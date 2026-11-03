// SPDX-License-Identifier: GPL-2.0-or-later
/** Decoded RGBA bytes a multi-frame image may retain across all its frames. */
export const MAX_ANIMATION_BYTES = 256 * 1024 * 1024;
export const MAX_ANIMATION_FRAMES = 4096;

/** Decoded RGBA bytes must stay addressable by a signed 32-bit index. */
export function imageSizeAllowed(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height * 4 <= 0x7fffffff;
}
