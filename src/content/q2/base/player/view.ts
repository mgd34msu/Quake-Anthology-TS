import type { Vec3, Vec4 } from "../../../../contracts/math.ts";
import { add, dot, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import type { Q2CharacterContext, Q2PlayerView, Q2PlayerState } from "./types.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
export function addQ2Blend(blend: Vec4, color: Vec3, alpha: number): Vec4 {
  if (alpha <= 0) return blend;
  const total = blend.w + (1 - blend.w) * alpha, old = blend.w / total;
  return { x: blend.x * old + color.x * (1 - old), y: blend.y * old + color.y * (1 - old), z: blend.z * old + color.z * (1 - old), w: total };
}

export function q2PainAnimationFrames(ducked: boolean, index: number) {
  return ducked ? { first: 168, last: 172 } : { first: 53 + index * 4, last: 57 + index * 4 };
}

export function q2DeathAnimationFrames(ducked: boolean, index: number) {
  return ducked ? { first: 172, last: 177 } : index === 0 ? { first: 177, last: 183 }
    : index === 1 ? { first: 183, last: 189 } : { first: 189, last: 197 };
}

export function q2DamageFeedback(context: Q2CharacterContext, painIndex: number): { readonly flashes: number; readonly painIndex: number } {
  const { state, entity, game, movement } = context, now = game.host.now();
  const powers = context.powerups();
  const flashes = (state.damageBlood !== 0 ? 1 : 0) | (state.damageArmor !== 0 && !state.god && powers.invulnerabilityUntil <= now ? 2 : 0);
  const total = state.damageBlood + state.damageArmor + state.damagePowerArmor;
  if (total === 0) return { flashes, painIndex };
  game.host.emit({ kind: "damage-indicator", actor: entity.actor.id, origin: { ...state.damageFrom }, amount: total });
  let nextPain = painIndex;
  if (movement.animateQ2 && state.animationPriority < 3) {
    state.animationPriority = 3;
    if (!movement.ducked) nextPain = (painIndex + 1) % 3;
    const frames = q2PainAnimationFrames(movement.ducked, nextPain);
    entity.frame = frames.first; state.animationEnd = frames.last;
  }
  const count = Math.max(total, 10), health = game.host.combat.read(entity.actor.id)?.health ?? 0;
  if (now > state.painDebounce && !state.god && powers.invulnerabilityUntil <= now) {
    const severity = health < 25 ? 25 : health < 50 ? 50 : health < 75 ? 75 : 100;
    game.sound(entity, `*pain${severity}_${Math.floor(game.host.random() * 2) + 1}.wav`, 2);
    state.painDebounce = now + 0.7;
  }
  state.damageAlpha = clamp(Math.max(state.damageAlpha, 0) + count * 0.01, 0.2, 0.6);
  state.damageBlend = { x: (state.damageArmor + state.damageBlood) / total, y: (state.damagePowerArmor + state.damageArmor) / total, z: state.damageArmor / total };
  if (state.damageKnockback !== 0 && health > 0) {
    const kick = clamp(Math.abs(state.damageKnockback) * 100 / health, count * 0.5, 50);
    const direction = normalize(subtract(state.damageFrom, game.body(entity).origin));
    const vectors = angleVectors(movement.viewAngles);
    state.damageRoll = kick * dot(direction, vectors.right) * 0.3;
    state.damagePitch = kick * -dot(direction, vectors.forward) * 0.3;
    state.damageTime = now + 0.5;
  }
  state.damageBlood = 0; state.damageArmor = 0; state.damagePowerArmor = 0; state.damageKnockback = 0;
  return { flashes, painIndex: nextPain };
}

function angleDifference(old: number, current: number): number {
  let delta = old - current;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return clamp(delta, -45, 45);
}

/** Each seat gets a complete source view; no module-global current player/vectors. */
export function q2BuildView(context: Q2CharacterContext, flashes: number, intermission: boolean): Q2PlayerView {
  const { state, entity, game, movement, rules } = context;
  const body = game.body(entity), now = game.host.now(), health = game.host.combat.read(entity.actor.id)?.health ?? 0;
  const weapon = context.weaponState(), powers = context.powerups();
  const vectors = angleVectors(movement.viewAngles), speed = Math.hypot(body.velocity.x, body.velocity.y);
  const bobTime = movement.ducked ? state.bobTime * 4 : state.bobTime, bobCycle = Math.trunc(bobTime), bob = Math.abs(Math.sin(bobTime * Math.PI));
  let angles = movement.viewAngles;
  let kicks = weapon?.kickAngles ?? zero;
  if (state.dead) { angles = { x: -15, y: state.killerYaw, z: 40 }; kicks = zero; }
  else {
    const damageRatio = Math.max(0, (state.damageTime - now) / 0.5), fallRatio = Math.max(0, (state.fallTime - now) / 0.3);
    if (damageRatio === 0) { state.damagePitch = 0; state.damageRoll = 0; }
    const duck = movement.ducked ? 6 : 1;
    kicks = { x: kicks.x + damageRatio * state.damagePitch + fallRatio * state.fallValue + dot(body.velocity, vectors.forward) * rules.runPitch + bob * rules.bobPitch * speed * duck,
      y: kicks.y, z: kicks.z + damageRatio * state.damageRoll + dot(body.velocity, vectors.right) * rules.runRoll + bob * rules.bobRoll * speed * duck * ((bobCycle & 1) !== 0 ? -1 : 1) };
  }
  const recoil = weapon?.kickOrigin ?? zero;
  const offset: Vec3 = { x: clamp(recoil.x, -14, 14), y: clamp(recoil.y, -14, 14),
    z: clamp(entity.viewHeight - Math.max(0, (state.fallTime - now) / 0.3) * state.fallValue * 0.4 + Math.min(bob * speed * rules.bobUp, 6) + recoil.z, -22, 30) };
  const yawDelta = angleDifference(state.oldViewAngles.y, angles.y);
  const gunAngles: Vec3 = { x: speed * bob * 0.005 + angleDifference(state.oldViewAngles.x, angles.x) * 0.2,
    y: speed * bob * 0.01 * ((bobCycle & 1) !== 0 ? -1 : 1) + yawDelta * 0.2,
    z: speed * bob * 0.005 * ((bobCycle & 1) !== 0 ? -1 : 1) + angleDifference(state.oldViewAngles.z, angles.z) * 0.2 + yawDelta * 0.1 };
  const gunOffset = add(add(scale(vectors.forward, rules.gunOffset.y), scale(vectors.right, rules.gunOffset.x)), scale(vectors.up, -rules.gunOffset.z));
  const contents = game.host.pointContents(add(body.origin, offset));
  let blend: Vec4 = { x: 0, y: 0, z: 0, w: 0 };
  if ((contents & 9) !== 0) blend = addQ2Blend(blend, { x: 1, y: 0.3, z: 0 }, 0.6);
  else if ((contents & 16) !== 0) blend = addQ2Blend(blend, { x: 0, y: 0.1, z: 0.05 }, 0.6);
  else if ((contents & 32) !== 0) blend = addQ2Blend(blend, { x: 0.5, y: 0.3, z: 0.2 }, 0.4);
  const power = powers.quadUntil > now ? { item: "q2:item_quad", until: powers.quadUntil, sound: "items/damage2.wav", color: { x: 0, y: 0, z: 1 }, alpha: 0.08 }
    : powers.invulnerabilityUntil > now ? { item: "q2:item_invulnerability", until: powers.invulnerabilityUntil, sound: "items/protect2.wav", color: { x: 1, y: 1, z: 0 }, alpha: 0.08 }
      : powers.enviroUntil > now ? { item: "q2:item_enviro", until: powers.enviroUntil, sound: "items/airout.wav", color: { x: 0, y: 1, z: 0 }, alpha: 0.08 }
        : powers.breatherUntil > now ? { item: "q2:item_breather", until: powers.breatherUntil, sound: "items/airout.wav", color: { x: 0.4, y: 1, z: 0.4 }, alpha: 0.04 } : null;
  if (power !== null) {
    const remaining = Math.round((power.until - now) * 10);
    if (remaining === 30) game.sound(entity, power.sound, 3);
    if (remaining > 30 || (remaining & 4) !== 0) blend = addQ2Blend(blend, power.color, power.alpha);
  }
  blend = addQ2Blend(blend, state.damageBlend, state.damageAlpha);
  blend = addQ2Blend(blend, { x: 0.85, y: 0.7, z: 0.3 }, state.bonusAlpha);
  state.damageAlpha = Math.max(0, state.damageAlpha - 0.06); state.bonusAlpha = Math.max(0, state.bonusAlpha - 0.1);
  const combat = game.host.combat.read(entity.actor.id), armor = combat?.armor;
  const armorPoints = armor === undefined || armor.kind === "none" ? 0 : armor.points;
  const activeWeapon = weapon?.q2Name;
  const ammo = activeWeapon === undefined || activeWeapon === null ? null : weapon?.ammo ?? null;
  const timer = powers.quadUntil > now ? { item: "q2:item_quad", seconds: Math.trunc(powers.quadUntil - now) }
    : powers.invulnerabilityUntil > now ? { item: "q2:item_invulnerability", seconds: Math.trunc(powers.invulnerabilityUntil - now) }
      : powers.enviroUntil > now ? { item: "q2:item_enviro", seconds: Math.trunc(powers.enviroUntil - now) }
        : powers.breatherUntil > now ? { item: "q2:item_breather", seconds: Math.trunc(powers.breatherUntil - now) } : null;
  return { angles, offset: intermission ? zero : offset, kickAngles: intermission ? zero : kicks, gunAngles, gunOffset,
    blend: intermission ? { x: 0, y: 0, z: 0, w: 0 } : blend, fov: intermission ? 90 : state.fov, underwater: !intermission && (contents & 56) !== 0,
    flashes, health, armor: armor?.kind === "q2" && armor.powerArmor.kind !== "none" && (armorPoints === 0 || (Math.round(now * 10) & 8) !== 0) ? armor.powerArmor.cells : armorPoints,
    ammo: ammo === null ? 0 : game.host.inventory.count(entity.actor.id, ammo), score: state.score, selectedItem: state.selectedItem,
    timer: timer === null ? null : { item: timer.item === "q2:item_quad" ? "q2:item_quad" : timer.item === "q2:item_invulnerability" ? "q2:item_invulnerability" : timer.item === "q2:item_enviro" ? "q2:item_enviro" : "q2:item_breather", seconds: timer.seconds },
    spectator: state.spectator, layouts: (state.showScores || state.showHelp || health <= 0 || intermission ? 1 : 0) | (state.showInventory && health > 0 ? 2 : 0) };
}

export function q2ClientAnimation(context: Q2CharacterContext): undefined {
  const { state, movement, entity, game } = context;
  if (!movement.animateQ2 || state.gibbed) return undefined;
  return advanceQ2PlayerAnimation(state, entity, movement.grounded, movement.ducked,
    Math.hypot(game.body(entity).velocity.x, game.body(entity).velocity.y) !== 0);
}

export function advanceQ2PlayerAnimation(state: Pick<Q2PlayerState, "animationPriority" | "animationDuck" | "animationRun" | "animationEnd">,
  entity: { frame: number }, grounded: boolean, duck: boolean, run: boolean): undefined {
  const changed = duck !== state.animationDuck && state.animationPriority < 5 || run !== state.animationRun && state.animationPriority === 0 || !grounded && state.animationPriority <= 1;
  if (!changed) {
    if (state.animationPriority === 6) { if (entity.frame > state.animationEnd) { entity.frame--; return undefined; } }
    else if (entity.frame < state.animationEnd) { entity.frame++; return undefined; }
    if (state.animationPriority === 5) return undefined;
    if (state.animationPriority === 2) { if (!grounded) return undefined; state.animationPriority = 1; entity.frame = 68; state.animationEnd = 71; return undefined; }
  }
  state.animationPriority = 0; state.animationDuck = duck; state.animationRun = run;
  if (!grounded) { state.animationPriority = 2; if (entity.frame !== 67) entity.frame = 66; state.animationEnd = 67; }
  else if (run) { entity.frame = duck ? 154 : 40; state.animationEnd = duck ? 159 : 45; }
  else { entity.frame = duck ? 135 : 0; state.animationEnd = duck ? 153 : 39; }
  return undefined;
}

export function q2ClientEffects(context: Q2CharacterContext): undefined {
  const { entity, state, game } = context, now = game.host.now();
  const powers = context.powerups(), combat = game.host.combat.read(entity.actor.id);
  entity.effects = 0; entity.renderFlags = game.options.edition === "rerelease" ? 32768 : 0;
  const flashing = (until: number): boolean => until > now && (until - now > 3 || (Math.round((until - now) * 10) & 4) !== 0);
  if ((combat?.health ?? 0) > 0) {
    if (state.powerArmorTime > now && combat?.armor.kind === "q2") {
      if (combat.armor.powerArmor.kind === "screen") entity.effects |= 0x200;
      else if (combat.armor.powerArmor.kind === "shield") { entity.effects |= 0x100; entity.renderFlags |= 0x800; }
    }
    if (flashing(powers.quadUntil)) entity.effects |= 0x8000;
    if (flashing(powers.invulnerabilityUntil)) entity.effects |= 0x10000;
    if (state.god) { entity.effects |= 0x100; entity.renderFlags |= 0x1c00; }
  }
  const weapon = context.weaponState();
  const loop = context.movement.waterLevel !== 0 && (context.movement.waterType & 24) !== 0 ? "player/fry.wav"
    : weapon?.q2Name === "railgun" ? "weapons/rg_hum.wav" : weapon?.q2Name === "bfg" ? "weapons/bfg_hum.wav" : weapon?.loopSound ?? "";
  if (loop !== state.loopSound) {
    if (state.loopSound !== "") game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: state.loopSound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "stop" });
    state.loopSound = loop;
    if (loop !== "") game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: loop, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
  }
  return undefined;
}
