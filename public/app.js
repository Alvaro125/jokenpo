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
    const username = e.target.username.value;
    const password = e.target.password.value;
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
            localStorage.setItem('jwtToken', data.token);
            myUserId = data.userId;
            myUsername = data.username;
            appendMessage('Login bem-sucedido!');
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            playerInfoDiv.textContent = `Logado como: ${myUsername} (ID: ${myUserId})`;
            playerInfoDiv.style.display = 'block';
            roomActions.style.display = 'block';
            connectWebSocket(data.token);
        } else {
            appendMessage(data.message || 'Falha no login.');
        }
    } catch (err) {
        appendMessage('Erro ao fazer login.');
        console.error(err);
    }
});

// --- Funções WebSocket e Jogo ---
function connectWebSocket(token) {
    // Certifique-se que o caminho /ws corresponde ao definido no server.on('upgrade')
    socket = new WebSocket(`ws://${window.location.host}/ws?token=${token}`);

    socket.onopen = () => {
        appendMessage('Conectado ao servidor WebSocket!');
        gameControls.style.display = 'block'; // Mostra controles gerais do jogo
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Mensagem do servidor:', message);
        handleServerMessage(message);
    };

    socket.onclose = () => {
        appendMessage('Desconectado do servidor WebSocket.');
        gameControls.style.display = 'none';
        roomActions.style.display = 'none';
        gameArea.style.display = 'none';
        loginForm.style.display = 'block'; // Volta para tela de login
        registerForm.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        localStorage.removeItem('jwtToken');
    };

    socket.onerror = (error) => {
        appendMessage('Erro na conexão WebSocket.');
        console.error('WebSocket Error:', error);
    };
}

function handleServerMessage(message) {
    appendMessage(`Servidor: ${message.payload?.message || JSON.stringify(message.payload)} (Tipo: ${message.type})`);
    switch (message.type) {
        case 'ROOM_CREATED':
            currentRoomCode = message.payload.roomCode;
            roomInfoDiv.textContent = `Sala Criada: ${currentRoomCode}. Compartilhe este código! Aguardando oponente...`;
            roomInfoDiv.style.display = 'block';
            roomActions.style.display = 'none'; // Esconde botões de criar/entrar
            updatePlayerList(message.payload.players);
            break;
        case 'PLAYER_JOINED':
            currentRoomCode = message.payload.roomCode; // Confirma a sala atual
            roomInfoDiv.textContent = `Você está na sala: ${currentRoomCode}. Status: ${message.payload.status}`;
            roomInfoDiv.style.display = 'block';
            roomActions.style.display = 'none';
            updatePlayerList(message.payload.players);
             if (message.payload.status === 'playing') {
                // gameArea.style.display = 'block'; // Já é feito por GAME_START
            }
            break;
        case 'GAME_START':
            gameArea.style.display = 'block';
            choicesDiv.style.display = 'flex'; // Mostra botões de escolha
            appendMessage(message.payload.message);
            break;
        case 'CHOICE_MADE':
            // Apenas uma confirmação para o jogador que fez a escolha
            appendMessage(`Sua escolha foi registrada. Aguardando oponente...`);
            choicesDiv.style.display = 'none'; // Esconde botões após a escolha
            break;
        case 'GAME_RESULT':
            choicesDiv.style.display = 'none'; // Garante que escolhas estão escondidas
            let resultText = `Resultado na sala ${message.payload.roomCode}: `;
            const p1 = message.payload.choices[Object.keys(message.payload.choices)[0]];
            const p2 = message.payload.choices[Object.keys(message.payload.choices)[1]];
            resultText += `${p1.username} (${p1.choice}) vs ${p2.username} (${p2.choice}). `;

            if (message.payload.result === 'draw') {
                resultText += "Empate!";
            } else if (message.payload.winnerId === myUserId) {
                resultText += "Você venceu!";
            } else {
                resultText += `Vencedor: ${message.payload.winnerUsername}. Você perdeu!`;
            }
            appendMessage(resultText);
            // Permitir jogar novamente
            setTimeout(() => {
                 if (gameArea.style.display === 'block') { // Só mostra se ainda estiver na tela de jogo
                    choicesDiv.style.display = 'flex';
                    appendMessage("Nova rodada! Façam suas escolhas.");
                }
            }, 3000); // Delay para ler o resultado
            break;
        case 'OPPONENT_LEFT':
            appendMessage(message.payload.message);
            gameArea.style.display = 'none'; // Esconde área de jogo
            roomInfoDiv.textContent += " Oponente saiu. Aguardando...";
            // Poderia reabilitar roomActions ou ter um botão "Sair da Sala"
            break;
        case 'ERROR':
            appendMessage(`Erro do Servidor: ${message.payload.message}`);
            break;
        default:
            console.warn('Tipo de mensagem não tratada:', message.type);
    }
}

function updatePlayerList(players) {
    // Lógica para exibir a lista de jogadores na sala (opcional)
    console.log("Jogadores na sala:", players);
}


createRoomBtn.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'CREATE_ROOM' }));
    }
});

joinRoomBtn.addEventListener('click', () => {
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (roomCode && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomCode } }));
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
        choicesDiv.style.display = 'none'; // Esconde botões após a escolha
    }
}

function appendMessage(text) {
    const p = document.createElement('p');
    p.textContent = text;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll
}

// Tenta reconectar ou reautenticar se já houver um token ao carregar a página
window.onload = () => {
    const token = localStorage.getItem('jwtToken');
    if (token) {
        // Tentar validar o token com o backend (opcional, para pegar userId/username)
        // ou decodificar localmente (menos seguro se precisar de dados frescos)
        // Por simplicidade, vamos assumir que se o token existe, tentamos conectar.
        // O servidor irá validar o token de qualquer maneira.
        // Para obter userId e username, uma chamada /api/auth/me (com token no header) seria ideal.
        // Aqui, vamos simplificar e exigir novo login se a página for recarregada,
        // a menos que você implemente a recuperação de user info.
        // Se você armazenou userId e username no localStorage junto com o token:
        const storedUserId = localStorage.getItem('userId');
        const storedUsername = localStorage.getItem('username');
        if (storedUserId && storedUsername) {
            myUserId = storedUserId;
            myUsername = storedUsername;
            appendMessage('Reconectando com token existente...');
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            playerInfoDiv.textContent = `Logado como: ${myUsername} (ID: ${myUserId})`;
            playerInfoDiv.style.display = 'block';
            roomActions.style.display = 'block';
            connectWebSocket(token);
        } else {
            // Se não tem user info, força novo login para obter esses dados
            localStorage.removeItem('jwtToken'); // Limpa token possivelmente inválido ou incompleto
        }
    }
};

// Adicione um botão de logout
const logoutBtn = document.getElementById('logoutBtn'); // Crie este botão no HTML
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
        if (socket) socket.close(); // Fecha a conexão WS
        // Redireciona ou reseta a UI para o estado de login
        window.location.reload(); // Simplesmente recarrega a página
    });
}