/* Quake WinQuake/pr_cmds.c PF_walkmove and world.c SV_TouchLinks. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { RandomSource } from "../../contracts/numeric.ts";
import type { SceneQueries, TraceHit } from "../../contracts/scene.ts";
import type { TouchContact } from "../../contracts/world.ts";
import { createNumericOperations } from "../../core/numeric.ts";
import { Q1MonsterMovement } from "../../movement/q1/monsters.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin, QcMachine } from "./machine.ts";
import { QcProgramError } from "./program.ts";
import { qcLinkBounds } from "./world-host.ts";
import type { QcWorldHost } from "./world-host.ts";

export function createQcMovementBindings(world: QcWorldHost, services: {
  readonly scene: SceneQueries;
  readonly random: Pick<RandomSource, "nextInteger">;
  readonly touchTriggers: (actor: OwnedActor) => undefined;
}): ReadonlyMap<QcHostBuiltinName, QcBuiltin> {
  const { actors, bodies, entities, slots, program } = world.options;
  const numeric = createNumericOperations(world.options.numeric);
  const field = (name: string): number => {
    const definition = program.fieldsByName.get(name);
    if (definition === undefined) throw new QcProgramError(`missing entity field ${name}`);
    return definition.offset;
  };
  const sourceSlot = (actor: ActorId): number | null => {
    if (!actors.isLive(actor)) return null;
    const source = actors.sourceOf(actor);
    return source?.provider === slots.options.provider ? source.slot : null;
  };
  const movement = new Q1MonsterMovement({ scene: services.scene, numeric, random: services.random,
    read: actor => {
      const slot = sourceSlot(actor), body = bodies.read(actor);
      if (slot === null || body === null) return null;
      const words = entities.at(slot), flags = Math.trunc(words.float(field("flags")));
      const groundReference = words.int(field("groundentity"));
      const groundActor = groundReference === 0 ? null : slots.at(entities.slot(groundReference));
      const ground: TraceHit = (flags & 512) === 0 ? { kind: "none" }
        : groundReference === 0 ? { kind: "world", model: 0 }
        : groundActor === null ? { kind: "none" } : { kind: "actor", actor: groundActor.id };
      const enemyReference = words.int(field("enemy"));
      return { ...body, absoluteBounds: bodies.linked(actor)?.absoluteBounds ?? qcLinkBounds(body, flags, numeric), flags, ground,
        idealYaw: words.float(field("ideal_yaw")), yawSpeed: words.float(field("yaw_speed")),
        enemy: enemyReference === 0 ? null : slots.at(entities.slot(enemyReference))?.id ?? null };
    },
    readTarget: actor => {
      const body = bodies.read(actor), slot = sourceSlot(actor);
      if (body === null) return null;
      if (slot !== null) {
        const words = entities.at(slot);
        return { origin: body.origin, absoluteBounds: { min: words.vector(field("absmin")), max: words.vector(field("absmax")) } };
      }
      const linked = bodies.linked(actor);
      return linked === null ? null : { origin: body.origin, absoluteBounds: linked.absoluteBounds };
    },
    write: (actor, state) => {
      const slot = sourceSlot(actor.id), body = bodies.read(actor.id);
      if (slot === null || body === null) return undefined;
      const words = entities.at(slot);
      words.setVector(field("origin"), state.origin); words.setVector(field("angles"), state.angles);
      // SV_movestep retains the raw ground word until a landing supplies a contact.
      if (state.ground.kind === "actor") words.setInt(field("groundentity"), world.reference(state.ground.actor));
      else if (state.ground.kind === "world") words.setInt(field("groundentity"), 0);
      words.setFloat(field("flags"), state.flags);
      words.setFloat(field("ideal_yaw"), state.idealYaw); words.setFloat(field("yaw_speed"), state.yawSpeed);
      return undefined;
    },
    link: (actor, touch) => {
      const slot = sourceSlot(actor.id);
      if (slot === null) return undefined;
      world.link(slot);
      if (touch) services.touchTriggers(actor);
      return undefined;
    },
  });
  const walkmove: QcBuiltin = vm => {
    if (vm.program !== program || vm.entities !== entities) return vm.fail("movement builtin belongs to another QC machine");
    const self = vm.globalOffset("self"), savedSelf = vm.globals.int(self);
    try { vm.returnFloat(movement.walkMove(world.actor(entities.slot(savedSelf)), vm.argFloat(0), vm.argFloat(1)) ? 1 : 0); }
    finally { vm.globals.setInt(self, savedSelf); }
  };
  const movetogoal: QcBuiltin = vm => {
    if (vm.program !== program || vm.entities !== entities) return vm.fail("movement builtin belongs to another QC machine");
    const self = entities.slot(vm.globals.int(vm.globalOffset("self"))), words = entities.at(self);
    const actor = world.actor(self), goal = world.actor(entities.slot(words.int(field("goalentity"))));
    const distance = vm.argFloat(0);
    if ((Math.trunc(words.float(field("flags"))) & (512 | 1 | 2)) === 0) { vm.returnFloat(0); return; }
    movement.moveToGoal(actor, goal.id, distance);
  };
  return new Map<QcHostBuiltinName, QcBuiltin>([["walkmove", walkmove], ["movetogoal", movetogoal]]);
}

/** Resolve mutable source touch words at dispatch, including newly spawned edicts. */
export function createQcTouchCallback(world: QcWorldHost, vm: QcMachine, serverTime: () => number): (contact: TouchContact) => undefined {
  if (vm.program !== world.options.program || vm.entities !== world.options.entities) throw new QcProgramError("touch callback belongs to another QC machine");
  const solid = vm.fieldOffset("solid"), touch = vm.fieldOffset("touch");
  return contact => {
    if (!world.options.actors.isLive(contact.self.id) || !world.options.actors.isLive(contact.other)) return undefined;
    const source = world.options.actors.sourceOf(contact.self.id);
    if (source === null || source.provider !== world.options.slots.options.provider) return undefined;
    const words = vm.entities.at(source.slot), callback = words.int(touch);
    if (words.float(solid) !== 1 || callback === 0) return undefined;
    const self = vm.globalOffset("self"), other = vm.globalOffset("other");
    const savedSelf = vm.globals.int(self), savedOther = vm.globals.int(other);
    try {
      vm.globals.setInt(self, world.reference(contact.self.id)); vm.globals.setInt(other, world.reference(contact.other));
      vm.globals.setFloat(vm.globalOffset("time"), serverTime());
      vm.execute(callback);
    } finally { vm.globals.setInt(self, savedSelf); vm.globals.setInt(other, savedOther); }
    return undefined;
  };
}
