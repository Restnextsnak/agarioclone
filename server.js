const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let players = {};
let food = [];
const FOOD_COUNT = 100;
const MAP_SIZE = 2000; // Example map size

// Generate initial food
function generateFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
        food.push({
            x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            radius: 10,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`
        });
    }
}

generateFood();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initialize new player
    socket.on('playerJoin', (playerName) => {
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            radius: 30,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            speed: 5, // Base speed
            targetX: 0,
            targetY: 0
        };
        console.log(`Player ${playerName} (${socket.id}) joined.`);
    });

    // Handle player movement input
    socket.on('playerInput', (input) => {
        if (players[socket.id]) {
            players[socket.id].targetX = input.targetX;
            players[socket.id].targetY = input.targetY;
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
    });
});

// Game loop
setInterval(() => {
    // Update player positions
    for (let id in players) {
        let player = players[id];
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 1) { // Prevent jittering when very close to target
            const angle = Math.atan2(dy, dx);
            // Speed is 2/3 of original speed
            const currentSpeed = (player.speed * (2/3)) / (player.radius / 30); // Slower for larger players
            player.x += Math.cos(angle) * Math.min(distance, currentSpeed);
            player.y += Math.sin(angle) * Math.min(distance, currentSpeed);
        }

        // Handle food consumption
        for (let i = food.length - 1; i >= 0; i--) {
            const foodItem = food[i];
            const dist = Math.sqrt(Math.pow(player.x - foodItem.x, 2) + Math.pow(player.y - foodItem.y, 2));
            if (dist < player.radius + foodItem.radius) {
                player.radius += 1; // Increase player size
                food.splice(i, 1); // Remove eaten food
                // Generate new food
                food.push({
                    x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                    y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                    radius: 10,
                    color: `hsl(${Math.random() * 360}, 100%, 50%)`
                });
            }
        }

        // Handle player collision (simple example: larger eats smaller)
        for (let otherId in players) {
            if (id === otherId) continue; // Don't check self

            let otherPlayer = players[otherId];
            const dist = Math.sqrt(Math.pow(player.x - otherPlayer.x, 2) + Math.pow(player.y - otherPlayer.y, 2));

            if (dist < player.radius + otherPlayer.radius) {
                if (player.radius > otherPlayer.radius * 1.1) { // Player is significantly larger
                    player.radius += otherPlayer.radius / 2; // Absorb other player
                    io.to(otherId).emit('playerDied'); // Notify eaten player
                    delete players[otherId]; // Remove eaten player
                } else if (otherPlayer.radius > player.radius * 1.1) { // Other player is significantly larger
                    otherPlayer.radius += player.radius / 2; // Absorb current player
                    io.to(id).emit('playerDied'); // Notify current player
                    delete players[id]; // Remove current player
                }
            }
        }
    }

    // Emit game state to all connected clients
    io.emit('gameState', { players: Object.values(players), food });
}, 1000 / 60); // 60 updates per second

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});