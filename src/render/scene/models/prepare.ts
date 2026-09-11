/* Scene model assembly from Q1 r_alias.c/r_sprite.c, Q2 gl_mesh.c and
 * Q3 tr_mesh.c/tr_surface.c. Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Vec2, Vec4 } from "../../../contracts/math.ts";
import type { DrawBatch } from "../../../contracts/render.ts";
import type { DecodedModel, ModelVertex, Q2AliasModel, SceneEntity } from "../../../contracts/scene.ts";
import { add3, addPointToBounds, dot3, emptyBounds, length3, radiusFromBounds, scale3, sub3 } from "../../../core/math.ts";
import { buildMd2Geometry, buildMdlGeometry, interpolateAliasFrames, sampleTimedFrame } from "../../../formats/q12-model/animation.ts";
import { interpolateMd3Frames } from "../../../formats/q3-model/md3.ts";
import { skinMd4Surface } from "../../../formats/q3-model/md4.ts";
import { sampleMd5Pose, skinMd5Mesh } from "../../../formats/q3-model/md5.ts";
import type { MaterialGeometry } from "../../../materials/geometry.ts";
import { q2AliasLight, q2ShellColor } from "./lighting.ts";
import { q1SpriteGeometry, spriteQuad } from "./sprites.ts";
import { at, attachSceneEntity, modelAttachmentTag, modelLocalDelta, modelWorldDirection, modelWorldPoint } from "./transform.ts";
import { byteColor } from "./types.ts";
import { q2BeamGeometry } from "../particles/legacy.ts";
import type { ModelBatchContext, ModelImageSelection, ModelPreparationContext, ModelSourceOptions, PreparedModelEntity, PreparedModelSurface } from "./types.ts";

function countFrames(model: DecodedModel): number {
  return model.kind === "brush-model" ? 1 : model.frames.length;
}

function repairFrames(entity: SceneEntity): { frame: number; previousFrame: number; backLerp: number; fallback: boolean } {
  if (entity.pose.kind === "skeleton") return { frame: 0, previousFrame: 0, backLerp: 0, fallback: false };
  let { frame, previousFrame, backLerp } = entity.pose;
  if (!Number.isInteger(frame) || !Number.isInteger(previousFrame) || !Number.isFinite(backLerp)) throw new RangeError("Invalid scene model pose");
  if (entity.flags.kind === "q2" && (entity.flags.bits & 128) !== 0) return { frame, previousFrame, backLerp, fallback: false };
  const count = countFrames(entity.model);
  if (count === 0) throw new RangeError("Scene model has no animation frames");
  if (entity.model.kind === "q2-sp2" || entity.model.kind === "md5" || entity.flags.kind === "q3" && (entity.flags.bits & 512) !== 0) {
    frame %= count; previousFrame %= count;
  }
  const badFrame = frame < 0 || frame >= count, badOld = previousFrame < 0 || previousFrame >= count;
  if (entity.flags.kind === "q3" && (badFrame || badOld)) { frame = 0; previousFrame = 0; }
  else { if (badFrame) frame = 0; if (badOld) previousFrame = 0; }
  if (frame === previousFrame && entity.model.kind !== "q2-md2") backLerp = 0;
  return { frame, previousFrame, backLerp, fallback: badFrame || badOld };
}

function selectedShader(name: string, shaders: readonly string[], entity: SceneEntity, options: ModelSourceOptions): ModelImageSelection {
  if (options.customShader != null) return { kind: "external", name: options.customShader };
  if (options.customSkin != null) {
    const selected = options.customSkin.find(surface => surface.name === name);
    return selected === undefined ? { kind: "default", reason: "missing-skin-surface" } : { kind: "external", name: selected.shader };
  }
  if (shaders.length === 0) return { kind: "default", reason: "no-skin" };
  const index = entity.model.kind === "q3-md3" ? entity.skin % shaders.length : entity.skin >= 0 && entity.skin < shaders.length ? entity.skin : 0;
  return { kind: "external", name: at(shaders, index, "model skin") };
}

function lodIndex(entity: SceneEntity, count: number, radius: number, context: ModelPreparationContext, options: ModelSourceOptions): number {
  let lod = 0;
  if (count > 1) {
    const distance = Math.fround(dot3(context.camera.axis[0], entity.transform.origin) - dot3(context.camera.axis[0], context.camera.origin));
    const matrix = context.camera.projection;
    const projected = distance > 0 ? Math.min(Math.fround(Math.fround(radius * matrix[5] - distance * matrix[9] + matrix[13])
      / Math.fround(radius * matrix[7] - distance * matrix[11] + matrix[15])), 1) : 0;
    const fraction = projected !== 0 ? Math.fround(1 - Math.fround(projected * Math.min(options.lodScale ?? 5, 20))) : 0;
    lod = Math.max(0, Math.min(count - 1, Math.trunc(Math.fround(fraction * count))));
  }
  return Math.max(0, Math.min(count - 1, lod + (options.lodBias ?? 0)));
}

/** Q2 stores scaled packed coordinates after interpolating translation and origin. */
export function interpolateSceneMd2(model: Q2AliasModel, entity: SceneEntity, frame: number, oldFrame: number, backLerp: number,
  shell: boolean): readonly ModelVertex[] {
  const current = at(model.frames, frame, "MD2 frame"), old = at(model.frames, oldFrame, "MD2 old frame");
  const delta = modelLocalDelta(entity.transform, sub3(entity.previousOrigin, entity.transform.origin));
  const front = 1 - backLerp;
  const move = { x: backLerp * (delta.x + old.translation.x) + front * current.translation.x,
    y: backLerp * (delta.y + old.translation.y) + front * current.translation.y,
    z: backLerp * (delta.z + old.translation.z) + front * current.translation.z };
  return current.compressedVertices.map((vertex, index) => {
    const previous = at(old.compressedVertices, index, "MD2 old vertex"), normal = at(current.vertices, index, "MD2 normal").normal;
    return { normal, position: {
      x: Math.fround(move.x + previous.position[0] * (backLerp * old.scale.x) + vertex.position[0] * (front * current.scale.x) + (shell ? normal.x * 4 : 0)),
      y: Math.fround(move.y + previous.position[1] * (backLerp * old.scale.y) + vertex.position[1] * (front * current.scale.y) + (shell ? normal.y * 4 : 0)),
      z: Math.fround(move.z + previous.position[2] * (backLerp * old.scale.z) + vertex.position[2] * (front * current.scale.z) + (shell ? normal.z * 4 : 0)),
    } };
  });
}

function cullGeometry(bounds: Bounds | null, context: ModelPreparationContext): PreparedModelEntity["cull"] {
  if (context.noCull === true || context.frustum === undefined || bounds === null) return "clip";
  let clipped = false;
  for (const plane of context.frustum) {
    const near = { x: plane.normal.x >= 0 ? bounds.min.x : bounds.max.x,
      y: plane.normal.y >= 0 ? bounds.min.y : bounds.max.y, z: plane.normal.z >= 0 ? bounds.min.z : bounds.max.z };
    const far = { x: plane.normal.x >= 0 ? bounds.max.x : bounds.min.x,
      y: plane.normal.y >= 0 ? bounds.max.y : bounds.min.y, z: plane.normal.z >= 0 ? bounds.max.z : bounds.min.z };
    if (dot3(far, plane.normal) <= plane.distance) return "out";
    if (dot3(near, plane.normal) <= plane.distance) clipped = true;
  }
  return clipped ? "clip" : "in";
}

export function prepareSceneEntity(entity: SceneEntity, context: ModelPreparationContext): PreparedModelEntity {
  const options = context.options?.(entity) ?? {}, pose = repairFrames(entity), surfaces: PreparedModelSurface[] = [];
  const flags = entity.flags, bits = flags.bits, model = entity.model;
  const shell = flags.kind === "q2" ? q2ShellColor(bits) : null;
  const portal = context.camera.clip.kind === "portal";
  const personalModel = flags.kind === "q3" && (bits & 2) !== 0 && !portal;
  const invisibleWeapon = (flags.kind === "q3" && (bits & 4) !== 0 && portal)
    || (flags.kind === "q2" && (bits & 4) !== 0 && options.leftHand === 2);
  const translucent = flags.kind === "q2" ? (bits & (32 | 128)) !== 0 : entity.color.w < 1;
  const alpha = translucent ? entity.color.w : 1;
  const color = byteColor({ ...entity.color, w: alpha });
  let lod = 0;
  function append(name: string, image: ModelImageSelection, vertices: readonly (ModelVertex & { readonly texCoord: Vec2; readonly color?: Vec4 })[],
    indices: readonly number[], unlit = false, world = false): void {
    const localGeometry: MaterialGeometry = { indices, vertices: vertices.map((vertex, corner) => {
      const sampled = context.lightVertex?.(entity, vertex.normal, vertex.position);
      const light = context.finalVertexLight?.(entity, vertex.normal, vertex.position, corner) ?? (flags.kind === "q2"
        ? q2AliasLight(bits, sampled ?? { x: 1, y: 1, z: 1 }, context.timeSeconds, false, options.infrared)
        : sampled ?? { x: 1, y: 1, z: 1 });
      const base = vertex.color ?? color;
      const lit = unlit && shell === null ? base : { x: base.x * light.x, y: base.y * light.y, z: base.z * light.z, w: base.w };
      return { ...vertex, lightmapCoord: { x: 0, y: 0 }, color: lit };
    }) };
    const geometry = world ? localGeometry : { indices, vertices: localGeometry.vertices.map(vertex => ({ ...vertex,
      position: modelWorldPoint(entity.transform, vertex.position), normal: modelWorldDirection(entity.transform, vertex.normal) })) };
    const depthHack = flags.kind === "q2" ? (bits & 16) !== 0 : flags.kind === "q3" && (bits & 8) !== 0;
    surfaces.push({ name, entity, transform: entity.transform, image, localGeometry, geometry,
      depthRange: depthHack ? [0, 0.3] : [0, 1], cull: model.kind === "q1-spr" || model.kind === "q2-sp2" ? "none" : "back",
      alphaTest: model.kind === "q1-spr" ? "gt0" : model.kind === "q2-sp2" && alpha === 1 ? "ge128" : "none",
      translucent, unlit: unlit || shell !== null, mirrorWeapon: flags.kind === "q2" && (bits & 4) !== 0 && options.leftHand === 1 });
  }
  const { frame, previousFrame, backLerp } = pose;
  if (flags.kind === "q2" && (bits & 128) !== 0) {
    const palette = context.paletteColor?.(entity, entity.skin & 255);
    if (palette === undefined) throw new Error("Q2 beam preparation requires its source palette");
    const geometry = q2BeamGeometry(entity.transform.origin, entity.previousOrigin, frame, { ...palette, w: entity.color.w * 255 });
    append("beam", { kind: "white" }, geometry.vertices, geometry.indices, true, true);
  } else switch (model.kind) {
    case "q1-mdl": {
      const current = sampleTimedFrame(at(model.frames, frame, "MDL frame"), context.timeSeconds, options.syncBase ?? 0);
      const previous = sampleTimedFrame(at(model.frames, previousFrame, "MDL old frame"), context.timeSeconds, options.syncBase ?? 0);
      const geometry = buildMdlGeometry(model, interpolateAliasFrames(current, previous, backLerp));
      const skin = entity.skin >= 0 && entity.skin < model.skins.length ? entity.skin : 0;
      const skinFrames = at(model.skins, skin, "MDL skin");
      const pixels = sampleTimedFrame(skinFrames, context.timeSeconds, options.syncBase ?? 0);
      const skinFrame = skinFrames.kind === "single" ? 0 : skinFrames.frames.findIndex(item => item.frame === pixels);
      append("alias", { kind: "indexed", name: `${entity.resource.id}:skin:${skin}:${skinFrame}`, width: model.skinWidth,
        height: model.skinHeight, pixels, transparentIndex: null, fullbright: true }, geometry.vertices, geometry.indices);
      break;
    }
    case "q2-md2": {
      const geometry = buildMd2Geometry(model, interpolateSceneMd2(model, entity, frame, previousFrame, backLerp, shell !== null));
      append("alias", shell === null ? selectedShader("alias", model.skins, entity, options) : { kind: "white" }, geometry.vertices, geometry.indices, shell !== null);
      break;
    }
    case "q3-md3": {
      const choices = options.q3Lods ?? [model];
      lod = lodIndex(entity, choices.length, radiusFromBounds(at(model.frames, frame, "MD3 frame").bounds), context, options);
      const selected = at(choices, lod, "MD3 LOD");
      if (selected === null) throw new RangeError(`Missing source MD3 LOD slot ${lod}`);
      for (const surface of selected.surfaces) {
        const current = at(surface.frames, frame, "MD3 frame");
        const vertices = backLerp === 0 ? current : interpolateMd3Frames(current, at(surface.frames, previousFrame, "MD3 old frame"), backLerp);
        append(surface.name, selectedShader(surface.name, surface.shaders, entity, options),
          vertices.map((vertex, index) => ({ ...vertex, texCoord: at(surface.textureCoordinates, index, "MD3 UV") })), surface.indices);
      }
      break;
    }
    case "q3-md4": {
      lod = lodIndex(entity, model.lods.length, at(model.frames, frame, "MD4 frame").radius, context, options);
      for (const surface of at(model.lods, lod, "MD4 LOD").surfaces) {
        const vertices = skinMd4Surface(model, surface, frame, previousFrame, backLerp);
        append(surface.name, selectedShader(surface.name, [surface.shader], entity, options),
          vertices.map((vertex, index) => ({ ...vertex, texCoord: at(surface.vertices, index, "MD4 UV").texCoords })), surface.triangles.flatMap(triangle => triangle.indices));
      }
      break;
    }
    case "md5": {
      const selection = model.skinSelection;
      const elapsedFrame = selection.kind === "q1-mdl-replacement" && selection.timing.kind === "elapsed-time"
        ? Math.floor((context.timeSeconds + (options.syncBase ?? 0)) * selection.timing.frameRate) % model.frames.length : null;
      const joints = entity.pose.kind === "skeleton" ? entity.pose.joints : elapsedFrame === null
        ? sampleMd5Pose(model, frame, previousFrame, backLerp) : sampleMd5Pose(model, elapsedFrame);
      for (const [index, mesh] of model.meshes.entries()) {
        const vertices = skinMd5Mesh(mesh, joints).map(vertex => shell === null ? vertex : { ...vertex, position: add3(vertex.position, scale3(vertex.normal, 4)) });
        let shaders: readonly string[];
        if (selection.kind === "q2-md2-replacement") shaders = selection.skins;
        else if (selection.kind === "q1-mdl-replacement") {
          const groups = at(selection.meshSkinGroups, index, "Q1 replacement mesh skin");
          shaders = groups.map(group => sampleTimedFrame(group, context.timeSeconds, options.syncBase ?? 0));
        } else shaders = [mesh.shader];
        append(`mesh${index}`, shell === null ? selectedShader(`mesh${index}`, shaders, entity, options) : { kind: "white" },
          vertices.map((vertex, index) => ({ ...vertex, texCoord: at(mesh.vertices, index, "MD5 UV").texCoord })), mesh.indices, shell !== null);
      }
      break;
    }
    case "q1-spr": {
      const frames = at(model.frames, frame, "SPR frame");
      const selected = sampleTimedFrame(frames, context.timeSeconds, options.syncBase ?? 0);
      const subframe = frames.kind === "single" ? 0 : frames.frames.findIndex(item => item.frame === selected);
      const geometry = q1SpriteGeometry(model, selected, entity.transform, context.camera, color, options.spriteRoll ?? 0);
      append("sprite", { kind: "indexed", name: `${entity.resource.id}:frame:${frame}:${subframe}`, width: selected.width, height: selected.height,
        pixels: selected.pixels, transparentIndex: 255, fullbright: true }, geometry.vertices, geometry.indices, true, true);
      break;
    }
    case "q2-sp2": {
      const selected = at(model.frames, frame, "SP2 frame");
      const geometry = spriteQuad(entity.transform.origin, context.camera.axis, {
        left: -selected.originX * entity.transform.scale.x, right: (selected.width - selected.originX) * entity.transform.scale.x,
        top: (selected.height - selected.originY) * entity.transform.scale.z, bottom: -selected.originY * entity.transform.scale.z,
      }, color, portal && context.camera.clip.kind === "portal" && context.camera.clip.mirror);
      append("sprite", { kind: "external", name: selected.image }, geometry.vertices, geometry.indices, true, true);
      break;
    }
    case "brush-model": break;
  }
  let bounds: Bounds | null = null;
  for (const surface of surfaces) for (const vertex of surface.geometry.vertices) bounds = addPointToBounds(bounds ?? emptyBounds(), vertex.position);
  const cull = invisibleWeapon ? "out" : cullGeometry(bounds, context);
  const attachments: PreparedModelEntity[] = [], missingAttachments: string[] = [];
  const repaired = entity.pose.kind === "frame" ? { ...entity, pose: { ...entity.pose, frame, previousFrame, backLerp } } : entity;
  for (const attachment of entity.attachments) {
    const tag = modelAttachmentTag(repaired, attachment.tag);
    if (tag === null) missingAttachments.push(attachment.tag);
    else attachments.push(prepareSceneEntity(attachSceneEntity(repaired, attachment.entity, tag), context));
  }
  return { entity, frame, previousFrame, frameFallback: pose.fallback, lod, bounds, cull, personalModel,
    surfaces, attachments, missingAttachments, modelEffectFlags: model.kind === "q1-mdl" ? model.flags
      : model.kind === "md5" && model.skinSelection.kind === "q1-mdl-replacement" ? model.skinSelection.flags : 0 };
}

export function prepareSceneEntityBatches(entity: SceneEntity, context: ModelPreparationContext, material: ModelBatchContext): readonly DrawBatch[] {
  return preparedModelBatches(prepareSceneEntity(entity, context), material);
}

export function preparedModelBatches(model: PreparedModelEntity, material: ModelBatchContext): readonly DrawBatch[] {
  const own = model.cull === "out" || model.personalModel ? [] : model.surfaces.flatMap(surface => material.draw(surface));
  return [...own, ...model.attachments.flatMap(attachment => preparedModelBatches(attachment, material))];
}

export function modelProjectedRadius(entity: SceneEntity, radius: number, context: ModelPreparationContext): number {
  const distance = length3(sub3(entity.transform.origin, context.camera.origin));
  return distance === 0 ? 1 : radius / distance;
}
