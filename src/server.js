require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const url = require('url');
const cookieParser = require('cookie-parser');
const cookie = require('cookie'); // Módulo para parsear strings de cookie

const authRoutes = require('./routes/authRoutes');
const { verifyTokenForWebSocket } = require('./middleware/authMiddleware');
const { initializeGameService } = require('./services/gameService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares Globais
app.use(express.json()); // Para parsear corpos de requisição JSON
app.use(cookieParser()); // Para parsear cookies nas requisições HTTP Express
app.use(express.static(path.join(__dirname, '../public'))); // Servir arquivos estáticos

// Rotas HTTP
app.use('/api/auth', authRoutes);

// Criação do servidor HTTP e WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true }); // `noServer: true` para controle manual do upgrade

initializeGameService(wss); // Passa a instância do WSS para o nosso serviço de jogo

// Lógica de Upgrade para WebSocket
server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/ws') { // Nosso endpoint WebSocket
        let tokenFromCookie;
        try {
            // Parseia os cookies do header da requisição de upgrade
            const cookies = cookie.parse(request.headers.cookie || '');
            tokenFromCookie = cookies.token; // O nome do cookie deve corresponder ao definido no login
        } catch (e) {
            console.error("Erro ao parsear cookies durante o upgrade:", e);
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); // Resposta HTTP padrão
            socket.destroy();
            return;
        }

        // Verifica o token JWT
        verifyTokenForWebSocket(tokenFromCookie, (err, clientData) => {
            if (err || !clientData) {
                let logMessage = 'Falha na autenticação WebSocket: ';
                if (err) logMessage += err.message;
                else if (!tokenFromCookie) logMessage += "Token não encontrado no cookie.";
                else logMessage += "Token inválido.";
                console.log(logMessage);

                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            // Se autenticado, completa o handshake do WebSocket
            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.clientId = clientData.userId; // Anexa dados do utilizador ao objeto `ws`
                ws.clientUsername = clientData.username;
                wss.emit('connection', ws, request); // Emite o evento 'connection' padrão do 'ws'
            });
        });
    } else {
        // Se a tentativa de upgrade não for para o nosso endpoint `/ws`
        console.log('Tentativa de upgrade em caminho não WebSocket:', pathname);
        socket.destroy();
    }
});

// Inicia o servidor
server.listen(PORT, () => {
    console.log(`Servidor HTTP e WebSocket rodando na porta ${PORT}`);
    console.log(`Frontend disponível em http://localhost:${PORT}`);
    console.log(`Endpoint WebSocket em ws://localhost:${PORT}/ws (ou wss:// se houver proxy SSL)`);
});

