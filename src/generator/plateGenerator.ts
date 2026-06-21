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
import { buildBorderRingPolygons, type SilhouettePolygons } from '../util/maskPolygon'
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
    const cpw = genInstruction.colorPixelWidth
    const colorCanvas = resizeImage(sourceImage, destW, destH, cpw)
    let colorData = getImageDataFromCanvas(colorCanvas)
    colorData = await palette.quantizeColors(colorData)

    // In 'stl' mode, shift the stencil rasterizer origin so its pixel area in
    // world coordinates matches where the cuboid emitter actually places each
    // cuboid (`[x*pw + xOff - pw/2, x*pw + xOff + pw/2]`). Without this shift
    // the stencil decision is made about a different world area than the
    // cuboid, leaving up to a `pw/2` gap between the lithophane edge cuboids
    // and the border ring's inner wall. Preview mode keeps origin (0, 0) so
    // it stays aligned with `compositeBorderRing`.
    const colorXOff = (destW - colorCanvas.width * cpw) / 2
    const colorYOff = (destH - colorCanvas.height * cpw) / 2
    const colorStencilOriginX = stencilMode === 'stl' ? colorXOff - cpw / 2 : 0
    const colorStencilOriginY = stencilMode === 'stl' ? colorYOff - cpw / 2 : 0

    applyPolygonStencil(
      colorData,
      maskPolygonMm,
      colorStencilOriginX,
      colorStencilOriginY,
      cpw,
      stencilMode,
    )
    if (stencilMode === 'preview') {
      const { ringInner, ringOuter } = buildBorderRingPolygons(
        maskPolygonMm,
        silhouettePolygonMm,
        genInstruction.borderOverlapMm,
      )
      compositeBorderRing(
        colorData,
        ringInner,
        ringOuter,
        destW,
        destH,
        cpw,
      )
    }
    colorImage = colorData
  }

  if (genInstruction.textureLayer) {
    const tpw = genInstruction.texturePixelWidth
    const texCanvas = resizeImage(sourceImage, destW, destH, tpw)
    let texData = getImageDataFromCanvas(texCanvas)
    texData = convertToBlackAndWhite(texData)

    const texXOff = (destW - texCanvas.width * tpw) / 2
    const texYOff = (destH - texCanvas.height * tpw) / 2
    const texStencilOriginX = stencilMode === 'stl' ? texXOff - tpw / 2 : 0
    const texStencilOriginY = stencilMode === 'stl' ? texYOff - tpw / 2 : 0

    applyPolygonStencil(
      texData,
      maskPolygonMm,
      texStencilOriginX,
      texStencilOriginY,
      tpw,
      stencilMode,
    )
    if (stencilMode === 'preview') {
      const { ringInner, ringOuter } = buildBorderRingPolygons(
        maskPolygonMm,
        silhouettePolygonMm,
        genInstruction.borderOverlapMm,
      )
      compositeBorderRing(
        texData,
        ringInner,
        ringOuter,
        destW,
        destH,
        tpw,
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
