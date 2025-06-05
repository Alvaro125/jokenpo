const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

exports.register = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Utilizador e palavra-passe são obrigatórios.' });
    }
    try {
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: 'Utilizador já existe.' });
        }
        const newUser = await User.create({ username, password });
        const token = jwt.sign(
            { userId: newUser.id, username: newUser.username },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1000 // 1 hora
        });
        res.status(201).json({
            message: 'Utilizador registado e logado com sucesso!',
            user: { id: newUser.id, username: newUser.username }
        });
    } catch (error) {
        console.error('Erro no registo:', error.message);
        if (error.message === 'Nome de utilizador já existe.') {
             return res.status(409).json({ message: error.message });
        }
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Utilizador e palavra-passe são obrigatórios.' });
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
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1000 // 1 hora
        });
        res.json({
            message: 'Login bem-sucedido!',
            userId: user.id,
            username: user.username
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};

exports.logout = (req, res) => {
    res.cookie('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: new Date(0)
    });
    res.status(200).json({ message: 'Logout bem-sucedido.' });
};

