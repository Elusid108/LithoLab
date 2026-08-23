import type { GenInstruction } from '../genInstruction'
import { Palette } from '../palette/palette'
import { buildZip, type ProgressFn, type StlProgress } from '../stl/stlMaker'
import type { SilhouettePolygons } from '../util/maskPolygon'

export type { StlProgress }

export interface ImageBufferPayload {
  width: number
  height: number
  buffer: ArrayBuffer
}

export interface StlZipJobInput {
  paletteJson: string
  genInstruction: GenInstruction
  color: ImageBufferPayload | null
  texture: ImageBufferPayload | null
  maskRelief: ImageBufferPayload | null
  polygons: SilhouettePolygons
  previewColorPng?: Blob | null
  previewTexturePng?: Blob | null
  extraFiles?: Record<string, Blob>
  signal?: AbortSignal
  rowChunk?: number
  yieldBetweenChunks?: boolean
}

export type StlZipWorkerProgress = {
  type: 'progress'
} & StlProgress

export type StlZipWorkerDone = {
  type: 'done'
  buffer: ArrayBuffer
}

export type StlZipWorkerError = {
  type: 'error'
  message: string
}

function imageFromPayload(payload: ImageBufferPayload | null): ImageData | null {
  if (!payload) return null
  return new ImageData(new Uint8ClampedArray(payload.buffer), payload.width, payload.height)
}

export async function runStlZipJob(
  input: StlZipJobInput,
  onProgress?: ProgressFn,
): Promise<Blob> {
  const palette = new Palette(input.paletteJson, input.genInstruction)
  return buildZip(
    imageFromPayload(input.color),
    imageFromPayload(input.texture),
    palette,
    input.genInstruction,
    {
      previewColorPng: input.previewColorPng,
      previewTexturePng: input.previewTexturePng,
      polygons: input.polygons,
      onProgress,
      signal: input.signal,
      extraFiles: input.extraFiles,
      rowChunk: input.rowChunk,
      yieldBetweenChunks: input.yieldBetweenChunks ?? false,
      maskReliefImage: imageFromPayload(input.maskRelief),
    },
  )
}
