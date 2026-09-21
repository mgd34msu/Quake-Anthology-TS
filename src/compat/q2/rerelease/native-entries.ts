// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestLayout, GuestValueLayout } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";
import { signature } from "./api.ts";

const P: GuestValueLayout = { kind: "scalar", storage: "pointer" };
const I: GuestValueLayout = { kind: "scalar", storage: "int32" };
export const rereleaseModLayout: GuestLayout = { id: "q2-rerelease:mod_t", byteLength: 3, alignment: 1, pointerBytes: 8, byteOrder: "little-endian", fields: [
  { name: "id", byteOffset: 0, storage: "uint8", count: 1 }, { name: "friendly_fire", byteOffset: 1, storage: "uint8", count: 1 }, { name: "no_point_loss", byteOffset: 2, storage: "uint8", count: 1 },
] };
export const rereleaseSpawnSignature = signature([], P);
export const rereleaseFreeSignature = signature([P]);
// Win64 passes the three-byte by-value mod_t indirectly; the shared ABI planner owns that rule.
export const rereleaseDamageSignature = signature([P, P, P, P, P, P, I, I, I, { kind: "aggregate", layout: rereleaseModLayout }]);
export const rereleasePowerArmorSignature = signature([P, P, P, I, I], I);
export interface RereleaseNativeEntries { readonly spawn: GuestAddress; readonly free: GuestAddress; readonly damage: GuestAddress; readonly powerArmor: GuestAddress; readonly processPain: GuestAddress; }
/** Retail entry boundaries verified through native give/pickup/trigger_hurt and monster-frame execution plus PE unwind records. */
export function retailRereleaseEntries(module: Pick<RereleaseGuestModule, "memory">, imageBase: GuestAddress): RereleaseNativeEntries {
  const authority = retailRereleaseClientProfile.authority;
  if (authority.kind !== "artifact" || module.memory.module.digest !== authority.digest) throw new Error("Native entry profile requires the verified retail DLL");
  const entry = (rva: bigint): GuestAddress => { const address = module.memory.offset(imageBase, rva); module.memory.check(address, 1, "execute"); return address; };
  return { spawn: entry(0x964b0n), free: entry(0x96600n), damage: entry(0x5cae0n), powerArmor: entry(0x5c100n), processPain: entry(0x76e20n) };
}

/** T_Damage compares client+0x1a10 and monster+0xb88 against this saved level.time global. */
export function retailRereleaseTime(module: Pick<RereleaseGuestModule, "memory">, entries: RereleaseNativeEntries): bigint {
  const authority = retailRereleaseClientProfile.authority;
  if (authority.kind !== "artifact" || module.memory.module.digest !== authority.digest) throw new Error("Native clock profile requires the verified retail DLL");
  return module.memory.readInt64(module.memory.offset(entries.damage, 0x241b28n - 0x5cae0n));
}

/** Retail monster accumulator offsets measured at both T_Damage store sites and M_ProcessPain reset. */
export const rereleaseMonsterDamage = {
  attacker: 3120, inflictor: 3128, blood: 3136, knockback: 3140, point: 3144, mod: 3156,
};
