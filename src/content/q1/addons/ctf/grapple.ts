/* quakec_ctf/hook.qc: moving anchors, damage pulses and source beam attachment. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub, vectors } from "../../foundation/types.ts";
import { aim } from "../../foundation/weapons.ts";
import { CTF_FLAGS } from "./types.ts";
import type { CtfState } from "./state.ts";

export function unhook(state: CtfState, actor: ActorId): undefined {
  const animation = state.game.entity(state.context.playerReference(actor, "ctf.hookAnimation"));
  if (animation !== null) state.game.remove(animation);
  state.context.setPlayerReference(actor, "ctf.hookAnimation", null);
  state.set(actor, "hookPulling", 0);
  const hook = state.hook(actor); if (hook === null) return undefined;
  for (const link of state.game.entities.values()) if (link.classname === "ctf_hook_link" && link.owner !== null && sameActor(link.owner, hook.actor.id)) state.game.remove(link);
  return state.game.remove(hook);
}

function vanish(state: CtfState, hook: Q1Actor): undefined {
  if (hook.owner !== null && state.game.host.actors.isLive(hook.owner)) return unhook(state, hook.owner);
  return state.game.remove(hook);
}
function hookPull(state: CtfState, hook: Q1Actor): undefined {
  const { game } = state, owner = hook.owner, enemy = hook.references.get("ctf.enemy");
  if (owner === null || !game.host.actors.isLive(owner) || enemy === undefined || enemy === null || !game.host.actors.isLive(enemy)) return vanish(state, hook);
  const input = state.services.input(owner), target = game.entity(enemy);
  state.set(owner, "hookPulling", 1);
  if (!input.attack && input.grappleSelected || input.teleportUntil > game.time || game.health(owner) <= 0 || target?.solid === "none") return vanish(state, hook);
  const enemyBody = state.body(enemy), enemyCombat = game.host.combat.read(enemy);
  if (enemyCombat?.canTakeDamage && (!game.isPlayer(enemy) || state.teamplay === 0 || state.lastTeam(enemy) !== state.lastTeam(owner))) {
    if (!game.canDamage(enemy, owner)) return vanish(state, hook);
    game.sound(hook, "blob/land1.wav", "weapon"); game.damage(enemy, hook.actor.id, owner, 1, null, "direct", "ctf:grapple");
    const spray = { x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 100 * (game.host.random() * 2 - 1) + 50 };
    game.host.emit({ kind: "particles", origin: game.body(hook).origin, direction: vscale(spray, 0.1), color: 73, count: 40 });
  }
  if (game.isPlayer(enemy) || target?.solid === "slidebox") game.setBody(hook, { velocity: ZERO,
    origin: vadd(enemyBody.origin, vscale(vadd(enemyBody.bounds.min, enemyBody.bounds.max), 0.5)) });
  else game.setBody(hook, { velocity: enemyBody.velocity });
  const body = state.body(owner), basis = vectors(body.angles);
  const relative = vsub(game.body(hook).origin, vadd(body.origin, vadd(vscale(basis.up, input.jump ? 0 : 16), vscale(basis.forward, 16))));
  const distance = length(relative), velocity = vscale(normalize(relative), distance <= 100 ? distance * 10 : 1000);
  const traveled = length(vsub(body.origin, hook.vector("ctf.lastOrigin")));
  if (traveled > 10 && hook.number("style") === 3) state.context.setNumber(hook, "style", 2);
  if (traveled < 10 && hook.number("style") === 2) state.context.setNumber(hook, "style", 3);
  state.writeBody(owner, { velocity }); state.context.setVector(hook, "ctf.lastOrigin", body.origin); game.link(hook);
  return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_pull"));
}

export function hookTouch(state: CtfState, hook: Q1Actor, other: ActorId): undefined {
  const { game } = state, owner = hook.owner;
  if (owner === null || !game.host.actors.isLive(owner)) return vanish(state, hook);
  if (sameActor(owner, other)) return undefined;
  if (game.host.contents(game.body(hook).origin) === "sky") return vanish(state, hook);
  if (game.isPlayer(other) && state.teamplay !== 0 && state.team(other) === state.lastTeam(owner)) return undefined;
  const target = game.entity(other), combat = game.host.combat.read(other);
  if (combat?.canTakeDamage) {
    if (!game.isPlayer(other)) game.sound(hook, "player/axhit2.wav", "weapon");
    game.damage(other, hook.actor.id, owner, 10, "ctf:grapple", "direct", "ctf:grapple");
    game.host.emit({ kind: "particles", origin: game.body(hook).origin, direction: vscale(game.body(hook).velocity, 0.1), color: 73, count: 20 });
  } else { game.sound(hook, "player/axhit2.wav", "weapon"); hook.angularVelocity = ZERO; }
  if (!state.services.input(owner).attack) return vanish(state, hook);
  const body = state.body(other);
  if (game.isPlayer(other) || target?.solid === "slidebox") game.setBody(hook, { origin: vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), velocity: ZERO });
  else game.setBody(hook, { velocity: body.velocity });
  hook.references.set("ctf.enemy", other); state.context.setNumber(hook, "style", 2);
  hook.touch = null; game.link(hook); return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_pull"));
}
export function fireHook(state: CtfState, actor: ActorId): boolean {
  const { game } = state;
  if (state.hook(actor) !== null || (state.teamplay & CTF_FLAGS.disableGrapple) !== 0 || game.health(actor) <= 0 || state.services.observer(actor)) return false;
  const hook = game.create("ctf_hook"), forward = vectors(state.services.input(actor).viewAngles).forward, direction = aim(game, state.owner(actor), forward);
  hook.owner = actor; hook.movement = "fly"; hook.solid = "bbox"; hook.model = "progs/star.mdl"; hook.angularVelocity = { x: 0, y: 0, z: -500 };
  hook.touch = game.named.touch(hook, "ctf:hook_touch"); state.context.setNumber(hook, "ctf.fired", game.time);
  const yaw = Math.atan2(direction.y, direction.x) * 180 / Math.PI, pitch = Math.atan2(direction.z, Math.hypot(direction.x, direction.y)) * 180 / Math.PI;
  game.setBody(hook, { origin: vadd(state.body(actor).origin, vadd(vscale(forward, 16), { x: 0, y: 0, z: 16 })), bounds: POINT,
    velocity: vscale(direction, 800), angles: { x: pitch, y: yaw < 0 ? yaw + 360 : yaw, z: 0 } }); game.link(hook);
  game.sound(state.owner(actor), "weapons/chain1.wav", "weapon"); game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_flying")); return true;
}
export function grappleTrail(state: CtfState, actor: ActorId): undefined {
  const hook = state.hook(actor); if (hook === null) return undefined;
  const body = state.game.body(hook), offset = vscale(vectors(body.angles).forward, -7);
  return state.game.host.emit({ kind: "beam", style: "grapple", actor: hook.actor.id, start: vadd(body.origin, { ...offset, z: -offset.z }), end: vadd(state.body(actor).origin, { x: 0, y: 0, z: 16 }) });
}
export function registerGrapple(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:hook_touch", { touch: (_game, hook, actor) => hookTouch(state, hook, actor) });
  game.named.register("ctf:hook_pull", { action: (_game, hook) => hookPull(state, hook) });
  game.named.register("ctf:hook_flying", { action: (_game, hook) => {
    const owner = hook.owner;
    if (owner === null || !game.host.actors.isLive(owner) || game.time >= hook.number("ctf.fired") + 5) return vanish(state, hook);
    const input = state.services.input(owner); if (!input.attack && input.grappleSelected) return vanish(state, hook);
    return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_flying"));
  } }); return undefined;
}
