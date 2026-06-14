import type { GenInstruction } from '../genInstruction'
import { cmykToColor, colorToHexCode, type Rgba } from '../util/colorUtil'
import { ColorLayer } from './colorLayer'

export class ColorCombi {
  layers: ColorLayer[]

  private constructor() {
    this.layers = []
  }

  static fromLayer(colorLayer: ColorLayer): ColorCombi {
    const c = new ColorCombi()
    c.layers.push(colorLayer)
    c.layers.sort(ColorLayer.layerComparator)
    return c
  }

  combineLithoColorLayer(colorLayer2: ColorLayer, nbLayerMax: number): ColorCombi | null {
    for (const c of this.layers) {
      if (c.hexCode === colorLayer2.hexCode) return null
    }
    if (this.getTotalLayers() + colorLayer2.layer > nbLayerMax) return null
    const c = this.duplicate()
    c.layers.push(colorLayer2)
    return c
  }

  combineLithoColorCombi(other: ColorCombi): ColorCombi {
    const c = this.duplicate()
    for (const l of other.layers) c.layers.push(l)
    return c
  }

  addLayer(colorLayer: ColorLayer): void {
    this.layers.push(colorLayer)
  }

  getTotalColors(): number {
    return this.layers.length
  }

  getTotalLayers(): number {
    let totalLayers = 0
    for (const lithoColorLayer of this.layers) {
      totalLayers += lithoColorLayer.layer
    }
    return totalLayers
  }

  getColor(genInstruction: GenInstruction): Rgba {
    const debug = genInstruction.debug
    let c = 0
    let m = 0
    let y = 0
    let k = 0
    for (const lithoColorLayer of this.layers) {
      if (debug) {
        console.log(`${lithoColorLayer.hexCode}[${lithoColorLayer.layer}]`)
      }
      c += lithoColorLayer.c
      m += lithoColorLayer.m
      y += lithoColorLayer.y
      k += lithoColorLayer.k
    }
    const color = cmykToColor(
      c < 1 ? c : 1,
      m < 1 ? m : 1,
      y < 1 ? y : 1,
      k < 1 ? k : 1,
    )
    if (debug) {
      console.log(`=${colorToHexCode(color)}`)
    }
    return color
  }

  duplicate(): ColorCombi {
    const c = new ColorCombi()
    for (const l of this.layers) c.layers.push(l)
    return c
  }

  factorize(): void {
    const newLayers: ColorLayer[] = []
    for (let i = 0; i < this.layers.length; i++) {
      const currL = this.layers[i]
      if (i === 0) {
        newLayers.push(currL)
        continue
      }
      const lastL = newLayers[newLayers.length - 1]
      if (lastL.hexCode === currL.hexCode) {
        newLayers.pop()
        newLayers.push(
          ColorLayer.fromCmyk(
            lastL.hexCode,
            lastL.layer + currL.layer,
            lastL.c,
            lastL.m,
            lastL.y,
            lastL.k,
          ),
        )
      } else {
        newLayers.push(currL)
      }
    }
    this.layers = newLayers
  }

  getLayerList(hexCode: string): ColorLayer[] {
    return this.layers.filter((layer) => layer.hexCode === hexCode)
  }

  getLayerPosition(layer: ColorLayer): number {
    let nbLayerBeforeThisColor = 0
    for (const curLayer of this.layers) {
      if (curLayer === layer) break
      nbLayerBeforeThisColor += curLayer.layer
    }
    return nbLayerBeforeThisColor
  }

  getLayers(): ColorLayer[] {
    return this.layers
  }
}
