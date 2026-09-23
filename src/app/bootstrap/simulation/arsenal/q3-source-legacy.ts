import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import { Q1_Q3_SUPPLY_PROFILE } from "../../../../content/composition/q1-q3-supply.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../../content/composition/q2-q3-supply.ts";
import { expansionSourceSupply } from "../../../../content/composition/expansion-source-supply.ts";
import { EntityEvent, EntityType, PersistentIndex } from "../../../../content/q3/base/shared/definitions.ts";
import { directionToByte } from "../../../../content/q3/base/shared/direction-byte.ts";
import { ServerEntityFlags } from "../../../../content/q3/base/shared/entity-shared.ts";
import { ENTITYNUM_NONE } from "../../../../content/q3/base/shared/player-state.ts";
import type { GameEntity } from "../../../../content/q3/base/game/state.ts";
import { MAX_CLIENTS } from "../../../../content/q3/base/game/state.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { savedActorId } from "../../../../persistence/save-image.ts";
import type { SaveReader } from "../../../../persistence/value.ts";
import { readQ3ProjectileStates, readQ3WeaponStatistics } from "../q3-ballistics.ts";
import type { Q3SelectedArsenalCheckpoint } from "./q3.ts";
import type { Q3SelectedSource } from "./q3-source.ts";

export function readLegacyQ3Source(reader: SaveReader, owner: (reader: SaveReader) => OwnedActor,
  reference: (saved: SavedActorId) => ActorId) {
  return { milliseconds: reader.field("milliseconds").finite(), randomSeed: reader.field("randomSeed").integer(),
    projectiles: readQ3ProjectileStates(reader.field("projectiles"), owner, reference),
    statistics: readQ3WeaponStatistics(reader.field("weaponStatistics"), owner),
    hookHeld: reader.field("hookHeld").value === undefined ? [] : reader.field("hookHeld").list(owner) };
}
export type LegacyQ3Source = ReturnType<typeof readLegacyQ3Source>;

export function migrateLegacyQ3Arsenal(checkpoint: Q3SelectedArsenalCheckpoint, map: "q1" | "q2"): Q3SelectedArsenalCheckpoint {
  const profile = map === "q1" ? Q1_Q3_SUPPLY_PROFILE : Q2_Q3_SUPPLY_PROFILE;
  if (checkpoint.runtime.product !== "baseq3" || checkpoint.supplyProfile !== profile.id)
    throw new Error("Legacy Q3 arsenal does not match its original base supply profile");
  return { ...checkpoint, supplyProfile: expansionSourceSupply(profile).id };
}

/** One-time checkpoint import; all subsequent execution belongs to the original MissileRuntime. */
export function restoreLegacyQ3Source(source: Pick<Q3SelectedSource, "host" | "records" | "pool" | "missiles" | "random">,
  saved: LegacyQ3Source, project: (actor: ActorId) => GameEntity | null): void {
  const { host, records, pool } = source;
  if (host.product !== "baseq3") throw new Error("Legacy ballistics require the base Q3 source");
  const actors = new Set<OwnedActor>(), hooks = new Set<ActorId>(), references = new Set<ActorId>();
  for (const state of saved.projectiles) {
    host.actors.assertOwned(state.actor);
    if (state.actor.owner !== host.provider || actors.has(state.actor) || records.nativeByActor(state.actor.id) !== null
      || host.bodies.read(state.actor.id) === null) throw new Error("Legacy projectile has no unique owned body");
    actors.add(state.actor); references.add(state.owner);
    if (state.pass !== null) references.add(state.pass);
    if (state.phase.kind === "attached" && state.weapon !== 10) throw new Error("Only a legacy grappling hook can be attached");
    if (state.weapon === 10) {
      if (hooks.has(state.owner) || host.player(state.owner) === null) throw new Error("Legacy grappling hook has no unique live player");
      hooks.add(state.owner);
    }
    if (state.phase.kind === "attached" && state.phase.target !== null) references.add(state.phase.target);
    if (state.phase.kind === "event" && state.phase.impact.target !== null) references.add(state.phase.impact.target);
  }
  for (const entries of [saved.statistics.map(value => value.actor), saved.hookHeld]) {
    if (new Set(entries).size !== entries.length || entries.some(actor => host.player(actor.id) === null))
      throw new Error("Legacy Q3 client continuation has no unique live player");
    for (const actor of entries) references.add(actor.id);
  }
  const foreign = [...references].filter(actor => host.actors.isLive(actor) && records.nativeByActor(actor) === null
    && ![...actors].some(owned => owned.id.equals(actor)));
  if (foreign.some(actor => host.bodies.read(actor) === null)) throw new Error("Legacy Q3 reference has no body");
  const slots = Array.from({ length: 1022 - MAX_CLIENTS }, (_, index) => index + MAX_CLIENTS).filter(slot => !pool.at(slot).inuse);
  if (slots.length < actors.size + foreign.filter(actor => host.player(actor) === null).length)
    throw new Error("Legacy Q3 projectiles exceed original source entity capacity");
  const entities = saved.projectiles.map((state, index) => {
    const slot = slots[index]; if (slot === undefined) throw new Error("Legacy Q3 entity slot is missing");
    const entity = records.adopt(slot, state.actor);
    if (slot >= pool.numEntities) pool.restoreCounts({ numEntities: slot + 1, maxClients: host.maxClients });
    return entity;
  });
  for (const actor of references) project(actor);
  const continuations = saved.projectiles.map((state, index) => {
    const entity = entities[index]; if (entity === undefined) throw new Error("Legacy Q3 entity is missing");
    const owner = records.nativeByActor(state.owner), phase = state.phase;
    entity.classname = state.weapon === 4 ? "grenade" : state.weapon === 5 ? "rocket" : state.weapon === 8 ? "plasma"
      : state.weapon === 9 ? "bfg" : state.weapon === 10 ? "hook" : "nail";
    entity.s.weapon = state.weapon; entity.s.eFlags = state.flags;
    entity.s.eType = EntityType.ET_MISSILE; entity.r.svFlags = ServerEntityFlags.USE_CURRENT_ORIGIN;
    entity.r.ownerNum = owner?.slot ?? ENTITYNUM_NONE; entity.clipmask = 0x6000001;
    entity.damage = state.direct; entity.splashDamage = state.splash; entity.splashRadius = state.radius;
    entity.methodOfDeath = state.method; entity.splashMethodOfDeath = state.splashMethod;
    entity.s.origin = { ...state.damagePoint };
    entity.s.pos = { ...state.trajectory, base: { ...state.trajectory.base }, delta: { ...state.trajectory.delta } };
    entity.think = pool.callbacks.think.resolve(state.weapon === 10 ? "q3.base.game.missile.fireGrapple.think" : "q3.base.game.missile.launch.think");
    entity.nextthink = state.expires;
    if (state.weapon === 10) {
      if (owner?.client == null) throw new Error("Legacy hook owner lost its source client");
      entity.parent = owner; entity.s.otherEntityNum = owner.slot; owner.client.hook = entity;
      if (phase.kind === "attached") {
        entity.s.eType = EntityType.ET_GRAPPLE;
        entity.think = pool.callbacks.think.resolve("q3.base.game.missile.hookThink"); entity.nextthink = phase.nextThink;
        owner.client.ps.pmFlags |= MoveFlags.GRAPPLE_PULL; owner.client.ps.grapplePoint = { ...entity.r.currentOrigin };
      }
    }
    if (phase.kind === "event") {
      entity.freeAfterEvent = true; entity.s.eType = EntityType.ET_GENERAL; entity.eventTime = phase.time;
      entity.s.event = phase.impact.flesh ? EntityEvent.EV_MISSILE_HIT : phase.impact.surfaceFlags & 0x1000
        ? EntityEvent.EV_MISSILE_MISS_METAL : EntityEvent.EV_MISSILE_MISS;
      entity.s.eventParm = directionToByte(phase.impact.normal);
      entity.s.otherEntityNum = records.nativeByActor(phase.impact.target)?.slot ?? ENTITYNUM_NONE;
    }
    return { entity: entity.slot, actor: savedActorId(state.actor.id), owner: savedActorId(state.owner),
      pass: state.pass === null ? null : savedActorId(state.pass), trigger: null,
      attachment: phase.kind === "attached" && phase.target !== null ? { kind: "player", actor: savedActorId(phase.target) } : { kind: "none" } };
  });
  source.missiles.restoreSaveState(continuations, actor => host.actors.referenceSaved(actor));
  source.random.reset(saved.randomSeed);
  for (const state of saved.statistics) {
    const client = records.nativeByActor(state.actor.id)?.client;
    if (client == null) throw new Error("Legacy statistics lost their source client");
    client.accuracyShots = state.shots; client.accuracyHits = state.hits; client.accurateCount = state.streak;
    client.ps.persistant.set(PersistentIndex.PERS_IMPRESSIVE_COUNT, state.impressiveCount); client.rewardTime = state.rewardUntil;
    if (state.rewardUntil > saved.milliseconds) client.ps.eFlags |= 0x8000;
  }
  for (const actor of saved.hookHeld) {
    const client = records.nativeByActor(actor.id)?.client;
    if (client == null) throw new Error("Legacy hook latch lost its source client");
    client.fireHeld = true;
  }
}
