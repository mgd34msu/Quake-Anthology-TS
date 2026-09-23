import type { QvmInventoryProfile } from "../../../compat/qvm/game-inventory.ts";
import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { QvmOpcode } from "../../../compat/qvm/image.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./threewave-grapple-profile.ts";

const stockDigest = "sha256:57c52bf22e4f528c064f8af1553a7103723bab0a02276bb11eed944bf829b219";

/** Capacity metadata reads the pinned Add_Ammo instructions, not host pickup formulas. */
export function q3NativeInventoryProfile(artifact: QvmModuleOptions["artifact"]): QvmInventoryProfile | null {
  if (artifact.module.digest !== stockDigest && artifact.module.digest !== THREEWAVE_GRAPPLE_DIGEST) return null;
  if (artifact.role !== "qagame" || artifact.abiProfile !== "q3-modern") throw new Error("Qualified Q3 inventory requires its modern server ABI");
  const constant = (index: number): number => {
    const instruction = artifact.image.instructions[index];
    if (instruction?.opcode !== QvmOpcode.OP_CONST) throw new Error("Q3 inventory source constant is not its qualified instruction");
    return instruction.operand;
  };
  const cap = (comparison: number, store: number): number => {
    const value = constant(comparison);
    if (constant(store) !== value || artifact.image.instructions[comparison + 1]?.opcode !== QvmOpcode.OP_LEI
      || artifact.image.instructions[store + 1]?.opcode !== QvmOpcode.OP_STORE4 || value < 0)
      throw new Error("Q3 inventory capacity comparison and store disagree");
    return value;
  };
  const common = { module: artifact.module, abiProfile: artifact.abiProfile, ammoOffset: 376 };
  if (artifact.module.digest === stockDigest) {
    const limit = cap(103202, 103216);
    return { ...common, weaponsOffset: 192, capacity: () => limit };
  }
  const ordinary = cap(166830, 166844), fallback = cap(166753, 166764);
  const gameType = constant(166769), specialMode = constant(166771), lithium = constant(166773);
  const first = constant(166498), last = constant(166507), jumpTable = constant(166514);
  const data = new DataView(artifact.image.initializedData.buffer, artifact.image.initializedData.byteOffset, artifact.image.initializedData.byteLength);
  const limits = new Map<number, number>();
  for (let weapon = first; weapon <= last; weapon++) {
    const branch = data.getInt32(jumpTable + weapon * 4, true);
    limits.set(weapon, cap(branch + 10, branch + 21));
  }
  return { ...common, weaponsOffset: 204, capacity: (memory, weapon) => {
    const special = memory.dataView(gameType, 4).getInt32(0, true) === specialMode || memory.dataView(lithium, 4).getInt32(0, true) !== 0;
    return special ? limits.get(weapon) ?? fallback : ordinary;
  } };
}
