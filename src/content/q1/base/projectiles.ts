/* Monster missile and backpack QuakeC. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1Weapon, Q1MessagePart } from "../foundation/types.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub, weaponItem, yawFor } from "../foundation/types.ts";
import type { BaseMonster } from "./monsters.ts";
import { q1Creatures } from "./creatures.ts";

function damageVelocity(game: Q1EntityServices, damage: number): Vec3 {
  return vscale({ x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 200 + 100 * game.host.random() }, damage > -50 ? 0.7 : damage > -200 ? 2 : 10);
}
export function throwGib(game: Q1EntityServices, origin: Vec3, model: string, damage: number): Q1Actor {
  const gib = game.create("gib"); gib.model = `progs/${model}.mdl`; gib.movement = "bounce";
  game.setBody(gib, { origin, velocity: damageVelocity(game, damage), bounds: POINT });
  gib.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 };
  game.schedule(gib, 10 + game.host.random() * 10, game.named.action(gib, "SUB_Remove")); game.link(gib); return gib;
}
export function throwHead(game: Q1EntityServices, entity: Q1Actor, model: string, damage = game.health(entity.actor.id)): undefined {
  game.cancel(entity); entity.model = `progs/${model}.mdl`; entity.frame = 0; entity.movement = "bounce"; entity.damageable = false; entity.solid = "none";
  const origin = game.body(entity).origin;
  game.setBody(entity, { origin: vadd(origin, { x: 0, y: 0, z: -24 }), velocity: damageVelocity(game, damage), bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } }, ground: null });
  entity.angularVelocity = { x: 0, y: (game.host.random() * 2 - 1) * 600, z: 0 }; return game.link(entity);
}
export function spawnMeatSpray(game: Q1EntityServices, owner: Q1Actor, origin: Vec3, velocity: Vec3): Q1Actor {
  const missile = game.create("meat_spray"), angles = game.body(owner).angles;
  missile.owner = owner.actor.id; missile.movement = "bounce"; missile.solid = "none";
  game.makeVectors(game.options.edition === "rerelease" ? { ...angles, x: -angles.x } : angles);
  game.setBody(missile, { origin, velocity: { ...velocity, z: velocity.z + 250 + 50 * game.host.random() }, bounds: POINT });
  missile.angularVelocity = { x: 3000, y: 1000, z: 2000 }; missile.model = "progs/zom_gib.mdl";
  game.schedule(missile, 1, game.named.action(missile, "SUB_Remove")); game.link(missile); return missile;
}
export interface BackpackContents {
  readonly weapon: Q1Weapon | null;
  readonly shells: number;
  readonly nails: number;
  readonly rockets: number;
  readonly cells: number;
  readonly extra?: readonly { readonly item: ItemId; readonly count: number }[];
  readonly selection?: "source-default" | "rank";
  readonly avoidUnderwaterLightning?: boolean;
  readonly ownerPickupDelay?: number;
}
const backpackWeapons: Readonly<Partial<Record<Q1Weapon, { readonly classic: string; readonly localized: string }>>> = {
  axe: { classic: "Axe", localized: "$qc_axe" }, shotgun: { classic: "Shotgun", localized: "$qc_shotgun" },
  supershotgun: { classic: "Double-barrelled Shotgun", localized: "$qc_double_shotgun" }, nailgun: { classic: "Nailgun", localized: "$qc_nailgun" },
  supernailgun: { classic: "Super Nailgun", localized: "$qc_super_nailgun" }, grenadelauncher: { classic: "Grenade Launcher", localized: "$qc_grenade_launcher" },
  rocketlauncher: { classic: "Rocket Launcher", localized: "$qc_rocket_launcher" }, lightning: { classic: "Thunderbolt", localized: "$qc_thunderbolt" },
  "hipnotic:laser": { classic: "Laser Cannon", localized: "$qc_laser_cannon" }, "hipnotic:proximity": { classic: "Proximity Gun", localized: "$qc_prox_gun" },
  "hipnotic:mjolnir": { classic: "Mjolnir", localized: "$qc_mjolnir" },
};

/** items.qc composes one notice from its prefix, newly acquired weapon and backpack ammunition. */
export function backpackMessage(contents: BackpackContents, edition: "classic" | "rerelease", newWeapon: boolean): { readonly text: string; readonly parts: readonly Q1MessagePart[] } {
  const entries: { readonly classic: string; readonly localized: string; readonly count: number }[] = [
    { classic: "shells", localized: "$qc_backpack_shells", count: contents.shells },
    { classic: "nails", localized: "$qc_backpack_nails", count: contents.nails },
    { classic: "rockets", localized: "$qc_backpack_rockets", count: contents.rockets },
    { classic: "cells", localized: "$qc_backpack_cells", count: contents.cells },
  ];
  for (const extra of contents.extra ?? []) {
    if (extra.item === "rogue:ammo/lava-nails") entries.push({ classic: "lava nails", localized: "$qc_backpack_lava_nails", count: extra.count });
    else if (extra.item === "rogue:ammo/multi-rockets") entries.push({ classic: "multi rockets", localized: "$qc_backpack_multi_rockets", count: extra.count });
    else if (extra.item === "rogue:ammo/plasma") entries.push({ classic: "plasma balls", localized: "$qc_backpack_plasma_balls", count: extra.count });
  }
  const weapon = newWeapon && contents.weapon !== null ? backpackWeapons[contents.weapon] : undefined;
  const classic = [...(weapon === undefined ? [] : [`the ${weapon.classic}`]), ...entries.filter(entry => entry.count > 0).map(entry => `${entry.count} ${entry.classic}`)];
  if (edition === "classic") return { text: `You get ${classic.join(", ")}`, parts: [] };
  const parts: Q1MessagePart[] = [{ text: "$qc_backpack_got" }];
  const items: Q1MessagePart[] = [...(weapon === undefined ? [] : [{ text: weapon.localized }]),
    ...entries.filter(entry => entry.count > 0).map(entry => ({ text: entry.localized, args: [entry.count] }))];
  for (const [index, item] of items.entries()) { if (index > 0) parts.push({ text: ", " }); parts.push(item); }
  return { text: "$qc_backpack_got", parts };
}

export function dropBackpack(game: Q1EntityServices, origin: Vec3, contents: BackpackContents, launch?: { readonly origin: Vec3; readonly velocity: Vec3; readonly movement: "bounce" | "toss" }): Q1Actor | null {
  if (contents.shells + contents.nails + contents.rockets + contents.cells + (contents.extra?.reduce((total, entry) => total + entry.count, 0) ?? 0) === 0) return null;
  const pack = game.create("item_backpack"); pack.model = "progs/backpack.mdl"; pack.solid = "trigger"; pack.movement = launch?.movement ?? "toss";
  const weapon = contents.weapon, rerelease = game.options.edition === "rerelease";
  q1Creatures(game).backpacks.set(pack.actor, {
    weapon, extra: contents.extra ?? [], selection: contents.selection ?? "source-default", avoidUnderwaterLightning: contents.avoidUnderwaterLightning ?? rerelease, ownerPickupDelay: contents.ownerPickupDelay ?? 0,
    shells: Math.max(contents.shells, rerelease && (weapon === "shotgun" || weapon === "supershotgun") ? 5 : 0),
    nails: Math.max(contents.nails, rerelease && (weapon === "nailgun" || weapon === "supernailgun") ? 20 : 0),
    rockets: Math.max(contents.rockets, rerelease && (weapon === "rocketlauncher" || weapon === "grenadelauncher") ? 5 : 0), cells: Math.max(contents.cells, rerelease && weapon === "lightning" ? 15 : 0),
  });
  game.setBody(pack, { origin: launch?.origin ?? vadd(origin, { x: 0, y: 0, z: -24 }), velocity: launch?.velocity ?? { x: -100 + game.host.random() * 200, y: -100 + game.host.random() * 200, z: 300 }, bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
  pack.touch = game.named.touch(pack, "base:backpack_touch");
  game.schedule(pack, 120, game.named.action(pack, "SUB_Remove")); game.link(pack); return pack;
}
function backpackTouch(game: Q1EntityServices, pack: Q1Actor, other: ActorId): undefined {
  const contents = q1Creatures(game).backpacks.get(pack.actor); if (contents === undefined) throw new Error("Missing source backpack contents");
  const weapon = contents.weapon;
  const ammo: readonly { readonly item: ItemId; readonly count: number }[] = [
    { item: "q1:ammo/shells", count: contents.shells }, { item: "q1:ammo/nails", count: contents.nails },
    { item: "q1:ammo/rockets", count: contents.rockets }, { item: "q1:ammo/cells", count: contents.cells },
    ...contents.extra ?? [],
  ];
    const player = game.player(other), actor = game.host.actors.resolveOwned(other);
    if (actor === null || !game.isPlayer(other) || game.health(other) <= 0 || !game.live(pack)) return undefined;
    if (pack.owner !== null && sameActor(other, pack.owner) && pack.nextThink - game.time > 120 - (contents.ownerPickupDelay ?? 0)) return undefined;
    const newWeapon = weapon !== null && !(game.pickupAdmission?.owns(other, weaponItem(weapon)) ?? game.host.inventory.count(other, weaponItem(weapon)) > 0);
    const feedback = (): undefined => {
      const message = backpackMessage(contents, game.options.edition, newWeapon);
      game.host.emit({ kind: "message", player: other, text: message.text, center: false, ...(message.parts.length === 0 ? {} : { parts: message.parts }) }); game.sound(actor, "weapons/lock4.wav", "item"); game.effect("pickup", game.body(pack).origin, other);
      return undefined;
    };
    const admission = game.pickupAdmission;
    if (admission !== null) {
      const grants = ammo.filter(entry => entry.count > 0).map(entry => ({ item: entry.item, amount: entry.count }));
      if (weapon === null) { for (const grant of grants) admission.ammo(actor, grant, false); }
      else {
        const owned = admission.owns(other, weaponItem(weapon));
        const autoSwitch = player === null || (game.pickupRules?.autoSwitch?.(game, player, owned)
          ?? (game.options.edition === "classic" || player.autoSwitch === "always" || player.autoSwitch === "new" && !owned));
        const always = contents.selection !== "rank" && game.options.edition === "classic" && game.options.deathmatch === 0;
        const underwater = !always && player !== null && (contents.avoidUnderwaterLightning ?? game.options.edition === "rerelease") && player.waterLevel !== 0 && weapon === "lightning";
        admission.weapon(actor, { item: weaponItem(weapon), ammo: grants }, !autoSwitch || underwater ? "never" : always ? "always" : "better");
      }
      feedback(); return game.remove(pack);
    }
    if (player === null) return undefined;
    const hadWeapon = weapon === null || game.host.inventory.count(other, weaponItem(weapon)) > 0;
    for (const entry of ammo) game.host.inventory.give(player.actor, entry.item, entry.count);
    if (weapon !== null) game.host.inventory.give(player.actor, weaponItem(weapon), 1);
    const selected = weapon ?? player.weapon; game.pickupRules?.weaponGranted?.(game, player, selected);
    feedback();
    if (game.pickupRules?.autoSwitch?.(game, player, hadWeapon) ?? (game.options.edition === "classic" || player.autoSwitch === "always" || player.autoSwitch === "new" && !hadWeapon)) {
      const rank = (weapon: Q1Weapon): number => {
        const base = ["lightning", "rocketlauncher", "supernailgun", "grenadelauncher", "supershotgun", "nailgun"].indexOf(weapon);
        return game.pickupRules?.weaponRank?.(weapon) ?? (base < 0 ? 7 : base + 1);
      };
      if (contents.selection !== "rank" && game.options.edition === "classic" && game.options.deathmatch === 0 || rank(selected) < rank(player.weapon) && (!(contents.avoidUnderwaterLightning ?? game.options.edition === "rerelease") || player.waterLevel === 0 || selected !== "lightning")) game.selectWeapon(player.actor, selected);
    }
    return game.remove(pack);
}

export function createMissile(game: Q1EntityServices, owner: ActorId | null, classname: string, model: string, origin: Vec3, velocity: Vec3, lifetime = 5): Q1Actor {
  const missile = game.create(classname); missile.owner = owner; missile.model = `progs/${model}.mdl`; missile.solid = "bbox"; missile.movement = "flymissile";
  game.setBody(missile, { origin, velocity, bounds: POINT, angles: { x: Math.atan2(velocity.z, Math.hypot(velocity.x, velocity.y)) * 180 / Math.PI, y: yawFor(velocity), z: 0 } });
  game.schedule(missile, lifetime, game.named.action(missile, "SUB_Remove")); game.link(missile); return missile;
}
export function launchSpike(game: Q1EntityServices, owner: ActorId | null, origin: Vec3, velocity: Vec3, kind: "spike" | "superspike" | "wizard" | "knight" = "spike"): Q1Actor {
  const missile = createMissile(game, owner, kind === "wizard" ? "wizard_spike" : kind === "knight" ? "knight_spike" : kind, kind === "wizard" ? "w_spike" : kind === "knight" ? "k_spike" : "spike", origin, velocity, 6);
  missile.projectile = kind === "superspike" ? "superspike" : "spike";
  missile.touch = game.named.touch(missile, "projectile_touch");
  return missile;
}
export function launchLaser(game: Q1EntityServices, owner: ActorId | null, origin: Vec3, direction: Vec3): Q1Actor {
  const missile = createMissile(game, owner, "enforcer_laser", "laser", origin, vscale(normalize(direction), 600)); missile.effects = 8;
  missile.touch = game.named.touch(missile, "base:laser_touch"); return missile;
}
function laserTouch(game: Q1EntityServices, missile: Q1Actor, other: ActorId): undefined {
    const owner = missile.owner;
    if (owner !== null && sameActor(other, owner)) return undefined;
    const body = game.body(missile); if (game.host.contents(body.origin) === "sky") return game.remove(missile);
    game.sound(missile, "enforcer/enfstop.wav", "weapon", 3); const hit = vsub(body.origin, vscale(normalize(body.velocity), 8));
    if (game.health(other) !== 0) { game.effect("blood", hit, other, 15); game.damage(other, missile.actor.id, owner, 15); }
    else game.effect("gunshot", hit);
    return game.remove(missile);
}
export function spriteExplosion(game: Q1EntityServices, missile: Q1Actor): undefined {
  game.effect("explosion", game.body(missile).origin); missile.touch = null; missile.solid = "none"; missile.movement = "none"; missile.model = "progs/s_explod.spr"; missile.frame = 0;
  game.setBody(missile, { velocity: ZERO }); game.link(missile);
  return game.schedule(missile, 0.1, game.named.action(missile, "base:explosion_frame"));
}
export function launchOgreGrenade(monster: BaseMonster): undefined {
  const { game, entity } = monster, target = monster.target; if (target === null) return undefined;
  game.effect("muzzleflash", monster.origin, entity.actor.id); game.sound(entity, "weapons/grenade.wav", "weapon");
  monster.makeVectors(); const direction = normalize(vsub(target, monster.origin)); const missile = createMissile(game, entity.actor.id, "ogre_grenade", "grenade", monster.origin, { x: direction.x * 600, y: direction.y * 600, z: 200 }, 2.5);
  missile.movement = "bounce"; missile.angularVelocity = { x: 300, y: 300, z: 300 };
  missile.touch = game.named.touch(missile, "base:ogre_grenade_touch"); return game.schedule(missile, 2.5, game.named.action(missile, "base:ogre_grenade_explode"));
}
function ogreGrenadeExplode(game: Q1EntityServices, missile: Q1Actor): undefined { game.radiusDamage(missile.actor.id, missile.owner, 40, null, null); game.sound(missile, "weapons/r_exp3.wav"); return spriteExplosion(game, missile); }
function ogreGrenadeTouch(game: Q1EntityServices, missile: Q1Actor, other: ActorId): undefined {
    if (missile.owner !== null && sameActor(other, missile.owner)) return undefined;
    if (game.isPlayer(other) || game.entity(other)?.aimedDamage) return ogreGrenadeExplode(game, missile);
    game.sound(missile, "weapons/bounce.wav"); if (length(game.body(missile).velocity) === 0) missile.angularVelocity = ZERO;
    return undefined;
}
export function launchZombieGrenade(monster: BaseMonster, offset: Vec3): undefined {
  const { game, entity } = monster, target = monster.target; if (target === null) return undefined;
  const axes = game.basis, origin = vadd(monster.origin, vadd(vscale(axes.forward, offset.x), vadd(vscale(axes.right, offset.y), vscale(axes.up, offset.z - 24))));
  game.sound(entity, "zombie/z_shot1.wav", "weapon"); monster.makeVectors(); const direction = normalize(vsub(target, origin));
  const missile = createMissile(game, entity.actor.id, "zombie_grenade", "zom_gib", origin, { x: direction.x * 600, y: direction.y * 600, z: 200 }, 2.5);
  missile.movement = "bounce"; missile.angularVelocity = { x: 3000, y: 1000, z: 2000 };
  missile.touch = game.named.touch(missile, "base:zombie_grenade_touch"); return undefined;
}
function zombieGrenadeTouch(game: Q1EntityServices, missile: Q1Actor, other: ActorId): undefined {
    if (missile.owner !== null && sameActor(other, missile.owner)) return undefined;
    if (game.host.combat.read(other)?.canTakeDamage) { game.damage(other, missile.actor.id, missile.owner, 10); game.sound(missile, "zombie/z_hit.wav", "weapon"); return game.remove(missile); }
    game.sound(missile, "zombie/z_miss.wav", "weapon"); game.setBody(missile, { velocity: ZERO }); missile.angularVelocity = ZERO;
    missile.touch = game.named.touch(missile, "base:remove_touch"); return undefined;
}
export function launchVoreBall(monster: BaseMonster): undefined {
  const { game, entity } = monster, target = monster.target, enemy = monster.enemy; if (target === null || enemy === null) return undefined;
  const direction = normalize(vsub(vadd(target, { x: 0, y: 0, z: 10 }), monster.origin));
  const missile = createMissile(game, entity.actor.id, "vore_ball", "v_spike", vadd(monster.origin, { x: 0, y: 0, z: 10 }), vscale(direction, 400));
  missile.angularVelocity = { x: 300, y: 300, z: 300 }; game.effect("muzzleflash", monster.origin, entity.actor.id); game.sound(entity, "shalrath/attack2.wav", "weapon");
  q1Creatures(game).projectileTargets.set(missile.actor, enemy);
  missile.touch = game.named.touch(missile, "base:vore_touch"); return game.schedule(missile, Math.max(0.1, monster.distance * 0.002), game.named.action(missile, "base:vore_home"));
}
function voreHome(game: Q1EntityServices, missile: Q1Actor): undefined {
    const enemy = q1Creatures(game).projectileTargets.get(missile.actor); if (enemy === undefined) throw new Error("Vore missile has no source enemy");
    const body = game.host.bodies.read(enemy); if (body === null || game.health(enemy) < 1) return game.remove(missile);
    const speed = game.options.edition === "classic" && game.options.skill === 3 ? 350 : 250;
    game.setBody(missile, { velocity: vscale(normalize(vsub(vadd(body.origin, { x: 0, y: 0, z: 10 }), game.body(missile).origin)), speed) }); return game.schedule(missile, 0.2, game.named.action(missile, "base:vore_home"));
}
function voreTouch(game: Q1EntityServices, missile: Q1Actor, other: ActorId): undefined {
    if (missile.owner !== null && sameActor(other, missile.owner)) return undefined;
    if (game.host.classname(other) === "monster_zombie") game.damage(other, missile.actor.id, missile.actor.id, 110);
    game.radiusDamage(missile.actor.id, missile.owner, 40, null, null); game.sound(missile, "weapons/r_exp3.wav", "weapon"); return spriteExplosion(game, missile);
}
export function registerProjectileCallbacks(game: Q1EntityServices): undefined {
  game.named.register("base:backpack_touch", { touch: backpackTouch }); game.named.register("base:laser_touch", { touch: laserTouch });
  game.named.register("base:ogre_grenade_touch", { touch: ogreGrenadeTouch }); game.named.register("base:ogre_grenade_explode", { action: ogreGrenadeExplode });
  game.named.register("base:zombie_grenade_touch", { touch: zombieGrenadeTouch }); game.named.register("base:remove_touch", { touch: (runtime, entity) => runtime.remove(entity) });
  game.named.register("base:vore_touch", { touch: voreTouch }); game.named.register("base:vore_home", { action: voreHome });
  game.named.register("base:explosion_frame", { action: (runtime, entity) => { entity.frame++; return entity.frame >= 6 ? runtime.remove(entity) : runtime.schedule(entity, 0.1, runtime.named.action(entity, "base:explosion_frame")); } }); return undefined;
}
export function castLightning(monster: BaseMonster): undefined {
  const { game, entity } = monster, target = monster.target; if (target === null) return undefined;
  monster.face(); game.effect("muzzleflash", monster.origin, entity.actor.id); monster.lightningCount++;
  const origin = vadd(monster.origin, { x: 0, y: 0, z: 40 }); const direction = normalize(vsub(vadd(target, { x: 0, y: 0, z: 16 }), origin));
  const wall = game.host.trace({ start: origin, end: vadd(monster.origin, vscale(direction, 600)), bounds: POINT, ignore: entity.actor.id, monsters: false });
  game.host.emit({ kind: "beam", style: "lightning1", actor: entity.actor.id, start: origin, end: wall.end });
  const delta = vsub(wall.end, origin), side: Vec3 = { x: -delta.y * 16, y: -delta.y * 16, z: 0 }; const hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(origin, offset), end: vadd(wall.end, offset), bounds: POINT, ignore: entity.actor.id, monsters: true });
    const targetActor = trace.actor;
    if (targetActor !== null && game.host.combat.read(targetActor)?.canTakeDamage && !hit.some(id => sameActor(id, targetActor))) { hit.push(targetActor); game.damage(targetActor, entity.actor.id, entity.actor.id, 10); game.effect("blood", trace.end, targetActor, 40); }
  }
  return undefined;
}
