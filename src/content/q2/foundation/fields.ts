import { nativeAtof, nativeAtoi } from "../../../core/numeric.ts";
import { parseQ2Token } from "../../../core/common-parse.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2Edition, Q2GameOptions, Q2SpawnFields } from "./host.ts";

export function numberField(fields: Q2SpawnFields, key: string, fallback = 0): number {
  const value = fields.values.get(key);
  return value === undefined ? fallback : nativeAtof(value);
}

export function integerField(fields: Q2SpawnFields, key: string, fallback = 0): number {
  const value = fields.values.get(key);
  return value === undefined ? fallback : nativeAtoi(value);
}

export function vectorField(fields: Q2SpawnFields, key: string): Vec3 {
  const values = (fields.values.get(key) ?? "").trim().split(/\s+/);
  return { x: nativeAtof(values[0] ?? "0"), y: nativeAtof(values[1] ?? "0"), z: nativeAtof(values[2] ?? "0") };
}

/** ED_NewString changes backslash-n to LF and removes other escape introducers. */
function entityString(value: string): string { return value.replace(/\\(.)/gs, (_match, escaped: string) => escaped === "n" ? "\n" : "\\"); }

function entityToken(state: { readonly data: string; index: number }, limit: number): { readonly kind: "eof" } | { readonly kind: "token"; readonly value: string } {
  let index = state.index;
  for (;;) {
    while (index < state.data.length && state.data.charCodeAt(index) > 0 && state.data.charCodeAt(index) <= 32) index++;
    if (index >= state.data.length || state.data.charCodeAt(index) === 0) return { kind: "eof" };
    if (state.data[index] !== "/" || state.data[index + 1] !== "/") break;
    while (index < state.data.length && state.data.charCodeAt(index) !== 0 && state.data[index] !== "\n") index++;
  }
  // COM_Parse's data pointer distinguishes EOF from a valid empty quoted token.
  return { kind: "token", value: parseQ2Token(state, limit) };
}

export function parseQ2Entities(source: string, edition: Q2Edition = "classic"): readonly Q2SpawnFields[] {
  const state = { data: source, index: 0 };
  const entities: Q2SpawnFields[] = [];
  const limit = edition === "classic" ? 128 : 512;
  for (;;) {
    const token = entityToken(state, limit);
    if (token.kind === "eof") break;
    if (token.value !== "{") throw new Error(`Q2 entity ${entities.length}: expected opening brace`);
    const values = new Map<string, string>();
    for (;;) {
      const key = entityToken(state, limit);
      if (key.kind === "eof") throw new Error(`Q2 entity ${entities.length}: EOF without closing brace`);
      if (key.value === "}") break;
      const value = entityToken(state, limit);
      if (value.kind === "eof" || value.value === "}") throw new Error(`Q2 entity ${entities.length}: missing value for ${key.value}`);
      values.set(key.value, entityString(value.value));
    }
    entities.push({ ordinal: entities.length, classname: values.get("classname") ?? "", values });
  }
  return entities;
}

export function inhibitQ2Spawn(fields: Q2SpawnFields, options: Q2GameOptions): boolean {
  if (fields.classname === "worldspawn") return false;
  const flags = integerField(fields, "spawnflags");
  if (options.mode === "deathmatch") return (flags & 2048) !== 0;
  if (options.edition === "rerelease") {
    if (options.mode === "coop" && (flags & 4096) !== 0) return true;
    if (options.mode !== "coop" && (flags & 16384) !== 0) return true;
  }
  return (flags & (options.skill === 0 ? 256 : options.skill === 1 ? 512 : 1024)) !== 0;
}

export function movedir(angles: Vec3): Vec3 {
  if (angles.x === 0 && angles.y === -1 && angles.z === 0) return { x: 0, y: 0, z: 1 };
  if (angles.x === 0 && angles.y === -2 && angles.z === 0) return { x: 0, y: 0, z: -1 };
  const yaw = angles.y * Math.PI / 180, pitch = angles.x * Math.PI / 180;
  return { x: Math.cos(pitch) * Math.cos(yaw), y: Math.cos(pitch) * Math.sin(yaw), z: -Math.sin(pitch) };
}

export function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: Vec3, factor: number): Vec3 { return { x: a.x * factor, y: a.y * factor, z: a.z * factor }; }
export function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function length(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
export function normalize(a: Vec3): Vec3 { const magnitude = length(a); return magnitude === 0 ? a : scale(a, 1 / magnitude); }
export const zero: Vec3 = { x: 0, y: 0, z: 0 };
