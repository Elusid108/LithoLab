import { transparentPixel } from '../util/colorUtil'
import { buildTextureTransform, emitTriTransformed, getPixelHeightTexture } from './csgThreadTextureRow'
import type { BinaryStlBuilder, Vec3 } from './stl'
import type { CSGWorkData } from './csgWorkData'

function xyz(x: number, y: number, z: number): Vec3 {
  return [x, y, z]
}

export function runTextureRowTransparent(
  csgWorkData: CSGWorkData,
  y: number,
  mesh: BinaryStlBuilder,
): void {
  const img = csgWorkData.texturedImage!
  const width = img.width
  const g = csgWorkData.genInstruction
  const pixelWidth = g.texturePixelWidth
  const trans = buildTextureTransform(csgWorkData)

  const getH = (x: number, yy: number): number => {
    if (transparentPixel(img, x, yy)) return 0
    return getPixelHeightTexture(img, x, yy, g.textureMinThickness, g.textureMaxThickness)
  }

  for (let x = 0; x < width - 1; x++) {
    if (transparentPixel(img, x, y)) continue

    const i = x * pixelWidth
    const j = y * pixelWidth
    const i1 = x * pixelWidth + pixelWidth
    const j1 = y * pixelWidth + pixelWidth
    const jm1 = y * pixelWidth - pixelWidth

    let toBuildA = true
    let toBuildB = true
    let toBuildC = true
    let toBuildD = true
    if (transparentPixel(img, x + 1, y)) {
      toBuildB = false
      toBuildC = false
      toBuildD = false
    }
    if (transparentPixel(img, x + 1, y + 1)) {
      toBuildA = false
      toBuildB = false
    } else {
      toBuildC = false
    }
    if (transparentPixel(img, x, y + 1)) {
      toBuildA = false
      toBuildC = false
    }
    if (transparentPixel(img, x + 1, y - 1)) {
      toBuildD = false
    }
    if (!transparentPixel(img, x, y - 1)) {
      toBuildD = false
    }

    if (toBuildA) {
      const triangleA1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i, j1, getH(x, y + 1)),
      ]
      emitTriTransformed(mesh, triangleA1, trans)

      const triangleA2: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j1, 0), xyz(i, j1, 0)]
      emitTriTransformed(mesh, triangleA2, trans)
    }
    if (toBuildB) {
      const triangleB1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j, getH(x + 1, y)),
        xyz(i1, j1, getH(x + 1, y + 1)),
      ]
      emitTriTransformed(mesh, triangleB1, trans)

      const triangleB2: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j, 0), xyz(i1, j1, 0)]
      emitTriTransformed(mesh, triangleB2, trans)
    }

    if (toBuildC) {
      const triangleC1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j, getH(x + 1, y)),
        xyz(i, j1, getH(x, y + 1)),
      ]
      emitTriTransformed(mesh, triangleC1, trans)

      const triangleC2: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j, 0), xyz(i, j1, 0)]
      emitTriTransformed(mesh, triangleC2, trans)
    }

    if (toBuildD) {
      const triangleD1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j, getH(x + 1, y)),
        xyz(i1, jm1, getH(x + 1, y - 1)),
      ]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j, 0), xyz(i1, jm1, 0)]
      emitTriTransformed(mesh, triangleD2, trans)
    }

    if ((toBuildA && !toBuildB) || (toBuildB && !toBuildA)) {
      const triangleA1: [Vec3, Vec3, Vec3] = [xyz(i, j, getH(x, y)), xyz(i, j, 0), xyz(i1, j1, 0)]
      emitTriTransformed(mesh, triangleA1, trans)

      const triangleA2: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i1, j1, 0),
      ]
      emitTriTransformed(mesh, triangleA2, trans)
    }
    if (toBuildC) {
      const triangleC1: [Vec3, Vec3, Vec3] = [
        xyz(i, j1, getH(x, y + 1)),
        xyz(i, j1, 0),
        xyz(i1, j, 0),
      ]
      emitTriTransformed(mesh, triangleC1, trans)

      const triangleC2: [Vec3, Vec3, Vec3] = [
        xyz(i, j1, getH(x, y + 1)),
        xyz(i1, j, 0),
        xyz(i1, j, getH(x + 1, y)),
      ]
      emitTriTransformed(mesh, triangleC2, trans)
    }
    if (toBuildD) {
      const triangleD1: [Vec3, Vec3, Vec3] = [xyz(i, j, getH(x, y)), xyz(i, j, 0), xyz(i1, jm1, 0)]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, jm1, getH(x + 1, y - 1)),
        xyz(i1, jm1, 0),
      ]
      emitTriTransformed(mesh, triangleD2, trans)
    }

    if (toBuildB && transparentPixel(img, x, y - 1) && transparentPixel(img, x + 1, y - 1)) {
      const triangleD1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i, j, 0),
        xyz(i1, j, getH(x + 1, y)),
      ]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j, getH(x + 1, y)), xyz(i1, j, 0)]
      emitTriTransformed(mesh, triangleD2, trans)
    }

    if (toBuildA && transparentPixel(img, x, y + 2) && transparentPixel(img, x + 1, y + 2)) {
      const triangleD1: [Vec3, Vec3, Vec3] = [
        xyz(i, j1, getH(x, y)),
        xyz(i, j1, 0),
        xyz(i1, j1, getH(x + 1, y + 1)),
      ]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [
        xyz(i, j1, 0),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i1, j1, 0),
      ]
      emitTriTransformed(mesh, triangleD2, trans)
    }

    if (toBuildA && transparentPixel(img, x - 1, y) && transparentPixel(img, x - 1, y + 1)) {
      const triangleD1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i, j, 0),
        xyz(i, j1, getH(x, y + 1)),
      ]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [
        xyz(i, j, 0),
        xyz(i, j1, getH(x, y + 1)),
        xyz(i, j1, 0),
      ]
      emitTriTransformed(mesh, triangleD2, trans)
    }

    if (toBuildB && transparentPixel(img, x + 2, y) && transparentPixel(img, x + 2, y + 1)) {
      const triangleD1: [Vec3, Vec3, Vec3] = [
        xyz(i1, j, getH(x + 1, y)),
        xyz(i1, j, 0),
        xyz(i1, j1, getH(x + 1, y + 1)),
      ]
      emitTriTransformed(mesh, triangleD1, trans)

      const triangleD2: [Vec3, Vec3, Vec3] = [
        xyz(i1, j, 0),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i1, j1, 0),
      ]
      emitTriTransformed(mesh, triangleD2, trans)
    }
  }

}
