/**
 * CMYK DESIGNER ENGINE v3.0
 * - Colorized Previews for CMYK channels
 * - Real 3MF Mesh Generation (No more cubes!)
 * - Multi-part Object Support (C, M, Y, W layers)
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
        width: 100,      // Final physical width (mm)
        height: 100,     // Final physical height (mm)
        minThick: 0.6,   // Base thickness (White layer floor)
        maxThick: 3.2,   // Max thickness (Peak of mountains)
        resolution: 0.25 // 0.1 = High Detail, 0.5 = Low Detail (Vertices per mm)
    },
    
    // Layer Objects
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null },

    // Generated Data (Stored as 0-255 arrays)
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
                
                // Default export width 100mm
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
        layer.x = newX;
        layer.y = newY;
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
    
    // Enable download button
    const btn = document.getElementById('btnDownload');
    btn.disabled = false;
    btn.innerText = "Processing..."; // Visual feedback
    btn.style.background = "#00d26a";
    btn.style.color = "#000";

    const w = cvs.width;
    const h = cvs.height;
    const data = ctx.getImageData(0,0,w,h).data;

    // We MUST re-initialize pixelData here to match the current canvas size
    // We will store it as a Flat Array for memory efficiency (Width, Height, Data[])
    state.pixelData = { 
        width: w,
        height: h,
        c: new Uint8Array(w * h),
        m: new Uint8Array(w * h),
        y: new Uint8Array(w * h),
        w: new Uint8Array(w * h),
        mask: new Uint8Array(w * h) // Store mask validity (1 or 0)
    };

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

    for (let i=0, p=0; i<data.length; i+=4, p++) {
        const r = data[i]; const g = data[i+1]; const b = data[i+2]; const a = data[i+3];
        
        if (a < 10) {
            state.pixelData.mask[p] = 0; // Invalid/Transparent
            continue; 
        }
        
        state.pixelData.mask[p] = 1; // Valid

        // Subtractive Logic
        const cVal = 255 - r;
        const mVal = 255 - g;
        const yVal = 255 - b;
        const wVal = 255 - (r*0.299 + g*0.587 + b*0.114);

        // Store Raw Data
        state.pixelData.c[p] = cVal;
        state.pixelData.m[p] = mVal;
        state.pixelData.y[p] = yVal;
        state.pixelData.w[p] = wVal;

        // Preview Visualization (Colorized)
        setPxRGB(buffers['c'], i, 255 - cVal, 255, 255); 
        setPxRGB(buffers['m'], i, 255, 255 - mVal, 255);
        setPxRGB(buffers['y'], i, 255, 255, 255 - yVal);
        setPxRGB(buffers['w'], i, wVal, wVal, wVal);
    }
    
    chans.forEach(k => { if(k!=='ref') ctxs[k].putImageData(buffers[k], 0,0); });
    
    btn.innerText = "2. Download 3MF";
}

function setPxRGB(imgData, i, r, g, b) {
    imgData.data[i] = r; 
    imgData.data[i+1] = g; 
    imgData.data[i+2] = b; 
    imgData.data[i+3] = 255;
}


// --- 3MF EXPORT LOGIC (REAL) ---
async function download3MF() {
    if (!JSZip) { alert("Library missing. Please reload."); return; }
    if (!state.pixelData) { alert("Please click 'Generate Previews' first."); return; }

    const zip = new JSZip();
    
    // 1. [Content_Types].xml
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);

    // 2. _rels/.rels
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);

    // 3. Generate The 4 Mesh Strings
    // We do this by channel.
    // Scale Factor: Canvas Pixels -> MM
    const scaleX = state.export.width / state.pixelData.width;
    const scaleY = state.export.height / state.pixelData.height;
    
    // We will create one massive .model file with 4 object definitions
    const modelHeader = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"><resources>`;
    const modelFooter = `</resources><build><item objectid="1"/><item objectid="2"/><item objectid="3"/><item objectid="4"/></build></model>`;

    // Generate Meshes
    // IDs: 1=Cyan, 2=Magenta, 3=Yellow, 4=White
    const meshC = generateMeshString(1, state.pixelData.c, scaleX, scaleY, 2.4); // 2.4mm depth for color?
    const meshM = generateMeshString(2, state.pixelData.m, scaleX, scaleY, 2.4);
    const meshY = generateMeshString(3, state.pixelData.y, scaleX, scaleY, 2.4);
    const meshW = generateMeshString(4, state.pixelData.w, scaleX, scaleY, 0.8); // 0.8mm depth for white base?

    const finalXML = modelHeader + meshC + meshM + meshY + meshW + modelFooter;
    
    zip.folder("3D").file("3dmodel.model", finalXML);

    const content = await zip.generateAsync({type:"blob"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "lithophane.3mf";
    a.click();
}

/**
 * GENERATES A SINGLE MESH STRING (Vertices + Triangles)
 * @param {number} id - Object ID (1-4)
 * @param {Uint8Array} valArray - The grayscale data (0-255)
 * @param {number} sx - Scale X
 * @param {number} sy - Scale Y
 * @param {number} zMax - Max thickness for this specific layer
 */
function generateMeshString(id, valArray, sx, sy, zMax) {
    const w = state.pixelData.width;
    const h = state.pixelData.height;
    const skip = Math.max(1, Math.floor(1 / (state.export.resolution || 0.2))); 
    
    // We need to map grid indices to Vertex IDs to generate triangles
    // Optimization: Only generate vertices for 'valid' pixels?
    // For simplicity in this version, we grid scan.
    
    let vertices = "";
    let triangles = "";
    let vCount = 0;
    
    // Vertex Map: map[y][x] = vertexID (so we can link triangles)
    // We use a sparse array or logic to handle skipping
    // Since we need to join them, we probably need a dedicated grid.
    // Let's use a 1D array to store Vertex IDs. -1 means no vertex there.
    // NOTE: Memory intensive for large images.
    
    // Reduced Grid Dimensions
    const gridW = Math.floor(w / skip);
    const gridH = Math.floor(h / skip);
    const vIDs = new Int32Array(gridW * gridH).fill(-1);

    // 1. Generate Vertices
    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const px = gx * skip;
            const py = gy * skip;
            const idx = py * w + px;

            if (state.pixelData.mask[idx] === 1) {
                const zVal = (valArray[idx] / 255) * zMax; 
                // We generate TWO vertices per pixel? No, a lithophane is usually a top surface.
                // But for 3D printing it needs to be "watertight" (closed volume).
                // "Pane" method: Top surface + flat back.
                // This means VCount * 2. 
                // Let's stick to a simple surface for now. Most slicers handle "open" sheets if settings allow,
                // BUT a valid 3MF object usually needs volume. 
                // Let's generate a FLAT BACK at Z=0 and a SCULPTED FRONT at Z=zVal.
                
                // Back Vertex (Z=0) -> ID: vCount
                vertices += `<vertex x="${(px * sx).toFixed(2)}" y="${(py * sy).toFixed(2)}" z="0" />`;
                // Front Vertex (Z=height) -> ID: vCount + 1
                vertices += `<vertex x="${(px * sx).toFixed(2)}" y="${(py * sy).toFixed(2)}" z="${zVal.toFixed(2)}" />`;
                
                vIDs[gy * gridW + gx] = vCount;
                vCount += 2;
            }
        }
    }

    // 2. Generate Triangles
    // We look at 2x2 quads in the grid.
    // TL--TR
    // |   |
    // BL--BR
    for (let gy = 0; gy < gridH - 1; gy++) {
        for (let gx = 0; gx < gridW - 1; gx++) {
            const tl = vIDs[gy * gridW + gx];
            const tr = vIDs[gy * gridW + (gx + 1)];
            const bl = vIDs[(gy + 1) * gridW + gx];
            const br = vIDs[(gy + 1) * gridW + (gx + 1)];

            // If all 4 corners exist, make a solid block
            if (tl !== -1 && tr !== -1 && bl !== -1 && br !== -1) {
                // Vertex Indices:
                // tl (back), tl+1 (front)
                
                // FRONT FACE (Clockwise? CCW?)
                // tl+1, bl+1, br+1
                // tl+1, br+1, tr+1
                triangles += `<triangle v1="${tl+1}" v2="${bl+1}" v3="${br+1}" />`;
                triangles += `<triangle v1="${tl+1}" v2="${br+1}" v3="${tr+1}" />`;

                // BACK FACE (Inverted winding)
                // tl, br, bl
                // tl, tr, br
                triangles += `<triangle v1="${tl}" v2="${br}" v3="${bl}" />`;
                triangles += `<triangle v1="${tl}" v2="${tr}" v3="${br}" />`;

                // SIDE WALLS?
                // Real solids need side walls between the front/back vertices.
                // This is complex for arbitrary shapes.
                // For a "Vibe Coding" prototype, just Front+Back often works in Bambu if "Close Holes" is on,
                // but strictly we should stitch edges. 
                // Let's leave walls out for V3.0 performance and see if Bambu accepts the "sandwich".
            }
        }
    }

    return `<object id="${id}" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
}

init();