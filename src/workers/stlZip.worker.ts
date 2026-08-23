import type { GenInstruction } from '../genInstruction'
import type { SilhouettePolygons } from '../util/maskPolygon'
import {
  runStlZipJob,
  type ImageBufferPayload,
  type StlZipWorkerDone,
  type StlZipWorkerError,
  type StlZipWorkerProgress,
} from './stlZipJob'

interface StlZipWorkerRequest {
  type: 'stl-zip'
  paletteJson: string
  genInstruction: GenInstruction
  color: ImageBufferPayload | null
  texture: ImageBufferPayload | null
  polygons: SilhouettePolygons
  previewColorPng?: Blob | null
  previewTexturePng?: Blob | null
  extraFiles?: Record<string, Blob>
  rowChunk?: number
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<StlZipWorkerRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

workerScope.onmessage = (ev: MessageEvent<StlZipWorkerRequest>) => {
  const msg = ev.data
  if (!msg || msg.type !== 'stl-zip') return
  void (async () => {
    try {
      const blob = await runStlZipJob(
        {
          paletteJson: msg.paletteJson,
          genInstruction: msg.genInstruction,
          color: msg.color,
          texture: msg.texture,
          polygons: msg.polygons,
          previewColorPng: msg.previewColorPng,
          previewTexturePng: msg.previewTexturePng,
          extraFiles: msg.extraFiles,
          rowChunk: msg.rowChunk ?? 8,
          yieldBetweenChunks: false,
        },
        (p) => {
          const progress: StlZipWorkerProgress = { type: 'progress', ...p }
          workerScope.postMessage(progress)
        },
      )
      const buffer = await blob.arrayBuffer()
      const done: StlZipWorkerDone = { type: 'done', buffer }
      workerScope.postMessage(done, [buffer])
    } catch (e) {
      const err: StlZipWorkerError = {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      }
      workerScope.postMessage(err)
    }
  })()
}
