import './style.css'
import {
  ColorDistanceComputation,
  createDefaultGenInstruction,
  DEFAULT_VALUE_BORDER_HEIGHT_MM,
  DEFAULT_VALUE_COLOR_LAYER_NUMBER,
  DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
  DEFAULT_VALUE_COLOR_PIXEL_WIDTH,
  DEFAULT_VALUE_PLATE_THICKNESS,
  PixelCreationMethod,
  type GenInstruction,
} from './genInstruction'
import { buildPreviewImages, generatePlateZip } from './generator/plateGenerator'
import { Palette } from './palette/palette'
import {
  extractMaskPolygons,
  offsetPolygonSet,
  polygonBounds,
  polygonSetToPath2D,
  transformPolygonSet,
  type PolygonSet,
} from './util/maskPolygon'
import defaultPalette from '../palette/CMYK-0.10mm.json' with { type: 'json' }
import {
  addColorFromPicker,
  closePaletteManager,
  exportPaletteFile,
  initPaletteManager,
  loadStoredPalette,
  openPaletteManager,
  resetPaletteToDefault,
  saveCustomColor,
  showPaletteCustomView,
  showPaletteMainView,
  showPalettePickerView,
  togglePaletteEntry,
  triggerPaletteImport,
  type PaletteJson,
} from './palette/paletteManager'

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
    onChange: refreshInlinePalette,
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
}

interface LayerHistoryEntry {
  src: string
  suggestedSlug: string | null
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
  }
  photo: PhotoLayer
  mask: MaskLayer
  pixelData: GeneratedPreviewData | null
  prompts: { photo: string; mask: string }
  history: { photo: LayerHistoryEntry[]; mask: LayerHistoryEntry[] }
  lastGeneratedPhotoName: string | null
  lastGeneratedMaskName: string | null
  aiPromptMode: 'photo' | 'mask'
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
  },
  pixelData: null,
  prompts: { photo: '', mask: '' },
  history: { photo: [], mask: [] },
  lastGeneratedPhotoName: null,
  lastGeneratedMaskName: null,
  aiPromptMode: 'photo',
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
}

/**
 * Extract a smooth vector polygon from the source mask image.
 * The polygon is luminance-thresholded marching-squares output passed through
 * Chaikin smoothing, then translated so its bounding box starts at (0, 0).
 * The returned `trimW`/`trimH` describe the polygon's bounding box in
 * source-image pixel units and serve as the mask layer's "natural" aspect.
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
    }
  }
  tCtx.drawImage(img, 0, 0)
  const id = tCtx.getImageData(0, 0, tempC.width, tempC.height)

  let polygons = extractMaskPolygons(id, { threshold: 128, smoothIters: 3, minLoopArea: 6 })

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
  const normalized: PolygonSet = polygons.map((loop) =>
    loop.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY })),
  )
  return { polygon: normalized, trimW, trimH }
}

function handleImageLoad(
  img: HTMLImageElement,
  mode: ActiveLayer,
  prompt: string | null,
  isGenerated: boolean,
): void {
  const cvs = requireCanvas()
  const c = requireCtx()

  cacheCurrentLayerState(mode)

  if (mode === 'mask') {
    const layer = state.mask
    layer.img = img
    layer.loaded = true
    layer.isGenerated = isGenerated
    const extracted = extractMaskFromImage(img)
    layer.polygon = extracted.polygon
    layer.trimW = extracted.trimW
    layer.trimH = extracted.trimH
    layer.aspect = extracted.trimW / extracted.trimH

    const key = cacheKeyFromSrc(img.src)
    const cached = state.layerCache[key]
    if (cached) {
      layer.x = cached.x
      layer.y = cached.y
      layer.w = cached.w
      layer.h = cached.h
      layer.rot = cached.rot
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

    state.export.width = 100
    state.export.height = 100 / layer.aspect
    updateInputsFromState()

    const btnMask = $('btn-mask')
    if (btnMask) btnMask.classList.remove('disabled')
    const dlMask = $('dl-mask') as HTMLElement | null
    if (dlMask) dlMask.style.display = isGenerated ? 'inline-block' : 'none'

    syncActiveGeneratedUi('mask', isGenerated, isGenerated ? img.src : null)

    selectLayer('mask')
  } else {
    const layer = state.photo
    layer.img = img
    layer.loaded = true
    layer.isGenerated = isGenerated
    layer.aspect = img.width / img.height

    const key = cacheKeyFromSrc(img.src)
    const cached = state.layerCache[key]
    if (cached) {
      layer.x = cached.x
      layer.y = cached.y
      layer.w = cached.w
      layer.h = cached.h
      layer.rot = cached.rot
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
      state.export.width = 100
      state.export.height = 100 / (layer.aspect ?? 1)
      updateInputsFromState()
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

function patchHistorySuggestedSlug(type: ActiveLayer, src: string, slug: string): void {
  const entry = state.history[type].find((h) => h.src === src)
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

function addToHistory(
  imgSrc: string,
  type: ActiveLayer,
  suggestedSlug: string | null = null,
): void {
  state.history[type].unshift({ src: imgSrc, suggestedSlug })
  if (state.history[type].length > 5) state.history[type].pop()

  const container = $(`${type}History`)
  if (!container) return
  container.replaceChildren()

  for (const entry of state.history[type]) {
    const thumb = document.createElement('img')
    thumb.src = entry.src
    thumb.className = 'history-thumb'
    thumb.addEventListener('click', () => {
      if (type === 'photo') state.lastGeneratedPhotoName = entry.suggestedSlug
      else state.lastGeneratedMaskName = entry.suggestedSlug
      const img = new Image()
      img.onload = () => handleImageLoad(img, type, 'Restored Image', true)
      img.src = entry.src
    })
    container.appendChild(thumb)
  }
}

function loadLayer(e: Event, type: ActiveLayer): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (event) => {
    const result = event.target?.result
    if (typeof result !== 'string') return
    const img = new Image()
    img.onload = () => {
      handleImageLoad(img, type, null, false)
    }
    img.src = result
  }
  reader.readAsDataURL(file)
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

  // 2. Silhouette = mask polygon offset outward by borderXY.
  let silhouetteRaw = borderXY > 0 ? offsetPolygonSet(maskInitial, borderXY) : maskInitial
  if (silhouetteRaw.length === 0) silhouetteRaw = maskInitial

  // 3. Shift both polygons so silhouette top-left lands at (0, 0).
  const sBounds = polygonBounds(silhouetteRaw)
  const shiftX = -sBounds.minX
  const shiftY = -sBounds.minY
  const maskPolygonMm = shiftPolygonSet(maskInitial, shiftX, shiftY)
  const silhouettePolygonMm = shiftPolygonSet(silhouetteRaw, shiftX, shiftY)
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

  // 6. Fill the silhouette with WHITE — this is the border ring that surrounds
  //    the photo content (the photo overdraws the interior next).
  const silhouettePath = polygonSetToPath2D(silhouettePolygonMm)
  ctx.fillStyle = '#ffffff'
  ctx.fill(silhouettePath, 'evenodd')

  // 7. Clip to the mask polygon and draw the photo at its proper mm position.
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

  return {
    composite,
    widthMm: compositeWidthMm,
    heightMm: compositeHeightMm,
    maskPolygonMm,
    silhouettePolygonMm,
  }
}

async function generateLayers(): Promise<void> {
  if (!state.photo.loaded) {
    void window.alert('Please upload a Photo first.')
    return
  }
  syncExportSettingsFromInputs()

  ui.show()
  ui.update(5, 'Building composite…', '')

  // Defer to the next frame so the spinner can render before heavy work runs.
  await new Promise((r) => requestAnimationFrame(r))

  const scene = buildRectifiedScene()
  if (!scene) {
    ui.hide()
    invalidatePreviews()
    void window.alert('Could not build composite. Check the photo/mask.')
    return
  }

  const gen = buildGenInstructionFromState()
  gen.destImageWidth = scene.widthMm
  gen.destImageHeight = scene.heightMm
  if (gen.destImageWidth <= 0 || gen.destImageHeight <= 0) {
    ui.hide()
    invalidatePreviews()
    void window.alert('No visible content on the canvas.')
    return
  }

  ui.update(25, 'Loading palette…', '')
  let palette: Palette
  try {
    palette = new Palette(JSON.stringify(currentPaletteJson), gen)
  } catch (e) {
    ui.hide()
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
    return
  }

  if (
    gen.pixelCreationMethod === PixelCreationMethod.FULL &&
    gen.colorNumber !== 0
  ) {
    palette.restrictFullColors(scene.composite, gen.colorNumber)
  }

  ui.update(45, 'Quantizing colors…', '')
  let previews: { colorImage: ImageData | null; textureImage: ImageData | null }
  try {
    previews = await buildPreviewImages(
      scene.composite,
      { maskPolygonMm: scene.maskPolygonMm, silhouettePolygonMm: scene.silhouettePolygonMm },
      palette,
      gen,
      'preview',
    )
  } catch (e) {
    ui.hide()
    console.error(e)
    void window.alert(e instanceof Error ? e.message : String(e))
    return
  }

  renderImageDataToCanvas('colorPreviewCanvas', previews.colorImage)
  renderImageDataToCanvas('texturePreviewCanvas', previews.textureImage)

  state.pixelData = {
    rectifiedComposite: scene.composite,
    widthMm: scene.widthMm,
    heightMm: scene.heightMm,
    maskPolygonMm: scene.maskPolygonMm,
    silhouettePolygonMm: scene.silhouettePolygonMm,
  }
  setExportButtonsEnabled(true)

  ui.update(100, 'Done', '')
  ui.hide()
}

function syncExportSettingsFromInputs(): void {
  state.export.border = readInputFloat('inpBorderWidth', state.export.border)
  state.export.borderHeightMm = readInputFloat(
    'inpBorderHeight',
    DEFAULT_VALUE_BORDER_HEIGHT_MM,
  )
  state.export.pixelSizeMm = readInputFloat('inpPixelSize', state.export.pixelSizeMm)
}

function onBorderWidthChange(): void {
  syncExportSettingsFromInputs()
  updateExportGridReadout()
  if (state.pixelData) void generateLayers()
}

function onBorderHeightChange(): void {
  syncExportSettingsFromInputs()
}

function onPixelSizeChange(): void {
  syncExportSettingsFromInputs()
  updateExportGridReadout()
  if (state.pixelData) void generateLayers()
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
    state.photo = {
      img: null,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rot: 0,
      loaded: false,
      isGenerated: false,
    }
    const photoInput = $('photoInput') as HTMLInputElement | null
    if (photoInput) photoInput.value = ''
    const dlPhoto = $('dl-photo') as HTMLElement | null
    if (dlPhoto) dlPhoto.style.display = 'none'
    syncActiveGeneratedUi('photo', false, null)
    invalidatePreviews()
  } else if (type === 'mask') {
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
    if (desc)
      desc.textContent =
        'Describe the SHAPE you want (e.g., Heart, Star, Cat Silhouette). The AI will create a B&W stencil.'
    input.placeholder = 'E.g., A simple silhouette of a cat sitting, vector style...'
  } else {
    if (title) title.textContent = '✨ Generate Photo'
    if (desc) desc.textContent = 'Describe the full color image you want to print.'
    input.placeholder = 'E.g., A cyberpunk city at sunset...'
  }
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
  if (aiOverlay) aiOverlay.style.display = 'none'

  ui.show()
  ui.update(50, `Creating ${mode}...`, 'This may take a few seconds')

  let finalPrompt = prompt
  if (mode === 'mask') {
    finalPrompt =
      'A high contrast, black and white stencil silhouette mask image of: ' +
      prompt +
      '. White is the object, Black is the background. Sharp hard vector edges. No grayscale shading. Flat design.'
  }

  const imageOpt = getSelectedImageModelOption()
  if (!state.selectedImageModel || !imageOpt) {
    ui.hide()
    void window.alert(
      'No image model selected or models not loaded. Open Settings, add your API key, and tap Refresh Models.',
    )
    return
  }

  const modelId = state.selectedImageModel
  const imageEndpoint = imageOpt.imageEndpoint

  try {
    let base64: string | undefined
    let imageMime = 'image/png'

    if (imageEndpoint === 'generateContent') {
      const url = googleModelEndpointUrl(modelId, state.apiKey, 'generateContent')
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
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

      if (!response.ok) {
        const msg = parseApiError(data, response.statusText)
        ui.update(0, 'Generation failed', msg)
        void window.alert(`AI generation failed: ${msg}`)
        ui.hide()
        return
      }

      if (data.error?.message) {
        const msg = data.error.message
        ui.update(0, 'Generation failed', msg)
        void window.alert(`AI generation failed: ${msg}`)
        ui.hide()
        return
      }

      const parts = data.candidates?.[0]?.content?.parts
      const imagePart = parts?.find(
        (p) => p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('image/'),
      )
      base64 = imagePart?.inlineData?.data
      const mt = imagePart?.inlineData?.mimeType
      if (mt && mt.startsWith('image/')) imageMime = mt
      if (!base64) {
        const msg = parseApiError(data, 'No image returned')
        ui.update(0, 'Generation failed', msg)
        void window.alert(`AI generation failed: ${msg}`)
        ui.hide()
        return
      }
    } else {
      const url = googleModelEndpointUrl(modelId, state.apiKey, 'predict')
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: { sampleCount: 1 },
        }),
      })

      const data = (await response.json()) as {
        predictions?: { bytesBase64Encoded?: string }[]
      }

      if (!response.ok) {
        const msg = parseApiError(data, response.statusText)
        ui.update(0, 'Generation failed', msg)
        void window.alert(`AI generation failed: ${msg}`)
        ui.hide()
        return
      }

      base64 = data.predictions?.[0]?.bytesBase64Encoded
      if (!base64) {
        const msg = parseApiError(data, 'No image returned')
        ui.update(0, 'Generation failed', msg)
        void window.alert(`AI generation failed: ${msg}`)
        ui.hide()
        return
      }
    }

    const imgSrc = `data:${imageMime};base64,${base64}`
    addToHistory(imgSrc, mode, null)

    void (async () => {
      try {
        const key = state.apiKey.trim()
        if (!key) return
        const slug = await autoNameImage(key, base64, imageMime)
        if (mode === 'photo') {
          state.lastGeneratedPhotoName = slug
          const el = $('generatedPhotoNameDisplay')
          if (el) el.textContent = `${slug}.jpg`
        } else {
          state.lastGeneratedMaskName = slug
          const el = $('generatedMaskNameDisplay')
          if (el) el.textContent = `${slug}.png`
        }
        patchHistorySuggestedSlug(mode, imgSrc, slug)
      } catch (e) {
        console.error('Auto-naming generated asset failed:', e)
      }
    })()

    const img = new Image()
    img.onload = () => {
      handleImageLoad(img, mode, prompt, true)
      ui.hide()
    }
    img.onerror = () => {
      void window.alert('Failed to decode generated image.')
      ui.hide()
    }
    img.src = imgSrc
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ui.update(0, 'Error', msg)
    void window.alert(`AI Generation Failed: ${msg}`)
    ui.hide()
  }
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
    ui.update(18, 'Generating ZIP…', '')
    const zipBlob = await generatePlateZip(
      state.pixelData.rectifiedComposite,
      JSON.stringify(currentPaletteJson),
      gen,
      {
        polygons: {
          maskPolygonMm: state.pixelData.maskPolygonMm,
          silhouettePolygonMm: state.pixelData.silhouettePolygonMm,
        },
        onProgress: (p) => {
          const pct = p.total > 0 ? 18 + Math.round((p.current / p.total) * 77) : 50
          ui.update(Math.min(96, Math.max(18, pct)), p.phase, '')
        },
      },
    )
    const fnameInput = $('fileNameInput') as HTMLInputElement | null
    const base =
      (fnameInput?.value || 'Lithophane').replace(/[^a-z0-9]/gi, '_') || 'Lithophane'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(zipBlob)
    a.download = `${base}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
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

  cvs.addEventListener('mousedown', (e) => {
    const rect = cvs.getBoundingClientRect()
    const m = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    if (state.activeLayer === 'mask' && !state.mask.loaded) return
    if (state.activeLayer === 'photo' && !state.photo.loaded) return

    const hit = getHitHandle(state[state.activeLayer], m.x, m.y)
    if (hit) {
      state.isDragging = true
      state.dragAction = hit
      state.dragStart = m
      const layer = state[state.activeLayer]
      dragInitial = { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rot: layer.rot }
    }
  })

  window.addEventListener('mouseup', () => {
    state.isDragging = false
    state.dragAction = null
    dragInitial = null
  })

  cvs.addEventListener('mousemove', (e) => {
    if (!state.isDragging || !state.dragAction || !dragInitial) return
    const rect = cvs.getBoundingClientRect()
    const m = { x: e.clientX - rect.left, y: e.clientY - rect.top }
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

  const photoInput = $('photoInput')
  const maskInput = $('maskInput')
  if (photoInput) photoInput.addEventListener('change', (e) => loadLayer(e, 'photo'))
  if (maskInput) maskInput.addEventListener('change', (e) => loadLayer(e, 'mask'))

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
    updateDims,
    updateUnitDisplay,
    onBorderWidthChange,
    onBorderHeightChange,
    onPixelSizeChange,
    generateLayers,
    exportDownload,
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
  })
}

init()
