require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const url = require('url'); // Para parsear a URL da requisição WebSocket
const { verifyTokenForWebSocket } = require('./middleware/authMiddleware'); // Criaremos este
const { initializeGameService } = require('./services/gameService'); // Criaremos este

// WebSocket e outras importações virão depois

const authRoutes = require('./routes/authRoutes'); // Supondo que você crie este arquivo

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // Para parsear JSON no corpo das requisições
app.use(express.static(path.join(__dirname, '../public'))); // Servir arquivos estáticos

// Rotas HTTP
app.use('/api/auth', authRoutes); // Rotas como /api/auth/register e /api/auth/login
const server = http.createServer(app);

// Anexar o servidor WebSocket ao servidor HTTP
const wss = new WebSocket.Server({ noServer: true }); // 'noServer: true' para controle manual do upgrade

initializeGameService(wss); // Passa a instância do WSS para o gameService

server.on('upgrade', (request, socket, head) => {
    // Parseia a URL para obter o token (e outros parâmetros, se houver)
    const pathname = url.parse(request.url).pathname;
    const queryParams = url.parse(request.url, true).query;
    const token = queryParams.token;

    // Autenticação do WebSocket antes de completar o handshake
    // Aqui, estamos assumindo que o token está em um query param 'token'
    // ws://localhost:3000?token=SUA_STRING_JWT

    if (pathname === '/ws') { // Define um caminho específico para WebSocket, ex: /ws
        verifyTokenForWebSocket(token, (err, clientData) => {
            if (err || !clientData) {
                console.log('Falha na autenticação WebSocket: Token inválido ou ausente.');
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); // Resposta HTTP padrão
                socket.destroy();
                return;
            }

            // Se autenticado, completar o handshake do WebSocket
            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.clientId = clientData.userId; // Adiciona o ID do usuário ao objeto ws
                ws.clientUsername = clientData.username;
                wss.emit('connection', ws, request); // Emite o evento 'connection' padrão do 'ws'
            });
        });
    } else {
        // Se não for para o caminho /ws, destruir o socket
        console.log('Tentativa de upgrade em caminho não WebSocket:', pathname);
        socket.destroy();
    }
});


// Iniciar o servidor HTTP (que agora também lida com WebSockets)
server.listen(PORT, () => {
    console.log(`Servidor HTTP e WebSocket rodando na porta ${PORT}`);
    console.log(`Frontend disponível em http://localhost:${PORT}`);
    console.log(`WebSocket endpoint em ws://localhost:${PORT}/ws`);
});