import type { GenInstruction } from '../genInstruction'
import type { Palette } from '../palette/palette'

export class CSGWorkData {
  readonly colorImage: ImageData | null
  readonly texturedImage: ImageData | null
  readonly palette: Palette
  readonly hexCode: string[]
  readonly threadName: string
  readonly genInstruction: GenInstruction
  readonly offset: number
  readonly layerMax: number

  constructor(
    colorImage: ImageData | null,
    texturedImage: ImageData | null,
    palette: Palette,
    threadName: string,
    hexCode: string[],
    genInstruction: GenInstruction,
    offset = -1,
    layerMax = -1,
  ) {
    this.colorImage = colorImage
    this.texturedImage = texturedImage
    this.palette = palette
    this.threadName = threadName
    this.hexCode = hexCode
    this.genInstruction = genInstruction
    this.offset = offset
    this.layerMax = layerMax
  }
}
