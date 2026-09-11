import type { AttackProvenance, DamageOutcome, ItemId } from "../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import { add, integerField, length, numberField, scale, subtract, vectorField, zero, inhibitQ2Spawn, parseQ2Entities } from "./fields.ts";
import { Q2Entity } from "./host.ts";
import type { Q2FoundationHost, Q2GameOptions, Q2GameServices, Q2Motion, Q2SpawnFields, Q2SpawnModule, Q2Think } from "./host.ts";
import { freeQ2Entity, Q2SourceCallbacks } from "./callbacks.ts";
import { restoreQ2Actor, saveQ2Actor } from "./checkpoint.ts";
import type { Q2EntityCheckpoint, Q2FoundationCheckpoint } from "./checkpoint.ts";
import type { SavedActorId } from "../../../contracts/session.ts";

const MASK_SOLID = 3;
const delayedUse: Q2Think = (entity, game) => { game.useTargets(entity, entity.activator); game.remove(entity); return undefined; };

export interface Q2SpawnReport {
  readonly authored: number;
  readonly inhibited: readonly Q2SpawnFields[];
  readonly removedBySource: readonly Q2SpawnFields[];
  readonly spawned: readonly Q2Entity[];
  readonly unsupported: readonly Q2Entity[];
}

/** One provider's actors and source callbacks; the session still owns the frame and all mutation authorities. */
export class Q2Foundation implements Q2GameServices {
  readonly entities = new Map<ActorId, Q2Entity>();
  readonly sourceCallbacks = new Q2SourceCallbacks();
  readonly counters = { totalSecrets: 0, foundSecrets: 0, totalGoals: 0, foundGoals: 0, totalMonsters: 0, killedMonsters: 0, serverFlags: 0 };
  private nextSourceSlot: number;
  private readonly sourceSlots = new Map<ActorId, number>();
  private readonly freedSlots = new Map<number, number>();
  private sequence = 0;
  currentActor: ActorId | null = null;
  private readonly unsupported = new Set<Q2Entity>();

  constructor(readonly host: Q2FoundationHost, readonly options: Q2GameOptions, private readonly modules: readonly Q2SpawnModule[]) {
    this.nextSourceSlot = options.maxClients + 1;
    this.sourceCallbacks.register({ think: { Think_Delay: delayedUse, G_FreeEdict: freeQ2Entity }, die: { G_FreeEdict: freeQ2Entity } });
    for (const module of modules) if (module.callbacks !== undefined) this.sourceCallbacks.register(module.callbacks);
    host.actors.onRelease(actor => {
      const entity = this.entities.get(actor.id);
      if (entity !== undefined) this.unsupported.delete(entity);
      const slot = this.sourceSlots.get(actor.id);
      if (slot !== undefined && slot > options.maxClients) this.freedSlots.set(slot, host.now());
      this.sourceSlots.delete(actor.id); this.entities.delete(actor.id);
      return undefined;
    });
  }

  load(source: string): Q2SpawnReport {
    const fields = parseQ2Entities(source, this.options.edition);
    const inhibited: Q2SpawnFields[] = [], removedBySource: Q2SpawnFields[] = [], spawned: Q2Entity[] = [];
    for (const field of fields) {
      if (inhibitQ2Spawn(field, this.options)) { inhibited.push(field); continue; }
      const entity = this.spawn(field);
      if (this.host.actors.isLive(entity.actor.id)) spawned.push(entity);
      else removedBySource.push(field);
    }
    this.findTeams();
    return { authored: fields.length, inhibited, removedBySource, spawned, unsupported: [...this.unsupported] };
  }

  /** G_FindTeams, followed by the rerelease's Rogue G_FixTeams train repair. */
  private findTeams(): undefined {
    const entities = [...this.entities.values()].sort((a, b) => (this.sourceSlots.get(a.actor.id) ?? 0) - (this.sourceSlots.get(b.actor.id) ?? 0));
    for (const master of entities) {
      const name = master.spawn.values.get("team");
      if (!name || (master.flags & 0x400) !== 0) continue;
      master.teamMaster = master.actor.id;
      if (this.options.edition === "rerelease") master.flags |= 0x4000000;
      let chain = master;
      for (const member of entities) {
        if (member === master || (this.sourceSlots.get(member.actor.id) ?? 0) <= (this.sourceSlots.get(master.actor.id) ?? 0) || member.spawn.values.get("team") !== name || (member.flags & 0x400) !== 0) continue;
        chain.teamChain = member.actor.id; member.teamMaster = master.actor.id;
        member.flags |= 0x400; chain = member;
      }
    }
    if (this.options.edition !== "rerelease") return undefined;
    for (const master of entities) {
      const name = master.spawn.values.get("team");
      if (!name || master.classname !== "func_train" || (master.spawnflags & 8) === 0 || (master.flags & 0x400) === 0) continue;
      master.teamMaster = master.actor.id; master.teamChain = null; master.flags = master.flags & ~0x400 | 0x4000000;
      let chain = master;
      for (const member of entities) {
        if (member === master || member.spawn.values.get("team") !== name) continue;
        chain.teamChain = member.actor.id; member.teamMaster = master.actor.id; member.teamChain = null;
        member.flags = member.flags & ~0x4000000 | 0x400; member.speed = master.speed;
        this.motion(member, "push"); chain = member;
      }
    }
    return undefined;
  }

  pushTeam(actor: ActorId): readonly OwnedActor[] {
    const entity = this.entity(actor);
    if (entity === null) return [];
    const master = this.entity(entity.teamMaster) ?? entity;
    const members: OwnedActor[] = [];
    for (let member: Q2Entity | null = master; member !== null; member = this.entity(member.teamChain)) members.push(member.actor);
    return members;
  }

  capture(): Q2FoundationCheckpoint {
    if (this.currentActor !== null) throw new Error("Q2 source saves require a completed callback boundary");
    const entities: Q2EntityCheckpoint[] = [];
    for (const entity of this.entities.values()) {
      const { actor, spawn, activator, enemy, owner, goal, teamMaster, teamChain, chain, lastAttack, think, prethink, use, touch, pain, die, blocked, ...values } = entity;
      entities.push({ actor: { slot: actor.id.slot, generation: actor.id.generation }, sourceSlot: this.sourceSlots.get(actor.id) ?? null,
        spawn: { classname: spawn.classname, ordinal: spawn.ordinal, values: [...spawn.values].map(([key, value]) => ({ key, value })) }, values: structuredClone(values),
        links: { activator: saveQ2Actor(activator), enemy: saveQ2Actor(enemy), owner: saveQ2Actor(owner), goal: saveQ2Actor(goal),
          teamMaster: saveQ2Actor(teamMaster), teamChain: saveQ2Actor(teamChain), chain: saveQ2Actor(chain) },
        lastAttack: lastAttack === null ? null : { ...lastAttack, attacker: saveQ2Actor(lastAttack.attacker), inflictor: saveQ2Actor(lastAttack.inflictor) },
        callbacks: { think: this.sourceCallbacks.think.name(think), prethink: this.sourceCallbacks.think.name(prethink), use: this.sourceCallbacks.use.name(use),
          touch: this.sourceCallbacks.touch.name(touch), pain: this.sourceCallbacks.pain.name(pain), die: this.sourceCallbacks.die.name(die), blocked: this.sourceCallbacks.blocked.name(blocked) } });
    }
    return { version: 1, nextSourceSlot: this.nextSourceSlot, sequence: this.sequence, counters: { ...this.counters },
      freedSlots: [...this.freedSlots].map(([slot, time]) => ({ slot, time })), entities };
  }

  /** Shared lifetimes and authority tables are restored first; no spawn callback runs here. */
  restore(checkpoint: Q2FoundationCheckpoint): undefined {
    if (this.currentActor !== null) throw new Error("Q2 source restore requires a completed callback boundary");
    this.entities.clear(); this.sourceSlots.clear(); this.freedSlots.clear(); this.unsupported.clear();
    this.nextSourceSlot = checkpoint.nextSourceSlot; this.sequence = checkpoint.sequence;
    Object.assign(this.counters, checkpoint.counters);
    for (const entry of checkpoint.freedSlots) this.freedSlots.set(entry.slot, entry.time);
    const reference = (saved: SavedActorId | null): ActorId | null => saved === null ? null : this.host.actors.referenceSaved(saved);
    for (const saved of checkpoint.entities) {
      const actor = restoreQ2Actor(this, saved.actor);
      if (saved.sourceSlot !== null) {
        const source = this.host.actors.sourceOf(actor.id);
        if (source === null || source.provider !== this.options.provider || source.slot !== saved.sourceSlot) throw new Error("Q2 checkpoint source slot disagrees with the shared registry");
      }
      const entity = new Q2Entity(actor, { classname: saved.spawn.classname, ordinal: saved.spawn.ordinal,
        values: new Map(saved.spawn.values.map(field => [field.key, field.value])) });
      Object.assign(entity, structuredClone(saved.values));
      entity.activator = reference(saved.links.activator); entity.enemy = reference(saved.links.enemy); entity.owner = reference(saved.links.owner);
      entity.goal = reference(saved.links.goal); entity.teamMaster = reference(saved.links.teamMaster); entity.teamChain = reference(saved.links.teamChain); entity.chain = reference(saved.links.chain);
      entity.lastAttack = saved.lastAttack === null ? null : { ...saved.lastAttack, attacker: reference(saved.lastAttack.attacker), inflictor: reference(saved.lastAttack.inflictor) };
      entity.think = this.sourceCallbacks.think.resolve(saved.callbacks.think); entity.prethink = this.sourceCallbacks.think.resolve(saved.callbacks.prethink);
      entity.use = this.sourceCallbacks.use.resolve(saved.callbacks.use); entity.touch = this.sourceCallbacks.touch.resolve(saved.callbacks.touch);
      entity.pain = this.sourceCallbacks.pain.resolve(saved.callbacks.pain); entity.die = this.sourceCallbacks.die.resolve(saved.callbacks.die); entity.blocked = this.sourceCallbacks.blocked.resolve(saved.callbacks.blocked);
      this.entities.set(actor.id, entity);
      if (saved.sourceSlot !== null) this.sourceSlots.set(actor.id, saved.sourceSlot);
      this.bindCallbacks(entity);
    }
    return undefined;
  }

  spawn(fields: Q2SpawnFields): Q2Entity {
    const entity = this.allocate(fields);
    for (const module of this.modules) if (module.spawn(entity, this)) return entity;
    this.unsupported.add(entity);
    this.host.diagnostic(`Q2 spawn handler not yet imported: ${fields.classname} at authored entity ${fields.ordinal}`);
    return entity;
  }

  create(classname: string, values: ReadonlyMap<string, string> = new Map<string, string>()): Q2Entity {
    return this.allocate({ classname, ordinal: -1, values });
  }

  itemName(classname: string): string | null {
    for (const module of this.modules) {
      const name = module.itemName?.(classname); if (name !== undefined && name !== null) return name;
    }
    return null;
  }

  /** Admission wraps the session's player slot. Character, movement and inventories were selected independently. */
  attachPlayer(actor: OwnedActor): Q2Entity {
    this.host.actors.assertOwned(actor);
    const existing = this.entities.get(actor.id);
    if (existing !== undefined) return existing;
    const entity = new Q2Entity(actor, { classname: "player", ordinal: -1, values: new Map<string, string>() });
    entity.maxHealth = 100; entity.viewHeight = 22;
    this.entities.set(actor.id, entity);
    this.bindCallbacks(entity);
    return entity;
  }

  private allocate(fields: Q2SpawnFields): Q2Entity {
    const reusable = [...this.freedSlots].sort(([a], [b]) => a - b).find(([, freed]) => freed < 2 || this.host.now() - freed > 0.5);
    const slot = fields.classname === "worldspawn" ? 0 : reusable?.[0] ?? this.nextSourceSlot++;
    this.freedSlots.delete(slot);
    const actor = this.host.actors.allocateAtSource(this.options.provider, slot, `q2:${fields.classname}`);
    this.sourceSlots.set(actor.id, slot);
    const entity = new Q2Entity(actor, fields);
    entity.spawnflags = integerField(fields, "spawnflags") & ~(this.options.edition === "rerelease" ? 0xff00 : 0x1f00);
    entity.delay = numberField(fields, "delay"); entity.wait = numberField(fields, "wait");
    entity.speed = numberField(fields, "speed"); entity.accel = numberField(fields, "accel"); entity.decel = numberField(fields, "decel");
    entity.damage = integerField(fields, "dmg"); entity.count = integerField(fields, "count"); entity.maxHealth = integerField(fields, "health");
    entity.noise = fields.values.get("noise") ?? ""; entity.map = fields.values.get("map") ?? "";
    entity.volume = numberField(fields, "volume"); entity.attenuation = numberField(fields, "attenuation");
    entity.random = numberField(fields, "random"); entity.style = integerField(fields, "style");
    const angles = fields.values.has("angles") ? vectorField(fields, "angles") : { x: 0, y: numberField(fields, "angle"), z: 0 };
    this.host.bodies.create(actor, { origin: vectorField(fields, "origin"), angles, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    this.entities.set(actor.id, entity);
    this.bindCallbacks(entity);
    return entity;
  }

  private bindCallbacks(entity: Q2Entity): undefined {
    return this.host.callbacks.bind(entity.actor, {
      think: () => this.invoke(entity.actor.id, () => {
        const callback = entity.think;
        entity.nextThink = null;
        if (callback !== null) callback(entity, this);
        return undefined;
      }),
      use: (_self, other, activator) => entity.use?.(entity, this, other, activator),
      touch: contact => entity.touch?.(entity, this, contact),
      pain: reaction => entity.pain?.(entity, this, reaction),
      die: reaction => entity.die?.(entity, this, reaction),
    });
  }

  private invoke(actor: ActorId, callback: () => undefined): undefined {
    const previous = this.currentActor;
    this.currentActor = actor;
    try { return callback(); } finally { this.currentActor = previous; }
  }

  /** Keep level.current_entity scoped around the session's existing entity physics step. */
  runActor(actor: ActorId, callback: () => undefined): undefined { return this.invoke(actor, callback); }

  prePhysics(actor: ActorId): undefined {
    const entity = this.entity(actor);
    return entity === null ? undefined : this.invoke(actor, () => entity.prethink?.(entity, this));
  }

  remove(entity: Q2Entity): undefined {
    if (!this.host.actors.isLive(entity.actor.id)) return undefined;
    this.host.bodies.unlink(entity.actor);
    const source = this.host.actors.sourceOf(entity.actor.id);
    if (entity.classname === "bodyque" || source !== null && source.provider === this.options.provider && source.slot <= this.options.maxClients) return undefined;
    this.cancel(entity);
    this.host.emit({ kind: "visibility", actor: entity.actor.id, visible: false });
    return this.host.actors.release(entity.actor);
  }

  entity(actor: ActorId | null): Q2Entity | null {
    const owner = actor === null ? null : this.host.actors.resolveOwned(actor);
    return owner === null ? null : this.entities.get(owner.id) ?? null;
  }

  body(entity: Q2Entity): BodyState {
    const body = this.host.bodies.read(entity.actor.id);
    if (body === null) throw new Error("Q2 callback used a released body");
    return body;
  }

  move(entity: Q2Entity, changes: Partial<BodyState>, link = true): undefined {
    this.host.bodies.write(entity.actor, { ...this.body(entity), ...changes });
    if (link) this.host.bodies.link(entity.actor);
    return undefined;
  }

  link(entity: Q2Entity): undefined { return this.host.bodies.link(entity.actor); }

  solid(entity: Q2Entity, solid: Q2Entity["solid"]): undefined {
    entity.solid = solid;
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    if (model !== null) this.move(entity, { bounds: this.host.inlineModelBounds(model) }, false);
    this.host.setSolid(entity.actor, solid, model);
    return this.link(entity);
  }

  motion(entity: Q2Entity, kind: Q2Motion["kind"]): undefined {
    entity.motion = kind;
    return this.host.setMotion({ actor: entity.actor, kind, velocity: this.body(entity).velocity, angularVelocity: entity.angularVelocity, gravity: entity.gravity, clipMask: entity.clipMask, owner: entity.owner });
  }

  schedule(entity: Q2Entity, delaySeconds: number, think: Q2Think): undefined {
    entity.think = think;
    entity.nextThink = this.options.edition === "rerelease"
      ? (Math.round(this.host.now() * 1000) + Math.round(delaySeconds * 1000)) / 1000
      : this.host.now() + delaySeconds;
    return this.host.schedule(entity.actor, entity.nextThink);
  }

  cancel(entity: Q2Entity): undefined {
    entity.nextThink = null;
    entity.think = null;
    return this.host.schedule(entity.actor, null);
  }

  targets(name: string): readonly Q2Entity[] {
    if (name === "") return [];
    return [...this.entities.values()].filter(entity => entity.targetname === name).sort((a, b) => {
      const first = this.host.actors.sourceOf(a.actor.id)?.slot ?? a.actor.id.slot;
      const second = this.host.actors.sourceOf(b.actor.id)?.slot ?? b.actor.id.slot;
      return first - second;
    });
  }

  pickTarget(name: string): Q2Entity | null {
    // G_PickTarget stores at most eight matches before selecting one.
    const targets = this.targets(name).slice(0, 8);
    return targets[Math.floor(this.host.random() * targets.length)] ?? null;
  }

  useTargets(entity: Q2Entity, activator: ActorId | null, ignoreDelay = false): undefined {
    if (entity.delay !== 0 && !ignoreDelay) {
      const delayed = this.create("DelayedUse");
      delayed.activator = activator; delayed.message = entity.message; delayed.target = entity.target; delayed.killtarget = entity.killtarget;
      return this.schedule(delayed, entity.delay, delayedUse);
    }
    if (entity.message !== "" && activator !== null && !this.host.isMonster(activator)) {
      this.host.emit({ kind: "centerprint", actor: activator, text: entity.message });
      const body = this.host.bodies.read(activator);
      if (body !== null) this.host.emit({ kind: "sound", actor: activator, origin: body.origin, path: "misc/talk1.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    }
    for (const target of this.targets(entity.killtarget)) {
      this.remove(target);
      if (!this.host.actors.isLive(entity.actor.id)) return undefined;
    }
    // Resolve each next slot after callbacks: nested spawns and removals retain G_Find traversal behavior.
    let after = -1;
    for (;;) {
      const target = this.targets(entity.target).find(candidate => (this.host.actors.sourceOf(candidate.actor.id)?.slot ?? candidate.actor.id.slot) > after);
      if (target === undefined) break;
      after = this.host.actors.sourceOf(target.actor.id)?.slot ?? target.actor.id.slot;
      if (target === entity) this.host.diagnostic(`Q2 ${entity.classname} targets itself`);
      else if (!(target.classname === "func_areaportal" && (entity.classname === "func_door" || entity.classname === "func_door_rotating"))) {
        this.host.callbacks.use(target.actor, entity.actor.id, activator);
      }
      if (!this.host.actors.isLive(entity.actor.id)) break;
    }
    return undefined;
  }

  show(entity: Q2Entity): undefined {
    this.host.emit({ kind: "model", actor: entity.actor.id, path: entity.model, attachedModels: [entity.model2, entity.model3, entity.model4], frame: entity.frame, oldFrame: entity.oldFrame, scale: entity.scale, skin: entity.skin, effects: entity.effects, renderFlags: entity.renderFlags });
    return this.host.emit({ kind: "visibility", actor: entity.actor.id, visible: entity.visible });
  }

  sound(entity: Q2Entity, path: string, channel = 2, volume = 1, attenuation = 1): undefined {
    return this.host.emit({ kind: "sound", actor: entity.actor.id, origin: this.body(entity).origin, path, channel, volume, attenuation, reliable: false, loop: "once" });
  }

  attack(inflictor: Q2Entity | ActorId, attacker: ActorId | null, meansOfDeath: number, flags: number, weapon: ItemId | null): AttackProvenance {
    return { sequence: this.sequence++, time: { kind: "seconds", value: this.host.now() }, attacker, inflictor: inflictor instanceof Q2Entity ? inflictor.actor.id : inflictor, weapon,
      weaponProvider: this.options.provider, combatProvider: this.options.combatProvider, inventoryProvider: this.options.inventoryProvider,
      movementProvider: this.options.movementProvider, cause: { kind: "q2", meansOfDeath, damageFlags: flags } };
  }

  damage(target: ActorId, inflictor: Q2Entity | ActorId, attacker: ActorId | null, amount: number, knockback: number, direction: Vec3,
    point: Vec3, normal: Vec3, meansOfDeath: number, flags = 0, weapon: ItemId | null = null): DamageOutcome {
    return this.host.combat.apply({ attack: this.attack(inflictor, attacker, meansOfDeath, flags, weapon), target,
      amount, knockback, direction, point, normal, delivery: "direct" });
  }

  canDamage(target: ActorId, inflictor: Q2Entity): boolean {
    const body = this.host.bodies.read(target);
    if (body === null) return false;
    const source = this.body(inflictor).origin;
    const entity = this.entity(target);
    const destination = entity?.motion === "push" ? add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)) : body.origin;
    const trace = this.host.trace({ start: source, end: destination, bounds: null, ignore: inflictor.actor.id, mask: MASK_SOLID });
    if (trace.fraction === 1 || trace.hit.kind === "actor" && trace.hit.actor.equals(target)) return true;
    if (entity?.motion === "push") return false;
    for (const offset of [{ x: 15, y: 15, z: 0 }, { x: 15, y: -15, z: 0 }, { x: -15, y: 15, z: 0 }, { x: -15, y: -15, z: 0 }]) {
      if (this.host.trace({ start: source, end: add(destination, offset), bounds: null, ignore: inflictor.actor.id, mask: MASK_SOLID }).fraction === 1) return true;
    }
    return false;
  }

  radiusDamage(inflictor: Q2Entity, attacker: ActorId | null, damage: number, ignore: ActorId | null, radius: number, meansOfDeath: number, damageFlags = 0, weapon: ItemId | null = null): undefined {
    const origin = this.body(inflictor).origin;
    for (const target of this.host.nearby(origin, radius)) {
      if (ignore !== null && ignore.equals(target)) continue;
      const state = this.host.combat.read(target), body = this.host.bodies.read(target);
      if (state === null || !state.canTakeDamage || body === null) continue;
      const center = add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5));
      let points = damage - 0.5 * length(subtract(center, origin));
      if (attacker !== null && target.equals(attacker)) points *= 0.5;
      if (points <= 0 || !this.canDamage(target, inflictor)) continue;
      this.host.combat.apply({ attack: this.attack(inflictor, attacker, meansOfDeath, damageFlags | 1, weapon), target,
        amount: Math.trunc(points), knockback: Math.trunc(points), direction: subtract(body.origin, origin), point: origin, normal: zero, delivery: "radius" });
    }
    return undefined;
  }
}
