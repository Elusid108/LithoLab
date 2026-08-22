export interface NormalizedPoint {
  x: number
  y: number
}

export type ProfileOp =
  | { type: 'lineCut'; x0: number; y0: number; x1: number; y1: number; keep: 'left' | 'right' }
  | { type: 'circle'; cx: number; cy: number; r: number; mode: 'add' | 'subtract' }

const GRID_SIZE = 128

const MS_TABLE: Array<Array<[number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 0], [1, 2]],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[2, 0]],
  [[0, 1], [2, 3]],
  [[2, 1]],
  [[1, 3]],
  [[1, 0]],
  [[0, 3]],
  [],
]

function edgePoint(cx: number, cy: number, edge: number): NormalizedPoint {
  switch (edge) {
    case 0:
      return { x: cx + 0.5, y: cy }
    case 1:
      return { x: cx + 1, y: cy + 0.5 }
    case 2:
      return { x: cx + 0.5, y: cy + 1 }
    default:
      return { x: cx, y: cy + 0.5 }
  }
}

function vertexKey(p: NormalizedPoint): string {
  return `${Math.round(p.x * 2)}|${Math.round(p.y * 2)}`
}

function extractPolygonsFromBinary(inside: Uint8Array, w: number, h: number): NormalizedPoint[][] {
  const segHeads = new Map<string, Array<{ to: NormalizedPoint; toKey: string }>>()
  const idx = (x: number, y: number): number => y * w + x
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    return inside[idx(x, y)]
  }

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const code = at(cx, cy) | (at(cx + 1, cy) << 1) | (at(cx + 1, cy + 1) << 2) | (at(cx, cy + 1) << 3)
      const segs = MS_TABLE[code]
      for (const [a, b] of segs) {
        const pa = edgePoint(cx, cy, a)
        const pb = edgePoint(cx, cy, b)
        const ka = vertexKey(pa)
        const kb = vertexKey(pb)
        let list = segHeads.get(ka)
        if (!list) {
          list = []
          segHeads.set(ka, list)
        }
        list.push({ to: pb, toKey: kb })
      }
    }
  }

  const loops: NormalizedPoint[][] = []
  while (segHeads.size > 0) {
    const startKey = segHeads.keys().next().value as string
    const loop: NormalizedPoint[] = []
    let key = startKey
    let safety = 500_000
    while (safety-- > 0) {
      const choices = segHeads.get(key)
      if (!choices || choices.length === 0) {
        segHeads.delete(key)
        break
      }
      const next = choices.shift()!
      if (choices.length === 0) segHeads.delete(key)
      loop.push(next.to)
      key = next.toKey
      if (key === startKey) break
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function polygonArea(loop: NormalizedPoint[]): number {
  let a = 0
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i]
    const p1 = loop[(i + 1) % loop.length]
    a += p0.x * p1.y - p1.x * p0.y
  }
  return Math.abs(a) * 0.5
}

function gridToNormalized(loop: NormalizedPoint[], w: number, h: number): NormalizedPoint[] {
  return loop.map((p) => ({
    x: Math.max(0, Math.min(1, p.x / w)),
    y: Math.max(0, Math.min(1, 1 - p.y / h)),
  }))
}

function cross2(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  return (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)
}

function lineSideKeep(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: number,
  py: number,
  keep: 'left' | 'right',
): boolean {
  const c = cross2(x0, y0, x1, y1, px, py)
  return keep === 'left' ? c >= 0 : c <= 0
}

export function evaluateProfileOps(ops: ProfileOp[], gridSize = GRID_SIZE): Uint8Array {
  const w = gridSize
  const h = gridSize
  const inside = new Uint8Array(w * h).fill(1)

  for (const op of ops) {
    if (op.type === 'lineCut') {
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const nx = (gx + 0.5) / w
          const ny = 1 - (gy + 0.5) / h
          const i = gy * w + gx
          if (!inside[i]) continue
          if (!lineSideKeep(op.x0, op.y0, op.x1, op.y1, nx, ny, op.keep)) {
            inside[i] = 0
          }
        }
      }
    } else if (op.type === 'circle') {
      const r2 = op.r * op.r
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const nx = (gx + 0.5) / w
          const ny = 1 - (gy + 0.5) / h
          const dx = nx - op.cx
          const dy = ny - op.cy
          const inCircle = dx * dx + dy * dy <= r2
          const i = gy * w + gx
          if (op.mode === 'subtract') {
            if (inCircle) inside[i] = 0
          } else if (inCircle) {
            inside[i] = 1
          }
        }
      }
    }
  }
  return inside
}

export function boundaryFromOps(ops: ProfileOp[], gridSize = GRID_SIZE): NormalizedPoint[] {
  const inside = evaluateProfileOps(ops, gridSize)
  const loops = extractPolygonsFromBinary(inside, gridSize, gridSize)
  if (loops.length === 0) return rectBoundary()
  let best = loops[0]
  let bestArea = polygonArea(best)
  for (let i = 1; i < loops.length; i++) {
    const a = polygonArea(loops[i])
    if (a > bestArea) {
      best = loops[i]
      bestArea = a
    }
  }
  return gridToNormalized(best, gridSize, gridSize)
}

export function rectBoundary(): NormalizedPoint[] {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
  ]
}

export function cloneBoundary(boundary: NormalizedPoint[]): NormalizedPoint[] {
  return boundary.map((p) => ({ x: p.x, y: p.y }))
}

export function isValidBoundary(boundary: NormalizedPoint[] | null | undefined): boolean {
  if (!boundary || boundary.length < 3) return false
  for (const p of boundary) {
    if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) return false
  }
  const tol = 0.12
  let hasLow = false
  let hasHigh = false
  for (const p of boundary) {
    if (p.x <= tol) {
      if (p.y <= 0.15) hasLow = true
      if (p.y >= 0.85) hasHigh = true
    }
  }
  return hasLow && hasHigh
}

/** Top/outer edge from inside-top toward outside-bottom — for future STL sweep */
export function extractTopProfilePath(boundary: NormalizedPoint[]): NormalizedPoint[] {
  if (boundary.length < 3) return []
  const tol = 0.05
  let startIdx = 0
  let bestScore = Infinity
  for (let i = 0; i < boundary.length; i++) {
    const p = boundary[i]
    const score = p.x + (1 - p.y)
    if (p.x <= tol && p.y >= 1 - tol && score < bestScore) {
      bestScore = score
      startIdx = i
    }
  }
  let endIdx = 0
  bestScore = Infinity
  for (let i = 0; i < boundary.length; i++) {
    const p = boundary[i]
    const score = (1 - p.x) + p.y
    if (p.x >= 1 - tol && p.y <= tol && score < bestScore) {
      bestScore = score
      endIdx = i
    }
  }
  const path: NormalizedPoint[] = []
  let i = startIdx
  for (let n = 0; n <= boundary.length; n++) {
    path.push(boundary[i])
    if (i === endIdx && path.length > 1) break
    i = (i + 1) % boundary.length
  }
  return path
}

export interface BoundaryDrawOpts {
  padL: number
  padR: number
  padT: number
  padB: number
  fillAlpha?: number
  strokeWidth?: number
  showOutline?: boolean
  previewOps?: ProfileOp[]
}

export function drawBoundaryPreview(
  ctx: CanvasRenderingContext2D,
  boundary: NormalizedPoint[],
  width: number,
  height: number,
  opts: BoundaryDrawOpts,
): void {
  const { padL, padR, padT, padB } = opts
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const toPx = (nx: number, ny: number) => ({
    x: padL + nx * plotW,
    y: padT + (1 - ny) * plotH,
  })

  if (boundary.length >= 3) {
    ctx.beginPath()
    const s = toPx(boundary[0].x, boundary[0].y)
    ctx.moveTo(s.x, s.y)
    for (let i = 1; i < boundary.length; i++) {
      const p = toPx(boundary[i].x, boundary[i].y)
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.fillStyle = `rgba(0, 210, 106, ${opts.fillAlpha ?? 0.3})`
    ctx.fill()
    if (opts.showOutline !== false) {
      ctx.strokeStyle = opts.fillAlpha && opts.fillAlpha < 0.32 ? '#7adfaa' : '#00d26a'
      ctx.lineWidth = opts.strokeWidth ?? 1.5
      ctx.stroke()
    }
  }

  if (opts.previewOps) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 1
    for (const op of opts.previewOps) {
      if (op.type === 'lineCut') {
        const a = toPx(op.x0, op.y0)
        const b = toPx(op.x1, op.y1)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      } else if (op.type === 'circle') {
        const c = toPx(op.cx, op.cy)
        const rPx = op.r * plotW
        ctx.beginPath()
        ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.setLineDash([])
  }
}
