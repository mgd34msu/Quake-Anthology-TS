// SPDX-License-Identifier: GPL-2.0-or-later
// Translated from id Software code/client/snd_mix.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
function value(array: Float64Array | Int32Array, index: number): number {
  const result = array[index];
  if (result === undefined) throw new RangeError(`Sound paint access outside allocation at ${index}`);
  return result;
}
function clipped(value: number): number {
  return Math.max(-32768, Math.min(32767, value >> 8));
}
/** S_WriteLinearBlastStereo16, with the source interleaved integer paint buffer. */
export function writeLinearBlastStereo16(paint: Int32Array | Float64Array, output: Int16Array, count: number): void {
  if (!Number.isInteger(count) || count < 0 || count % 2 !== 0) throw new RangeError("Stereo blast requires an even sample count");
  const convert = paint instanceof Float64Array ? (sample: number): number => Math.max(-32768, Math.min(32767, Math.floor(sample / 256))) : clipped;
  for (let index = 0; index < count; index += 2) {
    if (index + 1 >= output.length) throw new RangeError("Stereo output allocation is truncated");
    output[index] = convert(value(paint, index));
    output[index + 1] = convert(value(paint, index + 1));
  }
}
