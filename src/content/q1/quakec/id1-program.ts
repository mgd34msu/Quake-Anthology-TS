import { validateQcSourceCall, qcSourceValueType } from "../../../compat/qc/source-call.ts";
import type { ModCallbackInput, ModSourceCall } from "../../../contracts/mod-callbacks.ts";
import { QcOpcode, QcProgramError } from "../../../compat/qc/program.ts";
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
  readonly armorField: string;
  readonly armorMasks: readonly [number, number, number];
  readonly damage: { readonly index: number; readonly firstStatement: number; readonly parameterStart: number; readonly localWords: number;
    readonly global: number; } & ({ readonly kind: "sites"; readonly healthStore: number; readonly take: number; readonly death: readonly [number, number]; readonly pain: readonly [number, number];
    readonly statements: readonly (readonly [number, QcOpcode, number, number, number])[] } | { readonly kind: "calls"; readonly reactions: ReadonlyMap<number, "pain" | "death">; readonly parameters: readonly ("entity" | "float" | "vector" | "string" | "function")[] });
  readonly attacks: { readonly axe: number; readonly shotgun: number; readonly superShotgun: number; readonly addMulti: number; readonly traceAttack: number;
    readonly axeDamage: readonly number[]; readonly applyMultiDamage: readonly [number, number] } | null;
  readonly environment: readonly EnvironmentalSite[];
}
const netquake: Id1ProgramBinding = {
  kind: "netquake", attribution: "pinned", digest: "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580",
  armorField: "items", armorMasks: [8192, 16384, 32768],
  damage: { index: 117, firstStatement: 1421, parameterStart: 1580, localWords: 10, global: 520, kind: "sites", healthStore: 1526, take: 1589, death: [1532, 1559], pain: [1568, 1701],
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
  armorField: "items", armorMasks: [8192, 16384, 32768],
  damage: { index: 83, firstStatement: 359, parameterStart: 855, localWords: 13, global: 542, kind: "sites", healthStore: 517, take: 864, death: [523, 833], pain: [532, 1008],
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

/** Pinned annotations remain artifact-specific; other layouts require original operation proofs. */
export function id1ProgramBinding(program: QcProgram, declaredDamage?: ModSourceCall): Id1ProgramBinding {
  if (declaredDamage !== undefined) {
    if (declaredDamage.function !== "T_Damage") throw new QcProgramError("QC combat requires the verified source T_Damage ABI");
    for (const [index, name] of ["self", "inflictor", "attacker", "amount"].entries()) {
      const value = declaredDamage.arguments[index];
      if (value?.kind !== "input" || value.name !== name) throw new QcProgramError(`QC damage argument ${index} must lower ${name}`);
    }
    validateQcSourceCall(program, declaredDamage, new Set<ModCallbackInput>(["self", "attacker", "inflictor", "amount", "knockback", "point", "direction", "normal", "time"]), "combat damage");
  }
  const binding = program.digest === netquake.digest ? netquake : program.digest === quakeworld.digest ? quakeworld : null;
  if (binding === null) {
    const derived = deriveNativeBinding(program, declaredDamage);
    const damage = derived.damage;
    if (declaredDamage !== undefined && damage.kind === "calls"
      && declaredDamage.arguments.some((value, index) => qcSourceValueType(value) !== damage.parameters[index]))
      throw new QcProgramError("QC damage arguments differ from original source parameter types");
    return derived;
  }
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

const derivedBindings = new WeakMap<QcProgram, Id1ProgramBinding>();

/** Source calls supply every argument; these types do not imply defaults for host calls. */
export function deriveNativeProgramBinding(program: QcProgram): Id1ProgramBinding { return deriveNativeBinding(program); }

function deriveNativeBinding(program: QcProgram, declaredDamage?: ModSourceCall): Id1ProgramBinding {
  const cached = derivedBindings.get(program);
  if (cached !== undefined) return cached;
  const reject = (reason: string): never => { throw new QcProgramError(`Unsupported native damage semantics: ${reason}`, program.source); };
  if (program.api.kind === "q1-quakeworld" && declaredDamage === undefined) reject("QuakeWorld requires an artifact-qualified combat declaration");
  const damage = program.functionNamed("T_Damage");
  if (damage.firstStatement <= 0 || damage.parameterSizes.length < 4) reject("T_Damage parameters");
  const parameters: ("entity" | "float" | "vector" | "string" | "function")[] = [];
  let offset = damage.parameterStart;
  for (const [index, size] of damage.parameterSizes.entries()) {
    const definition = program.globals.find(value => value.offset === offset && value.type !== "void");
    const type = definition?.type;
    if (type !== "entity" && type !== "float" && type !== "vector" && type !== "string" && type !== "function") return reject("untyped damage argument");
    if (size !== (type === "vector" ? 3 : 1) || index < 3 && type !== "entity" || index === 3 && type !== "float") return reject("damage argument types");
    parameters.push(type); offset += size;
  }
  if (declaredDamage !== undefined && declaredDamage.arguments.some((value, index) => qcSourceValueType(value) !== parameters[index]))
    reject("QC damage arguments differ from original source parameter types");
  const initial = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
  const mutable = new Set<number>();
  for (const statement of program.statements) {
    const { opcode, b, c } = statement;
    if (opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn) {
      for (let word = b; word < b + (opcode === QcOpcode.StoreV ? 3 : 1); word++) mutable.add(word);
    } else if (opcode >= QcOpcode.MulF && opcode <= QcOpcode.Address || opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn || opcode >= QcOpcode.And && opcode <= QcOpcode.BitOr) {
      const width = opcode === QcOpcode.MulFV || opcode === QcOpcode.MulVF || opcode === QcOpcode.AddV || opcode === QcOpcode.SubV || opcode === QcOpcode.LoadV ? 3 : 1;
      for (let word = c; word < c + width; word++) mutable.add(word);
    }
  }
  const global = program.globalsByName.get("T_Damage");
  if (global?.type !== "function" || mutable.has(global.offset) || initial.getInt32(global.offset * 4, true) !== damage.index) return reject("damage global references");
  for (const [name, type] of [["health", "float"], ["armorvalue", "float"], ["armortype", "float"], ["velocity", "vector"], ["th_pain", "function"], ["th_die", "function"]]) {
    if (program.fieldsByName.get(name ?? "")?.type !== type) reject(`field ${name}`);
  }
  if (program.globalsByName.get("self")?.type !== "entity") reject("self global");
  const armorMask = (name: string): number => {
    const definition = program.globalsByName.get(name);
    if (definition?.type !== "float" || mutable.has(definition.offset)) return reject(`armor inventory constant ${name}`);
    const mask = initial.getFloat32(definition.offset * 4, true);
    if (!Number.isInteger(mask) || mask < 1 || mask > 0x80000000 || (mask & (mask - 1)) !== 0) return reject(`armor inventory bit ${name}`);
    return mask;
  };
  const inventories = program.fields.filter(field => {
    const match = /^items(\d*)$/.exec(field.name);
    return match !== null && field.type === "float" && [1, 2, 3].every(grade => program.globalsByName.has(`IT${match[1]}_ARMOR${grade}`));
  });
  const inventory = inventories[0];
  if (inventories.length !== 1 || inventory === undefined) return reject("ambiguous or missing armor inventory constants");
  const armorField = inventory.name, prefix = `IT${armorField.slice(5)}_ARMOR`;
  const armorMasks: readonly [number, number, number] = [armorMask(`${prefix}1`), armorMask(`${prefix}2`), armorMask(`${prefix}3`)];
  if (new Set(armorMasks).size !== armorMasks.length) reject("overlapping armor inventory bits");
  const reactions = new Map<number, "pain" | "death">();
  const pain = program.fieldsByName.get("th_pain"), die = program.fieldsByName.get("th_die");
  for (const fn of program.functions) {
    if (fn.firstStatement <= 0) continue;
    const end = program.functions.reduce((limit, other) => other.firstStatement > fn.firstStatement ? Math.min(limit, other.firstStatement) : limit, program.statements.length);
    for (let index = fn.firstStatement; index < end; index++) {
      const call = program.statements[index];
      if (call === undefined || call.opcode < QcOpcode.Call0 || call.opcode > QcOpcode.Call8) continue;
      let word = call.a;
      for (let cursor = index - 1; cursor >= fn.firstStatement; cursor--) {
        const statement = program.statements[cursor];
        if (statement === undefined) break;
        const { opcode, a, b, c } = statement;
        if (opcode === QcOpcode.LoadFn && c === word) {
          if (!mutable.has(b) && program.globals.some(value => value.offset === b && value.type === "field")) {
            const field = initial.getInt32(b * 4, true);
            if (field === pain?.offset) reactions.set(index, "pain");
            else if (field === die?.offset) reactions.set(index, "death");
          }
          break;
        }
        if (opcode === QcOpcode.StoreFn && b === word) { word = a; continue; }
        if (opcode >= QcOpcode.Call0 && opcode <= QcOpcode.Call8 || opcode === QcOpcode.If || opcode === QcOpcode.IfNot || opcode === QcOpcode.Goto) break;
        if (opcode >= QcOpcode.StoreF && opcode <= QcOpcode.StoreFn && b <= word && word < b + (opcode === QcOpcode.StoreV ? 3 : 1)) break;
        if ((opcode >= QcOpcode.MulF && opcode <= QcOpcode.Address || opcode >= QcOpcode.NotF && opcode <= QcOpcode.NotFn || opcode >= QcOpcode.And && opcode <= QcOpcode.BitOr) && c <= word && word < c + 3) break;
      }
    }
  }
  if (reactions.size === 0) reject("no typed damage reaction calls");
  const binding: Id1ProgramBinding = { kind: program.api.kind === "q1-quakeworld" ? "quakeworld" : "netquake", attribution: "native", digest: program.digest, armorField, armorMasks,
    damage: { index: damage.index, firstStatement: damage.firstStatement, parameterStart: damage.parameterStart, localWords: damage.localWords,
      global: global.offset, kind: "calls", parameters, reactions }, attacks: null, environment: [] };
  derivedBindings.set(program, binding);
  return binding;
}
