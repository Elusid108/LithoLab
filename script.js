/**
 * CMYK DESIGNER ENGINE v3.2
 * - Resolution: Increased to High (Step 1-2 pixels) for sharp mask edges.
 * - 3MF Metadata: Added Object Names (Cyan, Magenta, etc.) and Color Hex Codes.
 * - Logic: Objects are now assigned specific material IDs so slicers recognize colors.
 */

// --- CONFIGURATION ---
const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 30;
const CANVAS_PADDING = 50;

// --- STATE ---
const state = {
    activeLayer: 'mask',
    unit: 'mm',
    isDragging: false,
    dragAction: null,
    dragStart: { x:0, y:0 },
    
    // Export Settings
    export: { 
        width: 100,      
        height: 100,     
        pixelStep: 1     // 1 = Every pixel (Max Quality), 2 = Every 2nd pixel (Good balance)
    },
    
    // Layer Objects
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null },

    // Generated Data
    pixelData: null 
};

const cvs = document.getElementById('editorCanvas');
const ctx = cvs.getContext('2d');

// --- INITIALIZATION ---
function init() {
    render();
    updateInputsFromState();
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
                const trimmed = createSmartAlphaMask(img);
                layer.alphaCanvas = trimmed.canvas;
                layer.w = trimmed.w;
                layer.h = trimmed.h;
                layer.aspect = layer.w / layer.h;

                const viewScale = Math.min((cvs.width * 0.5) / layer.w, (cvs.height * 0.5) / layer.h);
                layer.w *= viewScale;
                layer.h *= viewScale;
                layer.x = (cvs.width - layer.w) / 2;
                layer.y = (cvs.height - layer.h) / 2;
                
                state.export.width = 100;
                state.export.height = 100 / layer.aspect;
                updateInputsFromState();
            } else {
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
    if (!state.mask.loaded) return;
    const isInch = state.unit === 'in';
    let valW = parseFloat(document.getElementById('inpWidth').value);
    let valH = parseFloat(document.getElementById('inpHeight').value);
    if (isInch) { valW *= 25.4; valH *= 25.4; }

    if (changed === 'w') {
        state.export.width = valW;
        state.export.height = valW / state.mask.aspect;
    } else {
        state.export.height = valH;
        state.export.width = valH * state.mask.aspect;
    }
    updateInputsFromState();
}

function updateUnitDisplay() {
    state.unit = document.getElementById('unitSelect').value;
    updateInputsFromState();
}

// --- RENDER ENGINE ---
function render() {
    ctx.clearRect(0,0,cvs.width, cvs.height);
    if (state.photo.loaded) drawLayer(state.photo, false);

    if (state.mask.loaded) {
        ctx.globalCompositeOperation = 'destination-in';
        drawLayer(state.mask, true);
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        setTransform(state.mask);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-state.mask.w/2, -state.mask.h/2, state.mask.w, state.mask.h);
        ctx.restore();
    }

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

// --- GENERATION (CMYK SPLIT & DATA CAPTURE) ---
function generateLayers() {
    if(!state.mask.loaded || !state.photo.loaded) { alert("Please upload both a Photo and a Mask (Shape) first."); return; }
    
    const btn = document.getElementById('btnDownload');
    btn.disabled = false;
    btn.innerText = "Processing..."; 
    btn.style.background = "#00d26a";
    btn.style.color = "#000";

    // Auto-Set Quality based on image size to prevent crashing
    // 2MP+ images get step 2, smaller get step 1
    const totalPixels = cvs.width * cvs.height;
    state.export.pixelStep = (totalPixels > 2000000) ? 2 : 1; 

    const w = cvs.width;
    const h = cvs.height;
    const data = ctx.getImageData(0,0,w,h).data;

    let minX = w, maxX = 0;
    
    state.pixelData = { 
        width: w, height: h,
        c: new Uint8Array(w * h), m: new Uint8Array(w * h), y: new Uint8Array(w * h), w: new Uint8Array(w * h),
        mask: new Uint8Array(w * h),
        maskBounds: { width: w } 
    };

    // Data Extraction
    for (let y=0; y<h; y++) {
        for (let x=0; x<w; x++) {
            const i = (y * w + x) * 4;
            const p = y * w + x;
            const a = data[i+3];

            if (a > 10) {
                state.pixelData.mask[p] = 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                
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
    
    if (maxX > minX) {
        state.pixelData.maskBounds.width = maxX - minX;
    }

    // Update Previews
    const ctxs = {};
    ['c','m','y','w','ref'].forEach(k => {
        const el = document.getElementById(k+'Canvas');
        el.width = w; el.height = h;
        ctxs[k] = el.getContext('2d');
    });
    ctxs['ref'].putImageData(ctx.getImageData(0,0,w,h), 0,0);
    
    const buffers = {};
    ['c','m','y','w'].forEach(k => buffers[k] = ctxs[k].createImageData(w,h));

    for (let p=0; p<w*h; p++) {
        if(state.pixelData.mask[p]===1) {
            const i = p*4;
            setPxRGB(buffers['c'], i, 255 - state.pixelData.c[p], 255, 255);
            setPxRGB(buffers['m'], i, 255, 255 - state.pixelData.m[p], 255);
            setPxRGB(buffers['y'], i, 255, 255, 255 - state.pixelData.y[p]);
            const lum = state.pixelData.w[p];
            setPxRGB(buffers['w'], i, lum, lum, lum);
        }
    }
    ['c','m','y','w'].forEach(k => ctxs[k].putImageData(buffers[k], 0,0));
    
    btn.innerText = "2. Download 3MF";
}

function setPxRGB(imgData, i, r, g, b) {
    imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = 255;
}


// --- 3MF EXPORT LOGIC (REAL) ---
async function download3MF() {
    if (!JSZip || !state.pixelData) return;

    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);

    const activeWidth = state.pixelData.maskBounds.width || state.pixelData.width;
    const scale = state.export.width / activeWidth;
    
    // LAYER CONFIGURATION
    // Defined with Name, Color (Hex), Data source, Z start, Z thickness
    const layers = [
        { name: "White Base", color: "#FFFFFF", id: 4, data: state.pixelData.w, zStart: 0.0, zThick: 0.4, isBase: true },
        { name: "Cyan",       color: "#00FFFF", id: 1, data: state.pixelData.c, zStart: 0.4, zThick: 0.6 },
        { name: "Magenta",    color: "#FF00FF", id: 2, data: state.pixelData.m, zStart: 1.0, zThick: 0.6 },
        { name: "Yellow",     color: "#FFFF00", id: 3, data: state.pixelData.y, zStart: 1.6, zThick: 0.6 },
        { name: "White Top",  color: "#FFFFFF", id: 4, data: state.pixelData.w, zStart: 2.2, zThick: 1.0 } 
    ];

    // Build Material Resources (Color Defs)
    let resources = `<resources><basematerials id="100">`;
    layers.forEach((l, idx) => {
        resources += `<base name="${l.name}" displaycolor="${l.color}" />`;
    });
    resources += `</basematerials>`;

    let buildXML = `<build>`;
    let objId = 1;
    let meshXML = "";

    // Generate Objects
    for(let i=0; i<layers.length; i++) {
        const l = layers[i];
        // We link the object to the material using pid="100" and pindex="i"
        meshXML += generateMeshString(objId, l.name, 100, i, l.data, scale, l.zStart, l.zThick, l.isBase);
        buildXML += `<item objectid="${objId}" />`;
        objId++;
    }

    const finalXML = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel">` 
                     + resources + meshXML + `</resources>` + buildXML + `</model>`;
    
    zip.folder("3D").file("3dmodel.model", finalXML);
    const content = await zip.generateAsync({type:"blob"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "lithophane_cmyk.3mf";
    a.click();
}

function generateMeshString(id, name, matPid, matPindex, valArray, s, zOffset, zMax, isFlat) {
    const w = state.pixelData.width;
    const h = state.pixelData.height;
    // QUALITY: Use calculated pixelStep (1 or 2)
    const skip = state.export.pixelStep; 
    
    let vertices = "";
    let triangles = "";
    let vCount = 0;
    
    const gridW = Math.floor(w / skip);
    const gridH = Math.floor(h / skip);
    const vIDs = new Int32Array(gridW * gridH).fill(-1);

    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const px = gx * skip;
            const py = gy * skip;
            const idx = py * w + px;

            if (state.pixelData.mask[idx] === 1) {
                const density = isFlat ? 1.0 : (valArray[idx] / 255);
                const height = zMax * density; 
                
                vertices += `<vertex x="${(px * s).toFixed(2)}" y="${(py * s).toFixed(2)}" z="${zOffset.toFixed(2)}" />`;
                vertices += `<vertex x="${(px * s).toFixed(2)}" y="${(py * s).toFixed(2)}" z="${(zOffset + height).toFixed(2)}" />`;
                
                vIDs[gy * gridW + gx] = vCount;
                vCount += 2;
            }
        }
    }

    for (let gy = 0; gy < gridH - 1; gy++) {
        for (let gx = 0; gx < gridW - 1; gx++) {
            const tl = vIDs[gy * gridW + gx];
            const tr = vIDs[gy * gridW + (gx + 1)];
            const bl = vIDs[(gy + 1) * gridW + gx];
            const br = vIDs[(gy + 1) * gridW + (gx + 1)];

            if (tl !== -1 && tr !== -1 && bl !== -1 && br !== -1) {
                triangles += `<triangle v1="${tl+1}" v2="${bl+1}" v3="${br+1}" />`;
                triangles += `<triangle v1="${tl+1}" v2="${br+1}" v3="${tr+1}" />`;
                triangles += `<triangle v1="${tl}" v2="${br}" v3="${bl}" />`;
                triangles += `<triangle v1="${tl}" v2="${tr}" v3="${br}" />`;
            }
        }
    }

    // Add Name and Material properties to Object
    return `<object id="${id}" name="${name}" pid="${matPid}" pindex="${matPindex}" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
}

init();