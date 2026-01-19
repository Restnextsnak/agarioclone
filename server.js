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
    
    // 쉬운 조합 생성
    if (targetGoldCount > 0 && targetSpecialCount > 0) {
        const usedIndices = new Set();
        function getSafePairIndex() {
            let idx;
            let attempts = 0;
            do {
                idx = Math.floor(Math.random() * 149);
                attempts++;
                if (attempts > 1000) break; 
            } while (
                idx % 15 === 14 || 
                usedIndices.has(idx) || usedIndices.has(idx+1) 
            );
            usedIndices.add(idx);
            usedIndices.add(idx+1);
            return idx;
        }

        const goldIdx = getSafePairIndex();
        grid[goldIdx] = 9;
        grid[goldIdx+1] = 1; 
        golds.push(goldIdx); 

        const specialIdx = getSafePairIndex();
        grid[specialIdx] = 9;
        grid[specialIdx+1] = 1;
        specials.push(specialIdx); 
    }

    // 나머지 채우기
    while(golds.length < targetGoldCount) {
        const r = Math.floor(Math.random() * 150);
        if(!golds.includes(r) && !specials.includes(r)) {
            golds.push(r);
        }
    }

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

    socket.on('createRoom', ({ name, maxPlayers, mode, timeLimit, goldCount, specialCount }) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            maxPlayers: maxPlayers,
            mode: mode,
            timeLimit: timeLimit || 180,
            goldCount: goldCount,      
            specialCount: specialCount, 
            players: [],
            bannedNames: [], // [추가] 강퇴된 플레이어 이름 목록
            isPlaying: false,
            timerInterval: null
        };
        rooms.set(roomCode, room);
        joinRoomLogic(socket, room, name, true);
    });

    socket.on('joinRoom', ({ name, roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', '방이 없습니다.');
        
        // [추가] 강퇴된 플레이어인지 확인
        if (room.bannedNames.includes(name)) {
            return socket.emit('error', '강퇴당하여 재입장할 수 없습니다.');
        }

        if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('error', '이미 게임 중입니다.');
        joinRoomLogic(socket, room, name, false);
    });

    // [추가] 강퇴 기능 처리
    socket.on('kickPlayer', (targetId) => {
        // 요청자가 방장인지 확인하기 위해 방을 찾음
        let targetRoom = null;
        let requester = null;

        // 모든 방을 뒤져서 요청자가 속한 방을 찾음 (효율을 위해 socket.roomCode 등을 저장할 수도 있지만 기존 구조 유지)
        for (const [code, room] of rooms) {
            const p = room.players.find(p => p.id === socket.id);
            if (p) {
                targetRoom = room;
                requester = p;
                break;
            }
        }

        if (targetRoom && requester && requester.isHost) {
            const targetPlayer = targetRoom.players.find(p => p.id === targetId);
            if (targetPlayer) {
                // 차단 목록에 추가
                targetRoom.bannedNames.push(targetPlayer.name);
                
                // 강퇴 대상에게 알림
                io.to(targetId).emit('kicked');
                
                // 강제 퇴장 처리 (소켓 연결 끊기 혹은 leave 처리)
                // handleLeave를 재사용하기 위해 타겟 소켓을 찾아야 함
                const targetSocket = io.sockets.sockets.get(targetId);
                if (targetSocket) {
                    handleLeave(targetSocket, targetRoom.code);
                } else {
                    // 소켓을 못 찾을 경우(이미 나감 등) 데이터만 정리
                    const idx = targetRoom.players.findIndex(p => p.id === targetId);
                    if(idx !== -1) targetRoom.players.splice(idx, 1);
                    io.to(targetRoom.code).emit('playersUpdate', targetRoom.players);
                }
            }
        }
    });

    socket.on('requestGridRegen', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        const data = generateGridData(room.goldCount, room.specialCount);
        socket.emit('gridRegenerated', {
            grid: data.grid,
            specials: data.specials,
            golds: data.golds
        });
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if(!room || room.players[0].id !== socket.id) return;
        
        room.isPlaying = true;
        
        let commonData = null;
        if (room.mode === 'fixedseed') {
            room.timeLimit = 120; 
            room.goldCount = 0;   
            room.specialCount = 0;
            commonData = generateGridData(0, 0);
        }

        let time = room.timeLimit;
        
        room.players.forEach(p => {
            const data = (room.mode === 'fixedseed') ? commonData : generateGridData(room.goldCount, room.specialCount);
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