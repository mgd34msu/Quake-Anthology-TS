import type { ContentDigest } from "../../contracts/content.ts";
import type { NativePrimaryCommandProfile } from "./native-primary-commands.ts";
import { xatrixCombatProfile } from "./classic/combat-profile.ts";

const xatrix: NativePrimaryCommandProfile = {
  digest: xatrixCombatProfile.digest, abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" },
  give: { entry: 0x3140, weapons: 0x3256, ammo: 0x32af, unknown: { entry: 0x3455, join: 0x3466 }, ammoGrants: [{ entry: 0x34ce, join: 0x34d5, descriptor: "rsi", kind: "set" }, { entry: 0x34db, join: 0x34f3, descriptor: "rsi", kind: "add" }], argc: 0x7677c, argv: 0x76780 },
  drop: { entry: 0x307c0, eligibility: { entry: 0x307e7, join: 0x3083b } },
  client: { pointer: 0x54, weapon: 0x704, ammoIndex: 0xdc8, inventory: 0x2e4 },
  items: { weaponFlag: 1, ammunitionFlag: 2, table: 0x4b828, stride: 76, count: 48, classname: 0, flags: 0x38, icon: 0x24, ammo: { kind: "name", offset: 0x34, label: 0x28 } },
};
const retail: NativePrimaryCommandProfile = {
  digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd", abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" },
  give: { entry: 0x56de0, weapons: 0x57372, ammo: 0x573f7, unknown: { entry: 0x57091, join: 0x5781d }, ammoGrants: [{ entry: 0x57127, join: 0x5712e, descriptor: "rdi", kind: "set" }, { entry: 0x57133, join: 0x5713d, descriptor: "rdi", kind: "add" }], argc: 0x1da780, argv: 0x1da788 },
  drop: { entry: 0xd5ec0, eligibility: { entry: 0xd5eed, join: 0xd5f30 } },
  client: { pointer: 0x78, weapon: 0xbe8, ammoIndex: null, inventory: 0xa80 },
  items: { weaponFlag: 1, ammunitionFlag: 2, table: 0x195320, stride: 192, count: 84, classname: 8, flags: 0x7c, icon: 0x50, ammo: { kind: "index", offset: 0x74 } },
};
export function nativePrimaryCommandProfile(digest: ContentDigest): NativePrimaryCommandProfile | null {
  return digest === xatrix.digest ? xatrix : digest === retail.digest ? retail : null;
}
