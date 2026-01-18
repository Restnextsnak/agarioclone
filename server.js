const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

// 정적 파일 제공
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 게임 방 관리
const rooms = new Map();

// 랜덤 방 코드 생성
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// 초기 그리드 생성 (15x10 = 150칸)
function generateGrid() {
    const grid = [];
    for (let i = 0; i < 150; i++) {
        grid.push(Math.floor(Math.random() * 9) + 1);
    }
    return grid;
}

// Socket.IO 연결
io.on('connection', (socket) => {
    console.log(`[연결] ${socket.id}`);

    // 방 만들기
    socket.on('createRoom', ({ name, maxPlayers }) => {
        const roomCode = generateRoomCode();
        
        const room = {
            code: roomCode,
            maxPlayers: maxPlayers,
            players: [{
                id: socket.id,
                name: name,
                score: 0,
                isHost: true
            }],
            grid: generateGrid(),
            isPlaying: false,
            startTime: null
        };
        
        rooms.set(roomCode, room);
        socket.join(roomCode);
        
        socket.emit('roomCreated', { roomCode, maxPlayers });
        io.to(roomCode).emit('playersUpdate', room.players);
        
        console.log(`[방 생성] ${roomCode} (${name}, 최대 ${maxPlayers}명)`);
    });

    // 방 참가
    socket.on('joinRoom', ({ name, roomCode }) => {
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('roomNotFound');
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            socket.emit('roomFull');
            return;
        }
        
        room.players.push({
            id: socket.id,
            name: name,
            score: 0,
            isHost: false
        });
        
        socket.join(roomCode);
        socket.emit('roomJoined', { roomCode, maxPlayers: room.maxPlayers });
        io.to(roomCode).emit('playersUpdate', room.players);
        
        console.log(`[방 참가] ${roomCode}: ${name}`);
    });

    // 게임 시작
    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        // 방장 확인
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return;
        
        room.isPlaying = true;
        room.startTime = Date.now();
        
        io.to(roomCode).emit('gameStarted', {
            grid: room.grid,
            players: room.players
        });
        
        console.log(`[게임 시작] ${roomCode}`);
        
        // 3분 타이머
        setTimeout(() => {
            endGame(roomCode);
        }, 180000);
    });

    // 그리드 업데이트
    socket.on('gridUpdate', ({ roomCode, grid, score }) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        room.grid = grid;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.score = score;
        }
        
        // 모든 플레이어에게 업데이트 전송
        io.to(roomCode).emit('gridUpdate', {
            grid: grid,
            playerId: socket.id,
            score: score
        });
    });

    // 방 나가기
    socket.on('leaveRoom', (roomCode) => {
        leaveRoom(socket, roomCode);
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log(`[연결 해제] ${socket.id}`);
        
        rooms.forEach((room, code) => {
            leaveRoom(socket, code);
        });
    });
});

// 방 나가기 처리
function leaveRoom(socket, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    
    const player = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    
    socket.leave(roomCode);
    
    console.log(`[방 나가기] ${roomCode}: ${player.name}`);
    
    if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`[방 삭제] ${roomCode}`);
    } else {
        if (player.isHost && room.players.length > 0) {
            room.players[0].isHost = true;
        }
        
        io.to(roomCode).emit('playersUpdate', room.players);
        
        if (room.isPlaying) {
            endGame(roomCode);
        }
    }
}

// 게임 종료
function endGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.isPlaying = false;
    
    const scores = room.players
        .map(p => ({ name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score);
    
    const winner = scores[0];
    
    io.to(roomCode).emit('gameEnded', { winner, scores });
    
    console.log(`[게임 종료] ${roomCode}, 승자: ${winner.name} (${winner.score}점)`);
}

// 서버 시작 (Render의 PORT 환경변수 사용)
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('🍎 멀티 사과 게임 서버 시작!');
    console.log('═══════════════════════════════════════');
    console.log(`포트: ${PORT}`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════');
});