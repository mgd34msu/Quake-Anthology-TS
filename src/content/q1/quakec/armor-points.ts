import type { RegularArmorState } from "../../../contracts/gameplay.ts";
import type { ModQcEmptyArmor } from "../../../contracts/mod-callbacks.ts";
import type { QcProgram } from "../../../compat/qc/program.ts";
import { id1ProgramBinding } from "./id1-program.ts";

/** Original id1 armor_touch red tier; other artifacts declare their points-only grant explicitly. */
export function qcEmptyArmor(program: QcProgram, declared?: ModQcEmptyArmor): ((points: number) => Exclude<RegularArmorState, { readonly kind: "none" }>) | undefined {
  const source = declared ?? (id1ProgramBinding(program).attribution === "pinned" ? { item: "q1:item_armorInv", absorption: 0.8 } satisfies ModQcEmptyArmor : undefined);
  if (source === undefined) return undefined;
  if (!["q1:item_armor1", "q1:item_armor2", "q1:item_armorInv"].includes(source.item) || !Number.isFinite(Math.fround(source.absorption)) || source.absorption < 0)
    throw new Error("QC points-only armor requires an authored item and finite nonnegative absorption");
  return points => ({ kind: "q1", item: source.item, absorption: Math.fround(source.absorption), points });
}
