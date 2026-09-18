// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentDigest } from "../../../contracts/content.ts";
import type { GuestAddress, GuestLayout, GuestValueLayout } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { signature } from "./api.ts";
import { readGuestString } from "./imports.ts";

export const q2EaksWeaponDigest: ContentDigest = "sha256:b60b79f7fb6f115218681a9cbab8765267e34f72466975526df05ad288925dde";
const P: GuestValueLayout = { kind: "scalar", storage: "pointer" };
const I: GuestValueLayout = { kind: "scalar", storage: "int32" };
const F: GuestValueLayout = { kind: "scalar", storage: "float32" };
export const q2EaksWeaponThinkSignature = signature([P]);
export const q2EaksFireRocketSignature = signature([P, P, P, I, I, F, I], P);

/** Sparse fields independently present in the v0.21 launch/project-source instructions. */
export const q2EaksProjectileLayout: GuestLayout = {
  id: "q2eaks-v0.21:observed-projectile-fields", byteLength: 0x7a8, alignment: 8, pointerBytes: 8, byteOrder: "little-endian", fields: [
    { name: "s.origin", byteOffset: 4, storage: "float32", count: 3 },
    { name: "s.angles", byteOffset: 16, storage: "float32", count: 3 },
    { name: "client", byteOffset: 0x78, storage: "pointer", count: 1 },
    { name: "owner", byteOffset: 0x5b8, storage: "pointer", count: 1 },
    { name: "velocity", byteOffset: 0x694, storage: "float32", count: 3 },
    { name: "nextthink", byteOffset: 0x6d8, storage: "int64", count: 1 },
    { name: "think.value", byteOffset: 0x700, storage: "pointer", count: 1 },
    { name: "think.list", byteOffset: 0x708, storage: "pointer", count: 1 },
    { name: "touch.value", byteOffset: 0x710, storage: "pointer", count: 1 },
    { name: "touch.list", byteOffset: 0x718, storage: "pointer", count: 1 },
    { name: "viewheight", byteOffset: 0x7a0, storage: "int32", count: 1 },
  ],
};
export const q2EaksWeaponClientLayout: GuestLayout = {
  id: "q2eaks-v0.21:observed-weapon-client-fields", byteLength: 0x19b0, alignment: 8, pointerBytes: 8, byteOrder: "little-endian", fields: [
    { name: "pers.hand", byteOffset: 0xa50, storage: "int32", count: 1 },
    { name: "pers.weapon", byteOffset: 0xbe8, storage: "pointer", count: 1 },
    { name: "v_angle", byteOffset: 0x1998, storage: "float32", count: 3 },
    { name: "v_forward", byteOffset: 0x19a4, storage: "float32", count: 3 },
  ],
};
export interface Q2EaksWeaponEntries {
  readonly weaponRunThink: GuestAddress;
  readonly rocketLauncherFire: GuestAddress;
  readonly fireRocket: GuestAddress;
  readonly spawn: GuestAddress;
  readonly free: GuestAddress;
  readonly rocketTouch: GuestAddress;
  readonly levelTime: GuestAddress;
}

/** Exact PE entries; calling them retains all native side effects and requires an initialized source shooter.
 * Weapon_RunThink owns transient damage/silencer setup before the source weapon dispatcher.
 * RocketLauncherFire contains the actual cvar policy; fireRocket alone does not.
 */
export function q2EaksWeaponEntries(module: Pick<RereleaseGuestModule, "memory">, imageBase: GuestAddress): Q2EaksWeaponEntries {
  const memory = module.memory;
  if (memory.module.digest !== q2EaksWeaponDigest || memory.pointerBytes !== 8) throw new Error("Q2Eaks weapon profile requires the exact v0.21 Windows x64 artifact");
  const entry = (rva: bigint): GuestAddress => {
    const address = memory.offset(imageBase, rva);
    memory.check(address, 1, "execute");
    return address;
  };
  const registered = (rva: bigint, name: string, tag: number, expectedRva: bigint): GuestAddress => {
    const record = memory.offset(imageBase, rva);
    const text = memory.readPointer(record), callback = memory.readPointer(memory.offset(record, 16n));
    if (text === null || callback === null || readGuestString(memory, text, name.length + 1) !== name
      || memory.readUint32(memory.offset(record, 8n)) !== tag || callback.byteOffset !== entry(expectedRva).byteOffset)
      throw new Error(`Q2Eaks typed source callback registration differs: ${name}`);
    memory.check(callback, 1, "execute");
    return callback;
  };
  const levelTime = memory.offset(imageBase, 0x2999c8n);
  memory.check(levelTime, 8, "read");
  return {
    weaponRunThink: entry(0xed420n), rocketLauncherFire: entry(0xef900n), fireRocket: entry(0x98310n), spawn: entry(0x95010n),
    free: registered(0x21e0c8n, "G_FreeEdict", 20, 0x95140n),
    rocketTouch: registered(0x21e1e8n, "rocket_touch", 21, 0x98060n), levelTime,
  };
}
