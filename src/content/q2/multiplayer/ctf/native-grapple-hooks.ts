import type { GrappleHooks } from "../../equipment/grapple-services.ts";
import { zero } from "../../foundation/fields.ts";
import type { Q2CtfHooks } from "./types.ts";

type NativeHooks = Pick<Q2CtfHooks, "player" | "weapons" | "setGrapplePrediction" | "gravity"> & Pick<GrappleHooks, "emit">;
export function nativeGrappleHooks(hooks: NativeHooks, weaponAim = true): GrappleHooks {
  return {
    pose: (actor, game) => {
      const entity = game.entity(actor);
      if (entity === null) throw new Error("Native grapple binding requires its source player entity");
      const input = weaponAim ? hooks.weapons.inputs.get(actor) : undefined;
      return { angles: input?.angles ?? game.host.playerViewState(actor)?.viewAngles ?? game.body(entity).angles,
        hand: input?.hand ?? hooks.player(actor)?.hand ?? "right", viewHeight: entity.viewHeight, gravity: entity.gravity, gravityVector: entity.gravityVector };
    },
    anchor: (actor, game) => {
      if (actor.equals(game.host.worldActor())) return "world";
      const entity = game.entity(actor);
      if (entity?.classname === "bodyque") return "corpse";
      if (!weaponAim && (entity?.classname.startsWith("info_flag") || entity?.classname.startsWith("func"))) return "brush";
      if (entity?.solid === "none") return "none";
      if (game.host.isPlayer(actor)) return "player";
      return entity?.solid === "box" ? "box" : entity?.solid === "brush" ? "brush" : "none";
    },
    dead: (actor, game) => {
      const combat = game.host.combat.read(actor);
      return hooks.player(actor)?.dead === true || combat?.canTakeDamage === true && combat.health <= 0;
    },
    previousVelocity: actor => hooks.player(actor)?.oldVelocity ?? zero,
    setPreviousVelocity: (actor, velocity) => { const player = hooks.player(actor); if (player !== null) player.oldVelocity = velocity; return undefined; },
    volume: actor => hooks.weapons.silencerShots(actor) > 0 ? 0.2 : 1,
    noise: (actor, game, origin, kind) => hooks.weapons.playerNoiseForActor(actor, game, origin, kind),
    setGrapplePrediction: (actor, suppressed) => hooks.setGrapplePrediction(actor, suppressed),
    gravity: () => hooks.gravity(), emit: event => hooks.emit(event),
  };
}
