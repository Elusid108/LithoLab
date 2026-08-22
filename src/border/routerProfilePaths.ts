import type { NormalizedPoint } from './routerGeometry'

export const P = (x: number, y: number): NormalizedPoint => ({ x, y })

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function sampleArc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segments: number,
): NormalizedPoint[] {
  const pts: NormalizedPoint[] = []
  for (let i = 0; i <= segments; i++) {
    const a = lerp(a0, a1, i / segments)
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return pts
}

export function concat(...parts: NormalizedPoint[][]): NormalizedPoint[] {
  const out: NormalizedPoint[] = []
  for (const part of parts) {
    for (const pt of part) {
      if (out.length === 0 || out[out.length - 1].x !== pt.x || out[out.length - 1].y !== pt.y) {
        out.push(pt)
      }
    }
  }
  return out
}

export function dropFirst(pts: NormalizedPoint[]): NormalizedPoint[] {
  return pts.length <= 1 ? pts : pts.slice(1)
}

/** Bottom-inside → inside face → decorative top/outer → bottom-outside */
export function closeTop(topOuter: NormalizedPoint[]): NormalizedPoint[] {
  return concat([P(0, 0), P(0, 1)], topOuter, [P(1, 0)])
}

export function quarterRound(r: number, segments = 10): NormalizedPoint[] {
  return closeTop(concat([P(1 - r, 1)], dropFirst(sampleArc(1 - r, 1 - r, r, Math.PI / 2, 0, segments))))
}

export function chamferCut(): NormalizedPoint[] {
  return [P(0, 0), P(0, 1), P(1, 0)]
}

export function bullnose(segments = 18): NormalizedPoint[] {
  return closeTop(dropFirst(sampleArc(1, 0, 1, Math.PI, Math.PI / 2, segments)))
}

export function coveFromTop(r: number, segments = 12): NormalizedPoint[] {
  return closeTop(dropFirst(sampleArc(0, 1 - r, r, Math.PI / 2, 0, segments)))
}

export function ogeeClassic(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0.18, 0.82, 0.18, Math.PI, Math.PI * 1.5, 8)),
      dropFirst(sampleArc(0.52, 0.36, 0.24, Math.PI * 0.5, 0, 10)),
      [P(1, 1)],
    ),
  )
}

export function wavyTop(samples: number, waves: number, baseY: number, amp: number): NormalizedPoint[] {
  const pts: NormalizedPoint[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    pts.push(P(t, baseY + amp * Math.sin(t * waves * Math.PI * 2)))
  }
  pts.push(P(1, 1))
  return closeTop(dropFirst(pts))
}
