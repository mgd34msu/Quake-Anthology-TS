// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusFile, corpusTest } from "../../support/corpus.ts";
import { parsePe } from "../../../src/guest/pe/index.ts";
import { q2SoldierVariants } from "../../../src/content/q2/foundation/monsters/index.ts";
import { q2OriginalMissionPackFallbacks } from "../../../src/content/q2/missionpacks/monsters/index.ts";

// The rerelease DLL has no soldierh model or tables: SP_monster_soldier_ripper/hypergun/lasergun call the common soldier setup, then
// store skinnum (edict +0x3c), count (+0x7b8), gib_health (+0x780) and health (+0x778, from a float constant times the health scale).
const path = "q2/rerelease/baseq2/game_x64.dll";
const spawns: readonly { readonly classname: string; readonly rva: number; readonly healthConstant: number }[] = [
  { classname: "monster_soldier_ripper", rva: 0xd0820, healthConstant: 0x178904 },
  { classname: "monster_soldier_hypergun", rva: 0xd0930, healthConstant: 0x178920 },
  { classname: "monster_soldier_lasergun", rva: 0xd0a50, healthConstant: 0x178950 },
];

function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function find(haystack: Uint8Array, needle: readonly number[], from: number, to: number): boolean {
  for (let i = from; i + needle.length <= to; i++) if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  return false;
}

corpusTest(path)("rerelease Xatrix soldiers are soldier-family variants with the DLL's skin, count and health", () => {
  const bytes = new Uint8Array(readFileSync(corpusFile(path))),
    pe = parsePe(bytes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = (rva: number): number => {
    const section = pe.sections.find(value => rva >= value.rva && rva < value.rva + value.rawSize);
    if (section === undefined) throw new Error(`RVA ${rva.toString(16)} is outside every raw section`);
    return section.rawOffset + rva - section.rva;
  };
  for (const entry of spawns) {
    const variant = q2SoldierVariants[entry.classname];
    if (variant === undefined) throw new Error(`${entry.classname} is not a soldier-family variant`);
    const start = offset(entry.rva),
      end = start + 0x140;
    expect([entry.classname, find(bytes, [0xc7, 0x43, 0x3c, ...le32(variant.skin)], start, end)]).toEqual([entry.classname, true]);
    expect([entry.classname, find(bytes, [0xc7, 0x83, 0xb8, 0x07, 0x00, 0x00, ...le32(variant.count)], start, end)]).toEqual([entry.classname, true]);
    expect([entry.classname, find(bytes, [0xc7, 0x83, 0x80, 0x07, 0x00, 0x00, ...le32(-30)], start, end)]).toEqual([entry.classname, true]);
    expect([entry.classname, view.getFloat32(offset(entry.healthConstant), true)]).toEqual([entry.classname, variant.health]);
    expect(variant.expansion).toBe("rerelease");
    expect(q2OriginalMissionPackFallbacks.has(entry.classname)).toBe(false);
  }
  // The weapon class follows count/2: blaster, shotgun-class hyper, machinegun-class laser, as in the base soldiers (count 0, 2, 4).
  expect(spawns.map(entry => q2SoldierVariants[entry.classname]?.weapon)).toEqual(["blaster", "shotgun", "machinegun"]);
});
