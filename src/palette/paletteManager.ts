import { colorToHSL, hexToColor, type Rgba } from '../util/colorUtil'

export interface PaletteLayerHSL {
  H: number
  S: number
  L: number
}

export interface PaletteEntry {
  name?: string
  active?: boolean
  layers?: Record<string, PaletteLayerHSL | { hexcode?: string }>
}

export type PaletteJson = Record<string, PaletteEntry>

const PALETTE_STORAGE_KEY = 'litholab_palette'
const WHITE_HEX = '#FFFFFF'

interface ManagerHooks {
  getPalette: () => PaletteJson
  setPalette: (next: PaletteJson) => void
  getDefaultPalette: () => PaletteJson
  onChange: () => void
}

let hooks: ManagerHooks | null = null
let importInputBound = false
let searchTerm = ''

function $(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function requireHooks(): ManagerHooks {
  if (!hooks) throw new Error('Palette manager not initialized')
  return hooks
}

export function initPaletteManager(h: ManagerHooks): void {
  hooks = h
  bindCustomFormListeners()
  bindImportInput()
  bindSearchListener()
}

export function loadStoredPalette(defaultPalette: PaletteJson): PaletteJson {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY)
    if (!raw) return filterPaletteWithLayers(defaultPalette)
    const parsed = JSON.parse(raw) as unknown
    if (!isPaletteShape(parsed)) return filterPaletteWithLayers(defaultPalette)
    return filterPaletteWithLayers(parsed)
  } catch {
    return filterPaletteWithLayers(defaultPalette)
  }
}

export function savePalette(palette: PaletteJson): void {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palette))
  } catch {
    /* ignore quota errors */
  }
}

function isPaletteShape(value: unknown): value is PaletteJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.startsWith('#')) return false
    if (!entry || typeof entry !== 'object') return false
  }
  return true
}

/** Drop palette entries that have no calibrated layer ramp (no `layers` data). */
function filterPaletteWithLayers(palette: PaletteJson): PaletteJson {
  const out: PaletteJson = {}
  for (const [hex, entry] of Object.entries(palette)) {
    const layers = entry.layers
    if (layers && typeof layers === 'object' && Object.keys(layers).length > 0) {
      out[hex] = entry
    }
  }
  return out
}

function normalizeHex(hex: string): string {
  return hex.trim().toUpperCase()
}

function hexCssFromEntry(hex: string, entry: PaletteEntry): string {
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex
  const layers = entry.layers
  if (layers && typeof layers === 'object') {
    const keys = Object.keys(layers).sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
    for (const k of keys) {
      const sub = layers[k]
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

function topLayerHSL(entry: PaletteEntry): PaletteLayerHSL | null {
  const layers = entry.layers
  if (!layers) return null
  const keys = Object.keys(layers).map((k) => parseInt(k, 10)).filter((n) => !isNaN(n))
  if (keys.length === 0) return null
  const top = String(Math.max(...keys))
  const sub = layers[top]
  if (sub && typeof sub === 'object' && 'H' in sub && 'S' in sub && 'L' in sub) {
    return { H: (sub as PaletteLayerHSL).H, S: (sub as PaletteLayerHSL).S, L: (sub as PaletteLayerHSL).L }
  }
  if (sub && typeof sub === 'object' && 'hexcode' in sub && typeof sub.hexcode === 'string') {
    try {
      const c = hexToColor(sub.hexcode)
      const [h, s, l] = colorToHSL(c)
      return { H: h, S: s, L: l }
    } catch {
      return null
    }
  }
  return null
}

function tileTextColorFor(hex: string): 'light-text' | 'dark-text' {
  try {
    const c = hexToColor(hex)
    const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
    return luminance > 0.55 ? 'dark-text' : 'light-text'
  } catch {
    return 'dark-text'
  }
}

/**
 * Generate a 5-layer H/S/L ramp from a single top-layer color.
 * In a lithophane, fewer layers = thinner filament = more transmitted light = lighter color.
 * Delta-L steps approximate the curves observed in the bundled CMYK-0.10mm.json.
 */
export function makeLayerRamp(h: number, s: number, lTop: number): Record<string, PaletteLayerHSL> {
  const steps = [0, 2, 8, 18, 32] // delta-L added at layers 5,4,3,2,1
  const layers: Record<string, PaletteLayerHSL> = {}
  for (let i = 0; i < 5; i++) {
    const layerNum = 5 - i
    layers[String(layerNum)] = {
      H: round(h, 1),
      S: round(s, 1),
      L: round(Math.min(95, Math.max(0, lTop + steps[i])), 1),
    }
  }
  return layers
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

// --- View switching ----------------------------------------------------------

export function openPaletteManager(): void {
  const overlay = $('paletteOverlay')
  if (overlay) overlay.style.display = 'flex'
  showPaletteMainView()
}

export function closePaletteManager(): void {
  const overlay = $('paletteOverlay')
  if (overlay) overlay.style.display = 'none'
}

export function showPaletteMainView(): void {
  setView('main')
  renderPaletteManager()
}

export function showPaletteCustomView(): void {
  setView('custom')
  resetCustomForm()
}

export function showPalettePickerView(): void {
  setView('picker')
  searchTerm = ''
  const sb = $('paletteSearch') as HTMLInputElement | null
  if (sb) sb.value = ''
  renderAvailableList()
}

function setView(view: 'main' | 'picker' | 'custom'): void {
  const main = $('paletteViewMain')
  const picker = $('paletteViewPicker')
  const custom = $('paletteViewCustom')
  if (main) main.style.display = view === 'main' ? 'flex' : 'none'
  if (picker) picker.style.display = view === 'picker' ? 'flex' : 'none'
  if (custom) custom.style.display = view === 'custom' ? 'flex' : 'none'
}

// --- Main view (active tiles) ------------------------------------------------

export function renderPaletteManager(): void {
  const { getPalette } = requireHooks()
  const palette = getPalette()
  const grid = $('materialTilesGrid')
  if (!grid) return
  grid.replaceChildren()

  const activeHexes = Object.keys(palette).filter((hex) => palette[hex].active !== false)

  for (const hex of activeHexes) {
    grid.appendChild(buildTile(hex, palette[hex]))
  }

  const addTile = document.createElement('div')
  addTile.className = 'material-tile add'
  addTile.title = 'Add a color'
  addTile.textContent = '+'
  addTile.addEventListener('click', () => showPalettePickerView())
  grid.appendChild(addTile)
}

function buildTile(hex: string, entry: PaletteEntry): HTMLDivElement {
  const tile = document.createElement('div')
  tile.className = `material-tile ${tileTextColorFor(hex)}`
  tile.style.background = hexCssFromEntry(hex, entry)
  tile.title = `${entry.name ?? hex} (${hex})`

  const isBase = normalizeHex(hex) === WHITE_HEX
  if (isBase) {
    const label = document.createElement('span')
    label.className = 'tile-base-label'
    label.textContent = 'BASE'
    tile.appendChild(label)
  } else {
    if (entry.name) {
      const nm = document.createElement('span')
      nm.className = 'tile-name'
      nm.textContent = entry.name
      tile.appendChild(nm)
    }
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'tile-x'
    x.innerHTML = '&times;'
    x.title = 'Remove color'
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      togglePaletteEntry(hex, false)
    })
    tile.appendChild(x)
  }

  return tile
}

export function togglePaletteEntry(hex: string, active: boolean): void {
  const h = requireHooks()
  const palette = h.getPalette()
  const key = findKey(palette, hex)
  if (!key) return
  if (normalizeHex(key) === WHITE_HEX && !active) return // protect base
  palette[key].active = active
  h.setPalette(palette)
  savePalette(palette)
  h.onChange()
  renderPaletteManager()
}

function findKey(palette: PaletteJson, hex: string): string | undefined {
  const want = normalizeHex(hex)
  return Object.keys(palette).find((k) => normalizeHex(k) === want)
}

// --- Picker view -------------------------------------------------------------

function renderAvailableList(): void {
  const list = $('paletteAvailableList')
  if (!list) return
  const palette = requireHooks().getPalette()
  list.replaceChildren()

  const entries = Object.keys(palette)
    .filter((hex) => palette[hex].active === false)
    .map((hex) => ({ hex, entry: palette[hex] }))

  const term = searchTerm.trim().toLowerCase()
  const filtered = term
    ? entries.filter(({ hex, entry }) =>
        hex.toLowerCase().includes(term) || (entry.name ?? '').toLowerCase().includes(term),
      )
    : entries

  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'palette-available-empty'
    empty.textContent = entries.length === 0
      ? 'All palette colors are already active. Add a custom color below.'
      : 'No matches.'
    list.appendChild(empty)
    return
  }

  for (const { hex, entry } of filtered) {
    list.appendChild(buildAvailableRow(hex, entry))
  }
}

function buildAvailableRow(hex: string, entry: PaletteEntry): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'palette-available-row'
  row.addEventListener('click', () => addColorFromPicker(hex))

  const sw = document.createElement('div')
  sw.className = 'row-swatch'
  sw.style.background = hexCssFromEntry(hex, entry)
  row.appendChild(sw)

  const info = document.createElement('div')
  info.className = 'row-info'
  const name = document.createElement('div')
  name.className = 'row-name'
  name.textContent = entry.name ?? hex
  info.appendChild(name)

  const meta = document.createElement('div')
  meta.className = 'row-meta'
  const hsl = topLayerHSL(entry)
  meta.textContent = hsl
    ? `${hex.toUpperCase()} \u00b7 hsl(${round(hsl.H, 0)}, ${round(hsl.S, 0)}%, ${round(hsl.L, 0)}%)`
    : hex.toUpperCase()
  info.appendChild(meta)
  row.appendChild(info)

  return row
}

export function addColorFromPicker(hex: string): void {
  togglePaletteEntry(hex, true)
  showPaletteMainView()
}

function bindSearchListener(): void {
  const sb = $('paletteSearch') as HTMLInputElement | null
  if (!sb) return
  sb.addEventListener('input', () => {
    searchTerm = sb.value
    renderAvailableList()
  })
}

// --- Custom color view -------------------------------------------------------

function bindCustomFormListeners(): void {
  const hexInput = $('customColorHex') as HTMLInputElement | null
  const hInput = $('customColorH') as HTMLInputElement | null
  const sInput = $('customColorS') as HTMLInputElement | null
  const lInput = $('customColorL') as HTMLInputElement | null

  if (hexInput) {
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim()
      if (/^#?[0-9A-Fa-f]{6}$/.test(v)) {
        const hex = v.startsWith('#') ? v : `#${v}`
        try {
          const c = hexToColor(hex.toUpperCase())
          const [h, s, l] = colorToHSL(c)
          if (hInput) hInput.value = String(round(h, 1))
          if (sInput) sInput.value = String(round(s, 1))
          if (lInput) lInput.value = String(round(l, 1))
        } catch {
          /* ignore */
        }
      }
      updateCustomPreview()
    })
  }

  for (const el of [hInput, sInput, lInput]) {
    if (!el) continue
    el.addEventListener('input', () => {
      const h = clamp(parseFloat(hInput?.value ?? '0'), 0, 360)
      const s = clamp(parseFloat(sInput?.value ?? '0'), 0, 100)
      const l = clamp(parseFloat(lInput?.value ?? '50'), 0, 100)
      const rgb = hslToRgb(h, s, l)
      const hexStr = rgbToHex(rgb)
      if (hexInput) hexInput.value = hexStr
      updateCustomPreview()
    })
  }
}

function resetCustomForm(): void {
  const name = $('customColorName') as HTMLInputElement | null
  const hex = $('customColorHex') as HTMLInputElement | null
  const h = $('customColorH') as HTMLInputElement | null
  const s = $('customColorS') as HTMLInputElement | null
  const l = $('customColorL') as HTMLInputElement | null
  const err = $('customColorError')
  if (name) name.value = ''
  if (hex) hex.value = ''
  if (h) h.value = '0'
  if (s) s.value = '0'
  if (l) l.value = '50'
  if (err) err.textContent = ''
  updateCustomPreview()
}

function updateCustomPreview(): void {
  const hexInput = $('customColorHex') as HTMLInputElement | null
  const sw = $('customColorPreview')
  const label = $('customColorHexLabel')
  let css = '#888'
  let hexUp = ''
  const v = hexInput?.value.trim() ?? ''
  if (/^#?[0-9A-Fa-f]{6}$/.test(v)) {
    hexUp = (v.startsWith('#') ? v : `#${v}`).toUpperCase()
    css = hexUp
  }
  if (sw) sw.style.background = css
  if (label) label.textContent = hexUp || '#------'
}

export function saveCustomColor(): void {
  const h = requireHooks()
  const nameInput = $('customColorName') as HTMLInputElement | null
  const hexInput = $('customColorHex') as HTMLInputElement | null
  const hInput = $('customColorH') as HTMLInputElement | null
  const sInput = $('customColorS') as HTMLInputElement | null
  const lInput = $('customColorL') as HTMLInputElement | null
  const err = $('customColorError')

  const setError = (msg: string) => { if (err) err.textContent = msg }

  const rawHex = (hexInput?.value ?? '').trim()
  if (!/^#?[0-9A-Fa-f]{6}$/.test(rawHex)) {
    setError('Enter a valid hex code (e.g., #E7CEB5).')
    return
  }
  const hex = (rawHex.startsWith('#') ? rawHex : `#${rawHex}`).toUpperCase()

  const hue = clamp(parseFloat(hInput?.value ?? 'NaN'), 0, 360)
  const sat = clamp(parseFloat(sInput?.value ?? 'NaN'), 0, 100)
  const lit = clamp(parseFloat(lInput?.value ?? 'NaN'), 0, 100)
  if (!isFinite(hue) || !isFinite(sat) || !isFinite(lit)) {
    setError('H, S, and L must be numbers.')
    return
  }

  const palette = h.getPalette()
  if (findKey(palette, hex)) {
    setError(`${hex} is already in the palette. Toggle it on instead.`)
    return
  }

  const name = (nameInput?.value.trim() || `Custom ${hex}`)
  palette[hex] = {
    name: `Custom: ${name}`,
    active: true,
    layers: makeLayerRamp(hue, sat, lit),
  }
  h.setPalette(palette)
  savePalette(palette)
  h.onChange()
  showPaletteMainView()
}

// --- Import / Export ---------------------------------------------------------

export function triggerPaletteImport(): void {
  const input = $('paletteImportInput') as HTMLInputElement | null
  if (input) input.click()
}

function bindImportInput(): void {
  if (importInputBound) return
  const input = $('paletteImportInput') as HTMLInputElement | null
  if (!input) return
  importInputBound = true
  input.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : ''
        const parsed = JSON.parse(text) as unknown
        if (!isPaletteShape(parsed)) throw new Error('Bad shape')
        const filtered = filterPaletteWithLayers(parsed)
        const h = requireHooks()
        h.setPalette(filtered)
        savePalette(filtered)
        h.onChange()
        renderPaletteManager()
      } catch {
        window.alert('Invalid palette JSON. Keeping current palette.')
      }
      target.value = ''
    }
    reader.readAsText(file)
  })
}

export function exportPaletteFile(): void {
  const palette = filterPaletteWithLayers(requireHooks().getPalette())
  const text = JSON.stringify(palette, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  a.download = `litholab-palette-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function resetPaletteToDefault(): void {
  const ok = window.confirm('Reset palette to the default LithoLab palette? Custom colors and changes will be lost.')
  if (!ok) return
  const h = requireHooks()
  try {
    localStorage.removeItem(PALETTE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  const fresh = JSON.parse(JSON.stringify(h.getDefaultPalette())) as PaletteJson
  h.setPalette(fresh)
  h.onChange()
  renderPaletteManager()
}

// --- helpers -----------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (isNaN(n)) return NaN
  return Math.min(max, Math.max(min, n))
}

function hslToRgb(h: number, s: number, l: number): Rgba {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0 }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0 }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c }
  else if (hp < 6) { r1 = c; g1 = 0; b1 = x }
  const m = ln - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a: 255,
  }
}

function rgbToHex(c: Rgba): string {
  return `#${[c.r, c.g, c.b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}
