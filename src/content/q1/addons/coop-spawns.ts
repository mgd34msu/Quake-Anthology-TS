// SPDX-License-Identifier: GPL-2.0-or-later
/* quakec_{mg1,mg3}/client.qc: info_player_coop checkpoints and COOP_RESPAWN_KEEP_WEAPONS. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { WEAPONS } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

const SPAWN_START_ACTIVE = 1;
const floors: readonly { readonly weapons: readonly string[]; readonly item: "q1:ammo/nails" | "q1:ammo/rockets" | "q1:ammo/cells"; readonly count: number }[] =
  [
    { weapons: ["nailgun", "supernailgun"], item: "q1:ammo/nails", count: 30 },
    { weapons: ["grenadelauncher", "rocketlauncher"], item: "q1:ammo/rockets", count: 4 },
    { weapons: ["lightning"], item: "q1:ammo/cells", count: 12 },
  ];

/** A checkpoint trigger activates exactly the points it targets and records the weapons the team holds. */
export function registerCoopSpawns(context: Q1AddonContext): undefined {
  const { game } = context;
  game.registerSpawn("info_player_coop", (_game, entity) => {
    if (!game.options.coop) return game.remove(entity);
    entity.activated = entity.targetname === "" || (entity.spawnflags & SPAWN_START_ACTIVE) !== 0;
    return undefined;
  });
  game.registerSpawn("trigger_activate_coop_spawns", (_game, entity) => {
    if (!game.options.coop) return game.remove(entity);
    entity.use = game.named.use(entity, "mg:coop_spawns_use");
    return undefined;
  });
  game.named.register("mg:coop_spawns_use", {
    use: (_game, entity) => {
      const held = new Set<string>();
      for (const player of game.host.players())
        for (const weapon of WEAPONS) if (game.host.inventory.count(player, game.weaponItem(weapon)) > 0) held.add(weapon);
      for (const spot of game.entities.values()) {
        if (spot.classname !== "info_player_coop") continue;
        spot.activated = spot.targetname === entity.target;
        if (spot.activated) spot.fields.set("coop.weapons", [...held].join(" "));
        else spot.fields.delete("coop.weapons");
      }
      return undefined;
    },
  });
  return undefined;
}

/** PutClientInServer: a respawning coop player gets back the weapons recorded on the spot, then the ammo floors. */
export function restoreCoopWeapons(context: Q1AddonContext, actor: ActorId, spot: Q1Actor): undefined {
  const { game } = context,
    owner = game.host.actors.resolveOwned(actor),
    held = spot
      .text("coop.weapons")
      .split(" ")
      .filter(name => name !== "");
  if (owner === null || !game.options.coop || held.length === 0) return undefined;
  for (const weapon of WEAPONS)
    if (held.includes(weapon) && game.host.inventory.count(actor, game.weaponItem(weapon)) === 0) game.host.inventory.give(owner, game.weaponItem(weapon), 1);
  for (const floor of floors) {
    if (!floor.weapons.some(name => held.includes(name))) continue;
    const missing = floor.count - game.host.inventory.count(actor, floor.item);
    if (missing > 0) game.host.inventory.give(owner, floor.item, missing);
  }
  return undefined;
}
