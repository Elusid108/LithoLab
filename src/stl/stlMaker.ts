import JSZip from 'jszip'
import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import type { Palette } from '../palette/palette'
import { runColorRow } from '../csg/csgThreadColorRow'
import { runTextureRowOpaque } from '../csg/csgThreadTextureRow'
import { runTextureRowTransparent } from '../csg/csgThreadTextureTransparent'
import { CSGWorkData } from '../csg/csgWorkData'
import { writeSolidStl } from '../csg/stl'
import { hasATransparentPixel } from '../util/imageUtil'
import { emitRingPrism, emitSilhouettePrism, type PrismOptions } from '../csg/csgPolyPrism'
import {
  buildBorderRingPolygons,
  flipPolygonSetY,
  type PolygonSet,
  type SilhouettePolygons,
} from '../util/maskPolygon'

const FLEXIBLE_COLOR_PLATE_NB = 3

export interface StlProgress {
  phase: string
  current: number
  total: number
}

export type ProgressFn = (p: StlProgress) => void

function concatFacets(facets: string[]): string {
  return writeSolidStl(facets)
}

/** Append facet strings without spread (avoids stack overflow on large meshes). */
function appendFacets(target: string[], source: string[]): void {
  for (const f of source) target.push(f)
}

function canYieldToUi(): boolean {
  return typeof requestAnimationFrame === 'function'
}

async function processRows(
  height: number,
  rowFn: (y: number) => string[],
  onProgress: ProgressFn | undefined,
  phase: string,
  chunkRows: number,
  yieldBetweenChunks: boolean,
): Promise<string[]> {
  const all: string[] = []
  for (let y = 0; y < height; y++) {
    appendFacets(all, rowFn(y))
    if (chunkRows > 0 && y % chunkRows === chunkRows - 1) {
      onProgress?.({ phase, current: y + 1, total: height })
      if (yieldBetweenChunks) {
        await new Promise((r) => requestAnimationFrame(r))
      }
    }
  }
  onProgress?.({ phase, current: height, total: height })
  return all
}

function buildBorderFacets(
  silhouette: PolygonSet,
  mask: PolygonSet,
  genInstruction: GenInstruction,
  colorStackTop: number,
  borderHeight: number,
  includeTextureCap: boolean,
  flatPrismOpts: PrismOptions,
  texturePrismOpts: PrismOptions,
  polyWidthMm: number,
  nbColorPlate: number,
  colorPlateLayerNb: number,
): string[] {
  if (silhouette.length === 0) return []

  const facets: string[] = []

  if (genInstruction.curve !== 0 && colorPlateLayerNb > 0) {
    const sliceH = genInstruction.colorPixelLayerThickness * colorPlateLayerNb
    for (let i = 0; i < nbColorPlate; i++) {
      const ringBottom = i * sliceH
      const ringTop = Math.min(colorStackTop, (i + 1) * sliceH)
      if (ringTop > ringBottom) {
        appendFacets(
          facets,
          emitRingPrism(
            silhouette,
            mask,
            ringBottom,
            ringTop,
            flatPrismOpts,
            polyWidthMm,
          ),
        )
      }
    }
  } else if (colorStackTop > 0) {
    appendFacets(
      facets,
      emitRingPrism(silhouette, mask, 0, colorStackTop, flatPrismOpts, polyWidthMm),
    )
  }

  if (includeTextureCap && borderHeight > 0) {
    appendFacets(
      facets,
      emitRingPrism(
        silhouette,
        mask,
        colorStackTop,
        colorStackTop + borderHeight,
        texturePrismOpts,
        polyWidthMm,
      ),
    )
  }

  return facets
}

/**
 * Build the export zip.
 *
 * Polygon prisms use Y-flipped mm coordinates so they align with flipped
 * color/texture rasters. Support plate follows the inner mask only; the white
 * border ring is exported as `stl/layer-border.stl` for separate slicer materials.
 */
export async function buildZip(
  colorImage: ImageData | null,
  texturedImage: ImageData | null,
  palette: Palette,
  genInstruction: GenInstruction,
  options: {
    previewColorPng?: Blob | null
    previewTexturePng?: Blob | null
    polygons: SilhouettePolygons
    onProgress?: ProgressFn
    signal?: AbortSignal
    rowChunk?: number
    extraFiles?: Record<string, Blob>
    /** Yield to the UI between row chunks (main thread). Off in workers. */
    yieldBetweenChunks?: boolean
  },
): Promise<Blob> {
  const { onProgress, signal, rowChunk = 2 } = options
  const yieldBetweenChunks = options.yieldBetweenChunks ?? canYieldToUi()
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  if (colorImage && hasATransparentPixel(colorImage) && genInstruction.curve !== 0) {
    throw new Error('Curve mode not compatible with image with transparency')
  }

  const polygons = options.polygons
  const flipH = genInstruction.destImageHeight
  const maskFlipped = flipPolygonSetY(polygons.maskPolygonMm, flipH)
  const silhouetteFlipped = flipPolygonSetY(polygons.silhouettePolygonMm, flipH)

  const colorStackTop =
    genInstruction.colorPixelLayerThickness * palette.getLayerCount()
  const borderHeight = Math.max(0, genInstruction.borderHeightMm)
  // Border/plate prism alignment to the cuboid grid (with the v2.5.2 stencil
  // origin shift of `xOff - pw/2`, each stencil cell center coincides with a
  // cuboid center):
  //   - X translate is 0. There is no X flip, so the mask edge already lands on
  //     the cuboid center; the border wall therefore sits inside the cuboid's
  //     X extent and the any-coverage cuboid straddles it on both sides. Any
  //     non-zero X translate (e.g. the old -pw/2) knocks the wall off the
  //     cuboid centers and reintroduces a left/right sliver gap of up to pw/2.
  //   - Y translate is -pw. `flipPolygonSetY` mirrors polygons around
  //     `destImageHeight/2`, putting the flipped mask point pw above the cuboid
  //     center; -pw brings the wall back onto the cuboid center, closing the
  //     top-edge gap.
  const flatPrismOpts: PrismOptions = {
    genInstruction,
    translate: [
      0,
      -genInstruction.colorPixelWidth,
      0,
    ],
    applyCurve: false,
  }
  const texturePrismOpts: PrismOptions = {
    genInstruction,
    translate: [
      0,
      -genInstruction.texturePixelWidth,
      0,
    ],
    applyCurve: true,
  }
  const polyWidthMm = silhouetteFlipped.length
    ? polygonSpanX(silhouetteFlipped)
    : genInstruction.destImageWidth

  const zip = new JSZip()

  if (options.previewColorPng) {
    zip.file('previews/image-color-preview.png', options.previewColorPng)
  }
  if (options.previewTexturePng) {
    zip.file('previews/image-texture-preview.png', options.previewTexturePng)
  }
  if (options.extraFiles) {
    for (const [name, blob] of Object.entries(options.extraFiles)) {
      zip.file(name, blob)
    }
  }

  checkAbort()

  let nbColorPlate = 1
  let colorPlateLayerNb = -1
  if (genInstruction.curve !== 0) {
    colorPlateLayerNb = FLEXIBLE_COLOR_PLATE_NB
    nbColorPlate = Math.floor(genInstruction.colorPixelLayerNumber / FLEXIBLE_COLOR_PLATE_NB)
    nbColorPlate += genInstruction.colorPixelLayerNumber % FLEXIBLE_COLOR_PLATE_NB !== 0 ? 1 : 0
  }

  if (colorImage) {
    onProgress?.({ phase: 'plate', current: 0, total: 1 })
    const plateFacets = emitSilhouettePrism(
      maskFlipped,
      0,
      genInstruction.plateThickness,
      flatPrismOpts,
      polyWidthMm,
    )
    zip.file('stl/layer-plate.stl', concatFacets(plateFacets))
    onProgress?.({ phase: 'plate', current: 1, total: 1 })

    checkAbort()

    onProgress?.({ phase: 'border', current: 0, total: 1 })
    const overlap = Math.max(0, genInstruction.borderOverlapMm)
    const { ringInner, ringOuter } = buildBorderRingPolygons(
      maskFlipped,
      silhouetteFlipped,
      overlap,
      { cellSize: Math.max(overlap / 12, 1e-6) },
    )
    const borderFacets = buildBorderFacets(
      ringOuter,
      ringInner,
      genInstruction,
      colorStackTop,
      borderHeight,
      genInstruction.textureLayer && texturedImage != null,
      flatPrismOpts,
      texturePrismOpts,
      polyWidthMm,
      nbColorPlate,
      colorPlateLayerNb,
    )
    if (borderFacets.length > 0) {
      zip.file('stl/layer-border.stl', concatFacets(borderFacets))
    }
    onProgress?.({ phase: 'border', current: 1, total: 1 })

    checkAbort()

    const colorGroups = palette.hexColorGroupList()
    const totalColorJobs = colorGroups.length * nbColorPlate
    let colorJob = 0

    for (const hexCodeList of colorGroups) {
      let colorName = ''
      for (const hexColor of hexCodeList) {
        if (colorName.length > 0) colorName += '+'
        colorName += palette.getColorName(hexColor)
      }

      for (let i = 0; i < nbColorPlate; i++) {
        checkAbort()
        const threadName =
          'layer-' + (nbColorPlate === 1 ? '' : `${i + 1}-`) + sanitizeFilename(colorName)
        const csgWorkData = new CSGWorkData(
          colorImage,
          texturedImage,
          palette,
          threadName,
          hexCodeList,
          genInstruction,
          i * colorPlateLayerNb,
          colorPlateLayerNb,
        )
        colorJob++
        const colorRowTotal = totalColorJobs * colorImage.height
        const colorRowOffset = (colorJob - 1) * colorImage.height
        onProgress?.({
          phase: 'color',
          current: colorRowOffset,
          total: colorRowTotal,
        })
        const facets = await processRows(
          colorImage.height,
          (y) => runColorRow(csgWorkData, y),
          (p) => {
            onProgress?.({
              phase: 'color',
              current: colorRowOffset + p.current,
              total: colorRowTotal,
            })
          },
          'color',
          rowChunk,
          yieldBetweenChunks,
        )
        if (facets.length > 0) {
          zip.file(`stl/${threadName}.stl`, concatFacets(facets))
        }
      }
    }
  }

  checkAbort()

  if (
    genInstruction.colorLayer &&
    genInstruction.pixelCreationMethod === PixelCreationMethod.ADDITIVE
  ) {
    const instructions = palette.generateSwapFilamentsInstruction()
    zip.file('instructions.txt', instructions)
  }

  if (genInstruction.textureLayer && texturedImage) {
    const colorList = [...palette.getColorHexList()].sort()
    const whiteColor = colorList[colorList.length - 1]
    const whiteName = sanitizeFilename(palette.getColorName(whiteColor))
    const threadName = `layer-texture-${whiteName}`
    const csgWorkData = new CSGWorkData(
      colorImage,
      texturedImage,
      palette,
      threadName,
      [whiteColor],
      genInstruction,
    )

    onProgress?.({ phase: 'texture', current: 0, total: texturedImage.height })
    const texHasAlpha = hasATransparentPixel(texturedImage)
    const facets = await processRows(
      texturedImage.height,
      texHasAlpha
        ? (y) => runTextureRowTransparent(csgWorkData, y)
        : (y) => runTextureRowOpaque(csgWorkData, y),
      onProgress,
      'texture',
      rowChunk,
      yieldBetweenChunks,
    )

    zip.file(`stl/${threadName}.stl`, concatFacets(facets))
  }

  checkAbort()

  onProgress?.({ phase: 'zip', current: 0, total: 100 })
  return zip.generateAsync({ type: 'blob' }, (metadata) => {
    onProgress?.({
      phase: 'zip',
      current: Math.max(0, Math.min(100, Math.round(metadata.percent))),
      total: 100,
    })
  })
}

function polygonSpanX(set: PolygonSet): number {
  let minX = Infinity
  let maxX = -Infinity
  for (const loop of set) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
    }
  }
  if (!isFinite(minX) || !isFinite(maxX)) return 0
  return maxX - minX
}

function sanitizeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_')
}
