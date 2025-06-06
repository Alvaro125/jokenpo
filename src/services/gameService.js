const WebSocket = require('ws');
// const { v4: uuidv4 } = require('uuid'); // Not used in current logic
const db = require('../config/db'); // Assuming your db config
const User = require('../models/userModel'); // Assuming your User model
const Room = require('../models/roomModel'); // Assuming your Room model

// In-memory store for active rooms
// roomCode -> { 
//   id (DB room id), 
//   roomCode, 
//   players: Map<userId, ws>, 
//   choices: Map<userId, choice>, 
//   status: 'waiting' | 'playing' | 'draw' | '<username>_won' | 'closed', 
//   player1IdActual (creator/owner), 
//   player2IdActual, 
//   playerUsernames: Map<userId, username> 
// }
const rooms = new Map(); 

async function attemptPlayerReconnection(ws) {
    console.log(`Tentando reconectar ${ws.clientUsername} (ID: ${ws.clientId})`);
    for (const [roomCode, room] of rooms) {
        // Check if this player was one of the designated players (player1 or player2)
        // and if they are not currently connected with this ws instance or not connected at all
        if ((room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId) &&
            (!room.players.has(ws.clientId) || room.players.get(ws.clientId) !== ws)) {
            
            console.log(`${ws.clientUsername} pertence à sala ${roomCode}. Reconectando...`);
            room.players.set(ws.clientId, ws); // Update/set WebSocket connection
            room.playerUsernames.set(ws.clientId, ws.clientUsername); // Ensure username is fresh
            ws.currentRoomCode = roomCode;

            const currentPlayersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
            
            const choicesForClient = {};
            room.choices.forEach((choice, userId) => {
                choicesForClient[userId] = { choice: choice, username: room.playerUsernames.get(userId) };
            });

            const roomStatePayload = {
                roomCode: room.roomCode,
                roomId: room.id, // DB room ID
                players: currentPlayersList,
                status: room.status,
                choices: choicesForClient,
                myChoice: room.choices.get(ws.clientId) || null,
                ownerId: room.player1IdActual // Send owner ID
            };

            ws.send(JSON.stringify({ type: 'ROOM_STATE_UPDATE', payload: roomStatePayload }));

            // Notify the other player if they are connected
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
            return true; // Reconnection successful
        }
    }
    console.log(`${ws.clientUsername} não encontrado em nenhuma sala ativa para reconexão.`);
    return false; // No suitable room found for reconnection
}


function initializeGameService(wss) {
    wss.on('connection', async (ws) => {
        // ws.clientId and ws.clientUsername are set by the authentication middleware
        console.log(`Cliente autenticado conectado: ${ws.clientUsername} (ID: ${ws.clientId})`);

        const reconnected = await attemptPlayerReconnection(ws);
        if (!reconnected) {
            // If not reconnected to an existing game, send a welcome message.
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
                    case 'CLOSE_ROOM': // Added handler for CLOSE_ROOM
                        handleCloseRoom(ws, data.payload.roomCode || ws.currentRoomCode);
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
            // Optionally handle disconnect here too if error implies connection loss
            handlePlayerDisconnect(ws); 
        });
    });
}

async function handleCreateRoom(ws) {
    let roomCode;
    let roomExistsInDb = true;
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loop

    // Generate a unique room code
    while (roomExistsInDb && attempts < maxAttempts) {
        roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); // 5 chars
        const existingRoom = await Room.findByRoomCode(roomCode); // findByRoomCode should return the room or null/undefined
        if (!existingRoom) { // If no room found with this code
            roomExistsInDb = false;
        }
        attempts++;
    }
    if (roomExistsInDb) { // Failed to generate unique code
         ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao gerar código de sala único. Tente novamente.' } }));
         return;
    }

    try {
        // Create room in the database
        const dbRoom = await Room.create(roomCode, ws.clientId, 'waiting'); // ws.clientId is player1_id
        if (!dbRoom || !dbRoom.id) {
            throw new Error("Falha ao criar sala no banco de dados ou retornar ID.");
        }

        const newRoom = {
            id: dbRoom.id, // Database ID of the room
            roomCode: roomCode,
            players: new Map(), // Map of userId -> WebSocket connection
            choices: new Map(), // Map of userId -> choice ('rock', 'paper', 'scissors')
            status: 'waiting', // Initial status
            player1IdActual: ws.clientId, // The creator is player1 (and owner)
            player2IdActual: null,
            playerUsernames: new Map() // Map of userId -> username
        };
        newRoom.players.set(ws.clientId, ws);
        newRoom.playerUsernames.set(ws.clientId, ws.clientUsername);
        rooms.set(roomCode, newRoom); // Add to in-memory store

        ws.currentRoomCode = roomCode; // Assign room code to WebSocket connection

        ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            payload: { 
                roomCode, 
                roomId: newRoom.id, 
                players: [{ userId: ws.clientId, username: ws.clientUsername }], 
                status: newRoom.status,
                ownerId: ws.clientId // Creator is the owner
            }
        }));
        console.log(`Sala ${roomCode} criada por ${ws.clientUsername}. ID BD: ${newRoom.id}. Status: ${newRoom.status}`);
    } catch (error) {
        console.error("Erro ao criar sala na BD:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao criar sala.' } }));
    }
}

async function handleJoinRoom(ws, roomCode) {
    let room = rooms.get(roomCode);

    // If room is not in memory, try to load from DB (e.g., server restart or player joining an existing persisted room)
    if (!room) {
        try {
            const dbRoomData = await Room.findByRoomCode(roomCode);
            if (dbRoomData) { // dbRoomData is the room object from DB
                if (dbRoomData.status === 'closed') {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Esta sala foi fechada.' } })); return;
                }
                // Check if player is already one of the assigned players for this room (reconnecting scenario)
                if (dbRoomData.player1_id === ws.clientId || dbRoomData.player2_id === ws.clientId) {
                    if (await attemptPlayerReconnection(ws)) return; // Attempt reconnection first
                }

                // If room is full in DB and current player is not one of them
                if (dbRoomData.player1_id && dbRoomData.player2_id && 
                    dbRoomData.player1_id !== ws.clientId && dbRoomData.player2_id !== ws.clientId) {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (DB).' } })); return;
                }

                // Load room into memory
                room = {
                    id: dbRoomData.id,
                    roomCode: dbRoomData.room_code,
                    players: new Map(),
                    choices: new Map(), // Choices are typically transient for a round
                    status: dbRoomData.status,
                    player1IdActual: dbRoomData.player1_id,
                    player2IdActual: dbRoomData.player2_id,
                    playerUsernames: new Map()
                };
                // Load usernames for existing players
                if (room.player1IdActual) {
                    const p1User = await User.findById(room.player1IdActual);
                    if (p1User) room.playerUsernames.set(room.player1IdActual, p1User.username);
                }
                if (room.player2IdActual) { // This might be null if only player1 has joined
                    const p2User = await User.findById(room.player2IdActual);
                    if (p2User) room.playerUsernames.set(room.player2IdActual, p2User.username);
                }
                rooms.set(roomCode, room);
                console.log(`Sala ${roomCode} carregada da BD para a memória.`);
            } else {
                ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada.' } })); return;
            }
        } catch (dbError) {
            console.error("Erro ao tentar carregar/entrar na sala via DB:", dbError);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao entrar na sala.' } })); return;
        }
    }
     if (room.status === 'closed') {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Esta sala foi fechada.' } })); return;
    }

    // At this point, 'room' refers to the in-memory representation
    if (room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } })); return;
    }

    if (room.players.size >= 2) { // Max 2 players
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia.' } })); return;
    }

    try {
        let newStatus = room.status;
        if (!room.player1IdActual) { // Should not happen if created correctly, but as a fallback
            await Room.updatePlayer1(room.id, ws.clientId); // room.id is DB id
            room.player1IdActual = ws.clientId;
        } else if (!room.player2IdActual) {
            await Room.addPlayer2AndSetStatus(room.id, ws.clientId, 'playing');
            room.player2IdActual = ws.clientId;
            newStatus = 'playing';
        } // No else, because we checked for room.players.size >= 2 earlier

        room.players.set(ws.clientId, ws);
        room.playerUsernames.set(ws.clientId, ws.clientUsername);
        room.status = newStatus;
        ws.currentRoomCode = roomCode;

        const playersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
        
        const joinedPayload = { 
            roomCode, 
            roomId: room.id,
            players: playersList, 
            status: room.status,
            ownerId: room.player1IdActual // Owner is player1
        };

        // Notify all players in the room about the new joiner and potential game start
        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'PLAYER_JOINED', payload: joinedPayload }));
                if (room.status === 'playing' && room.players.size === 2) {
                    playerWsInRoom.send(JSON.stringify({ type: 'GAME_START', payload: { ...joinedPayload, message: 'Ambos os jogadores estão conectados. Façam as vossas jogadas!' } }));
                }
            }
        });
        console.log(`${ws.clientUsername} entrou na sala ${roomCode}. Jogadores: ${playersList.map(p => p.username).join(', ')}. Status: ${room.status}`);
    } catch (error) {
        console.error("Erro ao atualizar sala na BD (join):", error);
        // Potentially remove player from in-memory if DB update failed critically
        room.players.delete(ws.clientId);
        room.playerUsernames.delete(ws.clientId);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao entrar na sala.' } }));
    }
}


async function handleMakeChoice(ws, roomCode, choice) {
    if (!roomCode) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Código da sala não especificado.' } })); return;
    }
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você não está nesta sala ou a sala não existe.' } })); return;
    }
    if (room.status !== 'playing') {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'O jogo não está em andamento ou aguardando jogadores.' } })); return;
    }
    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Jogada inválida.' } })); return;
    }
    if (room.choices.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já fez a sua jogada nesta rodada.' } })); return;
    }

    room.choices.set(ws.clientId, choice);
    ws.send(JSON.stringify({ type: 'CHOICE_MADE', payload: { choice: choice, roomCode: roomCode, message: 'A sua jogada foi registada. Aguardando oponente...' } }));
    console.log(`${ws.clientUsername} na sala ${roomCode} escolheu ${choice}`);

    // Notify opponent
    room.players.forEach(playerWsInRoom => {
        if (playerWsInRoom.clientId !== ws.clientId && playerWsInRoom.readyState === WebSocket.OPEN) {
            playerWsInRoom.send(JSON.stringify({ type: 'OPPONENT_CHOICE_MADE', payload: { roomCode: roomCode, message: 'O seu oponente fez uma jogada.' } }));
        }
    });

    // Check if both players have made their choices
    if (room.choices.size === 2 && room.players.size === 2) {
        const player1Id = room.player1IdActual;
        const player2Id = room.player2IdActual;

        // Ensure the choices are from the designated player1 and player2
        if (!room.choices.has(player1Id) || !room.choices.has(player2Id)) {
            console.log(`Sala ${roomCode}: Esperando escolhas dos jogadores designados (P1: ${player1Id}, P2: ${player2Id}). Escolhas atuais:`, room.choices);
            // This case might indicate an issue if choices.size is 2 but not from player1Id and player2Id.
            // However, with current logic, this should be fine as long as player1Id and player2Id are in room.players.
            return; 
        }

        const choice1 = room.choices.get(player1Id);
        const choice2 = room.choices.get(player2Id);
        const result = determineWinner(choice1, choice2);

        let gameStatus, winnerId = null, winnerUsername = null;
        if (result === 'draw') {
            gameStatus = 'draw';
        } else if (result === 'player1') { // player1 (creator) won
            winnerId = player1Id;
            winnerUsername = room.playerUsernames.get(player1Id);
            gameStatus = `${winnerUsername}_won`;
        } else { // player2 won
            winnerId = player2Id;
            winnerUsername = room.playerUsernames.get(player2Id);
            gameStatus = `${winnerUsername}_won`;
        }
        
        room.status = gameStatus; // Update in-memory status for the round result
        // Storing round result in DB is optional, main room status 'playing' or 'closed' is more critical for persistence.
        // await Room.updateStatus(room.id, gameStatus); // This would log each round result as room status

        const resultPayload = {
            roomCode,
            roomId: room.id,
            choices: { // Send choices with usernames
                [player1Id]: { username: room.playerUsernames.get(player1Id), choice: choice1 },
                [player2Id]: { username: room.playerUsernames.get(player2Id), choice: choice2 }
            },
            result: gameStatus, 
            winnerId: winnerId, 
            winnerUsername: winnerUsername,
            ownerId: room.player1IdActual // Include ownerId
        };

        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'GAME_RESULT', payload: resultPayload }));
            }
        });
        console.log(`Resultado da sala ${roomCode}: ${gameStatus}. Jogadas: ${room.playerUsernames.get(player1Id)}(${choice1}) vs ${room.playerUsernames.get(player2Id)}(${choice2})`);

        // Prepare for next round
        room.choices.clear();
        room.status = 'playing'; // Reset status for the next round immediately

        setTimeout(async () => {
            // Ensure room still exists and is 'playing'
             const currentRoomForNextRound = rooms.get(roomCode);
             if (currentRoomForNextRound && currentRoomForNextRound.status === 'playing') {
                await Room.updateStatus(currentRoomForNextRound.id, 'playing').catch(err => console.error("Error updating room status to playing for new round:", err)); // Persist 'playing' status
                currentRoomForNextRound.players.forEach(pWs => {
                    if (pWs.readyState === WebSocket.OPEN) {
                        pWs.send(JSON.stringify({ type: 'NEW_ROUND', payload: { roomCode, message: "Nova rodada! Façam as vossas escolhas.", ownerId: currentRoomForNextRound.player1IdActual } }));
                    }
                });
             }
        }, 2000); // Delay before starting new round message
    }
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return 'draw';
    if (
        (choice1 === 'rock' && choice2 === 'scissors') ||
        (choice1 === 'scissors' && choice2 === 'paper') ||
        (choice1 === 'paper' && choice2 === 'rock')
    ) {
        return 'player1'; // Corresponds to player1IdActual
    }
    return 'player2'; // Corresponds to player2IdActual
}

async function handleCloseRoom(ws, roomCode) {
    if (!roomCode) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Código da sala não especificado.' } })); return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada para fechar.' } })); return;
    }

    // Only the creator (player1IdActual) can close the room
    if (room.player1IdActual !== ws.clientId) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você não é o proprietário da sala e não pode fechá-la.' } })); return;
    }

    try {
        // Notify all players in the room that it's closing
        const closeMessagePayload = { 
            roomCode, 
            message: `A sala ${roomCode} foi fechada pelo proprietário (${ws.clientUsername}).` 
        };
        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'ROOM_CLOSED', payload: closeMessagePayload }));
            }
            playerWsInRoom.currentRoomCode = null; // Clear current room for all clients
        });

        // Update room status in DB to 'closed'
        await Room.updateStatus(room.id, 'closed'); // room.id is the DB ID
        
        // Remove room from in-memory store
        rooms.delete(roomCode);
        console.log(`Sala ${roomCode} (ID BD: ${room.id}) fechada por ${ws.clientUsername}. Status atualizado para 'closed' na BD.`);

    } catch (error) {
        console.error(`Erro ao fechar sala ${roomCode} (ID BD: ${room.id}) ou atualizar BD:`, error);
        // Send error to owner, other players might have already received ROOM_CLOSED or will disconnect
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao fechar a sala.' } }));
    }
}


function handlePlayerDisconnect(ws) {
    const roomCode = ws.currentRoomCode;
    if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        const wasPlayerConnected = room.players.delete(ws.clientId); // Remove player's WebSocket connection

        if (wasPlayerConnected) {
            // room.playerUsernames.delete(ws.clientId); // Optionally keep username for logs or history, but remove active player

            console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado da sala ${roomCode}. Jogadores ativos restantes na sala: ${room.players.size}`);

            // If the disconnected player was player1IdActual or player2IdActual, and the room is not yet closed by owner.
            // For now, we don't automatically close the room if owner disconnects, owner can reconnect.
            // If an opponent disconnects, the remaining player is notified.

            const otherPlayerId = room.player1IdActual === ws.clientId ? room.player2IdActual : room.player1IdActual;
            
            // If this disconnected player was one of the two main players
            if(ws.clientId === room.player1IdActual || ws.clientId === room.player2IdActual) {
                // Notify the other main player if they are still connected
                if (otherPlayerId && room.players.has(otherPlayerId)) {
                    const otherPlayerWs = room.players.get(otherPlayerId);
                    if (otherPlayerWs && otherPlayerWs.readyState === WebSocket.OPEN) {
                        otherPlayerWs.send(JSON.stringify({
                            type: 'OPPONENT_DISCONNECTED',
                            payload: { 
                                userId: ws.clientId, 
                                username: ws.clientUsername, 
                                roomCode: roomCode,
                                message: `${ws.clientUsername} desconectou-se. Aguardando reconexão ou novas ações.` 
                            }
                        }));
                        // Optionally, change room status to 'waiting' if game cannot proceed
                        // if (room.status === 'playing' && room.players.size < 2) {
                        // room.status = 'waiting';
                        // Room.updateStatus(room.id, 'waiting');
                        // otherPlayerWs.send(JSON.stringify({ type: 'ROOM_STATE_UPDATE', payload: { ...room, status: 'waiting', players: Array.from(room.playerUsernames.values()).map(name => ({username: name}))}}));
                        // }
                    }
                }
            }


            // If no active WebSocket connections remain, but the room might still exist in DB (e.g. waiting for reconnections)
            // We don't delete from 'rooms' map here unless explicitly closed by owner,
            // to allow for reconnections to persisted player slots.
            if (room.players.size === 0) {
                console.log(`Sala ${roomCode} (ID BD: ${room.id}) está agora sem conexões WebSocket ativas. Jogadores designados: P1=${room.player1IdActual}, P2=${room.player2IdActual}.`);
                // rooms.delete(roomCode); // Consider if room should be removed from memory if both disconnect and don't return soon.
                                      // For now, rely on attemptPlayerReconnection using DB data.
            }
        }
    } else {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado, mas não estava associado a uma sala ativa na memória via ws.currentRoomCode.`);
    }
}

module.exports = { initializeGameService };