import './style.css'
import {
  ColorDistanceComputation,
  createDefaultGenInstruction,
  DEFAULT_VALUE_COLOR_LAYER_NUMBER,
  DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
  DEFAULT_VALUE_COLOR_PIXEL_WIDTH,
  DEFAULT_VALUE_PLATE_THICKNESS,
  PixelCreationMethod,
  type GenInstruction,
} from './genInstruction'
import { generatePlateZip } from './generator/plateGenerator'
import defaultPalette from '../palette/CMYK-0.10mm.json' with { type: 'json' }

let currentPaletteJson: unknown = defaultPalette

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

function initPalette(): void {
  setPaletteLoadedLabel('')
  renderPalettePreview(parsePaletteForPreview(currentPaletteJson))
}

function attachPaletteInput(): void {
  const el = $('paletteInput') as HTMLInputElement | null
  if (!el) return
  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      try {
        const parsed: unknown = JSON.parse(text)
        currentPaletteJson = parsed
        setPaletteLoadedLabel(`Loaded: ${file.name}`)
        renderPalettePreview(parsePaletteForPreview(currentPaletteJson))
      } catch {
        void window.alert('Invalid palette JSON. Reverted to default palette.')
        currentPaletteJson = defaultPalette
        setPaletteLoadedLabel('')
        renderPalettePreview(parsePaletteForPreview(currentPaletteJson))
      }
      input.value = ''
    }
    reader.readAsText(file)
  })
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
  const textWrap = $('textModelSelectWrap')
  const imageWrap = $('imageModelSelectWrap')
  const textSel = $('textModelSelect') as HTMLSelectElement | null
  const imageSel = $('imageModelSelect') as HTMLSelectElement | null

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

type HitId = 'tl' | 'tr' | 'br' | 'bl' | 'rotate' | 'move'

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
  alphaCanvas: HTMLCanvasElement | null
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

interface PixelBounds {
  x: number
  y: number
  w: number
  h: number
}

interface PixelData {
  width: number
  height: number
  c: Uint8Array
  m: Uint8Array
  y: Uint8Array
  w: Uint8Array
  mask: Uint8Array
  interior: Uint8Array
  maskBounds: { width: number }
  bounds: PixelBounds
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
  }
  photo: PhotoLayer
  mask: MaskLayer
  pixelData: PixelData | null
  prompts: { photo: string; mask: string }
  history: { photo: string[]; mask: string[] }
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
  export: { width: 100, height: 100, pixelStep: 2, border: 3, pixelSizeMm: 0.2 },
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
    alphaCanvas: null,
    isGenerated: false,
  },
  pixelData: null,
  prompts: { photo: '', mask: '' },
  history: { photo: [], mask: [] },
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

function createSmartAlphaMask(img: HTMLImageElement): { canvas: HTMLCanvasElement; w: number; h: number } {
  const tempC = document.createElement('canvas')
  tempC.width = img.width
  tempC.height = img.height
  const tCtx = tempC.getContext('2d')
  if (!tCtx) return { canvas: tempC, w: img.width, h: img.height }
  tCtx.drawImage(img, 0, 0)
  const id = tCtx.getImageData(0, 0, tempC.width, tempC.height)
  const d = id.data

  let minX = tempC.width
  let minY = tempC.height
  let maxX = 0
  let maxY = 0
  let foundAny = false

  for (let y = 0; y < tempC.height; y++) {
    for (let x = 0; x < tempC.width; x++) {
      const i = (y * tempC.width + x) * 4
      const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
      if (lum > 128) {
        d[i] = 255
        d[i + 1] = 255
        d[i + 2] = 255
        d[i + 3] = 255
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        foundAny = true
      } else {
        d[i + 3] = 0
      }
    }
  }

  if (!foundAny) {
    minX = 0
    minY = 0
    maxX = tempC.width
    maxY = tempC.height
  }
  const trimW = maxX - minX
  const trimH = maxY - minY

  const finalC = document.createElement('canvas')
  finalC.width = trimW
  finalC.height = trimH
  const fCtx = finalC.getContext('2d')
  if (!fCtx) return { canvas: finalC, w: trimW, h: trimH }

  tCtx.putImageData(id, 0, 0)
  fCtx.drawImage(tempC, minX, minY, trimW, trimH, 0, 0, trimW, trimH)

  return { canvas: finalC, w: trimW, h: trimH }
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
    const trimmed = createSmartAlphaMask(img)
    layer.alphaCanvas = trimmed.canvas
    layer.aspect = trimmed.w / trimmed.h

    const key = cacheKeyFromSrc(img.src)
    const cached = state.layerCache[key]
    if (cached) {
      layer.x = cached.x
      layer.y = cached.y
      layer.w = cached.w
      layer.h = cached.h
      layer.rot = cached.rot
    } else {
      layer.w = trimmed.w
      layer.h = trimmed.h
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
  }
  invalidatePreviews()
  render(true, c)
}

function addToHistory(imgSrc: string, type: ActiveLayer): void {
  state.history[type].unshift(imgSrc)
  if (state.history[type].length > 5) state.history[type].pop()

  const container = $(`${type}History`)
  if (!container) return
  container.replaceChildren()

  for (const src of state.history[type]) {
    const thumb = document.createElement('img')
    thumb.src = src
    thumb.className = 'history-thumb'
    thumb.addEventListener('click', () => {
      const img = new Image()
      img.onload = () => handleImageLoad(img, type, 'Restored Image', true)
      img.src = src
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
  const imgToDraw =
    isMask && 'alphaCanvas' in layer && layer.alphaCanvas ? layer.alphaCanvas : layer.img
  if (imgToDraw) c.drawImage(imgToDraw, -layer.w / 2, -layer.h / 2, layer.w, layer.h)
  c.restore()
}

function render(showGizmos = true, cIn?: CanvasRenderingContext2D): void {
  const c = cIn ?? requireCtx()
  const cvs = requireCanvas()
  c.clearRect(0, 0, cvs.width, cvs.height)

  if (state.photo.loaded) drawLayer(state.photo, false, c)

  c.save()
  setTransform(state.mask, c)

  if (state.mask.loaded && state.mask.alphaCanvas) {
    c.globalCompositeOperation = 'destination-in'
    const imgToDraw = state.mask.alphaCanvas
    c.drawImage(imgToDraw, -state.mask.w / 2, -state.mask.h / 2, state.mask.w, state.mask.h)
  } else {
    c.globalCompositeOperation = 'destination-in'
    c.fillStyle = '#000'
    c.fillRect(-state.mask.w / 2, -state.mask.h / 2, state.mask.w, state.mask.h)
  }

  c.globalCompositeOperation = 'source-over'

  if (showGizmos) {
    c.strokeStyle = 'rgba(255,255,255,0.3)'
    c.lineWidth = 1
    c.strokeRect(-state.mask.w / 2, -state.mask.h / 2, state.mask.w, state.mask.h)
  }
  c.restore()

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

function setPxRGB(imgData: ImageData, i: number, r: number, g: number, b: number): void {
  imgData.data[i] = r
  imgData.data[i + 1] = g
  imgData.data[i + 2] = b
  imgData.data[i + 3] = 255
}

function channelArray(pd: PixelData, ch: 'c' | 'm' | 'y' | 'w'): Uint8Array {
  switch (ch) {
    case 'c':
      return pd.c
    case 'm':
      return pd.m
    case 'y':
      return pd.y
    default:
      return pd.w
  }
}

function generateLayers(): void {
  if (!state.photo.loaded) {
    void window.alert('Please upload a Photo first.')
    return
  }

  const cvs = requireCanvas()
  const c = requireCtx()
  render(false, c)

  const borderMm = parseFloat(($('borderInput') as HTMLInputElement | null)?.value ?? '') || 0
  state.export.border = borderMm
  const padPx = borderMm > 0 ? Math.ceil((borderMm / state.export.width) * cvs.width) + 15 : 0

  const tempCvs = document.createElement('canvas')
  tempCvs.width = cvs.width + padPx * 2
  tempCvs.height = cvs.height + padPx * 2
  const tempCtx = tempCvs.getContext('2d')
  if (!tempCtx) {
    void window.alert('Could not create off-screen canvas context.')
    render(true, c)
    return
  }
  tempCtx.drawImage(cvs, padPx, padPx)

  const w = tempCvs.width
  const h = tempCvs.height
  const data = tempCtx.getImageData(0, 0, w, h).data

  const totalPixels = w * h
  state.export.pixelStep = totalPixels > 2_000_000 ? 3 : 2

  let minX = w
  let maxX = 0
  let minY = h
  let maxY = 0

  const pixelData: PixelData = {
    width: w,
    height: h,
    c: new Uint8Array(w * h),
    m: new Uint8Array(w * h),
    y: new Uint8Array(w * h),
    w: new Uint8Array(w * h),
    mask: new Uint8Array(w * h),
    interior: new Uint8Array(w * h),
    maskBounds: { width: w },
    bounds: { x: 0, y: 0, w: 0, h: 0 },
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const p = y * w + x

      if (data[i + 3]! > 10) {
        pixelData.mask[p] = 1
        pixelData.interior[p] = 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y

        const r = data[i]!
        const g = data[i + 1]!
        const b = data[i + 2]!
        pixelData.c[p] = 255 - r
        pixelData.m[p] = 255 - g
        pixelData.y[p] = 255 - b
        pixelData.w[p] = 255 - (r * 0.299 + g * 0.587 + b * 0.114)
      } else {
        pixelData.mask[p] = 0
      }
    }
  }

  let bounds: PixelBounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  pixelData.maskBounds.width = bounds.w

  if (state.export.border > 0 && state.mask.loaded) {
    const pxPerMM = bounds.w / state.export.width
    const borderPx = state.export.border * pxPerMM

    const dist = new Float32Array(w * h).fill(999_999)

    for (let p = 0; p < w * h; p++) {
      if (pixelData.mask[p] === 1) dist[p] = 0
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (dist[idx]! > 0) {
          let d = dist[idx]!
          if (x > 0) d = Math.min(d, dist[idx - 1]! + 1) // Left
          if (y > 0) {
            d = Math.min(d, dist[idx - w]! + 1) // Top
            if (x > 0) d = Math.min(d, dist[idx - w - 1]! + Math.SQRT2) // Top-Left
            if (x < w - 1) d = Math.min(d, dist[idx - w + 1]! + Math.SQRT2) // Top-Right
          }
          dist[idx] = d
        }
      }
    }

    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const idx = y * w + x
        if (dist[idx]! > 0) {
          let d = dist[idx]!
          if (x < w - 1) d = Math.min(d, dist[idx + 1]! + 1) // Right
          if (y < h - 1) {
            d = Math.min(d, dist[idx + w]! + 1) // Bottom
            if (x < w - 1) d = Math.min(d, dist[idx + w + 1]! + Math.SQRT2) // Bottom-Right
            if (x > 0) d = Math.min(d, dist[idx + w - 1]! + Math.SQRT2) // Bottom-Left
          }
          dist[idx] = d
        }

        if (dist[idx]! <= borderPx && dist[idx]! > 0) {
          pixelData.mask[idx] = 1
          pixelData.c[idx] = 0
          pixelData.m[idx] = 0
          pixelData.y[idx] = 0
          pixelData.w[idx] = 255

          const x_ = x
          const y_ = y
          if (x_ < minX) minX = x_
          if (x_ > maxX) maxX = x_
          if (y_ < minY) minY = y_
          if (y_ > maxY) maxY = y_
        }
      }
    }
  } else if (state.export.border > 0) {
    const pxPerMM = bounds.w / state.export.width
    const borderPx = state.export.border * pxPerMM

    const bx = Math.floor(bounds.x - borderPx)
    const by = Math.floor(bounds.y - borderPx)
    const bw = Math.floor(bounds.w + borderPx * 2)
    const bh = Math.floor(bounds.h + borderPx * 2)

    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
          const idx = y * w + x
          if (pixelData.mask[idx] === 0) {
            pixelData.mask[idx] = 1
            pixelData.c[idx] = 0
            pixelData.m[idx] = 0
            pixelData.y[idx] = 0
            pixelData.w[idx] = 255

            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
    }
  }

  bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  if (bounds.w <= 0 || bounds.h <= 0) {
    render(true, c)
    invalidatePreviews()
    void window.alert('No visible content on the canvas.')
    return
  }

  pixelData.bounds = bounds
  state.pixelData = pixelData
  setExportButtonsEnabled(true)

  const renderPreview = (canvasId: string, dataChannel: 'c' | 'm' | 'y' | 'w'): void => {
    const prevCvs = $(canvasId) as HTMLCanvasElement | null
    const prevCtx = prevCvs?.getContext('2d')
    if (!prevCvs || !prevCtx) return
    prevCvs.width = bounds.w
    prevCvs.height = bounds.h
    const imgData = prevCtx.createImageData(bounds.w, bounds.h)
    const chArr = channelArray(pixelData, dataChannel)
    const useInterior = dataChannel === 'c' || dataChannel === 'm' || dataChannel === 'y'
    const vis = useInterior ? pixelData.interior : pixelData.mask

    for (let y = 0; y < bounds.h; y++) {
      for (let x = 0; x < bounds.w; x++) {
        const srcIdx = (y + bounds.y) * w + (x + bounds.x)
        const dstIdx = (y * bounds.w + x) * 4

        if (srcIdx >= 0 && srcIdx < w * h && vis[srcIdx] === 1) {
          const val = chArr[srcIdx]!
          if (dataChannel === 'c') setPxRGB(imgData, dstIdx, 255 - val, 255, 255)
          else if (dataChannel === 'm') setPxRGB(imgData, dstIdx, 255, 255 - val, 255)
          else if (dataChannel === 'y') setPxRGB(imgData, dstIdx, 255, 255, 255 - val)
          else setPxRGB(imgData, dstIdx, val, val, val)
        } else {
          imgData.data[dstIdx + 3] = 0
        }
      }
    }
    prevCtx.putImageData(imgData, 0, 0)
  }

  for (const k of ['c', 'm', 'y', 'w'] as const) {
    renderPreview(`${k}Canvas`, k)
  }

  const refCvs = $('refCanvas') as HTMLCanvasElement | null
  const refCtx = refCvs?.getContext('2d')
  if (refCvs && refCtx) {
    refCvs.width = bounds.w
    refCvs.height = bounds.h
    const compData = refCtx.createImageData(bounds.w, bounds.h)
    for (let y = 0; y < bounds.h; y++) {
      for (let x = 0; x < bounds.w; x++) {
        const srcIdx = (y + bounds.y) * w + (x + bounds.x)
        const dstIdx = (y * bounds.w + x) * 4

        if (srcIdx >= 0 && srcIdx < w * h && pixelData.mask[srcIdx] === 1) {
          const rr = 255 - pixelData.c[srcIdx]!
          const gg = 255 - pixelData.m[srcIdx]!
          const bb = 255 - pixelData.y[srcIdx]!
          compData.data[dstIdx] = rr
          compData.data[dstIdx + 1] = gg
          compData.data[dstIdx + 2] = bb
          compData.data[dstIdx + 3] = 255
        } else {
          compData.data[dstIdx + 3] = 0
        }
      }
    }
    refCtx.putImageData(compData, 0, 0)
  }

  render(true, c)
}

function updateBorderDisplay(val: string): void {
  const borderVal = $('borderVal')
  if (borderVal) borderVal.textContent = `${val}mm`
  state.export.border = parseFloat(val)
  if (state.pixelData) generateLayers()
}

function updatePixelSizeDisplay(val: string): void {
  const v = parseFloat(val)
  state.export.pixelSizeMm = v
  const el = $('pixelSizeVal')
  if (el) el.textContent = `${v} mm`
  updateExportGridReadout()
  if (state.pixelData) generateLayers()
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

function exportCompositePngBlob(): Promise<Blob | null> {
  const pd = state.pixelData
  const bounds = pd?.bounds
  if (!pd || !bounds || bounds.w <= 0 || bounds.h <= 0) {
    return Promise.resolve(null)
  }
  const w = pd.width
  const h = pd.height
  const canvas = document.createElement('canvas')
  canvas.width = bounds.w
  canvas.height = bounds.h
  const xctx = canvas.getContext('2d')
  if (!xctx) return Promise.resolve(null)
  const imgData = xctx.createImageData(bounds.w, bounds.h)
  for (let y = 0; y < bounds.h; y++) {
    for (let x = 0; x < bounds.w; x++) {
      const srcIdx = (y + bounds.y) * w + (x + bounds.x)
      const dstIdx = (y * bounds.w + x) * 4
      if (srcIdx >= 0 && srcIdx < w * h && pd.mask[srcIdx] === 1) {
        imgData.data[dstIdx] = 255 - pd.c[srcIdx]!
        imgData.data[dstIdx + 1] = 255 - pd.m[srcIdx]!
        imgData.data[dstIdx + 2] = 255 - pd.y[srcIdx]!
        imgData.data[dstIdx + 3] = 255
      } else {
        imgData.data[dstIdx + 3] = 0
      }
    }
  }
  xctx.putImageData(imgData, 0, 0)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image from blob'))
    }
    img.src = url
  })
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
      alphaCanvas: null,
      isGenerated: false,
    }
    const maskInput = $('maskInput') as HTMLInputElement | null
    if (maskInput) maskInput.value = ''
    const dlMask = $('dl-mask') as HTMLElement | null
    if (dlMask) dlMask.style.display = 'none'
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

function downloadSource(type: ActiveLayer): void {
  const layer = state[type]
  if (layer.loaded && layer.img) {
    const a = document.createElement('a')
    a.href = layer.img.src
    a.download = `generated_${type}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
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
    addToHistory(imgSrc, mode)

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

async function autoNameImage(): Promise<void> {
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
    const blob = await exportCompositePngBlob()
    if (!blob) {
      void window.alert('Could not export composite image.')
      return
    }
    ui.update(12, 'Loading image…', '')
    const img = await blobToImage(blob)
    const gen = buildGenInstructionFromState()
    const pdBounds = state.pixelData?.bounds
    if (pdBounds && pdBounds.w > 0) {
      gen.destImageHeight = gen.destImageWidth * (pdBounds.h / pdBounds.w)
    }
    ui.update(18, 'Generating ZIP…', '')
    const zipBlob = await generatePlateZip(img, JSON.stringify(currentPaletteJson), gen, {
      onProgress: (p) => {
        const pct = p.total > 0 ? 18 + Math.round((p.current / p.total) * 77) : 50
        ui.update(Math.min(96, Math.max(18, pct)), p.phase, '')
      },
    })
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
      const cx = layer.x + layer.w / 2
      const cy = layer.y + layer.h / 2
      const distStart = Math.hypot(start.x - cx, start.y - cy)
      const distNow = Math.hypot(m.x - cx, m.y - cy)
      const ratio = distStart > 0 ? distNow / distStart : 1
      layer.w = init.w * ratio
      layer.h = init.h * ratio
      layer.x = cx - layer.w / 2
      layer.y = cy - layer.h / 2
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
  const pi = $('pixelSizeInput') as HTMLInputElement | null
  if (pi) pi.value = String(state.export.pixelSizeMm)
  updateExportGridReadout()
  checkApiKey()

  bindSettingsModels()
  updateSettingsModelUI()
  if (state.apiKey.trim()) {
    void fetchModels(state.apiKey)
  }

  initPalette()
  attachPaletteInput()

  const photoInput = $('photoInput')
  const maskInput = $('maskInput')
  if (photoInput) photoInput.addEventListener('change', (e) => loadLayer(e, 'photo'))
  if (maskInput) maskInput.addEventListener('change', (e) => loadLayer(e, 'mask'))

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
    updateBorderDisplay,
    updatePixelSizeDisplay,
    generateLayers,
    exportDownload,
    autoNameImage,
  })
}

init()
