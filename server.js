const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();

// 유틸: 방 코드 생성
function generateRoomCode() {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms.has(code));
    return code;
}

// 유틸: 150칸 그리드 생성 (숫자 + 특수 사과 인덱스)
function generateGridData() {
    const grid = [];
    const specials = [];
    for(let i=0; i<150; i++) {
        grid.push(Math.floor(Math.random() * 9) + 1);
    }
    // 특수 사과 5개 랜덤 지정
    while(specials.length < 5) {
        const r = Math.floor(Math.random() * 150);
        if(!specials.includes(r)) specials.push(r);
    }
    return { grid, specials };
}

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    // 방 생성
    socket.on('createRoom', ({ name, maxPlayers, mode }) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            maxPlayers: maxPlayers,
            mode: mode, // 'timeattack' or 'deathmatch'
            players: [],
            isPlaying: false,
            timerInterval: null
        };
        rooms.set(roomCode, room);
        
        joinRoomLogic(socket, room, name, true);
    });

    // 방 참가
    socket.on('joinRoom', ({ name, roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', '방이 없습니다.');
        if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('error', '이미 게임 중입니다.');
        
        joinRoomLogic(socket, room, name, false);
    });

    // 게임 시작
    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if(!room || room.players[0].id !== socket.id) return;
        
        room.isPlaying = true;
        let time = 180; // 3분
        
        // 각 플레이어에게 고유 그리드 생성 및 전송
        room.players.forEach(p => {
            const data = generateGridData();
            p.score = 0;
            p.isDead = false;
            // 서버는 그리드 상세 데이터를 저장하진 않고 클라이언트가 보낸걸 중계만 함 (메모리 절약)
            // 다만 초기화 데이터는 보내줌
            io.to(p.id).emit('gameStarted', { 
                mode: room.mode,
                grid: data.grid,
                specials: data.specials
            });
        });

        io.to(roomCode).emit('playersUpdate', room.players); // 초기화된 점수 등 전파

        // 타이머 및 모드별 로직
        room.timerInterval = setInterval(() => {
            if(!room.isPlaying) { clearInterval(room.timerInterval); return; }
            
            time--;
            io.to(roomCode).emit('timerUpdate', time);

            // 데스매치: 30초마다 탈락 (30, 60, 90... 초가 지난 시점이니 남은시간 기준 150, 120...)
            if(room.mode === 'deathmatch' && time < 180 && time % 30 === 0 && time > 0) {
                processDeathmatch(room);
            }

            if(time <= 0) {
                clearInterval(room.timerInterval);
                finishGame(room);
            }
            
            // 데스매치 조기 종료 (1명 남음)
            if(room.mode === 'deathmatch') {
                const survivors = room.players.filter(p => !p.isDead);
                if(survivors.length === 1) {
                    clearInterval(room.timerInterval);
                    finishGame(room);
                }
            }

        }, 1000);
    });

    // 클라이언트 상태 업데이트 (모니터링용 중계)
    socket.on('myGridUpdate', (data) => {
        const room = rooms.get(data.roomCode);
        if(!room) return;
        
        const p = room.players.find(pl => pl.id === socket.id);
        if(p) {
            p.score = data.score;
            // 다른 사람들에게 이 사람의 상태를 알림
            socket.broadcast.to(data.roomCode).emit('monitorUpdate', {
                playerId: socket.id,
                grid: data.grid,
                specials: data.specials,
                stones: data.stones,
                score: data.score
            });
        }
    });

    // 공격 요청 처리
    socket.on('attack', ({ roomCode, targetId, type }) => {
        const room = rooms.get(roomCode);
        if(!room) return;
        
        const attacker = room.players.find(p => p.id === socket.id);
        let target;

        // 타겟 지정이 없거나 본인이면 랜덤 (생존자 중)
        if(!targetId || targetId === socket.id) {
            const potentialTargets = room.players.filter(p => p.id !== socket.id && !p.isDead);
            if(potentialTargets.length > 0) {
                target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
            }
        } else {
            target = room.players.find(p => p.id === targetId);
        }

        if(attacker && target && !target.isDead) {
            // 타겟에게 효과 전달
            io.to(target.id).emit('attacked', { type: type, attackerName: attacker.name });
            
            // 모든 사람에게 시각적 효과 전달 (누가 -> 누구)
            io.to(roomCode).emit('visualAttack', { from: attacker.id, to: target.id });
        }
    });

    // 나가기
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
        // 게임 중 다 나가서 1명 남으면 종료 로직 등은 생략 (간소화)
    }
}

function processDeathmatch(room) {
    // 생존자들
    let survivors = room.players.filter(p => !p.isDead);
    if(survivors.length <= 1) return;

    // 점수 오름차순 정렬
    survivors.sort((a, b) => a.score - b.score);
    
    // 탈락 인원 (50% 내림)
    const elimCount = Math.floor(survivors.length * 0.5);
    if(elimCount < 1) return;

    // 점수가 낮은 순서대로 탈락
    // 동점자 처리는 sort가 불안정할 수 있으나, JS sort는 안정적이거나 먼저 들어온 순서를 유지하는 경우가 많음.
    // 엄격한 '먼저 점수 낸 사람'은 timestamp가 필요하지만, 여기선 배열 순서(참가순) 등으로 대체
    for(let i=0; i<elimCount; i++) {
        const victim = survivors[i];
        victim.isDead = true;
        io.to(room.code).emit('playerEliminated', victim.id);
    }
}

function finishGame(room) {
    room.isPlaying = false;
    const survivors = room.players.filter(p => !p.isDead);
    
    // 점수 내림차순
    survivors.sort((a, b) => b.score - a.score);
    
    const winner = survivors.length > 0 ? survivors[0] : null;
    const scores = room.players.map(p => ({ 
        name: p.name, 
        score: p.score, 
        isDead: p.isDead 
    })).sort((a,b) => b.score - a.score); // 최종 결과창은 죽은 사람 포함 전체 순위

    io.to(room.code).emit('gameEnded', { winner, scores });
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));