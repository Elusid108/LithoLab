/**
 * CMYK DESIGNER ENGINE v2.4
 * - Colorized Previews for CMYK channels
 * - 3MF Export Integration (Using JSZip)
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
    export: { width: 100, height: 100 },
    
    // Layer Objects
    photo: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false },
    mask: { img: null, x: 0, y: 0, w: 0, h: 0, rot: 0, loaded: false, aspect: 1, alphaCanvas: null },

    // Generated Data (for export)
    pixelData: null // Stores the raw {c,m,y,w} arrays for the 3D generator
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

// --- GENERATION (CMYK SPLIT & PREVIEW) ---
function generateLayers() {
    if(!state.mask.loaded || !state.photo.loaded) { alert("Please upload both a Photo and a Mask (Shape) first."); return; }
    
    // Enable download button
    const btn = document.getElementById('btnDownload');
    btn.disabled = false;
    btn.style.background = "#00d26a";
    btn.style.color = "#000";

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

    // Storage for raw data (to use in 3MF generation)
    // We store simplified values (0-255) for export
    state.pixelData = { c: [], m: [], y: [], w: [] };

    for (let i=0; i<data.length; i+=4) {
        const r = data[i]; const g = data[i+1]; const b = data[i+2]; const a = data[i+3];
        
        if (a < 10) {
            // Transparent pixels stay transparent in preview
            continue; 
        }
        
        // Calculate CMYK values (Subtractive)
        // 255 = Full Ink, 0 = No Ink
        const cVal = 255 - r;
        const mVal = 255 - g;
        const yVal = 255 - b;
        const wVal = 255 - (r*0.299 + g*0.587 + b*0.114); // Luminance inverted

        // --- PREVIEW VISUALIZATION (Colorized) ---
        
        // Cyan: Absorbs Red. Show White (255,255,255) minus density in Red channel.
        setPxRGB(buffers['c'], i, 255 - cVal, 255, 255); 

        // Magenta: Absorbs Green.
        setPxRGB(buffers['m'], i, 255, 255 - mVal, 255);

        // Yellow: Absorbs Blue.
        setPxRGB(buffers['y'], i, 255, 255, 255 - yVal);

        // White: Grayscale representation of luminance
        setPxRGB(buffers['w'], i, wVal, wVal, wVal);

        // Store for Export (optimization: store sparse array or run logic again during export?)
        // For now, let's just rely on re-reading the canvas or state during export to save memory
    }
    
    chans.forEach(k => { if(k!=='ref') ctxs[k].putImageData(buffers[k], 0,0); });
}

function setPxRGB(imgData, i, r, g, b) {
    imgData.data[i] = r; 
    imgData.data[i+1] = g; 
    imgData.data[i+2] = b; 
    imgData.data[i+3] = 255; // Always opaque for the preview tile
}


// --- 3MF EXPORT LOGIC ---
async function download3MF() {
    if (!JSZip) { alert("Library missing. Please reload."); return; }
    
    const zip = new JSZip();
    
    // 1. [Content_Types].xml (Standard 3MF/OPC boilerplate)
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`);

    // 2. _rels/.rels
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`);

    // 3. 3D Model XML
    // TODO: This is where the heavy lifting happens. 
    // We need to loop through pixels and generate vertices/triangles.
    // For this prototype, we will generate a simplified placeholder cube.
    const modelXml = generateMeshXML(); 
    
    zip.folder("3D").file("3dmodel.model", modelXml);

    // 4. Generate Zip
    const content = await zip.generateAsync({type:"blob"});
    
    // 5. Trigger Download
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "lithophane.3mf";
    a.click();
}

function generateMeshXML() {
    // Placeholder 3MF XML structure
    // In next phase, we fill <Vertices> and <Triangles> with pixel height data.
    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="10" y="0" z="0"/>
     <vertex x="10" y="10" z="0"/>
     <vertex x="0" y="10" z="0"/>
     <vertex x="0" y="0" z="10"/>
     <vertex x="10" y="0" z="10"/>
     <vertex x="10" y="10" z="10"/>
     <vertex x="0" y="10" z="10"/>
    </vertices>
    <triangles>
     <triangle v1="3" v2="2" v3="1"/>
     <triangle v1="1" v2="0" v3="3"/>
     <triangle v1="4" v2="5" v3="6"/>
     <triangle v1="6" v2="7" v3="4"/>
     <triangle v1="0" v2="1" v3="5"/>
     <triangle v1="5" v2="4" v3="0"/>
     <triangle v1="1" v2="2" v3="6"/>
     <triangle v1="6" v2="5" v3="1"/>
     <triangle v1="2" v2="3" v3="7"/>
     <triangle v1="7" v2="6" v3="2"/>
     <triangle v1="3" v2="0" v3="4"/>
     <triangle v1="4" v2="7" v3="3"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1"/>
 </build>
</model>`;
}

init();