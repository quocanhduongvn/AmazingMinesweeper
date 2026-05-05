const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Debugging ---
window.onerror = function(msg, url, lineNo, columnNo, error) {
    alert("Script Error: " + msg + "\nLine: " + lineNo);
    return false;
};

const hintModeBtn = document.getElementById('hintModeBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');
const menuToggleBtn = document.getElementById('menuToggleBtn');
const uiContainer = document.getElementById('ui');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const difficultySelect = document.getElementById('difficultySelect');
const sizeSelect = document.getElementById('sizeSelect');

let isHintMode = false;
let currentMode = 'dig'; // 'dig' or 'flag'
let camera = { x: 0, y: 0, zoom: 45 }; 
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let cameraStart = { x: 0, y: 0 };
let cells = new Map(); 
let seed = Math.random();
let touchStartPos = { x: 0, y: 0 };
let lastPinchDist = 0;

let MINE_PROBABILITY = 0.20;
let BOARD_SIZE = 0; // 0 = Infinite, >0 = NxN
const SAFE_RADIUS = 2;

// --- DPI Support ---
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    draw();
}
window.addEventListener('resize', setupCanvas);
window.addEventListener('load', () => setTimeout(setupCanvas, 100));

// --- Game Logic ---
function hash(x, y) {
    let str = `${x},${y},${seed}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return (h >>> 0) / 4294967296;
}

function isMine(x, y) {
    // Bounds check for fixed size
    if (BOARD_SIZE > 0) {
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return false;
    }
    if (Math.abs(x) <= SAFE_RADIUS && Math.abs(y) <= SAFE_RADIUS) return false;
    return hash(x, y) < MINE_PROBABILITY;
}

function getCell(x, y) {
    if (BOARD_SIZE > 0) {
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return { state: 'void' };
    }
    let key = `${x},${y}`;
    if (cells.has(key)) return cells.get(key);
    return { state: 'hidden' };
}

function setCell(x, y, state) {
    if (BOARD_SIZE > 0) {
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return;
    }
    let key = `${x},${y}`;
    cells.set(key, { state: state });
}

function saveGame(instant = false) {
    const doSave = () => {
        let state = {
            seed: seed,
            camera: camera,
            difficulty: MINE_PROBABILITY,
            boardSize: BOARD_SIZE,
            cells: Array.from(cells.entries())
        };
        localStorage.setItem('infiniteMinesweeper', JSON.stringify(state));
    };
    if (instant) doSave();
    else setTimeout(doSave, 500);
}

function loadGame() {
    let saved = localStorage.getItem('infiniteMinesweeper');
    if (saved) {
        try {
            let state = JSON.parse(saved);
            seed = state.seed;
            camera = state.camera || { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 45 };
            MINE_PROBABILITY = state.difficulty || 0.20;
            BOARD_SIZE = state.boardSize || 0;
            if (difficultySelect) difficultySelect.value = MINE_PROBABILITY.toString();
            if (sizeSelect) sizeSelect.value = BOARD_SIZE.toString();
            cells = new Map(state.cells);
            updateStats();
            return true;
        } catch(e) {
            return false;
        }
    }
    return false;
}

let highScore = localStorage.getItem('minesweeperHighScore') || 0;

function updateStats() {
    let revealed = 0, correctFlags = 0, exploded = 0;
    for (let [key, cell] of cells.entries()) {
        if (cell.state === 'revealed') revealed++;
        else if (cell.state === 'exploded') exploded++;
        else if (cell.state === 'flagged') {
            let [x, y] = key.split(',').map(Number);
            if (isMine(x, y)) correctFlags++;
        }
    }
    let score = Math.max(0, revealed + correctFlags * 2 - exploded * 10);
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('minesweeperHighScore', highScore);
    }
    if (document.getElementById('revealedVal')) document.getElementById('revealedVal').innerText = revealed;
    if (document.getElementById('flagsVal')) document.getElementById('flagsVal').innerText = correctFlags;
    if (document.getElementById('explodedVal')) document.getElementById('explodedVal').innerText = exploded;
    if (document.getElementById('scoreVal')) document.getElementById('scoreVal').innerText = score;
    if (document.getElementById('highScoreVal')) document.getElementById('highScoreVal').innerText = highScore;
}

function getMineCount(x, y) {
    let count = 0;
    for(let dx=-1; dx<=1; dx++) {
        for(let dy=-1; dy<=1; dy++) {
            if(dx===0 && dy===0) continue;
            if(isMine(x+dx, y+dy)) count++;
        }
    }
    return count;
}

function hasRevealedNeighbor(x, y) {
    if (cells.size === 0) return true;
    for(let dx=-1; dx<=1; dx++) {
        for(let dy=-1; dy<=1; dy++) {
            if(dx===0 && dy===0) continue;
            let nKey = `${x+dx},${y+dy}`;
            if(cells.has(nKey) && cells.get(nKey).state === 'revealed') return true;
        }
    }
    return false;
}

function reveal(startX, startY) {
    let cell = getCell(startX, startY);
    if (cell.state !== 'hidden') return;
    if (cells.size > 0 && !hasRevealedNeighbor(startX, startY)) return;
    
    if (isMine(startX, startY)) {
        setCell(startX, startY, 'exploded');
        draw(); updateStats(); saveGame();
        return;
    }

    let queue = [{x: startX, y: startY}];
    let visited = new Set();
    visited.add(`${startX},${startY}`);
    while(queue.length > 0) {
        let {x, y} = queue.shift();
        if (getCell(x, y).state !== 'hidden') continue;
        setCell(x, y, 'revealed');
        if (getMineCount(x, y) === 0) {
            for(let dx=-1; dx<=1; dx++) {
                for(let dy=-1; dy<=1; dy++) {
                    let nx = x+dx, ny = y+dy;
                    if (BOARD_SIZE > 0) {
                        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
                    }
                    if (!visited.has(`${nx},${ny}`)) {
                        visited.add(`${nx},${ny}`);
                        queue.push({x: nx, y: ny});
                    }
                }
            }
        }
    }
    draw(); updateStats(); saveGame();
}

function toggleFlag(x, y) {
    let cell = getCell(x, y);
    if (cell.state === 'hidden' && hasRevealedNeighbor(x, y)) setCell(x, y, 'flagged');
    else if (cell.state === 'flagged') cells.delete(`${x},${y}`);
    draw(); updateStats(); saveGame();
}

// --- Interaction ---
canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    cameraStart = { x: camera.x, y: camera.y };
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
        camera.x = cameraStart.x + (e.clientX - dragStart.x);
        camera.y = cameraStart.y + (e.clientY - dragStart.y);
        draw();
    }
});

canvas.addEventListener('mouseup', (e) => {
    isDragging = false;
    let dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    if (dist < 5) {
        let rect = canvas.getBoundingClientRect();
        let gridX = Math.floor((e.clientX - rect.left - camera.x) / camera.zoom);
        let gridY = Math.floor((e.clientY - rect.top - camera.y) / camera.zoom);
        if (e.button === 0) {
            if (isHintMode) { explainHint(gridX, gridY); isHintMode = false; updateHintUI(); }
            else reveal(gridX, gridY);
        } else if (e.button === 2) toggleFlag(gridX, gridY);
    }
    saveGame();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
    let rect = canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
    let gridX = (mouseX - camera.x) / camera.zoom, gridY = (mouseY - camera.y) / camera.zoom;
    camera.zoom *= (e.deltaY > 0 ? 0.9 : 1.1);
    camera.zoom = Math.max(15, Math.min(camera.zoom, 100));
    camera.x = mouseX - gridX * camera.zoom;
    camera.y = mouseY - gridY * camera.zoom;
    draw();
});

// --- Rendering ---
const colors = ['', '#64B5F6', '#81C784', '#E57373', '#BA68C8', '#FFB74D', '#4DD0E1', '#FFF', '#FFF'];

function drawCell(x, y, screenX, screenY, size) {
    let cell = getCell(x, y);
    if (cell.state === 'void') return; // Don't draw out of bounds

    const padding = 2;
    const drawSize = size - padding * 2;
    const r = 3;

    if (cell.state === 'hidden') {
        ctx.fillStyle = '#1e1e1e';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, drawSize, drawSize, r); ctx.fill();
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
    } else if (cell.state === 'revealed') {
        ctx.fillStyle = '#2c2c2c';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, drawSize, drawSize, r); ctx.fill();
        ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1; ctx.stroke();
        let count = getMineCount(x, y);
        if (count > 0) {
            ctx.fillStyle = colors[count] || '#fff';
            ctx.font = `700 ${size * 0.6}px 'Orbitron', sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(count, screenX + size/2, screenY + size/2 + 1);
        }
    } else if (cell.state === 'flagged') {
        ctx.fillStyle = '#1e1e1e';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, drawSize, drawSize, r); ctx.fill();
        const cx = screenX + size/2, cy = screenY + size/2;
        ctx.shadowBlur = 5; ctx.shadowColor = 'rgba(211, 47, 47, 0.5)';
        ctx.fillStyle = '#FF5252';
        ctx.beginPath();
        ctx.moveTo(cx - size*0.12, cy + size*0.3); ctx.lineTo(cx - size*0.12, cy - size*0.35);
        ctx.quadraticCurveTo(cx + size*0.1, cy - size*0.45, cx + size*0.35, cy - size*0.2);
        ctx.lineTo(cx + size*0.35, cy + size*0.05);
        ctx.quadraticCurveTo(cx + size*0.1, cy - size*0.15, cx - size*0.12, cy + size*0.1);
        ctx.fill();
        ctx.strokeStyle = '#D32F2F'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx-size*0.12, cy+size*0.35); ctx.lineTo(cx-size*0.12, cy-size*0.35); ctx.stroke();
        ctx.shadowBlur = 0;
    } else if (cell.state === 'exploded') {
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, drawSize, drawSize, r); ctx.fill();
        const cx = screenX + size/2, cy = screenY + size/2;
        ctx.shadowBlur = 15; ctx.shadowColor = '#f44336';
        let bombGrad = ctx.createRadialGradient(cx-size*0.1, cy-size*0.1, 2, cx, cy, size*0.3);
        bombGrad.addColorStop(0, '#555'); bombGrad.addColorStop(1, '#000');
        ctx.fillStyle = bombGrad; ctx.beginPath(); ctx.arc(cx, cy, size*0.28, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#f44336'; ctx.lineWidth = 2;
        for(let i=0; i<8; i++) {
            let ang = i * Math.PI/4;
            ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang)*size*0.2, cy + Math.sin(ang)*size*0.2);
            ctx.lineTo(cx + Math.cos(ang)*size*0.4, cy + Math.sin(ang)*size*0.4); ctx.stroke();
        }
        ctx.fillStyle = '#FFEB3B'; ctx.beginPath(); ctx.arc(cx+size*0.15, cy-size*0.15, 2, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
    }
}

function draw() {
    if (!canvas.width || !canvas.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    if (isNaN(camera.x) || isNaN(camera.y) || isNaN(camera.zoom) || camera.zoom <= 0) {
        camera = { x: w / 2, y: h / 2, zoom: 45 };
    }
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    
    let startX = Math.floor((-camera.x) / camera.zoom), endX = Math.ceil((w - camera.x) / camera.zoom);
    let startY = Math.floor((-camera.y) / camera.zoom), endY = Math.ceil((h - camera.y) / camera.zoom);
    
    // Clamp drawing area for fixed size
    if (BOARD_SIZE > 0) {
        startX = Math.max(0, startX); endX = Math.min(BOARD_SIZE - 1, endX);
        startY = Math.max(0, startY); endY = Math.min(BOARD_SIZE - 1, endY);
        
        // Draw board boundary
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2;
        ctx.strokeRect(camera.x, camera.y, BOARD_SIZE * camera.zoom, BOARD_SIZE * camera.zoom);
    }
    
    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            drawCell(x, y, Math.floor(camera.x + x * camera.zoom), Math.floor(camera.y + y * camera.zoom), Math.ceil(camera.zoom));
        }
    }
}

// --- UI ---
menuToggleBtn.addEventListener('click', () => uiContainer.classList.toggle('hidden'));
modeToggleBtn.addEventListener('click', () => {
    currentMode = currentMode === 'dig' ? 'flag' : 'dig';
    modeToggleBtn.innerText = currentMode === 'dig' ? '⛏️ Mở ô' : '🚩 Cắm cờ';
    modeToggleBtn.classList.toggle('flag-mode', currentMode === 'flag');
});

function updateHintUI() {
    hintModeBtn.innerText = isHintMode ? '💡 Đang gợi ý' : '💡 Gợi ý';
    hintModeBtn.classList.toggle('hint-active', isHintMode);
    statusDiv.innerText = isHintMode ? 'Trạng thái: Chọn ô để AI phân tích' : 'Trạng thái: Đang chơi';
}

hintModeBtn.addEventListener('click', () => {
    isHintMode = !isHintMode;
    updateHintUI();
});

resetBtn.addEventListener('click', () => {
    MINE_PROBABILITY = parseFloat(difficultySelect.value);
    BOARD_SIZE = parseInt(sizeSelect.value);
    cells.clear(); seed = Math.random(); 
    
    if (BOARD_SIZE > 0) camera = { x: (canvas.width/dpr - BOARD_SIZE*45)/2, y: (canvas.height/dpr - BOARD_SIZE*45)/2, zoom: 45 };
    else camera = { x: canvas.width / (2 * (window.devicePixelRatio||1)), y: canvas.height / (2 * (window.devicePixelRatio||1)), zoom: 45 };
    
    let startX = BOARD_SIZE > 0 ? Math.floor(BOARD_SIZE/2) : 0;
    let startY = BOARD_SIZE > 0 ? Math.floor(BOARD_SIZE/2) : 0;
    
    for(let i=0; i<5; i++) reveal(startX + Math.floor(Math.random()*5)-2, startY + Math.floor(Math.random()*5)-2);
    updateStats(); saveGame(true);
});

// --- Smart Hint Logic ---
function explainHint(x, y) {
    let cell = getCell(x, y);
    if (cell.state === 'void') return;
    if (cell.state === 'revealed') {
        let count = getMineCount(x, y);
        let hidden = [], flagged = 0;
        for(let dx=-1; dx<=1; dx++) {
            for(let dy=-1; dy<=1; dy++) {
                if(dx===0 && dy===0) continue;
                let nc = getCell(x+dx, y+dy);
                if (nc.state === 'hidden') hidden.push({x: x+dx, y: y+dy});
                else if (nc.state === 'flagged') flagged++;
            }
        }
        if (count === flagged) alert(`Ô số ${count} đã đủ mìn. Ô trống còn lại an toàn!`);
        else if (count === flagged + hidden.length) alert(`Ô số ${count} thiếu ${count-flagged} mìn, chỉ còn ${hidden.length} ô. Tất cả là mìn!`);
        else alert(`Ô số ${count}: Hiện có ${flagged} cờ và ${hidden.length} ô chưa mở.`);
        return;
    }
    if (cell.state === 'hidden' || cell.state === 'flagged') {
        for(let dx=-1; dx<=1; dx++) {
            for(let dy=-1; dy<=1; dy++) {
                if(dx===0 && dy===0) continue;
                let nx = x+dx, ny = y+dy;
                let nc = getCell(nx, ny);
                if (nc.state === 'revealed') {
                    let nCount = getMineCount(nx, ny), nHidden = [], nFlagged = 0;
                    for(let ddx=-1; ddx<=1; ddx++) {
                        for(let ddy=-1; ddy<=1; ddy++) {
                            if(ddx===0 && ddy===0) continue;
                            let nnc = getCell(nx+ddx, ny+ddy);
                            if (nnc.state === 'hidden') nHidden.push({x: nx+ddx, y: ny+ddy});
                            else if (nnc.state === 'flagged') nFlagged++;
                        }
                    }
                    if (nCount === nFlagged) { alert(`Dựa vào ô số ${nCount}, ô này AN TOÀN!`); return; }
                    if (nCount === nFlagged + nHidden.length) { alert(`Dựa vào ô số ${nCount}, ô này là MÌN!`); return; }
                }
            }
        }
        alert("Chưa đủ dữ liệu logic.");
    }
}

// --- Touch ---
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        isDragging = true;
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        cameraStart = { x: camera.x, y: camera.y };
        if (window.innerWidth <= 600) uiContainer.classList.add('hidden');
    } else if (e.touches.length === 2) {
        isDragging = false;
        lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
        let dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastPinchDist > 0) {
            let delta = dist / lastPinchDist;
            if (delta > 1.05) delta = 1.05; if (delta < 0.95) delta = 0.95;
            let rect = canvas.getBoundingClientRect();
            let mouseX = (e.touches[0].clientX + e.touches[1].clientX)/2 - rect.left;
            let mouseY = (e.touches[0].clientY + e.touches[1].clientY)/2 - rect.top;
            let gridX = (mouseX - camera.x) / camera.zoom, gridY = (mouseY - camera.y) / camera.zoom;
            camera.zoom = Math.max(15, Math.min(camera.zoom * delta, 100));
            camera.x = mouseX - gridX * camera.zoom; camera.y = mouseY - gridY * camera.zoom;
            draw();
        }
        lastPinchDist = dist;
    } else if (isDragging && e.touches.length === 1) {
        camera.x = cameraStart.x + (e.touches[0].clientX - dragStart.x);
        camera.y = cameraStart.y + (e.touches[0].clientY - dragStart.y);
        draw();
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (isDragging) {
        isDragging = false;
        if (e.changedTouches.length === 1) {
            let dist = Math.hypot(e.changedTouches[0].clientX - dragStart.x, e.changedTouches[0].clientY - dragStart.y);
            if (dist < 15) {
                let rect = canvas.getBoundingClientRect();
                let gridX = Math.floor((e.changedTouches[0].clientX - rect.left - camera.x) / camera.zoom);
                let gridY = Math.floor((e.changedTouches[0].clientY - rect.top - camera.y) / camera.zoom);
                if (isHintMode) { explainHint(gridX, gridY); isHintMode = false; updateHintUI(); }
                else if (currentMode === 'flag') toggleFlag(gridX, gridY);
                else reveal(gridX, gridY);
            }
        }
    }
    lastPinchDist = 0;
});

const dpr = window.devicePixelRatio || 1;
setupCanvas();
if (!loadGame()) { 
    camera = { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 45 }; 
    for(let i=0; i<5; i++) reveal(Math.floor(Math.random()*5)-2, Math.floor(Math.random()*5)-2); updateStats(); 
}
else draw();
