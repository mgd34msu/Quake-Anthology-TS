import type { ContentDigest } from "../../../contracts/content.ts";

export interface ClassicCombatProfile {
  readonly digest: ContentDigest;
  readonly game: "base" | "xatrix" | "rogue" | "ctf";
  readonly entityBytes: number;
  readonly fields: { readonly health: number; readonly damageable: number; readonly flags: number; readonly mass: number; readonly velocity: number; readonly pain: number; readonly die: number };
  readonly client: { readonly inventory: number; readonly inventoryCount: number; readonly maxGrenades: number; readonly invincibleFrame: number; readonly userinfo: number; readonly viewAngles: number };
  readonly entries: { readonly damage: number; readonly powerArmor: number; readonly spawn: number; readonly free: number };
  readonly globals: { readonly levelFrame: number; readonly itemList: number; readonly itemBytes: number };
  readonly items: { readonly jacket: number; readonly combat: number; readonly body: number; readonly screen: number; readonly shield: number; readonly cells: number; readonly grenades: number };
}

/** Original Xatrix DLL. g_local.h i686 layouts and each used entry/store verified against this PE.
 * ClientThink RVA32ad6 writes private v_angle0xe44 before separate public ps.viewangles stores. */
export const xatrixCombatProfile: ClassicCombatProfile = {
  digest: "sha256:8187df3fd5b4d435d8227434d3351aad2b47e546236403e52adcd4d275810c45", game: "xatrix", entityBytes: 896,
  fields: { health: 480, damageable: 512, flags: 264, mass: 400, velocity: 376, pain: 452, die: 456 },
  client: { inventory: 740, inventoryCount: 256, maxGrenades: 1776, invincibleFrame: 3728, userinfo: 188, viewAngles: 3652 },
  entries: { damage: 0x5050, powerArmor: 0x5580, spawn: 0x19090, free: 0x19140 },
  globals: { levelFrame: 0x76800, itemList: 0x4b828, itemBytes: 76 },
  items: { jacket: 3, combat: 2, body: 1, screen: 5, shield: 6, cells: 23, grenades: 12 },
};
export function classicCombatProfile(digest: ContentDigest): ClassicCombatProfile | null {
  return digest === xatrixCombatProfile.digest ? xatrixCombatProfile : null;
}
