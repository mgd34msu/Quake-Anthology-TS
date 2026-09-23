import type { DamageRequest } from "../../../contracts/gameplay.ts";
import type { UseParticipant } from "./game/state.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { BodyState, DeathReaction, PainReaction } from "../../../contracts/world.ts";
import type { SessionActorRegistry, SharedBodyTable, ActorCallbackTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import type { PlayerAuthorityBinding } from "./shared/player-state.ts";
import type { Product } from "./shared/definitions.ts";
import { statSchema } from "./shared/definitions.ts";
import { GameClient, GameEntity, MAX_CLIENTS, MAX_GENTITIES } from "./game/state.ts";
import type { DamageInflictor } from "./game/state.ts";
import { q3WeaponItem, Q3_WEAPON_ITEMS } from "../foundation/arsenal.ts";
import type { Q3DamageCall } from "./game/combat.ts";
import { EntityShared } from "./shared/entity-shared.ts";

const ZERO_BODY: BodyState = { origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, ground: null };

export interface Q3RecordHost {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly callbacks: ActorCallbackTable;
  ammoTimerStored?(actor: ActorId, weapon: number, value: number): void;
  schedule(actor: OwnedActor, dueMilliseconds: number | null): undefined;
  runThink(actor: OwnedActor, timeMilliseconds: number): undefined;
  /** The innermost source call is retained until all synchronous pain/death callbacks return. */
  damageCall(): Q3DamageCall | null;
  admitDamage?(entity: GameEntity, request: DamageRequest): "continue" | "handled";
  /** Project actors owned by another game into the selected Q3 source-slot view. */
  foreign(actor: ActorId): GameEntity | null;
  isPlayer(actor: ActorId): boolean;
}

interface SourceRecord {
  readonly entity: GameEntity;
  actor: OwnedActor | null;
  active: boolean;
  borrowed: boolean;
}

/** gentity_t private records with lifetime, body, combat and inventory supplied by the session owners. */
export class Q3EntityRecords {
  private readonly records: readonly SourceRecord[];
  private readonly unobserve: () => undefined;
  private readonly clients: readonly GameClient[];
  private readonly clientBacking = Array.from({ length: MAX_CLIENTS }, () => ({ sourceStats: new Int32Array(16), specialAmmo: new Int32Array(16) }));

  captureOwnership() {
    return this.records.map(record => ({ actor: record.actor, active: record.active, borrowed: record.borrowed }));
  }

  restoreOwnership(states: readonly { readonly actor: OwnedActor | null; readonly active: boolean; readonly borrowed: boolean }[]): void {
    if (states.length !== MAX_GENTITIES) throw new Error("Restored Q3 ownership requires all retained slots");
    const seen = new Set<OwnedActor>();
    for (const state of states) {
      if (state.actor === null) {
        if (state.active) throw new Error("Active Q3 slot has no actor");
      } else {
        this.host.actors.assertOwned(state.actor);
        if (seen.has(state.actor)) throw new Error("Duplicate restored Q3 actor");
        seen.add(state.actor);
        if (!state.borrowed && state.actor.owner !== this.provider) throw new Error("Q3 owned actor has a foreign provider");
      }
    }
    states.forEach((state, slot) => {
      const record = this.record(slot);
      if (record.actor !== null) throw new Error("Q3 ownership hydration requires fresh records");
      record.actor = state.actor; record.active = state.active; record.borrowed = state.borrowed;
    });
  }

  restoreCallbacks(): void {
    for (const record of this.records) if (record.actor !== null && !record.borrowed) {
      this.host.combat.bindDamageAdmission(record.actor, request => this.host.admitDamage?.(record.entity, request) ?? "continue");
      this.bindCallbacks(record);
    }
  }

  captureClientBacking(slot: number): { readonly sourceStats: readonly number[]; readonly specialAmmo: readonly number[] } {
    const backing = this.clientBacking[slot];
    if (backing === undefined) throw new RangeError("Q3 client backing slot outside 0..63");
    return { sourceStats: Array.from(backing.sourceStats), specialAmmo: Array.from(backing.specialAmmo) };
  }

  restoreClientBacking(slot: number, state: { readonly sourceStats: readonly number[]; readonly specialAmmo: readonly number[] }): void {
    const backing = this.clientBacking[slot];
    if (backing === undefined || state.sourceStats.length !== 16 || state.specialAmmo.length !== 16) throw new Error("Invalid Q3 private client backing");
    backing.sourceStats.set(state.sourceStats); backing.specialAmmo.set(state.specialAmmo);
  }

  constructor(readonly host: Q3RecordHost, readonly provider: ProviderId, readonly product: Product) {
    this.records = Array.from({ length: MAX_GENTITIES }, (_, slot): SourceRecord => {
      const record = (): SourceRecord => this.record(slot);
      const body = {
        read: (): BodyState => { const actor = record().actor; return actor === null ? ZERO_BODY : host.bodies.read(actor.id) ?? ZERO_BODY; },
        write: (value: BodyState): void => { host.bodies.write(this.ensureActor(slot), value); },
        linked: () => { const actor = record().actor; return actor === null ? null : host.bodies.linked(actor.id); },
      };
      const entity = new GameEntity(slot, { body, actor: () => this.ensureActor(slot),
        active: () => record().active && record().actor !== null && host.actors.isLive(this.ensureActor(slot).id),
        health: () => { const actor = record().actor; return actor === null ? 0 : host.combat.read(actor.id)?.health ?? 0; },
        setHealth: value => { host.combat.setHealth(this.ensureActor(slot), value); },
        takedamage: () => { const actor = record().actor; return actor !== null && (host.combat.read(actor.id)?.canTakeDamage ?? false); },
        setTakedamage: value => { host.combat.setTraits(this.ensureActor(slot), { canTakeDamage: value }); },
        runThink: time => { host.runThink(this.ensureActor(slot), time); },
        schedule: value => { const actor = record().actor; if (actor !== null) host.schedule(actor, value <= 0 ? null : value); },
      });
      return { entity, actor: null, active: false, borrowed: false };
    });
    this.clients = Array.from({ length: MAX_CLIENTS }, (_, slot) => new GameClient(product, this.playerBinding(slot), host.ammoTimerStored === undefined ? undefined : (weapon, value) => {
      const actor = this.record(slot).actor; if (actor !== null) host.ammoTimerStored?.(actor.id, weapon, value);
    }));
    this.unobserve = host.actors.onRelease(actor => {
      for (const record of this.records) if (record.actor === actor) { record.actor = null; record.active = false; }
      return undefined;
    });
  }

  close(): void { this.unobserve(); }

  get(slot: number): GameEntity | undefined { return this.records[slot]?.entity; }
  client(slot: number): GameClient { const client = this.clients[slot]; if (client === undefined) throw new RangeError(`Q3 client ${slot} outside 0..63`); return client; }
  private record(slot: number): SourceRecord { const record = this.records[slot]; if (record === undefined) throw new RangeError(`Q3 entity ${slot} outside 0..1023`); return record; }

  private ensureActor(slot: number): OwnedActor {
    const record = this.record(slot);
    if (record.actor !== null) { this.host.actors.assertOwned(record.actor); return record.actor; }
    const actor = this.host.actors.allocateAtSource(this.provider, slot, slot < MAX_CLIENTS ? "q3:player" : "q3:entity");
    record.actor = actor;
    this.host.bodies.create(actor, ZERO_BODY);
    this.bindOwnedServices(record);
    return actor;
  }

  private bindOwnedServices(record: SourceRecord): void {
    const actor = record.actor;
    if (actor === null) throw new Error("Cannot bind Q3 services without an actor");
    if (this.host.combat.read(actor.id) === null) this.host.combat.create(actor, {
      health: 0, armor: { regular: { kind: "q3", points: 0, protection: Math.fround(0.66) }, powered: { kind: "none" } },
      mass: 200, canTakeDamage: false, invulnerable: false, team: null,
    }, request => this.host.admitDamage?.(record.entity, request) ?? "continue");
    else this.host.combat.bindDamageAdmission(actor, request => this.host.admitDamage?.(record.entity, request) ?? "continue");
    if (!this.host.inventory.has(actor.id)) this.host.inventory.create(actor, []);
    this.bindCallbacks(record);
  }

  /** Restore an existing owned actor without reallocating its identity or body. */
  adopt(slot: number, actor: OwnedActor): GameEntity {
    this.host.actors.assertOwned(actor);
    const record = this.record(slot);
    if (slot < MAX_CLIENTS || slot >= 1022 || actor.owner !== this.provider || record.actor !== null
      || this.nativeByActor(actor.id) !== null || this.host.bodies.read(actor.id) === null)
      throw new Error("Q3 owned actor adoption requires an unused entity slot and its existing body");
    record.actor = actor; record.active = true; record.borrowed = false; record.entity.s.number = slot;
    this.bindOwnedServices(record);
    return record.entity;
  }

  /** Attach an already admitted foreign or foundation actor without creating another actor or changing its callbacks. */
  attach(slot: number, actor: OwnedActor, player: boolean): GameEntity {
    this.host.actors.assertOwned(actor);
    const record = this.record(slot);
    if (record.actor !== null && record.actor !== actor) throw new Error(`Q3 slot ${slot} already has an actor`);
    record.actor = actor; record.active = true; record.borrowed = true;
    if (player) record.entity.client = this.client(slot);
    record.entity.s.number = slot;
    return record.entity;
  }

  activate(slot: number): GameEntity {
    const record = this.record(slot);
    this.ensureActor(slot); record.active = true;
    return record.entity;
  }

  deactivateClient(slot: number): void {
    const record = this.record(slot);
    const actor = record.actor;
    if (actor !== null && !record.borrowed) this.host.actors.release(actor);
    record.actor = null; record.active = false; record.borrowed = false;
  }

  release(entity: GameEntity): void {
    const record = this.record(entity.slot);
    if (record.entity !== entity) throw new Error("Q3 entity belongs to another record owner");
    const actor = record.actor;
    if (actor !== null && !record.borrowed) this.host.actors.release(actor);
    record.actor = null; record.active = false; record.borrowed = false;
    const fresh = new GameEntity(entity.slot, entity.binding);
    Object.assign(entity, fresh);
    // Body getters retain their forwarding binding; source metadata is cleared.
    entity.r = new EntityShared(entity.binding.body);
  }

  nativeByActor(actor: ActorId | null): GameEntity | null {
    return actor === null ? null : this.records.find(record => record.actor?.id.equals(actor))?.entity ?? null;
  }

  byActor(actor: ActorId | null): GameEntity | null {
    if (actor === null) return null;
    return this.records.find(record => record.actor?.id.equals(actor))?.entity ?? this.host.foreign(actor);
  }

  private reactionOther(actor: ActorId | null): DamageInflictor { return this.damageInflictor(actor); }

  useParticipant(actor: ActorId | null): UseParticipant | null {
    if (actor === null) return null;
    return this.damageInflictor(actor);
  }

  damageInflictor(actor: ActorId | null): DamageInflictor {
    if (actor === null) return this.record(1022).entity;
    const native = this.records.find(record => record.actor?.id.equals(actor));
    if (native !== undefined) return native.entity;
    return { kind: "shared-actor", actor, origin: () => {
      const body = this.host.bodies.read(actor);
      return this.host.actors.isLive(actor) && body !== null ? body.origin : null;
    } };
  }

  private bindCallbacks(record: SourceRecord): void {
    const actor = record.actor;
    if (actor === null) throw new Error("Cannot bind inactive Q3 record callbacks");
    const entity = record.entity;
    const pain = (reaction: PainReaction): undefined => { entity.pain?.(entity, this.reactionOther(reaction.attacker), reaction.damage); return undefined; };
    const die = (reaction: DeathReaction): undefined => {
      const call = this.host.damageCall();
      if (entity.die === null) throw new Error("G_Damage lethal target has no die callback");
      entity.die(entity, this.damageInflictor(reaction.inflictor), this.reactionOther(reaction.attacker), reaction.damage,
        call?.methodOfDeath ?? (reaction.attack?.cause.kind === "q3" ? reaction.attack.cause.meansOfDeath : 0)); return undefined;
    };
    this.host.callbacks.bind(actor, {
      think: () => { entity.nextthink = 0; if (entity.think === null) throw new Error("NULL ent->think"); entity.think(entity); return undefined; },
      touch: contact => {
        if (entity.touch === null) return undefined;
        const native = this.records.find(candidate => candidate.actor?.id.equals(contact.other));
        entity.touch(entity, native?.entity ?? this.damageInflictor(contact.other), contact); return undefined; },
      use: (_self, other, activator) => { entity.use?.(entity, this.useParticipant(other), this.useParticipant(activator)); return undefined; }, pain, die,
    });
  }

  private playerBinding(slot: number): PlayerAuthorityBinding {
    const backing = this.clientBacking[slot];
    if (backing === undefined) throw new RangeError("Q3 client backing slot outside 0..63");
    const { sourceStats, specialAmmo } = backing;
    const schema = statSchema(this.product);
    const body = (): BodyState => this.record(slot).entity.binding.body.read();
    const actor = (): OwnedActor => this.ensureActor(slot);
    const configure = (item: `${string}:${string}`, count: number, capacity: number): void => {
      this.host.inventory.configure(actor(), { item, count, capacity });
    };
    return {
      origin: () => body().origin, setOrigin: value => { this.host.bodies.write(actor(), { ...body(), origin: value }); },
      velocity: () => body().velocity, setVelocity: value => { this.host.bodies.write(actor(), { ...body(), velocity: value }); },
      stats: {
        read: index => {
          if (index === schema.health) return this.record(slot).entity.health;
          if (index === schema.armor) { const current = this.record(slot).actor; const armor = current === null ? null : this.host.combat.read(current.id)?.armor.regular;
            return armor === null || armor === undefined || armor.kind === "none" ? 0 : armor.points; }
          if (index === schema.weapons) { const current = this.record(slot).actor; if (current === null) return 0;
            return Q3_WEAPON_ITEMS.reduce((bits, weapon) => bits | (this.host.inventory.count(current.id, weapon.item) > 0 ? 1 << weapon.weapon : 0), 0); }
          const value = sourceStats[index]; if (value === undefined) throw new RangeError(`Q3 stat ${index} outside 0..15`); return value;
        },
        write: (index, value) => {
          if (index === schema.health) { this.host.combat.setHealth(actor(), value); return; }
          if (index === schema.armor) { const armor = this.host.combat.read(actor().id)?.armor.regular;
            if (armor === undefined || armor.kind === "none") this.host.combat.setRegularArmor(actor(), { kind: "q3", points: value, protection: Math.fround(0.66) });
            else this.host.combat.setRegularPoints(actor(), value); return; }
          if (index === schema.weapons) { for (const weapon of Q3_WEAPON_ITEMS) configure(weapon.item, value & (1 << weapon.weapon) ? 1 : 0, 1); return; }
          if (!Number.isInteger(index) || index < 0 || index >= 16) throw new RangeError(`Q3 stat ${index} outside 0..15`);
          sourceStats[index] = value;
        },
      },
      ammo: {
        read: index => { const weapon = q3WeaponItem(index); if (weapon?.ammo != null) { const current = this.record(slot).actor;
          return current === null ? 0 : this.host.inventory.count(current.id, weapon.ammo); }
          const value = specialAmmo[index]; if (value === undefined) throw new RangeError(`Q3 ammo ${index} outside 0..15`); return value; },
        write: (index, value) => { const weapon = q3WeaponItem(index); if (weapon?.ammo != null) {
          configure(weapon.ammo, value, 200); return; }
          if (!Number.isInteger(index) || index < 0 || index >= 16) throw new RangeError(`Q3 ammo ${index} outside 0..15`); specialAmmo[index] = value; },
      },
    };
  }
}
