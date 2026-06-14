import type { GenInstruction } from '../genInstruction'
import { cuboidTriangles, writeSolidStl } from './stl'

export function generateSupportPlateStl(colorImage: ImageData, genInstruction: GenInstruction): string {
  const colorPixelWidth = genInstruction.colorPixelWidth
  const plateThickness = genInstruction.plateThickness
  const cz = plateThickness / 2 - plateThickness

  const facets: string[] = []
  const w = colorImage.width
  for (let y = 0; y < colorImage.height; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = colorImage.data[(y * w + x) * 4 + 3]
      if (alpha <= 0) continue

      const cx = x * colorPixelWidth
      const cy = y * colorPixelWidth
      for (const f of cuboidTriangles(cx, cy, cz, colorPixelWidth, colorPixelWidth, plateThickness)) facets.push(f)
    }
  }

  return writeSolidStl(facets)
}
