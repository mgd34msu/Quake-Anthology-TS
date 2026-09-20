/* Quake SV_Physics_Pusher field projection. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Q1PhysicsEntity, Q1PusherServices } from "../../movement/q1/types.ts";
import type { QcMachine } from "./machine.ts";
import { QcProgramError } from "./program.ts";
import type { QcWorldHost } from "./world-host.ts";

type Projection = Pick<Q1PusherServices, "read" | "write" | "link" | "blocked">;

/** Borrow the existing world's pusher services; own only raw QC projection and dispatch. */
export function createQcPusherServices(world: Pick<QcWorldHost, "options" | "reference" | "link">, vm: QcMachine, options: {
  readonly physical: (projection: Projection) => Omit<Q1PusherServices, "think">;
  readonly foreign: Pick<Q1PusherServices, "read" | "write">;
  readonly touchTriggers: (actor: OwnedActor) => undefined;
  readonly serverTime: () => number;
  readonly invoke?: (actor: OwnedActor, callback: "think" | "blocked", other: ActorId | null) => undefined;
}): Q1PusherServices {
  const { actors, bodies, entities, slots, program } = world.options;
  if (vm.program !== program || vm.entities !== entities) throw new QcProgramError("pusher belongs to another QC machine");
  const field = (name: string) => vm.fieldOffset(name);
  const sourceSlot = (actor: ActorId): number | null => {
    if (!actors.isLive(actor)) return null;
    const source = actors.sourceOf(actor);
    return source?.provider === slots.options.provider ? source.slot : null;
  };
  const read: Q1PusherServices["read"] = actor => {
    const slot = sourceSlot(actor);
    if (slot === null) return options.foreign.read(actor);
    const body = bodies.read(actor), owned = actors.resolveOwned(actor);
    if (body === null || owned === null) return null;
    const words = entities.at(slot), flags = Math.trunc(words.float(field("flags"))), ground = words.int(field("groundentity"));
    const groundActor = ground === 0 ? null : body.ground;
    const solid = words.float(field("solid"));
    return { actor: owned, bounds: body.bounds, absoluteBounds: { min: words.vector(field("absmin")), max: words.vector(field("absmax")) },
      solid: solid === 0 ? "not" : solid === 1 ? "trigger" : solid === 4 ? "bsp" : solid === 3 ? "slidebox" : "box",
      localTimeSeconds: words.float(field("ltime")), nextThinkSeconds: words.float(field("nextthink")),
      state: { kind: "q1-netquake", origin: body.origin, velocity: body.velocity, angles: body.angles,
        oldOrigin: words.vector(field("oldorigin")), angularVelocity: words.vector(field("avelocity")),
        viewAngles: words.vector(field("v_angle")), punchAngles: program.api.kind === "q1-quakeworld" ? { x: 0, y: 0, z: 0 } : words.vector(field("punchangle")),
        moveType: words.float(field("movetype")), flags,
        ground: (flags & 512) === 0 ? { kind: "none" } : ground === 0 ? { kind: "world", model: 0 }
          : groundActor === null ? { kind: "none" } : { kind: "actor", actor: groundActor },
        waterLevel: words.float(field("waterlevel")), waterType: words.float(field("watertype")),
        teleportTimeSeconds: words.float(field("teleport_time")), waterJumpDirection: words.vector(field("movedir")),
        idealPitch: program.api.kind === "q1-quakeworld" ? 0 : words.float(field("idealpitch")), fixAngle: words.float(field("fixangle")) !== 0, health: words.float(field("health")) } };
  };
  const write = (entity: Q1PhysicsEntity): undefined => {
    const slot = sourceSlot(entity.actor.id);
    if (slot === null) return options.foreign.write(entity);
    const words = entities.at(slot);
    words.setVector(field("origin"), entity.state.origin); words.setVector(field("angles"), entity.state.angles);
    words.setFloat(field("flags"), entity.state.flags);
    words.setVector(field("mins"), entity.bounds.min); words.setVector(field("maxs"), entity.bounds.max);
    words.setFloat(field("ltime"), entity.localTimeSeconds); words.setFloat(field("nextthink"), entity.nextThinkSeconds);
    // SV_PushMove clears onground but does not rewrite the raw groundentity word.
    return undefined;
  };
  const invoke = (actor: ActorId, name: "think" | "blocked", other: ActorId | null): undefined => {
    const slot = sourceSlot(actor); if (slot === null) throw new QcProgramError("pusher callback requires a live QC actor");
    const callback = entities.at(slot).int(field(name));
    if (callback === 0 && name === "blocked") return undefined;
    if (options.invoke !== undefined) {
      const owner = actors.resolveOwned(actor);
      if (owner === null) throw new QcProgramError("pusher callback lost its source owner");
      return options.invoke(owner, name, other);
    }
    const self = vm.globalOffset("self"), otherOffset = vm.globalOffset("other");
    const savedSelf = vm.globals.int(self), savedOther = vm.globals.int(otherOffset);
    try {
      vm.globals.setInt(self, entities.reference(slot)); vm.globals.setInt(otherOffset, other === null ? 0 : world.reference(other));
      vm.globals.setFloat(vm.globalOffset("time"), options.serverTime()); vm.execute(callback);
    } finally { vm.globals.setInt(self, savedSelf); vm.globals.setInt(otherOffset, savedOther); }
    return undefined;
  };
  const physical = options.physical({ read, write,
    link: (actor, touch) => {
      const slot = sourceSlot(actor.id);
      if (slot === null) { bodies.link(actor); } else world.link(slot);
      if (touch) options.touchTriggers(actor);
      return undefined;
    }, blocked: (actor, other) => invoke(actor.id, "blocked", other) });
  return { ...physical,
    collisionEnabled: (actor, enabled) => {
      const slot = sourceSlot(actor.id);
      if (slot !== null) entities.at(slot).setFloat(field("solid"), enabled ? 4 : 0);
      return physical.collisionEnabled(actor, enabled);
    },
    think: actor => invoke(actor.id, "think", null) };
}
