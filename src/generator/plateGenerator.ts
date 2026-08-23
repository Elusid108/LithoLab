import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import { Palette } from '../palette/palette'
import {
  applyPolygonStencil,
  checkRatio,
  cloneImageData,
  compositeBorderRing,
  convertToBlackAndWhite,
  flipImage,
  getImageDataFromCanvas,
  imageDataToPngBlob,
  resizeImage,
} from '../util/imageUtil'
import { buildBorderRingPolygons, type SilhouettePolygons } from '../util/maskPolygon'
import { type ProgressFn } from '../stl/stlMaker'
import { buildStlZip } from '../workers/stlZipClient'

export type { SilhouettePolygons } from '../util/maskPolygon'

export type PreviewPhase = 'quantize' | 'color-stencil' | 'texture' | 'border'

export interface PreviewProgressEvent {
  phase: PreviewPhase
  current: number
  total: number
}

export interface PlateGeneratorOptions {
  onProgress?: ProgressFn
  onPreviewProgress?: (p: PreviewProgressEvent, pass: 'stl' | 'preview') => void
  signal?: AbortSignal
  /** Required: vector silhouette in mm space matching the rectified source image. */
  polygons: SilhouettePolygons
  extraFiles?: Record<string, Blob>
}

export interface PreviewImages {
  colorImage: ImageData | null
  textureImage: ImageData | null
}

export interface PreviewAndStlImages {
  preview: PreviewImages
  stl: PreviewImages
}

function applyLayerStencils(
  quantized: ImageData,
  polygons: SilhouettePolygons,
  destW: number,
  destH: number,
  pixelMm: number,
  rasterWidth: number,
  rasterHeight: number,
  borderOverlapMm: number,
  onProgress?: (p: PreviewProgressEvent) => void,
): { preview: ImageData; stl: ImageData } {
  const xOff = (destW - rasterWidth * pixelMm) / 2
  const yOff = (destH - rasterHeight * pixelMm) / 2

  const preview = cloneImageData(quantized)
  applyPolygonStencil(preview, polygons.maskPolygonMm, 0, 0, pixelMm, 'preview')
  onProgress?.({ phase: 'border', current: 0, total: 1 })
  const { ringInner, ringOuter } = buildBorderRingPolygons(
    polygons.maskPolygonMm,
    polygons.silhouettePolygonMm,
    borderOverlapMm,
  )
  compositeBorderRing(preview, ringInner, ringOuter, destW, destH, pixelMm)

  // STL stencil origin is shifted so raster cells match cuboid placement
  // (`[x*pw + xOff - pw/2, x*pw + xOff + pw/2]`). Preview keeps (0, 0) so it
  // stays aligned with `compositeBorderRing`.
  const stl = cloneImageData(quantized)
  applyPolygonStencil(
    stl,
    polygons.maskPolygonMm,
    xOff - pixelMm / 2,
    yOff - pixelMm / 2,
    pixelMm,
    'stl',
  )

  return { preview, stl }
}

/**
 * Quantize (and convert texture) once, then produce both the on-screen /
 * ZIP preview rasters and the binary STL-clip rasters from clones.
 */
export async function buildPreviewAndStlImages(
  sourceImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  polygons: SilhouettePolygons,
  palette: Palette,
  genInstruction: GenInstruction,
  onProgress?: (p: PreviewProgressEvent) => void,
): Promise<PreviewAndStlImages> {
  const preview: PreviewImages = { colorImage: null, textureImage: null }
  const stl: PreviewImages = { colorImage: null, textureImage: null }

  const destW = genInstruction.destImageWidth
  const destH = genInstruction.destImageHeight

  if (genInstruction.colorLayer) {
    const cpw = genInstruction.colorPixelWidth
    const colorCanvas = resizeImage(sourceImage, destW, destH, cpw)
    let colorData = getImageDataFromCanvas(colorCanvas)
    colorData = await palette.quantizeColors(colorData, (p) => {
      onProgress?.({ phase: 'quantize', current: p.current, total: p.total })
    })

    onProgress?.({ phase: 'color-stencil', current: 0, total: 1 })
    const layers = applyLayerStencils(
      colorData,
      polygons,
      destW,
      destH,
      cpw,
      colorCanvas.width,
      colorCanvas.height,
      genInstruction.borderOverlapMm,
      onProgress,
    )
    preview.colorImage = layers.preview
    stl.colorImage = layers.stl
  }

  if (genInstruction.textureLayer) {
    onProgress?.({ phase: 'texture', current: 0, total: 1 })
    const tpw = genInstruction.texturePixelWidth
    const texCanvas = resizeImage(sourceImage, destW, destH, tpw)
    let texData = getImageDataFromCanvas(texCanvas)
    texData = convertToBlackAndWhite(texData)
    const layers = applyLayerStencils(
      texData,
      polygons,
      destW,
      destH,
      tpw,
      texCanvas.width,
      texCanvas.height,
      genInstruction.borderOverlapMm,
    )
    preview.textureImage = layers.preview
    stl.textureImage = layers.stl
  }

  return { preview, stl }
}

/**
 * Build the palette-quantized color preview and the B&W texture preview at
 * the resolutions used by the STL generator (`colorPixelWidth` and
 * `texturePixelWidth` respectively).
 *
 * `stencilMode`:
 *  - `'preview'`: mask clip + white border ring composited at fine resolution.
 *  - `'stl'`: mask-only binary clip; border comes from vector geometry in stlMaker.
 */
export async function buildPreviewImages(
  sourceImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  polygons: SilhouettePolygons,
  palette: Palette,
  genInstruction: GenInstruction,
  stencilMode: 'preview' | 'stl' = 'preview',
  onProgress?: (p: PreviewProgressEvent) => void,
): Promise<PreviewImages> {
  const both = await buildPreviewAndStlImages(
    sourceImage,
    polygons,
    palette,
    genInstruction,
    onProgress,
  )
  return stencilMode === 'stl' ? both.stl : both.preview
}

export async function generatePlateZip(
  sourceImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  paletteJson: string,
  genInstruction: GenInstruction,
  options: PlateGeneratorOptions,
): Promise<Blob> {
  const palette = new Palette(paletteJson, genInstruction)
  const polygons = options.polygons

  checkRatio(
    sourceImage.width,
    sourceImage.height,
    genInstruction.destImageWidth,
    genInstruction.destImageHeight,
  )

  if (
    genInstruction.pixelCreationMethod === PixelCreationMethod.FULL &&
    genInstruction.colorNumber !== 0
  ) {
    palette.restrictFullColors(sourceImage, genInstruction.colorNumber)
  }

  const both = await buildPreviewAndStlImages(
    sourceImage,
    polygons,
    palette,
    genInstruction,
    (p) => options.onPreviewProgress?.(p, p.phase === 'quantize' ? 'stl' : 'preview'),
  )
  const previewColorBlob = both.preview.colorImage
    ? await imageDataToPngBlob(both.preview.colorImage)
    : null
  const previewTextureBlob = both.preview.textureImage
    ? await imageDataToPngBlob(both.preview.textureImage)
    : null

  const flipColor = both.stl.colorImage ? flipImage(both.stl.colorImage) : null
  const flipTexture = both.stl.textureImage ? flipImage(both.stl.textureImage) : null

  return buildStlZip({
    colorImage: flipColor,
    texturedImage: flipTexture,
    palette,
    paletteJson,
    genInstruction,
    polygons,
    previewColorPng: previewColorBlob,
    previewTexturePng: previewTextureBlob,
    extraFiles: options.extraFiles,
    onProgress: options.onProgress,
    signal: options.signal,
  })
}
