// 게임 상태
let socket;
let gameState = {
    roomCode: null,
    playerName: null,
    isHost: false,
    maxPlayers: 2,
    grid: [],
    score: 0,
    time: 180,
    isPlaying: false,
    players: [],
    
    // 드래그 선택
    isSelecting: false,
    selectionStart: null,
    selectionEnd: null,
    selectedCells: []
};

// 초기화
window.onload = function() {
    // Socket.IO 연결 (자동 도메인 감지)
    socket = io();
    
    setupSocketEvents();
};

// 화면 전환
function hideAllScreens() {
    document.getElementById('menuScreen').classList.add('hidden');
    document.getElementById('createRoomScreen').classList.add('hidden');
    document.getElementById('joinRoomScreen').classList.add('hidden');
    document.getElementById('waitingRoom').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
}

function showMenu() {
    hideAllScreens();
    document.getElementById('menuScreen').classList.remove('hidden');
}

function showCreateRoom() {
    hideAllScreens();
    document.getElementById('createRoomScreen').classList.remove('hidden');
}

function showJoinRoom() {
    hideAllScreens();
    document.getElementById('joinRoomScreen').classList.remove('hidden');
}

// 방 만들기
function createRoom() {
    const name = document.getElementById('hostName').value.trim();
    const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
    
    if (!name) {
        alert('이름을 입력하세요!');
        return;
    }
    
    gameState.playerName = name;
    gameState.maxPlayers = maxPlayers;
    gameState.isHost = true;
    
    socket.emit('createRoom', { name, maxPlayers });
}

// 방 참가
function joinRoom() {
    const name = document.getElementById('guestName').value.trim();
    const roomCode = document.getElementById('roomCodeInput').value.trim();
    
    if (!name) {
        alert('이름을 입력하세요!');
        return;
    }
    
    if (roomCode.length !== 4) {
        alert('4자리 방 코드를 입력하세요!');
        return;
    }
    
    gameState.playerName = name;
    socket.emit('joinRoom', { name, roomCode });
}

// 방 나가기
function leaveRoom() {
    socket.emit('leaveRoom', gameState.roomCode);
    showMenu();
}

function leaveGame() {
    socket.emit('leaveRoom', gameState.roomCode);
    gameState.isPlaying = false;
    showMenu();
}

// 게임 시작
function startGame() {
    socket.emit('startGame', gameState.roomCode);
}

// Socket 이벤트
function setupSocketEvents() {
    socket.on('roomCreated', ({ roomCode, maxPlayers }) => {
        gameState.roomCode = roomCode;
        gameState.maxPlayers = maxPlayers;
        hideAllScreens();
        document.getElementById('waitingRoom').classList.remove('hidden');
        document.getElementById('waitingCode').textContent = roomCode;
        document.getElementById('startGameBtn').style.display = 'block';
    });

    socket.on('roomJoined', ({ roomCode, maxPlayers }) => {
        gameState.roomCode = roomCode;
        gameState.maxPlayers = maxPlayers;
        hideAllScreens();
        document.getElementById('waitingRoom').classList.remove('hidden');
        document.getElementById('waitingCode').textContent = roomCode;
        document.getElementById('startGameBtn').style.display = 'none';
    });

    socket.on('playersUpdate', (players) => {
        gameState.players = players;
        updateWaitingRoom(players);
    });

    socket.on('gameStarted', ({ grid, players }) => {
        gameState.players = players;
        gameState.grid = grid;
        hideAllScreens();
        document.getElementById('gameScreen').classList.remove('hidden');
        initGame();
    });

    socket.on('gridUpdate', ({ grid, playerId, score }) => {
        gameState.grid = grid;
        
        // 다른 플레이어 점수 업데이트 (항상 반영)
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            player.score = score;
            updatePlayerPanels();
        }
        
        // 내 화면 그리드 업데이트
        // 중요: 내가 드래그 중일 때(isSelecting)는 그리드를 갱신하지 않음 (드래그 끊김 방지)
        if (playerId !== socket.id) {
            if (!gameState.isSelecting) {
                renderGrid();
            } else {
                // 선택 중일 때는 업데이트를 시각적으로 미룸 (UX 최적화)
                // console.log('드래그 중이라 그리드 갱신 보류');
            }
        }
    });

    socket.on('roomNotFound', () => {
        alert('방을 찾을 수 없습니다!');
    });

    socket.on('roomFull', () => {
        alert('방이 가득 찼습니다!');
    });

    socket.on('gameEnded', ({ winner, scores }) => {
        gameState.isPlaying = false;
        
        let message = '게임 종료!\n\n순위:\n';
        scores.forEach((s, i) => {
            message += `${i + 1}위: ${s.name} - ${s.score}점\n`;
        });
        
        alert(message);
        showMenu();
    });
}

// 대기실 업데이트
function updateWaitingRoom(players) {
    const container = document.getElementById('waitingPlayers');
    container.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'waiting-player';
        div.textContent = `${player.name} ${player.isHost ? '(방장)' : ''}`;
        container.appendChild(div);
    });
    
    // 빈 슬롯 표시
    const emptySlots = gameState.maxPlayers - players.length;
    for (let i = 0; i < emptySlots; i++) {
        const div = document.createElement('div');
        div.className = 'waiting-player';
        div.style.color = '#999';
        div.textContent = '대기 중...';
        container.appendChild(div);
    }
}

// 게임 초기화
function initGame() {
    gameState.score = 0;
    gameState.time = 180;
    gameState.isPlaying = true;
    gameState.isSelecting = false; // 선택 상태 초기화
    
    document.getElementById('myScore').textContent = '0';
    document.getElementById('gameRoomCode').textContent = gameState.roomCode;
    document.getElementById('playerCount').textContent = 
        `${gameState.players.length}/${gameState.maxPlayers}`;
    
    renderGrid();
    updatePlayerPanels();
    startTimer();
}

// 그리드 렌더링 (모바일 터치 지원 추가)
function renderGrid() {
    const gridContainer = document.getElementById('grid');
    gridContainer.innerHTML = '';
    
    gameState.grid.forEach((number, index) => {
        const apple = document.createElement('div');
        apple.className = number === 0 ? 'apple empty' : 'apple';
        apple.dataset.index = index;
        
        if (number !== 0) {
            apple.textContent = number;
            apple.dataset.number = number;
        }
        
        gridContainer.appendChild(apple);
    });
    
    // 마우스 이벤트
    gridContainer.addEventListener('mousedown', onMouseDown);
    gridContainer.addEventListener('mousemove', onMouseMove);
    gridContainer.addEventListener('mouseup', onMouseUp);

    // [추가] 모바일 터치 이벤트 지원
    gridContainer.addEventListener('touchstart', (e) => {
        e.preventDefault(); // 스크롤 방지
        if (e.touches.length > 1) return; // 멀티터치 방지
        const touch = e.touches[0];
        
        // 마우스 다운 이벤트 흉내내기
        onMouseDown({
            target: e.target, // 실제 터치된 요소
            currentTarget: gridContainer,
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: () => {}
        });
    }, { passive: false });

    gridContainer.addEventListener('touchmove', (e) => {
        e.preventDefault(); // 스크롤 방지
        if (!gameState.isSelecting) return;
        const touch = e.touches[0];
        
        // 마우스 무브 이벤트 흉내내기
        onMouseMove({
            currentTarget: gridContainer,
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: () => {}
        });
    }, { passive: false });

    gridContainer.addEventListener('touchend', (e) => {
        e.preventDefault();
        // 마우스 업 이벤트 흉내내기
        onMouseUp();
    });
}

// 드래그 시작
function onMouseDown(e) {
    if (!gameState.isPlaying) return;
    // 터치 시 e.target이 정확하지 않을 수 있으므로 안전장치
    if (e.target.classList.contains('empty') || !e.target.classList.contains('apple')) return;
    
    gameState.isSelecting = true;
    const rect = e.currentTarget.getBoundingClientRect();
    gameState.selectionStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    gameState.selectionEnd = { ...gameState.selectionStart };
    
    updateSelection();
}

// 드래그 중
function onMouseMove(e) {
    if (!gameState.isSelecting) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    gameState.selectionEnd = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    updateSelection();
}

// 드래그 종료
function onMouseUp(e) {
    if (!gameState.isSelecting) return;
    
    gameState.isSelecting = false;
    checkSelection();
    clearSelection();
    
    // 드래그가 끝나면 혹시 밀려있던 그리드 업데이트를 위해 
    // 서버 그리드 상태와 동기화 (선택적)
    // renderGrid(); 
}

// 선택 영역 업데이트
function updateSelection() {
    // 기존 선택 제거
    document.querySelectorAll('.apple').forEach(apple => {
        apple.classList.remove('selecting');
    });
    
    gameState.selectedCells = [];
    
    const gridContainer = document.getElementById('grid');
    const gridRect = gridContainer.getBoundingClientRect();
    
    // 선택 영역 계산
    const left = Math.min(gameState.selectionStart.x, gameState.selectionEnd.x);
    const right = Math.max(gameState.selectionStart.x, gameState.selectionEnd.x);
    const top = Math.min(gameState.selectionStart.y, gameState.selectionEnd.y);
    const bottom = Math.max(gameState.selectionStart.y, gameState.selectionEnd.y);
    
    // 각 사과 체크
    const apples = document.querySelectorAll('.apple:not(.empty)');
    apples.forEach(apple => {
        const rect = apple.getBoundingClientRect();
        const relX = rect.left - gridRect.left + rect.width / 2;
        const relY = rect.top - gridRect.top + rect.height / 2;
        
        if (relX >= left && relX <= right && relY >= top && relY <= bottom) {
            apple.classList.add('selecting');
            gameState.selectedCells.push(parseInt(apple.dataset.index));
        }
    });
}

// 선택 확인
function checkSelection() {
    if (gameState.selectedCells.length === 0) return;
    
    let sum = 0;
    gameState.selectedCells.forEach(index => {
        sum += gameState.grid[index];
    });
    
    if (sum === 10) {
        // 성공!
        gameState.score += 100; // 점수 계산 방식
        document.getElementById('myScore').textContent = gameState.score;
        
        // 선택된 사과 제거 (0으로 설정)
        const newGrid = [...gameState.grid];
        gameState.selectedCells.forEach(index => {
            newGrid[index] = 0;
        });
        gameState.grid = newGrid;
        
        // 서버에 업데이트 전송
        socket.emit('gridUpdate', {
            roomCode: gameState.roomCode,
            grid: newGrid,
            score: gameState.score
        });
        
        renderGrid();
    }
}

// 선택 초기화
function clearSelection() {
    document.querySelectorAll('.apple').forEach(apple => {
        apple.classList.remove('selecting');
    });
    gameState.selectedCells = [];
}

// 플레이어 패널 업데이트
function updatePlayerPanels() {
    const myIndex = gameState.players.findIndex(p => p.id === socket.id);
    const otherPlayers = gameState.players.filter((p, i) => i !== myIndex);
    
    // 좌우 분배
    const leftCount = Math.ceil(otherPlayers.length / 2);
    const leftPlayers = otherPlayers.slice(0, leftCount);
    const rightPlayers = otherPlayers.slice(leftCount);
    
    // 왼쪽 사이드바
    const leftSidebar = document.getElementById('leftSidebar');
    leftSidebar.innerHTML = '';
    leftPlayers.forEach(player => {
        leftSidebar.appendChild(createPlayerPanel(player));
    });
    
    // 오른쪽 사이드바
    const rightSidebar = document.getElementById('rightSidebar');
    rightSidebar.innerHTML = '';
    rightPlayers.forEach(player => {
        rightSidebar.appendChild(createPlayerPanel(player));
    });
}

// 플레이어 패널 생성
function createPlayerPanel(player) {
    const panel = document.createElement('div');
    panel.className = 'player-panel';
    
    const info = document.createElement('div');
    info.className = 'player-info';
    
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;
    
    const score = document.createElement('div');
    score.className = 'player-score';
    score.textContent = `${player.score || 0}점`;
    
    info.appendChild(name);
    info.appendChild(score);
    panel.appendChild(info);
    
    // 미니 그리드 (간략화)
    const miniGrid = document.createElement('div');
    miniGrid.className = 'player-mini-grid';
    
    // 간략화된 그리드 표시
    for (let i = 0; i < 50; i++) {
        const miniApple = document.createElement('div');
        miniApple.className = 'mini-apple';
        
        const gridIndex = Math.floor(i * 3);
        if (gameState.grid[gridIndex] === 0) {
            miniApple.classList.add('empty');
        }
        
        miniGrid.appendChild(miniApple);
    }
    
    panel.appendChild(miniGrid);
    
    return panel;
}

// 타이머
function startTimer() {
    const timerInterval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(timerInterval);
            return;
        }
        
        gameState.time--;
        const minutes = Math.floor(gameState.time / 60);
        const seconds = gameState.time % 60;
        document.getElementById('timer').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (gameState.time <= 0) {
            clearInterval(timerInterval);
            gameState.isPlaying = false;
        }
    }, 1000);
}