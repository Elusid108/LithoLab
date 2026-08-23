import JSZip from 'jszip'
import type { PaletteJson } from '../palette/paletteManager'
import { extForImageBlob } from '../util/fileName'

export const PROJECT_SCHEMA_VERSION = 1 as const

export interface LayerPoseSnapshot {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

export interface ProjectExportSettings {
  width: number
  height: number
  border: number
  pixelSizeMm: number
  borderHeightMm: number
  borderOverlapMm: number
}

export interface ProjectGenerationSettings {
  plateThickness: number
  colorPixelWidth: number
  layerThickness: number
  layerCount: number
  pixelMode: string
  colorDistance: string
  maxColors: number
  minThickness: number
  maxThickness: number
}

export interface ProjectJsonV1 {
  version: typeof PROJECT_SCHEMA_VERSION
  name: string
  unit: string
  photo: { file: string; pose: LayerPoseSnapshot } | null
  mask: { file: string; pose: LayerPoseSnapshot } | null
  export: ProjectExportSettings
  generation: ProjectGenerationSettings
  palette: PaletteJson
}

export interface PackProjectInput {
  name: string
  unit: string
  export: ProjectExportSettings
  generation: ProjectGenerationSettings
  palette: PaletteJson
  photo: { blob: Blob; pose: LayerPoseSnapshot } | null
  mask: { blob: Blob; pose: LayerPoseSnapshot } | null
}

export interface UnpackedProject {
  json: ProjectJsonV1
  photoBlob: Blob | null
  maskBlob: Blob | null
}

export async function packProjectZip(input: PackProjectInput): Promise<Blob> {
  const zip = new JSZip()
  const json: ProjectJsonV1 = {
    version: PROJECT_SCHEMA_VERSION,
    name: input.name,
    unit: input.unit,
    photo: null,
    mask: null,
    export: input.export,
    generation: input.generation,
    palette: input.palette,
  }

  if (input.photo) {
    const ext = extForImageBlob(input.photo.blob)
    json.photo = { file: `photo.${ext}`, pose: input.photo.pose }
    zip.file(json.photo.file, input.photo.blob)
  }
  if (input.mask) {
    const ext = extForImageBlob(input.mask.blob)
    json.mask = { file: `mask.${ext}`, pose: input.mask.pose }
    zip.file(json.mask.file, input.mask.blob)
  }

  zip.file('project.json', JSON.stringify(json, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

export async function unpackProjectZip(data: Blob): Promise<UnpackedProject> {
  const zip = await JSZip.loadAsync(data)
  const jsonFile = zip.file('project.json')
  if (!jsonFile) {
    throw new Error('Not a valid LithoLab project (missing project.json).')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await jsonFile.async('string')) as unknown
  } catch {
    throw new Error('Invalid project.json (could not parse).')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid project.json.')
  }

  const version = (parsed as { version?: unknown }).version
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project version (${String(version)}). This app reads version ${PROJECT_SCHEMA_VERSION}.`,
    )
  }

  const json = parsed as ProjectJsonV1

  let photoBlob: Blob | null = null
  if (json.photo?.file) {
    const f = zip.file(json.photo.file)
    if (f) photoBlob = await f.async('blob')
  }

  let maskBlob: Blob | null = null
  if (json.mask?.file) {
    const f = zip.file(json.mask.file)
    if (f) maskBlob = await f.async('blob')
  }

  return { json, photoBlob, maskBlob }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

export function downscaleCanvasToJpeg(
  source: HTMLCanvasElement,
  maxEdge = 256,
  quality = 0.82,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height, 1))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas unavailable'))
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    )
  })
}
