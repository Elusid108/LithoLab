/** ASCII STL matching jcsg Polygon.toStlString / CSGUtil.writeStlStream */

export type Vec3 = [number, number, number]

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function len(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

export function normalize(v: Vec3): Vec3 {
  const l = len(v)
  if (l === 0) return [0, 0, 0]
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize(cross(sub(b, a), sub(c, a)))
}

export function facetToStlString(normal: Vec3, v1: Vec3, v2: Vec3, v3: Vec3): string {
  const f = (n: number) => n.toFixed(6)
  return (
    `facet normal ${f(normal[0])} ${f(normal[1])} ${f(normal[2])}\n` +
    `outer loop\n` +
    `vertex ${f(v1[0])} ${f(v1[1])} ${f(v1[2])}\n` +
    `vertex ${f(v2[0])} ${f(v2[1])} ${f(v2[2])}\n` +
    `vertex ${f(v3[0])} ${f(v3[1])} ${f(v3[2])}\n` +
    `endloop\n` +
    `endfacet\n`
  )
}

export function writeSolidStl(facets: string[]): string {
  return `solid v3d.csg\n${facets.join('')}endsolid v3d.csg\n`
}

/** jcsg Cube: centered at origin, dimensions (dx, dy, dz) along x,y,z */
export function cuboidTriangles(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): string[] {
  const hx = dx / 2
  const hy = dy / 2
  const hz = dz / 2
  const facets: string[] = []

  const v = (x: number, y: number, z: number): Vec3 => [cx + x, cy + y, cz + z]

  // Six faces, two triangles each; normals outwards
  const faces: [Vec3, Vec3, Vec3, Vec3][] = [
    // -X
    [
      v(-hx, -hy, -hz),
      v(-hx, -hy, hz),
      v(-hx, hy, hz),
      v(-hx, hy, -hz),
    ],
    // +X
    [
      v(hx, -hy, -hz),
      v(hx, hy, -hz),
      v(hx, hy, hz),
      v(hx, -hy, hz),
    ],
    // -Y
    [
      v(-hx, -hy, -hz),
      v(hx, -hy, -hz),
      v(hx, -hy, hz),
      v(-hx, -hy, hz),
    ],
    // +Y
    [
      v(-hx, hy, -hz),
      v(-hx, hy, hz),
      v(hx, hy, hz),
      v(hx, hy, -hz),
    ],
    // -Z
    [
      v(-hx, -hy, -hz),
      v(-hx, hy, -hz),
      v(hx, hy, -hz),
      v(hx, -hy, -hz),
    ],
    // +Z
    [
      v(-hx, -hy, hz),
      v(hx, -hy, hz),
      v(hx, hy, hz),
      v(-hx, hy, hz),
    ],
  ]

  for (const [p0, p1, p2, p3] of faces) {
    const n = triangleNormal(p0, p1, p2)
    facets.push(facetToStlString(n, p0, p1, p2))
    facets.push(facetToStlString(n, p0, p2, p3))
  }
  return facets
}
