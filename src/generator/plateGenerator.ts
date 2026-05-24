import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import { Palette } from '../palette/palette'
import {
  applyPolygonStencil,
  checkRatio,
  compositeBorderRing,
  convertToBlackAndWhite,
  flipImage,
  getImageDataFromCanvas,
  imageDataToCanvas,
  resizeImage,
} from '../util/imageUtil'
import type { SilhouettePolygons } from '../util/maskPolygon'
import { buildZip, type ProgressFn } from '../stl/stlMaker'

export type { SilhouettePolygons } from '../util/maskPolygon'

export interface PlateGeneratorOptions {
  onProgress?: ProgressFn
  signal?: AbortSignal
  /** Required: vector silhouette in mm space matching the rectified source image. */
  polygons: SilhouettePolygons
}

export interface PreviewImages {
  colorImage: ImageData | null
  textureImage: ImageData | null
}

/**
 * Build the palette-quantized color preview and the B&W texture preview at
 * the resolutions used by the STL generator (`colorPixelWidth` and
 * `texturePixelWidth` respectively). The same call powers both:
 *  - the on-screen previews in main.ts, and
 *  - the `image-color-preview.png` / `image-texture-preview.png` saved into
 *    the exported zip, so the two always match.
 *
 * `sourceImage` is the photo-only rectified composite — photo placed in mm
 * space, clipped to the mask, transparent elsewhere. Coordinates map 1:1 to
 * polygon mm space (origin at top-left, x = mm).
 *
 * Pipeline per layer: resize → lithophane process → mask stencil → (preview
 * only) fine-vector border composite.
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
): Promise<PreviewImages> {
  let colorImage: ImageData | null = null
  let textureImage: ImageData | null = null

  const { maskPolygonMm, silhouettePolygonMm } = polygons
  const destW = genInstruction.destImageWidth
  const destH = genInstruction.destImageHeight

  if (genInstruction.colorLayer) {
    const colorCanvas = resizeImage(
      sourceImage,
      destW,
      destH,
      genInstruction.colorPixelWidth,
    )
    let colorData = getImageDataFromCanvas(colorCanvas)
    colorData = await palette.quantizeColors(colorData)
    applyPolygonStencil(
      colorData,
      maskPolygonMm,
      0,
      0,
      genInstruction.colorPixelWidth,
      stencilMode,
    )
    if (stencilMode === 'preview') {
      compositeBorderRing(
        colorData,
        maskPolygonMm,
        silhouettePolygonMm,
        destW,
        destH,
        genInstruction.colorPixelWidth,
      )
    }
    colorImage = colorData
  }

  if (genInstruction.textureLayer) {
    const texCanvas = resizeImage(
      sourceImage,
      destW,
      destH,
      genInstruction.texturePixelWidth,
    )
    let texData = getImageDataFromCanvas(texCanvas)
    texData = convertToBlackAndWhite(texData)
    applyPolygonStencil(
      texData,
      maskPolygonMm,
      0,
      0,
      genInstruction.texturePixelWidth,
      stencilMode,
    )
    if (stencilMode === 'preview') {
      compositeBorderRing(
        texData,
        maskPolygonMm,
        silhouettePolygonMm,
        destW,
        destH,
        genInstruction.texturePixelWidth,
      )
    }
    textureImage = texData
  }

  return { colorImage, textureImage }
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

  const stlPreviews = await buildPreviewImages(sourceImage, polygons, palette, genInstruction, 'stl')

  // For the PNG previews in the zip, also build a smooth-edged preview pass
  // (anti-aliased) so the exported images look great regardless of grid size.
  const visualPreviews = await buildPreviewImages(
    sourceImage,
    polygons,
    palette,
    genInstruction,
    'preview',
  )
  const previewColorBlob = visualPreviews.colorImage
    ? await canvasToBlob(canvasFromImageData(visualPreviews.colorImage))
    : null
  const previewTextureBlob = visualPreviews.textureImage
    ? await canvasToBlob(canvasFromImageData(visualPreviews.textureImage))
    : null

  const flipColor = stlPreviews.colorImage ? flipImage(stlPreviews.colorImage) : null
  const flipTexture = stlPreviews.textureImage ? flipImage(stlPreviews.textureImage) : null

  return buildZip(flipColor, flipTexture, palette, genInstruction, {
    previewColorPng: previewColorBlob,
    previewTexturePng: previewTextureBlob,
    polygons,
    onProgress: options.onProgress,
    signal: options.signal,
  })
}

function canvasFromImageData(imageData: ImageData): HTMLCanvasElement {
  return imageDataToCanvas(imageData)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
