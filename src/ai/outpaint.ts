/** Canvas helpers for square, centered photo edge-extend (outpaint). */

export const OUTPAINT_MAX_SIDE = 3840
export const OUTPAINT_SIDE_SCALE = 1.25
export const OUTPAINT_API_MAX_EDGE = 2048
export const OUTPAINT_ASPECT_RATIO = '1:1'

export interface OutpaintLayout {
  outW: number
  outH: number
  placedW: number
  placedH: number
  ox: number
  oy: number
}

export interface OutpaintRequestPayload {
  pngBase64: string
  mime: string
  aspectRatio: string
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
  const side = Math.min(OUTPAINT_MAX_SIDE, Math.max(1, Math.round(longEdge * OUTPAINT_SIDE_SCALE)))
  const maxPlacedLong = side / OUTPAINT_SIDE_SCALE
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
    'Expand this photograph into a seamless square 1:1 image. ' +
    'Keep the existing content in place at the same size and pose; ' +
    'fill only the empty margin with a natural continuation of the scene, lighting, and texture. ' +
    'Do not enlarge, duplicate, crop, or restage the subject. No border, frame, halo, or second copy.'
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

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  return ctx
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

/** Original centered on a transparent square — empty margin is the area to fill. */
function drawLetterboxedOriginal(img: HTMLImageElement, layout: OutpaintLayout): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = layout.outW
  canvas.height = layout.outH
  const ctx = require2d(canvas)
  ctx.clearRect(0, 0, layout.outW, layout.outH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, layout.ox, layout.oy, layout.placedW, layout.placedH)
  return canvas
}

export function prepareOutpaintRequest(img: HTMLImageElement): OutpaintRequestPayload {
  const layout = layoutForImage(img)
  const padded = drawLetterboxedOriginal(img, layout)
  const send = downscaleIfNeeded(padded, OUTPAINT_API_MAX_EDGE)
  return {
    pngBase64: canvasToPngBase64(send),
    mime: 'image/png',
    aspectRatio: OUTPAINT_ASPECT_RATIO,
  }
}
