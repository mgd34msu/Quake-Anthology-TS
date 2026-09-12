/* Official QC source state. Shared bodies, combat, inventory and RNG belong to the session checkpoint. */
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import { Q1Actor } from "./entity.ts";
import type { Q1Monster } from "./entity.ts";
import type { Q1EntityServices } from "./entity-services.ts";
import type { Q1PlayerState, Q1Powerup, Q1PrecacheTables } from "./types.ts";
import { callbackName } from "./callbacks.ts";

export interface Q1SavedCallbacks {
  readonly think: string | null;
  readonly use: string | null;
  readonly touch: string | null;
  readonly pain: string | null;
  readonly die: string | null;
  readonly blocked: string | null;
  readonly pathEnd: string | null;
}
export interface Q1SavedEntity {
  readonly actor: SavedActorId;
  readonly sourceSlot: number | null;
  readonly actorProvider: ProviderId;
  readonly classname: string;
  readonly sourceOrdinal: number | null;
  readonly state: Q1EntitySourceState;
  readonly fields: readonly { readonly key: string; readonly value: string }[];
  readonly references: readonly { readonly key: string; readonly actor: SavedActorId | null }[];
  readonly owner: SavedActorId | null;
  readonly activator: SavedActorId | null;
  readonly doorGroup: readonly SavedActorId[];
  readonly monster: (Omit<Q1Monster, "enemy" | "oldEnemy"> & { readonly enemy: SavedActorId | null; readonly oldEnemy: SavedActorId | null }) | null;
  readonly move: { readonly destination: import("../../../contracts/math.ts").Vec3; readonly done: string } | null;
  readonly callbacks: Q1SavedCallbacks;
}
export interface Q1SavedPlayer {
  readonly actorProvider: ProviderId;
  readonly actor: SavedActorId;
  readonly state: Omit<Q1PlayerState, "actor" | "powerups">;
  readonly powerups: readonly { readonly kind: Q1Powerup; readonly expires: number }[];
}
export interface Q1FoundationCheckpoint {
  readonly format: "q1-foundation";
  readonly provider: ProviderId;
  readonly version: 5;
  readonly precaches: Q1PrecacheTables;
  readonly edition: "classic" | "rerelease";
  readonly time: number;
  readonly frameSeconds: number;
  readonly forceRetouch: number;
  readonly basis: import("./types.ts").Q1Basis;
  readonly sequence: number;
  readonly nextDynamicSlot: number;
  readonly totalSecrets: number;
  readonly foundSecrets: number;
  readonly totalMonsters: number;
  readonly killedMonsters: number;
  readonly worldType: number;
  readonly mapName: string;
  readonly world: SavedActorId | null;
  readonly sightEntity: SavedActorId | null;
  readonly sightTime: number;
  readonly intermission: { readonly map: string; readonly cause: SavedActorId | null; readonly exitAfter: number } | null;
  readonly entities: readonly Q1SavedEntity[];
  readonly players: readonly Q1SavedPlayer[];
  readonly extensions: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}

/** Every mutable builtin source field outside shared stores appears here. */
export function captureEntitySourceState(entity: Q1Actor) {
  return {
    model: entity.model, frame: entity.frame, skin: entity.skin, effects: entity.effects, solid: entity.solid, movement: entity.movement,
    target: entity.target, targetname: entity.targetname, killtarget: entity.killtarget, message: entity.message, delay: entity.delay,
    spawnflags: entity.spawnflags, sounds: entity.sounds, wait: entity.wait, speed: entity.speed, damage: entity.damage, maxHealth: entity.maxHealth,
    aimedDamage: entity.aimedDamage, nextThink: entity.nextThink, originalModel: entity.originalModel,
    pos1: { ...entity.pos1 }, pos2: { ...entity.pos2 }, dest1: { ...entity.dest1 }, dest2: { ...entity.dest2 }, movedir: { ...entity.movedir }, mangle: { ...entity.mangle },
    state: entity.state, triggerBounds: entity.triggerBounds === null ? null : { min: { ...entity.triggerBounds.min }, max: { ...entity.triggerBounds.max } },
    attackFinished: entity.attackFinished, count: entity.count, activated: entity.activated,
    projectile: entity.projectile, projectileWeapon: entity.projectileWeapon, angularVelocity: { ...entity.angularVelocity }, waterLevel: entity.waterLevel, waterType: entity.waterType,
    movementFlags: entity.movementFlags, idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, attackState: entity.attackState,
  };
}
export type Q1EntitySourceState = ReturnType<typeof captureEntitySourceState>;
export function saveQ1Actor(actor: ActorId | null): SavedActorId | null { return actor === null ? null : { slot: actor.slot, generation: actor.generation }; }
function savedOwned(actor: OwnedActor): SavedActorId { return { slot: actor.id.slot, generation: actor.id.generation }; }
function saveEntity(game: Q1EntityServices, entity: Q1Actor): Q1SavedEntity {
  const source = game.host.actors.sourceOf(entity.actor.id);
  const monster = entity.monster, move = entity.move;
  const done = move === null ? null : callbackName(move.done);
  if (move !== null && done === null) throw new Error("Q1 move has no named completion");
  return {
    actor: savedOwned(entity.actor), sourceSlot: source?.slot ?? null, actorProvider: entity.actor.owner, classname: entity.classname, sourceOrdinal: entity.sourceOrdinal,
    state: captureEntitySourceState(entity), fields: [...entity.fields].map(([key, value]) => ({ key, value })),
    references: [...entity.references].map(([key, actor]) => ({ key, actor: saveQ1Actor(actor) })),
    owner: saveQ1Actor(entity.owner), activator: saveQ1Actor(entity.activator), doorGroup: entity.doorGroup.map(door => savedOwned(door.actor)),
    monster: monster === null ? null : { ...monster, sequence: [...monster.sequence], enemy: saveQ1Actor(monster.enemy), oldEnemy: saveQ1Actor(monster.oldEnemy) },
    move: move === null || done === null ? null : { destination: { ...move.destination }, done },
    callbacks: { think: callbackName(entity.think), use: callbackName(entity.use), touch: callbackName(entity.touch), pain: callbackName(entity.pain), die: callbackName(entity.die), blocked: callbackName(entity.blocked), pathEnd: callbackName(entity.pathEnd) },
  };
}
export function captureFoundation(game: Q1EntityServices, sequence: number, nextDynamicSlot: number): Q1FoundationCheckpoint {
  return {
    format: "q1-foundation", provider: game.provider, version: 5,
    precaches: { phase: game.precaches.phase, models: [...game.precaches.models], sounds: [...game.precaches.sounds] }, edition: game.options.edition, time: game.time, frameSeconds: game.frameSeconds, forceRetouch: game.forceRetouch, basis: { forward: { ...game.basis.forward }, right: { ...game.basis.right }, up: { ...game.basis.up } }, sequence, nextDynamicSlot,
    totalSecrets: game.totalSecrets, foundSecrets: game.foundSecrets, totalMonsters: game.totalMonsters, killedMonsters: game.killedMonsters,
    worldType: game.worldType, mapName: game.mapName, world: game.world === null ? null : savedOwned(game.world.actor),
    sightEntity: game.sightEntity === null ? null : savedOwned(game.sightEntity.actor), sightTime: game.sightTime,
    intermission: game.intermission === null ? null : { ...game.intermission, cause: saveQ1Actor(game.intermission.cause) },
    entities: [...game.entities.values()].map(entity => saveEntity(game, entity)),
    players: [...game.players.values()].map(player => {
      const { actor, powerups, ...state } = player;
      return { actor: savedOwned(actor), actorProvider: actor.owner, state: { ...state, punchAngles: { ...state.punchAngles }, viewAngles: { ...state.viewAngles } }, powerups: [...powerups].map(([kind, expires]) => ({ kind, expires })) };
    }),
    extensions: [...game.stateExtensions.values()].map(extension => ({ id: extension.id, bytes: extension.capture().slice() })),
  };
}

/** Restores source objects around existing authority tables. It never runs a spawn function. */
export function restoreFoundation(game: Q1EntityServices, checkpoint: Q1FoundationCheckpoint): undefined {
  if (checkpoint.format !== "q1-foundation" || checkpoint.version !== 5 || checkpoint.edition !== game.options.edition || checkpoint.provider !== game.provider) throw new Error("Incompatible Q1 source checkpoint");
  if (game.entities.size !== 0 || game.players.size !== 0) throw new Error("Restore Q1 source state into a fresh provider");
  game.precaches.restore(checkpoint.precaches);
  const owned = (saved: SavedActorId): OwnedActor => {
    const actor = game.host.actors.resolveSaved(saved); if (actor === null) throw new Error(`Missing restored Q1 actor ${saved.slot}/${saved.generation}`); return actor;
  };
  const reference = (saved: SavedActorId | null): ActorId | null => saved === null ? null : game.host.actors.referenceSaved(saved);
  for (const saved of checkpoint.entities) {
    const actor = owned(saved.actor), source = game.host.actors.sourceOf(actor.id);
    if (actor.owner !== saved.actorProvider || (source?.slot ?? null) !== saved.sourceSlot || (source !== null && source.provider !== actor.owner) || game.entities.has(actor)) throw new Error("Q1 restored source-slot mismatch");
    if (game.host.bodies.read(actor.id) === null || game.host.combat.read(actor.id) === null) throw new Error("Restore shared Q1 body and combat stores before source state");
    const entity = game.attachExisting(actor, saved.classname, undefined, saved.sourceOrdinal);
    Object.assign(entity, saved.state);
    for (const field of saved.fields) entity.fields.set(field.key, field.value);
  }
  const sourceEntity = (saved: SavedActorId): Q1Actor => {
    const entity = game.entities.get(owned(saved)); if (entity === undefined) throw new Error("Saved Q1 source reference points outside source entities"); return entity;
  };
  for (const saved of checkpoint.entities) {
    const entity = sourceEntity(saved.actor), callbacks = saved.callbacks;
    for (const entry of saved.references) entity.references.set(entry.key, reference(entry.actor));
    entity.owner = reference(saved.owner); entity.activator = reference(saved.activator);
    entity.doorGroup = saved.doorGroup.map(sourceEntity);
    entity.monster = saved.monster === null ? null : { ...saved.monster, sequence: [...saved.monster.sequence], enemy: reference(saved.monster.enemy), oldEnemy: reference(saved.monster.oldEnemy) };
    entity.move = saved.move === null ? null : { ...saved.move, destination: { ...saved.move.destination }, done: game.named.action(entity, saved.move.done) };
    entity.think = callbacks.think === null ? null : game.named.action(entity, callbacks.think);
    entity.use = callbacks.use === null ? null : game.named.use(entity, callbacks.use);
    entity.touch = callbacks.touch === null ? null : game.named.touch(entity, callbacks.touch);
    entity.pain = callbacks.pain === null ? null : game.named.pain(entity, callbacks.pain);
    entity.die = callbacks.die === null ? null : game.named.die(entity, callbacks.die);
    entity.blocked = callbacks.blocked === null ? null : game.named.blocked(entity, callbacks.blocked);
    entity.pathEnd = callbacks.pathEnd === null ? null : game.named.action(entity, callbacks.pathEnd);
  }
  for (const saved of checkpoint.players) {
    const actor = owned(saved.actor);
    if (actor.owner !== saved.actorProvider) throw new Error("Q1 restored player owner mismatch");
    if (game.players.has(actor)) throw new Error("Duplicate saved Q1 player");
    const powerups = new Map<Q1Powerup, number>();
    for (const powerup of saved.powerups) powerups.set(powerup.kind, powerup.expires);
    game.players.set(actor, { ...saved.state, viewAngles: { ...saved.state.viewAngles }, actor, powerups });
  }
  game.time = checkpoint.time; game.frameSeconds = checkpoint.frameSeconds; game.forceRetouch = checkpoint.forceRetouch;
  game.basis = { forward: { ...checkpoint.basis.forward }, right: { ...checkpoint.basis.right }, up: { ...checkpoint.basis.up } }; game.totalSecrets = checkpoint.totalSecrets; game.foundSecrets = checkpoint.foundSecrets;
  game.totalMonsters = checkpoint.totalMonsters; game.killedMonsters = checkpoint.killedMonsters; game.worldType = checkpoint.worldType; game.mapName = checkpoint.mapName;
  game.world = checkpoint.world === null ? null : sourceEntity(checkpoint.world);
  game.sightEntity = checkpoint.sightEntity === null ? null : game.entity(reference(checkpoint.sightEntity)); game.sightTime = checkpoint.sightTime;
  game.intermission = checkpoint.intermission === null ? null : { ...checkpoint.intermission, cause: reference(checkpoint.intermission.cause) };
  const restoredExtensions = new Set<string>();
  for (const saved of checkpoint.extensions) {
    const extension = game.stateExtensions.get(saved.id);
    if (extension === undefined || restoredExtensions.has(saved.id)) throw new Error(`Unknown or duplicate Q1 saved extension: ${saved.id}`);
    extension.restore(saved.bytes.slice()); restoredExtensions.add(saved.id);
  }
  for (const id of game.stateExtensions.keys()) if (!restoredExtensions.has(id)) throw new Error(`Missing Q1 saved extension: ${id}`);
  return undefined;
}
