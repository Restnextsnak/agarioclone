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
            bannedNames: [], 
            isPlaying: false,
            timerInterval: null,
            elapsedTime: 0 // 데스매치 경과 시간 체크용
        };
        rooms.set(roomCode, room);
        joinRoomLogic(socket, room, name, true);
    });

    socket.on('joinRoom', ({ name, roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', '방이 없습니다.');
        
        if (room.bannedNames.includes(name)) {
            return socket.emit('error', '강퇴당하여 재입장할 수 없습니다.');
        }

        if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('error', '이미 게임 중입니다.');
        joinRoomLogic(socket, room, name, false);
    });

    // [수정됨] 강퇴 로직 개선 - 독립적인 처리로 안정성 확보
    socket.on('kickPlayer', (targetId) => {
        let targetRoom = null;
        let requester = null;

        // 1. 요청자와 방 찾기
        for (const [code, room] of rooms) {
            const p = room.players.find(p => p.id === socket.id);
            if (p) {
                targetRoom = room;
                requester = p;
                break;
            }
        }

        // 2. 권한 확인 및 대상 존재 확인
        if (targetRoom && requester && requester.isHost) {
            const targetIndex = targetRoom.players.findIndex(p => p.id === targetId);
            
            if (targetIndex !== -1) {
                const targetPlayer = targetRoom.players[targetIndex];

                // 3. 밴 목록 추가
                targetRoom.bannedNames.push(targetPlayer.name);
                
                // 4. 대상에게 강퇴 알림 전송
                io.to(targetId).emit('kicked');

                // 5. 플레이어 목록에서 제거
                targetRoom.players.splice(targetIndex, 1);

                // 6. 대상 소켓을 방에서 내보냄 (Socket.io 룸 처리)
                const targetSocket = io.sockets.sockets.get(targetId);
                if (targetSocket) {
                    targetSocket.leave(targetRoom.code);
                }

                // 7. 남은 인원에게 업데이트 전송
                io.to(targetRoom.code).emit('playersUpdate', targetRoom.players);
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
        room.elapsedTime = 0; // 초기화
        
        let commonData = null;

        // 데스매치는 시간 제한 없음 (사실상 무한)
        if (room.mode == 'deathmatch') {
            room.timeLimit = 999999; 
        }

        if (room.mode === 'fixedseed') {
            room.timeLimit = 120; 
            room.goldCount = 0;   
            room.specialCount = 0;
            commonData = generateGridData(0, 0);
        }

        let time = room.timeLimit;
        
        // [수정됨] 모든 플레이어의 게임 상태를 초기화 (isDead 포함)
        room.players.forEach(p => {
            const data = (room.mode === 'fixedseed') ? commonData : generateGridData(room.goldCount, room.specialCount);
            p.score = 0;
            p.lastScoreTime = Date.now(); // 동점자 처리를 위한 시간 기록 초기화
            p.isDead = false; // 죽음 상태 초기화
            io.to(p.id).emit('gameStarted', { 
                mode: room.mode,
                grid: data.grid,
                specials: data.specials,
                golds: data.golds
            });
        });

        // [수정됨] 초기화된 플레이어 목록을 클라이언트에 전송
        io.to(roomCode).emit('playersUpdate', room.players);

        room.timerInterval = setInterval(() => {
            if(!room.isPlaying) { clearInterval(room.timerInterval); return; }
            
            time--;
            room.elapsedTime++; // 경과 시간 증가

            // 데스매치가 아닐 때만 클라이언트에 시간 전송 (데스매치는 타이머 없음)
            if(room.mode !== 'deathmatch') {
                io.to(roomCode).emit('timerUpdate', time);
            }

            // 데스매치: 30초마다 탈락 로직 실행
            if(room.mode === 'deathmatch' && room.elapsedTime > 0 && room.elapsedTime % 60 === 0) {
                processDeathmatch(room);
            }

            // 일반 모드 종료 조건 (시간 초과)
            if(room.mode !== 'deathmatch' && time <= 0) {
                clearInterval(room.timerInterval);
                finishGame(room);
            }
            
            // 데스매치 종료 조건: 생존자 1명 이하
            if(room.mode === 'deathmatch') {
                const survivors = room.players.filter(p => !p.isDead);
                if(survivors.length <= 1) {
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
            // 점수가 변동되었을 때만 시간 갱신 (동점자 처리용)
            if (p.score !== data.score) {
                p.score = data.score;
                p.lastScoreTime = Date.now();
            }

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

    // [수정됨] 공격 타겟 기능 제거 - 항상 랜덤 타겟으로 공격
    socket.on('attack', ({ roomCode, type }) => {
        const room = rooms.get(roomCode);
        if(!room) return;
        
        const attacker = room.players.find(p => p.id === socket.id);
        
        // 랜덤으로 타겟 선택 (자신 제외, 생존자만)
        const potentialTargets = room.players.filter(p => p.id !== socket.id && !p.isDead);
        
        if(attacker && potentialTargets.length > 0) {
            const target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
            
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
    const player = { 
        id: socket.id, 
        name, 
        isHost, 
        score: 0, 
        lastScoreTime: Date.now(), 
        isDead: false 
    };
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

    // 탈락시킬 인원 수 (현재 인원의 절반, 소수점 버림)
    const countToEliminate = Math.floor(survivors.length / 2);
    if (countToEliminate === 0) return;

    // 정렬 로직:
    // 1. 점수 오름차순 (낮은 점수가 앞 = 탈락 유력)
    // 2. 점수가 같다면 lastScoreTime 내림차순 (큰 시간값 = 늦게 득점함 = 앞 = 탈락 유력)
    survivors.sort((a, b) => {
        if (a.score !== b.score) {
            return a.score - b.score; 
        }
        return b.lastScoreTime - a.lastScoreTime;
    });
    
    // 앞쪽 인원 탈락 처리
    const victims = survivors.slice(0, countToEliminate);
    
    victims.forEach(v => {
        v.isDead = true;
        io.to(room.code).emit('playerEliminated', v.id);
    });
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