import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import { Palette } from '../palette/palette'
import {
  applyPolygonStencil,
  checkRatio,
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
 * `sourceImage` is expected to already be the "rectified composite" — the
 * photo placed in mm space with the border ring filled white and everything
 * outside the silhouette transparent. Coordinates inside the image map 1:1
 * to the polygon mm space (origin at top-left, x = mm).
 *
 * The stencil polygon depends on `stencilMode`:
 *  - `'preview'` (default): clips to the silhouette polygon so the full
 *    visible composite (photo + white border ring) shows in the preview.
 *  - `'stl'`: clips to the mask polygon, removing the border ring from the
 *    raster — the polygon-prism pass in stlMaker.ts provides that border
 *    as smooth vector geometry instead.
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

  const stencilPoly =
    stencilMode === 'stl' ? polygons.maskPolygonMm : polygons.silhouettePolygonMm

  if (genInstruction.colorLayer) {
    const colorCanvas = resizeImage(
      sourceImage,
      genInstruction.destImageWidth,
      genInstruction.destImageHeight,
      genInstruction.colorPixelWidth,
    )
    const colorData = getImageDataFromCanvas(colorCanvas)
    applyPolygonStencil(
      colorData,
      stencilPoly,
      0,
      0,
      genInstruction.colorPixelWidth,
      stencilMode,
    )
    colorImage = await palette.quantizeColors(colorData)
  }

  if (genInstruction.textureLayer) {
    const texCanvas = resizeImage(
      sourceImage,
      genInstruction.destImageWidth,
      genInstruction.destImageHeight,
      genInstruction.texturePixelWidth,
    )
    const texData = getImageDataFromCanvas(texCanvas)
    applyPolygonStencil(
      texData,
      stencilPoly,
      0,
      0,
      genInstruction.texturePixelWidth,
      stencilMode,
    )
    textureImage = convertToBlackAndWhite(texData)
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
