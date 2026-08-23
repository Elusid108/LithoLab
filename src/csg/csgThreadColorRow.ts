import { packedRgbToRgba, transparentPixel } from '../util/colorUtil'
import { addCuboidTriangles, type BinaryStlBuilder } from './stl'
import type { CSGWorkData } from './csgWorkData'

export function runColorRow(csgWorkData: CSGWorkData, y: number, mesh: BinaryStlBuilder): void {
  const img = csgWorkData.colorImage!
  const width = img.width

  for (const colorName of csgWorkData.hexCode) {
    for (let x = 0; x < width; x++) {
      if (transparentPixel(img, x, y)) continue

      let k = 1
      const pixel = getRgb(img, x, y)
      for (; x + k < width; k++) {
        const pixelNext = getRgb(img, x + k, y)
        if (pixelNext !== pixel) break
      }
      k--

      const pixelColor = packedRgbToRgba(pixel)
      const colorCombi = csgWorkData.palette.getColorCombi(pixelColor)
      if (!colorCombi) continue

      const colorLayerList = colorCombi.getLayerList(colorName)

      for (const layer of colorLayerList) {
        let layerHeight = layer.layer
        if (layerHeight === 0) continue

        const onePixelHeightSize = csgWorkData.genInstruction.colorPixelLayerThickness
        let layerBefore = colorCombi.getLayerPosition(layer)

        if (csgWorkData.offset !== -1 && csgWorkData.layerMax !== -1) {
          if (layerBefore >= csgWorkData.offset + csgWorkData.layerMax) continue

          if (layerBefore < csgWorkData.offset) {
            if (layerBefore + layerHeight < csgWorkData.offset) continue
            const delta = csgWorkData.offset - layerBefore
            layerHeight -= delta
            layerBefore = 0
            if (layerHeight > csgWorkData.layerMax) {
              layerHeight = csgWorkData.layerMax
            }
          } else {
            if (layerBefore <= csgWorkData.offset) layerBefore = 0
            if (layerBefore > csgWorkData.offset) {
              layerBefore -= csgWorkData.offset
            }

            if (layerHeight + layerBefore > csgWorkData.layerMax) {
              const delta = layerHeight + layerBefore - csgWorkData.layerMax
              layerHeight -= delta
            }
          }
          if (layerHeight === 0) continue
        }

        const curPixelHeight = onePixelHeightSize * layerHeight
        let curPixelHeightAdjust = curPixelHeight / 2
        curPixelHeightAdjust += layerBefore * onePixelHeightSize

        const pixelWidth = csgWorkData.genInstruction.colorPixelWidth
        const gridWidthMm = width * pixelWidth
        const gridHeightMm = img.height * pixelWidth
        const xOff = (csgWorkData.genInstruction.destImageWidth - gridWidthMm) / 2
        const yOff = (csgWorkData.genInstruction.destImageHeight - gridHeightMm) / 2
        const wx = pixelWidth + k * pixelWidth
        const cx = x * pixelWidth + (pixelWidth * k) / 2 + xOff
        const cy = y * pixelWidth + yOff
        const cz = curPixelHeightAdjust

        addCuboidTriangles(mesh, cx, cy, cz, wx, pixelWidth, curPixelHeight)
      }
      x += k
    }
  }
}

function getRgb(img: ImageData, x: number, y: number): number {
  const i = (y * img.width + x) * 4
  return (img.data[i + 3] << 24) | (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
}
