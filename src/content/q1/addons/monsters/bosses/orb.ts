/* quakec_mg3/monsters/mg3_orb.qc. GPL-2.0-or-later. */
import { Mg3Monster } from "../ai/index.ts";
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub, yawFor } from "../../../foundation/types.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import { launchSpike } from "../../../base/projectiles.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import type { Q1AddonContext } from "../../context.ts";
import { initMg3Monster, startMg3Monster, mg3MonsterActivator } from "../startup.ts";
import { frames } from "./frames/orb.ts";
import { registerBossControllers, requireBoss } from "./registry.ts";
import { painLightning } from "./effects.ts";

const prefix = "mg3:orb";
const spec: MonsterSpecies = { species: "wizard", classnames: ["monster_orb"], model: "teleporter_eye_blink", head: null, health: 300, gibHealth: -Infinity, gibs: [],
  bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "orb_stand1", walk: "orb_walk1", run: "orb_run1", sight: "", missile: "orb_fast1", melee: false, movement: "fly" };
const actions = new Map<string, (monster: BaseMonster) => undefined>();
for (const frame of frames.values()) for (const operation of frame.operations) if (operation.kind === "action") actions.set(operation.name, monster => {
  if (!(monster instanceof Q1Orb)) throw new Error("Orb callback received another controller"); return monster.action(operation.name);
});

export class Q1Orb extends Mg3Monster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) { super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames, actions }); }
  override spawn(): undefined {
    const { game, entity, context } = this; game.host.combat.setHealth(entity.actor, 300); entity.maxHealth = 300;
    entity.pain = game.named.pain(entity, `${prefix}:monster_pain`); entity.die = game.named.die(entity, `${prefix}:monster_die`); entity.pathEnd = game.named.action(entity, `${prefix}:monster_stand`);
    context.setNumber(entity, "combat_style", 1); return initMg3Monster(this, context, "progs/teleporter_eye_blink.mdl", 2, 2);
  }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined { return super.use(mg3MonsterActivator(this.game, activator)); }
  override pain(attacker: ActorId | null, damage: number): undefined {
    this.retaliate(attacker); const { game, entity } = this;
    if (this.state.painFinished > game.time || game.host.random() * 200 > damage) return undefined;
    game.sound(entity, "orb/orb_pain.wav"); this.state.painFinished = game.time + 8; return this.play("orb_pain1");
  }
  override die(attacker: ActorId | null): undefined {
    if (this.countedDeath) return undefined; this.enemy = attacker; this.entity.damageable = false; this.entity.touch = null; this.countKill(); return this.play("orb_death1");
  }
  override tryAttack(): boolean {
    const { game, entity } = this, range = game.world?.number("enemy_range") ?? 0;
    if (game.time < this.state.attackFinished || (game.world?.number("enemy_visible") ?? 0) === 0) return false;
    if (range === 3) { if (this.sliding || entity.attackState !== "straight") { this.sliding = false; entity.attackState = "straight"; this.play("wiz_run1"); } return false; }
    const target = this.enemy === null ? null : this.eye(this.enemy), origin = this.eye(); if (target === null || origin === null) return false;
    const trace = game.host.trace({ start: origin, end: target, bounds: POINT, ignore: entity.actor.id, monsters: true });
    if (trace.actor === null || this.enemy === null || !sameActor(trace.actor, this.enemy)) { if (this.sliding || entity.attackState !== "straight") { this.sliding = false; entity.attackState = "straight"; this.play("orb_run1"); } return false; }
    if (game.host.random() < (range === 0 ? 0.9 : range === 1 ? 0.6 : range === 2 ? 0.2 : 0)) { this.sliding = false; entity.attackState = "missile"; return true; }
    if (range === 2) { if (this.sliding || entity.attackState !== "straight") { this.sliding = false; entity.attackState = "straight"; this.play("orb_run1"); } }
    else if (!this.sliding) { entity.attackState = "straight"; this.sliding = true; this.play("orb_side1"); }
    return false;
  }
  private idleSound(): undefined {
    const { game, entity, context } = this;
    if (entity.number("waitmin") < game.time) { context.setNumber(entity, "waitmin", game.time + 15 + game.host.random() * 10); game.sound(entity, "boss2/sight.wav", "voice", 2); } return undefined;
  }
  action(name: string): undefined {
    const { game, entity, context } = this;
    switch (name) {
      case "orb:orb_stand1": return this.ai("stand", 0);
      case "orb:orb_walk1": this.ai("walk", 8); return this.idleSound();
      case "orb:orb_side1": this.face(); this.ai("run", 16); return this.idleSound();
      case "orb:orb_run1": this.ai("run", 16); return this.idleSound();
      case "orb:orb_fast1": context.setNumber(entity, "ammo_nails", 1 + Math.floor(game.host.random() * 3 + 0.5)); return this.face();
      case "orb:orb_fast3": this.delay(0.3); return this.face();
      case "orb:orb_fast4": this.face(); this.blast(); this.delay(0.2); context.setNumber(entity, "ammo_nails", entity.number("ammo_nails") - 1); if (entity.number("ammo_nails") !== 0) this.nextFrame = "orb_fast2"; return undefined;
      case "orb:orb_fast5":
        this.face(); this.attackFinished(2); entity.attackState = "straight";
        this.sliding = (game.world?.number("enemy_range") ?? 0) < 2 && (game.world?.number("enemy_visible") ?? 0) !== 0; this.nextFrame = this.sliding ? "orb_side1" : "orb_run1"; return undefined;
      case "orb:orb_pain1": context.setNumber(entity, "ammo_shells", 3); return this.delay(0.2);
      case "orb:orb_pain2": painLightning(context, entity, ZERO); this.delay(0.3); context.setNumber(entity, "ammo_shells", entity.number("ammo_shells") - 1); if (entity.number("ammo_shells") !== 0) this.nextFrame = "orb_pain2"; return undefined;
      case "orb:orb_death1":
        game.setBody(entity, { velocity: { x: -200 + 400 * game.host.random(), y: -200 + 400 * game.host.random(), z: 150 + 150 * game.host.random() }, ground: null });
        entity.movementFlags &= ~512; entity.solid = "bbox"; game.setBounds(entity, POINT); return game.sound(entity, "orb/orb_death.wav");
      case "orb:orb_death3": entity.touch = game.named.touch(entity, `${prefix}:death_touch`); return undefined;
      case "orb:orb_death4": return this.delay(9999);
      default: throw new Error(`Unknown orb action ${name}`);
    }
  }
  blast(): undefined {
    const { game, entity } = this, speed = game.options.skill > 2 ? 500 : game.options.skill > 0 ? 450 : 400, random = (): number => game.host.random() * 2 - 1;
    let count = 4 + Math.floor(game.host.random() * 2 + 0.5); const target = this.target ?? ZERO;
    const basis = game.makeVectors(velocityAngles(vsub(target, this.origin))), origin = vadd(this.origin, vscale(basis.forward, 15)), time = length(vsub(target, origin)) / speed;
    const targetVelocity = this.enemy === null ? ZERO : game.host.bodies.read(this.enemy)?.velocity ?? ZERO, projected = vadd(target, vscale({ ...targetVelocity, z: 0 }, time / 4)), direction = normalize(vsub(projected, origin));
    game.effect("explosion", origin);
    while (count > 0) {
      const aim = normalize(vadd(vadd(direction, vscale(game.basis.right, random() * 0.1)), vscale(game.basis.up, random() * 0.1)));
      const missile = launchSpike(game, entity.actor.id, vadd(origin, vscale(aim, 8)), vscale(aim, 1000)); missile.classname = "rock"; missile.model = "progs/rogue/sphere.mdl";
      game.setBody(missile, { velocity: vscale(aim, speed + random() * 100), bounds: POINT }); missile.angularVelocity = { x: 300 * random(), y: 300 * random(), z: 300 * random() };
      if (count % 2 === 0) { this.context.setNumber(missile, "frags", 1); missile.effects |= 64; }
      missile.touch = game.named.touch(missile, `${prefix}:missile_touch`); count--;
    }
    return undefined;
  }
  deathTouch(other: ActorId): undefined {
    const { game, entity, context } = this, target = game.entity(other);
    if (target?.solid === "trigger" || target?.solid === "bbox" && game.health(other) === 0) return undefined;
    context.services.emit({ kind: "colored-explosion", origin: this.origin, colorStart: 244, colorLength: 3 }); game.radiusDamage(entity.actor.id, entity.actor.id, 100, game.world?.actor.id ?? null, null); return game.remove(entity);
  }
}
export function registerOrb(context: Q1AddonContext): undefined {
  const { game } = context, monsters = registerBossControllers(context, prefix, "monster_orb", entity => new Q1Orb(context, entity));
  game.named.register(`${prefix}:death_touch`, { touch: (_game, entity, other) => requireBoss(monsters, entity).deathTouch(other) });
  game.named.register(`${prefix}:missile_touch`, { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
    const classname = game.host.classname(other); if (classname === "monster_orb" || classname === "monster_lava_man" || classname === "monster_super_shambler") return game.remove(entity);
    if (classname === entity.classname || game.entity(other)?.solid === "trigger") return undefined;
    const origin = game.body(entity).origin; if (game.host.contents(origin) === "sky") return game.remove(entity);
    if (game.host.combat.read(other)?.canTakeDamage === true) { game.effect("blood", origin, other, 18); game.damage(other, entity.actor.id, entity.owner, 18); }
    else if (entity.number("frags") !== 0) game.effect("knight-spike", origin);
    return game.remove(entity);
  } }); return undefined;
}

export function launchOrbMissile(monster: BaseMonster, missile: Q1Actor, speed: number, accuracy: number): undefined {
  const { game, entity } = monster, target = monster.enemy === null ? null : game.host.bodies.read(monster.enemy), basis = game.makeVectors(game.body(entity).angles), origin = game.body(missile).origin;
  const targetOrigin = target === null ? ZERO : vadd(vadd(target.origin, target.bounds.min), vscale(vsub(target.bounds.max, target.bounds.min), 0.7));
  const delta = vsub(targetOrigin, origin), travel = length(delta) / speed, velocity = target === null ? ZERO : { ...target.velocity, z: 0 };
  const direction = vadd(vadd(normalize(vadd(delta, vscale(velocity, travel))), vscale(basis.up, accuracy * (game.host.random() - 0.5))), vscale(game.basis.right, accuracy * (game.host.random() - 0.5)));
  game.setBody(missile, { velocity: vscale(direction, speed), angles: { x: 0, y: yawFor(direction), z: 0 } }); return game.schedule(missile, 5, game.named.action(missile, "SUB_Remove"));
}
