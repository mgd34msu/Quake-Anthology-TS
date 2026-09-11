/* Hipnotic/Rogue client.qc SetNewParms, SetChangeParms and DecodeLevelParms. GPL-2.0-or-later. */
import type { InventoryEntry } from "../../../contracts/gameplay.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import { weaponItem } from "../foundation/types.ts";
import { admitQ1Travel, captureQ1Travel, newQ1Travel } from "../base/travel.ts";
import type { Q1TravelState } from "../base/travel.ts";
import { missionWeapons } from "./types.ts";
import type { Q1MissionPack } from "./types.ts";

function packInventory(game: Q1Foundation, pack: Q1MissionPack): readonly InventoryEntry[] {
  const inventory: InventoryEntry[] = missionWeapons.filter(weapon => weapon.id.startsWith(`${pack}:`)).map(weapon => ({ item: weaponItem(weapon.id), count: 0, capacity: 1 }));
  if (pack === "rogue") inventory.push(
    { item: "rogue:ammo/lava-nails", count: 0, capacity: 200 },
    { item: "rogue:ammo/multi-rockets", count: 0, capacity: 100 },
    { item: "rogue:ammo/plasma", count: 0, capacity: 100 },
    { item: "rogue:artifact/vengeance", count: 0, capacity: 1 },
    { item: weaponItem("rogue:grapple"), count: game.options.deathmatch !== 0 && (game.options.teamplay ?? 0) >= 4 ? 1 : 0, capacity: 1 },
  );
  return inventory;
}
export function newMissionPackTravel(game: Q1Foundation, pack: Q1MissionPack): Q1TravelState {
  const base = newQ1Travel(game.options), inventory = [...base.inventory, ...packInventory(game, pack)];
  return pack === "rogue" && game.options.deathmatch !== 0 && (game.options.teamplay ?? 0) >= 4 ?
    { ...base, inventory, armor: { kind: "q1", points: 50, absorption: 0.3, item: "q1:armor/green" } } : { ...base, inventory };
}
export function captureMissionPackTravel(game: Q1Foundation, actor: OwnedActor, pack: Q1MissionPack): Q1TravelState {
  if (game.health(actor.id) <= 0 || game.options.edition === "rerelease" && game.options.deathmatch !== 0 || pack === "rogue" && (game.options.teamplay ?? 0) >= 4) return newMissionPackTravel(game, pack);
  const player = game.player(actor.id);
  return captureQ1Travel(game, actor, player?.weapon ?? "shotgun", game.options.edition === "classic" ? 100 : player?.maxHealth ?? 100, { resetInDeathmatch: game.options.edition === "rerelease" });
}
export function decodeMissionPackTravel(game: Q1Foundation, state: Q1TravelState, serverFlags: number, pack: Q1MissionPack): Q1TravelState {
  if (pack === "hipnotic" && ["start", "hip1m1", "hip2m1", "hip3m1"].includes(game.mapName) || pack === "rogue" && (serverFlags !== 0 && game.mapName === "start" || game.options.deathmatch === 0 && game.mapName === "r2m1")) return newMissionPackTravel(game, pack);
  return pack === "rogue" && state.weapon === "rogue:grapple" && (game.options.teamplay ?? 0) < 4 ? { ...state, weapon: "axe" } : state;
}
export function admitMissionPackTravel(game: Q1Foundation, actor: OwnedActor, state: Q1TravelState, pack: Q1MissionPack): undefined {
  const supplied = new Set(state.inventory.map(entry => entry.item));
  const inventory = [...packInventory(game, pack).filter(entry => !supplied.has(entry.item)), ...state.inventory];
  admitQ1Travel(game, actor, { ...state, inventory }); game.setGravity(actor.id, 1);
  return undefined;
}
