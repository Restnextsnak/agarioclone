let socket;
let gameState = {
    roomCode: null,
    playerName: null,
    myId: null,
    isHost: false,
    maxPlayers: 2,
    mode: 'timeattack',
    
    // 내 게임 데이터
    grid: [], // 숫자 배열
    specials: [], // 특수 사과 인덱스 배열
    stones: [], // 돌이 된 인덱스 배열
    score: 0,
    
    // 게임 상태
    time: 180,
    isPlaying: false,
    players: [],
    targetId: null, // 내가 공격할 대상
    
    // 드래그 로직
    isSelecting: false,
    selectionStart: null,
    selectionEnd: null,
    selectedCells: []
};

window.onload = function() {
    socket = io();
    setupSocketEvents();
};

/* --- 화면 전환 --- */
function hideAllScreens() {
    ['menuScreen', 'createRoomScreen', 'joinRoomScreen', 'waitingRoom', 'gameScreen'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}
function showMenu() { hideAllScreens(); document.getElementById('menuScreen').classList.remove('hidden'); }
function showCreateRoom() { hideAllScreens(); document.getElementById('createRoomScreen').classList.remove('hidden'); }
function showJoinRoom() { hideAllScreens(); document.getElementById('joinRoomScreen').classList.remove('hidden'); }

/* --- 방 관리 --- */
function createRoom() {
    const name = document.getElementById('hostName').value.trim();
    const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
    const mode = document.getElementById('gameMode').value;
    if(!name) return alert('이름을 입력하세요!');
    
    gameState.playerName = name;
    gameState.isHost = true;
    socket.emit('createRoom', { name, maxPlayers, mode });
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
        if(gameState.isPlaying) updatePlayerPanels(); // 게임 중이면 사이드바 갱신
    });

    socket.on('gameStarted', ({ mode, grid, specials }) => {
        gameState.mode = mode;
        // 초기 그리드는 서버에서 받지만 이후에는 각자 관리
        gameState.grid = grid;
        gameState.specials = specials;
        gameState.stones = [];
        gameState.score = 0;
        gameState.targetId = null; // 초기 타겟은 없음 (서버가 랜덤 처리하거나 랜덤 지정)
        
        hideAllScreens();
        document.getElementById('gameScreen').classList.remove('hidden');
        initGameUI();
    });

    // 다른 플레이어의 그리드 변경 알림 (모니터링용)
    socket.on('monitorUpdate', ({ playerId, grid, specials, stones, score }) => {
        const pIndex = gameState.players.findIndex(p => p.id === playerId);
        if(pIndex !== -1) {
            gameState.players[pIndex].grid = grid;
            gameState.players[pIndex].specials = specials;
            gameState.players[pIndex].stones = stones;
            gameState.players[pIndex].score = score;
            updatePlayerPanels();
        }
    });

    // 공격 받음!
    socket.on('attacked', ({ type, attackerName }) => {
        showStatusMessage(`'${attackerName}'의 공격!`);
        applyAttackEffect(type);
    });
    
    // 시각적 이펙트 (누가 누구를 공격했는지)
    socket.on('visualAttack', ({ from, to }) => {
        playAttackAnimation(from, to);
    });

    // 데스매치 탈락 알림
    socket.on('playerEliminated', (playerId) => {
        if(playerId === gameState.myId) {
            gameState.isPlaying = false;
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
        `<div style="padding:10px; border:1px solid #ccc; background:white;">
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
    
    renderMyGrid();
    updatePlayerPanels(); // 사이드바 생성
    
    // 초기 상태 서버 전송 (모니터링용)
    broadcastMyState();
}

function updateTimerDisplay() {
    const m = Math.floor(gameState.time / 60);
    const s = gameState.time % 60;
    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    
    if(gameState.time <= 10) timerEl.classList.add('urgent');
    else timerEl.classList.remove('urgent');
}

// 내 그리드 그리기
function renderMyGrid() {
    const container = document.getElementById('grid');
    container.innerHTML = '';
    
    gameState.grid.forEach((num, idx) => {
        const div = document.createElement('div');
        div.className = 'apple';
        div.dataset.index = idx;
        div.textContent = num > 0 ? num : ''; // 0은 빈칸
        
        if (num === 0) div.classList.add('empty');
        else {
            // 돌 확인
            if(gameState.stones.includes(idx)) div.classList.add('stone');
            // 특수 사과 확인 (돌이 아닐 때만)
            else if(gameState.specials.includes(idx)) div.classList.add('special');
        }
        
        container.appendChild(div);
    });
    
    // 이벤트 리스너
    container.onmousedown = onMouseDown;
    container.onmousemove = onMouseMove;
    document.onmouseup = onMouseUp; // document로 범위 확장
}

// 마우스 드래그 로직
function onMouseDown(e) {
    if(!gameState.isPlaying || e.target.classList.contains('empty') || e.target.classList.contains('stone')) return;
    gameState.isSelecting = true;
    gameState.selectionStart = getCellIndex(e.target);
    updateSelection(gameState.selectionStart);
}

function onMouseMove(e) {
    if(!gameState.isSelecting) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if(target && target.classList.contains('apple')) {
        updateSelection(getCellIndex(target));
    }
}

function onMouseUp() {
    if(!gameState.isSelecting) return;
    gameState.isSelecting = false;
    checkScore();
    clearSelection();
}

function getCellIndex(el) { return parseInt(el.dataset.index); }

function updateSelection(endIdx) {
    // 단순 사각형 선택 로직 (인덱스 기반 계산)
    // 15열 그리드 기준
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
            // 빈칸이나 돌은 선택 불가
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
    
    // 합계 계산
    const sum = gameState.selectedCells.reduce((acc, idx) => acc + gameState.grid[idx], 0);
    
    if(sum === 10) {
        // 점수: 사과 개수 * 1
        gameState.score += gameState.selectedCells.length;
        document.getElementById('myScore').textContent = gameState.score;
        
        // 특수 사과 확인 및 공격 트리거
        let attackTriggered = false;
        gameState.selectedCells.forEach(idx => {
            if(gameState.specials.includes(idx)) {
                attackTriggered = true;
                // 특수 목록에서 제거
                gameState.specials = gameState.specials.filter(s => s !== idx);
            }
            // 사과 제거 (0으로)
            gameState.grid[idx] = 0; 
        });
        
        // 공격 발동
        if(attackTriggered) {
            triggerAttack();
        }

        renderMyGrid();
        broadcastMyState();
    }
}

// 상태 서버 전송
function broadcastMyState() {
    socket.emit('myGridUpdate', {
        roomCode: gameState.roomCode,
        grid: gameState.grid,
        specials: gameState.specials,
        stones: gameState.stones,
        score: gameState.score
    });
}

/* --- 공격 시스템 --- */
function setTarget(id) {
    if(id === gameState.myId) return;
    gameState.targetId = id;
    updatePlayerPanels(); // 타겟 UI 갱신
}

function triggerAttack() {
    // 3가지 중 랜덤 (1: 섞기, 2: 돌, 3: 투명)
    const type = Math.floor(Math.random() * 3) + 1;
    
    // 타겟이 없으면 서버에 null을 보내서 랜덤 선택 요청
    socket.emit('attack', {
        roomCode: gameState.roomCode,
        targetId: gameState.targetId,
        type: type
    });
}

function applyAttackEffect(type) {
    if(type === 1) { // 셔플
        showStatusMessage("판이 섞였습니다!");
        // 0이 아닌 숫자들만 모아서 섞고 다시 배치
        const values = gameState.grid.filter(n => n > 0);
        values.sort(() => Math.random() - 0.5);
        let vIdx = 0;
        for(let i=0; i<gameState.grid.length; i++) {
            if(gameState.grid[i] > 0) gameState.grid[i] = values[vIdx++];
        }
        renderMyGrid();
    } 
    else if(type === 2) { // 돌
        showStatusMessage("돌 사과 발생!");
        // 0이 아닌 곳 중 10개 랜덤 선택
        const candidates = gameState.grid.map((v, i) => v > 0 ? i : -1).filter(i => i !== -1);
        candidates.sort(() => Math.random() - 0.5);
        const stoneIndices = candidates.slice(0, 10);
        
        gameState.stones = stoneIndices;
        renderMyGrid();
        
        setTimeout(() => {
            gameState.stones = []; // 10초 후 해제
            renderMyGrid();
            broadcastMyState(); // 상태 복구 알림
        }, 10000);
    } 
    else if(type === 3) { // 투명 마우스
        if(document.body.classList.contains('invisible-cursor')) return; // 이미 적용 중
        showStatusMessage("마우스가 사라졌습니다!");
        document.body.classList.add('invisible-cursor');
        setTimeout(() => {
            document.body.classList.remove('invisible-cursor');
        }, 30000);
    }
    broadcastMyState(); // 변경된 상태(돌 등) 전송
}

function showStatusMessage(text) {
    const el = document.getElementById('statusMessage');
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
}

/* --- 사이드바 및 UI --- */
function updatePlayerPanels() {
    const myId = gameState.myId;
    const others = gameState.players.filter(p => p.id !== myId);
    
    // 타겟 자동 지정 (없으면)
    if(!gameState.targetId && others.length > 0) {
        // gameState.targetId = others[0].id; // UI상에서만 보여줌, 실제 null이면 서버가 랜덤 처리
    }
    
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    leftSidebar.innerHTML = ''; rightSidebar.innerHTML = '';
    
    // 반반 나누기
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
    
    el.onclick = () => {
        if(!p.isDead) setTarget(p.id);
    };
    el.id = `panel-${p.id}`; // 애니메이션 좌표용

    // 그리드 시각화 (미니)
    let gridHtml = '';
    const pGrid = p.grid || [];
    // 150개 다 그리면 무거우니 간략화하거나 CSS Grid 사용
    // 여기선 데이터가 있으면 그림
    if(pGrid.length > 0) {
        gridHtml = '<div class="player-mini-grid">';
        pGrid.forEach((n, i) => {
            let cls = 'mini-apple';
            if(n === 0) cls += ' empty';
            else if(p.stones && p.stones.includes(i)) cls += ' stone';
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

// 애니메이션: 공격자(또는 나) -> 타겟
function playAttackAnimation(fromId, toId) {
    let startEl, endEl;
    
    if(fromId === gameState.myId) {
        // 내가 공격: 중앙 -> 사이드바
        startEl = document.querySelector('.game-container'); // 중앙 대략
        endEl = document.getElementById(`panel-${toId}`);
    } else if(toId === gameState.myId) {
        // 내가 맞음: 사이드바 -> 중앙
        startEl = document.getElementById(`panel-${fromId}`);
        endEl = document.getElementById('myScore'); // 중앙 점수판 쪽으로
    } else {
        // 제3자들 끼리: 사이드바 -> 사이드바
        startEl = document.getElementById(`panel-${fromId}`);
        endEl = document.getElementById(`panel-${toId}`);
    }

    if(!startEl || !endEl) return;

    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();

    const flying = document.createElement('div');
    flying.className = 'flying-apple';
    
    // 시작 위치 (중앙)
    const startX = fromId === gameState.myId ? window.innerWidth/2 : startRect.left + startRect.width/2;
    const startY = fromId === gameState.myId ? window.innerHeight/2 : startRect.top + startRect.height/2;

    flying.style.left = `${startX}px`;
    flying.style.top = `${startY}px`;
    
    document.body.appendChild(flying);

    // 강제 리플로우
    flying.getBoundingClientRect();

    // 목표 위치
    const endX = toId === gameState.myId ? window.innerWidth/2 : endRect.left + endRect.width/2;
    const endY = toId === gameState.myId ? window.innerHeight/2 : endRect.top + endRect.height/2;

    flying.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
    
    // 애니메이션 종료 후 제거
    setTimeout(() => {
        flying.remove();
    }, 800);
}