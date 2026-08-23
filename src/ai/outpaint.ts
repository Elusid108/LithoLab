/** Canvas helpers for 2× photo edge-extend (outpaint). */

export const OUTPAINT_SCALE = 2
export const OUTPAINT_API_MAX_EDGE = 2048
export const OUTPAINT_FEATHER_PX = 12
export const OUTPAINT_PAD_FILL = '#7A7A7A'

const GEMINI_ASPECT_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '9:16', value: 9 / 16 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 },
]

export interface OutpaintRequestPayload {
  jpegBase64: string
  mime: string
  origW: number
  origH: number
  aspectRatio: string
}

export function imageNaturalSize(img: HTMLImageElement): { w: number; h: number } {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

export function nearestGeminiAspectRatio(w: number, h: number): string {
  const ratio = Math.max(1, w) / Math.max(1, h)
  let best = GEMINI_ASPECT_RATIOS[0]!.label
  let bestDist = Infinity
  for (const entry of GEMINI_ASPECT_RATIOS) {
    const dist = Math.abs(Math.log(ratio / entry.value))
    if (dist < bestDist) {
      bestDist = dist
      best = entry.label
    }
  }
  return best
}

export function buildOutpaintPrompt(extra: string): string {
  const base =
    'This photo has empty padding around the original picture in the center. ' +
    'The gray border is empty canvas that must be filled. ' +
    'Fill only the padded border so the scene continues naturally in every direction. ' +
    'Do not change, restyle, crop, or move the original subject in the center. ' +
    'Keep the same art style, lighting, colors, and aspect ratio.'
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

export function prepareOutpaintRequest(img: HTMLImageElement): OutpaintRequestPayload {
  const { w: origW, h: origH } = imageNaturalSize(img)
  const padW = origW * OUTPAINT_SCALE
  const padH = origH * OUTPAINT_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = padW
  canvas.height = padH
  const ctx = require2d(canvas)
  ctx.fillStyle = OUTPAINT_PAD_FILL
  ctx.fillRect(0, 0, padW, padH)
  const ox = Math.round((padW - origW) / 2)
  const oy = Math.round((padH - origH) / 2)
  ctx.drawImage(img, ox, oy, origW, origH)

  const send = downscaleIfNeeded(canvas, OUTPAINT_API_MAX_EDGE)
  return {
    jpegBase64: canvasToJpegBase64(send),
    mime: 'image/jpeg',
    origW,
    origH,
    aspectRatio: nearestGeminiAspectRatio(padW, padH),
  }
}

function featheredOriginalOverlay(
  original: HTMLImageElement,
  outW: number,
  outH: number,
  origW: number,
  origH: number,
  feather: number,
): HTMLCanvasElement {
  const ox = Math.round((outW - origW) / 2)
  const oy = Math.round((outH - origH) / 2)
  const overlay = document.createElement('canvas')
  overlay.width = outW
  overlay.height = outH
  const octx = require2d(overlay)
  octx.drawImage(original, ox, oy, origW, origH)

  const maxFeather = Math.floor(Math.min(origW, origH) / 16)
  const f = Math.max(0, Math.min(feather, maxFeather))
  const mask = document.createElement('canvas')
  mask.width = outW
  mask.height = outH
  const mctx = require2d(mask)
  mctx.fillStyle = '#fff'
  if (f <= 0) {
    mctx.fillRect(ox, oy, origW, origH)
  } else {
    mctx.filter = `blur(${f}px)`
    mctx.fillRect(ox + f, oy + f, Math.max(1, origW - 2 * f), Math.max(1, origH - 2 * f))
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
  const { w: origW, h: origH } = imageNaturalSize(original)
  const outW = origW * OUTPAINT_SCALE
  const outH = origH * OUTPAINT_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = require2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(generated, 0, 0, outW, outH)
  ctx.drawImage(
    featheredOriginalOverlay(original, outW, outH, origW, origH, OUTPAINT_FEATHER_PX),
    0,
    0,
  )
  return canvas
}
