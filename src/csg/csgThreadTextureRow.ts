import { colorToCMYK, packedRgbToRgba } from '../util/colorUtil'
import { facetToStlString, triangleNormal, type Vec3 } from './stl'
import type { CSGWorkData } from './csgWorkData'

function xyz(x: number, y: number, z: number): Vec3 {
  return [x, y, z]
}

export function curveTriangleList(width: number, curve: number, triangleList: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
  if (curve === 0) return triangleList

  const angle = Math.abs(curve)
  const a = (width / curve) * (180 / Math.PI)
  let d = Math.sin(angle * (360 / Math.PI)) * a
  if (angle >= 180) d = 0
  const s = 0 - angle / 2

  const out: Vec3[] = []
  for (const vector3d of triangleList) {
    const x = vector3d[0]
    const y = vector3d[1]
    const z = vector3d[2]
    const u = x / width
    const r = s + angle * u
    const rt = r * (Math.PI / 180)
    const m = a + z
    const newX = width / 2 + m * Math.sin(rt)
    const newZ = d + m * Math.cos(rt)
    out.push([newX, y, newZ])
  }
  return [out[0], out[1], out[2]]
}

export function getPixelHeightTexture(
  texturedImage: ImageData,
  x: number,
  y: number,
  textureMinThickness: number,
  textureMaxThickness: number,
): number {
  const i = (y * texturedImage.width + x) * 4
  const pixel = (texturedImage.data[i + 3] << 24) | (texturedImage.data[i] << 16) | (texturedImage.data[i + 1] << 8) | texturedImage.data[i + 2]
  const pixelColor = packedRgbToRgba(pixel)
  let layerHeight = colorToCMYK(pixelColor)[3]
  layerHeight *= textureMaxThickness - textureMinThickness
  layerHeight += textureMinThickness
  return layerHeight
}

export function buildTextureTransform(csgWorkData: CSGWorkData): [number, number, number] | null {
  const g = csgWorkData.genInstruction
  if (!g.colorLayer || !csgWorkData.colorImage) return null

  const tW = csgWorkData.texturedImage!.width * g.texturePixelWidth
  const tH = csgWorkData.texturedImage!.height * g.texturePixelWidth
  const cW = csgWorkData.colorImage.width * g.colorPixelWidth
  const cH = csgWorkData.colorImage.height * g.colorPixelWidth
  const diffW = tW - cW
  const diffH = tH - cH
  const colorCenterOffX = (g.destImageWidth - cW) / 2
  const colorCenterOffY = (g.destImageHeight - cH) / 2

  const tx = -diffW / 2 - (g.colorPixelWidth - g.texturePixelWidth) / 2 + colorCenterOffX
  const ty = -diffH / 2 - (g.colorPixelWidth - g.texturePixelWidth) / 2 + colorCenterOffY
  const tz = g.colorPixelLayerThickness * csgWorkData.palette.getLayerCount()
  return [tx, ty, tz]
}

export function applyTrans(v: Vec3, t: [number, number, number] | null): Vec3 {
  if (!t) return v
  return [v[0] + t[0], v[1] + t[1], v[2] + t[2]]
}

export function emitTriTransformed(
  tri: [Vec3, Vec3, Vec3],
  trans: [number, number, number] | null,
): string {
  const t0 = applyTrans(tri[0], trans)
  const t1 = applyTrans(tri[1], trans)
  const t2 = applyTrans(tri[2], trans)
  const n = triangleNormal(t0, t1, t2)
  return facetToStlString(n, t0, t1, t2)
}

export function runTextureRowOpaque(csgWorkData: CSGWorkData, y: number): string[] {
  const img = csgWorkData.texturedImage!
  const width = img.width
  const height = img.height
  const g = csgWorkData.genInstruction
  const pixelWidth = g.texturePixelWidth
  const curve = g.curve
  const trans = buildTextureTransform(csgWorkData)

  let diffW = 0
  let diffH = 0
  if (g.colorLayer && csgWorkData.colorImage) {
    diffW = pixelWidth * width - csgWorkData.colorImage.width * g.colorPixelWidth
    diffH = pixelWidth * height - csgWorkData.colorImage.height * g.colorPixelWidth
  }

  const iMid = (width / 2) * pixelWidth
  const jMid = (height / 2) * pixelWidth
  const widthPixel = width * pixelWidth

  const facets: string[] = []

  if (y === height - 1) return facets

  const getH = (x: number, yy: number) =>
    getPixelHeightTexture(img, x, yy, g.textureMinThickness, g.textureMaxThickness)

  for (let x = 0; x < width; x++) {
    if (x === width - 1) continue

    let i = x * pixelWidth
    if (x === 0) i = diffW / 2 - pixelWidth / 2

    let j = y * pixelWidth
    if (y === 0) j = diffH / 2 - pixelWidth / 2

    let i1 = x * pixelWidth + pixelWidth
    if (x === width - 2) i1 += -diffW / 2 + pixelWidth / 2

    let j1 = y * pixelWidth + pixelWidth
    if (y === height - 2) j1 += -diffH / 2 + pixelWidth / 2

    if (x === 0) {
      const t1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i, j1, getH(x, y + 1)),
        xyz(i, j1, 0),
      ]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t1), trans))

      const t2: [Vec3, Vec3, Vec3] = [xyz(i, j, getH(x, y)), xyz(i, j, 0), xyz(i, j1, 0)]
      facets.push(emitTriTransformed(t2, trans))

      if (curve === 0) {
        const t3: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i, j1, 0), xyz(iMid, jMid, 0)]
        facets.push(emitTriTransformed(t3, trans))
      }
    }

    if (y === 0) {
      const t1: [Vec3, Vec3, Vec3] = [
        xyz(i, j, getH(x, y)),
        xyz(i1, j, getH(x + 1, y)),
        xyz(i1, j, 0),
      ]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t1), trans))

      const t2: [Vec3, Vec3, Vec3] = [xyz(i, j, getH(x, y)), xyz(i, j, 0), xyz(i1, j, 0)]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t2), trans))

      if (curve === 0) {
        const t3: [Vec3, Vec3, Vec3] = [xyz(i, j, 0), xyz(i1, j, 0), xyz(iMid, jMid, 0)]
        facets.push(emitTriTransformed(t3, trans))
      }
    }

    if (x === width - 2) {
      const t1: [Vec3, Vec3, Vec3] = [
        xyz(i1, j, getH(x + 1, y)),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i1, j1, 0),
      ]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t1), trans))

      const t2: [Vec3, Vec3, Vec3] = [xyz(i1, j, getH(x + 1, y)), xyz(i1, j, 0), xyz(i1, j1, 0)]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t2), trans))

      if (curve === 0) {
        const t3: [Vec3, Vec3, Vec3] = [xyz(i1, j, 0), xyz(i1, j1, 0), xyz(iMid, jMid, 0)]
        facets.push(emitTriTransformed(t3, trans))
      }
    }

    if (y === height - 2) {
      const t1: [Vec3, Vec3, Vec3] = [
        xyz(i, j1, getH(x, y + 1)),
        xyz(i1, j1, getH(x + 1, y + 1)),
        xyz(i1, j1, 0),
      ]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t1), trans))

      const t2: [Vec3, Vec3, Vec3] = [xyz(i, j1, getH(x, y + 1)), xyz(i, j1, 0), xyz(i1, j1, 0)]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t2), trans))

      if (curve === 0) {
        const t3: [Vec3, Vec3, Vec3] = [xyz(i, j1, 0), xyz(i1, j1, 0), xyz(iMid, jMid, 0)]
        facets.push(emitTriTransformed(t3, trans))
      }
    }

    const ta: [Vec3, Vec3, Vec3] = [
      xyz(i, j, getH(x, y)),
      xyz(i, j1, getH(x, y + 1)),
      xyz(i1, j, getH(x + 1, y)),
    ]
    facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, ta), trans))

    const tb: [Vec3, Vec3, Vec3] = [
      xyz(i1, j1, getH(x + 1, y + 1)),
      xyz(i, j1, getH(x, y + 1)),
      xyz(i1, j, getH(x + 1, y)),
    ]
    facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, tb), trans))

    if (curve !== 0 && y === 0) {
      const t3: [Vec3, Vec3, Vec3] = [xyz(i, 0, 0), xyz(i, height * pixelWidth, 0), xyz(i1, 0, 0)]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t3), trans))

      const t4: [Vec3, Vec3, Vec3] = [
        xyz(i1, height * pixelWidth, 0),
        xyz(i, height * pixelWidth, 0),
        xyz(i1, 0, 0),
      ]
      facets.push(emitTriTransformed(curveTriangleList(widthPixel, curve, t4), trans))
    }
  }

  return facets
}
