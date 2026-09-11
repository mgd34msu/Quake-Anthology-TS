/* Source CIN_DrawCinematic/CIN_UploadCinematic buffer and resampling rules.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { RoqFramePointer } from "./roq-playback.ts";
import type { RoqDecoderScratch } from "./roq.ts";
import type { ImageLevel } from "../contracts/render.ts";

/** Q3 wall movies read a fixed 256-square region of linbuf, including retained neighboring bytes. */
export function sourceRoqShaderPixels(scratch: RoqDecoderScratch, pointer: RoqFramePointer): ImageLevel {
  return { width: 256, height: 256, pixels: scratch.view(pointer.offset, 256 * 256 * 4).slice() };
}

/** Invoke after the queued rendering barrier to capture the source's live linbuf bytes. */
export function sourceRoqUiPixels(scratch: RoqDecoderScratch, pointer: RoqFramePointer,
  width: number, height: number, drawWidth: number, drawHeight: number, dirty: boolean): ImageLevel {
  if (!dirty || (width === drawWidth && height === drawHeight)) {
    return { width: drawWidth, height: drawHeight, pixels: scratch.view(pointer.offset, drawWidth * drawHeight * 4).slice() };
  }
  const source = scratch.view(pointer.offset, 512 * 512 * 4);
  const result = new Uint8Array(256 * 256 * 4);
  const xm = Math.trunc(width / 256), ym = Math.trunc(height / 256), shift = width === 512 ? 9 : 8;
  const read = (index: number): number => {
    const value = source[index];
    if (value === undefined) throw new RangeError("Source cinematic resample exceeded linbuf");
    return value;
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let channel = 0; channel < 4; channel++) {
    let value: number;
    if (xm === 2 && ym === 2) {
      const index = (y << 12) + x * 8 + channel;
      value = (read(index) + read(index + 4) + read(index + 2048) + read(index + 2052)) >> 2;
    } else if (xm === 2 && ym === 1) {
      const index = (y << 11) + x * 8 + channel;
      value = (read(index) + read(index + 4)) >> 1;
    } else value = read((((y * ym) << shift) + x * xm) * 4 + channel);
    result[(y * 256 + x) * 4 + channel] = value;
  }
  return { width: 256, height: 256, pixels: result };
}
