import { imageDataToPngBlob } from './imageUtil'

const NEAR_BLACK = 32

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}

function isNearBlack(data: Uint8ClampedArray, i: number, threshold = NEAR_BLACK): boolean {
  if (data[i + 3] === 0) return true
  return luminance(data, i) < threshold
}

/** 1 = near-black / transparent. */
export function nearBlackMask(img: ImageData, threshold = NEAR_BLACK): Uint8Array {
  const { width, height, data } = img
  const out = new Uint8Array(width * height)
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    if (isNearBlack(data, i, threshold)) out[p] = 1
  }
  return out
}

/**
 * Flood-fill near-black pixels connected to the image border.
 * Enclosed black (letter counters) is left unmarked.
 */
export function floodFillBorderBlack(black: Uint8Array, width: number, height: number): Uint8Array {
  const bg = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const p = y * width + x
    if (!black[p] || bg[p]) return
    bg[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (stack.length > 0) {
    const p = stack.pop()!
    const x = p % width
    const y = (p / width) | 0
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return bg
}

/**
 * Body pixels for polygon extraction: not near-black (white and gray stay inside
 * so a dark flower cannot punch a hole). Holes remain the enclosed black pockets.
 */
export function maskBodyInside(img: ImageData, threshold = NEAR_BLACK): Uint8Array {
  const black = nearBlackMask(img, threshold)
  const inside = new Uint8Array(black.length)
  for (let p = 0; p < black.length; p++) {
    if (!black[p]) inside[p] = 1
  }
  return inside
}

export function overlayMaskReliefPreview(target: ImageData, relief: ImageData): void {
  if (target.width !== relief.width || target.height !== relief.height) return
  const td = target.data
  const rd = relief.data
  for (let i = 0; i < td.length; i += 4) {
    if (td[i + 3] === 0 || rd[i + 3] === 0) continue
    const extra = 255 - Math.round(0.2126 * rd[i] + 0.7152 * rd[i + 1] + 0.0722 * rd[i + 2])
    if (extra <= 0) continue
    td[i] = Math.max(0, td[i] - extra)
    td[i + 1] = Math.max(0, td[i + 1] - extra)
    td[i + 2] = Math.max(0, td[i + 2] - extra)
  }
}

export interface AiMaskProcessOpts {
  fillHoles: boolean
  forceBinary: boolean
}

/** Cookiecutter fills enclosed black; gradient-off thresholds to hard B&W. */
export function postProcessAiMaskImageData(img: ImageData, opts: AiMaskProcessOpts): ImageData {
  const { width, height, data } = img
  const out = new ImageData(width, height)
  const dst = out.data
  dst.set(data)

  const black = nearBlackMask(out)
  const bg = floodFillBorderBlack(black, width, height)

  for (let p = 0, i = 0; p < black.length; p++, i += 4) {
    if (opts.fillHoles && black[p] && !bg[p]) {
      dst[i] = 255
      dst[i + 1] = 255
      dst[i + 2] = 255
      dst[i + 3] = 255
    }
  }

  if (opts.forceBinary) {
    for (let p = 0, i = 0; p < black.length; p++, i += 4) {
      if (dst[i + 3] === 0) {
        dst[i] = 0
        dst[i + 1] = 0
        dst[i + 2] = 0
        continue
      }
      const lum = luminance(dst, i)
      const v = lum >= 128 ? 255 : 0
      dst[i] = v
      dst[i + 1] = v
      dst[i + 2] = v
      dst[i + 3] = 255
    }
  }

  return out
}

export async function postProcessAiMaskBlob(blob: Blob, opts: AiMaskProcessOpts): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Failed to decode generated mask'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, img.naturalWidth || img.width)
    canvas.height = Math.max(1, img.naturalHeight || img.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0)
    const processed = postProcessAiMaskImageData(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      opts,
    )
    return imageDataToPngBlob(processed)
  } finally {
    URL.revokeObjectURL(url)
  }
}
