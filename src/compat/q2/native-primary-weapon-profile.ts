import type { ContentDigest } from "../../contracts/content.ts";
import type { NativePrimaryWeaponProfile } from "./native-primary-weapons.ts";
import type { NativeItemField } from "../../contracts/native-mod-items.ts";
import { xatrixCombatProfile } from "./classic/combat-profile.ts";

const classicButtons: NativeItemField = { record: "client", offset: 0xdcc, encoding: "int32" };
const classicLatched: NativeItemField = { record: "client", offset: 0xdd4, encoding: "int32" };
const retailButtons: NativeItemField = { record: "client", offset: 0x1860, encoding: "uint8" };
const retailLatched: NativeItemField = { record: "client", offset: 0x1862, encoding: "uint8" };
const xatrix: NativePrimaryWeaponProfile = {
  equipmentContexts: [{ provider: "q2:equipment/hand-grenades", item: "q2:ammo_grenades" }],
  digest: xatrixCombatProfile.digest,
  abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" },
  dispatcher: { entry: { kind: "rva", rva: 0x36710 }, record: "entity", argument: 0, arguments: 1 },
  decisions: [
    ...[[0x36c96, 0x36ca6], [0x370bd, 0x370ce], [0x3927d, 0x3928e]].map(([entry, join]) => {
      if (entry === undefined || join === undefined) throw new Error("Incomplete original decision range");
      return { entry, join, fields: [classicButtons, classicLatched].map(field => ({ field, clearMask: 1 })) };
    }),
    ...[[0x378f2, 0x378f9], [0x37b28, 0x37b2f], [0x37f6d, 0x37f74], [0x37f97, 0x37f9e]].map(([entry, join]) => {
      if (entry === undefined || join === undefined) throw new Error("Incomplete original decision range");
      return { entry, join, fields: [{ field: classicButtons, clearMask: 1 }] };
    }),
  ],
  committedInput: [],
  spawn: { entry: 0x319d0, accepted: [] },
  active: [
    { kind: "scalar", field: { record: "image", offset: 0x768c8, encoding: "float32" }, mask: null, comparison: "equals", value: 0 },
    { kind: "scalar", field: { record: "client", offset: 0xd98, encoding: "int32" }, mask: null, comparison: "equals", value: 0 },
    { kind: "scalar", field: { record: "entity", offset: 0x1ec, encoding: "int32" }, mask: null, comparison: "equals", value: 0 },
  ],
  continuations: [[{ kind: "scalar", field: { record: "client", offset: 0xe00, encoding: "int32" }, mask: null, comparison: "equals", value: 3 }]],
  time: { address: 0x76804, encoding: "float32", milliseconds: 1000 },
  entity: { client: 84, waterLevel: { record: "entity", offset: 0x264, encoding: "int32" },
    viewHeight: { record: "entity", offset: 0x1fc, encoding: "int32" }, maxHealth: { record: "entity", offset: 0x1e4, encoding: "int32" } },
  client: { byteLength: 3832, viewAngles: 0xe44, buttons: classicButtons, latchedButtons: classicLatched },
  attackAnimation: { entry: 0x36b60, skip: [{ entry: 0x36b6b, join: 0x36be5 }, { entry: 0x36bea, join: 0x36de6 }, { entry: 0x36d31, join: 0x36dcc }] },
  animation: { frame: { record: "entity", offset: 56, encoding: "int32" }, end: { record: "client", offset: 0xe7c, encoding: "int32" },
    priority: { record: "client", offset: 0xe80, encoding: "int32" }, duck: { record: "client", offset: 0xe84, encoding: "int32" }, run: { record: "client", offset: 0xe88, encoding: "int32" } },
  delay: { flag: { record: "image", offset: 0x6b694, encoding: "int32" }, region: { entry: 0x3676f, join: 0x36793 }, evaluate: { kind: "source-flag", factors: [1, 0.5] } },
  damage: { kind: "source-flag", address: 0x6b690, encoding: "int32", factors: [1, 4], region: { entry: 0x36748, join: 0x3676f } },
};
const retail: NativePrimaryWeaponProfile = {
  equipmentContexts: [{ provider: "q2:equipment/hand-grenades", item: "q2:ammo_grenades" }],
  digest: "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd", abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" },
  dispatcher: { entry: { kind: "rva", rva: 0xf05d0 }, record: "entity", argument: 0, arguments: 1 },
  decisions: [
    { entry: 0xf0f3d, join: 0xf0f4d, fields: [retailButtons, retailLatched].map(field => ({ field, clearMask: 1 })) },
    { entry: 0xf1a4b, join: 0xf1a5a, fields: [retailButtons, retailLatched].map(field => ({ field, clearMask: 1 })) },
    ...[[0xf28d1, 0xf28d8], [0xf2967, 0xf296e], [0xf2b7e, 0xf2b85], [0xf3076, 0xf307d], [0xf30be, 0xf30c5],
      [0x118fe0, 0x118fe7], [0x11913f, 0x119146], [0x119873, 0x11987a], [0x119cd9, 0x119ce0]].map(([entry, join]) => {
      if (entry === undefined || join === undefined) throw new Error("Incomplete original decision range");
      return { entry, join, fields: [{ field: retailButtons, clearMask: 1 }] };
    }),
  ],
  committedInput: [[{ kind: "scalar", field: { record: "client", offset: 0x1890, encoding: "uint8" }, mask: null, comparison: "equals", value: 1 }]],
  spawn: { entry: 0xda4b0, accepted: [{ kind: "scalar", field: { record: "client", offset: 0x1c54, encoding: "uint8" }, mask: null, comparison: "equals", value: 0 }] },
  active: [
    { kind: "scalar", field: { record: "image", offset: 0x241c30, encoding: "int64" }, mask: null, comparison: "equals", value: 0 },
    { kind: "scalar", field: { record: "client", offset: 0x17d8, encoding: "uint8" }, mask: null, comparison: "equals", value: 0 },
    { kind: "scalar", field: { record: "client", offset: 0x1c54, encoding: "uint8" }, mask: null, comparison: "equals", value: 0 },
    { kind: "scalar", field: { record: "entity", offset: 0x7a4, encoding: "uint8" }, mask: null, comparison: "equals", value: 0 },
  ],
  continuations: [[{ kind: "scalar", field: { record: "client", offset: 0x1924, encoding: "int32" }, mask: null, comparison: "equals", value: 3 }],
    [{ kind: "scalar", field: { record: "client", offset: 0x1890, encoding: "uint8" }, mask: null, comparison: "equals", value: 1 }]],
  time: { address: 0x241b28, encoding: "int64", milliseconds: 1 },
  entity: { client: 0x78, waterLevel: { record: "entity", offset: 0x83c, encoding: "uint8" },
    viewHeight: { record: "entity", offset: 0x7a0, encoding: "int32" }, maxHealth: { record: "entity", offset: 0x77c, encoding: "int32" } },
  client: { byteLength: 7344, viewAngles: 0x1998, buttons: retailButtons, latchedButtons: retailLatched },
  attackAnimation: { entry: 0xf1180, skip: [{ entry: 0xf11c3, join: 0xf12d8 }] },
  animation: { frame: { record: "entity", offset: 56, encoding: "int32" }, end: { record: "client", offset: 0x19f4, encoding: "int32" },
    priority: { record: "client", offset: 0x19f8, encoding: "int32" }, duck: { record: "client", offset: 0x19fc, encoding: "uint8" }, run: { record: "client", offset: 0x19fd, encoding: "uint8" } },
  delay: { flag: { record: "image", offset: 0x1d634d, encoding: "uint8" }, region: { entry: 0xeff75, join: 0xeff8a }, evaluate: {
    kind: "source-animation", entry: 0xf04f0, baselineMilliseconds: 100,
    projection: [{ field: { record: "client", offset: 0x1924, encoding: "int32" }, value: 3 }, { field: { record: "client", offset: 0x78, encoding: "int32" }, value: 1 }],
    writes: [{ record: "client", offset: 0x7c, encoding: "int32" }],
  } },
  damage: { kind: "source-result", entry: 0xef5f0, result: "uint8" },
};
export function nativePrimaryWeaponProfile(digest: ContentDigest): NativePrimaryWeaponProfile | null {
  return digest === xatrix.digest ? xatrix : digest === retail.digest ? retail : null;
}
