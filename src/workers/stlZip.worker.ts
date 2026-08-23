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
  maskRelief: ImageBufferPayload | null
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
          maskRelief: msg.maskRelief,
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
      // #region agent log
      fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H4',location:'stlZip.worker.ts:beforeArrayBuffer',message:'zip blob ready; converting to ArrayBuffer',data:{blobBytes:blob.size},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const buffer = await blob.arrayBuffer()
      const done: StlZipWorkerDone = { type: 'done', buffer }
      // #region agent log
      fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H4',location:'stlZip.worker.ts:beforePostMessage',message:'posting zip buffer to main',data:{bufferBytes:buffer.byteLength},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      workerScope.postMessage(done, [buffer])
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H1',location:'stlZip.worker.ts:catch',message:'STL worker job threw',data:{err:e instanceof Error?e.message:String(e),name:e instanceof Error?e.name:typeof e},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const err: StlZipWorkerError = {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      }
      workerScope.postMessage(err)
    }
  })()
}
