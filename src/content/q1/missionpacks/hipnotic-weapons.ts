/* quakec_hipnotic/weapons.qc and player.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState, Q1Weapon } from "../foundation/types.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import { aim } from "../foundation/weapons.ts";
import { grenadeVelocity, missionReference, moveMissile, setMissionNumber, setMissionReference, velocityAngles } from "./types.ts";

function finish(game: Q1EntityServices, player: Q1PlayerState, delay: number, frame: number, model: string, punch: number): boolean {
  player.attackFinished = Math.fround(game.time + delay); player.nextWeaponFrame = player.attackFinished;
  player.weaponFrame = frame; player.hostileUntil = Math.fround(game.time + 1);
  game.host.emit({ kind: "weapon", player: player.actor.id, weapon: player.weapon, viewModel: model, frame, punch });
  const body = game.host.bodies.read(player.actor.id); if (body !== null) game.effect("muzzleflash", body.origin, player.actor.id);
  return true;
}

export interface HipnoticLaserProfile { readonly weapon: Q1Weapon; readonly damage: number; readonly lightDamage: number; }
const hipnoticLaser: HipnoticLaserProfile = { weapon: "hipnotic:laser", damage: 18, lightDamage: 25 };
export function launchHipnoticLaser(game: Q1EntityServices, shooter: ActorId, origin: Vec3, direction: Vec3, light = false, profile: HipnoticLaserProfile = hipnoticLaser): Q1Actor {
  const laser = game.create("hiplaser"), velocity = vscale(normalize(direction), 1000);
  laser.owner = shooter; laser.activator = shooter; laser.movement = "flymissile"; laser.solid = "bbox";
  laser.model = "progs/lasrspik.mdl"; laser.effects = light ? 8 : 0; laser.speed = 1000; laser.damage = light ? profile.lightDamage : profile.damage;
  laser.angularVelocity = { x: 0, y: 0, z: 400 }; laser.movedir = velocity; laser.attackFinished = Math.fround(game.time + 5);
  laser.projectileWeapon = profile.weapon; laser.touch = game.named.touch(laser, "hipnotic:laser-touch");
  game.setBounds(laser, POINT); game.setBody(laser, { origin, velocity, angles: velocityAngles(velocity) }); game.link(laser);
  game.schedule(laser, 0, game.named.action(laser, "hipnotic:laser-think"));
  const owner = game.host.actors.resolveOwned(shooter); if (owner !== null) game.sound(owner, "hipweap/laserg.wav", "weapon");
  return laser;
}
export function fireHipnoticLaser(game: Q1EntityServices, player: Q1PlayerState): boolean {
  if (!game.host.inventory.consume(player.actor, "q1:ammo/cells", 1)) return false;
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  const basis = game.makeVectors(player.viewAngles), outward = normalize({ ...basis.forward, z: 0 });
  let origin = vadd(vadd(body.origin, vscale(basis.up, 6)), vscale(outward, 12));
  const direction = aim(game, player.actor, basis.forward), paired = !player.continuousFiring || player.weaponFrame === 4;
  if (paired) {
    const offset = 6 * 0.707; origin = vsub(vadd(origin, vscale(basis.right, offset)), vscale(basis.up, offset));
    launchHipnoticLaser(game, player.actor.id, origin, direction);
    launchHipnoticLaser(game, player.actor.id, vsub(origin, vscale(basis.right, offset * 2)), direction);
  } else launchHipnoticLaser(game, player.actor.id, vadd(origin, vscale(basis.up, 6)), direction, game.host.random() < 0.1);
  player.continuousFiring = true; player.weaponAnimationAt = -1;
  return finish(game, player, 0.1, paired ? 1 : 4, "progs/v_laserg.mdl", -1);
}
function laserTouch(game: Q1EntityServices, laser: Q1Actor, other: ActorId, normal: Vec3 | null): undefined {
  laser.owner = null; laser.count++;
  if (game.host.contents(game.body(laser).origin) === "sky") return game.remove(laser);
  const oldDirection = normalize(laser.movedir), origin = game.body(laser).origin;
  const trace = game.host.trace({ start: vsub(origin, vscale(oldDirection, 16)), end: vadd(origin, vscale(oldDirection, 16)), bounds: POINT, ignore: laser.actor.id, monsters: true });
  game.setOrigin(laser, trace.end);
  if (game.health(other) !== 0) {
    if (laser.activator !== null && sameActor(laser.activator, other)) laser.damage = Math.fround(laser.damage / 2);
    game.effect("blood", trace.end, other, laser.damage); game.damage(other, laser.actor.id, laser.activator, laser.damage, laser.projectileWeapon);
  } else if (laser.count === 3 || game.host.random() < 0.15) game.effect("gunshot", trace.end);
  else {
    laser.damage = Math.fround(laser.damage * 0.9);
    laser.movedir = vscale(normalize(vadd(oldDirection, vscale(trace.fraction < 1 ? trace.normal : normal ?? ZERO, 2))), laser.speed);
    moveMissile(game, laser, laser.movedir); game.host.random();
    return game.sound(laser, "hipweap/laserric.wav", "weapon", 3);
  }
  game.sound(laser, "enforcer/enfstop.wav", "weapon", 3); return game.remove(laser);
}

export function launchHipnoticProximity(game: Q1EntityServices, owner: ActorId, origin: Vec3, velocity: Vec3): Q1Actor {
  const mine = game.create("proximity_grenade");
  mine.owner = owner; mine.activator = owner; mine.movement = "toss"; mine.solid = "bbox";
  mine.model = "progs/proxbomb.mdl"; mine.angularVelocity = { x: 100, y: 600, z: 100 }; mine.projectileWeapon = "hipnotic:proximity";
  mine.delay = Math.fround(game.time + 15 + 10 * game.host.random()); mine.damageable = false; game.host.combat.setHealth(mine.actor, 5);
  mine.touch = game.named.touch(mine, "hipnotic:proximity-touch"); mine.die = game.named.die(mine, "hipnotic:proximity-arm-explosion");
  game.setBounds(mine, { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } });
  game.setBody(mine, { origin, velocity, angles: velocityAngles(velocity) }); game.link(mine);
  game.schedule(mine, 2, game.named.action(mine, "hipnotic:proximity-watch"));
  return mine;
}
export function fireHipnoticProximity(game: Q1EntityServices, player: Q1PlayerState): boolean {
  if (!game.host.inventory.consume(player.actor, "q1:ammo/rockets", 1)) return false;
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  const velocity = grenadeVelocity(game, player.viewAngles, aim(game, player.actor, game.makeVectors(player.viewAngles).forward));
  launchHipnoticProximity(game, player.actor.id, body.origin, velocity); game.sound(player.actor, "hipweap/proxbomb.wav", "weapon");
  player.continuousFiring = false; player.weaponAnimationAt = game.time; player.weaponAnimationBase = 1;
  return finish(game, player, 0.6, 1, "progs/v_prox.mdl", -2);
}
function proximityExplode(game: Q1EntityServices, mine: Q1Actor): undefined {
  game.radiusDamage(mine.actor.id, mine.activator, 95, null, "hipnotic:proximity");
  game.effect("explosion", game.body(mine).origin); return game.remove(mine);
}
function armProximityExplosion(game: Q1EntityServices, mine: Q1Actor, delay = 0.1): undefined {
  mine.damageable = false; setMissionNumber(mine, "hipnotic:detonating", 1); mine.owner = mine.activator;
  return game.schedule(mine, delay, game.named.action(mine, "hipnotic:proximity-explode"));
}
function proximityTouch(game: Q1EntityServices, mine: Q1Actor, other: ActorId): undefined {
  if (sameActor(other, mine.actor.id) || game.host.classname(other) === mine.classname) return undefined;
  mine.movement = "toss";
  if (mine.count === 1) return undefined;
  const body = game.host.bodies.read(other);
  if (body !== null && length(body.velocity) > 0 || game.entity(other)?.aimedDamage || game.isPlayer(other)) {
    armProximityExplosion(game, mine); return proximityExplode(game, mine);
  }
  game.sound(mine, "weapons/bounce.wav", "weapon"); mine.movement = "none"; mine.count = 1;
  setMissionReference(mine, "hipnotic:surface", other);
  game.setBounds(mine, { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }); return game.link(mine);
}
function proximityWatch(game: Q1EntityServices, mine: Q1Actor): undefined {
  const mines = [...game.entities.values()].filter(entity => entity.classname === mine.classname && entity.number("hipnotic:detonating") === 0);
  const surface = missionReference(game, mine, "hipnotic:surface"), surfaceBody = surface === null ? null : game.host.bodies.read(surface);
  if (game.time > mine.delay || mines.length > 15 || surfaceBody !== null && length(surfaceBody.velocity) > 0) return proximityExplode(game, mine);
  mine.owner = null; mine.damageable = true;
  const origin = game.body(mine).origin;
  for (const observation of [...game.host.actors.observations()].reverse()) {
    const other = observation.id, body = game.host.bodies.read(other); if (body === null) continue;
    const center = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)); if (length(vsub(origin, center)) > 140) continue;
    const target = game.entity(other);
    const liveEnemy = !sameActor(other, mine.actor.id) && game.health(other) > 0 && (game.isPlayer(other) || target?.monster !== null && target?.monster !== undefined) && target?.classname !== mine.classname;
    const looseMine = target?.classname === mine.classname && target.count === 0;
    if (!liveEnemy && !looseMine) continue;
    const trace = game.host.trace({ start: origin, end: body.origin, bounds: POINT, ignore: mine.actor.id, monsters: false });
    if (trace.fraction !== 1) continue;
    game.sound(mine, "hipweap/proxwarn.wav", "weapon"); return armProximityExplosion(game, mine, 0.5);
  }
  return game.schedule(mine, 0.25, game.named.action(mine, "hipnotic:proximity-watch"));
}

export function fireHipnoticMjolnir(game: Q1EntityServices, player: Q1PlayerState): boolean {
  const strike = game.create("hipnotic_hammer_strike"); strike.owner = player.actor.id;
  game.schedule(strike, 0.3, game.named.action(strike, "hipnotic:hammer-strike"));
  player.continuousFiring = false; player.weaponAnimationAt = game.time; player.weaponAnimationBase = game.host.inventory.count(player.actor.id, "q1:ammo/cells") < 30 ? 32 : 38;
  return finish(game, player, 0.8, 1, "progs/v_hammer.mdl", 0);
}
function hammerDamage(game: Q1EntityServices, from: ActorId, start: Vec3, end: Vec3, damage: number, weapon: Q1Weapon): undefined {
  const delta = vsub(end, start), side = { x: -delta.y * 16, y: -delta.y * 16, z: 0 }, hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: from, monsters: true });
    const target = trace.actor;
    if (target === null || hit.some(actor => sameActor(actor, target))) continue;
    hit.push(target);
    if (game.host.combat.read(target)?.canTakeDamage && (game.player(target)?.powerups.get("hipnotic:wetsuit") ?? 0) === 0) {
      game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 225, count: damage * 4 }); game.damage(target, from, from, damage, weapon, "direct", "electric");
    }
  }
  return undefined;
}
function hammerStrike(game: Q1EntityServices, strike: Q1Actor): undefined {
  const player = strike.owner === null ? null : game.player(strike.owner), body = player === null ? null : game.host.bodies.read(player.actor.id);
  if (player === null || body === null) return game.remove(strike);
  const basis = game.makeVectors(player.viewAngles), source = vadd(body.origin, { x: 0, y: 0, z: 16 });
  let trace = game.host.trace({ start: source, end: vadd(source, vscale(basis.forward, 32)), bounds: POINT, ignore: player.actor.id, monsters: true });
  const cells = game.host.inventory.count(player.actor.id, "q1:ammo/cells");
  player.attackFinished = Math.fround(game.time + 0.4);
  if (trace.fraction === 1 && cells >= 15) {
    const start = vadd(source, vscale(basis.forward, 32));
    trace = game.host.trace({ start, end: vsub(start, vscale(basis.up, 50)), bounds: POINT, ignore: player.actor.id, monsters: true });
    if (trace.fraction > 0.3 && trace.fraction < 1) {
      if (player.waterLevel > 1) {
        game.host.inventory.consume(player.actor, "q1:ammo/cells", cells);
        game.radiusDamage(player.actor.id, player.actor.id, 35 * cells, null, "hipnotic:mjolnir", "discharge");
      } else {
        game.host.inventory.consume(player.actor, "q1:ammo/cells", 15); spawnHipnoticHammerBase(game, player, trace.end);
      }
      player.attackFinished = Math.fround(game.time + 1.5); return game.remove(strike);
    }
  }
  const origin = vsub(trace.end, vscale(basis.forward, 4));
  if (trace.actor !== null && game.host.combat.read(trace.actor)?.canTakeDamage) {
    const damage = game.host.classname(trace.actor) === "monster_zombie" ? 70 : 50;
    game.effect("blood", origin, trace.actor, damage); game.damage(trace.actor, player.actor.id, player.actor.id, damage, "hipnotic:mjolnir");
  } else if (trace.fraction !== 1) { game.sound(player.actor, "hipweap/mjoltink.wav", "weapon"); game.effect("gunshot", origin); }
  else game.sound(player.actor, "knight/sword1.wav", "weapon");
  return game.remove(strike);
}
export function spawnHipnoticHammerBase(game: Q1EntityServices, player: Q1PlayerState, origin: Vec3, weapon: Q1Weapon = "hipnotic:mjolnir"): undefined {
  const base = game.create("hipnotic_mjolnir_base"); base.owner = player.actor.id; base.movedir = game.makeVectors(player.viewAngles).forward; base.projectileWeapon = weapon;
  game.setOrigin(base, origin); game.schedule(base, 1, game.named.action(base, "SUB_Remove"));
  game.sound(base, "hipweap/mjolslap.wav", "auto"); game.sound(base, "hipweap/mjolhit.wav", "weapon");
  for (let i = 0; i < 4; i++) {
    const bolt = game.create("hipnotic_mjolnir_lightning"); bolt.owner = base.actor.id; bolt.activator = player.actor.id; bolt.projectileWeapon = weapon;
    bolt.delay = Math.fround(game.time + 0.8); bolt.mangle = { x: 0, y: player.viewAngles.y, z: 0 }; game.setOrigin(bolt, origin);
    game.schedule(bolt, 0, game.named.action(bolt, "hipnotic:hammer-lightning"));
  }
  return undefined;
}
function hammerLightning(game: Q1EntityServices, bolt: Q1Actor): undefined {
  const base = game.entity(bolt.owner);
  if (game.time > bolt.delay || base === null || bolt.activator === null) return game.remove(bolt);
  const origin = game.body(base).origin, oldState = bolt.count;
  let target = missionReference(game, bolt, "hipnotic:enemy");
  if (bolt.count === 0) {
    target = null; let best = 350;
    for (const observation of [...game.host.actors.observations()].reverse()) {
      const actor = observation.id, body = game.host.bodies.read(actor), entity = game.entity(actor);
      if (body === null || sameActor(actor, bolt.activator) || game.health(actor) <= 0 || (entity?.movementFlags ?? 0) & 128 || !(game.isPlayer(actor) || entity?.monster !== null && entity?.monster !== undefined)) continue;
      if ([...game.entities.values()].some(other => (other.classname === "hipnotic_mjolnir_lightning" || other.classname === "hipnotic_tesla_lightning") && other.count === 1 && (() => { const struck = missionReference(game, other, "hipnotic:enemy"); return struck !== null && sameActor(struck, actor); })())) continue;
      const distance = length(vsub(body.origin, origin)); if (distance >= best) continue;
      const visible = game.host.trace({ start: origin, end: body.origin, bounds: POINT, ignore: bolt.actor.id, monsters: false });
      if (visible.fraction !== 1 || visible.inOpen && visible.inWater) continue;
      best = distance; target = actor;
    }
    setMissionReference(bolt, "hipnotic:enemy", target);
    if (target === null) {
      const basis = game.makeVectors(bolt.mangle), end = vadd(vadd(origin, vscale(basis.forward, 200)), vscale(basis.right, 400 * game.host.random() - 200));
      const trace = game.host.trace({ start: origin, end, bounds: POINT, ignore: bolt.actor.id, monsters: false });
      game.host.emit({ kind: "beam", style: "lightning2", actor: bolt.actor.id, start: origin, end: trace.end });
      return game.schedule(bolt, 0.1, game.named.action(bolt, "hipnotic:hammer-lightning"));
    }
    bolt.count = 1;
  }
  const body = target === null ? null : game.host.bodies.read(target);
  if (body === null || target === null) { bolt.count = 0; return game.schedule(bolt, 0.1, game.named.action(bolt, "hipnotic:hammer-lightning")); }
  const size = vsub(body.bounds.max, body.bounds.min), end = vadd(vadd(body.origin, body.bounds.min), vscale(size, 0.25 + game.host.random() * 0.5));
  const trace = game.host.trace({ start: origin, end, bounds: POINT, ignore: bolt.activator, monsters: false });
  if (trace.fraction !== 1 || game.health(target) <= 0) { bolt.count = 0; return game.schedule(bolt, 0.1, game.named.action(bolt, "hipnotic:hammer-lightning")); }
  game.host.emit({ kind: "beam", style: "lightning2", actor: bolt.actor.id, start: origin, end: trace.end });
  const damage = oldState === 0 ? 80 : 30, facing = dot(normalize(vsub(body.origin, origin)), base.movedir);
  hammerDamage(game, bolt.activator, origin, trace.end, facing > 0.3 ? damage : damage * 0.5, bolt.projectileWeapon ?? "hipnotic:mjolnir");
  return game.schedule(bolt, 0.2, game.named.action(bolt, "hipnotic:hammer-lightning"));
}

const laserRegistrations = new WeakSet<Q1EntityServices>();
export function registerHipnoticLaserCallbacks(game: Q1EntityServices): undefined {
  if (laserRegistrations.has(game)) return undefined;
  laserRegistrations.add(game);
  game.named.register("hipnotic:laser-touch", { touch: laserTouch });
  game.named.register("hipnotic:laser-think", { action: (runtime, laser) => {
    if (runtime.time > laser.attackFinished) return runtime.remove(laser);
    moveMissile(runtime, laser, laser.movedir); return runtime.schedule(laser, 0.1, runtime.named.action(laser, "hipnotic:laser-think"));
  } });
  return undefined;
}
export function registerHipnoticWeaponCallbacks(game: Q1EntityServices): undefined {
  registerHipnoticLaserCallbacks(game);
  game.named.register("hipnotic:proximity-touch", { touch: proximityTouch });
  game.named.register("hipnotic:proximity-watch", { action: proximityWatch });
  game.named.register("hipnotic:proximity-explode", { action: proximityExplode });
  game.named.register("hipnotic:proximity-arm-explosion", { die: (runtime, mine) => armProximityExplosion(runtime, mine) });
  return registerHipnoticHammerCallbacks(game);
}
const hammerRegistrations = new WeakSet<Q1EntityServices>();
export function registerHipnoticHammerCallbacks(game: Q1EntityServices): undefined {
  if (hammerRegistrations.has(game)) return undefined;
  hammerRegistrations.add(game);
  game.named.register("hipnotic:hammer-strike", { action: hammerStrike });
  game.named.register("hipnotic:hammer-lightning", { action: hammerLightning }); return undefined;
}
