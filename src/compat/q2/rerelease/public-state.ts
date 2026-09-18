// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, RawEntityView } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2RereleaseEntityState, Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { clientLayout, edictLayout, fieldOffset } from "./layouts.ts";
import { readRereleasePlayerState } from "./player-state.ts";

/** API2023's published prefix only; no g_local.h private members. */
export class RereleasePublicEdict {
  constructor(readonly memory: MappedGuestMemory, readonly record: RawEntityView) { memory.check(record.address, edictLayout.byteLength, "read"); }
  address(name: string): GuestAddress { return this.memory.offset(this.record.address, BigInt(fieldOffset(edictLayout, name))); }
  int(name: string): number { return this.memory.readInt32(this.address(name)); }
  uint(name: string): number { return this.memory.readUint32(this.address(name)); }
  byte(name: string): number { return this.memory.readUint8(this.address(name)); }
  float(name: string): number { return this.memory.readFloat32(this.address(name)); }
  pointer(name: string): GuestAddress | null { return this.memory.readPointer(this.address(name)); }
  vector(name: string): Vec3 { const at = this.address(name); return { x: this.memory.readFloat32(at), y: this.memory.readFloat32(this.memory.offset(at, 4n)), z: this.memory.readFloat32(this.memory.offset(at, 8n)) }; }
  setVector(name: string, value: Vec3): void { const at = this.address(name); this.memory.writeFloat32(at, value.x); this.memory.writeFloat32(this.memory.offset(at, 4n), value.y); this.memory.writeFloat32(this.memory.offset(at, 8n), value.z); }
  client(): GuestAddress { const address = this.pointer("client"); if (address === null) throw new Error("API2023 source slot has no public client prefix"); this.memory.check(address, clientLayout.byteLength, "read"); return address; }
  playerState(): Q2RereleasePlayerState { return readRereleasePlayerState(this.memory, this.client()); }
  ping(): number { return this.memory.readInt32(this.memory.offset(this.client(), BigInt(fieldOffset(clientLayout, "ping")))); }
  setPing(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new RangeError("Invalid API2023 ping"); this.memory.writeInt32(this.memory.offset(this.client(), BigInt(fieldOffset(clientLayout, "ping"))), value); }
  state(): Q2RereleaseEntityState {
    return { number: this.uint("s.number"), origin: this.vector("s.origin"), angles: this.vector("s.angles"), oldOrigin: this.vector("s.old_origin"),
      modelIndexes: [this.int("s.modelindex"), this.int("s.modelindex2"), this.int("s.modelindex3"), this.int("s.modelindex4")], frame: this.int("s.frame"), skin: this.int("s.skinnum"),
      effects: this.memory.readUint64(this.address("s.effects")), renderEffects: this.uint("s.renderfx"), solid: this.uint("s.solid"), sound: this.int("s.sound"), event: this.byte("s.event"),
      alpha: this.float("s.alpha"), scale: this.float("s.scale"), instanceBits: this.byte("s.instance_bits"), loopVolume: this.float("s.loop_volume"), loopAttenuation: this.float("s.loop_attenuation"),
      owner: this.int("s.owner"), oldFrame: this.int("s.old_frame") };
  }
}
