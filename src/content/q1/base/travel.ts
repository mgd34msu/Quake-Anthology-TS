/* client.qc SetNewParms/SetChangeParms/DecodeLevelParms. GPL-2.0-or-later. */
import type { ArmorState, InventoryEntry, ItemId } from "../../../contracts/gameplay.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1FoundationOptions, Q1Weapon } from "../foundation/types.ts";
import { WEAPONS, weaponItem } from "../foundation/types.ts";

export interface Q1TravelState {
  readonly health: number;
  readonly maxHealth: number;
  readonly armor: ArmorState;
  readonly inventory: readonly InventoryEntry[];
  readonly weapon: Q1Weapon;
  readonly extensions: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}
const temporaryItems: ReadonlySet<ItemId> = new Set(["q1:key/silver", "q1:key/gold", "q1:powerup/quad", "q1:powerup/invulnerability", "q1:powerup/invisibility", "q1:powerup/suit"]);
export function newQ1Travel(options: Pick<Q1FoundationOptions, "edition" | "skill" | "deathmatch">): Q1TravelState {
  const inventory: InventoryEntry[] = WEAPONS.map(weapon => ({ item: weaponItem(weapon), count: weapon === "axe" || weapon === "shotgun" ? 1 : 0, capacity: 1 }));
  inventory.push({ item: "q1:ammo/shells", count: 25, capacity: 100 }, { item: "q1:ammo/nails", count: 0, capacity: 200 }, { item: "q1:ammo/rockets", count: 0, capacity: 100 }, { item: "q1:ammo/cells", count: 0, capacity: 100 }, { item: "q1:key/silver", count: 0, capacity: 1 }, { item: "q1:key/gold", count: 0, capacity: 1 });
  const health = options.edition === "rerelease" && options.skill === 3 && options.deathmatch === 0 ? 50 : 100;
  return { health, maxHealth: health, armor: { kind: "none" }, inventory, weapon: "shotgun", extensions: [] };
}
/** Captures source travel policy without changing the departing actor. */
export function captureQ1Travel(game: Q1EntityServices, actor: OwnedActor, weapon: Q1Weapon = game.player(actor.id)?.weapon ?? "shotgun", maxHealth = game.player(actor.id)?.maxHealth ?? 100, policy: { readonly resetInDeathmatch?: boolean } = {}): Q1TravelState {
  const combat = game.host.combat.read(actor.id); if (combat === null) throw new Error("Q1 travel actor has no combat state");
  const player = game.player(actor.id), extensions: { readonly id: string; readonly bytes: Uint8Array }[] = [];
  if (player !== null) for (const extension of game.playerExtensions.values()) {
    const bytes = extension.captureTravel?.(game, player);
    if (bytes !== undefined) extensions.push({ id: extension.id, bytes: bytes.slice() });
  }
  if (combat.health <= 0 || game.options.deathmatch !== 0 && (policy.resetInDeathmatch ?? true)) return { ...newQ1Travel(game.options), extensions };
  const inventory = game.host.inventory.entries(actor.id).map(entry => temporaryItems.has(entry.item) ? { ...entry, count: 0 } : entry.item === "q1:ammo/shells" ? { ...entry, count: Math.max(25, entry.count) } : entry);
  return { health: Math.max(maxHealth / 2, Math.min(maxHealth, combat.health)), maxHealth, armor: combat.armor, inventory, weapon, extensions };
}
/** DecodeLevelParms resets equipment when returning to start with an episode rune. */
export function decodeQ1Travel(game: Q1EntityServices, state: Q1TravelState, serverFlags: number): Q1TravelState {
  return serverFlags !== 0 && game.mapName === "start" ? { ...newQ1Travel(game.options), extensions: state.extensions } : state;
}
/** Applies to an existing admitted actor; it neither allocates one nor selects its movement/appearance. */
export function admitQ1Travel(game: Q1EntityServices, actor: OwnedActor, state: Q1TravelState): undefined {
  game.host.combat.setHealth(actor, state.health); game.host.combat.setArmor(actor, state.armor);
  if (!game.host.inventory.has(actor.id)) game.host.inventory.create(actor, state.inventory);
  else for (const entry of state.inventory) game.host.inventory.configure(actor, entry);
  const player = game.player(actor.id);
  if (player !== null) {
    player.maxHealth = state.maxHealth;
    for (const kind of player.powerups.keys()) game.host.powerup(actor, kind, 0);
    player.powerups.clear(); player.megaRotAt = -1; game.selectWeapon(actor, state.weapon);
    for (const extension of state.extensions) {
      const restore = game.playerExtensions.get(extension.id)?.restoreTravel;
      if (restore === undefined) throw new Error(`Missing Q1 player travel extension: ${extension.id}`);
      restore(game, player, extension.bytes);
    }
  }
  return undefined;
}
