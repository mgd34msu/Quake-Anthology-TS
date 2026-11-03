import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q2GameServices } from "./host.ts";

/** IF_NO_INFINITE_AMMO: rerelease trap and tesla ammo is spent even under g_infinite_ammo. */
export function noInfiniteAmmo(game: Pick<Q2GameServices, "options">, ammo: ItemId): boolean {
  return game.options.edition === "rerelease" && (ammo === "q2:ammo_trap" || ammo === "q2:ammo_tesla");
}
