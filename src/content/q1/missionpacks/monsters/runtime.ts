/* Source monster controllers share the Q1 frame, movement and combat owners. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { callbackName } from "../../foundation/callbacks.ts";
import { baseSpecies } from "../../base/species.ts";
import { charmer, findCharmedTarget, findHipnoticTarget, huntCharmer, walkWithCharmer } from "./charm.ts";
import { BaseMonster, registerMonsterCallbacks } from "../../base/monsters.ts";
import { vsub, yawFor } from "../../foundation/types.ts";
import type { MonsterAi, MonsterFrame } from "../../base/animation.ts";
import type { Q1Base } from "../../base/provider.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../persistence/value.ts";
import type { Q1MissionPack } from "../types.ts";
import type { MissionMonsterHooks, PackMonsterDefinition } from "./types.ts";

export class MissionMonster extends BaseMonster {
  constructor(game: Q1Foundation, entity: Q1Actor, readonly definition: PackMonsterDefinition, readonly runtime: Q1MissionPackMonsters) {
    super(game, entity, definition.spec, runtime.base, { callbackPrefix: runtime.pack, frames: definition.frames,
      actions: new Map(Object.entries(definition.actions).map(([name, action]) => [name, (monster: BaseMonster) => action(runtime.require(monster.entity))])) });
  }
  override spawn(): undefined { return this.definition.spawn === undefined ? this.spawnDefault() : this.definition.spawn(this); }
  spawnDefault(): undefined { return super.spawn(); }
  override start(): undefined { return this.definition.start === undefined ? this.startDefault() : this.definition.start(this); }
  startDefault(): undefined {
    const path = this.game.find(this.state.path)[0]; this.entity.references.set("goalentity", path?.actor.id ?? null); this.entity.references.set("movetarget", path?.actor.id ?? null);
    return super.start();
  }
  override play(name: string): undefined {
    if (!this.definition.frames.has(name)) {
      const action = this.definition.actions[name];
      if (action !== undefined) return action(this);
    }
    return super.play(name);
  }
  override pain(attacker: ActorId | null, damage: number): undefined { if (this.definition.baseBehavior === true) return super.pain(attacker, damage); this.retaliate(attacker); return this.definition.pain(this, attacker, damage); }
  painDefault(attacker: ActorId | null, damage: number): undefined { return super.pain(attacker, damage); }
  dieDefault(attacker: ActorId | null): undefined { return super.die(attacker); }
  override die(attacker: ActorId | null): undefined {
    if (this.entity.number("charmed") !== 0) this.entity.effects &= ~8;
    if (this.definition.baseBehavior === true) return super.die(attacker);
    if (this.countedDeath) return undefined;
    this.enemy = attacker;
    if (this.game.health(this.entity.actor.id) < -99) this.game.host.combat.setHealth(this.entity.actor, -99);
    this.entity.damageable = false; this.entity.touch = null;
    this.countKill();
    return this.definition.die(this, attacker);
  }
  override meleeAttack(): undefined { return this.definition.baseBehavior === true ? super.meleeAttack() : this.definition.melee?.(this); }
  override tryAttack(): boolean { return this.definition.checkAttack === undefined ? super.tryAttack() : this.definition.checkAttack(this); }
  checkAttackDefault(): boolean { return super.tryAttack(); }
  override found(target: ActorId): undefined {
    const owner = charmer(this);
    if (owner !== null && (target === owner || this.game.entity(target)?.references.get("charmer") === owner)) { this.enemy = null; return undefined; }
    return this.definition.found === undefined ? this.foundDefault(target) : this.definition.found(this, target); }
  foundDefault(target: ActorId): undefined {
    if (this.runtime.pack !== "hipnotic") return super.found(target);
    const { game, entity, spec } = this; this.enemy = target;
    if (game.isPlayer(target)) { game.sightEntity = entity; game.sightTime = game.time; }
    entity.fields.set("show_hostile", String(Math.fround(game.time + 1)));
    let sound = spec.sight;
    if (spec.species === "enforcer") {
      const r = Math.floor(game.host.random() * 3 + 0.5); sound = `enforcer/sight${r === 1 ? 1 : r === 2 ? 2 : r === 0 ? 3 : 4}.wav`;
    } else if (spec.species === "fish" || spec.species === "gremlin" && entity.number("stoleweapon") !== 0) sound = "";
    if (sound !== "") game.sound(entity, sound);
    this.state.mode = "run"; this.nextFrame = spec.run; entity.references.set("goalentity", target);
    entity.idealYaw = yawFor(vsub(game.host.bodies.read(target)?.origin ?? { x: 0, y: 0, z: 0 }, this.origin));
    this.delay(0.1); return this.attackFinished(1);
  }
  override ai(mode: MonsterAi, distance: number): undefined {
    if (mode === "walk" && walkWithCharmer(this, distance)) return undefined;
    return this.definition.ai === undefined ? super.ai(mode, distance) : this.definition.ai(this, mode, distance); }
  aiDefault(mode: MonsterAi, distance: number): undefined { return super.ai(mode, distance); }
  override run(distance: number): undefined {
    const { game, entity } = this;
    const owner = charmer(this);
    if (owner !== null && (this.enemy === null || this.enemy === owner || game.health(this.enemy) <= 0)) { this.enemy = null; return huntCharmer(this); }
    if (entity.attackState !== "dodging") return super.run(distance);
    if (this.enemy === null || game.health(this.enemy) <= 0) { entity.attackState = "straight"; return super.run(distance); }
    const target = this.target;
    if (target === null) return undefined;
    const seen = this.visible(); if (seen) this.state.searchUntil = game.time + 5;
    if (this.searchForCoopTarget()) return undefined;
    game.makeVectors(game.body(entity).angles);
    if (seen && this.tryAttack()) return undefined;
    this.delay(0.1);
    const offset = this.lefty ? 40 : -40;
    if (game.time > entity.number("ltime")) { this.lefty = !this.lefty; entity.fields.set("ltime", String(Math.fround(game.time + 0.8))); }
    entity.idealYaw = yawFor(vsub(target, this.origin));
    if (game.host.walkMove(entity.actor, entity.idealYaw + offset, distance)) return this.changeYaw();
    this.lefty = !this.lefty; entity.fields.set("ltime", String(Math.fround(game.time + 0.8)));
    game.host.walkMove(entity.actor, entity.idealYaw - offset, distance); return this.changeYaw();
  }
  override moveToEnemy(distance: number): undefined {
    const { game, entity } = this;
    if (this.runtime.pack === "hipnotic" && (game.world?.number("RUN_STRAIGHT") ?? 0) !== 0 && game.time > entity.number("endtime")) {
      game.world?.fields.set("RUN_STRAIGHT", "0");
      if (game.host.walkMove(entity.actor, game.body(entity).angles.y, distance)) return undefined;
      entity.fields.set("endtime", String(Math.fround(game.time + 3)));
    }
    return super.moveToEnemy(distance);
  }
  override searchForCoopTarget(): boolean { return this.entity.number("charmed") === 0 && super.searchForCoopTarget(); }
  override makeVectors() { return this.game.makeVectors(this.game.body(this.entity).angles); }
  override findTarget(): boolean { return this.runtime.pack === "hipnotic" ? findCharmedTarget(this) ?? findHipnoticTarget(this) : super.findTarget(); }
  override retaliate(attacker: ActorId | null): undefined { return attacker !== null && attacker === charmer(this) ? undefined : super.retaliate(attacker); }
  override use(activator: ActorId | null): undefined { return this.definition.use === undefined ? super.use(activator) : this.definition.use(this, activator); }
}

export class Q1MissionPackMonsters {
  authoredGremlins = 0;
  spawnedGremlins = 0;
  readonly monsters = new Map<OwnedActor, MissionMonster>();
  private readonly definitions = new Map<string, PackMonsterDefinition>();
  constructor(readonly game: Q1Foundation, readonly base: Q1Base, readonly pack: Q1MissionPack, readonly hooks: MissionMonsterHooks = {}) {
    registerMonsterCallbacks(game, pack, entity => this.require(entity));
    if (pack === "hipnotic") for (const spec of baseSpecies) for (const classname of spec.classnames) {
      this.definitions.set(classname, { spec, baseBehavior: true, frames: new Map<string, MonsterFrame>(), actions: {}, pain: (monster, attacker, damage) => monster.painDefault(attacker, damage), die: (monster, attacker) => monster.dieDefault(attacker) });
      if (spec.movement !== "boss") game.replaceSpawn(classname, (_game, entity) => this.spawn(entity));
    }
    game.host.actors.onRelease(actor => { this.monsters.delete(actor); return undefined; });
    game.registerStateExtension({ id: `q1:${pack}:monsters`, capture: () => this.capture(), restore: bytes => this.restore(bytes), clone: (source, target) => this.clone(source, target) });
  }
  require(entity: Q1Actor): MissionMonster {
    const monster = this.monsters.get(entity.actor);
    if (monster === undefined) throw new Error(`Missing ${this.pack} monster controller for ${entity.classname}`);
    return monster;
  }
  context(actor: ActorId): MissionMonster | null {
    const owner = this.game.host.actors.resolveOwned(actor);
    return owner === null ? null : this.monsters.get(owner) ?? null;
  }
  register(definition: PackMonsterDefinition): undefined {
    for (const [name, callback] of Object.entries(definition.callbacks ?? {})) this.game.named.register(`${this.pack}:${name}`, callback);
    for (const classname of definition.spec.classnames) {
      if (this.definitions.has(classname)) throw new Error(`Duplicate ${this.pack} monster ${classname}`);
      this.definitions.set(classname, definition);
      this.game.registerSpawn(classname, (_game, entity) => this.spawn(entity));
    }
    return undefined;
  }
  spawn(entity: Q1Actor): undefined {
    if (this.game.options.deathmatch !== 0) return this.game.remove(entity);
    const definition = this.definitions.get(entity.classname);
    if (definition === undefined) throw new Error(`Unknown ${this.pack} monster ${entity.classname}`);
    const monster = new MissionMonster(this.game, entity, definition, this);
    this.monsters.set(entity.actor, monster);
    return monster.spawn();
  }
  charm(entity: Q1Actor, owner: ActorId): undefined {
    entity.references.set("charmer", owner); entity.fields.set("charmed", "1");
    if (this.monsters.has(entity.actor)) return undefined;
    const previous = this.base.monsters.get(entity.actor), definition = this.definitions.get(entity.classname);
    if (previous === undefined || definition === undefined) throw new Error(`Missing source charm controller for ${entity.classname}`);
    const monster = new MissionMonster(this.game, entity, definition, this);
    monster.restore(new SaveReader(previous.capture(), "hipnotic:charm"));
    this.base.monsters.delete(entity.actor); this.monsters.set(entity.actor, monster);
    const name = (callback: object | null): string | null => { const source = callbackName(callback); return source?.startsWith("base:") === true ? `${this.pack}:${source.slice(5)}` : source; };
    const think = name(entity.think), use = name(entity.use), pain = name(entity.pain), die = name(entity.die), touch = name(entity.touch), pathEnd = name(entity.pathEnd);
    entity.think = think === null ? null : this.game.named.action(entity, think);
    entity.use = use === null ? null : this.game.named.use(entity, use);
    entity.pain = pain === null ? null : this.game.named.pain(entity, pain);
    entity.die = die === null ? null : this.game.named.die(entity, die);
    entity.touch = touch === null ? null : this.game.named.touch(entity, touch);
    entity.pathEnd = pathEnd === null ? null : this.game.named.action(entity, pathEnd);
    return undefined;
  }
  private clone(source: Q1Actor, target: Q1Actor): undefined {
    const original = this.monsters.get(source.actor);
    if (original === undefined) return undefined;
    const monster = new MissionMonster(this.game, target, original.definition, this);
    monster.restore(new SaveReader(original.capture(), `${this.pack}:monster-clone`)); this.monsters.set(target.actor, monster);
    return undefined;
  }
  private capture(): Uint8Array {
    return encodeCheckpointValue({ version: 1, authoredGremlins: this.authoredGremlins, spawnedGremlins: this.spawnedGremlins, monsters: [...this.monsters.values()].map(monster => ({
      actor: { slot: monster.entity.actor.id.slot, generation: monster.entity.actor.id.generation }, definition: monster.spec.classnames[0] ?? monster.entity.classname, state: monster.capture(),
    })) });
  }
  private restore(bytes: Uint8Array): undefined {
    const reader = new SaveReader(decodeCheckpointValue(bytes), `q1:${this.pack}:monsters`); reader.field("version").literal(1);
    this.authoredGremlins = reader.field("authoredGremlins").number(); this.spawnedGremlins = reader.field("spawnedGremlins").number();
    this.monsters.clear();
    reader.field("monsters").list(saved => {
      const id = saved.field("actor"), actor = this.game.host.actors.resolveSaved({ slot: id.field("slot").integer(0), generation: id.field("generation").integer(0) });
      if (actor === null) return saved.fail("missing saved monster actor");
      const entity = this.game.entity(actor.id);
      if (entity === null) return saved.fail("missing saved monster source entity");
      const definition = this.definitions.get(saved.field("definition").string());
      if (definition === undefined) return saved.fail("unknown saved mission pack monster");
      const monster = new MissionMonster(this.game, entity, definition, this);
      monster.restore(saved.field("state")); this.monsters.set(actor, monster);
      return undefined;
    });
    return undefined;
  }
}
