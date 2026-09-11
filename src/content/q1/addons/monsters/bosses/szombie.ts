/* quakec_mg3/monsters/mg3_shub_zombie.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, ZERO, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import { throwGib } from "../../../base/projectiles.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import type { Q1AddonContext } from "../../context.ts";
import { frames } from "./frames/szombie.ts";
import { registerBossControllers } from "./registry.ts";

const prefix = "mg3:szombie";
const spec: MonsterSpecies = { species: "zombie", classnames: ["monster_szombie"], model: "zombie", head: null, health: 60, gibHealth: -Infinity, gibs: [],
  bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, stand: "szombie_stand1", walk: "szombie_walk1", run: "szombie_run1", sight: "", missile: null, melee: true, movement: "walk" };
const actions = new Map<string, (monster: BaseMonster) => undefined>();
for (const frame of frames.values()) for (const operation of frame.operations) if (operation.kind === "action") actions.set(operation.name, monster => {
  if (!(monster instanceof Q1ShubZombie)) throw new Error("Shub zombie callback received another controller"); return monster.action(operation.name);
});

export class Q1ShubZombie extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) { super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames, actions }); }
  override spawn(): undefined {
    const { game, entity, context } = this; game.host.combat.setHealth(entity.actor, 60); entity.maxHealth = 60; entity.classname = "monster_szombie"; this.inPain = 2;
    entity.solid = "none"; entity.movement = "step"; entity.model = "progs/zombie.mdl"; game.setBounds(entity, spec.bounds);
    const owner = game.entity(entity.owner); game.setOrigin(entity, owner === null ? ZERO : game.body(owner).origin);
    entity.damageable = true; entity.aimedDamage = true; entity.idealYaw = game.body(entity).angles.y; context.setVector(entity, "view_ofs", { x: 0, y: 0, z: 25 });
    game.host.combat.setTraits(entity.actor, { team: "q1:monsters" }); entity.movementFlags |= 32; entity.yawSpeed ||= 20; context.setNumber(entity, "combat_style", 2);
    entity.pain = game.named.pain(entity, `${prefix}:monster_pain`); entity.die = game.named.die(entity, `${prefix}:monster_die`);
    game.totalMonsters++; game.host.emit({ kind: "monster-total", total: game.totalMonsters }); this.enemy = game.host.players()[0] ?? null;
    entity.frame = 174; this.currentFrame = "szombie_paine10"; this.nextFrame = "szombie_paine11"; return this.delay(2);
  }
  override play(name: string): undefined { return super.play(name.startsWith("zombie_") ? `szombie_${name.slice(7)}` : name); }
  override meleeAttack(): undefined { const r = this.game.host.random(); return this.play(r < 0.3 ? "szombie_atta1" : r < 0.6 ? "szombie_attb1" : "szombie_attc1"); }
  override die(attacker: ActorId | null): undefined {
    if (this.countedDeath) return undefined; const { game, entity } = this; this.enemy = attacker; entity.damageable = false; entity.touch = null; this.countKill();
    game.sound(entity, "zombie/z_gib.wav"); for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, this.origin, model, game.health(entity.actor.id)); return game.remove(entity);
  }
  action(name: string): undefined {
    const { game, entity } = this;
    switch (name) {
      case "szombie:szombie_stand1": return this.ai("stand", 0);
      case "szombie:szombie_walk1": return this.ai("walk", 0);
      case "szombie:szombie_walk2": return this.ai("walk", 2);
      case "szombie:szombie_walk3": return this.ai("walk", 3);
      case "szombie:szombie_walk5": return this.ai("walk", 1);
      case "szombie:szombie_walk19": this.ai("walk", 0); if (game.host.random() < 0.2) game.sound(entity, "zombie/z_idle.wav", "voice", 2); return undefined;
      case "szombie:szombie_run1": this.ai("run", 1); this.inPain = 0; return undefined;
      case "szombie:szombie_run2": return this.ai("run", 1);
      case "szombie:szombie_run3": return this.ai("run", 0);
      case "szombie:szombie_run5": return this.ai("run", 2);
      case "szombie:szombie_run6": return this.ai("run", 3);
      case "szombie:szombie_run7": return this.ai("run", 4);
      case "szombie:szombie_run15": return this.ai("run", 6);
      case "szombie:szombie_run16": return this.ai("run", 7);
      case "szombie:szombie_run18": this.ai("run", 8); if (game.host.random() < 0.2) game.sound(entity, "zombie/z_idle.wav", "voice", 2); if (game.host.random() > 0.8) game.sound(entity, "zombie/z_idle1.wav", "voice", 2); return undefined;
      case "szombie:szombie_atta1": return this.face();
      case "szombie:szombie_atta13": this.face(); return this.grenade({ x: -10, y: -22, z: 30 });
      case "szombie:szombie_attb14": this.face(); return this.grenade({ x: -10, y: -24, z: 29 });
      case "szombie:szombie_attc12": this.face(); return this.grenade({ x: -12, y: -19, z: 29 });
      case "szombie:szombie_paina1": return game.sound(entity, "zombie/z_pain.wav");
      case "szombie:szombie_painb1": return game.sound(entity, "zombie/z_pain1.wav");
      case "szombie:szombie_paina2": return this.ai("painforward", 3);
      case "szombie:szombie_paina3": return this.ai("painforward", 1);
      case "szombie:szombie_paina4": return this.ai("pain", 1);
      case "szombie:szombie_paina5": return this.ai("pain", 3);
      case "szombie:szombie_painb2": return this.ai("pain", 2);
      case "szombie:szombie_painb3": return this.ai("pain", 8);
      case "szombie:szombie_painb4": return this.ai("pain", 6);
      case "szombie:szombie_painb9": return game.sound(entity, "zombie/z_fall.wav", "body");
      case "szombie:szombie_paine1": game.sound(entity, "zombie/z_pain.wav"); game.host.combat.setHealth(entity.actor, 60); return undefined;
      case "szombie:szombie_paine3": return this.ai("pain", 5);
      case "szombie:szombie_paine10": game.sound(entity, "zombie/z_fall.wav", "body"); entity.solid = "none"; return game.link(entity);
      case "szombie:szombie_paine11": this.delay(entity.nextThink - game.time + 5); game.host.combat.setHealth(entity.actor, 60); return undefined;
      case "szombie:szombie_paine12":
        game.host.combat.setHealth(entity.actor, 60); game.sound(entity, "zombie/z_idle.wav", "voice", 2); entity.solid = "slidebox";
        if (!game.host.walkMove(entity.actor, 0, 0)) { this.nextFrame = "szombie_paine11"; entity.solid = "none"; } return game.link(entity);
      case "szombie:szombie_paine25": return this.ai("painforward", 5);
      default: throw new Error(`Unknown Shub zombie action ${name}`);
    }
  }
  private grenade(offset: Vec3): undefined {
    const { game, entity } = this; game.sound(entity, "zombie/z_shot1.wav", "weapon"); const missile = game.create("szombie_grenade"); missile.classname = "";
    missile.owner = entity.actor.id; missile.movement = "bounce"; missile.solid = "bbox";
    const basis = game.basis, origin = vadd(vadd(vadd(this.origin, vscale(basis.forward, offset.x)), vscale(basis.right, offset.y)), vscale(basis.up, offset.z - 24));
    game.makeVectors(game.body(entity).angles); const velocity = vscale(normalize(vsub(this.target ?? ZERO, origin)), 600);
    game.setBody(missile, { origin, velocity: { ...velocity, z: 200 }, bounds: POINT }); missile.angularVelocity = { x: 3000, y: 1000, z: 2000 }; missile.model = "progs/zom_gib.mdl";
    missile.touch = game.named.touch(missile, `${prefix}:grenade_touch`); game.schedule(missile, 2.5, game.named.action(missile, "SUB_Remove")); return game.link(missile);
  }
}

export function spawnShubZombie(context: Q1AddonContext): Q1Actor | null {
  const { game } = context, all = [...game.entities.values()]; if (all.filter(entity => entity.classname === "monster_szombie").length > 32) return null;
  const spawns = all.filter(entity => entity.classname === "info_szombie_spawn"), count = spawns.filter(entity => entity.wait !== 0 && entity.wait < game.time).length;
  if (count === 0) return null;
  // Native selection counts eligible points, then indexes the original list without filtering.
  const point = spawns[Math.floor(game.host.random() * (count - 1) + 0.5)]; if (point === undefined) throw new Error("Missing source zombie spawn"); point.wait = game.time + 8;
  const zombie = game.create("monster_szombie"); zombie.owner = point.actor.id; game.spawnEntity(zombie); return zombie;
}
export function spawnHomingFlame(context: Q1AddonContext, source: Q1Actor): Q1Actor {
  const { game } = context, flame = game.create("homing_flame"); flame.classname = ""; flame.solid = "bbox"; flame.movement = "flymissile"; flame.model = "progs/flame2.mdl"; flame.effects = 64;
  const enemy = source.monster?.enemy ?? source.references.get("enemy") ?? null; flame.references.set("enemy", game.isPlayer(enemy) ? enemy : game.host.players()[0] ?? null);
  const target = flame.references.get("enemy") ?? null, origin = vadd(game.body(source).origin, { x: 0, y: 0, z: 4 }); flame.speed = 400;
  game.setBody(flame, { origin, velocity: vscale(normalize(vsub(target === null ? ZERO : game.host.bodies.read(target)?.origin ?? ZERO, origin)), 400), bounds: POINT });
  flame.projectile = "spike"; flame.touch = game.named.touch(flame, "projectile_touch"); context.setNumber(flame, "waitmin", game.time);
  game.schedule(flame, 0.1, game.named.action(flame, `${prefix}:homing_flame_think`)); game.link(flame); game.remove(source); return flame;
}
export function registerShubZombie(context: Q1AddonContext): undefined {
  const { game } = context; registerBossControllers(context, prefix, "monster_szombie", entity => new Q1ShubZombie(context, entity));
  game.registerSpawn("info_szombie_spawn", (_game, entity) => { entity.wait = -1; return undefined; });
  game.named.register(`${prefix}:grenade_touch`, { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    const classname = game.host.classname(other); if (classname === "monster_oldone_new" || classname === "oldnew_child") return game.remove(entity);
    if (game.host.combat.read(other)?.canTakeDamage === true) { game.damage(other, entity.actor.id, entity.owner, 10); game.sound(entity, "zombie/z_hit.wav", "weapon"); return game.remove(entity); }
    game.sound(entity, "zombie/z_miss.wav", "weapon"); game.setBody(entity, { velocity: ZERO }); entity.angularVelocity = ZERO; entity.touch = game.named.touch(entity, "SUB_Remove"); return undefined;
  } });
  game.named.register(`${prefix}:homing_flame_think`, { action: (_game, entity) => {
    const origin = game.body(entity).origin;
    if (entity.number("waitmin") + 3 < game.time) { context.services.emit({ kind: "colored-explosion", origin, colorStart: 244, colorLength: 3 }); game.radiusDamage(entity.actor.id, entity.actor.id, 100, game.world?.actor.id ?? null, null); return game.remove(entity); }
    entity.speed = Math.max(0, entity.speed - 10); const enemy = entity.references.get("enemy") ?? null, direction = normalize(vsub(enemy === null ? ZERO : game.host.bodies.read(enemy)?.origin ?? ZERO, origin));
    game.setBody(entity, { velocity: vscale(vadd(vscale(direction, 0.3), vscale(normalize(game.body(entity).velocity), 0.7)), entity.speed) }); return game.schedule(entity, 0.1, game.named.action(entity, `${prefix}:homing_flame_think`));
  } }); return undefined;
}
