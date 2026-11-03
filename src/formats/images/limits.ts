/** Game-scale decode limits shared by every image decoder (Q3 textures top out near 2048 to 4096 pixels). */
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 8192 * 8192;
/** Decoded RGBA bytes a multi-frame image may retain across all its frames. */
export const MAX_ANIMATION_BYTES = 256 * 1024 * 1024;
export const MAX_ANIMATION_FRAMES = 4096;

export function imageSizeAllowed(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION && width * height <= MAX_IMAGE_PIXELS;
}
