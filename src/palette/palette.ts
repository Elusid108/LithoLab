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
          colorLayerList.push(ColorLayer.fromHsl(hexColor, layer, h, s, l))
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

  private createMultiCombi(
    restrictColorList: string[] | null,
    colorLayerList: ColorLayer[],
  ): ColorCombi[] {
    const colorCombiList: ColorCombi[] = []
    for (let i = 0; i < colorLayerList.length; i++) {
      const colorLayer = colorLayerList[i]
      if (restrictColorList != null && !restrictColorList.includes(colorLayer.hexCode)) continue

      const cC = ColorCombi.fromLayer(colorLayer)
      colorCombiList.push(cC)
      if (i + 1 < colorLayerList.length) {
        colorCombiList.push(...this.computeCombination(restrictColorList, cC, colorLayerList))
      }
    }
    const finalColorCombiList: ColorCombi[] = []
    for (const c of colorCombiList) {
      if (c.getTotalLayers() !== this.genInstruction.colorPixelLayerNumber) continue
      finalColorCombiList.push(c)
    }
    return finalColorCombiList
  }

  private computeCombination(
    restrictColorList: string[] | null,
    cC: ColorCombi,
    colorLayerList: ColorLayer[],
  ): ColorCombi[] {
    const colorCombiList: ColorCombi[] = []
    for (let i = 0; i < colorLayerList.length; i++) {
      const colorLayer = colorLayerList[i]
      if (restrictColorList != null && !restrictColorList.includes(colorLayer.hexCode)) continue
      const layer = colorLayer.layer
      if (cC.getTotalLayers() + layer > this.nbLayers) continue
      if (cC.getTotalColors() >= this.hexCodesMap.size) break

      const cC2 = cC.combineLithoColorLayer(colorLayer, this.nbLayers)
      if (cC2 == null) continue
      if (cC2.getTotalLayers() === this.genInstruction.colorPixelLayerNumber) colorCombiList.push(cC2)
      if (i + 1 < colorLayerList.length) {
        colorCombiList.push(...this.computeCombination(restrictColorList, cC2, colorLayerList))
      }
    }
    return colorCombiList
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
   * Quantize image colors; yields to event loop every `chunkRows` rows if > 0.
   */
  async quantizeColors(imageData: ImageData, chunkRows = 4): Promise<ImageData> {
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
      if (chunkRows > 0 && y % chunkRows === chunkRows - 1) {
        await new Promise((r) => requestAnimationFrame(r))
      }
    }

    const quantizedColorsTemp = new Map<string, ColorCombi>()
    for (const c of usedColorList) {
      const combi = this.quantizedColors.get(colorToHexCode(c))
      if (combi) quantizedColorsTemp.set(colorToHexCode(c), combi)
    }
    this.quantizedColors = quantizedColorsTemp
    console.log(`Nb color used=${this.quantizedColors.size}`)

    return quantizedImage
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

    const tempColorCombiListList: ColorCombi[][] = []
    tempColorCombiListList.push(colorCombiListList[0])
    for (let i = 0; i < nbGroup - 1; i++) {
      const tempColorCombiList: ColorCombi[] = []
      for (const cI of tempColorCombiListList[i]) {
        for (const cI1 of colorCombiListList[i + 1]) {
          tempColorCombiList.push(cI.combineLithoColorCombi(cI1))
        }
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
      cc.layers.push(...bottomLayerList, ...middleLayerList, ...topLayerList)
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
