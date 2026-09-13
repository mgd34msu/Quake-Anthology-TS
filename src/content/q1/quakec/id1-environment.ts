import { id1ProgramBinding, id1DamageMultiplier, type Id1ProgramBinding } from "./id1-program.ts";
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
type EnvironmentCause = DamageRequest["attack"]["cause"];
export interface Id1EnvironmentalDamage {
  readonly cause: EnvironmentCause;
  readonly time: number;
  readonly direction: Vec3;
  readonly point: Vec3;
  readonly knockback: number;
}

/** Classifies proven artifact sites; other native source calls retain unclassified provenance. */
export class Id1Environment {
  private readonly binding: Id1ProgramBinding;
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    private readonly machine: () => QcMachine) {
    this.binding = id1ProgramBinding(source.program);
    for (const site of this.binding.environment) {
      const statement = source.program.statements[site.statement];
      if (source.program.functionAt(site.caller).name !== site.name || statement?.opcode !== QcOpcode.Call4
        || statement.a !== this.binding.damage.global || statement.b !== 0 || statement.c !== 0)
        throw new QcProgramError(`id1 environmental statement ${site.statement} mismatch`);
    }
  }
  resolve(call: Id1DamageCall, callback: Id1PhysicsCallback | null): Id1EnvironmentalDamage | null {
    const site = this.binding.environment.find(value => value.caller === call.call.caller && value.statement === call.call.statement);
    if (site === undefined) return null;
    const vm = this.machine();
    if (vm.program !== this.source.program || vm.entities !== this.source.entities || vm.globals.int(this.binding.damage.global) !== this.binding.damage.index || call.call.functionIndex !== this.binding.damage.index)
      throw new QcProgramError("Unmatched id1 environmental machine or function");
    const reference = (actor: ActorId): number => {
      const owned = this.source.actors.sourceOf(actor);
      if (!this.source.actors.isLive(actor) || owned?.provider !== this.source.slots.options.provider)
        throw new QcProgramError("id1 environment references a foreign or stale actor");
      return this.source.entities.reference(owned.slot);
    };
    const target = reference(call.target), inflictor = reference(call.inflictor), attacker = reference(call.attacker);
    const self = vm.globals.int(vm.globalOffset("self")), other = vm.globals.int(vm.globalOffset("other"));
    const field = (name: string): number => {
      const value = this.source.program.fieldsByName.get(name);
      if (value === undefined) throw new QcProgramError(`Missing environmental field ${name}`);
      return value.offset;
    };
    const expectedAttacker = site.attacker === "goalentity" ? vm.entities.fromReference(inflictor).int(field("goalentity")) : inflictor;
    const text = (entity: number, name: string): string => vm.strings.get(vm.entities.fromReference(entity).int(field(name)));
    let cause: EnvironmentCause = { kind: "environment", hazard: site.hazard };
    if (site.native !== undefined) {
      if (vm.argInt(0) !== target || vm.argInt(1) !== inflictor || vm.argInt(2) !== attacker || vm.argFloat(3) !== call.amount)
        throw new QcProgramError("Native map damage arguments changed");
      if (site.native === "barrel") {
        // This radius site is shared with weapons; only a native exploding box belongs here.
        if (text(inflictor, "classname") !== "explo_box") return null;
        if (self !== inflictor || attacker !== inflictor || vm.entities.fromReference(inflictor).int(field("th_die")) !== vm.program.functionNamed("barrel_explode").index)
          throw new QcProgramError("Unmatched native barrel damage");
      } else {
        if (callback === null || callback.kind !== "touch" || callback.functionIndex !== site.caller
          || !callback.actor.equals(call.inflictor) || reference(callback.other) !== other || self !== inflictor)
          throw new QcProgramError("Unmatched native map touch");
        const owner = vm.entities.fromReference(inflictor).int(field("owner"));
        if (site.native === "teledeath") {
          const classname = text(inflictor, "classname");
          const expectedClass = site.statement === 9808 || site.statement === 9817 ? "teledeath3" : site.statement === 9828 ? "teledeath2" : classname;
          const victimMatches = site.statement === 9828 ? target === owner : site.statement === 9817 ? owner === other && target === vm.globals.int(vm.program.functionAt(site.caller).parameterStart) && target !== other && target !== inflictor : target === other;
          if (attacker !== inflictor || call.amount !== 50000 || !victimMatches || classname !== expectedClass
            || !["teledeath", "teledeath2", "teledeath3"].includes(classname))
            throw new QcProgramError("Unmatched native teledeath branch");
          cause = { kind: "q1", deathType: classname };
        } else {
          if (target !== other) throw new QcProgramError("Unmatched native map victim");
          if (site.native === "spike" || site.native === "laser") {
            const ownerClass = text(owner, "classname");
            if (ownerClass !== "trap_spikeshooter" && ownerClass !== "trap_shooter") return null;
            if (attacker !== owner || call.amount !== (site.native === "laser" ? 15 : site.statement === 3900 ? 9 : 18))
              throw new QcProgramError("Unmatched native trap owner or damage");
          } else if (attacker !== inflictor) throw new QcProgramError("Unmatched native map attacker");
          if (site.native === "fireball" && (text(inflictor, "classname") !== "fireball" || call.amount !== 20))
            throw new QcProgramError("Unmatched native fireball");
          if (site.native === "exit" && (text(inflictor, "classname") !== "trigger_changelevel" || call.amount !== 50000))
            throw new QcProgramError("Unmatched native exit punishment");
          cause = { kind: "q1", deathType: text(target, "deathtype") };
        }
      }
      if (site.native === "barrel") cause = { kind: "q1", deathType: text(target, "deathtype") };
    } else if (site.context === "world") {
      if (target !== self || inflictor !== 0 || attacker !== 0 || vm.globals.int(vm.globalOffset("world")) !== 0)
        throw new QcProgramError("Unmatched id1 world hazard arguments");
    } else if (callback === null || callback.kind !== site.context || callback.functionIndex !== site.caller
      || !call.target.equals(callback.other) || !call.inflictor.equals(callback.actor)
      || self !== inflictor || other !== target || attacker !== expectedAttacker) {
      throw new QcProgramError("Unmatched id1 environmental callback");
    }
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
      knockback = vm.numeric.multiply(call.amount, id1DamageMultiplier(vm, attacker, inflictor));
    }
    return { cause, time, direction, point, knockback };
  }
}
