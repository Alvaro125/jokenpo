const db = require('../config/db');

const Room = {
    async create(roomCode, player1Id, status = 'waiting') {
        const query = `
            INSERT INTO rooms (room_code, player1_id, status)
            VALUES ($1, $2, $3)
            RETURNING id, room_code, player1_id, player2_id, status, created_at;
        `;
        try {
            const { rows } = await db.query(query, [roomCode, player1Id, status]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao criar sala na base de dados:', error);
            throw error;
        }
    },
    async findByRoomCode(roomCode) {
        const query = 'SELECT * FROM rooms WHERE room_code = $1';
        try {
            const { rows } = await db.query(query, [roomCode]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao buscar sala por código:', error);
            throw error;
        }
    },
    async findById(id) {
        const query = 'SELECT * FROM rooms WHERE id = $1';
        try {
            const { rows } = await db.query(query, [id]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao buscar sala por ID:', error);
            throw error;
        }
    },
    async addPlayer2AndSetStatus(roomCode, player2Id, status = 'playing') {
        const query = `
            UPDATE rooms
            SET player2_id = $1, status = $2
            WHERE room_code = $3
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [player2Id, status, roomCode]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao adicionar jogador 2 e atualizar estado da sala:', error);
            throw error;
        }
    },
    async updateStatus(roomCode, status) {
        const query = `
            UPDATE rooms
            SET status = $1
            WHERE room_code = $2
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [status, roomCode]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao atualizar o estado da sala:', error);
            throw error;
        }
    },
    async updatePlayer1(roomCode, player1Id) {
        const query = `
            UPDATE rooms
            SET player1_id = $1
            WHERE room_code = $2
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [player1Id, roomCode]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao atualizar player1_id da sala:', error);
            throw error;
        }
    },
    async removePlayer(roomCode, playerField, newStatus) {
        let queryString = `UPDATE rooms SET ${playerField} = NULL`;
        const queryParams = [];

        if (newStatus) {
            queryString += ', status = $1';
            queryParams.push(newStatus);
        }

        queryString += ' WHERE room_code = $';
        queryParams.push(roomCode);
        queryString += queryParams.length + ' RETURNING *;';


        try {
            const { rows } = await db.query(queryString, queryParams);
            return rows[0];
        } catch (error) {
            console.error(`Erro ao remover ${playerField} da sala ${roomCode}:`, error);
            throw error;
        }
    },
    async listActiveRooms() {
        const query = `
            SELECT * FROM rooms
            WHERE status = 'waiting' OR status = 'playing'
            ORDER BY created_at DESC;
        `;
        try {
            const { rows } = await db.query(query);
            return rows;
        } catch (error) {
            console.error('Erro ao listar salas ativas:', error);
            throw error;
        }
    },
    async deleteByRoomCode(roomCode) {
        const query = 'DELETE FROM rooms WHERE room_code = $1 RETURNING *';
        try {
            const { rows } = await db.query(query, [roomCode]);
            return rows[0]; // Retorna a sala que foi excluída
        } catch (error) {
            console.error('Erro ao excluir sala por código:', error);
            throw error;
        }
    }
};

module.exports = Room;