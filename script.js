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

let isHintMode = false;
let currentMode = 'dig'; // 'dig' or 'flag'
let camera = { x: 0, y: 0, zoom: 45 }; 
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let cameraStart = { x: 0, y: 0 };
let cells = new Map(); 
let seed = Math.random();
let autoSolveInterval = null;
let touchStartPos = { x: 0, y: 0 };
let lastPinchDist = 0;

const MINE_PROBABILITY = 0.20;
const SAFE_RADIUS = 2;

// --- DPI Support ---
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    draw();
}
window.addEventListener('resize', setupCanvas);

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
    if (Math.abs(x) <= SAFE_RADIUS && Math.abs(y) <= SAFE_RADIUS) return false;
    return hash(x, y) < MINE_PROBABILITY;
}

function getCell(x, y) {
    let key = `${x},${y}`;
    if (cells.has(key)) return cells.get(key);
    return { state: 'hidden' };
}

function setCell(x, y, state) {
    let key = `${x},${y}`;
    cells.set(key, { state: state });
}

function saveGame(instant = false) {
    const doSave = () => {
        let state = {
            seed: seed,
            camera: camera,
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
    
    // Only check for neighbors if the board is NOT empty (allow starting clicks/initial reveals)
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
            reveal(gridX, gridY);
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
const colors = ['', '#2196F3', '#4CAF50', '#F44336', '#9C27B0', '#FF9800', '#00BCD4', '#000000', '#9E9E9E'];

function drawCell(x, y, screenX, screenY, size) {
    let cell = getCell(x, y);
    const padding = 1;
    const innerSize = size - padding * 2;
    const r = Math.max(2, size * 0.1); // Rounded corners

    if (cell.state === 'hidden') {
        // Shadow/Depth
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.roundRect(screenX + 2, screenY + 2, size - 2, size - 2, r); ctx.fill();

        // Main Cell Gradient
        let grad = ctx.createLinearGradient(screenX, screenY, screenX + size, screenY + size);
        grad.addColorStop(0, '#555');
        grad.addColorStop(1, '#333');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, innerSize, innerSize, r); ctx.fill();
        
        // Highlight Edge
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
    } else if (cell.state === 'revealed') {
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, innerSize, innerSize, r); ctx.fill();
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
        
        let count = getMineCount(x, y);
        if (count > 0) {
            ctx.fillStyle = colors[count] || '#fff';
            ctx.font = `bold ${size * 0.55}px 'Outfit', 'Inter', sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(count, screenX + size/2, screenY + size/2 + 1);
        }
    } else if (cell.state === 'flagged') {
        ctx.fillStyle = '#444';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, innerSize, innerSize, r); ctx.fill();
        
        // Modern Warning Triangle
        ctx.shadowBlur = 10; ctx.shadowColor = '#FF9800';
        ctx.fillStyle = '#FF9800';
        ctx.beginPath();
        ctx.moveTo(screenX + size/2, screenY + size * 0.25);
        ctx.lineTo(screenX + size * 0.2, screenY + size * 0.75);
        ctx.lineTo(screenX + size * 0.8, screenY + size * 0.75);
        ctx.closePath();
        ctx.fill();
        
        ctx.fillStyle = '#000';
        ctx.font = `bold ${size * 0.3}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillText('!', screenX + size/2, screenY + size * 0.68);
        ctx.shadowBlur = 0;
    } else if (cell.state === 'exploded') {
        ctx.fillStyle = '#F44336';
        ctx.beginPath(); ctx.roundRect(screenX + padding, screenY + padding, innerSize, innerSize, r); ctx.fill();
        
        // Bomb core
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(screenX + size/2, screenY + size/2, size * 0.25, 0, Math.PI * 2); ctx.fill();
        
        // Spikes
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        for(let i=0; i<8; i++) {
            let ang = i * Math.PI/4;
            ctx.beginPath();
            ctx.moveTo(screenX+size/2, screenY+size/2);
            ctx.lineTo(screenX+size/2 + Math.cos(ang)*size*0.35, screenY+size/2 + Math.sin(ang)*size*0.35);
            ctx.stroke();
        }
    }
}

function draw() {
    if (!canvas.width || !canvas.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (isNaN(camera.x) || isNaN(camera.y) || isNaN(camera.zoom) || camera.zoom <= 0) {
        camera = { x: w / 2, y: h / 2, zoom: 45 };
    }
    
    ctx.clearRect(0, 0, w, h);
    
    let startX = Math.floor((-camera.x) / camera.zoom), endX = Math.ceil((w - camera.x) / camera.zoom);
    let startY = Math.floor((-camera.y) / camera.zoom), endY = Math.ceil((h - camera.y) / camera.zoom);
    
    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            drawCell(x, y, Math.floor(camera.x + x * camera.zoom), Math.floor(camera.y + y * camera.zoom), Math.ceil(camera.zoom));
        }
    }
    
    // Chunk grid (Neon)
    ctx.strokeStyle = 'rgba(0, 201, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = startX; x <= endX; x++) if (x % 8 === 0) { let sx = Math.floor(camera.x + x * camera.zoom); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
    for (let y = startY; y <= endY; y++) if (y % 8 === 0) { let sy = Math.floor(camera.y + y * camera.zoom); ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
    ctx.stroke();
}

// --- UI ---
menuToggleBtn.addEventListener('click', () => uiContainer.classList.toggle('hidden'));
modeToggleBtn.addEventListener('click', () => {
    currentMode = currentMode === 'dig' ? 'flag' : 'dig';
    modeToggleBtn.innerText = currentMode === 'dig' ? 'Chế độ: ⛏️ Mở ô' : 'Chế độ: ⚠️ Đánh dấu';
    modeToggleBtn.classList.toggle('flag-mode', currentMode === 'flag');
});

resetBtn.addEventListener('click', () => {
    cells.clear(); seed = Math.random(); camera = { x: canvas.width / (2 * (window.devicePixelRatio||1)), y: canvas.height / (2 * (window.devicePixelRatio||1)), zoom: 45 };
    // Reveal a small cluster to start
    for(let i=0; i<5; i++) {
        let rx = Math.floor(Math.random() * 5) - 2;
        let ry = Math.floor(Math.random() * 5) - 2;
        reveal(rx, ry);
    }
    updateStats(); saveGame(true);
});

document.getElementById('hardResetBtn').addEventListener('click', () => {
    if (confirm("Xóa toàn bộ dữ liệu?")) { localStorage.clear(); location.reload(); }
});

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
                if (currentMode === 'flag') toggleFlag(gridX, gridY);
                else reveal(gridX, gridY);
            }
        }
    }
    lastPinchDist = 0;
});

// Start
setupCanvas();
if (!loadGame()) { 
    camera = { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 45 }; 
    // Initial reveals
    for(let i=0; i<5; i++) {
        let rx = Math.floor(Math.random() * 5) - 2;
        let ry = Math.floor(Math.random() * 5) - 2;
        reveal(rx, ry);
    }
    updateStats(); 
}
else draw();
