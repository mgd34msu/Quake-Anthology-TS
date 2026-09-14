import { id1ProgramBinding, id1DamageMultiplier, type Id1ProgramBinding } from "./id1-program.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { QcFunctionBoundary, QcMachine } from "../../../compat/qc/machine.ts";
import { QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import type { Id1DamageCall } from "./id1-damage.ts";

export interface Id1SynchronousAttack {
  readonly actor: ActorId;
  readonly weapon: ItemId;
  readonly time: number;
  readonly knockback: number;
  readonly direction: Vec3;
  readonly point: Vec3;
  readonly normal: Vec3;
}
interface Trace { readonly point: Vec3; readonly normal: Vec3; }
interface Attack {
  readonly actor: ActorId;
  readonly reference: number;
  readonly weapon: ItemId;
  readonly time: number;
  readonly traces: Map<ActorId, Trace>;
}

/** Synchronous attack identity for the pinned id1 program; projectile lifetimes are separate. */
export class Id1SynchronousAttacks {
  private readonly active: Attack[] = [];
  private readonly binding: Id1ProgramBinding;
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    private readonly machine: () => QcMachine) {
    this.binding = id1ProgramBinding(source.program);
  }
  assertIdle(): void { if (this.active.length !== 0) throw new QcProgramError("Cannot save during a synchronous attack"); }
  private vm(): QcMachine {
    const vm = this.machine();
    if (vm.program !== this.source.program || vm.entities !== this.source.entities) throw new QcProgramError("id1 attacks belong to another machine");
    return vm;
  }
  private field(name: string): number {
    const field = this.source.program.fieldsByName.get(name);
    if (field === undefined) throw new QcProgramError(`Missing id1 attack field ${name}`);
    return field.offset;
  }
  private trace(vm: QcMachine): Trace {
    return { point: vm.globals.vector(vm.globalOffset("trace_endpos")), normal: vm.globals.vector(vm.globalOffset("trace_plane_normal")) };
  }
  compose(damage: QcFunctionBoundary): QcFunctionBoundary {
    const layout = this.binding.attacks;
    if (layout === null) return damage;
    return { functions: new Set([...damage.functions, layout.axe, layout.shotgun, layout.superShotgun, layout.addMulti]), run: (call, execute) => {
      if (damage.functions.has(call.functionIndex)) return damage.run(call, execute);
      const vm = this.vm();
      if (call.functionIndex === layout.addMulti) {
        const attack = this.active.at(-1);
        if (attack !== undefined && call.caller === layout.traceAttack) {
          const target = this.source.slots.at(this.source.entities.slot(vm.argInt(0)));
          if (target !== null) attack.traces.set(target.id, this.trace(vm));
        }
        return execute();
      }
      const reference = vm.globals.int(vm.globalOffset("self"));
      const actor = this.source.slots.at(this.source.entities.slot(reference));
      if (actor === null || !this.source.actors.isLive(actor.id)) throw new QcProgramError("id1 attack has no live source actor");
      const words = this.source.entities.fromReference(reference);
      if (vm.strings.get(words.int(this.field("classname"))) !== "player") throw new QcProgramError("id1 player attack requires a source player");
      const weapon = call.functionIndex === layout.axe ? "q1:weapon/axe" : call.functionIndex === layout.shotgun ? "q1:weapon/shotgun" : "q1:weapon/supershotgun";
      this.active.push({ actor: actor.id, reference, weapon, time: vm.globals.float(vm.globalOffset("time")), traces: new Map<ActorId, Trace>() });
      try { return execute(); } finally { this.active.pop(); }
    } };
  }
  resolve(call: Id1DamageCall): Id1SynchronousAttack | null {
    const layout = this.binding.attacks;
    if (layout === null) return null;
    const axe = call.call.caller === layout.axe && layout.axeDamage.includes(call.call.statement);
    const shotgun = call.call.caller === layout.applyMultiDamage[0] && call.call.statement === layout.applyMultiDamage[1];
    if (!axe && !shotgun) return null;
    const attack = this.active.at(-1), vm = this.vm();
    if (attack === undefined || !this.source.actors.isLive(attack.actor) || !attack.actor.equals(call.attacker) || !attack.actor.equals(call.inflictor)
      || vm.globals.int(vm.globalOffset("self")) !== attack.reference || vm.globals.int(this.binding.damage.global) !== this.binding.damage.index
      || axe !== (attack.weapon === "q1:weapon/axe")) throw new QcProgramError("Unmatched id1 synchronous damage scope");
    const target = this.source.actors.sourceOf(call.target);
    if (target === null || target.provider !== this.source.slots.options.provider) throw new QcProgramError("id1 attack target has no source projection");
    const trace = axe ? this.trace(vm) : attack.traces.get(call.target);
    if (trace === undefined) throw new QcProgramError("id1 shotgun damage has no captured target trace");
    const n = vm.numeric, owner = this.source.entities.fromReference(attack.reference), victim = this.source.entities.at(target.slot);
    const min = owner.vector(this.field("absmin")), max = owner.vector(this.field("absmax")), origin = victim.vector(this.field("origin"));
    const delta = { x: n.subtract(origin.x, n.multiply(n.add(min.x, max.x), 0.5)), y: n.subtract(origin.y, n.multiply(n.add(min.y, max.y), 0.5)), z: n.subtract(origin.z, n.multiply(n.add(min.z, max.z), 0.5)) };
    const magnitude = n.squareRoot(n.add(n.add(n.multiply(delta.x, delta.x), n.multiply(delta.y, delta.y)), n.multiply(delta.z, delta.z)));
    const inverse = magnitude === 0 ? 0 : n.divide(1, magnitude);
    return { actor: attack.actor, weapon: attack.weapon, time: attack.time,
      knockback: n.multiply(call.amount, id1DamageMultiplier(vm, attack.reference, attack.reference)),
      direction: { x: n.multiply(delta.x, inverse), y: n.multiply(delta.y, inverse), z: n.multiply(delta.z, inverse) }, point: { ...trace.point }, normal: { ...trace.normal } };
  }
}
