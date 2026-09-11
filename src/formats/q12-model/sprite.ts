/* SPR/SP2 adapted from quake-1-re-ts/ref_soft/model.ts,
 * quake-2-re-ts/ref_gl/gl_model.ts and original spritegn.h/qfiles.h.
 * Copyright (C) 1996-2001 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds } from "../../contracts/math.ts";
import type { Q1SpriteModel, Q2SpriteModel, SpriteFrame, TimedFrames } from "../../contracts/scene.ts";
import { BinaryReader } from "../../core/binary/index.ts";
import { count, fail, readTimed, syncType, unionBounds, version } from "./common.ts";

function orientation(reader: BinaryReader): Q1SpriteModel["orientation"] {
  const value = reader.i32();
  switch (value) {
    case 0: case 1: case 2: case 3: case 4: return value;
    default: return fail(reader, `invalid sprite orientation ${value}`);
  }
}

function spriteFrame(reader: BinaryReader): SpriteFrame {
  const originX = reader.i32();
  const originY = reader.i32();
  const width = count(reader, "sprite width");
  const height = count(reader, "sprite height");
  return { originX, originY, width, height, pixels: reader.bytes(width * height) };
}

export function parseSpr(data: Uint8Array, source = "<spr>"): Q1SpriteModel {
  const reader = new BinaryReader(data, source);
  reader.expectMagic("IDSP");
  version(reader, 1);
  const type = orientation(reader);
  const boundingRadius = reader.finiteF32();
  const maxWidth = count(reader, "sprite maximum width");
  const maxHeight = count(reader, "sprite maximum height");
  const frameCount = count(reader, "sprite frames");
  const beamLength = reader.finiteF32();
  const sync = syncType(reader);
  if (boundingRadius < 0) fail(reader, "negative sprite radius");
  reader.dataView(reader.offset, frameCount * 21);
  const frames: TimedFrames<SpriteFrame>[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(readTimed(reader, () => spriteFrame(reader)));
  return {
    kind: "q1-spr", orientation: type, boundingRadius, maxWidth, maxHeight, beamLength, sync, frames,
    bounds: { min: { x: -maxWidth / 2, y: -maxWidth / 2, z: -maxHeight / 2 }, max: { x: maxWidth / 2, y: maxWidth / 2, z: maxHeight / 2 } },
  };
}

/** Conservative bounds for the camera-facing SP2 quad at every orientation. */
function spriteBounds(frame: Q2SpriteModel["frames"][number]): Bounds {
  const right = Math.max(Math.abs(frame.originX), Math.abs(frame.width - frame.originX));
  const up = Math.max(Math.abs(frame.originY), Math.abs(frame.height - frame.originY));
  const radius = Math.hypot(right, up);
  return { min: { x: -radius, y: -radius, z: -radius }, max: { x: radius, y: radius, z: radius } };
}

export function parseSp2(data: Uint8Array, source = "<sp2>"): Q2SpriteModel {
  const reader = new BinaryReader(data, source);
  reader.expectMagic("IDS2");
  version(reader, 2);
  const frameCount = count(reader, "sprite frames");
  reader.dataView(reader.offset, frameCount * 80);
  const frames: Q2SpriteModel["frames"][number][] = [];
  for (let i = 0; i < frameCount; i++) {
    const width = count(reader, "sprite width");
    const height = count(reader, "sprite height");
    const originX = reader.i32();
    const originY = reader.i32();
    const image = reader.fixedByteString(64);
    frames.push({ width, height, originX, originY, image });
  }
  return { kind: "q2-sp2", frames, bounds: unionBounds(frames.map(spriteBounds)) };
}
