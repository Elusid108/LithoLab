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
  maskJpegBase64: string
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

const OUTPAINT_PROMPT_CORE =
  'Fill only the white-mask / blurred border with new photorealistic scene that matches the original. ' +
  'Do not enlarge, duplicate, or stretch the subject. Do not copy the blur. ' +
  'No vertical or horizontal streaks, no smeared limbs, no repeated stripes. ' +
  'The result must be a seamless square 1:1 photograph. No rectangle, frame, halo, or hard edge around the original.'

export function buildOutpaintPrompt(extra: string): string {
  const base =
    'Image 1 is the original photograph. Keep that subject unchanged in the center at the same size and pose. ' +
    'Image 2 is a mask: black = keep exactly, white = generate new photorealistic scene. ' +
    'Image 3 is a 1:1 canvas with the original centered on a blurred continuation of the photo — ' +
    'the blur is only a color and lighting hint, not content to copy. ' +
    OUTPAINT_PROMPT_CORE
  const trimmed = extra.trim()
  return trimmed ? `${base} Additional guidance: ${trimmed}` : base
}

export function buildOutpaintRetryPrompt(extra: string): string {
  const base =
    'Expand this photograph to a square 1:1 image. Keep the subject the same size, centered, in the same pose. ' +
    'Invent a natural continuation of the real scene in the new areas around it ' +
    '(more of the same environment, lighting, and style). ' +
    'Do not stretch, smear, or duplicate the subject. No vertical or horizontal streaks. Photorealistic.'
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

/** Blurred cover-scale of the whole photo as pad — scene color/lighting without 1D streaks. */
function drawBlurredScenePad(img: HTMLImageElement, layout: OutpaintLayout): HTMLCanvasElement {
  const { ox, oy, outW, outH } = layout
  const src = placedSource(img, layout)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = require2d(canvas)

  const coverScale = Math.max(outW / src.width, outH / src.height)
  const dw = src.width * coverScale
  const dh = src.height * coverScale
  const dx = (outW - dw) / 2
  const dy = (outH - dh) / 2
  const blurPx = Math.max(24, Math.round(Math.min(outW, outH) * 0.045))
  ctx.filter = `blur(${blurPx}px)`
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, dx, dy, dw, dh)
  ctx.filter = 'none'
  ctx.drawImage(src, ox, oy)
  return canvas
}

/** White = generate, black = keep. */
function drawKeepFillMask(layout: OutpaintLayout): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = layout.outW
  canvas.height = layout.outH
  const ctx = require2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.outW, layout.outH)
  ctx.fillStyle = '#000000'
  ctx.fillRect(layout.ox, layout.oy, layout.placedW, layout.placedH)
  return canvas
}

export function prepareOutpaintRequest(img: HTMLImageElement): OutpaintRequestPayload {
  const layout = layoutForImage(img)
  const padded = drawBlurredScenePad(img, layout)
  const mask = drawKeepFillMask(layout)
  const send = downscaleIfNeeded(padded, OUTPAINT_API_MAX_EDGE)
  const originalSend = downscaleIfNeeded(placedSource(img, layout), OUTPAINT_API_MAX_EDGE)
  const maskSend = downscaleIfNeeded(mask, OUTPAINT_API_MAX_EDGE)
  return {
    jpegBase64: canvasToJpegBase64(send),
    originalJpegBase64: canvasToJpegBase64(originalSend),
    maskJpegBase64: canvasToJpegBase64(maskSend, 0.92),
    mime: 'image/jpeg',
    aspectRatio: OUTPAINT_ASPECT_RATIO,
    layout,
  }
}

function columnLumaVariance(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y0: number,
  y1: number,
): number {
  const n = y1 - y0
  if (n < 4) return 999
  let sum = 0
  const lums = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const p = ((y0 + i) * width + x) * 4
    const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
    lums[i] = lum
    sum += lum
  }
  const mean = sum / n
  let v = 0
  for (const lum of lums) {
    const d = lum - mean
    v += d * d
  }
  return v / n
}

function rowLumaVariance(
  data: Uint8ClampedArray,
  width: number,
  y: number,
  x0: number,
  x1: number,
): number {
  const n = x1 - x0
  if (n < 4) return 999
  let sum = 0
  const lums = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const p = (y * width + (x0 + i)) * 4
    const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
    lums[i] = lum
    sum += lum
  }
  const mean = sum / n
  let v = 0
  for (const lum of lums) {
    const d = lum - mean
    v += d * d
  }
  return v / n
}

function fractionBelow(values: number[], threshold: number): number {
  if (values.length === 0) return 0
  let n = 0
  for (const v of values) if (v < threshold) n++
  return n / values.length
}

/** True when pad pixels look like 1D edge stretch (near-identical columns or rows). */
export function outpaintPadLooksSmeared(
  generated: HTMLImageElement,
  original: HTMLImageElement,
): boolean {
  const layout = layoutForImage(original)
  const { ox, oy, placedW, placedH, outW, outH } = layout
  const top = oy
  const left = ox
  const right = Math.max(0, outW - (ox + placedW))
  const bottom = Math.max(0, outH - (oy + placedH))
  if (top < 16 && bottom < 16 && left < 16 && right < 16) return false

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = require2d(canvas)
  ctx.drawImage(generated, 0, 0, outW, outH)
  const { data, width } = ctx.getImageData(0, 0, outW, outH)

  const sampleCount = 40
  const varianceLimit = 36
  const smearShare = 0.65

  if (top >= 16 || bottom >= 16) {
    const vars: number[] = []
    const x0 = ox
    const x1 = ox + placedW
    const span = Math.max(1, x1 - x0)
    for (let s = 0; s < sampleCount; s++) {
      const x = x0 + Math.floor(((s + 0.5) * span) / sampleCount)
      if (top >= 16) vars.push(columnLumaVariance(data, width, x, 0, top))
      if (bottom >= 16) {
        vars.push(columnLumaVariance(data, width, x, oy + placedH, outH))
      }
    }
    if (fractionBelow(vars, varianceLimit) >= smearShare) return true
  }

  if (left >= 16 || right >= 16) {
    const vars: number[] = []
    const y0 = oy
    const y1 = oy + placedH
    const span = Math.max(1, y1 - y0)
    for (let s = 0; s < sampleCount; s++) {
      const y = y0 + Math.floor(((s + 0.5) * span) / sampleCount)
      if (left >= 16) vars.push(rowLumaVariance(data, width, y, 0, left))
      if (right >= 16) {
        vars.push(rowLumaVariance(data, width, y, ox + placedW, outW))
      }
    }
    if (fractionBelow(vars, varianceLimit) >= smearShare) return true
  }

  return false
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
