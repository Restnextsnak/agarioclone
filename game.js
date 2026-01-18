let socket;
let gameState = {
    roomCode: null,
    playerName: null,
    myId: null,
    isHost: false,
    maxPlayers: 2,
    mode: 'timeattack',
    timeLimit: 180,
    
    // 내 게임 데이터
    grid: [], 
    specials: [], 
    golds: [], 
    stones: [], 
    score: 0,
    
    // 게임 상태
    time: 180,
    isPlaying: false,
    players: [],
    targetId: null, 
    
    // 드래그 로직
    isSelecting: false,
    selectionStart: null,
    selectionEnd: null,
    selectedCells: [],
    
    // 스킬 및 힌트 로직
    skillCount: 0,
    isUsingSkill: false,
    hintTimer: null
};

const audio = {
    bgm: null,
    pop: null,
    volume: 0.5,
    started: false 
};

window.onload = function() {
    socket = io();
    setupAudio();
    setupSocketEvents();

    document.body.addEventListener('click', startAudioContext, { once: true });
    document.body.addEventListener('touchstart', startAudioContext, { once: true });
};

function setupAudio() {
    audio.bgm = document.getElementById('bgm');
    audio.pop = document.getElementById('sfxPop');
    updateVolume(0.5);
}

function startAudioContext() {
    if(!audio.started) {
        audio.started = true;
        playBGM();
    }
}

function updateVolume(val) {
    audio.volume = parseFloat(val);
    if(audio.bgm) audio.bgm.volume = audio.volume * 0.5;
    if(audio.pop) audio.pop.volume = audio.volume;
}

function playBGM() {
    if(audio.bgm && audio.bgm.paused) {
        audio.bgm.currentTime = 0;
        audio.bgm.play().catch(e => {
            audio.started = false;
        });
    }
}

function playSFX() {
    if(audio.pop) {
        audio.pop.currentTime = 0;
        audio.pop.play().catch(e => {});
    }
}

/* --- 화면 전환 --- */
function hideAllScreens() {
    ['menuScreen', 'createRoomScreen', 'joinRoomScreen', 'waitingRoom', 'gameScreen'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}
function showMenu() { hideAllScreens(); document.getElementById('menuScreen').classList.remove('hidden'); }
function showCreateRoom() { hideAllScreens(); document.getElementById('createRoomScreen').classList.remove('hidden'); playBGM(); }
function showJoinRoom() { hideAllScreens(); document.getElementById('joinRoomScreen').classList.remove('hidden'); playBGM(); }

function toggleTimeSelect() {
    const mode = document.getElementById('gameMode').value;
    const timeGroup = document.getElementById('timeSelectGroup');
    timeGroup.style.display = mode === 'timeattack' ? 'block' : 'none';
}

/* --- 방 관리 --- */
function createRoom() {
    const name = document.getElementById('hostName').value.trim();
    const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
    const mode = document.getElementById('gameMode').value;
    const timeLimit = parseInt(document.getElementById('timeLimit').value);
    
    const goldCount = parseInt(document.getElementById('goldCount').value);
    const specialCount = parseInt(document.getElementById('specialCount').value);

    if(!name) return alert('이름을 입력하세요!');
    
    gameState.playerName = name;
    gameState.isHost = true;
    socket.emit('createRoom', { name, maxPlayers, mode, timeLimit, goldCount, specialCount });
}

function joinRoom() {
    const name = document.getElementById('guestName').value.trim();
    const roomCode = document.getElementById('roomCodeInput').value.trim();
    if(!name || roomCode.length !== 4) return alert('정보를 올바르게 입력하세요.');
    
    gameState.playerName = name;
    socket.emit('joinRoom', { name, roomCode });
}

function leaveRoom() { socket.emit('leaveRoom', gameState.roomCode); showMenu(); }
function leaveGame() { 
    if(confirm("정말 나가시겠습니까?")) {
        socket.emit('leaveRoom', gameState.roomCode); 
        gameState.isPlaying = false; 
        clearHintTimer();
        showMenu(); 
    }
}
function startGame() { socket.emit('startGame', gameState.roomCode); }

/* --- 소켓 이벤트 --- */
function setupSocketEvents() {
    socket.on('connect', () => { gameState.myId = socket.id; });
    socket.on('roomCreated', (data) => enterWaitingRoom(data));
    socket.on('roomJoined', (data) => enterWaitingRoom(data));
    
    socket.on('playersUpdate', (players) => {
        gameState.players = players;
        updateWaitingRoom(players);
        if(gameState.isPlaying) updatePlayerPanels();
        
        const cntEl = document.getElementById('playerCount');
        if(cntEl) cntEl.textContent = `${players.length}/${gameState.maxPlayers}`;
    });

    socket.on('gameStarted', ({ mode, grid, specials, golds }) => {
        gameState.mode = mode;
        gameState.grid = grid;
        gameState.specials = specials;
        gameState.golds = golds || [];
        gameState.stones = [];
        gameState.score = 0;
        gameState.targetId = null;
        gameState.skillCount = 0; 
        gameState.isUsingSkill = false;
        
        hideAllScreens();
        document.getElementById('gameScreen').classList.remove('hidden');
        initGameUI();
    });

    socket.on('monitorUpdate', ({ playerId, grid, specials, golds, stones, score }) => {
        const pIndex = gameState.players.findIndex(p => p.id === playerId);
        if(pIndex !== -1) {
            gameState.players[pIndex].grid = grid;
            gameState.players[pIndex].specials = specials;
            gameState.players[pIndex].golds = golds;
            gameState.players[pIndex].stones = stones;
            gameState.players[pIndex].score = score;
            updatePlayerPanels();
        }
    });

    socket.on('attacked', ({ type, attackerName }) => {
        showStatusMessage(`'${attackerName}'의 공격!`);
        applyAttackEffect(type);
    });
    
    socket.on('visualAttack', ({ from, to }) => {
        playAttackAnimation(from, to);
    });

    socket.on('playerEliminated', (playerId) => {
        if(playerId === gameState.myId) {
            gameState.isPlaying = false;
            clearHintTimer();
            showStatusMessage("탈락했습니다...💀");
            document.querySelector('.grid-wrapper').style.opacity = '0.5';
            document.querySelectorAll('.apple').forEach(el => el.style.pointerEvents = 'none');
        }
        
        const p = gameState.players.find(p => p.id === playerId);
        if(p) p.isDead = true;
        updatePlayerPanels();
    });

    socket.on('timerUpdate', (time) => {
        gameState.time = time;
        updateTimerDisplay();
    });

    socket.on('gameEnded', ({ winner, scores }) => {
        gameState.isPlaying = false;
        clearHintTimer();
        let msg = winner ? `우승: ${winner.name}!` : "게임 종료";
        msg += "\n\n[순위]\n" + scores.map((s,i) => `${i+1}. ${s.name} (${s.score}점)`).join("\n");
        alert(msg);
        showMenu();
    });

    socket.on('error', (msg) => alert(msg));
}

function enterWaitingRoom({ roomCode, maxPlayers, mode }) {
    gameState.roomCode = roomCode;
    gameState.maxPlayers = maxPlayers;
    hideAllScreens();
    document.getElementById('waitingRoom').classList.remove('hidden');
    document.getElementById('waitingCode').textContent = roomCode;
    document.getElementById('waitingModeDisplay').textContent = mode === 'timeattack' ? '<타임어택 모드>' : '<데스매치 모드>';
    document.getElementById('startGameBtn').style.display = gameState.isHost ? 'inline-block' : 'none';
}

function updateWaitingRoom(players) {
    const div = document.getElementById('waitingPlayers');
    div.innerHTML = players.map(p => 
        `<div style="padding:10px; border:1px solid #ccc; background:white; font-size:14px;">
            ${p.name} ${p.isHost ? '👑' : ''}
        </div>`
    ).join('');
}

/* --- 게임 로직 --- */
function initGameUI() {
    gameState.isPlaying = true;
    gameState.isSelecting = false;
    document.body.classList.remove('invisible-cursor');
    document.querySelector('.grid-wrapper').style.opacity = '1';
    
    document.getElementById('gameModeBadge').textContent = gameState.mode === 'timeattack' ? 'TIME ATTACK' : 'DEATH MATCH';
    document.getElementById('gameRoomCode').textContent = gameState.roomCode;
    document.getElementById('myScore').textContent = '0';
    updateSkillButton();
    
    renderMyGrid();
    updatePlayerPanels();
    broadcastMyState();
    resetHintTimer(); 
}

function updateTimerDisplay() {
    const m = Math.floor(gameState.time / 60);
    const s = gameState.time % 60;
    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    
    if(gameState.time <= 10) timerEl.classList.add('urgent');
    else timerEl.classList.remove('urgent');
}

function renderMyGrid() {
    const container = document.getElementById('grid');
    container.innerHTML = '';
    
    gameState.grid.forEach((num, idx) => {
        const div = document.createElement('div');
        div.className = 'apple';
        div.dataset.index = idx;
        div.textContent = num > 0 ? num : '';
        
        if (num === 0) div.classList.add('empty');
        else {
            if(gameState.stones.includes(idx)) div.classList.add('stone');
            else if(gameState.golds.includes(idx)) div.classList.add('gold');
            else if(gameState.specials.includes(idx)) div.classList.add('special');
        }
        
        container.appendChild(div);
    });
    
    container.onmousedown = onInputStart;
    container.onmousemove = onInputMove;
    document.onmouseup = onInputEnd;
    container.ontouchstart = onInputStart;
    container.ontouchmove = onInputMove;
    document.ontouchend = onInputEnd;
}

function getPointFromEvent(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
    }
    return { x: e.clientX, y: e.clientY, target: e.target };
}

function getElementFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if(el && el.classList.contains('apple')) return el;
    return null;
}

function onInputStart(e) {
    if(!gameState.isPlaying) return;
    
    hideHint();
    resetHintTimer();

    const point = getPointFromEvent(e);
    
    // 스킬 사용 모드
    if(gameState.isUsingSkill) {
        const target = e.target.closest('.apple');
        if(target && !target.classList.contains('empty') && !target.classList.contains('stone')) {
            useSingleRemoveSkill(getCellIndex(target));
        }
        return;
    }

    if(point.target.classList.contains('empty') || point.target.classList.contains('stone')) return;
    
    gameState.isSelecting = true;
    gameState.selectionStart = getCellIndex(point.target);
    updateSelection(gameState.selectionStart);
}

function onInputMove(e) {
    if(!gameState.isSelecting || gameState.isUsingSkill) return;
    
    if(e.type === 'touchmove') e.preventDefault();

    const point = getPointFromEvent(e);
    const target = getElementFromPoint(point.x, point.y);
    
    if(target) {
        updateSelection(getCellIndex(target));
    }
}

function onInputEnd(e) {
    if(!gameState.isSelecting) return;
    gameState.isSelecting = false;
    checkScore();
    clearSelection();
}

function getCellIndex(el) { return parseInt(el.dataset.index); }

function updateSelection(endIdx) {
    const start = gameState.selectionStart;
    const end = endIdx;
    if(isNaN(start) || isNaN(end)) return;

    const cols = 15;
    const minX = Math.min(start % cols, end % cols);
    const maxX = Math.max(start % cols, end % cols);
    const minY = Math.min(Math.floor(start / cols), Math.floor(end / cols));
    const maxY = Math.max(Math.floor(start / cols), Math.floor(end / cols));

    gameState.selectedCells = [];
    document.querySelectorAll('#grid .apple').forEach(el => {
        el.classList.remove('selecting');
        const idx = parseInt(el.dataset.index);
        const x = idx % cols;
        const y = Math.floor(idx / cols);
        
        if(x >= minX && x <= maxX && y >= minY && y <= maxY) {
            if(!el.classList.contains('empty') && !el.classList.contains('stone')) {
                el.classList.add('selecting');
                gameState.selectedCells.push(idx);
            }
        }
    });
}

function clearSelection() {
    document.querySelectorAll('.apple.selecting').forEach(el => el.classList.remove('selecting'));
    gameState.selectedCells = [];
}

function checkScore() {
    if(gameState.selectedCells.length === 0) return;
    
    const sum = gameState.selectedCells.reduce((acc, idx) => acc + gameState.grid[idx], 0);
    
    if(sum === 10) {
        resetHintTimer();
        playSFX();

        gameState.score += gameState.selectedCells.length;
        document.getElementById('myScore').textContent = gameState.score;
        
        let attackTriggered = false;
        let goldTriggered = false;

        gameState.selectedCells.forEach(idx => {
            if(gameState.specials.includes(idx)) {
                attackTriggered = true;
                gameState.specials = gameState.specials.filter(s => s !== idx);
            }
            if(gameState.golds.includes(idx)) {
                goldTriggered = true;
                gameState.golds = gameState.golds.filter(g => g !== idx);
            }
            gameState.grid[idx] = 0; 
        });
        
        if(attackTriggered) triggerAttack();
        
        if(goldTriggered) {
            showStatusMessage("황금 사과 효과!✨");
            // 50% 확률로 리필 or 스킬 획득
            if(Math.random() < 0.5) {
                refillBoard();
                showStatusMessage("보드 리필! 🔄");
            } else {
                gameState.skillCount++;
                updateSkillButton();
                showStatusMessage(`스킬 획득! (+1)`);
            }
        }

        renderMyGrid();
        broadcastMyState();
    }
}

/* --- 힌트 시스템 --- */
function resetHintTimer() {
    clearHintTimer();
    if(gameState.isPlaying) {
        // [수정] 15초 -> 10초
        gameState.hintTimer = setTimeout(findAndShowHint, 10000); 
    }
}

function clearHintTimer() {
    if(gameState.hintTimer) {
        clearTimeout(gameState.hintTimer);
        gameState.hintTimer = null;
    }
}

function hideHint() {
    document.querySelectorAll('.apple.hint').forEach(el => el.classList.remove('hint'));
}

function findAndShowHint() {
    if(!gameState.isPlaying) return;
    hideHint();

    const cols = 15;
    const rows = 10;
    
    for(let r1=0; r1<rows; r1++) {
        for(let c1=0; c1<cols; c1++) {
            for(let r2=r1; r2<rows; r2++) {
                for(let c2=c1; c2<cols; c2++) {
                    
                    let sum = 0;
                    let valid = true;
                    const indices = [];

                    for(let r=r1; r<=r2; r++) {
                        for(let c=c1; c<=c2; c++) {
                            const idx = r * cols + c;
                            const val = gameState.grid[idx];
                            if(val === 0 || gameState.stones.includes(idx)) {
                                valid = false;
                                break;
                            }
                            sum += val;
                            indices.push(idx);
                        }
                        if(!valid) break;
                    }

                    if(valid && sum === 10) {
                        indices.forEach(idx => {
                            const el = document.querySelector(`.apple[data-index="${idx}"]`);
                            if(el) el.classList.add('hint');
                        });
                        return; 
                    }
                }
            }
        }
    }
}

function refillBoard() {
    for(let i=0; i<gameState.grid.length; i++) {
        if(gameState.grid[i] === 0) {
            gameState.grid[i] = Math.floor(Math.random() * 9) + 1;
        }
    }
}

function updateSkillButton() {
    const btn = document.getElementById('skillBtn');
    if(gameState.skillCount > 0) {
        btn.style.display = 'inline-block';
        btn.textContent = gameState.isUsingSkill ? "취소" : `✨ 지우개 (x${gameState.skillCount})`;
        btn.style.background = gameState.isUsingSkill ? "#f44336" : "#ffd700";
        btn.style.color = gameState.isUsingSkill ? "white" : "#8b4513";
    } else {
        btn.style.display = 'none';
        gameState.isUsingSkill = false;
        document.body.classList.remove('using-skill');
    }
}

function toggleSkillMode() {
    gameState.isUsingSkill = !gameState.isUsingSkill;
    if(gameState.isUsingSkill) {
        document.body.classList.add('using-skill');
        hideHint(); 
        resetHintTimer();
    } else {
        document.body.classList.remove('using-skill');
    }
    updateSkillButton();
}

function useSingleRemoveSkill(idx) {
    if(gameState.grid[idx] === 0 || gameState.stones.includes(idx)) return;
    
    playSFX();
    gameState.grid[idx] = 0;
    
    gameState.specials = gameState.specials.filter(s => s !== idx);
    gameState.golds = gameState.golds.filter(g => g !== idx);

    gameState.skillCount--;
    gameState.isUsingSkill = false;
    document.body.classList.remove('using-skill');
    updateSkillButton();
    resetHintTimer();

    renderMyGrid();
    broadcastMyState();
}

function broadcastMyState() {
    socket.emit('myGridUpdate', {
        roomCode: gameState.roomCode,
        grid: gameState.grid,
        specials: gameState.specials,
        golds: gameState.golds,
        stones: gameState.stones,
        score: gameState.score
    });
}

function setTarget(id) {
    if(id === gameState.myId) return;
    gameState.targetId = id;
    updatePlayerPanels();
}

function triggerAttack() {
    const type = Math.floor(Math.random() * 3) + 1;
    socket.emit('attack', {
        roomCode: gameState.roomCode,
        targetId: gameState.targetId,
        type: type
    });
}

function applyAttackEffect(type) {
    if(type === 1) { 
        showStatusMessage("판이 섞였습니다!");
        const values = gameState.grid.filter(n => n > 0);
        values.sort(() => Math.random() - 0.5);
        let vIdx = 0;
        for(let i=0; i<gameState.grid.length; i++) {
            if(gameState.grid[i] > 0) gameState.grid[i] = values[vIdx++];
        }
        renderMyGrid();
    } 
    else if(type === 2) { 
        showStatusMessage("돌 사과 발생!");
        const candidates = gameState.grid.map((v, i) => v > 0 ? i : -1).filter(i => i !== -1);
        candidates.sort(() => Math.random() - 0.5);
        
        // [수정] 10개 -> 20개
        gameState.stones = candidates.slice(0, 20);
        renderMyGrid();
        
        setTimeout(() => {
            gameState.stones = []; 
            renderMyGrid();
            broadcastMyState(); 
        }, 10000);
    } 
    else if(type === 3) { 
        if(document.body.classList.contains('invisible-cursor')) return; 
        showStatusMessage("마우스가 사라졌습니다!");
        document.body.classList.add('invisible-cursor');
        
        // [수정] 30초 -> 20초
        setTimeout(() => {
            document.body.classList.remove('invisible-cursor');
        }, 20000);
    }
    resetHintTimer(); 
    broadcastMyState(); 
}

function showStatusMessage(text) {
    const el = document.getElementById('statusMessage');
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
}

function updatePlayerPanels() {
    const myId = gameState.myId;
    const others = gameState.players.filter(p => p.id !== myId);
    
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    leftSidebar.innerHTML = ''; rightSidebar.innerHTML = '';
    
    const half = Math.ceil(others.length / 2);
    
    others.forEach((p, i) => {
        const panel = createPlayerPanel(p);
        if(i < half) leftSidebar.appendChild(panel);
        else rightSidebar.appendChild(panel);
    });
}

function createPlayerPanel(p) {
    const el = document.createElement('div');
    el.className = 'player-panel';
    if(p.id === gameState.targetId) el.classList.add('target');
    if(p.isDead) el.classList.add('dead');
    
    el.onclick = () => { if(!p.isDead) setTarget(p.id); };
    el.id = `panel-${p.id}`; 

    let gridHtml = '';
    const pGrid = p.grid || [];
    if(pGrid.length > 0) {
        gridHtml = '<div class="player-mini-grid">';
        pGrid.forEach((n, i) => {
            let cls = 'mini-apple';
            if(n === 0) cls += ' empty';
            else if(p.stones && p.stones.includes(i)) cls += ' stone';
            else if(p.golds && p.golds.includes(i)) cls += ' gold';
            else if(p.specials && p.specials.includes(i)) cls += ' special';
            gridHtml += `<div class="${cls}"></div>`;
        });
        gridHtml += '</div>';
    }

    el.innerHTML = `
        <div class="player-info">
            <span class="player-name">${p.name}</span>
            <span class="player-score">${p.score}점</span>
        </div>
        ${gridHtml}
    `;
    return el;
}

function playAttackAnimation(fromId, toId) {
    let startEl, endEl;
    if(fromId === gameState.myId) {
        startEl = document.querySelector('.game-container'); 
        endEl = document.getElementById(`panel-${toId}`);
    } else if(toId === gameState.myId) {
        startEl = document.getElementById(`panel-${fromId}`);
        endEl = document.getElementById('myScore'); 
    } else {
        startEl = document.getElementById(`panel-${fromId}`);
        endEl = document.getElementById(`panel-${toId}`);
    }

    if(!startEl || !endEl) return;
    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
    const flying = document.createElement('div');
    flying.className = 'flying-apple';
    
    const startX = fromId === gameState.myId ? window.innerWidth/2 : startRect.left + startRect.width/2;
    const startY = fromId === gameState.myId ? window.innerHeight/2 : startRect.top + startRect.height/2;

    flying.style.left = `${startX}px`;
    flying.style.top = `${startY}px`;
    document.body.appendChild(flying);
    flying.getBoundingClientRect();

    const endX = toId === gameState.myId ? window.innerWidth/2 : endRect.left + endRect.width/2;
    const endY = toId === gameState.myId ? window.innerHeight/2 : endRect.top + endRect.height/2;

    flying.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
    setTimeout(() => { flying.remove(); }, 800);
}