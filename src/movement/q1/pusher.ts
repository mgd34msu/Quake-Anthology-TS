/* SV_PushMove and the separately selected rotating-pusher extension.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId } from "../../contracts/identity.ts";
import { sameActor } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import { MovementMath } from "./common.ts";
import { Q1_FLAG_ONGROUND, Q1_MOVE_NOCLIP, Q1_MOVE_NONE, Q1_MOVE_PUSH, Q1_MOVE_WALK,
  type Q1PhysicsEntity, type Q1PusherResult, type Q1PusherServices } from "./types.ts";

function overlap(a: Bounds, b: Bounds): boolean {
  return a.min.x < b.max.x && a.min.y < b.max.y && a.min.z < b.max.z
    && a.max.x > b.min.x && a.max.y > b.min.y && a.max.z > b.min.z;
}
function rider(entity: Q1PhysicsEntity, pusher: ActorId): boolean {
  return (entity.state.flags & Q1_FLAG_ONGROUND) !== 0 && entity.state.ground.kind === "actor"
    && sameActor(entity.state.ground.actor, pusher);
}

export interface Q1PusherInput {
  readonly actor: ActorId;
  readonly elapsedSeconds: number;
  /** Rotation is an explicit extension; ordinary NetQuake PUSH is translational. */
  readonly movement: "translate" | "rotate";
}

/** A single source pusher transaction. The shared scheduler chooses its traversal. */
export function moveQ1Pusher(input: Q1PusherInput, services: Q1PusherServices): Q1PusherResult {
  let pusher = services.read(input.actor);
  if (pusher === null) return { actor: input.actor, status: "actor-removed", moved: [] };
  if (!Number.isFinite(input.elapsedSeconds) || input.elapsedSeconds < 0) throw new RangeError("Invalid pusher interval");
  const m = new MovementMath(services.movement.numeric), n = m.n;
  const originalOrigin = pusher.state.origin, originalAngles = pusher.state.angles;
  const originalBounds = pusher.absoluteBounds;
  const velocity = input.movement === "rotate" ? pusher.state.angularVelocity : pusher.state.velocity;
  const delta = m.scale(velocity, input.elapsedSeconds);
  if (velocity.x === 0 && velocity.y === 0 && velocity.z === 0) {
    services.write({ ...pusher, localTimeSeconds: n.store(n.add(pusher.localTimeSeconds, input.elapsedSeconds)) });
    return { actor: input.actor, status: "moved", moved: [] };
  }
  pusher = { ...pusher, state: { ...pusher.state,
    origin: input.movement === "translate" ? m.add(pusher.state.origin, delta) : pusher.state.origin,
    angles: input.movement === "rotate" ? m.add(pusher.state.angles, delta) : pusher.state.angles },
    localTimeSeconds: n.store(n.add(pusher.localTimeSeconds, input.elapsedSeconds)) };
  services.write(pusher); services.link(pusher.actor, false);
  const pushed: { readonly actor: ActorId; readonly origin: Vec3 }[] = [];
  const axes = m.angles(m.scale(delta, -1));
  const linkedPusher = services.read(input.actor);
  if (linkedPusher === null) return { actor: input.actor, status: "actor-removed", moved: [] };
  const pusherBounds = input.movement === "translate"
    ? { min: m.add(originalBounds.min, delta), max: m.add(originalBounds.max, delta) } : linkedPusher.absoluteBounds;
  for (const actor of services.candidates()) {
    let entity = services.read(actor);
    if (entity === null || sameActor(actor, input.actor)) continue;
    if (entity.state.moveType === Q1_MOVE_PUSH || entity.state.moveType === Q1_MOVE_NONE || entity.state.moveType === Q1_MOVE_NOCLIP) continue;
    if (!rider(entity, input.actor)) {
      if (!overlap(entity.absoluteBounds, pusherBounds)) continue;
      if (services.testPosition(entity).kind === "none") continue;
    }
    if (entity.state.moveType !== Q1_MOVE_WALK) entity = { ...entity, state: { ...entity.state, flags: entity.state.flags & ~Q1_FLAG_ONGROUND } };
    const original = entity.state.origin;
    pushed.push({ actor, origin: original });
    let displacement = delta;
    if (input.movement === "rotate") {
      const offset = m.sub(entity.state.origin, pusher.state.origin);
      const rotated = m.vec(m.dot(offset, axes.forward), -m.dot(offset, axes.right), m.dot(offset, axes.up));
      displacement = m.sub(rotated, offset);
    }
    services.collisionEnabled(pusher.actor, false);
    try { entity = services.push(entity, displacement).entity; }
    finally {
      // A synchronous trigger may remove the pusher. Never relink a stale actor.
      if (services.read(input.actor) !== null) services.collisionEnabled(pusher.actor, true);
    }
    const livePusher = services.read(input.actor);
    if (livePusher === null) return { actor: input.actor, status: "actor-removed", moved: pushed.map(value => value.actor) };
    pusher = livePusher;
    if (entity === null) continue;
    if (services.testPosition(entity).kind === "none") {
      if (input.movement === "rotate") services.write({ ...entity, state: { ...entity.state, angles: m.add(entity.state.angles, delta) } });
      continue;
    }
    if (entity.bounds.min.x === entity.bounds.max.x) continue;
    if (entity.solid === "not" || entity.solid === "trigger") {
      const minimum = m.vec(0, 0, entity.bounds.min.z);
      services.write({ ...entity, bounds: { min: minimum, max: minimum } });
      continue;
    }
    entity = { ...entity, state: { ...entity.state, origin: original } };
    services.write(entity); services.link(entity.actor, true);
    const currentPusher = services.read(input.actor);
    if (currentPusher === null) return { actor: input.actor, status: "actor-removed", moved: pushed.map(value => value.actor) };
    services.write({ ...currentPusher, state: { ...currentPusher.state,
      origin: input.movement === "translate" ? originalOrigin : currentPusher.state.origin,
      angles: input.movement === "rotate" ? originalAngles : currentPusher.state.angles },
      localTimeSeconds: n.store(n.subtract(currentPusher.localTimeSeconds, input.elapsedSeconds)) });
    services.link(currentPusher.actor, false);
    services.blocked(currentPusher.actor, actor);
    // Source blocked() runs before rollback, so preserve its damage, removals and
    // state changes while restoring only the positions owned by this transaction.
    for (const moved of pushed) {
      const current = services.read(moved.actor);
      if (current === null) continue;
      services.write({ ...current, state: { ...current.state, origin: moved.origin,
        angles: input.movement === "rotate" ? m.sub(current.state.angles, delta) : current.state.angles } });
      services.link(current.actor, false);
    }
    return { actor: input.actor, status: services.read(input.actor) === null ? "actor-removed" : "blocked", moved: pushed.map(value => value.actor) };
  }
  return { actor: input.actor, status: "moved", moved: pushed.map(value => value.actor) };
}

/** Think timing uses local pusher time, including blocked moves that do not advance. */
export function stepQ1Pusher(input: Q1PusherInput, services: Q1PusherServices): Q1PusherResult {
  const pusher = services.read(input.actor);
  if (pusher === null) return { actor: input.actor, status: "actor-removed", moved: [] };
  const n = services.movement.numeric, oldTime = pusher.localTimeSeconds, thinkTime = pusher.nextThinkSeconds;
  const moveTime = thinkTime < n.add(oldTime, input.elapsedSeconds) ? Math.max(0, n.subtract(thinkTime, oldTime)) : input.elapsedSeconds;
  const result = moveTime === 0 ? { actor: input.actor, status: "moved", moved: [] } satisfies Q1PusherResult
    : moveQ1Pusher({ ...input, elapsedSeconds: moveTime }, services);
  const current = services.read(input.actor);
  if (current === null) return { ...result, status: "actor-removed" };
  if (thinkTime > oldTime && thinkTime <= current.localTimeSeconds) {
    services.write({ ...current, nextThinkSeconds: 0 });
    services.think(current.actor);
  }
  return services.read(input.actor) === null ? { ...result, status: "actor-removed" } : result;
}
