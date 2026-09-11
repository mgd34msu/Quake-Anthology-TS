import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q3MovementState } from "../../../../contracts/movement.ts";
import type { Q2PlayerState, Q2RereleasePlayerState } from "../../../../contracts/protocol.ts";
import type { TraceHit } from "../../../../contracts/scene.ts";
import type { SourcePlayerState } from "../../../../content/q3/base/shared/player-state.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { Powerup, statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { itemAt } from "../../../../content/q3/base/shared/items.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../../../content/q3/foundation/arsenal.ts";
import type { MovementPredictionSnapshot } from "./types.ts";
import { copyPredictionSnapshot } from "./step.ts";

export interface PredictionSourceEntities {
  readonly actorAt: (number: number) => ActorId | null;
  readonly numberOf: (actor: ActorId) => number | null;
}
export function predictionSourceHit(number: number, entities: PredictionSourceEntities): TraceHit {
  if (number === 1022) return { kind: "world", model: 0 };
  if (number === 1023) return { kind: "none" };
  const actor = entities.actorAt(number);
  return actor === null ? { kind: "none" } : { kind: "actor", actor };
}
export function predictionSourceNumber(hit: TraceHit, entities: PredictionSourceEntities): number {
  return hit.kind === "world" ? 1022 : hit.kind === "none" ? 1023 : entities.numberOf(hit.actor) ?? 1023;
}

/** Q2 rerelease float movement never passes through the classic eighth-unit representation. */
export function q2PredictionSnapshot(base: MovementPredictionSnapshot, player: Q2PlayerState | Q2RereleasePlayerState,
  sequence: number, commandTimeMilliseconds: number): MovementPredictionSnapshot {
  const copy = copyPredictionSnapshot(base);
  return copyPredictionSnapshot({ ...copy, sequence, commandTimeMilliseconds, state: player.movement,
    viewAngles: { ...player.viewAngles }, viewOffset: { ...player.viewOffset },
    viewHeight: player.kind === "q2-rerelease" ? player.movement.viewHeight : player.viewOffset.z,
    environment: { ...copy.environment, health: player.stats[1] ?? 0 } });
}

export function readPredictionSourceState(base: MovementPredictionSnapshot, ps: SourcePlayerState,
  entities: PredictionSourceEntities): MovementPredictionSnapshot {
  const source = copyPredictionSnapshot(base), schema = statSchema(ps.product);
  const q3State: Q3MovementState = { kind: "q3", commandTimeMilliseconds: ps.commandTime, movementType: ps.pmType,
    bobCycle: ps.bobCycle, movementFlags: ps.pmFlags, movementTimeMilliseconds: ps.pmTime, origin: { ...ps.origin }, velocity: { ...ps.velocity },
    gravity: ps.gravity, speed: ps.speed, deltaAngleWords: [ps.deltaAngles.x, ps.deltaAngles.y, ps.deltaAngles.z], ground: predictionSourceHit(ps.groundEntityNum, entities),
    movementDirection: ps.movementDir, grapplePoint: { ...ps.grapplePoint }, flags: ps.eFlags, viewAngles: { ...ps.viewangles }, viewHeight: ps.viewheight,
    predictableEventSequence: ps.eventSequence, jumpPad: ps.jumppadEnt === 0 ? null : entities.actorAt(ps.jumppadEnt),
    movementFrame: ps.pmoveFramecount, jumpPadFrame: ps.jumppadFrame };
  const arsenal = source.arsenal.state.kind !== "q3" ? source.arsenal : {
    provider: source.arsenal.provider, activeWeapon: q3WeaponItem(ps.weapon)?.item ?? null,
    state: { kind: "q3", sourceWeapon: ps.weapon, state: ps.weaponState, timeMilliseconds: ps.weaponTime } satisfies MovementPredictionSnapshot["arsenal"]["state"],
    ammo: Q3_WEAPON_ITEMS.filter(item => ps.product === "missionpack" || item.weapon < 11).flatMap(item => {
      const entries = [{ item: item.item, count: (ps.stats.get(schema.weapons) & (1 << item.weapon)) !== 0 ? 1 : 0, capacity: 1 }];
      if (item.ammo !== null) entries.push({ item: item.ammo, count: ps.ammo.get(item.weapon), capacity: 200 });
      return entries;
    }),
  };
  const holdableItem = ps.stats.get(schema.holdableItem);
  const state = source.state.kind === "q3" ? q3State : source.state.kind === "q2-classic"
    ? { ...source.state, originEighths: [Math.trunc(ps.origin.x * 8), Math.trunc(ps.origin.y * 8), Math.trunc(ps.origin.z * 8)],
      velocityEighths: [Math.trunc(ps.velocity.x * 8), Math.trunc(ps.velocity.y * 8), Math.trunc(ps.velocity.z * 8)] } satisfies MovementPredictionSnapshot["state"]
    : { ...source.state, origin: { ...ps.origin }, velocity: { ...ps.velocity } };
  return { ...source, commandTimeMilliseconds: ps.commandTime, state,
    arsenal, animation: source.animation.state.kind === "q3" ? { ...source.animation, state: { kind: "q3", legs: ps.legsAnim,
      torso: ps.torsoAnim, legsTimerMilliseconds: ps.legsTimer, torsoTimerMilliseconds: ps.torsoTimer } } : source.animation,
    viewAngles: { ...ps.viewangles }, viewHeight: ps.viewheight,
    environment: { ...source.environment, gravityMultiplier: source.state.kind === "q3" ? 1 : source.environment.gravityMultiplier,
      health: ps.health, flight: ps.powerups.get(Powerup.PW_FLIGHT) !== 0,
      haste: ps.powerups.get(Powerup.PW_HASTE) !== 0,
      invulnerable: ps.product === "missionpack" && ps.powerups.get(Powerup.PW_INVULNERABILITY) !== 0 },
    q3Arsenal: arsenal.state.kind !== "q3" ? null : { product: ps.product, maxHealth: ps.stats.get(schema.maxHealth),
      spectator: ps.pmType === 1, persistentPowerupTag: schema.product === "missionpack" ? itemAt(ps.product, ps.stats.get(schema.persistentPowerup)).tag : 0,
      holdableItem, holdableTag: itemAt(ps.product, holdableItem).tag, respawned: (ps.pmFlags & MoveFlags.RESPAWNED) !== 0,
      useItemHeld: (ps.pmFlags & MoveFlags.USE_ITEM_HELD) !== 0, eventSequence: ps.eventSequence,
      fractionalMilliseconds: source.q3Arsenal?.fractionalMilliseconds ?? 0, externalSlot: source.q3Arsenal?.externalSlot ?? "active", requestedWeapon: source.q3Arsenal?.requestedWeapon ?? null } };
}

export function writePredictionSourceState(ps: SourcePlayerState, output: MovementPredictionSnapshot,
  entities: PredictionSourceEntities): void {
  const state = output.state;
  ps.commandTime = output.commandTimeMilliseconds;
  ps.origin = state.kind === "q2-classic" ? { x: state.originEighths[0] / 8, y: state.originEighths[1] / 8, z: state.originEighths[2] / 8 } : { ...state.origin };
  ps.velocity = state.kind === "q2-classic" ? { x: state.velocityEighths[0] / 8, y: state.velocityEighths[1] / 8, z: state.velocityEighths[2] / 8 } : { ...state.velocity };
  ps.viewangles = { ...output.viewAngles }; ps.viewheight = output.viewHeight;
  if (output.contact !== null) ps.groundEntityNum = predictionSourceNumber(output.contact.ground, entities);
  if (state.kind === "q3") {
    ps.commandTime = state.commandTimeMilliseconds; ps.pmType = state.movementType; ps.pmFlags = state.movementFlags;
    ps.pmTime = state.movementTimeMilliseconds; ps.bobCycle = state.bobCycle; ps.deltaAngles = { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] };
    ps.groundEntityNum = predictionSourceNumber(state.ground, entities); ps.movementDir = state.movementDirection;
    ps.eFlags = state.flags; ps.pmoveFramecount = state.movementFrame; ps.jumppadFrame = state.jumpPadFrame;
    ps.jumppadEnt = state.jumpPad === null ? 0 : entities.numberOf(state.jumpPad) ?? 0;
  }
  const arsenal = output.arsenal;
  if (arsenal.state.kind === "q3") {
    ps.weapon = arsenal.state.sourceWeapon; ps.weaponState = arsenal.state.state; ps.weaponTime = arsenal.state.timeMilliseconds;
    let owned = 0;
    for (const item of Q3_WEAPON_ITEMS) {
      if ((arsenal.ammo.find(entry => entry.item === item.item)?.count ?? 0) > 0) owned |= 1 << item.weapon;
      if (item.ammo !== null) ps.ammo.set(item.weapon, arsenal.ammo.find(entry => entry.item === item.ammo)?.count ?? 0);
    }
    const schema = statSchema(ps.product); ps.stats.set(schema.weapons, owned);
    if (output.q3Arsenal !== null) {
      ps.stats.set(schema.holdableItem, output.q3Arsenal.holdableItem);
      ps.pmFlags = (ps.pmFlags & ~(MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD))
        | (output.q3Arsenal.respawned ? MoveFlags.RESPAWNED : 0) | (output.q3Arsenal.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0);
    }
  }
  if (output.animation.state.kind === "q3") {
    const animation = output.animation.state;
    ps.legsAnim = animation.legs; ps.torsoAnim = animation.torso;
    ps.legsTimer = animation.legsTimerMilliseconds; ps.torsoTimer = animation.torsoTimerMilliseconds;
  }
}
