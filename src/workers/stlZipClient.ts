import type { GenInstruction } from '../genInstruction'
import type { Palette } from '../palette/palette'
import { buildZip, type ProgressFn } from '../stl/stlMaker'
import type { SilhouettePolygons } from '../util/maskPolygon'
import {
  type ImageBufferPayload,
  type StlZipWorkerDone,
  type StlZipWorkerError,
  type StlZipWorkerProgress,
} from './stlZipJob'

export interface BuildStlZipInput {
  colorImage: ImageData | null
  texturedImage: ImageData | null
  palette: Palette
  paletteJson: string
  genInstruction: GenInstruction
  polygons: SilhouettePolygons
  previewColorPng?: Blob | null
  previewTexturePng?: Blob | null
  extraFiles?: Record<string, Blob>
  onProgress?: ProgressFn
  signal?: AbortSignal
}

let worker: Worker | null = null
let workerFailed = false

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./stlZip.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('error', () => {
      workerFailed = true
      worker?.terminate()
      worker = null
    })
    return worker
  } catch {
    workerFailed = true
    return null
  }
}

function toPayload(image: ImageData | null): ImageBufferPayload | null {
  if (!image) return null
  const copy = image.data.slice()
  return {
    width: image.width,
    height: image.height,
    buffer: copy.buffer as ArrayBuffer,
  }
}

export async function buildStlZip(input: BuildStlZipInput): Promise<Blob> {
  const w = getWorker()
  // #region agent log
  fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H3',location:'stlZipClient.ts:buildStlZip',message:'choosing STL zip path',data:{hasWorker:!!w,workerFailed,colorW:input.colorImage?.width??null,colorH:input.colorImage?.height??null,texW:input.texturedImage?.width??null,texH:input.texturedImage?.height??null,colorBytes:input.colorImage?.data.byteLength??0,texBytes:input.texturedImage?.data.byteLength??0},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (w) {
    try {
      return await buildStlZipWithWorker(w, input)
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H3',location:'stlZipClient.ts:workerCatch',message:'STL worker failed; falling back to main thread',data:{err:e instanceof Error?e.message:String(e)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!(e instanceof Error) || e.message !== 'STL worker failed') {
        throw e
      }
      workerFailed = true
      worker?.terminate()
      worker = null
    }
  }
  return buildStlZipOnMain(input)
}

async function buildStlZipOnMain(input: BuildStlZipInput): Promise<Blob> {
  return buildZip(input.colorImage, input.texturedImage, input.palette, input.genInstruction, {
    previewColorPng: input.previewColorPng,
    previewTexturePng: input.previewTexturePng,
    polygons: input.polygons,
    onProgress: input.onProgress,
    signal: input.signal,
    extraFiles: input.extraFiles,
    yieldBetweenChunks: true,
  })
}

function buildStlZipWithWorker(w: Worker, input: BuildStlZipInput): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const color = toPayload(input.colorImage)
    const texture = toPayload(input.texturedImage)
    const transfer: Transferable[] = []
    if (color) transfer.push(color.buffer)
    if (texture) transfer.push(texture.buffer)

    const onMessage = (
      ev: MessageEvent<StlZipWorkerProgress | StlZipWorkerDone | StlZipWorkerError>,
    ) => {
      const msg = ev.data
      if (msg.type === 'progress') {
        input.onProgress?.({ phase: msg.phase, current: msg.current, total: msg.total })
        return
      }
      cleanup()
      if (msg.type === 'error') {
        reject(new Error(msg.message))
        return
      }
      resolve(new Blob([msg.buffer], { type: 'application/zip' }))
    }
    const onError = () => {
      cleanup()
      reject(new Error('STL worker failed'))
    }
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage(
      {
        type: 'stl-zip',
        paletteJson: input.paletteJson,
        genInstruction: input.genInstruction,
        color,
        texture,
        polygons: input.polygons,
        previewColorPng: input.previewColorPng ?? null,
        previewTexturePng: input.previewTexturePng ?? null,
        extraFiles: input.extraFiles,
        rowChunk: 8,
      },
      transfer,
    )
  })
}
