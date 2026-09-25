import type { QvmAbiProfile } from "../../contracts/execution.ts";
// Q3 cl_cgame.c snapshot copies and q_shared.h guest ABI. GPL-2.0-or-later.
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";
import type { WireUserCommand } from "../../network/q3/message.ts";
import type { Snapshot } from "../../network/q3/server-message.ts";
import { qvmConfigstring } from "./legacy-presentation.ts";
import { writeQvmEntityState, writeSourceQvmEntityState, type QvmEntityStateFields } from "./entity-record.ts";
import { writeQvmPlayerState, writeSourceQvmPlayerState } from "./player-record.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmMemory } from "./memory.ts";

export const QVM_GAME_STATE_BYTES = 20100;
export const QVM_SNAPSHOT_BYTES = 53772;
export function qvmSnapshotBytes(profile: QvmAbiProfile): number { return profile === "q3-modern" ? QVM_SNAPSHOT_BYTES : 52724; }
export const QVM_USER_COMMAND_BYTES = 24;
interface QvmUserCommandLayout {
  readonly buttons: { readonly offset: number; readonly bytes: 1 | 4 };
  readonly angles: number; readonly weapon: number; readonly forward: number; readonly right: number; readonly up: number;
}
const modernCommand: QvmUserCommandLayout = { buttons: { offset: 16, bytes: 4 }, angles: 4, weapon: 20, forward: 21, right: 22, up: 23 };
const legacyCommand: QvmUserCommandLayout = { buttons: { offset: 4, bytes: 1 }, angles: 8, weapon: 5, forward: 20, right: 21, up: 22 };
export function qvmUserCommandLayout(profile: QvmAbiProfile): QvmUserCommandLayout {
  return profile === "q3-modern" ? modernCommand : legacyCommand;
}

export interface QvmSourceSnapshot {
  readonly number: number;
  readonly serverTime: number;
  readonly flags: number;
  readonly areaMask: Uint8Array;
  readonly playerState: Q3PlayerState;
  readonly entities: readonly QvmEntityStateFields[];
  readonly serverCommandSequence: number;
}
export function writeSourceQvmSnapshot(memory: QvmMemory, view: DataView, snapshot: QvmSourceSnapshot, profile: QvmAbiProfile): void {
  requireBytes(view, qvmSnapshotBytes(profile));
  if (snapshot.areaMask.length !== 32 || snapshot.entities.length > 256) throw new RangeError("Invalid source snapshot_t extent");
  const psBytes = profile === "q3-modern" ? 468 : 444, entityBytes = profile === "q3-modern" ? 208 : 204;
  const offset = view.byteOffset - memory.bytes.byteOffset;
  view.setInt32(0, snapshot.flags, true); view.setInt32(4, snapshot.playerState.pingMilliseconds, true); view.setInt32(8, snapshot.serverTime, true);
  memory.writeBytes(offset + 12, snapshot.areaMask);
  writeSourceQvmPlayerState(memory.dataView(offset + 44, psBytes), snapshot.playerState, profile);
  view.setInt32(44 + psBytes, snapshot.entities.length, true);
  snapshot.entities.forEach((entity, index) => writeSourceQvmEntityState(memory.dataView(offset + 48 + psBytes + index * entityBytes, entityBytes), entity, profile));
  view.setInt32(qvmSnapshotBytes(profile) - 4, snapshot.serverCommandSequence, true);
}

function requireBytes(view: DataView, size: number): void {
  if (view.byteLength < size) throw new RangeError(`QVM client record requires ${size} bytes`);
}

export function writeQvmGameState(memory: QvmMemory, view: DataView, state: SourceGameStateRecord, profile: QvmAbiProfile = "q3-modern"): void {
  writeGameState(memory, view, state, profile);
}

/** Original module configstring indices are already in their source ABI. */
export function writeSourceQvmGameState(memory: QvmMemory, view: DataView, state: SourceGameStateRecord): void {
  writeGameState(memory, view, state, null);
}

function writeGameState(memory: QvmMemory, view: DataView, state: SourceGameStateRecord, profile: QvmAbiProfile | null): void {
  requireBytes(view, QVM_GAME_STATE_BYTES);
  if (state.stringOffsets.length !== 1024 || state.stringData.length !== 16000) throw new RangeError("Invalid source gameState_t extent");
  for (let index = 0; index < 1024; index++) {
    const source = profile === null ? index : profile !== "q3-modern" && index >= 16 && index <= 26 ? -1 : qvmConfigstring(index, profile);
    view.setInt32(index * 4, source < 0 ? 0 : state.stringOffsets[source] ?? 0, true);
  }
  memory.writeBytes(view.byteOffset - memory.bytes.byteOffset + 4096, state.stringData);
  view.setInt32(20096, state.dataCount, true);
}

export function writeQvmSnapshot(memory: QvmMemory, view: DataView, snapshot: Snapshot, ping: number, profile: QvmAbiProfile = "q3-modern"): void {
  requireBytes(view, qvmSnapshotBytes(profile));
  const psBytes = profile === "q3-modern" ? 468 : 444, entityBytes = profile === "q3-modern" ? 208 : 204;
  if (snapshot.areaMask.length !== 32 || snapshot.entities.length > 256) throw new RangeError("Invalid source snapshot_t extent");
  const ps = snapshot.playerState;
  const offset = view.byteOffset - memory.bytes.byteOffset;
  view.setInt32(0, snapshot.flags, true); view.setInt32(4, ping, true); view.setInt32(8, snapshot.serverTime, true);
  memory.writeBytes(offset + 12, snapshot.areaMask);
  writeQvmPlayerState(memory.dataView(offset + 44, psBytes), {
    commandTimeMilliseconds: ps.commandTime, movementType: ps.pmType, bobCycle: ps.bobCycle,
    movementFlags: ps.pmFlags, movementTimeMilliseconds: ps.pmTime, origin: ps.origin, velocity: ps.velocity,
    weaponTimeMilliseconds: ps.weaponTime, gravity: ps.gravity, speed: ps.speed,
    deltaAngleWords: [ps.deltaAngles.x, ps.deltaAngles.y, ps.deltaAngles.z], groundEntityNumber: ps.groundEntityNum,
    legsTimerMilliseconds: ps.legsTimer, legsAnimation: ps.legsAnim, torsoTimerMilliseconds: ps.torsoTimer,
    torsoAnimation: ps.torsoAnim, movementDirection: ps.movementDir, grapplePoint: ps.grapplePoint,
    flags: ps.eFlags, eventSequence: ps.eventSequence, events: [ps.events.get(0), ps.events.get(1)],
    eventParameters: [ps.eventParms.get(0), ps.eventParms.get(1)], externalEvent: ps.externalEvent,
    externalEventParameter: ps.externalEventParm, externalEventTimeMilliseconds: ps.externalEventTime,
    clientNumber: ps.clientNum, weapon: ps.weapon, weaponState: ps.weaponState, viewAngles: ps.viewangles,
    viewHeight: ps.viewheight, damageEvent: ps.damageEvent, damageYaw: ps.damageYaw, damagePitch: ps.damagePitch,
    damageCount: ps.damageCount, stats: Array.from(ps.stats.copy()), persistent: Array.from(ps.persistant.copy()),
    powerups: Array.from(ps.powerups.copy()), ammo: Array.from(ps.ammo.copy()), generic1: ps.generic1,
    loopSound: ps.loopSound, jumpPadEntity: ps.jumppadEnt, pingMilliseconds: ps.ping,
    movementFrameCount: ps.pmoveFramecount, jumpPadFrame: ps.jumppadFrame, entityEventSequence: ps.entityEventSequence,
  }, profile);
  view.setInt32(44 + psBytes, snapshot.entities.length, true);
  snapshot.entities.forEach((entity, index) => writeQvmEntityState(memory.dataView(offset + 48 + psBytes + index * entityBytes, entityBytes), entity, profile));
  // CL_GetSnapshot leaves numServerCommands and unused entity slots untouched.
  view.setInt32(qvmSnapshotBytes(profile) - 4, snapshot.serverCommandNumber, true);
}

export function writeQvmUserCommand(view: DataView, command: WireUserCommand, profile: QvmAbiProfile = "q3-modern", mode: "encode" | "update" = "encode"): void {
  requireBytes(view, QVM_USER_COMMAND_BYTES);
  const layout = qvmUserCommandLayout(profile);
  view.setInt32(0, command.serverTime, true);
  if (layout.buttons.bytes === 1) view.setUint8(layout.buttons.offset, (mode === "update" ? view.getUint8(layout.buttons.offset) & 96 : 0)
    | (command.buttons & 31) | ((command.buttons & 2048) !== 0 ? 128 : 0));
  else view.setInt32(layout.buttons.offset, command.buttons, true);
  command.angles.forEach((angle, index) => view.setInt32(layout.angles + index * 4, angle, true));
  view.setUint8(layout.weapon, command.weapon);
  view.setInt8(layout.forward, command.forwardmove); view.setInt8(layout.right, command.rightmove); view.setInt8(layout.up, command.upmove);
}

export function readQvmUserCommand(view: DataView, profile: QvmAbiProfile = "q3-modern"): WireUserCommand {
  requireBytes(view, QVM_USER_COMMAND_BYTES);
  const layout = qvmUserCommandLayout(profile), buttons = layout.buttons.bytes === 1 ? view.getUint8(layout.buttons.offset) : view.getInt32(layout.buttons.offset, true);
  return { serverTime: view.getInt32(0, true), angles: [view.getInt32(layout.angles, true), view.getInt32(layout.angles + 4, true), view.getInt32(layout.angles + 8, true)],
    buttons: layout.buttons.bytes === 1 ? (buttons & 31) | ((buttons & 128) === 0 ? 0 : 2048) : buttons, weapon: view.getUint8(layout.weapon),
    forwardmove: view.getInt8(layout.forward), rightmove: view.getInt8(layout.right), upmove: view.getInt8(layout.up) };
}
