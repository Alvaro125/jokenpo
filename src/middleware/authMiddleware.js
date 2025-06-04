const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware para verificar token em conexões WebSocket
exports.verifyTokenForWebSocket = (token, callback) => {
    if (!token) {
        return callback(new Error('Token não fornecido'), null);
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return callback(err, null);
        }
        // Token é válido, retorna os dados decodificados (payload)
        // Ex: { userId: 1, username: 'fulano', iat: ..., exp: ... }
        return callback(null, decoded);
    });
};