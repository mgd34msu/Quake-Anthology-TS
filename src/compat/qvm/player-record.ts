import { qvmEvent, qvmPersistent, qvmPowerups } from "./legacy-presentation.ts";
import type { QvmAbiProfile } from "../../contracts/execution.ts";
// Ported from id Software's code/game/q_shared.h playerState_t.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

import { BinaryError } from "../../core/binary/index.ts";
import type { Vec3 } from "../../core/math.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";

/** Selected 32-bit QVM ABI: 117 four-byte words, including the non-network tail. */
export const QVM_PLAYER_STATE_BYTES = 468;

export function qvmPlayerStateBytes(profile: QvmAbiProfile): number { return profile === "q3-modern" ? 468 : 444; }

function checkRecord(view: DataView, profile: QvmAbiProfile): void {
  const QVM_PLAYER_STATE_BYTES = qvmPlayerStateBytes(profile);
  if (view.byteLength < QVM_PLAYER_STATE_BYTES) {
    throw new BinaryError("QVM playerState_t", 0, `requires ${QVM_PLAYER_STATE_BYTES} bytes, got ${view.byteLength}`);
  }
}

function readVector(view: DataView, offset: number): Vec3 {
  return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) };
}

function writeVector(view: DataView, offset: number, value: Vec3): void {
  view.setFloat32(offset, value.x, true);
  view.setFloat32(offset + 4, value.y, true);
  view.setFloat32(offset + 8, value.z, true);
}

function readSlots(view: DataView, offset: number): number[] {
  return Array.from({ length: 16 }, (_, index) => view.getInt32(offset + index * 4, true));
}
function writeSlots(view: DataView, offset: number, slots: readonly number[]): void {
  for (const [index, value] of slots.entries()) view.setInt32(offset + 4 * index, value, true);
}

/** The caller resolves the VM pointer; this view starts at the complete C record. */
export function readQvmPlayerState(view: DataView, profile: QvmAbiProfile = "q3-modern"): Q3PlayerState {
  checkRecord(view, profile);
  return {
    commandTimeMilliseconds: view.getInt32(0, true),
    movementType: view.getInt32(4, true),
    bobCycle: view.getInt32(8, true),
    movementFlags: view.getInt32(12, true),
    movementTimeMilliseconds: view.getInt32(16, true),
    origin: readVector(view, 20),
    velocity: readVector(view, 32),
    weaponTimeMilliseconds: view.getInt32(44, true),
    gravity: view.getInt32(48, true),
    speed: view.getInt32(52, true),
    deltaAngleWords: [view.getInt32(56, true), view.getInt32(60, true), view.getInt32(64, true)],
    groundEntityNumber: view.getInt32(68, true),
    legsTimerMilliseconds: view.getInt32(72, true),
    legsAnimation: view.getInt32(76, true),
    torsoTimerMilliseconds: view.getInt32(80, true),
    torsoAnimation: view.getInt32(84, true),
    movementDirection: view.getInt32(88, true),
    grapplePoint: readVector(view, 92),
    flags: view.getInt32(104, true),
    eventSequence: view.getInt32(108, true),
    events: [qvmEvent(view.getInt32(112, true), profile), qvmEvent(view.getInt32(116, true), profile)],
    eventParameters: [view.getInt32(120, true), view.getInt32(124, true)],
    externalEvent: qvmEvent(view.getInt32(128, true), profile),
    externalEventParameter: view.getInt32(132, true),
    externalEventTimeMilliseconds: view.getInt32(136, true),
    clientNumber: view.getInt32(140, true),
    weapon: view.getInt32(144, true),
    weaponState: view.getInt32(148, true),
    viewAngles: readVector(view, 152),
    viewHeight: view.getInt32(164, true),
    damageEvent: view.getInt32(168, true),
    damageYaw: view.getInt32(172, true),
    damagePitch: view.getInt32(176, true),
    damageCount: view.getInt32(180, true),
    stats: readSlots(view, 184),
    persistent: qvmPersistent(readSlots(view, 248), profile),
    powerups: qvmPowerups(readSlots(view, 312), profile),
    ammo: readSlots(view, 376),
    generic1: profile === "q3-modern" ? view.getInt32(440, true) : 0,
    loopSound: profile === "q3-modern" ? view.getInt32(444, true) : 0,
    jumpPadEntity: profile === "q3-modern" ? view.getInt32(448, true) : 0,
    pingMilliseconds: view.getInt32(profile === "q3-modern" ? 452 : 440, true),
    movementFrameCount: profile === "q3-modern" ? view.getInt32(456, true) : 0,
    jumpPadFrame: profile === "q3-modern" ? view.getInt32(460, true) : 0,
    entityEventSequence: profile === "q3-modern" ? view.getInt32(464, true) : 0,
  };
}

/** Writes exactly playerState_t, preserving surrounding VM memory. */
export function writeQvmPlayerState(view: DataView, state: Q3PlayerState): void {
  checkRecord(view, "q3-modern");
  for (const slots of [state.stats, state.persistent, state.powerups, state.ammo]) {
    if (slots.length !== 16) throw new RangeError("QVM player-state arrays require 16 slots");
  }
  view.setInt32(0, state.commandTimeMilliseconds, true);
  view.setInt32(4, state.movementType, true);
  view.setInt32(8, state.bobCycle, true);
  view.setInt32(12, state.movementFlags, true);
  view.setInt32(16, state.movementTimeMilliseconds, true);
  writeVector(view, 20, state.origin);
  writeVector(view, 32, state.velocity);
  view.setInt32(44, state.weaponTimeMilliseconds, true);
  view.setInt32(48, state.gravity, true);
  view.setInt32(52, state.speed, true);
  view.setInt32(56, state.deltaAngleWords[0], true);
  view.setInt32(60, state.deltaAngleWords[1], true);
  view.setInt32(64, state.deltaAngleWords[2], true);
  view.setInt32(68, state.groundEntityNumber, true);
  view.setInt32(72, state.legsTimerMilliseconds, true);
  view.setInt32(76, state.legsAnimation, true);
  view.setInt32(80, state.torsoTimerMilliseconds, true);
  view.setInt32(84, state.torsoAnimation, true);
  view.setInt32(88, state.movementDirection, true);
  writeVector(view, 92, state.grapplePoint);
  view.setInt32(104, state.flags, true);
  view.setInt32(108, state.eventSequence, true);
  writeSlots(view, 112, state.events);
  writeSlots(view, 120, state.eventParameters);
  view.setInt32(128, state.externalEvent, true);
  view.setInt32(132, state.externalEventParameter, true);
  view.setInt32(136, state.externalEventTimeMilliseconds, true);
  view.setInt32(140, state.clientNumber, true);
  view.setInt32(144, state.weapon, true);
  view.setInt32(148, state.weaponState, true);
  writeVector(view, 152, state.viewAngles);
  view.setInt32(164, state.viewHeight, true);
  view.setInt32(168, state.damageEvent, true);
  view.setInt32(172, state.damageYaw, true);
  view.setInt32(176, state.damagePitch, true);
  view.setInt32(180, state.damageCount, true);
  writeSlots(view, 184, state.stats);
  writeSlots(view, 248, state.persistent);
  writeSlots(view, 312, state.powerups);
  writeSlots(view, 376, state.ammo);
  view.setInt32(440, state.generic1, true);
  view.setInt32(444, state.loopSound, true);
  view.setInt32(448, state.jumpPadEntity, true);
  view.setInt32(452, state.pingMilliseconds, true);
  view.setInt32(456, state.movementFrameCount, true);
  view.setInt32(460, state.jumpPadFrame, true);
  view.setInt32(464, state.entityEventSequence, true);
}
