// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { Vec3, Vec4 } from "../../../contracts/math.ts";
import type { Q2RereleaseMovementState, Q2RereleasePlayerState, Q2RereleaseUserCommand } from "../../../contracts/protocol.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { playerStateLayout } from "./layouts.ts";

function writeVector(view: DataView, offset: number, value: Vec3): void { view.setFloat32(offset, value.x, true); view.setFloat32(offset + 4, value.y, true); view.setFloat32(offset + 8, value.z, true); }
function readVector(view: DataView, offset: number): Vec3 { return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) }; }
function readColor(view: DataView, offset: number): Vec4 { return { ...readVector(view, offset), w: view.getFloat32(offset + 12, true) }; }
function writeColor(view: DataView, offset: number, value: Vec4): void { writeVector(view, offset, value); view.setFloat32(offset + 12, value.w, true); }
export function writeRereleaseMovementState(view: DataView, value: Q2RereleaseMovementState): void {
  view.setInt32(0, value.type, true); writeVector(view, 4, value.origin); writeVector(view, 16, value.velocity);
  view.setUint16(28, value.flags, true); view.setUint16(30, value.timeMilliseconds, true); view.setInt16(32, value.gravity, true);
  writeVector(view, 36, value.deltaAngles); view.setInt8(48, value.viewHeight);
}
export function readRereleaseMovementState(view: DataView): Q2RereleaseMovementState {
  return { kind: "q2-rerelease", type: view.getInt32(0, true), origin: readVector(view, 4), velocity: readVector(view, 16), flags: view.getUint16(28, true), timeMilliseconds: view.getUint16(30, true), gravity: view.getInt16(32, true), deltaAngles: readVector(view, 36), viewHeight: view.getInt8(48) };
}
export function writeRereleasePlayerState(memory: MappedGuestMemory, address: GuestAddress, value: Q2RereleasePlayerState): void {
  if (value.stats.length > 64) throw new RangeError("Rerelease player state has more than 64 source stats");
  memory.check(address, playerStateLayout.byteLength, "write");
  const view = memory.borrow(address, playerStateLayout.byteLength);
  writeRereleaseMovementState(view, value.movement);
  writeVector(view, 52, value.viewAngles); writeVector(view, 64, value.viewOffset); writeVector(view, 76, value.kickAngles); writeVector(view, 88, value.gunAngles); writeVector(view, 100, value.gunOffset);
  view.setInt32(112, value.gunIndex, true); view.setInt32(116, value.gunSkin, true); view.setInt32(120, value.gunFrame, true); view.setInt32(124, value.gunRate, true);
  writeColor(view, 128, value.screenBlend); writeColor(view, 144, value.damageBlend); view.setFloat32(160, value.fov, true); view.setUint8(164, value.renderFlags);
  for (let index = 0; index < 64; index++) view.setInt16(166 + index * 2, value.stats[index] ?? 0, true);
  view.setUint8(294, value.teamId);
}
export function readRereleasePlayerState(memory: MappedGuestMemory, address: GuestAddress): Q2RereleasePlayerState {
  const view = memory.borrow(address, playerStateLayout.byteLength);
  return { kind: "q2-rerelease", movement: readRereleaseMovementState(view), viewAngles: readVector(view, 52), viewOffset: readVector(view, 64), kickAngles: readVector(view, 76), gunAngles: readVector(view, 88), gunOffset: readVector(view, 100),
    gunIndex: view.getInt32(112, true), gunSkin: view.getInt32(116, true), gunFrame: view.getInt32(120, true), gunRate: view.getInt32(124, true), screenBlend: readColor(view, 128), damageBlend: readColor(view, 144), fov: view.getFloat32(160, true), renderFlags: view.getUint8(164), stats: Array.from({ length: 64 }, (_, index) => view.getInt16(166 + index * 2, true)), teamId: view.getUint8(294) };
}
export function writeRereleaseUserCommand(view: DataView, value: Q2RereleaseUserCommand): void {
  view.setUint8(0, value.milliseconds); view.setUint8(1, value.buttons); writeVector(view, 4, value.angles);
  view.setFloat32(16, value.forwardMove, true); view.setFloat32(20, value.sideMove, true); view.setUint32(24, value.serverFrame, true);
}
export function readRereleaseUserCommand(view: DataView): Q2RereleaseUserCommand {
  return { kind: "q2-rerelease", milliseconds: view.getUint8(0), buttons: view.getUint8(1), angles: readVector(view, 4),
    forwardMove: view.getFloat32(16, true), sideMove: view.getFloat32(20, true), serverFrame: view.getUint32(24, true) };
}
