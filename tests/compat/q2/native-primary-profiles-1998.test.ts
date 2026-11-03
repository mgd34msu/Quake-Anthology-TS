// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusFile, corpusTest } from "../../support/corpus.ts";
import { parsePe, type PeFile } from "../../../src/guest/pe/index.ts";
import { xatrix1998CombatProfile } from "../../../src/compat/q2/classic/combat-profile.ts";
import { builtinNativePrimary } from "../../../src/compat/q2/native-primary.ts";
import { validateNativePrimary } from "../../../src/compat/q2/native-primary-validation.ts";
import { nativePrimaryPlayerProfile } from "../../../src/compat/q2/native-primary-player-profile.ts";
import { nativePrimaryCommandProfile } from "../../../src/compat/q2/native-primary-command-profile.ts";
import { nativePrimaryInventoryProfile } from "../../../src/compat/q2/native-primary-inventory-profile.ts";
import { nativePrimaryDropProfile } from "../../../src/compat/q2/native-primary-drop-profile.ts";
import { classicPickupProfile } from "../../../src/compat/q2/classic/pickup-profile.ts";

// Every RVA below was found by disassembling the 1998 Xatrix DLL (objdump -d -M intel) and matching the instruction shape of the
// verified 8187df profiles. The tests re-read the shipped bytes, so a wrong address, offset or join fails here.
const path = "q2/xatrix/gamex86.dll";
const base = 0x20000000;

interface Image {
  readonly bytes: Uint8Array;
  readonly pe: PeFile;
}
function image(): Image {
  const bytes = new Uint8Array(readFileSync(corpusFile(path)));
  return { bytes, pe: parsePe(bytes) };
}
function slice(file: Image, rva: number, length: number): number[] {
  const section = file.pe.sections.find(value => rva >= value.rva && rva + length <= value.rva + value.rawSize);
  if (section === undefined) throw new Error(`RVA ${rva.toString(16)} is outside every raw section`);
  const start = section.rawOffset + rva - section.rva;
  return [...file.bytes.subarray(start, start + length)];
}
function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u32(file: Image, rva: number): number {
  const [a = 0, b = 0, c = 0, d = 0] = slice(file, rva, 4);
  return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
}
function contains(haystack: readonly number[], needle: readonly number[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  return false;
}
/** Target RVA of the `call rel32` at an RVA, or null when the byte there is not E8. */
function callTarget(file: Image, rva: number): number | null {
  const [opcode = 0] = slice(file, rva, 1);
  return opcode === 0xe8 ? rva + 5 + (u32(file, rva + 1) | 0) : null;
}
function required<T>(value: T | null): T {
  if (value === null) throw new Error("1998 Xatrix has no native primary profile");
  return value;
}
const digest = xatrix1998CombatProfile.digest;
const epilogue = [0x5f, 0x5e, 0x5d, 0x5b, 0xc3];

corpusTest(path)("1998 Xatrix has a complete native primary that validates against the shipped PE", () => {
  const file = image();
  expect(new Bun.CryptoHasher("sha256").update(file.bytes).digest("hex")).toBe(digest.slice("sha256:".length));
  const profile = required(builtinNativePrimary(digest, "classic"));
  expect(profile.edition).toBe("classic");
  validateNativePrimary(profile, file.pe);
  expect(builtinNativePrimary(digest, "rerelease")).toBeNull();
});

corpusTest(path)("1998 Xatrix item table, client records and entity fields match the shipped PE", () => {
  const file = image();
  const commands = required(nativePrimaryCommandProfile(digest)),
    pickups = required(classicPickupProfile(digest));
  const items = commands.items;
  expect(items.stride).toBe(72);
  const text = (rva: number): string => {
    const bytes: number[] = [];
    for (let at = rva; ; at++) {
      const [byte = 0] = slice(file, at, 1);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  };
  const field = (index: number, offset: number): number => u32(file, items.table + index * items.stride + offset);
  const name = (index: number, offset: number): string | null => {
    const pointer = field(index, offset);
    return pointer === 0 ? null : text(pointer - base);
  };
  const classnames = Array.from({ length: items.count }, (_, index) => name(index, items.classname));
  expect(classnames[0]).toBeNull();
  expect(classnames[1]).toBe("item_armor_body");
  expect(classnames[46]).toBe("key_airstrike_target");
  expect(classnames[47]).toBeNull();
  expect(name(47, items.ammo.kind === "name" ? items.ammo.label : 0)).toBe("Health");
  expect(field(items.count, 0)).toBe(0);
  expect(classnames.flatMap((value, index) => (value !== null && (field(index, items.flags) & items.weaponFlag) !== 0 ? [value] : []))).toEqual([
    "weapon_blaster",
    "weapon_shotgun",
    "weapon_supershotgun",
    "weapon_machinegun",
    "weapon_chaingun",
    "ammo_grenades",
    "ammo_trap",
    "weapon_grenadelauncher",
    "weapon_rocketlauncher",
    "weapon_hyperblaster",
    "weapon_boomer",
    "weapon_railgun",
    "weapon_phalanx",
    "weapon_bfg",
  ]);
  expect(name(8, items.ammo.kind === "name" ? items.ammo.offset : 0)).toBe("Shells");
  expect(name(8, items.icon)).toBe("w_shotgun");
  // Ammo tags select the pers.max_* slot and sit eight bytes before the end of each record.
  expect([21, 22, 23, 24, 25, 26].map(index => field(index, pickups.supply.ammo.tag))).toEqual([1, 0, 4, 2, 5, 6]);
  expect(pickups.supply.ammo.tag).toBe(items.stride - 8);
  expect(pickups.supply.ammo.capacities).toEqual([0x6e4, 0x6e8, 0x6ec, 0x6f0, 0x6f4, 0x6f8, 0x6fc, 0x700]);
  // The pickup pointers stored in the table are the declared grant entries.
  const pickup = (index: number): number => field(index, pickups.items.pickup) - base;
  expect([1, 21, 8, 35, 36].map(pickup)).toEqual(pickups.grants.map(grant => grant.entry));

  const player = required(nativePrimaryPlayerProfile(digest));
  // resp.score is incremented by ClientObituary; resp.cmd_angles follows it and is written by ClientThink as three floats.
  const score = player.match?.score ?? 0;
  expect(contains(slice(file, 0x4500, 0x60), [0xff, 0x80, ...le32(score)])).toBe(true);
  expect(player.commandAngles).toBe(score + 4);
  expect(contains(slice(file, 0x318c0, 0x60), [0xd9, 0x9b, ...le32(player.commandAngles)])).toBe(true);
  expect(player.velocity).toBe(xatrix1998CombatProfile.fields.velocity);
  // SelectSpawnPoint(ent, origin, angles) tests the deathmatch cvar first and falls back to info_player_start.
  expect(slice(file, player.spawn, 8)).toEqual([0xa1, ...le32(0x20073e14), 0x56, 0x33, 0xf6]);
  expect(contains(slice(file, player.spawn, 0x100), [0x68, ...le32(0x2004dc6c)])).toBe(true);
});

corpusTest(path)("1998 Xatrix command, inventory and drop entries sit on the original g_cmds and p_weapon bodies", () => {
  const file = image();
  const commands = required(nativePrimaryCommandProfile(digest)),
    inventory = required(nativePrimaryInventoryProfile(digest)),
    drop = required(nativePrimaryDropProfile(digest));
  const give = commands.give;
  // Cmd_Give_f: the weapon and ammo categories each begin with `test ebp,ebp` after their item loops; the grants write inventory[index].
  expect(slice(file, give.weapons, 2)).toEqual([0x85, 0xed]);
  expect(slice(file, give.ammo, 2)).toEqual([0x85, 0xed]);
  expect(slice(file, give.unknown.entry, 1)).toEqual([0x68]);
  expect(slice(file, give.unknown.join, 5)).toEqual([...epilogue.slice(0, 4), 0x59]);
  const [set, add] = give.ammoGrants;
  if (set === undefined || add === undefined) throw new Error("Expected set and add ammo grants");
  expect(slice(file, set.entry, 7)).toEqual([0x89, 0x84, 0xb9, ...le32(commands.client.inventory)]);
  expect(set.join).toBe(set.entry + 7);
  expect(slice(file, add.entry, 3)).toEqual([0x8b, 0x53, 0x54]);
  expect(slice(file, add.join, 5)).toEqual([...epilogue.slice(0, 4), 0x59]);
  const body = slice(file, give.entry, 0x400);
  expect(contains(body, [0xff, 0x15, ...le32(base + give.argc)])).toBe(true);
  expect(contains(body, [0xff, 0x15, ...le32(base + give.argv)])).toBe(true);
  expect(contains(body, [0x81, 0xe9, ...le32(base + commands.items.table)]) || contains(body, [0x81, 0xea, ...le32(base + commands.items.table)])).toBe(true);
  // TossClientWeapon: the eligibility region reads client.ammo_index and reconverges where the quad drop test begins.
  const eligibility = commands.drop.eligibility;
  expect(eligibility.entry - commands.drop.entry).toBe(0x27);
  expect(eligibility.join - commands.drop.entry).toBe(0x7b);
  expect(slice(file, eligibility.entry, 6)).toEqual([0x8b, 0x8b, ...le32(commands.client.ammoIndex ?? 0)]);
  expect(slice(file, eligibility.join, 1)).toEqual([0xa1]);

  // SelectNextItem and SelectPrevItem: scan regions are the item loops; the cursor store is skipped and the final epilogue is the join.
  for (const [entry, scan, join, head, edi] of [
    [inventory.next.entry, inventory.next.scan, inventory.next.join, [0x8b, 0xc6, 0x99], 0x87],
    [inventory.previous.entry, inventory.previous.scan, inventory.previous.join, [0x8b, 0xc1, 0x99], 0x86],
  ] as const) {
    const span = slice(file, entry, join - entry);
    expect(slice(file, scan, 3)).toEqual([...head]);
    expect(slice(file, join, 6)).toEqual([...epilogue, 0x90]);
    expect(contains(span, [0xc7, edi, ...le32(inventory.cursor), 0xff, 0xff, 0xff, 0xff])).toBe(true);
    expect(contains(span, [0x89, edi, ...le32(inventory.cursor)])).toBe(true);
    expect(scan).toBeGreaterThan(entry);
    expect(join).toBeGreaterThan(scan);
  }
  // ValidateSelectedItem reloads the cursor and calls SelectNextItem(ent, -1).
  expect(callTarget(file, inventory.validate.entry + 0x1c)).toBe(inventory.next.entry);
  // Cmd_Use_f and Cmd_Drop_f call FindItem on gi.args() and then the item's use (+8) or drop (+0xc) pointer.
  expect(callTarget(file, inventory.namedUse.lookupCall)).toBe(drop.find);
  expect(inventory.namedUse.lookupReturn).toBe(inventory.namedUse.lookupCall + 5);
  expect(slice(file, inventory.namedUse.call, 3)).toEqual([0xff, 0x51, 0x08]);
  expect(inventory.namedUse.join).toBe(inventory.namedUse.call + 3);
  expect(callTarget(file, drop.named + (inventory.namedUse.lookupCall - inventory.namedUse.entry))).toBe(drop.find);
  expect(drop.lookupReturn).toBe(drop.named + (inventory.namedUse.lookupReturn - inventory.namedUse.entry));
  expect(slice(file, drop.callbacks[0]?.entry ?? 0, 3)).toEqual([0xff, 0x51, 0x0c]);
  // Cmd_InvUse_f and Cmd_InvDrop_f validate the selection, then call item->use or item->drop through ecx.
  expect(callTarget(file, inventory.use.entry + 6)).toBe(inventory.validate.entry);
  expect(slice(file, inventory.use.call, 2)).toEqual([0xff, 0xd1]);
  expect(inventory.use.join).toBe(inventory.use.call + 2);
  expect(callTarget(file, drop.inventory.entry + 6)).toBe(inventory.validate.entry);
  expect(drop.inventory.admitted).toBe(drop.inventory.entry + 0xb);
  expect(slice(file, drop.inventory.admitted, 3)).toEqual([0x8b, 0x46, 0x54]);
  expect(slice(file, drop.callbacks[1]?.entry ?? 0, 2)).toEqual([0xff, 0xd1]);
  expect(drop.callbacks.map(value => value.join - value.entry)).toEqual([3, 2]);
  // Drop_Item allocates through G_Spawn; G_FreeEdict is the refusal path; newweapon (pending) is written by Pickup_Weapon's autoswitch.
  expect(slice(file, drop.allocate, 3)).toEqual([0x83, 0xec, 0x5c]);
  expect(callTarget(file, drop.allocate + 6)).toBe(xatrix1998CombatProfile.entries.spawn);
  expect(slice(file, drop.free, 4)).toEqual([0x56, 0x8b, 0x74, 0x24]);
  expect(drop.free).toBe(xatrix1998CombatProfile.entries.free);
  expect(contains(slice(file, 0x34d4f, 0x52), [0x89, 0x97, ...le32(drop.client.pending)])).toBe(true);
  // Debits: Drop_Weapon stores the decremented counter right after Drop_Item; Drop_Ammo stores inventory - count before ValidateSelectedItem.
  const [weaponDebit, ammoDebit] = drop.debits;
  if (weaponDebit === undefined || ammoDebit === undefined) throw new Error("Expected two drop debits");
  expect(slice(file, weaponDebit.entry, 2)).toEqual([0x89, 0x08]);
  expect(weaponDebit.join).toBe(weaponDebit.entry + 2);
  expect(callTarget(file, weaponDebit.entry - 0x1a)).toBe(drop.allocate);
  expect(slice(file, ammoDebit.entry, 3)).toEqual([0x89, 0x34, 0x01]);
  expect(callTarget(file, ammoDebit.join)).toBe(inventory.validate.entry);
});

corpusTest(path)("1998 Xatrix pickup entries sit on Touch_Item and the original grant bodies", () => {
  const file = image();
  const pickups = required(classicPickupProfile(digest)),
    drop = required(nativePrimaryDropProfile(digest));
  // Touch_Item: item->pickup(ent, other) is called through eax and returns into `mov ebp,eax`; G_UseTargets returns to the spawnflags update.
  expect(slice(file, pickups.touch, 7)).toEqual([0x55, 0x56, 0x8b, 0x74, 0x24, 0x10, 0x57]);
  expect(slice(file, pickups.grantReturn - 2, 4)).toEqual([0xff, 0xd0, 0x8b, 0xe8]);
  expect(callTarget(file, pickups.targetsReturn - 5)).toBe(0x181b0);
  expect(slice(file, pickups.targetsReturn, 2)).toEqual([0x8b, 0x87]);
  expect(
    contains(slice(file, pickups.touch, pickups.targetsReturn - pickups.touch), [0xf7, 0x87, ...le32(pickups.entity.spawnflags), 0x00, 0x00, 0x04, 0x00]),
  ).toBe(true);
  expect(contains(slice(file, pickups.touch, 0x60), [0x8b, 0x87, ...le32(pickups.entity.item)])).toBe(true);
  expect([pickups.entity.item, pickups.entity.count, pickups.entity.spawnflags]).toEqual([0x288, 0x214, 0x11c]);
  // Level time is the float after level.framenum.
  expect(pickups.time.address).toBe(xatrix1998CombatProfile.globals.levelFrame + 4);
  expect(contains(slice(file, pickups.touch, 0x100), [0xd9, 0x05, ...le32(base + pickups.time.address)])).toBe(true);
  // Add_Ammo(ent, item, count): item->tag selects the pers.max_* slot.
  expect(slice(file, pickups.supply.ammo.entry, 4)).toEqual([0x53, 0x56, 0x57, 0x8b]);
  expect(contains(slice(file, pickups.supply.ammo.entry, 0x40), [0x8b, 0x42, pickups.supply.ammo.tag])).toBe(true);
  for (const offset of pickups.supply.ammo.capacities) expect(contains(slice(file, pickups.supply.ammo.entry, 0x90), [0x8b, 0x8e, ...le32(offset)])).toBe(true);
  const [armor, ammo, weapon, bandolier, pack] = pickups.grants;
  if (armor === undefined || ammo === undefined || weapon === undefined || bandolier === undefined || pack === undefined)
    throw new Error("Expected five grants");
  const respawnTail = (flags: number): number[] => [0x00, 0x00, flags, 0x00];
  // Pickup_Armor: the region opens at the ArmorIndex call and joins the respawn tail (test ent->spawnflags, 0x10000).
  expect(slice(file, armor.recipient.entry, 1)).toEqual([0x57]);
  expect(callTarget(file, armor.recipient.entry + 1)).toBe(0x9fd0);
  expect(slice(file, armor.recipient.join, 10)).toEqual([0xf7, 0x83, ...le32(0x11c), ...respawnTail(1)]);
  // Pickup_Ammo: Add_Ammo(other, item, count) with count in ebx, then the weapon autoswitch up to the respawn join.
  if (ammo.supply?.kind !== "ammo") throw new Error("Expected an ammo supply");
  expect(slice(file, ammo.supply.entry, 2)).toEqual([0x8b, 0xce]);
  expect(callTarget(file, ammo.supply.entry + 0x2e)).toBe(pickups.supply.ammo.entry);
  expect(slice(file, ammo.recipient.entry, 4)).toEqual([0x8b, 0x7c, 0x24, 0x14]);
  expect(slice(file, ammo.recipient.join, 4)).toEqual([0x8b, 0x5c, 0x24, 0x14]);
  expect(slice(file, ammo.recipient.join + 4, 10)).toEqual([0xf7, 0x83, ...le32(0x11c), ...respawnTail(3)]);
  // Pickup_Weapon: the inventory[index]++ region, the Add_Ammo return, the spawnflags test after it, and the autoswitch tail up to the pops.
  expect(slice(file, weapon.recipient.entry, 3)).toEqual([0x8b, 0x4b, 0x54]);
  expect(slice(file, weapon.recipient.join - 2, 4)).toEqual([0x89, 0x08, 0x8b, 0x86]);
  if (weapon.supply?.kind !== "weapon") throw new Error("Expected a weapon supply");
  expect(callTarget(file, weapon.supply.ammoReturn - 5)).toBe(pickups.supply.ammo.entry);
  expect(slice(file, weapon.supply.settle, 5)).toEqual([0xa9, ...respawnTail(2)]);
  expect(slice(file, weapon.supply.autoswitch.entry, 3)).toEqual([0x8b, 0x7b, 0x54]);
  expect(slice(file, weapon.supply.autoswitch.join, 3)).toEqual(epilogue.slice(0, 3));
  expect(
    contains(slice(file, weapon.supply.autoswitch.entry, weapon.supply.autoswitch.join - weapon.supply.autoswitch.entry), [
      0x89,
      0x97,
      ...le32(drop.client.pending),
    ]),
  ).toBe(true);
  // Pickup_Bandolier and Pickup_Pack raise pers.max_* and add ammo before the respawn tail.
  for (const grant of [bandolier, pack]) {
    expect(grant.recipient.entry).toBe(grant.entry + 0xb);
    expect(slice(file, grant.recipient.entry, 3)).toEqual([0x8b, 0x46, 0x54]);
    expect(slice(file, grant.recipient.join, 4)).toEqual([0x8b, 0x4c, 0x24, 0x0c]);
    expect(slice(file, grant.recipient.join + 4, 10)).toEqual([0xf7, 0x81, ...le32(0x11c), ...respawnTail(1)]);
  }
  expect(bandolier.recipient.join - bandolier.entry).toBe(0x112);
  expect(pack.recipient.join - pack.entry).toBe(0x2d8);
});
