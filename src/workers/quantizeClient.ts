import type { ColorDistanceComputation } from '../genInstruction'
import type { Rgba } from '../util/colorUtil'
import {
  runQuantizeJob,
  type QuantizeWorkerDone,
  type QuantizeWorkerError,
  type QuantizeWorkerProgress,
} from './quantizeJob'

export interface QuantizeProgress {
  current: number
  total: number
}

let worker: Worker | null = null
let workerFailed = false

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./quantize.worker.ts', import.meta.url), { type: 'module' })
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

export async function quantizeImageData(
  imageData: ImageData,
  colors: Rgba[],
  distance: ColorDistanceComputation,
  onProgress?: (p: QuantizeProgress) => void,
): Promise<{ image: ImageData; usedHexes: string[] }> {
  const w = getWorker()
  if (w) {
    try {
      return await quantizeWithWorker(w, imageData, colors, distance, onProgress)
    } catch {
      workerFailed = true
      worker?.terminate()
      worker = null
    }
  }
  return quantizeOnMain(imageData, colors, distance, onProgress)
}

function quantizeOnMain(
  imageData: ImageData,
  colors: Rgba[],
  distance: ColorDistanceComputation,
  onProgress?: (p: QuantizeProgress) => void,
): { image: ImageData; usedHexes: string[] } {
  const result = runQuantizeJob(
    {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
      colors,
      distance,
    },
    (current, total) => onProgress?.({ current, total }),
  )
  return {
    image: new ImageData(
      new Uint8ClampedArray(result.data),
      imageData.width,
      imageData.height,
    ),
    usedHexes: result.usedHexes,
  }
}

function quantizeWithWorker(
  w: Worker,
  imageData: ImageData,
  colors: Rgba[],
  distance: ColorDistanceComputation,
  onProgress?: (p: QuantizeProgress) => void,
): Promise<{ image: ImageData; usedHexes: string[] }> {
  return new Promise((resolve, reject) => {
    const copy = imageData.data.slice()
    const onMessage = (
      ev: MessageEvent<QuantizeWorkerProgress | QuantizeWorkerDone | QuantizeWorkerError>,
    ) => {
      const msg = ev.data
      if (msg.type === 'progress') {
        onProgress?.({ current: msg.current, total: msg.total })
        return
      }
      w.removeEventListener('message', onMessage)
      if (msg.type === 'error') {
        reject(new Error(msg.message))
        return
      }
      const pixels = new Uint8ClampedArray(msg.buffer)
      resolve({
        image: new ImageData(pixels, imageData.width, imageData.height),
        usedHexes: msg.usedHexes,
      })
    }
    w.addEventListener('message', onMessage)
    const transfer = copy.buffer as ArrayBuffer
    w.postMessage(
      {
        type: 'quantize',
        width: imageData.width,
        height: imageData.height,
        buffer: transfer,
        colors,
        distance,
      },
      [transfer],
    )
  })
}
