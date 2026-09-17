import type { Q1EntityServices } from "../q1/foundation/entity-services.ts";
import type { Q1PlayerState } from "../q1/foundation/types.ts";
import { registerHipnoticWeapons, registerMissionPackArsenal } from "../q1/missionpacks/arsenal.ts";
import { missionWeaponImpulse } from "../q1/missionpacks/selection.ts";
import { Q1Base } from "../q1/base/provider.ts";
import { Q1AddonContext } from "../q1/addons/context.ts";
import type { Q1AddonServices } from "../q1/addons/context.ts";
import { registerMg3Items, handleMg3ItemImpulse } from "../q1/addons/items/index.ts";
import { q1WeaponImpulse } from "./q1/commands.ts";

export type SelectedQ1Program = "id1" | "hipnotic" | "rogue" | "dopa" | "mg1" | "mg3";

export function registerSelectedQ1MissionWeapons(game: Q1EntityServices, program: SelectedQ1Program, services: Q1AddonServices): {
  impulse(player: Q1PlayerState, value: number): boolean;
  frame(elapsedSeconds: number): undefined;
  preparePickup(player: Q1PlayerState): undefined;
} {
  if (program === "hipnotic") {
    registerHipnoticWeapons(game);
    return { impulse: (player, value) => missionWeaponImpulse(game, player, "hipnotic", value), frame: () => undefined, preparePickup: () => undefined };
  }
  if (program === "rogue") {
    const arsenal = registerMissionPackArsenal(game, program);
    return { impulse: (player, value) => arsenal.impulse(player.actor.id, value), frame: () => undefined, preparePickup: player => arsenal.players.enableCombos(player) };
  }
  if (program === "mg3") {
    const context = new Q1AddonContext(new Q1Base(game, { officialCampaign: false }), program, services);
    registerMg3Items(context);
    return { impulse: (player, value) => handleMg3ItemImpulse(context, player.actor.id, value,
      text => services.emit({ kind: "developer-message", text })) || q1WeaponImpulse(game, player, value), frame: elapsed => context.frame(elapsed), preparePickup: () => undefined };
  }
  return { impulse: (player, value) => q1WeaponImpulse(game, player, value), frame: () => undefined, preparePickup: () => undefined };
}
