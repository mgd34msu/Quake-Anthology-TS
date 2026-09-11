import type { Q1AddonContext } from "../context.ts";
import { registerMg3ItemCallbacks } from "./common.ts";
import { mg3WeaponRank, registerMg3Pickups } from "./pickups.ts";
import { captureMg3UpgradeTravel, initializeMg3Capacities, registerMg3Upgrades, restoreMg3UpgradeTravel } from "./upgrades.ts";
import { mg3WeaponFrame, registerMg3Weapons } from "./weapons.ts";

export { mg3UpgradeFlag, mg3UpgradedMaximum, initializeMg3Capacities, captureMg3UpgradeTravel, restoreMg3UpgradeTravel, giveNextMg3Upgrade } from "./upgrades.ts";
export type { Mg3Upgrade } from "./upgrades.ts";
export { mg3HammerBodyFrame } from "./weapons.ts";
export { handleMg3ItemImpulse } from "./commands.ts";

/** Register after the shared base arsenal and before player admission/map spawning. */
export function registerMg3Items(context: Q1AddonContext): undefined {
  if (context.program !== "mg3") throw new Error("MG3 item registration requires its source program");
  registerMg3ItemCallbacks(context); registerMg3Upgrades(context); registerMg3Weapons(context); registerMg3Pickups(context);
  context.game.registerPickupRules({ id: "q1:mg3", weaponRank: mg3WeaponRank });
  context.game.registerPlayerExtension({ id: "q1:mg3:items", attach: (_game, player) => initializeMg3Capacities(context, player),
    frame: (_game, player) => mg3WeaponFrame(context, player), captureTravel: (_game, player) => captureMg3UpgradeTravel(context, player),
    restoreTravel: (_game, player, bytes) => restoreMg3UpgradeTravel(context, player, bytes) });
  return undefined;
}
