/* quakec_mg3/monsters/mg3_demodog.qc and monsters.qc. GPL-2.0-or-later. */
import { Mg3Monster } from "./ai/index.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../persistence/value.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { BaseMonster, registerMonsterCallbacks } from "../../base/monsters.ts";
import { throwGib, throwHead } from "../../base/projectiles.ts";
import type { MonsterSpecies } from "../../base/species.ts";
import { POINT, ZERO, length, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { demodogFrames } from "./demodog-frames.ts";
import { initMg3Monster, startMg3Monster, registerMg3MonsterStartup, mg3MonsterActivator } from "./startup.ts";

const prefix = "mg3:demodog";
const spec: MonsterSpecies = { species: "dog", classnames: ["monster_demodog"], model: "dog_explosive", head: "h_dog", health: 25, gibHealth: -35, gibs: ["gib3", "gib3", "gib3"],
  bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "demodog_stand1", walk: "demodog_walk1", run: "demodog_run1", sight: "dog/dsight.wav", missile: "demodog_leap1", melee: true, movement: "walk" };
const actions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ["demodog_bite", monster => { if (monster.enemy === null) return undefined; monster.ai("charge", 10); monster.melee(100, 8, 3, true); return undefined; }],
  ["demodog_jump", monster => {
    const { game, entity } = monster, body = game.body(entity);
    entity.touch = game.named.touch(entity, `${prefix}:jump_touch`); entity.movementFlags &= ~512;
    return game.setBody(entity, { origin: vadd(body.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(game.makeVectors(body.angles).forward, 300), { x: 0, y: 0, z: 200 }), ground: null });
  }],
]);

export class Q1Demodog extends Mg3Monster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) {
    super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames: demodogFrames, actions });
  }
  override spawn(): undefined {
    const { game, entity, context } = this;
    entity.classname = "monster_dog"; context.setNumber(entity, "aflag", 1); entity.wait = 0;
    game.host.combat.setHealth(entity.actor, 25); entity.maxHealth = 25;
    entity.pain = game.named.pain(entity, `${prefix}:monster_pain`); entity.die = game.named.die(entity, `${prefix}:monster_die`);
    entity.pathEnd = game.named.action(entity, `${prefix}:monster_stand`); entity.fields.set("allowPathFind", "1"); entity.fields.set("combat_style", "2");
    return initMg3Monster(this, context, "progs/dog_explosive.mdl", 1, 2);
  }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined {
    return super.use(mg3MonsterActivator(this.game, activator));
  }
  override tryAttack(): boolean {
    const target = this.enemy === null ? null : this.game.host.bodies.read(this.enemy); if (target === null) return false;
    if ((this.game.world?.number("enemy_range") ?? 0) === 0) { this.entity.attackState = "melee"; return true; }
    const body = this.game.body(this.entity), delta = vsub(target.origin, body.origin), height = target.bounds.max.z - target.bounds.min.z;
    if (body.origin.z + body.bounds.min.z > target.origin.z + target.bounds.min.z + height * 0.75 || body.origin.z + body.bounds.max.z < target.origin.z + target.bounds.min.z + height * 0.25) return false;
    const distance = Math.hypot(delta.x, delta.y); if (distance < 80 || distance > 150) return false;
    this.entity.attackState = "missile"; return true;
  }
  override meleeAttack(): undefined { return this.play("demodog_atta1"); }
  override pain(attacker: ActorId | null, _damage: number): undefined {
    this.retaliate(attacker); this.game.sound(this.entity, "dog/dpain1.wav", "voice"); return this.play(this.game.host.random() > 0.5 ? "demodog_pain1" : "demodog_painb1");
  }
  override die(attacker: ActorId | null): undefined {
    if (this.countedDeath) return undefined;
    const { game, entity } = this; this.enemy = attacker; entity.damageable = false; entity.touch = null; this.countKill();
    game.host.combat.setHealth(entity.actor, -50);
    this.grenade(false); this.grenade(false); this.grenade(false); if (game.options.skill > 2 && game.host.random() > 0.7) this.grenade(true);
    game.sound(entity, "player/udeath.wav", "voice"); for (let i = 0; i < 3; i++) throwGib(game, this.origin, "gib3", -50);
    return throwHead(game, entity, "h_dog", -50);
  }
  jumpTouch(other: ActorId): undefined {
    const { game, entity } = this; if (game.health(entity.actor.id) <= 0) return undefined;
    if (game.host.combat.read(other)?.canTakeDamage && this.state.attackFinished < game.time && length(game.body(entity).velocity) > 300) {
      game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random());
      if (game.isPlayer(other)) { game.damage(entity.actor.id, other, other, 200); return undefined; }
      this.state.attackFinished = game.time + 0.5;
    }
    if (!game.host.checkBottom(entity.actor.id)) {
      if ((entity.movementFlags & 512) !== 0) { entity.touch = null; this.nextFrame = "demodog_leap1"; return this.delay(0.1); }
      return undefined;
    }
    entity.wait = 0; entity.touch = null; this.nextFrame = spec.run; return this.delay(0.1);
  }
  private grenade(vertical: boolean): undefined {
    const { game, entity, context } = this, random = (): number => game.host.random() * 2 - 1;
    let velocity = vscale({ x: 100 * random(), y: 100 * random(), z: 200 + 100 * game.host.random() }, 1.5);
    if (vertical) velocity = { x: 0, y: 0, z: velocity.z };
    velocity = vadd(velocity, vscale(game.makeVectors(game.body(entity).angles).forward, 100));
    game.sound(entity, "weapons/grenade.wav", "weapon"); const grenade = game.create("grenade"); grenade.owner = entity.actor.id;
    grenade.movement = "bounce"; grenade.solid = "bbox"; grenade.projectile = "grenade"; grenade.damage = 60; grenade.model = "progs/grenade.mdl"; grenade.angularVelocity = { x: 300, y: 300, z: 300 };
    context.setVector(grenade, "oldorigin", velocity); game.setBody(grenade, { origin: this.origin, velocity, bounds: POINT, angles: { x: Math.atan2(velocity.z, Math.hypot(velocity.x, velocity.y)) * 180 / Math.PI, y: yawFor(velocity), z: 0 } });
    grenade.touch = game.named.touch(grenade, `${prefix}:grenade_touch`); game.link(grenade);
    return game.schedule(grenade, 2.5 + 0.25 * random(), game.named.action(grenade, `${prefix}:grenade_explode`));
  }
}

export function registerMg3Demodog(context: Q1AddonContext): ReadonlyMap<OwnedActor, Q1Demodog> {
  const { game } = context, monsters = new Map<OwnedActor, Q1Demodog>();
  const monster = (entity: Q1Actor): Q1Demodog => { const value = monsters.get(entity.actor); if (value === undefined) throw new Error("Missing MG3 demodog source state"); return value; };
  registerMonsterCallbacks(game, prefix, monster);
  game.named.register(`${prefix}:jump_touch`, { touch: (_game, entity, other) => monster(entity).jumpTouch(other) });
  registerMg3MonsterStartup(game, prefix, monster);
  const explode = (entity: Q1Actor, ignore: ActorId | null): undefined => { game.radiusDamage(entity.actor.id, entity.owner, entity.damage, ignore, null); game.effect("explosion", game.body(entity).origin); return game.remove(entity); };
  game.named.register(`${prefix}:grenade_explode`, { action: (_game, entity) => explode(entity, game.world?.actor.id ?? null) });
  game.named.register(`${prefix}:grenade_touch`, { touch: (_game, entity, other) => {
    if (entity.owner !== null && sameActor(other, entity.owner)) return undefined;
    const target = game.entity(other);
    if (target?.aimedDamage || game.isPlayer(other)) {
      if (target?.classname === "monster_boss" || target?.classname === "monster_oldone_new") { game.damage(other, entity.actor.id, entity.owner, entity.damage); return explode(entity, other); }
      return explode(entity, game.world?.actor.id ?? null);
    }
    if (length(game.body(entity).velocity) === 0) entity.angularVelocity = ZERO;
    if (entity.number("attack_finished") < game.time) game.sound(entity, "weapons/bounce.wav", "weapon");
    return context.setNumber(entity, "attack_finished", game.time + 0.1);
  } });
  game.registerSpawn("monster_demodog", (_game, entity) => { const value = new Q1Demodog(context, entity); monsters.set(entity.actor, value); return value.spawn(); });
  game.host.actors.onRelease(actor => { monsters.delete(actor); return undefined; });
  game.registerStateExtension({ id: prefix, capture: () => encodeCheckpointValue([...monsters.values()].map(value => ({ slot: value.entity.actor.id.slot, generation: value.entity.actor.id.generation, state: value.capture() }))), restore: bytes => {
    monsters.clear(); new SaveReader(decodeCheckpointValue(bytes), prefix).list(reader => {
      const owner = game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }), entity = owner === null ? null : game.entity(owner.id);
      if (owner === null || entity === null) return reader.fail("missing demodog actor");
      const value = new Q1Demodog(context, entity); value.restore(reader.field("state")); monsters.set(owner, value); return undefined;
    }); return undefined;
  }, clone: (source, target) => { const value = monsters.get(source.actor); if (value === undefined) return undefined; const copy = new Q1Demodog(context, target); copy.restore(new SaveReader(value.capture(), prefix)); monsters.set(target.actor, copy); return undefined; } });
  return monsters;
}
