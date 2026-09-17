/* FS_SetRestrictions, id Software files.c. GPL-2.0-or-later. */
import { q3MountRestriction } from "../../core/q3-product-policy.ts";
import type { Q3MountRestriction, Q3ProductPolicy } from "../../core/q3-product-policy.ts";

const scrambledProductId = new Uint8Array([
  220, 129, 255, 108, 244, 163, 171, 55, 133, 65, 199, 36, 140, 222, 53, 99,
  65, 171, 175, 232, 236, 193, 210, 250, 169, 104, 231, 231, 21, 201, 170, 208,
  135, 175, 130, 136, 85, 215, 71, 23, 96, 32, 96, 83, 44, 240, 219, 138,
  184, 215, 73, 27, 196, 247, 55, 139, 148, 68, 78, 203, 213, 238, 139, 23,
  45, 205, 118, 186, 236, 230, 231, 107, 212, 1, 10, 98, 30, 20, 116, 180,
  216, 248, 166, 35, 45, 22, 215, 229, 35, 116, 250, 167, 117, 3, 57, 55,
  201, 229, 218, 222, 128, 12, 141, 149, 32, 110, 168, 215, 184, 53, 31, 147,
  62, 12, 138, 67, 132, 54, 125, 6, 221, 148, 140, 4, 21, 44, 198, 3,
  126, 12, 100, 236, 61, 42, 44, 251, 15, 135, 14, 134, 89, 92, 177, 246,
  152, 106, 124, 78, 118, 80, 28, 42,
]);

/** Resolve before selecting recipe artifacts; a demo restriction changes the mounted content. */
export async function resolveQ3MountRestriction(policy: Q3ProductPolicy, fsRestrict: boolean,
  readProductId: () => Promise<Uint8Array | null>): Promise<Q3MountRestriction> {
  const forced = q3MountRestriction(policy, fsRestrict);
  if (forced.kind === "demo") return forced;
  const productId = await readProductId();
  if (productId === null) return q3MountRestriction(policy, true);
  let seed = 5000;
  for (const [index, scrambled] of scrambledProductId.entries()) {
    if ((scrambled ^ (seed & 255)) !== (productId[index] ?? 0)) throw new Error("Invalid product identification");
    seed = (Math.imul(69069, seed) + 1) | 0;
  }
  return forced;
}
