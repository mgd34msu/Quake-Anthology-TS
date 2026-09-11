/* Direct ports of monster frame actions. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import { sameActor } from "../../../contracts/identity.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { q1Base } from "./provider.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { length, normalize, vadd, vscale, vsub, ZERO } from "../foundation/types.ts";
import type { BaseMonster } from "./monsters.ts";
import { castLightning, createMissile, dropBackpack, launchLaser, launchOgreGrenade, launchSpike, launchVoreBall, launchZombieGrenade, spawnMeatSpray } from "./projectiles.ts";

function meat(monster: BaseMonster, side: number): undefined {
  const axes = monster.makeVectors(), velocity = vscale(axes.right, side === 1 ? (monster.game.host.random() * 2 - 1) * 100 : side);
  spawnMeatSpray(monster.game, monster.entity, vadd(monster.origin, vscale(axes.forward, 16)), velocity); return undefined;
}
function chainsaw(monster: BaseMonster, side: number): undefined {
  if (monster.enemy === null || !monster.game.canDamage(monster.enemy, monster.entity.actor.id)) return undefined;
  monster.ai("charge", 10); if (monster.distance > 100) return undefined;
  monster.melee(100, 4, 3, false); if (side !== 0) meat(monster, side);
  return undefined;
}
function jump(monster: BaseMonster, tar: boolean): undefined {
  const { game, entity } = monster, body = game.body(entity);
  if (tar) entity.movement = "bounce"; monster.counter = 0;
  entity.movementFlags &= ~512;
  game.setBody(entity, { origin: vadd(body.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(monster.makeVectors().forward, 600), { x: 0, y: 0, z: tar ? 200 + game.host.random() * 150 : 250 }), ground: null });
  entity.touch = game.named.touch(entity, `${monster.source?.callbackPrefix ?? "base"}:monster_jump_touch`); return game.link(entity);
}
export function monsterJumpTouch(monster: BaseMonster, other: ActorId): undefined {
    const { game, entity } = monster, tar = monster.spec.species === "tarbaby";
    if (game.health(entity.actor.id) <= 0) return undefined;
    const damageable = game.host.combat.read(other)?.canTakeDamage ?? false;
    if (damageable && (!tar || game.host.classname(other) !== entity.classname)) {
      if (length(game.body(entity).velocity) > 400) { game.damage(other, entity.actor.id, entity.actor.id, (tar ? 10 : 40) + 10 * game.host.random()); if (tar) game.sound(entity, "blob/hit1.wav", "weapon"); }
    } else if (tar) game.sound(entity, "blob/land1.wav", "weapon");
    if (game.host.checkBottom(entity.actor.id)) {
      entity.touch = null; if (!tar) entity.movement = "step"; monster.nextFrame = tar ? "tbaby_jump1" : "demon1_jump11"; return monster.delay(0.1);
    }
    if (game.body(entity).ground !== null) { entity.touch = null; entity.movement = "step"; monster.nextFrame = tar ? "tbaby_run1" : "demon1_jump1"; return monster.delay(0.1); }
    return undefined;
}
function wizardFast(monster: BaseMonster): undefined {
  const { game, entity } = monster, enemy = monster.enemy; if (enemy === null) return undefined;
  game.sound(entity, "wizard/wattack.wav", "weapon"); const axes = monster.makeVectors();
  for (const shot of [{ side: 1, delay: 0.8 }, { side: -1, delay: 0.3 }]) {
    const timer = game.create("wizard_fastfire"); timer.owner = entity.actor.id;
    const origin = vadd(monster.origin, vadd({ x: 0, y: 0, z: 30 }, vadd(vscale(axes.forward, 14), vscale(axes.right, 14 * shot.side))));
    game.setOrigin(timer, origin); q1Base(game).wizardShots.set(timer.actor, { enemy, right: vscale(axes.right, shot.side) });
    game.schedule(timer, shot.delay, game.named.action(timer, "base:wizard_fastfire"));
  }
  return undefined;
}
function hellKnightShot(monster: BaseMonster, offset: number): undefined {
  const { game, entity } = monster, target = monster.target; if (target === null) return undefined;
  const delta = vsub(target, monster.origin); const angle = { x: Math.atan2(delta.z, Math.hypot(delta.x, delta.y)) * 180 / Math.PI, y: Math.atan2(delta.y, delta.x) * 180 / Math.PI + offset * 6, z: 0 };
  const forward = game.makeVectors(angle).forward, body = game.body(entity);
  const origin = vadd(vadd(monster.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), vscale(forward, 20));
  const direction = normalize(forward); launchSpike(game, entity.actor.id, origin, vscale({ ...direction, z: -direction.z + (game.host.random() - 0.5) * 0.1 }, 300), "knight");
  return game.sound(entity, "hknight/attack1.wav", "weapon");
}
export function wizardFastFire(game: Q1Foundation, timer: Q1Actor): undefined {
  const shot = q1Base(game).wizardShots.get(timer.actor); if (shot === undefined) throw new Error("Wizard shot has no source target");
  const target = game.host.bodies.read(shot.enemy), origin = game.body(timer).origin, owner = timer.owner;
  if (owner !== null && game.health(owner) > 0 && target !== null) {
    const body = game.host.bodies.read(owner); if (body !== null) game.effect("muzzleflash", body.origin, owner);
    game.makeVectors(game.options.edition === "rerelease" ? { ...target.angles, x: -target.angles.x } : target.angles);
    const direction = normalize(vsub(vsub(target.origin, vscale(shot.right, 13)), origin));
    game.sound(timer, "wizard/wattack.wav", "weapon"); launchSpike(game, owner, origin, vscale(direction, 600), "wizard");
  }
  return game.remove(timer);
}
function bossFace(monster: BaseMonster): undefined {
  const { game } = monster;
  if (monster.enemy === null || game.health(monster.enemy) <= 0 || game.host.random() < 0.02) {
    const players = game.host.players(); const current = monster.enemy;
    const start = current === null ? -1 : players.findIndex(actor => sameActor(actor, current));
    for (let i = 1; i <= Math.min(4, players.length); i++) { const candidate = players[(start + i) % players.length]; if (candidate !== undefined && game.health(candidate) > 0) { monster.enemy = candidate; break; } }
  }
  return monster.face();
}
function bossMissile(monster: BaseMonster, offset: Vec3): undefined {
  const { game, entity } = monster, target = monster.target, enemy = monster.enemy; if (target === null || enemy === null) return undefined;
  const delta = vsub(target, monster.origin), angles = { x: Math.atan2(delta.z, Math.hypot(delta.x, delta.y)) * 180 / Math.PI, y: Math.atan2(delta.y, delta.x) * 180 / Math.PI, z: 0 };
  const axes = game.makeVectors(angles), origin = vadd(monster.origin, vadd(vscale(axes.forward, offset.x), vadd(vscale(axes.right, offset.y), { x: 0, y: 0, z: offset.z })));
  const velocity = game.host.bodies.read(enemy)?.velocity ?? ZERO;
  const destination = game.options.skill > 1 ? vadd(target, vscale({ ...velocity, z: 0 }, length(vsub(target, origin)) / 300)) : target;
  const missile = createMissile(game, entity.actor.id, "chthon_lavaball", "lavaball", origin, vscale(normalize(vsub(destination, origin)), 300), 6);
  missile.projectile = "rocket"; missile.angularVelocity = { x: 200, y: 100, z: 300 }; game.sound(entity, "boss1/throw.wav", "weapon");
  if (game.health(enemy) <= 0) return monster.play("boss_idle1"); return undefined;
}
const knightOffsets: ReadonlyMap<string, number> = new Map([
  ["hknight_magica7", -2], ["hknight_magica8", -1], ["hknight_magica9", 0], ["hknight_magica10", 1], ["hknight_magica11", 2], ["hknight_magica12", 3],
  ["hknight_magicb7", -2], ["hknight_magicb8", -1], ["hknight_magicb9", 0], ["hknight_magicb10", 1], ["hknight_magicb11", 2], ["hknight_magicb12", 3],
  ["hknight_magicc6", -2], ["hknight_magicc7", -1], ["hknight_magicc8", 0], ["hknight_magicc9", 1], ["hknight_magicc10", 2], ["hknight_magicc11", 3],
]);

export function monsterAction(monster: BaseMonster, name: string): undefined {
  const { game, entity, state } = monster;
  const knightOffset = knightOffsets.get(name); if (knightOffset !== undefined) return hellKnightShot(monster, knightOffset);
  if (name.startsWith("boss_idle") || name.startsWith("boss_missile")) {
    if (name === "boss_idle1" && monster.enemy !== null && game.health(monster.enemy) > 0) return monster.play("boss_missile1");
    if (name === "boss_missile9") return bossMissile(monster, { x: 100, y: 100, z: 200 });
    if (name === "boss_missile20") return bossMissile(monster, { x: 100, y: -100, z: 200 });
    return bossFace(monster);
  }
  switch (name) {
    case "knight_runatk1": game.sound(entity, game.host.random() > 0.5 ? "knight/sword2.wav" : "knight/sword1.wav", "weapon"); return monster.ai("charge", 20);
    case "enf_atk6": case "enf_atk10": {
      const target = monster.target; if (target === null) return undefined; const axes = monster.makeVectors();
      game.effect("muzzleflash", monster.origin, entity.actor.id); game.sound(entity, "enforcer/enfire.wav", "weapon");
      launchLaser(game, entity.actor.id, vadd(monster.origin, vadd(vscale(axes.forward, 30), vadd(vscale(axes.right, 8.5), { x: 0, y: 0, z: 16 }))), vsub(target, monster.origin)); return undefined;
    }
    case "enf_atk14": if (game.options.skill === 3 && !state.refired && monster.visible()) { state.refired = true; monster.nextFrame = "enf_atk1"; } return undefined;
    case "enf_die3": case "enf_fdie3": dropBackpack(game, monster.origin, { weapon: null, shells: 0, nails: 0, rockets: 0, cells: 5 }); return undefined;
    case "demon1_jump4": return jump(monster, false);
    case "demon1_jump10": return monster.delay(3);
    case "demon1_atta5": case "demon1_atta11":
      monster.face(); game.host.walkMove(entity.actor, entity.idealYaw, 12);
      if (monster.enemy !== null && monster.distance <= 100 && game.canDamage(monster.enemy, entity.actor.id)) { game.sound(entity, "demon/dhit2.wav", "weapon"); game.damage(monster.enemy, entity.actor.id, entity.actor.id, 10 + 5 * game.host.random()); meat(monster, name === "demon1_atta5" ? 200 : -200); }
      return undefined;
    case "ogre_swing5": case "ogre_swing6": case "ogre_swing7": case "ogre_swing8": case "ogre_swing9": case "ogre_swing10": case "ogre_swing11":
      chainsaw(monster, name === "ogre_swing6" ? 200 : name === "ogre_swing10" ? -200 : 0);
      return game.setBody(entity, { angles: { ...game.body(entity).angles, y: game.body(entity).angles.y + game.host.random() * 25 } });
    case "ogre_smash6": case "ogre_smash7": case "ogre_smash8": case "ogre_smash9": return chainsaw(monster, 0);
    case "ogre_smash10": return chainsaw(monster, 1);
    case "ogre_smash11": chainsaw(monster, 0); return monster.delay(0.1 + game.host.random() * 0.2);
    case "ogre_nail4": return launchOgreGrenade(monster);
    case "ogre_die3": case "ogre_bdie3": dropBackpack(game, monster.origin, { weapon: null, shells: 0, nails: 0, rockets: 2, cells: 0 }); return undefined;
    case "hknight_walk1": if (game.host.random() < 0.2) game.sound(entity, "hknight/idle.wav"); return monster.ai("walk", 2);
    case "hknight_run1": {
      if (game.host.random() < 0.2) game.sound(entity, "hknight/idle.wav"); monster.ai("run", 20);
      const target = monster.target;
      if (target !== null && monster.visible() && game.time >= state.attackFinished && Math.abs(monster.origin.z - target.z) <= 20 && monster.distance >= 80) { monster.attackFinished(2); return monster.play("hknight_char_a1"); }
      return undefined;
    }
    case "hknight_char_b1":
      if (game.time > state.attackFinished) { monster.attackFinished(3); monster.play("hknight_run1"); }
      else game.sound(entity, game.host.random() > 0.5 ? "knight/sword2.wav" : "knight/sword1.wav", "weapon");
      monster.ai("charge", 23); return monster.ai("melee", 0);
    case "sham_smash10":
      monster.ai("charge", 0);
      if (monster.enemy !== null && monster.distance <= 100 && game.canDamage(monster.enemy, entity.actor.id)) {
        monster.melee(100, 40, 3, false); game.sound(entity, "shambler/smack.wav");
        for (let i = 0; i < 2; i++) { const axes = game.basis; spawnMeatSpray(game, entity, vadd(monster.origin, vscale(axes.forward, 16)), vscale(axes.right, (game.host.random() * 2 - 1) * 100)); }
      }
      return undefined;
    case "sham_swingl7": case "sham_swingr7":
      monster.ai("charge", 10);
      if (monster.enemy !== null && monster.distance <= 100) { monster.melee(100, 20, 3, false); game.sound(entity, "shambler/smack.wav"); meat(monster, name === "sham_swingl7" ? 250 : -250); } return undefined;
    case "sham_swingl9": if (game.host.random() < 0.5) monster.nextFrame = "sham_swingr1"; return undefined;
    case "sham_swingr9": if (game.host.random() < 0.5) monster.nextFrame = "sham_swingl1"; return undefined;
    case "sham_magic3": {
      monster.delay(0.3); game.effect("muzzleflash", monster.origin, entity.actor.id); monster.face();
      const light = game.create("shambler_light"); entity.owner = light.actor.id; light.model = "progs/s_light.mdl";
      game.setBody(light, { origin: monster.origin, angles: game.body(entity).angles }); game.link(light); return game.schedule(light, 0.7, game.named.action(light, "SUB_Remove"));
    }
    case "sham_magic4": case "sham_magic5": { game.effect("muzzleflash", monster.origin, entity.actor.id); const light = game.entity(entity.owner); if (light !== null) light.frame = name === "sham_magic4" ? 1 : 2; return undefined; }
    case "sham_magic6": { const light = game.entity(entity.owner); if (light !== null) game.remove(light); castLightning(monster); return game.sound(entity, "shambler/sboom.wav", "weapon"); }
    case "sham_magic9": case "sham_magic10": return castLightning(monster);
    case "wiz_walk1": case "wiz_run1": case "wiz_side1": {
      const r = game.host.random() * 5;
      if (monster.idleUntil < game.time) { monster.idleUntil = game.time + 2; if (r > 4.5) game.sound(entity, "wizard/widle1.wav", "voice", 2); if (r < 1.5) game.sound(entity, "wizard/widle2.wav", "voice", 2); } return undefined;
    }
    case "wiz_fast1": return wizardFast(monster);
    case "wiz_fast10": monster.attackFinished(2); monster.sliding = monster.rangeDistance() < 500 && monster.visible(); monster.nextFrame = monster.sliding ? "wiz_side1" : "wiz_run1"; return undefined;
    case "wiz_death1": game.setBody(entity, { velocity: { x: -200 + 400 * game.host.random(), y: -200 + 400 * game.host.random(), z: 100 + 100 * game.host.random() }, ground: null }); return game.sound(entity, "wizard/wdeath.wav");
    case "shal_attack9": return launchVoreBall(monster);
    case "tbaby_fly4": monster.counter++; return monster.counter === 4 ? monster.play("tbaby_jump5") : undefined;
    case "tbaby_jump5": return jump(monster, true);
    case "tbaby_die1": entity.damageable = false; return undefined;
    case "tbaby_die2":
      game.radiusDamage(entity.actor.id, entity.actor.id, 120, null, null); game.sound(entity, "blob/death1.wav");
      game.effect("tar-explosion", vsub(monster.origin, vscale(normalize(game.body(entity).velocity), 8))); return game.remove(entity);
    case "f_attack3": case "f_attack9": case "f_attack15":
      if (monster.enemy !== null && monster.distance <= 60) { game.sound(entity, "fish/bite.wav"); monster.melee(60, 3, 2, false); } return undefined;
    case "zombie_cruc2": case "zombie_cruc3": case "zombie_cruc4": case "zombie_cruc5": case "zombie_cruc6": return monster.delay(0.1 + game.host.random() * 0.1);
    case "zombie_run1": monster.inPain = 0; return undefined;
    case "zombie_atta13": return launchZombieGrenade(monster, { x: -10, y: -22, z: 30 });
    case "zombie_attb14": return launchZombieGrenade(monster, { x: -10, y: -24, z: 29 });
    case "zombie_attc12": return launchZombieGrenade(monster, { x: -12, y: -19, z: 29 });
    case "zombie_paine1": return game.host.combat.setHealth(entity.actor, 60);
    case "zombie_paine11": game.host.combat.setHealth(entity.actor, 60); return monster.delay(5.1);
    case "zombie_paine12":
      game.host.combat.setHealth(entity.actor, 60); game.sound(entity, "zombie/z_idle.wav", "voice", 2); entity.solid = "slidebox";
      if (!game.host.walkMove(entity.actor, 0, 0)) { monster.nextFrame = "zombie_paine11"; entity.solid = "none"; } return game.link(entity);
    case "boss_death9": return game.effect("lava-splash", monster.origin);
    case "boss_death10": monster.countKill(); return game.remove(entity);
    case "old_thrash15": monster.counter++; if (monster.counter !== 3) monster.nextFrame = "old_thrash1"; return undefined;
    case "old_thrash20": return monster.services.finishFinale(monster);
    default: throw new Error(`Q1 frame action is not implemented: ${name}`);
  }
}
