/* Selection and interpolation adapted from Q1 r_alias.c/r_sprite.c and
 * Q2 gl_mesh.c. Copyright (C) 1996-2001 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec2, Vec3 } from "../../contracts/math.ts";
import type { Palette, RenderImage } from "../../contracts/render.ts";
import type { ModelFrame, ModelVertex, Q1AliasModel, Q1SpriteModel, Q2AliasModel, TimedFrames } from "../../contracts/scene.ts";
import { at } from "./common.ts";

/** Q1 stores cumulative endpoints, not durations. A boundary selects the next frame. */
export function sampleTimedFrame<T>(frames: TimedFrames<T>, timeSeconds: number, syncBase = 0): T {
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(syncBase)) throw new RangeError("Animation time must be finite");
  if (frames.kind === "single") return frames.frame;
  const last = at(frames.frames, frames.frames.length - 1, "group frame");
  const time = timeSeconds + syncBase;
  const target = time - Math.trunc(time / last.intervalSeconds) * last.intervalSeconds;
  for (const item of frames.frames) {
    if (item.intervalSeconds > target) return item.frame;
  }
  return last.frame;
}

/** Q1 and Q2 light the current pose's normal while interpolating vertex positions. */
export function interpolateAliasFrames(current: ModelFrame, previous: ModelFrame, backLerp: number,
  previousOriginDelta: Vec3 = { x: 0, y: 0, z: 0 }): readonly ModelVertex[] {
  if (!Number.isFinite(backLerp) || backLerp < 0 || backLerp > 1) throw new RangeError("backLerp must be in 0..1");
  if (current.vertices.length !== previous.vertices.length) throw new RangeError("Alias poses have different vertex counts");
  const frontLerp = 1 - backLerp;
  return current.vertices.map((vertex, index) => {
    const old = at(previous.vertices, index, "previous vertex");
    return { normal: vertex.normal, position: {
      x: Math.fround(vertex.position.x * frontLerp + (old.position.x + previousOriginDelta.x) * backLerp),
      y: Math.fround(vertex.position.y * frontLerp + (old.position.y + previousOriginDelta.y) * backLerp),
      z: Math.fround(vertex.position.z * frontLerp + (old.position.z + previousOriginDelta.z) * backLerp),
    } };
  });
}

export interface AliasMeshVertex extends ModelVertex { readonly texCoord: Vec2; }
export interface AliasGeometry { readonly vertices: readonly AliasMeshVertex[]; readonly indices: readonly number[]; }

/** Expand corners so back-facing seam vertices can use the other half of the skin. */
export function buildMdlGeometry(model: Q1AliasModel, pose: readonly ModelVertex[]): AliasGeometry {
  const vertices: AliasMeshVertex[] = [];
  const indices: number[] = [];
  for (const triangle of model.triangles) {
    for (const index of triangle.vertices) {
      const vertex = at(pose, index, "pose vertex");
      const coordinate = at(model.textureCoordinates, index, "texture coordinate");
      const s = coordinate.s + (!triangle.front && coordinate.onSeam ? model.skinWidth / 2 : 0);
      indices.push(vertices.length);
      vertices.push({ ...vertex, texCoord: { x: (s + 0.5) / model.skinWidth, y: (coordinate.t + 0.5) / model.skinHeight } });
    }
  }
  return { vertices, indices };
}

export function buildMd2Geometry(model: Q2AliasModel, pose: readonly ModelVertex[]): AliasGeometry {
  const vertices: AliasMeshVertex[] = [];
  const indices: number[] = [];
  for (const triangle of model.triangles) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = at(pose, at(triangle.vertices, corner, "triangle vertex"), "pose vertex");
      const coordinate = at(model.textureCoordinates, at(triangle.texCoords, corner, "triangle coordinate"), "texture coordinate");
      indices.push(vertices.length);
      vertices.push({ ...vertex, texCoord: { x: (coordinate.x + 0.5) / model.skinWidth, y: (coordinate.y + 0.5) / model.skinHeight } });
    }
  }
  return { vertices, indices };
}

export function mdlSkinImage(model: Q1AliasModel, skin: number, palette: Palette, timeSeconds = 0, syncBase = 0): RenderImage {
  const pixels = sampleTimedFrame(at(model.skins, skin, "skin"), timeSeconds, syncBase);
  return {
    kind: "indexed8", levels: [{ width: model.skinWidth, height: model.skinHeight, pixels }],
    palette, transparency: { kind: "opaque" }, fullbright: { first: 224, last: 255 }, translation: null,
  };
}

export function sprFrameImage(model: Q1SpriteModel, frame: number, palette: Palette, timeSeconds = 0, syncBase = 0): RenderImage {
  const selected = sampleTimedFrame(at(model.frames, frame, "sprite frame"), timeSeconds, syncBase);
  return {
    kind: "indexed8", levels: [{ width: selected.width, height: selected.height, pixels: selected.pixels }],
    palette, transparency: { kind: "index", index: 255 }, fullbright: { first: 224, last: 254 }, translation: null,
  };
}
