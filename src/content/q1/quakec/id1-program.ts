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
  readonly damage: { readonly index: number; readonly firstStatement: number; readonly parameterStart: number; readonly localWords: number;
    readonly global: number; readonly take: number; readonly death: readonly [number, number]; readonly pain: readonly [number, number];
    readonly statements: readonly (readonly [number, QcOpcode, number, number, number])[] };
  readonly attacks: { readonly axe: number; readonly shotgun: number; readonly superShotgun: number; readonly addMulti: number; readonly traceAttack: number;
    readonly axeDamage: readonly number[]; readonly applyMultiDamage: readonly [number, number] };
  readonly environment: readonly EnvironmentalSite[];
}
const netquake: Id1ProgramBinding = {
  kind: "netquake", digest: "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580",
  damage: { index: 117, firstStatement: 1421, parameterStart: 1580, localWords: 10, global: 520, take: 1589, death: [1532, 1559], pain: [1568, 1701],
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
  kind: "quakeworld", digest: "sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830",
  damage: { index: 83, firstStatement: 359, parameterStart: 855, localWords: 13, global: 542, take: 864, death: [523, 833], pain: [532, 1008],
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

/** Statement identities belong to these two supplied artifacts, not arbitrary CRC-compatible programs. */
export function id1ProgramBinding(program: QcProgram): Id1ProgramBinding {
  const binding = program.digest === netquake.digest ? netquake : program.digest === quakeworld.digest ? quakeworld : null;
  if (binding === null || (program.api.kind === "q1-quakeworld") !== (binding.kind === "quakeworld"))
    throw new QcProgramError("QuakeC source requires a verified classic id1 or native QuakeWorld artifact");
  return binding;
}

export function id1DamageMultiplier(vm: QcMachine, attacker: number, inflictor: number): number {
  const field = (name: string): number => {
    const definition = vm.program.fieldsByName.get(name);
    if (definition === undefined) throw new QcProgramError(`Missing source damage field ${name}`);
    return definition.offset;
  };
  if (vm.entities.fromReference(attacker).float(field("super_damage_finished")) <= vm.globals.float(vm.globalOffset("time"))) return 1;
  if (id1ProgramBinding(vm.program).kind === "netquake") return 4;
  if (vm.strings.get(vm.entities.fromReference(inflictor).int(field("classname"))) === "door") return 1;
  return vm.globals.float(vm.globalOffset("deathmatch")) === 4 ? 8 : 4;
}
