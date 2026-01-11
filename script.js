/**
 * CMYK DESIGNER ENGINE v2.3
 * - Decoupled Dimensions: Input changes export settings, not visual scale
 * - Constraint Logic: REMOVED (User request)
 */

// --- CONFIGURATION ---
const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 30;

// --- STATE ---
const state = {
    activeLayer: 'mask', // 'photo' or 'mask'
    unit: 'mm',
    isDragging: false,
    dragAction: null, // 'move', 'tl', 'tr', 'bl', 'br', 'rotate'
    dragStart: { x:0, y:0 },
    
    // Export Settings (Physical Dimensions)
    export: { width: 100, height: 100 },
    
    // Layer Objects (Visual Canvas Units)
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null }
};

const cvs = document.getElementById('editorCanvas');
const ctx = cvs.getContext('2d');

// --- INITIALIZATION ---
function init() {
    render();
    updateInputsFromState(); // Initialize inputs
}

// --- FILE HANDLERS ---
document.getElementById('photoInput').addEventListener('change', e => loadLayer(e, 'photo'));
document.getElementById('maskInput').addEventListener('change', e => loadLayer(e, 'mask'));

function loadLayer(e, type) {
    if (!e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = event => {
        const img = new Image();
        img.onload = () => {
            const layer = state[type];
            layer.img = img;
            layer.loaded = true;
            layer.rot = 0;

            if (type === 'mask') {
                // Process Mask
                const trimmed = createSmartAlphaMask(img);
                layer.alphaCanvas = trimmed.canvas;
                layer.w = trimmed.w;
                layer.h = trimmed.h;
                layer.aspect = layer.w / layer.h;

                // Fit Mask to View (Visual only)
                const viewScale = Math.min(
                    (cvs.width * 0.5) / layer.w,
                    (cvs.height * 0.5) / layer.h
                );
                
                layer.w *= viewScale;
                layer.h *= viewScale;
                layer.x = (cvs.width - layer.w) / 2;
                layer.y = (cvs.height - layer.h) / 2;
                
                // Set initial export dimensions to something reasonable (e.g. 100mm width)
                state.export.width = 100;
                state.export.height = 100 / layer.aspect;
                
                updateInputsFromState();
            } else {
                // Photo loading
                layer.aspect = img.width / img.height;
                layer.w = cvs.width;
                layer.h = cvs.width / layer.aspect;
                layer.x = 0;
                layer.y = (cvs.height - layer.h) / 2;
            }
            render();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
}

function createSmartAlphaMask(img) {
    const tempC = document.createElement('canvas');
    tempC.width = img.width;
    tempC.height = img.height;
    const tCtx = tempC.getContext('2d');
    tCtx.drawImage(img, 0, 0);
    
    const id = tCtx.getImageData(0,0, tempC.width, tempC.height);
    const d = id.data;
    
    let minX = tempC.width, minY = tempC.height, maxX = 0, maxY = 0;
    let foundAny = false;

    for (let y = 0; y < tempC.height; y++) {
        for (let x = 0; x < tempC.width; x++) {
            const i = (y * tempC.width + x) * 4;
            const r = d[i];
            d[i+3] = r; 
            if (d[i+3] > 10) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                foundAny = true;
            }
        }
    }

    if (!foundAny) { minX = 0; minY = 0; maxX = tempC.width; maxY = tempC.height; }
    const trimW = maxX - minX;
    const trimH = maxY - minY;
    const finalC = document.createElement('canvas');
    finalC.width = trimW;
    finalC.height = trimH;
    const fCtx = finalC.getContext('2d');
    tCtx.putImageData(id, 0, 0);
    fCtx.drawImage(tempC, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
    return { canvas: finalC, w: trimW, h: trimH };
}

// --- INTERACTION HANDLERS ---
function selectLayer(layer) {
    state.activeLayer = layer;
    document.getElementById('btn-mask').className = layer === 'mask' ? 'layer-btn active' : 'layer-btn';
    document.getElementById('btn-photo').className = layer === 'photo' ? 'layer-btn active' : 'layer-btn';
    render();
}

function getMousePos(e) {
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getHitHandle(layer, mx, my) {
    const cx = layer.x + layer.w/2;
    const cy = layer.y + layer.h/2;
    const corners = [
        { id: 'tl', x: -layer.w/2, y: -layer.h/2 },
        { id: 'tr', x: layer.w/2, y: -layer.h/2 },
        { id: 'br', x: layer.w/2, y: layer.h/2 },
        { id: 'bl', x: -layer.w/2, y: layer.h/2 },
        { id: 'rotate', x: 0, y: -layer.h/2 - ROT_HANDLE_OFFSET }
    ];

    for (let c of corners) {
        const rx = c.x * Math.cos(layer.rot) - c.y * Math.sin(layer.rot);
        const ry = c.x * Math.sin(layer.rot) + c.y * Math.cos(layer.rot);
        const sx = cx + rx;
        const sy = cy + ry;
        if (Math.hypot(mx-sx, my-sy) < HANDLE_SIZE + 5) return c.id;
    }
    
    const dx = mx - cx;
    const dy = my - cy;
    const localX = dx * Math.cos(-layer.rot) - dy * Math.sin(-layer.rot);
    const localY = dx * Math.sin(-layer.rot) + dy * Math.cos(-layer.rot);
    
    if (Math.abs(localX) < layer.w/2 && Math.abs(localY) < layer.h/2) return 'move';
    return null;
}

cvs.addEventListener('mousedown', e => {
    const m = getMousePos(e);
    const layer = state[state.activeLayer];
    if (!layer.loaded) return;

    const hit = getHitHandle(layer, m.x, m.y);
    if (hit) {
        state.isDragging = true;
        state.dragAction = hit;
        state.dragStart = m;
        state.initialLayer = { ...layer };
    }
});

window.addEventListener('mouseup', () => state.isDragging = false);

cvs.addEventListener('mousemove', e => {
    if (!state.isDragging) return;
    const m = getMousePos(e);
    const layer = state[state.activeLayer];
    const start = state.dragStart;
    const init = state.initialLayer;
    
    if (state.dragAction === 'move') {
        let newX = init.x + (m.x - start.x);
        let newY = init.y + (m.y - start.y);
        
        // CONSTRAIN LOGIC REMOVED
        layer.x = newX;
        layer.y = newY;
        
    } else if (state.dragAction === 'rotate') {
        const cx = layer.x + layer.w/2;
        const cy = layer.y + layer.h/2;
        const angle = Math.atan2(m.y - cy, m.x - cx);
        layer.rot = angle + Math.PI/2;
    } else {
        // Scaling Visuals
        const cx = layer.x + layer.w/2;
        const cy = layer.y + layer.h/2;
        const distStart = Math.hypot(start.x - cx, start.y - cy);
        const distNow = Math.hypot(m.x - cx, m.y - cy);
        const ratio = distNow / distStart;
        layer.w = init.w * ratio;
        layer.h = init.h * ratio;
        layer.x = cx - layer.w/2;
        layer.y = cy - layer.h/2;
    }
    render();
});


// --- EXPORT DIMENSIONS LOGIC ---
function updateInputsFromState() {
    // Updates the DOM inputs based on state.export values
    const isInch = state.unit === 'in';
    const valW = isInch ? state.export.width / 25.4 : state.export.width;
    const valH = isInch ? state.export.height / 25.4 : state.export.height;

    document.getElementById('inpWidth').value = valW.toFixed(1);
    document.getElementById('inpHeight').value = valH.toFixed(1);
}

function updateDims(changed) {
    if (!state.mask.loaded) return;
    
    const isInch = state.unit === 'in';
    let valW = parseFloat(document.getElementById('inpWidth').value);
    let valH = parseFloat(document.getElementById('inpHeight').value);
    
    // Convert to mm for state storage
    if (isInch) { valW *= 25.4; valH *= 25.4; }

    if (changed === 'w') {
        state.export.width = valW;
        state.export.height = valW / state.mask.aspect; // Maintain Aspect Ratio
    } else {
        state.export.height = valH;
        state.export.width = valH * state.mask.aspect; // Maintain Aspect Ratio
    }

    // Refresh inputs (to show the auto-calculated value)
    updateInputsFromState();
    
    // NOTE: We do NOT call render() or change state.mask.w/h here. 
    // Visuals are now decoupled from export size.
}

function updateUnitDisplay() {
    state.unit = document.getElementById('unitSelect').value;
    updateInputsFromState();
}

// --- RENDER ENGINE ---
function render() {
    ctx.clearRect(0,0,cvs.width, cvs.height);

    // 1. Draw Photo
    if (state.photo.loaded) drawLayer(state.photo, false);

    // 2. Draw Mask (Cut Mode)
    if (state.mask.loaded) {
        ctx.globalCompositeOperation = 'destination-in';
        drawLayer(state.mask, true);
        ctx.globalCompositeOperation = 'source-over';
        
        // Outline
        ctx.save();
        setTransform(state.mask);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
        ctx.restore();
    }

    // 3. Draw Gizmos
    const active = state[state.activeLayer];
    if (active.loaded) {
        ctx.save();
        setTransform(active);
        
        ctx.strokeStyle = "#00d26a";
        ctx.lineWidth = 2;
        ctx.strokeRect(-active.w/2, -active.h/2, active.w, active.h);
        
        ctx.fillStyle = "#00d26a";
        const hw = active.w/2; const hh = active.h/2; const s = HANDLE_SIZE;
        ctx.fillRect(-hw-s/2, -hh-s/2, s, s);
        ctx.fillRect(hw-s/2, -hh-s/2, s, s);
        ctx.fillRect(hw-s/2, hh-s/2, s, s);
        ctx.fillRect(-hw-s/2, hh-s/2, s, s);
        
        ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, -hh - ROT_HANDLE_OFFSET); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -hh - ROT_HANDLE_OFFSET, s/2, 0, Math.PI*2); ctx.fill();
        
        ctx.restore();
    }
}

function setTransform(layer) {
    ctx.translate(layer.x + layer.w/2, layer.y + layer.h/2);
    ctx.rotate(layer.rot);
}

function drawLayer(layer, isMask) {
    ctx.save();
    setTransform(layer);
    const imgToDraw = (isMask && layer.alphaCanvas) ? layer.alphaCanvas : layer.img;
    ctx.drawImage(imgToDraw, -layer.w/2, -layer.h/2, layer.w, layer.h);
    ctx.restore();
}

// --- GENERATION (CMYK SPLIT) ---
function generateLayers() {
    if(!state.mask.loaded || !state.photo.loaded) { alert("Please upload both a Photo and a Mask (Shape) first."); return; }
    
    const w = cvs.width;
    const h = cvs.height;
    const data = ctx.getImageData(0,0,w,h).data;

    const chans = ['c','m','y','w', 'ref'];
    const ctxs = {};
    chans.forEach(k => {
        const el = document.getElementById(k+'Canvas');
        el.width = w; el.height = h;
        ctxs[k] = el.getContext('2d');
    });

    ctxs['ref'].putImageData(ctx.getImageData(0,0,w,h), 0,0);
    const buffers = {};
    chans.forEach(k => buffers[k] = ctxs[k].createImageData(w,h));

    for (let i=0; i<data.length; i+=4) {
        const r = data[i]; const g = data[i+1]; const b = data[i+2]; const a = data[i+3];
        if (a < 10) continue; 
        const cVal = 255 - r;
        const mVal = 255 - g;
        const yVal = 255 - b;
        const wVal = 255 - (r*0.299 + g*0.587 + b*0.114);
        setPx(buffers['c'], i, cVal);
        setPx(buffers['m'], i, mVal);
        setPx(buffers['y'], i, yVal);
        setPx(buffers['w'], i, wVal);
    }
    chans.forEach(k => { if(k!=='ref') ctxs[k].putImageData(buffers[k], 0,0); });
}

function setPx(imgData, i, val) {
    imgData.data[i] = val; imgData.data[i+1] = val; imgData.data[i+2] = val; imgData.data[i+3] = 255;
}

init();
