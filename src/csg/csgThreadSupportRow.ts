import { hasATransparentPixel } from '../util/imageUtil'
import { transparentPixel, hasATransparentPixelAsNeighbor } from '../util/colorUtil'
import { cuboidTriangles } from './stl'
import type { CSGWorkData } from './csgWorkData'

export function runSupportRow(csgWorkData: CSGWorkData, y: number): string[] {
  const img = csgWorkData.colorImage!
  const width = img.width
  const transparentMode = hasATransparentPixel(img)
  const facets: string[] = []

  for (let x = 0; x < width; x++) {
    if (transparentPixel(img, x, y)) continue
    if (transparentMode && hasATransparentPixelAsNeighbor(img, x, y)) continue

    let k = 1
    for (; x + k < width; k++) {
      const pixel = getRgb(img, x, y)
      const pixelNext = getRgb(img, x + k, y)
      if (pixelNext !== pixel) break
      if (transparentMode && hasATransparentPixelAsNeighbor(img, x + k, y)) break
    }
    k--

    const pixelWidth = csgWorkData.genInstruction.colorPixelWidth
    const plateThickness = csgWorkData.genInstruction.plateThickness

    const w = pixelWidth + pixelWidth * k
    const cx = x * pixelWidth + (pixelWidth * k) / 2
    const cy = y * pixelWidth
    const cz = plateThickness / 2 - plateThickness

    facets.push(...cuboidTriangles(cx, cy, cz, w, pixelWidth, plateThickness))
    x += k
  }

  return facets
}

function getRgb(img: ImageData, x: number, y: number): number {
  const i = (y * img.width + x) * 4
  return (img.data[i + 3] << 24) | (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
}
