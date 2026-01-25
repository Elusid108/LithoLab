/**
 * Lithophane generation adapted from PIXEstL (https://github.com/gaugo87/PIXEstL) by gaugo87. MIT License.
 * Color utilities: RGB/CIELab distance, transparent-pixel checks, CMYK/HSL conversion.
 */

const PIXESTL_Color = (function () {
  'use strict';

  const RGB = 'RGB';
  const CIELab = 'CIELab';

  function transparentPixel(imageData, width, height, x, y) {
    if (x < 0 || x >= width) return true;
    if (y < 0 || y >= height) return true;
    const i = (y * width + x) * 4;
    return (imageData.data[i + 3] || 0) === 0;
  }

  function hasATransparentPixelAsNeighbor(imageData, width, height, x, y) {
    const neighbors = [[x, y + 1], [x + 1, y], [x, y - 1], [x - 1, y]];
    for (const [xN, yN] of neighbors) {
      if (xN < 0 || xN > width - 1 || yN < 0 || yN > height - 1) return true;
      if (transparentPixel(imageData, width, height, xN, yN)) return true;
    }
    return false;
  }

  function hasATransparentPixel(imageData, width, height) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (transparentPixel(imageData, width, height, x, y)) return true;
      }
    }
    return false;
  }

  function colorDistanceRGB(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  function pivotRgbToXyz(n) {
    return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92;
  }

  function rgbToXyz(r, g, b) {
    const rr = pivotRgbToXyz(r / 255);
    const gg = pivotRgbToXyz(g / 255);
    const bb = pivotRgbToXyz(b / 255);
    const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) * 100;
    const y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175) * 100;
    const z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) * 100;
    return [x, y, z];
  }

  function pivotXyzToLab(n) {
    return n > Math.pow(6 / 29, 3)
      ? Math.pow(n, 1 / 3)
      : n / (3 * Math.pow(6 / 29, 2)) + 4 / 29;
  }

  function xyzToLab(x, y, z) {
    x /= 95.047;
    y /= 100;
    z /= 108.883;
    if (x > 0) x = pivotXyzToLab(x);
    if (y > 0) y = pivotXyzToLab(y);
    if (z > 0) z = pivotXyzToLab(z);
    const L = Math.max(0, 116 * y - 16);
    const a = (x - y) * 500;
    const b = (y - z) * 200;
    return [L, a, b];
  }

  function rgbToLab(r, g, b) {
    const [x, y, z] = rgbToXyz(r, g, b);
    return xyzToLab(x, y, z);
  }

  function deltaE(L1, a1, b1, L2, a2, b2) {
    const dL = L2 - L1, da = a2 - a1, db = b2 - b1;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function colorDistanceCIELab(r1, g1, b1, r2, g2, b2) {
    const [L1, a1, b1_] = rgbToLab(r1, g1, b1);
    const [L2, a2, b2_] = rgbToLab(r2, g2, b2);
    return deltaE(L1, a1, b1_, L2, a2, b2_);
  }

  function findClosestColor(r, g, b, colors, colorDistanceComputation) {
    let minDist = Infinity;
    let closest = colors[0];
    for (const c of colors) {
      const dist = colorDistanceComputation === RGB
        ? colorDistanceRGB(r, g, b, c.r, c.g, c.b)
        : colorDistanceCIELab(r, g, b, c.r, c.g, c.b);
      if (dist < minDist) {
        minDist = dist;
        closest = c;
      }
    }
    return closest;
  }

  function hexToColor(hex) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error('Invalid hex: ' + hex);
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  function colorToHSL(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
      s = 0;
      h = 0;
    } else {
      const d = max - min;
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = (60 * ((g - b) / d) + 360) % 360;
      else if (max === g) h = (60 * ((b - r) / d) + 120) % 360;
      else h = (60 * ((r - g) / d) + 240) % 360;
    }
    return [h, s * 100, l * 100];
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToCmyk(h, s, l) {
    s /= 100;
    l /= 100;
    let c, m, y, k;
    if (s === 0) {
      c = m = y = 0;
      k = 1 - l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hk = h / 360;
      const r = hueToRgb(p, q, hk + 1 / 3);
      const g_ = hueToRgb(p, q, hk);
      const b = hueToRgb(p, q, hk - 1 / 3);
      c = 1 - r;
      m = 1 - g_;
      y = 1 - b;
      k = Math.min(c, m, y);
      c = (c - k) / (1 - k);
      m = (m - k) / (1 - k);
      y = (y - k) / (1 - k);
    }
    return [c, m, y, k];
  }

  function cmykToColor(c, m, y, k) {
    const r = Math.round((1 - c) * (1 - k) * 255);
    const g = Math.round((1 - m) * (1 - k) * 255);
    const b_ = Math.round((1 - y) * (1 - k) * 255);
    return { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b_)) };
  }

  function colorToCMYK(r, g, b) {
    const r_ = r / 255, g_ = g / 255, b_ = b / 255;
    const k = 1 - Math.max(r_, g_, b_);
    let c = 0, m = 0, y = 0;
    if (k < 1) {
      c = (1 - r_ - k) / (1 - k);
      m = (1 - g_ - k) / (1 - k);
      y = (1 - b_ - k) / (1 - k);
    }
    return [c, m, y, k];
  }

  function hexCodeComparator(hexA, hexB) {
    const a = hexToColor(hexA);
    const b = hexToColor(hexB);
    const sumA = a.r + a.g + a.b;
    const sumB = b.r + b.g + b.b;
    return sumA - sumB;
  }

  return {
    transparentPixel,
    hasATransparentPixelAsNeighbor,
    hasATransparentPixel,
    colorDistanceRGB,
    colorDistanceCIELab,
    findClosestColor,
    hexToColor,
    colorToHSL,
    hslToCmyk,
    cmykToColor,
    colorToCMYK,
    rgbToLab,
    deltaE,
    hexCodeComparator,
    RGB,
    CIELab
  };
})();
