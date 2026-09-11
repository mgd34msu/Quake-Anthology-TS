import type { Q2CharacterContext } from "./types.ts";

/** p_view.c P_WorldEffects runs once on the selected Q2 source frame. */
export function q2WorldEffects(context: Q2CharacterContext): undefined {
  const { entity, game, state, movement, hooks } = context;
  const now = game.host.now();
  if (state.noclip || state.spectator) { state.airFinished = now + 12; return undefined; }
  const level = movement.waterLevel, old = state.oldWaterLevel;
  const powers = context.powerups();
  const breather = powers.breatherUntil > now, suit = powers.enviroUntil > now;
  state.oldWaterLevel = level;
  const sound = (path: string, channel = 4): undefined => game.sound(entity, path, channel);
  const noise = (): undefined => hooks.noise(entity.actor.id, game.body(entity).origin);
  if (old === 0 && level !== 0) {
    noise(); sound((movement.waterType & 8) !== 0 ? "player/lava_in.wav" : "player/watr_in.wav"); entity.flags |= 8;
  }
  if (old !== 0 && level === 0) { noise(); sound("player/watr_out.wav"); entity.flags &= ~8; }
  if (old !== 3 && level === 3) sound("player/watr_un.wav");
  if (old === 3 && level !== 3) {
    if (state.airFinished < now) { sound("player/gasp1.wav", 2); noise(); }
    else if (state.airFinished < now + 11) sound("player/gasp2.wav", 2);
  }
  if (level === 3) {
    if (breather || suit) {
      state.airFinished = now + 10;
      const remaining = Math.round((powers.breatherUntil - now) * 10);
      if (remaining % 25 === 0) {
        sound(state.breatherSound === 0 ? "player/u_breath1.wav" : "player/u_breath2.wav", 0);
        state.breatherSound ^= 1; noise();
      }
    }
    const health = game.host.combat.read(entity.actor.id)?.health ?? 0;
    if (state.airFinished < now && state.nextDrownTime < now && health > 0) {
      state.nextDrownTime = now + 1;
      state.drownDamage = Math.min(state.drownDamage + 2, 15);
      sound(health <= state.drownDamage ? "player/drown1.wav" : game.host.random() < 0.5 ? "*gurp2.wav" : "*gurp1.wav", 2);
      state.painDebounce = now;
      q2EnvironmentDamage(context, state.drownDamage, 17, 2);
    }
  } else { state.airFinished = now + 12; state.drownDamage = 2; }
  if (level !== 0 && (movement.waterType & (8 | 16)) !== 0) {
    if ((movement.waterType & 8) !== 0) {
      if ((game.host.combat.read(entity.actor.id)?.health ?? 0) > 0 && state.painDebounce <= now && powers.invulnerabilityUntil < now) {
        sound(game.host.random() < 0.5 ? "player/burn2.wav" : "player/burn1.wav", 2); state.painDebounce = now + 1;
      }
      q2EnvironmentDamage(context, (suit ? 1 : 3) * level, 19);
    }
    if ((movement.waterType & 16) !== 0 && !suit) q2EnvironmentDamage(context, level, 18);
  }
  return undefined;
}

export function q2EnvironmentDamage(context: Q2CharacterContext, amount: number, means: number, flags = 0): undefined {
  return context.environmentDamage(amount, means, flags);
}

export function q2FallingDamage(context: Q2CharacterContext): undefined {
  const { entity, game, movement, state } = context;
  if (!movement.animateQ2 || state.noclip || state.spectator) return undefined;
  const velocity = game.body(entity).velocity;
  let delta: number;
  if (state.oldVelocity.z < 0 && velocity.z > state.oldVelocity.z && !movement.grounded) delta = state.oldVelocity.z;
  else { if (!movement.grounded) return undefined; delta = velocity.z - state.oldVelocity.z; }
  delta = delta * delta * 0.0001;
  if (movement.waterLevel === 3) return undefined;
  if (movement.waterLevel === 2) delta *= 0.25;
  if (movement.waterLevel === 1) delta *= 0.5;
  if (delta < 1) return undefined;
  if (state.landmarkFreeFall) { delta = Math.min(30, delta); state.landmarkFreeFall = false; state.landmarkNoiseTime = game.host.now() + 0.1; }
  if (delta < 15) { state.event = "q2:footstep"; return undefined; }
  state.fallValue = Math.min(delta * 0.5, 40); state.fallTime = game.host.now() + 0.3;
  if (delta > 30) {
    if ((game.host.combat.read(entity.actor.id)?.health ?? 0) > 0) state.event = delta >= 55 ? "q2:fall-far" : "q2:fall";
    state.painDebounce = game.host.now();
    if (game.options.mode !== "deathmatch" || (game.options.deathmatchFlags & 8) === 0) q2EnvironmentDamage(context, Math.max(1, Math.trunc((delta - 30) / 2)), 22);
  } else state.event = "q2:fall-short";
  return undefined;
}
