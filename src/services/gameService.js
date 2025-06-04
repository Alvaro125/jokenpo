const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid'); // Para gerar IDs de sala únicos
const db = require('../config/db'); // Para interagir com o banco de dados, se necessário para salas

// Em memória para armazenar salas e jogadores.
// Para produção, considere Redis ou persistência no DB para maior robustez.
const rooms = new Map(); // roomCode -> { id, players: Map<userId, ws>, choices: Map<userId, choice>, status, etc. }

function initializeGameService(wss) {
    wss.on('connection', (ws) => {
        // ws.clientId e ws.clientUsername já foram definidos no server.js após a autenticação
        console.log(`Cliente conectado: ${ws.clientUsername} (ID: ${ws.clientId})`);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`Mensagem recebida de ${ws.clientUsername}:`, data);

                switch (data.type) {
                    case 'CREATE_ROOM':
                        handleCreateRoom(ws);
                        break;
                    case 'JOIN_ROOM':
                        handleJoinRoom(ws, data.payload.roomCode);
                        break;
                    case 'MAKE_CHOICE':
                        handleMakeChoice(ws, data.payload.roomCode, data.payload.choice);
                        break;
                    // Adicione outros tipos de mensagem conforme necessário (ex: LEAVE_ROOM, CHAT_MESSAGE)
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
            // Lógica para remover o jogador das salas em que ele estava
            handlePlayerDisconnect(ws);
        });

        ws.on('error', (error) => {
            console.error(`Erro no WebSocket para ${ws.clientUsername}:`, error);
            // Lógica de limpeza, se necessário
            handlePlayerDisconnect(ws);
        });
    });
}

async function handleCreateRoom(ws) {
    let roomCode;
    let roomExists = true;
    // Tenta gerar um código de sala único
    while(roomExists) {
        roomCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // Gera um código alfanumérico de 6 chars
        const existingRoom = await db.query('SELECT id FROM rooms WHERE room_code = $1', [roomCode]);
        if (existingRoom.rows.length === 0) {
            roomExists = false;
        }
    }

    try {
        const dbRoom = await db.query(
            'INSERT INTO rooms (room_code, player1_id, status) VALUES ($1, $2, $3) RETURNING id',
            [roomCode, ws.clientId, 'waiting']
        );
        const roomId = dbRoom.rows[0].id;

        const newRoom = {
            id: roomId,
            roomCode: roomCode,
            players: new Map(), // userId -> ws
            choices: new Map(), // userId -> choice
            status: 'waiting', // 'waiting', 'playing', 'player1_won', 'player2_won', 'draw'
            playerUsernames: {} // userId -> username
        };
        newRoom.players.set(ws.clientId, ws);
        newRoom.playerUsernames[ws.clientId] = ws.clientUsername;

        rooms.set(roomCode, newRoom);

        ws.currentRoomCode = roomCode; // Armazena o código da sala na conexão do jogador

        ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            payload: { roomCode, roomId, players: [{userId: ws.clientId, username: ws.clientUsername}] }
        }));
        console.log(`Sala ${roomCode} criada por ${ws.clientUsername}`);

    } catch (error) {
        console.error("Erro ao criar sala no DB:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao criar sala.' } }));
    }
}

async function handleJoinRoom(ws, roomCode) {
    const room = rooms.get(roomCode);

    if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala não encontrada.' } }));
        return;
    }

    if (room.players.size >= 2) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Sala cheia.' } }));
        return;
    }

    if (room.players.has(ws.clientId)) {
         ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Você já está nesta sala.' } }));
        return;
    }

    try {
        // Atualiza o player2_id no banco de dados
        await db.query('UPDATE rooms SET player2_id = $1, status = $2 WHERE room_code = $3', [ws.clientId, 'playing', roomCode]);

        room.players.set(ws.clientId, ws);
        room.playerUsernames[ws.clientId] = ws.clientUsername;
        room.status = 'playing';
        ws.currentRoomCode = roomCode;

        const playersInRoom = Array.from(room.players.keys()).map(pid => ({
            userId: pid,
            username: room.playerUsernames[pid]
        }));

        // Notifica todos na sala que um novo jogador entrou e o jogo pode começar
        room.players.forEach(playerWs => {
            playerWs.send(JSON.stringify({
                type: 'PLAYER_JOINED',
                payload: { roomCode, players: playersInRoom, status: room.status }
            }));
            playerWs.send(JSON.stringify({
                type: 'GAME_START', // Sinaliza para o front-end que o jogo começou
                payload: { roomCode, message: 'Ambos os jogadores estão conectados. Façam suas jogadas!' }
            }));
        });
        console.log(`${ws.clientUsername} entrou na sala ${roomCode}. Jogadores: ${playersInRoom.map(p=>p.username).join(', ')}`);

    } catch (error) {
        console.error("Erro ao atualizar sala no DB:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Erro ao entrar na sala.' } }));
    }
}

function handleMakeChoice(ws, roomCode, choice) {
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(ws.clientId) || room.status !== 'playing') {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Não é possível fazer a jogada.' } }));
        return;
    }

    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Jogada inválida.' } }));
        return;
    }

    room.choices.set(ws.clientId, choice);
    ws.send(JSON.stringify({ type: 'CHOICE_MADE', payload: { message: 'Sua jogada foi registrada. Aguardando oponente...' } }));
    console.log(`${ws.clientUsername} na sala ${roomCode} escolheu ${choice}`);


    // Verifica se ambos os jogadores fizeram suas escolhas
    if (room.choices.size === 2) {
        const playerIds = Array.from(room.players.keys());
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const choice1 = room.choices.get(player1Id);
        const choice2 = room.choices.get(player2Id);

        const result = determineWinner(choice1, choice2);
        let gameStatus, winnerId = null;

        if (result === 'draw') {
            gameStatus = 'draw';
        } else if (result === 'player1') {
            gameStatus = 'player1_won';
            winnerId = player1Id;
        } else {
            gameStatus = 'player2_won';
            winnerId = player2Id;
        }
        room.status = gameStatus;

        // Atualiza status da sala no DB (opcional, mas bom para consistência)
        db.query('UPDATE rooms SET status = $1 WHERE room_code = $2', [gameStatus, roomCode]).catch(console.error);


        const resultPayload = {
            roomCode,
            choices: {
                [player1Id]: { username: room.playerUsernames[player1Id], choice: choice1 },
                [player2Id]: { username: room.playerUsernames[player2Id], choice: choice2 }
            },
            result: gameStatus, // 'player1_won', 'player2_won', 'draw'
            winnerId: winnerId,
            winnerUsername: winnerId ? room.playerUsernames[winnerId] : null
        };

        room.players.forEach(playerWsInRoom => {
            playerWsInRoom.send(JSON.stringify({ type: 'GAME_RESULT', payload: resultPayload }));
        });
        console.log(`Resultado da sala ${roomCode}: ${gameStatus}. Jogadas: P1(${choice1}) vs P2(${choice2})`);

        // Limpa as escolhas para a próxima rodada (ou finaliza o jogo)
        room.choices.clear();
        // Poderia adicionar lógica para "jogar novamente" ou fechar a sala.
        // Por simplicidade, vamos permitir novas jogadas na mesma sala.
        // Para uma nova rodada, redefina o status para 'playing'
        // room.status = 'playing';
        // room.players.forEach(playerWsInRoom => {
        //     playerWsInRoom.send(JSON.stringify({ type: 'NEW_ROUND', payload: { message: 'Nova rodada! Façam suas escolhas.' } }));
        // });

    } else {
        // Notifica o oponente que o outro jogador já fez a escolha (opcional)
        room.players.forEach(playerWsInRoom => {
            if (playerWsInRoom.clientId !== ws.clientId) {
                // playerWsInRoom.send(JSON.stringify({ type: 'OPPONENT_CHOSE', payload: { message: 'Seu oponente já fez uma escolha.' } }));
            }
        });
    }
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return 'draw';
    if (
        (choice1 === 'rock' && choice2 === 'scissors') ||
        (choice1 === 'scissors' && choice2 === 'paper') ||
        (choice1 === 'paper' && choice2 === 'rock')
    ) {
        return 'player1'; // Assumindo que choice1 é do "jogador 1" conceitual da comparação
    }
    return 'player2';
}

function handlePlayerDisconnect(ws) {
    const roomCode = ws.currentRoomCode;
    if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        room.players.delete(ws.clientId);
        delete room.playerUsernames[ws.clientId];

        console.log(`${ws.clientUsername} desconectado da sala ${roomCode}. Jogadores restantes: ${room.players.size}`);

        if (room.players.size < 2 && room.status !== 'waiting') {
            // Se um jogador sair e o jogo estava em andamento ou esperando o segundo jogador
            room.status = 'waiting'; // Ou 'aborted', 'opponent_left'
            // Notifica o jogador restante, se houver
            room.players.forEach(remainingPlayerWs => {
                remainingPlayerWs.send(JSON.stringify({
                    type: 'OPPONENT_LEFT',
                    payload: { roomCode, message: 'Seu oponente saiu da sala. Aguardando novo jogador...' }
                }));
            });
             // Atualiza DB, remove player da sala ou marca como "aberta"
            db.query(
                'UPDATE rooms SET player1_id = CASE WHEN player1_id = $1 THEN NULL ELSE player1_id END, player2_id = CASE WHEN player2_id = $1 THEN NULL ELSE player2_id END, status = $2 WHERE room_code = $3',
                [ws.clientId, 'waiting', roomCode]
            ).then(() => {
                // Se ambos os players saíram, a sala pode ser removida do DB ou marcada como inativa.
                // Por simplicidade, apenas resetamos os players.
                // Se a sala ficar vazia, podemos removê-la do map 'rooms' em memória.
                if (room.players.size === 0) {
                    rooms.delete(roomCode);
                    console.log(`Sala ${roomCode} ficou vazia e foi removida da memória.`);
                    // Opcionalmente, deletar do DB também:
                    // db.query('DELETE FROM rooms WHERE room_code = $1', [roomCode]).catch(console.error);
                }
            }).catch(console.error);


        } else if (room.players.size === 0) {
            // Se a sala ficar vazia, remove da memória
            rooms.delete(roomCode);
            console.log(`Sala ${roomCode} ficou vazia e foi removida da memória.`);
             // Opcionalmente, deletar do DB também:
             // db.query('DELETE FROM rooms WHERE room_code = $1', [roomCode]).catch(console.error);
        }
    }
}

module.exports = { initializeGameService };