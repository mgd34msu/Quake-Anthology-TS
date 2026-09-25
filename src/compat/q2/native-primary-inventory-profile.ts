import type { ContentDigest } from "../../contracts/content.ts";
import type { NativePrimaryInventoryProfile } from "./native-primary-inventory.ts";

const classic: NativePrimaryInventoryProfile = {
  digest: "sha256:8187df3fd5b4d435d8227434d3351aad2b47e546236403e52adcd4d275810c45",
  prototypes: { weapon: "q2:weapon_blaster", ammunition: "q2:ammo_shells", usable: "q2:item_quad", passive: "q2:key_data_cd", droppable: "q2:item_quad", undroppable: "q2:weapon_blaster" },
  abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" },
  client: 0x54, inventory: 0x2e4, count: 256, cursor: 0x2e0, empty: -1, selectionWrites: [{ offset: 0x2e0, bytes: 4 }],
  next: { entry: 0x2fe0, scan: 0x3003, join: 0x306a, menuArgument: false },
  previous: { entry: 0x3070, scan: 0x3093, join: 0x30ff }, validate: { entry: 0x3110, scan: null },
  use: { entry: 0x3a60, call: 0x3abc, join: 0x3abe },
  namedUse: { entry: 0x36d0, lookupCall: 0x36dd, lookupReturn: 0x36e2, call: 0x384c, join: 0x384f },
};
const retail: NativePrimaryInventoryProfile = {
  digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd",
  prototypes: { weapon: "q2:weapon_blaster", ammunition: "q2:ammo_shells", usable: "q2:item_quad", passive: "q2:key_data_cd", droppable: "q2:item_quad", undroppable: "q2:weapon_blaster" },
  abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" },
  client: 0x78, inventory: 0xa80, count: 84, cursor: 0xa70, empty: 0,
  selectionWrites: [{ offset: 0xa70, bytes: 4 }, { offset: 0xa78, bytes: 8 }, { offset: 0x10c, bytes: 2 }],
  next: { entry: 0x56a40, scan: 0x56a76, join: 0x56b1e, menuArgument: true },
  previous: { entry: 0x56b30, scan: 0x56bde, join: 0x56c84 },
  validate: { entry: 0x56c90, scan: { entry: 0x56ca6, join: 0x56d14 } },
  use: { entry: 0x58670, call: 0x58775, join: 0x5877b },
  namedUse: { entry: 0x581f0, lookupCall: 0x582cf, lookupReturn: 0x582d4, call: 0x583bc, join: 0x583c2 },
};
export function nativePrimaryInventoryProfile(digest: ContentDigest): NativePrimaryInventoryProfile | null {
  return digest === classic.digest ? classic : digest === retail.digest ? retail : null;
}
