import type { ActorId } from "../../../contracts/identity.ts";
import type { DamageRequest } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { QcMachine } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import { createMutableVectorMath } from "../../../core/math.ts";
import type { Id1DamageCall } from "./id1-damage.ts";

export interface Id1PhysicsCallback {
  readonly kind: "blocked" | "touch";
  readonly actor: ActorId;
  readonly other: ActorId;
  readonly functionIndex: number;
}
type EnvironmentCause = Extract<DamageRequest["attack"]["cause"], { readonly kind: "environment" }>;
interface Site {
  readonly caller: number;
  readonly name: string;
  readonly statement: number;
  readonly hazard: EnvironmentCause["hazard"];
  readonly context: "world" | "touch" | "blocked";
}
const sites: readonly Site[] = [
  { caller: 239, name: "WaterMove", statement: 6446, hazard: "drown", context: "world" },
  { caller: 239, name: "WaterMove", statement: 6489, hazard: "lava", context: "world" },
  { caller: 239, name: "WaterMove", statement: 6509, hazard: "slime", context: "world" },
  { caller: 243, name: "PlayerPostThink", statement: 6935, hazard: "fall", context: "world" },
  { caller: 434, name: "hurt_touch", statement: 10462, hazard: "trigger", context: "touch" },
  { caller: 375, name: "door_blocked", statement: 8690, hazard: "crush", context: "blocked" },
  { caller: 397, name: "secret_blocked", statement: 9589, hazard: "crush", context: "blocked" },
  { caller: 448, name: "plat_crush", statement: 10736, hazard: "crush", context: "blocked" },
  { caller: 451, name: "train_blocked", statement: 10877, hazard: "crush", context: "blocked" },
];
export interface Id1EnvironmentalDamage {
  readonly cause: EnvironmentCause;
  readonly time: number;
  readonly direction: Vec3;
  readonly point: Vec3;
  readonly knockback: number;
}

/** Classifies real calls in the pinned artifact; QC still executes every damage store and reaction. */
export class Id1Environment {
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    private readonly machine: () => QcMachine) {
    if (source.program.digest !== "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580")
      throw new QcProgramError("id1 environment requires the verified classic id1 program");
    for (const site of sites) {
      const statement = source.program.statements[site.statement];
      if (source.program.functionAt(site.caller).name !== site.name || statement?.opcode !== QcOpcode.Call4
        || statement.a !== 520 || statement.b !== 0 || statement.c !== 0)
        throw new QcProgramError(`id1 environmental statement ${site.statement} mismatch`);
    }
  }
  resolve(call: Id1DamageCall, callback: Id1PhysicsCallback | null): Id1EnvironmentalDamage | null {
    const site = sites.find(value => value.caller === call.call.caller && value.statement === call.call.statement);
    if (site === undefined) return null;
    const vm = this.machine();
    if (vm.program !== this.source.program || vm.entities !== this.source.entities || vm.globals.int(520) !== 117 || call.call.functionIndex !== 117)
      throw new QcProgramError("Unmatched id1 environmental machine or function");
    const reference = (actor: ActorId): number => {
      const owned = this.source.actors.sourceOf(actor);
      if (!this.source.actors.isLive(actor) || owned?.provider !== this.source.slots.options.provider)
        throw new QcProgramError("id1 environment references a foreign or stale actor");
      return this.source.entities.reference(owned.slot);
    };
    const target = reference(call.target), inflictor = reference(call.inflictor), attacker = reference(call.attacker);
    const self = vm.globals.int(vm.globalOffset("self")), other = vm.globals.int(vm.globalOffset("other"));
    if (site.context === "world") {
      if (target !== self || inflictor !== 0 || attacker !== 0 || vm.globals.int(vm.globalOffset("world")) !== 0)
        throw new QcProgramError("Unmatched id1 world hazard arguments");
    } else if (callback === null || callback.kind !== site.context || callback.functionIndex !== site.caller
      || !call.target.equals(callback.other) || !call.inflictor.equals(callback.actor) || !call.attacker.equals(callback.actor)
      || self !== inflictor || other !== target || attacker !== inflictor) {
      throw new QcProgramError("Unmatched id1 environmental callback");
    }
    const field = (name: string): number => {
      const value = this.source.program.fieldsByName.get(name);
      if (value === undefined) throw new QcProgramError(`Missing environmental field ${name}`);
      return value.offset;
    };
    const victim = vm.entities.fromReference(target), point = victim.vector(field("origin")), direction = { x: 0, y: 0, z: 0 };
    let knockback = 0;
    const time = vm.globals.float(vm.globalOffset("time"));
    if (inflictor !== 0 && victim.float(field("movetype")) === 3) {
      const origin = vm.entities.fromReference(inflictor), math = createMutableVectorMath(vm.numeric, "preserve");
      const store = (): void => { direction.x = Math.fround(direction.x); direction.y = Math.fround(direction.y); direction.z = Math.fround(direction.z); };
      // Each QC vector opcode and the normalize builtin return through float32 VM words.
      math.VectorAdd(origin.vector(field("absmin")), origin.vector(field("absmax")), direction); store();
      math.VectorScale(direction, 0.5, direction); store();
      math.VectorSubtract(point, direction, direction); store();
      math.VectorNormalize(direction); store();
      knockback = vm.numeric.multiply(call.amount, vm.entities.fromReference(attacker).float(field("super_damage_finished")) > time ? 4 : 1);
    }
    return { cause: { kind: "environment", hazard: site.hazard }, time, direction, point, knockback };
  }
}
