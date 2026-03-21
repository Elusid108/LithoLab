import { ColorDistanceComputation } from '../genInstruction'

/** RGBA 0-255; opaque if a omitted */
export interface Rgba {
  r: number
  g: number
  b: number
  a?: number
}

export function rgbaToPackedRgb(c: Rgba): number {
  const a = c.a ?? 255
  return (a << 24) | (c.r << 16) | (c.g << 8) | c.b
}

export function packedRgbToRgba(pixel: number): Rgba {
  return {
    a: (pixel >>> 24) & 0xff,
    r: (pixel >>> 16) & 0xff,
    g: (pixel >>> 8) & 0xff,
    b: pixel & 0xff,
  }
}

export function findClosestColor(
  targetColor: Rgba,
  colors: Rgba[],
  colorDistanceComputation: ColorDistanceComputation,
): Rgba {
  let minDistance = Number.POSITIVE_INFINITY
  let closestColor = colors[0]
  for (const color of colors) {
    let distance: number
    switch (colorDistanceComputation) {
      case ColorDistanceComputation.RGB:
        distance = colorDistanceRGB(targetColor, color)
        break
      case ColorDistanceComputation.CIELab:
      default:
        distance = colorDistanceCIELab(targetColor, color)
    }
    if (distance < minDistance) {
      minDistance = distance
      closestColor = color
    }
  }
  return closestColor
}

function colorDistanceRGB(color1: Rgba, color2: Rgba): number {
  const dr = color1.r - color2.r
  const dg = color1.g - color2.g
  const db = color1.b - color2.b
  return dr * dr + dg * dg + db * db
}

function colorDistanceCIELab(color1: Rgba, color2: Rgba): number {
  const lab1 = rgbToLab(color1.r, color1.g, color1.b)
  const lab2 = rgbToLab(color2.r, color2.g, color2.b)
  return deltaE(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2])
}

export function cmykToColor(cyan: number, magenta: number, yellow: number, black: number): Rgba {
  const red = Math.round((1 - cyan) * (1 - black) * 255)
  const green = Math.round((1 - magenta) * (1 - black) * 255)
  const blue = Math.round((1 - yellow) * (1 - black) * 255)
  return { r: red, g: green, b: blue, a: 255 }
}

export function hslToCmyk(h: number, s: number, l: number): [number, number, number, number] {
  let c: number
  let m: number
  let y: number
  let k: number
  let r: number
  let g: number
  let b: number

  s /= 100
  l /= 100

  if (s === 0) {
    c = 0
    m = 0
    y = 0
    k = 1 - l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const hk = h / 360

    r = hueToRgb(p, q, hk + 1 / 3)
    g = hueToRgb(p, q, hk)
    b = hueToRgb(p, q, hk - 1 / 3)

    c = 1 - r
    m = 1 - g
    y = 1 - b
    k = Math.min(c, Math.min(m, y))
    c = (c - k) / (1 - k)
    m = (m - k) / (1 - k)
    y = (y - k) / (1 - k)
  }

  return [c, m, y, k]
}

export function hueToRgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

export function colorToHSL(color: Rgba): [number, number, number] {
  const r = color.r / 255.0
  const g = color.g / 255.0
  const b = color.b / 255.0

  const max = Math.max(r, Math.max(g, b))
  const min = Math.min(r, Math.min(g, b))

  const luminosity = (max + min) / 2.0

  let saturation: number
  if (max === min) {
    saturation = 0
  } else {
    const delta = max - min
    saturation = delta / (1 - Math.abs(2 * luminosity - 1))
  }

  let hue: number
  if (max === min) {
    hue = 0
  } else if (max === r) {
    hue = (60 * ((g - b) / (max - min)) + 360) % 360
  } else if (max === g) {
    hue = (60 * ((b - r) / (max - min)) + 120) % 360
  } else {
    hue = (60 * ((r - g) / (max - min)) + 240) % 360
  }
  return [hue, saturation * 100, luminosity * 100]
}

export function transparentPixel(imageData: ImageData, x: number, y: number): boolean {
  if (x < 0 || x >= imageData.width) return true
  if (y < 0 || y >= imageData.height) return true
  const i = (y * imageData.width + x) * 4
  const a = imageData.data[i + 3]
  return a === 0
}

export function hasATransparentPixelAsNeighbor(imageData: ImageData, x: number, y: number): boolean {
  const neighborList: [number, number][] = [
    [x, y + 1],
    [x + 1, y],
    [x, y - 1],
    [x - 1, y],
  ]
  for (const [xN, yN] of neighborList) {
    if (xN < 0 || xN > imageData.width - 1 || yN < 0 || yN > imageData.height - 1) return true
    if (transparentPixel(imageData, xN, yN)) return true
  }
  return false
}

export function colorToCMYK(color: Rgba): [number, number, number, number] {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255

  let k = 1 - Math.max(Math.max(r, g), b)
  let c = 0
  let m = 0
  let y = 0
  if (k < 1.0) {
    c = (1 - r - k) / (1 - k)
    m = (1 - g - k) / (1 - k)
    y = (1 - b - k) / (1 - k)
  }
  return [c, m, y, k]
}

export function colorToHexCode(color: Rgba): string {
  const red = color.r
  const green = color.g
  const blue = color.b
  return `#${[red, green, blue].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const xyz = rgbToXyz(r, g, b)
  return xyzToLab(xyz[0], xyz[1], xyz[2])
}

export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rr = pivotRgbToXyz(r / 255)
  const gg = pivotRgbToXyz(g / 255)
  const bb = pivotRgbToXyz(b / 255)

  const x = rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375
  const y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175
  const z = rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041

  return [x * 100, y * 100, z * 100]
}

export function hexToColor(hexColor: string): Rgba {
  if (hexColor.startsWith('#') && hexColor.length === 7) {
    try {
      const r = parseInt(hexColor.substring(1, 3), 16)
      const g = parseInt(hexColor.substring(3, 5), 16)
      const b = parseInt(hexColor.substring(5, 7), 16)
      return { r, g, b, a: 255 }
    } catch {
      throw new Error(`Incorrect color format : ${hexColor}`)
    }
  }
  throw new Error(`Incorrect color format : ${hexColor}`)
}

export function hexDecodeColor(hex: string): Rgba {
  if (hex.startsWith('#')) return hexToColor(hex)
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 }
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  let xx = x / 95.047
  let yy = y / 100.0
  let zz = z / 108.883

  if (xx > 0) xx = pivotXyzToLab(xx)
  if (yy > 0) yy = pivotXyzToLab(yy)
  if (zz > 0) zz = pivotXyzToLab(zz)

  const l = Math.max(0, 116 * yy - 16)
  const a = (xx - yy) * 500
  const b = (yy - zz) * 200

  return [l, a, b]
}

function pivotRgbToXyz(n: number): number {
  return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92
}

function pivotXyzToLab(n: number): number {
  return n > Math.pow(6.0 / 29.0, 3)
    ? Math.pow(n, 1.0 / 3.0)
    : n / (3 * Math.pow(6.0 / 29.0, 2)) + 4.0 / 29.0
}

export function deltaE(l1: number, a1: number, b1: number, l2: number, a2: number, b2: number): number {
  const dL = l2 - l1
  const da = a2 - a1
  const db = b2 - b1
  return Math.sqrt(dL * dL + da * da + db * db)
}

export function hexCodeComparator(s1: string, s2: string): number {
  const c1 = hexDecodeColor(s1)
  const c2 = hexDecodeColor(s2)
  const e1 = c1.b + c1.g + c1.r
  const e2 = c2.b + c2.g + c2.r
  return e1 - e2
}
