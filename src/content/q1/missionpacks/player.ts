/* Hipnotic/Rogue client.qc, combat.qc, shield.qc, sphere.qc and new_ai.qc. GPL-2.0-or-later. */
import type { DamagePreparation, DamageRequest, InventoryEntry } from "../../../contracts/gameplay.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Q1DamageSourceEffects } from "../../../world/gameplay/index.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1PlayerState, Q1Powerup, Q1Weapon } from "../foundation/types.ts";
import { POINT, length, normalize, vadd, vscale, vsub, weaponItem, yawFor } from "../foundation/types.ts";
import { missionReference, missionWeapons, moveMissile, setMissionNumber, setMissionReference } from "./types.ts";
import type { MissionPowerup, Q1MissionPack } from "./types.ts";
import { missionMessage } from "./messages.ts";

interface ComboWeapon { readonly base: Q1Weapon; readonly powered: Q1Weapon; readonly ammo: "rogue:ammo/lava-nails" | "rogue:ammo/multi-rockets" | "rogue:ammo/plasma"; readonly message: string; }
const combos: readonly ComboWeapon[] = [
  { base: "nailgun", powered: "rogue:lava-nailgun", ammo: "rogue:ammo/lava-nails", message: "$qc_lava_enabled" },
  { base: "supernailgun", powered: "rogue:lava-supernailgun", ammo: "rogue:ammo/lava-nails", message: "$qc_super_lava_enabled" },
  { base: "grenadelauncher", powered: "rogue:multi-grenade", ammo: "rogue:ammo/multi-rockets", message: "$qc_multi_gl_enabled" },
  { base: "rocketlauncher", powered: "rogue:multi-rocket", ammo: "rogue:ammo/multi-rockets", message: "$qc_multi_rl_enabled" },
  { base: "lightning", powered: "rogue:plasma", ammo: "rogue:ammo/plasma", message: "$qc_plasma_enabled" },
];
const timers: readonly { readonly id: MissionPowerup; readonly warn: string; readonly lost: string; readonly sound: string }[] = [
  { id: "hipnotic:wetsuit", warn: "$qc_wetsuit_fade", lost: "", sound: "items/suit2.wav" },
  { id: "hipnotic:empathy", warn: "$qc_empathy_fade", lost: "", sound: "items/suit2.wav" },
  { id: "rogue:shield", warn: "$qc_shield_failing", lost: "$qc_shield_lost", sound: "shield/fadeout.wav" },
  { id: "rogue:antigrav", warn: "$qc_antigrav_failing", lost: "$qc_antigrav_lost", sound: "belt/fadeout.wav" },
];
export class MissionPackPlayers {
  readonly sourceEffects: Q1DamageSourceEffects;
  constructor(readonly game: Q1Foundation, readonly pack: Q1MissionPack) {
    this.sourceEffects = { beforeQuad: (request, damage) => this.beforeQuad(request, damage), afterQuad: (request, damage) => this.afterQuad(request, damage) };
    game.registerDamageSourceEffects(`q1:${pack}:effects`, this.sourceEffects);
    game.registerPlayerExtension({ id: `q1:${pack}:players`, attach: (_runtime, player) => this.attach(player), frame: (_runtime, player, seconds) => this.frame(player, seconds), afterPhysics: (_runtime, player, seconds) => this.afterPhysics(player, seconds) });
    game.named.register("rogue:shield-think", { action: (runtime, shield) => {
      const body = shield.owner === null ? null : runtime.host.bodies.read(shield.owner);
      if (body === null || shield.delay < runtime.time) return runtime.remove(shield);
      if (shield.delay - 0.25 <= runtime.time) shield.model = "";
      else runtime.setBody(shield, { origin: body.origin, angles: body.angles });
      return runtime.schedule(shield, 0.05, runtime.named.action(shield, "rogue:shield-think"));
    } });
    game.named.register("rogue:sphere-think", { action: (runtime, sphere) => this.sphereThink(runtime, sphere) });
    game.named.register("rogue:sphere-attack", { action: (runtime, sphere) => this.sphereAttack(runtime, sphere) });
    game.named.register("rogue:sphere-impact", { touch: (runtime, sphere, target) => {
      if (runtime.health(target) !== 0) runtime.damage(target, sphere.actor.id, sphere.actor.id, 1000, null, "direct", "rogue:vengeance");
      runtime.radiusDamage(sphere.actor.id, sphere.actor.id, 300, target, null, "rogue:vengeance");
      runtime.effect("explosion", vsub(runtime.body(sphere).origin, vscale(normalize(runtime.body(sphere).velocity), 8))); return runtime.remove(sphere);
    } });
  }
  private state(player: Q1PlayerState): Q1Actor {
    const existing = [...this.game.entities.values()].find(entity => entity.classname === "missionpack_player_state" && entity.owner !== null && sameActor(entity.owner, player.actor.id));
    if (existing !== undefined) return existing;
    const entity = this.game.create("missionpack_player_state"); entity.owner = player.actor.id; return entity;
  }
  attach(player: Q1PlayerState): undefined {
    const inventory = this.game.host.inventory;
    for (const weapon of missionWeapons) if (weapon.id.startsWith(`${this.pack}:`)) inventory.configure(player.actor, { item: weaponItem(weapon.id), count: inventory.count(player.actor.id, weaponItem(weapon.id)), capacity: 1 });
    if (this.pack === "rogue") {
      const entries: readonly InventoryEntry[] = [{ item: "rogue:ammo/lava-nails", count: 0, capacity: 200 }, { item: "rogue:ammo/multi-rockets", count: 0, capacity: 100 }, { item: "rogue:ammo/plasma", count: 0, capacity: 100 }, { item: "rogue:artifact/vengeance", count: 0, capacity: 1 }];
      for (const entry of entries) inventory.configure(player.actor, { ...entry, count: inventory.count(player.actor.id, entry.item) });
    }
    this.state(player); return undefined;
  }
  enableCombos(player: Q1PlayerState): undefined {
    if (this.pack !== "rogue") return undefined;
    const inventory = this.game.host.inventory;
    for (const combo of combos) if (inventory.count(player.actor.id, weaponItem(combo.powered)) === 0 && inventory.count(player.actor.id, weaponItem(combo.base)) > 0 && inventory.count(player.actor.id, combo.ammo) > 0) {
      inventory.give(player.actor, weaponItem(combo.powered), 1); missionMessage(this.game, player.actor.id, combo.message);
    }
    return undefined;
  }
  powerup(player: Q1PlayerState, powerup: Q1Powerup, seconds: number): undefined {
    const state = this.state(player); state.fields.delete(`${powerup}:warned`); state.fields.delete(`${powerup}:lost`);
    if (powerup === "rogue:antigrav") this.game.setGravity(player.actor.id, 0.25);
    return this.game.givePowerup(player, powerup, seconds);
  }
  gravityScale(player: ActorId): number { return (this.game.player(player)?.powerups.get("rogue:antigrav") ?? 0) > this.game.time ? 0.25 : 1; }
  private frame(player: Q1PlayerState, seconds: number): undefined {
    const game = this.game, state = this.state(player); this.enableCombos(player);
    for (const timer of timers) {
      const expires = player.powerups.get(timer.id); if (expires === undefined) continue;
      if (expires < seconds + 3 && state.number(`${timer.id}:warned`) === 0) {
        missionMessage(game, player.actor.id, timer.warn); game.sound(player.actor, timer.sound, "auto"); setMissionNumber(state, `${timer.id}:warned`, 1);
      }
      if (expires < seconds + 3 && state.number(`${timer.id}:flash`) < seconds) {
        const body = game.host.bodies.read(player.actor.id); if (body !== null) game.effect("pickup", body.origin, player.actor.id);
        setMissionNumber(state, `${timer.id}:flash`, seconds + 1);
      }
      if (expires <= seconds && state.number(`${timer.id}:lost`) === 0) {
        missionMessage(game, player.actor.id, timer.lost); setMissionNumber(state, `${timer.id}:lost`, 1);
        if (timer.id === "rogue:antigrav") game.setGravity(player.actor.id, 1);
      }
    }
    if ((player.powerups.get("hipnotic:wetsuit") ?? 0) > seconds) {
      player.airFinished = seconds + 12;
      if (player.waterLevel >= 2) {
        if (state.number("hipnotic:scuba") < seconds) { game.sound(player.actor, "misc/wetsuit.wav", "body"); setMissionNumber(state, "hipnotic:scuba", seconds + 7); }
        const body = game.host.bodies.read(player.actor.id);
        if (body !== null && state.text("hipnotic:scaled-time") !== String(seconds)) {
          game.host.bodies.write(player.actor, { ...body, velocity: vscale(body.velocity, player.waterLevel === 2 ? 1.25 : 1.5) });
          state.fields.set("hipnotic:scaled-time", String(seconds)); setMissionNumber(state, "hipnotic:scaled-level", player.waterLevel);
        }
      }
    }
    const entity = game.entity(player.actor.id);
    if (entity !== null) entity.effects = (player.powerups.get("hipnotic:empathy") ?? 0) > seconds ? entity.effects | 8 : entity.effects & ~8;
    return undefined;
  }
  private afterPhysics(player: Q1PlayerState, seconds: number): undefined {
    const state = this.state(player);
    if (state.text("hipnotic:scaled-time") === String(seconds)) {
      const body = this.game.host.bodies.read(player.actor.id);
      if (body !== null) this.game.host.bodies.write(player.actor, { ...body, velocity: vscale(body.velocity, state.number("hipnotic:scaled-level") === 2 ? 0.8 : 0.66) });
      state.fields.delete("hipnotic:scaled-time");
    }
    return undefined;
  }
  private beforeQuad(request: DamageRequest, damage: number): DamagePreparation {
    const game = this.game, player = game.player(request.target), cause = request.attack.cause;
    if (player === null) return { kind: "continue", amount: damage };
    if (this.pack === "hipnotic" && cause.kind === "q1" && cause.deathType === "discharge" && (player.powerups.get("hipnotic:wetsuit") ?? 0) !== 0) return { kind: "cancel" };
    if (this.pack === "rogue" && (player.powerups.get("rogue:shield") ?? 0) !== 0 && request.attack.inflictor !== null) {
      const body = game.host.bodies.read(request.target), incoming = game.host.bodies.read(request.attack.inflictor);
      if (body !== null && incoming !== null) {
        const hitAngle = yawFor(vsub(incoming.origin, body.origin)) - yawFor(game.makeVectors(body.angles).forward);
        if (!(hitAngle > 90 && hitAngle < 270 || hitAngle < -90 && hitAngle > -270)) {
          this.shieldHit(player); return { kind: "continue", amount: Math.fround(damage * (game.host.classname(request.attack.inflictor) === "lava_spike" ? 0.7 : 0.3)) };
        }
      }
    }
    return { kind: "continue", amount: damage };
  }
  private afterQuad(request: DamageRequest, damage: number): DamagePreparation {
    const game = this.game, player = game.player(request.target), attacker = request.attack.attacker;
    if (player === null) return { kind: "continue", amount: damage };
    if (attacker !== null) setMissionReference(this.state(player), "rogue:killer", attacker);
    const inflictor = request.attack.inflictor;
    if (this.pack === "hipnotic" && attacker !== null && !sameActor(attacker, request.target) && (player.powerups.get("hipnotic:empathy") ?? 0) !== 0 && (inflictor === null || (game.player(inflictor)?.powerups.get("hipnotic:empathy") ?? 0) === 0)) {
      const reflected = Math.fround(damage / 2); game.damage(attacker, request.target, request.target, reflected, null, "direct", "hipnotic:empathy");
      return { kind: "continue", amount: reflected };
    }
    return { kind: "continue", amount: damage };
  }
  private shieldHit(player: Q1PlayerState): undefined {
    const game = this.game, state = this.state(player), body = game.host.bodies.read(player.actor.id); if (body === null) return undefined;
    if (state.number("rogue:shield-death") <= game.time) {
      const shield = game.create("power_shield"); shield.owner = player.actor.id; shield.model = "progs/p_shield.mdl"; shield.delay = Math.fround(game.time + 0.3);
      game.setBounds(shield, POINT); game.setBody(shield, { origin: body.origin, angles: body.angles }); game.link(shield);
      setMissionNumber(state, "rogue:shield-death", shield.delay); game.schedule(shield, 0.1, game.named.action(shield, "rogue:shield-think"));
    }
    if (state.number("rogue:shield-sound") < game.time) { game.sound(player.actor, "shield/hit.wav", "item"); setMissionNumber(state, "rogue:shield-sound", game.time + 0.5); }
    return undefined;
  }
  sphere(item: Q1Actor, player: Q1PlayerState): boolean {
    const game = this.game;
    if (game.host.inventory.give(player.actor, "rogue:artifact/vengeance", 1) === 0) return false;
    const sphere = game.create("Vengeance"); sphere.owner = player.actor.id; sphere.model = "progs/sphere.mdl"; sphere.movement = "flymissile"; sphere.solid = "none";
    sphere.angularVelocity = { x: 40, y: 40, z: 40 }; sphere.delay = Math.fround(game.time + 30);
    game.setOrigin(sphere, game.body(item).origin); game.schedule(sphere, 0.1, game.named.action(sphere, "rogue:sphere-think")); return true;
  }
  private sphereThink(game: Q1Foundation, sphere: Q1Actor): undefined {
    const player = sphere.owner === null ? null : game.player(sphere.owner), body = sphere.owner === null ? null : game.host.bodies.read(sphere.owner);
    if (player === null || body === null) return game.remove(sphere);
    if (sphere.attackFinished < game.time) { game.sound(sphere, "sphere/sphere.wav", "voice"); sphere.attackFinished = Math.fround(game.time + 4); }
    if (game.time > sphere.delay || game.health(player.actor.id) < 1) {
      game.host.inventory.consume(player.actor, "rogue:artifact/vengeance", 1);
      if (game.time > sphere.delay) { missionMessage(game, player.actor.id, "$qc_vengeance_lost"); return game.remove(sphere); }
      let killer = missionReference(game, this.state(player), "rogue:killer");
      if (killer !== null && !game.isPlayer(killer)) killer = game.entity(killer)?.owner ?? null;
      if (killer === null || !game.isPlayer(killer)) return game.remove(sphere);
      setMissionReference(sphere, "rogue:enemy", killer); return this.sphereAttack(game, sphere);
    }
    const center = vadd(body.origin, { x: 0, y: 0, z: 48 }), source = game.body(sphere).origin;
    if (sphere.count < 0 || sphere.count > 3) sphere.count = 0;
    const trace = game.host.trace({ start: source, end: center, bounds: POINT, ignore: null, monsters: false });
    if (trace.fraction < 1) { game.setOrigin(sphere, center); sphere.count++; }
    else {
      const offset = sphere.count === 0 ? { x: 16, y: 0, z: 0 } : sphere.count === 1 ? { x: 0, y: 16, z: 0 } : sphere.count === 2 ? { x: -16, y: 0, z: 0 } : { x: 0, y: -16, z: 0 };
      const direction = vsub(vadd(center, offset), source), distance = length(direction);
      if (distance < 8) sphere.count++; else moveMissile(game, sphere, vscale(normalize(direction), distance < 50 ? 150 : 500));
    }
    return game.schedule(sphere, 0.1, game.named.action(sphere, "rogue:sphere-think"));
  }
  private sphereAttack(game: Q1Foundation, sphere: Q1Actor): undefined {
    sphere.solid = "trigger"; sphere.touch = game.named.touch(sphere, "rogue:sphere-impact"); game.link(sphere);
    const target = missionReference(game, sphere, "rogue:enemy"), body = target === null ? null : game.host.bodies.read(target);
    if (target === null || body === null || game.health(target) < 1) { missionMessage(game, sphere.owner, "$qc_you_are_denied_vengeance"); return game.remove(sphere); }
    moveMissile(game, sphere, vscale(normalize(vsub(vadd(body.origin, { x: 0, y: 0, z: 22 }), game.body(sphere).origin)), 650));
    return game.schedule(sphere, 0.1, game.named.action(sphere, "rogue:sphere-attack"));
  }
}
