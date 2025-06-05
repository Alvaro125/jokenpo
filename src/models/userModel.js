const db = require('../config/db'); // Importa a configuração da pool de conexões
const bcrypt = require('bcryptjs');

const User = {
    // Encontra um usuário pelo nome de usuário
    async findByUsername(username) {
        const query = 'SELECT * FROM users WHERE username = $1';
        try {
            const { rows } = await db.query(query, [username]);
            return rows[0]; // Retorna o usuário encontrado ou undefined
        } catch (error) {
            console.error('Erro ao buscar usuário por nome de usuário:', error);
            throw error;
        }
    },

    // Encontra um usuário pelo ID
    async findById(id) {
        const query = 'SELECT id, username, created_at FROM users WHERE id = $1'; // Não retorna o hash da senha
        try {
            const { rows } = await db.query(query, [id]);
            return rows[0];
        } catch (error) {
            console.error('Erro ao buscar usuário por ID:', error);
            throw error;
        }
    },

    // Cria um novo usuário
    async create({ username, password }) {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const query = `
            INSERT INTO users (username, password_hash)
            VALUES ($1, $2)
            RETURNING id, username, created_at;
        `;
        try {
            const { rows } = await db.query(query, [username, passwordHash]);
            return rows[0]; // Retorna o usuário recém-criado
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            // Tratar erros específicos, como violação de constraint UNIQUE para username
            if (error.code === '23505') { // Código de erro do PostgreSQL para unique_violation
                throw new Error('Nome de usuário já existe.');
            }
            throw error;
        }
    },

    // Compara a senha fornecida com o hash armazenado
    async comparePassword(candidatePassword, passwordHash) {
        try {
            return await bcrypt.compare(candidatePassword, passwordHash);
        } catch (error) {
            console.error('Erro ao comparar senhas:', error);
            throw error;
        }
    }
};

module.exports = User;