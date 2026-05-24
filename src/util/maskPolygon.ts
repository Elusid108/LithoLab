/**
 * Vector polygon utilities for the mask pipeline.
 *
 * The mask is extracted as a set of closed polygons via marching squares,
 * smoothed with Chaikin corner-cutting, then offset (Minkowski expansion
 * with a disk) using a Euclidean distance transform to produce the silhouette
 * polygon that drives both the raster previews and the STL prism geometry.
 *
 * Coordinate conventions:
 *   - All polygon vertices are in 2D space using whatever units the caller
 *     supplies (mask-source pixels, editor-canvas pixels, or millimeters).
 *   - `Polygon` is an *open* list of points; the loop is implicitly closed
 *     from the last point back to the first.
 *   - `PolygonSet` is a list of polygons (outer boundary loops; the marching
 *     squares pass yields each connected boundary as its own loop, and any
 *     holes appear as additional loops walked in the opposite winding).
 */

export interface Point {
  x: number
  y: number
}

export type Polygon = Point[]
export type PolygonSet = Polygon[]

export interface AffineMat {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

/**
 * The two-polygon descriptor that drives the smooth-edge STL pipeline.
 *
 * `maskPolygonMm` is the interior outline of the lithophane (the user's mask
 * shape) and `silhouettePolygonMm` is the outer silhouette (mask offset by
 * the border XY width). Both are in millimeters with origin at (0, 0) at the
 * top-left of the silhouette bounding box.
 */
export interface SilhouettePolygons {
  maskPolygonMm: PolygonSet
  silhouettePolygonMm: PolygonSet
}

/** Mirror polygon Y to match STL raster `flipImage` (y' = heightMm - y). */
export function flipPolygonSetY(set: PolygonSet, heightMm: number): PolygonSet {
  return set.map((loop) => loop.map((p) => ({ x: p.x, y: heightMm - p.y })))
}

// ---------------------------------------------------------------------------
// Polygon extraction (marching squares on a luminance-thresholded mask)
// ---------------------------------------------------------------------------

/**
 * Build a binary "inside" array (1 byte per pixel) from an ImageData.
 * A pixel is "inside" when alpha > 0 AND luminance >= threshold.
 */
function maskInsideFromImageData(img: ImageData, threshold: number): Uint8Array {
  const { width, height, data } = img
  const inside = new Uint8Array(width * height)
  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    if (lum >= threshold) inside[p] = 1
  }
  return inside
}

/**
 * Marching squares case table. Each case maps to up to two segments described
 * as `[fromEdge, toEdge]` pairs, where edges are labelled 0..3:
 *   0 = top, 1 = right, 2 = bottom, 3 = left.
 * Walking from -> to keeps the inside region consistent for chaining.
 *
 * Corner bits in `case`: bit 0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left.
 */
const MS_TABLE: Array<Array<[number, number]>> = [
  /* 0  */ [],
  /* 1  tl       */ [[3, 0]],
  /* 2  tr       */ [[0, 1]],
  /* 3  tl+tr    */ [[3, 1]],
  /* 4  br       */ [[1, 2]],
  /* 5  tl+br    */ [[3, 0], [1, 2]],
  /* 6  tr+br    */ [[0, 2]],
  /* 7  tl+tr+br */ [[3, 2]],
  /* 8  bl       */ [[2, 3]],
  /* 9  tl+bl    */ [[2, 0]],
  /* 10 tr+bl    */ [[0, 1], [2, 3]],
  /* 11 tl+tr+bl */ [[2, 1]],
  /* 12 br+bl    */ [[1, 3]],
  /* 13 tl+br+bl */ [[1, 0]],
  /* 14 tr+br+bl */ [[0, 3]],
  /* 15          */ [],
]

/** Edge midpoint coordinates relative to the cell origin (cx, cy). */
function edgePoint(cx: number, cy: number, edge: number): Point {
  switch (edge) {
    case 0: return { x: cx + 0.5, y: cy }       // top
    case 1: return { x: cx + 1, y: cy + 0.5 }   // right
    case 2: return { x: cx + 0.5, y: cy + 1 }   // bottom
    default: return { x: cx, y: cy + 0.5 }      // left
  }
}

/**
 * Quantize a vertex to an integer cell-edge key so segments can be chained
 * by exact endpoint matching (no float-noise mismatches).
 * Edge midpoints land on `(integer + 0.5)` on exactly one axis, so we encode
 * the vertex as a pair of doubled integers.
 */
function vertexKey(p: Point): string {
  return `${Math.round(p.x * 2)}|${Math.round(p.y * 2)}`
}

/**
 * Extract closed polygons from a W×H binary grid via marching squares.
 * Vertex coordinates are in grid units (0..W on x, 0..H on y, with half-pixel offsets).
 */
function extractPolygonsFromBinary(inside: Uint8Array, w: number, h: number): PolygonSet {
  const segHeads = new Map<string, Array<{ to: Point; toKey: string }>>()
  const idx = (x: number, y: number): number => y * w + x
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    return inside[idx(x, y)]
  }

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const tl = at(cx, cy)
      const tr = at(cx + 1, cy)
      const br = at(cx + 1, cy + 1)
      const bl = at(cx, cy + 1)
      const code = tl | (tr << 1) | (br << 2) | (bl << 3)
      const segs = MS_TABLE[code]
      if (segs.length === 0) continue
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

  const loops: PolygonSet = []
  while (segHeads.size > 0) {
    const startKey = segHeads.keys().next().value as string | undefined
    if (!startKey) break
    const loop: Polygon = []
    let key = startKey
    let safety = 1_000_000
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

/**
 * Extract a smoothed silhouette polygon set from a luminance image.
 * - `threshold` (default 128) selects which pixels count as "inside".
 * - `smoothIters` (default 2) controls how many Chaikin rounds run.
 *
 * Returns polygon coordinates in the same pixel space as `img`.
 */
export function extractMaskPolygons(
  img: ImageData,
  opts: { threshold?: number; smoothIters?: number; minLoopArea?: number } = {},
): PolygonSet {
  const threshold = opts.threshold ?? 128
  const smoothIters = opts.smoothIters ?? 2
  const minLoopArea = opts.minLoopArea ?? 4 // drop noise sub-pixel loops
  const inside = maskInsideFromImageData(img, threshold)
  let loops = extractPolygonsFromBinary(inside, img.width, img.height)
  loops = loops.filter((l) => Math.abs(signedArea(l)) >= minLoopArea)
  if (smoothIters > 0) loops = loops.map((l) => smoothChaikin(l, smoothIters))
  return loops
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Chaikin corner-cutting subdivision on a closed polygon.
 * Each iteration replaces every vertex with two new vertices at 1/4 and 3/4
 * of each edge, quickly approximating a smooth quadratic B-spline.
 */
export function smoothChaikin(poly: Polygon, iterations: number): Polygon {
  if (poly.length < 3 || iterations <= 0) return poly
  let pts = poly
  for (let it = 0; it < iterations; it++) {
    const n = pts.length
    const next: Polygon = new Array(n * 2)
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      next[i * 2] = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }
      next[i * 2 + 1] = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
    }
    pts = next
  }
  return pts
}

export function smoothChaikinSet(set: PolygonSet, iterations: number): PolygonSet {
  return set.map((p) => smoothChaikin(p, iterations))
}

/** Upper bound on polygon vertices used for STL prism emission (spread-safe, still smooth). */
export const STL_POLYGON_MAX_VERTS = 2048

/** Uniformly subsample a closed polygon when it exceeds `maxVerts`. */
export function decimateClosedPolygon(poly: Polygon, maxVerts: number): Polygon {
  if (poly.length <= maxVerts) return poly
  const n = poly.length
  const out: Polygon = new Array(maxVerts)
  for (let i = 0; i < maxVerts; i++) {
    out[i] = poly[Math.floor((i * n) / maxVerts)]
  }
  return out
}

export function decimatePolygonSet(set: PolygonSet, maxVerts: number): PolygonSet {
  return set.map((loop) => decimateClosedPolygon(loop, maxVerts))
}

// ---------------------------------------------------------------------------
// Transform / geometry helpers
// ---------------------------------------------------------------------------

export function transformPolygon(poly: Polygon, m: AffineMat): Polygon {
  const out: Polygon = new Array(poly.length)
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    out[i] = {
      x: m.a * p.x + m.c * p.y + m.tx,
      y: m.b * p.x + m.d * p.y + m.ty,
    }
  }
  return out
}

export function transformPolygonSet(set: PolygonSet, m: AffineMat): PolygonSet {
  return set.map((p) => transformPolygon(p, m))
}

export function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s * 0.5
}

export function polygonBounds(set: PolygonSet): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of set) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/**
 * Even-odd point-in-polygon-set test. Returns `true` if `pt` is inside an
 * odd number of loops (handles holes via opposing winding).
 */
export function pointInPolygonSet(pt: Point, set: PolygonSet): boolean {
  let inside = false
  for (const loop of set) {
    const n = loop.length
    let j = n - 1
    for (let i = 0; i < n; i++) {
      const a = loop[i]
      const b = loop[j]
      if ((a.y > pt.y) !== (b.y > pt.y)) {
        const xCross = a.x + ((pt.y - a.y) * (b.x - a.x)) / (b.y - a.y)
        if (pt.x < xCross) inside = !inside
      }
      j = i
    }
  }
  return inside
}

// ---------------------------------------------------------------------------
// Rasterization (scanline)
// ---------------------------------------------------------------------------

/**
 * Rasterize polygon(s) into a width × height byte grid (1 = inside).
 * Coordinates are mapped via:  gridX = (worldX - originX) / cellSize.
 * Uses scanline filling at pixel centers with the even-odd rule.
 */
export function rasterizePolygonsBinary(
  set: PolygonSet,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
): Uint8Array {
  const out = new Uint8Array(width * height)
  if (set.length === 0) return out
  // Pre-collect edges as arrays for tight loops
  const edges: Array<{ ax: number; ay: number; bx: number; by: number }> = []
  for (const loop of set) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
    }
  }
  const xs: number[] = []
  for (let y = 0; y < height; y++) {
    const yWorld = originY + (y + 0.5) * cellSize
    xs.length = 0
    for (const e of edges) {
      const ay = e.ay
      const by = e.by
      // Half-open interval avoids double-counting vertices on the scanline.
      if ((ay <= yWorld && by > yWorld) || (by <= yWorld && ay > yWorld)) {
        const t = (yWorld - ay) / (by - ay)
        xs.push(e.ax + t * (e.bx - e.ax))
      }
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const row = y * width
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0w = (xs[i] - originX) / cellSize - 0.5
      const x1w = (xs[i + 1] - originX) / cellSize - 0.5
      const x0 = Math.max(0, Math.ceil(x0w))
      const x1 = Math.min(width - 1, Math.floor(x1w))
      for (let x = x0; x <= x1; x++) out[row + x] = 1
    }
  }
  return out
}

/**
 * Anti-aliased coverage rasterization. Supersamples each pixel at `ss×ss`
 * positions and returns a `0..255` coverage byte (1 byte per pixel).
 */
export function rasterizePolygonCoverage(
  set: PolygonSet,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
  supersamples = 4,
): Uint8Array {
  const ss = Math.max(1, supersamples | 0)
  if (ss === 1) {
    const b = rasterizePolygonsBinary(set, width, height, originX, originY, cellSize)
    const out = new Uint8Array(width * height)
    for (let i = 0; i < out.length; i++) out[i] = b[i] ? 255 : 0
    return out
  }
  // Rasterize a higher-res binary grid, then box-downsample.
  const hiW = width * ss
  const hiH = height * ss
  const hiCell = cellSize / ss
  const hi = rasterizePolygonsBinary(set, hiW, hiH, originX, originY, hiCell)
  const out = new Uint8Array(width * height)
  const total = ss * ss
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      const yBase = y * ss
      const xBase = x * ss
      for (let sy = 0; sy < ss; sy++) {
        const rowOff = (yBase + sy) * hiW + xBase
        for (let sx = 0; sx < ss; sx++) sum += hi[rowOff + sx]
      }
      out[y * width + x] = Math.round((sum * 255) / total)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Euclidean distance transform (Felzenszwalb & Huttenlocher, O(N))
// ---------------------------------------------------------------------------

const INF = 1e20

function edt1d(f: Float64Array, n: number): Float64Array {
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = +INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]))
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]))
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = +INF
  }
  const D = new Float64Array(n)
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    D[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
  return D
}

/**
 * Squared-Euclidean distance transform on a binary grid: returns a
 * Float64Array of length w*h where each entry is the squared distance (in
 * pixel units) to the nearest pixel where `inside[i] !== 0`.
 */
function edtSquaredFromInside(inside: Uint8Array, w: number, h: number): Float64Array {
  const D = new Float64Array(w * h)
  const col = new Float64Array(h)
  // Pass 1: each column
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = inside[y * w + x] ? 0 : INF
    const r = edt1d(col, h)
    for (let y = 0; y < h; y++) D[y * w + x] = r[y]
  }
  // Pass 2: each row
  const row = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = D[y * w + x]
    const r = edt1d(row, w)
    for (let x = 0; x < w; x++) D[y * w + x] = r[x]
  }
  return D
}

// ---------------------------------------------------------------------------
// Outward polygon offset (Minkowski with disk) via EDT
// ---------------------------------------------------------------------------

/**
 * Outward offset of a polygon set by `delta` (same units as the polygon
 * coordinates). For `delta <= 0` returns the input unchanged.
 *
 * Implementation: rasterize the polygon into a high-resolution binary grid,
 * compute the squared EDT, threshold at `delta²`, and re-extract polygons
 * via marching squares. Robust to concavities, self-touching edges, and
 * multi-loop masks. Output polygons are smoothed by `smoothIters` rounds of
 * Chaikin (default 2) since the re-extracted edges otherwise step in
 * one-cell increments.
 */
export function offsetPolygonSet(
  set: PolygonSet,
  delta: number,
  opts: { cellSize?: number; maxGrid?: number; smoothIters?: number } = {},
): PolygonSet {
  if (set.length === 0) return set
  if (delta <= 0) return set

  const b = polygonBounds(set)
  const pad = delta * 1.25 + 4
  const spanX = b.maxX - b.minX + 2 * pad
  const spanY = b.maxY - b.minY + 2 * pad

  const maxGrid = opts.maxGrid ?? 1024
  const minCellFromGrid = Math.max(spanX, spanY) / maxGrid
  const accuracyCell = Math.max(delta / 6, 1e-6)
  let cellSize = opts.cellSize ?? Math.max(minCellFromGrid, accuracyCell)

  let w = Math.ceil(spanX / cellSize)
  let h = Math.ceil(spanY / cellSize)
  if (w > maxGrid || h > maxGrid) {
    cellSize = Math.max(spanX, spanY) / maxGrid
    w = Math.ceil(spanX / cellSize)
    h = Math.ceil(spanY / cellSize)
  }
  const ox = b.minX - pad
  const oy = b.minY - pad

  const inside = rasterizePolygonsBinary(set, w, h, ox, oy, cellSize)
  const distSq = edtSquaredFromInside(inside, w, h)
  const dCells = delta / cellSize
  const dSq = dCells * dCells
  const expanded = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    expanded[i] = inside[i] || distSq[i] <= dSq ? 1 : 0
  }

  const gridPolys = extractPolygonsFromBinary(expanded, w, h)
  const smoothIters = opts.smoothIters ?? 2
  const smoothed = smoothIters > 0 ? gridPolys.map((p) => smoothChaikin(p, smoothIters)) : gridPolys
  return smoothed.map((loop) =>
    loop.map((p) => ({ x: ox + p.x * cellSize, y: oy + p.y * cellSize })),
  )
}

// ---------------------------------------------------------------------------
// Canvas Path2D helper (so callers can fill the polygon without rasterizing)
// ---------------------------------------------------------------------------

/** Build a Path2D representing the polygon set (closed). */
export function polygonSetToPath2D(set: PolygonSet): Path2D {
  const path = new Path2D()
  for (const loop of set) {
    if (loop.length < 2) continue
    path.moveTo(loop[0].x, loop[0].y)
    for (let i = 1; i < loop.length; i++) path.lineTo(loop[i].x, loop[i].y)
    path.closePath()
  }
  return path
}
