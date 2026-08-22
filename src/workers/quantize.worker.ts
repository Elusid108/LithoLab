import type { ColorDistanceComputation } from '../genInstruction'
import type { Rgba } from '../util/colorUtil'
import {
  runQuantizeJob,
  type QuantizeWorkerDone,
  type QuantizeWorkerError,
  type QuantizeWorkerProgress,
} from './quantizeJob'

interface QuantizeWorkerRequest {
  type: 'quantize'
  width: number
  height: number
  buffer: ArrayBuffer
  colors: Rgba[]
  distance: ColorDistanceComputation
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<QuantizeWorkerRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

workerScope.onmessage = (ev: MessageEvent<QuantizeWorkerRequest>) => {
  const msg = ev.data
  if (!msg || msg.type !== 'quantize') return
  try {
    const data = new Uint8ClampedArray(msg.buffer)
    const result = runQuantizeJob(
      {
        width: msg.width,
        height: msg.height,
        data,
        colors: msg.colors,
        distance: msg.distance,
      },
      (current, total) => {
        const progress: QuantizeWorkerProgress = { type: 'progress', current, total }
        workerScope.postMessage(progress)
      },
    )
    const done: QuantizeWorkerDone = {
      type: 'done',
      buffer: result.data.buffer as ArrayBuffer,
      usedHexes: result.usedHexes,
    }
    workerScope.postMessage(done, [result.data.buffer as ArrayBuffer])
  } catch (e) {
    const err: QuantizeWorkerError = {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    }
    workerScope.postMessage(err)
  }
}
