/* Quake and QuakeWorld pr_cmds.c; rerelease defs.qc. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import type { RandomSource } from "../../contracts/numeric.ts";
import { nativeAtof } from "../../core/numeric.ts";
import type { QcBuiltin, QcBuiltinRegistry, QcMachine } from "./machine.ts";

export type QcHostKind = "netquake" | "quakeworld" | "rerelease";
export type QcHostBuiltinName =
  | "setorigin" | "setmodel" | "setsize" | "break" | "sound" | "objerror"
  | "spawn" | "remove" | "traceline" | "checkclient" | "precache_sound" | "precache_model"
  | "stuffcmd" | "findradius" | "bprint" | "sprint" | "dprint" | "coredump" | "eprint"
  | "walkmove" | "droptofloor" | "lightstyle" | "checkbottom" | "pointcontents" | "aim"
  | "cvar" | "localcmd" | "particle" | "changeyaw" | "WriteByte" | "WriteChar" | "WriteShort"
  | "WriteLong" | "WriteCoord" | "WriteAngle" | "WriteString" | "WriteEntity" | "movetogoal"
  | "precache_file" | "makestatic" | "changelevel" | "cvar_set" | "centerprint" | "ambientsound"
  | "setspawnparms" | "logfrag" | "infokey" | "multicast" | "setcolor"
  | "ex_bprint" | "ex_sprint" | "ex_centerprint" | "ex_finaleFinished" | "ex_localsound"
  | "ex_draw_point" | "ex_draw_line" | "ex_draw_arrow" | "ex_draw_ray" | "ex_draw_circle"
  | "ex_draw_bounds" | "ex_draw_worldtext" | "ex_draw_sphere" | "ex_draw_cylinder"
  | "ex_bot_movetopoint" | "ex_bot_followentity" | "ex_CheckPlayerEXFlags" | "ex_walkpathtogoal"
  | "ex_prompt" | "ex_promptchoice" | "ex_clearprompt";
export interface QcBuiltinServices {
  readonly kind: QcHostKind;
  /** A source RNG, owned and saved by the session. No process-global Math.random. */
  readonly random?: RandomSource;
  readonly isFreeEntity?: (slot: number) => boolean;
  /** Numbered and named host calls execute to completion before QC resumes. */
  readonly host?: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  /** Advertise only behavior actually supplied by the chosen host. */
  readonly extensions?: ReadonlySet<string>;
}
export interface QcBuiltinRequirement { readonly number: number | null; readonly name: QcHostBuiltinName; }
const hostNumbers: readonly (readonly [number, QcHostBuiltinName])[] = [
  [2,"setorigin"],[3,"setmodel"],[4,"setsize"],[6,"break"],[8,"sound"],[11,"objerror"],
  [14,"spawn"],[15,"remove"],[16,"traceline"],[17,"checkclient"],[19,"precache_sound"],[20,"precache_model"],
  [21,"stuffcmd"],[22,"findradius"],[23,"bprint"],[24,"sprint"],[25,"dprint"],[28,"coredump"],[31,"eprint"],
  [32,"walkmove"],[34,"droptofloor"],[35,"lightstyle"],[40,"checkbottom"],[41,"pointcontents"],[44,"aim"],
  [45,"cvar"],[46,"localcmd"],[48,"particle"],[49,"changeyaw"],[52,"WriteByte"],[53,"WriteChar"],
  [54,"WriteShort"],[55,"WriteLong"],[56,"WriteCoord"],[57,"WriteAngle"],[58,"WriteString"],[59,"WriteEntity"],
  [67,"movetogoal"],[68,"precache_file"],[69,"makestatic"],[70,"changelevel"],[72,"cvar_set"],
  [73,"centerprint"],[74,"ambientsound"],[75,"precache_model"],[76,"precache_sound"],[77,"precache_file"],[78,"setspawnparms"],
];
const rereleaseNames: readonly QcHostBuiltinName[] = [
  "ex_bprint", "ex_sprint", "ex_centerprint", "ex_finaleFinished", "ex_localsound",
  "ex_draw_point", "ex_draw_line", "ex_draw_arrow", "ex_draw_ray", "ex_draw_circle", "ex_draw_bounds",
  "ex_draw_worldtext", "ex_draw_sphere", "ex_draw_cylinder", "ex_bot_movetopoint", "ex_bot_followentity",
  "ex_CheckPlayerEXFlags", "ex_walkpathtogoal", "ex_prompt", "ex_promptchoice", "ex_clearprompt",
];
export function qcHostRequirements(kind: QcHostKind): readonly QcBuiltinRequirement[] {
  const requirements = hostNumbers.filter(([number]) => kind !== "quakeworld" || number !== 48)
    .map(([number, name]) => ({ number, name }));
  const result: QcBuiltinRequirement[] = [...requirements];
  if (kind === "quakeworld") result.push({number:79,name:"logfrag"},{number:80,name:"infokey"},{number:82,name:"multicast"});
  if (kind === "rerelease") {
    result.push({ number: 401, name: "setcolor" });
    for (const name of rereleaseNames) result.push({ number: null, name });
  }
  return result;
}
function length(machine: QcMachine, vector: Vec3): number {
  const n = machine.numeric;
  return n.squareRoot(n.add(n.add(n.multiply(vector.x, vector.x), n.multiply(vector.y, vector.y)), n.multiply(vector.z, vector.z)));
}
function yaw(vector: Vec3): number {
  if (vector.x === 0 && vector.y === 0) return 0;
  const angle = Math.trunc(Math.atan2(vector.y, vector.x) * 180 / Math.PI);
  return angle < 0 ? angle + 360 : angle;
}
function formatFloat(value: number): string { return value.toFixed(1).padStart(5, " "); }
function makeVectors(machine: QcMachine): undefined {
  const angles = machine.argVector(0);
  const n = machine.numeric;
  const y = angles.y * Math.PI / 180;
  const p = angles.x * Math.PI / 180;
  const r = angles.z * Math.PI / 180;
  const sy = n.store(Math.sin(y)); const cy = n.store(Math.cos(y));
  const sp = n.store(Math.sin(p)); const cp = n.store(Math.cos(p));
  const sr = n.store(Math.sin(r)); const cr = n.store(Math.cos(r));
  machine.globals.setVector(machine.globalOffset("v_forward"), { x: n.multiply(cp,cy), y:n.multiply(cp,sy), z:-sp });
  machine.globals.setVector(machine.globalOffset("v_right"), {
    x:n.add(n.multiply(n.multiply(-sr,sp),cy),n.multiply(cr,sy)),
    y:n.subtract(n.multiply(n.multiply(-sr,sp),sy),n.multiply(cr,cy)), z:n.multiply(-sr,cp),
  });
  machine.globals.setVector(machine.globalOffset("v_up"), {
    x:n.add(n.multiply(n.multiply(cr,sp),cy),n.multiply(sr,sy)),
    y:n.subtract(n.multiply(n.multiply(cr,sp),sy),n.multiply(sr,cy)), z:n.multiply(cr,cp),
  });
}
/** Pure builtins are installed here. Missing engine bindings remain unbound and fail by name. */
export function createQcBuiltins(services: QcBuiltinServices): QcBuiltinRegistry {
  const numbered = new Map<number, QcBuiltin>();
  const named = new Map<string, QcBuiltin>();
  numbered.set(1, makeVectors);
  const random = services.random;
  if (random !== undefined) numbered.set(7, machine => { machine.returnFloat((random.nextInteger() & 0x7fff) / 0x7fff); });
  numbered.set(9, machine => {
    const vector = machine.argVector(0); const magnitude = length(machine, vector);
    const inverse = magnitude === 0 ? 0 : machine.numeric.divide(1, magnitude);
    machine.returnVector({ x:machine.numeric.multiply(vector.x,inverse), y:machine.numeric.multiply(vector.y,inverse), z:machine.numeric.multiply(vector.z,inverse) });
  });
  numbered.set(10, machine => machine.fail(machine.varString(0)));
  numbered.set(12, machine => { machine.returnFloat(length(machine, machine.argVector(0))); });
  numbered.set(13, machine => { machine.returnFloat(yaw(machine.argVector(0))); });
  numbered.set(26, machine => {
    const value = machine.argFloat(0);
    const text = value === Math.trunc(value) ? `${Math.trunc(value)}` : formatFloat(value);
    machine.returnInt(machine.strings.setEngine("pr_string_temp", text));
  });
  numbered.set(27, machine => {
    const value = machine.argVector(0);
    machine.returnInt(machine.strings.setEngine("pr_string_temp", `'${formatFloat(value.x)} ${formatFloat(value.y)} ${formatFloat(value.z)}'`));
  });
  numbered.set(29, machine => { machine.traceEnabled = true; });
  numbered.set(30, machine => { machine.traceEnabled = false; });
  numbered.set(36, machine => { const value = machine.argFloat(0); machine.returnFloat(Math.trunc(value > 0 ? value + 0.5 : value - 0.5)); });
  numbered.set(37, machine => { machine.returnFloat(Math.floor(machine.argFloat(0))); });
  numbered.set(38, machine => { machine.returnFloat(Math.ceil(machine.argFloat(0))); });
  numbered.set(43, machine => { machine.returnFloat(Math.abs(machine.argFloat(0))); });
  numbered.set(51, machine => {
    const vector = machine.argVector(0);
    let pitch: number;
    if (vector.x === 0 && vector.y === 0) pitch = vector.z > 0 ? 90 : 270;
    else {
      const forward = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
      pitch = Math.trunc(Math.atan2(vector.z, forward) * 180 / Math.PI);
      if (pitch < 0) pitch += 360;
    }
    machine.returnVector({x:pitch,y:yaw(vector),z:0});
  });
  const isFree = services.isFreeEntity;
  if (isFree !== undefined) {
    numbered.set(18, machine => {
      const start = machine.entities.slot(machine.argInt(0)); const field = machine.argInt(1); const match = machine.argString(2);
      for (let slot = start + 1; slot < machine.entities.count; slot++) {
        if (isFree(slot)) continue;
        const text = machine.entities.at(slot).int(field);
        if (text !== 0 && machine.strings.get(text) === match) { machine.returnInt(machine.entities.reference(slot)); return; }
      }
      machine.returnInt(0);
    });
    numbered.set(47, machine => {
      for (let slot = machine.entities.slot(machine.argInt(0)) + 1; slot < machine.entities.count; slot++) {
        if (!isFree(slot)) { machine.returnInt(machine.entities.reference(slot)); return; }
      }
      machine.returnInt(0);
    });
  }
  if (services.kind === "quakeworld") numbered.set(81, machine => { machine.returnFloat(nativeAtof(machine.argString(0))); });
  const extensions = services.extensions ?? new Set<string>();
  numbered.set(99, machine => { machine.returnFloat(extensions.has(machine.argString(0)) ? 1 : 0); });
  for (const requirement of qcHostRequirements(services.kind)) {
    const binding = services.host?.get(requirement.name);
    if (binding === undefined) continue;
    if (requirement.number === null) named.set(requirement.name, binding);
    else numbered.set(requirement.number, binding);
  }
  return { numbered, named };
}
