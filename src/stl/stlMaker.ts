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
import { flipPolygonSetY, type PolygonSet, type SilhouettePolygons } from '../util/maskPolygon'

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

async function processRows(
  height: number,
  rowFn: (y: number) => string[],
  onProgress: ProgressFn | undefined,
  phase: string,
  chunkRows: number,
): Promise<string[]> {
  const all: string[] = []
  for (let y = 0; y < height; y++) {
    all.push(...rowFn(y))
    if (chunkRows > 0 && y % chunkRows === chunkRows - 1) {
      onProgress?.({ phase, current: y + 1, total: height })
      await new Promise((r) => requestAnimationFrame(r))
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
        facets.push(
          ...emitRingPrism(
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
    facets.push(
      ...emitRingPrism(silhouette, mask, 0, colorStackTop, flatPrismOpts, polyWidthMm),
    )
  }

  if (includeTextureCap && borderHeight > 0) {
    facets.push(
      ...emitRingPrism(
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
 * border ring is exported as `layer-border.stl` for separate slicer materials.
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
  },
): Promise<Blob> {
  const { onProgress, signal, rowChunk = 2 } = options
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
  const flatPrismOpts: PrismOptions = {
    genInstruction,
    translate: [
      -genInstruction.colorPixelWidth / 2,
      -genInstruction.colorPixelWidth / 2,
      0,
    ],
    applyCurve: false,
  }
  const texturePrismOpts: PrismOptions = {
    genInstruction,
    translate: [
      -genInstruction.texturePixelWidth / 2,
      -genInstruction.texturePixelWidth / 2,
      0,
    ],
    applyCurve: true,
  }
  const polyWidthMm = silhouetteFlipped.length
    ? polygonSpanX(silhouetteFlipped)
    : genInstruction.destImageWidth

  const zip = new JSZip()

  if (options.previewColorPng) {
    zip.file('image-color-preview.png', options.previewColorPng)
  }
  if (options.previewTexturePng) {
    zip.file('image-texture-preview.png', options.previewTexturePng)
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
      -genInstruction.plateThickness,
      0,
      flatPrismOpts,
      polyWidthMm,
    )
    zip.file('layer-plate.stl', concatFacets(plateFacets))
    onProgress?.({ phase: 'plate', current: 1, total: 1 })

    checkAbort()

    onProgress?.({ phase: 'border', current: 0, total: 1 })
    const borderFacets = buildBorderFacets(
      silhouetteFlipped,
      maskFlipped,
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
      zip.file('layer-border.stl', concatFacets(borderFacets))
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
        onProgress?.({
          phase: `color-${colorName}-${i + 1}`,
          current: colorJob,
          total: totalColorJobs,
        })
        const facets = await processRows(
          colorImage.height,
          (y) => runColorRow(csgWorkData, y),
          undefined,
          'color',
          rowChunk,
        )
        if (facets.length > 0) {
          zip.file(`${threadName}.stl`, concatFacets(facets))
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
    )

    zip.file(`${threadName}.stl`, concatFacets(facets))
  }

  checkAbort()

  return zip.generateAsync({ type: 'blob' })
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
