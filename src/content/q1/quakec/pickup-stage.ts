import type { ItemId } from "../../../contracts/gameplay.ts";
import type { PickupResource } from "../../../contracts/original-pickups.ts";
import type { QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcOpcode, QcProgramError, type QcProgram } from "../../../compat/qc/program.ts";

export interface QcPickupDescriptor {
  readonly value: string | number;
  readonly item: ItemId;
  readonly resource: PickupResource;
}
export interface QcPickupRegion {
  readonly region: QcInlineRegion;
  readonly operation: { readonly kind: "decision"; readonly word: number; readonly accepted: number } | { readonly kind: "grant" };
}
export interface QcPickupStage {
  readonly functionIndex: number;
  readonly descriptor: { readonly field: string; readonly kind: "string" | "float"; readonly values: readonly QcPickupDescriptor[] };
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
  return [{ functionIndex: armor, descriptor: { field: "classname", kind: "string", values: [
    { value: "item_armor1", item: "q1:item_armor1", resource: { kind: "protection", channel: "regular" } },
    { value: "item_armor2", item: "q1:item_armor2", resource: { kind: "protection", channel: "regular" } },
    { value: "item_armorInv", item: "q1:item_armorInv", resource: { kind: "protection", channel: "regular" } },
  ] }, regions: armorRegions }, { functionIndex: ammo, descriptor: { field: "weapon", kind: "float", values: [
    { value: 1, item: "q1:ammo/shells", resource: { kind: "inventory", item: "q1:ammo/shells" } },
    { value: 2, item: "q1:ammo/nails", resource: { kind: "inventory", item: "q1:ammo/nails" } },
    { value: 3, item: "q1:ammo/rockets", resource: { kind: "inventory", item: "q1:ammo/rockets" } },
    { value: 4, item: "q1:ammo/cells", resource: { kind: "inventory", item: "q1:ammo/cells" } },
  ] }, regions: ammoRegions }];
}
