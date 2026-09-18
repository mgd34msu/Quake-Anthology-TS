import type { QcProgram, QcValueType } from "./program.ts";

export const qcWeaponBehaviorFields = {
  origin: "vector", velocity: "vector", angles: "vector", mins: "vector", maxs: "vector", v_angle: "vector",
  health: "float", solid: "float", nextthink: "float",
  classname: "string", netname: "string", think: "function",
} satisfies Readonly<Record<string, QcValueType>>;
export const qcWeaponBehaviorGlobals = {
  self: "entity", other: "entity",
} satisfies Readonly<Record<string, QcValueType>>;
const optionalFields = { model: "string", modelindex: "float", chain: "entity" } satisfies Readonly<Record<string, QcValueType>>;
const optionalGlobals = {
  time: "float", trace_endpos: "vector", trace_plane_normal: "vector", trace_ent: "entity",
  deathmatch: "float", coop: "float", trace_fraction: "float", trace_allsolid: "float", trace_startsolid: "float",
  trace_inwater: "float", trace_inopen: "float", trace_plane_dist: "float",
} satisfies Readonly<Record<string, QcValueType>>;
export function qcWeaponBehaviorCapabilityError(program: QcProgram): string | null {
  for (const [name, type] of Object.entries(qcWeaponBehaviorFields)) {
    const field = program.fieldsByName.get(name);
    if (field === undefined || field.type !== type) return `QuakeC trajectory adapter requires entity field ${name} of type ${type}`;
  }
  for (const [name, type] of Object.entries(qcWeaponBehaviorGlobals)) {
    const global = program.globalsByName.get(name);
    if (global === undefined || global.type !== type) return `QuakeC trajectory adapter requires global ${name} of type ${type}`;
  }
  for (const [name, type] of Object.entries(optionalFields)) {
    const field = program.fieldsByName.get(name);
    if (field !== undefined && field.type !== type) return `QuakeC trajectory adapter requires declared entity field ${name} to have type ${type}`;
  }
  for (const [name, type] of Object.entries(optionalGlobals)) {
    const global = program.globalsByName.get(name);
    if (global !== undefined && global.type !== type) return `QuakeC trajectory adapter requires declared global ${name} to have type ${type}`;
  }
  return null;
}
