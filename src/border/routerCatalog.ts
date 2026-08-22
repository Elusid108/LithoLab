import { cloneBoundary, type NormalizedPoint } from './routerGeometry'
import {
  P,
  bullnose,
  chamferCut,
  closeTop,
  coveFromTop,
  dropFirst,
  ogeeClassic,
  quarterRound,
  sampleArc,
  concat,
  wavyTop,
} from './routerProfilePaths'

import type { RouterPresetDef, RouterPresetId } from './routerPresets'

function build(id: RouterPresetId, label: string, boundary: NormalizedPoint[]): RouterPresetDef {
  return { id, label, boundary: cloneBoundary(boundary) }
}

function p01(): NormalizedPoint[] {
  return quarterRound(0.22)
}

function p02(): NormalizedPoint[] {
  return quarterRound(0.42)
}

/** Hilton (#3): top shelf → step down → convex ovolo → step → toe → right edge */
function p03(): NormalizedPoint[] {
  const shelfX = 0.4
  const drop1Y = 0.66
  const r = 0.17
  const cx = shelfX + r
  const cy = drop1Y
  const toeY = 0.14
  const toeX = 0.9
  return closeTop(
    concat(
      [P(shelfX, 1), P(shelfX, drop1Y)],
      dropFirst(sampleArc(cx, cy, r, Math.PI, Math.PI * 1.5, 16)),
      [P(shelfX + r, toeY), P(toeX, toeY), P(1, toeY)],
    ),
  )
}

function p04(): NormalizedPoint[] {
  return coveFromTop(0.45)
}

function p05(): NormalizedPoint[] {
  return chamferCut()
}

function p06(): NormalizedPoint[] {
  return closeTop(
    concat([P(0, 0.86)], dropFirst(sampleArc(0.86, 0, 0.86, Math.PI, Math.PI / 2, 14)), [P(1, 1)]),
  )
}

function p07(): NormalizedPoint[] {
  return closeTop(
    concat([P(0, 0.86)], dropFirst(sampleArc(0, 0.86, 0.32, Math.PI / 2, 0, 12)), [P(1, 1)]),
  )
}

function p08(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0.1, 1)],
      dropFirst(sampleArc(0.1, 0.82, 0.18, Math.PI, Math.PI / 2, 10)),
      [P(1, 1)],
    ),
  )
}

function p12(): NormalizedPoint[] {
  return closeTop(
    concat([P(0, 0.72)], dropFirst(sampleArc(0.72, 0.08, 0.64, Math.PI, Math.PI / 2, 14)), [P(1, 1)]),
  )
}

function p13(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88), P(0.12, 0.72), P(0.05, 0.72)],
      dropFirst(sampleArc(0.17, 0.72, 0.12, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p14(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.52, 0.36, Math.PI / 2, 0, 12)),
      [P(1, 1)],
    ),
  )
}

function p15(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.76, 0.12, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p16(): NormalizedPoint[] {
  return closeTop(
    concat([P(0, 0.92)], dropFirst(sampleArc(0, 0.92, 0.28, Math.PI / 2, 0, 12)), [P(1, 1)]),
  )
}

function p17(): NormalizedPoint[] {
  return ogeeClassic()
}

function p18(): NormalizedPoint[] {
  return bullnose()
}

function p19(): NormalizedPoint[] {
  return closeTop(
    concat([P(0.08, 1)], dropFirst(sampleArc(1, 0, 1, Math.PI, Math.PI / 2, 18)), [P(1, 0)]),
  )
}

function p20(): NormalizedPoint[] {
  return closeTop([P(0, 0.82), P(1, 0.18)])
}

function p21(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88), P(0.12, 0.72), P(0.05, 0.72)],
      dropFirst(sampleArc(0.17, 0.72, 0.12, Math.PI / 2, 0, 8)),
      [P(1, 1)],
    ),
  )
}

function p22(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.35, 0.53, Math.PI, Math.PI / 2, 14)),
      [P(1, 1)],
    ),
  )
}

function p23(): NormalizedPoint[] {
  return closeTop([P(0, 0.88), P(0.12, 0.88), P(0.12, 0.72), P(0.05, 0.72), P(0.17, 0.6), P(1, 0)])
}

function p24(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.55, 0.33, Math.PI / 2, 0, 8)),
      dropFirst(sampleArc(0.45, 0.55, 0.12, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p25(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.24, 0.88, 0.12, Math.PI, Math.PI / 2, 8)),
      dropFirst(sampleArc(0.36, 0.55, 0.33, Math.PI / 2, 0, 10)),
      [P(1, 1)],
    ),
  )
}

function p26(): NormalizedPoint[] {
  return closeTop([P(0, 0.55), P(0.5, 0.85), P(1, 0.55)])
}

function p27(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.62)],
      dropFirst(sampleArc(0.25, 0.62, 0.25, Math.PI, 0, 8)),
      dropFirst(sampleArc(0.75, 0.62, 0.25, Math.PI, 0, 8)),
      [P(1, 1)],
    ),
  )
}

function p28(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.72), P(0.32, 0.72)],
      dropFirst(sampleArc(0.5, 0.72, 0.18, Math.PI, 0, 12)),
      [P(0.68, 0.72), P(0.68, 0.35), P(1, 1)],
    ),
  )
}

function p29(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.55)],
      dropFirst(sampleArc(0.5, 0.55, 0.18, Math.PI, 0, 12)),
      [P(1, 1)],
    ),
  )
}

function p30(): NormalizedPoint[] {
  return closeTop([P(0, 0.72), P(0.5, 0.42), P(1, 0.72)])
}

function p31(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.1, 0.88), P(0.1, 0.72), P(0.18, 0.72), P(0.18, 0.56), P(0.26, 0.56)],
      dropFirst(sampleArc(0.26, 0.38, 0.18, Math.PI / 2, 0, 10)),
      [P(1, 1)],
    ),
  )
}

function p32(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.1, 0.88), P(0.1, 0.72), P(0.18, 0.72), P(0.18, 0.56)],
      dropFirst(sampleArc(0.18, 0.38, 0.18, Math.PI / 2, 0, 10)),
      [P(1, 1)],
    ),
  )
}

function p33(): NormalizedPoint[] {
  return closeTop([P(0, 0.92), P(0.85, 0.07), P(1, 0.15)])
}

function p34(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88), P(0.12, 0.72)],
      dropFirst(sampleArc(0.24, 0.72, 0.12, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p35(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.55, 0.33, Math.PI / 2, 0, 12)),
      [P(1, 1)],
    ),
  )
}

function p36(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0, 0.55, 0.45, Math.PI / 2, 0, 12)),
      [P(0.45, 0.1), P(1, 1)],
    ),
  )
}

function p37(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.35, 0.53, Math.PI, Math.PI / 2, 14)),
      [P(1, 1)],
    ),
  )
}

function p38(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.12, 0.88)],
      dropFirst(sampleArc(0.12, 0.52, 0.36, Math.PI / 2, 0, 12)),
      [P(1, 1)],
    ),
  )
}

function p39(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.72)],
      dropFirst(sampleArc(0.25, 0.72, 0.25, Math.PI / 2, 0, 8)),
      dropFirst(sampleArc(0.75, 0.72, 0.25, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p40(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.72)],
      dropFirst(sampleArc(0.25, 0.72, 0.25, Math.PI, Math.PI / 2, 8)),
      dropFirst(sampleArc(0.75, 0.72, 0.25, Math.PI / 2, 0, 8)),
      [P(1, 1)],
    ),
  )
}

function p301(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0.12, 0.88, 0.12, Math.PI, Math.PI / 2, 6)),
      [P(0.88, 1)],
      dropFirst(sampleArc(0.88, 0.88, 0.12, Math.PI / 2, 0, 6)),
    ),
  )
}

function p302(): NormalizedPoint[] {
  return wavyTop(24, 3, 0.78, 0.14)
}

function p303(): NormalizedPoint[] {
  return closeTop(
    concat(
      [P(0, 0.88), P(0.1, 0.88), P(0.1, 0.72), P(0.2, 0.72)],
      dropFirst(sampleArc(0.2, 0.55, 0.17, Math.PI / 2, 0, 8)),
      [P(0.37, 0.38), P(0.55, 0.38), P(0.55, 0.22), P(1, 1)],
    ),
  )
}

function p304(): NormalizedPoint[] {
  const r = 0.08
  return closeTop(
    concat(
      dropFirst(sampleArc(r, 1 - r, r, Math.PI, Math.PI / 2, 6)),
      [P(0.35, 1)],
      dropFirst(sampleArc(0.43, 1 - r, r, Math.PI, Math.PI / 2, 6)),
      [P(1, 1)],
    ),
  )
}

function p305(): NormalizedPoint[] {
  const r = 0.14
  return closeTop(
    concat(
      dropFirst(sampleArc(r, 1 - r, r, Math.PI, Math.PI / 2, 8)),
      [P(0.45, 1)],
      dropFirst(sampleArc(0.59, 1 - r, r, Math.PI, Math.PI / 2, 8)),
      [P(1, 1)],
    ),
  )
}

function p306(): NormalizedPoint[] {
  return closeTop([
    P(0, 0.92),
    P(0.08, 0.92),
    P(0.08, 0.84),
    P(0.16, 0.84),
    P(0.16, 0.76),
    P(0.24, 0.76),
    P(0.24, 0.68),
    P(0.32, 0.68),
    P(0.32, 0.6),
    P(0.4, 0.6),
    P(0.4, 0.52),
    P(1, 1),
  ])
}

function p307(): NormalizedPoint[] {
  const r = 0.07
  return closeTop(
    concat(
      dropFirst(sampleArc(r, 1 - r, r, Math.PI, Math.PI / 2, 5)),
      [P(0.28, 1)],
      dropFirst(sampleArc(0.35, 1 - r, r, Math.PI, Math.PI / 2, 5)),
      [P(0.58, 1)],
      dropFirst(sampleArc(0.65, 1 - r, r, Math.PI, Math.PI / 2, 5)),
      [P(1, 1)],
    ),
  )
}

function p308(): NormalizedPoint[] {
  return closeTop(
    concat([P(0.15, 1)], dropFirst(sampleArc(0.5, 0.75, 0.25, Math.PI, 0, 14)), [P(0.85, 1)]),
  )
}

function p309(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0.12, 0.88, 0.12, Math.PI, Math.PI / 2, 6)),
      [P(0.35, 0.95)],
      dropFirst(sampleArc(0.5, 0.8, 0.2, Math.PI / 2, 0, 8)),
      [P(0.7, 0.88)],
      dropFirst(sampleArc(0.82, 0.88, 0.1, Math.PI, Math.PI / 2, 6)),
      [P(1, 1)],
    ),
  )
}

function p310(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0.15, 0.55, 0.4, Math.PI / 2, 0, 10)),
      dropFirst(sampleArc(0.55, 0.55, 0.2, Math.PI, Math.PI / 2, 10)),
      [P(1, 1)],
    ),
  )
}

function p311(): NormalizedPoint[] {
  return closeTop(
    concat(
      dropFirst(sampleArc(0.15, 0.88, 0.15, Math.PI, Math.PI / 2, 8)),
      dropFirst(sampleArc(0.55, 0.52, 0.36, Math.PI / 2, 0, 10)),
      [P(1, 1)],
    ),
  )
}

const BUILDERS: Record<RouterPresetId, () => NormalizedPoint[]> = {
  '1': p01,
  '2': p02,
  '3': p03,
  '4': p04,
  '5': p05,
  '6': p06,
  '7': p07,
  '8': p08,
  '12': p12,
  '13': p13,
  '14': p14,
  '15': p15,
  '16': p16,
  '17': p17,
  '18': p18,
  '19': p19,
  '20': p20,
  '21': p21,
  '22': p22,
  '23': p23,
  '24': p24,
  '25': p25,
  '26': p26,
  '27': p27,
  '28': p28,
  '29': p29,
  '30': p30,
  '31': p31,
  '32': p32,
  '33': p33,
  '34': p34,
  '35': p35,
  '36': p36,
  '37': p37,
  '38': p38,
  '39': p39,
  '40': p40,
  '301': p301,
  '302': p302,
  '303': p303,
  '304': p304,
  '305': p305,
  '306': p306,
  '307': p307,
  '308': p308,
  '309': p309,
  '310': p310,
  '311': p311,
}

const LABELS: Record<RouterPresetId, string> = {
  '1': '1',
  '2': '2',
  '3': '3 — Hilton',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '12': '12',
  '13': '13',
  '14': '14',
  '15': '15',
  '16': '16',
  '17': '17',
  '18': '18',
  '19': '19',
  '20': '20',
  '21': '21',
  '22': '22',
  '23': '23',
  '24': '24',
  '25': '25',
  '26': '26',
  '27': '27',
  '28': '28',
  '29': '29',
  '30': '30',
  '31': '31',
  '32': '32',
  '33': '33',
  '34': '34',
  '35': '35',
  '36': '36',
  '37': '37',
  '38': '38',
  '39': '39',
  '40': '40',
  '301': '301',
  '302': '302',
  '303': '303',
  '304': '304',
  '305': '305',
  '306': '306',
  '307': '307',
  '308': '308',
  '309': '309',
  '310': '310',
  '311': '311',
}

/** Chart row-major order: 6 rows x 8 columns */
export const CATALOG_PRESET_ORDER: RouterPresetId[] = [
  '1', '2', '3', '4', '5', '6', '7', '8',
  '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35',
  '36', '37', '38', '39', '40', '301', '302', '303',
  '304', '305', '306', '307', '308', '309', '310', '311',
]

export const CATALOG_PRESET_GRID: RouterPresetDef[] = CATALOG_PRESET_ORDER.map((id) =>
  build(id, LABELS[id], BUILDERS[id]()),
)

export function isCatalogPresetId(id: string): id is RouterPresetId {
  return id in BUILDERS
}

export function catalogBoundary(id: RouterPresetId): NormalizedPoint[] {
  return cloneBoundary(BUILDERS[id]())
}
