/*
 * Allocation-free scalar byte conversion, following the shared C foundation
 * (include/qa/binary.h): loads/stores are plain arithmetic on caller bytes and
 * float reinterpretation reuses one scratch word instead of allocating an
 * ArrayBuffer/DataView per call. GPL-2.0-or-later.
 */

/* The scratch views are consumed synchronously; results are primitive numbers
 * copied out before any other call can reuse the word. */
const scratch = new ArrayBuffer(8);
const scratchView = new DataView(scratch);

/** Rounds to binary32 and returns its IEEE-754 bit pattern as uint32. */
export function float32Bits(value: number): number {
  scratchView.setFloat32(0, value, true);
  return scratchView.getUint32(0, true);
}

/** Returns the binary32 value stored in a uint32 bit pattern. */
export function float32FromBits(bits: number): number {
  scratchView.setUint32(0, bits >>> 0, true);
  return scratchView.getFloat32(0, true);
}

/** Returns the binary64 value stored in a uint64 bit pattern. */
export function float64FromBits(bits: bigint): number {
  scratchView.setBigUint64(0, bits, false);
  return scratchView.getFloat64(0, false);
}

/** Returns the uint64 bit pattern of a binary64 value. */
export function float64Bits(value: number): bigint {
  scratchView.setFloat64(0, value, false);
  return scratchView.getBigUint64(0, false);
}

function byteAt(data: Uint8Array, offset: number): number {
  const value = data[offset];
  if (value === undefined) throw new RangeError("Binary load offset is outside its checked span");
  return value;
}

/** Loads require a previously checked span of the corresponding width. */
export function loadU16LE(data: Uint8Array, offset: number): number {
  return byteAt(data, offset) | (byteAt(data, offset + 1) << 8);
}

export function loadU32LE(data: Uint8Array, offset: number): number {
  return (byteAt(data, offset) | (byteAt(data, offset + 1) << 8)
    | (byteAt(data, offset + 2) << 16) | (byteAt(data, offset + 3) << 24)) >>> 0;
}

export function loadI32LE(data: Uint8Array, offset: number): number {
  return loadU32LE(data, offset) | 0;
}

export function loadF32LE(data: Uint8Array, offset: number): number {
  return float32FromBits(loadU32LE(data, offset));
}

export function storeU16LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

export function storeU32LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

export function storeF32LE(data: Uint8Array, offset: number, value: number): void {
  storeU32LE(data, offset, float32Bits(value));
}
