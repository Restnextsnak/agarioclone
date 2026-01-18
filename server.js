const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();

function generateRoomCode() {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms.has(code));
    return code;
}

// 그리드 생성 (설정값 반영 + 쉬운 조합 보장)
function generateGridData(targetGoldCount, targetSpecialCount) {
    const grid = [];
    const specials = [];
    const golds = [];
    
    // 1. 기본 150칸 랜덤 채우기
    for(let i=0; i<150; i++) {
        grid.push(Math.floor(Math.random() * 9) + 1);
    }
    
    // 2. [필수 요청 1] 쉬운 조합 강제 생성 (9, 1 배치)
    // 인덱스 충돌 방지를 위한 헬퍼 함수
    const usedIndices = new Set();
    
    function getSafePairIndex() {
        // 15열 그리드이므로, 행이 바뀌지 않는 위치(오른쪽 끝 제외)를 찾아야 함
        // 0~148 중, i % 15 !== 14 인 곳
        let idx;
        let attempts = 0;
        do {
            idx = Math.floor(Math.random() * 149);
            attempts++;
            if (attempts > 1000) break; // 무한루프 방지
        } while (
            idx % 15 === 14 || // 오른쪽 끝이면 옆이랑 짝 못지음
            usedIndices.has(idx) || usedIndices.has(idx+1) // 이미 쓴 자리
        );
        usedIndices.add(idx);
        usedIndices.add(idx+1);
        return idx;
    }

    // (1) 쉬운 황금 사과 배치 (9, 1)
    const goldIdx = getSafePairIndex();
    grid[goldIdx] = 9;
    grid[goldIdx+1] = 1; 
    golds.push(goldIdx); // 9번 자리를 황금사과로 (혹은 1번 자리여도 됨, 여기선 왼쪽)

    // (2) 쉬운 독 사과 배치 (9, 1)
    const specialIdx = getSafePairIndex();
    grid[specialIdx] = 9;
    grid[specialIdx+1] = 1;
    specials.push(specialIdx); // 9번 자리를 독사과로

    // 3. 나머지 황금 사과 채우기 (방장 설정 개수만큼)
    while(golds.length < targetGoldCount) {
        const r = Math.floor(Math.random() * 150);
        if(!golds.includes(r) && !specials.includes(r)) {
            golds.push(r);
        }
    }

    // 4. 나머지 독 사과 채우기 (방장 설정 개수만큼)
    while(specials.length < targetSpecialCount) {
        const r = Math.floor(Math.random() * 150);
        if(!golds.includes(r) && !specials.includes(r)) {
            specials.push(r);
        }
    }
    
    return { grid, specials, golds };
}

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    // [필수 요청 2] 방 생성 시 개수 조절 데이터 받기
    socket.on('createRoom', ({ name, maxPlayers, mode, timeLimit, goldCount, specialCount }) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            maxPlayers: maxPlayers,
            mode: mode,
            timeLimit: timeLimit || 180,
            goldCount: goldCount || 3,      // 기본값 3
            specialCount: specialCount || 10, // 기본값 10
            players: [],
            isPlaying: false,
            timerInterval: null
        };
        rooms.set(roomCode, room);
        joinRoomLogic(socket, room, name, true);
    });

    socket.on('joinRoom', ({ name, roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', '방이 없습니다.');
        if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('error', '이미 게임 중입니다.');
        joinRoomLogic(socket, room, name, false);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if(!room || room.players[0].id !== socket.id) return;
        
        room.isPlaying = true;
        let time = room.timeLimit;
        
        room.players.forEach(p => {
            // 설정된 개수만큼 생성
            const data = generateGridData(room.goldCount, room.specialCount);
            p.score = 0;
            p.isDead = false;
            io.to(p.id).emit('gameStarted', { 
                mode: room.mode,
                grid: data.grid,
                specials: data.specials,
                golds: data.golds
            });
        });

        io.to(roomCode).emit('playersUpdate', room.players);

        room.timerInterval = setInterval(() => {
            if(!room.isPlaying) { clearInterval(room.timerInterval); return; }
            
            time--;
            io.to(roomCode).emit('timerUpdate', time);

            const elapsed = room.timeLimit - time;
            if(room.mode === 'deathmatch' && elapsed > 0 && elapsed % 30 === 0 && time > 0) {
                processDeathmatch(room);
            }

            if(time <= 0) {
                clearInterval(room.timerInterval);
                finishGame(room);
            }
            
            if(room.mode === 'deathmatch') {
                const survivors = room.players.filter(p => !p.isDead);
                if(survivors.length === 1 && room.players.length > 1) {
                    clearInterval(room.timerInterval);
                    finishGame(room);
                }
            }
        }, 1000);
    });

    socket.on('myGridUpdate', (data) => {
        const room = rooms.get(data.roomCode);
        if(!room) return;
        
        const p = room.players.find(pl => pl.id === socket.id);
        if(p) {
            p.score = data.score;
            socket.broadcast.to(data.roomCode).emit('monitorUpdate', {
                playerId: socket.id,
                grid: data.grid,
                specials: data.specials,
                golds: data.golds,
                stones: data.stones,
                score: data.score
            });
        }
    });

    socket.on('attack', ({ roomCode, targetId, type }) => {
        const room = rooms.get(roomCode);
        if(!room) return;
        
        const attacker = room.players.find(p => p.id === socket.id);
        let target;

        if(!targetId || targetId === socket.id) {
            const potentialTargets = room.players.filter(p => p.id !== socket.id && !p.isDead);
            if(potentialTargets.length > 0) {
                target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
            }
        } else {
            target = room.players.find(p => p.id === targetId);
        }

        if(attacker && target && !target.isDead) {
            io.to(target.id).emit('attacked', { type: type, attackerName: attacker.name });
            io.to(roomCode).emit('visualAttack', { from: attacker.id, to: target.id });
        }
    });

    socket.on('leaveRoom', (roomCode) => handleLeave(socket, roomCode));
    socket.on('disconnect', () => {
        rooms.forEach((room, code) => {
            if(room.players.find(p => p.id === socket.id)) handleLeave(socket, code);
        });
    });
});

function joinRoomLogic(socket, room, name, isHost) {
    const player = { id: socket.id, name, isHost, score: 0, isDead: false };
    room.players.push(player);
    socket.join(room.code);
    
    socket.emit(isHost ? 'roomCreated' : 'roomJoined', { 
        roomCode: room.code, maxPlayers: room.maxPlayers, mode: room.mode 
    });
    io.to(room.code).emit('playersUpdate', room.players);
}

function handleLeave(socket, roomCode) {
    const room = rooms.get(roomCode);
    if(!room) return;
    
    const idx = room.players.findIndex(p => p.id === socket.id);
    if(idx === -1) return;
    
    room.players.splice(idx, 1);
    socket.leave(roomCode);
    
    if(room.players.length === 0) {
        if(room.timerInterval) clearInterval(room.timerInterval);
        rooms.delete(roomCode);
    } else {
        if(!room.players.some(p => p.isHost)) room.players[0].isHost = true;
        io.to(roomCode).emit('playersUpdate', room.players);
    }
}

function processDeathmatch(room) {
    let survivors = room.players.filter(p => !p.isDead);
    if(survivors.length <= 1) return;
    survivors.sort((a, b) => a.score - b.score);
    
    const victim = survivors[0];
    victim.isDead = true;
    io.to(room.code).emit('playerEliminated', victim.id);
}

function finishGame(room) {
    room.isPlaying = false;
    const survivors = room.players.filter(p => !p.isDead);
    survivors.sort((a, b) => b.score - a.score);
    
    const scores = room.players.map(p => ({ 
        name: p.name, score: p.score, isDead: p.isDead 
    })).sort((a,b) => b.score - a.score);

    io.to(room.code).emit('gameEnded', { winner: survivors[0] || null, scores });
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));