// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusFile, corpusTest } from "../../support/corpus.ts";
import { parsePe, type PeFile } from "../../../src/guest/pe/index.ts";
import { xatrix1998CombatProfile } from "../../../src/compat/q2/classic/combat-profile.ts";
import { nativePrimaryWeaponProfile } from "../../../src/compat/q2/native-primary-weapon-profile.ts";

// Offsets below were found by disassembling the 1998 Xatrix DLL (objdump -d -M intel) and matching the instruction shapes of the
// verified 8187df profile; the tests re-read the shipped bytes so a wrong RVA, offset or branch join fails here.
const path = "q2/xatrix/gamex86.dll";

function image(): { readonly bytes: Uint8Array; readonly pe: PeFile } {
  const bytes = new Uint8Array(readFileSync(corpusFile(path)));
  return { bytes, pe: parsePe(bytes) };
}
function slice(file: { readonly bytes: Uint8Array; readonly pe: PeFile }, rva: number, length: number): number[] {
  const section = file.pe.sections.find(value => rva >= value.rva && rva + length <= value.rva + value.rawSize);
  if (section === undefined) throw new Error(`RVA ${rva.toString(16)} is outside every raw section`);
  const start = section.rawOffset + rva - section.rva;
  return [...file.bytes.subarray(start, start + length)];
}
function le32(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }
function contains(haystack: readonly number[], needle: readonly number[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  return false;
}

corpusTest(path)("1998 Xatrix native primary weapon profile matches the shipped PE", () => {
  const file = image();
  expect(new Bun.CryptoHasher("sha256").update(file.bytes).digest("hex")).toBe(xatrix1998CombatProfile.digest.slice("sha256:".length));
  const profile = nativePrimaryWeaponProfile(xatrix1998CombatProfile.digest);
  if (profile === null) throw new Error("1998 Xatrix has no native primary weapon profile");
  expect(profile.abi.pointerBytes).toBe(4);
  const base = 0x20000000;
  const buttons = profile.client.buttons.offset, latched = profile.client.latchedButtons.offset;

  // All seven decision ranges read the button word; the first three also read the latched word; each closes on the original conditional jump.
  expect(profile.decisions.length).toBe(7);
  profile.decisions.forEach((range, index) => {
    const body = slice(file, range.entry, range.join - range.entry + 1);
    expect(contains(body, le32(buttons)) || contains(body, [buttons & 0xff])).toBe(true);
    expect(contains(body, le32(latched))).toBe(index < 3);
    expect([0x74, 0x75, 0x0f].includes(body[body.length - 1] ?? -1)).toBe(true);
    expect(range.fields.map(value => value.field.offset)).toEqual(index < 3 ? [buttons, latched] : [buttons]);
  });

  // Think_Weapon: push esi / mov esi,[esp+8], then fild level.framenum opens the damage region and the delay region follows it.
  const dispatcher = profile.dispatcher.entry;
  if (dispatcher.kind !== "rva") throw new Error("dispatcher is addressed by RVA");
  expect(slice(file, dispatcher.rva, 5)).toEqual([0x56, 0x8b, 0x74, 0x24, 0x08]);
  expect(slice(file, 0x352f8, 6)).toEqual([0xdb, 0x05, ...le32(base + 0x73fe0)]);
  const damage = profile.damage;
  if (damage.kind !== "source-flag") throw new Error("expected a source-flag damage rule");
  expect(damage.region.entry).toBe(0x352f8);
  expect(contains(slice(file, damage.region.entry, damage.region.join - damage.region.entry), le32(base + damage.address))).toBe(true);
  expect(contains(slice(file, profile.delay.region.entry, profile.delay.region.join - profile.delay.region.entry), le32(base + profile.delay.flag.offset))).toBe(true);
  expect(damage.region.join).toBe(profile.delay.region.entry);
  expect(profile.delay.flag.offset).toBe(damage.address + 4);

  // Weapon_Generic: state dispatch reads weaponstate, and every skip region starts and ends at a real instruction of that function.
  const generic = profile.attackAnimation;
  expect(slice(file, generic.entry, 8)).toEqual([0x53, 0x55, 0x56, 0x8b, 0x74, 0x24, 0x10, 0x57]);
  const state = profile.continuations[0]?.[0];
  if (state?.kind !== "scalar") throw new Error("expected a weapon-state continuation");
  expect(contains(slice(file, generic.entry, 0x40), [0x8b, 0x88, ...le32(state.field.offset)])).toBe(true);
  expect(generic.skip.map(region => [region.entry, region.join])).toEqual([[0x3571b, 0x35795], [0x3579a, 0x35996], [0x358e1, 0x3597c]]);
  expect(slice(file, 0x35795, 5)).toEqual([0xba, 0x01, 0x00, 0x00, 0x00]);
  expect(slice(file, 0x35996, 3)).toEqual([0x8b, 0x4e, 0x54]);
  expect(slice(file, 0x3597c, 2)).toEqual([0x5f, 0x5e]);
  // The attack animation (ANIM_ATTACK = 6) goes to anim_priority and anim_end through the declared client offsets.
  const generic0 = slice(file, generic.entry, 0x140);
  expect(contains(generic0, [0xc7, 0x80, ...le32(profile.animation.priority.offset), 0x06, 0x00, 0x00, 0x00])).toBe(true);
  expect(contains(generic0, [0xc7, 0x40, 0x38, 0xad, 0x00, 0x00, 0x00])).toBe(false);
  expect(contains(generic0, [0xc7, 0x80, ...le32(profile.animation.end.offset), 0xa9, 0x00, 0x00, 0x00])).toBe(true);
  expect([profile.animation.end.offset, profile.animation.priority.offset, profile.animation.duck.offset, profile.animation.run.offset])
    .toEqual([0, 4, 8, 12].map(delta => profile.client.viewAngles + 56 + delta));

  // v_angle is written by ClientThink in the same record as the invincible frame the combat profile derived.
  expect(profile.client.viewAngles).toBe(xatrix1998CombatProfile.client.viewAngles);
  expect(xatrix1998CombatProfile.client.invincibleFrame - profile.client.viewAngles).toBe(76);
  expect(contains(slice(file, 0x31990, 0x80), [0x89, 0x8b, ...le32(profile.client.viewAngles)])).toBe(true);
  expect(buttons).toBe(profile.client.viewAngles - 0x78);

  // PutClientInServer takes the edict and reserves the persistent/respawn save area; level time, intermission and sizeof(gclient_t) exist as operands.
  expect(slice(file, profile.spawn.entry, 6)).toEqual([0x81, 0xec, ...le32(0xef4)]);
  const text = slice(file, 0x1000, file.pe.sections[0]?.virtualSize ?? 0);
  expect(contains(text, [0xd9, 0x05, ...le32(base + profile.time.address)])).toBe(true);
  const intermission = profile.active[0];
  if (intermission?.kind !== "scalar") throw new Error("expected the intermission test first");
  expect(contains(text, [0xd9, 0x05, ...le32(base + intermission.field.offset)])).toBe(true);
  expect(contains(text, [0x68, ...le32(profile.client.byteLength)])).toBe(true);
  expect(profile.entity.client).toBe(0x54);
});
