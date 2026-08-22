import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import {
  colorToHexCode,
  colorToHSL,
  findClosestColor,
  hexCodeComparator,
  hexToColor,
  transparentPixel,
  type Rgba,
} from '../util/colorUtil'
import { getImageDataFromCanvas, resizeImage, rgbaAt, setRgba } from '../util/imageUtil'
import { ColorCombi } from './colorCombi'
import { ColorLayer } from './colorLayer'
import { quantizeImageData } from '../workers/quantizeClient'

function num(obj: Record<string, unknown>, key: string): number {
  const v = obj[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseFloat(v)
  throw new Error(`Expected number for ${key}`)
}

export class Palette {
  private nbLayers = 0
  private readonly genInstruction: GenInstruction
  private quantizedColors = new Map<string, ColorCombi>()
  private hexCodesMap = new Map<string, string>()
  private readonly hexColorList: string[] = []
  private readonly hexColorGroups: string[][] = []
  private nbGroup = 0
  private layerCount = 0

  constructor(jsonContent: string, genInstruction: GenInstruction) {
    this.genInstruction = genInstruction
    const jsonObject = JSON.parse(jsonContent) as Record<string, Record<string, unknown>>
    const colorLayerList: ColorLayer[] = []

    for (const hexColor of Object.keys(jsonObject)) {
      const colorObject = jsonObject[hexColor]
      const colorName = String(colorObject.name)
      this.hexCodesMap.set(hexColor, colorName)
      if (colorObject.active === false) continue
      if (colorObject.layers && genInstruction.pixelCreationMethod === PixelCreationMethod.ADDITIVE) {
        const layersObject = colorObject.layers as Record<string, Record<string, unknown>>
        let maxLayer = 0
        let maxH = 0
        let maxS = 0
        let maxL = 0

        for (const layerKey of Object.keys(layersObject)) {
          const layer = parseInt(layerKey, 10)
          const subObject = layersObject[layerKey]
          let h: number
          let s: number
          let l: number
          if ('hexcode' in subObject) {
            const c = hexToColor(String(subObject.hexcode))
            const hsl = colorToHSL(c)
            h = hsl[0]
            s = hsl[1]
            l = hsl[2]
          } else {
            h = num(subObject, 'H')
            s = num(subObject, 'S')
            l = num(subObject, 'L')
          }
          if (layer > maxLayer) {
            maxLayer = layer
            maxH = h
            maxS = s
            maxL = l
          }
          colorLayerList.push(ColorLayer.fromHsl(hexColor, layer, h, s, l))
        }

        if (maxLayer > 0 && genInstruction.colorPixelLayerNumber > maxLayer) {
          for (let extra = maxLayer + 1; extra <= genInstruction.colorPixelLayerNumber; extra++) {
            let newL = maxL
            if (maxL < 90 && maxL > 10) {
              newL = Math.max(0, maxL - (extra - maxLayer) * 2)
            }
            colorLayerList.push(ColorLayer.fromHsl(hexColor, extra, maxH, maxS, newL))
          }
        }
        if (!this.hexColorList.includes(hexColor)) this.hexColorList.push(hexColor)
      } else if (genInstruction.pixelCreationMethod === PixelCreationMethod.FULL) {
        const c = hexToColor(hexColor)
        const hsl = colorToHSL(c)
        colorLayerList.push(
          ColorLayer.fromHsl(hexColor, genInstruction.colorPixelLayerNumber, hsl[0], hsl[1], hsl[2]),
        )
        if (!this.hexColorList.includes(hexColor)) this.hexColorList.push(hexColor)
      }
    }

    if (
      genInstruction.pixelCreationMethod === PixelCreationMethod.ADDITIVE &&
      !this.hexColorList.includes('#FFFFFF')
    ) {
      throw new Error(
        '"#FFFFFF" not found in the palette. The code "#FFFFFF" is mandatory in additive mode.',
      )
    }

    this.nbLayers = genInstruction.colorPixelLayerNumber
    colorLayerList.sort(ColorLayer.layerComparator)
    this.hexColorList.sort(hexCodeComparator)

    this.computeColorsByGroup(colorLayerList)
  }

  /** Remove #FFFFFF from palette list (Java mutates hexColorList in computeColorsByGroup). */
  private filterWhiteFromHexList(): void {
    const i = this.hexColorList.indexOf('#FFFFFF')
    if (i >= 0) this.hexColorList.splice(i, 1)
  }

  private static readonly MAX_COMBINATIONS = 200_000

  private createMultiCombi(
    restrictColorList: string[] | null,
    colorLayerList: ColorLayer[],
  ): ColorCombi[] {
    const targetLayers = this.genInstruction.colorPixelLayerNumber
    const result: ColorCombi[] = []

    for (let i = 0; i < colorLayerList.length; i++) {
      const colorLayer = colorLayerList[i]
      if (restrictColorList != null && !restrictColorList.includes(colorLayer.hexCode)) continue

      const seed = ColorCombi.fromLayer(colorLayer)
      if (seed.getTotalLayers() === targetLayers) {
        result.push(seed)
      }

      if (i + 1 < colorLayerList.length) {
        this.computeCombinationIterative(
          restrictColorList, seed, colorLayerList, targetLayers, result,
        )
      }

      if (result.length >= Palette.MAX_COMBINATIONS) {
        console.warn(
          `Palette: combination cap reached (${Palette.MAX_COMBINATIONS}). ` +
          'Reduce active colors or layer count for exhaustive coverage.',
        )
        break
      }
    }

    return result
  }

  /**
   * Iterative DFS replacement for the former recursive computeCombination.
   * Uses an explicit work stack to avoid call-stack overflow on large
   * color/layer configurations.
   */
  private computeCombinationIterative(
    restrictColorList: string[] | null,
    seedCombi: ColorCombi,
    colorLayerList: ColorLayer[],
    targetLayers: number,
    out: ColorCombi[],
  ): void {
    const maxColors = this.hexCodesMap.size
    const cap = Palette.MAX_COMBINATIONS

    interface Frame { combi: ColorCombi; startIdx: number }
    const stack: Frame[] = [{ combi: seedCombi, startIdx: 0 }]

    while (stack.length > 0) {
      if (out.length >= cap) return

      const frame = stack.pop()!
      const { combi, startIdx } = frame

      for (let i = startIdx; i < colorLayerList.length; i++) {
        const colorLayer = colorLayerList[i]
        if (restrictColorList != null && !restrictColorList.includes(colorLayer.hexCode)) continue
        if (combi.getTotalLayers() + colorLayer.layer > this.nbLayers) continue
        if (combi.getTotalColors() >= maxColors) break

        const combined = combi.combineLithoColorLayer(colorLayer, this.nbLayers)
        if (combined == null) continue

        if (combined.getTotalLayers() === targetLayers) {
          out.push(combined)
          if (out.length >= cap) return
        }

        if (i + 1 < colorLayerList.length && combined.getTotalLayers() < targetLayers) {
          stack.push({ combi: combined, startIdx: i + 1 })
        }
      }
    }
  }

  getColorHexList(): string[] {
    return [...this.hexCodesMap.keys()]
  }

  getColorName(hexCode: string): string {
    return this.hexCodesMap.get(hexCode) ?? ''
  }

  getColors(): Rgba[] {
    return [...this.quantizedColors.keys()].map((h) => hexToColor(h))
  }

  getColorCombi(c: Rgba): ColorCombi | undefined {
    return this.quantizedColors.get(colorToHexCode(c))
  }

  /**
   * Quantize image colors on a worker (falls back to the main thread).
   */
  async quantizeColors(
    imageData: ImageData,
    onProgress?: (p: { current: number; total: number }) => void,
  ): Promise<ImageData> {
    const { image, usedHexes } = await quantizeImageData(
      imageData,
      this.getColors(),
      this.genInstruction.colorDistanceComputation,
      onProgress,
    )
    const quantizedColorsTemp = new Map<string, ColorCombi>()
    for (const hex of usedHexes) {
      const combi = this.quantizedColors.get(hex)
      if (combi) quantizedColorsTemp.set(hex, combi)
    }
    this.quantizedColors = quantizedColorsTemp
    console.log(`Nb color used=${this.quantizedColors.size}`)
    return image
  }

  private computeColorsByGroup(colorLayerList: ColorLayer[]): void {
    this.filterWhiteFromHexList()
    const hexList = this.hexColorList

    let nbColorPool = hexList.length
    if (
      this.genInstruction.pixelCreationMethod === PixelCreationMethod.ADDITIVE &&
      this.genInstruction.colorNumber !== 0
    ) {
      nbColorPool = this.genInstruction.colorNumber - 1
    }

    let nbGroup = Math.floor(hexList.length / nbColorPool)
    nbGroup += hexList.length % nbColorPool === 0 ? 0 : 1

    const hexColorGroup: string[][] = []
    for (let i = 0; i < nbGroup; i++) hexColorGroup.push([])

    for (let i = 0; i < nbGroup; i++) {
      for (let j = 0; j < nbColorPool; j++) {
        if (nbColorPool * i + j >= hexList.length) break
        hexColorGroup[i].push(hexList[nbColorPool * i + j])
      }
    }

    const colorCombiListList: ColorCombi[][] = []
    for (let i = 0; i < nbGroup; i++) {
      const g = [...hexColorGroup[i]]
      g.push('#FFFFFF')
      const curColorCombiList = this.createMultiCombi(g, colorLayerList)
      colorCombiListList.push(curColorCombiList)
    }

    const cap = Palette.MAX_COMBINATIONS
    const tempColorCombiListList: ColorCombi[][] = []
    tempColorCombiListList.push(colorCombiListList[0])
    for (let i = 0; i < nbGroup - 1; i++) {
      const tempColorCombiList: ColorCombi[] = []
      const prevList = tempColorCombiListList[i]
      const nextList = colorCombiListList[i + 1]
      let capped = false
      for (const cI of prevList) {
        for (const cI1 of nextList) {
          tempColorCombiList.push(cI.combineLithoColorCombi(cI1))
          if (tempColorCombiList.length >= cap) { capped = true; break }
        }
        if (capped) break
      }
      if (capped) {
        console.warn(
          `Palette: Cartesian product cap reached (${cap}) at group ${i + 1}/${nbGroup}. ` +
          'Reduce active colors or layer count for exhaustive coverage.',
        )
      }
      tempColorCombiListList.push(tempColorCombiList)
    }
    const finalCombiList = tempColorCombiListList[tempColorCombiListList.length - 1]

    this.layerCount = this.nbLayers * nbGroup
    this.nbGroup = nbGroup

    this.quantizedColors.clear()
    for (const c of finalCombiList) {
      c.factorize()
      const col = c.getColor(this.genInstruction)
      this.quantizedColors.set(colorToHexCode(col), c)
    }

    this.optimizeWhiteLayer(nbColorPool)
    this.initHexColorGroupList(hexColorGroup, nbColorPool)
  }

  private optimizeWhiteLayer(nbColorPool: number): void {
    for (const c of this.quantizedColors.keys()) {
      const cc = this.quantizedColors.get(c)!
      const bottomLayerList: ColorLayer[] = []
      const middleLayerList: ColorLayer[] = []
      const topLayerList: ColorLayer[] = []
      let l = 0
      for (const cL of cc.getLayers()) {
        if (cL.hexCode === '#FFFFFF') {
          if (l <= nbColorPool) {
            bottomLayerList.push(cL)
          } else {
            topLayerList.push(cL)
          }
        } else {
          middleLayerList.push(cL)
        }
        l += cL.layer
      }
      cc.layers = []
      for (const l of bottomLayerList) cc.layers.push(l)
      for (const l of middleLayerList) cc.layers.push(l)
      for (const l of topLayerList) cc.layers.push(l)
    }
  }

  private initHexColorGroupList(hexColorGroup: string[][], nbColorPool: number): void {
    this.hexColorGroups.length = 0
    for (let i = 0; i < nbColorPool; i++) {
      this.hexColorGroups.push([])
    }

    for (const groupLayer of hexColorGroup) {
      const gl = groupLayer.filter((h) => h !== '#FFFFFF')
      for (let i = 0; i < nbColorPool; i++) {
        if (i >= gl.length) continue
        this.hexColorGroups[i].push(gl[i])
      }
    }

    this.hexColorGroups.push(['#FFFFFF'])
  }

  restrictFullColors(
    image: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
    colorNumber: number,
  ): void {
    const pixelated = getImageDataFromCanvas(
      resizeImage(
        image,
        this.genInstruction.destImageWidth,
        this.genInstruction.destImageHeight,
        this.genInstruction.colorPixelWidth,
      ),
    )
    // quantizeColors sync path for restrict - use internal sync
    const quantizedImage = this.quantizeColorsSync(pixelated)

    const colorCounts = new Map<string, number>()
    for (let y = 0; y < quantizedImage.height; y++) {
      for (let x = 0; x < quantizedImage.width; x++) {
        const c = rgbaAt(quantizedImage, x, y)
        const cc = this.quantizedColors.get(colorToHexCode(c))
        if (!cc) continue
        for (const cL of cc.getLayers()) {
          let count = colorCounts.get(cL.hexCode) ?? 0
          let nbLayer = cL.layer
          if (cL.hexCode === '#000000' && nbLayer === 5) nbLayer = 1
          colorCounts.set(cL.hexCode, count + nbLayer)
        }
      }
    }

    const sortedColors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])

    let cn = colorNumber
    const mostFrequentColors: string[] = []
    for (const [key] of sortedColors) {
      if (key === '#FFFFFF') {
        mostFrequentColors.push('#FFFFFF')
        cn--
      }
    }

    for (let i = 0; i < Math.min(sortedColors.length, cn); i++) {
      mostFrequentColors.push(sortedColors[i][0])
    }

    const newQuantizedColors = new Map<string, ColorCombi>()
    for (const c of this.quantizedColors.keys()) {
      const cC = this.quantizedColors.get(c)!
      let excluded = false
      for (const cL of cC.getLayers()) {
        if (!mostFrequentColors.includes(cL.hexCode)) {
          excluded = true
          break
        }
      }
      if (!excluded) newQuantizedColors.set(c, cC)
    }
    this.quantizedColors = newQuantizedColors

    const newHexCodesMap = new Map<string, string>()
    for (const c of this.quantizedColors.keys()) {
      const cC = this.quantizedColors.get(c)!
      for (const l of cC.getLayers()) {
        const hexCode = l.hexCode
        for (const hex of this.hexCodesMap.keys()) {
          if (hexCode === hex) {
            newHexCodesMap.set(hex, this.hexCodesMap.get(hex)!)
            break
          }
        }
      }
    }
    this.hexCodesMap = newHexCodesMap
  }

  private quantizeColorsSync(imageData: ImageData): ImageData {
    const width = imageData.width
    const height = imageData.height
    const colors = this.getColors()
    const quantizedImage = new ImageData(width, height)
    const usedColorList: Rgba[] = []

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (transparentPixel(imageData, x, y)) {
          setRgba(quantizedImage, x, y, { r: 0, g: 0, b: 0, a: 0 })
          continue
        }
        const pixelColor = rgbaAt(imageData, x, y)
        const closest = findClosestColor(
          pixelColor,
          colors,
          this.genInstruction.colorDistanceComputation,
        )
        const hex = colorToHexCode(closest)
        if (!usedColorList.some((u) => colorToHexCode(u) === hex)) usedColorList.push(closest)
        setRgba(quantizedImage, x, y, { ...closest, a: 255 })
      }
    }

    const quantizedColorsTemp = new Map<string, ColorCombi>()
    for (const c of usedColorList) {
      const combi = this.quantizedColors.get(colorToHexCode(c))
      if (combi) quantizedColorsTemp.set(colorToHexCode(c), combi)
    }
    this.quantizedColors = quantizedColorsTemp
    return quantizedImage
  }

  generateSwapFilamentsInstruction(): string {
    let layerIdx = 0
    let sB = ''
    for (let i = 0; i < this.getNbGroup(); i++) {
      sB += `Layer[${layerIdx}] :`
      let j = 0
      for (const hexColorGroup of this.hexColorGroups) {
        if (i >= hexColorGroup.length) continue
        if (j !== 0) sB += ', '
        j++
        if (i !== 0) {
          sB += `${this.getColorName(hexColorGroup[i - 1])}-->`
        }
        sB += this.getColorName(hexColorGroup[i])
      }
      sB += '\n'
      if (i === 0) layerIdx += this.genInstruction.plateThickness
      layerIdx +=
        this.genInstruction.colorPixelLayerThickness * (this.genInstruction.colorPixelLayerNumber + 1)
    }
    return sB
  }

  getNbGroup(): number {
    return this.nbGroup
  }

  hexColorGroupList(): string[][] {
    return this.hexColorGroups
  }

  getLayerCount(): number {
    return this.layerCount
  }
}
