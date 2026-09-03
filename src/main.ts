import './style.css'
import {
  ColorDistanceComputation,
  createDefaultGenInstruction,
  DEFAULT_VALUE_BORDER_HEIGHT_MM,
  DEFAULT_VALUE_BORDER_OVERLAP_MM,
  DEFAULT_VALUE_COLOR_LAYER_NUMBER,
  DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
  DEFAULT_VALUE_COLOR_PIXEL_WIDTH,
  DEFAULT_VALUE_PLATE_THICKNESS,
  DEFAULT_VALUE_TEXTURE_MAX_THICKNESS,
  DEFAULT_VALUE_TEXTURE_MIN_THICKNESS,
  DEFAULT_VALUE_MASK_MAX_THICKNESS,
  PixelCreationMethod,
  type GenInstruction,
} from './genInstruction'
import { buildPreviewAndStlImages, type PreviewProgressEvent } from './generator/plateGenerator'
import type { StlProgress } from './stl/stlMaker'
import { Palette } from './palette/palette'
import {
  classifyPolygonLoops,
  decimatePolygonSet,
  extractMaskPolygons,
  offsetPolygonSet,
  polygonBounds,
  polygonSetToPath2D,
  STL_POLYGON_MAX_VERTS,
  transformPolygonSet,
  type PolygonSet,
} from './util/maskPolygon'
import defaultPalette from '../palette/0.05mm_10layer_9 colors.json' with { type: 'json' }
import {
  addColorFromPicker,
  closePaletteManager,
  exportPaletteFile,
  initPaletteManager,
  loadStoredPalette,
  openPaletteManager,
  resetPaletteToDefault,
  savePalette,
  saveCustomColor,
  showPaletteCustomView,
  showPaletteMainView,
  showPalettePickerView,
  togglePaletteEntry,
  triggerPaletteImport,
  type PaletteJson,
} from './palette/paletteManager'
import { DEFAULT_MASKS, defaultMaskUrl } from './data/defaultMasks'
import { buildOutpaintPrompt, DEFAULT_OUTPAINT_PROMPT, loadHtmlImage, prepareOutpaintRequest } from './ai/outpaint'
import { flipImage, imageDataToCanvas, imageDataToPngBlob } from './util/imageUtil'
import { decodeImportedImage, yieldForPaint } from './util/imageImport'
import { postProcessAiMaskBlob } from './util/maskProcess'
import { buildStlZip } from './workers/stlZipClient'
import {
  canvasToPngBlob,
  downscaleCanvasToJpeg,
  packProjectZip,
  unpackProjectZip,
  type LayerPoseSnapshot,
  type PackProjectInput,
  type UnpackedProject,
} from './project/projectFile'
import {
  addLibraryEntry,
  deleteLibraryEntry,
  getLibraryZip,
  isQuotaError,
  listLibrary,
} from './project/projectStore'
import {
  deleteOutpaintSourceBlob,
  loadOutpaintSourceBlob,
  saveOutpaintSourceBlob,
} from './project/outpaintSourceStore'
import { downloadBlob, extForImageBlob, safeFileName } from './util/fileName'

let currentPaletteJson: PaletteJson = loadStoredPalette(
  JSON.parse(JSON.stringify(defaultPalette)) as PaletteJson,
)

interface PalettePreviewEntry {
  hexKey: string
  cssColor: string
  active: boolean
  name: string
}

function isArrayItemActive(entry: Record<string, unknown>): boolean {
  return entry.active !== false
}

function colorCssFromArrayItem(hexKey: string, entry: Record<string, unknown>): string {
  if (/^#[0-9A-Fa-f]{6}$/.test(hexKey)) return hexKey
  const layers = entry.layers
  if (layers && typeof layers === 'object') {
    const lo = layers as Record<string, Record<string, unknown>>
    const keys = Object.keys(lo).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    for (const k of keys) {
      const sub = lo[k]
      if (!sub || typeof sub !== 'object') continue
      const so = sub as Record<string, unknown>
      if (typeof so.hexcode === 'string' && /^#[0-9A-Fa-f]{6}$/.test(so.hexcode)) {
        return so.hexcode
      }
      if (
        typeof so.H === 'number' &&
        typeof so.S === 'number' &&
        typeof so.L === 'number'
      ) {
        return `hsl(${so.H}, ${so.S}%, ${so.L}%)`
      }
    }
  }
  return '#888888'
}

function parsePaletteForPreview(root: unknown): PalettePreviewEntry[] {
  if (!root || typeof root !== 'object') return []
  const o = root as Record<string, unknown>
  const out: PalettePreviewEntry[] = []
  for (const hexKey of Object.keys(o)) {
    const raw = o[hexKey]
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name : hexKey
    const active = isArrayItemActive(entry)
    const cssColor = colorCssFromArrayItem(hexKey, entry)
    out.push({ hexKey, cssColor, active, name })
  }
  return out
}

function renderPalettePreview(parsed: PalettePreviewEntry[]): void {
  const sw = $('paletteSwatches')
  const cnt = $('paletteActiveCount')
  if (!sw) return
  sw.replaceChildren()
  let n = 0
  for (const p of parsed) {
    if (!p.active) continue
    n++
    const d = document.createElement('div')
    d.title = `${p.name} (${p.hexKey})`
    d.style.width = '20px'
    d.style.height = '20px'
    d.style.borderRadius = '4px'
    d.style.background = p.cssColor
    d.style.border = '1px solid #444'
    d.style.flexShrink = '0'
    sw.appendChild(d)
  }
  if (cnt) cnt.textContent = n === 0 ? 'No active colors' : `${n} active colors`
}

function setPaletteLoadedLabel(text: string): void {
  const el = $('paletteLoadedLabel')
  if (el) el.textContent = text
}

function refreshInlinePalette(): void {
  renderPalettePreview(parsePaletteForPreview(currentPaletteJson))
}

function initPalette(): void {
  setPaletteLoadedLabel('')
  initPaletteManager({
    getPalette: () => currentPaletteJson,
    setPalette: (next) => {
      currentPaletteJson = next
    },
    getDefaultPalette: () => defaultPalette as unknown as PaletteJson,
    onChange: () => {
      refreshInlinePalette()
      invalidatePreviews()
    },
  })
  refreshInlinePalette()
}

// --- CONFIGURATION (LithoLab script.js) ---
const HANDLE_SIZE = 8
const ROT_HANDLE_OFFSET = 30

function $(id: string): HTMLElement | null {
  return document.getElementById(id)
}

const API_KEY_STORAGE = 'cmyk_api_key'
const TEXT_MODEL_STORAGE = 'pixestl_selected_text_model'
const IMAGE_MODEL_STORAGE = 'pixestl_selected_image_model'
const OUTPAINT_PROMPT_STORAGE = 'litholab_outpaint_prompt'

type ImageEndpointType = 'predict' | 'generateContent'

interface TextModelOption {
  name: string
  displayName: string
}

interface ImageModelOption {
  name: string
  displayName: string
  imageEndpoint: ImageEndpointType
}

interface GeminiModelResponse {
  name?: string
  displayName?: string
  supportedGenerationMethods?: string[]
  supported_generation_methods?: string[]
}

interface ModelsListResponse {
  models?: GeminiModelResponse[]
  error?: { message?: string }
}

const EXCLUDE_PATTERNS = ['embedding', 'aqa', 'answer', 'vision', 'image']

let availableTextModels: TextModelOption[] = []
let availableImageModels: ImageModelOption[] = []

let isRefreshingModels = false

function modelIdFromName(name: string): string {
  return name.replace(/^models\//, '')
}

function sortModels<T extends { name: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const aName = a.name.toLowerCase()
    const bName = b.name.toLowerCase()
    const aHasGemini = aName.includes('gemini')
    const bHasGemini = bName.includes('gemini')
    const aHasGemma = aName.includes('gemma')
    const bHasGemma = bName.includes('gemma')

    if (aHasGemini && !bHasGemini) return -1
    if (!aHasGemini && bHasGemini) return 1
    if (aHasGemma && !bHasGemma) return -1
    if (!aHasGemma && bHasGemma) return 1
    return bName.localeCompare(aName)
  })
}

function googleModelEndpointUrl(
  modelId: string,
  apiKey: string,
  endpoint: 'predict' | 'generateContent',
): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${endpoint}?key=${encodeURIComponent(apiKey)}`
}

function googleGeminiGenerateContentUrl(model: string, apiKey: string): string {
  return googleModelEndpointUrl(model, apiKey, 'generateContent')
}

function gemini15FlashNamingUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
}

function sanitizeAssetFilenameSlug(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\s+/g, '-')
  s = s.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s || 'generated'
}

function parseJsonNameFromGeminiText(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const obj = JSON.parse(t) as { name?: unknown }
  if (typeof obj.name !== 'string' || !obj.name.trim()) throw new Error('Missing name in JSON')
  return sanitizeAssetFilenameSlug(obj.name)
}

/** Vision-based slug for AI-generated assets (Gemini 1.5 Flash). */
async function autoNameImage(apiKey: string, imageBase64: string, mimeType: string): Promise<string> {
  const prompt =
    'Generate a 3-5 word descriptive slug for this image, no extension. Return as a plain JSON object: {"name": "sluggish-name"}'
  const response = await fetch(gemini15FlashNamingUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mimeType || 'image/png', data: imageBase64 } },
          ],
        },
      ],
    }),
  })
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(parseApiError(data, response.statusText))
  }
  if (data.error?.message) {
    throw new Error(data.error.message)
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text).find((t) => t && t.trim())?.trim()
  if (!text) throw new Error('No text in naming response')
  return parseJsonNameFromGeminiText(text)
}

function pickDefaultTextModel(sorted: TextModelOption[]): string | null {
  if (sorted.length === 0) return null
  for (const m of sorted) {
    const id = modelIdFromName(m.name).toLowerCase()
    const disp = (m.displayName || '').toLowerCase()
    if (id.includes('flash-lite') || disp.includes('flash-lite')) return modelIdFromName(m.name)
  }
  for (const m of sorted) {
    const id = modelIdFromName(m.name).toLowerCase()
    const disp = (m.displayName || '').toLowerCase()
    if (id.includes('flash') || disp.includes('flash')) return modelIdFromName(m.name)
  }
  return modelIdFromName(sorted[0]!.name)
}

function pickDefaultImageModel(sorted: ImageModelOption[]): string | null {
  if (sorted.length === 0) return null
  for (const m of sorted) {
    const disp = (m.displayName || '').toLowerCase()
    if (disp.includes('nano banana')) return modelIdFromName(m.name)
  }
  for (const m of sorted) {
    const id = modelIdFromName(m.name).toLowerCase()
    if (id.includes('imagen')) return modelIdFromName(m.name)
  }
  const predictFirst = sorted.find((m) => m.imageEndpoint === 'predict')
  if (predictFirst) return modelIdFromName(predictFirst.name)
  return modelIdFromName(sorted[0]!.name)
}

function setSelectedTextModelPersist(id: string): void {
  state.selectedTextModel = id
  try {
    localStorage.setItem(TEXT_MODEL_STORAGE, id)
  } catch {
    /* ignore */
  }
}

function setSelectedImageModelPersist(id: string): void {
  state.selectedImageModel = id
  try {
    localStorage.setItem(IMAGE_MODEL_STORAGE, id)
  } catch {
    /* ignore */
  }
}

function isSettingsOverlayOpen(): boolean {
  const overlay = $('settingsOverlay') as HTMLElement | null
  return overlay?.style.display === 'flex'
}

/** Key used to show model UI: live field while settings open, else persisted state. */
function getApiKeyForModelPanelsVisibility(): string {
  const apiInput = $('apiKeyInput') as HTMLInputElement | null
  if (isSettingsOverlayOpen() && apiInput) return apiInput.value.trim()
  return state.apiKey.trim()
}

function reconcileSelectionsAfterFetch(sortedText: TextModelOption[], sortedImage: ImageModelOption[]): void {
  const textIds = new Set(sortedText.map((m) => modelIdFromName(m.name)))
  if (state.selectedTextModel && textIds.has(state.selectedTextModel)) {
    /* keep stored selection */
  } else {
    const d = pickDefaultTextModel(sortedText)
    if (d) setSelectedTextModelPersist(d)
    else setSelectedTextModelPersist('')
  }

  const imageIds = new Set(sortedImage.map((m) => modelIdFromName(m.name)))
  if (state.selectedImageModel && imageIds.has(state.selectedImageModel)) {
    /* keep stored selection */
  } else {
    const d = pickDefaultImageModel(sortedImage)
    if (d) setSelectedImageModelPersist(d)
    else setSelectedImageModelPersist('')
  }
}

function updateSettingsModelUI(): void {
  const countEl = $('modelsCountLabel')
  const modelsRow = $('settingsModelsRow')
  const textWrap = $('textModelSelectWrap')
  const imageWrap = $('imageModelSelectWrap')
  const textSel = $('textModelSelect') as HTMLSelectElement | null
  const imageSel = $('imageModelSelect') as HTMLSelectElement | null

  const hasKey = getApiKeyForModelPanelsVisibility().length > 0
  if (!hasKey) {
    if (modelsRow) modelsRow.style.display = 'none'
    if (textWrap) textWrap.style.display = 'none'
    if (imageWrap) imageWrap.style.display = 'none'
    return
  }

  if (modelsRow) modelsRow.style.display = ''

  if (countEl) {
    countEl.textContent =
      availableTextModels.length > 0 || availableImageModels.length > 0
        ? `${availableTextModels.length} text, ${availableImageModels.length} image models`
        : 'No models loaded'
  }

  if (textWrap) textWrap.style.display = availableTextModels.length > 0 ? 'block' : 'none'
  if (imageWrap) imageWrap.style.display = availableImageModels.length > 0 ? 'block' : 'none'

  if (textSel) {
    textSel.replaceChildren()
    for (const m of availableTextModels) {
      const id = modelIdFromName(m.name)
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = m.displayName || m.name
      textSel.appendChild(opt)
    }
    if (
      state.selectedTextModel &&
      [...textSel.options].some((o) => o.value === state.selectedTextModel)
    ) {
      textSel.value = state.selectedTextModel
    }
  }

  if (imageSel) {
    imageSel.replaceChildren()
    for (const m of availableImageModels) {
      const id = modelIdFromName(m.name)
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = m.displayName || m.name
      imageSel.appendChild(opt)
    }
    if (
      state.selectedImageModel &&
      [...imageSel.options].some((o) => o.value === state.selectedImageModel)
    ) {
      imageSel.value = state.selectedImageModel
    }
  }
}

function updateRefreshButtonState(): void {
  const btn = $('refreshModelsBtn') as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = isRefreshingModels
  btn.textContent = isRefreshingModels ? 'Scanning...' : 'Refresh Models'
}

async function fetchModels(key: string): Promise<void> {
  isRefreshingModels = true
  updateRefreshButtonState()
  try {
    const trimmed = key?.trim()
    if (!trimmed) {
      availableTextModels = []
      availableImageModels = []
      reconcileSelectionsAfterFetch([], [])
      updateSettingsModelUI()
      return
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}`,
      )
      const data: ModelsListResponse = await response.json()

      if (data.error) {
        availableTextModels = []
        availableImageModels = []
        reconcileSelectionsAfterFetch([], [])
        updateSettingsModelUI()
        return
      }

      const rawModels = data.models ?? []
      const textModels: TextModelOption[] = []
      const imageModels: ImageModelOption[] = []

      for (const model of rawModels) {
        const name = model.name ?? ''
        const nameLower = name.toLowerCase()
        const displayName = model.displayName ?? name.replace(/^models\//, '')
        const displayNameLower = displayName.toLowerCase()
        const methods = model.supportedGenerationMethods ?? model.supported_generation_methods ?? []

        const hasGenerateContent = methods.some(
          (m) => String(m).toLowerCase() === 'generatecontent',
        )

        const excluded = EXCLUDE_PATTERNS.some((p) => nameLower.includes(p))

        if (hasGenerateContent && !excluded) {
          textModels.push({ name, displayName })
        }

        const isImagenByName = nameLower.includes('imagen') || nameLower.includes('image')
        const isImageByDisplayName = displayNameLower.includes('nano banana')
        const isImageModel = isImagenByName || isImageByDisplayName

        if (isImageModel) {
          const isGeminiImage =
            hasGenerateContent &&
            (displayNameLower.includes('nano banana') ||
              (nameLower.includes('gemini') &&
                (displayNameLower.includes('image') || displayNameLower.includes('vision'))))
          const imageEndpoint: ImageEndpointType = isGeminiImage ? 'generateContent' : 'predict'
          imageModels.push({ name, displayName, imageEndpoint })
        }
      }

      const sortedText = sortModels(textModels)
      const sortedImage = sortModels(imageModels)
      availableTextModels = sortedText
      availableImageModels = sortedImage

      reconcileSelectionsAfterFetch(sortedText, sortedImage)
      updateSettingsModelUI()
    } catch {
      availableTextModels = []
      availableImageModels = []
      reconcileSelectionsAfterFetch([], [])
      updateSettingsModelUI()
    }
  } finally {
    isRefreshingModels = false
    updateRefreshButtonState()
  }
}

function parseApiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    const nested = o.error
    if (typeof nested === 'string') return nested
    if (nested && typeof nested === 'object') {
      const e = nested as Record<string, unknown>
      if (typeof e.message === 'string') return e.message
    }
    if (typeof o.message === 'string') return o.message
  }
  return fallback
}

// --- TYPES ---
type ActiveLayer = 'photo' | 'mask'

type HitId = 'tl' | 'tr' | 'br' | 'bl' | 't' | 'b' | 'l' | 'r' | 'rotate' | 'move'

interface PhotoLayer {
  img: HTMLImageElement | null
  x: number
  y: number
  w: number
  h: number
  rot: number
  loaded: boolean
  isGenerated: boolean
  aspect?: number
  objectUrl: string | null
  historyId: string | null
}

interface MaskLayer {
  img: HTMLImageElement | null
  x: number
  y: number
  w: number
  h: number
  rot: number
  loaded: boolean
  aspect: number
  /** Vector mask polygon in trimmed source-image space (0..trimW, 0..trimH). */
  polygon: PolygonSet | null
  /** Width/height (in source pixels) of the trimmed mask bounding box. */
  trimW: number
  trimH: number
  isGenerated: boolean
  objectUrl: string | null
  /** Trimmed grayscale crop aligned with `polygon` / trimW×trimH. */
  gray: ImageData | null
}

interface LayerPose {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

interface LayerCacheEntry extends LayerPose {}

/**
 * Cached output of generateLayers() consumed by exportDownload().
 * All polygons are in millimeters with origin at the silhouette bounding-box top-left.
 */
interface GeneratedPreviewData {
  /** Photo composited over the white border ring, transparent outside silhouette. */
  rectifiedComposite: HTMLCanvasElement
  /** Width/height of the rectifiedComposite in millimeters. */
  widthMm: number
  heightMm: number
  /** Mask polygon (interior of the lithophane) in mm. */
  maskPolygonMm: PolygonSet
  /** Silhouette polygon (mask offset by border XY) in mm. Defines the printed outline. */
  silhouettePolygonMm: PolygonSet
  outerPolygonMm: PolygonSet
  holePolygonMm: PolygonSet
  /** Binary-clipped rasters for mesh emission (not flipped). */
  stlColorImage: ImageData | null
  stlTextureImage: ImageData | null
  stlMaskRelief: ImageData | null
  /** Preview PNGs matching the on-screen canvases, packed into the ZIP. */
  previewColorPng: Blob | null
  previewTexturePng: Blob | null
}

type HistorySource = 'upload' | 'ai'

interface LayerHistoryEntry {
  id: string
  blob: Blob
  objectUrl: string
  suggestedSlug: string | null
  source: HistorySource
  isExtendSource?: boolean
  extendSourceBlob?: Blob
}

interface ImageLoadOptions {
  pose?: LayerPose
  resetExportDims?: boolean
  objectUrl?: string | null
  historyId?: string | null
}

interface AppState {
  apiKey: string
  selectedTextModel: string
  selectedImageModel: string
  activeLayer: ActiveLayer
  unit: string
  isDragging: boolean
  dragAction: HitId | null
  dragStart: { x: number; y: number }
  export: {
    width: number
    height: number
    pixelStep: number
    border: number
    pixelSizeMm: number
    borderHeightMm: number
    borderOverlapMm: number
  }
  photo: PhotoLayer
  mask: MaskLayer
  pixelData: GeneratedPreviewData | null
  prompts: { photo: string; mask: string }
  history: { photo: LayerHistoryEntry[]; mask: LayerHistoryEntry[] }
  lastGeneratedPhotoName: string | null
  lastGeneratedMaskName: string | null
  aiPromptMode: 'photo' | 'mask'
  maskAiKind: 'cookiecutter' | 'stencil'
  maskAiGradient: boolean
  layerCache: Record<string, LayerCacheEntry>
}

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

function loadSelectedTextModel(): string {
  try {
    return localStorage.getItem(TEXT_MODEL_STORAGE) ?? ''
  } catch {
    return ''
  }
}

function loadSelectedImageModel(): string {
  try {
    return localStorage.getItem(IMAGE_MODEL_STORAGE) ?? ''
  } catch {
    return ''
  }
}

const state: AppState = {
  apiKey: loadApiKey(),
  selectedTextModel: loadSelectedTextModel(),
  selectedImageModel: loadSelectedImageModel(),
  activeLayer: 'photo',
  unit: 'mm',
  isDragging: false,
  dragAction: null,
  dragStart: { x: 0, y: 0 },
  export: {
    width: 100,
    height: 100,
    pixelStep: 2,
    border: 3,
    pixelSizeMm: 0.2,
    borderHeightMm: DEFAULT_VALUE_BORDER_HEIGHT_MM,
    borderOverlapMm: DEFAULT_VALUE_BORDER_OVERLAP_MM,
  },
  photo: {
    img: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rot: 0,
    loaded: false,
    isGenerated: false,
    objectUrl: null,
    historyId: null,
  },
  mask: {
    img: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rot: 0,
    loaded: false,
    aspect: 1,
    polygon: null,
    trimW: 0,
    trimH: 0,
    isGenerated: false,
    objectUrl: null,
    gray: null,
  },
  pixelData: null,
  prompts: { photo: '', mask: '' },
  history: { photo: [], mask: [] },
  lastGeneratedPhotoName: null,
  lastGeneratedMaskName: null,
  aiPromptMode: 'photo',
  maskAiKind: 'cookiecutter',
  maskAiGradient: false,
  layerCache: {},
}

let dragInitial: LayerPose | null = null

const editorCanvas = $('editorCanvas') as HTMLCanvasElement | null
const ctx = editorCanvas?.getContext('2d') ?? null

function requireCtx(): CanvasRenderingContext2D {
  if (!ctx) throw new Error('2D canvas context unavailable')
  return ctx
}

function requireCanvas(): HTMLCanvasElement {
  if (!editorCanvas) throw new Error('#editorCanvas not found')
  return editorCanvas
}

const ui = {
  overlay: null as HTMLElement | null,
  bar: null as HTMLElement | null,
  text: null as HTMLElement | null,
  sub: null as HTMLElement | null,
  bind(): void {
    ui.overlay = $('progressOverlay')
    ui.bar = $('progressBar')
    ui.text = $('progressText')
    ui.sub = $('progressSub')
  },
  update(pct: number, msg?: string, sub?: string): void {
    if (ui.bar) ui.bar.style.width = `${pct}%`
    if (msg !== undefined && ui.text) ui.text.textContent = msg
    if (sub !== undefined && ui.sub) ui.sub.textContent = sub
  },
  show(): void {
    if (ui.overlay) ui.overlay.style.display = 'flex'
  },
  hide(): void {
    if (ui.overlay) ui.overlay.style.display = 'none'
  },
}

let progressDepth = 0

function beginProgress(): void {
  progressDepth += 1
  if (progressDepth === 1) ui.show()
}

function endProgress(): void {
  progressDepth = Math.max(0, progressDepth - 1)
  if (progressDepth === 0) ui.hide()
}

function reportImportProgress(pct: number, message: string, detail: string): void {
  ui.update(pct, message, detail)
}

function setExportButtonsEnabled(enabled: boolean): void {
  const btnStl = $('btnDownloadStl') as HTMLButtonElement | null
  if (!btnStl) return
  btnStl.disabled = !enabled
  if (enabled) {
    btnStl.style.background = '#00d26a'
    btnStl.style.color = '#000'
  } else {
    btnStl.style.background = '#333'
    btnStl.style.color = '#888'
  }
}

function invalidatePreviews(): void {
  state.pixelData = null
  setExportButtonsEnabled(false)
  renderImageDataToCanvas('colorPreviewCanvas', null)
  renderImageDataToCanvas('texturePreviewCanvas', null)
}

function cacheKeyFromSrc(src: string): string {
  return src.substring(0, 100) + src.length
}

function cacheCurrentLayerState(type: ActiveLayer): void {
  const layer = state[type]
  if (layer.loaded && layer.img?.src) {
    const key = cacheKeyFromSrc(layer.img.src)
    state.layerCache[key] = {
      x: layer.x,
      y: layer.y,
      w: layer.w,
      h: layer.h,
      rot: layer.rot,
    }
  }
}

interface MaskExtraction {
  polygon: PolygonSet
  trimW: number
  trimH: number
  gray: ImageData | null
}

/**
 * Extract a smooth vector polygon from the source mask image.
 * Gray (including dark flower texture) stays inside the body; enclosed black
 * pockets become hole loops. The returned `trimW`/`trimH` describe the
 * polygon's bounding box in source-image pixel units.
 */
function extractMaskFromImage(img: HTMLImageElement): MaskExtraction {
  const tempC = document.createElement('canvas')
  tempC.width = img.width
  tempC.height = img.height
  const tCtx = tempC.getContext('2d')
  if (!tCtx) {
    return {
      polygon: [
        [
          { x: 0, y: 0 },
          { x: img.width, y: 0 },
          { x: img.width, y: img.height },
          { x: 0, y: img.height },
        ],
      ],
      trimW: img.width,
      trimH: img.height,
      gray: null,
    }
  }
  tCtx.drawImage(img, 0, 0)
  const id = tCtx.getImageData(0, 0, tempC.width, tempC.height)

  let polygons = extractMaskPolygons(id, { smoothIters: 3, minLoopArea: 6 })

  if (polygons.length === 0) {
    polygons = [
      [
        { x: 0, y: 0 },
        { x: img.width, y: 0 },
        { x: img.width, y: img.height },
        { x: 0, y: img.height },
      ],
    ]
  }

  const b = polygonBounds(polygons)
  const trimW = Math.max(1, b.maxX - b.minX)
  const trimH = Math.max(1, b.maxY - b.minY)
  const tw = Math.max(1, Math.round(trimW))
  const th = Math.max(1, Math.round(trimH))
  const crop = document.createElement('canvas')
  crop.width = tw
  crop.height = th
  const cctx = crop.getContext('2d')
  let gray: ImageData | null = null
  if (cctx) {
    cctx.drawImage(img, b.minX, b.minY, trimW, trimH, 0, 0, tw, th)
    gray = cctx.getImageData(0, 0, tw, th)
  }
  const sx = tw / trimW
  const sy = th / trimH
  const normalized: PolygonSet = polygons.map((loop) =>
    loop.map((p) => ({ x: (p.x - b.minX) * sx, y: (p.y - b.minY) * sy })),
  )
  return { polygon: normalized, trimW: tw, trimH: th, gray }
}

function revokeLayerObjectUrl(layer: { objectUrl: string | null }): void {
  if (layer.objectUrl) {
    URL.revokeObjectURL(layer.objectUrl)
    layer.objectUrl = null
  }
}

function blobFromBase64(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'image/png' })
}

function applyPoseToLayer(
  layer: { x: number; y: number; w: number; h: number; rot: number },
  pose: LayerPose,
): void {
  layer.x = pose.x
  layer.y = pose.y
  layer.w = pose.w
  layer.h = pose.h
  layer.rot = pose.rot
}

function handleImageLoad(
  img: HTMLImageElement,
  mode: ActiveLayer,
  prompt: string | null,
  isGenerated: boolean,
  opts: ImageLoadOptions = {},
): void {
  const cvs = requireCanvas()
  const c = requireCtx()
  const resetExportDims = opts.resetExportDims !== false

  cacheCurrentLayerState(mode)

  if (mode === 'mask') {
    const layer = state.mask
    revokeLayerObjectUrl(layer)
    layer.objectUrl = opts.objectUrl ?? null
    layer.img = img
    layer.loaded = true
    layer.isGenerated = isGenerated
    const extracted = extractMaskFromImage(img)
    layer.polygon = extracted.polygon
    layer.trimW = extracted.trimW
    layer.trimH = extracted.trimH
    layer.gray = extracted.gray
    layer.aspect = extracted.trimW / extracted.trimH

    const key = cacheKeyFromSrc(img.src)
    const cached = state.layerCache[key]
    if (opts.pose) {
      applyPoseToLayer(layer, opts.pose)
    } else if (cached) {
      applyPoseToLayer(layer, cached)
    } else {
      layer.w = extracted.trimW
      layer.h = extracted.trimH
      layer.rot = 0
      const viewScale = Math.min((cvs.width * 0.5) / layer.w, (cvs.height * 0.5) / layer.h)
      layer.w *= viewScale
      layer.h *= viewScale
      layer.x = (cvs.width - layer.w) / 2
      layer.y = (cvs.height - layer.h) / 2
    }

    if (resetExportDims) {
      state.export.width = 100
      state.export.height = 100 / layer.aspect
      updateInputsFromState()
    }

    const btnMask = $('btn-mask')
    if (btnMask) btnMask.classList.remove('disabled')
    const dlMask = $('dl-mask') as HTMLElement | null
    if (dlMask) dlMask.style.display = isGenerated ? 'inline-block' : 'none'

    syncActiveGeneratedUi('mask', isGenerated, isGenerated ? img.src : null)

    selectLayer('mask')
  } else {
    const layer = state.photo
    revokeLayerObjectUrl(layer)
    layer.objectUrl = opts.objectUrl ?? null
    layer.img = img
    layer.loaded = true
    layer.isGenerated = isGenerated
    layer.aspect = img.width / img.height
    layer.historyId = opts.historyId ?? null

    const key = cacheKeyFromSrc(img.src)
    const cached = state.layerCache[key]
    if (opts.pose) {
      applyPoseToLayer(layer, opts.pose)
    } else if (cached) {
      applyPoseToLayer(layer, cached)
    } else {
      layer.rot = 0
      const padding = 40
      const availW = cvs.width - padding
      const availH = cvs.height - padding
      const scale = Math.min(availW / img.width, availH / img.height)
      layer.w = img.width * scale
      layer.h = img.height * scale
      layer.x = (cvs.width - layer.w) / 2
      layer.y = (cvs.height - layer.h) / 2
    }

    if (!state.mask.loaded) {
      state.mask.aspect = layer.aspect ?? 1
      state.mask.w = layer.w
      state.mask.h = layer.h
      state.mask.x = layer.x
      state.mask.y = layer.y
      if (resetExportDims) {
        state.export.width = 100
        state.export.height = 100 / (layer.aspect ?? 1)
        updateInputsFromState()
      }
      selectLayer('photo')
    }
    if (prompt) {
      const fileNameInput = $('fileNameInput') as HTMLInputElement | null
      if (fileNameInput) {
        fileNameInput.value = prompt
          .split(' ')
          .slice(0, 3)
          .join('_')
          .replace(/[^a-zA-Z0-9_]/g, '')
      }
    }

    const dlPhoto = $('dl-photo') as HTMLElement | null
    if (dlPhoto) dlPhoto.style.display = isGenerated ? 'inline-block' : 'none'

    syncActiveGeneratedUi('photo', isGenerated, isGenerated ? img.src : null)
  }
  invalidatePreviews()
  render(true, c)
}

function patchHistorySuggestedSlug(type: ActiveLayer, id: string, slug: string): void {
  const entry = state.history[type].find((h) => h.id === id)
  if (entry) entry.suggestedSlug = slug
}

function syncActiveGeneratedUi(
  layer: 'photo' | 'mask',
  isGenerated: boolean,
  previewSrc: string | null,
): void {
  const container =
    layer === 'photo' ? $('activeGeneratedPhotoContainer') : $('activeGeneratedMaskContainer')
  const prev =
    layer === 'photo'
      ? ($('generatedPhotoPreview') as HTMLImageElement | null)
      : ($('generatedMaskPreview') as HTMLImageElement | null)
  const span =
    layer === 'photo' ? $('generatedPhotoNameDisplay') : $('generatedMaskNameDisplay')
  if (!container || !prev || !span) return

  if (isGenerated) {
    container.style.display = 'block'
    if (previewSrc) {
      prev.src = previewSrc
      prev.hidden = false
    } else {
      prev.removeAttribute('src')
      prev.hidden = true
    }
    const slug = layer === 'photo' ? state.lastGeneratedPhotoName : state.lastGeneratedMaskName
    span.textContent =
      slug ? (layer === 'photo' ? `${slug}.jpg` : `${slug}.png`) : ''
  } else {
    container.style.display = 'none'
    prev.removeAttribute('src')
    prev.hidden = true
    span.textContent = ''
    if (layer === 'photo') state.lastGeneratedPhotoName = null
    else state.lastGeneratedMaskName = null
  }
}

function renderHistory(type: ActiveLayer): void {
  const container = $(`${type}History`)
  if (!container) return
  container.replaceChildren()

  for (const entry of state.history[type]) {
    const wrap = document.createElement('div')
    wrap.className = 'history-thumb-wrap'
    const thumb = document.createElement('img')
    thumb.src = entry.objectUrl
    thumb.className = 'history-thumb'
    thumb.alt = entry.suggestedSlug ?? type
    thumb.addEventListener('click', () => restoreHistoryEntry(type, entry))
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'history-thumb-del'
    del.title = 'Remove'
    del.textContent = '×'
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      removeHistoryEntry(type, entry.id)
    })
    wrap.append(thumb, del)
    container.appendChild(wrap)
  }
  refreshStripArrows(container)
}

function updateStripArrowState(root: HTMLElement): void {
  const strip = root.querySelector('.history-strip') as HTMLElement | null
  const prev = root.querySelector('.strip-arrow[data-dir="-1"]') as HTMLButtonElement | null
  const next = root.querySelector('.strip-arrow[data-dir="1"]') as HTMLButtonElement | null
  if (!strip || !prev || !next) return
  const max = strip.scrollWidth - strip.clientWidth
  prev.disabled = strip.scrollLeft <= 1
  next.disabled = max <= 1 || strip.scrollLeft >= max - 1
}

function refreshStripArrows(strip: HTMLElement): void {
  const root = strip.closest('.strip-scroller')
  if (root instanceof HTMLElement) updateStripArrowState(root)
}

function bindStripScroller(root: HTMLElement): void {
  const strip = root.querySelector('.history-strip') as HTMLElement | null
  const prev = root.querySelector('.strip-arrow[data-dir="-1"]') as HTMLButtonElement | null
  const next = root.querySelector('.strip-arrow[data-dir="1"]') as HTMLButtonElement | null
  if (!strip || !prev || !next) return

  const step = (): number => Math.max(135, Math.round(strip.clientWidth * 0.75))
  prev.addEventListener('click', () => {
    strip.scrollBy({ left: -step(), behavior: 'smooth' })
  })
  next.addEventListener('click', () => {
    strip.scrollBy({ left: step(), behavior: 'smooth' })
  })
  strip.addEventListener('scroll', () => updateStripArrowState(root), { passive: true })
  new ResizeObserver(() => updateStripArrowState(root)).observe(strip)
  updateStripArrowState(root)
}

function bindAllStripScrollers(): void {
  document.querySelectorAll('.strip-scroller').forEach((el) => {
    if (el instanceof HTMLElement) bindStripScroller(el)
  })
}

function addToHistory(
  blob: Blob,
  type: ActiveLayer,
  meta: {
    source: HistorySource
    suggestedSlug?: string | null
    isExtendSource?: boolean
    extendSourceBlob?: Blob
  } = { source: 'upload' },
): string {
  const id = crypto.randomUUID()
  const objectUrl = URL.createObjectURL(blob)
  state.history[type].unshift({
    id,
    blob,
    objectUrl,
    suggestedSlug: meta.suggestedSlug ?? null,
    source: meta.source,
    isExtendSource: meta.isExtendSource,
    extendSourceBlob: meta.extendSourceBlob,
  })
  renderHistory(type)
  return id
}

function removeHistoryEntry(type: ActiveLayer, id: string): void {
  const i = state.history[type].findIndex((h) => h.id === id)
  if (i < 0) return
  const [entry] = state.history[type].splice(i, 1)
  URL.revokeObjectURL(entry.objectUrl)
  renderHistory(type)
}

function restoreHistoryEntry(type: ActiveLayer, entry: LayerHistoryEntry): void {
  if (type === 'photo') void applyOutpaintSourceForRestoredPhoto(entry)
  if (entry.source === 'ai') {
    if (type === 'photo') state.lastGeneratedPhotoName = entry.suggestedSlug
    else state.lastGeneratedMaskName = entry.suggestedSlug
  }
  void (async () => {
    beginProgress()
    try {
      ui.update(8, 'Restoring image…', '')
      await yieldForPaint()
      const decoded = await decodeImportedImage(entry.blob, type, undefined, reportImportProgress)
      handleImageLoad(decoded.img, type, null, entry.source === 'ai', {
        objectUrl: decoded.objectUrl,
        historyId: type === 'photo' ? entry.id : undefined,
      })
    } catch (e) {
      console.error(e)
      void window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      endProgress()
    }
  })()
}

function loadLayer(e: Event, type: ActiveLayer): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (type === 'photo') clearOutpaintSource()
  const suggested = file.name.replace(/\.[^.]+$/, '') || null
  void (async () => {
    beginProgress()
    try {
      ui.update(5, 'Importing image…', file.name)
      await yieldForPaint()
      const decoded = await decodeImportedImage(file, type, file.name, reportImportProgress)
      const histId = addToHistory(decoded.blob, type, { source: 'upload', suggestedSlug: suggested })
      handleImageLoad(decoded.img, type, null, false, {
        objectUrl: decoded.objectUrl,
        historyId: type === 'photo' ? histId : undefined,
      })
    } catch (err) {
      console.error(err)
      void window.alert(
        err instanceof Error ? err.message : `Could not decode that ${type} image.`,
      )
    } finally {
      endProgress()
      input.value = ''
    }
  })()
}

function selectLayer(layer: ActiveLayer): void {
  if (layer === 'mask' && !state.mask.loaded) return
  cacheCurrentLayerState(state.activeLayer)
  state.activeLayer = layer
  const btnMask = $('btn-mask')
  const btnPhoto = $('btn-photo')
  if (btnMask) {
    btnMask.className =
      layer === 'mask' ? 'layer-btn active' : state.mask.loaded ? 'layer-btn' : 'layer-btn disabled'
  }
  if (btnPhoto) {
    btnPhoto.className = layer === 'photo' ? 'layer-btn active' : 'layer-btn'
  }
  render()
}

function getHitHandle(layer: PhotoLayer | MaskLayer, mx: number, my: number): HitId | null {
  const cx = layer.x + layer.w / 2
  const cy = layer.y + layer.h / 2
  const corners: { id: HitId; x: number; y: number }[] = [
    { id: 'tl', x: -layer.w / 2, y: -layer.h / 2 },
    { id: 'tr', x: layer.w / 2, y: -layer.h / 2 },
    { id: 'br', x: layer.w / 2, y: layer.h / 2 },
    { id: 'bl', x: -layer.w / 2, y: layer.h / 2 },
    { id: 't', x: 0, y: -layer.h / 2 },
    { id: 'b', x: 0, y: layer.h / 2 },
    { id: 'l', x: -layer.w / 2, y: 0 },
    { id: 'r', x: layer.w / 2, y: 0 },
    { id: 'rotate', x: 0, y: -layer.h / 2 - ROT_HANDLE_OFFSET },
  ]

  for (const c of corners) {
    const rx = c.x * Math.cos(layer.rot) - c.y * Math.sin(layer.rot)
    const ry = c.x * Math.sin(layer.rot) + c.y * Math.cos(layer.rot)
    const sx = cx + rx
    const sy = cy + ry
    if (Math.hypot(mx - sx, my - sy) < HANDLE_SIZE + 5) return c.id
  }

  const dx = mx - cx
  const dy = my - cy
  const localX = dx * Math.cos(-layer.rot) - dy * Math.sin(-layer.rot)
  const localY = dx * Math.sin(-layer.rot) + dy * Math.cos(-layer.rot)

  if (Math.abs(localX) < layer.w / 2 && Math.abs(localY) < layer.h / 2) return 'move'
  return null
}

function setTransform(layer: PhotoLayer | MaskLayer, c: CanvasRenderingContext2D): void {
  c.translate(layer.x + layer.w / 2, layer.y + layer.h / 2)
  c.rotate(layer.rot)
}

function drawLayer(layer: PhotoLayer | MaskLayer, isMask: boolean, c: CanvasRenderingContext2D): void {
  c.save()
  setTransform(layer, c)
  if (isMask) {
    // Masks render via Path2D in render() — drawLayer is no-op for them.
    c.restore()
    return
  }
  if (layer.img) c.drawImage(layer.img, -layer.w / 2, -layer.h / 2, layer.w, layer.h)
  c.restore()
}

function render(showGizmos = true, cIn?: CanvasRenderingContext2D): void {
  const c = cIn ?? requireCtx()
  const cvs = requireCanvas()
  c.clearRect(0, 0, cvs.width, cvs.height)

  if (state.photo.loaded) drawLayer(state.photo, false, c)

  if (state.mask.loaded && state.mask.polygon && state.mask.trimW > 0 && state.mask.trimH > 0) {
    c.save()
    setTransform(state.mask, c)
    c.translate(-state.mask.w / 2, -state.mask.h / 2)
    c.scale(state.mask.w / state.mask.trimW, state.mask.h / state.mask.trimH)

    const path = polygonSetToPath2D(state.mask.polygon)
    c.globalCompositeOperation = 'destination-in'
    c.fillStyle = '#ffffff'
    c.fill(path, 'evenodd')
    c.globalCompositeOperation = 'source-over'
    c.restore()

    if (showGizmos) {
      c.save()
      setTransform(state.mask, c)
      c.strokeStyle = 'rgba(255,255,255,0.35)'
      c.lineWidth = 1
      c.strokeRect(-state.mask.w / 2, -state.mask.h / 2, state.mask.w, state.mask.h)
      c.restore()
    }
  }

  if (!showGizmos) return

  const active = state[state.activeLayer]
  if (active && (active.loaded || state.activeLayer === 'mask')) {
    c.save()
    setTransform(active, c)

    c.strokeStyle = '#00d26a'
    c.lineWidth = 2
    c.strokeRect(-active.w / 2, -active.h / 2, active.w, active.h)

    c.fillStyle = '#00d26a'
    const hw = active.w / 2
    const hh = active.h / 2
    const s = HANDLE_SIZE
    c.fillRect(-hw - s / 2, -hh - s / 2, s, s)
    c.fillRect(hw - s / 2, -hh - s / 2, s, s)
    c.fillRect(hw - s / 2, hh - s / 2, s, s)
    c.fillRect(-hw - s / 2, hh - s / 2, s, s)

    c.fillRect(-s / 2, -hh - s / 2, s, s) // top
    c.fillRect(-s / 2, hh - s / 2, s, s) // bottom
    c.fillRect(-hw - s / 2, -s / 2, s, s) // left
    c.fillRect(hw - s / 2, -s / 2, s, s) // right

    c.beginPath()
    c.moveTo(0, -hh)
    c.lineTo(0, -hh - ROT_HANDLE_OFFSET)
    c.stroke()
    c.beginPath()
    c.arc(0, -hh - ROT_HANDLE_OFFSET, s / 2, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }
}

function updateInputsFromState(): void {
  const isInch = state.unit === 'in'
  const valW = isInch ? state.export.width / 25.4 : state.export.width
  const valH = isInch ? state.export.height / 25.4 : state.export.height
  const inpW = $('inpWidth') as HTMLInputElement | null
  const inpH = $('inpHeight') as HTMLInputElement | null
  if (inpW) inpW.value = valW.toFixed(1)
  if (inpH) inpH.value = valH.toFixed(1)
}

function updateDims(changed: 'w' | 'h'): void {
  const isInch = state.unit === 'in'
  const inpW = $('inpWidth') as HTMLInputElement | null
  const inpH = $('inpHeight') as HTMLInputElement | null
  if (!inpW || !inpH) return
  let valW = parseFloat(inpW.value)
  let valH = parseFloat(inpH.value)
  if (isInch) {
    valW *= 25.4
    valH *= 25.4
  }

  const mh = state.mask.h
  const aspect = mh !== 0 ? state.mask.w / mh : 1

  if (changed === 'w') {
    state.export.width = valW
    state.export.height = valW / aspect
  } else {
    state.export.height = valH
    state.export.width = valH * aspect
  }
  updateInputsFromState()
  updateExportGridReadout()
  invalidatePreviews()
}

function updateUnitDisplay(): void {
  const unitSelect = $('unitSelect') as HTMLSelectElement | null
  if (unitSelect) state.unit = unitSelect.value
  updateInputsFromState()
}

function updateExportGridReadout(): void {
  const gridEl = $('exportGridVal')
  if (!gridEl) return
  const w = state.export.width
  const h = state.export.height
  const ps = state.export.pixelSizeMm || 0.2
  const exportW = Math.max(1, Math.min(2000, Math.round(w / ps)))
  const exportH = Math.max(1, Math.min(2000, Math.round(h / ps)))
  gridEl.textContent = `Export grid: ${exportW} × ${exportH} px`
}

// ---------------------------------------------------------------------------
// 2D affine helpers (used to compose photo / mask / mm-space transforms)
// ---------------------------------------------------------------------------

interface Affine {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

function translateAffine(tx: number, ty: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty }
}

function scaleAffine(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 }
}

function rotateAffine(theta: number): Affine {
  return {
    a: Math.cos(theta),
    b: Math.sin(theta),
    c: -Math.sin(theta),
    d: Math.cos(theta),
    tx: 0,
    ty: 0,
  }
}

function multiplyAffine(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  }
}

function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c
  if (det === 0) return IDENTITY
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    tx: (m.c * m.ty - m.d * m.tx) / det,
    ty: (m.b * m.tx - m.a * m.ty) / det,
  }
}

/** Affine that maps a layer's source pixel space onto editor canvas pixels. */
function layerEditorAffine(
  layer: { x: number; y: number; w: number; h: number; rot: number },
  srcW: number,
  srcH: number,
): Affine {
  if (srcW === 0 || srcH === 0) return IDENTITY
  let m = scaleAffine(layer.w / srcW, layer.h / srcH)
  m = multiplyAffine(translateAffine(-layer.w / 2, -layer.h / 2), m)
  m = multiplyAffine(rotateAffine(layer.rot), m)
  m = multiplyAffine(translateAffine(layer.x + layer.w / 2, layer.y + layer.h / 2), m)
  return m
}

function shiftPolygonSet(set: PolygonSet, dx: number, dy: number): PolygonSet {
  return set.map((loop) => loop.map((p) => ({ x: p.x + dx, y: p.y + dy })))
}

function renderImageDataToCanvas(canvasId: string, imageData: ImageData | null): void {
  const cvs = $(canvasId) as HTMLCanvasElement | null
  if (!cvs) return
  if (!imageData || imageData.width === 0 || imageData.height === 0) {
    cvs.width = 1
    cvs.height = 1
    cvs.getContext('2d')?.clearRect(0, 0, 1, 1)
    return
  }
  cvs.width = imageData.width
  cvs.height = imageData.height
  cvs.getContext('2d')!.putImageData(imageData, 0, 0)
}

// ---------------------------------------------------------------------------
// Build the rectified composite + polygons used by the preview & STL pipelines
// ---------------------------------------------------------------------------

interface RectifiedScene {
  composite: HTMLCanvasElement
  widthMm: number
  heightMm: number
  maskPolygonMm: PolygonSet
  silhouettePolygonMm: PolygonSet
  outerPolygonMm: PolygonSet
  holePolygonMm: PolygonSet
  maskGray: HTMLCanvasElement | null
}

function buildRectifiedScene(): RectifiedScene | null {
  if (!state.photo.loaded || !state.photo.img) return null

  const borderXY = Math.max(0, state.export.border)
  const destW = state.export.width
  const destH = state.export.height
  if (destW <= 0 || destH <= 0) return null

  // 1. Mask polygon in mm space (covering 0..destW × 0..destH).
  let maskInitial: PolygonSet
  if (state.mask.loaded && state.mask.polygon && state.mask.trimW > 0 && state.mask.trimH > 0) {
    const m: { a: number; b: number; c: number; d: number; tx: number; ty: number } = {
      a: destW / state.mask.trimW,
      b: 0,
      c: 0,
      d: destH / state.mask.trimH,
      tx: 0,
      ty: 0,
    }
    maskInitial = transformPolygonSet(state.mask.polygon, m)
  } else {
    maskInitial = [
      [
        { x: 0, y: 0 },
        { x: destW, y: 0 },
        { x: destW, y: destH },
        { x: 0, y: destH },
      ],
    ]
  }

  maskInitial = decimatePolygonSet(maskInitial, STL_POLYGON_MAX_VERTS)

  const classified = classifyPolygonLoops(maskInitial)
  const outerInitial =
    classified.outers.length > 0 ? classified.outers : maskInitial
  const holeInitial = classified.holes

  // 2. Silhouette = outer loops offset by borderXY so hole interiors stay inside
  // the expanded outline and can be filled with border material.
  let silhouetteRaw =
    borderXY > 0
      ? offsetPolygonSet(outerInitial, borderXY, {
          maxGrid: 2048,
          smoothIters: 4,
          cellSize: Math.max(borderXY / 12, 1e-6),
        })
      : outerInitial
  if (silhouetteRaw.length === 0) silhouetteRaw = outerInitial
  silhouetteRaw = decimatePolygonSet(silhouetteRaw, STL_POLYGON_MAX_VERTS)

  // 3. Shift both polygons so silhouette top-left lands at (0, 0).
  const sBounds = polygonBounds(silhouetteRaw)
  const shiftX = -sBounds.minX
  const shiftY = -sBounds.minY
  const maskPolygonMm = shiftPolygonSet(maskInitial, shiftX, shiftY)
  const silhouettePolygonMm = shiftPolygonSet(silhouetteRaw, shiftX, shiftY)
  const outerPolygonMm = shiftPolygonSet(outerInitial, shiftX, shiftY)
  const holePolygonMm = shiftPolygonSet(holeInitial, shiftX, shiftY)
  const compositeWidthMm = Math.max(0.001, sBounds.maxX - sBounds.minX)
  const compositeHeightMm = Math.max(0.001, sBounds.maxY - sBounds.minY)

  // 4. Allocate canvas at the texture grid resolution (the finest grid used).
  const pxPerMm = 1 / Math.max(0.01, state.export.pixelSizeMm)
  const W = Math.max(1, Math.round(compositeWidthMm * pxPerMm))
  const H = Math.max(1, Math.round(compositeHeightMm * pxPerMm))
  const composite = document.createElement('canvas')
  composite.width = W
  composite.height = H
  const ctx = composite.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 5. Switch ctx into mm space.
  ctx.setTransform(W / compositeWidthMm, 0, 0, H / compositeHeightMm, 0, 0)

  // 6. Photo only — clip to mask; border ring is composited later at fine vector resolution.
  ctx.save()
  const maskPath = polygonSetToPath2D(maskPolygonMm)
  ctx.clip(maskPath, 'evenodd')

  const photoSrcToEditor = layerEditorAffine(
    state.photo,
    state.photo.img.width,
    state.photo.img.height,
  )
  let photoSrcToMm: Affine
  if (state.mask.loaded && state.mask.trimW > 0 && state.mask.trimH > 0) {
    const maskSrcToEditor = layerEditorAffine(state.mask, state.mask.trimW, state.mask.trimH)
    const editorToMaskSrc = invertAffine(maskSrcToEditor)
    const maskSrcToMm: Affine = {
      a: destW / state.mask.trimW,
      b: 0,
      c: 0,
      d: destH / state.mask.trimH,
      tx: shiftX,
      ty: shiftY,
    }
    photoSrcToMm = multiplyAffine(multiplyAffine(maskSrcToMm, editorToMaskSrc), photoSrcToEditor)
  } else {
    // Mask-less: stretch photo to fill the silhouette.
    photoSrcToMm = {
      a: destW / state.photo.img.width,
      b: 0,
      c: 0,
      d: destH / state.photo.img.height,
      tx: shiftX,
      ty: shiftY,
    }
  }

  ctx.transform(
    photoSrcToMm.a,
    photoSrcToMm.b,
    photoSrcToMm.c,
    photoSrcToMm.d,
    photoSrcToMm.tx,
    photoSrcToMm.ty,
  )
  ctx.drawImage(state.photo.img, 0, 0)
  ctx.restore()

  let maskGray: HTMLCanvasElement | null = null
  if (state.mask.loaded && state.mask.gray && state.mask.trimW > 0 && state.mask.trimH > 0) {
    maskGray = document.createElement('canvas')
    maskGray.width = W
    maskGray.height = H
    const gctx = maskGray.getContext('2d')
    if (gctx) {
      gctx.imageSmoothingEnabled = true
      gctx.setTransform(W / compositeWidthMm, 0, 0, H / compositeHeightMm, 0, 0)
      gctx.save()
      gctx.clip(polygonSetToPath2D(maskPolygonMm), 'evenodd')
      const maskSrcToMm: Affine = {
        a: destW / state.mask.trimW,
        b: 0,
        c: 0,
        d: destH / state.mask.trimH,
        tx: shiftX,
        ty: shiftY,
      }
      gctx.transform(
        maskSrcToMm.a,
        maskSrcToMm.b,
        maskSrcToMm.c,
        maskSrcToMm.d,
        maskSrcToMm.tx,
        maskSrcToMm.ty,
      )
      gctx.drawImage(imageDataToCanvas(state.mask.gray), 0, 0)
      gctx.restore()
    }
  }

  return {
    composite,
    widthMm: compositeWidthMm,
    heightMm: compositeHeightMm,
    maskPolygonMm,
    silhouettePolygonMm,
    outerPolygonMm,
    holePolygonMm,
    maskGray,
  }
}

function mapPreviewProgress(p: PreviewProgressEvent): void {
  if (p.phase === 'quantize') {
    const t = p.total > 0 ? p.current / p.total : 0
    const pct = 20 + Math.round(t * 60)
    ui.update(pct, 'Quantizing colors…', `Row ${p.current} / ${p.total}`)
    return
  }
  if (p.phase === 'color-stencil') {
    ui.update(82, 'Clipping color to mask…', '')
    return
  }
  if (p.phase === 'texture') {
    ui.update(88, 'Building texture…', '')
    return
  }
  if (p.phase === 'border') {
    ui.update(93, 'Compositing border…', '')
  }
}

function mapExportStlProgress(p: StlProgress): void {
  if (p.phase === 'plate') {
    ui.update(36, 'Building plate…', '')
    return
  }
  if (p.phase === 'border') {
    ui.update(40, 'Building border…', '')
    return
  }
  if (p.phase === 'color') {
    const t = p.total > 0 ? p.current / p.total : 0
    const pct = 42 + Math.round(t * 36)
    ui.update(Math.min(77, pct), 'Building color layers…', `${p.current} / ${p.total}`)
    return
  }
  if (p.phase === 'texture') {
    const t = p.total > 0 ? p.current / p.total : 0
    const pct = 78 + Math.round(t * 12)
    ui.update(pct, 'Building texture…', `Row ${p.current} / ${p.total}`)
    return
  }
  if (p.phase === 'zip') {
    const t = p.total > 0 ? p.current / p.total : 0
    const pct = 90 + Math.round(t * 9)
    ui.update(pct, 'Compressing ZIP…', `${Math.round(t * 100)}%`)
  }
}

async function generateLayers(opts?: { saveToLibrary?: boolean }): Promise<void> {
  if (!state.photo.loaded) {
    void window.alert('Please upload a Photo first.')
    return
  }
  syncExportSettingsFromInputs()

  ui.show()
  ui.update(5, 'Building composite…', '')
  invalidatePreviews()

  // Defer to the next frame so the spinner can render before heavy work runs.
  await new Promise((r) => requestAnimationFrame(r))

  const scene = buildRectifiedScene()
  if (!scene) {
    ui.hide()
    void window.alert('Could not build composite. Check the photo/mask.')
    return
  }

  const gen = buildGenInstructionFromState()
  gen.destImageWidth = scene.widthMm
  gen.destImageHeight = scene.heightMm
  if (gen.destImageWidth <= 0 || gen.destImageHeight <= 0) {
    ui.hide()
    void window.alert('No visible content on the canvas.')
    return
  }

  ui.update(10, 'Building color combinations…', '')
  await new Promise((r) => requestAnimationFrame(r))
  let palette: Palette
  try {
    palette = new Palette(JSON.stringify(currentPaletteJson), gen)
    if (
      gen.pixelCreationMethod === PixelCreationMethod.FULL &&
      gen.colorNumber !== 0
    ) {
      palette.restrictFullColors(scene.composite, gen.colorNumber)
    }
  } catch (e) {
    ui.hide()
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
    return
  }

  ui.update(20, 'Quantizing colors…', '')
  let both: Awaited<ReturnType<typeof buildPreviewAndStlImages>>
  try {
    both = await buildPreviewAndStlImages(
      scene.composite,
      {
        maskPolygonMm: scene.maskPolygonMm,
        silhouettePolygonMm: scene.silhouettePolygonMm,
        outerPolygonMm: scene.outerPolygonMm,
        holePolygonMm: scene.holePolygonMm,
      },
      palette,
      gen,
      mapPreviewProgress,
      scene.maskGray,
    )
  } catch (e) {
    ui.hide()
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
    return
  }

  renderImageDataToCanvas('colorPreviewCanvas', both.preview.colorImage)
  renderImageDataToCanvas('texturePreviewCanvas', both.preview.textureImage)

  let previewColorPng: Blob | null = null
  let previewTexturePng: Blob | null = null
  try {
    previewColorPng = both.preview.colorImage
      ? await imageDataToPngBlob(both.preview.colorImage)
      : null
    previewTexturePng = both.preview.textureImage
      ? await imageDataToPngBlob(both.preview.textureImage)
      : null
  } catch (e) {
    ui.hide()
    invalidatePreviews()
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
    return
  }

  state.pixelData = {
    rectifiedComposite: scene.composite,
    widthMm: scene.widthMm,
    heightMm: scene.heightMm,
    maskPolygonMm: scene.maskPolygonMm,
    silhouettePolygonMm: scene.silhouettePolygonMm,
    outerPolygonMm: scene.outerPolygonMm,
    holePolygonMm: scene.holePolygonMm,
    stlColorImage: both.stl.colorImage,
    stlTextureImage: both.stl.textureImage,
    stlMaskRelief: both.stl.maskReliefImage,
    previewColorPng,
    previewTexturePng,
  }
  setExportButtonsEnabled(true)

  ui.update(100, 'Done', '')
  ui.hide()

  if (opts?.saveToLibrary !== false) {
    void saveCurrentToLibrary()
  }
}

function syncExportSettingsFromInputs(): void {
  state.export.border = readInputFloat('inpBorderWidth', state.export.border)
  state.export.borderHeightMm = readInputFloat(
    'inpBorderHeight',
    DEFAULT_VALUE_BORDER_HEIGHT_MM,
  )
  state.export.borderOverlapMm = readInputFloat(
    'inpBorderOverlap',
    DEFAULT_VALUE_BORDER_OVERLAP_MM,
  )
  const maxOverlap = Math.max(0, state.export.border - 0.01)
  state.export.borderOverlapMm = Math.min(
    Math.max(0, state.export.borderOverlapMm),
    maxOverlap,
  )
  const overlapEl = $('inpBorderOverlap') as HTMLInputElement | null
  if (overlapEl) overlapEl.value = String(state.export.borderOverlapMm)
  state.export.pixelSizeMm = readInputFloat('inpPixelSize', state.export.pixelSizeMm)
}

function onBorderWidthChange(): void {
  syncExportSettingsFromInputs()
  updateExportGridReadout()
  invalidatePreviews()
}

function onBorderHeightChange(): void {
  syncExportSettingsFromInputs()
}

function onBorderOverlapChange(): void {
  syncExportSettingsFromInputs()
  updateExportGridReadout()
  invalidatePreviews()
}

function onPixelSizeChange(): void {
  syncExportSettingsFromInputs()
  updateExportGridReadout()
  invalidatePreviews()
}

function onPreviewSettingsChange(): void {
  invalidatePreviews()
}

function readInputFloat(id: string, fallback: number): number {
  const el = $(id) as HTMLInputElement | null
  if (!el) return fallback
  const v = parseFloat(el.value)
  return Number.isFinite(v) ? v : fallback
}

function readInputInt(id: string, fallback: number): number {
  const el = $(id) as HTMLInputElement | null
  if (!el) return fallback
  const v = parseInt(el.value, 10)
  return Number.isFinite(v) ? v : fallback
}

function buildGenInstructionFromState(): GenInstruction {
  syncExportSettingsFromInputs()
  const g = createDefaultGenInstruction()
  const ps = state.export.pixelSizeMm
  g.destImageWidth = state.export.width
  g.destImageHeight = state.export.height
  g.texturePixelWidth = ps

  g.plateThickness = readInputFloat('inpPlateThickness', DEFAULT_VALUE_PLATE_THICKNESS)
  g.colorPixelWidth = readInputFloat('inpColorPixelWidth', DEFAULT_VALUE_COLOR_PIXEL_WIDTH)
  g.colorPixelLayerThickness = readInputFloat(
    'inpLayerThickness',
    DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
  )
  g.colorPixelLayerNumber = readInputInt('inpLayerCount', DEFAULT_VALUE_COLOR_LAYER_NUMBER)
  g.colorNumber = Math.max(0, readInputInt('inpMaxColors', 0))
  g.borderHeightMm = state.export.borderHeightMm
  g.borderOverlapMm = state.export.borderOverlapMm
  g.textureMinThickness = readInputFloat('inpMinThickness', DEFAULT_VALUE_TEXTURE_MIN_THICKNESS)
  g.textureMaxThickness = readInputFloat('inpMaxThickness', DEFAULT_VALUE_TEXTURE_MAX_THICKNESS)
  g.maskMaxThickness = readInputFloat('inpMaskMaxThickness', DEFAULT_VALUE_MASK_MAX_THICKNESS)

  const modeSel = $('selPixelMode') as HTMLSelectElement | null
  g.pixelCreationMethod =
    modeSel?.value === PixelCreationMethod.FULL
      ? PixelCreationMethod.FULL
      : PixelCreationMethod.ADDITIVE

  const distSel = $('selColorDistance') as HTMLSelectElement | null
  g.colorDistanceComputation =
    distSel?.value === ColorDistanceComputation.RGB
      ? ColorDistanceComputation.RGB
      : ColorDistanceComputation.CIELab

  return g
}

function checkApiKey(): void {
  const isValid = /^AIza[0-9A-Za-z-_]{35}$/.test(state.apiKey)
  const aiElements = document.querySelectorAll('.ai-feature')
  aiElements.forEach((el) => {
    ;(el as HTMLElement).style.display = isValid ? 'flex' : 'none'
  })
}

function getSelectedImageModelOption(): ImageModelOption | null {
  const id = state.selectedImageModel
  if (!id) return null
  return availableImageModels.find((m) => modelIdFromName(m.name) === id) ?? null
}

function bindSettingsModels(): void {
  const textSel = $('textModelSelect') as HTMLSelectElement | null
  const imageSel = $('imageModelSelect') as HTMLSelectElement | null
  const refreshBtn = $('refreshModelsBtn') as HTMLButtonElement | null

  if (textSel) {
    textSel.addEventListener('change', () => {
      setSelectedTextModelPersist(textSel.value)
    })
  }
  if (imageSel) {
    imageSel.addEventListener('change', () => {
      setSelectedImageModelPersist(imageSel.value)
    })
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const apiInput = $('apiKeyInput') as HTMLInputElement | null
      const key = (apiInput?.value.trim() || state.apiKey).trim()
      if (!key) return
      void fetchModels(key)
    })
  }
  const apiKeyInput = $('apiKeyInput') as HTMLInputElement | null
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', () => {
      updateSettingsModelUI()
    })
  }
}

function openSettings(): void {
  const overlay = $('settingsOverlay') as HTMLElement | null
  const apiInput = $('apiKeyInput') as HTMLInputElement | null
  if (overlay) overlay.style.display = 'flex'
  if (apiInput) apiInput.value = state.apiKey
  updateSettingsModelUI()
}

function closeSettings(): void {
  const overlay = $('settingsOverlay') as HTMLElement | null
  if (overlay) overlay.style.display = 'none'
}

function saveSettings(): void {
  const apiInput = $('apiKeyInput') as HTMLInputElement | null
  const key = apiInput?.value.trim() ?? ''
  try {
    localStorage.setItem(API_KEY_STORAGE, key)
  } catch {
    /* ignore */
  }
  state.apiKey = key
  closeSettings()
  checkApiKey()
  if (key && availableTextModels.length === 0 && availableImageModels.length === 0) {
    void fetchModels(key)
  }
}

function clearLayer(type: ActiveLayer): void {
  if (type === 'photo') {
    clearOutpaintSource()
    revokeLayerObjectUrl(state.photo)
    state.photo = {
      img: null,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rot: 0,
      loaded: false,
      isGenerated: false,
      objectUrl: null,
      historyId: null,
    }
    const photoInput = $('photoInput') as HTMLInputElement | null
    if (photoInput) photoInput.value = ''
    const dlPhoto = $('dl-photo') as HTMLElement | null
    if (dlPhoto) dlPhoto.style.display = 'none'
    syncActiveGeneratedUi('photo', false, null)
    invalidatePreviews()
  } else if (type === 'mask') {
    revokeLayerObjectUrl(state.mask)
    state.mask = {
      img: null,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rot: 0,
      loaded: false,
      aspect: 1,
      polygon: null,
      trimW: 0,
      trimH: 0,
      isGenerated: false,
      objectUrl: null,
      gray: null,
    }
    const maskInput = $('maskInput') as HTMLInputElement | null
    if (maskInput) maskInput.value = ''
    const dlMask = $('dl-mask') as HTMLElement | null
    if (dlMask) dlMask.style.display = 'none'
    syncActiveGeneratedUi('mask', false, null)
    const btnMask = $('btn-mask')
    if (btnMask) btnMask.classList.add('disabled')

    if (state.photo.loaded && state.photo.aspect) {
      selectLayer('photo')
      state.mask.aspect = state.photo.aspect
      state.mask.w = state.photo.w
      state.mask.h = state.photo.h
      state.mask.x = state.photo.x
      state.mask.y = state.photo.y
    }
    invalidatePreviews()
  }

  render()
  updateInputsFromState()
}

async function downloadGeneratedPanelAsset(): Promise<void> {
  const kind = state.aiPromptMode
  const preview =
    kind === 'photo'
      ? ($('generatedPhotoPreview') as HTMLImageElement | null)
      : ($('generatedMaskPreview') as HTMLImageElement | null)
  if (!preview?.src) return
  const slug =
    kind === 'photo' ? state.lastGeneratedPhotoName : state.lastGeneratedMaskName
  const base =
    slug && slug.length > 0
      ? slug
      : kind === 'photo'
        ? 'generated_image'
        : 'generated_mask'
  const ext = kind === 'photo' ? '.jpg' : '.png'
  try {
    const r = await fetch(preview.src)
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error(e)
  }
}

function downloadSource(type: ActiveLayer): void {
  const layer = state[type]
  const imgEl = layer.img
  if (!layer.loaded || !imgEl) return
  void (async () => {
    try {
      const slug = type === 'photo' ? state.lastGeneratedPhotoName : state.lastGeneratedMaskName
      const base =
        layer.isGenerated && slug && slug.length > 0
          ? slug
          : type === 'photo'
            ? 'generated_image'
            : 'generated_mask'
      const ext = type === 'photo' ? '.jpg' : '.png'
      const r = await fetch(imgEl.src)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    }
  })()
}

function readMaskAiKind(): 'cookiecutter' | 'stencil' {
  const checked = document.querySelector(
    'input[name="aiMaskKind"]:checked',
  ) as HTMLInputElement | null
  return checked?.value === 'stencil' ? 'stencil' : 'cookiecutter'
}

function readMaskAiGradient(): boolean {
  const el = $('aiMaskGradient') as HTMLInputElement | null
  return Boolean(el?.checked)
}

function maskTypeHelpText(kind: 'cookiecutter' | 'stencil', gradient: boolean): string {
  if (kind === 'cookiecutter' && !gradient) {
    return 'Solid fill with a hard outline. No interior holes and no grayscale.'
  }
  if (kind === 'cookiecutter' && gradient) {
    return 'Solid outer shape with no holes. Grayscale texture is allowed inside the fill.'
  }
  if (kind === 'stencil' && !gradient) {
    return 'Hard black-and-white stencil. Interior holes (like the counter in “A”) are allowed.'
  }
  return 'Stencil with interior holes. Grayscale texture is allowed in the filled regions; holes stay black.'
}

function syncMaskTypeHelp(): void {
  const kind = readMaskAiKind()
  const gradient = readMaskAiGradient()
  state.maskAiKind = kind
  state.maskAiGradient = gradient
  const help = $('aiMaskTypeHelp')
  if (help) help.textContent = maskTypeHelpText(kind, gradient)
}

function buildMaskAiPrompt(subject: string): string {
  const s = subject.trim()
  const kind = state.maskAiKind
  const gradient = state.maskAiGradient
  if (kind === 'cookiecutter' && !gradient) {
    return (
      `A high-contrast, polarized image mask featuring a perfectly solid, continuous white silhouette of ${s}. ` +
      `This entire silhouette is one unbroken, unblemished white shape with no internal features, holes, ` +
      `facial details, cutouts, or floating shapes inside. The outer outline is crisp and smooth. ` +
      `The entire form is seamlessly filled with solid white, set against a pure black background. ` +
      `No grayscale, no shading, no texture, no gradients. Flat vector-style cookie cutter.`
    )
  }
  if (kind === 'cookiecutter' && gradient) {
    return (
      `A high-contrast image mask of ${s}. The outer silhouette is a single solid shape with a crisp hard ` +
      `outline and NO interior holes, cutouts, or floating pieces. Background is pure black. ` +
      `Inside the filled shape, grayscale texture and gradients ARE allowed (for example a floral pattern ` +
      `in gray on the white body). Darker gray means raised relief. White means no extra relief. ` +
      `Do not punch holes with the texture. The outer edge stays hard against black.`
    )
  }
  if (kind === 'stencil' && !gradient) {
    return (
      `A high-contrast black-and-white stencil mask of ${s}. Filled regions are solid white with hard edges. ` +
      `Interior holes and counters ARE allowed (for example the triangular hole in the letter A). ` +
      `Holes and the background are pure black. No grayscale, no shading, no gradients. ` +
      `Do not add spraypaint stencil bridges, tabs, or connectors.`
    )
  }
  return (
    `A high-contrast stencil mask of ${s}. Interior holes and counters ARE allowed (for example the hole ` +
    `in the letter A) and those holes stay pure black, same as the background. Filled strokes may contain ` +
    `grayscale texture and gradients (for example a floral pattern across the letter). Darker gray means ` +
    `raised relief; white means no extra relief. Hard outer edges. ` +
    `Do not add spraypaint stencil bridges, tabs, or connectors.`
  )
}

interface OutpaintSource {
  img: HTMLImageElement
  objectUrl: string
  blob: Blob
  sourceHistoryId?: string
}

let outpaintSource: OutpaintSource | null = null

function persistOutpaintSourceBlob(blob: Blob): void {
  void saveOutpaintSourceBlob(blob).catch((err) => {
    if (!isQuotaError(err)) console.error('Failed to persist extend source:', err)
  })
}

function clearPersistedOutpaintSource(): void {
  void deleteOutpaintSourceBlob().catch((err) => {
    console.error('Failed to clear saved extend source:', err)
  })
}

function clearOutpaintSource(): void {
  if (outpaintSource?.objectUrl) URL.revokeObjectURL(outpaintSource.objectUrl)
  outpaintSource = null
  clearPersistedOutpaintSource()
  const regen = $('btnRegenerateExtend') as HTMLButtonElement | null
  if (regen) regen.disabled = true
}

function syncPhotoExtendUi(): void {
  const section = $('aiPhotoExtendSection')
  const extendBtn = $('btnExtendEdges') as HTMLButtonElement | null
  const regenBtn = $('btnRegenerateExtend') as HTMLButtonElement | null
  if (!section || !extendBtn || !regenBtn) return
  const isPhoto = state.aiPromptMode === 'photo'
  section.hidden = !isPhoto
  const hasPhoto = Boolean(state.photo.loaded && state.photo.img)
  extendBtn.disabled = !hasPhoto
  extendBtn.title = hasPhoto
    ? 'Fill in matching background around the current photo'
    : 'Load a photo first'
  regenBtn.disabled = !outpaintSource
  regenBtn.title = outpaintSource
    ? 'Try another fill around the same source photo'
    : 'Extend edges first'
  fillOutpaintPromptField()
}

async function setOutpaintSourceFromBlob(
  blob: Blob,
  sourceHistoryId?: string,
  persist = true,
): Promise<void> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const clone = await loadHtmlImage(objectUrl)
    if (outpaintSource?.objectUrl) URL.revokeObjectURL(outpaintSource.objectUrl)
    outpaintSource = { img: clone, objectUrl, blob, sourceHistoryId }
    if (persist) persistOutpaintSourceBlob(blob)
    syncPhotoExtendUi()
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

async function applyOutpaintSourceForRestoredPhoto(entry: LayerHistoryEntry): Promise<void> {
  try {
    if (entry.extendSourceBlob) {
      await setOutpaintSourceFromBlob(entry.extendSourceBlob)
      return
    }
    if (entry.isExtendSource) {
      await setOutpaintSourceFromBlob(entry.blob, entry.id)
      return
    }
    clearOutpaintSource()
  } catch (err) {
    console.error('Failed to restore extend source:', err)
    clearOutpaintSource()
  }
}

async function snapshotPhotoForOutpaint(img: HTMLImageElement): Promise<void> {
  const w = Math.max(1, img.naturalWidth || img.width)
  const h = Math.max(1, img.naturalHeight || img.height)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, 0, 0)
  const blob = await canvasToPngBlob(canvas)
  const histId = state.photo.historyId
  if (histId) {
    const entry = state.history.photo.find((h) => h.id === histId)
    if (entry) entry.isExtendSource = true
  }
  await setOutpaintSourceFromBlob(blob, histId ?? undefined)
}

function loadStoredOutpaintPrompt(): string {
  try {
    const stored = localStorage.getItem(OUTPAINT_PROMPT_STORAGE)
    if (stored && stored.trim()) return stored
  } catch {
    /* ignore */
  }
  return DEFAULT_OUTPAINT_PROMPT
}

function saveStoredOutpaintPrompt(text: string): void {
  try {
    localStorage.setItem(OUTPAINT_PROMPT_STORAGE, text)
  } catch {
    /* ignore */
  }
}

function fillOutpaintPromptField(): void {
  const el = $('aiOutpaintPrompt') as HTMLTextAreaElement | null
  if (!el) return
  if (document.activeElement === el) return
  el.value = loadStoredOutpaintPrompt()
}

function resetOutpaintPrompt(): void {
  const el = $('aiOutpaintPrompt') as HTMLTextAreaElement | null
  if (el) el.value = DEFAULT_OUTPAINT_PROMPT
  saveStoredOutpaintPrompt(DEFAULT_OUTPAINT_PROMPT)
}

function readOutpaintPrompt(): string {
  const el = $('aiOutpaintPrompt') as HTMLTextAreaElement | null
  const text = el?.value ?? loadStoredOutpaintPrompt()
  saveStoredOutpaintPrompt(text)
  return buildOutpaintPrompt(text)
}

function bindOutpaintPromptField(): void {
  const el = $('aiOutpaintPrompt') as HTMLTextAreaElement | null
  if (!el) return
  el.value = loadStoredOutpaintPrompt()
  el.addEventListener('input', () => saveStoredOutpaintPrompt(el.value))
}

async function hydratePersistedOutpaintSource(): Promise<void> {
  try {
    const blob = await loadOutpaintSourceBlob()
    if (blob) await setOutpaintSourceFromBlob(blob, undefined, false)
  } catch (err) {
    console.error('Failed to restore saved extend source:', err)
  }
}

function openAiPrompt(mode: string): void {
  const overlay = $('aiPromptOverlay') as HTMLElement | null
  const modeInput = $('aiMode') as HTMLInputElement | null
  const title = $('aiModalTitle')
  const desc = $('aiModalDesc')
  const input = $('aiPromptInput') as HTMLTextAreaElement | null
  if (!overlay || !modeInput || !input) return

  overlay.style.display = 'flex'
  modeInput.value = mode
  state.aiPromptMode = mode === 'mask' ? 'mask' : 'photo'
  input.value =
    mode === 'mask' || mode === 'photo' ? state.prompts[mode as 'photo' | 'mask'] : ''

  if (mode === 'mask') {
    if (title) title.textContent = '✨ Generate Mask Shape'
    const kindSection = $('aiMaskTypeSection')
    if (kindSection) kindSection.hidden = false
    const cookie = document.querySelector(
      'input[name="aiMaskKind"][value="cookiecutter"]',
    ) as HTMLInputElement | null
    const stencil = document.querySelector(
      'input[name="aiMaskKind"][value="stencil"]',
    ) as HTMLInputElement | null
    if (cookie) cookie.checked = state.maskAiKind !== 'stencil'
    if (stencil) stencil.checked = state.maskAiKind === 'stencil'
    const grad = $('aiMaskGradient') as HTMLInputElement | null
    if (grad) grad.checked = state.maskAiGradient
    syncMaskTypeHelp()
    if (desc)
      desc.textContent =
        'Describe the shape (e.g. "letter A with a flower pattern"). Generation type controls holes and grayscale.'
    input.placeholder = "E.g., letter A with a flower pattern"
  } else {
    const kindSection = $('aiMaskTypeSection')
    if (kindSection) kindSection.hidden = true
    if (title) title.textContent = '✨ Generate Photo'
    if (desc) desc.textContent = 'Describe the full color image you want to print.'
    input.placeholder = 'E.g., A cyberpunk city at sunset...'
  }
  syncPhotoExtendUi()
}

interface GeneratedImageResult {
  base64: string
  mime: string
}

async function requestGeneratedImage(opts: {
  prompt: string
  inlineImage?: { data: string; mime: string }
  inlineImages?: Array<{ data: string; mime: string }>
  aspectRatio?: string
}): Promise<GeneratedImageResult> {
  const imageOpt = getSelectedImageModelOption()
  if (!state.selectedImageModel || !imageOpt) {
    throw new Error(
      'No image model selected or models not loaded. Open Settings, add your API key, and tap Refresh Models.',
    )
  }

  const modelId = state.selectedImageModel
  const imageEndpoint = imageOpt.imageEndpoint

  const inlineImages =
    opts.inlineImages ?? (opts.inlineImage ? [opts.inlineImage] : [])

  if (inlineImages.length > 0 && imageEndpoint !== 'generateContent') {
    throw new Error(
      'Extend edges needs a Gemini image model (for example Nano Banana). Open Settings and pick an image model that can edit photos.',
    )
  }

  if (imageEndpoint === 'generateContent') {
    const parts: Array<Record<string, unknown>> = []
    for (const image of inlineImages) {
      parts.push({
        inlineData: { mimeType: image.mime, data: image.data },
      })
    }
    parts.push({ text: opts.prompt })

    const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] }
    if (opts.aspectRatio) {
      generationConfig.imageConfig = { aspectRatio: opts.aspectRatio }
    }

    const url = googleModelEndpointUrl(modelId, state.apiKey, 'generateContent')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig,
      }),
    })

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string }
          }>
        }
      }>
      error?: { message?: string }
    }

    if (!response.ok) throw new Error(parseApiError(data, response.statusText))
    if (data.error?.message) throw new Error(data.error.message)

    const outParts = data.candidates?.[0]?.content?.parts
    const imagePart = outParts?.find(
      (p) => p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('image/'),
    )
    const base64 = imagePart?.inlineData?.data
    if (!base64) throw new Error(parseApiError(data, 'No image returned'))
    const mt = imagePart?.inlineData?.mimeType
    return {
      base64,
      mime: mt && mt.startsWith('image/') ? mt : 'image/png',
    }
  }

  const url = googleModelEndpointUrl(modelId, state.apiKey, 'predict')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: opts.prompt }],
      parameters: { sampleCount: 1 },
    }),
  })

  const data = (await response.json()) as {
    predictions?: { bytesBase64Encoded?: string }[]
    error?: { message?: string }
  }

  if (!response.ok) throw new Error(parseApiError(data, response.statusText))
  if (data.error?.message) throw new Error(data.error.message)
  const base64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!base64) throw new Error(parseApiError(data, 'No image returned'))
  return { base64, mime: 'image/png' }
}

function applyGeneratedLayerBlob(
  blob: Blob,
  mode: ActiveLayer,
  prompt: string | null,
  nameBase64: string,
  nameMime: string,
  extra?: { extendSourceBlob?: Blob },
): void {
  const histId = addToHistory(blob, mode, {
    source: 'ai',
    extendSourceBlob: extra?.extendSourceBlob,
  })

  void (async () => {
    try {
      const key = state.apiKey.trim()
      if (!key) return
      const slug = await autoNameImage(key, nameBase64, nameMime)
      if (mode === 'photo') {
        state.lastGeneratedPhotoName = slug
        const el = $('generatedPhotoNameDisplay')
        if (el) el.textContent = `${slug}.jpg`
      } else {
        state.lastGeneratedMaskName = slug
        const el = $('generatedMaskNameDisplay')
        if (el) el.textContent = `${slug}.png`
      }
      patchHistorySuggestedSlug(mode, histId, slug)
    } catch (e) {
      console.error('Auto-naming generated asset failed:', e)
    }
  })()

  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    handleImageLoad(img, mode, prompt, true, {
      objectUrl: url,
      historyId: mode === 'photo' ? histId : undefined,
    })
    ui.hide()
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    void window.alert('Failed to decode generated image.')
    ui.hide()
  }
  img.src = url
}

async function confirmGenerateImage(): Promise<void> {
  const input = $('aiPromptInput') as HTMLTextAreaElement | null
  const modeInput = $('aiMode') as HTMLInputElement | null
  const aiOverlay = $('aiPromptOverlay') as HTMLElement | null
  const prompt = input?.value.trim() ?? ''
  const modeRaw = modeInput?.value ?? 'photo'
  const mode: ActiveLayer = modeRaw === 'mask' ? 'mask' : 'photo'

  if (!prompt) return

  state.prompts[mode] = prompt
  if (mode === 'photo') clearOutpaintSource()
  if (aiOverlay) aiOverlay.style.display = 'none'
  if (mode === 'mask') syncMaskTypeHelp()

  ui.show()
  ui.update(50, `Creating ${mode}...`, 'This may take a few seconds')

  const finalPrompt = mode === 'mask' ? buildMaskAiPrompt(prompt) : prompt

  try {
    const generated = await requestGeneratedImage({ prompt: finalPrompt })
    let blob = blobFromBase64(generated.base64, generated.mime)
    if (mode === 'mask') {
      blob = await postProcessAiMaskBlob(blob, {
        fillHoles: state.maskAiKind === 'cookiecutter',
        forceBinary: !state.maskAiGradient,
      })
    }
    applyGeneratedLayerBlob(blob, mode, prompt, generated.base64, generated.mime)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ui.update(0, 'Generation failed', msg)
    void window.alert(`AI generation failed: ${msg}`)
    ui.hide()
  }
}

async function runPhotoExtend(regenerate: boolean): Promise<void> {
  const prompt = readOutpaintPrompt()

  if (!regenerate) {
    if (!state.photo.loaded || !state.photo.img) {
      void window.alert('Load a photo first.')
      return
    }
  } else if (!outpaintSource) {
    void window.alert('Extend edges first, then regenerate for another attempt.')
    return
  }

  const imageOpt = getSelectedImageModelOption()
  if (!imageOpt || imageOpt.imageEndpoint !== 'generateContent') {
    void window.alert(
      'Extend edges needs a Gemini image model (for example Nano Banana). Open Settings and pick an image model that can edit photos.',
    )
    return
  }

  const aiOverlay = $('aiPromptOverlay') as HTMLElement | null
  if (aiOverlay) aiOverlay.style.display = 'none'

  ui.show()
  ui.update(30, regenerate ? 'Trying another extend...' : 'Extending photo...', 'Filling in the area around your image')

  try {
    if (!regenerate && state.photo.img) {
      await snapshotPhotoForOutpaint(state.photo.img)
    }
    if (!outpaintSource) throw new Error('Load a photo first.')

    const prepared = prepareOutpaintRequest(outpaintSource.img)
    ui.update(55, regenerate ? 'Trying another extend...' : 'Extending photo...', 'This may take a few seconds')
    const generated = await requestGeneratedImage({
      prompt,
      inlineImages: [{ data: prepared.pngBase64, mime: prepared.mime }],
      aspectRatio: prepared.aspectRatio,
    })

    const blob = blobFromBase64(generated.base64, generated.mime)
    applyGeneratedLayerBlob(
      blob,
      'photo',
      'extended_photo',
      generated.base64,
      generated.mime,
      { extendSourceBlob: outpaintSource.blob },
    )
    syncPhotoExtendUi()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ui.update(0, 'Extend failed', msg)
    void window.alert(`AI extend failed: ${msg}`)
    ui.hide()
  }
}

function extendPhotoEdges(): void {
  void runPhotoExtend(false)
}

function regeneratePhotoExtend(): void {
  void runPhotoExtend(true)
}

async function autoNameLithophaneFromPhoto(): Promise<void> {
  if (!state.photo.loaded || !state.photo.img) {
    void window.alert('Upload an image first!')
    return
  }

  if (!state.selectedTextModel) {
    void window.alert(
      'No text model selected. Open Settings, add your API key, and tap Refresh Models.',
    )
    return
  }

  ui.show()
  ui.update(50, 'Analyzing...', 'Gemini is looking at your photo')

  try {
    const tCvs = document.createElement('canvas')
    tCvs.width = 512
    tCvs.height = 512 * (state.photo.img.height / state.photo.img.width)
    const tCtx = tCvs.getContext('2d')
    if (!tCtx) throw new Error('Canvas unavailable')
    tCtx.drawImage(state.photo.img, 0, 0, tCvs.width, tCvs.height)
    const dataUrl = tCvs.toDataURL('image/jpeg')
    const base64Data = dataUrl.split(',')[1]
    if (!base64Data) throw new Error('Failed to encode image')

    const response = await fetch(
      googleGeminiGenerateContentUrl(state.selectedTextModel, state.apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Generate a short, concise filename (max 3 words, connected by underscores) for this image. Do not include file extension. Example: Sunset_Mountain_View',
                },
                { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
              ],
            },
          ],
        }),
      },
    )

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }

    if (!response.ok) {
      const msg = parseApiError(data, response.statusText)
      ui.update(0, 'Naming failed', msg)
      void window.alert(`Naming failed: ${msg}`)
      return
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!text) {
      ui.update(0, 'Naming failed', 'No response text')
      void window.alert('Naming failed. Check API key and response.')
      return
    }

    const fileNameInput = $('fileNameInput') as HTMLInputElement | null
    if (fileNameInput) {
      fileNameInput.value = text.replace(/[^a-zA-Z0-9_]/g, '')
    }
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    ui.update(0, 'Error', msg)
    void window.alert('Naming failed. Check API Key.')
  } finally {
    ui.hide()
  }
}

function lithophaneName(): string {
  const el = $('fileNameInput') as HTMLInputElement | null
  return el?.value.trim() || 'MyLithophane'
}

function poseOf(layer: { x: number; y: number; w: number; h: number; rot: number }): LayerPoseSnapshot {
  return { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rot: layer.rot }
}

async function blobFromLayerImg(img: HTMLImageElement): Promise<Blob> {
  const r = await fetch(img.src)
  if (!r.ok) throw new Error('Could not read image data.')
  return r.blob()
}

function setInputValue(id: string, value: string | number): void {
  const el = $(id) as HTMLInputElement | HTMLSelectElement | null
  if (el) el.value = String(value)
}

async function collectPackInput(): Promise<PackProjectInput> {
  syncExportSettingsFromInputs()
  let photo: PackProjectInput['photo'] = null
  if (state.photo.loaded && state.photo.img) {
    photo = { blob: await blobFromLayerImg(state.photo.img), pose: poseOf(state.photo) }
  }
  let mask: PackProjectInput['mask'] = null
  if (state.mask.loaded && state.mask.img) {
    mask = { blob: await blobFromLayerImg(state.mask.img), pose: poseOf(state.mask) }
  }
  const modeSel = $('selPixelMode') as HTMLSelectElement | null
  const distSel = $('selColorDistance') as HTMLSelectElement | null
  return {
    name: lithophaneName(),
    unit: state.unit,
    export: {
      width: state.export.width,
      height: state.export.height,
      border: state.export.border,
      pixelSizeMm: state.export.pixelSizeMm,
      borderHeightMm: state.export.borderHeightMm,
      borderOverlapMm: state.export.borderOverlapMm,
    },
    generation: {
      plateThickness: readInputFloat('inpPlateThickness', DEFAULT_VALUE_PLATE_THICKNESS),
      colorPixelWidth: readInputFloat('inpColorPixelWidth', DEFAULT_VALUE_COLOR_PIXEL_WIDTH),
      layerThickness: readInputFloat(
        'inpLayerThickness',
        DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
      ),
      layerCount: readInputInt('inpLayerCount', DEFAULT_VALUE_COLOR_LAYER_NUMBER),
      pixelMode: modeSel?.value ?? PixelCreationMethod.ADDITIVE,
      colorDistance: distSel?.value ?? ColorDistanceComputation.CIELab,
      maxColors: Math.max(0, readInputInt('inpMaxColors', 0)),
      minThickness: readInputFloat('inpMinThickness', DEFAULT_VALUE_TEXTURE_MIN_THICKNESS),
      maxThickness: readInputFloat('inpMaxThickness', DEFAULT_VALUE_TEXTURE_MAX_THICKNESS),
      maskMaxThickness: readInputFloat('inpMaskMaxThickness', DEFAULT_VALUE_MASK_MAX_THICKNESS),
    },
    palette: currentPaletteJson,
    photo,
    mask,
  }
}

async function packCurrentProject(): Promise<Blob> {
  return packProjectZip(await collectPackInput())
}

function loadBlobAsLayer(
  blob: Blob,
  type: ActiveLayer,
  pose: LayerPose | undefined,
  isGenerated: boolean,
): Promise<void> {
  beginProgress()
  return decodeImportedImage(blob, type, undefined, reportImportProgress)
    .then((decoded) => {
      handleImageLoad(decoded.img, type, null, isGenerated, {
        pose,
        resetExportDims: false,
        objectUrl: decoded.objectUrl,
      })
    })
    .finally(() => {
      endProgress()
    })
}

async function applyUnpackedProject(unpacked: UnpackedProject): Promise<void> {
  clearOutpaintSource()
  clearLayer('photo')
  clearLayer('mask')
  const json = unpacked.json

  const nameEl = $('fileNameInput') as HTMLInputElement | null
  if (nameEl) nameEl.value = json.name || 'MyLithophane'

  state.unit = json.unit === 'in' ? 'in' : 'mm'
  const unitSelect = $('unitSelect') as HTMLSelectElement | null
  if (unitSelect) unitSelect.value = state.unit

  if (json.export) {
    state.export.width = json.export.width
    state.export.height = json.export.height
    state.export.border = json.export.border
    state.export.pixelSizeMm = json.export.pixelSizeMm
    state.export.borderHeightMm = json.export.borderHeightMm
    state.export.borderOverlapMm = json.export.borderOverlapMm
    setInputValue('inpBorderWidth', state.export.border)
    setInputValue('inpBorderHeight', state.export.borderHeightMm)
    setInputValue('inpBorderOverlap', state.export.borderOverlapMm)
    setInputValue('inpPixelSize', state.export.pixelSizeMm)
  }

  const g = json.generation
  if (g) {
    setInputValue('inpPlateThickness', g.plateThickness)
    setInputValue('inpColorPixelWidth', g.colorPixelWidth)
    setInputValue('inpLayerThickness', g.layerThickness)
    setInputValue('inpLayerCount', g.layerCount)
    setInputValue('inpMaxColors', g.maxColors)
    setInputValue('inpMinThickness', g.minThickness)
    setInputValue('inpMaxThickness', g.maxThickness)
    if (g.maskMaxThickness != null) {
      setInputValue('inpMaskMaxThickness', g.maskMaxThickness)
    }
    const modeSel = $('selPixelMode') as HTMLSelectElement | null
    if (modeSel && g.pixelMode) modeSel.value = g.pixelMode
    const distSel = $('selColorDistance') as HTMLSelectElement | null
    if (distSel && g.colorDistance) distSel.value = g.colorDistance
  }

  if (json.palette && typeof json.palette === 'object') {
    currentPaletteJson = json.palette
    savePalette(currentPaletteJson)
    refreshInlinePalette()
  }

  updateInputsFromState()
  updateExportGridReadout()

  if (unpacked.photoBlob) {
    await loadBlobAsLayer(unpacked.photoBlob, 'photo', json.photo?.pose, false)
  }
  if (unpacked.maskBlob) {
    await loadBlobAsLayer(unpacked.maskBlob, 'mask', json.mask?.pose, false)
  }

  if (json.export) {
    state.export.width = json.export.width
    state.export.height = json.export.height
    updateInputsFromState()
    updateExportGridReadout()
  }

  invalidatePreviews()
  render()
}

async function exportProject(): Promise<void> {
  try {
    const blob = await packCurrentProject()
    downloadBlob(blob, `${safeFileName(lithophaneName())}.litholab`)
  } catch (e) {
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
  }
}

function triggerProjectImport(): void {
  $('projectImportInput')?.click()
}

async function importProjectFile(file: File): Promise<void> {
  beginProgress()
  try {
    ui.update(40, 'Opening project…', '')
    await yieldForPaint()
    const unpacked = await unpackProjectZip(file)
    await applyUnpackedProject(unpacked)
    ui.update(100, 'Done', '')
  } catch (e) {
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
  } finally {
    endProgress()
  }
}

function renderDefaultMasks(): void {
  const container = $('maskPresets')
  if (!container) return
  container.replaceChildren()
  for (const mask of DEFAULT_MASKS) {
    const thumb = document.createElement('img')
    thumb.src = defaultMaskUrl(mask.filename)
    thumb.className = 'history-thumb'
    thumb.title = mask.name
    thumb.alt = mask.name
    thumb.addEventListener('click', () => void loadPresetMask(mask.filename))
    thumb.addEventListener('load', () => refreshStripArrows(container))
    container.appendChild(thumb)
  }
  refreshStripArrows(container)
}

function loadPresetMask(filename: string): void {
  const url = defaultMaskUrl(filename)
  void (async () => {
    beginProgress()
    try {
      ui.update(8, 'Loading preset mask…', filename)
      await yieldForPaint()
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Could not load preset mask (${filename}).`)
      const blob = await res.blob()
      const decoded = await decodeImportedImage(blob, 'mask', filename, reportImportProgress)
      handleImageLoad(decoded.img, 'mask', null, false, { objectUrl: decoded.objectUrl })
    } catch (e) {
      console.error(e)
      void window.alert(e instanceof Error ? e.message : `Could not load preset mask (${filename}).`)
    } finally {
      endProgress()
    }
  })()
}

let libraryThumbUrls: string[] = []

function openLibrary(): void {
  const overlay = $('libraryOverlay')
  if (overlay) overlay.style.display = 'flex'
  void refreshLibraryGrid()
}

function closeLibrary(): void {
  const overlay = $('libraryOverlay')
  if (overlay) overlay.style.display = 'none'
}

async function refreshLibraryGrid(): Promise<void> {
  const grid = $('libraryGrid')
  const empty = $('libraryEmpty')
  if (!grid || !empty) return
  for (const u of libraryThumbUrls) URL.revokeObjectURL(u)
  libraryThumbUrls = []
  grid.replaceChildren()

  let items
  try {
    items = await listLibrary()
  } catch (e) {
    console.error(e)
    empty.textContent = 'Could not read the library.'
    empty.classList.add('visible')
    return
  }

  if (items.length === 0) {
    empty.textContent = 'Generate previews to save a lithophane here.'
    empty.classList.add('visible')
    return
  }
  empty.classList.remove('visible')

  for (const item of items) {
    const card = document.createElement('div')
    card.className = 'library-card'
    const img = document.createElement('img')
    const thumbUrl = URL.createObjectURL(item.thumbnail)
    libraryThumbUrls.push(thumbUrl)
    img.src = thumbUrl
    img.alt = item.name
    const name = document.createElement('p')
    name.className = 'library-card-name'
    name.textContent = item.name
    const date = document.createElement('p')
    date.className = 'library-card-date'
    date.textContent = new Date(item.createdAt).toLocaleString()
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'library-card-del'
    del.title = 'Delete'
    del.textContent = '×'
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      void (async () => {
        try {
          await deleteLibraryEntry(item.id)
          await refreshLibraryGrid()
        } catch (err) {
          console.error(err)
          void window.alert('Could not delete that library entry.')
        }
      })()
    })
    card.addEventListener('click', () => void restoreLibraryEntry(item.id))
    card.append(img, name, date, del)
    grid.appendChild(card)
  }
}

async function restoreLibraryEntry(id: string): Promise<void> {
  beginProgress()
  try {
    ui.update(40, 'Restoring…', '')
    await yieldForPaint()
    const zip = await getLibraryZip(id)
    if (!zip) throw new Error('Library entry not found.')
    const unpacked = await unpackProjectZip(zip)
    await applyUnpackedProject(unpacked)
    closeLibrary()
  } catch (e) {
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
  } finally {
    endProgress()
  }
}

async function saveCurrentToLibrary(): Promise<void> {
  if (!state.pixelData) return
  try {
    const litholabZip = await packCurrentProject()
    const thumbnail = await downscaleCanvasToJpeg(state.pixelData.rectifiedComposite)
    await addLibraryEntry({
      name: lithophaneName(),
      createdAt: Date.now(),
      thumbnail,
      litholabZip,
    })
  } catch (e) {
    console.error(e)
    if (isQuotaError(e)) {
      void window.alert(
        'Could not save this lithophane to the Library (browser storage is full). Export the project file as a backup, or delete older library entries.',
      )
    } else {
      void window.alert(
        `Could not save to Library: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}

async function exportDownload(): Promise<void> {
  if (!state.pixelData) {
    void window.alert('Generate previews first.')
    return
  }
  ui.show()
  ui.update(5, 'Preparing…', '')
  try {
    const gen = buildGenInstructionFromState()
    gen.destImageWidth = state.pixelData.widthMm
    gen.destImageHeight = state.pixelData.heightMm
    ui.update(12, 'Packing project…', '')
    const base = safeFileName(lithophaneName())
    const extraFiles: Record<string, Blob> = {}
    extraFiles[`${base}.litholab`] = await packCurrentProject()
    if (state.photo.loaded && state.photo.img) {
      const photoBlob = await blobFromLayerImg(state.photo.img)
      extraFiles[`originals/original-photo.${extForImageBlob(photoBlob)}`] = photoBlob
    }
    if (state.mask.loaded && state.mask.img) {
      const maskBlob = await blobFromLayerImg(state.mask.img)
      extraFiles[`originals/original-mask.${extForImageBlob(maskBlob)}`] = maskBlob
    }
    extraFiles['originals/original-masked.png'] = await canvasToPngBlob(
      state.pixelData.rectifiedComposite,
    )

    // #region agent log
    {
      const extraSizes: Record<string, number> = {}
      for (const [name, blob] of Object.entries(extraFiles)) extraSizes[name] = blob.size
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
      fetch('http://127.0.0.1:7504/ingest/af4d1295-d9ac-45c3-99c1-28f04c301803',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ffb977'},body:JSON.stringify({sessionId:'ffb977',runId:'post-fix',hypothesisId:'H5',location:'main.ts:exportDownload:beforeMeshes',message:'export extras packed; starting mesh build',data:{widthMm:state.pixelData.widthMm,heightMm:state.pixelData.heightMm,colorW:state.pixelData.stlColorImage?.width??null,colorH:state.pixelData.stlColorImage?.height??null,texW:state.pixelData.stlTextureImage?.width??null,texH:state.pixelData.stlTextureImage?.height??null,pixelSizeMm:state.export.pixelSizeMm,colorPixelWidth:gen.colorPixelWidth,texturePixelWidth:gen.texturePixelWidth,extraSizes,extraTotal:Object.values(extraSizes).reduce((a,b)=>a+b,0),heapUsed:mem?.usedJSHeapSize??null,heapLimit:mem?.jsHeapSizeLimit??null},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion

    ui.update(35, 'Building meshes…', '')
    const paletteJson = JSON.stringify(currentPaletteJson)
    const palette = new Palette(paletteJson, gen)
    if (
      gen.pixelCreationMethod === PixelCreationMethod.FULL &&
      gen.colorNumber !== 0
    ) {
      palette.restrictFullColors(state.pixelData.rectifiedComposite, gen.colorNumber)
    }
    const zipBlob = await buildStlZip({
      colorImage: state.pixelData.stlColorImage
        ? flipImage(state.pixelData.stlColorImage)
        : null,
      texturedImage: state.pixelData.stlTextureImage
        ? flipImage(state.pixelData.stlTextureImage)
        : null,
      palette,
      paletteJson,
      genInstruction: gen,
      polygons: {
        maskPolygonMm: state.pixelData.maskPolygonMm,
        silhouettePolygonMm: state.pixelData.silhouettePolygonMm,
        outerPolygonMm: state.pixelData.outerPolygonMm,
        holePolygonMm: state.pixelData.holePolygonMm,
      },
      extraFiles,
      previewColorPng: state.pixelData.previewColorPng,
      previewTexturePng: state.pixelData.previewTexturePng,
      maskReliefImage: state.pixelData.stlMaskRelief
        ? flipImage(state.pixelData.stlMaskRelief)
        : null,
      onProgress: mapExportStlProgress,
    })
    downloadBlob(zipBlob, `${base}.zip`)
    ui.update(100, 'Done', '')
  } catch (e) {
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
  } finally {
    ui.hide()
  }
}

function attachCanvasInteraction(): void {
  const cvs = requireCanvas()
  const c = requireCtx()

  // Map a pointer position to canvas bitmap coordinates. The canvas keeps its
  // 800x600 bitmap but may be CSS-scaled to fit the viewport, so scale by the
  // bitmap/display ratio (exactly 1 when displayed at native size).
  const toCanvas = (e: PointerEvent): { x: number; y: number } => {
    const rect = cvs.getBoundingClientRect()
    const sx = rect.width > 0 ? cvs.width / rect.width : 1
    const sy = rect.height > 0 ? cvs.height / rect.height : 1
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  cvs.addEventListener('pointerdown', (e) => {
    const m = toCanvas(e)

    if (state.activeLayer === 'mask' && !state.mask.loaded) return
    if (state.activeLayer === 'photo' && !state.photo.loaded) return

    const hit = getHitHandle(state[state.activeLayer], m.x, m.y)
    if (hit) {
      e.preventDefault()
      try {
        cvs.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported; drag still works while the pointer stays on the canvas */
      }
      state.isDragging = true
      state.dragAction = hit
      state.dragStart = m
      const layer = state[state.activeLayer]
      dragInitial = { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rot: layer.rot }
    }
  })

  const endDrag = (): void => {
    const wasDragging = state.isDragging
    const init = dragInitial
    const layer = state[state.activeLayer]
    state.isDragging = false
    state.dragAction = null
    dragInitial = null
    if (
      wasDragging &&
      init &&
      (layer.x !== init.x ||
        layer.y !== init.y ||
        layer.w !== init.w ||
        layer.h !== init.h ||
        layer.rot !== init.rot)
    ) {
      invalidatePreviews()
    }
  }
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)

  cvs.addEventListener('pointermove', (e) => {
    if (!state.isDragging || !state.dragAction || !dragInitial) return
    const m = toCanvas(e)
    const layer = state[state.activeLayer]
    const start = state.dragStart
    const init = dragInitial

    if (state.dragAction === 'move') {
      layer.x = init.x + (m.x - start.x)
      layer.y = init.y + (m.y - start.y)
    } else if (state.dragAction === 'rotate') {
      const cx = layer.x + layer.w / 2
      const cy = layer.y + layer.h / 2
      const angle = Math.atan2(m.y - cy, m.x - cx)
      layer.rot = angle + Math.PI / 2
    } else {
      const cx = init.x + init.w / 2
      const cy = init.y + init.h / 2

      if (['tl', 'tr', 'bl', 'br'].includes(state.dragAction)) {
        // Proportional scaling (Corners)
        const distStart = Math.hypot(start.x - cx, start.y - cy)
        const distNow = Math.hypot(m.x - cx, m.y - cy)
        const ratio = distStart > 0 ? distNow / distStart : 1
        layer.w = Math.max(10, init.w * ratio)
        layer.h = Math.max(10, init.h * ratio)
        layer.x = cx - layer.w / 2
        layer.y = cy - layer.h / 2
      } else if (['t', 'b', 'l', 'r'].includes(state.dragAction)) {
        // Independent axis warping (Sides)
        // Project mouse movements into the layer's local rotated coordinate space
        const dxStart = start.x - cx
        const dyStart = start.y - cy
        const locStartX = dxStart * Math.cos(-init.rot) - dyStart * Math.sin(-init.rot)
        const locStartY = dxStart * Math.sin(-init.rot) + dyStart * Math.cos(-init.rot)

        const dxNow = m.x - cx
        const dyNow = m.y - cy
        const locNowX = dxNow * Math.cos(-init.rot) - dyNow * Math.sin(-init.rot)
        const locNowY = dxNow * Math.sin(-init.rot) + dyNow * Math.cos(-init.rot)

        if (state.dragAction === 'l' || state.dragAction === 'r') {
          const ratioX = Math.abs(locStartX) > 0 ? Math.abs(locNowX / locStartX) : 1
          layer.w = Math.max(10, init.w * ratioX)
          layer.x = cx - layer.w / 2
        } else if (state.dragAction === 't' || state.dragAction === 'b') {
          const ratioY = Math.abs(locStartY) > 0 ? Math.abs(locNowY / locStartY) : 1
          layer.h = Math.max(10, init.h * ratioY)
          layer.y = cy - layer.h / 2
        }
      }
    }
    render(true, c)
  })
}

function init(): void {
  const verEl = $('appVersion')
  if (verEl) verEl.textContent = `v${__APP_VERSION__}`

  ui.bind()

  if (!editorCanvas || !ctx) {
    console.error('editorCanvas or context missing')
    return
  }

  render()
  updateInputsFromState()
  const bw = $('inpBorderWidth') as HTMLInputElement | null
  if (bw) bw.value = String(state.export.border)
  const bh = $('inpBorderHeight') as HTMLInputElement | null
  if (bh) bh.value = String(state.export.borderHeightMm)
  const bo = $('inpBorderOverlap') as HTMLInputElement | null
  if (bo) bo.value = String(state.export.borderOverlapMm)
  const ps = $('inpPixelSize') as HTMLInputElement | null
  if (ps) ps.value = String(state.export.pixelSizeMm)
  updateExportGridReadout()
  checkApiKey()

  bindSettingsModels()
  updateSettingsModelUI()
  if (state.apiKey.trim()) {
    void fetchModels(state.apiKey)
  }

  initPalette()
  try {
    localStorage.removeItem('litholab_border_profile')
  } catch {
    /* ignore */
  }
  renderDefaultMasks()
  bindAllStripScrollers()
  bindOutpaintPromptField()
  void hydratePersistedOutpaintSource()

  const photoInput = $('photoInput')
  const maskInput = $('maskInput')
  if (photoInput) photoInput.addEventListener('change', (e) => loadLayer(e, 'photo'))
  if (maskInput) maskInput.addEventListener('change', (e) => loadLayer(e, 'mask'))

  document.querySelectorAll('input[name="aiMaskKind"]').forEach((el) => {
    el.addEventListener('change', () => syncMaskTypeHelp())
  })
  const gradCb = $('aiMaskGradient')
  if (gradCb) gradCb.addEventListener('change', () => syncMaskTypeHelp())

  const projectImport = $('projectImportInput') as HTMLInputElement | null
  if (projectImport) {
    projectImport.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) void importProjectFile(file)
      input.value = ''
    })
  }

  const btnDlGenPhoto = $('btnDownloadGeneratedPhoto')
  if (btnDlGenPhoto) {
    btnDlGenPhoto.addEventListener('click', () => {
      state.aiPromptMode = 'photo'
      void downloadGeneratedPanelAsset()
    })
  }
  const btnDlGenMask = $('btnDownloadGeneratedMask')
  if (btnDlGenMask) {
    btnDlGenMask.addEventListener('click', () => {
      state.aiPromptMode = 'mask'
      void downloadGeneratedPanelAsset()
    })
  }

  attachCanvasInteraction()

  Object.assign(globalThis, {
    openSettings,
    closeSettings,
    saveSettings,
    clearLayer,
    downloadSource,
    selectLayer,
    openAiPrompt,
    confirmGenerateImage,
    syncMaskTypeHelp,
    updateDims,
    updateUnitDisplay,
    onBorderWidthChange,
    onBorderHeightChange,
    onBorderOverlapChange,
    onPixelSizeChange,
    onPreviewSettingsChange,
    generateLayers,
    exportDownload,
    exportProject,
    triggerProjectImport,
    openLibrary,
    closeLibrary,
    autoNameLithophaneFromPhoto,
    openPaletteManager,
    closePaletteManager,
    showPaletteMainView,
    showPalettePickerView,
    showPaletteCustomView,
    triggerPaletteImport,
    exportPaletteFile,
    resetPaletteToDefault,
    saveCustomColor,
    togglePaletteEntry,
    addColorFromPicker,
    extendPhotoEdges,
    regeneratePhotoExtend,
    resetOutpaintPrompt,
  })
}

init()
