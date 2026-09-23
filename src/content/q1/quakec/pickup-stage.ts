import type { ItemId } from "../../../contracts/gameplay.ts";
import type { PickupResource } from "../../../contracts/original-pickups.ts";
import type { QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, type QcProgram } from "../../../compat/qc/program.ts";

export interface QcPickupDescriptor {
  readonly value: string | number;
  readonly item: ItemId;
  readonly resource: PickupResource | null;
  readonly supply?: { readonly item: ItemId; readonly quantity: { readonly kind: "field"; readonly name: string } | { readonly kind: "global"; readonly word: number }; readonly leave?: number };
}
export interface QcPickupRegion {
  readonly region: QcInlineRegion;
  readonly operation: { readonly kind: "decision"; readonly word: number; readonly accepted: number }
    | { readonly kind: "grant" | "weapon-selection" | "admission" | "consume" | "consumed-selection" }
    | { readonly kind: "cargo-ownership"; readonly word: number };
}
export interface QcPickupStage {
  readonly functionIndex: number;
  readonly descriptor: { readonly field: string; readonly kind: "string" | "float"; readonly values: readonly QcPickupDescriptor[] }
    | { readonly kind: "cargo"; readonly value: QcPickupDescriptor; readonly counters: readonly { readonly field: string; readonly item: ItemId }[];
        readonly weapons: readonly { readonly word: number; readonly item: ItemId }[] };
  readonly regions: readonly QcPickupRegion[];
}

const ID1_PICKUP_DIGEST = "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580";

/** Recipient regions from the original id1 items.qc. Map feedback and targets remain outside them. */
export function qcPickupStages(program: QcProgram): readonly QcPickupStage[] {
  if (program.digest !== ID1_PICKUP_DIGEST) return [];
  const statement = (index: number, opcode: QcOpcode, a: number, b: number, c = 0): void => {
    const actual = program.statements[index];
    if (actual?.opcode !== opcode || actual.a !== a || actual.b !== b || actual.c !== c)
      throw new QcProgramError(`Original pickup statement ${index} differs from its qualified artifact`);
  };
  const fn = (name: string, index: number, first: number, start: number, words: number): number => {
    const original = program.functionNamed(name);
    if (original.index !== index || original.firstStatement !== first || original.parameterStart !== start || original.localWords !== words
      || original.parameterSizes.length !== 0 || original.namedBuiltin) throw new QcProgramError(`Unsupported original pickup caller ${name}`);
    return index;
  };
  const armor = fn("armor_touch", 128, 1949, 1931, 3), ammo = fn("ammo_touch", 142, 2389, 2145, 2);
  const decision = (functionIndex: number, entry: number, exit: number, word: number): QcPickupRegion => {
    statement(exit, QcOpcode.IfNot, word, 2);
    statement(exit + 1, QcOpcode.Return, 0, 0);
    return { region: { functionIndex, entry, exit, replaceable: true }, operation: { kind: "decision", word, accepted: 0 } };
  };
  const grant = (functionIndex: number, entry: number, exit: number): QcPickupRegion =>
    ({ region: { functionIndex, entry, exit, replaceable: true }, operation: { kind: "grant" } });
  statement(1975, QcOpcode.LoadF, 29, 187, 1951);
  statement(1979, QcOpcode.Ge, 1953, 1954, 1955);
  statement(1982, QcOpcode.Address, 29, 187, 1956);
  statement(1994, QcOpcode.StorePF, 1965, 1958);
  statement(1995, QcOpcode.Address, 28, 104, 1966);
  const armorRegions = [decision(armor, 1975, 1980, 1955), grant(armor, 1982, 1995)];
  const ammoRegions: QcPickupRegion[] = [];
  const branches: readonly (readonly [number, number, number])[] = [[2405, 158, 2153], [2417, 159, 2161], [2429, 160, 2169], [2441, 161, 2177]];
  for (const [entry, field, temporary] of branches) {
    statement(entry, QcOpcode.LoadF, 29, field, temporary);
    statement(entry + 4, QcOpcode.Address, 29, field, temporary + 2);
    statement(entry + 8, QcOpcode.StorePF, temporary + 5, temporary + 2);
    ammoRegions.push(decision(ammo, entry, entry + 2, temporary + 1), grant(ammo, entry + 4, entry + 9));
  }
  statement(2450, QcOpcode.Call0, 1990, 0);
  statement(2451, QcOpcode.StoreV, 29, 4);
  // The original clamp touches every ammo field. The selected owner already completed its grant.
  ammoRegions.push(grant(ammo, 2450, 2451));
  statement(2470, QcOpcode.LoadF, 29, 154, 2185);
  statement(2483, QcOpcode.StoreEnt, 2145, 28);
  statement(2484, QcOpcode.Address, 28, 130, 2188);
  ammoRegions.push({ region: { functionIndex: ammo, entry: 2470, exit: 2484, replaceable: true }, operation: { kind: "weapon-selection" } });
  const weapon = fn("weapon_touch", 135, 2119, 2021, 6), weaponRegions: QcPickupRegion[] = [];
  const weaponDescriptors: QcPickupDescriptor[] = [];
  const weapons: readonly (readonly [string, ItemId, ItemId, number, number, number, number])[] = [
    ["weapon_nailgun", "q1:weapon/nailgun", "q1:ammo/nails", 2138, 2035, 159, 304],
    ["weapon_supernailgun", "q1:weapon/supernailgun", "q1:ammo/nails", 2154, 2045, 159, 304],
    ["weapon_supershotgun", "q1:weapon/supershotgun", "q1:ammo/shells", 2170, 2055, 158, 230],
    ["weapon_rocketlauncher", "q1:weapon/rocketlauncher", "q1:ammo/rockets", 2186, 2065, 160, 230],
    ["weapon_grenadelauncher", "q1:weapon/grenadelauncher", "q1:ammo/rockets", 2202, 2075, 160, 230],
    ["weapon_lightning", "q1:weapon/lightning", "q1:ammo/cells", 2218, 2085, 161, 1861],
  ];
  for (const [value, item, counter, entry, temporary, field, amount] of weapons) {
    statement(entry, QcOpcode.LoadF, 29, 162, temporary);
    statement(entry + 2, QcOpcode.And, 2026, temporary + 1, temporary + 2);
    statement(entry + 8, QcOpcode.Address, 29, field, temporary + 4);
    statement(entry + 10, QcOpcode.AddF, temporary + 5, amount, temporary + 6);
    statement(entry + 11, QcOpcode.StorePF, temporary + 6, temporary + 4);
    weaponRegions.push(decision(weapon, entry, entry + 3, temporary + 2), grant(weapon, entry + 8, entry + 12));
    weaponDescriptors.push({ value, item, resource: { kind: "inventory", item }, supply: { item: counter, quantity: { kind: "global", word: amount }, leave: 2026 } });
  }
  statement(2252, QcOpcode.Call0, 1990, 0);
  statement(2270, QcOpcode.StoreEnt, 2025, 28);
  statement(2271, QcOpcode.IfNot, 2026, 2);
  weaponRegions.push(grant(weapon, 2252, 2271));
  const counters: readonly ItemId[] = ["q1:ammo/shells", "q1:ammo/nails", "q1:ammo/rockets", "q1:ammo/cells"];
  const backpack = fn("BackpackTouch", 159, 3127, 2464, 6);
  statement(3135, QcOpcode.StoreF, 213, 2469);
  statement(3136, QcOpcode.StoreV, 29, 4);
  statement(3141, QcOpcode.LoadF, 29, 162, 2476);
  statement(3145, QcOpcode.IfNot, 2479, 9);
  statement(3159, QcOpcode.Address, 29, 158, 2482);
  statement(3191, QcOpcode.Call0, 1990, 0);
  statement(3192, QcOpcode.LoadF, 28, 158, 2505);
  statement(3272, QcOpcode.StoreV, 28, 4);
  statement(3273, QcOpcode.Call1, 460, 0);
  statement(3274, QcOpcode.StoreEnt, 29, 28);
  statement(3275, QcOpcode.NotF, 35, 0, 2518);
  statement(3283, QcOpcode.Call0, 1785, 0);
  statement(3284, QcOpcode.Done, 0, 0);
  const backpackRegion = (entry: number, exit: number, operation: QcPickupRegion["operation"]): QcPickupRegion =>
    ({ region: { functionIndex: backpack, entry, exit, replaceable: true }, operation });
  const backpackWeapons: readonly ItemId[] = ["q1:weapon/axe", "q1:weapon/shotgun", "q1:weapon/supershotgun", "q1:weapon/nailgun", "q1:weapon/supernailgun", "q1:weapon/grenadelauncher", "q1:weapon/rocketlauncher", "q1:weapon/lightning"];
  return [{ functionIndex: armor, descriptor: { field: "classname", kind: "string", values: [
    { value: "item_armor1", item: "q1:item_armor1", resource: { kind: "protection", channel: "regular" } },
    { value: "item_armor2", item: "q1:item_armor2", resource: { kind: "protection", channel: "regular" } },
    { value: "item_armorInv", item: "q1:item_armorInv", resource: { kind: "protection", channel: "regular" } },
  ] }, regions: armorRegions }, { functionIndex: ammo, descriptor: { field: "weapon", kind: "float", values: [
    ...counters.map((item, index): QcPickupDescriptor => ({ value: index + 1, item, resource: { kind: "inventory", item }, supply: { item, quantity: { kind: "field", name: "aflag" } } })),
  ] }, regions: ammoRegions }, { functionIndex: weapon, descriptor: { field: "classname", kind: "string", values: weaponDescriptors }, regions: weaponRegions },
  { functionIndex: backpack, descriptor: { kind: "cargo", value: { value: "backpack", item: "q1:item_backpack", resource: null },
    counters: [{ item: "q1:ammo/shells", field: "ammo_shells" }, { item: "q1:ammo/nails", field: "ammo_nails" }, { item: "q1:ammo/rockets", field: "ammo_rockets" }, { item: "q1:ammo/cells", field: "ammo_cells" }],
    weapons: backpackWeapons.map((item, index) => ({ word: 253 + index, item })) }, regions: [
        backpackRegion(3135, 3136, { kind: "admission" }), backpackRegion(3141, 3145, { kind: "cargo-ownership", word: 2479 }),
        grant(backpack, 3159, 3192), backpackRegion(3272, 3275, { kind: "consume" }), backpackRegion(3275, 3284, { kind: "consumed-selection" }),
      ] }];
}
