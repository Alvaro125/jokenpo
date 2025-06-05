const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const User = require('../models/userModel'); // Para buscar usernames se necessário

const rooms = new Map(); // roomCode -> { id (DB room id), roomCode, players: Map<userId, ws>, choices: Map<userId, choice>, status, player1IdActual, player2IdActual, playerUsernames: Map<userId, username> }

async function attemptPlayerReconnection(ws) {
    console.log(`Tentando reconectar ${ws.clientUsername} (ID: ${ws.clientId})`);
    for (const [roomCode, room] of rooms) {
        // Verifica se este jogador era um dos jogadores designados para esta sala
        // e não está atualmente conectado com um socket ativo ou é o mesmo socket tentando reconectar (pouco provável aqui, mas seguro)
        if ((room.player1IdActual === ws.clientId || room.player2IdActual === ws.clientId) &&
            (!room.players.has(ws.clientId) || room.players.get(ws.clientId) !== ws)) {

            console.log(`${ws.clientUsername} pertence à sala ${roomCode}. Reconectando...`);
            room.players.set(ws.clientId, ws); // Adiciona/Atualiza a conexão WebSocket do jogador
            room.playerUsernames.set(ws.clientId, ws.clientUsername); // Garante que o username está atualizado
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
                choices: choicesForClient, // Envia as escolhas já feitas
                myChoice: room.choices.get(ws.clientId) || null // Envia a escolha do próprio jogador, se houver
            };

            ws.send(JSON.stringify({ type: 'ROOM_STATE_UPDATE', payload: roomStatePayload }));

            // Notifica o outro jogador (se existir e estiver conectado)
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
            return true; // Reconexão bem-sucedida
        }
    }
    console.log(`${ws.clientUsername} não encontrado em nenhuma sala ativa para reconexão.`);
    return false; // Não reconectado a nenhuma sala
}


function initializeGameService(wss) {
    wss.on('connection', async (ws) => { // Adicionado async aqui
        console.log(`Cliente autenticado conectado: ${ws.clientUsername} (ID: ${ws.clientId})`);

        const reconnected = await attemptPlayerReconnection(ws);

        if (!reconnected) {
            // Lógica para novo jogador que não está se reconectando a uma sala existente
            ws.send(JSON.stringify({ type: 'WELCOME_NEW_CONNECTION', payload: { message: 'Bem-vindo! Crie ou entre em uma sala.' } }));
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
                        // O roomCode deve vir do cliente ou ser inferido de ws.currentRoomCode
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
            handlePlayerDisconnect(ws); // Trata erro como desconexão para limpeza
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
        console.error("Erro ao criar sala no DB:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao criar sala.' } }));
    }
}

async function handleJoinRoom(ws, roomCode) {
    const room = rooms.get(roomCode);

    if (!room) {
        // Tenta carregar do DB se não estiver na memória (ex: servidor reiniciou, ou jogador 1 está esperando)
        try {
            const { rows } = await db.query('SELECT * FROM rooms WHERE room_code = $1', [roomCode]);
            if (rows.length > 0) {
                const dbRoom = rows[0];
                if (dbRoom.player1_id && dbRoom.player2_id && dbRoom.player1_id !== ws.clientId && dbRoom.player2_id !== ws.clientId) {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (DB).' } }));
                     return;
                }
                if (dbRoom.player1_id === ws.clientId || dbRoom.player2_id === ws.clientId) {
                    // O jogador já está "designado" para esta sala no DB, tentativa de reconexão
                    if (await attemptPlayerReconnection(ws)) return; // Se reconectou, encerra aqui
                }

                // Se chegou aqui, a sala existe no DB, não está cheia e o jogador não é um dos listados ou falhou em reconectar
                // Vamos recriá-la na memória ou adicionar o jogador
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
                        player2IdActual: dbRoom.player2_id, // Pode ser null se player2 estiver entrando agora
                        playerUsernames: new Map()
                    };
                    if (player1User) {
                        joiningRoom.playerUsernames.set(player1User.id, player1User.username);
                        // Se o player1 estiver online em outra conexão, não adicionamos o ws aqui.
                        // A lógica de reconexão deve lidar com a atualização do ws correto.
                    }
                    rooms.set(roomCode, joiningRoom);
                }
                 // Re-referencia `room` para o objeto recém-criado/obtido
                const currentRoomInMemory = rooms.get(roomCode);
                if (!currentRoomInMemory) { // Segurança, não deve acontecer
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao carregar sala para entrar.' } }));
                    return;
                }


                if (currentRoomInMemory.players.size >= 2 && !currentRoomInMemory.players.has(ws.clientId)) {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (memória).' } }));
                     return;
                }
                 if (currentRoomInMemory.players.has(ws.clientId)) {
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } }));
                    return;
                }

                // Atualiza o DB e a memória
                let newStatus = currentRoomInMemory.status;
                if (!currentRoomInMemory.player1IdActual) { // Slot P1 vago
                    await db.query('UPDATE rooms SET player1_id = $1 WHERE room_code = $2', [ws.clientId, roomCode]);
                    currentRoomInMemory.player1IdActual = ws.clientId;
                } else if (!currentRoomInMemory.player2IdActual) { // Slot P2 vago
                     await db.query('UPDATE rooms SET player2_id = $1, status = $2 WHERE room_code = $3', [ws.clientId, 'playing', roomCode]);
                    currentRoomInMemory.player2IdActual = ws.clientId;
                    newStatus = 'playing';
                } else { // Ambos os slots ocupados, mas jogador não está na sala (deve ter sido reconexão falha)
                    ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia ou erro inesperado ao entrar.' } }));
                    return;
                }

                currentRoomInMemory.players.set(ws.clientId, ws);
                currentRoomInMemory.playerUsernames.set(ws.clientId, ws.clientUsername);
                currentRoomInMemory.status = newStatus;
                ws.currentRoomCode = roomCode;

                const playersList = Array.from(currentRoomInMemory.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));

                currentRoomInMemory.players.forEach(playerWs => {
                    playerWs.send(JSON.stringify({
                        type: 'PLAYER_JOINED',
                        payload: { roomCode, players: playersList, status: currentRoomInMemory.status }
                    }));
                    if (currentRoomInMemory.status === 'playing' && currentRoomInMemory.players.size === 2) {
                        playerWs.send(JSON.stringify({
                            type: 'GAME_START',
                            payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam suas jogadas!' }
                        }));
                    }
                });
                console.log(`${ws.clientUsername} entrou na sala ${roomCode}. Jogadores: ${playersList.map(p => p.username).join(', ')}. Status: ${currentRoomInMemory.status}`);
                return; // Sai da função handleJoinRoom após sucesso

            } else {
                 ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada (DB).' } }));
                 return;
            }

        } catch (dbError) {
            console.error("Erro ao tentar carregar/entrar na sala via DB:", dbError);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro de servidor ao entrar na sala.' } }));
            return;
        }
    }

    // Lógica original para sala já em memória (refatorada acima para integrar com a carga do DB)
    // Esta parte é alcançada se a sala já estava na memória ao chamar handleJoinRoom
    if (room.players.size >= 2 && !room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia (memória).' } }));
        return;
    }
    if (room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } }));
        return;
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
             ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro: Slots da sala já preenchidos no DB.' } }));
             return;
        }


        room.players.set(ws.clientId, ws);
        room.playerUsernames.set(ws.clientId, ws.clientUsername);
        room.status = newDbStatus; // Atualiza status da sala em memória
        ws.currentRoomCode = roomCode;

        const playersList = Array.from(room.playerUsernames.entries()).map(([id, name]) => ({ userId: id, username: name }));

        room.players.forEach(playerWs_in_room => {
            playerWs_in_room.send(JSON.stringify({
                type: 'PLAYER_JOINED',
                payload: { roomCode, players: playersList, status: room.status }
            }));
            if (room.status === 'playing' && room.players.size === 2) {
                playerWs_in_room.send(JSON.stringify({
                    type: 'GAME_START',
                    payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam suas jogadas!' }
                }));
            }
        });
        console.log(`${ws.clientUsername} entrou na sala ${roomCode} (memória). Jogadores: ${playersList.map(p=>p.username).join(', ')}. Status: ${room.status}`);

    } catch (error) {
        console.error("Erro ao atualizar sala no DB (join em sala em memória):", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao entrar na sala.' } }));
    }
}


function handleMakeChoice(ws, roomCode, choice) {
    if (!roomCode) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Código da sala não especificado.'}}));
        return;
    }
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(ws.clientId)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você não está nesta sala ou a sala não existe.' } }));
        return;
    }
    if (room.status !== 'playing') {
         ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'O jogo não está em andamento.' } }));
        return;
    }
    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Jogada inválida.' } }));
        return;
    }
    if (room.choices.has(ws.clientId)){
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já fez sua jogada nesta rodada.' } }));
        return;
    }

    room.choices.set(ws.clientId, choice);
    ws.send(JSON.stringify({ type: 'CHOICE_MADE', payload: { choice: choice, message: 'Sua jogada foi registrada. Aguardando oponente...' } }));
    console.log(`${ws.clientUsername} na sala ${roomCode} escolheu ${choice}`);

    // Notifica o oponente que este jogador fez uma escolha (sem revelar a escolha)
    room.players.forEach(playerWsInRoom => {
        if (playerWsInRoom.clientId !== ws.clientId && playerWsInRoom.readyState === WebSocket.OPEN) {
            playerWsInRoom.send(JSON.stringify({ type: 'OPPONENT_CHOICE_MADE', payload: { message: 'Seu oponente fez uma jogada.'}}));
        }
    });

    if (room.choices.size === 2 && room.players.size === 2) { // Garante que ambos os jogadores designados fizeram escolhas
        const player1Id = room.player1IdActual;
        const player2Id = room.player2IdActual;

        // Verifica se as escolhas são dos jogadores designados para a sala
        if (!room.choices.has(player1Id) || !room.choices.has(player2Id)) {
            console.log(`Sala ${roomCode}: Esperando escolhas dos jogadores designados.`);
            return; // Algum jogador não designado fez uma escolha, ou um dos designados ainda não escolheu
        }

        const choice1 = room.choices.get(player1Id);
        const choice2 = room.choices.get(player2Id);

        const result = determineWinner(choice1, choice2);
        let gameStatus, winnerId = null;

        if (result === 'draw') {
            gameStatus = 'draw';
        } else if (result === 'player1') { // player1 aqui se refere à 'choice1'
            gameStatus = `${room.playerUsernames.get(player1Id)}_won`; // ou 'player1_won' se preferir
            winnerId = player1Id;
        } else { // player2 aqui se refere à 'choice2'
            gameStatus = `${room.playerUsernames.get(player2Id)}_won`; // ou 'player2_won'
            winnerId = player2Id;
        }
        room.status = gameStatus;

        db.query('UPDATE rooms SET status = $1 WHERE room_code = $2', [gameStatus, roomCode]).catch(console.error);

        const resultPayload = {
            roomCode,
            choices: {
                [player1Id]: { username: room.playerUsernames.get(player1Id), choice: choice1 },
                [player2Id]: { username: room.playerUsernames.get(player2Id), choice: choice2 }
            },
            result: gameStatus,
            winnerId: winnerId,
            winnerUsername: winnerId ? room.playerUsernames.get(winnerId) : null
        };

        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.readyState === WebSocket.OPEN) {
                playerWsInRoom.send(JSON.stringify({ type: 'GAME_RESULT', payload: resultPayload }));
            }
        });
        console.log(`Resultado da sala ${roomCode}: ${gameStatus}. Jogadas: ${room.playerUsernames.get(player1Id)}(${choice1}) vs ${room.playerUsernames.get(player2Id)}(${choice2})`);

        room.choices.clear();
        room.status = 'playing'; // Prepara para a próxima rodada
        // Envia mensagem para nova rodada
         setTimeout(() => {
            room.players.forEach(pWs => {
                if (pWs.readyState === WebSocket.OPEN) {
                    pWs.send(JSON.stringify({ type: 'NEW_ROUND', payload: { message: "Nova rodada! Façam suas escolhas." } }));
                }
            });
        }, 1000); // Pequeno delay para mensagem de nova rodada
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

function handlePlayerDisconnect(ws) {
    const roomCode = ws.currentRoomCode;
    if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        const wasPlayerInRoom = room.players.has(ws.clientId);
        room.players.delete(ws.clientId); // Remove a conexão WebSocket específica

        if (wasPlayerInRoom) {
            console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado da sala ${roomCode}. Jogadores ativos restantes na sala: ${room.players.size}`);

            // Notifica o outro jogador (se existir e ainda estiver conectado)
            // Os IDs `player1IdActual` e `player2IdActual` ainda estão no objeto `room`
            const otherPlayerId = room.player1IdActual === ws.clientId ? room.player2IdActual : room.player1IdActual;
            if (otherPlayerId && room.players.has(otherPlayerId)) { // Verifica se o outro jogador ainda está na lista de players ativos
                const otherPlayerWs = room.players.get(otherPlayerId);
                if (otherPlayerWs && otherPlayerWs.readyState === WebSocket.OPEN) {
                    otherPlayerWs.send(JSON.stringify({
                        type: 'OPPONENT_DISCONNECTED',
                        payload: { userId: ws.clientId, username: ws.clientUsername, message: `${ws.clientUsername} desconectou-se.` }
                    }));
                }
            }

            // Se a sala ficar sem jogadores *conectados* e não estiver apenas 'waiting' para o primeiro jogador
            // (ou seja, era um jogo em andamento ou esperando o segundo)
            // A sala ainda existe na memória e no DB, permitindo reconexão nos slots player1IdActual/player2IdActual.
            // Poderíamos mudar o status da sala no DB aqui para algo como 'interrupted' ou 'waiting_reconnect' se desejado.
            // Por ora, a sala permanece em memória e no DB com seus player IDs atribuídos.
            // Se todos os *designados* saírem (player1IdActual e player2IdActual se tornam null ou a sala é explicitamente fechada),
            // então ela pode ser removida da memória e do DB.

            // Se não houver mais nenhum socket ativo na sala:
            if (room.players.size === 0) {
                 console.log(`Sala ${roomCode} está agora vazia de conexões ativas.`);
                 // Não removemos da `rooms` Map aqui para permitir que os `player1IdActual` e `player2IdActual` possam reconectar.
                 // A limpeza de salas completamente abandonadas pode ser uma tarefa separada (ex: por timeout).
            }
        }
    } else {
        console.log(`${ws.clientUsername} (ID: ${ws.clientId}) desconectado, mas não estava associado a uma sala ativa na memória.`);
    }
}

module.exports = { initializeGameService };