// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentDigest } from "../../../contracts/content.ts";
import type { GuestLayout } from "../../../contracts/execution.ts";
import { clientLayout, privateClientPrefixLayout } from "./layouts.ts";

export interface RereleaseClientProfile {
  readonly authority: { readonly kind: "source"; readonly headerDigest: ContentDigest } | { readonly kind: "artifact"; readonly digest: ContentDigest };
  readonly layout: GuestLayout;
  readonly inventoryCount: number;
  readonly ammoCount: number;
}
export const sourceRereleaseClientProfile: RereleaseClientProfile = {
  authority: { kind: "source", headerDigest: "sha256:3257c79f07d9e8ef333342b9a0be0bde7dd514d9de1b9b36173aad157601aecf" },
  layout: privateClientPrefixLayout, inventoryCount: 82, ammoCount: 12,
};
/** Sparse retail fields, independently observed rather than shifting the source struct.
 * Bot_SetWeapon RVA11c060: inventory0xa80, weapon0xbe8, newweapon0x1898,
 * no_weapon_chains0x1b68, item bound84. Bot_UseItem RVA11c1b0: selected_item0xa70.
 * Executed Init allocates7344/client; ClientConnect initializes twelve int16 ammo
 * capacities at3024 to p_client.cpp InitClientPersistant's distinct source values.
 */
export const retailRereleaseClientProfile: RereleaseClientProfile = {
  authority: { kind: "artifact", digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd" },
  inventoryCount: 84, ammoCount: 12,
  layout: { id: "q2-rerelease-retail:observed-client-fields", byteLength: 7344, alignment: 8, pointerBytes: 8, byteOrder: "little-endian", fields: [
    ...clientLayout.fields.map(field => ({ ...field, name: `shared.${field.name}` })),
    { name: "pers.selected_item", byteOffset: 2672, storage: "int32", count: 1 },
    { name: "pers.inventory", byteOffset: 2688, storage: "int32", count: 84 },
    { name: "pers.max_ammo", byteOffset: 3024, storage: "int16", count: 12 },
    { name: "pers.weapon", byteOffset: 3048, storage: "pointer", count: 1 },
    { name: "newweapon", byteOffset: 6296, storage: "pointer", count: 1 },
    { name: "no_weapon_chains", byteOffset: 7016, storage: "uint8", count: 1 },
  ] },
};
