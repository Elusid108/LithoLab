import { colorToCMYK, hexDecodeColor, hslToCmyk } from '../util/colorUtil'

export class ColorLayer {
  readonly hexCode: string
  readonly layer: number
  readonly c: number
  readonly m: number
  readonly y: number
  readonly k: number

  static fromHsl(hexCode: string, layer: number, h: number, s: number, l: number): ColorLayer {
    const cmyk = hslToCmyk(h, s, l)
    return new ColorLayer(hexCode, layer, cmyk[0], cmyk[1], cmyk[2], cmyk[3])
  }

  static fromCmyk(
    hexCode: string,
    layer: number,
    c: number,
    m: number,
    y: number,
    k: number,
  ): ColorLayer {
    return new ColorLayer(hexCode, layer, c, m, y, k)
  }

  private constructor(
    hexCode: string,
    layer: number,
    c: number,
    m: number,
    y: number,
    k: number,
  ) {
    this.hexCode = hexCode
    this.layer = layer
    this.c = c
    this.m = m
    this.y = y
    this.k = k
  }

  static layerComparator(a: ColorLayer, b: ColorLayer): number {
    const c1 = hexDecodeColor(a.hexCode)
    const c2 = hexDecodeColor(b.hexCode)
    const k1 = colorToCMYK(c1)[3]
    const k2 = colorToCMYK(c2)[3]
    return k2 - k1
  }
}
