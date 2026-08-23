/** Mirrors ggo.pixestl.generator.GenInstruction */

export const PixelCreationMethod = {
  ADDITIVE: 'ADDITIVE',
  FULL: 'FULL',
} as const
export type PixelCreationMethod = (typeof PixelCreationMethod)[keyof typeof PixelCreationMethod]

export const ColorDistanceComputation = {
  RGB: 'RGB',
  CIELab: 'CIELab',
} as const
export type ColorDistanceComputation =
  (typeof ColorDistanceComputation)[keyof typeof ColorDistanceComputation]

export interface GenInstruction {
  pixelCreationMethod: PixelCreationMethod
  colorDistanceComputation: ColorDistanceComputation
  destImageWidth: number
  destImageHeight: number
  plateThickness: number
  colorPixelWidth: number
  colorPixelLayerThickness: number
  colorPixelLayerNumber: number
  texturePixelWidth: number
  textureMinThickness: number
  textureMaxThickness: number
  /** Extra Z (mm) added on top of photo texture from dark mask grayscale. */
  maskMaxThickness: number
  layerThreadMaxNumber: number
  rowThreadNumber: number
  layerThreadTimeout: number
  rowThreadTimeout: number
  curve: number
  colorLayer: boolean
  textureLayer: boolean
  debug: boolean
  lowMemory: boolean
  colorNumber: number
  /** Z-height (mm) of the white-border ring, independent of border XY width. */
  borderHeightMm: number
  /** Inward shift (mm) of both border ring edges; printed width stays unchanged. */
  borderOverlapMm: number
}

export const DEFAULT_VALUE_PLATE_THICKNESS = 0.15
export const DEFAULT_VALUE_COLOR_LAYER_NUMBER = 10
export const DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS = 0.05
export const DEFAULT_VALUE_COLOR_PIXEL_WIDTH = 0.4
export const DEFAULT_VALUE_TEXTURE_MAX_THICKNESS = 2.7
export const DEFAULT_VALUE_TEXTURE_MIN_THICKNESS = 0.8
export const DEFAULT_VALUE_MASK_MAX_THICKNESS = 0.4
export const DEFAULT_VALUE_TEXTURE_PIXEL_WIDTH = 0.25
export const DEFAULT_VALUE_LAYER_THREAD_TIMEOUT = 300
export const DEFAULT_VALUE_ROW_THREAD_MAX_NUMBER =
  typeof navigator !== 'undefined' ? Math.max(1, (navigator.hardwareConcurrency ?? 4)) : 4
export const DEFAULT_VALUE_LAYER_THREAD_MAX_NUMBER = 0
export const DEFAULT_VALUE_ROW_THREAD_TIMEOUT = 120
export const DEFAULT_VALUE_COLOR_LAYER = true
export const DEFAULT_VALUE_TEXTURE_LAYER = true
export const DEFAULT_VALUE_CURVE = 0
export const DEFAULT_VALUE_BORDER_HEIGHT_MM = 3.0
export const DEFAULT_VALUE_BORDER_OVERLAP_MM = 0.4

export function createDefaultGenInstruction(): GenInstruction {
  return {
    pixelCreationMethod: PixelCreationMethod.ADDITIVE,
    colorDistanceComputation: ColorDistanceComputation.CIELab,
    destImageWidth: 0,
    destImageHeight: 0,
    plateThickness: DEFAULT_VALUE_PLATE_THICKNESS,
    colorPixelWidth: DEFAULT_VALUE_COLOR_PIXEL_WIDTH,
    colorPixelLayerThickness: DEFAULT_VALUE_COLOR_PIXEL_LAYER_THICKNESS,
    colorPixelLayerNumber: DEFAULT_VALUE_COLOR_LAYER_NUMBER,
    texturePixelWidth: DEFAULT_VALUE_TEXTURE_PIXEL_WIDTH,
    textureMinThickness: DEFAULT_VALUE_TEXTURE_MIN_THICKNESS,
    textureMaxThickness: DEFAULT_VALUE_TEXTURE_MAX_THICKNESS,
    maskMaxThickness: DEFAULT_VALUE_MASK_MAX_THICKNESS,
    layerThreadMaxNumber: DEFAULT_VALUE_LAYER_THREAD_MAX_NUMBER,
    rowThreadNumber: DEFAULT_VALUE_ROW_THREAD_MAX_NUMBER,
    layerThreadTimeout: DEFAULT_VALUE_LAYER_THREAD_TIMEOUT,
    rowThreadTimeout: DEFAULT_VALUE_ROW_THREAD_TIMEOUT,
    curve: DEFAULT_VALUE_CURVE,
    colorLayer: DEFAULT_VALUE_COLOR_LAYER,
    textureLayer: DEFAULT_VALUE_TEXTURE_LAYER,
    debug: false,
    lowMemory: false,
    colorNumber: 0,
    borderHeightMm: DEFAULT_VALUE_BORDER_HEIGHT_MM,
    borderOverlapMm: DEFAULT_VALUE_BORDER_OVERLAP_MM,
  }
}
