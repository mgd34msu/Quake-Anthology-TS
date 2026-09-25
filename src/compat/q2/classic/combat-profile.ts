import type { ContentDigest } from "../../../contracts/content.ts";

export interface ClassicCombatProfile {
  readonly digest: ContentDigest;
  readonly game: "base" | "xatrix" | "rogue" | "ctf";
  readonly entityBytes: number;
  readonly fields: { readonly health: number; readonly damageable: number; readonly flags: number; readonly mass: number; readonly velocity: number; readonly pain: number; readonly die: number };
  readonly client: { readonly inventory: number; readonly inventoryCount: number; readonly maxGrenades: number; readonly invincibleFrame: number; readonly userinfo: number; readonly userinfoBytes: number; readonly viewAngles: number };
  readonly entries: { readonly damage: number; readonly powerArmor: number; readonly regularArmor: number; readonly spawn: number; readonly free: number };
  readonly globals: { readonly levelFrame: number; readonly itemList: number; readonly itemBytes: number };
  readonly items: { readonly jacket: number; readonly combat: number; readonly body: number; readonly screen: number; readonly shield: number; readonly cells: number; readonly grenades: number };
  readonly itemFields: { readonly className: number; readonly armorInfo: number };
  readonly armorInfo: { readonly normalProtection: number; readonly energyProtection: number };
  readonly armor: { readonly regular: readonly number[]; readonly empty: number };
  readonly flags: { readonly invulnerable: number; readonly notarget: number; readonly noKnockback: number; readonly powerArmor: number };
  readonly teams: { readonly model: number; readonly skin: number };
}

/** Original Xatrix DLL. g_local.h i686 layouts and each used entry/store verified against this PE.
 * ClientThink RVA32ad6 writes private v_angle0xe44 before separate public ps.viewangles stores. */
export const xatrixCombatProfile: ClassicCombatProfile = {
  digest: "sha256:8187df3fd5b4d435d8227434d3351aad2b47e546236403e52adcd4d275810c45", game: "xatrix", entityBytes: 896,
  fields: { health: 480, damageable: 512, flags: 264, mass: 400, velocity: 376, pain: 452, die: 456 },
  client: { inventory: 740, inventoryCount: 256, maxGrenades: 1776, invincibleFrame: 3728, userinfo: 188, userinfoBytes: 512, viewAngles: 3652 },
  entries: { damage: 0x5050, powerArmor: 0x5580, regularArmor: 0x5760, spawn: 0x19090, free: 0x19140 },
  globals: { levelFrame: 0x76800, itemList: 0x4b828, itemBytes: 76 },
  items: { jacket: 3, combat: 2, body: 1, screen: 5, shield: 6, cells: 23, grenades: 12 },
  itemFields: { className: 0, armorInfo: 64 }, armorInfo: { normalProtection: 8, energyProtection: 12 },
  armor: { regular: [3, 2, 1], empty: 1 }, flags: { invulnerable: 16, notarget: 32, noKnockback: 2048, powerArmor: 4096 }, teams: { model: 64, skin: 128 },
};

export function validateClassicCombatProfile(profile: ClassicCombatProfile): void {
  const scalar = (value: number, length = 4): void => {
    if (!Number.isSafeInteger(value) || value < 0 || value + length > 0x100000000) throw new Error("Classic combat source field exceeds its address range");
  };
  scalar(profile.entityBytes, 0); scalar(profile.globals.itemBytes, 0);
  if (profile.entityBytes < 260 || profile.globals.itemBytes < 4 || !Number.isSafeInteger(profile.client.inventoryCount) || profile.client.inventoryCount < 1)
    throw new Error("Classic combat source record sizes are invalid");
  for (const [name, offset] of Object.entries(profile.fields)) {
    scalar(offset); if (offset % 4 !== 0 || offset + (name === "velocity" ? 12 : 4) > profile.entityBytes) throw new Error("Classic combat field is outside its source edict");
  }
  for (const [name, offset] of Object.entries(profile.client)) {
    if (name === "inventoryCount" || name === "userinfoBytes") continue;
    scalar(offset); if (name !== "userinfo" && offset % 4 !== 0) throw new Error("Classic combat client field is unaligned");
  }
  if (!Number.isSafeInteger(profile.client.userinfoBytes) || profile.client.userinfoBytes < 1) throw new Error("Classic combat userinfo requires a bounded source string");
  scalar(profile.client.userinfo, profile.client.userinfoBytes); scalar(profile.client.inventory, profile.client.inventoryCount * 4);
  for (const value of [...Object.values(profile.entries), profile.globals.levelFrame, profile.globals.itemList]) scalar(value);
  for (const offset of Object.values(profile.itemFields)) {
    scalar(offset); if (offset % 4 !== 0 || offset + 4 > profile.globals.itemBytes) throw new Error("Classic armor item field exceeds its original item record");
  }
  for (const offset of Object.values(profile.armorInfo)) { scalar(offset); if (offset % 4 !== 0) throw new Error("Classic armor information is unaligned"); }
  if (profile.armorInfo.normalProtection === profile.armorInfo.energyProtection || profile.itemFields.className === profile.itemFields.armorInfo)
    throw new Error("Classic armor fields overlap");
  if (profile.armor.regular.length === 0 || new Set(profile.armor.regular).size !== profile.armor.regular.length || !profile.armor.regular.includes(profile.armor.empty))
    throw new Error("Classic regular armor requires distinct source priorities and an admitted empty tier");
  for (const index of [...Object.values(profile.items), ...profile.armor.regular])
    if (!Number.isSafeInteger(index) || index < 1 || index >= profile.client.inventoryCount) throw new Error("Classic combat inventory index exceeds its declared source storage");
  for (const value of [...Object.values(profile.flags), ...Object.values(profile.teams)])
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Classic combat mask exceeds its uint32 source value");
}
export function classicCombatProfile(digest: ContentDigest): ClassicCombatProfile | null {
  return digest === xatrixCombatProfile.digest ? xatrixCombatProfile : null;
}
