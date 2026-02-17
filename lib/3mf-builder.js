/**
 * LithoLab 3MF Builder: Converts PIXEstL STL ZIP output to a single 3MF file
 * with Cyan, Magenta, Yellow layers pre-assigned. Uses 3MF Materials Extension.
 */

const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Color indices for 3MF basematerials: 0=White, 1=Cyan, 2=Magenta, 3=Yellow
const COLOR_WHITE = 0;
const COLOR_CYAN = 1;
const COLOR_MAGENTA = 2;
const COLOR_YELLOW = 3;

/**
 * Map STL filename to color index.
 * PIXEstL outputs: layer-plate.stl, layer-Cyan[PLA Basic]+..., layer-texture-White[PLA Basic].stl
 */
function mapFilenameToColor(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('plate') || lower.includes('texture') || lower.includes('white')) {
    return COLOR_WHITE;
  }
  const hasCyan = lower.includes('cyan');
  const hasMagenta = lower.includes('magenta');
  const hasYellow = lower.includes('yellow');
  if (hasCyan && !hasMagenta && !hasYellow) return COLOR_CYAN;
  if (hasMagenta && !hasCyan && !hasYellow) return COLOR_MAGENTA;
  if (hasYellow && !hasCyan && !hasMagenta) return COLOR_YELLOW;
  // Combined or unknown -> White
  return COLOR_WHITE;
}

/**
 * Parse STL buffer (ASCII or binary) to vertices and triangles.
 * Returns { vertices: [[x,y,z], ...], triangles: [[v0,v1,v2], ...] }
 */
function parseStl(buffer) {
  const vertices = [];
  const triangles = [];
  const vertexMap = new Map();
  const getIndex = (x, y, z) => {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertices.length);
      vertices.push([x, y, z]);
    }
    return vertexMap.get(key);
  };

  const startsWithSolid = buffer.length >= 6 && buffer.toString('utf8', 0, 6).toLowerCase() === 'solid ';
  const isBinary = !startsWithSolid && buffer.length >= 84;

  if (isBinary) {
    const numTriangles = buffer.readUInt32LE(80);
    let offset = 84;
    for (let i = 0; i < numTriangles && offset + 50 <= buffer.length; i++) {
      offset += 12; // skip normal
      const x1 = buffer.readFloatLE(offset); offset += 4;
      const y1 = buffer.readFloatLE(offset); offset += 4;
      const z1 = buffer.readFloatLE(offset); offset += 4;
      const x2 = buffer.readFloatLE(offset); offset += 4;
      const y2 = buffer.readFloatLE(offset); offset += 4;
      const z2 = buffer.readFloatLE(offset); offset += 4;
      const x3 = buffer.readFloatLE(offset); offset += 4;
      const y3 = buffer.readFloatLE(offset); offset += 4;
      const z3 = buffer.readFloatLE(offset); offset += 4;
      offset += 2; // attributes
      const i1 = getIndex(x1, y1, z1);
      const i2 = getIndex(x2, y2, z2);
      const i3 = getIndex(x3, y3, z3);
      triangles.push([i1, i2, i3]);
    }
  } else {
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith('vertex ')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          const v1 = getIndex(x, y, z);
          i++;
          if (i < lines.length && lines[i].trim().startsWith('vertex ')) {
            const p2 = lines[i].trim().split(/\s+/);
            const v2 = getIndex(parseFloat(p2[1]), parseFloat(p2[2]), parseFloat(p2[3]));
            i++;
            if (i < lines.length && lines[i].trim().startsWith('vertex ')) {
              const p3 = lines[i].trim().split(/\s+/);
              const v3 = getIndex(parseFloat(p3[1]), parseFloat(p3[2]), parseFloat(p3[3]));
              triangles.push([v1, v2, v3]);
            }
          }
        }
      }
      i++;
    }
  }

  return { vertices, triangles };
}

const COLOR_NAMES = ['White', 'Cyan', 'Magenta', 'Yellow'];

function getObjectName(mesh) {
  const lower = (mesh.name || '').toLowerCase();
  if (lower.includes('plate') && !lower.includes('texture')) return 'Plate';
  if (lower.includes('texture')) return 'Texture';
  return COLOR_NAMES[mesh.colorIndex];
}

/**
 * Build 3MF package from meshes. One object per mesh so user can assign filament per layer in Bambu Studio.
 * meshes: Array<{ vertices, triangles, colorIndex, name }>
 */
function build3mf(meshes) {
  const objectParts = [];
  const buildItems = [];

  // Basematerials for display color: 0=White, 1=Cyan, 2=Magenta, 3=Yellow
  const basematerials = `    <basematerials id="1">
      <base name="White" displaycolor="#FFFFFF" />
      <base name="Cyan" displaycolor="#0086D6" />
      <base name="Magenta" displaycolor="#EC008C" />
      <base name="Yellow" displaycolor="#FCE300" />
    </basematerials>`;

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const objectId = i + 2;
    const name = getObjectName(mesh);
    const colorIndex = mesh.colorIndex;
    const vertexElements = mesh.vertices.map(
      v => `        <vertex x="${v[0]}" y="${v[1]}" z="${v[2]}" />`
    ).join('\n');
    const triangleElements = mesh.triangles.map(
      tri => `        <triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" pid="1" p1="${colorIndex}" p2="${colorIndex}" p3="${colorIndex}" />`
    ).join('\n');
    objectParts.push(`    <object id="${objectId}" type="model" name="${escapeXml(name)}">
      <mesh>
        <vertices>
${vertexElements}
        </vertices>
        <triangles>
${triangleElements}
        </triangles>
      </mesh>
    </object>`);
    buildItems.push(`    <item objectid="${objectId}" />`);
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Application" preserve="1">LithoLab</metadata>
  <metadata name="Units" preserve="1">millimeter</metadata>
  <resources>
${basematerials}
${objectParts.join('\n')}
  </resources>
  <build>
${buildItems.join('\n')}
  </build>
</model>`;

  // Slicer config: 100% infill for lithophanes (Bambu/PrusaSlicer format)
  const slicerConfig = `# LithoLab lithophane preset
sparse_infill_density = 1
sparse_infill_pattern = concentric
`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="model/3mf" />
  <Override PartName="/3D/3dmodel.model" ContentType="model/3mf" />
  <Override PartName="/Metadata/slicer_config.config" ContentType="application/octet-stream" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" Id="rel0" />
  <Relationship Type="http://schemas.slic3r.org/3mf/2017/06/slicer_config" Target="/Metadata/slicer_config.config" Id="rel1" />
</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(modelXml, 'utf8'));
  zip.addFile('Metadata/slicer_config.config', Buffer.from(slicerConfig, 'utf8'));

  const totalV = meshes.reduce((s, m) => s + m.vertices.length, 0);
  const totalT = meshes.reduce((s, m) => s + m.triangles.length, 0);
  try {
    const logPath = path.join(__dirname, '..', '.cursor', 'debug.log');
    const line = JSON.stringify({
      location: '3mf-builder.js:build3mf',
      message: '3MF built',
      data: { objectCount: meshes.length, totalVertices: totalV, totalTriangles: totalT },
      timestamp: Date.now(),
      hypothesisId: 'G2',
    }) + '\n';
    fs.appendFileSync(logPath, line);
  } catch (_) {}

  return zip.toBuffer();
}

/**
 * Convert PIXEstL output ZIP to 3MF with color assignments.
 * zipBuffer: Buffer from PIXEstL -o output
 */
function zipTo3mf(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const meshes = [];

  for (const entry of entries) {
    if (!entry.entryName.toLowerCase().endsWith('.stl')) continue;
    const buffer = entry.getData();
    if (!buffer || buffer.length < 84) continue;

    const { vertices, triangles } = parseStl(buffer);
    if (vertices.length === 0 || triangles.length === 0) continue;

    const colorIndex = mapFilenameToColor(entry.entryName);
    meshes.push({ vertices, triangles, colorIndex, name: entry.entryName });
  }

  if (meshes.length === 0) {
    throw new Error('No valid STL files found in PIXEstL output');
  }

  const totalV = meshes.reduce((s, m) => s + m.vertices.length, 0);
  const totalT = meshes.reduce((s, m) => s + m.triangles.length, 0);
  try {
    const logPath = path.join(__dirname, '..', '.cursor', 'debug.log');
    const line = JSON.stringify({
      location: '3mf-builder.js:zipTo3mf',
      message: 'Mesh stats before build',
      data: { stlCount: meshes.length, totalVertices: totalV, totalTriangles: totalT, perFile: meshes.map(m => ({ name: m.name, v: m.vertices.length, t: m.triangles.length })) },
      timestamp: Date.now(),
      hypothesisId: 'G1',
    }) + '\n';
    fs.appendFileSync(logPath, line);
  } catch (_) {}

  return build3mf(meshes);
}

module.exports = {
  zipTo3mf,
  parseStl,
  mapFilenameToColor,
};
