/* Mission-pack modifications to the inherited items.qc paths. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1Weapon } from "../foundation/types.ts";
import type { MissionPackPlayers } from "./player.ts";
import type { Q1MissionPack } from "./types.ts";
import { hipnoticWeaponRank } from "./items.ts";

function rogueRank(weapon: Q1Weapon): number {
  const order: readonly Q1Weapon[] = ["rogue:plasma", "lightning", "rogue:multi-rocket", "rocketlauncher", "rogue:lava-supernailgun", "supernailgun", "rogue:multi-grenade", "grenadelauncher", "rogue:lava-nailgun", "supershotgun", "nailgun"];
  const rank = order.indexOf(weapon); return rank < 0 ? 12 : rank + 1;
}
export function registerMissionPackPickupRules(game: Q1EntityServices, pack: Q1MissionPack, players: MissionPackPlayers): undefined {
  return game.registerPickupRules({ id: `q1:${pack}:pickups`,
    weaponLeave: runtime => runtime.options.coop || runtime.options.deathmatch === 2 || runtime.options.edition === "rerelease" && [3, 5].includes(runtime.options.deathmatch),
    weaponRank: pack === "hipnotic" ? hipnoticWeaponRank : rogueRank,
    autoSwitch: (runtime, player, wasOwned) => {
      if (pack === "rogue" && player.weapon === "rogue:grapple" && player.attackHeld) return false;
      return runtime.options.edition === "classic" || player.autoSwitch === "always" || player.autoSwitch === "new" && !wasOwned;
    },
    weaponGranted: (runtime, player, weapon) => {
      if (pack !== "rogue") return weapon;
      players.enableCombos(player); const inventory = runtime.host.inventory;
      switch (weapon) {
        case "lightning": return inventory.count(player.actor.id, "rogue:ammo/plasma") > 0 ? "rogue:plasma" : weapon;
        case "rocketlauncher": return inventory.count(player.actor.id, "rogue:ammo/multi-rockets") > 0 ? "rogue:multi-rocket" : weapon;
        case "grenadelauncher": return inventory.count(player.actor.id, "rogue:ammo/multi-rockets") > 0 ? "rogue:multi-grenade" : weapon;
        case "supernailgun": return inventory.count(player.actor.id, "rogue:ammo/lava-nails") > 1 ? "rogue:lava-supernailgun" : weapon;
        case "nailgun": return inventory.count(player.actor.id, "rogue:ammo/lava-nails") > 0 ? "rogue:lava-nailgun" : weapon;
        default: return weapon;
      }
    },
    respawn: (runtime, entity, delay) => runtime.options.edition === "classic" && runtime.options.deathmatch !== 1 &&
      (entity.classname.startsWith("item_armor") || entity.classname.startsWith("weapon_") || ["item_shells", "item_spikes", "item_rockets", "item_cells", "item_weapon"].includes(entity.classname)) ? -1 : delay,
  });
}
