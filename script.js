/**
 * CMYK DESIGNER ENGINE v5.5
 * - Clear Layer Buttons Added
 * - Overlapping Color Layers (Base 0-0.6, Colors 0.6-2.0, Top 0.6-2.7)
 * - Settings API Key management
 */

// --- API KEYS ---
const apiKey = localStorage.getItem('cmyk_api_key') || "";

// --- CONFIGURATION ---
const APP_VERSION = "1.0.0";
const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 30;
const CANVAS_PADDING = 50;

// --- STATE ---
const state = {
    apiKey: apiKey,
    activeLayer: 'photo',
    unit: 'mm',
    isDragging: false,
    dragAction: null,
    dragStart: { x:0, y:0 },
    export: { width: 100, height: 100, pixelStep: 2, border: 3, pixelSizeMm: 0.2 },
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, isGenerated: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null, isGenerated: false },
    pixelData: null,
    prompts: { photo: "", mask: "" },
    history: { photo: [], mask: [] },
    layerCache: {} 
};

const cvs = document.getElementById('editorCanvas');
const ctx = cvs.getContext('2d');

function init() {
    const verEl = document.getElementById("appVersion");
    if (verEl) verEl.textContent = "v" + APP_VERSION;
    render();
    updateInputsFromState();
    const pi = document.getElementById("pixelSizeInput");
    if (pi) pi.value = state.export.pixelSizeMm;
    updateExportGridReadout();
    checkApiKey();
}

// --- SETTINGS & API KEY ---
function openSettings() {
    document.getElementById('settingsOverlay').style.display = 'flex';
    document.getElementById('apiKeyInput').value = state.apiKey;
}

function closeSettings() {
    document.getElementById('settingsOverlay').style.display = 'none';
}

function saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    localStorage.setItem('cmyk_api_key', key);
    state.apiKey = key;
    closeSettings();
    checkApiKey();
}

function checkApiKey() {
    // Regex for Google API Key (starts with AIza, 39 chars total)
    const isValid = /^AIza[0-9A-Za-z-_]{35}$/.test(state.apiKey);
    const aiElements = document.querySelectorAll('.ai-feature');
    
    aiElements.forEach(el => {
        el.style.display = isValid ? 'flex' : 'none';
    });
}

// --- CLEAR LAYERS ---
function clearLayer(type) {
    if (type === 'photo') {
        state.photo = { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, isGenerated: false };
        document.getElementById('photoInput').value = ""; // Reset file input
        document.getElementById('dl-photo').style.display = 'none';
        
        // If mask exists, keep it, but if it was virtual, it needs context? 
        // Virtual mask depends on photo size. If photo gone, mask stays as is or resets?
        // Let's reset mask if it wasn't loaded (virtual)
        if (!state.mask.loaded) {
             // Virtual mask effectively gone without photo
        }
        
    } else if (type === 'mask') {
        state.mask = { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null, isGenerated: false };
        document.getElementById('maskInput').value = ""; // Reset file input
        document.getElementById('dl-mask').style.display = 'none';
        document.getElementById('btn-mask').classList.add('disabled');
        
        // If photo exists, switch back to virtual mask mode
        if (state.photo.loaded) {
             selectLayer('photo');
             state.mask.aspect = state.photo.aspect;
             state.mask.w = state.photo.w;
             state.mask.h = state.photo.h;
             state.mask.x = state.photo.x;
             state.mask.y = state.photo.y;
        }
    }
    
    render();
    updateInputsFromState(); // Update dims might change if mask cleared
}

// --- DOWNLOAD SOURCE IMAGE ---
function downloadSource(type) {
    const layer = state[type];
    if (layer.loaded && layer.img) {
        const a = document.createElement('a');
        a.href = layer.img.src;
        a.download = `generated_${type}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

// --- GEMINI AI FEATURES ---
function openAiPrompt(mode) {
    document.getElementById('aiPromptOverlay').style.display = 'flex';
    document.getElementById('aiMode').value = mode;
    const title = document.getElementById('aiModalTitle');
    const desc = document.getElementById('aiModalDesc');
    const input = document.getElementById('aiPromptInput');
    
    // Load existing prompt from state
    input.value = state.prompts[mode];
    
    if(mode === 'mask') {
        title.innerText = "✨ Generate Mask Shape";
        desc.innerText = "Describe the SHAPE you want (e.g., Heart, Star, Cat Silhouette). The AI will create a B&W stencil.";
        input.placeholder = "E.g., A simple silhouette of a cat sitting, vector style...";
    } else {
        title.innerText = "✨ Generate Photo";
        desc.innerText = "Describe the full color image you want to print.";
        input.placeholder = "E.g., A cyberpunk city at sunset...";
    }
}

function addToHistory(imgSrc, type) {
    state.history[type].unshift(imgSrc); 
    if(state.history[type].length > 5) state.history[type].pop(); 
    
    const container = document.getElementById(type + 'History');
    container.innerHTML = '';
    
    state.history[type].forEach(src => {
        const thumb = document.createElement('img');
        thumb.src = src;
        thumb.className = 'history-thumb';
        thumb.onclick = () => {
            const img = new Image();
            img.onload = () => handleImageLoad(img, type, "Restored Image", true);
            img.src = src;
        };
        container.appendChild(thumb);
    });
}

async function confirmGenerateImage() {
    const prompt = document.getElementById('aiPromptInput').value;
    const mode = document.getElementById('aiMode').value;
    if(!prompt) return;
    
    state.prompts[mode] = prompt;
    document.getElementById('aiPromptOverlay').style.display = 'none';
    ui.show();
    ui.update(50, `Creating ${mode}...`, "This may take a few seconds");

    let finalPrompt = prompt;
    if(mode === 'mask') {
        finalPrompt = "A high contrast, black and white stencil silhouette mask image of: " + prompt + ". White is the object, Black is the background. Sharp hard vector edges. No grayscale shading. Flat design.";
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${state.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: finalPrompt }],
                parameters: { sampleCount: 1 }
            })
        });

        const data = await response.json();
        if (data.predictions && data.predictions[0]) {
            const base64 = data.predictions[0].bytesBase64Encoded;
            const imgSrc = "data:image/png;base64," + base64;
            addToHistory(imgSrc, mode); 
            
            const img = new Image();
            img.onload = () => {
                handleImageLoad(img, mode, prompt, true);
                ui.hide();
            };
            img.src = imgSrc;
        } else {
            throw new Error("No image returned");
        }
    } catch (e) {
        alert("AI Generation Failed: " + e.message);
        ui.hide();
    }
}

// CACHING HELPER
function cacheCurrentLayerState(type) {
    const layer = state[type];
    if (layer.loaded && layer.img && layer.img.src) {
        const key = layer.img.src.substring(0, 100) + layer.img.src.length; 
        state.layerCache[key] = {
            x: layer.x,
            y: layer.y,
            w: layer.w,
            h: layer.h,
            rot: layer.rot
        };
    }
}

function handleImageLoad(img, mode, prompt, isGenerated = false) {
    cacheCurrentLayerState(mode);

    if(mode === 'mask') {
        const layer = state.mask;
        layer.img = img;
        layer.loaded = true;
        layer.isGenerated = isGenerated; // Mark source
        const trimmed = createSmartAlphaMask(img);
        layer.alphaCanvas = trimmed.canvas;
        layer.aspect = trimmed.w / trimmed.h; 
        
        const key = img.src.substring(0, 100) + img.src.length;
        if (state.layerCache[key]) {
            const c = state.layerCache[key];
            layer.x = c.x; layer.y = c.y; layer.w = c.w; layer.h = c.h; layer.rot = c.rot;
        } else {
            layer.w = trimmed.w; layer.h = trimmed.h; layer.rot = 0;
            const viewScale = Math.min((cvs.width * 0.5) / layer.w, (cvs.height * 0.5) / layer.h);
            layer.w *= viewScale;
            layer.h *= viewScale;
            layer.x = (cvs.width - layer.w) / 2;
            layer.y = (cvs.height - layer.h) / 2;
        }
        
        state.export.width = 100;
        state.export.height = 100 / layer.aspect;
        updateInputsFromState();
        
        document.getElementById('btn-mask').classList.remove('disabled');
        document.getElementById('dl-mask').style.display = isGenerated ? 'inline-block' : 'none';
        
        selectLayer('mask'); 
        
    } else {
        const layer = state.photo;
        layer.img = img;
        layer.loaded = true;
        layer.isGenerated = isGenerated; // Mark source
        layer.aspect = img.width / img.height;
        
        const key = img.src.substring(0, 100) + img.src.length;
        if (state.layerCache[key]) {
            const c = state.layerCache[key];
            layer.x = c.x; layer.y = c.y; layer.w = c.w; layer.h = c.h; layer.rot = c.rot;
        } else {
            layer.rot = 0;
            const padding = 40;
            const availW = cvs.width - padding;
            const availH = cvs.height - padding;
            const scale = Math.min(availW / img.width, availH / img.height);
            layer.w = img.width * scale;
            layer.h = img.height * scale;
            layer.x = (cvs.width - layer.w) / 2;
            layer.y = (cvs.height - layer.h) / 2;
        }
        
        if (!state.mask.loaded) {
            state.mask.aspect = layer.aspect;
            state.mask.w = layer.w;
            state.mask.h = layer.h;
            state.mask.x = layer.x;
            state.mask.y = layer.y;
            state.export.width = 100;
            state.export.height = 100 / layer.aspect;
            updateInputsFromState();
            selectLayer('photo');
        }
        if(prompt) {
            document.getElementById('fileNameInput').value = prompt.split(' ').slice(0,3).join('_').replace(/[^a-zA-Z0-9_]/g, '');
        }

        document.getElementById('dl-photo').style.display = isGenerated ? 'inline-block' : 'none';
    }
    render();
}

async function autoNameImage() {
    if (!state.photo.loaded) { alert("Upload an image first!"); return; }
    ui.show();
    ui.update(50, "Analyzing...", "Gemini is looking at your photo");

    try {
        const tCvs = document.createElement('canvas');
        tCvs.width = 512; 
        tCvs.height = 512 * (state.photo.img.height / state.photo.img.width);
        tCvs.getContext('2d').drawImage(state.photo.img, 0, 0, tCvs.width, tCvs.height);
        const base64Data = tCvs.toDataURL('image/jpeg').split(',')[1];

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${state.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "Generate a short, concise filename (max 3 words, connected by underscores) for this image. Do not include file extension. Example: Sunset_Mountain_View" },
                        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
                    ]
                }]
            })
        });

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text.trim().replace(/[^a-zA-Z0-9_]/g, '');
        document.getElementById('fileNameInput').value = text;
        
    } catch (e) {
        alert("Naming failed. Check API Key.");
    } finally {
        ui.hide();
    }
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
            handleImageLoad(img, type, null, false); // isGenerated = false
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
    if(layer === 'mask' && !state.mask.loaded) return;
    cacheCurrentLayerState(state.activeLayer);
    state.activeLayer = layer;
    document.getElementById('btn-mask').className = layer === 'mask' ? 'layer-btn active' : (state.mask.loaded ? 'layer-btn' : 'layer-btn disabled');
    document.getElementById('btn-photo').className = layer === 'photo' ? 'layer-btn active' : 'layer-btn';
    render();
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
    const rect = cvs.getBoundingClientRect();
    const m = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    
    if (state.activeLayer === 'mask' && !state.mask.loaded) return;
    if (state.activeLayer === 'photo' && !state.photo.loaded) return;

    const hit = getHitHandle(state[state.activeLayer], m.x, m.y);
    if (hit) {
        state.isDragging = true;
        state.dragAction = hit;
        state.dragStart = m;
        state.initialLayer = { ...state[state.activeLayer] };
    }
});

window.addEventListener('mouseup', () => state.isDragging = false);

cvs.addEventListener('mousemove', e => {
    if (!state.isDragging) return;
    const rect = cvs.getBoundingClientRect();
    const m = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
        layer.rot = angle + Math.PI/2;
    } else {
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
    const isInch = state.unit === 'in';
    const valW = isInch ? state.export.width / 25.4 : state.export.width;
    const valH = isInch ? state.export.height / 25.4 : state.export.height;
    document.getElementById('inpWidth').value = valW.toFixed(1);
    document.getElementById('inpHeight').value = valH.toFixed(1);
}

function updateDims(changed) {
    const isInch = state.unit === 'in';
    let valW = parseFloat(document.getElementById('inpWidth').value);
    let valH = parseFloat(document.getElementById('inpHeight').value);
    if (isInch) { valW *= 25.4; valH *= 25.4; }

    const aspect = state.mask.w ? (state.mask.w / state.mask.h) : 1;

    if (changed === 'w') {
        state.export.width = valW;
        state.export.height = valW / aspect;
    } else {
        state.export.height = valH;
        state.export.width = valH * aspect;
    }
    updateInputsFromState();
    updateExportGridReadout();
}

function updateUnitDisplay() {
    state.unit = document.getElementById('unitSelect').value;
    updateInputsFromState();
}

function updateLivePreviews() {
    if (!state.pixelData) return;
    generateLayers();
}

function updateBorderDisplay(val) {
    document.getElementById('borderVal').innerText = val + 'mm';
    state.export.border = parseFloat(val);
    if (state.pixelData) updateLivePreviews();
}

function updatePixelSizeDisplay(val) {
    const v = parseFloat(val);
    state.export.pixelSizeMm = v;
    const el = document.getElementById('pixelSizeVal');
    const gridEl = document.getElementById('exportGridVal');
    if (el) el.innerText = v + ' mm';
    updateExportGridReadout();
}

function updateExportGridReadout() {
    const el = document.getElementById('exportGridVal');
    if (!el) return;
    const w = state.export.width;
    const h = state.export.height;
    const ps = state.export.pixelSizeMm || 0.2;
    const exportW = Math.max(1, Math.min(2000, Math.round(w / ps)));
    const exportH = Math.max(1, Math.min(2000, Math.round(h / ps)));
    el.innerText = 'Export grid: ' + exportW + ' × ' + exportH + ' px';
}

// --- RENDER ENGINE ---
function render(showGizmos = true) {
    ctx.clearRect(0,0,cvs.width, cvs.height);
    
    if (state.photo.loaded) drawLayer(state.photo, false);

    ctx.save();
    setTransform(state.mask);
    
    if (state.mask.loaded) {
        ctx.globalCompositeOperation = 'destination-in';
        const imgToDraw = state.mask.alphaCanvas;
        ctx.drawImage(imgToDraw, -state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
        // VISUAL BORDER REMOVED from Edit Canvas per request
    } else {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = '#000';
        ctx.fillRect(-state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
    }
    
    ctx.globalCompositeOperation = 'source-over';
    
    // Outline - Only draw if showGizmos is true
    if (showGizmos) {
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
    }
    ctx.restore();

    // 3. Draw Gizmos
    if (!showGizmos) return;

    const active = state[state.activeLayer];
    if (active && (active.loaded || state.activeLayer === 'mask')) {
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
    if(imgToDraw) ctx.drawImage(imgToDraw, -layer.w/2, -layer.h/2, layer.w, layer.h);
    ctx.restore();
}

// --- GENERATION (CMYK SPLIT & DATA CAPTURE) ---
function generateLayers() {
    if(!state.photo.loaded) { alert("Please upload a Photo first."); return; }
    
    // Hide Gizmos for Capture
    render(false);

    const btn = document.getElementById('btnDownload');
    btn.disabled = false;
    btn.innerText = "Download";
    btn.style.background = "#00d26a";
    btn.style.color = "#000";

    const totalPixels = cvs.width * cvs.height;
    state.export.pixelStep = (totalPixels > 2000000) ? 3 : 2; 
    state.export.border = parseFloat(document.getElementById('borderInput').value) || 0;

    const w = cvs.width;
    const h = cvs.height;
    const data = ctx.getImageData(0,0,w,h).data;

    let minX = w, maxX = 0; 
    let minY = h, maxY = 0;
    
    state.pixelData = { 
        width: w, height: h,
        c: new Uint8Array(w * h), m: new Uint8Array(w * h), y: new Uint8Array(w * h), w: new Uint8Array(w * h),
        mask: new Uint8Array(w * h),
        interior: new Uint8Array(w * h),
        maskBounds: { width: w } 
    };

    // 1. Initial Pass
    for (let y=0; y<h; y++) {
        for (let x=0; x<w; x++) {
            const i = (y * w + x) * 4;
            const p = y * w + x;
            
            if (data[i+3] > 10) {
                state.pixelData.mask[p] = 1;
                state.pixelData.interior[p] = 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                
                const r = data[i]; const g = data[i+1]; const b = data[i+2];
                state.pixelData.c[p] = 255 - r;
                state.pixelData.m[p] = 255 - g;
                state.pixelData.y[p] = 255 - b;
                state.pixelData.w[p] = 255 - (r*0.299 + g*0.587 + b*0.114);
            } else {
                state.pixelData.mask[p] = 0;
            }
        }
    }
    
    let bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    state.pixelData.maskBounds.width = bounds.w;
    
    // 2. Shape-Aware Border Logic (Distance Field)
    if(state.export.border > 0 && state.mask.loaded) {
        const pxPerMM = bounds.w / state.export.width;
        const borderPx = state.export.border * pxPerMM;
        
        // Compute Distance from Mask=1 set
        const dist = new Float32Array(w * h).fill(999999);
        
        // Init
        for(let p=0; p<w*h; p++) {
            if(state.pixelData.mask[p] === 1) dist[p] = 0;
        }
        
        // Chamfer Distance Pass 1 (TL -> BR)
        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                const idx = y*w+x;
                if(dist[idx] > 0) {
                    let d = dist[idx];
                    if(x>0) d = Math.min(d, dist[idx-1] + 1);
                    if(y>0) d = Math.min(d, dist[idx-w] + 1);
                    dist[idx] = d;
                }
            }
        }
        
        // Pass 2 (BR -> TL)
        for(let y=h-1; y>=0; y--) {
            for(let x=w-1; x>=0; x--) {
                const idx = y*w+x;
                if(dist[idx] > 0) {
                    let d = dist[idx];
                    if(x<w-1) d = Math.min(d, dist[idx+1] + 1);
                    if(y<h-1) d = Math.min(d, dist[idx+w] + 1);
                    dist[idx] = d;
                }
                
                // BORDER EXPANSION
                if(dist[idx] <= borderPx && dist[idx] > 0) {
                    state.pixelData.mask[idx] = 1;
                    state.pixelData.c[idx] = 0;
                    state.pixelData.m[idx] = 0;
                    state.pixelData.y[idx] = 0;
                    state.pixelData.w[idx] = 255; // Pure White
                    
                    // Update Bounds to include new border pixels
                    if(x < minX) minX = x;
                    if(x > maxX) maxX = x;
                    if(y < minY) minY = y;
                    if(y > maxY) maxY = y;
                }
            }
        }
    } else if (state.export.border > 0) {
        // Fallback for Rect
        const pxPerMM = bounds.w / state.export.width;
        const borderPx = state.export.border * pxPerMM;
        
        const bx = Math.floor(bounds.x - borderPx);
        const by = Math.floor(bounds.y - borderPx);
        const bw = Math.floor(bounds.w + borderPx*2);
        const bh = Math.floor(bounds.h + borderPx*2);
        
        for(let y=by; y<by+bh; y++) {
            for(let x=bx; x<bx+bw; x++) {
                if(x>=0 && x<w && y>=0 && y<h) {
                    const idx = y*w+x;
                    // If currently 0, make it border
                    if(state.pixelData.mask[idx] === 0) {
                        state.pixelData.mask[idx] = 1;
                        state.pixelData.c[idx] = 0;
                        state.pixelData.m[idx] = 0;
                        state.pixelData.y[idx] = 0;
                        state.pixelData.w[idx] = 255;
                        
                        // Update bounds
                        if(x < minX) minX = x;
                        if(x > maxX) maxX = x;
                        if(y < minY) minY = y;
                        if(y > maxY) maxY = y;
                    }
                }
            }
        }
    }
    
    // Update bounds object for cropping with new border dims
    bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    state.pixelData.bounds = bounds;

    state.pixelData.dist = null; // Clear if used locally or store?
    // We actually need dist for live slider if we want to change border WITHOUT re-gen...
    // But currently we re-gen border pixels into mask=1.
    // So 'live slider' requires re-running generateLayers essentially?
    // The current updateLivePreviews relies on mask=1 being set.
    // Let's store dist if available.

    // 3. Update Previews (Clean)
    const renderPreview = (id, dataChannel) => {
        const cvs = document.getElementById(id);
        const ctx = cvs.getContext('2d');
        cvs.width = bounds.w;
        cvs.height = bounds.h;
        const imgData = ctx.createImageData(bounds.w, bounds.h);
        const useInterior = (dataChannel === 'c' || dataChannel === 'm' || dataChannel === 'y');
        const vis = useInterior ? state.pixelData.interior : state.pixelData.mask;
        
        for (let y = 0; y < bounds.h; y++) {
            for (let x = 0; x < bounds.w; x++) {
                const srcIdx = ((y + bounds.y) * w + (x + bounds.x));
                const dstIdx = (y * bounds.w + x) * 4;
                
                if (srcIdx >= 0 && srcIdx < w*h && vis[srcIdx] === 1) {
                    const val = state.pixelData[dataChannel][srcIdx];
                    if (dataChannel === 'c') setPxRGB(imgData, dstIdx, 255-val, 255, 255);
                    else if (dataChannel === 'm') setPxRGB(imgData, dstIdx, 255, 255-val, 255);
                    else if (dataChannel === 'y') setPxRGB(imgData, dstIdx, 255, 255, 255-val);
                    else setPxRGB(imgData, dstIdx, val, val, val); 
                } else {
                    imgData.data[dstIdx+3] = 0;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    };

    ['c','m','y','w'].forEach(k => renderPreview(k + 'Canvas', k));
    
    // Composite Preview
    const refCvs = document.getElementById('refCanvas');
    const refCtx = refCvs.getContext('2d');
    refCvs.width = bounds.w;
    refCvs.height = bounds.h;
    
    const compData = refCtx.createImageData(bounds.w, bounds.h);
    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            const srcIdx = ((y + bounds.y) * w + (x + bounds.x));
            const dstIdx = (y * bounds.w + x) * 4;
            
            if (srcIdx >= 0 && srcIdx < w*h && state.pixelData.mask[srcIdx] === 1) {
                const r = 255 - state.pixelData.c[srcIdx];
                const g = 255 - state.pixelData.m[srcIdx];
                const b = 255 - state.pixelData.y[srcIdx];
                
                compData.data[dstIdx] = r;
                compData.data[dstIdx+1] = g;
                compData.data[dstIdx+2] = b;
                compData.data[dstIdx+3] = 255;
            } else {
                compData.data[dstIdx+3] = 0;
            }
        }
    }
    refCtx.putImageData(compData, 0, 0);

    // Restore Gizmos
    render(true);
}

function setPxRGB(imgData, i, r, g, b) {
    imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = 255;
}


// --- ASYNC STL ZIP EXPORT (PIXEstL port) ---
const ui = {
    overlay: document.getElementById('progressOverlay'),
    bar: document.getElementById('progressBar'),
    text: document.getElementById('progressText'),
    sub: document.getElementById('progressSub'),
    update: (pct, msg, sub) => {
        ui.bar.style.width = pct + '%';
        if(msg) ui.text.innerText = msg;
        if(sub) ui.sub.innerText = sub;
    },
    show: () => ui.overlay.style.display = 'flex',
    hide: () => ui.overlay.style.display = 'none'
};

const yieldToUI = () => new Promise(r => setTimeout(r, 0));

function getExportOpts() {
    return {
        widthMm: state.export.width,
        heightMm: state.export.height,
        hasTransparency: !!state.mask.loaded,
        plateThickness: 0.2,
        textureMinThickness: 0.8,
        textureMaxThickness: 2.7,
        whiteBaseMm: 1,
        texturePixelWidth: 0.25,
        colorPixelWidth: 0.8,
        colorPixelLayerThickness: 0.1,
        colorPixelLayerNumber: 5
    };
}

function resamplePixelDataForExport(pd, widthMm, heightMm, pixelSizeMm) {
    const bounds = pd.bounds;
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return pd;
    const ps = Math.max(0.01, pixelSizeMm);
    let exportW = Math.max(1, Math.round(widthMm / ps));
    let exportH = Math.max(1, Math.round(heightMm / ps));
    exportW = Math.min(2000, exportW);
    exportH = Math.min(2000, exportH);

    const c = new Uint8Array(exportW * exportH);
    const m = new Uint8Array(exportW * exportH);
    const y = new Uint8Array(exportW * exportH);
    const w = new Uint8Array(exportW * exportH);
    const mask = new Uint8Array(exportW * exportH);
    const interior = new Uint8Array(exportW * exportH);

    const srcW = pd.width;
    const b = bounds;

    for (let ey = 0; ey < exportH; ey++) {
        for (let ex = 0; ex < exportW; ex++) {
            const sx = (ex + 0.5) * b.w / exportW - 0.5;
            const sy = (ey + 0.5) * b.h / exportH - 0.5;
            let ix = Math.round(sx);
            let iy = Math.round(sy);
            ix = Math.max(0, Math.min(b.w - 1, ix));
            iy = Math.max(0, Math.min(b.h - 1, iy));
            const srcIdx = (b.y + iy) * srcW + (b.x + ix);
            const dstIdx = ey * exportW + ex;

            c[dstIdx] = pd.c[srcIdx];
            m[dstIdx] = pd.m[srcIdx];
            y[dstIdx] = pd.y[srcIdx];
            w[dstIdx] = pd.w[srcIdx];
            mask[dstIdx] = pd.mask[srcIdx];
            interior[dstIdx] = pd.interior ? pd.interior[srcIdx] : pd.mask[srcIdx];
        }
    }

    return {
        width: exportW,
        height: exportH,
        bounds: { x: 0, y: 0, w: exportW, h: exportH },
        maskBounds: { width: exportW },
        c, m, y, w, mask, interior
    };
}

async function buildAllMeshes() {
    const pd = state.pixelData;
    const bounds = pd.bounds;
    if (!bounds) return null;
    const opts = getExportOpts();
    const pixelSizeMm = state.export.pixelSizeMm ?? 0.2;
    const pdExport = resamplePixelDataForExport(pd, opts.widthMm, opts.heightMm, pixelSizeMm);

    ui.update(10, "Building plate...");
    await yieldToUI();
    const plateFacets = PIXESTL_STL.buildPlate(pdExport, opts);

    ui.update(30, "Building texture layer...");
    await yieldToUI();
    const textureFacets = PIXESTL_STL.buildTextureLayer(pdExport, opts);

    const colorChannels = [
        { channel: "c", name: "Cyan" },
        { channel: "m", name: "Magenta" },
        { channel: "y", name: "Yellow" }
    ];
    const cyanFacets = [];
    const magentaFacets = [];
    const yellowFacets = [];
    for (let i = 0; i < colorChannels.length; i++) {
        const { channel, name } = colorChannels[i];
        ui.update(40 + (i + 1) * 15, `Building ${name}...`);
        await yieldToUI();
        const facets = PIXESTL_STL.buildColorLayerAsHeightField(pdExport, channel, opts, { useInteriorOnly: true });
        const dst = channel === "c" ? cyanFacets : channel === "m" ? magentaFacets : yellowFacets;
        for (let k = 0; k < facets.length; k++) dst.push(facets[k]);
    }

    return {
        opts,
        plateFacets,
        textureFacets,
        cyanFacets,
        magentaFacets,
        yellowFacets
    };
}

function facetsTo3mfMesh(facets) {
    const vertexChunks = [];
    const triangleChunks = [];
    const fmt = (v) => `x="${Number(v[0]).toFixed(6)}" y="${Number(v[1]).toFixed(6)}" z="${Number(v[2]).toFixed(6)}"`;
    for (let i = 0; i < facets.length; i++) {
        const [v0, v1, v2] = facets[i];
        const base = i * 3;
        vertexChunks.push(`        <vertex ${fmt(v0)} />\n`, `        <vertex ${fmt(v1)} />\n`, `        <vertex ${fmt(v2)} />\n`);
        triangleChunks.push(`        <triangle v1="${base}" v2="${base + 1}" v3="${base + 2}" />\n`);
    }
    return { vertexChunks, triangleChunks };
}

function exportDownload() {
    const format = document.getElementById("exportFormat")?.value || "stlzip";
    if (format === "3mf") exportTo3mf();
    else exportToStlZip();
}

async function downloadStlsIndividually(fname, built) {
    const toBlob = (parts) => new Blob(parts, { type: "text/plain" });
    const files = [
        ["layer-plate.stl", "layer-plate", built.plateFacets],
        ["layer-texture-White.stl", "layer-texture-White", built.textureFacets],
        ["layer-Cyan.stl", "layer-Cyan", built.cyanFacets],
        ["layer-Magenta.stl", "layer-Magenta", built.magentaFacets],
        ["layer-Yellow.stl", "layer-Yellow", built.yellowFacets]
    ];
    for (const [filename, solidName, facets] of files) {
        if (!facets || facets.length === 0) continue;
        const parts = PIXESTL_STL.writeStlAscii(solidName, facets);
        const blob = toBlob(parts);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fname + "-" + filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        await new Promise((r) => setTimeout(r, 150));
    }
}

async function exportToStlZip() {
    let built = null;
    try {
        if (!window.JSZip || !state.pixelData || !window.PIXESTL_STL) return;
        const fname = document.getElementById("fileNameInput").value.replace(/[^a-z0-9]/gi, "_") || "Lithophane";

        ui.show();
        ui.update(0, "Initializing...");
        await yieldToUI();

        built = await buildAllMeshes();
        if (!built) {
            ui.hide();
            alert("Generate previews first.");
            return;
        }

        const { plateFacets, textureFacets, cyanFacets, magentaFacets, yellowFacets } = built;
        const zip = new JSZip();
        const toBlob = (parts) => new Blob(parts, { type: "text/plain" });
        zip.file("layer-plate.stl", toBlob(PIXESTL_STL.writeStlAscii("layer-plate", plateFacets)));
        zip.file("layer-texture-White.stl", toBlob(PIXESTL_STL.writeStlAscii("layer-texture-White", textureFacets)));
        if (cyanFacets.length) zip.file("layer-Cyan.stl", toBlob(PIXESTL_STL.writeStlAscii("layer-Cyan", cyanFacets)));
        if (magentaFacets.length) zip.file("layer-Magenta.stl", toBlob(PIXESTL_STL.writeStlAscii("layer-Magenta", magentaFacets)));
        if (yellowFacets.length) zip.file("layer-Yellow.stl", toBlob(PIXESTL_STL.writeStlAscii("layer-Yellow", yellowFacets)));

        ui.update(90, "Compressing...");
        await yieldToUI();
        const content = await zip.generateAsync({ type: "blob" }, (meta) => {
            ui.update(90 + meta.percent * 0.1, "Packaging STL ZIP...");
        });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = fname + ".zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        ui.hide();
    } catch (error) {
        ui.hide();
        const allocationFailed = /array buffer allocation failed|allocation failed/i.test(error.message);
        if (built && allocationFailed) {
            ui.show();
            ui.update(50, "ZIP too large...", "Downloading each layer as separate STL files.");
            await yieldToUI();
            await downloadStlsIndividually(document.getElementById("fileNameInput").value.replace(/[^a-z0-9]/gi, "_") || "Lithophane", built);
            ui.hide();
            alert("ZIP was too large for one file. Each layer has been downloaded as a separate STL.");
        } else {
            alert("Export failed: " + error.message);
        }
        console.error("Export error:", error);
    }
}

async function exportTo3mf() {
    try {
        if (!window.JSZip || !state.pixelData || !window.PIXESTL_STL) return;
        const fname = document.getElementById("fileNameInput").value.replace(/[^a-z0-9]/gi, "_") || "Lithophane";

        ui.show();
        ui.update(0, "Initializing...");
        await yieldToUI();

        const built = await buildAllMeshes();
        if (!built) {
            ui.hide();
            alert("Generate previews first.");
            return;
        }

        const { plateFacets, textureFacets, cyanFacets, magentaFacets, yellowFacets } = built;
        const objects = [
            { id: 1, name: "layer-plate", facets: plateFacets },
            { id: 2, name: "layer-texture-White", facets: textureFacets },
            { id: 3, name: "layer-Cyan", facets: cyanFacets },
            { id: 4, name: "layer-Magenta", facets: magentaFacets },
            { id: 5, name: "layer-Yellow", facets: yellowFacets }
        ];

        const modelChunks = [
            '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n  <metadata name="Application">LithoLab</metadata>\n  <resources>\n'
        ];
        const buildChunks = [];
        for (const obj of objects) {
            if (obj.facets.length === 0) continue;
            const { vertexChunks, triangleChunks } = facetsTo3mfMesh(obj.facets);
            modelChunks.push(`    <object id="${obj.id}" type="model">\n      <mesh>\n        <vertices>\n`);
            for (let k = 0; k < vertexChunks.length; k++) modelChunks.push(vertexChunks[k]);
            modelChunks.push(`        </vertices>\n        <triangles>\n`);
            for (let k = 0; k < triangleChunks.length; k++) modelChunks.push(triangleChunks[k]);
            modelChunks.push(`        </triangles>\n      </mesh>\n    </object>\n`);
            buildChunks.push(`  <item objectid="${obj.id}" />\n`);
        }
        modelChunks.push('  </resources>\n  <build>\n');
        for (let k = 0; k < buildChunks.length; k++) modelChunks.push(buildChunks[k]);
        modelChunks.push('  </build>\n</model>\n');

        const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

        const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/3dmodel.model" Id="rel0"/>
</Relationships>`;

        ui.update(95, "Packaging .3MF...");
        await yieldToUI();

        const zip = new JSZip();
        zip.file("[Content_Types].xml", contentTypesXml);
        zip.file("_rels/.rels", relsXml);
        zip.file("3D/3dmodel.model", new Blob(modelChunks, { type: "application/xml" }));

        const content = await zip.generateAsync({ type: "blob" });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = fname + ".3mf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        ui.hide();
    } catch (error) {
        ui.hide();
        const allocationFailed = /array buffer allocation failed|allocation failed/i.test(error.message);
        if (allocationFailed) {
            alert("3MF export too large for this model. Use STL ZIP instead; if the ZIP is too large, each layer will download as a separate STL.");
        } else {
            alert("Export failed: " + error.message);
        }
        console.error("Export error:", error);
    }
}

init();
