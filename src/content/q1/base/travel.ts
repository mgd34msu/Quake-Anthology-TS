/* client.qc SetNewParms/SetChangeParms/DecodeLevelParms. GPL-2.0-or-later. */
import type { ArmorState, InventoryEntry, ItemId } from "../../../contracts/gameplay.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1FoundationOptions, Q1Weapon } from "../foundation/types.ts";
import { WEAPONS, weaponItem } from "../foundation/types.ts";

export interface Q1TravelState {
  readonly health: number;
  readonly armor: ArmorState;
  readonly inventory: readonly InventoryEntry[];
  readonly weapon: Q1Weapon;
}
const temporaryItems: ReadonlySet<ItemId> = new Set(["q1:key/silver", "q1:key/gold", "q1:powerup/quad", "q1:powerup/invulnerability", "q1:powerup/invisibility", "q1:powerup/suit"]);
export function newQ1Travel(options: Pick<Q1FoundationOptions, "edition" | "skill" | "deathmatch">): Q1TravelState {
  const inventory: InventoryEntry[] = WEAPONS.map(weapon => ({ item: weaponItem(weapon), count: weapon === "axe" || weapon === "shotgun" ? 1 : 0, capacity: 1 }));
  inventory.push({ item: "q1:ammo/shells", count: 25, capacity: 100 }, { item: "q1:ammo/nails", count: 0, capacity: 200 }, { item: "q1:ammo/rockets", count: 0, capacity: 100 }, { item: "q1:ammo/cells", count: 0, capacity: 100 }, { item: "q1:key/silver", count: 0, capacity: 1 }, { item: "q1:key/gold", count: 0, capacity: 1 });
  return { health: options.edition === "rerelease" && options.skill === 3 && options.deathmatch === 0 ? 50 : 100, armor: { kind: "none" }, inventory, weapon: "shotgun" };
}
/** Captures source travel policy without changing the departing actor. */
export function captureQ1Travel(game: Q1Foundation, actor: OwnedActor, weapon: Q1Weapon = game.player(actor.id)?.weapon ?? "shotgun", maxHealth = game.player(actor.id)?.maxHealth ?? 100): Q1TravelState {
  const combat = game.host.combat.read(actor.id); if (combat === null) throw new Error("Q1 travel actor has no combat state");
  if (combat.health <= 0 || game.options.deathmatch !== 0) return newQ1Travel(game.options);
  const inventory = game.host.inventory.entries(actor.id).map(entry => temporaryItems.has(entry.item) ? { ...entry, count: 0 } : entry.item === "q1:ammo/shells" ? { ...entry, count: Math.max(25, entry.count) } : entry);
  return { health: Math.max(maxHealth / 2, Math.min(maxHealth, combat.health)), armor: combat.armor, inventory, weapon };
}
/** Applies to an existing admitted actor; it neither allocates one nor selects its movement/appearance. */
export function admitQ1Travel(game: Q1Foundation, actor: OwnedActor, state: Q1TravelState): undefined {
  game.host.combat.setHealth(actor, state.health); game.host.combat.setArmor(actor, state.armor);
  if (!game.host.inventory.has(actor.id)) game.host.inventory.create(actor, state.inventory);
  else for (const entry of state.inventory) game.host.inventory.configure(actor, entry);
  const player = game.player(actor.id);
  if (player !== null) {
    for (const kind of player.powerups.keys()) game.host.powerup(actor, kind, 0);
    player.powerups.clear(); player.megaRotAt = -1; game.selectWeapon(actor, state.weapon);
  }
  return undefined;
}
