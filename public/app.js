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
const roomInfoText = document.getElementById('roomInfoText');
const roomInfoIcon = document.getElementById('roomInfoIcon');
const playerInfoDiv = document.getElementById('playerInfo');
const playerInfoContainer = document.getElementById('playerInfoContainer');
const logoutBtn = document.getElementById('logoutBtn');
const authForms = document.getElementById('authForms');
const closeRoomBtn = document.getElementById('closeRoomBtn'); // Added close room button

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');
const themeSwitcher = document.getElementById('themeSwitcher');


// --- Global State ---
let socket;
let currentRoomCode = null;
let myUserId = null;
let myUsername = null;
let currentRoomOwnerId = null; // To track owner for showing close button

// --- Loading State Functions ---
function showLoading(message = 'Processando...') {
    loadingMessage.textContent = message;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// --- Notification/Message Function ---
function appendMessage(text, type = 'game') { // type: 'game', 'success', 'error', 'warning', 'info'
    if (messagesDiv.innerHTML.includes('Aguardando ações...') || (type === 'info' && text.includes("Você foi desconectado.")) || (type === 'warning' && text.includes("foi fechada pelo proprietário"))) {
        messagesDiv.innerHTML = ''; // Clear initial or specific messages before adding new
    }

    const messageWrapper = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let iconSvg = '';
    let alertClass = '';

    switch (type) {
        case 'success':
            alertClass = 'alert-success';
            iconSvg = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
            break;
        case 'error':
            alertClass = 'alert-error';
            iconSvg = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
            break;
        case 'warning':
            alertClass = 'alert-warning';
            iconSvg = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
            break;
        case 'info':
            alertClass = 'alert-info';
            iconSvg = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            break;
        case 'game':
        default:
            messageWrapper.className = 'chat chat-start';
            messageWrapper.innerHTML = `
                <div class="chat-header text-xs opacity-70">
                    Jogo @ ${timestamp}
                </div>
                <div class="chat-bubble chat-bubble-secondary">
                    ${text}
                </div>`;
            messagesDiv.appendChild(messageWrapper);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            return;
    }

    messageWrapper.className = `alert ${alertClass} shadow-md`;
    messageWrapper.innerHTML = `
        ${iconSvg}
        <div>
            <h3 class="font-bold text-sm">${type.toUpperCase()} @ ${timestamp}</h3>
            <div class="text-xs">${text}</div>
        </div>
    `;
    messagesDiv.appendChild(messageWrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- Authentication Functions (Cookie Based) ---
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    showLoading('Registrando...');
    try {
        // Server is expected to set an HTTP-only cookie on success
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        
        appendMessage(data.message || (res.ok ? 'Registro bem-sucedido!' : 'Erro no registro.'), res.ok ? 'success' : 'error');
        
        if (res.ok && data.user) {
            registerForm.reset();
            localStorage.setItem('userId', data.user.id);
            localStorage.setItem('username', data.user.username);
            myUserId = data.user.id; // Ensure myUserId is an integer if it's stored as such in DB
            myUsername = data.user.username;
            updateLoginState(true);
            connectWebSocket(); // Connect without explicit token
        } else {
            updateLoginState(false);
        }
    } catch (err) {
        appendMessage('Erro ao conectar ao servidor de registro. Verifique sua conexão ou tente mais tarde.', 'error');
        console.error("Registration fetch error:", err);
        updateLoginState(false);
    } finally {
        hideLoading();
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameVal = e.target.username.value;
    const passwordVal = e.target.password.value;
    showLoading('Fazendo login...');
    try {
        // Server is expected to set an HTTP-only cookie on success
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameVal, password: passwordVal }),
        });
        const data = await res.json();

        if (res.ok && data.userId) {
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('username', data.username);
            myUserId = parseInt(data.userId); // Ensure myUserId is an integer
            myUsername = data.username;
            updateLoginState(true); // Calls appendMessage for success internally
            connectWebSocket(); // Connect without explicit token
        } else {
            appendMessage(data.message || 'Falha no login. Verifique usuário e senha.', 'error');
            updateLoginState(false);
        }
    } catch (err) {
        appendMessage('Erro ao conectar ao servidor de login. Verifique sua conexão ou tente mais tarde.', 'error');
        console.error("Login fetch error:", err);
        updateLoginState(false);
    } finally {
        hideLoading();
    }
});

logoutBtn.addEventListener('click', async () => {
    showLoading('Fazendo logout...');
    try {
        // Server is expected to clear the HTTP-only cookie
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
        appendMessage("Erro ao comunicar com o servidor para logout.", 'error');
        console.error("Logout fetch error:", err);
    } finally {
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
        if (socket) socket.close();
        myUserId = null;
        myUsername = null;
        currentRoomCode = null;
        currentRoomOwnerId = null;
        updateLoginState(false); 
        appendMessage("Você foi desconectado.", 'info');
        hideLoading();
    }
});

function updateLoginState(isLoggedIn) {
    if (isLoggedIn && myUsername) { 
        appendMessage(`Login como ${myUsername} bem-sucedido!`, 'success');
        authForms.style.display = 'none';
        playerInfoDiv.textContent = `Logado como: ${myUsername} (ID: ${myUserId})`;
        playerInfoContainer.style.display = 'block';
        logoutBtn.style.display = 'inline-block';
        roomActions.style.display = 'block';
        gameControls.style.display = 'block';
        gameArea.style.display = 'none';
        roomInfoDiv.style.display = 'none';
        closeRoomBtn.style.display = 'none';
    } else {
        authForms.style.display = 'grid';
        playerInfoContainer.style.display = 'none';
        logoutBtn.style.display = 'none';
        roomActions.style.display = 'none';
        gameControls.style.display = 'none';
        gameArea.style.display = 'none';
        roomInfoDiv.style.display = 'none';
        closeRoomBtn.style.display = 'none';
    }
}

// --- WebSocket and Game Functions ---
function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`; 
    // const wsUrl = `ws://localhost:8080/ws`; // Backend on 8080
    
    appendMessage(`Tentando conectar ao WebSocket...`, 'info');
    
    if (typeof WebSocket === 'undefined' || wsUrl.includes('//localhost:PORT_FOR_MOCK')) { 
        console.warn("Using MOCK WebSocket implementation.");
        socket = {
            readyState: 0, 
            onopen: null, onmessage: null, onclose: null, onerror: null,
            send: function(data) {
                console.log("MOCK WS SEND:", data);
                const message = JSON.parse(data);
                setTimeout(() => handleMockServerMessage(message), 500);
            },
            close: function() {
                console.log("MOCK WS CLOSE");
                this.readyState = 3; // CLOSED
                if (this.onclose) this.onclose({code: 1000, reason: "Logout by user/Socket closed (Mock)", wasClean: true});
            }
        };
        setTimeout(() => {
            if (socket.onopen) {
                 socket.readyState = 1; // OPEN
                 socket.onopen();
            } else if (socket.onerror && socket.readyState !==1) {
                 socket.onerror({message: "Mock connection failed to open"});
            }
        }, 1000);
    } else {
        socket = new WebSocket(wsUrl);
    }

    socket.onopen = () => {
        appendMessage('Conectado ao servidor WebSocket!', 'success');
         if (socket.send && socket.readyState === 1 && typeof handleMockServerMessage !== 'undefined' && (wsUrl.includes('//localhost:PORT_FOR_MOCK') || typeof WebSocket === 'undefined')) { 
            socket.onmessage({ data: JSON.stringify({ type: 'WELCOME_NEW_CONNECTION', payload: { message: "Bem-vindo! Crie ou entre em uma sala."}})});
         }
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Mensagem do servidor:', message);
            handleServerMessage(message);
        } catch (e) {
            console.error("Failed to parse server message:", event.data, e);
            appendMessage("Recebida mensagem malformada do servidor.", "error");
        }
    };

    socket.onclose = (event) => {
        let reason = `Código: ${event.code || 'N/A'}. Motivo: ${event.reason || 'Desconhecido'}.`;
        reason += event.wasClean ? ' (Conexão limpa)' : ' (Conexão interrompida)';
        appendMessage(`Desconectado do servidor WebSocket. ${reason}`, 'warning');
        
        roomInfoText.textContent = "Desconectado. Poderá precisar fazer login novamente.";
        roomInfoDiv.className = 'alert alert-warning shadow-lg';
        roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
        roomInfoDiv.style.display = 'flex';
        gameArea.style.display = 'none';
        choicesDiv.style.display = 'none';
        closeRoomBtn.style.display = 'none'; // Hide close button on disconnect
        currentRoomOwnerId = null;
    };

    socket.onerror = (error) => {
        appendMessage('Erro na conexão WebSocket. Verifique o console e se o servidor está online.', 'error');
        console.error('WebSocket Error:', error);
        roomInfoText.textContent = "Falha ao conectar ao WebSocket.";
        roomInfoDiv.className = 'alert alert-error shadow-lg';
        roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
        roomInfoDiv.style.display = 'flex';
        closeRoomBtn.style.display = 'none';
        currentRoomOwnerId = null;
    };
}

// --- Mock Server Logic for UI testing (Remove/Adapt for production) ---
let mockRoom = null; 
function handleMockServerMessage(clientMessage) {
    if (!socket || socket.readyState !== 1) { 
        console.warn("Mock server: Socket not open or undefined, cannot process message", clientMessage);
        return;
    }

    let serverResponse = { type: "ERROR", payload: { message: "Ação desconhecida no mock server." } };

    switch (clientMessage.type) {
        case 'CREATE_ROOM':
            if (!mockRoom) { 
                currentRoomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
                currentRoomOwnerId = myUserId; // Creator is owner
                mockRoom = {
                    roomCode: currentRoomCode,
                    ownerId: currentRoomOwnerId,
                    status: 'waiting',
                    players: [{ userId: myUserId, username: myUsername }],
                    choices: {},
                    myChoice: null 
                };
                serverResponse = { type: 'ROOM_CREATED', payload: { ...mockRoom } };
            } else {
                serverResponse = { type: "ERROR", payload: { message: "Você já está em uma sala (mock)." } };
            }
            break;
        case 'JOIN_ROOM':
            if (clientMessage.payload.roomCode && !mockRoom) {
                currentRoomCode = clientMessage.payload.roomCode;
                const otherMockPlayerId = 999; // Simulated existing player
                currentRoomOwnerId = otherMockPlayerId; // Assume the existing player is owner
                mockRoom = {
                    roomCode: currentRoomCode,
                    ownerId: currentRoomOwnerId,
                    status: 'waiting', 
                    players: [{userId: otherMockPlayerId, username: `Jogador_B_${Math.floor(Math.random()*100)}`}, { userId: myUserId, username: myUsername }],
                    choices: {},
                    myChoice: null
                };
                socket.onmessage({ data: JSON.stringify({ type: 'PLAYER_JOINED', payload: {...mockRoom} }) });
                setTimeout(() => {
                    if(mockRoom) { 
                        mockRoom.status = 'playing';
                        socket.onmessage({ data: JSON.stringify({ type: 'GAME_START', payload: { ...mockRoom, message: "O jogo começou! Faça sua escolha."}})});
                    }
                }, 500);
                return; 
            } else if (mockRoom) {
                serverResponse = { type: "ERROR", payload: { message: "Você já está em uma sala (mock) e não pode entrar em outra." } };
            } else {
                serverResponse = { type: "ERROR", payload: { message: "Código da sala inválido para entrar (mock)." } };
            }
            break;
        case 'MAKE_CHOICE':
            if (mockRoom && mockRoom.status === 'playing' && clientMessage.payload.roomCode === mockRoom.roomCode) {
                mockRoom.choices[myUserId.toString()] = { username: myUsername, choice: clientMessage.payload.choice };
                mockRoom.myChoice = clientMessage.payload.choice;

                serverResponse = { type: 'CHOICE_MADE', payload: { choice: clientMessage.payload.choice, roomCode: mockRoom.roomCode }};
                socket.onmessage({ data: JSON.stringify(serverResponse) });

                setTimeout(() => {
                    if (!mockRoom) return; 
                    const opponent = mockRoom.players.find(p => p.userId !== myUserId);
                    if (opponent && !mockRoom.choices[opponent.userId.toString()]) {
                        const opponentPossibleChoices = ['rock', 'paper', 'scissors'];
                        const opponentChoice = opponentPossibleChoices[Math.floor(Math.random() * opponentPossibleChoices.length)];
                        mockRoom.choices[opponent.userId.toString()] = {username: opponent.username, choice: opponentChoice};
                        socket.onmessage({ data: JSON.stringify({ type: 'OPPONENT_CHOICE_MADE', payload: { message: `${opponent.username} fez uma escolha.`, roomCode: mockRoom.roomCode }})});
                    }

                    if (Object.keys(mockRoom.choices).length === mockRoom.players.length) { 
                        const myData = mockRoom.choices[myUserId.toString()];
                        const opponentData = mockRoom.choices[opponent.userId.toString()];
                        let resultType = 'draw';
                        let winnerId = null;
                        let winnerUsername = null;

                        if (myData.choice === opponentData.choice) resultType = 'draw';
                        else if ((myData.choice === 'rock' && opponentData.choice === 'scissors') ||
                                 (myData.choice === 'scissors' && opponentData.choice === 'paper') ||
                                 (myData.choice === 'paper' && opponentData.choice === 'rock')) {
                            resultType = `${myUsername}_won`; winnerId = myUserId; winnerUsername = myUsername;
                        } else {
                            resultType = `${opponentData.username}_won`; winnerId = opponent.userId; winnerUsername = opponentData.username;
                        }
                        mockRoom.status = resultType;

                        socket.onmessage({ data: JSON.stringify({ type: 'GAME_RESULT', payload: {
                            roomCode: mockRoom.roomCode,
                            ownerId: mockRoom.ownerId, // Include ownerId
                            choices: {...mockRoom.choices}, 
                            result: resultType,
                            winnerId: winnerId,
                            winnerUsername: winnerUsername
                        }})});
                        
                        setTimeout(() => {
                            if(mockRoom) { 
                                mockRoom.choices = {};
                                mockRoom.myChoice = null;
                                mockRoom.status = 'playing';
                                socket.onmessage({ data: JSON.stringify({ type: 'NEW_ROUND', payload: { message: "Nova rodada! Faça sua escolha.", roomCode: mockRoom.roomCode, ownerId: mockRoom.ownerId }})});
                            }
                        }, 3000);
                    }
                }, 1500);
                return; 
            } else {
                 serverResponse = { type: "ERROR", payload: { message: "Não é possível fazer a escolha agora (mock)." } };
            }
            break;
        case 'CLOSE_ROOM': // Added mock for CLOSE_ROOM
            if (mockRoom && mockRoom.roomCode === clientMessage.payload.roomCode) {
                if (myUserId === mockRoom.ownerId) {
                    serverResponse = { type: 'ROOM_CLOSED', payload: { roomCode: mockRoom.roomCode, message: `Sala ${mockRoom.roomCode} fechada pelo proprietário (mock).` }};
                    mockRoom = null;
                    currentRoomCode = null;
                    currentRoomOwnerId = null;
                } else {
                    serverResponse = { type: 'ERROR', payload: { message: "Você não pode fechar esta sala (mock)." } };
                }
            } else {
                serverResponse = { type: 'ERROR', payload: { message: "Sala não encontrada para fechar (mock)." } };
            }
            break;
        default:
            break;
    }
    if (socket && socket.readyState === 1) {
      socket.onmessage({ data: JSON.stringify(serverResponse) });
    }
}
// --- End Mock Server Logic ---

function renderRoomState(payload) {
    currentRoomCode = payload.roomCode;
    currentRoomOwnerId = payload.ownerId; // Store owner ID
    const isOwner = myUserId === currentRoomOwnerId;

    roomInfoDiv.className = 'alert alert-info shadow-lg'; // Default to info
    roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    roomInfoText.textContent = `Sala: ${currentRoomCode}. Status: ${payload.status}. Jogadores: ${payload.players.map(p => p.username).join(', ')}`;
    roomInfoDiv.style.display = 'flex'; // Use flex for roomInfo to align items
    roomActions.style.display = 'none';

    // Show or hide close room button based on ownership and room status
    if (isOwner && payload.status !== 'closed' && roomInfoDiv.style.display === 'flex') { // Check if roomInfo is visible
        closeRoomBtn.style.display = 'inline-block';
    } else {
        closeRoomBtn.style.display = 'none';
    }

    if (payload.status === 'playing') {
        gameArea.style.display = 'block';
        const currentPlayerMadeChoice = payload.myChoice || (mockRoom && mockRoom.roomCode === payload.roomCode && mockRoom.myChoice);

        if (currentPlayerMadeChoice) {
            choicesDiv.style.display = 'none';
        } else {
            choicesDiv.style.display = 'flex';
        }
    } else if (payload.status === 'waiting') {
        gameArea.style.display = 'none';
        choicesDiv.style.display = 'none';
        roomInfoDiv.className = 'alert alert-warning shadow-lg';
        roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
    } else { 
        gameArea.style.display = 'block'; 
        choicesDiv.style.display = 'none'; 
    }
}


function handleServerMessage(message) {
    // Ensure payload exists before trying to access its properties like ownerId
    const payload = message.payload || {};

    switch (message.type) {
        case 'WELCOME_NEW_CONNECTION':
            appendMessage(payload.message || "Conectado! Escolha uma sala.", 'info');
            roomActions.style.display = 'block';
            gameArea.style.display = 'none';
            roomInfoDiv.style.display = 'none';
            closeRoomBtn.style.display = 'none';
            break;
        case 'ROOM_STATE_UPDATE':
            renderRoomState(payload);
            appendMessage("Estado da sala sincronizado!", 'info');
            break;
        case 'ROOM_CREATED':
            renderRoomState(payload); // payload should include ownerId
            appendMessage(`Sala ${payload.roomCode} criada. Aguardando jogadores...`, 'success');
            break;
        case 'PLAYER_JOINED':
            renderRoomState(payload); // payload should include ownerId
            const newPlayerUsername = payload.players.length > 0 ? payload.players[payload.players.length-1]?.username : 'Novo jogador';
            appendMessage(`${newPlayerUsername || 'Um jogador'} entrou na sala.`, 'info');
            break;
        case 'GAME_START':
            renderRoomState(payload); // payload should include ownerId
            appendMessage(payload.message || "O jogo começou!", 'game');
            break;
        case 'CHOICE_MADE':
            appendMessage(`Sua escolha (${payload.choice}) foi registrada. Aguardando oponente...`, 'game');
            choicesDiv.style.display = 'none';
            if(mockRoom && mockRoom.roomCode === payload.roomCode) mockRoom.myChoice = payload.choice;
            break;
        case 'OPPONENT_CHOICE_MADE':
            appendMessage(payload.message || "Oponente fez uma escolha.", 'game');
            break;
        case 'GAME_RESULT':
            choicesDiv.style.display = 'none';
            gameArea.style.display = 'block'; 
            currentRoomOwnerId = payload.ownerId; // Update ownerId from result if available
            const isOwnerForResult = myUserId === currentRoomOwnerId;

            if (isOwnerForResult && roomInfoDiv.style.display === 'flex') {
                closeRoomBtn.style.display = 'inline-block';
            } else {
                closeRoomBtn.style.display = 'none';
            }

            let resultText = `Resultado na sala ${payload.roomCode}: `;
            const playerChoices = Object.values(payload.choices);

            if (playerChoices.length >= 2) { 
                const choiceDetails = playerChoices.map(c => `${c.username || 'Jogador'}(${c.choice || 'N/A'})`).join(' vs ');
                resultText += `${choiceDetails}. `;
            } else {
                resultText += `Jogo concluído. `;
            }

            if (payload.result === 'draw') {
                resultText += " Empate!";
                appendMessage(resultText, 'info');
                roomInfoDiv.className = 'alert alert-info shadow-lg';
                roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                roomInfoText.textContent = `Sala ${currentRoomCode}: Empate! Aguardando próxima rodada.`;
            } else if (payload.winnerId === myUserId) {
                resultText += " Você venceu!";
                appendMessage(resultText, 'success');
                roomInfoDiv.className = 'alert alert-success shadow-lg';
                roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
                roomInfoText.textContent = `Sala ${currentRoomCode}: Você Venceu! Parabéns!`;
            } else if (payload.winnerUsername) {
                resultText += ` Vencedor: ${payload.winnerUsername}. Você perdeu.`;
                appendMessage(resultText, 'error');
                roomInfoDiv.className = 'alert alert-error shadow-lg';
                roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
                roomInfoText.textContent = `Sala ${currentRoomCode}: Você Perdeu. Vencedor: ${payload.winnerUsername}.`;
            } else { 
                appendMessage(`${resultText} Resultado: ${payload.result || 'Indefinido'}`, 'game');
                roomInfoText.textContent = `Sala ${currentRoomCode}: Jogo finalizado. ${payload.result || 'Indefinido'}`;
            }
            roomInfoDiv.style.display = 'flex';
            if (mockRoom && mockRoom.roomCode === payload.roomCode) mockRoom.status = payload.result;
            break;
        case 'NEW_ROUND':
            renderRoomState({ ...payload, status: 'playing', roomCode: currentRoomCode, players: mockRoom ? mockRoom.players : [], ownerId: payload.ownerId || currentRoomOwnerId });
            appendMessage(payload.message || "Nova rodada começando!", 'info');
            roomInfoText.textContent = `Sala ${currentRoomCode}: Nova Rodada! Faça sua escolha.`;
            roomInfoDiv.className = 'alert alert-info shadow-lg'; 
            roomInfoIcon.innerHTML = '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            roomInfoDiv.style.display = 'flex';
            if (mockRoom && mockRoom.roomCode === (payload.roomCode || currentRoomCode)) { 
                mockRoom.choices = {};
                mockRoom.myChoice = null;
                mockRoom.status = 'playing';
                mockRoom.ownerId = payload.ownerId || currentRoomOwnerId;
            }
            break;
        case 'PLAYER_RECONNECTED':
            appendMessage(`${payload.username} reconectou-se à sala.`, 'info');
            if (payload.roomState) renderRoomState(payload.roomState); // roomState should include ownerId
            break;
        case 'OPPONENT_DISCONNECTED':
            appendMessage(payload.message || `${payload.username || 'Oponente'} desconectou-se.`, 'warning');
            if (roomInfoDiv.style.display === 'flex') {
                roomInfoText.textContent += ` (${payload.username || 'Oponente'} desconectou-se, aguardando...)`;
            }
             if (mockRoom && mockRoom.roomCode === (payload.roomCode || currentRoomCode) ) {
                const opponentUserId = payload.userId; 
                if (opponentUserId) {
                    mockRoom.players = mockRoom.players.filter(p => p.userId !== opponentUserId);
                }
                if (mockRoom.players.length < 2) { 
                    mockRoom.status = 'waiting';
                }
                renderRoomState({...mockRoom}); 
            }
            break;
        case 'ROOM_CLOSED': // Added handler for ROOM_CLOSED
            appendMessage(payload.message, 'warning');
            currentRoomCode = null;
            currentRoomOwnerId = null;
            roomInfoDiv.style.display = 'none';
            gameArea.style.display = 'none';
            choicesDiv.style.display = 'none';
            roomActions.style.display = 'block'; 
            closeRoomBtn.style.display = 'none';
            if (mockRoom && mockRoom.roomCode === payload.roomCode) {
                mockRoom = null;
            }
            break;
        case 'ERROR':
            appendMessage(`Erro do Servidor: ${payload.message}`, 'error');
            break;
        default:
            console.warn('Tipo de mensagem não tratada:', message.type, payload);
            appendMessage(`Mensagem não reconhecida do servidor: ${message.type}`, 'warning');
    }
}

// --- Event Listeners for Game Actions ---
createRoomBtn.addEventListener('click', () => {
    if (socket && socket.readyState === 1) { 
        socket.send(JSON.stringify({ type: 'CREATE_ROOM' }));
    } else {
        appendMessage('Não conectado ao servidor para criar sala.', 'error');
    }
});

joinRoomBtn.addEventListener('click', () => {
    const roomCodeVal = roomCodeInput.value.trim().toUpperCase();
    if (roomCodeVal && socket && socket.readyState === 1) { 
        socket.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomCode: roomCodeVal } }));
        roomCodeInput.value = '';
    } else if (!roomCodeVal){
        appendMessage('Digite um código de sala válido.', 'warning');
    } else {
        appendMessage('Não conectado ao servidor para entrar na sala.', 'error');
    }
});

// Added event listener for close room button
closeRoomBtn.addEventListener('click', () => {
    if (currentRoomCode && socket && socket.readyState === 1) {
        showLoading('Fechando sala...');
        socket.send(JSON.stringify({ type: 'CLOSE_ROOM', payload: { roomCode: currentRoomCode } }));
    } else {
        appendMessage('Não é possível fechar a sala. Verifique a conexão e se está em uma sala válida.', 'error');
    }
    hideLoading();
});


rockBtn.addEventListener('click', () => makeChoice('rock'));
paperBtn.addEventListener('click', () => makeChoice('paper'));
scissorsBtn.addEventListener('click', () => makeChoice('scissors'));

function makeChoice(choice) {
    if (currentRoomCode && socket && socket.readyState === 1) { 
        socket.send(JSON.stringify({ type: 'MAKE_CHOICE', payload: { roomCode: currentRoomCode, choice } }));
    } else {
        appendMessage('Não é possível fazer a escolha. Verifique a conexão e se está em uma sala.', 'error');
    }
}

// --- Initial Load ---
window.onload = () => {
    const storedUserIdStr = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');

    const savedTheme = localStorage.getItem('theme') || 'light'; 
    document.documentElement.setAttribute('data-theme', savedTheme);
    if(themeSwitcher) themeSwitcher.value = savedTheme;

    if (storedUserIdStr && storedUsername) {
        myUserId = parseInt(storedUserIdStr); // Parse userId to integer
        myUsername = storedUsername;
        updateLoginState(true); 
        connectWebSocket();     
    } else {
        updateLoginState(false); 
        messagesDiv.innerHTML = '<div class="text-center text-base-content/60 p-4">Bem-vindo! Faça login ou registre-se para jogar.</div>';
    }
};

if(themeSwitcher) {
    themeSwitcher.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}