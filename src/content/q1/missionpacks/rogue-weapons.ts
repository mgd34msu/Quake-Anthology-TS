/* quakec_rogue/lava_wpn.qc and mult_wpn.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState } from "../foundation/types.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import { aim } from "../foundation/weapons.ts";
import { grenadeVelocity, missionReference, moveMissile, setMissionReference, velocityAngles } from "./types.ts";

function finish(game: Q1EntityServices, player: Q1PlayerState, delay: number, model: string, repeating = false): boolean {
  delay = game.weaponAttackDelay(player, delay);
  player.attackFinished = Math.fround(game.time + delay); player.nextWeaponFrame = Math.fround(game.time + (repeating ? game.weaponFrameDelay(player, 0.1) : delay));
  player.continuousFiring = repeating; player.weaponFrame = repeating ? player.weaponFrame % 8 + 1 : player.weapon === "rogue:plasma" ? 0 : 1;
  player.weaponAnimationAt = repeating || player.weapon === "rogue:plasma" ? -1 : game.time; player.weaponAnimationBase = 1; player.hostileUntil = Math.fround(game.time + 1);
  game.weaponPunch(player, -2);
  game.host.emit({ kind: "weapon", player: player.actor.id, weapon: player.weapon, viewModel: model, frame: player.weaponFrame, punch: -2 });
  const body = game.host.bodies.read(player.actor.id); if (body !== null) game.effect("muzzleflash", body.origin, player.actor.id);
  return true;
}
function missile(game: Q1EntityServices, classname: string, owner: ActorId, origin: Vec3, velocity: Vec3, model: string): Q1Actor {
  const entity = game.create(classname); entity.owner = owner; entity.solid = "bbox"; entity.movement = "flymissile"; entity.model = model;
  game.setBounds(entity, POINT); game.setBody(entity, { origin, velocity, angles: velocityAngles(velocity) }); game.link(entity); return entity;
}
function ignoreTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): boolean {
  return entity.owner !== null && sameActor(entity.owner, other) || game.entity(other)?.solid === "trigger";
}
export function launchRogueLavaSpike(game: Q1EntityServices, owner: ActorId, origin: Vec3, direction: Vec3, powered = false): Q1Actor {
  const entity = missile(game, "lava_spike", owner, origin, vscale(direction, 1000), "progs/lspike.mdl");
  entity.count = powered ? 1 : 0; entity.projectileWeapon = powered ? "rogue:lava-supernailgun" : "rogue:lava-nailgun";
  entity.touch = game.named.touch(entity, "rogue:lava-touch"); game.schedule(entity, 6, game.named.action(entity, "SUB_Remove"));
  game.launchProjectileBehavior(entity, owner, entity.projectileWeapon, "nail"); return entity;
}
export function fireRogueLava(game: Q1EntityServices, player: Q1PlayerState): boolean {
  const nails = game.host.inventory.count(player.actor.id, "rogue:ammo/lava-nails");
  const powered = player.weapon === "rogue:lava-supernailgun" && nails >= 2;
  if (!game.host.inventory.consume(player.actor, "rogue:ammo/lava-nails", powered ? 2 : 1)) return false;
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  const basis = game.makeVectors(player.viewAngles), origin = vadd(vadd(body.origin, { x: 0, y: 0, z: 16 }), vscale(basis.right, powered ? 0 : player.nailSide * 4));
  game.sound(player.actor, powered ? "weapons/spike2.wav" : "weapons/rocket1i.wav", "weapon");
  launchRogueLavaSpike(game, player.actor.id, origin, aim(game, player.actor, basis.forward), powered); player.nailSide *= -1;
  return finish(game, player, 0.2, player.weapon === "rogue:lava-supernailgun" ? "progs/v_lava2.mdl" : "progs/v_lava.mdl", true);
}
function lavaTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): undefined {
  if (ignoreTouch(game, entity, other)) return undefined;
  const origin = game.body(entity).origin;
  if (game.host.contents(origin) === "sky") return game.remove(entity);
  const powered = entity.count === 1;
  if (game.host.combat.read(other)?.canTakeDamage) {
    game.effect("blood", origin, other, powered ? 18 : 9);
    if (game.host.classname(other) !== "monster_lava_man") {
      const player = game.isPlayer(other), damage = player ? powered ? 18 : 9 : powered ? 30 : 15;
      game.damage(other, entity.actor.id, entity.owner, damage, entity.projectileWeapon, "direct", powered ? "rogue:super-lava" : "rogue:lava", player ? powered ? "half-effectiveness" : "bypass" : undefined);
    }
  } else game.effect(powered ? "superspike" : "spike", origin);
  return game.remove(entity);
}

export function launchRogueMultiGrenade(game: Q1EntityServices, owner: ActorId, origin: Vec3, velocity: Vec3, angles: Vec3): Q1Actor {
  const grenade = missile(game, "MultiGrenade", owner, origin, velocity, "progs/mervup.mdl");
  grenade.movement = "bounce"; grenade.mangle = angles; grenade.angularVelocity = { x: 300, y: 300, z: 300 }; grenade.projectileWeapon = "rogue:multi-grenade";
  grenade.touch = game.named.touch(grenade, "rogue:multi-grenade-touch");
  game.schedule(grenade, 1, game.named.action(grenade, "rogue:multi-grenade-split"));
  game.launchProjectileBehavior(grenade, owner, "rogue:multi-grenade", "grenade"); return grenade;
}
export function fireRogueMultiGrenade(game: Q1EntityServices, player: Q1PlayerState): boolean {
  if (!game.host.inventory.consume(player.actor, "rogue:ammo/multi-rockets", 1)) return false;
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  const velocity = grenadeVelocity(game, player.viewAngles, aim(game, player.actor, game.makeVectors(player.viewAngles).forward));
  launchRogueMultiGrenade(game, player.actor.id, body.origin, velocity, ZERO); game.sound(player.actor, "weapons/grenade.wav", "weapon");
  return finish(game, player, 0.6, "progs/v_multi.mdl");
}
function grenadeExplode(game: Q1EntityServices, grenade: Q1Actor, mini = true): undefined {
  const player = grenade.owner !== null && game.isPlayer(grenade.owner);
  game.radiusDamage(grenade.actor.id, grenade.owner, mini ? player ? 90 : 60 : 120, null, "rogue:multi-grenade");
  game.effect("explosion", game.body(grenade).origin); return game.remove(grenade);
}
function splitGrenade(game: Q1EntityServices, grenade: Q1Actor): undefined {
  if (grenade.owner === null) return game.remove(grenade);
  for (const offset of [0, 72, 144, 216, 288]) {
    const angles = { ...grenade.mangle, y: grenade.mangle.y + offset }, basis = game.makeVectors(angles);
    let velocity = vadd(vscale(basis.forward, 100), vscale(basis.up, 400));
    velocity = vadd(velocity, vscale(basis.forward, (game.host.random() * 2 - 1) * 60 - 30));
    velocity = vadd(velocity, vscale(basis.right, (game.host.random() * 2 - 1) * 40 - 20));
    velocity = vadd(velocity, vscale(basis.up, (game.host.random() * 2 - 1) * 60 - 30));
    const mini = missile(game, "MiniGrenade", grenade.owner, game.body(grenade).origin, velocity, "progs/mervup.mdl");
    mini.movement = "bounce"; mini.mangle = angles; mini.angularVelocity = { x: 300, y: 300, z: 300 }; mini.projectileWeapon = "rogue:multi-grenade";
    mini.touch = game.named.touch(mini, "rogue:multi-grenade-touch");
    game.launchProjectileBehavior(mini, grenade.owner, "rogue:multi-grenade", "grenade");
    game.schedule(mini, 1 + (game.host.random() * 2 - 1) * 0.5, game.named.action(mini, "rogue:mini-grenade-explode"));
  }
  return game.remove(grenade);
}
function multiGrenadeTouch(game: Q1EntityServices, grenade: Q1Actor, other: ActorId): undefined {
  if (grenade.owner !== null && sameActor(grenade.owner, other)) return undefined;
  if (game.entity(other)?.aimedDamage || game.isPlayer(other)) return grenadeExplode(game, grenade, grenade.classname === "MiniGrenade" || grenade.owner === null || !game.isPlayer(grenade.owner));
  game.sound(grenade, "weapons/bounce.wav", "weapon");
  if (length(game.body(grenade).velocity) === 0) grenade.angularVelocity = ZERO;
  return undefined;
}

function explodeRocket(game: Q1EntityServices, rocket: Q1Actor, direct: ActorId | null): undefined {
  if (direct !== null && game.health(direct) !== 0) {
    let damage = 60 + game.host.random() * 15;
    if (game.host.classname(direct) === "monster_shambler" || game.host.classname(direct) === "monster_dragon") damage *= 0.5;
    game.damage(direct, rocket.actor.id, rocket.owner, damage, "rogue:multi-rocket");
  }
  game.radiusDamage(rocket.actor.id, rocket.owner, 75, direct, "rogue:multi-rocket");
  game.effect("explosion", vsub(game.body(rocket).origin, vscale(normalize(game.body(rocket).velocity), 8))); return game.remove(rocket);
}
function acquireRocket(game: Q1EntityServices, rocket: Q1Actor): undefined {
  if (rocket.delay < game.time) return explodeRocket(game, rocket, null);
  const body = game.body(rocket), owner = rocket.owner === null ? null : game.host.actors.resolveOwned(rocket.owner);
  const direction = owner === null ? normalize(body.velocity) : aim(game, rocket.actor, game.makeVectors(rocket.mangle).forward);
  const trace = game.host.trace({ start: body.origin, end: vadd(body.origin, vscale(direction, 1000)), bounds: POINT, ignore: rocket.actor.id, monsters: true });
  if (trace.actor !== null && game.entity(trace.actor)?.monster !== null && game.entity(trace.actor)?.monster !== undefined) {
    setMissionReference(rocket, "rogue:enemy", trace.actor); return homeRocket(game, rocket);
  }
  rocket.mangle = velocityAngles(body.velocity); return game.schedule(rocket, 0.2, game.named.action(rocket, "rogue:rocket-acquire"));
}
function homeRocket(game: Q1EntityServices, rocket: Q1Actor): undefined {
  const target = missionReference(game, rocket, "rogue:enemy"), body = target === null ? null : game.host.bodies.read(target);
  if (body === null || target === null || game.health(target) < 1) return game.remove(rocket);
  if (game.host.weaponBehavior?.controlsTrajectory(rocket.actor.id) !== true)
    moveMissile(game, rocket, vscale(normalize(vsub(body.origin, game.body(rocket).origin)), 1000));
  return game.schedule(rocket, 0.1, game.named.action(rocket, "rogue:rocket-home"));
}
export function fireRogueMultiRocket(game: Q1EntityServices, player: Q1PlayerState): boolean {
  if (!game.host.inventory.consume(player.actor, "rogue:ammo/multi-rockets", 1)) return false;
  const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
  game.makeVectors(player.viewAngles); const multiplayer = game.options.coop || game.options.deathmatch !== 0;
  for (const shot of [{ offset: -10, frame: 2 }, { offset: -5, frame: 3 }, { offset: 5, frame: 0 }, { offset: 10, frame: 1 }]) {
    const origin = vadd(vadd(body.origin, vscale(game.basis.forward, 8)), { x: 0, y: 0, z: 16 });
    const angles = { ...player.viewAngles, y: player.viewAngles.y + shot.offset * 0.66 };
    const basis = game.makeVectors(multiplayer ? angles : player.viewAngles);
    const velocity = multiplayer ? vscale(aim(game, player.actor, basis.forward), 1000) : vsub(vscale(basis.forward, 1000), vscale(basis.right, shot.offset * 8));
    const rocket = missile(game, "MultiRocket", player.actor.id, origin, velocity, multiplayer ? "progs/rockup_d.mdl" : "progs/rockup.mdl");
    rocket.projectileWeapon = "rogue:multi-rocket"; rocket.frame = shot.frame; rocket.delay = Math.fround(game.time + 4); rocket.mangle = player.viewAngles;
    rocket.touch = game.named.touch(rocket, "rogue:rocket-touch");
    game.launchProjectileBehavior(rocket, player.actor.id, "rogue:multi-rocket", "rocket");
    if (multiplayer) game.schedule(rocket, 4, game.named.action(rocket, "rogue:rocket-explode"));
    else {
      const trace = game.host.trace({ start: origin, end: vadd(origin, velocity), bounds: POINT, ignore: player.actor.id, monsters: true });
      if (trace.actor !== null && game.entity(trace.actor)?.monster !== null && game.entity(trace.actor)?.monster !== undefined) {
        // Both source editions return here without assigning nextthink.
        setMissionReference(rocket, "rogue:enemy", trace.actor); rocket.think = game.named.action(rocket, "rogue:rocket-home");
      } else game.schedule(rocket, 0.1, game.named.action(rocket, "rogue:rocket-acquire"));
    }
  }
  game.sound(player.actor, "weapons/sgun1.wav", "weapon"); return finish(game, player, 0.8, "progs/v_multi2.mdl");
}

export function launchRoguePlasma(game: Q1EntityServices, owner: ActorId, origin: Vec3, direction: Vec3): Q1Actor {
  const plasma = missile(game, "plasma", owner, origin, vscale(direction, 0.01), "progs/plasma.mdl");
  plasma.angularVelocity = { x: 300, y: 300, z: 300 }; plasma.projectileWeapon = "rogue:plasma";
  if (!game.options.coop && game.options.deathmatch === 0) plasma.effects = 4;
  plasma.touch = game.named.touch(plasma, "rogue:plasma-touch"); game.sound(plasma, "plasma/flight.wav", "weapon");
  game.schedule(plasma, 0.1, game.named.action(plasma, "rogue:plasma-launch"));
  game.launchProjectileBehavior(plasma, owner, "rogue:plasma", "plasma"); return plasma;
}
export function fireRoguePlasma(game: Q1EntityServices, player: Q1PlayerState): boolean {
  const ammo = game.host.inventory.count(player.actor.id, "rogue:ammo/plasma"); if (ammo < 1) return false;
  if (player.waterLevel > 1) {
    game.host.inventory.consume(player.actor, "rogue:ammo/plasma", ammo); game.radiusDamage(player.actor.id, player.actor.id, 35 * ammo, null, "rogue:plasma");
  } else {
    const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
    game.host.inventory.consume(player.actor, "rogue:ammo/plasma", 1);
    const basis = game.makeVectors(player.viewAngles), origin = vadd(vadd(body.origin, vscale(basis.forward, 24)), { x: 0, y: 0, z: 16 });
    launchRoguePlasma(game, player.actor.id, origin, aim(game, player.actor, basis.forward));
    game.host.emit({ kind: "sound", actor: player.actor.id, path: "plasma/fire.wav", channel: "weapon", attenuation: 1, volume: 0.5 });
  }
  return finish(game, player, 1, "progs/v_plasma.mdl");
}
function plasmaDamage(game: Q1EntityServices, plasma: Q1Actor, end: Vec3): undefined {
  const origin = game.body(plasma).origin, delta = vsub(end, origin), side = { x: -delta.y * 16, y: -delta.y * 16, z: 0 }, hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(origin, offset), end: vadd(end, offset), bounds: POINT, ignore: plasma.actor.id, monsters: true });
    const other = trace.actor; if (other === null || hit.some(actor => sameActor(actor, other))) continue;
    hit.push(other);
    if (game.host.combat.read(other)?.canTakeDamage) { game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 225, count: 200 }); game.damage(other, plasma.actor.id, plasma.owner, 50, "rogue:plasma"); }
  }
  return undefined;
}
function plasmaTouch(game: Q1EntityServices, plasma: Q1Actor, other: ActorId): undefined {
  if (plasma.owner !== null && sameActor(plasma.owner, other)) return undefined;
  const origin = game.body(plasma).origin; if (game.host.contents(origin) === "sky") return game.remove(plasma);
  let damage = 80 + game.host.random() * 20; game.sound(plasma, "plasma/explode.wav", "weapon");
  if (game.health(other) !== 0) {
    if (game.host.classname(other) === "monster_shambler") damage *= 0.5;
    game.damage(other, plasma.actor.id, plasma.owner, damage, "rogue:plasma");
  }
  game.radiusDamage(plasma.actor.id, plasma.owner, 70, other, "rogue:plasma"); game.effect("explosion", origin);
  let count = 0;
  for (const observation of [...game.host.actors.observations()].reverse()) {
    const target = observation.id, body = game.host.bodies.read(target), entity = game.entity(target);
    if (body === null || plasma.owner !== null && sameActor(plasma.owner, target) || !(game.isPlayer(target) || entity?.monster !== null && entity?.monster !== undefined)) continue;
    const center = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)); if (length(vsub(center, origin)) > 320) continue;
    const trace = game.host.trace({ start: origin, end: body.origin, bounds: POINT, ignore: null, monsters: false }); if (trace.fraction !== 1) continue;
    game.host.emit({ kind: "beam", style: "lightning2", actor: target, start: body.origin, end: origin }); game.sound(plasma, "weapons/lhit.wav", "voice"); plasmaDamage(game, plasma, body.origin);
    if (++count === 5) break;
  }
  return game.remove(plasma);
}
export function registerRogueWeaponCallbacks(game: Q1EntityServices): undefined {
  game.named.register("rogue:lava-touch", { touch: lavaTouch });
  game.named.register("rogue:multi-grenade-touch", { touch: multiGrenadeTouch });
  game.named.register("rogue:multi-grenade-split", { action: splitGrenade });
  game.named.register("rogue:mini-grenade-explode", { action: (runtime, grenade) => grenadeExplode(runtime, grenade) });
  game.named.register("rogue:rocket-explode", { action: (runtime, rocket) => explodeRocket(runtime, rocket, null) });
  game.named.register("rogue:rocket-acquire", { action: acquireRocket }); game.named.register("rogue:rocket-home", { action: homeRocket });
  game.named.register("rogue:rocket-touch", { touch: (runtime, rocket, other) => {
    if (rocket.owner !== null && sameActor(rocket.owner, other)) return undefined;
    if (runtime.host.contents(runtime.body(rocket).origin) === "sky") return runtime.remove(rocket);
    return explodeRocket(runtime, rocket, other);
  } });
  game.named.register("rogue:plasma-touch", { touch: plasmaTouch });
  game.named.register("rogue:plasma-launch", { action: (runtime, plasma) => {
    if (runtime.host.weaponBehavior?.controlsTrajectory(plasma.actor.id) !== true)
      moveMissile(runtime, plasma, vscale(normalize(runtime.body(plasma).velocity), 1250));
    return runtime.schedule(plasma, 5, runtime.named.action(plasma, "SUB_Remove"));
  } }); return undefined;
}
