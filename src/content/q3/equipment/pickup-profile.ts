import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import type { QvmPickupEligibility, QvmPickupProfile } from "../../../compat/qvm/game-pickups.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./threewave-grapple-profile.ts";

export const STOCK_Q3_PICKUP_DIGEST = "sha256:57c52bf22e4f528c064f8af1553a7103723bab0a02276bb11eed944bf829b219";

/** Non-resource eligibility from Threewave BG_CanItemBeGrabbed; the selected owner decides caps and tiers. */
function threewaveDroppedOwner({ call, item, player }: QvmPickupEligibility, lithium: boolean): boolean {
  const mode = call.words.getInt32(0, true), alternate = lithium && call.words.getInt32(12, true) !== 0;
  return (mode !== 10 && !alternate) || item.getInt32(164, true) !== 2 || item.getInt32(168, true) !== player.getInt32(140, true);
}

/** Entry and caller indices are qualified only for these immutable original executables. */
export function q3NativePickupProfile(artifact: QvmModuleOptions["artifact"]): QvmPickupProfile | null {
  const common = { module: artifact.module, abiProfile: "q3-modern", fields: { inuse: 520, client: 516, health: 732, item: 804, count: 760, flags: 536 },
    droppedFlag: 4096, objectiveTypes: [8] } satisfies Pick<QvmPickupProfile, "module" | "abiProfile" | "fields" | "droppedFlag" | "objectiveTypes">;
  switch (artifact.module.digest) {
    case STOCK_Q3_PICKUP_DIGEST: return { ...common, entityStride: 808, clientStride: 776, touch: 103974,
      gate: { entry: 65953, calls: [104007], itemArgument: 1, playerArgument: 2 }, targets: { entry: 129114, calls: [104340] }, free: 129805,
      items: { address: 2552, count: 36, stride: 52, fields: { className: 0, pickupName: 28, type: 36, tag: 40 }, weaponType: 1, ammoType: 2 },
      grants: [{ itemType: 3, entry: 103594, calls: [104107], operation: { kind: "return", acceptedReturn: 103658 }, eligible: () => true },
        { itemType: 2, entry: 103220, calls: [104091], operation: { kind: "return", acceptedReturn: 103265 }, eligible: () => true }] };
    case THREEWAVE_GRAPPLE_DIGEST: return { ...common, entityStride: 876, clientStride: 944, touch: 168574,
      gate: { entry: 20482, calls: [168697, 168873], itemArgument: 1, playerArgument: 2 }, targets: { entry: 210519, calls: [169404] }, free: 211210,
      items: { address: 5304, count: 50, stride: 52, fields: { className: 0, pickupName: 28, type: 36, tag: 40 }, weaponType: 1, ammoType: 2 },
      grants: [{ itemType: 3, entry: 167408, calls: [169094], operation: { kind: "return", acceptedReturn: 167814 }, eligible: context => threewaveDroppedOwner(context, false) },
        { itemType: 2, entry: 166848, calls: [169078], operation: { kind: "region", entry: 166875, join: 166893, quantity: 20 }, eligible: context => threewaveDroppedOwner(context, true) },
        { itemType: 1, entry: 166897, calls: [169062], operation: { kind: "region", entry: 167099, join: 167173, quantity: 20,
          weapon: { bitsOffset: 204, ammoOffset: 376, quantity: { entry: 166958, join: 167099, inputs: [], result: 20 } } }, eligible: context => threewaveDroppedOwner(context, true) }] };
    default: return null;
  }
}
