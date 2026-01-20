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
    isDead: false,
    
    // 게임 상태
    time: 180,
    isPlaying: false,
    players: [],
    targetId: null, 
    spectatingTargetId: null,
    
    // 드래그 로직
    isSelecting: false,
    selectionStart: null,
    selectionEnd: null,
    selectedCells: [],
    
    // 스킬 및 힌트 로직
    skillCount: 0,
    isUsingSkill: false,
    hintTimer: null,
    cursorTimer: null 
};

// 모드 설명 데이터 추가
const MODE_DESCRIPTIONS = {
    'timeattack': "제한 시간 동안 가장 많은 점수를 얻는 사람이 승리합니다. (기본 모드)",
    'deathmatch': "타이머 없음. 1분 마다 점수가 낮은 생존자의 절반이 탈락합니다. 동점 시 늦게 점수를 얻은 사람이 탈락하며, 최후의 1인이 승리합니다.",
    'fixedseed': "모두가 똑같은 맵으로 대결합니다. 독/황금 사과가 없고 제한시간 2분인 순수 실력전입니다."
};

const audio = {
    bgmTitle: null,
    bgmGame: null,
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

// [수정됨] 스코프 문제를 방지하기 위해 window 객체에 명시적으로 등록
window.kickPlayer = function(targetId) {
    if (confirm("이 플레이어를 강퇴하시겠습니까? (이 방에 재입장 불가)")) {
        socket.emit('kickPlayer', targetId);
    }
};

function setupAudio() {
    audio.bgmTitle = document.getElementById('bgmTitle');
    audio.bgmGame = document.getElementById('bgmGame');
    audio.pop = document.getElementById('sfxPop');
    updateVolume(0.5);
}

function startAudioContext() {
    if(!audio.started) {
        audio.started = true;
        playTitleBGM(); 
    }
}

function updateVolume(val) {
    audio.volume = parseFloat(val);
    if(audio.bgmTitle) audio.bgmTitle.volume = audio.volume * 0.5;
    if(audio.bgmGame) audio.bgmGame.volume = audio.volume * 0.5;
    if(audio.pop) audio.pop.volume = audio.volume;
}

function playTitleBGM() {
    if(!audio.started) return;
    if(audio.bgmGame) {
        audio.bgmGame.pause();
        audio.bgmGame.currentTime = 0;
    }
    if(audio.bgmTitle && audio.bgmTitle.paused) {
        audio.bgmTitle.play().catch(()=>{});
    }
}

function playGameBGM() {
    if(!audio.started) return;
    if(audio.bgmTitle) {
        audio.bgmTitle.pause();
        audio.bgmTitle.currentTime = 0;
    }
    if(audio.bgmGame && audio.bgmGame.paused) {
        audio.bgmGame.play().catch(()=>{});
    }
}

function playBGM() {
    if(gameState.isPlaying) playGameBGM();
    else playTitleBGM();
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
function showMenu() { 
    hideAllScreens(); 
    document.getElementById('menuScreen').classList.remove('hidden'); 
    
    const menuSlider = document.getElementById('volumeSlider');
    if(menuSlider) menuSlider.value = audio.volume;
    
    playTitleBGM(); 
}
function showCreateRoom() { 
    hideAllScreens(); 
    document.getElementById('createRoomScreen').classList.remove('hidden'); 
    playTitleBGM(); 
    updateModeDescription(); // 모드 설명 초기화
}
function showJoinRoom() { 
    hideAllScreens(); 
    document.getElementById('joinRoomScreen').classList.remove('hidden'); 
    playTitleBGM(); 
}

// 모드 설명 및 타임 셀렉트 토글
function updateModeDescription() {
    const mode = document.getElementById('gameMode').value;
    const descEl = document.getElementById('modeDescription');
    const timeGroup = document.getElementById('timeSelectGroup');
    
    if(descEl) descEl.textContent = MODE_DESCRIPTIONS[mode] || "";
    
    // 타임어택만 시간 설정 가능
    if (mode === 'timeattack') {
        timeGroup.style.display = 'block';
    } else {
        timeGroup.style.display = 'none';
    }
}

// 스코프 문제 방지를 위해 window 객체에 등록 (game.js는 보통 글로벌이지만 안전을 위해)
window.toggleTimeSelect = function() {
    updateModeDescription();
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
        resetGameEffects(); 
        showMenu(); 
    }
}
function startGame() { socket.emit('startGame', gameState.roomCode); }

// window.kickPlayer로 이동됨 (상단 참조)

function resetGameEffects() {
    if(gameState.hintTimer) {
        clearTimeout(gameState.hintTimer);
        gameState.hintTimer = null;
    }
    if(gameState.cursorTimer) {
        clearTimeout(gameState.cursorTimer);
        gameState.cursorTimer = null;
    }
    document.body.classList.remove('invisible-cursor');
    hideHint();
}

/* --- 소켓 이벤트 --- */
function setupSocketEvents() {
    socket.on('connect', () => { gameState.myId = socket.id; });
    socket.on('roomCreated', (data) => enterWaitingRoom(data));
    socket.on('roomJoined', (data) => enterWaitingRoom(data));
    
    socket.on('playersUpdate', (players) => {
        gameState.players = players;
        
        // 내 정보 갱신
        const me = players.find(p => p.id === gameState.myId);
        if(me) gameState.isHost = me.isHost;

        updateWaitingRoom(players);
        
        if(gameState.isPlaying) updatePlayerPanels();
        
        const cntEl = document.getElementById('playerCount');
        if(cntEl) cntEl.textContent = `${players.length}/${gameState.maxPlayers}`;
        
        if(!gameState.isPlaying) {
            document.getElementById('startGameBtn').style.display = gameState.isHost ? 'inline-block' : 'none';
        }
    });

    socket.on('kicked', () => {
        alert("방장에 의해 강퇴당했습니다.");
        gameState.roomCode = null;
        gameState.isHost = false;
        showMenu();
    });

    socket.on('gameStarted', ({ mode, grid, specials, golds }) => {
        gameState.mode = mode;
        gameState.grid = grid;
        gameState.specials = specials;
        gameState.golds = golds || [];
        gameState.stones = [];
        gameState.score = 0;
        gameState.isDead = false; 
        gameState.targetId = null;
        gameState.spectatingTargetId = null; 
        gameState.skillCount = 0; 
        gameState.isUsingSkill = false;
        
        hideAllScreens();
        document.getElementById('gameScreen').classList.remove('hidden');
        initGameUI();
    });

    socket.on('gridRegenerated', ({ grid, specials, golds }) => {
        if(gameState.isDead) return;

        showStatusMessage("판이 교체되었습니다! 🔄");
        gameState.grid = grid;
        gameState.specials = specials;
        gameState.golds = golds;
        gameState.stones = []; 
        
        renderMyGrid();
        broadcastMyState();
        resetHintTimer(); 
    });

    socket.on('monitorUpdate', ({ playerId, grid, specials, golds, stones, score }) => {
        const pIndex = gameState.players.findIndex(p => p.id === playerId);
        if(pIndex !== -1) {
            const p = gameState.players[pIndex];
            p.grid = grid;
            p.specials = specials;
            p.golds = golds;
            p.stones = stones;
            p.score = score;
            
            updateSinglePlayerPanel(p);

            if (gameState.isDead && playerId === gameState.spectatingTargetId) {
                renderSpectatorGrid(p);
            }
        }
    });

    socket.on('attacked', ({ type, attackerName }) => {
        if (gameState.isDead) return;
        showStatusMessage(`'${attackerName}'의 공격!`);
        applyAttackEffect(type);
    });
    
    socket.on('visualAttack', ({ from, to }) => {
        playAttackAnimation(from, to);
    });

    socket.on('playerEliminated', (playerId) => {
        if(playerId === gameState.myId) {
            gameState.isDead = true;
            gameState.isPlaying = true; 
            
            resetGameEffects(); 
            showStatusMessage("탈락했습니다... 관전 모드 진입 👻");
            
            document.querySelector('.grid-wrapper').style.opacity = '0.8';
            document.getElementById('skillBtn').style.display = 'none';

            spectateFirstSurvivor();
        } else {
            if (gameState.isDead && gameState.spectatingTargetId === playerId) {
                 spectateFirstSurvivor();
            }
        }
        
        const p = gameState.players.find(p => p.id === playerId);
        if(p) {
            p.isDead = true;
            updateSinglePlayerPanel(p);
        }
    });

    socket.on('timerUpdate', (time) => {
        gameState.time = time;
        updateTimerDisplay();
    });

    socket.on('gameEnded', ({ winner, scores }) => {
        gameState.isPlaying = false;
        resetGameEffects(); 
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
    let modeText = '<타임어택 모드>';
    if (mode === 'deathmatch') modeText = '<데스매치 모드>';
    else if (mode === 'fixedseed') modeText = '<시드 고정 (실력전)>';
    
    document.getElementById('waitingModeDisplay').textContent = modeText;
    document.getElementById('startGameBtn').style.display = gameState.isHost ? 'inline-block' : 'none';
}

function updateWaitingRoom(players) {
    const div = document.getElementById('waitingPlayers');
    div.innerHTML = players.map(p => {
        let kickBtn = '';
        if (gameState.isHost && p.id !== gameState.myId) {
            kickBtn = `<button class="btn-kick" onclick="kickPlayer('${p.id}')">강퇴</button>`;
        }
        return `<div style="padding:10px; border:1px solid #ccc; background:white; font-size:14px; display:flex; justify-content:center; align-items:center;">
            ${p.name} ${p.isHost ? '👑' : ''} ${kickBtn}
        </div>`;
    }).join('');
}

/* --- 게임 로직 --- */
function initGameUI() {
    playGameBGM(); 

    const gameSlider = document.getElementById('gameVolumeSlider');
    if(gameSlider) gameSlider.value = audio.volume;

    gameState.isPlaying = true;
    gameState.isSelecting = false;
    document.body.classList.remove('invisible-cursor');
    document.querySelector('.grid-wrapper').style.opacity = '1';
    
    let badgeText = 'TIME ATTACK';
    let isDeathmatch = false;

    if(gameState.mode === 'deathmatch') {
        badgeText = 'DEATH MATCH';
        isDeathmatch = true;
    } else if(gameState.mode === 'fixedseed') {
        badgeText = 'FIXED SEED';
    }
    
    const badgeEl = document.getElementById('gameModeBadge');
    badgeEl.textContent = badgeText;
    badgeEl.style.background = '#fff';
    badgeEl.style.color = '#d84315';

    document.getElementById('gameRoomCode').textContent = gameState.roomCode;
    document.getElementById('myScore').textContent = '0';
    updateSkillButton();
    
    // 타이머 UI 처리
    const timerEl = document.getElementById('timer');
    if (isDeathmatch) {
        timerEl.parentElement.style.display = 'none'; // 데스매치는 타이머 숨김
    } else {
        timerEl.parentElement.style.display = 'block';
        timerEl.textContent = "준비";
    }
    
    document.getElementById('leftSidebar').innerHTML = '';
    document.getElementById('rightSidebar').innerHTML = '';
    createPlayerPanelsInitial(); 

    renderMyGrid();
    broadcastMyState();
    resetHintTimer(); 
}

function updateTimerDisplay() {
    if (gameState.mode === 'deathmatch') return; // 데스매치 무시

    const m = Math.floor(gameState.time / 60);
    const s = gameState.time % 60;
    const timerEl = document.getElementById('timer');
    if(timerEl) {
        timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        
        if(gameState.time <= 10) timerEl.classList.add('urgent');
        else timerEl.classList.remove('urgent');
    }
}

/* --- 메인 그리드 렌더링 --- */

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

function renderSpectatorGrid(targetPlayer) {
    const container = document.getElementById('grid');
    
    const badgeEl = document.getElementById('gameModeBadge');
    badgeEl.textContent = `Spectating: ${targetPlayer.name}`;
    badgeEl.style.background = '#333';
    badgeEl.style.color = '#00ff00';

    document.getElementById('myScore').textContent = targetPlayer.score;

    container.innerHTML = '';
    const pGrid = targetPlayer.grid || [];

    pGrid.forEach((num, idx) => {
        const div = document.createElement('div');
        div.className = 'apple';
        div.textContent = num > 0 ? num : '';
        
        if (num === 0) div.classList.add('empty');
        else {
            if(targetPlayer.stones && targetPlayer.stones.includes(idx)) div.classList.add('stone');
            else if(targetPlayer.golds && targetPlayer.golds.includes(idx)) div.classList.add('gold');
            else if(targetPlayer.specials && targetPlayer.specials.includes(idx)) div.classList.add('special');
        }
        div.style.pointerEvents = 'none';
        container.appendChild(div);
    });

    container.onmousedown = null;
    container.onmousemove = null;
    document.onmouseup = null;
    container.ontouchstart = null;
    container.ontouchmove = null;
    document.ontouchend = null;
}

/* --- 입력 처리 (드래그) --- */
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
    if(!gameState.isPlaying || gameState.isDead) return; 
    
    const point = getPointFromEvent(e);
    
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
    if(!gameState.isSelecting || gameState.isUsingSkill || gameState.isDead) return;
    
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

/* --- 게임 룰 & 점수 --- */
function checkScore() {
    if(gameState.selectedCells.length === 0) return;
    
    const sum = gameState.selectedCells.reduce((acc, idx) => acc + gameState.grid[idx], 0);
    
    if(sum === 10) {
        resetHintTimer(); 
        playSFX();

        gameState.score += gameState.selectedCells.length;
        document.getElementById('myScore').textContent = gameState.score;
        
        let goldTriggered = false;

        gameState.selectedCells.forEach(idx => {
            if(gameState.specials.includes(idx)) {
                triggerAttack();
                playLocalPoisonAnimation(idx);
                gameState.specials = gameState.specials.filter(s => s !== idx);
            }
            
            if(gameState.golds.includes(idx)) {
                goldTriggered = true;
                gameState.golds = gameState.golds.filter(g => g !== idx);
            }
            
            gameState.grid[idx] = 0; 
        });
        
        if(goldTriggered) {
            gameState.skillCount++;
            updateSkillButton();
            showStatusMessage(`스킬 획득! (+1)`);
        }

        renderMyGrid();
        broadcastMyState();
        checkAndHandleDeadlock(); 
    }
}

function playLocalPoisonAnimation(gridIndex) {
    let targetId = gameState.targetId;
    
    if (!targetId) {
        const others = gameState.players.filter(p => p.id !== gameState.myId && !p.isDead);
        if (others.length > 0) {
            targetId = others[Math.floor(Math.random() * others.length)].id;
        }
    }
    
    if (!targetId) return;

    const targetEl = document.getElementById(`panel-${targetId}`);
    const appleEl = document.querySelector(`.apple[data-index="${gridIndex}"]`);
    
    if (!targetEl || !appleEl) return;

    const startRect = appleEl.getBoundingClientRect();
    const endRect = targetEl.getBoundingClientRect();

    const flying = document.createElement('div');
    flying.className = 'flying-apple';
    flying.style.backgroundImage = "url('poison.png')";
    flying.style.backgroundSize = "contain";
    flying.style.left = `${startRect.left}px`;
    flying.style.top = `${startRect.top}px`;
    flying.style.width = `${startRect.width}px`;
    flying.style.height = `${startRect.height}px`;
    
    document.body.appendChild(flying);
    flying.getBoundingClientRect();

    const endX = endRect.left + endRect.width/2 - startRect.width/2;
    const endY = endRect.top + endRect.height/2 - startRect.height/2;

    flying.style.transform = `translate(${endX - startRect.left}px, ${endY - startRect.top}px)`;
    
    setTimeout(() => { flying.remove(); }, 800);
}

function checkAndHandleDeadlock() {
    if (!hasValidMove()) {
        socket.emit('requestGridRegen', gameState.roomCode);
    }
}

function hasValidMove() {
    const cols = 15;
    const rows = 10;
    for(let r1=0; r1<rows; r1++) {
        for(let c1=0; c1<cols; c1++) {
            for(let r2=r1; r2<rows; r2++) {
                for(let c2=c1; c2<cols; c2++) {
                    let sum = 0;
                    let valid = true;
                    for(let r=r1; r<=r2; r++) {
                        for(let c=c1; c<=c2; c++) {
                            const idx = r * cols + c;
                            const val = gameState.grid[idx];
                            if(val === 0 || gameState.stones.includes(idx)) {
                                valid = false;
                                break;
                            }
                            sum += val;
                        }
                        if(!valid) break;
                    }
                    if(valid && sum === 10) return true; 
                }
            }
        }
    }
    return false; 
}

function resetHintTimer() {
    clearHintTimer();
    if(gameState.isPlaying && !gameState.isDead) {
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
    if(!gameState.isPlaying || gameState.isDead) return;
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

function updateSkillButton() {
    const btn = document.getElementById('skillBtn');
    if(gameState.isDead) {
        btn.style.display = 'none';
        return;
    }

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
    if(gameState.isDead) return;
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
    checkAndHandleDeadlock(); 
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

    if(gameState.isDead) {
        const target = gameState.players.find(p => p.id === id);
        if(target && !target.isDead) {
            gameState.spectatingTargetId = id;
            renderSpectatorGrid(target);
            showStatusMessage(`관전 중: ${target.name}`);
        }
    } else {
        gameState.targetId = id;
        updatePlayerPanels();
    }
}

function spectateFirstSurvivor() {
    const survivors = gameState.players.filter(p => p.id !== gameState.myId && !p.isDead);
    if(survivors.length > 0) {
        gameState.spectatingTargetId = survivors[0].id;
        renderSpectatorGrid(survivors[0]);
    } else {
        showStatusMessage("관전할 생존자가 없습니다.");
    }
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
        checkAndHandleDeadlock(); 
    } 
    else if(type === 2) { 
        showStatusMessage("돌 사과 발생!");
        const candidates = gameState.grid.map((v, i) => v > 0 ? i : -1).filter(i => i !== -1);
        candidates.sort(() => Math.random() - 0.5);
        
        const newStones = candidates.slice(0, 20);
        gameState.stones.push(...newStones);
        
        renderMyGrid();
        broadcastMyState();
        checkAndHandleDeadlock(); 
        
        setTimeout(() => {
            if(!gameState.isPlaying || gameState.isDead) return;
            gameState.stones = gameState.stones.filter(idx => !newStones.includes(idx));
            renderMyGrid();
            broadcastMyState(); 
        }, 10000);
    } 
    else if(type === 3) { 
        if(document.body.classList.contains('invisible-cursor')) return; 
        showStatusMessage("마우스가 사라졌습니다!");
        document.body.classList.add('invisible-cursor');
        
        gameState.cursorTimer = setTimeout(() => {
            document.body.classList.remove('invisible-cursor');
            gameState.cursorTimer = null;
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

/* --- 패널 렌더링 최적화 --- */
function createPlayerPanelsInitial() {
    const myId = gameState.myId;
    const others = gameState.players.filter(p => p.id !== myId);
    
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    
    const half = Math.ceil(others.length / 2);
    
    others.forEach((p, i) => {
        const panel = createPlayerPanelDOM(p);
        if(i < half) leftSidebar.appendChild(panel);
        else rightSidebar.appendChild(panel);
    });
}

function updatePlayerPanels() {
    const myId = gameState.myId;
    const others = gameState.players.filter(p => p.id !== myId);
    
    const currentPanelCount = document.querySelectorAll('.player-panel').length;
    if(currentPanelCount !== others.length) {
        document.getElementById('leftSidebar').innerHTML = '';
        document.getElementById('rightSidebar').innerHTML = '';
        createPlayerPanelsInitial();
    } else {
        others.forEach(p => updateSinglePlayerPanel(p));
    }
}

function createPlayerPanelDOM(p) {
    const el = document.createElement('div');
    el.className = 'player-panel';
    el.id = `panel-${p.id}`;
    el.onclick = () => { setTarget(p.id); };

    const infoDiv = document.createElement('div');
    infoDiv.className = 'player-info';
    infoDiv.innerHTML = `<span class="name"></span><span class="score"></span>`;
    
    const gridDiv = document.createElement('div');
    gridDiv.className = 'player-mini-grid';
    for(let i=0; i<150; i++) {
        const cell = document.createElement('div');
        cell.className = 'mini-apple empty';
        gridDiv.appendChild(cell);
    }

    el.appendChild(infoDiv);
    el.appendChild(gridDiv);
    
    updatePanelContent(el, p);
    
    return el;
}

function updateSinglePlayerPanel(p) {
    const el = document.getElementById(`panel-${p.id}`);
    if(!el) return;
    
    updatePanelContent(el, p);
}

function updatePanelContent(el, p) {
    if(p.isDead) el.classList.add('dead');
    else el.classList.remove('dead');
    
    if(p.id === gameState.targetId) el.classList.add('target');
    else el.classList.remove('target');

    const nameEl = el.querySelector('.name');
    const scoreEl = el.querySelector('.score');
    if(nameEl.textContent !== p.name) nameEl.textContent = p.name;
    if(scoreEl.textContent !== `${p.score}점`) scoreEl.textContent = `${p.score}점`;

    const gridDiv = el.querySelector('.player-mini-grid');
    const cells = gridDiv.children;
    const pGrid = p.grid || [];
    
    if(pGrid.length === 0) return;

    for(let i=0; i<150; i++) {
        const cell = cells[i];
        const val = pGrid[i];
        let newClass = 'mini-apple';
        
        if(val === 0) newClass += ' empty';
        else if(p.stones && p.stones.includes(i)) newClass += ' stone';
        else if(p.golds && p.golds.includes(i)) newClass += ' gold';
        else if(p.specials && p.specials.includes(i)) newClass += ' special';
        
        if(cell.className !== newClass) {
            cell.className = newClass;
        }
    }
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