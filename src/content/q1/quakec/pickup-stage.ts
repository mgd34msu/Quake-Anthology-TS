import type { QcPickupScalar } from "../../../contracts/qc-pickup-callers.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { PickupResource } from "../../../contracts/original-pickups.ts";
import type { QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, type QcProgram } from "../../../compat/qc/program.ts";

export interface QcPickupDescriptor {
  readonly value: string | number;
  readonly item: ItemId;
  readonly resource: PickupResource | null;
  readonly count?: QcPickupScalar;
  readonly supply?: { readonly item: ItemId; readonly quantity: { readonly kind: "field"; readonly name: string } | { readonly kind: "global"; readonly word: number }; readonly leave?: number };
}
export interface QcPickupRegion {
  readonly region: QcInlineRegion;
  readonly self?: "recipient";
  readonly operation: { readonly kind: "decision"; readonly word: number; readonly accepted: number }
    | { readonly kind: "grant" | "weapon-selection" | "admission" | "consume" | "consumed-selection" | "source-effect" }
    | { readonly kind: "cargo-ownership" | "cargo-current"; readonly word: number }
    | { readonly kind: "counter"; readonly field: string; readonly item: ItemId };
}
export interface QcPickupStage {
  readonly functionIndex: number;
  readonly dropped?: QcPickupScalar;
  readonly descriptor: { readonly kind: "constant"; readonly value: QcPickupDescriptor } | { readonly field: string; readonly kind: "string" | "float"; readonly values: readonly QcPickupDescriptor[] }
    | { readonly kind: "cargo"; readonly value: QcPickupDescriptor; readonly counters: readonly { readonly field: string; readonly item: ItemId }[];
        readonly weapons: readonly { readonly word: number; readonly item: ItemId }[] };
  readonly regions: readonly QcPickupRegion[];
  readonly sourceSelection?: { readonly functionIndex: number; readonly calls: readonly number[]; readonly weapons: readonly { readonly word: number; readonly item: ItemId }[] };
  readonly sourceEffect?: { readonly word: number; readonly value: number };
}

const ID1_PICKUP_DIGEST = "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580";

/** Recipient regions from the original id1 items.qc. Map feedback and targets remain outside them. */
export function qcPickupStages(program: QcProgram): readonly QcPickupStage[] {
  if (program.digest === "sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830") return quakeWorldPickupStages(program);
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

function quakeWorldPickupStages(program: QcProgram): readonly QcPickupStage[] {
  const statement = (index: number, opcode: QcOpcode, a: number, b: number, c = 0): void => {
    const actual = program.statements[index];
    if (actual?.opcode !== opcode || actual.a !== a || actual.b !== b || actual.c !== c)
      throw new QcProgramError(`QW pickup statement ${index} differs from its qualified artifact`);
  };
  const fn = (name: string, index: number, first: number, start: number, locals: number): number => {
    const value = program.functionNamed(name);
    if (value.index !== index || value.firstStatement !== first || value.parameterStart !== start || value.localWords !== locals || value.namedBuiltin)
      throw new QcProgramError(`Unsupported QW pickup caller ${name}`);
    return index;
  };
  const armor = fn("armor_touch", 98, 1115, 1350, 3), ammo = fn("ammo_touch", 113, 1627, 1592, 2);
  const weapon = fn("weapon_touch", 106, 1312, 1451, 7), backpack = fn("BackpackTouch", 130, 2412, 1929, 7);
  const selection = fn("Deathmatch_Weapon", 105, 1300, 1442, 4);
  fn("WeaponCode", 104, 1280, 1434, 0);
  const region = (functionIndex: number, entry: number, exit: number, operation: QcPickupRegion["operation"]): QcPickupRegion =>
    ({ region: { functionIndex, entry, exit, replaceable: true, ...(operation.kind === "counter" ? { standalone: { saved: 1932 } } : {}) }, operation });
  const decision = (functionIndex: number, entry: number, exit: number, word: number): QcPickupRegion => {
    statement(exit, QcOpcode.IfNot, word, 2); statement(exit + 1, QcOpcode.Return, 0, 0);
    return region(functionIndex, entry, exit, { kind: "decision", word, accepted: 0 });
  };
  const grant = (functionIndex: number, entry: number, exit: number): QcPickupRegion => region(functionIndex, entry, exit, { kind: "grant" });
  statement(1147, QcOpcode.LoadF, 29, 181, 1373); statement(1151, QcOpcode.Ge, 1375, 1376, 1377);
  statement(1154, QcOpcode.Address, 29, 181, 1378); statement(1166, QcOpcode.StorePF, 1387, 1380);
  statement(1167, QcOpcode.Address, 28, 103, 1388);
  const counters: readonly ItemId[] = ["q1:ammo/shells", "q1:ammo/nails", "q1:ammo/rockets", "q1:ammo/cells"];
  const ammoRegions: QcPickupRegion[] = [];
  for (const [entry, field, temporary] of [[1643, 153, 1600], [1655, 154, 1608], [1667, 155, 1616], [1679, 156, 1624]] satisfies readonly (readonly [number, number, number])[]) {
    statement(entry, QcOpcode.LoadF, 29, field, temporary);
    statement(entry + 4, QcOpcode.Address, 29, field, temporary + 2);
    statement(entry + 8, QcOpcode.StorePF, temporary + 5, temporary + 2);
    ammoRegions.push(decision(ammo, entry, entry + 2, temporary + 1), grant(ammo, entry + 4, entry + 9));
  }
  statement(1688, QcOpcode.Call0, 1412, 0); statement(1711, QcOpcode.LoadF, 29, 149, 1632);
  statement(1724, QcOpcode.StoreEnt, 1592, 28); statement(1725, QcOpcode.Address, 28, 125, 1635);
  ammoRegions.push(grant(ammo, 1688, 1689), region(ammo, 1711, 1725, { kind: "weapon-selection" }));
  const weaponRegions: QcPickupRegion[] = [], weaponDescriptors: QcPickupDescriptor[] = [];
  const entries: readonly (readonly [string, ItemId, ItemId, number, number, number, number])[] = [
    ["weapon_nailgun", "q1:weapon/nailgun", "q1:ammo/nails", 1349, 1471, 154, 298],
    ["weapon_supernailgun", "q1:weapon/supernailgun", "q1:ammo/nails", 1365, 1481, 154, 298],
    ["weapon_supershotgun", "q1:weapon/supershotgun", "q1:ammo/shells", 1381, 1491, 153, 224],
    ["weapon_rocketlauncher", "q1:weapon/rocketlauncher", "q1:ammo/rockets", 1397, 1501, 155, 224],
    ["weapon_grenadelauncher", "q1:weapon/grenadelauncher", "q1:ammo/rockets", 1413, 1511, 155, 224],
    ["weapon_lightning", "q1:weapon/lightning", "q1:ammo/cells", 1429, 1521, 156, 1276],
  ];
  for (const [value, item, counter, entry, temporary, field, amount] of entries) {
    statement(entry, QcOpcode.LoadF, 29, 157, temporary); statement(entry + 2, QcOpcode.And, 1456, temporary + 1, temporary + 2);
    statement(entry + 8, QcOpcode.Address, 29, field, temporary + 4); statement(entry + 10, QcOpcode.AddF, temporary + 5, amount, temporary + 6);
    statement(entry + 11, QcOpcode.StorePF, temporary + 6, temporary + 4);
    weaponRegions.push(decision(weapon, entry, entry + 3, temporary + 2), grant(weapon, entry + 8, entry + 12));
    weaponDescriptors.push({ value, item, resource: { kind: "inventory", item }, supply: { item: counter, quantity: { kind: "global", word: amount }, leave: 1456 } });
  }
  statement(1466, QcOpcode.Call0, 1412, 0); statement(1473, QcOpcode.StoreEnt, 28, 1455);
  statement(1491, QcOpcode.Call0, 1084, 0); statement(1492, QcOpcode.StoreEnt, 1455, 28);
  weaponRegions.push(grant(weapon, 1466, 1473), { ...region(weapon, 1491, 1492, { kind: "weapon-selection" }), self: "recipient" });
  const weapons = [
    { word: 259, item: "q1:weapon/axe" }, { word: 248, item: "q1:weapon/shotgun" }, { word: 249, item: "q1:weapon/supershotgun" },
    { word: 250, item: "q1:weapon/nailgun" }, { word: 251, item: "q1:weapon/supernailgun" },
    { word: 252, item: "q1:weapon/grenadelauncher" }, { word: 253, item: "q1:weapon/rocketlauncher" }, { word: 254, item: "q1:weapon/lightning" },
  ] satisfies readonly { readonly word: number; readonly item: ItemId }[];
  for (const call of [1486, 1490, 2704, 2708]) statement(call, QcOpcode.Call2, 1441, 0);
  statement(2478, QcOpcode.StoreV, 28, 4); statement(2479, QcOpcode.Call1, 479, 0); statement(2522, QcOpcode.StoreEnt, 29, 28);
  statement(2446, QcOpcode.EqF, 364, 223, 1946); statement(2447, QcOpcode.IfNot, 1946, 77);
  statement(2448, QcOpcode.Address, 29, 147, 1947); statement(2449, QcOpcode.LoadF, 29, 147, 1948);
  statement(2450, QcOpcode.AddF, 1948, 229, 1949); statement(2451, QcOpcode.StorePF, 1949, 1947);
  statement(2504, QcOpcode.Address, 29, 156, 1973); statement(2505, QcOpcode.StorePF, 207, 1973);
  statement(2524, QcOpcode.LoadF, 28, 157, 1977); statement(2525, QcOpcode.IfNot, 1977, 16);
  statement(2526, QcOpcode.LoadF, 29, 157, 1978); statement(2529, QcOpcode.EqF, 1980, 207, 1981);
  statement(2546, QcOpcode.Address, 29, 153, 1984); statement(2565, QcOpcode.StorePF, 1999, 1996);
  statement(2570, QcOpcode.LoadF, 29, 149, 2002); statement(2571, QcOpcode.StoreF, 2002, 1932);
  statement(2572, QcOpcode.LoadF, 29, 157, 2003); statement(2579, QcOpcode.Call0, 1412, 0);
  statement(2660, QcOpcode.EqF, 364, 222, 2021); statement(2661, QcOpcode.EqF, 364, 224, 2022);
  statement(2662, QcOpcode.Or, 2021, 2022, 2023); statement(2663, QcOpcode.StoreV, 1932, 4); statement(2664, QcOpcode.Call1, 1433, 0);
  statement(2665, QcOpcode.EqF, 1, 225, 2024); statement(2666, QcOpcode.StoreV, 1932, 4); statement(2667, QcOpcode.Call1, 1433, 0);
  statement(2668, QcOpcode.EqF, 1, 226, 2025); statement(2669, QcOpcode.Or, 2024, 2025, 2026);
  statement(2670, QcOpcode.BitAnd, 2023, 2026, 2027); statement(2671, QcOpcode.LoadF, 29, 155, 2028);
  statement(2672, QcOpcode.Lt, 2028, 224, 2029); statement(2673, QcOpcode.BitAnd, 2027, 2029, 2030);
  statement(2674, QcOpcode.IfNot, 2030, 3); statement(2675, QcOpcode.Address, 29, 155, 2031); statement(2676, QcOpcode.StorePF, 224, 2031);
  statement(2690, QcOpcode.StoreV, 28, 4); statement(2691, QcOpcode.Call1, 479, 0); statement(2692, QcOpcode.StoreEnt, 29, 28);
  statement(2709, QcOpcode.Call0, 1084, 0);
  return [
    { functionIndex: armor, descriptor: { field: "classname", kind: "string", values: [
      { value: "item_armor1", item: "q1:item_armor1", resource: { kind: "protection", channel: "regular" } },
      { value: "item_armor2", item: "q1:item_armor2", resource: { kind: "protection", channel: "regular" } },
      { value: "item_armorInv", item: "q1:item_armorInv", resource: { kind: "protection", channel: "regular" } },
    ] }, regions: [decision(armor, 1147, 1152, 1377), grant(armor, 1154, 1167)] },
    { functionIndex: ammo, descriptor: { field: "weapon", kind: "float", values: counters.map((item, index) => ({ value: index + 1, item,
      resource: { kind: "inventory", item }, supply: { item, quantity: { kind: "field", name: "aflag" } } })) }, regions: ammoRegions },
    { functionIndex: weapon, descriptor: { field: "classname", kind: "string", values: weaponDescriptors }, regions: weaponRegions,
      sourceSelection: { functionIndex: selection, calls: [1486, 1490], weapons } },
    { functionIndex: backpack, descriptor: { kind: "cargo", value: { value: "backpack", item: "q1:item_backpack", resource: null },
      counters: [{ item: "q1:ammo/shells", field: "ammo_shells" }, { item: "q1:ammo/nails", field: "ammo_nails" }, { item: "q1:ammo/rockets", field: "ammo_rockets" }, { item: "q1:ammo/cells", field: "ammo_cells" }], weapons },
      sourceEffect: { word: 364, value: 4 }, sourceSelection: { functionIndex: selection, calls: [2704, 2708], weapons }, regions: [
        region(backpack, 2448, 2452, { kind: "source-effect" }),
        region(backpack, 2478, 2523, { kind: "consume" }), region(backpack, 2504, 2506, { kind: "counter", item: "q1:ammo/cells", field: "ammo_cells" }),
        region(backpack, 2524, 2525, { kind: "admission" }), region(backpack, 2526, 2530, { kind: "cargo-ownership", word: 1981 }),
        grant(backpack, 2546, 2566), region(backpack, 2570, 2572, { kind: "cargo-current", word: 1932 }), grant(backpack, 2572, 2580),
        region(backpack, 2660, 2677, { kind: "counter", item: "q1:ammo/rockets", field: "ammo_rockets" }),
        region(backpack, 2690, 2693, { kind: "consume" }), region(backpack, 2709, 2710, { kind: "consumed-selection" }),
      ] },
  ];
}
