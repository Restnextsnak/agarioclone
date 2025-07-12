
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let players = {};

wss.on('connection', (ws) => {
    const playerId = Date.now().toString(); // Simple unique ID
    players[playerId] = {
        x: Math.random() * 800,
        y: Math.random() * 600,
        radius: 20,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
    };
    ws.playerId = playerId;

    console.log(`Player ${playerId} connected`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'update') {
                const player = players[ws.playerId];
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                }
            }
        } catch (e) {
            console.error("Failed to parse message or update player", e);
        }
    });

    ws.on('close', () => {
        console.log(`Player ${ws.playerId} disconnected`);
        delete players[ws.playerId];
    });
});

// Broadcast game state to all clients
setInterval(() => {
    const gameState = JSON.stringify(Object.values(players));
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(gameState);
        }
    });
}, 1000 / 30); // 30 times per second

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
