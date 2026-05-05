const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hintModeBtn = document.getElementById('hintModeBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');

let isHintMode = false;

let camera = { x: 0, y: 0, zoom: 40 }; // zoom is tile size
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let cameraStart = { x: 0, y: 0 };

let cells = new Map(); 
let seed = Math.random();
let autoSolveInterval = null;

const MINE_PROBABILITY = 0.20;
const SAFE_RADIUS = 2; // Radius around 0,0 that is guaranteed safe

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}
window.addEventListener('resize', resizeCanvas);

// --- Game Logic ---

function hash(x, y) {
    let str = `${x},${y},${seed}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    // Convert to positive float
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

// --- Save/Load Logic ---
let saveTimeout = null;
function saveGame(instant = false) {
    const doSave = () => {
        let state = {
            seed: seed,
            camera: camera,
            cells: Array.from(cells.entries())
        };
        localStorage.setItem('infiniteMinesweeper', JSON.stringify(state));
    };

    if (instant) {
        if (saveTimeout) clearTimeout(saveTimeout);
        doSave();
    } else {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(doSave, 500); // Debounce 500ms
    }
}

function loadGame() {
    let saved = localStorage.getItem('infiniteMinesweeper');
    if (saved) {
        try {
            let state = JSON.parse(saved);
            seed = state.seed;
            camera = state.camera || { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 40 };
            cells = new Map(state.cells);
            updateStats();
            return true;
        } catch(e) {
            console.error('Lỗi tải game:', e);
            return false;
        }
    }
    return false;
}

let highScore = localStorage.getItem('minesweeperHighScore') || 0;

function updateStats() {
    let revealed = 0;
    let correctFlags = 0;
    let exploded = 0;

    for (let [key, cell] of cells.entries()) {
        if (cell.state === 'revealed') revealed++;
        else if (cell.state === 'exploded') exploded++;
        else if (cell.state === 'flagged') {
            let [x, y] = key.split(',').map(Number);
            if (isMine(x, y)) {
                correctFlags++;
            }
        }
    }

    let score = revealed + correctFlags * 2 - exploded * 10;
    if (score < 0) score = 0;

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('minesweeperHighScore', highScore);
    }

    let rVal = document.getElementById('revealedVal');
    if (rVal) rVal.innerText = revealed;
    
    let fVal = document.getElementById('flagsVal');
    if (fVal) fVal.innerText = correctFlags;

    let eVal = document.getElementById('explodedVal');
    if (eVal) eVal.innerText = exploded;

    let sVal = document.getElementById('scoreVal');
    if (sVal) sVal.innerText = score;

    let hsVal = document.getElementById('highScoreVal');
    if (hsVal) hsVal.innerText = highScore;
}

window.addEventListener('beforeunload', () => saveGame(true));
// -----------------------

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
    let anyRevealed = false;
    for (let val of cells.values()) {
        if (val.state === 'revealed') {
            anyRevealed = true;
            break;
        }
    }
    if (!anyRevealed) return true; // Allow first click on empty board

    for(let dx=-1; dx<=1; dx++) {
        for(let dy=-1; dy<=1; dy++) {
            if(dx===0 && dy===0) continue;
            let nx = x+dx, ny = y+dy;
            let key = `${nx},${ny}`;
            if(cells.has(key) && cells.get(key).state === 'revealed') return true;
        }
    }
    return false;
}

function reveal(startX, startY) {
    let cell = getCell(startX, startY);
    if (cell.state !== 'hidden') return;
    
    if (!hasRevealedNeighbor(startX, startY)) {
        statusDiv.innerText = 'Cảnh báo: Chỉ được mở ô nằm sát khu vực đã mở!';
        statusDiv.style.color = '#FF9800';
        setTimeout(() => {
            if (!statusDiv.innerText.includes('THUA') && !statusDiv.innerText.includes('MÌN')) {
                statusDiv.innerText = 'Trạng thái: Đang chơi';
                statusDiv.style.color = '#4CAF50';
            }
        }, 2000);
        return;
    }
    
    if (isMine(startX, startY)) {
        setCell(startX, startY, 'exploded');
        statusDiv.innerText = 'Cảnh báo: ĐẠP TRÚNG MÌN 💥';
        statusDiv.style.color = '#F44336';
        if (autoSolveInterval) {
            clearInterval(autoSolveInterval);
            autoSolveInterval = null;
            solveAllBtn.innerText = 'Tự động giải đố';
            solveAllBtn.style.background = '#1a4b8c';
        }
        draw();
        updateStats();
        saveGame();
        
        setTimeout(() => {
            if (statusDiv.innerText.includes('MÌN')) {
                statusDiv.innerText = 'Trạng thái: Đang chơi tiếp...';
                statusDiv.style.color = '#FF9800';
            }
        }, 3000);
        return;
    }

    let queue = [{x: startX, y: startY}];
    let visited = new Set();
    visited.add(`${startX},${startY}`);
    
    while(queue.length > 0) {
        let curr = queue.shift();
        let x = curr.x;
        let y = curr.y;
        
        let currCell = getCell(x, y);
        if (currCell.state !== 'hidden') continue;
        
        setCell(x, y, 'revealed');
        let count = getMineCount(x, y);
        
        if (count === 0) {
            for(let dx=-1; dx<=1; dx++) {
                for(let dy=-1; dy<=1; dy++) {
                    let nx = x+dx, ny = y+dy;
                    let nKey = `${nx},${ny}`;
                    if (!visited.has(nKey)) {
                        visited.add(nKey);
                        queue.push({x: nx, y: ny});
                    }
                }
            }
        }
    }
    draw();
    updateStats();
    saveGame();
}

function toggleFlag(x, y) {
    let cell = getCell(x, y);
    if (cell.state === 'hidden') {
        if (!hasRevealedNeighbor(x, y)) {
            statusDiv.innerText = 'Cảnh báo: Chỉ được cắm cờ sát khu vực đã mở!';
            statusDiv.style.color = '#FF9800';
            setTimeout(() => {
                statusDiv.innerText = 'Trạng thái: Đang chơi';
                statusDiv.style.color = '#4CAF50';
            }, 2000);
            return;
        }
        setCell(x, y, 'flagged');
    }
    else if (cell.state === 'flagged') cells.delete(`${x},${y}`); // remove from map to be hidden again
    draw();
    updateStats();
    saveGame();
}

// --- Solver Logic ---

function solveStep() {
    let changed = false;
    let toReveal = [];
    let toFlag = [];

    // Find deterministic moves
    for (let [key, cell] of cells.entries()) {
        if (cell.state === 'revealed') {
            let [x, y] = key.split(',').map(Number);
            let count = getMineCount(x, y);
            if (count > 0) {
                let hidden = [];
                let flagged = 0;
                
                for(let dx=-1; dx<=1; dx++) {
                    for(let dy=-1; dy<=1; dy++) {
                        if(dx===0 && dy===0) continue;
                        let nx = x+dx, ny = y+dy;
                        let nState = getCell(nx, ny).state;
                        if (nState === 'flagged') flagged++;
                        else if (nState === 'hidden') hidden.push({x: nx, y: ny});
                    }
                }
                
                if (hidden.length > 0) {
                    if (count === flagged) {
                        // All remaining hidden are safe
                        hidden.forEach(h => toReveal.push(h));
                    } else if (count === hidden.length + flagged) {
                        // All remaining hidden are mines
                        hidden.forEach(h => toFlag.push(h));
                    }
                }
            }
        }
    }
    
    // Apply moves
    if (toReveal.length > 0 || toFlag.length > 0) {
        // Filter unique coordinates to avoid duplicate operations
        let uniqueReveal = new Set(toReveal.map(h => `${h.x},${h.y}`));
        let uniqueFlag = new Set(toFlag.map(h => `${h.x},${h.y}`));
        
        uniqueFlag.forEach(k => {
            let [x, y] = k.split(',').map(Number);
            let cell = getCell(x, y);
            if (cell.state === 'hidden') {
                setCell(x, y, 'flagged');
                changed = true;
            }
        });

        uniqueReveal.forEach(k => {
            let [x, y] = k.split(',').map(Number);
            let cell = getCell(x, y);
            if (cell.state === 'hidden') {
                reveal(x, y);
                changed = true;
            }
        });
    }

    if (changed) {
        draw();
        saveGame();
    }
    return changed;
}

function explainHint(x, y) {
    let cell = getCell(x, y);
    if (cell.state !== 'hidden' && cell.state !== 'flagged') {
        alert("Vui lòng nhấp vào ô chưa mở (hoặc đã cắm cờ) để xem giải thích.");
        return;
    }
    
    let isSafe = false;
    let isMineReason = false;
    let safeReason = "";
    let mineReason = "";

    for(let dx=-1; dx<=1; dx++) {
        for(let dy=-1; dy<=1; dy++) {
            if(dx===0 && dy===0) continue;
            let nx = x+dx, ny = y+dy;
            let nCell = getCell(nx, ny);
            if (nCell.state === 'revealed') {
                let count = getMineCount(nx, ny);
                if (count > 0) {
                    let hidden = [];
                    let flagged = 0;
                    for(let ddx=-1; ddx<=1; ddx++) {
                        for(let ddy=-1; ddy<=1; ddy++) {
                            if(ddx===0 && ddy===0) continue;
                            let nnx = nx+ddx, nny = ny+ddy;
                            let nnState = getCell(nnx, nny).state;
                            if (nnState === 'flagged') flagged++;
                            else if (nnState === 'hidden') hidden.push({x: nnx, y: nny});
                        }
                    }

                    let isTargetNeighbor = (cell.state === 'hidden' && hidden.some(h => h.x === x && h.y === y)) || 
                                           (cell.state === 'flagged' && Math.abs(nx-x)<=1 && Math.abs(ny-y)<=1);

                    // Prove safe
                    if (count === flagged && isTargetNeighbor && cell.state === 'hidden') {
                        isSafe = true;
                        safeReason = `Ô này CHẮC CHẮN AN TOÀN vì ô số ${count} kế bên đã có đủ ${flagged} cờ xung quanh.`;
                    }

                    // Prove mine
                    if (count === hidden.length + flagged && isTargetNeighbor) {
                        isMineReason = true;
                        mineReason = `Ô này CHẮC CHẮN LÀ MÌN vì ô số ${count} kế bên cần ${count} mìn, mà xung quanh nó chỉ còn đúng ${hidden.length + flagged} ô (bao gồm cả cờ và ô chưa mở).`;
                    }
                }
            }
        }
    }

    if (isSafe) {
        alert(safeReason);
    } else if (isMineReason) {
        alert(mineReason);
    } else {
        alert("Chưa đủ dữ kiện để xác định ô này là mìn hay an toàn dựa trên các ô số xung quanh. Hãy thử phân tích thêm hoặc tìm ở khu vực khác.");
    }
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
    saveGame(); // Save camera position after drag
    // Check if it was a click or a drag
    let dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    if (dist < 5) {
        // It's a click
        let rect = canvas.getBoundingClientRect();
        let mouseX = e.clientX - rect.left;
        let mouseY = e.clientY - rect.top;
        
        // Convert screen to grid coordinates
        let gridX = Math.floor((mouseX - camera.x) / camera.zoom);
        let gridY = Math.floor((mouseY - camera.y) / camera.zoom);
        
        if (e.button === 0) {
            // Left click or touch
            if (isHintMode) {
                explainHint(gridX, gridY);
                isHintMode = false;
                hintModeBtn.innerText = 'Bật Gợi Ý: Tắt';
                hintModeBtn.style.background = '#FF9800';
                hintModeBtn.style.borderColor = '#F57C00';
                statusDiv.innerText = 'Trạng thái: Đang chơi';
                statusDiv.style.color = '#4CAF50';
            } else {
                reveal(gridX, gridY);
            }
        } else if (e.button === 2) {
            // Right click (always flag)
            toggleFlag(gridX, gridY);
        }
    }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
    // Zoom around mouse pointer
    let rect = canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;
    
    let gridX = (mouseX - camera.x) / camera.zoom;
    let gridY = (mouseY - camera.y) / camera.zoom;
    
    let zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    camera.zoom *= zoomDelta;
    camera.zoom = Math.max(15, Math.min(camera.zoom, 100)); // Clamp zoom
    
    camera.x = mouseX - gridX * camera.zoom;
    camera.y = mouseY - gridY * camera.zoom;
    
    draw();
});

// --- Rendering ---

const colors = [
    '', '#2196F3', '#4CAF50', '#F44336', 
    '#9C27B0', '#FF9800', '#00BCD4', '#000000', '#9E9E9E'
];

function drawCell(x, y, screenX, screenY, size) {
    let cell = getCell(x, y);
    
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#333';
    
    if (cell.state === 'hidden') {
        ctx.fillStyle = '#555';
        ctx.fillRect(screenX, screenY, size, size);
        
        // Pseudo 3D effect
        ctx.fillStyle = '#777';
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX + size, screenY);
        ctx.lineTo(screenX + size - 4, screenY + 4);
        ctx.lineTo(screenX + 4, screenY + 4);
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX, screenY + size);
        ctx.lineTo(screenX + 4, screenY + size - 4);
        ctx.lineTo(screenX + 4, screenY + 4);
        ctx.fill();
        
    } else if (cell.state === 'revealed') {
        ctx.fillStyle = '#222';
        ctx.fillRect(screenX, screenY, size, size);
        ctx.strokeRect(screenX, screenY, size, size);
        
        let count = getMineCount(x, y);
        if (count > 0) {
            ctx.fillStyle = colors[count] || '#fff';
            ctx.font = `bold ${size * 0.6}px Inter`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(count, screenX + size/2, screenY + size/2 + 1);
        }
    } else if (cell.state === 'flagged') {
        ctx.fillStyle = '#555';
        ctx.fillRect(screenX, screenY, size, size);
        ctx.strokeRect(screenX, screenY, size, size);
        
        // Draw flag
        ctx.fillStyle = '#F44336';
        ctx.beginPath();
        ctx.moveTo(screenX + size * 0.3, screenY + size * 0.7);
        ctx.lineTo(screenX + size * 0.3, screenY + size * 0.2);
        ctx.lineTo(screenX + size * 0.7, screenY + size * 0.4);
        ctx.lineTo(screenX + size * 0.3, screenY + size * 0.5);
        ctx.fill();
        
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screenX + size * 0.3, screenY + size * 0.2);
        ctx.lineTo(screenX + size * 0.3, screenY + size * 0.8);
        ctx.stroke();
    } else if (cell.state === 'exploded') {
        ctx.fillStyle = '#F44336';
        ctx.fillRect(screenX, screenY, size, size);
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(screenX + size/2, screenY + size/2, size*0.3, 0, Math.PI*2);
        ctx.fill();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let startX = Math.floor((-camera.x) / camera.zoom);
    let endX = Math.ceil((canvas.width - camera.x) / camera.zoom);
    let startY = Math.floor((-camera.y) / camera.zoom);
    let endY = Math.ceil((canvas.height - camera.y) / camera.zoom);

    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            let screenX = Math.floor(camera.x + x * camera.zoom);
            let screenY = Math.floor(camera.y + y * camera.zoom);
            drawCell(x, y, screenX, screenY, Math.ceil(camera.zoom));
        }
    }
    
    // Draw 8x8 Chunk Borders
    ctx.strokeStyle = 'rgba(0, 201, 255, 0.5)'; // Neon blue color for chunk boundaries
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = startX; x <= endX; x++) {
        if (x % 8 === 0) {
            let screenX = Math.floor(camera.x + x * camera.zoom);
            ctx.moveTo(screenX, 0);
            ctx.lineTo(screenX, canvas.height);
        }
    }
    for (let y = startY; y <= endY; y++) {
        if (y % 8 === 0) {
            let screenY = Math.floor(camera.y + y * camera.zoom);
            ctx.moveTo(0, screenY);
            ctx.lineTo(canvas.width, screenY);
        }
    }
    ctx.stroke();
    
    // Draw center crosshair gently
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width/2, 0);
    ctx.lineTo(canvas.width/2, canvas.height);
    ctx.moveTo(0, canvas.height/2);
    ctx.lineTo(canvas.width, canvas.height/2);
    ctx.stroke();

    // Draw Long-Press Progress Indicator (Mobile Optimization)
    if (longPressProgress > 0 && longPressProgress < 1) {
        let rect = canvas.getBoundingClientRect();
        let x = touchStartPos.x - rect.left;
        let y = touchStartPos.y - rect.top;
        
        ctx.beginPath();
        ctx.arc(x, y, 25, 0, Math.PI * 2 * longPressProgress);
        ctx.strokeStyle = '#00C9FF';
        ctx.lineWidth = 4;
        ctx.stroke();
        
        // Inner pulse
        ctx.beginPath();
        ctx.arc(x, y, 15 * longPressProgress, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 201, 255, 0.3)';
        ctx.fill();
    }
}

// --- Init & UI Hooks ---

hintModeBtn.addEventListener('click', () => {
    isHintMode = !isHintMode;
    if (isHintMode) {
        hintModeBtn.innerText = 'Bật Gợi Ý: Bật';
        hintModeBtn.style.background = '#4CAF50';
        hintModeBtn.style.borderColor = '#388E3C';
        statusDiv.innerText = 'Trạng thái: Chọn 1 ô để xem giải thích';
        statusDiv.style.color = '#2196F3';
    } else {
        hintModeBtn.innerText = 'Bật Gợi Ý: Tắt';
        hintModeBtn.style.background = '#FF9800';
        hintModeBtn.style.borderColor = '#F57C00';
        statusDiv.innerText = 'Trạng thái: Đang chơi';
        statusDiv.style.color = '#4CAF50';
    }
});

resetBtn.addEventListener('click', () => {
    cells.clear();
    seed = Math.random();
    if (autoSolveInterval) clearInterval(autoSolveInterval);
    isHintMode = false;
    hintModeBtn.innerText = 'Bật Gợi Ý: Tắt';
    hintModeBtn.style.background = '#FF9800';
    hintModeBtn.style.borderColor = '#F57C00';
    statusDiv.innerText = 'Trạng thái: Đang chơi';
    statusDiv.style.color = '#4CAF50';
    statusDiv.style.color = '#4CAF50';
    
    // Center camera
    camera.x = canvas.width / 2;
    camera.y = canvas.height / 2;
    camera.zoom = 40;
    
    // Auto start by clicking 0,0
    reveal(0, 0);
    updateStats();
    saveGame(true);
});

// Start game
resizeCanvas();
if (!loadGame()) {
    camera.x = canvas.width / 2;
    camera.y = canvas.height / 2;
    reveal(0, 0); // Start the game by revealing origin
    updateStats();
} else {
    draw();
}

// --- Manual Solver Modal Logic ---
const manualSolveBtn = document.getElementById('manualSolveBtn');
const manualModal = document.getElementById('manualModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const manualGrid = document.getElementById('manualGrid');
const runManualSolveBtn = document.getElementById('runManualSolveBtn');
const clearManualBtn = document.getElementById('clearManualBtn');
const manualStatus = document.getElementById('manualStatus');
const imageUpload = document.getElementById('imageUpload');

// Initialize 8x8 grid inputs
let manualInputs = [];
for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
        let input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.dataset.x = x;
        input.dataset.y = y;
        input.addEventListener('input', (e) => {
            let val = e.target.value.toUpperCase();
            if (val === 'F') {
                e.target.value = 'F';
            } else if (val >= '1' && val <= '8') {
                e.target.value = val;
            } else {
                e.target.value = '';
            }
            // Remove highlights when user edits
            e.target.classList.remove('safe', 'mine');
        });
        manualGrid.appendChild(input);
        manualInputs.push(input);
    }
}

manualSolveBtn.addEventListener('click', () => {
    manualModal.style.display = 'flex';
});

closeModalBtn.addEventListener('click', () => {
    manualModal.style.display = 'none';
});

clearManualBtn.addEventListener('click', () => {
    manualInputs.forEach(input => {
        input.value = '';
        input.classList.remove('safe', 'mine');
    });
    imageUpload.value = '';
    manualStatus.innerText = 'Sẵn sàng.';
    manualStatus.style.color = '#aaa';
});

// --- Image Processing (OCR) ---
async function processImage(imageSource) {
    manualStatus.innerText = 'Đang phân tích ảnh... Vui lòng đợi (có thể mất 10-20 giây).';
    manualStatus.style.color = '#2196F3';
    
    try {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            let cellW = img.width / 8;
            let cellH = img.height / 8;

            const worker = await Tesseract.createWorker('eng');
            await worker.setParameters({
                tessedit_char_whitelist: '12345678',
                tessedit_pageseg_mode: 10 // PSM_SINGLE_CHAR
            });

            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    // Extract cell
                    let cellCanvas = document.createElement('canvas');
                    cellCanvas.width = cellW;
                    cellCanvas.height = cellH;
                    let cellCtx = cellCanvas.getContext('2d');
                    
                    let cropMargin = Math.max(2, Math.floor(Math.min(cellW, cellH) * 0.05));
                    let drawW = cellW - cropMargin*2;
                    let drawH = cellH - cropMargin*2;
                    cellCtx.drawImage(
                        canvas, 
                        x * cellW + cropMargin, y * cellH + cropMargin, 
                        drawW, drawH, 
                        0, 0, drawW, drawH
                    );

                    // Pre-process Image
                    let imgData = cellCtx.getImageData(0, 0, drawW, drawH);
                    let pixels = imgData.data;
                    let redCount = 0;

                    for (let i = 0; i < pixels.length; i += 4) {
                        let r = pixels[i];
                        let g = pixels[i+1];
                        let b = pixels[i+2];
                        
                        // Detect Red Flag
                        if (r > 80 && r > g * 1.5 && r > b * 1.5) {
                            redCount++;
                        }
                    }

                    let totalPixels = drawW * drawH;
                    if (redCount > totalPixels * 0.02) {
                        manualInputs[y * 8 + x].value = 'F';
                    } else {
                        // Binarize for OCR
                        let hasBright = false;
                        for (let i = 0; i < pixels.length; i += 4) {
                            let r = pixels[i];
                            let g = pixels[i+1];
                            let b = pixels[i+2];
                            
                            if (r > 90 && g > 90 && b > 90) {
                                pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0;
                                hasBright = true;
                            } else {
                                pixels[i] = 255; pixels[i+1] = 255; pixels[i+2] = 255;
                            }
                        }

                        if (!hasBright) {
                            manualInputs[y * 8 + x].value = '';
                        } else {
                            cellCtx.putImageData(imgData, 0, 0);

                            // Scale up with smoothing to help Tesseract (it hates sharp pixel fonts)
                            let scale = 4;
                            let paddedCanvas = document.createElement('canvas');
                            paddedCanvas.width = (drawW * scale) + 40;
                            paddedCanvas.height = (drawH * scale) + 40;
                            let paddedCtx = paddedCanvas.getContext('2d');
                            
                            paddedCtx.fillStyle = '#ffffff';
                            paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
                            
                            paddedCtx.imageSmoothingEnabled = true; // Smoothing helps create anti-aliasing
                            paddedCtx.drawImage(cellCanvas, 0, 0, drawW, drawH, 20, 20, drawW * scale, drawH * scale);

                            let { data: { text } } = await worker.recognize(paddedCanvas);
                            let val = text.trim().replace(/[^1-8]/g, '');
                            
                            if (val.length > 0) {
                                manualInputs[y * 8 + x].value = val[0];
                            } else {
                                manualInputs[y * 8 + x].value = '';
                            }
                        }
                    }
                    
                    manualStatus.innerText = `Đang phân tích ảnh... (${y*8 + x + 1}/64)`;
                }
            }
            await worker.terminate();
            manualStatus.innerText = 'Quét ảnh hoàn tất! Kiểm tra lại số và ấn Tìm mìn.';
            manualStatus.style.color = '#4CAF50';
        };
        img.src = imageSource;
    } catch (e) {
        console.error(e);
        manualStatus.innerText = 'Lỗi khi xử lý ảnh!';
        manualStatus.style.color = '#F44336';
    }
}

imageUpload.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        let reader = new FileReader();
        reader.onload = (event) => {
            processImage(event.target.result);
        };
        reader.readAsDataURL(e.target.files[0]);
    }
});

document.addEventListener('paste', (e) => {
    if (manualModal.style.display !== 'none') {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                let blob = item.getAsFile();
                let reader = new FileReader();
                reader.onload = (event) => {
                    processImage(event.target.result);
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    }
});

runManualSolveBtn.addEventListener('click', () => {
    // Read state
    let state = [];
    for (let y = 0; y < 8; y++) {
        state[y] = [];
        for (let x = 0; x < 8; x++) {
            let val = manualInputs[y * 8 + x].value;
            if (val === 'F') state[y][x] = { type: 'flagged' };
            else if (val >= '1' && val <= '8') state[y][x] = { type: 'number', val: parseInt(val) };
            else state[y][x] = { type: 'hidden' };
        }
    }

    let changed = false;
    let safeCount = 0;
    let mineCount = 0;

    // Apply basic solver logic
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (state[y][x].type === 'number') {
                let count = state[y][x].val;
                let hidden = [];
                let flagged = 0;
                let outsideUnknown = 0;

                for(let dy=-1; dy<=1; dy++) {
                    for(let dx=-1; dx<=1; dx++) {
                        if(dx===0 && dy===0) continue;
                        let nx = x+dx, ny = y+dy;
                        if(nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
                            if (state[ny][nx].type === 'flagged') flagged++;
                            else if (state[ny][nx].type === 'hidden') hidden.push({x: nx, y: ny});
                        } else {
                            // Because it's an infinite board, outside cells might be hidden/mines
                            outsideUnknown++;
                        }
                    }
                }

                if (hidden.length > 0) {
                    if (count === flagged) {
                        // All remaining hidden are definitely safe
                        hidden.forEach(h => {
                            let input = manualInputs[h.y * 8 + h.x];
                            if (!input.classList.contains('safe')) {
                                input.classList.add('safe');
                                state[h.y][h.x].type = 'safe'; // Mark so we don't count it as hidden in next iteration
                                safeCount++;
                                changed = true;
                            }
                        });
                    } else if (count === hidden.length + flagged + outsideUnknown) {
                        // All remaining hidden (AND outside unknowns) are definitely mines
                        hidden.forEach(h => {
                            let input = manualInputs[h.y * 8 + h.x];
                            if (input.value !== 'F') {
                                input.value = 'F';
                                input.classList.add('mine');
                                state[h.y][h.x].type = 'flagged';
                                mineCount++;
                                changed = true;
                            }
                        });
                    }
                }
            }
        }
    }

    if (changed) {
        manualStatus.innerText = `Đã tìm thấy ${mineCount} mìn (Đỏ) và ${safeCount} ô an toàn (Xanh).`;
        manualStatus.style.color = '#4CAF50';
    } else {
        manualStatus.innerText = 'Không tìm thấy bước giải tiếp theo chắc chắn.';
        manualStatus.style.color = '#FF9800';
    }
});

// --- Menu Toggle Logic ---
const menuToggleBtn = document.getElementById('menuToggleBtn');
const uiContainer = document.getElementById('ui');

// Auto-hide menu on very small screens initially
if (window.innerWidth <= 600) {
    uiContainer.classList.add('hidden');
}

menuToggleBtn.addEventListener('click', () => {
    uiContainer.classList.toggle('hidden');
});

// --- Menu Toggle Logic ---
const menuToggleBtn = document.getElementById('menuToggleBtn');
const uiContainer = document.getElementById('ui');

// Auto-hide menu on very small screens initially
if (window.innerWidth <= 600) {
    uiContainer.classList.add('hidden');
}

menuToggleBtn.addEventListener('click', () => {
    uiContainer.classList.toggle('hidden');
});

// --- Mobile Touch Support ---
let longPressTimeout = null;
let longPressFired = false;
let touchStartPos = { x: 0, y: 0 };
let longPressProgress = 0;
let longPressInterval = null;

function startLongPressTimer(x, y) {
    longPressProgress = 0;
    const duration = 300; // 300ms is snappier
    const interval = 20;
    
    longPressInterval = setInterval(() => {
        longPressProgress += interval / duration;
        if (longPressProgress >= 1) {
            longPressProgress = 1;
            clearInterval(longPressInterval);
        }
        draw();
    }, interval);
    
    longPressTimeout = setTimeout(() => {
        longPressFired = true;
        clearInterval(longPressInterval);
        longPressProgress = 0;
        
        let rect = canvas.getBoundingClientRect();
        let mouseX = x - rect.left;
        let mouseY = y - rect.top;
        
        let gridX = Math.floor((mouseX - camera.x) / camera.zoom);
        let gridY = Math.floor((mouseY - camera.y) / camera.zoom);
        
        toggleFlag(gridX, gridY);
        if (navigator.vibrate) navigator.vibrate(50);
        draw();
    }, duration);
}

function cancelLongPress() {
    clearTimeout(longPressTimeout);
    clearInterval(longPressInterval);
    longPressProgress = 0;
    draw();
}

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isDragging = true;
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        cameraStart = { x: camera.x, y: camera.y };
        
        longPressFired = false;
        startLongPressTimer(e.touches[0].clientX, e.touches[0].clientY);
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
        let dist = Math.hypot(e.touches[0].clientX - touchStartPos.x, e.touches[0].clientY - touchStartPos.y);
        if (dist > 10) {
            cancelLongPress(); // User moved, cancel long press
        }
    }

    if (isDragging && e.touches.length === 1 && !longPressFired) {
        camera.x = cameraStart.x + (e.touches[0].clientX - dragStart.x);
        camera.y = cameraStart.y + (e.touches[0].clientY - dragStart.y);
        draw();
    }
});

canvas.addEventListener('touchend', (e) => {
    cancelLongPress();

    if (isDragging) {
        isDragging = false;
        saveGame();
        
        if (e.changedTouches.length === 1 && !longPressFired) {
            let touch = e.changedTouches[0];
            let dist = Math.hypot(touch.clientX - dragStart.x, touch.clientY - dragStart.y);
            if (dist < 10) {
                let rect = canvas.getBoundingClientRect();
                let mouseX = touch.clientX - rect.left;
                let mouseY = touch.clientY - rect.top;
                
                let gridX = Math.floor((mouseX - camera.x) / camera.zoom);
                let gridY = Math.floor((mouseY - camera.y) / camera.zoom);
                
                if (isHintMode) {
                    explainHint(gridX, gridY);
                    isHintMode = false;
                    hintModeBtn.innerText = 'Bật Gợi Ý: Tắt';
                    hintModeBtn.style.background = '#FF9800';
                    hintModeBtn.style.borderColor = '#F57C00';
                    statusDiv.innerText = 'Trạng thái: Đang chơi';
                    statusDiv.style.color = '#4CAF50';
                } else {
                    reveal(gridX, gridY);
                }
            }
        }
    }
});
