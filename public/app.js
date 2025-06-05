const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const gameControls = document.getElementById('gameControls');
const roomActions = document.getElementById('roomActions');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const gameArea = document.getElementById('gameArea');
const choicesDiv = document.getElementById('choices');
const rockBtn = document.getElementById('rockBtn');
const paperBtn = document.getElementById('paperBtn');
const scissorsBtn = document.getElementById('scissorsBtn');
const messagesDiv = document.getElementById('messages');
const roomInfoDiv = document.getElementById('roomInfo');
const playerInfoDiv = document.getElementById('playerInfo');
const logoutBtn = document.getElementById('logoutBtn');

let socket;
let currentRoomCode = null;
let myUserId = null;
let myUsername = null;

// --- Funções de Autenticação ---
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        appendMessage(data.message || (res.ok ? 'Registro bem-sucedido!' : 'Erro no registro.'));
        if (res.ok) registerForm.reset();
    } catch (err) {
        appendMessage('Erro ao registrar.');
        console.error(err);
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameVal = e.target.username.value; // Renomeado para evitar conflito
    const passwordVal = e.target.password.value; // Renomeado para evitar conflito
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameVal, password: passwordVal }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
            localStorage.setItem('jwtToken', data.token);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('username', data.username);
            myUserId = data.userId;
            myUsername = data.username;

            updateLoginState(true);
            connectWebSocket(data.token);
        } else {
            appendMessage(data.message || 'Falha no login.');
        }
    } catch (err) {
        appendMessage('Erro ao fazer login.');
        console.error(err);
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    if (socket) socket.close();
    myUserId = null;
    myUsername = null;
    currentRoomCode = null;
    updateLoginState(false);
    appendMessage("Você foi desconectado.");
});

function updateLoginState(isLoggedIn) {
    if (isLoggedIn) {
        appendMessage(`Login como ${myUsername} bem-sucedido!`);
        loginForm.style.display = 'none';
        registerForm.style.display = 'none';
        playerInfoDiv.textContent = `Logado como: ${myUsername} (ID: ${myUserId})`;
        playerInfoDiv.style.display = 'block';
        logoutBtn.style.display = 'inline';
        roomActions.style.display = 'block';
        gameControls.style.display = 'block'; // Mostra controles gerais do jogo
    } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        logoutBtn.style.display = 'none';
        roomActions.style.display = 'none';
        gameControls.style.display = 'none';
        gameArea.style.display = 'none';
        roomInfoDiv.style.display = 'none';
    }
}


// --- Funções WebSocket e Jogo ---
function connectWebSocket(token) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${token}`;
    appendMessage(`Tentando conectar a: ${wsUrl}`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        appendMessage('Conectado ao servidor WebSocket!');
        // O servidor agora tentará reconectar automaticamente e enviar ROOM_STATE_UPDATE se aplicável.
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Mensagem do servidor:', message);
        handleServerMessage(message);
    };

    socket.onclose = (event) => {
        let reason = `Código: ${event.code || 'N/A'}. Motivo: ${event.reason || 'N/A'}.`;
        reason += event.wasClean ? ' (Conexão limpa)' : ' (Conexão não limpa)';
        appendMessage(`Desconectado do servidor WebSocket. ${reason}`);
        // Não resetar o estado de login aqui, pois pode ser uma desconexão temporária.
        // A UI pode indicar "Tentando reconectar..." ou o usuário pode ter que logar novamente se o token expirar.
        // Se o logoutBtn for clicado, ele limpa o localStorage e reseta o estado.
        // Se a página for recarregada, window.onload tentará reconectar.
        // Para uma melhor UX, um indicador de status da conexão seria útil.
        // Por ora, se o socket fecha, a UI de jogo/sala pode ser escondida,
        // mas os forms de login não são mostrados automaticamente a menos que o logout seja explícito.
        gameControls.style.display = 'none'; // Esconde controles se desconectado
        roomInfoDiv.textContent = "Desconectado. Tente recarregar ou fazer login novamente.";
    };

    socket.onerror = (error) => {
        appendMessage('Erro na conexão WebSocket. Verifique o console.');
        console.error('WebSocket Error:', error);
    };
}

function renderRoomState(payload) {
    currentRoomCode = payload.roomCode;
    roomInfoDiv.textContent = `Sala: ${currentRoomCode}. Status: ${payload.status}. Jogadores: ${payload.players.map(p => p.username).join(', ')}`;
    roomInfoDiv.style.display = 'block';
    roomActions.style.display = 'none'; // Esconde criar/entrar após estar em uma sala

    if (payload.status === 'playing' || payload.status === 'draw' || payload.status.includes('_won')) {
        gameArea.style.display = 'block';
        choicesDiv.style.display = 'flex'; // Mostra botões por padrão

        // Verifica se o jogador atual já fez uma escolha nesta rodada
        if (payload.myChoice) {
            appendMessage(`Você já escolheu: ${payload.myChoice}. Aguardando oponente...`);
            choicesDiv.style.display = 'none'; // Esconde se já escolheu
        } else if (payload.choices && Object.keys(payload.choices).length === payload.players.length && payload.players.length === 2) {
            // Ambos escolheram, mas o resultado ainda não foi processado (ou é uma nova rodada pós-resultado)
             choicesDiv.style.display = 'none'; // Esconder para resultado
        } else {
            choicesDiv.style.display = 'flex';
        }


        // Lógica para exibir as escolhas dos outros (se o jogo permitir ou após o resultado)
        // Esta parte é mais relevante para o GAME_RESULT
    } else if (payload.status === 'waiting') {
        gameArea.style.display = 'none';
        appendMessage("Aguardando outro jogador...");
    } else {
        gameArea.style.display = 'none';
    }
}


function handleServerMessage(message) {
    appendMessage(`Servidor: ${message.payload?.message || JSON.stringify(message.payload)} (Tipo: ${message.type})`);
    switch (message.type) {
        case 'WELCOME_NEW_CONNECTION':
            // Usuário conectado, mas não em uma sala. Mostrar opções de sala.
            roomActions.style.display = 'block';
            gameArea.style.display = 'none';
            roomInfoDiv.style.display = 'none';
            break;
        case 'ROOM_STATE_UPDATE': // Mensagem ao reconectar a uma sala
            renderRoomState(message.payload);
            appendMessage("Reconectado e estado da sala sincronizado!");
            break;
        case 'ROOM_CREATED':
            renderRoomState(message.payload);
            break;
        case 'PLAYER_JOINED':
            renderRoomState(message.payload);
            break;
        case 'GAME_START':
            gameArea.style.display = 'block';
            choicesDiv.style.display = 'flex';
            appendMessage(message.payload.message);
            break;
        case 'CHOICE_MADE':
            appendMessage(`Sua escolha (${message.payload.choice}) foi registrada. Aguardando oponente...`);
            choicesDiv.style.display = 'none';
            break;
        case 'OPPONENT_CHOICE_MADE':
            appendMessage(message.payload.message);
            break;
        case 'GAME_RESULT':
            choicesDiv.style.display = 'none';
            let resultText = `Resultado na sala ${message.payload.roomCode}: `;
            const p1Data = message.payload.choices[Object.keys(message.payload.choices).find(k => message.payload.choices[k].username === message.payload.choices[room.player1IdActual]?.username)];
            const p2Data = message.payload.choices[Object.keys(message.payload.choices).find(k => message.payload.choices[k].username === message.payload.choices[room.player2IdActual]?.username)];

            if (p1Data && p2Data) {
                 resultText += `${p1Data.username} (${p1Data.choice}) vs ${p2Data.username} (${p2Data.choice}). `;
            } else {
                // Fallback se os usernames não puderem ser mapeados diretamente (improvável com a lógica atual do servidor)
                const choicesMade = Object.values(message.payload.choices);
                resultText += `${choicesMade[0].username} (${choicesMade[0].choice}) vs ${choicesMade[1].username} (${choicesMade[1].choice}). `;
            }


            if (message.payload.result === 'draw') {
                resultText += "Empate!";
            } else if (message.payload.winnerId === myUserId) {
                resultText += "Você venceu!";
            } else if (message.payload.winnerUsername) {
                resultText += `Vencedor: ${message.payload.winnerUsername}. Você perdeu!`;
            } else {
                 resultText += `Resultado: ${message.payload.result}`;
            }
            appendMessage(resultText);
            break;
        case 'NEW_ROUND':
             appendMessage(message.payload.message);
             choicesDiv.style.display = 'flex'; // Mostrar escolhas para nova rodada
             gameArea.style.display = 'block'; // Garantir que a área de jogo está visível
            break;
        case 'PLAYER_RECONNECTED':
            appendMessage(`${message.payload.username} reconectou-se à sala.`);
            // Atualizar lista de jogadores ou status, se necessário (renderRoomState pode ser chamado se mais dados vierem)
            break;
        case 'OPPONENT_DISCONNECTED':
            appendMessage(message.payload.message || `${message.payload.username} desconectou-se.`);
            // A sala continua, aguardando reconexão do oponente
            // A UI pode indicar "Oponente desconectado, aguardando..."
            if (roomInfoDiv.style.display === 'block') {
                 roomInfoDiv.textContent += ` (${message.payload.username} desconectou-se, aguardando...)`;
            }
            break;
        case 'ERROR':
            appendMessage(`Erro do Servidor: ${message.payload.message}`);
            break;
        default:
            console.warn('Tipo de mensagem não tratada:', message.type);
    }
}

createRoomBtn.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'CREATE_ROOM' }));
    }
});

joinRoomBtn.addEventListener('click', () => {
    const roomCodeVal = roomCodeInput.value.trim().toUpperCase(); // Renomeado
    if (roomCodeVal && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomCode: roomCodeVal } }));
        roomCodeInput.value = '';
    } else {
        appendMessage('Digite um código de sala válido.');
    }
});

rockBtn.addEventListener('click', () => makeChoice('rock'));
paperBtn.addEventListener('click', () => makeChoice('paper'));
scissorsBtn.addEventListener('click', () => makeChoice('scissors'));

function makeChoice(choice) {
    if (currentRoomCode && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'MAKE_CHOICE', payload: { roomCode: currentRoomCode, choice } }));
    }
}

function appendMessage(text) {
    const p = document.createElement('p');
    const timestamp = new Date().toLocaleTimeString();
    p.textContent = `[${timestamp}] ${text}`;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

window.onload = () => {
    const token = localStorage.getItem('jwtToken');
    const storedUserId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');

    if (token && storedUserId && storedUsername) {
        myUserId = parseInt(storedUserId); // IDs de usuário são geralmente números
        myUsername = storedUsername;
        updateLoginState(true);
        connectWebSocket(token);
    } else {
        updateLoginState(false);
    }
};
