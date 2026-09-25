// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestLayout, GuestValueLayout } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { validateRereleasePrimaryWorldProfile, type RereleasePrimaryWorldProfile } from "./world-profile.ts";
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
export interface RereleaseNativeEntries { readonly spawn: GuestAddress; readonly free: GuestAddress; readonly damage: GuestAddress; readonly powerArmor: GuestAddress; readonly regularArmor: { readonly entry: GuestAddress; readonly join: GuestAddress }; readonly armorInfoTable: GuestAddress; readonly processPain: GuestAddress; readonly time: GuestAddress; }
/** Resolve artifact-qualified source functions and data within the loaded module. */
export function rereleaseEntries(module: Pick<RereleaseGuestModule, "memory">, imageBase: GuestAddress, profile: RereleasePrimaryWorldProfile): RereleaseNativeEntries {
  validateRereleasePrimaryWorldProfile(profile, module.memory.module.digest);
  const entry = (rva: number): GuestAddress => { const address = module.memory.offset(imageBase, BigInt(rva)); module.memory.check(address, 1, "execute"); return address; };
  const data = (rva: number, bytes: number): GuestAddress => { const address = module.memory.offset(imageBase, BigInt(rva)); module.memory.check(address, bytes, "read"); return address; };
  const source = profile.entries;
  return { spawn: entry(source.spawn), free: entry(source.free), damage: entry(source.damage), powerArmor: entry(source.powerArmor),
    regularArmor: { entry: entry(source.regularArmor.entry), join: entry(source.regularArmor.join) },
    armorInfoTable: data(profile.armor.table, (profile.client.inventoryCount - 1) * profile.armor.stride + 8), processPain: entry(source.processPain), time: data(source.time, 8) };
}
