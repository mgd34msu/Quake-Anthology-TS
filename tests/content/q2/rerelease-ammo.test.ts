// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusFile, corpusTest } from "../../support/corpus.ts";
import { parsePe, type PeFile } from "../../../src/guest/pe/index.ts";
import { q2MissionAmmoPackCapacity, q2MissionWeaponInventory } from "../../../src/content/q2/missionpacks/items.ts";
import { q2RereleaseAmmoLimits } from "../../../src/content/q2/foundation/rerelease-ammo.ts";

// The rerelease DLL is stripped. Its ammo gitem rows are found through their classname pointers (tag at +0x88), InitClientPersistant
// is the function that stores the defaults into client.pers.max_ammo (client offset 0xbd0, int16[12]) and Pickup_Bandolier and
// Pickup_Pack are the two functions that clamp it upward with cmovl.
const path = "q2/rerelease/baseq2/game_x64.dll";
const maxAmmoOffset = 0xbd0,
  initRva = 0xd7760,
  initEnd = 0xd77dc,
  bandolierRva = 0x667b0,
  packRva = 0x66960,
  pickupSpan = 0x1b0;

interface Image {
  readonly bytes: Uint8Array;
  readonly pe: PeFile;
}
function rvaToOffset(image: Image, rva: number): number {
  const section = image.pe.sections.find(value => rva >= value.rva && rva < value.rva + value.rawSize);
  if (section === undefined) throw new Error(`RVA ${rva.toString(16)} is outside every raw section`);
  return section.rawOffset + rva - section.rva;
}
function readView(image: Image): DataView {
  return new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength);
}

function gitemTag(image: Image, classname: string): number {
  const needle = Buffer.from(`\0${classname}\0`, "latin1"),
    at = Buffer.from(image.bytes).indexOf(needle) + 1;
  expect(at).toBeGreaterThan(0);
  const section = image.pe.sections.find(value => at >= value.rawOffset && at < value.rawOffset + value.rawSize);
  if (section === undefined) throw new Error("classname outside sections");
  const address = image.pe.preferredBase + BigInt(section.rva + at - section.rawOffset),
    view = readView(image);
  for (const data of image.pe.sections.filter(value => value.name === ".data")) {
    for (let offset = data.rawOffset; offset + 8 <= data.rawOffset + data.rawSize; offset += 8) {
      if (view.getBigUint64(offset, true) === address) return view.getInt32(offset + 0x88, true);
    }
  }
  throw new Error(`No gitem row points at ${classname}`);
}

/** Decodes the stores of InitClientPersistant: `mov dword [rbx+d],imm32` fills two int16 slots, `mov [rbx+d],ax|cx` stores the loaded constant. */
function defaults(image: Image): number[] {
  const bytes = image.bytes,
    start = rvaToOffset(image, initRva),
    result = new Array<number>(12).fill(-1);
  const view = readView(image);
  let ax = 0,
    cx = 0;
  for (let i = start; i < start + (initEnd - initRva); i++) {
    const b = bytes[i];
    if (b === 0xb8) ax = view.getInt32(i + 1, true);
    else if (b === 0xb9) cx = view.getInt32(i + 1, true);
    else if (b === 0xc7 && bytes[i + 1] === 0x83) {
      const slot = (view.getInt32(i + 2, true) - maxAmmoOffset) / 2;
      if (slot >= 0 && slot < 11) {
        result[slot] = view.getInt16(i + 6, true);
        result[slot + 1] = view.getInt16(i + 8, true);
      }
    } else if (b === 0x66 && bytes[i + 1] === 0x89 && (bytes[i + 2] === 0x83 || bytes[i + 2] === 0x8b)) {
      const slot = (view.getInt32(i + 3, true) - maxAmmoOffset) / 2;
      if (slot >= 0 && slot < 12) result[slot] = bytes[i + 2] === 0x83 ? ax : cx;
    }
  }
  return result;
}

/** Decodes a clamp function: each `movzx eax,[base+d]; cmp ax,reg; cmovl; mov [base+d],ax` raises slot d to the constant last loaded into reg. */
function ceilings(image: Image, rva: number): Map<number, number> {
  const bytes = image.bytes,
    view = readView(image),
    start = rvaToOffset(image, rva),
    found = new Map<number, number>();
  let r9 = 0,
    cx = 0,
    dx = 0,
    slot = -1;
  for (let i = start; i < start + pickupSpan; i++) {
    const b = bytes[i];
    if (b === 0x41 && bytes[i + 1] === 0xb9) r9 = view.getInt32(i + 2, true);
    else if (b === 0xb9 && bytes[i + 1] !== 0x00 && bytes[i + 2] === 0) cx = view.getInt32(i + 1, true);
    else if (b === 0xba && bytes[i + 2] === 0) dx = view.getInt32(i + 1, true);
    else if (b === 0x0f && bytes[i + 1] === 0xb7 && (bytes[i + 2] ?? 0) >= 0x80 && (bytes[i + 2] ?? 0) < 0x88)
      slot = (view.getInt32(i + 3, true) - maxAmmoOffset) / 2;
    else if (b === 0x66 && bytes[i + 1] === 0x41 && bytes[i + 2] === 0x3b && bytes[i + 3] === 0xc1 && slot >= 0) found.set(slot, r9);
    else if (b === 0x66 && bytes[i + 1] === 0x3b && bytes[i + 2] === 0xc1 && slot >= 0) found.set(slot, cx);
    else if (b === 0x66 && bytes[i + 1] === 0x3b && bytes[i + 2] === 0xc2 && slot >= 0) found.set(slot, dx);
  }
  return found;
}

corpusTest(path)("rerelease ammo capacities equal what game_x64.dll stores and clamps", () => {
  const bytes = new Uint8Array(readFileSync(corpusFile(path))),
    image: Image = { bytes, pe: parsePe(bytes) };
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe("045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const bySlot = Object.entries(q2RereleaseAmmoLimits);
  expect(new Set(bySlot.map(([, value]) => value.tag)).size).toBe(12);
  for (const [classname, limits] of bySlot) expect([classname, gitemTag(image, classname)]).toEqual([classname, limits.tag]);

  const initial = defaults(image);
  expect(initial.every(value => value > 0)).toBe(true);
  for (const [classname, limits] of bySlot) expect([classname, initial[limits.tag]]).toEqual([classname, limits.capacity]);

  const raises: readonly (readonly [number, "bandolier" | "pack"])[] = [
    [bandolierRva, "bandolier"],
    [packRva, "pack"],
  ];
  for (const [rva, pick] of raises) {
    const raised = ceilings(image, rva);
    for (const [classname, limits] of bySlot) expect([classname, raised.get(limits.tag) ?? null]).toEqual([classname, limits[pick]]);
  }
});

test("rerelease mission pack ammo uses the rerelease capacities and classic keeps the original ones", () => {
  const capacities = (pack: "xatrix" | "rogue", edition: "classic" | "rerelease"): Record<string, number> =>
    Object.fromEntries(q2MissionWeaponInventory(pack, edition).map(entry => [entry.item, entry.capacity]));
  expect(capacities("rogue", "classic")["q2:ammo_tesla"]).toBe(50);
  expect(capacities("rogue", "classic")["q2:ammo_disruptor"]).toBe(100);
  expect(capacities("rogue", "rerelease")["q2:ammo_tesla"]).toBe(5);
  expect(capacities("rogue", "rerelease")["q2:ammo_disruptor"]).toBe(12);
  expect(capacities("rogue", "rerelease")["q2:ammo_flechettes"]).toBe(200);
  expect(capacities("rogue", "rerelease")["q2:ammo_prox"]).toBe(50);
  expect(capacities("xatrix", "rerelease")["q2:ammo_trap"]).toBe(5);
  expect(capacities("xatrix", "rerelease")["q2:ammo_magslug"]).toBe(50);
  expect(q2MissionAmmoPackCapacity("ammo_disruptor", false, "rerelease", 150)).toBe(21);
  expect(q2MissionAmmoPackCapacity("ammo_disruptor", true, "rerelease", 200)).toBe(30);
  expect(q2MissionAmmoPackCapacity("ammo_flechettes", true, "rerelease", 200)).toBe(300);
  expect(q2MissionAmmoPackCapacity("ammo_disruptor", false, "classic", 150)).toBe(150);
});
