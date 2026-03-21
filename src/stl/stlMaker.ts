import JSZip from 'jszip'
import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import type { Palette } from '../palette/palette'
import { generateSupportPlateStl } from '../csg/csgSupportPlate'
import { runSupportRow } from '../csg/csgThreadSupportRow'
import { runColorRow } from '../csg/csgThreadColorRow'
import { runTextureRowOpaque } from '../csg/csgThreadTextureRow'
import { runTextureRowTransparent } from '../csg/csgThreadTextureTransparent'
import { CSGWorkData } from '../csg/csgWorkData'
import { writeSolidStl } from '../csg/stl'
import { hasATransparentPixel } from '../util/imageUtil'

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

export async function buildZip(
  colorImage: ImageData | null,
  texturedImage: ImageData | null,
  palette: Palette,
  genInstruction: GenInstruction,
  options: {
    previewColorPng?: Blob | null
    previewTexturePng?: Blob | null
    onProgress?: ProgressFn
    signal?: AbortSignal
    rowChunk?: number
  } = {},
): Promise<Blob> {
  const { onProgress, signal, rowChunk = 2 } = options
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  if (colorImage && hasATransparentPixel(colorImage) && genInstruction.curve !== 0) {
    throw new Error('Curve mode not compatible with image with transparency')
  }

  const zip = new JSZip()

  if (options.previewColorPng) {
    zip.file('image-color-preview.png', options.previewColorPng)
  }
  if (options.previewTexturePng) {
    zip.file('image-texture-preview.png', options.previewTexturePng)
  }

  checkAbort()

  if (colorImage) {
    if (!hasATransparentPixel(colorImage)) {
      onProgress?.({ phase: 'plate', current: 0, total: 1 })
      const plateStl = generateSupportPlateStl(colorImage, genInstruction)
      zip.file('layer-plate.stl', plateStl)
      onProgress?.({ phase: 'plate', current: 1, total: 1 })
    } else {
      const csgWorkData = new CSGWorkData(colorImage, texturedImage, palette, 'plate', [], genInstruction)
      const facets = await processRows(
        colorImage.height,
        (y) => runSupportRow(csgWorkData, y),
        onProgress,
        'support-plate',
        rowChunk,
      )
      zip.file('layer-plate.stl', concatFacets(facets))
    }

    checkAbort()

    let nbColorPlate = 1
    let colorPlateLayerNb = -1
    if (genInstruction.curve !== 0) {
      colorPlateLayerNb = FLEXIBLE_COLOR_PLATE_NB
      nbColorPlate = Math.floor(genInstruction.colorPixelLayerNumber / FLEXIBLE_COLOR_PLATE_NB)
      nbColorPlate += genInstruction.colorPixelLayerNumber % FLEXIBLE_COLOR_PLATE_NB !== 0 ? 1 : 0
    }

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

function sanitizeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_')
}
