import { sourceScore, type SourcePrimaryMatch } from "../../contracts/source-match.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { GuestAddress, GuestCallValue } from "../../contracts/execution.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { qvmAngleVectors } from "../../core/qvm-math.ts";
import type { NativePrimaryWeaponHost, NativePrimaryWeaponProfile } from "./native-primary-weapons.ts";
import { classicSignature, q2Pointer } from "./classic/layout.ts";
import { signature } from "./rerelease/api.ts";

export interface NativePrimaryPlayerProfile {
  readonly digest: ContentDigest;
  readonly match?: SourcePrimaryMatch;
  readonly spawn: number;
  readonly objectives: { readonly kind: "none" } | { readonly kind: "entry"; readonly entry: number };
  readonly commandAngles: number;
  readonly velocity: number;
  readonly forward: number | null;
}

/** Source spawn selection and private client pose; the caller owns the equipment's teleport effect. */
export class NativePrimaryPlayer {
  constructor(private readonly host: NativePrimaryWeaponHost, private readonly weapon: NativePrimaryWeaponProfile, readonly profile: NativePrimaryPlayerProfile) {
    if (profile.match !== undefined && (!Number.isSafeInteger(profile.match.score) || profile.match.score < 0 || profile.match.score % 4 !== 0 || profile.match.score + 4 > weapon.client.byteLength)) throw new Error("Native score exceeds the declared client record");
    if (host.memory.module.digest !== profile.digest || profile.digest !== weapon.digest) throw new Error("Native player service belongs to another executable");
  }
  private current(actor: ActorId): { readonly entity: GuestAddress; readonly client: GuestAddress } {
    const record = this.host.recordFor(actor);
    if (record === null || this.host.actor(record)?.equals(actor) !== true) throw new Error("Native player service has no current actor");
    const client = this.host.memory.readPointer(this.host.memory.offset(record.address, BigInt(this.weapon.entity.client)));
    if (client === null) throw new Error("Native player service has no source client");
    this.host.memory.check(client, this.weapon.client.byteLength, "read");
    return { entity: record.address, client };
  }
  score(actor: ActorId): number {
    const match = this.profile.match; if (match === undefined) throw new Error("Original native score storage has no declaration");
    return this.host.memory.readInt32(this.host.memory.offset(this.current(actor).client, BigInt(match.score)));
  }
  setScore(actor: ActorId, score: number): void {
    const match = this.profile.match; if (match === undefined) throw new Error("Original native score storage has no declaration");
    this.host.memory.writeInt32(this.host.memory.offset(this.current(actor).client, BigInt(match.score)), sourceScore(score));
  }
  maxHealth(actor: ActorId): number {
    const { entity } = this.current(actor); return this.host.memory.readInt32(this.host.memory.offset(entity, BigInt(this.weapon.entity.maxHealth.offset)));
  }
  setMaxHealth(actor: ActorId, value: number): void {
    if (!Number.isInteger(value) || value <= 0 || value > 0x7fffffff) throw new Error("Native player max health requires a positive int32");
    const { entity } = this.current(actor); this.host.memory.writeInt32(this.host.memory.offset(entity, BigInt(this.weapon.entity.maxHealth.offset)), value);
  }
  dropObjectives(actor: ActorId): void {
    const { entity } = this.current(actor), declaration = this.profile.objectives;
    if (declaration.kind === "none") return;
    this.host.invoke(this.host.memory.offset(this.host.image, BigInt(declaration.entry)),
      this.weapon.abi.kind === "windows-i386" ? classicSignature([q2Pointer]) : signature([q2Pointer]), [{ kind: "pointer", value: entity }]);
    this.current(actor);
  }
  spawnPoint(actor: ActorId): { readonly origin: Vec3; readonly angles: Vec3 } {
    const { entity } = this.current(actor), { memory } = this.host;
    const scratch = memory.allocate({ byteLength: 32, alignment: 8n, label: "source player spawn result" });
    try {
      const origin = scratch, angles = memory.offset(scratch, 12n), landmark = memory.offset(scratch, 24n);
      const storage = memory.borrow(scratch, 32); for (let index = 0; index < 32; index++) storage.setUint8(index, 0);
      const values: GuestCallValue[] = [entity, origin, angles].map(value => ({ kind: "pointer", value }));
      const target = memory.offset(this.host.image, BigInt(this.profile.spawn));
      if (this.weapon.abi.kind === "windows-i386") this.host.invoke(target, classicSignature([q2Pointer, q2Pointer, q2Pointer]), values);
      else {
        const result = this.host.invoke(target, signature([q2Pointer, q2Pointer, q2Pointer, { kind: "scalar", storage: "uint8" }, q2Pointer], { kind: "scalar", storage: "uint8" }),
          [...values, { kind: "uint32", value: 1 }, { kind: "pointer", value: landmark }]);
        if (result.kind !== "uint32" || result.value === 0) throw new Error("Original native spawn selector could not place the player");
      }
      this.current(actor);
      const vector = (address: GuestAddress): Vec3 => ({ x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) });
      return { origin: vector(origin), angles: vector(angles) };
    } finally { memory.unmap(scratch, 32); }
  }
  teleport(actor: ActorId, origin: Vec3, velocity: Vec3, angles: Vec3, holdMilliseconds: number): void {
    const { entity, client } = this.current(actor), { memory } = this.host, classic = this.weapon.abi.kind === "windows-i386";
    const state = memory.borrow(client, this.weapon.client.byteLength);
    const vector = (address: GuestAddress, value: Vec3): void => {
      memory.writeFloat32(address, value.x); memory.writeFloat32(memory.offset(address, 4n), value.y); memory.writeFloat32(memory.offset(address, 8n), value.z);
    };
    vector(memory.offset(entity, 4n), origin); vector(memory.offset(entity, 28n), origin);
    vector(memory.offset(entity, BigInt(this.profile.velocity)), velocity);
    for (const [axis, value] of [origin.x, origin.y, origin.z].entries()) {
      if (classic) state.setInt16(4 + axis * 2, Math.trunc(Math.fround(value * 8)), true);
      else state.setFloat32(4 + axis * 4, value, true);
    }
    for (const [axis, value] of [velocity.x, velocity.y, velocity.z].entries()) {
      if (classic) state.setInt16(10 + axis * 2, Math.trunc(Math.fround(value * 8)), true);
      else state.setFloat32(16 + axis * 4, value, true);
    }
    if (classic) { state.setUint8(16, state.getUint8(16) & ~4 | 32); state.setUint8(17, Math.min(255, Math.ceil(holdMilliseconds / 8))); }
    else { state.setUint16(28, state.getUint16(28, true) & ~4 | 32, true); state.setUint16(30, Math.min(65535, holdMilliseconds), true); }
    for (const [axis, value] of [angles.x, angles.y, angles.z].entries()) {
      const delta = Math.fround(value - state.getFloat32(this.profile.commandAngles + axis * 4, true));
      if (classic) state.setInt16(20 + axis * 2, Math.trunc(Math.fround(delta * (65536 / 360))), true);
      else state.setFloat32(36 + axis * 4, delta, true);
      state.setFloat32((classic ? 28 : 52) + axis * 4, value, true);
      state.setFloat32(this.weapon.client.viewAngles + axis * 4, value, true);
    }
    if (this.profile.forward !== null) vector(memory.offset(client, BigInt(this.profile.forward)), qvmAngleVectors(angles).forward);
  }
}
