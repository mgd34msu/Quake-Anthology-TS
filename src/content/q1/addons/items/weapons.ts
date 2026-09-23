/* quakec_mg3/mg3_weapons.qc, weapons.qc and player.qc. GPL-2.0-or-later. */
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1PlayerState, Q1Weapon } from "../../foundation/types.ts";
import { POINT, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { aim, fireBaseWeapon, fireBullets } from "../../foundation/weapons.ts";
import { launchHipnoticLaser, registerHipnoticLaserCallbacks, registerHipnoticHammerCallbacks, spawnHipnoticHammerBase } from "../../missionpacks/hipnotic-weapons.ts";
import type { Q1AddonContext } from "../context.ts";
import { MG3_BLOODY_SHOTGUN, MG3_BLOODY_SUPER_SHOTGUN } from "./pickups.ts";

function infiniteAmmo(context: Q1AddonContext, player: Q1PlayerState): boolean {
  return context.playerNumber(player.actor.id, "infiniteammo") !== 0;
}

export function mg3HammerBodyFrame(context: Q1AddonContext, player: Q1PlayerState): number | null {
  if (player.weapon !== "mg3:mjolnir" || player.weaponAnimationAt < 0 || player.weaponFrame < 1 || player.weaponFrame > 4) return null;
  return context.playerNumber(player.actor.id, "mg3.hammerBodyBase") + player.weaponFrame;
}

export function mg3WeaponFrame(context: Q1AddonContext, player: Q1PlayerState): undefined {
  const { game } = context;
  if (game.health(player.actor.id) <= 0) return undefined;
  if (player.weapon === "mg3:mjolnir" && context.playerNumber(player.actor.id, "mg3.hammerGlow") !== 0
    && context.playerNumber(player.actor.id, "last_mjolnir_hit_time") <= Math.fround(game.time)) {
    context.setPlayerNumber(player.actor.id, "mg3.hammerGlow", 0); emitWeapon(game, player, 0);
  }
  if (game.time <= player.attackFinished || player.weapon === "axe" || player.weapon === "mg3:mjolnir") return undefined;
  const ammo = game.weaponAmmo(player.weapon);
  if (ammo === null || game.host.inventory.count(player.actor.id, ammo) !== 0) return undefined;
  const name = ammo === "q1:ammo/shells" ? "item_shells" : ammo === "q1:ammo/nails" ? "item_spikes"
    : ammo === "q1:ammo/rockets" ? "item_rockets" : ammo === "q1:ammo/cells" ? "item_cells" : null;
  if (name !== null) for (const entity of game.entities.values()) if (entity.classname === name && (entity.spawnflags & 8) !== 0 && entity.solid === "none")
    game.schedule(entity, 0.5 * game.host.random(), game.named.action(entity, "SUB_regen"));
  game.selectWeapon(player.actor, game.chooseBest(player.actor)); return undefined;
}

function emitWeapon(game: Q1EntityServices, player: Q1PlayerState, punch: number): undefined {
  return game.host.emit({ kind: "weapon", player: player.actor.id, weapon: player.weapon,
    viewModel: game.weaponModel(player.weapon, player), frame: player.weaponFrame, punch });
}

function fireLaser(context: Q1AddonContext, player: Q1PlayerState): boolean {
  const { game } = context, body = game.host.bodies.read(player.actor.id);
  if (body === null || !infiniteAmmo(context, player) && !game.host.inventory.consume(player.actor, "q1:ammo/cells", 1)) return false;
  const basis = game.makeVectors(player.viewAngles), outward = normalize({ ...basis.forward, z: 0 });
  const origin = vadd(vadd(body.origin, vscale(basis.up, 6)), vscale(outward, 12)), direction = aim(game, player.actor, basis.forward);
  const paired = !player.continuousFiring || player.weaponFrame === 4;
  const profile = { weapon: "mg3:laser", damage: 15, lightDamage: 20 } satisfies Parameters<typeof launchHipnoticLaser>[5];
  if (paired) {
    const offset = 6 * 0.707, first = vsub(vadd(origin, vscale(basis.right, offset)), vscale(basis.up, offset));
    launchHipnoticLaser(game, player.actor.id, first, direction, false, profile);
    launchHipnoticLaser(game, player.actor.id, vsub(first, vscale(basis.right, offset * 2)), direction, false, profile);
  } else launchHipnoticLaser(game, player.actor.id, vadd(origin, vscale(basis.up, 6)), direction, game.host.random() < 0.1, profile);
  player.continuousFiring = true; player.weaponAnimationAt = -1; player.weaponFrame = paired ? 1 : 4;
  player.attackFinished = player.nextWeaponFrame = Math.fround(game.time + game.weaponFrameDelay(player, 0.1)); player.hostileUntil = Math.fround(game.time + 1);
  emitWeapon(game, player, -1); game.effect("muzzleflash", body.origin, player.actor.id); return true;
}

function hammerStrike(context: Q1AddonContext, strike: Q1Actor): undefined {
  const { game } = context, player = strike.owner === null ? null : game.player(strike.owner);
  const body = player === null ? null : game.host.bodies.read(player.actor.id);
  if (player === null || body === null) return game.remove(strike);
  const basis = game.makeVectors(player.viewAngles), source = vadd(body.origin, { x: 0, y: 0, z: 16 });
  const trace = game.host.trace({ start: source, end: vadd(source, vscale(basis.forward, 64)), bounds: POINT, ignore: player.actor.id, monsters: true });
  const target = trace.actor, origin = vsub(trace.end, vscale(basis.forward, 4));
  player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.4));
  if (target !== null && game.host.combat.read(target)?.canTakeDamage) {
    game.sound(player.actor, "hipweap/mjolslap.wav", "weapon"); game.effect("blood", origin, target, 40);
    const victim = game.entity(target); if (victim !== null) context.setNumber(victim, "axhitme", 1);
    const classname = game.host.classname(target), health = game.health(target);
    const damage = classname === "monster_zombie" || classname === "monster_szombie" ? 120 : health - 40 < 0 ? 80 : 40;
    const last = context.playerReference(player.actor.id, "last_mjolnir_hit");
    if (context.playerNumber(player.actor.id, "last_mjolnir_hit_time") > Math.fround(game.time)) {
      if (last !== null && sameActor(last, target) && player.waterLevel < 2 && game.host.inventory.count(player.actor.id, "q1:ammo/cells") >= 15) {
        const floor = game.host.trace({ start: source, end: vsub(source, vscale(basis.up, player.waterLevel < 1 ? 30 : 15)), bounds: POINT, ignore: player.actor.id, monsters: true });
        if (!infiniteAmmo(context, player)) game.host.inventory.consume(player.actor, "q1:ammo/cells", 15);
        spawnHipnoticHammerBase(game, player, floor.end, "mg3:mjolnir");
      } else game.damage(target, player.actor.id, player.actor.id, damage, "mg3:mjolnir");
      context.setPlayerNumber(player.actor.id, "last_mjolnir_hit_time", game.time); player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.5));
    } else {
      context.setPlayerNumber(player.actor.id, "last_mjolnir_hit_time", game.time + 0.5); context.setPlayerReference(player.actor.id, "last_mjolnir_hit", target);
      player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.2));
      if (game.host.inventory.count(player.actor.id, "q1:ammo/cells") >= 15) context.setPlayerNumber(player.actor.id, "mg3.hammerGlow", 1);
      game.damage(target, player.actor.id, player.actor.id, damage, "mg3:mjolnir");
    }
  } else {
    if (trace.fraction !== 1) { game.sound(player.actor, "hipweap/mjoltink.wav", "weapon"); game.effect("gunshot", origin); }
    else game.sound(player.actor, "weapons/ax1.wav", "weapon");
    context.setPlayerReference(player.actor.id, "last_mjolnir_hit", null);
  }
  emitWeapon(game, player, 0); return game.remove(strike);
}

function fireHammer(context: Q1AddonContext, player: Q1PlayerState): boolean {
  const { game } = context, strike = game.create("mg3_hammer_strike"); strike.owner = player.actor.id;
  context.setPlayerNumber(player.actor.id, "mg3.hammerBodyBase", game.host.inventory.count(player.actor.id, "q1:ammo/cells") < 30 ? 31 : 37);
  game.schedule(strike, 0.2, game.named.action(strike, "mg3:hammer_strike"));
  player.continuousFiring = false; player.weaponAnimationAt = game.time; player.weaponAnimationBase = 1; player.weaponFrame = 1;
  player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.5)); player.hostileUntil = Math.fround(game.time + 1);
  emitWeapon(game, player, 0); return true;
}

function fireShotgun(context: Q1AddonContext, player: Q1PlayerState): boolean {
  const { game } = context, count = game.host.inventory.count(player.actor.id, "q1:ammo/shells");
  const bloody = context.playerNumber(player.actor.id, "parm15");
  if (player.weapon === "supershotgun" && (bloody & MG3_BLOODY_SUPER_SHOTGUN) !== 0 && count > 1) {
    const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
    if (!infiniteAmmo(context, player)) game.host.inventory.consume(player.actor, "q1:ammo/shells", 2);
    game.sound(player.actor, "weapons/shotgn2.wav", "weapon");
    const basis = game.makeVectors(player.viewAngles);
    fireBullets(game, player.actor, aim(game, player.actor, basis.forward), player.viewAngles, 28, 0.3, 0.08, "supershotgun");
    player.continuousFiring = false; player.weaponAnimationAt = game.time; player.weaponAnimationBase = 1; player.weaponFrame = 1;
    player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.7)); player.hostileUntil = Math.fround(game.time + 1);
    emitWeapon(game, player, -4); game.effect("muzzleflash", body.origin, player.actor.id); return true;
  }
  const fired = fireBaseWeapon(game, player);
  if (fired && player.weapon === "shotgun" && (bloody & MG3_BLOODY_SHOTGUN) !== 0) player.attackFinished = Math.fround(game.time + game.weaponAttackDelay(player, 0.28));
  return fired;
}

export function registerMg3Weapons(context: Q1AddonContext): undefined {
  const { game } = context;
  game.registerWeaponRules({ id: "q1:mg3:ammunition", consumeAmmo: (_game, player, item, amount) => infiniteAmmo(context, player) || game.host.inventory.consume(player.actor, item, amount) });
  registerHipnoticLaserCallbacks(game); registerHipnoticHammerCallbacks(game);
  game.named.register("mg3:hammer_strike", { action: (_game, entity) => hammerStrike(context, entity) });
  game.registerWeapon({ id: "mg3:laser", ammo: "q1:ammo/cells", model: "progs/v_laserg.mdl", rank: 3, fire: (_game, player) => fireLaser(context, player) });
  game.registerWeapon({ id: "mg3:mjolnir", ammo: "q1:ammo/cells", ammoPerShot: 0, model: "progs/v_hammer.mdl", rank: 8,
    modelFor: (_game, player) => context.playerNumber(player.actor.id, "mg3.hammerGlow") !== 0 && context.playerNumber(player.actor.id, "last_mjolnir_hit_time") > Math.fround(game.time) ? "progs/v_hammer_glow.mdl" : "progs/v_hammer.mdl",
    fire: (_game, player) => fireHammer(context, player), animate: (_game, player, seconds) => {
      if (player.weaponAnimationAt < 0) return undefined;
      const step = Math.floor((seconds - player.weaponAnimationAt) / 0.1), frame = step >= 4 ? 0 : step + 1;
      if (frame !== player.weaponFrame) { player.weaponFrame = frame; emitWeapon(game, player, 0); }
      if (step >= 4) player.weaponAnimationAt = -1; return undefined;
    } });
  for (const weapon of ["shotgun", "supershotgun"] satisfies readonly Q1Weapon[]) game.replaceWeapon({ id: weapon, ammo: "q1:ammo/shells", ammoPerShot: 1,
    model: weapon === "shotgun" ? "progs/v_shot.mdl" : "progs/v_shot2.mdl", rank: weapon === "shotgun" ? 8 : 6,
    bestAvailable: (_game, player) => weapon === "shotgun" || game.host.inventory.count(player.actor.id, "q1:ammo/shells") >= 2,
    modelFor: (_game, player) => (context.playerNumber(player.actor.id, "parm15") & (weapon === "shotgun" ? MG3_BLOODY_SHOTGUN : MG3_BLOODY_SUPER_SHOTGUN)) !== 0
      ? weapon === "shotgun" ? "progs/v_bloodshot.mdl" : "progs/v_bloodshot2.mdl" : weapon === "shotgun" ? "progs/v_shot.mdl" : "progs/v_shot2.mdl",
    fire: (_game, player) => fireShotgun(context, player) });
  // The MG3 QC intentionally omits laser/rocket/grenade launchers from W_BestWeapon.
  game.registerWeaponOrder("q1:mg3", ["lightning", "supernailgun", "supershotgun", "nailgun", "shotgun", "mg3:mjolnir", "axe"]);
  return undefined;
}
