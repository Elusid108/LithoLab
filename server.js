/**
 * LithoLab export backend: accepts image + dimensions, runs PIXEstL JAR, returns ZIP.
 * Requires: Java on PATH, PIXEstL built (mvn clean install) in internal PIXEstL directory.
 *
 * Env (optional): PIXESTL_JAR, PIXESTL_PALETTE override paths.
 * Default: PIXEstL/target/PIXEstL.jar (or PIXEstL-*.jar), PIXEstL/src/main/resources/palette-cmyw-0.10mm.json
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const { zipTo3mf } = require('./lib/3mf-builder');

const PORT = process.env.PORT || 3000;

// Resolve PIXEstL JAR: env or internal PIXEstL/target (PIXEstL.jar or PIXEstL-*.jar)
function resolveJarPath() {
  if (process.env.PIXESTL_JAR) {
    const p = path.resolve(process.env.PIXESTL_JAR);
    if (fs.existsSync(p)) return p;
  }
  const targetDir = path.resolve(__dirname, 'PIXEstL', 'target');
  if (!fs.existsSync(targetDir)) return null;
  const preferred = path.join(targetDir, 'PIXEstL.jar');
  if (fs.existsSync(preferred)) return preferred;
  const files = fs.readdirSync(targetDir);
  const jar = files.find((f) => f.startsWith('PIXEstL') && f.endsWith('.jar'));
  return jar ? path.join(targetDir, jar) : null;
}

// Resolve palette: env or internal PIXEstL palette
function resolvePalettePath() {
  if (process.env.PIXESTL_PALETTE) {
    const p = path.resolve(process.env.PIXESTL_PALETTE);
    if (fs.existsSync(p)) return p;
  }
  const p = path.resolve(__dirname, 'PIXEstL', 'src', 'main', 'resources', 'palette-cmyw-0.10mm.json');
  return fs.existsSync(p) ? p : null;
}

const app = express();
app.use(cors());

// #region agent log
app.use((req, res, next) => {
  if (req.method === 'POST') {
    fetch('http://127.0.0.1:7245/ingest/917ae731-0894-4091-a08e-afb05c06b4f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:middleware',message:'POST received',data:{method:req.method,path:req.path,url:req.url},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
  }
  next();
});
// #endregion

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post('/generate', upload.single('image'), async (req, res) => {
  const jarPath = resolveJarPath();
  const palettePath = resolvePalettePath();

  if (!jarPath) {
    return res.status(500).json({
      error: 'PIXEstL JAR not found. Set PIXESTL_JAR or build PIXEstL: cd PIXEstL && mvn clean install',
    });
  }
  if (!palettePath) {
    return res.status(500).json({
      error: 'Palette not found. Set PIXESTL_PALETTE or use PIXEstL repo with palette-cmyw-0.10mm.json',
    });
  }

  const widthMm = parseFloat(req.body.widthMm);
  const heightMm = parseFloat(req.body.heightMm);
  const fileName = (req.body.fileName || 'Lithophane').replace(/[^a-z0-9]/gi, '_') || 'Lithophane';

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Missing image file' });
  }
  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
    return res.status(400).json({ error: 'Invalid widthMm or heightMm (positive numbers required)' });
  }

  const tmpDir = os.tmpdir();
  const tempId = `litholab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempPng = path.join(tmpDir, `${tempId}.png`);
  const tempZip = path.join(tmpDir, `${tempId}.zip`);

  const cleanup = () => {
    try {
      if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);
    } catch (_) {}
    try {
      if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    } catch (_) {}
  };

  try {
    fs.writeFileSync(tempPng, req.file.buffer);

    await new Promise((resolve, reject) => {
      const args = [
        '-jar', jarPath,
        '-i', tempPng,
        '-p', palettePath,
        '-w', String(widthMm),
        '-H', String(heightMm),
        '-c', '4',
        '-o', tempZip,
      ];
      const proc = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `Java exited ${code}`));
      });
      proc.on('error', (err) => reject(err));
    });

    if (!fs.existsSync(tempZip)) {
      cleanup();
      return res.status(500).json({ error: 'PIXEstL did not produce output ZIP' });
    }

    const zipBuffer = fs.readFileSync(tempZip);
    cleanup();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    cleanup();
    console.error('PIXEstL error:', err);
    res.status(500).json({
      error: 'PIXEstL failed: ' + (err.message || String(err)),
    });
  }
});

app.post('/generate-3mf', upload.single('image'), async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/917ae731-0894-4091-a08e-afb05c06b4f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:generate-3mf-handler',message:'/generate-3mf handler entered',data:{},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  const jarPath = resolveJarPath();
  const palettePath = resolvePalettePath();

  if (!jarPath) {
    return res.status(500).json({
      error: 'PIXEstL JAR not found. Set PIXESTL_JAR or build PIXEstL: cd PIXEstL && mvn clean install',
    });
  }
  if (!palettePath) {
    return res.status(500).json({
      error: 'Palette not found. Set PIXESTL_PALETTE or use PIXEstL repo with palette-cmyw-0.10mm.json',
    });
  }

  const widthMm = parseFloat(req.body.widthMm);
  const heightMm = parseFloat(req.body.heightMm);
  const fileName = (req.body.fileName || 'Lithophane').replace(/[^a-z0-9]/gi, '_') || 'Lithophane';

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Missing image file' });
  }
  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
    return res.status(400).json({ error: 'Invalid widthMm or heightMm (positive numbers required)' });
  }

  const tmpDir = os.tmpdir();
  const tempId = `litholab-3mf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempPng = path.join(tmpDir, `${tempId}.png`);
  const tempZip = path.join(tmpDir, `${tempId}.zip`);

  const cleanup = () => {
    try {
      if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);
    } catch (_) {}
    try {
      if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    } catch (_) {}
  };

  try {
    fs.writeFileSync(tempPng, req.file.buffer);

    await new Promise((resolve, reject) => {
      const args = [
        '-jar', jarPath,
        '-i', tempPng,
        '-p', palettePath,
        '-w', String(widthMm),
        '-H', String(heightMm),
        '-c', '4',
        '-o', tempZip,
      ];
      const proc = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `Java exited ${code}`));
      });
      proc.on('error', (err) => reject(err));
    });

    if (!fs.existsSync(tempZip)) {
      cleanup();
      return res.status(500).json({ error: 'PIXEstL did not produce output ZIP' });
    }

    const zipBuffer = fs.readFileSync(tempZip);
    cleanup();

    const threeMfBuffer = zipTo3mf(zipBuffer);

    res.setHeader('Content-Type', 'model/3mf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.3mf"`);
    res.send(threeMfBuffer);
  } catch (err) {
    cleanup();
    console.error('3MF export error:', err);
    res.status(500).json({
      error: '3MF export failed: ' + (err.message || String(err)),
    });
  }
});

app.listen(PORT, () => {
  // #region agent log
  const routes = app._router.stack.filter(r => r.route).map(r => Object.keys(r.route.methods)[0] + ' ' + r.route.path);
  fetch('http://127.0.0.1:7245/ingest/917ae731-0894-4091-a08e-afb05c06b4f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:listen',message:'Server started',data:{port:PORT,routes},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  console.log(`LithoLab export backend on http://localhost:${PORT}`);
  console.log('POST /generate with multipart: image, widthMm, heightMm, fileName');
  console.log('POST /generate-3mf with multipart: image, widthMm, heightMm, fileName');
});
