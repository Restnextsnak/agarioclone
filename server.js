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
let cpuPlayers = {}; // Added for CPU players
const FOOD_COUNT = 100;
const CPU_PLAYER_COUNT = 10; // Number of CPU players
const INITIAL_CPU_RADIUS = 25;
const CPU_SPEED = 3;
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

function generateCpuPlayers() {
    for (let i = 0; i < CPU_PLAYER_COUNT; i++) {
        const id = `cpu-${i}`;
        cpuPlayers[id] = {
            id: id,
            name: `CPU-${i}`,
            x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
            radius: INITIAL_CPU_RADIUS + Math.random() * 10,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            speed: CPU_SPEED,
            vx: (Math.random() - 0.5) * CPU_SPEED,
            vy: (Math.random() - 0.5) * CPU_SPEED
        };
    }
}

generateFood();
generateCpuPlayers();

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

        if (distance > 5) { // Prevent jittering when very close to target
            const angle = Math.atan2(dy, dx);
            // Speed is 2/3 of original speed
            const currentSpeed = (player.speed * (2/3)) / (player.radius / 30); // Slower for larger players
            player.x += Math.cos(angle) * Math.min(distance, currentSpeed);
            player.y += Math.sin(angle) * Math.min(distance, currentSpeed);
        } else {
            player.x = player.targetX;
            player.y = player.targetY;
        }

        // Keep player within map bounds
        player.x = Math.max(-MAP_SIZE / 2 + player.radius, Math.min(MAP_SIZE / 2 - player.radius, player.x));
        player.y = Math.max(-MAP_SIZE / 2 + player.radius, Math.min(MAP_SIZE / 2 - player.radius, player.y));

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

    // Update CPU player positions and handle collisions
    for (let id in cpuPlayers) {
        let cpu = cpuPlayers[id];

        // Simple random movement for CPU players
        cpu.x += cpu.vx;
        cpu.y += cpu.vy;

        // Bounce off walls
        if (cpu.x - cpu.radius < -MAP_SIZE / 2 || cpu.x + cpu.radius > MAP_SIZE / 2) {
            cpu.vx *= -1;
        }
        if (cpu.y - cpu.radius < -MAP_SIZE / 2 || cpu.y + cpu.radius > MAP_SIZE / 2) {
            cpu.vy *= -1;
        }

        // Keep CPU within map bounds
        cpu.x = Math.max(-MAP_SIZE / 2 + cpu.radius, Math.min(MAP_SIZE / 2 - cpu.radius, cpu.x));
        cpu.y = Math.max(-MAP_SIZE / 2 + cpu.radius, Math.min(MAP_SIZE / 2 - cpu.radius, cpu.y));

        // CPU vs Food
        for (let i = food.length - 1; i >= 0; i--) {
            const foodItem = food[i];
            const dist = Math.sqrt(Math.pow(cpu.x - foodItem.x, 2) + Math.pow(cpu.y - foodItem.y, 2));
            if (dist < cpu.radius + foodItem.radius) {
                cpu.radius += 1;
                food.splice(i, 1);
                food.push({
                    x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                    y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                    radius: 10,
                    color: `hsl(${Math.random() * 360}, 100%, 50%)`
                });
            }
        }

        // CPU vs Players
        for (let playerId in players) {
            let player = players[playerId];
            const dist = Math.sqrt(Math.pow(cpu.x - player.x, 2) + Math.pow(cpu.y - player.y, 2));
            if (dist < cpu.radius + player.radius) {
                if (cpu.radius > player.radius * 1.1) {
                    cpu.radius += player.radius / 2;
                    io.to(playerId).emit('playerDied');
                    delete players[playerId];
                } else if (player.radius > cpu.radius * 1.1) {
                    player.radius += cpu.radius / 2;
                    delete cpuPlayers[id];
                    // Regenerate CPU
                    const newCpuId = `cpu-${Object.keys(cpuPlayers).length}`;
                    cpuPlayers[newCpuId] = {
                        id: newCpuId,
                        name: `CPU-${Object.keys(cpuPlayers).length}`,
                        x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        radius: INITIAL_CPU_RADIUS + Math.random() * 10,
                        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                        speed: CPU_SPEED,
                        vx: (Math.random() - 0.5) * CPU_SPEED,
                        vy: (Math.random() - 0.5) * CPU_SPEED
                    };
                }
            }
        }

        // CPU vs CPU
        for (let otherCpuId in cpuPlayers) {
            if (id === otherCpuId) continue;
            let otherCpu = cpuPlayers[otherCpuId];
            const dist = Math.sqrt(Math.pow(cpu.x - otherCpu.x, 2) + Math.pow(cpu.y - otherCpu.y, 2));
            if (dist < cpu.radius + otherCpu.radius) {
                if (cpu.radius > otherCpu.radius * 1.1) {
                    cpu.radius += otherCpu.radius / 2;
                    delete cpuPlayers[otherCpuId];
                    // Regenerate CPU
                    const newCpuId = `cpu-${Object.keys(cpuPlayers).length}`;
                    cpuPlayers[newCpuId] = {
                        id: newCpuId,
                        name: `CPU-${Object.keys(cpuPlayers).length}`,
                        x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        radius: INITIAL_CPU_RADIUS + Math.random() * 10,
                        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                        speed: CPU_SPEED,
                        vx: (Math.random() - 0.5) * CPU_SPEED,
                        vy: (Math.random() - 0.5) * CPU_SPEED
                    };
                } else if (otherCpu.radius > cpu.radius * 1.1) {
                    otherCpu.radius += cpu.radius / 2;
                    delete cpuPlayers[id];
                    // Regenerate CPU
                    const newCpuId = `cpu-${Object.keys(cpuPlayers).length}`;
                    cpuPlayers[newCpuId] = {
                        id: newCpuId,
                        name: `CPU-${Object.keys(cpuPlayers).length}`,
                        x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
                        radius: INITIAL_CPU_RADIUS + Math.random() * 10,
                        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                        speed: CPU_SPEED,
                        vx: (Math.random() - 0.5) * CPU_SPEED,
                        vy: (Math.random() - 0.5) * CPU_SPEED
                    };
                }
            }
        }
    }

    // Emit game state to all connected clients
    io.emit('gameState', { players: Object.values(players), food, cpuPlayers: Object.values(cpuPlayers) });
}, 1000 / 60); // 60 updates per second

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});