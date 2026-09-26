// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, RawEntityView } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2RereleaseEntityState, Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { clientLayout, edictLayout, entityStateLayout, fieldOffset } from "./layouts.ts";
import { readRereleasePlayerState } from "./player-state.ts";

const entityFields = {
  number: fieldOffset(entityStateLayout, "number"), origin: fieldOffset(entityStateLayout, "origin"), angles: fieldOffset(entityStateLayout, "angles"), oldOrigin: fieldOffset(entityStateLayout, "old_origin"),
  model: fieldOffset(entityStateLayout, "modelindex"), model2: fieldOffset(entityStateLayout, "modelindex2"), model3: fieldOffset(entityStateLayout, "modelindex3"), model4: fieldOffset(entityStateLayout, "modelindex4"),
  frame: fieldOffset(entityStateLayout, "frame"), skin: fieldOffset(entityStateLayout, "skinnum"), effects: fieldOffset(entityStateLayout, "effects"), renderEffects: fieldOffset(entityStateLayout, "renderfx"),
  solid: fieldOffset(entityStateLayout, "solid"), sound: fieldOffset(entityStateLayout, "sound"), event: fieldOffset(entityStateLayout, "event"), alpha: fieldOffset(entityStateLayout, "alpha"), scale: fieldOffset(entityStateLayout, "scale"),
  instanceBits: fieldOffset(entityStateLayout, "instance_bits"), loopVolume: fieldOffset(entityStateLayout, "loop_volume"), loopAttenuation: fieldOffset(entityStateLayout, "loop_attenuation"), owner: fieldOffset(entityStateLayout, "owner"), oldFrame: fieldOffset(entityStateLayout, "old_frame"),
};
const clientFields = { velocity: fieldOffset(clientLayout, "ps.pmove.velocity"), flags: fieldOffset(clientLayout, "ps.pmove.pm_flags"), height: fieldOffset(clientLayout, "ps.pmove.viewheight"), offset: fieldOffset(clientLayout, "ps.viewoffset") };
function readVector(view: DataView, offset: number): Vec3 { return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) }; }
const snapshotBuffers = new WeakMap<MappedGuestMemory, Map<number, { readonly bytes: Uint8Array; readonly view: DataView }>>();

/** API2023's published prefix only; no g_local.h private members. */
export class RereleasePublicEdict {
  constructor(readonly memory: MappedGuestMemory, readonly record: RawEntityView) { memory.check(record.address, edictLayout.byteLength, "read"); }
  address(name: string): GuestAddress { return this.memory.offset(this.record.address, BigInt(fieldOffset(edictLayout, name))); }
  int(name: string): number { return this.memory.readInt32(this.address(name)); }
  uint(name: string): number { return this.memory.readUint32(this.address(name)); }
  byte(name: string): number { return this.memory.readUint8(this.address(name)); }
  float(name: string): number { return this.memory.readFloat32(this.address(name)); }
  pointer(name: string): GuestAddress | null { return this.memory.readPointer(this.address(name)); }
  // Decoders consume these views synchronously and return only independent values.
  private snapshot(address: GuestAddress, byteLength: number): DataView {
    let buffers = snapshotBuffers.get(this.memory);
    if (buffers === undefined) { buffers = new Map(); snapshotBuffers.set(this.memory, buffers); }
    let buffer = buffers.get(byteLength);
    if (buffer === undefined) {
      const bytes = new Uint8Array(byteLength);
      buffer = { bytes, view: new DataView(bytes.buffer) }; buffers.set(byteLength, buffer);
    }
    this.memory.copyInto(address, buffer.bytes);
    return buffer.view;
  }
  vector(name: string): Vec3 { return this.memory.readFloat32Vector(this.address(name)); }
  setVector(name: string, value: Vec3): void { const at = this.address(name); this.memory.writeFloat32(at, value.x); this.memory.writeFloat32(this.memory.offset(at, 4n), value.y); this.memory.writeFloat32(this.memory.offset(at, 8n), value.z); }
  client(): GuestAddress { const address = this.pointer("client"); if (address === null) throw new Error("API2023 source slot has no public client prefix"); this.memory.check(address, clientLayout.byteLength, "read"); return address; }
  playerState(): Q2RereleasePlayerState { return readRereleasePlayerState(this.memory, this.client()); }
  playerVelocity(): Vec3 { return this.memory.readFloat32Vector(this.memory.offset(this.client(), BigInt(clientFields.velocity))); }
  playerMovementFlags(): number { return this.memory.readUint16(this.memory.offset(this.client(), BigInt(clientFields.flags))); }
  playerView(): { readonly viewOffset: Vec3; readonly viewHeight: number; readonly movementFlags: number } {
    const view = this.snapshot(this.memory.offset(this.client(), BigInt(clientFields.flags)), clientFields.offset + 12 - clientFields.flags);
    return { viewOffset: readVector(view, clientFields.offset - clientFields.flags), viewHeight: view.getInt8(clientFields.height - clientFields.flags), movementFlags: view.getUint16(0, true) };
  }
  modelState(): Pick<Q2RereleaseEntityState, "modelIndexes" | "skin"> {
    const view = this.snapshot(this.address("s.modelindex"), entityFields.skin + 4 - entityFields.model);
    return { modelIndexes: [view.getInt32(0, true), view.getInt32(entityFields.model2 - entityFields.model, true), view.getInt32(entityFields.model3 - entityFields.model, true), view.getInt32(entityFields.model4 - entityFields.model, true)], skin: view.getInt32(entityFields.skin - entityFields.model, true) };
  }
  ping(): number { return this.memory.readInt32(this.memory.offset(this.client(), BigInt(fieldOffset(clientLayout, "ping")))); }
  setPing(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new RangeError("Invalid API2023 ping"); this.memory.writeInt32(this.memory.offset(this.client(), BigInt(fieldOffset(clientLayout, "ping"))), value); }
  state(): Q2RereleaseEntityState {
    const view = this.snapshot(this.address("s.number"), entityStateLayout.byteLength);
    return { number: view.getUint32(entityFields.number, true), origin: readVector(view, entityFields.origin), angles: readVector(view, entityFields.angles), oldOrigin: readVector(view, entityFields.oldOrigin),
      modelIndexes: [view.getInt32(entityFields.model, true), view.getInt32(entityFields.model2, true), view.getInt32(entityFields.model3, true), view.getInt32(entityFields.model4, true)], frame: view.getInt32(entityFields.frame, true), skin: view.getInt32(entityFields.skin, true),
      effects: view.getBigUint64(entityFields.effects, true), renderEffects: view.getUint32(entityFields.renderEffects, true), solid: view.getUint32(entityFields.solid, true), sound: view.getInt32(entityFields.sound, true), event: view.getUint8(entityFields.event),
      alpha: view.getFloat32(entityFields.alpha, true), scale: view.getFloat32(entityFields.scale, true), instanceBits: view.getUint8(entityFields.instanceBits), loopVolume: view.getFloat32(entityFields.loopVolume, true), loopAttenuation: view.getFloat32(entityFields.loopAttenuation, true),
      owner: view.getInt32(entityFields.owner, true), oldFrame: view.getInt32(entityFields.oldFrame, true) };
  }
}
