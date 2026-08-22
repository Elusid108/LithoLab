import {
  colorToHexCode,
  findClosestColor,
  type Rgba,
} from '../util/colorUtil'
import type { ColorDistanceComputation } from '../genInstruction'

export interface QuantizeJobInput {
  width: number
  height: number
  data: Uint8ClampedArray
  colors: Rgba[]
  distance: ColorDistanceComputation
  reportEvery?: number
}

export interface QuantizeJobResult {
  data: Uint8ClampedArray
  usedHexes: string[]
}

export type QuantizeWorkerProgress = {
  type: 'progress'
  current: number
  total: number
}

export type QuantizeWorkerDone = {
  type: 'done'
  buffer: ArrayBuffer
  usedHexes: string[]
}

export type QuantizeWorkerError = {
  type: 'error'
  message: string
}

export function runQuantizeJob(
  input: QuantizeJobInput,
  onProgress?: (current: number, total: number) => void,
): QuantizeJobResult {
  const { width, height, data, colors, distance } = input
  const reportEvery = Math.max(1, input.reportEvery ?? 8)
  const out = new Uint8ClampedArray(width * height * 4)
  const used = new Set<string>()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3]
      if (a === 0) {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
        continue
      }
      const closest = findClosestColor(
        { r: data[i], g: data[i + 1], b: data[i + 2], a },
        colors,
        distance,
      )
      const hex = colorToHexCode(closest)
      used.add(hex)
      out[i] = closest.r
      out[i + 1] = closest.g
      out[i + 2] = closest.b
      out[i + 3] = 255
    }
    if ((y + 1) % reportEvery === 0 || y === height - 1) {
      onProgress?.(y + 1, height)
    }
  }

  return { data: out, usedHexes: [...used] }
}
