// SPDX-License-Identifier: GPL-2.0-or-later
// Public FreeType 2 freetype.h / ftimage.h records, not private driver fields.
export interface FreeTypeLayout {
  readonly longBytes: 4 | 8;
  readonly signedLong: "i32" | "i64";
  readonly unsignedLong: "u32" | "u64";
  readonly faceGlyph: number;
  readonly slotFormat: number;
  readonly slotBitmap: number;
  readonly slotOutline: number;
}

const lp64: FreeTypeLayout = {
  longBytes: 8, signedLong: "i64", unsignedLong: "u64",
  faceGlyph: 152, slotFormat: 144, slotBitmap: 152, slotOutline: 200,
};
const llp64: FreeTypeLayout = {
  longBytes: 4, signedLong: "i32", unsignedLong: "u32",
  faceGlyph: 120, slotFormat: 96, slotBitmap: 104, slotOutline: 152,
};

/** Unsupported ABIs fail before loading or reading native memory. */
export function freeTypeLayout(platform: string, arch: string, byteOrder: string): FreeTypeLayout | null {
  if (byteOrder !== "LE") return null;
  if (platform === "win32" && arch === "x64") return llp64;
  if ((platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64")) return lp64;
  return null;
}

export function freeTypeMetric(view: DataView, offset: number, layout: FreeTypeLayout): number {
  if (layout.longBytes === 4) return view.getInt32(offset, true);
  const value = view.getBigInt64(offset, true);
  if (value < -2147483648n || value > 2147483647n) throw new RangeError("FreeType metric exceeds source int32");
  return Number(value);
}

/** Reject malformed native row lengths before allocating or copying. */
export function freeTypeBitmapLength(width: number, height: number, pitch: number, pixelMode: number): number {
  if (!Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0
    || !Number.isInteger(pitch) || Math.abs(pitch) > 0x7fffffff)
    throw new RangeError("Invalid FreeType bitmap dimensions");
  let rowBytes: number;
  switch (pixelMode) {
    case 0: if (width !== 0 && height !== 0) throw new RangeError("Nonempty FreeType bitmap has no pixel mode"); rowBytes = 0; break;
    case 1: rowBytes = Math.ceil(width / 8); break;
    case 2: case 5: case 6: rowBytes = width; break;
    case 3: rowBytes = Math.ceil(width / 4); break;
    case 4: rowBytes = Math.ceil(width / 2); break;
    case 7: rowBytes = width * 4; break;
    default: throw new RangeError("Unsupported FreeType pixel mode");
  }
  const length = Math.abs(pitch) * height;
  if (height > 0 && Math.abs(pitch) < rowBytes || !Number.isSafeInteger(length) || length > 64 * 1024 * 1024)
    throw new RangeError("FreeType bitmap exceeds row or 64 MiB allocation bounds");
  return length;
}

/** A native allocation copied from its lowest address must reverse negative-pitch rows. */
export function normalizeFreeTypeBitmapRows(bytes: Uint8Array, height: number, pitch: number): void {
  if (!Number.isInteger(height) || height < 0 || !Number.isInteger(pitch)
    || !Number.isSafeInteger(height * Math.abs(pitch)) || bytes.length !== height * Math.abs(pitch))
    throw new RangeError("FreeType bitmap storage does not match its rows");
  if (pitch >= 0 || height < 2) return;
  const stride = -pitch, temporary = new Uint8Array(stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    temporary.set(bytes.subarray(top * stride, (top + 1) * stride));
    bytes.copyWithin(top * stride, bottom * stride, (bottom + 1) * stride);
    bytes.set(temporary, bottom * stride);
  }
}
