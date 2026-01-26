/**
 * Lithophane generation adapted from PIXEstL (https://github.com/gaugo87/PIXEstL) by gaugo87. MIT License.
 * STL mesh generation: plate, texture (height-field), color layers. Output STL ASCII.
 */

const PIXESTL_STL = (function () {
  'use strict';

  function cross(ax, ay, az, bx, by, bz) {
    return [
      ay * bz - az * by,
      az * bx - ax * bz,
      ax * by - ay * bx
    ];
  }

  function normalize(n) {
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  }

  function facetToStl(v0, v1, v2) {
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const n = normalize(cross(e1[0], e1[1], e1[2], e2[0], e2[1], e2[2]));
    return `facet normal ${n[0]} ${n[1]} ${n[2]}
  outer loop
    vertex ${v0[0]} ${v0[1]} ${v0[2]}
    vertex ${v1[0]} ${v1[1]} ${v1[2]}
    vertex ${v2[0]} ${v2[1]} ${v2[2]}
  endloop
endfacet
`;
  }

  function cubeFacets(w, h, d, ox, oy, oz) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const x0 = ox - hw, x1 = ox + hw, y0 = oy - hh, y1 = oy + hh, z0 = oz - hd, z1 = oz + hd;
    const out = [];
    out.push([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
    out.push([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
    const f = [
      [out[0], out[1], out[2]], [out[0], out[2], out[3]],
      [out[4], out[5], out[6]], [out[4], out[6], out[7]],
      [out[0], out[4], out[7]], [out[0], out[7], out[1]],
      [out[1], out[7], out[6]], [out[1], out[6], out[2]],
      [out[2], out[6], out[5]], [out[2], out[5], out[3]],
      [out[3], out[5], out[4]], [out[3], out[4], out[0]]
    ];
    return f;
  }

  function writeStlAscii(name, facets) {
    const chunks = [`solid ${name}\n`];
    for (const tri of facets) {
      chunks.push(facetToStl(tri[0], tri[1], tri[2]));
    }
    chunks.push(`endsolid ${name}\n`);
    return chunks;
  }

  function buildPlate(pixelData, opts) {
    const { bounds, mask, width: imgW } = pixelData;
    const w = bounds.w;
    const h = bounds.h;
    const hasTransparency = typeof opts.hasTransparency === 'boolean' ? opts.hasTransparency : true;
    const plateThickness = opts.plateThickness ?? 0.2;
    const widthMm = opts.widthMm ?? 100;
    const heightMm = opts.heightMm ?? 100;
    const mmPerPixelX = widthMm / w;
    const mmPerPixelY = heightMm / h;
    const facets = [];

    if (!hasTransparency) {
      const cubes = cubeFacets(widthMm, heightMm, plateThickness, widthMm / 2, heightMm / 2, -plateThickness / 2);
      for (const tri of cubes) facets.push(tri);
      return facets;
    }

    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const idx = (bounds.y + y) * imgW + (bounds.x + x);
        if (!mask || mask[idx] !== 1) { x++; continue; }
        let k = 0;
        while (x + k < w) {
          const nidx = (bounds.y + y) * imgW + (bounds.x + x + k);
          if (!mask || mask[nidx] !== 1) break;
          k++;
        }
        const segW = Math.max(1, k) * mmPerPixelX;
        const segH = mmPerPixelY;
        const gx = (x + k / 2) * mmPerPixelX;
        const gy = (y + 0.5) * mmPerPixelY;
        const cubes = cubeFacets(segW, segH, plateThickness, gx, gy, -plateThickness / 2);
        for (const tri of cubes) facets.push(tri);
        x += Math.max(1, k);
      }
    }
    return facets;
  }

  function getPixelHeight(pixelData, x, y, opts) {
    const { bounds, mask, width } = pixelData;
    const idx = (bounds.y + y) * width + (bounds.x + x);
    if (mask && mask[idx] !== 1) return 0;
    const K = (pixelData.w[idx] ?? 0) / 255;
    const minT = opts.textureMinThickness ?? 0.3;
    const maxT = opts.textureMaxThickness ?? 2.5;
    return minT + (maxT - minT) * K;
  }

  function getPixelHeightForChannel(pixelData, x, y, channel, opts) {
    const { bounds, mask, width } = pixelData;
    const idx = (bounds.y + y) * width + (bounds.x + x);
    if (mask && mask[idx] !== 1) return 0;
    const arr = pixelData[channel];
    if (!arr) return 0;
    const K = (arr[idx] ?? 0) / 255;
    const minT = opts.textureMinThickness ?? 0.3;
    const maxT = opts.textureMaxThickness ?? 2.5;
    return minT + (maxT - minT) * K;
  }

  function buildTextureLayer(pixelData, opts) {
    const { bounds, mask, width: imgW } = pixelData;
    const w = bounds.w;
    const h = bounds.h;
    const widthMm = opts.widthMm ?? 100;
    const heightMm = opts.heightMm ?? 100;
    const mmPerPixelX = widthMm / w;
    const mmPerPixelY = heightMm / h;
    const whiteBaseMm = opts.whiteBaseMm ?? 1;
    const facets = [];
    const transparent = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return true;
      const idx = (bounds.y + y) * imgW + (bounds.x + x);
      return mask && mask[idx] !== 1;
    };

    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        if (transparent(x, y)) continue;
        const i = x * mmPerPixelX;
        const j = y * mmPerPixelY;
        const i1 = (x + 1) * mmPerPixelX;
        const j1 = (y + 1) * mmPerPixelY;
        const z00 = getPixelHeight(pixelData, x, y, opts);
        const z10 = getPixelHeight(pixelData, x + 1, y, opts);
        const z01 = getPixelHeight(pixelData, x, y + 1, opts);
        const z11 = getPixelHeight(pixelData, x + 1, y + 1, opts);

        const v00 = [i, j, z00];
        const v10 = [i1, j, z10];
        const v01 = [i, j1, z01];
        const v11 = [i1, j1, z11];
        const b00 = [i, j, 0];
        const b10 = [i1, j, 0];
        const b01 = [i, j1, 0];
        const b11 = [i1, j1, 0];

        facets.push([v00, v01, v10]);
        facets.push([v10, v01, v11]);
        facets.push([v00, v10, b10]);
        facets.push([v00, b10, b00]);
        facets.push([v01, v00, b00]);
        facets.push([v01, b00, b01]);
        facets.push([v10, v11, b11]);
        facets.push([v10, b11, b10]);
        facets.push([v11, v01, b01]);
        facets.push([v11, b01, b11]);
        facets.push([b00, b10, b11]);
        facets.push([b00, b11, b01]);

        if (whiteBaseMm > 0) {
          const zBot = -whiteBaseMm;
          const b00_ = [i, j, zBot];
          const b10_ = [i1, j, zBot];
          const b01_ = [i, j1, zBot];
          const b11_ = [i1, j1, zBot];
          facets.push([b00_, b10_, b11_]);
          facets.push([b00_, b11_, b01_]);
          facets.push([b00, b10, b10_]);
          facets.push([b00, b10_, b00_]);
          facets.push([b10, b11, b11_]);
          facets.push([b10, b11_, b10_]);
          facets.push([b11, b01, b01_]);
          facets.push([b11, b01_, b11_]);
          facets.push([b01, b00, b00_]);
          facets.push([b01, b00_, b01_]);
        }
      }
    }
    return facets;
  }

  function buildColorLayerAsHeightField(pixelData, channel, opts, extra) {
    const { bounds, mask, width: imgW } = pixelData;
    const useInterior = !!(extra && extra.useInteriorOnly && pixelData.interior);
    const vis = useInterior ? pixelData.interior : mask;
    const w = bounds.w;
    const h = bounds.h;
    const widthMm = opts.widthMm ?? 100;
    const heightMm = opts.heightMm ?? 100;
    const mmPerPixelX = widthMm / w;
    const mmPerPixelY = heightMm / h;
    const facets = [];
    const transparent = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return true;
      const idx = (bounds.y + y) * imgW + (bounds.x + x);
      return !vis || vis[idx] !== 1;
    };
    const quadVisible = (x, y) => {
      if (transparent(x, y)) return false;
      if (transparent(x + 1, y)) return false;
      if (transparent(x, y + 1)) return false;
      if (transparent(x + 1, y + 1)) return false;
      return true;
    };
    const skip = useInterior ? (x, y) => !quadVisible(x, y) : (x, y) => transparent(x, y);

    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        if (skip(x, y)) continue;
        const i = x * mmPerPixelX;
        const j = y * mmPerPixelY;
        const i1 = (x + 1) * mmPerPixelX;
        const j1 = (y + 1) * mmPerPixelY;
        const z00 = getPixelHeightForChannel(pixelData, x, y, channel, opts);
        const z10 = getPixelHeightForChannel(pixelData, x + 1, y, channel, opts);
        const z01 = getPixelHeightForChannel(pixelData, x, y + 1, channel, opts);
        const z11 = getPixelHeightForChannel(pixelData, x + 1, y + 1, channel, opts);

        const v00 = [i, j, z00];
        const v10 = [i1, j, z10];
        const v01 = [i, j1, z01];
        const v11 = [i1, j1, z11];
        const b00 = [i, j, 0];
        const b10 = [i1, j, 0];
        const b01 = [i, j1, 0];
        const b11 = [i1, j1, 0];

        facets.push([v00, v01, v10]);
        facets.push([v10, v01, v11]);
        facets.push([v00, v10, b10]);
        facets.push([v00, b10, b00]);
        facets.push([v01, v00, b00]);
        facets.push([v01, b00, b01]);
        facets.push([v10, v11, b11]);
        facets.push([v10, b11, b10]);
        facets.push([v11, v01, b01]);
        facets.push([v11, b01, b11]);
        facets.push([b00, b10, b11]);
        facets.push([b00, b11, b01]);
      }
    }
    return facets;
  }

  function buildColorLayerChannel(pixelData, channel, opts) {
    const { bounds, mask, width: imgW } = pixelData;
    const w = bounds.w;
    const h = bounds.h;
    const widthMm = opts.widthMm ?? 100;
    const heightMm = opts.heightMm ?? 100;
    const mmPerPixelX = widthMm / w;
    const mmPerPixelY = heightMm / h;
    const layerHeight = (opts.colorPixelLayerThickness ?? 0.1) * (opts.colorPixelLayerNumber ?? 5);
    const facets = [];
    const arr = pixelData[channel];
    if (!arr) return facets;

    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const idx = (bounds.y + y) * imgW + (bounds.x + x);
        if (!mask || mask[idx] !== 1) { x++; continue; }
        const v = arr[idx] ?? 0;
        if (v === 0) { x++; continue; }
        let k = 0;
        while (x + k < w) {
          const nidx = (bounds.y + y) * imgW + (bounds.x + x + k);
          if (!mask || mask[nidx] !== 1) break;
          if ((arr[nidx] ?? 0) === 0) break;
          k++;
        }
        const frac = (arr[idx] ?? 0) / 255;
        const segH = layerHeight * Math.min(1, frac);
        if (segH <= 0) { x += Math.max(1, k); continue; }
        const segW = Math.max(1, k) * mmPerPixelX;
        const segHp = mmPerPixelY;
        const gx = (x + k / 2) * mmPerPixelX;
        const gy = (y + 0.5) * mmPerPixelY;
        const cubes = cubeFacets(segW, segHp, segH, gx, gy, segH / 2);
        for (const tri of cubes) facets.push(tri);
        x += Math.max(1, k);
      }
    }
    return facets;
  }

  return {
    writeStlAscii,
    buildPlate,
    buildTextureLayer,
    buildColorLayerChannel,
    buildColorLayerAsHeightField,
    getPixelHeight,
    getPixelHeightForChannel
  };
})();

// Expose to window for global access
window.PIXESTL_STL = PIXESTL_STL;
