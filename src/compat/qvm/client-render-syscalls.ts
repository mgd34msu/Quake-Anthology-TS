/*
 * Renderer resource and picture traps from Quake III Arena cl_ui.c/cl_cgame.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
 */
import type { Vec3 } from "../../contracts/math.ts";
import type { Draw2D } from "../../text/draw2d.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import { readQvmRefEntity, readQvmRefdef, readQvmPolyVertices, QVM_REF_ENTITY_BYTES, QVM_REFDEF_BYTES, QVM_POLY_VERTEX_BYTES } from "./render-record.ts";
import { modelBounds, lerpModelTag } from "../../content/q3/presentation/model-access.ts";
import type { Q3RendererResources } from "../../content/q3/presentation/resources.ts";
import type { QvmMemory } from "./memory.ts";
import { QVM_ORIENTATION_BYTES, writeQvmOrientation } from "./render-record.ts";

interface ResourceTraps {
  readonly model: number;
  readonly skin: number;
  readonly shader: number | null;
  readonly shaderNoMip: number;
  readonly color: number;
  readonly picture: number;
  readonly bounds: number;
  readonly tag: number;
  readonly remap: number;
}
const ui: ResourceTraps = { model: 18, skin: 19, shader: null, shaderNoMip: 20,
  color: 26, picture: 27, bounds: 56, tag: 29, remap: 80 };
const cgame: ResourceTraps = { model: 37, skin: 38, shader: 39, shaderNoMip: 57,
  color: 45, picture: 46, bounds: 47, tag: 48, remap: 79 };

function writeVector(view: DataView, value: Vec3): void {
  view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
}

/** Resource/2D subset. Scene, screen and configuration traps remain separate. */
function resourceSyscall(
  role: "game" | "cgame" | "ui", words: DataView, memory: QvmMemory,
  resources: Q3RendererResources, commands: Draw2D,
): number | Promise<number> | null {
  if (role === "game") return null;
  const trap = words.getInt32(0, true), ids = role === "ui" ? ui : cgame;
  if (trap === ids.model) {
    const nameWord = words.getInt32(4, true);
    return resources.registerModel(nameWord === 0 ? "" : memory.readString(nameWord)).then(model => resources.modelHandle(model));
  }
  if (trap === ids.skin) {
    const nameWord = words.getInt32(4, true);
    return resources.registerSkin(nameWord === 0 ? "" : memory.readString(nameWord)).then(skin => resources.skinHandle(skin));
  }
  if (trap === ids.shader || trap === ids.shaderNoMip) {
    const name = memory.readString(words.getInt32(4, true));
    const pending = trap === ids.shader ? resources.registerShader(name) : resources.registerShaderNoMip(name);
    return pending.then(shader => resources.shaderHandle(shader));
  }
  if (trap === ids.color) {
    const word = words.getInt32(4, true);
    if (word === 0) commands.setColor(null);
    else {
      const color = memory.view(word, 16);
      commands.setColor({ x: color.getFloat32(0, true), y: color.getFloat32(4, true),
        z: color.getFloat32(8, true), w: color.getFloat32(12, true) });
    }
    return 0;
  }
  if (trap === ids.picture) {
    const rect = { x: words.getFloat32(4, true), y: words.getFloat32(8, true),
      width: words.getFloat32(12, true), height: words.getFloat32(16, true) };
    const uv = { s: words.getFloat32(20, true), t: words.getFloat32(24, true),
      s2: words.getFloat32(28, true), t2: words.getFloat32(32, true) };
    const shaderWord = words.getInt32(36, true);
    commands.stretchPixels(rect, uv, () => resources.picture(resources.shaderForHandle(shaderWord)));
    return 0;
  }
  if (trap === ids.bounds) {
    const modelWord = words.getInt32(4, true);
    const min = memory.view(words.getInt32(8, true), 12), max = memory.view(words.getInt32(12, true), 12);
    const bounds = modelBounds(resources.modelForHandle(modelWord));
    writeVector(min, bounds.min); writeVector(max, bounds.max);
    return 0;
  }
  if (trap === ids.tag) {
    const destination = memory.view(words.getInt32(4, true), QVM_ORIENTATION_BYTES);
    const modelWord = words.getInt32(8, true), start = words.getInt32(12, true), end = words.getInt32(16, true);
    const fraction = words.getFloat32(20, true), nameWord = words.getInt32(24, true);
    const model = resources.modelForHandle(modelWord);
    const base = model.kind === "model" ? model.model : null;
    // R_LerpTag/R_GetTag do not consume tagName when no tag storage exists.
    const tag = base === null || base.kind !== "q3-md3" || base.tags.length === 0 ? null
      : lerpModelTag(model, memory.readString(nameWord), start, end, fraction);
    if (tag === null) writeQvmOrientation(destination, { origin: { x: 0, y: 0, z: 0 },
      axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] });
    else writeQvmOrientation(destination, tag);
    // UI's switch discards LerpTag's result; cgame returns it.
    return role === "ui" || tag === null ? 0 : 1;
  }
  if (trap === ids.remap) {
    const original = memory.readString(words.getInt32(4, true)), replacement = memory.readString(words.getInt32(8, true));
    const offsetWord = words.getInt32(12, true), offset = offsetWord === 0 ? "" : memory.readString(offsetWord);
    return resources.remapShader(original, replacement, offset).then(() => 0);
  }
  return null;
}

/** Guest rendering shares the native client's resource identities and scene publication. */
export function qvmClientRenderSyscall(call: QvmHostCall, resources: Q3RendererResources, draw: Draw2D): QvmHostResult | null {
  if (call.kind !== "engine" || call.role === "qagame") return null;
  const { words, guest, role } = call;
  const resource = resourceSyscall(role, words, guest, resources, draw);
  if (resource !== null) return resource;
  const trap = call.code, ui = role === "ui";
  if (!ui && trap === 36) return resources.loadWorld(guest.readString(words.getInt32(4, true))).then(() => 0);
  if (!ui && trap === 86) return Number(resources.getEntityToken(token => guest.writeString(words.getInt32(4, true), token, words.getInt32(8, true))));
  if (!ui && trap === 88) return Number(resources.inPVS(
    () => { const point = guest.view(words.getInt32(4, true), 12); return { x: point.getFloat32(0, true), y: point.getFloat32(4, true), z: point.getFloat32(8, true) }; },
    () => { const point = guest.view(words.getInt32(8, true), 12); return { x: point.getFloat32(0, true), y: point.getFloat32(4, true), z: point.getFloat32(8, true) }; }));
  if (trap === (ui ? 21 : 40)) { resources.clearScene(); return 0; }
  if (trap === (ui ? 22 : 41)) {
    const source = readQvmRefEntity(guest.view(words.getInt32(4, true), QVM_REF_ENTITY_BYTES));
    if (source.kind === "poly") { resources.addRefEntity(source); return 0; }
    if (source.kind === "portal-surface") { resources.addRefEntity(source); return 0; }
    const customShader = typeof source.customShader === "number" ? resources.shaderForHandle(source.customShader) : source.customShader;
    if (source.kind === "model") {
      resources.addRefEntity({ ...source, customShader,
        model: typeof source.model === "number" ? resources.modelForHandle(source.model) : source.model,
        customSkin: typeof source.customSkin === "number" ? resources.skinForHandle(source.customSkin) : source.customSkin });
    } else resources.addRefEntity({ ...source, customShader });
    return 0;
  }
  if (trap === (ui ? 23 : 42) || !ui && trap === 87) {
    const shaderHandle = words.getInt32(4, true), count = words.getInt32(8, true), pointer = words.getInt32(12, true);
    const polys = trap === 87 ? words.getInt32(16, true) : 1;
    if (shaderHandle === 0 || count <= 0 || polys <= 0) return 0;
    const shader = resources.shaderForHandle(shaderHandle), stride = count * QVM_POLY_VERTEX_BYTES;
    guest.span(pointer, stride * polys);
    for (let index = 0; index < polys; index++) resources.addPoly({ shader, vertices: readQvmPolyVertices(guest.view(pointer, stride, index * stride), count) });
    return 0;
  }
  if (trap === (ui ? 24 : 43) || !ui && trap === 85) {
    const radius = words.getFloat32(8, true);
    if (radius <= 0) return 0;
    const origin = guest.view(words.getInt32(4, true), 12);
    resources.addLight({ origin: { x: origin.getFloat32(0, true), y: origin.getFloat32(4, true), z: origin.getFloat32(8, true) }, radius,
      color: { x: words.getFloat32(12, true), y: words.getFloat32(16, true), z: words.getFloat32(20, true) }, additive: trap === 85 });
    return 0;
  }
  if (trap === (ui ? 25 : 44)) {
    resources.renderScene(readQvmRefdef(guest.view(words.getInt32(4, true), QVM_REFDEF_BYTES))); return 0;
  }
  return null;
}
