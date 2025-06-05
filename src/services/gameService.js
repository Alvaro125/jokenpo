// src/services/gameService.js
const WebSocket = require('ws');
// const { v4: uuidv4 } = require('uuid'); // uuidv4 não parece estar a ser usado diretamente
const User = require('../models/userModel');
const Room = require('../models/roomModel'); // <--- ADICIONADO

// rooms: roomCode -> { id (DB room id), roomCode, players: Map<userId, ws>, choices: Map<userId, choice>, status, player1IdActual, player2IdActual, playerUsernames: Map<userId, username> }
const rooms = new Map();

// Função auxiliar para popular o objeto de sala em memória a partir dos dados da BD
async function hydrateRoomInMemoryFromDb(dbRoom) {
    const roomInMemory = {
        id: dbRoom.id,
        roomCode: dbRoom.room_code,
        players: new Map(), // conexões WebSocket serão adicionadas conforme os jogadores (re)conectam
        choices: new Map(),
        status: dbRoom.status,
        player1IdActual: dbRoom.player1_id,
        player2IdActual: dbRoom.player2_id,
        playerUsernames: new Map()
    };

    if (dbRoom.player1_id) {
        const user1 = await User.findById(dbRoom.player1_id);
        if (user1) roomInMemory.playerUsernames.set(user1.id, user1.username);
    }
    if (dbRoom.player2_id) {
        const user2 = await User.findById(dbRoom.player2_id);
        if (user2) roomInMemory.playerUsernames.set(user2.id, user2.username);
    }
    rooms.set(dbRoom.room_code, roomInMemory);
    return roomInMemory;
}


async function attemptPlayerReconnection(ws) {
    console.log(`Tentando reconectar ${ws.clientUsername} (ID: ${ws.clientId})`);
    for (const [roomCode, room] of rooms) {
        if ((room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId) &&
            (!room.players.has(ws.clientId) || room.players.get(ws.clientId) !== ws)) {
            
            // Se a sala existe em memória mas o jogador não está no Map de players (ou o ws é diferente)
            console.log(`${ws.clientUsername} pertence à sala ${roomCode}. Reconectando...`);
            room.players.set(ws.clientId, ws);
            if (!room.playerUsernames.has(ws.clientId)) { // Garante que o username está no map
                 room.playerUsernames.set(ws.clientId, ws.clientUsername);
            }
            ws.currentRoomCode = roomCode;

            const currentPlayersList = Array.from(room.playerUsernames.entries())
                .filter(([id, _]) => room.players.has(id) || id === room.player1IdActual || id === room.player2IdActual) // Garante que apenas jogadores relevantes são listados
                .map(([id, name]) => ({ userId: id, username: name }));

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
                myChoice: room.choices.get(ws.clientId) || null,
                player1Id: room.player1IdActual,
                player2Id: room.player2IdActual
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
    // Se não encontrou em salas em memória, tenta carregar do DB se o cliente estava numa sala
    // Esta parte é mais complexa e depende de como o cliente informa a sala que quer reconectar
    // Por agora, a reconexão só funciona se a sala já estiver no Map 'rooms'.
    console.log(`${ws.clientUsername} não encontrado em nenhuma sala ativa em memória para reconexão.`);
    return false;
}


function initializeGameService(wss) {
    wss.on('connection', async (ws) => {
        console.log(`Cliente autenticado conectado: ${ws.clientUsername} (ID: ${ws.clientId})`);
        
        // Tentativa de reconexão antes de qualquer outra coisa
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
            // Considerar chamar handlePlayerDisconnect também em caso de erro que feche a conexão
            handlePlayerDisconnect(ws); 
        });
    });
}

async function handleCreateRoom(ws) {
    let roomCode;
    let roomExists = true;
    try {
        while (roomExists) {
            roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); // 5 chars
            const existingRoom = await Room.findByRoomCode(roomCode); // <--- ALTERADO
            if (!existingRoom) {
                roomExists = false;
            }
        }

        const dbRoom = await Room.create(roomCode, ws.clientId, 'waiting'); // <--- ALTERADO
        if (!dbRoom) {
            throw new Error("Falha ao criar sala na base de dados.");
        }

        const newRoom = {
            id: dbRoom.id,
            roomCode: dbRoom.room_code,
            players: new Map(),
            choices: new Map(),
            status: dbRoom.status,
            player1IdActual: dbRoom.player1_id,
            player2IdActual: null,
            playerUsernames: new Map()
        };
        newRoom.players.set(ws.clientId, ws);
        newRoom.playerUsernames.set(ws.clientId, ws.clientUsername);
        rooms.set(roomCode, newRoom);
        ws.currentRoomCode = roomCode;

        ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            payload: { 
                roomCode, 
                roomId: newRoom.id, 
                players: [{ userId: ws.clientId, username: ws.clientUsername }], 
                status: newRoom.status,
                player1Id: newRoom.player1IdActual,
                player2Id: newRoom.player2IdActual
            }
        }));
        console.log(`Sala ${roomCode} criada por ${ws.clientUsername}. Status: ${newRoom.status}`);
    } catch (error) {
        console.error("Erro ao criar sala:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao criar sala.' } }));
    }
}

async function handleJoinRoom(ws, roomCode) {
    let room = rooms.get(roomCode);

    try {
        if (!room) { // Sala não está em memória, tenta carregar da BD
            console.log(`Sala ${roomCode} não encontrada em memória. Tentando carregar da BD...`);
            const dbRoomData = await Room.findByRoomCode(roomCode); // <--- ALTERADO
            if (dbRoomData) {
                if (dbRoomData.status !== 'waiting' && dbRoomData.status !== 'playing') {
                     // Verifica se a sala na BD já está num estado final (ex: 'draw', 'user_won')
                     // mas não tem os dois jogadores. Isso pode indicar uma sala que precisa ser resetada.
                     // Ou se a sala está 'playing' mas um dos jogadores não é o que está a tentar entrar
                     if(!(dbRoomData.player1_id === ws.clientId || dbRoomData.player2_id === ws.clientId) && dbRoomData.player1_id && dbRoomData.player2_id) {
                        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: `Sala ${roomCode} está ${dbRoomData.status} e cheia.` } }));
                        return;
                     }
                }

                // Se o jogador já estiver listado na sala da BD, tenta reconectar (pode já ter sido feito pelo attemptPlayerReconnection)
                if (dbRoomData.player1_id === ws.clientId || dbRoomData.player2_id === ws.clientId) {
                    if (await attemptPlayerReconnection(ws)) return; // Se reconectou com sucesso, termina aqui
                    // Se não reconectou (ex: sala não estava em memória ainda), continua para hidratar
                }
                
                // Verifica se a sala da BD está cheia por outros jogadores
                if (dbRoomData.player1_id && dbRoomData.player2_id &&
                    dbRoomData.player1_id !== ws.clientId && dbRoomData.player2_id !== ws.clientId) {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: `Sala ${roomCode} cheia (BD).` } }));
                    return;
                }

                room = await hydrateRoomInMemoryFromDb(dbRoomData);
                console.log(`Sala ${roomCode} carregada da BD e adicionada à memória.`);

            } else {
                ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada.' } }));
                return;
            }
        }

        // A partir daqui, 'room' refere-se à sala em memória (seja acabada de carregar ou já existente)
        if (room.players.has(ws.clientId)) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } }));
            // Pode reenviar o estado da sala se for uma tentativa de join redundante mas o jogador já está lá
             const currentPlayersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));
             ws.send(JSON.stringify({ type: 'ROOM_STATE_UPDATE', payload: { roomCode: room.roomCode, roomId: room.id, players: currentPlayersList, status: room.status, choices: {}, myChoice: null, player1Id: room.player1IdActual, player2Id: room.player2IdActual } }));
            return;
        }

        if (room.players.size >= 2 && !(room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId)) {
             // Esta verificação adicional garante que não estamos a adicionar um terceiro jogador a uma sala que já tinha 2 `ActualId`
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia.' } }));
            return;
        }
        
        let newDbStatus = room.status;
        let playerSlotAssigned = false;

        if (!room.player1IdActual) {
            await Room.updatePlayer1(roomCode, ws.clientId); // <--- ALTERADO
            room.player1IdActual = ws.clientId;
            newDbStatus = 'waiting'; // Permanece waiting até o segundo jogador
            playerSlotAssigned = true;
        } else if (!room.player2IdActual && room.player1IdActual !== ws.clientId) {
            newDbStatus = 'playing';
            await Room.addPlayer2AndSetStatus(roomCode, ws.clientId, newDbStatus); // <--- ALTERADO
            room.player2IdActual = ws.clientId;
            playerSlotAssigned = true;
        } else if (room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId) {
            // O jogador já tem um slot (player1 ou player2), então é uma reconexão ou já está lá.
            // A conexão WS será atualizada.
            playerSlotAssigned = true; // Considera como slot atribuído para adicionar à lista de players.
        }


        if (!playerSlotAssigned) {
             // Se chegou aqui, significa que player1 e player2 já estão definidos E NÃO SÃO o ws.clientId
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia ou erro ao designar slot.' } }));
            return;
        }

        room.players.set(ws.clientId, ws);
        room.playerUsernames.set(ws.clientId, ws.clientUsername);
        room.status = newDbStatus; // Atualiza o status em memória
        ws.currentRoomCode = roomCode;

        const playersList = Array.from(room.playerUsernames.entries())
                             .filter(([id, _]) => room.players.has(id) || id === room.player1IdActual || id === room.player2IdActual)
                             .map(([id, name]) => ({ userId: id, username: name }));

        const messageForAll = {
            type: 'PLAYER_JOINED', // Ou ROOM_STATE_UPDATE para ser mais geral
            payload: {
                roomCode,
                roomId: room.id,
                players: playersList,
                status: room.status,
                player1Id: room.player1IdActual,
                player2Id: room.player2IdActual
            }
        };
        
        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                 playerWsInRoom.send(JSON.stringify(messageForAll));
            }
        });

        if (room.status === 'playing' && room.players.size === 2 && room.player1IdActual && room.player2IdActual) {
            room.choices.clear(); // Limpa escolhas de rodadas anteriores ao iniciar novo jogo/rodada
            room.players.forEach(playerWsInRoom => {
                 if (playerWsInRoom.readyState === WebSocket.OPEN) {
                    playerWsInRoom.send(JSON.stringify({ type: 'GAME_START', payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam as vossas jogadas!' } }));
                 }
            });
        }
        console.log(`${ws.clientUsername} entrou/reconectou à sala ${roomCode}. Jogadores na sala em memória: ${playersList.map(p => p.username).join(', ')}. Status: ${room.status}`);

    } catch (error) {
        console.error(`Erro ao entrar na sala ${roomCode} para ${ws.clientUsername}:`, error);
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
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'O jogo não está em andamento.' } })); return;
    }
    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Jogada inválida.' } })); return;
    }
    if (room.choices.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já fez a sua jogada nesta rodada.' } })); return;
    }

    room.choices.set(ws.clientId, choice);
    ws.send(JSON.stringify({ type: 'CHOICE_MADE', payload: { choice: choice, message: 'A sua jogada foi registada. Aguardando oponente...' } }));
    console.log(`${ws.clientUsername} na sala ${roomCode} escolheu ${choice}`);

    // Notifica oponente que uma jogada foi feita, sem revelar qual
    room.players.forEach(playerWsInRoom => {
        if (playerWsInRoom.clientId !== ws.clientId && playerWsInRoom.readyState === WebSocket.OPEN) {
            playerWsInRoom.send(JSON.stringify({ type: 'OPPONENT_CHOICE_MADE', payload: { message: 'O seu oponente fez uma jogada.' } }));
        }
    });

    // Verifica se ambos os jogadores fizeram suas escolhas
    if (room.choices.size === 2 && room.player1IdActual && room.player2IdActual && room.choices.has(room.player1IdActual) && room.choices.has(room.player2IdActual)) {
        const player1Id = room.player1IdActual;
        const player2Id = room.player2IdActual;

        const choice1 = room.choices.get(player1Id);
        const choice2 = room.choices.get(player2Id);
        const result = determineWinner(choice1, choice2);

        let gameStatus, winnerId = null;
        const player1Username = room.playerUsernames.get(player1Id) || 'Jogador 1';
        const player2Username = room.playerUsernames.get(player2Id) || 'Jogador 2';

        if (result === 'draw') {
            gameStatus = 'draw';
        } else if (result === 'player1') {
            gameStatus = `${player1Username}_won`; winnerId = player1Id;
        } else { // player2
            gameStatus = `${player2Username}_won`; winnerId = player2Id;
        }

        // Atualiza o status da sala em memória primeiro
        // room.status = gameStatus; // Não mudar para 'draw' ou 'won' permanentemente se houverem novas rodadas

        try {
            await Room.updateStatus(roomCode, gameStatus); // <--- ALTERADO: Atualiza o status final da rodada na BD
            console.log(`Status da sala ${roomCode} atualizado para ${gameStatus} na BD.`);
        } catch (dbError) {
            console.error(`Erro ao atualizar status da sala ${roomCode} na BD:`, dbError);
        }

        const resultPayload = {
            roomCode,
            choices: {
                [player1Id]: { username: player1Username, choice: choice1 },
                [player2Id]: { username: player2Username, choice: choice2 }
            },
            result: gameStatus, // e.g., 'draw', 'Alice_won'
            winnerId: winnerId,
            winnerUsername: winnerId ? room.playerUsernames.get(winnerId) : null
        };

        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'GAME_RESULT', payload: resultPayload }));
            }
        });
        console.log(`Resultado da sala ${roomCode}: ${gameStatus}. Jogadas: ${player1Username}(${choice1}) vs ${player2Username}(${choice2})`);

        // Prepara para a próxima rodada
        room.choices.clear();
        // room.status = 'playing'; // Volta para 'playing' para a próxima rodada na memória
        // A BD terá o resultado da última rodada, a memória se prepara para a próxima

        setTimeout(() => {
            if (rooms.has(roomCode)) { // Verifica se a sala ainda existe
                 const currentRoomState = rooms.get(roomCode);
                 currentRoomState.status = 'playing'; // Garante que o status em memória está correto para a nova rodada
                 currentRoomState.players.forEach(pWs => {
                    if (pWs.readyState === WebSocket.OPEN) {
                        pWs.send(JSON.stringify({ type: 'NEW_ROUND', payload: { message: "Nova rodada! Façam as vossas escolhas." } }));
                    }
                });
                 // Atualiza o status na BD para 'playing' para a nova rodada, se desejar
                 // Room.updateStatus(roomCode, 'playing').catch(console.error);
            }
        }, 3000); // Aumentado para dar tempo de ver o resultado
    }
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return 'draw';
    if (
        (choice1 === 'rock' && choice2 === 'scissors') ||
        (choice1 === 'scissors' && choice2 === 'paper') ||
        (choice1 === 'paper' && choice2 === 'rock')
    ) {
        return 'player1';
    }
    return 'player2';
}

async function handlePlayerDisconnect(ws) {
    const roomCode = ws.currentRoomCode;
    if (!roomCode || !rooms.has(roomCode)) {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado, mas não estava associado a uma sala ativa em memória ou a sala já foi removida.`);
        return;
    }

    const room = rooms.get(roomCode);
    const wasPlayerInActiveSet = room.players.delete(ws.clientId); // Remove da lista de conexões ativas

    if (wasPlayerInActiveSet) {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado da sala ${roomCode}. Conexões ativas restantes na sala: ${room.players.size}`);
        
        let playerFieldToClearInDb = null;
        let newRoomStatusForDb = room.status; // Mantém o status atual por padrão

        if (ws.clientId === room.player1IdActual) {
            playerFieldToClearInDb = 'player1_id';
            room.player1IdActual = null; // Limpa o slot em memória
        } else if (ws.clientId === room.player2IdActual) {
            playerFieldToClearInDb = 'player2_id';
            room.player2IdActual = null; // Limpa o slot em memória
        }
        
        room.playerUsernames.delete(ws.clientId); // Remove username da sala em memória

        // Se um jogador designado desconectou, a sala deve voltar a esperar
        if (playerFieldToClearInDb) {
            newRoomStatusForDb = 'waiting';
            room.status = 'waiting'; // Atualiza status em memória
            room.choices.clear();   // Limpa escolhas pendentes
            
            try {
                await Room.removePlayer(roomCode, playerFieldToClearInDb, newRoomStatusForDb); // <--- ALTERADO
                console.log(`Jogador ${ws.clientId} removido da sala ${roomCode} na BD. Status da sala: ${newRoomStatusForDb}`);
            } catch (dbError) {
                console.error(`Erro ao remover jogador ${ws.clientId} da sala ${roomCode} na BD:`, dbError);
            }
        }

        // Notifica o outro jogador, se houver e estiver ativo
        const remainingPlayersList = Array.from(room.playerUsernames.entries())
                                      .filter(([id, _]) => room.players.has(id) || id === room.player1IdActual || id === room.player2IdActual )
                                      .map(([id, name]) => ({ userId: id, username: name }));

        room.players.forEach(otherPlayerWs => { // Itera sobre as conexões WS restantes
            if (otherPlayerWs.readyState === WebSocket.OPEN) {
                otherPlayerWs.send(JSON.stringify({
                    type: 'OPPONENT_DISCONNECTED',
                    payload: {
                        userId: ws.clientId,
                        username: ws.clientUsername,
                        message: `${ws.clientUsername} desconectou-se. A sala está agora '${room.status}'.`,
                        roomStatus: room.status,
                        players: remainingPlayersList, // Envia a lista atualizada de jogadores
                        player1Id: room.player1IdActual,
                        player2Id: room.player2IdActual
                    }
                }));
                 // Se a sala voltou para 'waiting', informa que podem precisar de um novo oponente ou podem sair
                 if (room.status === 'waiting') {
                    otherPlayerWs.send(JSON.stringify({ type: 'INFO', payload: { message: 'Aguardando novo oponente...'}}));
                 }
            }
        });
        
        // Se não há mais jogadores designados (player1IdActual e player2IdActual são null)
        // E não há mais conexões ativas na sala, remove da memória.
        if (!room.player1IdActual && !room.player2IdActual && room.players.size === 0) {
            console.log(`Sala ${roomCode} está completamente vazia (sem jogadores designados e sem conexões ativas). Removendo da memória.`);
            rooms.delete(roomCode);
            // Opcional: Poderia marcar a sala na BD como 'aborted' ou excluí-la se não for para ser reutilizada.
            // await Room.updateStatus(roomCode, 'aborted'); ou await Room.deleteByRoomCode(roomCode);
        } else if (room.players.size === 0 && (room.player1IdActual || room.player2IdActual)) {
            console.log(`Sala ${roomCode} não tem conexões ativas, mas ainda tem jogadores designados (${room.player1IdActual}, ${room.player2IdActual}). Mantendo em memória para reconexão.`);
        }


    } else {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado, mas não estava na lista de jogadores ativos da sala ${roomCode} (pode já ter sido processado).`);
    }
}

module.exports = { initializeGameService, rooms, hydrateRoomInMemoryFromDb };