/**
 * Polygon prism STL emission.
 *
 * These helpers convert smoothed vector polygons (from src/util/maskPolygon)
 * into ASCII-STL facet strings that match the rest of the CSG pipeline. They
 * produce the slanted/curved silhouette geometry that replaces the pixelated
 * support-plate edge and the white-border ring.
 *
 * Two main shapes are supported:
 *   1. emitSilhouettePrism — solid prism extruded from a simple polygon set
 *      (no holes). Used for the support plate.
 *   2. emitRingPrism — annular prism between an outer (silhouette) loop and
 *      an inner (mask) loop. Used for the white-border ring on both the color
 *      layers and the texture layer.
 *
 * If `curve !== 0`, the same cylindrical warping that the cuboid-based
 * pipeline performs (see csgThreadTextureRow.curveTriangleList) is applied
 * per-vertex so the polygon geometry matches the rest of the model.
 */

import type { GenInstruction } from '../genInstruction'
import type { Polygon, PolygonSet } from '../util/maskPolygon'
import { signedArea } from '../util/maskPolygon'
import { curveTriangleList } from './csgThreadTextureRow'
import { triangleNormal, type BinaryStlBuilder, type Vec3 } from './stl'

export interface PrismOptions {
  /** GenInstruction supplies the curve parameter & destImageWidth for curving. */
  genInstruction: GenInstruction
  /** Optional XYZ translation applied to every emitted vertex (before curving). */
  translate?: Vec3
  /**
   * Apply the cylindrical `curveTriangleList` warp to every vertex. Defaults
   * to `false` since only the texture row currently emits curved cuboids in
   * the existing pipeline; the plate and color layers stay flat even when
   * `genInstruction.curve !== 0`.
   */
  applyCurve?: boolean
}

function asCCW(loop: Polygon): Polygon {
  // signedArea > 0 means CCW in math coords (y-up). In our pipeline we work
  // in image-style coords where y grows downward; CCW screen orientation gives
  // negative signed area. Marching-squares output is consistent: outer loops
  // have positive signed area when viewed with our (x→right, y→down) frame,
  // because our LUT walks them with inside-on-left in that frame. Empirically
  // all extracted outer boundaries from a filled blob come out with the same
  // sign; we standardise to a positive sign here so triangulation winds the
  // top facets with +Z normals.
  return signedArea(loop) >= 0 ? loop : [...loop].reverse()
}

function asCW(loop: Polygon): Polygon {
  return signedArea(loop) < 0 ? loop : [...loop].reverse()
}

function transformVertex(v: Vec3, opts: PrismOptions, polygonWidthMm: number): Vec3 {
  let out: Vec3 = v
  if (opts.translate) {
    out = [out[0] + opts.translate[0], out[1] + opts.translate[1], out[2] + opts.translate[2]]
  }
  const curve = opts.genInstruction.curve
  if (opts.applyCurve && curve !== 0 && polygonWidthMm > 0) {
    const tri = curveTriangleList(polygonWidthMm, curve, [out, out, out])
    out = tri[0]
  }
  return out
}

function emitTri(
  mesh: BinaryStlBuilder,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  opts: PrismOptions,
  polygonWidthMm: number,
): void {
  const ta = transformVertex(a, opts, polygonWidthMm)
  const tb = transformVertex(b, opts, polygonWidthMm)
  const tc = transformVertex(c, opts, polygonWidthMm)
  mesh.addTriangle(triangleNormal(ta, tb, tc), ta, tb, tc)
}

// ---------------------------------------------------------------------------
// Ear-clipping triangulation (simple polygon, no holes)
// ---------------------------------------------------------------------------

function isConvex(a: Polygon[number], b: Polygon[number], c: Polygon[number]): boolean {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
}

function pointInTri(
  p: Polygon[number],
  a: Polygon[number],
  b: Polygon[number],
  c: Polygon[number],
): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * Triangulate a simple polygon (no self-intersections, no holes) via
 * ear-clipping. Returns triangles as triples of indices into the input loop.
 * Assumes CCW orientation; if CW is passed, results may be invalid.
 */
function earClip(loop: Polygon): Array<[number, number, number]> {
  const n = loop.length
  if (n < 3) return []
  if (n === 3) return [[0, 1, 2]]
  const indices: number[] = Array.from({ length: n }, (_, i) => i)
  const tris: Array<[number, number, number]> = []
  let safety = n * n + 16
  while (indices.length > 3 && safety-- > 0) {
    let earIdx = -1
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]
      const cur = indices[i]
      const next = indices[(i + 1) % indices.length]
      const a = loop[prev]
      const b = loop[cur]
      const c = loop[next]
      if (!isConvex(a, b, c)) continue
      let isEar = true
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k]
        if (idx === prev || idx === cur || idx === next) continue
        if (pointInTri(loop[idx], a, b, c)) {
          isEar = false
          break
        }
      }
      if (isEar) {
        earIdx = i
        break
      }
    }
    if (earIdx < 0) {
      // Degenerate / nearly-colinear polygon. Bail with what we have.
      break
    }
    const prev = indices[(earIdx - 1 + indices.length) % indices.length]
    const cur = indices[earIdx]
    const next = indices[(earIdx + 1) % indices.length]
    tris.push([prev, cur, next])
    indices.splice(earIdx, 1)
  }
  if (indices.length === 3) tris.push([indices[0], indices[1], indices[2]])
  return tris
}

// ---------------------------------------------------------------------------
// Solid prism (no hole)
// ---------------------------------------------------------------------------

/**
 * Emit a solid prism extruded from the union of all loops in `polygons`.
 * Each loop is treated independently as its own simple polygon (suitable when
 * a mask consists of multiple disjoint pieces). Loops are normalised to CCW
 * before triangulation. Side walls are emitted along each loop edge.
 */
export function emitSilhouettePrism(
  polygons: PolygonSet,
  zBottom: number,
  zTop: number,
  opts: PrismOptions,
  polygonWidthMm: number,
  mesh: BinaryStlBuilder,
): void {
  for (const raw of polygons) {
    if (raw.length < 3) continue
    const loop = asCCW(raw)
    const tris = earClip(loop)

    // Top face (z = zTop, normals up)
    for (const [i0, i1, i2] of tris) {
      const a: Vec3 = [loop[i0].x, loop[i0].y, zTop]
      const b: Vec3 = [loop[i1].x, loop[i1].y, zTop]
      const c: Vec3 = [loop[i2].x, loop[i2].y, zTop]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
    }

    // Bottom face (z = zBottom, normals down — reverse winding)
    for (const [i0, i1, i2] of tris) {
      const a: Vec3 = [loop[i0].x, loop[i0].y, zBottom]
      const b: Vec3 = [loop[i2].x, loop[i2].y, zBottom]
      const c: Vec3 = [loop[i1].x, loop[i1].y, zBottom]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
    }

    // Side walls (outward normals; CCW loop in xy → outward when winding CCW
    // around the bottom face seen from below).
    for (let i = 0; i < loop.length; i++) {
      const p0 = loop[i]
      const p1 = loop[(i + 1) % loop.length]
      const a: Vec3 = [p0.x, p0.y, zBottom]
      const b: Vec3 = [p1.x, p1.y, zBottom]
      const c: Vec3 = [p1.x, p1.y, zTop]
      const d: Vec3 = [p0.x, p0.y, zTop]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
      emitTri(mesh, a, c, d, opts, polygonWidthMm)
    }
  }
}

// ---------------------------------------------------------------------------
// Ring prism (silhouette − mask): the smooth white border
// ---------------------------------------------------------------------------

function sqDist(a: Polygon[number], b: Polygon[number]): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Triangulate the area between an outer CCW loop and an inner CCW loop using
 * a parallel two-pointer "ribbon" walk. Robust for smoothed offset polygons
 * where the inner loop closely tracks the outer loop along the outward
 * normal. Returns triangles as 3-tuples of `{ side, idx }` where side is
 * 'o' for the outer loop and 'i' for the inner loop.
 */
function ribbonTriangulate(
  outerCCW: Polygon,
  innerCCW: Polygon,
): Array<[{ s: 'o' | 'i'; i: number }, { s: 'o' | 'i'; i: number }, { s: 'o' | 'i'; i: number }]> {
  const N = outerCCW.length
  const M = innerCCW.length
  if (N < 3 || M < 3) return []

  // Find starting inner index = closest to outer[0].
  let jStart = 0
  let bestD = Infinity
  for (let j = 0; j < M; j++) {
    const d = sqDist(outerCCW[0], innerCCW[j])
    if (d < bestD) {
      bestD = d
      jStart = j
    }
  }

  let i = 0
  let j = jStart
  let outerSteps = 0
  let innerSteps = 0
  const tris: ReturnType<typeof ribbonTriangulate> = []

  // Walk until both loops have been traversed once.
  while (outerSteps < N || innerSteps < M) {
    const canAdvOuter = outerSteps < N
    const canAdvInner = innerSteps < M
    const nextI = (i + 1) % N
    const nextJ = (j + 1) % M

    let advanceOuter: boolean
    if (canAdvOuter && !canAdvInner) {
      advanceOuter = true
    } else if (!canAdvOuter && canAdvInner) {
      advanceOuter = false
    } else {
      // Pick the option with the shorter new diagonal so the strip stays tight.
      const dIfAdvOuter = sqDist(outerCCW[nextI], innerCCW[j])
      const dIfAdvInner = sqDist(outerCCW[i], innerCCW[nextJ])
      advanceOuter = dIfAdvOuter <= dIfAdvInner
    }

    if (advanceOuter) {
      // Triangle (outer[i], outer[next], inner[j])
      tris.push([
        { s: 'o', i },
        { s: 'o', i: nextI },
        { s: 'i', i: j },
      ])
      i = nextI
      outerSteps++
    } else {
      // Triangle (outer[i], inner[next], inner[j])
      tris.push([
        { s: 'o', i },
        { s: 'i', i: nextJ },
        { s: 'i', i: j },
      ])
      j = nextJ
      innerSteps++
    }
  }
  return tris
}

/**
 * Emit an annular prism — solid material between `outer` and `inner` loops,
 * extruded from `zBottom` to `zTop`. Used for the smooth white-border ring
 * that wraps the lithophane.
 *
 * The first loop of each set is treated as the boundary (other loops are
 * ignored, since the polygon-offset routine yields one outer/inner pair per
 * blob). Both loops are normalised to CCW for triangulation.
 */
export function emitRingPrism(
  outer: PolygonSet,
  inner: PolygonSet,
  zBottom: number,
  zTop: number,
  opts: PrismOptions,
  polygonWidthMm: number,
  mesh: BinaryStlBuilder,
): void {

  // Match outer loops to inner loops by bounding-box overlap so multi-blob
  // shapes still wind correctly.
  const innerUsed = new Array<boolean>(inner.length).fill(false)
  for (const rawOuter of outer) {
    if (rawOuter.length < 3) continue
    // Find inner loop whose centroid is inside this outer loop.
    let pickedInner: Polygon | null = null
    let pickedIdx = -1
    let bestD = Infinity
    const oCenter = polygonCentroid(rawOuter)
    for (let k = 0; k < inner.length; k++) {
      if (innerUsed[k]) continue
      const iCenter = polygonCentroid(inner[k])
      const d = (oCenter.x - iCenter.x) ** 2 + (oCenter.y - iCenter.y) ** 2
      if (d < bestD) {
        bestD = d
        pickedInner = inner[k]
        pickedIdx = k
      }
    }
    if (!pickedInner || pickedIdx < 0) {
      // No matching inner loop → emit solid prism for this outer alone.
      emitSilhouettePrism([rawOuter], zBottom, zTop, opts, polygonWidthMm, mesh)
      continue
    }
    innerUsed[pickedIdx] = true

    const oCCW = asCCW(rawOuter)
    const iCCW = asCCW(pickedInner)
    const tris = ribbonTriangulate(oCCW, iCCW)

    const pick = (s: 'o' | 'i', idx: number): Polygon[number] =>
      s === 'o' ? oCCW[idx] : iCCW[idx]

    // Top face (z = zTop, normals up)
    for (const [t0, t1, t2] of tris) {
      const p0 = pick(t0.s, t0.i)
      const p1 = pick(t1.s, t1.i)
      const p2 = pick(t2.s, t2.i)
      const a: Vec3 = [p0.x, p0.y, zTop]
      const b: Vec3 = [p1.x, p1.y, zTop]
      const c: Vec3 = [p2.x, p2.y, zTop]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
    }
    // Bottom face (z = zBottom, normals down — reverse winding)
    for (const [t0, t1, t2] of tris) {
      const p0 = pick(t0.s, t0.i)
      const p1 = pick(t1.s, t1.i)
      const p2 = pick(t2.s, t2.i)
      const a: Vec3 = [p0.x, p0.y, zBottom]
      const b: Vec3 = [p2.x, p2.y, zBottom]
      const c: Vec3 = [p1.x, p1.y, zBottom]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
    }

    // Outer side walls (outward normals)
    for (let k = 0; k < oCCW.length; k++) {
      const p0 = oCCW[k]
      const p1 = oCCW[(k + 1) % oCCW.length]
      const a: Vec3 = [p0.x, p0.y, zBottom]
      const b: Vec3 = [p1.x, p1.y, zBottom]
      const c: Vec3 = [p1.x, p1.y, zTop]
      const d: Vec3 = [p0.x, p0.y, zTop]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
      emitTri(mesh, a, c, d, opts, polygonWidthMm)
    }
    // Inner side walls (inward-facing — reverse winding so normals point
    // toward the ring's hole)
    const iCW = asCW(pickedInner)
    for (let k = 0; k < iCW.length; k++) {
      const p0 = iCW[k]
      const p1 = iCW[(k + 1) % iCW.length]
      const a: Vec3 = [p0.x, p0.y, zBottom]
      const b: Vec3 = [p1.x, p1.y, zBottom]
      const c: Vec3 = [p1.x, p1.y, zTop]
      const d: Vec3 = [p0.x, p0.y, zTop]
      emitTri(mesh, a, b, c, opts, polygonWidthMm)
      emitTri(mesh, a, c, d, opts, polygonWidthMm)
    }
  }
}

function polygonCentroid(loop: Polygon): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (const p of loop) {
    sx += p.x
    sy += p.y
  }
  const n = Math.max(1, loop.length)
  return { x: sx / n, y: sy / n }
}
