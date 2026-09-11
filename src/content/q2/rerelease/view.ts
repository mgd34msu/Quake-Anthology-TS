import type { Vec3 } from "../../../contracts/math.ts";
import { dot, normalize, subtract, zero } from "../foundation/fields.ts";
import { angleVectors } from "../foundation/weapons/vectors.ts";
import type { Q2CharacterContext, Q2PlayerContext, Q2PlayerView } from "../base/player/types.ts";
import { q2BuildView, q2DamageFeedback } from "../base/player/view.ts";
import type { Q2RereleasePlayerState } from "./types.ts";

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
function kickRatio(until: number, now: number, duration: number, slack: number): number {
  const remaining = until - now;
  if (remaining <= 0) return 0;
  return slack !== 0 && remaining > duration ? (duration + slack - remaining) / slack : remaining / duration;
}

export function q2RereleaseDamageFeedback(context: Q2PlayerContext, extra: Q2RereleasePlayerState, painIndex: number): { readonly flashes: number; readonly painIndex: number } {
  const { state, game, entity } = context, now = game.host.now();
  const blood = state.damageBlood, armor = state.damageArmor, power = state.damagePowerArmor, kick = state.damageKnockback;
  const total = blood + armor + power, oldAlpha = state.damageAlpha, oldPain = state.painDebounce;
  const result = q2DamageFeedback(context, painIndex);
  if (result.flashes !== 0) { extra.flashes = result.flashes; extra.flashTime = now + 0.1; }
  else if (extra.flashTime < now) extra.flashes = 0;
  if (total !== 0) {
    extra.animationTime = 0;
    const count = blood !== 0 ? Math.max(total, 10) : Math.min(total, 2);
    state.damageAlpha = Math.max(0, oldAlpha);
    if (blood !== 0 || state.damageAlpha + count * 0.06 < 0.15) state.damageAlpha = clamp(state.damageAlpha + count * 0.06, 0.06, 0.4);
    state.damageBlend = normalize({ x: armor / total + (blood !== 0 ? Math.max(15, blood / total) : 0), y: (power + armor) / total, z: armor / total });
    const health = game.host.combat.read(entity.actor.id)?.health ?? 0;
    if (kick !== 0 && health > 0) {
      const amount = clamp(Math.abs(kick) * 100 / health, count * 0.5, 50), direction = normalize(subtract(state.damageFrom, game.body(entity).origin)), vectors = angleVectors(context.movement.viewAngles);
      state.damageRoll = amount * dot(direction, vectors.right) * 0.3; state.damagePitch = -amount * dot(direction, vectors.forward) * 0.3;
      state.damageTime = now + 0.5 + (0.1 - game.host.frameSeconds());
    }
    if (state.painDebounce > oldPain) context.hooks.noise(entity.actor.id, game.body(entity).origin);
  }
  return { flashes: extra.flashes, painIndex: result.painIndex };
}

export function q2RereleaseBuildView(context: Q2PlayerContext, extra: Q2RereleasePlayerState, flashes: number, intermission: boolean): Q2PlayerView {
  const { state, movement, game, entity, rules } = context, now = game.host.now(), dt = game.host.frameSeconds();
  const powers = context.powerups();
  const shared: Q2CharacterContext = { ...context, game: { host: game.host, options: game.options, body: entity => game.body(entity), move: (entity, changes, link) => game.move(entity, changes, link),
    sound: (entity, path, channel, volume, attenuation) => {
      const until = path === "items/damage2.wav" ? powers.quadUntil : path === "items/protect2.wav" ? powers.invulnerabilityUntil : path === "items/airout.wav" ? powers.enviroUntil > now ? powers.enviroUntil : powers.breatherUntil : null;
      if (until !== null && Math.round((until - now) * 1000) !== 3000) return undefined;
      return game.sound(entity, path, channel, volume, attenuation);
    } } };
  const alpha = state.damageAlpha, bonus = state.bonusAlpha, base = q2BuildView(shared, flashes, intermission);
  state.damageAlpha = Math.max(0, alpha - dt * 0.6); state.bonusAlpha = Math.max(0, bonus - dt);
  if (intermission) return { ...base, offset: zero };
  const body = game.body(entity), weapon = context.weaponState(), vectors = angleVectors(movement.viewAngles);
  const speed = Math.hypot(body.velocity.x, body.velocity.y), duck = movement.ducked && movement.grounded;
  const bobTime = state.bobTime * (duck ? 4 : 1), cycle = Math.trunc(bobTime), bob = Math.abs(Math.sin(bobTime * Math.PI));
  const sign = (cycle & 1) !== 0 ? -1 : 1, fall = kickRatio(state.fallTime, now, 0.3, 0.1 - dt);
  let kick = zero, offset = zero;
  if (!state.dead && !extra.bobSkip) {
    const recoil = weapon?.kickAngles ?? zero, damage = kickRatio(state.damageTime, now, 0.5, 0.1 - dt);
    kick = { x: recoil.x + damage * state.damagePitch + fall * state.fallValue + dot(body.velocity, vectors.forward) * rules.runPitch + Math.min(bob * rules.bobPitch * speed * (duck ? 6 : 1), 1.2),
      y: recoil.y, z: recoil.z + damage * state.damageRoll + dot(body.velocity, vectors.right) * rules.runRoll + Math.min(bob * rules.bobRoll * speed * (duck ? 6 : 1), 1.2) * sign };
    if (extra.quakeTime > now) {
      const factor = Math.min(1, extra.quakeTime / now * 0.25);
      kick = { x: kick.x + (game.host.random() * 2 - 1) * factor, y: kick.y + (game.host.random() * 2 - 1) * factor, z: kick.z + (game.host.random() * 2 - 1) * factor };
    }
  }
  if (!extra.bobSkip) {
    const recoil = weapon?.kickOrigin ?? zero;
    offset = { x: clamp(recoil.x, -14, 14), y: clamp(recoil.y, -14, 14), z: clamp(-fall * state.fallValue * 0.4 + Math.min(bob * speed * rules.bobUp, 6) + recoil.z, -22, 30) };
  }
  const sourceWeapon = context.weapons.states.get(entity.actor.id);
  let gun = zero;
  if (weapon !== null && !((weapon.q2Name === "heatbeam" || weapon.q2Name === "grapple") && sourceWeapon?.phase === "firing")) {
    const delta = subtract(state.oldViewAngles, base.angles), slow = extra.slowViewAngles;
    const reduce = (previous: number, change: number): { readonly kick: number; readonly value: number } => {
      let value = previous + change;
      if (value > 180) value -= 360;
      if (value < -180) value += 360;
      value = clamp(value, -45, 45);
      const amount = dt * 1000 * (change !== 0 ? 0.05 : 0.15);
      return { kick: value, value: value > 0 ? Math.max(0, value - amount) : Math.min(0, value + amount) };
    };
    const x = reduce(slow.x, delta.x), y = reduce(slow.y, delta.y), z = reduce(slow.z, delta.z);
    extra.slowViewAngles = { x: x.value, y: y.value, z: z.value };
    gun = { x: speed * bob * 0.005 + x.kick * 0.1, y: speed * bob * 0.01 * sign + y.kick * 0.1, z: -(speed * bob * 0.005 * sign + z.kick * 0.05) };
  }
  const kickAngles: Vec3 = { x: clamp(kick.x, -31, 31), y: clamp(kick.y, -31, 31), z: clamp(kick.z, -31, 31) };
  return { ...base, offset, kickAngles, gunAngles: gun };
}

export function q2RereleaseClientAnimation(context: Q2PlayerContext, extra: Q2RereleasePlayerState): undefined {
  const { state, movement, entity, game } = context;
  if (!movement.animateQ2 || state.gibbed) return undefined;
  const run = Math.hypot(game.body(entity).velocity.x, game.body(entity).velocity.y) !== 0, duck = movement.ducked;
  const priority = state.animationPriority === 6 ? 256 : state.animationPriority;
  const reversed = (priority & 256) !== 0;
  const changed = duck !== state.animationDuck && priority < 5 || run !== state.animationRun && priority === 0 || !movement.grounded && priority <= 1;
  if (!changed) {
    if (extra.animationTime > game.host.now()) return undefined;
    if (reversed && entity.frame > state.animationEnd || !reversed && entity.frame < state.animationEnd) {
      entity.frame += reversed ? -1 : 1; extra.animationTime = game.host.now() + 0.1; return undefined;
    }
    if (priority === 5) return undefined;
    if (priority === 2) {
      if (!movement.grounded) return undefined;
      state.animationPriority = duck ? 257 : 1; entity.frame = duck ? 71 : 68; state.animationEnd = duck ? 69 : 71;
      extra.animationTime = game.host.now() + 0.1; return undefined;
    }
  }
  state.animationPriority = 0; state.animationDuck = duck; state.animationRun = run; extra.animationTime = game.host.now() + 0.1;
  if (!movement.grounded && !extra.grappleAttached) {
    state.animationPriority = 2;
    if (duck) { if (entity.frame !== 155) entity.frame = 154; state.animationEnd = 155; }
    else { if (entity.frame !== 67) entity.frame = 66; state.animationEnd = 67; }
  } else if (movement.grounded && run) { entity.frame = duck ? 154 : 40; state.animationEnd = duck ? 159 : 45; }
  else { entity.frame = duck ? 135 : 0; state.animationEnd = duck ? 153 : 39; }
  return undefined;
}
