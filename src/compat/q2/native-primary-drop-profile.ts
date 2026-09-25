import type { ContentDigest } from "../../contracts/content.ts";
import type { NativePrimaryDropProfile } from "./native-primary-drop.ts";
const classic: NativePrimaryDropProfile = {
  digest: "sha256:8187df3fd5b4d435d8227434d3351aad2b47e546236403e52adcd4d275810c45",
  abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" },
  client: { pointer: 0x54, inventory: 0x2e4, cursor: 0x2e0, weapon: 0x704, pending: 0xddc },
  named: 0x3860, inventory: { entry: 0x3c80, admitted: 0x3c8b }, find: 0x9590, lookupReturn: 0x3872, allocate: 0xad00, free: 0x19140,
  consumer: null, debits: [{ entry: 0x36b57, join: 0x36b59 }, { entry: 0xa5ab, join: 0xa5ae }],
};
const retail: NativePrimaryDropProfile = {
  digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd",
  abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" },
  client: { pointer: 0x78, inventory: 0xa80, cursor: 0xa70, weapon: 0xbe8, pending: 0x1898 },
  named: 0x58410, inventory: { entry: 0x58970, admitted: 0x58998 }, find: 0x660a0, lookupReturn: 0x58541, allocate: 0x680c0, free: 0x96600,
  consumer: { entry: 0x674a6, join: 0x674ab }, debits: [{ entry: 0xf0964, join: 0xf096b }, { entry: 0x6749f, join: 0x674a3 }],
};
export function nativePrimaryDropProfile(digest: ContentDigest): NativePrimaryDropProfile | null {
  return digest === classic.digest ? classic : digest === retail.digest ? retail : null;
}
