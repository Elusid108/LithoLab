import type { GenInstruction } from '../genInstruction'
import { cuboidTriangles, writeSolidStl } from './stl'

export function generateSupportPlateStl(colorImage: ImageData, genInstruction: GenInstruction): string {
  const colorPixelWidth = genInstruction.colorPixelWidth
  const plateThickness = genInstruction.plateThickness
  const width = colorImage.width * colorPixelWidth
  const height = colorImage.height * colorPixelWidth

  const cx = (width - colorPixelWidth) / 2
  const cy = (height - colorPixelWidth) / 2
  const cz = plateThickness / 2 - plateThickness

  const facets = cuboidTriangles(cx, cy, cz, width, height, plateThickness)
  return writeSolidStl(facets)
}
