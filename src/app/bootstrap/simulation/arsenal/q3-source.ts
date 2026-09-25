import { restoreLegacyQ3Source, type LegacyQ3Source } from "./q3-source-legacy.ts";
import type { Q3SelectedArsenalCheckpoint } from "./q3.ts";
import { expandQ3Invulnerability } from "../../../../content/q3/team-arena/client-think.ts";
import { q3InvulnerabilityPose } from "../../../../movement/q3/postures.ts";
import { dropQ3MovementTimers } from "../../../../movement/q3/move.ts";
import { clientPresentationConfig, cleanClientName, clientInfoValue } from "../../../../content/q3/team-arena/client-admission.ts";
import type { Q3Postures } from "../../../../movement/q3/types.ts";
import type { FixedMovementPose } from "../../../../contracts/movement.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { WeaponBehaviorProjectilePort } from "../../../../contracts/weapon-behavior.ts";
import type { ConfigStringStore } from "../../../../content/q3/base/game/utilities.ts";
import type { Q3SourcePresentationState } from "../q3/presentation.ts";
import { q3PoolModels, q3PoolPresentationState } from "../q3/presentation.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q3ArsenalRuntimeState } from "../../../../content/q3/foundation/arsenal.ts";
import type { Q3RecordHost } from "../../../../content/q3/base/records.ts";
import type { Q3WorldAdapterHost } from "../../../../content/q3/base/world-adapter.ts";
import type { Q3CombatBridgeHost } from "../../../../content/q3/base/combat-bridge.ts";
import type { EntityState } from "../../../../content/q3/base/shared/entity-state.ts";
import type { Team } from "../../../../content/q3/base/shared/definitions.ts";
import { Q3EntityRecords } from "../../../../content/q3/base/records.ts";
import { Q3WorldAdapter } from "../../../../content/q3/base/world-adapter.ts";
import { Q3CombatBridge } from "../../../../content/q3/base/combat-bridge.ts";
import { EntityPool, runThink } from "../../../../content/q3/base/game/entities.ts";
import { GameClient, GameEntity, MAX_CLIENTS } from "../../../../content/q3/base/game/state.ts";
import { GameRandom } from "../../../../content/q3/base/game/numeric.ts";
import { MissileRuntime } from "../../../../content/q3/base/game/missile.ts";
import { WeaponRuntime, invulnerabilityEffect, logAccuracyHit, q3WeaponDamageFactor } from "../../../../content/q3/base/game/weapon.ts";
import { PersonalPortalRuntime } from "../../../../content/q3/base/game/personal-portal.ts";
import { teleportPlayer } from "../../../../content/q3/base/game/misc.ts";
import { EntityEvent, EntityType, ItemType, PersistentIndex, Powerup, statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { playerStateToEntityState } from "../../../../content/q3/base/shared/snapshot-state.ts";
import { updateQ3ClientPowerups } from "../../../../content/q3/team-arena/client-effects.ts";
import { clientSpeedMultiplier, clientTimerActions } from "../../../../content/q3/team-arena/client-effects.ts";
import { canItemBeGrabbed, canQ3ArmorBeGrabbed, itemAt, itemList } from "../../../../content/q3/base/shared/items.ts";
import { pickupHoldable, pickupPersistentPowerup } from "../../../../content/q3/base/game/item-pickup.ts";
import { q3ItemInventory, type SourcePickupDescriptor, type SourcePickupAdmission } from "../../../../content/q3/base/game/item-lifecycle.ts";
import { returnQ3PersistentPowerup, tossQ3ClientPersistentPowerup } from "../../../../content/q3/base/game/death.ts";
import type { OriginalPickupOffer } from "../../../../contracts/original-pickups.ts";
import { TrajectoryType } from "../../../../content/q3/base/shared/trajectory.ts";
import { useQ3Holdable } from "../../../../content/q3/team-arena/client-events.ts";
import { captureQ3Graph, prepareQ3Graph, restoreQ3Graph } from "../../../../content/q3/base/game/save-state.ts";
import { readQ3Graph } from "../../../../content/q3/base/game/save-reader.ts";
import { q3GrappleVelocity } from "../../../../content/q3/base/game/grapple.ts";
import { qvmAngleVectors } from "../../../../core/qvm-math.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { savedActorId, readSavedActor } from "../../../../persistence/save-image.ts";
import { SaveReader } from "../../../../persistence/value.ts";
import type { ActorTraceQuery } from "../../../../content/q3/base/world.ts";
import type { WeaponStepInput } from "../../../../contracts/movement.ts";
import type { BodyState } from "../../../../contracts/world.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import { q3WeaponDelay } from "../../../../movement/q3/weapon.ts";
import type { DamageRequest } from "../../../../contracts/gameplay.ts";
import type { Q2Motion } from "../../../../content/q2/foundation/host.ts";
import type { SharedSolid } from "../physics.ts";
import { q3InvulnerabilityBlocks } from "../../../../content/q3/base/game/combat.ts";

/** Current destination pose only; source equipment and timers remain in their original private records. */
export interface Q3SelectedClientPose {
  readonly angles: Vec3;
  readonly viewHeight: number;
  readonly maxHealth: number;
  readonly team: Team;
  readonly quadUntil: number;
  readonly hasteUntil: number;
}

export interface Q3SelectedSourceHost extends Pick<Q3RecordHost, "actors" | "bodies" | "combat" | "inventory" | "callbacks">,
  Pick<Q3WorldAdapterHost, "queries" | "collision" | "curves" | "playerCurveClip">,
  Pick<Q3CombatBridgeHost, "combatProvider" | "damagePowerupOwner" | "inventoryProvider" | "movementProvider" | "armorContext" | "gameType" | "friendlyFire" | "knockback" | "intermissionQueued" | "checkHurtCarrier"> {
  readonly provider: ProviderId;
  readonly product: "baseq3" | "missionpack";
  readonly equipment: { readonly kind: "source" } | { readonly kind: "primary" };
  readonly weaponEffects?: { damageFactor(actor: ActorId): number; firingDelay(actor: ActorId, milliseconds: number, persistentPowerup: number): number; };
  readonly content: ProviderReference["content"];
  readonly configstrings: ConfigStringStore;
  userinfo(actor: ActorId): string;
  readonly weaponBehavior?: WeaponBehaviorProjectilePort;
  readonly maxClients: number;
  readonly seed: number;
  now(): number;
  worldActor(): OwnedActor;
  player(actor: ActorId): Q3SelectedClientPose | null;
  quadFactor(actor?: ActorId): number;
  proximityTimeout(): number;
  modelIndex(path: string): number;
  soundIndex(path: string): number;
  print(text: string): void;
  /** Called only for component-owned actors; the caller uses the selected source's frame cadence. */
  execute(actor: OwnedActor, step: (previous: number, time: number) => void): void;
  /** Original source events retain their fields and actor identity for the shared presentation path. */
  event(actor: OwnedActor, state: EntityState, time: number): void;
  /** Copies of changed source fields; body, health and ammunition already write their current owners. */
  clientChanged(actor: OwnedActor, before: Q3SelectedClientEffects, after: Q3SelectedClientEffects): void;
  checkObeliskAttack(target: GameEntity, attacker: GameEntity): boolean;
  dropObjectives(actor: OwnedActor): void;
  returnPickup(actor: ActorId): void;
  spawnPoint(actor: OwnedActor): { readonly origin: Vec3; readonly angles: Vec3 };
}

export interface Q3SelectedClientEffects {
  readonly teleportBit: number;
  readonly viewAngles: Vec3;
  readonly deltaAngles: Vec3;
  readonly pmFlags: number;
  readonly pmTime: number;
  readonly invulnerabilityTime: number;
  readonly maxHealth: number;
}

export type Q3SelectedEquipmentState = Pick<Q3ArsenalRuntimeState, "maxHealth" | "persistentPowerupTag" | "holdableItem" | "holdableTag">;


const zero = { x: 0, y: 0, z: 0 };
function clientEffects(client: GameClient): Q3SelectedClientEffects {
  return { teleportBit: client.ps.eFlags & 4, viewAngles: { ...client.ps.viewangles }, deltaAngles: { ...client.ps.deltaAngles }, pmFlags: client.ps.pmFlags,
    pmTime: client.ps.pmTime, invulnerabilityTime: client.invulnerabilityTime,
    maxHealth: client.ps.stats.get(statSchema(client.ps.product).maxHealth) };
}
function sameEffects(a: Q3SelectedClientEffects, b: Q3SelectedClientEffects): boolean {
  return a.teleportBit === b.teleportBit && a.pmFlags === b.pmFlags && a.pmTime === b.pmTime && a.invulnerabilityTime === b.invulnerabilityTime && a.maxHealth === b.maxHealth
    && a.viewAngles.x === b.viewAngles.x && a.viewAngles.y === b.viewAngles.y && a.viewAngles.z === b.viewAngles.z
    && a.deltaAngles.x === b.deltaAngles.x && a.deltaAngles.y === b.deltaAngles.y && a.deltaAngles.z === b.deltaAngles.z;
}

/** Original Q3 weapon/equipment records over actors admitted by their actual world. */
export class Q3SelectedSource {
  readonly records: Q3EntityRecords;
  readonly pool: EntityPool;
  readonly world: Q3WorldAdapter;
  readonly bridge: Q3CombatBridge;
  readonly missiles: MissileRuntime;
  readonly weapons: WeaponRuntime;
  readonly personalPortal: PersonalPortalRuntime | null;
  readonly random: GameRandom;
  private readonly projected = new Map<OwnedActor, number>();
  private readonly clientEffects = new Map<OwnedActor, Q3SelectedClientEffects>();
  private depth = 0;
  private readonly executing = new Set<OwnedActor>();
  private readonly published = new Map<OwnedActor, { readonly event: number; readonly time: number }>();
  private readonly unobserve: () => undefined;
  private previous = 0;
  private clock: number | null = null;
  private closed = false;
  private revision = 0;
  get generation(): number { return this.revision; }
  get ownsEquipment(): boolean { return this.host.equipment.kind === "source"; }
  private restoredPresentation: Q3SourcePresentationState | null = null;
  get presentationBaseline(): Q3SourcePresentationState | null { return this.restoredPresentation; }

  constructor(readonly host: Q3SelectedSourceHost, restored?: unknown) {
    const source = this;
    this.random = new GameRandom(host.seed);
    this.records = new Q3EntityRecords({ actors: host.actors, bodies: host.bodies, combat: host.combat, inventory: host.inventory, callbacks: host.callbacks,
      schedule: actor => { this.track(actor); return undefined; }, runThink: (actor, time) => {
        const entity = this.records.nativeByActor(actor.id);
        if (entity === null || !this.owns(actor)) throw new Error("Selected Q3 think actor is retired");
        const previous = this.clock; this.clock = time;
        try { entity.nextthink = 0; if (entity.think === null) throw new Error("NULL ent->think"); entity.think(entity); }
        finally { this.clock = previous; }
        return undefined;
      }, damageCall: () => this.bridge.currentCall, foreign: actor => this.project(actor), isPlayer: actor => host.player(actor) !== null }, host.provider, host.product);
    this.world = new class extends Q3WorldAdapter {
      override traceActor(input: ActorTraceQuery) {
        const trace = super.traceActor(input);
        if (trace.hit.kind === "actor") source.project(trace.hit.actor);
        return trace;
      }
    }({ queries: host.queries, bodies: host.bodies, collision: (actor, collision) => source.owns(actor) ? host.collision(actor, collision) : undefined,
      curves: host.curves, playerCurveClip: host.playerCurveClip }, this.records);
    this.pool = new EntityPool({ records: this.records, product: host.product, maxClients: host.maxClients,
      mapStartTime: host.now(), time: () => this.now(), print: host.print,
      link: entity => { this.world.link(entity); this.track(entity.actor); }, unlink: entity => this.world.unlink(entity.slot) });
    this.bridge = new Q3CombatBridge({ product: host.product, authority: host.combat, entities: this.pool, records: this.records, world: this.world,
      ...(host.damagePowerupOwner === undefined ? {} : { damagePowerupOwner: host.damagePowerupOwner }),
      weaponProvider: host.provider, combatProvider: host.combatProvider, inventoryProvider: host.inventoryProvider, movementProvider: host.movementProvider,
      armorContext: host.armorContext, time: () => this.now(), intermissionQueued: host.intermissionQueued, gameType: host.gameType, friendlyFire: host.friendlyFire,
      knockback: host.knockback, debugDamage: null, checkHurtCarrier: host.checkHurtCarrier, checkObeliskAttack: host.checkObeliskAttack,
      logAccuracyHit: (target, attacker) => logAccuracyHit(host.gameType(), target, attacker), projectileParent: actor => this.missiles.ownerOf(actor),
      invulnerabilityEffect: (target, direction, point) => { invulnerabilityEffect(this.pool, target, direction, point); } });
    const combat = this.bridge.context;
    this.missiles = new MissileRuntime({ ...(host.weaponBehavior === undefined ? {} : { weaponBehavior: host.weaponBehavior }), world: this.world, bodies: host.bodies, actors: host.actors,
      get previousTime() { return source.previous; }, ...(combat.product === "baseq3" ? { combat, missionpack: null } : { combat, missionpack: { get proxMineTimeout() { return host.proximityTimeout(); }, random: this.random,
        soundIndex: host.soundIndex, invulnerabilityImpact: (target, direction, point) => invulnerabilityEffect(this.pool, target, direction, point) } }) });
    this.weapons = new WeaponRuntime({ missiles: this.missiles, random: this.random, unlink: actor => this.world.unlinkActor(actor), get quadFactor() { return host.quadFactor(); },
      damageFactor: entity => {
        if (host.weaponEffects !== undefined) {
          const sourceFactor = this.ownsEquipment && entity.client?.persistantPowerup?.item?.tag === Powerup.PW_DOUBLER ? 2 : 1;
          return Math.fround(host.weaponEffects.damageFactor(entity.actor.id) * sourceFactor);
        }
        if (entity.client === null) throw new Error("Selected weapon damage has no source client");
        return q3WeaponDamageFactor(entity.client, host.quadFactor(entity.actor.id), host.product);
      } });
    this.personalPortal = combat.product === "baseq3" ? null : new PersonalPortalRuntime({ combat, world: this.world, models: { modelIndex: host.modelIndex }, random: this.random,
      mapTravel: { dropCarriedFlag: entity => host.dropObjectives(entity.actor), teleport: (entity, origin, angles) => this.teleport(entity, origin, angles) } });
    this.unobserve = host.actors.onRelease(actor => {
      this.executing.delete(actor); this.published.delete(actor); this.clientEffects.delete(actor);
      const slot = this.projected.get(actor); this.projected.delete(actor);
      if (slot !== undefined) { if (slot < this.host.maxClients) { this.returnPersistent(this.pool.at(slot)); this.host.configstrings.set(544 + slot, ""); } this.records.release(this.pool.at(slot)); }
      return undefined;
    });
    if (restored !== undefined) this.restore(restored);
  }

  private bindWorld(): void {
    const world = this.host.worldActor(), current = this.records.nativeByActor(world.id);
    if (current === null) this.records.attach(1022, world, false);
    else if (current.slot !== 1022) throw new Error("Selected Q3 world actor changed its source slot");
  }

  private now(): number { return this.clock ?? this.host.now(); }
  get active(): boolean { return !this.closed; }
  actor(slot: number): ActorId | null {
    if (this.closed) return null;
    const entity = this.records.get(slot);
    return entity?.inuse === true && this.host.actors.isLive(entity.actor.id) ? entity.actor.id : null;
  }
  live(actor: ActorId): boolean { return !this.closed && this.host.actors.isLive(actor) && this.records.nativeByActor(actor) !== null; }
  private assertOpen(): void { if (this.closed) throw new Error("Selected Q3 source is closed"); }
  private owns(actor: OwnedActor): boolean { return actor.owner === this.host.provider && this.records.nativeByActor(actor.id) !== null; }
  motion(actor: OwnedActor, body: BodyState): Q2Motion {
    const entity = this.records.nativeByActor(actor.id);
    if (entity === null || !this.owns(actor)) throw new Error("Selected Q3 motion actor is retired");
    return { actor, kind: "stationary", velocity: body.velocity, angularVelocity: zero, gravity: 1, gravityVector: { x: 0, y: 0, z: -1 },
      clipMask: entity.clipmask, owner: this.records.get(entity.r.ownerNum)?.inuse ? this.records.get(entity.r.ownerNum)?.actor.id ?? null : null };
  }
  collision(actor: OwnedActor): SharedSolid {
    const entity = this.records.nativeByActor(actor.id);
    if (entity === null || !this.owns(actor)) throw new Error("Selected Q3 collision actor is retired");
    return { family: "q3", solid: entity.r.contents === 0 ? "none" : entity.r.contents === 0x40000000 ? "trigger" : entity.r.model.kind === "inline" ? "brush" : "box",
      model: entity.r.model.kind === "inline" ? entity.r.model.index : null,
      owner: this.records.get(entity.r.ownerNum)?.inuse ? this.records.get(entity.r.ownerNum)?.actor.id ?? null : null };
  }
  fixedPose(actor: OwnedActor, postures: Q3Postures): FixedMovementPose | null {
    const entity = this.player(actor), client = entity.client;
    if (client === null) throw new Error("Selected Q3 pose has no source client");
    if (client.invulnerabilityTime <= this.now()) { client.ps.pmFlags &= ~MoveFlags.INVULEXPAND; return null; }
    updateQ3ClientPowerups({ combat: this.bridge.context }, client);
    expandQ3Invulnerability(this.pool, this.world, entity);
    return q3InvulnerabilityPose((client.ps.pmFlags & MoveFlags.INVULEXPAND) !== 0, postures);
  }
  advanceMovement(actor: OwnedActor, milliseconds: number): void {
    const entity = this.player(actor);
    if (entity.client === null) throw new Error("Selected Q3 movement clock has no source client");
    dropQ3MovementTimers(entity.client.ps, milliseconds);
    this.publishClient(entity, entity.client);
  }
  endCommand(actor: OwnedActor, milliseconds: number): void {
    if (!this.ownsEquipment) return;
    const entity = this.player(actor);
    if (entity.health <= 0) return;
    this.run(() => clientTimerActions({ combat: this.bridge.context }, entity, milliseconds, { ordinaryDecay: false, ammo: null }));
  }
  blocksDamage(request: DamageRequest): boolean {
    this.assertOpen(); const target = this.records.nativeByActor(request.target);
    return target === null ? false : this.run(() => q3InvulnerabilityBlocks(this.bridge.context, target, request.direction, request.point,
      request.attack.cause.kind === "q3" ? request.attack.cause.meansOfDeath : -1));
  }
  private track(actor: OwnedActor): void {
    if (!this.owns(actor) || this.executing.has(actor)) return;
    this.executing.add(actor); this.host.execute(actor, (previous, time) => this.step(actor, previous, time));
  }
  private project(actor: ActorId): GameEntity | null {
    const owned = this.host.actors.resolveOwned(actor);
    if (owned === null) return null;
    const current = this.records.nativeByActor(actor); if (current !== null) return current;
    if (this.host.bodies.read(actor) === null) throw new Error("Q3 source projection requires the existing actor body");
    const pose = this.host.player(actor);
    let slot = pose === null ? MAX_CLIENTS : 0;
    const end = pose === null ? 1022 : this.host.maxClients;
    while (slot < end && this.pool.at(slot).inuse) slot++;
    if (slot >= end) throw new Error("Selected Q3 source projection capacity exceeded");
    const entity = this.records.attach(slot, owned, pose !== null); this.projected.set(owned, slot);
    if (slot >= this.pool.numEntities) this.pool.restoreCounts({ numEntities: slot + 1, maxClients: this.host.maxClients });
    if (pose !== null) {
      const client = this.records.client(slot), ps = client.ps, fresh = new GameClient(this.host.product);
      Object.assign(client, fresh, { ps }); ps.copyFrom(fresh.ps, "preserve-authority");
      this.records.restoreClientBacking(slot, { sourceStats: Array.from({ length: 16 }, () => 0), specialAmmo: Array.from({ length: 16 }, () => 0) });
      entity.s.eType = EntityType.ET_PLAYER; entity.s.clientNum = slot; ps.clientNum = slot;
    }
    this.refresh(entity); return entity;
  }
  private refresh(entity: GameEntity): void {
    const body = this.host.bodies.read(entity.actor.id); if (body === null) throw new Error("Selected Q3 projected body was removed");
    entity.s.pos = { type: TrajectoryType.TR_STATIONARY, time: 0, duration: 0, base: { ...body.origin }, delta: zero };
    entity.s.apos = { type: TrajectoryType.TR_STATIONARY, time: 0, duration: 0, base: { ...body.angles }, delta: zero };
    const client = entity.client, pose = this.host.player(entity.actor.id);
    if (client === null || pose === null) return;
    this.publishClient(entity, client);
    client.ps.viewangles = { ...pose.angles }; client.ps.viewheight = pose.viewHeight; client.sess.sessionTeam = pose.team;
    client.pers.maxHealth = pose.maxHealth; client.ps.persistant.set(PersistentIndex.PERS_TEAM, pose.team);
    client.ps.stats.set(statSchema(this.host.product).maxHealth, pose.maxHealth);
    client.ps.powerups.set(Powerup.PW_QUAD, pose.quadUntil); client.ps.powerups.set(Powerup.PW_HASTE, pose.hasteUntil);
    client.pers.netname = cleanClientName(clientInfoValue(this.host.userinfo(entity.actor.id), "name"));
    this.host.configstrings.set(544 + entity.slot, clientPresentationConfig(client, this.host.userinfo(entity.actor.id), this.host.gameType(), null));
    this.clientEffects.set(entity.actor, clientEffects(client));
  }
  private player(actor: OwnedActor): GameEntity {
    this.assertOpen(); this.host.actors.assertOwned(actor);
    this.bindWorld();
    const entity = this.project(actor.id);
    if (entity?.client == null) throw new Error("Selected Q3 arsenal requires an admitted player");
    this.refresh(entity); return entity;
  }
  admit(actor: OwnedActor): void { this.player(actor); }
  respawn(actor: ActorId): undefined {
    this.assertOpen();
    const entity = this.records.nativeByActor(actor), client = entity?.client;
    if (entity === null || client == null) return undefined;
    this.releaseHook(actor);
    this.returnPersistent(entity);
    this.run(() => {
      const { pers, sess, ps, accuracyHits, accuracyShots } = client;
      const persistant = ps.persistant.copy(), eventSequence = ps.eventSequence, ping = ps.ping;
      const fresh = new GameClient(this.host.product);
      Object.assign(client, fresh, { pers, sess, ps, accuracyHits, accuracyShots }); ps.copyFrom(fresh.ps, "preserve-authority");
      for (const [index, value] of persistant.entries()) ps.persistant.set(index, value);
      ps.eventSequence = eventSequence; ps.ping = ping; ps.clientNum = entity.slot;
      this.clientEffects.delete(entity.actor);
      this.refresh(entity);
    });
    return undefined;
  }
  gauntletHit(actor: OwnedActor): boolean { const player = this.player(actor); return this.run(() => this.weapons.checkGauntletAttack(player)); }
  command(actor: OwnedActor, attack: boolean, selected: boolean, alive: boolean): void {
    const player = this.player(actor), client = player.client;
    if (client === null) throw new Error("Missing selected Q3 client");
    this.run(() => {
      if (!attack || !alive) client.fireHeld = false;
      if ((!attack || !selected || !alive) && client.hook !== null) this.missiles.hookFree(client.hook);
    });
  }
  releaseHook(actor: ActorId): void {
    this.assertOpen(); const client = this.records.nativeByActor(actor)?.client;
    const hook = client?.hook;
    if (hook != null) this.run(() => this.missiles.hookFree(hook));
  }
  grapplePoint(actor: ActorId): Vec3 | null {
    const client = this.records.nativeByActor(actor)?.client;
    return client != null && (client.ps.pmFlags & MoveFlags.GRAPPLE_PULL) !== 0 ? { ...client.ps.grapplePoint } : null;
  }
  pull(actor: OwnedActor): Vec3 | null {
    const point = this.grapplePoint(actor.id), body = this.host.bodies.read(actor.id), pose = this.host.player(actor.id);
    return point === null || body === null || pose === null ? null : q3GrappleVelocity(body.origin, point, qvmAngleVectors(pose.angles).forward);
  }
  equipment(actor: OwnedActor): Q3SelectedEquipmentState {
    const entity = this.player(actor), client = entity.client;
    if (client === null) throw new Error("Missing selected Q3 client");
    const schema = statSchema(this.host.product);
    const holdableItem = client.ps.stats.get(schema.holdableItem);
    return { maxHealth: client.ps.stats.get(schema.maxHealth), persistentPowerupTag: schema.product === "baseq3" ? Powerup.PW_NONE : itemAt(this.host.product, client.ps.stats.get(schema.persistentPowerup)).tag,
      holdableItem, holdableTag: itemAt(this.host.product, holdableItem).tag };
  }
  inventory(actor: OwnedActor): readonly { readonly item: ItemId; readonly label: string; readonly count: number; readonly usable: boolean; readonly icon: string | null }[] {
    if (!this.ownsEquipment) return [];
    const equipment = this.equipment(actor), items = itemList(this.host.product);
    return items.flatMap((item, index) => {
      const held = item.type === ItemType.IT_HOLDABLE && index === equipment.holdableItem;
      const persistent = item.type === ItemType.IT_PERSISTANT_POWERUP && item.tag === equipment.persistentPowerupTag;
      if ((!held && !persistent) || item.className === null || item.pickupName === null) return [];
      const id: ItemId = `q3:${item.className}`;
      return [{ item: id, label: item.pickupName, count: 1, usable: held, icon: item.icon }];
    });
  }
  firingDelay(actor: OwnedActor, milliseconds: number): number {
    const entity = this.player(actor), client = entity.client;
    if (client === null) throw new Error("Selected firing delay requires its source client");
    const persistent = this.ownsEquipment ? client.persistantPowerup?.item?.tag ?? 0 : 0;
    return this.host.weaponEffects?.firingDelay(actor.id, milliseconds, persistent)
      ?? q3WeaponDelay(milliseconds, persistent, client.ps.powerups.get(Powerup.PW_HASTE) !== 0);
  }
  speedMultiplier(actor: ActorId): number {
    const client = this.records.nativeByActor(actor)?.client;
    return client == null ? 1 : clientSpeedMultiplier(client.ps);
  }
  pickupAllowed(offer: OriginalPickupOffer): boolean {
    if (!this.ownsEquipment) return true;
    if (offer.defaultResource?.kind !== "protection" || offer.defaultResource.channel !== "regular") return true;
    const client = this.records.nativeByActor(offer.recipient)?.client;
    if (client == null || client.ps.product !== "missionpack") return true;
    const inventory = q3ItemInventory(client);
    if (inventory.product !== "missionpack") return true;
    const tag = itemAt("missionpack", inventory.persistentPowerupIndex).tag;
    return tag !== Powerup.PW_SCOUT && tag !== Powerup.PW_GUARD || canQ3ArmorBeGrabbed(inventory);
  }
  takePickup(offer: SourcePickupDescriptor): SourcePickupAdmission {
    if (!this.ownsEquipment) return { kind: "native" };
    if (offer.item.type !== ItemType.IT_HOLDABLE && offer.item.type !== ItemType.IT_PERSISTANT_POWERUP) return { kind: "native" };
    const item = itemList(this.host.product).find(item => item.className === offer.item.className);
    if (item === undefined) return { kind: "rejected" };
    const actor = this.host.actors.resolveOwned(offer.playerActor);
    if (actor === null || !this.host.actors.isLive(offer.itemActor)) return { kind: "rejected" };
    const player = this.player(actor), client = player.client;
    if (client === null) throw new Error("Original equipment pickup requires a source client");
    const modelIndex = itemList(this.host.product).indexOf(item);
    if (!canItemBeGrabbed(offer.gameType, { modelIndex, modelIndex2: offer.dropped ? 1 : 0, generic1: offer.generic1 }, q3ItemInventory(client))) return { kind: "rejected" };
    const pickup = this.project(offer.itemActor);
    if (pickup === null) return { kind: "rejected" };
    pickup.item = item; pickup.count = offer.count; pickup.s.modelindex = modelIndex; pickup.s.generic1 = offer.generic1;
    const respawnSeconds = this.run(() => item.type === ItemType.IT_HOLDABLE ? pickupHoldable(pickup, player)
      : pickupPersistentPowerup(pickup, player, clientInfoValue(this.host.userinfo(actor.id), "handicap")));
    return { kind: "picked", respawnSeconds };
  }
  private returnPersistent(entity: GameEntity): void {
    tossQ3ClientPersistentPowerup(entity, pickup => {
      if (!pickup.inuse) return;
      if (this.owns(pickup.actor)) returnQ3PersistentPowerup(pickup, this.world);
      else this.host.returnPickup(pickup.actor.id);
    });
  }
  died(actor: ActorId): void {
    const entity = this.records.nativeByActor(actor);
    if (entity?.client != null) this.run(() => this.returnPersistent(entity));
  }
  consume(actor: OwnedActor, item: number): undefined {
    const entity = this.player(actor), client = entity.client;
    if (client === null || client.ps.stats.get(statSchema(this.host.product).holdableItem) !== item || itemAt(this.host.product, item).type !== ItemType.IT_HOLDABLE)
      throw new Error("Selected Q3 holdable consumption differs from its current source item");
    client.ps.stats.set(statSchema(this.host.product).holdableItem, 0); return undefined;
  }
  giveHoldable(actor: OwnedActor, name: string): boolean {
    if (!this.ownsEquipment) return false;
    const item = itemList(this.host.product).find(item => item.type === ItemType.IT_HOLDABLE &&
      (item.className?.toLowerCase() === name.toLowerCase() || item.pickupName?.toLowerCase() === name.toLowerCase()));
    if (item === undefined) return false;
    const player = this.player(actor);
    this.run(() => {
      const pickup = this.pool.spawn();
      try { pickup.item = item; pickupHoldable(pickup, player); }
      finally { if (pickup.inuse) this.pool.free(pickup); }
    });
    return true;
  }
  restoreEquipment(actor: OwnedActor, saved: Q3SelectedEquipmentState): void {
    this.assertOpen(); this.host.actors.assertOwned(actor);
    const client = this.records.nativeByActor(actor.id)?.client;
    if (client == null) throw new Error("Restored selected equipment has no source client");
    const item = itemAt(this.host.product, saved.holdableItem);
    if (saved.holdableItem !== 0 && (item.type !== ItemType.IT_HOLDABLE || item.tag !== saved.holdableTag)) throw new Error("Restored selected holdable differs from its source item");
    client.ps.stats.set(statSchema(this.host.product).holdableItem, saved.holdableItem);
  }
  fire(actor: OwnedActor, weapon: number, _input: WeaponStepInput): undefined {
    const entity = this.player(actor); entity.s.weapon = weapon;
    if (entity.client === null) throw new Error("Missing selected Q3 client");
    entity.client.ps.weapon = weapon;
    this.pool.addPredictableEvent(entity, EntityEvent.EV_FIRE_WEAPON); entity.eventTime = this.now();
    this.run(() => this.weapons.fire(entity)); return undefined;
  }
  useHoldable(actor: OwnedActor, event: number): undefined {
    const entity = this.player(actor), combat = this.bridge.context;
    this.pool.addPredictableEvent(entity, event); entity.eventTime = this.now();
    const teleport = (player: GameEntity): void => {
      this.host.dropObjectives(player.actor); const spawn = this.host.spawnPoint(player.actor); this.teleport(player, spawn.origin, spawn.angles);
    };
    this.run(() => {
      if (combat.product === "baseq3") useQ3Holdable({ product: "baseq3", combat, weapons: this.weapons, teleport }, entity, event);
      else {
        if (this.personalPortal === null) throw new Error("Missionpack holdable has no portal service");
        useQ3Holdable({ product: "missionpack", combat, weapons: this.weapons, personalPortal: this.personalPortal, teleport }, entity, event);
      }
    });
    return undefined;
  }
  private teleport(entity: GameEntity, origin: Vec3, angles: Vec3): void {
    teleportPlayer({ combat: this.bridge.context, world: this.world }, entity, origin, angles);
  }
  private step(actor: OwnedActor, previous: number, time: number): void {
    if (this.closed || !this.host.actors.isLive(actor.id) || !this.owns(actor)) return;
    const prior = this.clock, priorPrevious = this.previous; this.clock = time; this.previous = previous;
    try {
      for (const [borrowed, slot] of this.projected) if (this.host.actors.isLive(borrowed.id)) this.refresh(this.pool.at(slot));
      const entity = this.records.nativeByActor(actor.id);
      this.run(() => { if (entity !== null && this.pool.expireEvents(entity) === "active" && !this.missiles.runOwned(actor)) runThink(entity, time); });
    } finally { this.clock = prior; this.previous = priorPrevious; }
  }
  private run<T>(operation: () => T): T {
    this.assertOpen(); this.depth++;
    try {
      let result: { readonly kind: "value"; readonly value: T } | { readonly kind: "error"; readonly error: unknown };
      try { result = { kind: "value", value: operation() }; } catch (error) { result = { kind: "error", error }; }
      try { this.publish(); } catch (error) {
        if (result.kind === "error") throw new AggregateError([result.error, error], "Selected Q3 call and publication failed");
        throw error;
      }
      if (result.kind === "error") throw result.error;
      return result.value;
    } finally { this.depth--; }
  }
  /** Publish original shared touch/reaction callbacks before the next destination client command. */
  synchronize(): void { this.assertOpen(); this.publish(); }
  private publishClient(entity: GameEntity, client: GameClient): void {
    const after = clientEffects(client), before = this.clientEffects.get(entity.actor);
    this.clientEffects.set(entity.actor, after);
    if (before !== undefined && !sameEffects(before, after)) this.host.clientChanged(entity.actor, before, after);
  }
  private publish(): void {
    for (let slot = 0; slot < this.pool.numEntities; slot++) {
      const entity = this.pool.at(slot); if (!entity.inuse) continue;
      if (entity.client !== null) {
        this.publishClient(entity, entity.client);
        updateQ3ClientPowerups({ combat: this.bridge.context }, entity.client);
        playerStateToEntityState(entity.client.ps, entity.s, true);
      } else {
        if (!this.owns(entity.actor)) continue;
        this.track(entity.actor);
      }
      const event = entity.s.eType >= EntityType.ET_EVENTS ? entity.s.eType - EntityType.ET_EVENTS : entity.s.event;
      const previous = this.published.get(entity.actor);
      if (event === 0 || previous?.event === event && previous.time === entity.eventTime) continue;
      this.published.set(entity.actor, { event, time: entity.eventTime }); this.host.event(entity.actor, entity.s.copy(), entity.eventTime);
    }
  }
  sourceState() { return q3PoolPresentationState(this.pool, this.host.product, this.now(), this.host.configstrings); }
  presentations() { return q3PoolModels(this.pool, this.host.product, this.now(), this.host.content, this.host.configstrings); }
  capture() {
    this.assertOpen(); if (this.depth !== 0) throw new Error("Cannot save selected Q3 during a source call");
    this.bindWorld();
    return { version: 1, provider: this.host.provider, product: this.host.product, graph: captureQ3Graph(this.records, this.pool), bridge: this.bridge.captureSaveState(),
      missiles: this.missiles.captureSaveState(), personalPortal: this.personalPortal?.captureSaveState() ?? null, random: this.random.seed,
      published: [...this.published].map(([actor, value]) => ({ actor: savedActorId(actor.id), ...value })) };
  }
  restoreLegacy(saved: LegacyQ3Source, clients: readonly { readonly actor: OwnedActor; readonly state: Q3SelectedArsenalCheckpoint }[]): void {
    this.assertOpen();
    if (this.depth !== 0 || this.projected.size !== 0 || this.executing.size !== 0 || this.host.product !== "baseq3")
      throw new Error("Legacy Q3 restore requires an unused base source owner");
    this.bindWorld();
    for (const { actor, state } of clients) {
      if (state.runtime.product !== "baseq3" || state.arsenal.provider !== this.host.provider || state.arsenal.state.kind !== "q3")
        throw new Error("Legacy Q3 player arsenal differs from its source");
      const entity = this.player(actor), client = entity.client;
      if (client === null) throw new Error("Legacy Q3 player lost its source client");
      this.restoreEquipment(actor, state.runtime);
      const weapon = state.arsenal.state;
      client.ps.weapon = weapon.sourceWeapon; client.ps.weaponState = weapon.state; client.ps.weaponTime = weapon.timeMilliseconds;
      client.ps.torsoAnim = state.torsoAnimation; client.ps.eventSequence = state.runtime.eventSequence;
      client.ps.entityEventSequence = state.runtime.eventSequence;
      entity.s.weapon = weapon.sourceWeapon;
    }
    restoreLegacyQ3Source(this, saved, actor => this.project(actor));
    for (const { actor } of saved.projectiles) {
      const entity = this.records.nativeByActor(actor.id);
      if (entity === null) throw new Error("Imported Q3 projectile disappeared");
      this.track(actor);
      if (entity.s.event !== 0) this.published.set(actor, { event: entity.s.event, time: entity.eventTime });
    }
    this.restoredPresentation = this.sourceState(); this.revision++;
  }

  restore(value: unknown): void {
    this.assertOpen();
    if (this.depth !== 0 || this.projected.size !== 0 || this.executing.size !== 0) throw new Error("Selected Q3 restore requires an unused source owner");
    const reader = new SaveReader(value, "selected Q3 source"); reader.field("version").literal(1); reader.field("provider").literal(this.host.provider);
    if ((reader.field("product").value === undefined ? "missionpack" : reader.field("product").choice("baseq3", "missionpack")) !== this.host.product) reader.fail("Saved Q3 equipment product changed");
    const graph = readQ3Graph(reader.field("graph").value);
    prepareQ3Graph(this.records, graph, this.host.actors); restoreQ3Graph(this.records, this.pool, graph, this.host.actors);
    this.bridge.restoreSaveState(reader.field("bridge").value);
    if (this.personalPortal !== null) this.personalPortal.restoreSaveState(reader.field("personalPortal").value);
    else if (reader.field("personalPortal").value !== null) reader.fail("Base Q3 equipment has missionpack portal state");
    this.missiles.restoreSaveState(reader.field("missiles").value, actor => this.host.actors.referenceSaved(actor)); this.random.reset(reader.field("random").integer());
    for (const entry of reader.field("published").list(entry => {
      const actor = this.host.actors.resolveSaved(readSavedActor(entry.field("actor")));
      if (actor === null || this.records.nativeByActor(actor.id) === null) return entry.fail("Published event has no live selected source actor");
      return { actor, event: entry.field("event").integer(), time: entry.field("time").integer() };
    })) {
      if (this.published.has(entry.actor)) reader.fail("Duplicate published source event");
      this.published.set(entry.actor, { event: entry.event, time: entry.time });
    }
    const world = this.records.nativeByActor(this.host.worldActor().id);
    if (world?.slot !== 1022) reader.fail("Restored selected Q3 world actor differs from the current map");
    for (const [slot, record] of this.records.captureOwnership().entries()) if (record.actor !== null) {
      if (record.borrowed && slot !== 1022) { this.projected.set(record.actor, slot);
        const client = this.pool.at(slot).client; if (client !== null) this.clientEffects.set(record.actor, clientEffects(client)); }
      else if (!record.borrowed) this.track(record.actor);
    }
    this.restoredPresentation = this.sourceState(); this.revision++;
  }
  close(): void {
    if (this.closed) return;
    if (this.depth !== 0) throw new Error("Cannot close selected Q3 during a source call");
    const errors: unknown[] = [];
    for (const slot of this.projected.values()) if (slot < this.host.maxClients) try { this.returnPersistent(this.pool.at(slot)); } catch (error) { errors.push(error); }
    this.closed = true;
    for (const record of this.records.captureOwnership()) if (record.actor !== null && !record.borrowed && this.host.actors.isLive(record.actor.id))
      try { this.host.actors.release(record.actor); } catch (error) { errors.push(error); }
    for (const dispose of [() => this.missiles.close(), () => this.records.close(), this.unobserve]) try { dispose(); } catch (error) { errors.push(error); }
    this.projected.clear(); this.executing.clear(); this.published.clear(); this.clientEffects.clear();
    if (errors.length !== 0) throw new AggregateError(errors, "Selected Q3 source close failed");
  }
}
