/**
 * Lithophane generation adapted from PIXEstL (https://github.com/gaugo87/PIXEstL) by gaugo87. MIT License.
 * Image utilities: resize, B&W texture, transparency, flip.
 */

const PIXESTL_Image = (function () {
  'use strict';

  function resizeImage(imageData, width, height, destWidthMm, destHeightMm, pixelMm) {
    let nw, nh;
    if (destWidthMm > 0 && (!destHeightMm || destHeightMm === 0)) {
      nw = Math.floor(destWidthMm / pixelMm);
      const heightMm = (height * destWidthMm) / width;
      nh = Math.floor(heightMm / pixelMm);
    } else if (destHeightMm > 0 && (!destWidthMm || destWidthMm === 0)) {
      nh = Math.floor(destHeightMm / pixelMm);
      const widthMm = (width * destHeightMm) / height;
      nw = Math.floor(widthMm / pixelMm);
    } else {
      nw = Math.floor(destWidthMm / pixelMm);
      nh = Math.floor(destHeightMm / pixelMm);
    }
    nw = Math.max(1, nw);
    nh = Math.max(1, nh);
    const out = new ImageData(nw, nh);
    const scaleX = width / nw;
    const scaleY = height / nh;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(Math.floor(x * scaleX), width - 1);
        const sy = Math.min(Math.floor(y * scaleY), height - 1);
        const si = (sy * width + sx) * 4;
        const di = (y * nw + x) * 4;
        out.data[di] = imageData.data[si];
        out.data[di + 1] = imageData.data[si + 1];
        out.data[di + 2] = imageData.data[si + 2];
        out.data[di + 3] = imageData.data[si + 3];
      }
    }
    return out;
  }

  function convertToBlackAndWhite(imageData, width, height) {
    const out = new ImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const si = i * 4;
      const di = i * 4;
      if ((imageData.data[si + 3] || 0) === 0) {
        out.data[di] = out.data[di + 1] = out.data[di + 2] = 0;
        out.data[di + 3] = 0;
        continue;
      }
      const r = imageData.data[si];
      const g = imageData.data[si + 1];
      const b = imageData.data[si + 2];
      const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      out.data[di] = out.data[di + 1] = out.data[di + 2] = lum;
      out.data[di + 3] = 255;
    }
    return out;
  }

  function flipImage(imageData, width, height) {
    const out = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      const sy = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const si = (sy * width + x) * 4;
        const di = (y * width + x) * 4;
        out.data[di] = imageData.data[si];
        out.data[di + 1] = imageData.data[si + 1];
        out.data[di + 2] = imageData.data[si + 2];
        out.data[di + 3] = imageData.data[si + 3];
      }
    }
    return out;
  }

  return {
    resizeImage,
    convertToBlackAndWhite,
    flipImage
  };
})();
