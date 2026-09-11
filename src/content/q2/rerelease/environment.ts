import type { Q2CharacterContext } from "../base/player/types.ts";
import type { Q2RereleaseOptions, Q2RereleasePlayerState } from "./types.ts";

export function q2RereleaseWorldEffects(context: Q2CharacterContext, extra: Q2RereleasePlayerState): undefined {
  const { entity, game, state, movement, hooks } = context, now = game.host.now();
  if (state.noclip || state.spectator) { state.airFinished = now + 12; return undefined; }
  const water = movement.waterLevel, old = state.oldWaterLevel, powers = context.powerups();
  const breather = powers.breatherUntil > now, suit = powers.enviroUntil > now;
  state.oldWaterLevel = water;
  const sound = (path: string, channel = 4): undefined => game.sound(entity, path, channel);
  const noise = (): undefined => hooks.noise(entity.actor.id, game.body(entity).origin);
  if (old === 0 && water !== 0) { noise(); sound((movement.waterType & 8) !== 0 ? "player/lava_in.wav" : "player/watr_in.wav"); entity.flags |= 8; }
  if (old !== 0 && water === 0) { noise(); sound("player/watr_out.wav"); entity.flags &= ~8; }
  if (old !== 3 && water === 3) sound("player/watr_un.wav");
  if (old === 3 && water !== 3 && (game.host.combat.read(entity.actor.id)?.health ?? 0) > 0) {
    if (state.airFinished < now) { sound("player/gasp1.wav", 2); noise(); }
    else if (state.airFinished < now + 11) sound("player/gasp2.wav", 2);
  }
  if (water === 3) {
    if (breather || suit) {
      state.airFinished = now + 10;
      if (Math.round((powers.breatherUntil - now) * 1000) % 2500 === 0) {
        sound(state.breatherSound === 0 ? "player/u_breath1.wav" : "player/u_breath2.wav", 0); state.breatherSound ^= 1; noise();
      }
    }
    const health = game.host.combat.read(entity.actor.id)?.health ?? 0;
    if (state.airFinished < now && state.nextDrownTime < now && health > 0) {
      state.nextDrownTime = now + 1; state.drownDamage = Math.min(state.drownDamage + 2, 15);
      sound(health <= state.drownDamage ? "*drown1.wav" : game.host.random() < 0.5 ? "*gurp2.wav" : "*gurp1.wav", 2);
      state.painDebounce = now; context.environmentDamage(state.drownDamage, 17, 2);
    } else if (state.airFinished <= now + 3 && state.nextDrownTime < now) {
      sound(`player/wade${1 + Math.trunc(now) % 3}.wav`, 2); state.nextDrownTime = now + 1;
    }
  } else { state.airFinished = now + 12; state.drownDamage = 2; }
  if (water !== 0 && (movement.waterType & 24) !== 0 && extra.slimeDebounce <= now) {
    if ((movement.waterType & 8) !== 0) {
      if ((game.host.combat.read(entity.actor.id)?.health ?? 0) > 0 && state.painDebounce <= now && powers.invulnerabilityUntil < now) {
        sound(game.host.random() < 0.5 ? "player/burn2.wav" : "player/burn1.wav", 2); state.painDebounce = now + 1;
      }
      context.environmentDamage((suit ? 1 : 3) * water, 19, 0);
    }
    if ((movement.waterType & 16) !== 0 && !suit) context.environmentDamage(water, 18, 0);
    extra.slimeDebounce = now + 0.1;
  }
  return undefined;
}

/** Rerelease P_FallingDamage consumes pmove's impact_delta after each ClientThink. */
export function q2RereleaseFallingDamage(context: Q2CharacterContext, extra: Q2RereleasePlayerState, options: Q2RereleaseOptions, frameSeconds: number): undefined {
  const { entity, game, state, movement } = context, now = game.host.now(), impact = extra.impactDelta;
  extra.impactDelta = 0;
  if (state.dead || state.noclip || state.spectator || (game.host.combat.read(entity.actor.id)?.health ?? 0) <= 0 || movement.waterLevel === 3 || extra.grappleReleasedUntil >= now || extra.grappleAttached) return undefined;
  let delta = impact * impact * 0.0001;
  if (movement.waterLevel === 2) delta *= 0.25;
  if (movement.waterLevel === 1) delta *= 0.5;
  if (delta < 1) return undefined;
  state.bobTime = 0;
  if (state.landmarkFreeFall) { delta = Math.min(30, delta); state.landmarkFreeFall = false; state.landmarkNoiseTime = now + 0.1; }
  if (delta < 15) { if (!extra.onLadder) state.event = "q2:footstep"; return undefined; }
  state.fallValue = Math.min(delta * 0.5, 40); state.fallTime = now + 0.3 + (0.1 - frameSeconds);
  if (delta > 30) {
    state.event = delta >= 55 ? "q2:fall-far" : "q2:fall"; state.painDebounce = now + frameSeconds;
    if (game.options.mode !== "deathmatch" || !options.deathmatchNoFallDamage) context.environmentDamage(Math.max(1, Math.trunc((delta - 30) / 2)), 22, 0);
  } else state.event = "q2:fall-short";
  if ((game.host.combat.read(entity.actor.id)?.health ?? 0) !== 0) context.hooks.noise(entity.actor.id, game.body(entity).origin);
  return undefined;
}
