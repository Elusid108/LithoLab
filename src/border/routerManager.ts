import {
  boundaryFromOps,
  cloneBoundary,
  customProfileFromOps,
  defaultBorderProfile,
  getPresetById,
  isSolidDefaultProfile,
  isValidProfileShape,
  profileFromPreset,
  profileLabel,
  ROUTER_PRESETS,
  type BorderProfile,
  type NormalizedPoint,
  type ProfileOp,
  type RouterPresetId,
} from './routerPresets'
import { drawBoundaryPreview } from './routerGeometry'

const CANVAS_W = 280
const CANVAS_H = 220
const PAD_LEFT = 36
const PAD_BOTTOM = 28
const PAD_TOP = 16
const PAD_RIGHT = 16
const MAX_OPS = 50

type RouterTool = 'line' | 'circle'
type CircleMode = 'add' | 'subtract'
type LineKeep = 'left' | 'right'

interface BorderDims {
  widthMm: number
  heightMm: number
}

interface ManagerHooks {
  getBorderDims: () => BorderDims
  getProfile: () => BorderProfile | null
  setProfile: (profile: BorderProfile | null) => void
  onChange: () => void
}

let hooks: ManagerHooks | null = null
let draftProfile: BorderProfile = defaultBorderProfile()
let selectedPresetId: RouterPresetId | null = null
let activeTool: RouterTool = 'line'
let circleMode: CircleMode = 'subtract'
let lineKeep: LineKeep = 'left'
let pendingLineStart: NormalizedPoint | null = null
let circleDrag: { cx: number; cy: number; r: number } | null = null
let canvasBound = false

function $(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function requireHooks(): ManagerHooks {
  if (!hooks) throw new Error('Router manager not initialized')
  return hooks
}

function draftOps(): ProfileOp[] {
  return draftProfile.ops ?? []
}

function recomputeCustomBoundary(): void {
  draftProfile.boundary = boundaryFromOps(draftOps())
}

function setDraftCustom(ops: ProfileOp[]): void {
  draftProfile = customProfileFromOps(ops.slice(0, MAX_OPS))
}

export function initRouterManager(h: ManagerHooks): void {
  hooks = h
  bindCanvasInteraction()
  renderPresetGrid()
  syncToolUi()
}

export function openRouterModal(): void {
  const overlay = $('routerOverlay')
  if (!overlay) return

  const dims = requireHooks().getBorderDims()
  if (dims.widthMm <= 0 || dims.heightMm <= 0) return

  const current = requireHooks().getProfile()
  draftProfile = current
    ? {
        source: current.source,
        presetId: current.presetId,
        boundary: cloneBoundary(current.boundary),
        ops: current.ops ? [...current.ops] : undefined,
      }
    : defaultBorderProfile()
  selectedPresetId =
    draftProfile.source === 'preset' && draftProfile.presetId ? draftProfile.presetId : null
  pendingLineStart = null
  circleDrag = null

  overlay.style.display = 'flex'
  renderPresetGrid()
  renderRouterCanvas()
  syncToolUi()
  clearRouterError()
}

export function closeRouterModal(): void {
  const overlay = $('routerOverlay')
  if (overlay) overlay.style.display = 'none'
  pendingLineStart = null
  circleDrag = null
}

export function cancelRouterModal(): void {
  closeRouterModal()
}

export function applyRouterProfile(): void {
  const errEl = $('routerError')
  if (!isValidProfileShape(draftProfile)) {
    if (errEl) {
      errEl.textContent =
        'Profile must keep the inside-left edge intact (material from bottom to top on the left).'
    }
    return
  }

  const h = requireHooks()
  const toSave = isSolidDefaultProfile(draftProfile) ? null : {
    source: draftProfile.source,
    presetId: draftProfile.presetId,
    boundary: cloneBoundary(draftProfile.boundary),
    ops: draftProfile.ops ? [...draftProfile.ops] : undefined,
  } as BorderProfile
  h.setProfile(toSave)
  h.onChange()
  closeRouterModal()
}

export function selectRouterPreset(id: RouterPresetId): void {
  selectedPresetId = id
  draftProfile = profileFromPreset(id)
  pendingLineStart = null
  circleDrag = null
  renderPresetGrid()
  renderRouterCanvas()
  clearRouterError()
}

export function clearRouterDrawing(): void {
  setDraftCustom([])
  selectedPresetId = null
  pendingLineStart = null
  circleDrag = null
  renderPresetGrid()
  renderRouterCanvas()
  clearRouterError()
}

export function resetRouterToPreset(): void {
  if (selectedPresetId) {
    selectRouterPreset(selectedPresetId)
  } else {
    clearRouterDrawing()
  }
}

export function setRouterTool(tool: RouterTool): void {
  activeTool = tool
  pendingLineStart = null
  circleDrag = null
  syncToolUi()
  renderRouterCanvas()
}

export function setRouterCircleMode(mode: CircleMode): void {
  circleMode = mode
  syncToolUi()
}

export function setRouterLineKeep(keep: LineKeep): void {
  lineKeep = keep
  syncToolUi()
}

export function undoRouterOp(): void {
  if (draftProfile.source !== 'custom' || !draftProfile.ops?.length) return
  draftProfile.ops.pop()
  recomputeCustomBoundary()
  renderRouterCanvas()
  clearRouterError()
}

export function refreshRouterCanvasIfOpen(): void {
  const overlay = $('routerOverlay')
  if (overlay && overlay.style.display === 'flex') {
    renderRouterCanvas()
  }
}

export function updateRouterButtonState(): void {
  const btn = $('btnRouter') as HTMLButtonElement | null
  const dims = hooks?.getBorderDims()
  const profile = hooks?.getProfile() ?? null
  if (!btn) return

  const disabled = !dims || dims.widthMm <= 0 || dims.heightMm <= 0
  btn.disabled = disabled
  btn.title = disabled ? 'Set border width and height first' : 'Edit border router profile'
  btn.textContent = `Router: ${profileLabel(profile)}`
}

function syncToolUi(): void {
  const lineBtn = $('routerToolLine')
  const circleBtn = $('routerToolCircle')
  const addBtn = $('routerModeAdd')
  const subBtn = $('routerModeSubtract')
  const keepLeftBtn = $('routerKeepLeft')
  const keepRightBtn = $('routerKeepRight')
  lineBtn?.classList.toggle('active', activeTool === 'line')
  circleBtn?.classList.toggle('active', activeTool === 'circle')
  addBtn?.classList.toggle('active', circleMode === 'add')
  subBtn?.classList.toggle('active', circleMode === 'subtract')
  keepLeftBtn?.classList.toggle('active', lineKeep === 'left')
  keepRightBtn?.classList.toggle('active', lineKeep === 'right')

  const circleModeEl = $('routerCircleModeGroup')
  const lineKeepEl = $('routerLineKeepGroup')
  if (circleModeEl) circleModeEl.style.display = activeTool === 'circle' ? 'flex' : 'none'
  if (lineKeepEl) lineKeepEl.style.display = activeTool === 'line' ? 'flex' : 'none'
}

function clearRouterError(): void {
  const errEl = $('routerError')
  if (errEl) errEl.textContent = ''
}

function bindCanvasInteraction(): void {
  if (canvasBound) return
  const canvas = $('routerCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  canvasBound = true

  canvas.addEventListener('mousedown', (e) => {
    const pt = canvasToNormalized(e.offsetX, e.offsetY)
    if (activeTool === 'line') {
      if (!pendingLineStart) {
        pendingLineStart = pt
      } else {
        appendOp({
          type: 'lineCut',
          x0: pendingLineStart.x,
          y0: pendingLineStart.y,
          x1: pt.x,
          y1: pt.y,
          keep: lineKeep,
        })
        pendingLineStart = null
      }
    } else {
      circleDrag = { cx: pt.x, cy: pt.y, r: 0.01 }
    }
    renderRouterCanvas()
  })

  canvas.addEventListener('mousemove', (e) => {
    if (!circleDrag || activeTool !== 'circle') return
    const pt = canvasToNormalized(e.offsetX, e.offsetY)
    const dx = pt.x - circleDrag.cx
    const dy = pt.y - circleDrag.cy
    circleDrag.r = Math.max(0.01, Math.min(0.6, Math.hypot(dx, dy)))
    renderRouterCanvas()
  })

  const finishCircle = (): void => {
    if (!circleDrag || activeTool !== 'circle') return
    if (circleDrag.r >= 0.02) {
      appendOp({
        type: 'circle',
        cx: circleDrag.cx,
        cy: circleDrag.cy,
        r: circleDrag.r,
        mode: circleMode,
      })
    }
    circleDrag = null
    renderRouterCanvas()
  }
  canvas.addEventListener('mouseup', finishCircle)
  canvas.addEventListener('mouseleave', () => {
    if (circleDrag) {
      circleDrag = null
      renderRouterCanvas()
    }
  })
}

function appendOp(op: ProfileOp): void {
  if (draftProfile.source === 'preset') {
    setDraftCustom([])
  }
  const ops = draftOps()
  ops.push(op)
  draftProfile.ops = ops.slice(0, MAX_OPS)
  recomputeCustomBoundary()
  draftProfile.source = 'custom'
  draftProfile.presetId = undefined
  selectedPresetId = null
  renderPresetGrid()
  clearRouterError()
}

function canvasToNormalized(px: number, py: number): NormalizedPoint {
  const plotW = CANVAS_W - PAD_LEFT - PAD_RIGHT
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM
  return {
    x: Math.max(0, Math.min(1, (px - PAD_LEFT) / plotW)),
    y: Math.max(0, Math.min(1, 1 - (py - PAD_TOP) / plotH)),
  }
}

function renderPresetGrid(): void {
  const grid = $('routerPresetGrid')
  if (!grid) return
  grid.innerHTML = ''

  for (const preset of ROUTER_PRESETS) {
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'router-preset-tile'
    if (preset.id === selectedPresetId && draftProfile.source === 'preset') {
      tile.classList.add('selected')
    }

    const thumb = document.createElement('canvas')
    thumb.className = 'router-preset-thumb'
    thumb.width = 56
    thumb.height = 44
    const tctx = thumb.getContext('2d')
    if (tctx) {
      tctx.fillStyle = '#262626'
      tctx.fillRect(0, 0, 56, 44)
      drawBoundaryPreview(tctx, preset.boundary, 56, 44, {
        padL: 4,
        padR: 4,
        padT: 4,
        padB: 4,
        fillAlpha: 0.35,
        strokeWidth: 1.5,
      })
    }

    const label = document.createElement('span')
    label.className = 'router-preset-label'
    label.textContent = preset.label

    tile.appendChild(thumb)
    tile.appendChild(label)
    tile.addEventListener('click', () => selectRouterPreset(preset.id))
    grid.appendChild(tile)
  }
}

function renderRouterCanvas(): void {
  const canvas = $('routerCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dims = requireHooks().getBorderDims()
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  drawGrid(ctx, dims)

  const previewOps = [...draftOps()]
  if (pendingLineStart && activeTool === 'line') {
    previewOps.push({
      type: 'lineCut',
      x0: pendingLineStart.x,
      y0: pendingLineStart.y,
      x1: pendingLineStart.x,
      y1: pendingLineStart.y,
      keep: lineKeep,
    })
  }
  if (circleDrag && activeTool === 'circle') {
    previewOps.push({
      type: 'circle',
      cx: circleDrag.cx,
      cy: circleDrag.cy,
      r: circleDrag.r,
      mode: circleMode,
    })
  }

  drawBoundaryPreview(ctx, draftProfile.boundary, CANVAS_W, CANVAS_H, {
    padL: PAD_LEFT,
    padR: PAD_RIGHT,
    padT: PAD_TOP,
    padB: PAD_BOTTOM,
    fillAlpha: 0.28,
    strokeWidth: 2,
    previewOps,
  })

  ctx.fillStyle = '#ccc'
  ctx.font = '11px Inter, sans-serif'
  ctx.textAlign = 'left'
  const toolHint =
    activeTool === 'line'
      ? pendingLineStart
        ? 'Line cut: click second point'
        : 'Line cut: click first point'
      : 'Circle: click center, drag radius, release'
  ctx.fillText(`${profileLabel(draftProfile)} — ${toolHint}`, PAD_LEFT, 12)
}

function drawGrid(ctx: CanvasRenderingContext2D, dims: BorderDims): void {
  const plotX = PAD_LEFT
  const plotY = PAD_TOP
  const plotW = CANVAS_W - PAD_LEFT - PAD_RIGHT
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM

  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.strokeRect(plotX, plotY, plotW, plotH)

  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#00d26a'
  ctx.beginPath()
  ctx.moveTo(plotX, plotY)
  ctx.lineTo(plotX, plotY + plotH)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#00d26a'
  ctx.font = '10px Inter, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('Inside edge', plotX - 4, plotY + plotH / 2)

  ctx.fillStyle = '#888'
  ctx.textAlign = 'center'
  ctx.fillText('0 mm', plotX, plotY + plotH + 18)
  ctx.fillText(`${dims.widthMm.toFixed(1)} mm`, plotX + plotW, plotY + plotH + 18)

  ctx.save()
  ctx.translate(8, plotY + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(`${dims.heightMm.toFixed(1)} mm`, 0, 0)
  ctx.restore()
  ctx.fillText('0 mm', plotX - 2, plotY + plotH)

  ctx.fillStyle = '#666'
  ctx.font = '9px Inter, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Width (mm)', plotX + plotW / 2 - 20, plotY + plotH + 10)
  ctx.textAlign = 'right'
  ctx.fillText('Height (mm)', 14, plotY + plotH / 2)
}

export { profileLabel, getPresetById }
