import type { QvmAbiProfile } from "../../contracts/execution.ts";
// Q3 cl_cgame.c snapshot copies and q_shared.h guest ABI. GPL-2.0-or-later.
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";
import type { WireUserCommand } from "../../network/q3/message.ts";
import type { Snapshot } from "../../network/q3/server-message.ts";
import { qvmConfigstring } from "./legacy-presentation.ts";
import { writeQvmEntityState } from "./entity-record.ts";
import { writeQvmPlayerState } from "./player-record.ts";

export const QVM_GAME_STATE_BYTES = 20100;
export const QVM_SNAPSHOT_BYTES = 53772;
export function qvmSnapshotBytes(profile: QvmAbiProfile): number { return profile === "q3-modern" ? QVM_SNAPSHOT_BYTES : 52724; }
export const QVM_USER_COMMAND_BYTES = 24;

function requireBytes(view: DataView, size: number): void {
  if (view.byteLength < size) throw new RangeError(`QVM client record requires ${size} bytes`);
}

export function writeQvmGameState(view: DataView, state: SourceGameStateRecord, profile: QvmAbiProfile = "q3-modern"): void {
  requireBytes(view, QVM_GAME_STATE_BYTES);
  if (state.stringOffsets.length !== 1024 || state.stringData.length !== 16000) throw new RangeError("Invalid source gameState_t extent");
  for (let index = 0; index < 1024; index++) {
    const source = profile !== "q3-modern" && index >= 16 && index <= 26 ? -1 : qvmConfigstring(index, profile);
    view.setInt32(index * 4, source < 0 ? 0 : state.stringOffsets[source] ?? 0, true);
  }
  new Uint8Array(view.buffer, view.byteOffset + 4096, 16000).set(state.stringData);
  view.setInt32(20096, state.dataCount, true);
}

export function writeQvmSnapshot(view: DataView, snapshot: Snapshot, ping: number, profile: QvmAbiProfile = "q3-modern"): void {
  requireBytes(view, qvmSnapshotBytes(profile));
  const psBytes = profile === "q3-modern" ? 468 : 444, entityBytes = profile === "q3-modern" ? 208 : 204;
  if (snapshot.areaMask.length !== 32 || snapshot.entities.length > 256) throw new RangeError("Invalid source snapshot_t extent");
  const ps = snapshot.playerState;
  view.setInt32(0, snapshot.flags, true); view.setInt32(4, ping, true); view.setInt32(8, snapshot.serverTime, true);
  new Uint8Array(view.buffer, view.byteOffset + 12, 32).set(snapshot.areaMask);
  writeQvmPlayerState(new DataView(view.buffer, view.byteOffset + 44, psBytes), {
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
  snapshot.entities.forEach((entity, index) => writeQvmEntityState(new DataView(view.buffer, view.byteOffset + 48 + psBytes + index * entityBytes, entityBytes), entity, profile));
  // CL_GetSnapshot leaves numServerCommands and unused entity slots untouched.
  view.setInt32(qvmSnapshotBytes(profile) - 4, snapshot.serverCommandNumber, true);
}

export function writeQvmUserCommand(view: DataView, command: WireUserCommand, profile: QvmAbiProfile = "q3-modern"): void {
  requireBytes(view, QVM_USER_COMMAND_BYTES);
  view.setInt32(0, command.serverTime, true);
  if (profile !== "q3-modern") {
    view.setUint8(4, (command.buttons & 31) | ((command.buttons & 2048) !== 0 ? 128 : 0)); view.setUint8(5, command.weapon);
    command.angles.forEach((angle, index) => view.setInt32(8 + index * 4, angle, true));
    view.setInt8(20, command.forwardmove); view.setInt8(21, command.rightmove); view.setInt8(22, command.upmove);
    return;
  }
  command.angles.forEach((angle, index) => view.setInt32(4 + index * 4, angle, true));
  view.setInt32(16, command.buttons, true); view.setUint8(20, command.weapon);
  view.setInt8(21, command.forwardmove); view.setInt8(22, command.rightmove); view.setInt8(23, command.upmove);
}
