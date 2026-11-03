// SPDX-License-Identifier: GPL-2.0-or-later
// Derives Quake monster frame tables from the QuakeC bytecode of a shipped progs.dat.
//
// A frame function `void() name = [$frame, next] { body };` compiles to a STATE statement followed by
// the body. Bodies made only of ai_* calls, sound() (optionally behind one random() comparison),
// `self.solid = SOLID_NOT` and lightstyle() map to declarative operations. Any other body becomes an
// `action` that the species controller implements, named after the first function with that body.
import { loadQcProgram, QcOpcode } from "../../src/compat/qc/program.ts";
import type { QcProgram, QcStatement } from "../../src/compat/qc/program.ts";
import type { MonsterFrame, MonsterOperation, MonsterAi } from "../../src/content/q1/base/animation.ts";

const OFS_RETURN = 1, OFS_PARM0 = 4;
const channels = new Map<number, "voice" | "weapon" | "body">([[1, "weapon"], [2, "voice"], [4, "body"]]);
const aiModes = new Map<string, MonsterAi>([["ai_stand", "stand"], ["ai_walk", "walk"], ["ai_run", "run"], ["ai_charge", "charge"],
  ["ai_charge_side", "charge_side"], ["ai_melee", "melee"], ["ai_melee_side", "melee_side"], ["ai_painforward", "painforward"],
  ["ai_turn", "turn"], ["ai_face", "face"], ["ai_pain", "pain"], ["ai_forward", "forward"]]);

export interface DerivedFrame { readonly name: string; readonly index: number; readonly frame: MonsterFrame; readonly signature: string; readonly simple: boolean; readonly empty: boolean; }

class Reader {
  readonly view: DataView;
  readonly names = new Map<number, string>();
  constructor(readonly program: QcProgram) {
    this.view = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
    for (const definition of program.globals) if (!this.names.has(definition.offset)) this.names.set(definition.offset, definition.name);
  }
  float(offset: number): number { return this.view.getFloat32(offset * 4, true); }
  int(offset: number): number { return this.view.getInt32(offset * 4, true); }
  string(offset: number): string {
    const start = this.int(offset), bytes = this.program.strings;
    let end = start; while (end < bytes.length && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(start, end));
  }
  functionName(offset: number): string | null { const fn = this.program.functions[this.int(offset)]; return fn === undefined ? null : fn.name; }
}

interface Decoded { readonly operations: MonsterOperation[]; readonly complete: boolean; }

/** Shortest decimal that reads back as the same float32, which is how the QuakeC constants were written. */
function decimal(value: number): number {
  const exact = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) { const candidate = Number(exact.toPrecision(digits)); if (Math.fround(candidate) === exact) return candidate; }
  return exact;
}

/**
 * Reads declarative operations from the start of a body. `complete` is false when anything else follows;
 * the remainder then becomes one action, as the species controllers implement.
 */
function decode(reader: Reader, body: readonly QcStatement[], callActions: boolean): Decoded {
  const operations: MonsterOperation[] = [];
  const parameters = new Map<number, number>();
  const parameter = (slot: number): number | undefined => parameters.get(OFS_PARM0 + slot * 3);
  let index = 0;
  const stop = (): Decoded => ({ operations, complete: false });
  while (index < body.length) {
    const statement = body[index];
    if (statement === undefined) return stop();
    if (statement.opcode === QcOpcode.Done) return { operations, complete: index === body.length - 1 };
    if (statement.opcode === QcOpcode.Address) {
      const store = body[index + 1];
      if (reader.names.get(statement.a) !== "self" || reader.program.fields.find(field => field.offset === reader.int(statement.b))?.name !== "solid"
        || store?.opcode !== QcOpcode.StorePF || store.b !== statement.c || reader.float(store.a) !== 0 || reader.int(store.a) !== 0) return stop();
      operations.push({ kind: "solid", solid: "none" }); index += 2; continue;
    }
    if (statement.opcode === QcOpcode.Call0 && reader.functionName(statement.a) === "random") {
      const compare = body[index + 1], branch = body[index + 2];
      if (compare === undefined || branch?.opcode !== QcOpcode.IfNot || (compare.opcode !== QcOpcode.Lt && compare.opcode !== QcOpcode.Gt)
        || compare.a !== OFS_RETURN || branch.a !== compare.c) return stop();
      const end = index + 2 + branch.b;
      const stores: QcStatement[] = [];
      let cursor = index + 3;
      for (; cursor < end - 1; cursor++) { const store = body[cursor]; if (store === undefined || store.opcode !== QcOpcode.StoreF && store.opcode !== QcOpcode.StoreS && store.opcode !== QcOpcode.StoreEnt) return stop(); stores.push(store); }
      const call = body[cursor];
      if (call?.opcode !== QcOpcode.Call5 || reader.functionName(call.a) !== "sound") return stop();
      const sound = soundOperation(reader, stores, compare.opcode === QcOpcode.Lt ? "less" : "greater", decimal(reader.float(compare.b)));
      if (sound === null) return stop();
      operations.push(sound); index = end; continue;
    }
    // Parameter stores up to a call.
    const stores: QcStatement[] = [];
    let cursor = index;
    for (; cursor < body.length; cursor++) {
      const store = body[cursor];
      if (store === undefined || store.opcode !== QcOpcode.StoreF && store.opcode !== QcOpcode.StoreS && store.opcode !== QcOpcode.StoreEnt) break;
      stores.push(store);
    }
    const call = body[cursor];
    if (call === undefined) return stop();
    for (const store of stores) parameters.set(store.b, store.a);
    const name = call.opcode >= QcOpcode.Call0 && call.opcode <= QcOpcode.Call8 ? reader.functionName(call.a) : null;
    if (name === null) return stop();
    const mode = aiModes.get(name), argument = parameter(0);
    if (mode !== undefined && call.opcode === QcOpcode.Call1 && stores.length === 1 && argument !== undefined) operations.push({ kind: "ai", mode, distance: reader.float(argument) });
    else if (mode !== undefined && call.opcode === QcOpcode.Call0 && stores.length === 0) operations.push({ kind: "ai", mode, distance: 0 });
    else if (name === "sound" && call.opcode === QcOpcode.Call5) {
      const sound = soundOperation(reader, stores, "less", null);
      if (sound === null) return stop();
      operations.push(sound);
    } else if (name === "lightstyle" && call.opcode === QcOpcode.Call2 && stores.length === 2) {
      const style = parameter(0), pattern = parameter(1);
      if (style === undefined || pattern === undefined || reader.float(style) !== 0) return stop();
      operations.push({ kind: "lightstyle", pattern: reader.string(pattern) });
    } else if (callActions && name !== "random" && stores.length <= 1 && (stores.length === 0) === (call.opcode === QcOpcode.Call0)
      && (stores.length === 0 || argument !== undefined && reader.names.get(argument) !== "self" && isFloatConstant(reader.float(argument)))) {
      operations.push({ kind: "action", name: argument === undefined || stores.length === 0 ? name : `${name}(${decimal(reader.float(argument))})` });
    } else return stop();
    for (const store of stores) parameters.delete(store.b);
    index = cursor + 1;
  }
  return { operations, complete: true };
}

/** A function or string operand read as a float is a denormal; real QuakeC float constants are not. */
function isFloatConstant(value: number): boolean { return Number.isFinite(value) && (value === 0 || Math.abs(value) > 1e-30); }

function soundOperation(reader: Reader, stores: readonly QcStatement[], comparison: "less" | "greater", chance: number | null): MonsterOperation | null {
  const slots = new Map<number, number>(stores.map(store => [store.b, store.a]));
  const [self, channel, path, volume, attenuation] = [0, 1, 2, 3, 4].map(slot => slots.get(OFS_PARM0 + slot * 3));
  if (self === undefined || channel === undefined || path === undefined || volume === undefined || attenuation === undefined || reader.names.get(self) !== "self") return null;
  const mapped = channels.get(reader.float(channel));
  if (mapped === undefined || reader.float(volume) !== 1) return null;
  return { kind: "sound", path: reader.string(path), channel: mapped, attenuation: reader.float(attenuation), comparison, chance };
}

function signature(program: QcProgram, first: number, end: number): string {
  const parts: string[] = [];
  for (let index = first; index < end; index++) {
    const s = program.statements[index];
    if (s !== undefined && s.opcode !== QcOpcode.State) parts.push(`${s.opcode}:${s.a}:${s.b}:${s.c}`);
  }
  return parts.join("|");
}

/** Every frame function whose name passes `include`, in program order. */
export function deriveFrames(bytes: Uint8Array, include: (name: string) => boolean, callActions = false): DerivedFrame[] {
  const program = loadQcProgram(bytes), reader = new Reader(program), result: DerivedFrame[] = [];
  for (const fn of program.functions) {
    if (fn.index === 0 || fn.firstStatement < 0 || !include(fn.name)) continue;
    const first = program.statements[fn.firstStatement];
    if (first === undefined || first.opcode !== QcOpcode.State) continue;
    const end = program.functionEnd(fn), next = reader.functionName(first.b);
    if (next === null) throw new Error(`${fn.name}: frame has no successor`);
    const decoded = decode(reader, program.statements.slice(fn.firstStatement + 1, end), callActions);
    result.push({ name: fn.name, index: fn.index, signature: signature(program, fn.firstStatement + 1, end), simple: decoded.complete, empty: end - fn.firstStatement <= 2,
      frame: { frame: reader.float(first.a), next, operations: decoded.operations } });
  }
  return result;
}

export interface TableStyle {
  /** Prefix for generated action names, e.g. "hiparma:". */
  readonly actionPrefix: string;
  /** Identical bodies share the action of the first function that has them. */
  readonly sharedActions: boolean;
  /** The species controller implements every frame, so no declarative operations are emitted. */
  readonly allActions?: boolean;
  /** Simple calls (`fn()` or `fn(N)`) in a body become actions named after the call instead of one action per frame. */
  readonly callActions?: boolean;
  /** A frame with any non-declarative statement carries only its action, which then also performs the declarative part. */
  readonly foldPartial?: boolean;
}

/** Resolves actions for non-declarative bodies and returns the finished frames in program order. */
export function finishFrames(derived: readonly DerivedFrame[], style: TableStyle): Map<string, MonsterFrame> {
  const actions = new Map<string, string>(), table = new Map<string, MonsterFrame>();
  for (const entry of derived) {
    if (entry.empty || entry.simple && style.allActions !== true) { table.set(entry.name, entry.frame); continue; }
    let action = style.actionPrefix + entry.name;
    if (style.sharedActions) { const shared = actions.get(entry.signature); if (shared === undefined) actions.set(entry.signature, action); else action = shared; }
    table.set(entry.name, { ...entry.frame, operations: [...(style.allActions === true || style.foldPartial === true ? [] : entry.frame.operations), { kind: "action", name: action }] });
  }
  return table;
}

/** The committed layout: one frame per line, compact JSON. */
export function renderFrames(header: string, importPath: string, exportName: string, table: ReadonlyMap<string, MonsterFrame>): string {
  const lines = [...table].map(([name, frame]) => `  [${JSON.stringify(name)}, ${JSON.stringify(frame)}],`);
  return `${header}\nimport type { MonsterFrame } from ${JSON.stringify(importPath)};\n\nexport const ${exportName}: ReadonlyMap<string, MonsterFrame> = new Map<string, MonsterFrame>([\n${lines.join("\n")}\n]);\n`;
}

export interface FrameTableTarget {
  /** Archive holding progs.dat, relative to the Quake root (the directory that contains id1/, hipnotic/, ...). */
  readonly archive: string;
  readonly include: RegExp;
  readonly output: string;
  readonly style: TableStyle;
  readonly exportName: string;
  /** Path from the output file to base/animation.ts. */
  readonly animationImport: string;
  readonly origin: string;
}

const pack = (archive: string, stem: string, include: string, output: string, origin: string, prefix = `${stem}:`): FrameTableTarget => ({
  archive, include: new RegExp(include), output: `src/content/q1/${output}`, origin, exportName: "frames",
  animationImport: "../../../base/animation.ts", style: { actionPrefix: prefix, sharedActions: true, callActions: true, foldPartial: true } });
const heavy = (stem: string, include: string, file: string): FrameTableTarget => ({ ...pack("rerelease/mg3/pak0.pak", `mg3_${stem}`, include, `addons/monsters/heavy/tables/${file}.ts`, "MG3"),
  animationImport: "../../../../base/animation.ts" });
const boss = (stem: string, include: string, prefix: string, shared: boolean): FrameTableTarget => ({ archive: "rerelease/mg3/pak0.pak", include: new RegExp(include),
  output: `src/content/q1/addons/monsters/bosses/frames/${stem}.ts`, origin: "MG3", exportName: "frames", animationImport: "../../../../base/animation.ts",
  style: { actionPrefix: prefix, sharedActions: shared, allActions: true } });

/** Every committed Q1 monster frame table and the progs.dat functions it is derived from. */
export const FRAME_TABLE_TARGETS: readonly FrameTableTarget[] = [
  { archive: "rerelease/id1/pak0.pak", include: /^(knight|zombie|wiz|tbaby|demon1|ogre|shal|sham|hknight|enf|boss|old|f_|fish|army_|dog_)/, output: "src/content/q1/base/frames.ts",
    exportName: "monsterFrames", animationImport: "./animation.ts", origin: "id1", style: { actionPrefix: "", sharedActions: false } },
  pack("rerelease/hipnotic/pak0.pak", "grunt", "^army_", "missionpacks/monsters/tables/grunt.ts", "Hipnotic"),
  pack("rerelease/hipnotic/pak0.pak", "rottweiler", "^dog_", "missionpacks/monsters/tables/rottweiler.ts", "Hipnotic"),
  pack("rerelease/hipnotic/pak0.pak", "hiparma", "^armagon_", "missionpacks/monsters/tables/hiparma.ts", "Hipnotic"),
  pack("rerelease/hipnotic/pak0.pak", "hipdecoy", "^decoy_", "missionpacks/monsters/tables/hipdecoy.ts", "Hipnotic"),
  pack("rerelease/hipnotic/pak0.pak", "hipgrem", "^gremlin_", "missionpacks/monsters/tables/hipgrem.ts", "Hipnotic"),
  pack("rerelease/hipnotic/pak0.pak", "hipscrge", "^scourge_", "missionpacks/monsters/tables/hipscrge.ts", "Hipnotic"),
  pack("rerelease/rogue/pak0.pak", "dragon", "^dragon", "missionpacks/monsters/tables/dragon.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "eel", "^eel_", "missionpacks/monsters/tables/eel.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "invis_sw", "^sword", "missionpacks/monsters/tables/invis_sw.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "lavaman", "^lavaman", "missionpacks/monsters/tables/lavaman.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "morph", "^morph", "missionpacks/monsters/tables/morph.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "mummy", "^mummy", "missionpacks/monsters/tables/mummy.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "s_wrath", "^overlord", "missionpacks/monsters/tables/s_wrath.ts", "Rogue"),
  pack("rerelease/rogue/pak0.pak", "wrath", "^wrath", "missionpacks/monsters/tables/wrath.ts", "Rogue"),
  heavy("lavaman", "^lavaman", "mg3_lavaman"), heavy("rknight", "^rknight", "mg3_rknight"), heavy("super_shambler", "^supsham", "mg3_super_shambler"),
  boss("final", "^boss_final", "", false), boss("ghost", "^ghost", "ghost:", true), boss("oldnew", "^oldnew", "oldnew:", true),
  boss("orb", "^orb", "orb:", true), boss("szombie", "^szombie", "szombie:", true),
];

export function renderTarget(target: FrameTableTarget, progs: Uint8Array): string {
  const table = finishFrames(deriveFrames(progs, name => target.include.test(name), target.style.callActions === true), target.style);
  const header = `// SPDX-License-Identifier: GPL-2.0-or-later\n// Generated by tools/content/generate-q1-monster-frames.ts from the ${target.origin} rerelease progs.dat (${target.archive}); do not edit.\n// Frame data and QuakeC calls: Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later.`;
  return renderFrames(header, target.animationImport, target.exportName, table);
}
