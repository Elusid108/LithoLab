import type { GenInstruction } from '../genInstruction'
import { PixelCreationMethod } from '../genInstruction'
import { Palette } from '../palette/palette'
import {
  applyMonochromeStencilMask,
  checkRatio,
  convertToBlackAndWhite,
  flipImage,
  getImageDataFromCanvas,
  imageDataToCanvas,
  resizeImage,
} from '../util/imageUtil'
import { buildZip, type ProgressFn } from '../stl/stlMaker'

export interface PlateGeneratorOptions {
  onProgress?: ProgressFn
  signal?: AbortSignal
  maskImage?: HTMLImageElement | ImageBitmap
}

export async function generatePlateZip(
  sourceImage: HTMLImageElement | ImageBitmap,
  paletteJson: string,
  genInstruction: GenInstruction,
  options: PlateGeneratorOptions = {},
): Promise<Blob> {
  const mask = options.maskImage
  const palette = new Palette(paletteJson, genInstruction)

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

  let quantizedColorImage: ImageData | null = null
  let textureImage: ImageData | null = null
  let previewColorBlob: Blob | null = null
  let previewTextureBlob: Blob | null = null

  if (genInstruction.colorLayer) {
    const colorCanvas = resizeImage(
      sourceImage,
      genInstruction.destImageWidth,
      genInstruction.destImageHeight,
      genInstruction.colorPixelWidth,
    )
    const colorData = getImageDataFromCanvas(colorCanvas)
    if (mask) {
      const maskCanvas = resizeImage(
        mask,
        genInstruction.destImageWidth,
        genInstruction.destImageHeight,
        genInstruction.colorPixelWidth,
      )
      applyMonochromeStencilMask(colorData, getImageDataFromCanvas(maskCanvas))
    }
    quantizedColorImage = await palette.quantizeColors(colorData)
    previewColorBlob = await canvasToBlob(canvasFromImageData(quantizedColorImage))
  }

  if (genInstruction.textureLayer) {
    const texCanvas = resizeImage(
      sourceImage,
      genInstruction.destImageWidth,
      genInstruction.destImageHeight,
      genInstruction.texturePixelWidth,
    )
    textureImage = convertToBlackAndWhite(getImageDataFromCanvas(texCanvas))
    if (mask) {
      const maskCanvas = resizeImage(
        mask,
        genInstruction.destImageWidth,
        genInstruction.destImageHeight,
        genInstruction.texturePixelWidth,
      )
      applyMonochromeStencilMask(textureImage, getImageDataFromCanvas(maskCanvas))
    }
    previewTextureBlob = await canvasToBlob(canvasFromImageData(textureImage))
  }

  const flipColor = quantizedColorImage ? flipImage(quantizedColorImage) : null
  const flipTexture = textureImage ? flipImage(textureImage) : null

  return buildZip(flipColor, flipTexture, palette, genInstruction, {
    previewColorPng: previewColorBlob,
    previewTexturePng: previewTextureBlob,
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
