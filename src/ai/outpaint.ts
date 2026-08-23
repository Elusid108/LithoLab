/** Canvas helpers for square, centered photo edge-extend (outpaint). */

export const OUTPAINT_MAX_SIDE = 3840
export const OUTPAINT_MIN_SIDE = 2048
export const OUTPAINT_API_MAX_EDGE = 2048
export const OUTPAINT_ASPECT_RATIO = '1:1'
export const OUTPAINT_COLOR_SHIFT_MAX = 40

export interface OutpaintLayout {
  outW: number
  outH: number
  placedW: number
  placedH: number
  ox: number
  oy: number
}

export interface OutpaintRequestPayload {
  jpegBase64: string
  originalJpegBase64: string
  mime: string
  aspectRatio: string
  layout: OutpaintLayout
}

export function imageNaturalSize(img: HTMLImageElement): { w: number; h: number } {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

export function computeOutpaintLayout(srcW: number, srcH: number): OutpaintLayout {
  const w = Math.max(1, srcW)
  const h = Math.max(1, srcH)
  const longEdge = Math.max(w, h)
  const side = Math.min(OUTPAINT_MAX_SIDE, Math.max(longEdge * 2, OUTPAINT_MIN_SIDE))
  const maxPlacedLong = side / 2
  let placedW = w
  let placedH = h
  if (longEdge > maxPlacedLong) {
    const scale = maxPlacedLong / longEdge
    placedW = Math.max(1, Math.round(w * scale))
    placedH = Math.max(1, Math.round(h * scale))
  }
  return {
    outW: side,
    outH: side,
    placedW,
    placedH,
    ox: Math.round((side - placedW) / 2),
    oy: Math.round((side - placedH) / 2),
  }
}

export function layoutForImage(img: HTMLImageElement): OutpaintLayout {
  const { w, h } = imageNaturalSize(img)
  return computeOutpaintLayout(w, h)
}

export function buildOutpaintPrompt(extra: string): string {
  const base =
    'The first image is a square 1:1 canvas. The sharp center is the original photo. ' +
    'The bands around it are stretched edge colors only — a placeholder, not the real background. ' +
    'Replace those stretched bands with a natural continuation of the scene: more of the same ' +
    'environment, lighting, and style. Invent new background that matches, such as more sky, ' +
    'ground, or stars. Do not copy, enlarge, blur, or ghost the subject into the border. ' +
    'The second image is the exact original artwork. Keep that subject in the center at the ' +
    'same size and pose. Do not duplicate it. ' +
    'The result must be a seamless square. No rectangle, frame, halo, or hard edge around the original.'
  const trimmed = extra.trim()
  return trimmed ? `${base} Additional guidance: ${trimmed}` : base
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = src
  })
}

function canvasToJpegBase64(canvas: HTMLCanvasElement, quality = 0.85): string {
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  return ctx
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function downscaleIfNeeded(source: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const edge = Math.max(source.width, source.height, 1)
  if (edge <= maxEdge) return source
  const scale = maxEdge / edge
  const next = document.createElement('canvas')
  next.width = Math.max(1, Math.round(source.width * scale))
  next.height = Math.max(1, Math.round(source.height * scale))
  const ctx = require2d(next)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, next.width, next.height)
  return next
}

function placedSource(img: HTMLImageElement, layout: OutpaintLayout): HTMLCanvasElement {
  const src = document.createElement('canvas')
  src.width = layout.placedW
  src.height = layout.placedH
  const sctx = require2d(src)
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(img, 0, 0, layout.placedW, layout.placedH)
  return src
}

/** Stretch only the outer edge colors into the pad — never a scaled copy of the subject. */
function drawEdgeExtrudedPad(img: HTMLImageElement, layout: OutpaintLayout): HTMLCanvasElement {
  const { ox, oy, placedW, placedH, outW, outH } = layout
  const src = placedSource(img, layout)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = require2d(canvas)
  ctx.imageSmoothingEnabled = false

  const strip = Math.min(4, Math.max(1, Math.floor(Math.min(placedW, placedH) / 80)))
  const right = Math.max(0, outW - (ox + placedW))
  const bottom = Math.max(0, outH - (oy + placedH))

  if (ox > 0 && oy > 0) ctx.drawImage(src, 0, 0, strip, strip, 0, 0, ox, oy)
  if (right > 0 && oy > 0) {
    ctx.drawImage(src, placedW - strip, 0, strip, strip, ox + placedW, 0, right, oy)
  }
  if (ox > 0 && bottom > 0) {
    ctx.drawImage(src, 0, placedH - strip, strip, strip, 0, oy + placedH, ox, bottom)
  }
  if (right > 0 && bottom > 0) {
    ctx.drawImage(
      src,
      placedW - strip,
      placedH - strip,
      strip,
      strip,
      ox + placedW,
      oy + placedH,
      right,
      bottom,
    )
  }
  if (oy > 0) ctx.drawImage(src, 0, 0, placedW, strip, ox, 0, placedW, oy)
  if (bottom > 0) {
    ctx.drawImage(src, 0, placedH - strip, placedW, strip, ox, oy + placedH, placedW, bottom)
  }
  if (ox > 0) ctx.drawImage(src, 0, 0, strip, placedH, 0, oy, ox, placedH)
  if (right > 0) {
    ctx.drawImage(src, placedW - strip, 0, strip, placedH, ox + placedW, oy, right, placedH)
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, ox, oy)
  return canvas
}

export function prepareOutpaintRequest(img: HTMLImageElement): OutpaintRequestPayload {
  const layout = layoutForImage(img)
  const padded = drawEdgeExtrudedPad(img, layout)
  const send = downscaleIfNeeded(padded, OUTPAINT_API_MAX_EDGE)
  const originalSend = downscaleIfNeeded(placedSource(img, layout), OUTPAINT_API_MAX_EDGE)
  return {
    jpegBase64: canvasToJpegBase64(send),
    originalJpegBase64: canvasToJpegBase64(originalSend),
    mime: 'image/jpeg',
    aspectRatio: OUTPAINT_ASPECT_RATIO,
    layout,
  }
}

function featherPx(layout: OutpaintLayout): number {
  const short = Math.min(layout.placedW, layout.placedH)
  const minPx = short >= 400 ? 24 : 8
  return Math.max(minPx, Math.round(short * 0.04))
}

function bandMean(imageData: ImageData, band: number): { r: number; g: number; b: number } {
  const { width: w, height: h, data } = imageData
  const b = Math.max(1, Math.min(band, Math.floor(Math.min(w, h) / 4)))
  let r = 0
  let g = 0
  let bl = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= b && y >= b && x < w - b && y < h - b) continue
      const i = (y * w + x) * 4
      r += data[i]!
      g += data[i + 1]!
      bl += data[i + 2]!
      n++
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 }
  return { r: r / n, g: g / n, b: bl / n }
}

function colorMatchPlacedOriginal(
  original: HTMLImageElement,
  generated: HTMLCanvasElement,
  layout: OutpaintLayout,
): HTMLCanvasElement {
  const placed = document.createElement('canvas')
  placed.width = layout.placedW
  placed.height = layout.placedH
  const pctx = require2d(placed)
  pctx.imageSmoothingEnabled = true
  pctx.imageSmoothingQuality = 'high'
  pctx.drawImage(original, 0, 0, layout.placedW, layout.placedH)

  const origData = pctx.getImageData(0, 0, layout.placedW, layout.placedH)
  const genData = require2d(generated).getImageData(
    layout.ox,
    layout.oy,
    layout.placedW,
    layout.placedH,
  )
  const band = Math.max(4, Math.round(Math.min(layout.placedW, layout.placedH) * 0.04))
  const oMean = bandMean(origData, band)
  const gMean = bandMean(genData, band)
  const dr = clamp(gMean.r - oMean.r, -OUTPAINT_COLOR_SHIFT_MAX, OUTPAINT_COLOR_SHIFT_MAX)
  const dg = clamp(gMean.g - oMean.g, -OUTPAINT_COLOR_SHIFT_MAX, OUTPAINT_COLOR_SHIFT_MAX)
  const db = clamp(gMean.b - oMean.b, -OUTPAINT_COLOR_SHIFT_MAX, OUTPAINT_COLOR_SHIFT_MAX)

  const px = origData.data
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clamp(px[i]! + dr, 0, 255)
    px[i + 1] = clamp(px[i + 1]! + dg, 0, 255)
    px[i + 2] = clamp(px[i + 2]! + db, 0, 255)
  }
  pctx.putImageData(origData, 0, 0)
  return placed
}

function featheredOverlay(
  placed: HTMLCanvasElement,
  layout: OutpaintLayout,
  feather: number,
): HTMLCanvasElement {
  const overlay = document.createElement('canvas')
  overlay.width = layout.outW
  overlay.height = layout.outH
  const octx = require2d(overlay)
  octx.drawImage(placed, layout.ox, layout.oy)

  const maxFeather = Math.floor(Math.min(layout.placedW, layout.placedH) / 6)
  const f = Math.max(0, Math.min(feather, maxFeather))
  const mask = document.createElement('canvas')
  mask.width = layout.outW
  mask.height = layout.outH
  const mctx = require2d(mask)
  mctx.fillStyle = '#fff'
  if (f <= 0) {
    mctx.fillRect(layout.ox, layout.oy, layout.placedW, layout.placedH)
  } else {
    mctx.filter = `blur(${f}px)`
    mctx.fillRect(
      layout.ox + f,
      layout.oy + f,
      Math.max(1, layout.placedW - 2 * f),
      Math.max(1, layout.placedH - 2 * f),
    )
    mctx.filter = 'none'
  }

  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(mask, 0, 0)
  return overlay
}

export function compositeOutpaintResult(
  generated: HTMLImageElement,
  original: HTMLImageElement,
): HTMLCanvasElement {
  const layout = layoutForImage(original)
  const canvas = document.createElement('canvas')
  canvas.width = layout.outW
  canvas.height = layout.outH
  const ctx = require2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(generated, 0, 0, layout.outW, layout.outH)
  const matched = colorMatchPlacedOriginal(original, canvas, layout)
  ctx.drawImage(featheredOverlay(matched, layout, featherPx(layout)), 0, 0)
  return canvas
}
