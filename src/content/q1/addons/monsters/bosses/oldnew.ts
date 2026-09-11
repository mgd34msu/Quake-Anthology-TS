/* quakec_mg3/monsters/mg3_oldone_new.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, vadd, vscale } from "../../../foundation/types.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import type { Q1AddonContext } from "../../context.ts";
import { frames } from "./frames/oldnew.ts";
import { registerBossControllers } from "./registry.ts";
import { painLightning } from "./effects.ts";
import { spawnShubZombie } from "./szombie.ts";
import { autoGun, oldnewPrefix, registerOldnewProjectiles, spawnSphereChunkManager, spawnSphereManager } from "./oldnew-projectiles.ts";
import { cleanupOldnew, registerOldnewChildren, spawnBlaster, spawnEye, spawnSpammer, spawnSwiper, spawnVortex } from "./oldnew-children.ts";
import { spherePoint } from "./sphere-points.ts";

const prefix = "mg3:oldnew";
const spec: MonsterSpecies = { species: "oldone", classnames: ["monster_oldone_new"], model: "oldone", head: null, health: 12000, gibHealth: -Infinity, gibs: [],
  bounds: { min: { x: -128, y: -128, z: -24 }, max: { x: 128, y: 128, z: 256 } }, stand: "oldnew_idle1", walk: "oldnew_idle1", run: "oldnew_walk1", sight: "", missile: null, melee: false, movement: "walk" };
const actions = new Map<string, (monster: BaseMonster) => undefined>();
for (const frame of frames.values()) for (const operation of frame.operations) if (operation.kind === "action") actions.set(operation.name, monster => {
  if (!(monster instanceof Q1Oldnew)) throw new Error("Oldone callback received another controller"); return monster.action(operation.name);
});

export class Q1Oldnew extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) { super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames, actions }); }
  override spawn(): undefined {
    const { game, entity, context } = this; if (game.options.deathmatch !== 0) return game.remove(entity);
    entity.solid = "slidebox"; entity.movement = "step"; entity.model = "progs/oldone.mdl";
    game.setBounds(entity, (entity.spawnflags & 128) !== 0 ? { min: { x: 1, y: 1, z: -24 }, max: { x: 1, y: 1, z: 0 } } : spec.bounds);
    game.host.combat.setHealth(entity.actor, 12000); entity.maxHealth = 12000; entity.damageable = true; entity.aimedDamage = true; entity.movementFlags = 32;
    game.host.combat.setTraits(entity.actor, { team: "q1:monsters" }); context.setVector(entity, "view_ofs", { x: 0, y: 0, z: 24 });
    entity.pain = game.named.pain(entity, `${prefix}:monster_pain`); entity.die = game.named.die(entity, `${prefix}:monster_die`); entity.use = game.named.use(entity, `${prefix}:monster_use`);
    entity.yawSpeed = 10; entity.idealYaw = game.body(entity).angles.y; game.totalMonsters++; game.host.emit({ kind: "monster-total", total: game.totalMonsters }); this.nextFrame = spec.stand; return this.delay(0.1);
  }
  override pain(attacker: ActorId | null, _damage: number): undefined {
    this.retaliate(attacker); const { game, entity, context } = this; if (entity.number("boss_immune") !== 0) return undefined;
    let trigger = false;
    if (entity.number("boss_phase") === 0) { trigger = true; context.setNumber(entity, "boss_phase", 1); }
    if (entity.number("boss_phase") === 1 && game.health(entity.actor.id) < entity.maxHealth * 0.75) { trigger = true; context.setNumber(entity, "boss_phase", 2); spawnEye(context, entity); this.wave("wave1"); }
    if (entity.number("boss_phase") === 2 && game.health(entity.actor.id) < entity.maxHealth * 0.5) { trigger = true; context.setNumber(entity, "boss_phase", 3); this.wave("wave2"); }
    if (entity.number("boss_phase") === 3 && game.health(entity.actor.id) < entity.maxHealth * 0.25) { trigger = true; context.setNumber(entity, "boss_phase", 4); this.wave("wave2"); }
    if (!trigger) return undefined;
    context.setNumber(entity, "boss_immune", 1); game.sound(entity, "orb/orb_pain.wav"); this.state.painFinished = game.time + 2.1; return this.play("oldnew_thrash1");
  }
  private wave(field: string): undefined { const target = this.entity.text(field); if (target === "") return undefined; const previous = this.entity.target; this.entity.target = target; this.game.useTargets(this.entity, this.entity.activator); this.entity.target = previous; return undefined; }
  override die(attacker: ActorId | null): undefined {
    if (this.countedDeath) return undefined; const { game, entity, context } = this; this.enemy = attacker; entity.damageable = false; entity.touch = null; this.countKill();
    context.setNumber(entity, "boss_immune", 1); context.setNumber(entity, "cnt", 0); this.play("oldnew_death1"); cleanupOldnew(context); spawnSphereManager(context, entity, game.options.skill > 2 ? entity.number("boss_phase") : 1); return undefined;
  }
  attack(): undefined {
    const { entity, context } = this; if (entity.number("boss_immune") !== 0) return undefined; const phase = entity.number("boss_phase");
    if (entity.number("cnt") % 3 !== 0) spawnSphereChunkManager(context, entity, phase <= 3 ? 1 : 2);
    else if (phase === 0) spawnSphereChunkManager(context, entity, 1);
    else {
      if (phase === 1) { if (entity.count === 0) spawnSpammer(context, entity); else if (entity.count === 1) spawnSwiper(context, entity); }
      else if (phase === 2) { if (entity.count === 0) spawnVortex(context, entity); else if (entity.count === 1) spawnSwiper(context, entity); else if (entity.count === 2) spawnSpammer(context, entity); }
      else if (phase === 3) { if (entity.count === 0) spawnBlaster(context, entity); else if (entity.count >= 1 && entity.count <= 3) spawnSwiper(context, entity); }
      else if (phase >= 4) { if (entity.count === 0) spawnSpammer(context, entity); else if (entity.count === 1) spawnEye(context, entity); else if (entity.count === 2) spawnSwiper(context, entity); else if (entity.count === 3) spawnBlaster(context, entity); }
      entity.count++; if (entity.count > (phase === 1 ? 1 : phase === 2 ? 2 : 3)) entity.count = 0;
    }
    context.setNumber(entity, "cnt", entity.number("cnt") + 1); return undefined;
  }
  private autoGun(side: number, offset: number, count: number): undefined {
    const { game, entity, context } = this; if (entity.number("boss_immune") !== 0 || count > entity.number("boss_phase") + 2 || game.options.skill === 0 || count > game.options.skill + 1) return undefined;
    const basis = game.makeVectors(game.body(entity).angles); game.sound(entity, "weapons/spike2.wav", "weapon"); return autoGun(context, entity, vadd(vadd(this.origin, { x: 0, y: 0, z: 80 }), vscale(basis.right, side * 64)), offset);
  }
  action(name: string): undefined {
    const { game, entity, context } = this;
    switch (name) {
      case "oldnew:oldnew_idle1": return this.ai("stand", 0);
      case "oldnew:oldnew_walk1": this.face(); context.setNumber(entity, "boss_immune", 0); return undefined;
      case "oldnew:oldnew_walk2": return this.face();
      case "oldnew:oldnew_walk14": this.face(); return this.attack();
      case "oldnew:oldnew_walk21": this.face(); return this.autoGun(1, 0.05, 1);
      case "oldnew:oldnew_walk22": this.face(); return this.autoGun(1, 0, 2);
      case "oldnew:oldnew_walk23": this.face(); spawnShubZombie(context); return this.autoGun(1, -0.05, 3);
      case "oldnew:oldnew_walk24": this.face(); return this.autoGun(1, -0.1, 4);
      case "oldnew:oldnew_walk25": this.face(); return this.autoGun(1, -0.15, 5);
      case "oldnew:oldnew_walk36": this.face(); return this.autoGun(-1, -0.05, 1);
      case "oldnew:oldnew_walk37": this.face(); return this.autoGun(-1, 0, 2);
      case "oldnew:oldnew_walk38": this.face(); return this.autoGun(-1, 0.05, 3);
      case "oldnew:oldnew_walk39": this.face(); return this.autoGun(-1, 0.1, 4);
      case "oldnew:oldnew_walk40": this.face(); return this.autoGun(-1, 0.15, 5);
      case "oldnew:oldnew_walk45": this.face(); spawnShubZombie(context); return undefined;
      case "oldnew:oldnew_thrash4": return painLightning(context, entity, { x: 0, y: 0, z: 100 });
      case "oldnew:oldnew_thrash14": context.setNumber(entity, "boss_immune", 1); spawnSphereManager(context, entity, game.options.skill > 2 ? entity.number("boss_phase") : 1); return undefined;
      case "oldnew:oldnew_thrash15": context.setNumber(entity, "boss_immune", 0); return undefined;
      case "oldnew:oldnew_death1": return game.sound(entity, "boss2/death.wav");
      case "oldnew:oldnew_death15": context.setNumber(entity, "cnt", entity.number("cnt") + 1); if (entity.number("cnt") !== 3) this.nextFrame = "oldnew_death1"; return undefined;
      case "oldnew:oldnew_death16": return game.host.emit({ kind: "lightstyle", style: 0, pattern: "g" });
      case "oldnew:oldnew_death17": return game.host.emit({ kind: "lightstyle", style: 0, pattern: "c" });
      case "oldnew:oldnew_death18": return game.host.emit({ kind: "lightstyle", style: 0, pattern: "b" });
      case "oldnew:oldnew_death19": return game.host.emit({ kind: "lightstyle", style: 0, pattern: "a" });
      case "oldnew:oldnew_death20": return this.finish();
      default: throw new Error(`Unknown oldone action ${name}`);
    }
  }
  finish(): undefined {
    const { game, entity, context } = this; game.sound(entity, "boss2/pop2.wav");
    const player = game.host.players()[0];
    if (!game.options.coop && (player === undefined || game.health(player) <= 0)) return this.play("oldnew_idle1");
    for (let i = 0; i < 100; i++) { const point = spherePoint(i); if (point.z > 0) throwGibVector(context, vadd(vadd(this.origin, vscale(point, 64)), { x: 0, y: 0, z: 48 }), point); }
    game.remove(entity); context.services.emit({ kind: "music", track: 3, loopTrack: 3 }); game.host.emit({ kind: "lightstyle", style: 0, pattern: "m" }); return oldnewCredits(context);
  }
}
export function throwGibVector(context: Q1AddonContext, origin: Vec3, direction: Vec3): Q1Actor {
  const { game } = context, gib = game.create("gib_vector"); gib.classname = ""; const choice = game.host.random(); gib.model = `progs/gib${choice < 0.3 ? 1 : choice < 0.6 ? 2 : 3}.mdl`;
  const speed = 800 + (game.host.random() * 2 - 1) * 200; game.setBody(gib, { origin, velocity: vscale(direction, speed), bounds: POINT }); gib.movement = "bounce"; gib.solid = "none";
  gib.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 }; context.setNumber(gib, "ltime", game.time); game.schedule(gib, 10 + game.host.random() * 10, game.named.action(gib, "SUB_Remove")); game.link(gib); return gib;
}
export function oldnewCredits(context: Q1AddonContext): undefined {
  context.game.world?.fields.set("addon.intermissiontext", "$map_dopa_endtext_final");
  // execute_changelevel overwrites oldnew_credits' provisional 10000000-second delay with the ordinary two-second wait.
  return context.base.levelRules.begin("start", null);
}
export function registerOldnew(context: Q1AddonContext): undefined {
  const { game } = context; registerOldnewProjectiles(context); registerOldnewChildren(context); registerBossControllers(context, prefix, "monster_oldone_new", entity => new Q1Oldnew(context, entity));
  game.named.register(oldnewPrefix + "oldnew_credits", { action: () => oldnewCredits(context) });
  game.registerDamageSourceEffects("mg3:oldone", { beforeHealth: request => { const entity = game.entity(request.target); return entity?.classname !== "monster_oldone_new" || entity.number("boss_immune") !== 1; } });
  return undefined;
}
