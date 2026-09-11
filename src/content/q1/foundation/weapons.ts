/* weapons.qc/player.qc, Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "./entity.ts";
import type { Q1Foundation } from "./runtime.ts";
import { ammoItem } from "./runtime.ts";
import type { Q1PlayerState, Q1Weapon } from "./types.ts";
import { POINT, ZERO, vadd, vsub, vscale, normalize, dot, isQ1BaseWeapon } from "./types.ts";

export function weaponModel(weapon: Q1Weapon): string {
  if (!isQ1BaseWeapon(weapon)) throw new Error(`Use registered Q1 weapon model for ${weapon}`);
  switch (weapon) {
    case "axe": return "progs/v_axe.mdl";
    case "shotgun": return "progs/v_shot.mdl";
    case "supershotgun": return "progs/v_shot2.mdl";
    case "nailgun": return "progs/v_nail.mdl";
    case "supernailgun": return "progs/v_nail2.mdl";
    case "grenadelauncher": return "progs/v_rock.mdl";
    case "rocketlauncher": return "progs/v_rock2.mdl";
    case "lightning": return "progs/v_light.mdl";
  }
}
export function bestWeapon(game: Q1Foundation, actor: OwnedActor): Q1Weapon {
  const order = game.weaponOrder ?? ["lightning", "supernailgun", "supershotgun", "nailgun", "shotgun", "axe"];
  const player = game.player(actor.id); if (player === null) return "axe";
  for (const weapon of order) if (game.weaponAvailable(player, weapon)) return weapon;
  return "axe";
}

/** PF_aim preserves horizontal aim and corrects height toward a visible DAMAGE_AIM target. */
export function aim(game: Q1Foundation, actor: OwnedActor, forward: Vec3): Vec3 {
  const body = game.host.bodies.read(actor.id); if (body === null) return forward;
  const start = vadd(body.origin, { x: 0, y: 0, z: 20 });
  const team = game.host.combat.read(actor.id)?.team ?? null;
  const eligible = (target: ActorId): boolean => {
    if (sameActor(target, actor.id) || !(game.entity(target)?.aimedDamage || game.isPlayer(target))) return false;
    const state = game.host.combat.read(target);
    return state !== null && state.canTakeDamage && !((game.options.teamplay ?? 0) !== 0 && team !== null && team === state.team);
  };
  const straight = game.host.trace({ start, end: vadd(start, vscale(forward, 2048)), bounds: POINT, ignore: actor.id, monsters: true });
  if (straight.actor !== null && eligible(straight.actor)) return forward;
  let best = game.options.aimThreshold ?? 0.93, selected: Vec3 | null = null;
  for (const observation of game.host.actors.observations()) {
    const target = observation.id; if (!eligible(target)) continue;
    const targetBody = game.host.bodies.read(target); if (targetBody === null) continue;
    const end = vadd(targetBody.origin, vscale(vadd(targetBody.bounds.min, targetBody.bounds.max), 0.5));
    const distance = dot(normalize(vsub(end, start)), forward); if (distance < best) continue;
    const trace = game.host.trace({ start, end, bounds: POINT, ignore: actor.id, monsters: true });
    if (trace.actor !== null && sameActor(trace.actor, target)) { best = distance; selected = targetBody.origin; }
  }
  if (selected === null) return forward;
  const delta = vsub(selected, body.origin), result = vscale(forward, dot(delta, forward));
  return normalize({ ...result, z: delta.z });
}

/** MultiDamage flushes when the next pellet changes target, preserving intervening reactions. */
export function fireBullets(game: Q1Foundation, shooter: OwnedActor, direction: Vec3, viewAngles: Vec3, count: number, spreadX: number, spreadY: number, weapon: Q1Weapon | null): undefined {
  const body = game.host.bodies.read(shooter.id); if (body === null) return undefined;
  const basis = game.makeVectors(viewAngles); let source = vadd(body.origin, vscale(basis.forward, 10));
  source = { ...source, z: Math.fround(body.origin.z + body.bounds.min.z + (body.bounds.max.z - body.bounds.min.z) * 0.7) };
  let pending: ActorId | null = null, total = 0;
  const flush = (): undefined => { if (pending !== null && game.host.actors.isLive(pending)) game.damage(pending, shooter.id, shooter.id, total, weapon); total = 0; return undefined; };
  for (let shot = 0; shot < count; shot++) {
    const ray = vadd(vadd(direction, vscale(game.basis.right, (game.host.random() * 2 - 1) * spreadX)), vscale(game.basis.up, (game.host.random() * 2 - 1) * spreadY));
    const trace = game.host.trace({ start: source, end: vadd(source, vscale(ray, 2048)), bounds: POINT, ignore: shooter.id, monsters: true });
    if (trace.fraction === 1) continue;
    if (trace.actor !== null && game.host.combat.read(trace.actor)?.canTakeDamage) {
      game.effect("blood", vsub(trace.end, vscale(ray, 4)), trace.actor, 4);
      if (pending === null || !sameActor(pending, trace.actor)) { flush(); pending = trace.actor; }
      total += 4;
    } else game.effect("gunshot", vsub(trace.end, vscale(ray, 4)), trace.actor);
  }
  return flush();
}

function projectile(game: Q1Foundation, player: Q1PlayerState, kind: "rocket" | "grenade" | "spike" | "superspike", velocity: Vec3, origin: Vec3): Q1Actor {
  const entity = game.create(kind === "rocket" ? "missile" : kind);
  entity.projectile = kind; entity.projectileWeapon = player.weapon; entity.owner = player.actor.id;
  entity.movement = kind === "grenade" ? "bounce" : "flymissile"; entity.solid = "bbox";
  entity.model = kind === "rocket" ? "progs/missile.mdl" : kind === "grenade" ? "progs/grenade.mdl" : kind === "superspike" ? "progs/s_spike.mdl" : "progs/spike.mdl";
  if (kind === "grenade") entity.angularVelocity = { x: 300, y: 300, z: 300 };
  game.setBody(entity, { origin, velocity }); game.link(entity);
  entity.touch = game.named.touch(entity, "projectile_touch");
  game.schedule(entity, kind === "grenade" ? 2.5 : kind === "rocket" ? 5 : 6,
    game.named.action(entity, kind === "grenade" ? "GrenadeExplode" : "SUB_Remove"));
  return entity;
}
export function projectileTouch(game: Q1Foundation, entity: Q1Actor, other: ActorId | null, _normal: Vec3): undefined {
  if (other !== null && entity.owner !== null && sameActor(other, entity.owner)) return undefined;
  if (other !== null && game.entity(other)?.solid === "trigger") return undefined;
  if (game.host.contents(game.body(entity).origin) === "sky") return game.remove(entity);
  switch (entity.projectile) {
    case "rocket": return explode(game, entity, other, true);
    case "grenade":
      if (other !== null && (game.entity(other)?.aimedDamage || game.isPlayer(other))) return explode(game, entity, null, false);
      return game.sound(entity, "weapons/bounce.wav", "weapon");
    case "spike": case "superspike": {
      const amount = entity.projectile === "spike" ? 9 : 18;
      if (other !== null && game.host.combat.read(other)?.canTakeDamage) {
        game.effect("blood", game.body(entity).origin, other, amount); game.damage(other, entity.actor.id, entity.owner, amount, entity.projectileWeapon);
      } else game.effect(entity.classname === "wizard_spike" ? "wizard-spike" : entity.classname === "knight_spike" ? "knight-spike" : entity.projectile, game.body(entity).origin);
      return game.remove(entity);
    }
    case null: return undefined;
  }
}
function explode(game: Q1Foundation, entity: Q1Actor, direct: ActorId | null, rocket: boolean): undefined {
  if (rocket && direct !== null && game.health(direct) !== 0) {
    let amount = Math.fround(100 + game.host.random() * 20);
    if (game.host.classname(direct) === "monster_shambler") amount *= 0.5;
    game.damage(direct, entity.actor.id, entity.owner, amount, entity.projectileWeapon);
  }
  game.radiusDamage(entity.actor.id, entity.owner, 120, direct, entity.projectileWeapon);
  const origin = rocket ? vsub(game.body(entity).origin, vscale(normalize(game.body(entity).velocity), 8)) : game.body(entity).origin;
  game.effect("explosion", origin);
  // BecomeExplosion in the network Quake source removes the missile after emitting TE_EXPLOSION.
  return game.remove(entity);
}
function lightning(game: Q1Foundation, player: Q1PlayerState): undefined {
  const body = game.host.bodies.read(player.actor.id); if (body === null) return undefined;
  const cells = game.host.inventory.count(player.actor.id, "q1:ammo/cells");
  if (player.waterLevel > 1) {
    game.consumeWeaponAmmo(player, "q1:ammo/cells", cells); return game.radiusDamage(player.actor.id, player.actor.id, 35 * cells, null, "lightning", "discharge");
  }
  game.consumeWeaponAmmo(player, "q1:ammo/cells", 1);
  const forward = game.makeVectors(player.viewAngles).forward, start = vadd(body.origin, { x: 0, y: 0, z: 16 });
  const wall = game.host.trace({ start, end: vadd(start, vscale(forward, 600)), bounds: POINT, ignore: player.actor.id, monsters: false });
  game.host.emit({ kind: "beam", style: "lightning2", actor: player.actor.id, start, end: wall.end });
  const end = vadd(wall.end, vscale(forward, 4));
  // Preserve the source's discarded normalize return and sequential x/y assignments.
  const delta = vsub(end, body.origin), side = { x: -delta.y * 16, y: -delta.y * 16, z: 0 };
  const hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(body.origin, offset), end: vadd(end, offset), bounds: POINT, ignore: player.actor.id, monsters: true });
    const target = trace.actor;
    if (target !== null && !hit.some(actor => sameActor(actor, target)) && game.host.combat.read(target)?.canTakeDamage) {
      hit.push(target); game.effect("blood", trace.end, target, 120); game.damage(target, player.actor.id, player.actor.id, 30, "lightning");
    }
  }
  return undefined;
}
export function fireWeapon(game: Q1Foundation, player: Q1PlayerState): boolean {
  if (game.registeredWeapons.has(player.weapon) || !isQ1BaseWeapon(player.weapon)) return game.fireRegisteredWeapon(player);
  return fireBaseWeapon(game, player);
}
/** An overriding source definition can delegate its unmodified attack without reentering its own registration. */
export function fireBaseWeapon(game: Q1Foundation, player: Q1PlayerState): boolean {
  if (!isQ1BaseWeapon(player.weapon)) throw new Error("Base Q1 attack requires a base weapon");
  const repeating = player.continuousFiring;
  if (game.health(player.actor.id) <= 0 || game.time < (repeating ? player.nextWeaponFrame : player.attackFinished)) return false;
  const ammo = ammoItem(player.weapon);
  if (ammo !== null && game.host.inventory.count(player.actor.id, ammo) < 1) { game.selectWeapon(player.actor, bestWeapon(game, player.actor)); return false; }
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  if (!game.registeredWeapons.has(player.weapon)) game.weaponBeforeFire(player);
  const basis = game.makeVectors(player.viewAngles); const weapon = player.weapon; let delay = 0.1, punch = -2;
  player.continuousFiring = weapon === "nailgun" || weapon === "supernailgun" || weapon === "lightning";
  player.nextWeaponFrame = Math.fround(game.time + 0.1);
  if (!player.continuousFiring) { player.weaponAnimationAt = game.time; player.weaponAnimationBase = 1; }
  player.hostileUntil = game.time + 1;
  switch (weapon) {
    case "axe": {
      delay = 0.5; punch = 0; game.sound(player.actor, "weapons/ax1.wav", "weapon");
      const animation = game.host.random(); player.weaponAnimationBase = animation >= 0.25 && animation < 0.5 || animation >= 0.75 ? 5 : 1;
      // player_axe3 is the hit frame, two 0.1 second animation steps after attack begins.
      const strike = game.create("axe_strike"); strike.owner = player.actor.id;
      game.schedule(strike, 0.2, game.named.action(strike, "player_axe3")); break;
    }
    case "shotgun": case "supershotgun": {
      const superShot = weapon === "supershotgun" && game.host.inventory.count(player.actor.id, "q1:ammo/shells") > 1;
      game.consumeWeaponAmmo(player, "q1:ammo/shells", superShot ? 2 : 1); delay = weapon === "supershotgun" ? 0.7 : 0.5; punch = superShot ? -4 : -2;
      game.sound(player.actor, superShot ? "weapons/shotgn2.wav" : "weapons/guncock.wav", "weapon");
      fireBullets(game, player.actor, aim(game, player.actor, basis.forward), player.viewAngles, superShot ? 14 : 6, superShot ? 0.14 : 0.04, superShot ? 0.08 : 0.04, weapon); break;
    }
    case "nailgun": case "supernailgun": {
      const superNail = weapon === "supernailgun" && game.host.inventory.count(player.actor.id, "q1:ammo/nails") >= 2;
      delay = 0.2;
      game.consumeWeaponAmmo(player, "q1:ammo/nails", superNail ? 2 : 1);
      game.sound(player.actor, superNail ? "weapons/spike2.wav" : "weapons/rocket1i.wav", "weapon");
      const origin = vadd(vadd(body.origin, { x: 0, y: 0, z: 16 }), vscale(basis.right, superNail ? 0 : player.nailSide * 4));
      projectile(game, player, superNail ? "superspike" : "spike", vscale(aim(game, player.actor, basis.forward), game.nailSpeed(player, 1000)), origin); player.nailSide *= -1; break;
    }
    case "grenadelauncher": {
      game.consumeWeaponAmmo(player, "q1:ammo/rockets", 1); delay = 0.6; game.sound(player.actor, "weapons/grenade.wav", "weapon");
      const velocity = player.viewAngles.x === 0 ? { ...vscale(aim(game, player.actor, basis.forward), 600), z: 200 } :
        vadd(vadd(vadd(vscale(basis.forward, 600), vscale(basis.up, 200)), vscale(basis.right, (game.host.random() * 2 - 1) * 10)), vscale(basis.up, (game.host.random() * 2 - 1) * 10));
      projectile(game, player, "grenade", velocity, body.origin); break;
    }
    case "rocketlauncher": {
      game.consumeWeaponAmmo(player, "q1:ammo/rockets", 1); delay = 0.8; game.sound(player.actor, "weapons/sgun1.wav", "weapon");
      projectile(game, player, "rocket", vscale(aim(game, player.actor, basis.forward), 1000), vadd(vadd(body.origin, vscale(basis.forward, 8)), { x: 0, y: 0, z: 16 })); break;
    }
    case "lightning":
      delay = repeating ? 0.2 : 0.1;
      if (player.lightningSoundAt < game.time) { game.sound(player.actor, "weapons/lhit.wav", "weapon"); player.lightningSoundAt = game.time + 0.6; }
      lightning(game, player); if (!repeating) game.sound(player.actor, "weapons/lstart.wav", "auto"); break;
  }
  player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, delay));
  player.weaponFrame = player.continuousFiring ? player.weaponFrame % (weapon === "lightning" ? 4 : 8) + 1 : player.weaponAnimationBase;
  game.host.emit({ kind: "weapon", player: player.actor.id, weapon, viewModel: game.weaponModel(weapon, player), frame: player.weaponFrame, punch });
  game.effect("muzzleflash", body.origin, player.actor.id); return true;
}

function axeStrike(game: Q1Foundation, strike: Q1Actor): undefined {
        const player = strike.owner === null ? null : game.player(strike.owner); if (player === null) return game.remove(strike);
        const current = game.host.bodies.read(player.actor.id); if (current === null) return game.remove(strike);
        const start = vadd(current.origin, { x: 0, y: 0, z: 16 }), forward = game.makeVectors(player.viewAngles).forward;
        const trace = game.host.trace({ start, end: vadd(start, vscale(forward, 64)), bounds: POINT, ignore: player.actor.id, monsters: true });
        if (trace.fraction < 1) {
          if (trace.actor !== null && game.host.combat.read(trace.actor)?.canTakeDamage) { game.effect("blood", trace.end, trace.actor, 20); game.damage(trace.actor, player.actor.id, player.actor.id, 20, "axe"); }
          else { game.sound(player.actor, "player/axhit2.wav", "weapon"); game.effect("gunshot", trace.end, null, 3); }
        }
        return game.remove(strike);
}

export function registerWeaponCallbacks(game: Q1Foundation): undefined {
  game.named.register("projectile_touch", { touch: (runtime, entity, other, normal) => projectileTouch(runtime, entity, other, normal ?? ZERO) });
  game.named.register("GrenadeExplode", { action: (runtime, entity) => explode(runtime, entity, null, false) });
  game.named.register("player_axe3", { action: axeStrike });
  return undefined;
}
