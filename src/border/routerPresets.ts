import {
  boundaryFromOps,
  cloneBoundary,
  isValidBoundary,
  rectBoundary,
  type NormalizedPoint,
  type ProfileOp,
} from './routerGeometry'
import { CATALOG_PRESET_GRID, CATALOG_PRESET_ORDER, isCatalogPresetId } from './routerCatalog'

export type { NormalizedPoint, ProfileOp }

export type RouterPresetId =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '19'
  | '20'
  | '21'
  | '22'
  | '23'
  | '24'
  | '25'
  | '26'
  | '27'
  | '28'
  | '29'
  | '30'
  | '31'
  | '32'
  | '33'
  | '34'
  | '35'
  | '36'
  | '37'
  | '38'
  | '39'
  | '40'
  | '301'
  | '302'
  | '303'
  | '304'
  | '305'
  | '306'
  | '307'
  | '308'
  | '309'
  | '310'
  | '311'

export interface BorderProfile {
  source: 'preset' | 'custom'
  presetId?: RouterPresetId
  boundary: NormalizedPoint[]
  ops?: ProfileOp[]
}

export interface RouterPresetDef {
  id: RouterPresetId
  label: string
  boundary: NormalizedPoint[]
  ops?: ProfileOp[]
}

export const BORDER_PROFILE_STORAGE_KEY = 'litholab_border_profile'

export const ROUTER_PRESETS: RouterPresetDef[] = CATALOG_PRESET_GRID

export function getPresetById(id: RouterPresetId): RouterPresetDef {
  return ROUTER_PRESETS.find((p) => p.id === id) ?? ROUTER_PRESETS[0]
}

export function profileFromPreset(id: RouterPresetId): BorderProfile {
  const preset = getPresetById(id)
  return {
    source: 'preset',
    presetId: id,
    boundary: cloneBoundary(preset.boundary),
    ops: preset.ops ? [...preset.ops] : undefined,
  }
}

export function defaultBorderProfile(): BorderProfile {
  return {
    source: 'custom',
    boundary: rectBoundary(),
    ops: [],
  }
}

export function isSolidDefaultProfile(profile: BorderProfile): boolean {
  if (profile.source !== 'custom' || profile.presetId) return false
  const ops = profile.ops ?? []
  return ops.length === 0 && isValidBoundary(profile.boundary)
}

export function customProfileFromOps(ops: ProfileOp[]): BorderProfile {
  return {
    source: 'custom',
    boundary: boundaryFromOps(ops),
    ops: [...ops],
  }
}

export function profileLabel(profile: BorderProfile | null): string {
  if (!profile) return 'Solid'
  if (profile.source === 'preset' && profile.presetId) {
    return getPresetById(profile.presetId).label
  }
  if (isSolidDefaultProfile(profile)) return 'Solid'
  return 'Custom'
}

export function isValidProfileShape(profile: BorderProfile | null): boolean {
  if (!profile) return false
  return isValidBoundary(profile.boundary)
}

export function loadStoredBorderProfile(): BorderProfile | null {
  try {
    const raw = localStorage.getItem(BORDER_PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isBorderProfileShape(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveBorderProfile(profile: BorderProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(BORDER_PROFILE_STORAGE_KEY)
      return
    }
    if (isSolidDefaultProfile(profile)) {
      localStorage.removeItem(BORDER_PROFILE_STORAGE_KEY)
      return
    }
    localStorage.setItem(BORDER_PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch {
    /* ignore quota errors */
  }
}

function isBorderProfileShape(value: unknown): value is BorderProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as BorderProfile & { points?: unknown }
  if (v.source !== 'preset' && v.source !== 'custom') return false
  if ('points' in v && !('boundary' in v)) return false
  if (v.source === 'preset') {
    if (!v.presetId || !isCatalogPresetId(v.presetId)) return false
  } else if (v.presetId && !isCatalogPresetId(v.presetId)) {
    return false
  }
  if (!Array.isArray(v.boundary) || v.boundary.length < 3) return false
  for (const p of v.boundary) {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return false
  }
  return isValidBoundary(v.boundary)
}

export { cloneBoundary, rectBoundary, boundaryFromOps, isValidBoundary, CATALOG_PRESET_ORDER }
