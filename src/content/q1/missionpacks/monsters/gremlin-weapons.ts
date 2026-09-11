/* hipgrem.qc: stolen weapons retain shared inventory and projectile ownership. GPL-2.0-or-later. */
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Weapon } from "../../foundation/types.ts";
import { POINT, ZERO, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { fireBullets } from "../../foundation/weapons.ts";
import { launchOgreGrenade, launchSpike } from "../../base/projectiles.ts";
import { launchHipnoticLaser, launchHipnoticProximity } from "../hipnotic-weapons.ts";
import { velocityAngles } from "../types.ts";
import type { MissionMonster } from "./runtime.ts";
import { missile, number } from "./helpers.ts";
import { gremlinFindVictim } from "./gremlin-ai.ts";

const weapons: readonly Q1Weapon[] = ["axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "rocketlauncher", "lightning", "hipnotic:laser", "hipnotic:proximity", "hipnotic:mjolnir"];
export function gremlinWeapon(monster: MissionMonster): Q1Weapon | null { const value = monster.entity.fields.get("gremlin:weapon"); return weapons.find(weapon => weapon === value) ?? null; }
function ammo(monster: MissionMonster, item: ItemId, used: number): undefined {
  const count = monster.game.host.inventory.adjustSourceCounter(monster.entity.actor, item, -used);
  return number(monster, "currentammo", count);
}
export function gremlinHasAmmo(monster: MissionMonster): boolean {
  if (monster.entity.number("currentammo") > 0) return true;
  number(monster, "stoleweapon", 0); return false;
}
export function gremlinSteal(monster: MissionMonster): boolean {
  const { game, entity } = monster;
  if (entity.number("stoleweapon") !== 0 || monster.enemy === null || !game.isPlayer(monster.enemy) || monster.distance > 100 || game.host.random() < 0.5) return false;
  const victim = game.player(monster.enemy); if (victim === null) return false;
  const weapon = victim.weapon; if (weapon === "axe" || weapon === "shotgun" || weapon === "hipnotic:mjolnir") return false;
  game.host.inventory.consume(victim.actor, game.weaponItem(weapon), game.host.inventory.count(victim.actor.id, game.weaponItem(weapon)));
  game.host.inventory.configure(entity.actor, { item: game.weaponItem(weapon), count: 1, capacity: 1 }); entity.fields.set("gremlin:weapon", weapon);
  const item = game.weaponAmmo(weapon);
  if (item !== null) {
    const amount = Math.min(game.host.inventory.count(victim.actor.id, item), weapon === "supershotgun" ? 20 : weapon === "grenadelauncher" || weapon === "rocketlauncher" || weapon === "hipnotic:proximity" ? 5 : 40);
    game.host.inventory.consume(victim.actor, item, amount); game.host.inventory.configure(entity.actor, { item, count: game.host.inventory.count(entity.actor.id, item) + amount, capacity: 1000000 }); number(monster, "currentammo", game.host.inventory.count(entity.actor.id, item));
    const labels: Readonly<Partial<Record<Q1Weapon, readonly [string, string]>>> = {
      supershotgun: ["$qc_gremlin_ssg", "Gremlin stole your Super Shotgun\n"], nailgun: ["$qc_gremlin_ng", "Gremlin stole your Nailgun\n"], supernailgun: ["$qc_gremlin_sng", "Gremlin stole your Super Nailgun\n"],
      grenadelauncher: ["$qc_gremlin_gl", "Gremlin stole your Grenade Launcher\n"], rocketlauncher: ["$qc_gremlin_rl", "Gremlin stole your Rocket Launcher\n"], lightning: ["$qc_gremlin_lg", "Gremlin stole your Lightning Gun\n"],
      "hipnotic:laser": ["$qc_gremlin_lc", "Gremlin stole your Laser Cannon\n"], "hipnotic:proximity": ["$qc_gremlin_prox", "Gremlin stole your Proximity Gun\n"],
    };
    const label = labels[weapon]; if (label !== undefined) game.message(victim.actor.id, label[game.options.edition === "rerelease" ? 0 : 1], false);
  }
  game.selectWeapon(victim.actor, game.chooseBest(victim.actor)); number(monster, "stoleweapon", 1); monster.state.attackFinished = game.time;
  entity.references.set("lastvictim", game.host.random() > 0.65 ? victim.actor.id : entity.actor.id);
  const next = gremlinFindVictim(monster); if (next !== null) { monster.found(next); monster.state.attackFinished = game.time; monster.state.searchUntil = game.time + 1; }
  return true;
}
function aim(monster: MissionMonster, spread: number) {
  const { game, entity } = monster, direction = normalize(vsub(monster.target ?? ZERO, monster.origin)), angles = velocityAngles(direction);
  entity.fields.set("v_angle", `${angles.x} ${angles.y} ${angles.z}`); const basis = game.makeVectors(angles);
  return normalize(vadd(vadd(direction, vscale(basis.right, (game.host.random() * 2 - 1) * spread)), vscale(game.basis.up, (game.host.random() * 2 - 1) * spread)));
}
export function gremlinFireNail(monster: MissionMonster): undefined {
  ammo(monster, "q1:ammo/nails", 1); monster.entity.effects |= 2; monster.game.sound(monster.entity, "weapons/rocket1i.wav", "weapon");
  const direction = aim(monster, 0.1); launchSpike(monster.game, monster.entity.actor.id, vadd(monster.origin, { x: 0, y: 0, z: 16 }), vscale(direction, 1000)); return undefined;
}
export function gremlinFireLaser(monster: MissionMonster): undefined {
  ammo(monster, "q1:ammo/cells", 1); monster.entity.effects |= 2; monster.game.sound(monster.entity, "weapons/rocket1i.wav", "weapon");
  const direction = aim(monster, 0.1); launchHipnoticLaser(monster.game, monster.entity.actor.id, vadd(monster.origin, { x: 0, y: 0, z: 16 }), direction); return undefined;
}
function shotgun(monster: MissionMonster, double: boolean): undefined {
  ammo(monster, "q1:ammo/shells", double ? 2 : 1); monster.entity.effects |= 2; monster.game.sound(monster.entity, double ? "weapons/shotgn2.wav" : "weapons/guncock.wav", "weapon");
  const direction = aim(monster, double ? 0.3 : 0.1), angles = velocityAngles(direction); monster.entity.fields.set("v_angle", `${angles.x} ${angles.y} ${angles.z}`);
  return fireBullets(monster.game, monster.entity.actor, direction, angles, double ? 14 : 6, double ? 0.14 : 0.04, double ? 0.08 : 0.04, double ? "supershotgun" : "shotgun");
}
function rocket(monster: MissionMonster): undefined {
  const { game, entity } = monster; ammo(monster, "q1:ammo/rockets", 1); entity.effects |= 2; game.sound(entity, "weapons/sgun1.wav", "weapon"); entity.fields.set("punchangle", "-2 0 0");
  const direction = aim(monster, 0.1), shot = missile(game, entity.actor.id, "missile", "progs/missile.mdl", vadd(vadd(monster.origin, vscale(game.basis.forward, 8)), { x: 0, y: 0, z: 16 }), vscale(direction, 1000), "projectile_touch");
  shot.projectile = "rocket"; shot.projectileWeapon = "rocketlauncher"; return game.setBody(shot, { angles: velocityAngles(game.body(shot).velocity) });
}
export function gremlinFireLightning(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if (entity.waterType <= -3) {
    const cells = game.host.inventory.count(entity.actor.id, "q1:ammo/cells"); game.host.inventory.configure(entity.actor, { item: "q1:ammo/cells", count: 0, capacity: 1000000 });
    return game.radiusDamage(entity.actor.id, entity.actor.id, 35 * cells, game.world?.actor.id ?? null, "lightning", "discharge");
  }
  entity.effects |= 2; monster.face(); ammo(monster, "q1:ammo/cells", 2);
  const start = vadd(monster.origin, { x: 0, y: 0, z: 16 }), direction = aim(monster, 0.1);
  const wall = game.host.trace({ start, end: vadd(monster.origin, vscale(direction, 600)), bounds: POINT, ignore: entity.actor.id, monsters: false });
  game.host.emit({ kind: "beam", style: "lightning2", actor: entity.actor.id, start, end: wall.end });
  const end = vadd(wall.end, vscale(direction, 4)), delta = vsub(end, start), side = { x: -delta.y * 16, y: -delta.y * 16, z: 0 }, hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: entity.actor.id, monsters: true }), target = trace.actor;
    if (target === null || hit.includes(target)) continue;
    hit.push(target); if (game.host.combat.read(target)?.canTakeDamage) { game.effect("blood", trace.end, target, 120); game.damage(target, entity.actor.id, entity.actor.id, 30, "lightning", "direct", "electric"); }
  }
  return undefined;
}
function proximity(monster: MissionMonster): undefined {
  ammo(monster, "q1:ammo/rockets", 1); monster.game.sound(monster.entity, "weapons/grenade.wav", "weapon");
  const direction = aim(monster, 0.1), velocity = { ...vscale(direction, 600), z: 200 };
  launchHipnoticProximity(monster.game, monster.entity.actor.id, monster.origin, velocity); return undefined;
}
export function gremlinWeaponAttack(monster: MissionMonster): boolean {
  if (!gremlinHasAmmo(monster)) return false;
  number(monster, "show_hostile", monster.game.time + 1);
  switch (gremlinWeapon(monster)) {
    case "shotgun": monster.play("gremlin_shot1"); shotgun(monster, false); monster.attackFinished(1); break;
    case "supershotgun": monster.play("gremlin_shot1"); shotgun(monster, true); monster.attackFinished(1); break;
    case "nailgun": case "supernailgun": monster.play("gremlin_nail3"); monster.attackFinished(1); break;
    case "grenadelauncher": monster.play("gremlin_rocket1"); launchOgreGrenade(monster); ammo(monster, "q1:ammo/rockets", 1); monster.attackFinished(1); break;
    case "rocketlauncher": monster.play("gremlin_rocket1"); rocket(monster); monster.attackFinished(1); break;
    case "lightning": monster.play("gremlin_light1"); monster.attackFinished(1); monster.game.sound(monster.entity, "weapons/lstart.wav", "auto"); break;
    case "hipnotic:laser": monster.play("gremlin_laser3"); monster.attackFinished(1); break;
    case "hipnotic:proximity": monster.play("gremlin_rocket1"); proximity(monster); monster.attackFinished(1); break;
    default: break;
  }
  return true;
}
export function gremlinDropBackpack(monster: MissionMonster): undefined {
  const { game, entity } = monster, pack = game.create("item_backpack"), inventory = game.host.inventory;
  const selected = weapons.find(weapon => inventory.count(entity.actor.id, game.weaponItem(weapon)) > 0) ?? null;
  monster.runtime.base.backpacks.set(pack.actor, { weapon: selected, extra: [], shells: Math.max(0, inventory.count(entity.actor.id, "q1:ammo/shells")), nails: Math.max(0, inventory.count(entity.actor.id, "q1:ammo/nails")), rockets: Math.max(0, inventory.count(entity.actor.id, "q1:ammo/rockets")), cells: Math.max(0, inventory.count(entity.actor.id, "q1:ammo/cells")) });
  pack.model = "progs/backpack.mdl"; pack.solid = "trigger"; pack.movement = "toss"; pack.movementFlags = 256;
  game.setBody(pack, { origin: vadd(monster.origin, { x: 0, y: 0, z: -24 }), velocity: { x: -100 + game.host.random() * 200, y: -100 + game.host.random() * 200, z: 300 }, bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
  pack.touch = game.named.touch(pack, "base:backpack_touch"); game.schedule(pack, 120, game.named.action(pack, "SUB_Remove")); return game.link(pack);
}
