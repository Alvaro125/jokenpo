// src/services/gameService.js
// ... (código completo do gameService.js da iteração anterior com reconexão) ...
// Pontos chave:
// - `initializeGameService(wss)`: Configura o listener para novas conexões.
// - `attemptPlayerReconnection(ws)`: Tenta recolocar um utilizador numa sala se ele se reconectar.
// - `handleCreateRoom(ws)`: Cria uma nova sala de jogo.
// - `handleJoinRoom(ws, roomCode)`: Permite que um utilizador entre numa sala existente.
// - `handleMakeChoice(ws, roomCode, choice)`: Processa a jogada de um utilizador.
// - `determineWinner(choice1, choice2)`: Lógica do Jokenpô.
// - `handlePlayerDisconnect(ws)`: Lida com a desconexão de um utilizador.
// O restante do código do gameService.js fornecido na última iteração do Canvas
// com a lógica de reconexão e persistência de estado é aplicável aqui.
// Cole o código completo do gameService.js aqui.
// Por questões de brevidade neste exemplo formatado, ele não será repetido integralmente,
// mas deve ser o mesmo da versão anterior que incluía a lógica de reconexão.
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const User = require('../models/userModel');

const rooms = new Map(); // roomCode -> { id (DB room id), roomCode, players: Map<userId, ws>, choices: Map<userId, choice>, status, player1IdActual, player2IdActual, playerUsernames: Map<userId, username> }

async function attemptPlayerReconnection(ws) {
    console.log(`Tentando reconectar ${ws.clientUsername} (ID: ${ws.clientId})`);
    for (const [roomCode, room] of rooms) {
        if ((room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId) &&
            (!room.players.has(ws.clientId) || room.players.get(ws.clientId) !== ws)) {
            console.log(`${ws.clientUsername} pertence à sala ${roomCode}. Reconectando...`);
            room.players.set(ws.clientId, ws);
            room.playerUsernames.set(ws.clientId, ws.clientUsername);
            ws.currentRoomCode = roomCode;
            const currentPlayersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
            const choicesForClient = {};
            room.choices.forEach((choice, userId) => {
                choicesForClient[userId] = { choice: choice, username: room.playerUsernames.get(userId) };
            });
            const roomStatePayload = {
                roomCode: room.roomCode,
                roomId: room.id,
                players: currentPlayersList,
                status: room.status,
                choices: choicesForClient,
                myChoice: room.choices.get(ws.clientId) || null
            };
            ws.send(JSON.stringify({ type: 'ROOM_STATE_UPDATE', payload: roomStatePayload }));
            const otherPlayerId = room.player1IdActual === ws.clientId ? room.player2IdActual : room.player1IdActual;
            if (otherPlayerId && room.players.has(otherPlayerId)) {
                const otherPlayerWs = room.players.get(otherPlayerId);
                if (otherPlayerWs && otherPlayerWs.readyState === WebSocket.OPEN) {
                    otherPlayerWs.send(JSON.stringify({
                        type: 'PLAYER_RECONNECTED',
                        payload: { userId: ws.clientId, username: ws.clientUsername }
                    }));
                }
            }
            return true;
        }
    }
    console.log(`${ws.clientUsername} não encontrado em nenhuma sala ativa para reconexão.`);
    return false;
}


function initializeGameService(wss) {
    wss.on('connection', async (ws) => {
        console.log(`Cliente autenticado conectado: ${ws.clientUsername} (ID: ${ws.clientId})`);
        const reconnected = await attemptPlayerReconnection(ws);
        if (!reconnected) {
            ws.send(JSON.stringify({ type: 'WELCOME_NEW_CONNECTION', payload: { message: 'Bem-vindo! Crie ou entre numa sala.' } }));
        }
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`Mensagem recebida de ${ws.clientUsername} (Sala: ${ws.currentRoomCode || 'N/A'}):`, data);
                switch (data.type) {
                    case 'CREATE_ROOM':
                        handleCreateRoom(ws);
                        break;
                    case 'JOIN_ROOM':
                        handleJoinRoom(ws, data.payload.roomCode);
                        break;
                    case 'MAKE_CHOICE':
                        handleMakeChoice(ws, data.payload.roomCode || ws.currentRoomCode, data.payload.choice);
                        break;
                    default:
                        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Tipo de mensagem desconhecido.' } }));
                }
            } catch (error) {
                console.error('Erro ao processar mensagem:', error);
                ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Mensagem inválida.' } }));
            }
        });
        ws.on('close', () => {
            console.log(`Cliente desconectado: ${ws.clientUsername} (ID: ${ws.clientId})`);
            handlePlayerDisconnect(ws);
        });
        ws.on('error', (error) => {
            console.error(`Erro no WebSocket para ${ws.clientUsername}:`, error);
            handlePlayerDisconnect(ws);
        });
    });
}

async function handleCreateRoom(ws) {
    let roomCode;
    let roomExistsInDb = true;
    while (roomExistsInDb) {
        roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); // 5 chars
        const { rows } = await db.query('SELECT id FROM rooms WHERE room_code = $1', [roomCode]);
        if (rows.length === 0) roomExistsInDb = false;
    }
    try {
        const dbRoom = await db.query(
            'INSERT INTO rooms (room_code, player1_id, status) VALUES ($1, $2, $3) RETURNING id, status',
            [roomCode, ws.clientId, 'waiting']
        );
        const newRoomData = dbRoom.rows[0];
        const newRoom = {
            id: newRoomData.id,
            roomCode: roomCode,
            players: new Map(),
            choices: new Map(),
            status: newRoomData.status,
            player1IdActual: ws.clientId,
            player2IdActual: null,
            playerUsernames: new Map()
        };
        newRoom.players.set(ws.clientId, ws);
        newRoom.playerUsernames.set(ws.clientId, ws.clientUsername);
        rooms.set(roomCode, newRoom);
        ws.currentRoomCode = roomCode;
        ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            payload: { roomCode, roomId: newRoom.id, players: [{ userId: ws.clientId, username: ws.clientUsername }], status: newRoom.status }
        }));
        console.log(`Sala ${roomCode} criada por ${ws.clientUsername}. Status: ${newRoom.status}`);
    } catch (error) {
        console.error("Erro ao criar sala na BD:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao criar sala.' } }));
    }
}

async function handleJoinRoom(ws, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) {
        try {
            const { rows } = await db.query('SELECT * FROM rooms WHERE room_code = $1', [roomCode]);
            if (rows.length > 0) {
                const dbRoom = rows[0];
                if (dbRoom.player1_id && dbRoom.player2_id && dbRoom.player1_id !== ws.clientId && dbRoom.player2_id !== ws.clientId) {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (DB).' } })); return;
                }
                if (dbRoom.player1_id === ws.clientId || dbRoom.player2_id === ws.clientId) {
                    if (await attemptPlayerReconnection(ws)) return;
                }
                let joiningRoom = rooms.get(roomCode);
                if (!joiningRoom) {
                    const player1User = dbRoom.player1_id ? await User.findById(dbRoom.player1_id) : null;
                    joiningRoom = {
                        id: dbRoom.id,
                        roomCode: dbRoom.room_code,
                        players: new Map(),
                        choices: new Map(),
                        status: dbRoom.status,
                        player1IdActual: dbRoom.player1_id,
                        player2IdActual: dbRoom.player2_id,
                        playerUsernames: new Map()
                    };
                    if (player1User) joiningRoom.playerUsernames.set(player1User.id, player1User.username);
                    rooms.set(roomCode, joiningRoom);
                }
                const currentRoomInMemory = rooms.get(roomCode);
                if (!currentRoomInMemory) {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao carregar sala para entrar.' } })); return;
                }
                if (currentRoomInMemory.players.size >= 2 && !currentRoomInMemory.players.has(ws.clientId)) {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (memória).' } })); return;
                }
                if (currentRoomInMemory.players.has(ws.clientId)) {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } })); return;
                }
                let newStatus = currentRoomInMemory.status;
                if (!currentRoomInMemory.player1IdActual) {
                    await db.query('UPDATE rooms SET player1_id = $1 WHERE room_code = $2', [ws.clientId, roomCode]);
                    currentRoomInMemory.player1IdActual = ws.clientId;
                } else if (!currentRoomInMemory.player2IdActual) {
                    await db.query('UPDATE rooms SET player2_id = $1, status = $2 WHERE room_code = $3', [ws.clientId, 'playing', roomCode]);
                    currentRoomInMemory.player2IdActual = ws.clientId; newStatus = 'playing';
                } else {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia ou erro inesperado ao entrar.' } })); return;
                }
                currentRoomInMemory.players.set(ws.clientId, ws);
                currentRoomInMemory.playerUsernames.set(ws.clientId, ws.clientUsername);
                currentRoomInMemory.status = newStatus; ws.currentRoomCode = roomCode;
                const playersList = Array.from(currentRoomInMemory.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
                currentRoomInMemory.players.forEach(playerWs_in_room => {
                    playerWs_in_room.send(JSON.stringify({ type: 'PLAYER_JOINED', payload: { roomCode, players: playersList, status: currentRoomInMemory.status } }));
                    if (currentRoomInMemory.status === 'playing' && currentRoomInMemory.players.size === 2) {
                        playerWs_in_room.send(JSON.stringify({ type: 'GAME_START', payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam as vossas jogadas!' } }));
                    }
                });
                console.log(`${ws.clientUsername} entrou na sala ${roomCode}. Jogadores: ${playersList.map(p => p.username).join(', ')}. Status: ${currentRoomInMemory.status}`);
                return;
            } else {
                 ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada (DB).' } })); return;
            }
        } catch (dbError) {
            console.error("Erro ao tentar carregar/entrar na sala via DB:", dbError);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao entrar na sala.' } })); return;
        }
    }

    if (room.players.size >= 2 && !room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (memória).' } })); return;
    }
    if (room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } })); return;
    }
    try {
        let newDbStatus = room.status;
        if (!room.player1IdActual) {
            await db.query('UPDATE rooms SET player1_id = $1 WHERE id = $2', [ws.clientId, room.id]);
            room.player1IdActual = ws.clientId;
        } else if (!room.player2IdActual) {
            newDbStatus = 'playing';
            await db.query('UPDATE rooms SET player2_id = $1, status = $2 WHERE id = $3', [ws.clientId, newDbStatus, room.id]);
            room.player2IdActual = ws.clientId;
        } else {
             ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro: Slots da sala já preenchidos na BD.' } })); return;
        }
        room.players.set(ws.clientId, ws);
        room.playerUsernames.set(ws.clientId, ws.clientUsername);
        room.status = newDbStatus; ws.currentRoomCode = roomCode;
        const playersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
        room.players.forEach(playerWs_in_room => {
            playerWs_in_room.send(JSON.stringify({ type: 'PLAYER_JOINED', payload: { roomCode, players: playersList, status: room.status } }));
            if (room.status === 'playing' && room.players.size === 2) {
                playerWs_in_room.send(JSON.stringify({ type: 'GAME_START', payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam as vossas jogadas!' } }));
            }
        });
        console.log(`${ws.clientUsername} entrou na sala ${roomCode} (memória). Jogadores: ${playersList.map(p=>p.username).join(', ')}. Status: ${room.status}`);
    } catch (error) {
        console.error("Erro ao atualizar sala na BD (join em sala em memória):", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao entrar na sala.' } }));
    }
}


function handleMakeChoice(ws, roomCode, choice) {
    if (!roomCode) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Código da sala não especificado.'}})); return;
    }
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você não está nesta sala ou a sala não existe.' } })); return;
    }
    if (room.status !== 'playing') {
         ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'O jogo não está em andamento.' } })); return;
    }
    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Jogada inválida.' } })); return;
    }
    if (room.choices.has(ws.clientId)){
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já fez a sua jogada nesta rodada.' } })); return;
    }
    room.choices.set(ws.clientId, choice);
    ws.send(JSON.stringify({ type: 'CHOICE_MADE', payload: { choice: choice, message: 'A sua jogada foi registada. Aguardando oponente...' } }));
    console.log(`${ws.clientUsername} na sala ${roomCode} escolheu ${choice}`);
    room.players.forEach(playerWsInRoom => {
        if (playerWsInRoom.clientId !== ws.clientId && playerWsInRoom.readyState === WebSocket.OPEN) {
            playerWsInRoom.send(JSON.stringify({ type: 'OPPONENT_CHOICE_MADE', payload: { message: 'O seu oponente fez uma jogada.'}}));
        }
    });
    if (room.choices.size === 2 && room.players.size === 2) {
        const player1Id = room.player1IdActual;
        const player2Id = room.player2IdActual;
        if (!room.choices.has(player1Id) || !room.choices.has(player2Id)) {
            console.log(`Sala ${roomCode}: Esperando escolhas dos jogadores designados.`); return;
        }
        const choice1 = room.choices.get(player1Id);
        const choice2 = room.choices.get(player2Id);
        const result = determineWinner(choice1, choice2);
        let gameStatus, winnerId = null;
        if (result === 'draw') {
            gameStatus = 'draw';
        } else if (result === 'player1') {
            gameStatus = `${room.playerUsernames.get(player1Id)}_won`; winnerId = player1Id;
        } else {
            gameStatus = `${room.playerUsernames.get(player2Id)}_won`; winnerId = player2Id;
        }
        room.status = gameStatus;
        db.query('UPDATE rooms SET status = $1 WHERE room_code = $2', [gameStatus, roomCode]).catch(console.error);
        const resultPayload = {
            roomCode,
            choices: {
                [player1Id]: { username: room.playerUsernames.get(player1Id), choice: choice1 },
                [player2Id]: { username: room.playerUsernames.get(player2Id), choice: choice2 }
            },
            result: gameStatus, winnerId: winnerId, winnerUsername: winnerId ? room.playerUsernames.get(winnerId) : null
        };
        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'GAME_RESULT', payload: resultPayload }));
            }
        });
        console.log(`Resultado da sala ${roomCode}: ${gameStatus}. Jogadas: ${room.playerUsernames.get(player1Id)}(${choice1}) vs ${room.playerUsernames.get(player2Id)}(${choice2})`);
        room.choices.clear(); room.status = 'playing';
         setTimeout(() => {
            room.players.forEach(pWs => {
                if (pWs.readyState === WebSocket.OPEN) {
                    pWs.send(JSON.stringify({ type: 'NEW_ROUND', payload: { message: "Nova rodada! Façam as vossas escolhas." } }));
                }
            });
        }, 1000);
    }
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return 'draw';
    if ((choice1 === 'rock' && choice2 === 'scissors') || (choice1 === 'scissors' && choice2 === 'paper') || (choice1 === 'paper' && choice2 === 'rock')) {
        return 'player1';
    }
    return 'player2';
}

function handlePlayerDisconnect(ws) {
    const roomCode = ws.currentRoomCode;
    if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        const wasPlayerInRoom = room.players.has(ws.clientId);
        room.players.delete(ws.clientId);
        if (wasPlayerInRoom) {
            console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado da sala ${roomCode}. Jogadores ativos restantes na sala: ${room.players.size}`);
            const otherPlayerId = room.player1IdActual === ws.clientId ? room.player2IdActual : room.player1IdActual;
            if (otherPlayerId && room.players.has(otherPlayerId)) {
                const otherPlayerWs = room.players.get(otherPlayerId);
                if (otherPlayerWs && otherPlayerWs.readyState === WebSocket.OPEN) {
                    otherPlayerWs.send(JSON.stringify({
                        type: 'OPPONENT_DISCONNECTED',
                        payload: { userId: ws.clientId, username: ws.clientUsername, message: `${ws.clientUsername} desconectou-se.` }
                    }));
                }
            }
            if (room.players.size === 0) {
                 console.log(`Sala ${roomCode} está agora vazia de conexões ativas.`);
            }
        }
    } else {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado, mas não estava associado a uma sala ativa na memória.`);
    }
}
module.exports = { initializeGameService };

