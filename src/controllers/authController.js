const User = require('../models/userModel'); // Importa o modelo
const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs'); // Não é mais necessário aqui, pois o model lida com hash e compare
const JWT_SECRET = process.env.JWT_SECRET;


exports.register = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
    }

    try {
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: 'Usuário já existe.' });
        }

        const newUser = await User.create({ username, password });

        res.status(201).json({
            message: 'Usuário registrado com sucesso!',
            user: { id: newUser.id, username: newUser.username }, // Não retorna o hash da senha
        });
    } catch (error) {
        console.error('Erro no registro:', error.message);
        // Se o erro for de "Nome de usuário já existe" vindo do model
        if (error.message === 'Nome de usuário já existe.') {
             return res.status(409).json({ message: error.message });
        }
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
    }

    try {
        const user = await User.findByUsername(username);
        if (!user) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const isMatch = await User.comparePassword(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            message: 'Login bem-sucedido!',
            token,
            userId: user.id,
            username: user.username
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};
