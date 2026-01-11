/**
 * CMYK DESIGNER ENGINE v2.1
 */

// --- CONFIGURATION ---
// 5 Pixels = 1 mm for canvas preview (100mm = 500px)
// We will upsample this later for STL generation
const PPM = 5; 
const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 30;

// --- STATE ---
const state = {
    activeLayer: 'mask', // 'photo' or 'mask'
    unit: 'mm',
    isDragging: false,
    dragAction: null, // 'move', 'tl', 'tr', 'bl', 'br', 'rotate'
    dragStart: { x:0, y:0 },
    
    // Layer Objects
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null }
};

const cvs = document.getElementById('editorCanvas');
const ctx = cvs.getContext('2d');

// --- INITIALIZATION ---
function init() {
    render();
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
            layer.aspect = img.width / img.height;
            layer.rot = 0;

            // Fit to view logic
            if (type === 'mask') {
                // Mask fills ~60% of view
                layer.h = cvs.height * 0.6;
                layer.w = layer.h * layer.aspect;
                layer.x = (cvs.width - layer.w) / 2;
                layer.y = (cvs.height - layer.h) / 2;
                
                // Process Mask Alpha immediately
                layer.alphaCanvas = createAlphaMask(img);
                
                updateInputsFromState(); // Update mm boxes
            } else {
                // Photo fills view background mostly
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

function createAlphaMask(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const id = x.getImageData(0,0,c.width,c.height);
    const d = id.data;
    for(let i=0; i<d.length; i+=4) {
        // Brightness -> Alpha. Black(0) = Transparent. White(255) = Opaque.
        // We use the Red channel as proxy for brightness since masks are usually B&W
        d[i+3] = d[i]; 
    }
    x.putImageData(id,0,0);
    return c;
}

// --- INTERACTION HANDLERS ---
function selectLayer(layer) {
    state.activeLayer = layer;
    document.getElementById('btn-mask').className = layer === 'mask' ? 'layer-btn active' : 'layer-btn';
    document.getElementById('btn-photo').className = layer === 'photo' ? 'layer-btn active' : 'layer-btn';
    render();
}

// Coordinate transform helper
function getMousePos(e) {
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Hit Testing
function getHitHandle(layer, mx, my) {
    // Transform mouse into layer local space is hard. 
    // Simpler: Transform layer corners to screen space and check distance.
    const cx = layer.x + layer.w/2;
    const cy = layer.y + layer.h/2;
    
    // Corners relative to center (unrotated)
    const corners = [
        { id: 'tl', x: -layer.w/2, y: -layer.h/2 },
        { id: 'tr', x: layer.w/2, y: -layer.h/2 },
        { id: 'br', x: layer.w/2, y: layer.h/2 },
        { id: 'bl', x: -layer.w/2, y: layer.h/2 },
        { id: 'rotate', x: 0, y: -layer.h/2 - ROT_HANDLE_OFFSET } // Rotate handle
    ];

    for (let c of corners) {
        // Rotate point
        const rx = c.x * Math.cos(layer.rot) - c.y * Math.sin(layer.rot);
        const ry = c.x * Math.sin(layer.rot) + c.y * Math.cos(layer.rot);
        const sx = cx + rx;
        const sy = cy + ry;

        if (Math.hypot(mx-sx, my-sy) < HANDLE_SIZE + 5) return c.id;
    }
    
    // Check if inside box for Move
    // Inverse rotate mouse to check AABB
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
        state.initialLayer = { ...layer }; // Snapshot for delta calcs
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
        layer.x = init.x + (m.x - start.x);
        layer.y = init.y + (m.y - start.y);
    } else if (state.dragAction === 'rotate') {
        const cx = layer.x + layer.w/2;
        const cy = layer.y + layer.h/2;
        const angle = Math.atan2(m.y - cy, m.x - cx);
        layer.rot = angle + Math.PI/2; // Offset because handle is at top (-90deg)
    } else {
        // Scaling (Simplified: Uniform scale based on distance from center)
        const cx = layer.x + layer.w/2;
        const cy = layer.y + layer.h/2;
        const distStart = Math.hypot(start.x - cx, start.y - cy);
        const distNow = Math.hypot(m.x - cx, m.y - cy);
        const ratio = distNow / distStart;
        
        layer.w = init.w * ratio;
        layer.h = init.h * ratio;
        
        // Recenter to keep centered
        layer.x = cx - layer.w/2;
        layer.y = cy - layer.h/2;
        
        if (state.activeLayer === 'mask') updateInputsFromState();
    }
    render();
});


// --- DIMENSIONS LOGIC ---
function updateInputsFromState() {
    if (!state.mask.loaded) return;
    const factor = state.unit === 'mm' ? 1/PPM : (1/PPM) / 25.4;
    document.getElementById('inpWidth').value = (state.mask.w * factor).toFixed(1);
    document.getElementById('inpHeight').value = (state.mask.h * factor).toFixed(1);
}

function updateDims(changed) {
    if (!state.mask.loaded) return;
    const factor = state.unit === 'mm' ? PPM : PPM * 25.4; // Convert Unit to Pixels
    
    const wInp = parseFloat(document.getElementById('inpWidth').value);
    const hInp = parseFloat(document.getElementById('inpHeight').value);

    if (changed === 'w') {
        state.mask.w = wInp * factor;
        state.mask.h = state.mask.w / state.mask.aspect; // Lock Aspect
    } else {
        state.mask.h = hInp * factor;
        state.mask.w = state.mask.h * state.mask.aspect; // Lock Aspect
    }
    updateInputsFromState(); // Refreshes the other box
    render();
}

function updateUnitDisplay() {
    state.unit = document.getElementById('unitSelect').value;
    updateInputsFromState();
}

// --- RENDER ENGINE ---
function render() {
    // Clear
    ctx.clearRect(0,0,cvs.width, cvs.height);

    // 1. Draw Photo (Bottom)
    if (state.photo.loaded) drawLayer(state.photo, false);

    // 2. Draw Mask (Cut Mode)
    if (state.mask.loaded) {
        // Logic for view:
        // Draw Photo -> Set Comp Mode 'destination-in' -> Draw Mask -> Reset Comp Mode.
        
        ctx.globalCompositeOperation = 'destination-in';
        drawLayer(state.mask, true); // True = draw alpha version
        ctx.globalCompositeOperation = 'source-over';
        
        // OPTIONAL: Draw a faint outline of the mask so user sees it even if not cutting
        ctx.save();
        setTransform(state.mask);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
        ctx.restore();
    }

    // 3. Draw Gizmos (Selection Box)
    const active = state[state.activeLayer];
    if (active.loaded) {
        ctx.save();
        setTransform(active);
        
        // Box
        ctx.strokeStyle = "#00d26a";
        ctx.lineWidth = 2;
        ctx.strokeRect(-active.w/2, -active.h/2, active.w, active.h);
        
        // Corners
        ctx.fillStyle = "#00d26a";
        const hw = active.w/2;
        const hh = active.h/2;
        const s = HANDLE_SIZE;
        
        ctx.fillRect(-hw-s/2, -hh-s/2, s, s); // TL
        ctx.fillRect(hw-s/2, -hh-s/2, s, s);  // TR
        ctx.fillRect(hw-s/2, hh-s/2, s, s);   // BR
        ctx.fillRect(-hw-s/2, hh-s/2, s, s);  // BL
        
        // Rotation Handle
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh - ROT_HANDLE_OFFSET);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -hh - ROT_HANDLE_OFFSET, s/2, 0, Math.PI*2);
        ctx.fill();
        
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
    // Draw centered
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

    // Output Canvases
    const chans = ['c','m','y','w', 'ref'];
    const ctxs = {};
    chans.forEach(k => {
        const el = document.getElementById(k+'Canvas');
        el.width = w; el.height = h;
        ctxs[k] = el.getContext('2d');
    });

    // Reference
    ctxs['ref'].putImageData(ctx.getImageData(0,0,w,h), 0,0);

    // Buffers
    const buffers = {};
    chans.forEach(k => buffers[k] = ctxs[k].createImageData(w,h));

    for (let i=0; i<data.length; i+=4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const a = data[i+3];

        if (a < 10) continue; // Skip transparent pixels

        const cVal = 255 - r;
        const mVal = 255 - g;
        const yVal = 255 - b;
        const wVal = 255 - (r*0.299 + g*0.587 + b*0.114);

        // Fill buffers
        setPx(buffers['c'], i, cVal);
        setPx(buffers['m'], i, mVal);
        setPx(buffers['y'], i, yVal);
        setPx(buffers['w'], i, wVal);
    }

    chans.forEach(k => {
        if(k!=='ref') ctxs[k].putImageData(buffers[k], 0,0);
    });
}

function setPx(imgData, i, val) {
    imgData.data[i] = val;
    imgData.data[i+1] = val;
    imgData.data[i+2] = val;
    imgData.data[i+3] = 255;
}

init();