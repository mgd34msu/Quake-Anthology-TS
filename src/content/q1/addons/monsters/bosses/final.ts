/* quakec_mg3/monsters/boss_final.qc. Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { spawnTeleportFog } from "../../../foundation/spawns.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import { launchSpike, spawnMeatSpray } from "../../../base/projectiles.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import type { Q1AddonContext } from "../../context.ts";
import { BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED, BLOODY_NIGHTMARE_NEWGAME } from "../../campaign.ts";
import { frames } from "./frames/final.ts";
import { painLightning } from "./effects.ts";
import { spherePoint } from "./sphere-points.ts";
import { throwGibVector } from "./oldnew.ts";
import { registerBossControllers, requireBoss } from "./registry.ts";

const prefix = "mg3:final";
const spec: MonsterSpecies = { species: "boss", classnames: ["monster_boss_final"], model: "boss", head: null, health: 12000, gibHealth: -Infinity, gibs: [],
  bounds: { min: { x: -128, y: -128, z: -24 }, max: { x: 128, y: 128, z: 256 } }, stand: "boss_final_idle1", walk: "boss_final_idle1", run: "boss_final_missile1", sight: "", missile: "boss_final_missile1", melee: false, movement: "boss" };
const actions = new Map<string, (monster: BaseMonster) => undefined>();
for (const frame of frames.values()) for (const operation of frame.operations) if (operation.kind === "action") actions.set(operation.name, monster => {
  if (!(monster instanceof Q1FinalBoss)) throw new Error("Final boss callback received another source controller"); return monster.action(operation.name);
});
actions.set("boss_final_decide", monster => {
  if (!(monster instanceof Q1FinalBoss)) throw new Error("Final boss decision received another source controller"); return monster.play("boss_final_decide");
});
function later(context: Q1AddonContext, entity: Q1Actor, name: string, delay: number): undefined { return context.game.schedule(entity, delay, context.game.named.action(entity, `${prefix}:${name}`)); }
function randomSigned(context: Q1AddonContext): number { return Math.fround(2 * context.game.host.random() - 1); }
function spin(context: Q1AddonContext, shot: Q1Actor): undefined {
  shot.angularVelocity = { x: 300 * randomSigned(context), y: 300 * randomSigned(context), z: 300 * randomSigned(context) }; return undefined;
}
function rock(context: Q1AddonContext, owner: ActorId | null, origin: Vec3, direction: Vec3, model = "sphere"): Q1Actor {
  const shot = launchSpike(context.game, owner, origin, direction); shot.classname = "rock"; shot.model = `progs/rogue/${model}.mdl`; shot.touch = context.game.named.touch(shot, `${prefix}:T_RockTouch2`); context.game.setBounds(shot, POINT); return shot;
}
export class Q1FinalBoss extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) { super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames, actions }); }
  override spawn(): undefined {
    const { game, entity, context } = this;
    if (game.options.deathmatch !== 0) return game.remove(entity);
    entity.classname = "monster_boss"; context.setNumber(entity, "boss_immune", 1); entity.movementFlags = 32; game.host.combat.setTraits(entity.actor, { team: "q1:monsters" });
    game.totalMonsters++; context.services.emit({ kind: "monster-count", count: game.totalMonsters });
    context.setNumber(entity, "frags", 0); entity.use = game.named.use(entity, `${prefix}:boss_awake`); return undefined;
  }
  override awake(activator: ActorId | null): undefined {
    const { game, entity } = this;
    entity.solid = "slidebox"; entity.movement = "step"; entity.damageable = true; entity.aimedDamage = true; entity.model = "progs/boss.mdl";
    this.state.attackFinished = game.time + 3; game.setBounds(entity, spec.bounds); this.enemy = activator;
    entity.die = game.named.die(entity, `${prefix}:monster_die`); entity.pain = game.named.pain(entity, `${prefix}:monster_pain`);
    game.host.combat.setHealth(entity.actor, 12000); entity.maxHealth = 12000; entity.use = game.named.use(entity, `${prefix}:monster_use`);
    entity.yawSpeed = 20; game.effect("lava-splash", this.origin); return this.play("boss_final_rise1");
  }
  override play(name: string): undefined {
    if (name === "boss_final_decide") return super.play(this.entity.wait > 0 && this.game.host.random() < 0.3 ? "boss_final_mg1" : "boss_final_missile1");
    return super.play(name);
  }
  bossFace(): undefined {
    const { game } = this;
    if ((this.enemy === null ? 0 : game.health(this.enemy)) <= 0 || game.host.random() < 0.02) {
      const players = [...game.host.players()].sort((a, b) => a.slot - b.slot);
      this.enemy = players.find(actor => actor.slot > (this.enemy?.slot ?? 0)) ?? players[0] ?? null;
    }
    return (this.enemy === null ? 0 : game.health(this.enemy)) > 0 ? this.face() : undefined;
  }
  override pain(_attacker: ActorId | null, _damage: number): undefined {
    const { game, entity, context } = this;
    if (this.state.attackFinished > game.time || this.state.painFinished > game.time || entity.number("boss_immune") !== 0) return undefined;
    let event = "", frags = entity.number("frags");
    if (frags === 0) { event = "boss_final_shocka1"; frags = 1; }
    for (const [step, fraction, frame] of [[1, 0.83, "boss_final_shocka1"], [2, 0.66, "boss_final_shocka1"], [3, 0.5, "boss_final_shockb1"], [4, 0.33, "boss_final_shocka1"], [5, 0.16, "boss_final_shockb1"]] satisfies readonly (readonly [number, number, string])[]) {
      if (frags === step && game.health(entity.actor.id) < Math.fround(entity.maxHealth * Math.fround(fraction))) { event = frame; frags++; }
    }
    context.setNumber(entity, "frags", frags);
    if (event === "") return undefined;
    context.setNumber(entity, "boss_immune", 1); game.sound(entity, "boss1/pain.wav", "weapon"); this.state.painFinished = game.time + 3; return this.play(event);
  }
  override die(attacker: ActorId | null): undefined {
    this.enemy = attacker; this.entity.damageable = false; this.entity.touch = null; this.entity.movementFlags &= ~3;
    this.game.useTargets(this.entity, this.enemy); return this.play("boss_final_death1");
  }
  action(name: string): undefined {
    const { game, entity, context } = this;
    if (name.startsWith("boss_final_idle")) { this.bossFace(); return name === "boss_final_idle31" ? this.play(this.enemy !== null ? "boss_final_missile1" : "boss_final_idle1") : undefined; }
    if (name.startsWith("boss_final_shock")) return name.endsWith("10") ? this.upgrade() : painLightning(context, entity, { x: 0, y: 0, z: 100 });
    switch (name) {
      case "boss_final_rise1": return game.sound(entity, "boss1/out1.wav", "weapon");
      case "boss_final_rise2": return game.sound(entity, "boss1/sight1.wav", "voice");
      case "boss_final_mg7": {
        const shells = Math.fround(Math.fround((game.options.skill + 3) / 6) * 30) + Math.floor(randomSigned(context) * 10 + 0.5);
        context.setNumber(entity, "ammo_shells", shells); context.setNumber(entity, "ammo_nails", shells);
        if (game.options.skill > 0) this.state.attackFinished = game.time + 5; return this.bossFace();
      }
      case "boss_final_mg8": {
        const nails = entity.number("ammo_nails"), wide = nails % 2 === 0; let spread = Math.fround(1 - Math.fround(nails / entity.number("ammo_shells"))); spread = Math.fround(spread * spread);
        this.blast({ x: 270, y: 60, z: 210 }, wide ? spread : spread * 0.5, wide);
        if (nails !== 0) this.nextFrame = "boss_final_mg8"; context.setNumber(entity, "ammo_nails", nails - 1); return this.bossFace();
      }
      case "boss_final_missile1": context.setNumber(entity, "boss_immune", 0); return this.bossFace();
      case "boss_final_missile10": return this.missile({ x: 200, y: 100, z: 60 });
      case "boss_final_missile21": return this.missile({ x: 200, y: -100, z: 60 });
      case "boss_final_death1":
        game.sound(entity, "boss1/death.wav", "voice");
        for (const delay of [1, 3, 5]) { const timer = game.create("circle_thinker"); timer.classname = ""; game.setOrigin(timer, vadd(this.origin, { x: 0, y: 0, z: 60 })); later(context, timer, "circle_think", delay); } return undefined;
      case "boss_final_death9": game.sound(entity, "boss1/out1.wav", "body"); return game.effect("lava-splash", this.origin);
      case "boss_final_death10": {
        game.killedMonsters++; game.host.emit({ kind: "monster-killed", actor: entity.actor.id, total: game.totalMonsters, found: game.killedMonsters });
        context.setNumber(entity, "frags", entity.number("frags") + 1);
        while (entity.number("frags") < 5) { game.useTargets(entity, entity.activator); context.setNumber(entity, "frags", entity.number("frags") + 1); }
        game.sound(entity, "boss2/pop2.wav", "voice");
        for (let i = 0; i < 100; i++) { const point = spherePoint(i); if (point.z > 0) throwGibVector(context, vadd(vadd(this.origin, vscale(point, 64)), { x: 0, y: 0, z: 48 }), point); }
        const timer = game.create("boss_end_timer"); timer.classname = ""; game.schedule(timer, 8, game.named.action(timer, "mg3:bosses:boss_end")); return game.remove(entity);
      }
      default:
        if (name.startsWith("boss_final_missile") || name.startsWith("boss_final_mg")) return this.bossFace();
        throw new Error(`Unknown final boss action ${name}`);
    }
  }
  upgrade(): undefined {
    const { entity, game, context } = this; entity.wait++; context.setNumber(entity, "boss_immune", 0);
    const target = entity.wait === 2 ? entity.text("wave1") : entity.wait === 3 ? entity.text("tele_target") : entity.wait === 4 ? entity.text("wave2") : entity.wait === 5 ? entity.text("wave3") : null;
    if (entity.wait === 3) { entity.frame = 0; game.schedule(entity, 0, game.named.action(entity, "SUB_Null")); context.setNumber(entity, "boss_immune", 1); }
    if (target !== null) { const original = entity.target; entity.target = target; game.useTargets(entity, entity.activator); entity.target = original; }
    if (entity.wait === 3) bossTeleport(context, false);
    if (entity.wait === 5) {
      const spiral = game.create("spiral"); spiral.classname = ""; spiral.owner = entity.actor.id;
      game.setBody(spiral, { origin: vadd(this.origin, { x: 0, y: 0, z: 60 }), angles: velocityAngles(normalize({ ...vsub(this.target ?? ZERO, this.origin), z: 0 })) });
      spiral.delay = game.options.skill <= 2 ? 0.2 : 0.15; spiral.count = 50; later(context, spiral, "spiral_single", spiral.delay);
    } return undefined;
  }
  muzzle(offset: Vec3, angles: Vec3): Vec3 {
    const basis = this.game.makeVectors(angles); return vadd(vadd(vadd(this.origin, vscale(basis.forward, offset.x)), vscale(basis.right, offset.y)), { x: 0, y: 0, z: offset.z });
  }
  missile(offset: Vec3): undefined {
    const { game, entity } = this;
    if ((entity.spawnflags & 2) !== 0) { game.host.random(); return this.line(offset); }
    const origin = this.muzzle(offset, velocityAngles(vsub(this.target ?? ZERO, this.origin))), direction = normalize(vsub(this.target ?? ZERO, origin));
    const shot = launchSpike(game, entity.actor.id, origin, direction); shot.model = "progs/lavaball.mdl"; shot.projectile = "rocket"; shot.touch = game.named.touch(shot, "projectile_touch"); shot.angularVelocity = { x: 200, y: 100, z: 300 }; game.setBody(shot, { bounds: POINT, velocity: vscale(direction, 300) }); game.sound(entity, "boss1/throw.wav", "weapon");
    return (this.enemy === null ? 0 : game.health(this.enemy)) <= 0 ? this.play("boss_final_idle1") : undefined;
  }
  meleeCheck(): undefined {
    const { game, entity, context } = this;
    if (this.distance > 300 || this.enemy === null || !game.canDamage(this.enemy, entity.actor.id)) return undefined;
    game.damage(this.enemy, entity.actor.id, entity.actor.id, (game.host.random() + game.host.random() + game.host.random()) * 40);
    game.sound(entity, "shambler/smack.wav", "voice");
    for (let i = 0; i < 2; i++) spawnMeatSpray(game, entity, vadd(this.origin, vscale(game.basis.forward, 100)), vscale(game.basis.right, randomSigned(context) * 100));
    return undefined;
  }
  missileSpawner(offset: Vec3): undefined {
    const { game, entity } = this, origin = this.muzzle(offset, velocityAngles(vsub(this.target ?? ZERO, this.origin)));
    const shot = launchSpike(game, entity.actor.id, origin, ZERO); shot.model = "progs/lavaball.mdl"; shot.projectile = "rocket"; shot.touch = game.named.touch(shot, "projectile_touch"); shot.angularVelocity = { x: 200, y: 100, z: 300 };
    game.setBody(shot, { bounds: POINT, velocity: ZERO }); game.sound(entity, "boss1/throw.wav", "weapon");
    return this.enemy === null || game.health(this.enemy) <= 0 ? this.play("boss_final_idle1") : undefined;
  }
  blast(offset: Vec3, spread: number, effect: boolean): undefined {
    const { game, entity, context } = this, speed = game.options.skill > 2 ? 500 : game.options.skill > 0 ? 450 : 400;
    const width = Math.fround(0.15 + Math.fround(0.2 * Math.abs(spread))), count = Math.floor(game.host.random() * 6 + 0.5);
    const angles = velocityAngles(vsub(this.target ?? ZERO, this.origin)), origin = this.muzzle(offset, angles), basis = game.makeVectors(angles);
    const time = Math.fround(length(vsub(this.target ?? ZERO, origin)) / speed), velocity = this.enemy === null ? ZERO : game.host.bodies.read(this.enemy)?.velocity ?? ZERO;
    const direction = normalize(vsub(vadd(this.target ?? ZERO, vscale({ ...velocity, z: 0 }, time / 4)), origin));
    if (effect) game.effect("explosion", origin);
    for (let remaining = count; remaining > 0; remaining--) {
      const aim = normalize(vadd(vadd(direction, vscale(basis.right, randomSigned(context) * width)), vscale(basis.up, randomSigned(context) * width)));
      const shot = rock(context, entity.actor.id, vadd(origin, vscale(aim, 8)), aim); game.setBody(shot, { velocity: vscale(aim, speed + randomSigned(context) * 100) }); spin(context, shot); if (remaining % 2 === 0) shot.effects |= 64;
    } return undefined;
  }
  line(offset: Vec3): undefined {
    const { game, entity, context } = this, count = game.options.skill === 0 ? 4 : game.options.skill === 1 ? 8 : game.options.skill === 3 ? 15 : 11;
    const origin = this.muzzle(offset, game.body(entity).angles), basis = game.makeVectors(game.body(entity).angles), direction = normalize({ ...vsub(this.target ?? ZERO, origin), z: 0 });
    game.effect("explosion", origin); const start = 4 / count * (offset.y < 0 ? 1 : -1), increment = 2 / count * (offset.y < 0 ? -1 : 1);
    for (let i = 0; i < count; i++) {
      bossRadiusDamage(context, entity, 10 * game.host.random() + 10);
      let aim = normalize(vadd(vadd(direction, vscale(basis.right, start)), vscale(vscale(basis.right, increment), i))); aim = normalize({ ...aim, z: 0 });
      const shot = rock(context, entity.actor.id, vadd(origin, vscale(aim, 8)), aim); let velocity = vscale(aim, 300 + randomSigned(context) * 100);
      if (game.host.random() > 0.5) velocity = { ...velocity, z: (game.host.random() + 1) * 8 };
      game.setBody(shot, { velocity }); spin(context, shot); if (i % 2 === 0) { context.setNumber(shot, "frags", 1); shot.effects |= 64; }
    } return undefined;
  }
}

function bossRadiusDamage(context: Q1AddonContext, source: Q1Actor, damage: number): undefined {
  const { game } = context, origin = game.body(source).origin;
  for (const observation of [...game.host.actors.observations()].reverse()) {
    const target = observation.id, body = game.host.bodies.read(target);
    if (sameActor(target, source.actor.id) || game.host.classname(target) === "monster_lava_man" || game.host.combat.read(target)?.canTakeDamage !== true || body === null) continue;
    const distance = length(vsub(origin, vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5))));
    if (distance > damage + 40) continue; const points = damage - 0.5 * distance;
    if (points > 0 && game.canDamage(target, source.actor.id)) game.damage(target, source.actor.id, source.actor.id, points);
  } return undefined;
}
export function bossTeleport(context: Q1AddonContext, variant: boolean): undefined {
  const { game } = context;
  if (variant) {
    const boss = [...game.entities.values()].find(entity => entity.classname === "monster_boss"), point = [...game.entities.values()].find(entity => entity.classname === "info_boss_teleport_boss");
    if (boss !== undefined && point !== undefined) { game.setOrigin(boss, game.body(point).origin); game.effect("lava-splash", game.body(boss).origin); later(context, boss, "boss_final_rise1", 0.1); }
  }
  const points = [...game.entities.values()].filter(entity => entity.classname === (variant ? "info_boss_teleport_second" : "info_boss_teleport_first")); for (const point of points) point.wait = 0;
  for (const player of game.host.players()) {
    const point = points.find(entity => entity.wait === 0); if (point === undefined) { context.services.emit({ kind: "developer-message", text: "ERROR: Could not find valid teleport destination!\n" }); break; }
    point.wait = 1; const origin = game.body(point).origin, angles = point.vector("mangle"), entity = game.entity(player), state = game.player(player);
    if (entity !== null) entity.movementFlags &= ~1;
    if (state !== null) state.viewAngles = angles;
    const owned = game.host.actors.resolveOwned(player), body = game.host.bodies.read(player);
    if (owned !== null && body !== null) { game.host.bodies.write(owned, { ...body, origin, angles, ground: null, velocity: { x: 0, y: 0, z: 300 } }); game.host.bodies.link(owned); }
    game.host.emit({ kind: "camera", player, origin, angles }); spawnTeleportFog(game, vadd(origin, vscale(game.makeVectors(angles).forward, 32)));
  } return undefined;
}
export function registerFinalBoss(context: Q1AddonContext): undefined {
  const { game } = context, bosses = registerBossControllers(context, prefix, "monster_boss_final", entity => new Q1FinalBoss(context, entity));
  game.registerDamageSourceEffects("mg3:final", {
    beforeHealth: request => {
      const entity = game.entity(request.target);
      return entity === null || !bosses.has(entity.actor) || (entity.spawnflags & 2) === 0 || entity.number("boss_immune") !== 1 && (request.attack.attacker === null || game.host.classname(request.attack.attacker) !== "monster_lava_man");
    },
    afterArmor: (request, take) => {
      const entity = game.entity(request.target), weapon = request.attack.attacker === null ? null : game.player(request.attack.attacker)?.weapon;
      return entity !== null && bosses.has(entity.actor) && (entity.spawnflags & 2) !== 0 && weapon !== "lightning" && weapon !== "mg3:laser" ? Math.fround(take * Math.fround(0.8)) : take;
    },
  });
  game.named.register(`${prefix}:boss_final_melee_check`, { action: (_game, entity) => requireBoss(bosses, entity).meleeCheck() });
  game.named.register(`${prefix}:boss_final_rise1`, { action: (_game, entity) => requireBoss(bosses, entity).play("boss_final_rise1") });
  for (const classname of ["info_boss_teleport_first", "info_boss_teleport_second", "info_boss_teleport_boss"]) game.registerSpawn(classname, (_game, entity) => {
    context.setVector(entity, "mangle", game.body(entity).angles); entity.model = "";
    return game.setBody(entity, { angles: ZERO, origin: vadd(game.body(entity).origin, { x: 0, y: 0, z: classname === "info_boss_teleport_boss" ? 0 : 27 }) });
  });
  game.named.register(`${prefix}:trigger_boss_teleport_use`, { use: (_game, entity) => bossTeleport(context, (entity.spawnflags & 1) !== 0) });
  game.registerSpawn("trigger_boss_teleport", (_game, entity) => { entity.use = game.named.use(entity, `${prefix}:trigger_boss_teleport_use`); return undefined; });
  game.named.register(`${prefix}:T_RockTouch2`, { touch: (_game, entity, other, normal) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    const target = game.entity(other), classname = game.host.classname(other);
    if (classname === "monster_orb" || classname === "monster_lava_man") return game.remove(entity);
    if (classname === entity.classname || target?.solid === "trigger") return undefined;
    if (game.host.contents(game.body(entity).origin) === "sky") return game.remove(entity);
    if (game.host.combat.read(other)?.canTakeDamage === true) {
      const direction = normalize(vadd(vadd(normalize(game.body(entity).velocity), vscale(game.basis.up, game.host.random() - 0.5)), vscale(game.basis.right, game.host.random() - 0.5)));
      const spray = vscale(vscale(vadd(direction, vscale(normal ?? ZERO, 2)), 200), 0.2);
      game.host.emit({ kind: "particles", origin: vadd(game.body(entity).origin, vscale(spray, 0.01)), direction: vscale(spray, 0.1), color: 73, count: 36 });
      game.damage(other, entity.actor.id, entity.owner, 18);
    }
    else if (entity.number("frags") !== 0) game.effect("knight-spike", game.body(entity).origin);
    return game.remove(entity);
  } });
  game.named.register(`${prefix}:Rock_Death`, { action: (_game, entity) => {
    for (const other of game.entities.values()) if (other.classname === "rock" && length(vsub(game.body(other).origin, game.body(entity).origin)) <= 96) later(context, other, "Rock_Death", 0.1);
    game.effect("explosion", game.body(entity).origin); return game.remove(entity);
  } });
  game.named.register(`${prefix}:spiral_single`, { action: (_game, entity) => {
    game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: 5, z: 0 }) }); game.makeVectors(game.body(entity).angles);
    if (game.options.skill < 2 && entity.count % 10 < 5) { later(context, entity, "spiral_single", entity.delay); entity.count--; return undefined; }
    for (let i = 3; i >= 0; i--) {
      const direction = game.makeVectors(vadd(game.body(entity).angles, { x: 0, y: 90 * i, z: 0 })).forward;
      const shot = rock(context, entity.owner, vadd(game.body(entity).origin, vscale(direction, 100)), direction, "plasma"); game.setBody(shot, { velocity: vscale(direction, 100) }); spin(context, shot); game.schedule(shot, 30, game.named.action(shot, "SUB_Remove"));
    }
    entity.count--; if (entity.owner === null || game.health(entity.owner) <= 0) return game.remove(entity); return later(context, entity, "spiral_single", entity.delay);
  } });
  game.named.register(`${prefix}:circle_think`, { action: (_game, entity) => {
    for (let remaining = 72; remaining > 0; remaining--) {
      const direction = game.makeVectors({ x: 0, y: (72 - remaining) * 5, z: 0 }).forward, shot = rock(context, entity.actor.id, game.body(entity).origin, direction);
      game.setBody(shot, { velocity: vscale(direction, 250 + randomSigned(context) * 100) }); spin(context, shot); game.schedule(shot, 20, game.named.action(shot, "SUB_Remove")); if (remaining % 4 === 0) shot.effects |= 8;
    } return game.remove(entity);
  } });
  game.named.register("mg3:bosses:boss_end", { action: () => bossEnd(context) }); return undefined;
}
function bossEnd(context: Q1AddonContext): undefined {
  const { game, base } = context;
  const first = game.host.players()[0];
  if (!game.options.coop && (first === undefined || game.health(first) <= 0)) return undefined;
  for (const actor of game.host.players()) {
    const player = game.player(actor); if (player === null) continue;
    for (const entry of game.host.inventory.entries(actor)) if (entry.item === "q1:ammo/shells" || entry.item === "q1:ammo/nails" || entry.item === "q1:ammo/cells" || entry.item === "q1:ammo/rockets") game.host.inventory.configure(player.actor, { ...entry, count: entry.item === "q1:ammo/shells" ? 25 : 0 });
    game.host.combat.setArmor(player.actor, { kind: "none" }); player.weapon = "shotgun";
  }
  const flags = base.campaign.readFlags(); let map = "start";
  if ((flags & BLOODY_NIGHTMARE_ACTIVE) !== 0) {
    if ((flags & BLOODY_NIGHTMARE_NEWGAME) !== 0) map = "boss2";
    else {
      map = "map1"; base.campaign.writeFlags(BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_DISCOVERED | BLOODY_NIGHTMARE_NEWGAME);
      game.world?.fields.set("mg3.finalNewGameTravel", "1");
      for (const actor of game.host.players()) for (const parm of ["parm10", "parm11", "parm12", "parm13", "parm14"]) context.setPlayerNumber(actor, parm, 0);
    }
  }
  game.world?.fields.set("addon.intermissiontext", "$mg3_qc_boss_finale"); return base.levelRules.begin(map, null);
}
