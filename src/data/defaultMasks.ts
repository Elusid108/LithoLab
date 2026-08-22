export interface DefaultMask {
  id: string
  name: string
  filename: string
}

export const DEFAULT_MASKS: DefaultMask[] = [
  { id: 'circle', name: 'Circle', filename: 'circle_mask.png' },
  { id: 'oval', name: 'Oval', filename: 'oval_mask.png' },
  { id: 'heart', name: 'Heart', filename: 'heart_mask.png' },
  { id: 'triangle', name: 'Triangle', filename: 'triangle_mask.png' },
  { id: 'teardrop', name: 'Teardrop', filename: 'teardrop_mask.png' },
  { id: 'hexagon', name: 'Hexagon', filename: 'hexagon_mask.png' },
  { id: 'octagon', name: 'Octagon', filename: 'octagon mask.png' },
  { id: 'trapezoid', name: 'Isosceles Trapezoid', filename: 'isosceles trapezoid_mask.png' },
  { id: 'half-circle', name: 'Half Circle', filename: 'half-circle_mask.png' },
  { id: 'balloon', name: 'Balloon', filename: 'baloon_mask.png' },
  { id: 'gear', name: 'Gear', filename: 'mask_gear.png' },
]

export function defaultMaskUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}masks/${encodeURIComponent(filename)}`
}
