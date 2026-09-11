import type { ActorAnimationState, MovementEnvironment, Q3MovementState } from "../../../../contracts/movement.ts";
import type { TraceHit } from "../../../../contracts/scene.ts";
import type { Q3EntityRecords } from "../../../../content/q3/base/records.ts";
import type { GameEntity } from "../../../../content/q3/base/game/state.ts";
import { MoveType, Powerup, Team, statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { MoveFlags } from "../../../../content/q3/base/shared/player-state.ts";
import { itemAt } from "../../../../content/q3/base/shared/items.ts";
import type { Q3ArsenalRuntimeState } from "../../../../content/q3/foundation/arsenal.ts";

function playerState(entity: GameEntity) {
  if (entity.client === null) throw new Error("Q3 player state requires an admitted client");
  return entity.client.ps;
}

function sourceHit(number: number, records: Q3EntityRecords): TraceHit {
  if (number === 1022) return { kind: "world", model: 0 };
  const entity = number === 1023 ? undefined : records.get(number);
  return entity?.inuse ? { kind: "actor", actor: entity.actor.id } : { kind: "none" };
}

function sourceNumber(hit: TraceHit, records: Q3EntityRecords): number {
  return hit.kind === "world" ? 1022 : hit.kind === "none" ? 1023 : records.byActor(hit.actor)?.slot ?? 1023;
}

/** Read immediately before selected Q3 PMove, after game-side triggers, teleport and client policy. */
export function readQ3MovementState(entity: GameEntity, records: Q3EntityRecords): Q3MovementState {
  const ps = playerState(entity), jumpPad = ps.jumppadEnt === 0 ? undefined : records.get(ps.jumppadEnt);
  return { kind: "q3", commandTimeMilliseconds: ps.commandTime, movementType: ps.pmType,
    bobCycle: ps.bobCycle, movementFlags: ps.pmFlags, movementTimeMilliseconds: ps.pmTime,
    origin: { ...ps.origin }, velocity: { ...ps.velocity }, gravity: ps.gravity, speed: ps.speed,
    deltaAngleWords: [ps.deltaAngles.x, ps.deltaAngles.y, ps.deltaAngles.z], ground: sourceHit(ps.groundEntityNum, records),
    movementDirection: ps.movementDir, grapplePoint: { ...ps.grapplePoint }, flags: ps.eFlags,
    viewAngles: { ...ps.viewangles }, viewHeight: ps.viewheight, predictableEventSequence: ps.eventSequence,
    jumpPad: jumpPad?.inuse ? jumpPad.actor.id : null, movementFrame: ps.pmoveFramecount, jumpPadFrame: ps.jumppadFrame };
}

/** PMove's scalar results return to the source record; body vectors already belong to the shared body table. */
export function writeQ3MovementState(entity: GameEntity, state: Q3MovementState, records: Q3EntityRecords): void {
  const ps = playerState(entity);
  ps.commandTime = state.commandTimeMilliseconds; ps.pmType = state.movementType; ps.bobCycle = state.bobCycle;
  ps.pmFlags = state.movementFlags; ps.pmTime = state.movementTimeMilliseconds; ps.gravity = state.gravity; ps.speed = state.speed;
  ps.deltaAngles = { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] };
  ps.groundEntityNum = sourceNumber(state.ground, records); ps.movementDir = state.movementDirection;
  ps.grapplePoint = { ...state.grapplePoint }; ps.eFlags = state.flags; ps.viewangles = { ...state.viewAngles };
  ps.viewheight = state.viewHeight; ps.pmoveFramecount = state.movementFrame; ps.jumppadFrame = state.jumpPadFrame;
  ps.jumppadEnt = state.jumpPad === null ? 0 : records.byActor(state.jumpPad)?.slot ?? 0;
  // The ordered effects append to ps.events at the caller, maintaining its two-entry native ring.
}

export function writeQ3CharacterAnimation(entity: GameEntity, animation: ActorAnimationState): void {
  if (animation.state.kind !== "q3") return;
  const ps = playerState(entity), state = animation.state;
  ps.legsAnim = state.legs; ps.torsoAnim = state.torso; ps.legsTimer = state.legsTimerMilliseconds; ps.torsoTimer = state.torsoTimerMilliseconds;
}

export function readQ3MovementEnvironment(entity: GameEntity, base: MovementEnvironment): MovementEnvironment {
  const ps = playerState(entity);
  return { ...base, health: ps.health, flight: ps.powerups.get(Powerup.PW_FLIGHT) !== 0,
    haste: ps.powerups.get(Powerup.PW_HASTE) !== 0,
    invulnerable: base.invulnerable || ps.product === "missionpack" && ps.powerups.get(Powerup.PW_INVULNERABILITY) !== 0 };
}

/** Item pickups and holdable use change these fields between weapon commands. */
export function readQ3ArsenalRuntime(entity: GameEntity, previous: Q3ArsenalRuntimeState): Q3ArsenalRuntimeState {
  const ps = playerState(entity), schema = statSchema(ps.product), holdableItem = ps.stats.get(schema.holdableItem);
  return { ...previous, product: ps.product, maxHealth: ps.stats.get(schema.maxHealth),
    spectator: ps.pmType === MoveType.PM_SPECTATOR || entity.client?.sess.sessionTeam === Team.TEAM_SPECTATOR,
    persistentPowerupTag: schema.product === "missionpack" ? itemAt(ps.product, ps.stats.get(schema.persistentPowerup)).tag : 0,
    holdableItem, holdableTag: itemAt(ps.product, holdableItem).tag,
    respawned: (ps.pmFlags & MoveFlags.RESPAWNED) !== 0, useItemHeld: (ps.pmFlags & MoveFlags.USE_ITEM_HELD) !== 0,
    eventSequence: ps.eventSequence };
}

export function writeQ3ArsenalRuntime(entity: GameEntity, runtime: Q3ArsenalRuntimeState): void {
  const ps = playerState(entity);
  ps.stats.set(statSchema(ps.product).holdableItem, runtime.holdableItem);
  ps.pmFlags = (ps.pmFlags & ~(MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD))
    | (runtime.respawned ? MoveFlags.RESPAWNED : 0) | (runtime.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0);
}
