/* quakec_ctf/observ.qc. The selected movement host owns observer admission and collision. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { ZERO, dot, length, normalize, vadd, vscale, vsub, vectors } from "../../foundation/types.ts";
import type { CtfState } from "./state.ts";
import { spawnPoint } from "./teams.ts";

export function becomeObserver(state: CtfState, actor: ActorId): undefined {
  state.services.setObserver(actor, true);
  state.game.host.combat.setHealth(state.owner(actor), 999);
  state.game.host.combat.setTraits(state.owner(actor), { canTakeDamage: false });
  return state.writeBody(actor, { bounds: { min: { x: -12, y: -12, z: -12 }, max: { x: 12, y: 12, z: 12 } } });
}
function throughDoor(state: CtfState, actor: ActorId, door: Q1Actor): undefined {
  const master = door.doorGroup[0] ?? state.game.entity(door.owner);
  if (master === null || master.state !== "bottom") return undefined;
  const members = master.doorGroup.length === 0 ? [master] : master.doorGroup;
  let min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const member of members) {
    const body = state.game.body(member), low = vadd(body.origin, body.bounds.min), high = vadd(body.origin, body.bounds.max);
    min = { x: Math.min(min.x, low.x), y: Math.min(min.y, low.y), z: Math.min(min.z, low.z) };
    max = { x: Math.max(max.x, high.x), y: Math.max(max.y, high.y), z: Math.max(max.z, high.z) };
  }
  const body = state.body(actor), low = vadd(body.origin, body.bounds.min), high = vadd(body.origin, body.bounds.max);
  const x = min.x + 15 < low.x && high.x < max.x - 15, y = min.y + 15 < low.y && high.y < max.y - 15, z = min.z + 15 < low.z && high.z < max.z - 15;
  let direction: Vec3 = ZERO, origin = body.origin;
  if (x && y) { if (origin.z < min.z) { direction = { x: 0, y: 0, z: 1 }; origin = { ...origin, z: max.z + 25 }; } else if (origin.z > max.z) { direction = { x: 0, y: 0, z: -1 }; origin = { ...origin, z: min.z - 25 }; } }
  else if (x && z) { if (origin.y < min.y) { direction = { x: 0, y: 1, z: 0 }; origin = { ...origin, y: max.y + 25 }; } else if (origin.y > max.y) { direction = { x: 0, y: -1, z: 0 }; origin = { ...origin, y: min.y - 25 }; } }
  else if (y && z) { if (origin.x < min.x) { direction = { x: 1, y: 0, z: 0 }; origin = { ...origin, x: max.x + 25 }; } else if (origin.x > max.x) { direction = { x: -1, y: 0, z: 0 }; origin = { ...origin, x: min.x - 25 }; } }
  if (dot(direction, normalize(body.velocity)) >= 0.5) state.writeBody(actor, { origin });
  return undefined;
}
function throughTeleporter(state: CtfState, actor: ActorId, teleporter: Q1Actor): undefined {
  const body = state.body(actor), teleBody = state.game.body(teleporter);
  const direction = vsub(vadd(teleBody.origin, vscale(vadd(teleBody.bounds.min, teleBody.bounds.max), 0.5)), body.origin);
  // The QC calls normalize without assigning its return value here.
  if (dot(direction, body.velocity) <= 0.1) return undefined;
  const target = state.game.find(teleporter.target)[0]; if (target === undefined) return undefined;
  return state.services.teleport(actor, state.game.body(target).origin, target.mangle, vscale(vectors(target.mangle).forward, 300), state.game.time + 0.7);
}
export function observerFrame(state: CtfState, actor: ActorId): undefined {
  const body = state.body(actor), input = state.services.input(actor), forward = vectors(input.viewAngles).forward;
  const horizontal = { x: forward.x, y: forward.y, z: 0 }, cosine = length(horizontal), inverse = cosine === 0 ? 0 : 1 / cosine;
  const facing = vscale(horizontal, inverse), velocity = { ...body.velocity, z: 0 }, parallel = vscale(facing, dot(facing, velocity)), strafe = vsub(velocity, parallel);
  let projected = vscale(forward, (dot(facing, velocity) < 0 ? -length(parallel) : length(parallel)) * inverse);
  projected = { ...projected, z: projected.z + body.velocity.z * 0.75 };
  const speed = length(projected), maximum = 320 - 100 * forward.z;
  if (speed > maximum) projected = vscale(projected, maximum / speed);
  if (Math.abs(body.angles.x) === 30) projected = { ...projected, z: -projected.z };
  state.writeBody(actor, { velocity: vadd(projected, strafe) });
  for (const entity of state.game.entities.values()) {
    const target = state.game.body(entity), center = vadd(target.origin, vscale(vadd(target.bounds.min, target.bounds.max), 0.5));
    if (length(vsub(center, body.origin)) > 75) continue;
    if (entity.classname === "func_door") { throughDoor(state, actor, entity); break; }
    if (entity.classname === "trigger_teleport") { throughTeleporter(state, actor, entity); break; }
  }
  if (input.jump && state.number(actor, "observerJumpHeld") === 0) {
    const spot = spawnPoint(state, actor);
    if (spot !== null) state.services.teleport(actor, vadd(state.game.body(spot).origin, { x: 0, y: 0, z: 1 }), state.game.body(spot).angles, state.body(actor).velocity, input.teleportUntil);
  }
  state.set(actor, "observerJumpHeld", input.jump ? 1 : 0); return undefined;
}
