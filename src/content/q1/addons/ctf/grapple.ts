/* Native Threewave activation and team rules; mechanics live in shared-actor equipment. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { aim } from "../../foundation/weapons.ts";
import { ThreewaveGrapple } from "../../equipment/threewave-grapple.ts";
import { CTF_FLAGS } from "./types.ts";
import type { CtfState } from "./state.ts";

export function createGrapple(state: CtfState): ThreewaveGrapple {
  const { game } = state;
  return new ThreewaveGrapple(game, {
    input: actor => {
      const input = state.services.input(actor);
      return { held: input.attack, release: !input.attack && input.grappleSelected, jump: input.jump, viewAngles: input.viewAngles, teleportUntil: input.teleportUntil };
    },
    aim: (actor, forward) => aim(game, state.owner(actor), forward),
    anchor: actor => { const target = game.entity(actor), player = game.isPlayer(actor);
      return { solid: target?.solid !== "none", centered: player || target?.solid === "slidebox", player }; },
    canAttach: (owner, target) => !game.isPlayer(target) || state.teamplay === 0 || state.team(target) !== state.lastTeam(owner),
    canPulse: (owner, target) => !game.isPlayer(target) || state.teamplay === 0 || state.lastTeam(target) !== state.lastTeam(owner),
    canDamage: (target, owner) => game.canDamage(target, owner),
  });
}
export function unhook(state: CtfState, actor: ActorId): undefined { return state.grapple !== null ? state.grapple.release(actor) : state.sharedGrapple?.release(actor); }
export function hookTouch(state: CtfState, hook: Q1Actor, other: ActorId): undefined { return state.grapple?.touch(hook, other); }
export function fireHook(state: CtfState, actor: ActorId): boolean {
  if ((state.teamplay & CTF_FLAGS.disableGrapple) !== 0 || state.services.observer(actor)) return false;
  return state.grapple?.fire(actor) ?? false;
}
export function grappleTrail(state: CtfState, actor: ActorId): undefined { return state.grapple?.trail(actor); }
