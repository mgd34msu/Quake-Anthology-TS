import { QcOpcode, QcProgramError, signedQcBranch } from "../../../compat/qc/program.ts";
import type { QcProgram } from "../../../compat/qc/program.ts";
import type { QcMachine } from "../../../compat/qc/machine.ts";

interface EnvironmentalSite {
  readonly caller: number;
  readonly name: string;
  readonly statement: number;
  readonly hazard: "drown" | "lava" | "slime" | "fall" | "trigger" | "crush";
  readonly context: "world" | "touch" | "blocked" | "radius";
  readonly native?: "teledeath" | "exit" | "fireball" | "laser" | "spike" | "barrel";
  readonly attacker?: "goalentity";
}
export interface Id1ProgramBinding {
  readonly kind: "netquake" | "quakeworld";
  readonly digest: string;
  readonly attribution: "pinned" | "native";
  readonly damage: { readonly index: number; readonly firstStatement: number; readonly parameterStart: number; readonly localWords: number;
    readonly global: number; readonly healthStore: number; readonly take: number; readonly death: readonly [number, number]; readonly pain: readonly [number, number];
    readonly statements: readonly (readonly [number, QcOpcode, number, number, number])[] };
  readonly attacks: { readonly axe: number; readonly shotgun: number; readonly superShotgun: number; readonly addMulti: number; readonly traceAttack: number;
    readonly axeDamage: readonly number[]; readonly applyMultiDamage: readonly [number, number] } | null;
  readonly environment: readonly EnvironmentalSite[];
}
const netquake: Id1ProgramBinding = {
  kind: "netquake", attribution: "pinned", digest: "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580",
  damage: { index: 117, firstStatement: 1421, parameterStart: 1580, localWords: 10, global: 520, healthStore: 1526, take: 1589, death: [1532, 1559], pain: [1568, 1701],
    statements: [[1421, QcOpcode.LoadF, 1580, 163, 1590], [1442, QcOpcode.StorePF, 213, 1600, 0], [1450, QcOpcode.StorePF, 1607, 1601, 0],
      [1454, QcOpcode.StorePF, 1610, 1608, 0], [1492, QcOpcode.StorePV, 1655, 1643, 0], [1526, QcOpcode.StorePF, 1677, 1675, 0],
      [1532, QcOpcode.Call2, 1559, 0, 0], [1568, QcOpcode.Call2, 1701, 0, 0]] },
  attacks: { axe: 163, shotgun: 174, superShotgun: 175, addMulti: 171, traceAttack: 172, axeDamage: [3460], applyMultiDamage: [170, 3580] },
  environment: [
    { caller: 239, name: "WaterMove", statement: 6446, hazard: "drown", context: "world" },
    { caller: 239, name: "WaterMove", statement: 6489, hazard: "lava", context: "world" },
    { caller: 239, name: "WaterMove", statement: 6509, hazard: "slime", context: "world" },
    { caller: 243, name: "PlayerPostThink", statement: 6935, hazard: "fall", context: "world" },
    { caller: 434, name: "hurt_touch", statement: 10462, hazard: "trigger", context: "touch" },
    { caller: 375, name: "door_blocked", statement: 8690, hazard: "crush", context: "blocked" },
    { caller: 397, name: "secret_blocked", statement: 9589, hazard: "crush", context: "blocked" },
    { caller: 448, name: "plat_crush", statement: 10736, hazard: "crush", context: "blocked" },
    { caller: 451, name: "train_blocked", statement: 10877, hazard: "crush", context: "blocked" },
  ],
};
const quakeworld: Id1ProgramBinding = {
  kind: "quakeworld", attribution: "pinned", digest: "sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830",
  damage: { index: 83, firstStatement: 359, parameterStart: 855, localWords: 13, global: 542, healthStore: 517, take: 864, death: [523, 833], pain: [532, 1008],
    statements: [[359, QcOpcode.LoadF, 855, 158, 868], [388, QcOpcode.StorePF, 207, 884, 0], [396, QcOpcode.StorePF, 891, 885, 0],
      [400, QcOpcode.StorePF, 894, 892, 0], [439, QcOpcode.StorePV, 939, 927, 0], [457, QcOpcode.StorePV, 965, 953, 0],
      [517, QcOpcode.StorePF, 1004, 1002, 0], [523, QcOpcode.Call2, 833, 0, 0], [532, QcOpcode.Call2, 1008, 0, 0]] },
  attacks: { axe: 134, shotgun: 145, superShotgun: 146, addMulti: 141, traceAttack: 143, axeDamage: [2887, 2893], applyMultiDamage: [140, 3027] },
  environment: [
    { caller: 383, name: "tdeath_touch", statement: 9808, hazard: "trigger", context: "touch", native: "teledeath" },
    { caller: 383, name: "tdeath_touch", statement: 9817, hazard: "trigger", context: "touch", native: "teledeath" },
    { caller: 383, name: "tdeath_touch", statement: 9828, hazard: "trigger", context: "touch", native: "teledeath" },
    { caller: 383, name: "tdeath_touch", statement: 9836, hazard: "trigger", context: "touch", native: "teledeath" },
    { caller: 186, name: "changelevel_touch", statement: 5410, hazard: "trigger", context: "touch", native: "exit" },
    { caller: 431, name: "fire_touch", statement: 10926, hazard: "lava", context: "touch", native: "fireball" },
    { caller: 435, name: "Laser_Touch", statement: 11091, hazard: "trigger", context: "touch", native: "laser" },
    { caller: 158, name: "spike_touch", statement: 3900, hazard: "trigger", context: "touch", native: "spike" },
    { caller: 159, name: "superspike_touch", statement: 3973, hazard: "trigger", context: "touch", native: "spike" },
    { caller: 84, name: "T_RadiusDamage", statement: 580, hazard: "trigger", context: "radius", native: "barrel" },
    { caller: 202, name: "WaterMove", statement: 6020, hazard: "drown", context: "world" },
    { caller: 202, name: "WaterMove", statement: 6063, hazard: "lava", context: "world" },
    { caller: 202, name: "WaterMove", statement: 6083, hazard: "slime", context: "world" },
    { caller: 206, name: "PlayerPostThink", statement: 6533, hazard: "fall", context: "world" },
    { caller: 393, name: "hurt_touch", statement: 10071, hazard: "trigger", context: "touch" },
    { caller: 335, name: "door_blocked", statement: 8275, hazard: "crush", context: "blocked", attacker: "goalentity" },
    { caller: 357, name: "secret_blocked", statement: 9183, hazard: "crush", context: "blocked" },
    { caller: 407, name: "plat_crush", statement: 10349, hazard: "crush", context: "blocked" },
    { caller: 410, name: "train_blocked", statement: 10492, hazard: "crush", context: "blocked" },
  ],
};

/** Pinned annotations remain artifact-specific; other NetQuake layouts require operation proofs. */
export function id1ProgramBinding(program: QcProgram): Id1ProgramBinding {
  const binding = program.digest === netquake.digest ? netquake : program.digest === quakeworld.digest ? quakeworld : null;
  if (binding === null) return deriveNativeProgramBinding(program);
  if ((program.api.kind === "q1-quakeworld") !== (binding.kind === "quakeworld"))
    throw new QcProgramError("QuakeC source requires a verified classic id1 or native QuakeWorld artifact");
  return binding;
}

export function id1DamageMultiplier(vm: QcMachine, attacker: number, inflictor: number): number {
  const binding = id1ProgramBinding(vm.program);
  if (binding.attribution === "native") throw new QcProgramError("Native mod damage multiplier belongs to its bytecode");
  const field = (name: string): number => {
    const definition = vm.program.fieldsByName.get(name);
    if (definition === undefined) throw new QcProgramError(`Missing source damage field ${name}`);
    return definition.offset;
  };
  if (vm.entities.fromReference(attacker).float(field("super_damage_finished")) <= vm.globals.float(vm.globalOffset("time"))) return 1;
  if (binding.kind === "netquake") return 4;
  if (vm.strings.get(vm.entities.fromReference(inflictor).int(field("classname"))) === "door") return 1;
  return vm.globals.float(vm.globalOffset("deathmatch")) === 4 ? 8 : 4;
}

type DamageWord =
  | { readonly kind: "field"; readonly entity: number; readonly field: number }
  | { readonly kind: "pointer"; readonly entity: number; readonly field: number }
  | { readonly kind: "mask"; readonly value: number }
  | { readonly kind: "masked" | "cleared"; readonly entity: number; readonly field: number; readonly mask: number }
  | { readonly kind: "subtraction"; readonly entity: number; readonly field: number; readonly take: number };
const derivedBindings = new WeakMap<QcProgram, Id1ProgramBinding>();

/** Recognize observable damage operations, without replacing the program's damage policy. */
export function deriveNativeProgramBinding(program: QcProgram): Id1ProgramBinding {
  const cached = derivedBindings.get(program);
  if (cached !== undefined) return cached;
  const reject = (reason: string): never => { throw new QcProgramError(`Unsupported native damage semantics: ${reason}`, program.source); };
  if (program.api.kind !== "q1-netquake") reject("unverified QuakeWorld program");
  const damage = program.functionNamed("T_Damage");
  if (damage.firstStatement <= 0 || damage.parameterSizes.length !== 4 || damage.parameterSizes.some(size => size !== 1)) reject("T_Damage parameters");
  const initial = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
  const mutableGlobals = new Set<number>();
  for (const statement of program.statements) {
    const { opcode, b, c } = statement;
    if (opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn) {
      for (let word = b; word < b + (opcode === QcOpcode.StoreV ? 3 : 1); word++) mutableGlobals.add(word);
    } else if (opcode >= QcOpcode.MulF && opcode <= QcOpcode.Address || opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn
      || opcode >= QcOpcode.And && opcode <= QcOpcode.BitOr) {
      const width = opcode === QcOpcode.MulFV || opcode === QcOpcode.MulVF || opcode === QcOpcode.AddV || opcode === QcOpcode.SubV || opcode === QcOpcode.LoadV ? 3 : 1;
      for (let word = c; word < c + width; word++) mutableGlobals.add(word);
    }
  }

  const definition = (name: string, type: "float" | "vector" | "function"): number => {
    const field = program.fieldsByName.get(name);
    if (field?.type !== type) return reject(`field ${name}`);
    return field.offset;
  };
  const health = definition("health", "float"), painField = definition("th_pain", "function");
  for (const name of ["armorvalue", "armortype", "items"]) definition(name, "float");
  definition("velocity", "vector"); definition("th_die", "function");
  const global = program.globalsByName.get("T_Damage"), self = program.globalsByName.get("self");
  if (global?.type !== "function" || mutableGlobals.has(global.offset) || initial.getInt32(global.offset * 4, true) !== damage.index || self?.type !== "entity") return reject("damage global references");
  const end = program.functions.reduce((limit, fn) => fn.firstStatement > damage.firstStatement ? Math.min(limit, fn.firstStatement) : limit, program.statements.length);
  const starts = new Set([damage.firstStatement]);
  for (let index = damage.firstStatement; index < end; index++) {
    const statement = program.statements[index];
    if (statement === undefined) return reject("missing statement");
    if (statement.opcode === QcOpcode.If || statement.opcode === QcOpcode.IfNot || statement.opcode === QcOpcode.Goto) {
      const target = index + signedQcBranch(statement.opcode === QcOpcode.Goto ? statement.a : statement.b);
      if (target < damage.firstStatement || target >= end) return reject("branch leaves damage function");
      starts.add(target); starts.add(index + 1);
    }
  }
  const words = new Map<number, DamageWord>();
  const invalidate = (start: number, count = 1): void => {
    for (const [word, value] of words) {
      if (word >= start && word < start + count || value.kind === "subtraction" && value.take >= start && value.take < start + count) words.delete(word);
    }
  };
  let armorClear = false;
  const inventoryField = definition("items", "float");
  const combatFields = new Set([health, definition("armorvalue", "float"), definition("armortype", "float"), definition("items", "float"), definition("velocity", "vector")]);
  const combatStores = new Set<number>();
  let healthStore: number | null = null, take: number | null = null;
  let death: readonly [number, number] | null = null, pain: readonly [number, number] | null = null;
  const killed = program.functionNamed("Killed");
  if (killed.firstStatement <= 0 || killed.parameterSizes.length !== 2 || killed.parameterSizes.some(size => size !== 1)) return reject("death function parameters");
  const killedEnd = program.functions.reduce((limit, fn) => fn.firstStatement > killed.firstStatement ? Math.min(limit, fn.firstStatement) : limit, program.statements.length);
  const dieField = definition("th_die", "function");
  let dispatchesDeath = false;
  for (let index = killed.firstStatement; index + 1 < killedEnd; index++) {
    const load = program.statements[index], call = program.statements[index + 1];
    if (load?.opcode === QcOpcode.LoadFn && load.a === self.offset && initial.getInt32(load.b * 4, true) === dieField
      && call?.opcode === QcOpcode.Call0 && call.a === load.c) dispatchesDeath = true;
  }
  if (!dispatchesDeath) return reject("death function has no target death callback dispatch");
  const fieldValue = (word: number): number | null => {
    if (mutableGlobals.has(word) || !program.globals.some(value => value.type === "field" && value.offset === word)) return null;
    return initial.getInt32(word * 4, true);
  };
  const argumentSource = (index: number, argument: number): number | null => {
    for (let cursor = index - 1; cursor >= damage.firstStatement; cursor--) {
      const statement = program.statements[cursor];
      if (statement === undefined) return null;
      if ((statement.opcode === QcOpcode.StoreF || statement.opcode === QcOpcode.StoreV || statement.opcode === QcOpcode.StoreEnt) && statement.b === 4 + argument * 3) return statement.a;
      if (starts.has(cursor) || statement.opcode >= QcOpcode.Call0 && statement.opcode <= QcOpcode.Call8) return null;
    }
    return null;
  };
  const maskValue = (word: number): number | null => {
    const value = words.get(word);
    if (value?.kind === "mask") return value.value;
    if (value !== undefined || mutableGlobals.has(word) || !program.globals.some(definition => definition.offset === word && definition.type === "float")) return null;
    const constant = initial.getFloat32(word * 4, true);
    return Number.isInteger(constant) && constant > 0 && constant <= 0x7fffffff ? constant : null;
  };
  for (let index = damage.firstStatement; index < end; index++) {
    if (starts.has(index)) words.clear();
    const statement = program.statements[index];
    if (statement === undefined) return reject("missing statement");
    const { opcode, a, b, c } = statement;
    const writes = opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn ? { start: b, count: opcode === QcOpcode.StoreV ? 3 : 1 }
      : opcode >= QcOpcode.MulF && opcode <= QcOpcode.Address || opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn || opcode >= QcOpcode.And && opcode <= QcOpcode.BitOr
        ? { start: c, count: opcode === QcOpcode.MulFV || opcode === QcOpcode.MulVF || opcode === QcOpcode.AddV || opcode === QcOpcode.SubV || opcode === QcOpcode.LoadV ? 3 : 1 } : null;
    if (writes !== null && writes.start < damage.parameterStart + 3 && writes.start + writes.count > damage.parameterStart)
      return reject("damage actor parameters are reassigned");
    const left = words.get(a), pointer = words.get(b);
    if (opcode === QcOpcode.Address || opcode >= QcOpcode.LoadF && opcode <= QcOpcode.LoadFn) {
      const field = fieldValue(b);
      invalidate(c, opcode === QcOpcode.LoadV ? 3 : 1);
      if (field !== null) words.set(c, { kind: opcode === QcOpcode.Address ? "pointer" : "field", entity: a, field });
    } else if (opcode === QcOpcode.BitOr) {
      const leftMask = maskValue(a), rightMask = maskValue(b);
      invalidate(c);
      if (leftMask !== null && rightMask !== null) words.set(c, { kind: "mask", value: leftMask | rightMask });
    } else if (opcode === QcOpcode.BitAnd) {
      const mask = maskValue(b);
      invalidate(c);
      if (left?.kind === "field" && mask !== null) words.set(c, { kind: "masked", entity: left.entity, field: left.field, mask });
    } else if (opcode === QcOpcode.SubF) {
      const right = words.get(b);
      invalidate(c);
      if (left?.kind === "field" && right?.kind === "masked" && left.entity === right.entity && left.field === right.field)
        words.set(c, { kind: "cleared", entity: left.entity, field: left.field, mask: right.mask });
      else if (left?.kind === "field" && b !== c) words.set(c, { kind: "subtraction", entity: left.entity, field: left.field, take: b });
    } else if (opcode >= QcOpcode.StorePF && opcode <= QcOpcode.StorePFn) {
      if (pointer?.kind !== "pointer") return reject(`unresolved entity store ${index}`);
      if (left?.kind === "cleared" || pointer.field === inventoryField) {
        if (left?.kind !== "cleared" || left.entity !== damage.parameterStart || pointer.entity !== left.entity || pointer.field !== left.field
          || pointer.field !== inventoryField || left.mask !== 57344) return reject("armor inventory layout is not the supported items mask");
        armorClear = true;
      }
      if (combatFields.has(pointer.field)) {
        if (pointer.entity !== damage.parameterStart) return reject("combat store does not address the damage target parameter");
        combatStores.add(index);
      }
      if (pointer.field === health) {
        if (opcode !== QcOpcode.StorePF || pointer.entity !== damage.parameterStart || left?.kind !== "subtraction" || left.entity !== pointer.entity || left.field !== health || healthStore !== null)
          return reject(`health store ${index} is not a unique target subtraction`);
        healthStore = index; take = left.take;
        if (take < damage.parameterStart || take >= damage.parameterStart + damage.localWords) return reject("damage amount is not a preserved local");
      }
    } else if (opcode >= QcOpcode.Call0 && opcode <= QcOpcode.Call8) {
      if (opcode === QcOpcode.Call2 && !mutableGlobals.has(a) && initial.getInt32(a * 4, true) === killed.index && program.globals.some(value => value.offset === a && value.type === "function")) {
        if (death !== null || argumentSource(index, 0) !== damage.parameterStart || argumentSource(index, 1) !== damage.parameterStart + 2) return reject("death call arguments");
        death = [index, a];
      } else if (opcode === QcOpcode.Call2 && left?.kind === "field" && left.field === painField && left.entity === self.offset) {
        if (pain !== null || argumentSource(index, 0) !== damage.parameterStart + 2 || argumentSource(index, 1) !== take) return reject("pain call arguments");
        pain = [index, a];
      }
      // Calls may overwrite scratch globals. Source locals are restored by the VM.
      words.clear();
    } else if (opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn) {
      invalidate(b, opcode === QcOpcode.StoreV ? 3 : 1);
    } else if (opcode !== QcOpcode.If && opcode !== QcOpcode.IfNot && opcode !== QcOpcode.Goto && opcode !== QcOpcode.Return && opcode !== QcOpcode.Done) {
      invalidate(c, opcode === QcOpcode.AddV || opcode === QcOpcode.SubV || opcode === QcOpcode.MulFV || opcode === QcOpcode.MulVF ? 3 : 1);
    }
  }
  if (!armorClear) return reject("missing supported armor inventory clear");
  if (healthStore === null || take === null || death === null || pain === null || death[0] <= healthStore || pain[0] <= healthStore) return reject("missing health or reaction dataflow");
  const pending: { readonly index: number; readonly phase: "before" | "stored" | "reacted" }[] = [{ index: damage.firstStatement, phase: "before" }];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const state = pending.pop();
    if (state === undefined) break;
    const key = `${state.index}:${state.phase}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const statement = program.statements[state.index];
    if (statement === undefined || state.index >= end) return reject("damage control flow leaves function");
    let phase = state.phase;
    if (phase === "reacted" && statement.opcode >= QcOpcode.Call0 && statement.opcode <= QcOpcode.Call8)
      return reject("damage function calls another function after reaction");
    if (combatStores.has(state.index) && phase === "reacted") return reject("combat store follows reaction");
    if (state.index === healthStore) {
      if (phase !== "before") return reject("health store can execute more than once");
      phase = "stored";
    }
    if (state.index === death[0] || state.index === pain[0]) {
      if (phase !== "stored") return reject("reaction is not dominated by health store");
      phase = "reacted";
    }
    if (statement.opcode === QcOpcode.Return || statement.opcode === QcOpcode.Done) continue;
    if (statement.opcode === QcOpcode.Goto) pending.push({ index: state.index + signedQcBranch(statement.a), phase });
    else {
      pending.push({ index: state.index + 1, phase });
      if (statement.opcode === QcOpcode.If || statement.opcode === QcOpcode.IfNot) pending.push({ index: state.index + signedQcBranch(statement.b), phase });
    }
  }
  const binding: Id1ProgramBinding = { kind: "netquake", attribution: "native", digest: program.digest,
    damage: { index: damage.index, firstStatement: damage.firstStatement, parameterStart: damage.parameterStart, localWords: damage.localWords,
      global: global.offset, healthStore, take, death, pain, statements: [] }, attacks: null, environment: [] };
  derivedBindings.set(program, binding);
  return binding;
}
