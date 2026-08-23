import { loadHtmlImage } from '../ai/outpaint'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])

export type ImportKind = 'photo' | 'mask'

export interface DecodedImport {
  img: HTMLImageElement
  blob: Blob
  objectUrl: string
}

/** CMS `looksLikeHeic`: ISO-BMFF `ftyp` brand, including HEIC renamed to `.jpg`. */
export function looksLikeHeic(buf: ArrayBuffer | Uint8Array): boolean {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8.length < 12) return false
  const ftyp = String.fromCharCode(u8[4], u8[5], u8[6], u8[7])
  if (ftyp !== 'ftyp') return false
  const brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11])
  return HEIC_BRANDS.has(brand)
}

export function looksLikeHeicName(name: string | undefined, mime: string | undefined): boolean {
  const n = (name ?? '').toLowerCase()
  const t = (mime ?? '').toLowerCase()
  return (
    n.endsWith('.heic') ||
    n.endsWith('.heif') ||
    t === 'image/heic' ||
    t === 'image/heif' ||
    t === 'image/heic-sequence'
  )
}

async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to')
  return heicTo({ blob, type: 'image/jpeg', quality: 0.92 })
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}

function bitmapToBlob(bitmap: ImageBitmap, mime: string, quality?: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, bitmap.width)
  canvas.height = Math.max(1, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return Promise.reject(new Error('Canvas unavailable'))
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      mime,
      quality,
    )
  })
}

/**
 * Decode any picked/imported image into a canvas-safe JPEG (photo) or PNG (mask).
 * HEIC/HEIF is converted first (same magic-byte rule as the Portfolio CMS).
 */
export async function decodeImportedImage(
  source: Blob,
  kind: ImportKind,
  fileName?: string,
): Promise<DecodedImport> {
  const buf = await source.arrayBuffer()
  let working: Blob = source
  let convertedHeic = false

  if (looksLikeHeic(buf) || looksLikeHeicName(fileName, source.type)) {
    try {
      working = await convertHeicToJpeg(new Blob([buf], { type: 'image/heic' }))
      convertedHeic = true
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`HEIC/HEIF conversion failed (${detail})`)
    }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await decodeBitmap(working)
  } catch {
    if (!convertedHeic) {
      try {
        working = await convertHeicToJpeg(new Blob([buf], { type: 'image/heic' }))
        convertedHeic = true
        bitmap = await decodeBitmap(working)
      } catch {
        bitmap = null
      }
    }
  }

  if (!bitmap) {
    throw new Error(
      'Could not decode that image. Try JPEG, PNG, WebP, or HEIC/HEIF.',
    )
  }

  const outMime = kind === 'mask' ? 'image/png' : 'image/jpeg'
  const blob = await bitmapToBlob(bitmap, outMime, kind === 'mask' ? undefined : 0.92)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await loadHtmlImage(objectUrl)
    return { img, blob, objectUrl }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err instanceof Error ? err : new Error('Failed to decode image')
  }
}
