import { transparentPixel, type Rgba } from './colorUtil'
import { rasterizePolygonCoverage, type PolygonSet } from './maskPolygon'

function formatRatio(n: number): string {
  return n.toFixed(2)
}

export function checkRatio(
  width: number,
  height: number,
  imageWidthMm: number,
  imageHeightMm: number,
): void {
  if (imageWidthMm === 0 || imageHeightMm === 0) return
  const ratioSrc = width / height
  const ratioDest = imageWidthMm / imageHeightMm
  if (formatRatio(ratioSrc) !== formatRatio(ratioDest)) {
    console.warn(
      `Warning : The image ratio is not preserved. (Source ratio:${formatRatio(ratioSrc)}; Destination ratio:${formatRatio(ratioDest)})`,
    )
  }
}

/** Resize canvas/image to target pixel dimensions using same rules as Java ImageUtil.resizeImage */
export function resizeImage(
  source: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  imageWidthMm: number,
  imageHeightMm: number,
  pixelMm: number,
): HTMLCanvasElement {
  const height = 'height' in source ? source.height : (source as ImageBitmap).height
  const width = 'width' in source ? source.width : (source as ImageBitmap).width

  let nbPixelWidth: number
  let nbPixelHeight: number

  if (imageWidthMm !== 0 && imageHeightMm === 0) {
    nbPixelWidth = Math.floor(imageWidthMm / pixelMm)
    const heightMm = (height * imageWidthMm) / width
    nbPixelHeight = Math.floor(heightMm / pixelMm)
  } else if (imageWidthMm === 0 && imageHeightMm !== 0) {
    nbPixelHeight = Math.floor(imageHeightMm / pixelMm)
    const widthMm = (width * imageHeightMm) / height
    nbPixelWidth = Math.floor(widthMm / pixelMm)
  } else {
    nbPixelWidth = Math.floor(imageWidthMm / pixelMm)
    nbPixelHeight = Math.floor(imageHeightMm / pixelMm)
  }

  const canvas = document.createElement('canvas')
  canvas.width = nbPixelWidth
  canvas.height = nbPixelHeight
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, 0, 0, nbPixelWidth, nbPixelHeight)
  return canvas
}

export function getImageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')!
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function hasATransparentPixel(imageData: ImageData): boolean {
  const { width, height } = imageData
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (transparentPixel(imageData, x, y)) return true
    }
  }
  return false
}

export type PolygonStencilMode = 'preview' | 'stl'

/**
 * Clip an ImageData by a polygon set. The polygon's coverage is supersampled
 * at each pixel so the edge ends up anti-aliased.
 *
 * - `'preview'` mode: pixels with non-zero coverage keep their RGB and get
 *   `alpha = coverage` (smooth, anti-aliased edges for the on-screen / PNG
 *   previews).
 * - `'stl'` mode: pixels with coverage ≥ 50% get `alpha = 255`, everything
 *   else is cleared. The cuboid emitters consume this as a binary stencil;
 *   the smooth outer silhouette is provided by the polygon-prism geometry
 *   added in stlMaker.ts, which overlaps the half-pixel border cuboids and
 *   gets unioned by the slicer.
 */
export function applyPolygonStencil(
  target: ImageData,
  silhouette: PolygonSet,
  originMmX: number,
  originMmY: number,
  pixelMm: number,
  mode: PolygonStencilMode = 'preview',
): void {
  const { width, height, data } = target
  if (silhouette.length === 0) {
    for (let i = 0; i < data.length; i += 4) data[i + 3] = 0
    return
  }
  const coverage = rasterizePolygonCoverage(
    silhouette,
    width,
    height,
    originMmX,
    originMmY,
    pixelMm,
    4,
  )
  if (mode === 'stl') {
    for (let p = 0, i = 0; p < coverage.length; p++, i += 4) {
      if (coverage[p] < 128) {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 0
      } else {
        data[i + 3] = 255
      }
    }
    return
  }
  for (let p = 0, i = 0; p < coverage.length; p++, i += 4) {
    const cov = coverage[p]
    if (cov === 0) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
    } else {
      data[i + 3] = cov
    }
  }
}

/** Light mask pixels keep target; dark or fully transparent mask pixels clear target to RGBA 0,0,0,0. */
export function applyMonochromeStencilMask(
  target: ImageData,
  mask: ImageData,
  opts?: { threshold?: number },
): void {
  if (target.width !== mask.width || target.height !== mask.height) {
    throw new Error('applyMonochromeStencilMask: target and mask dimensions must match')
  }
  const threshold = opts?.threshold ?? 128
  const { width, height } = target
  const td = target.data
  const md = mask.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mi = (y * width + x) * 4
      if (md[mi + 3] === 0) {
        const ti = mi
        td[ti] = 0
        td[ti + 1] = 0
        td[ti + 2] = 0
        td[ti + 3] = 0
        continue
      }
      const lum = Math.round(0.2126 * md[mi] + 0.7152 * md[mi + 1] + 0.0722 * md[mi + 2])
      if (lum < threshold) {
        const ti = mi
        td[ti] = 0
        td[ti + 1] = 0
        td[ti + 2] = 0
        td[ti + 3] = 0
      }
    }
  }
}

export function convertToBlackAndWhite(imageData: ImageData): ImageData {
  const { width, height } = imageData
  const out = new ImageData(width, height)
  const src = imageData.data
  const dst = out.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (src[i + 3] === 0) {
        dst[i] = 0
        dst[i + 1] = 0
        dst[i + 2] = 0
        dst[i + 3] = 0
        continue
      }
      const luminance = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2])
      dst[i] = luminance
      dst[i + 1] = luminance
      dst[i + 2] = luminance
      dst[i + 3] = 255
    }
  }
  return out
}

/** Vertical flip (same as Java AffineTransform scale 1,-1) */
export function flipImage(imageData: ImageData): ImageData {
  const { width, height } = imageData
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const temp = document.createElement('canvas')
  temp.width = width
  temp.height = height
  temp.getContext('2d')!.putImageData(imageData, 0, 0)
  ctx.translate(0, height)
  ctx.scale(1, -1)
  ctx.drawImage(temp, 0, 0)
  return ctx.getImageData(0, 0, width, height)
}

export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = imageData.width
  c.height = imageData.height
  c.getContext('2d')!.putImageData(imageData, 0, 0)
  return c
}

export function rgbaAt(imageData: ImageData, x: number, y: number): Rgba {
  const i = (y * imageData.width + x) * 4
  return {
    r: imageData.data[i],
    g: imageData.data[i + 1],
    b: imageData.data[i + 2],
    a: imageData.data[i + 3],
  }
}

export function setRgba(imageData: ImageData, x: number, y: number, c: Rgba): void {
  const i = (y * imageData.width + x) * 4
  imageData.data[i] = c.r
  imageData.data[i + 1] = c.g
  imageData.data[i + 2] = c.b
  imageData.data[i + 3] = c.a ?? 255
}
