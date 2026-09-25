import type { SelectedPickupWeapon } from "../../../../world/gameplay/pickups.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { PickupAmmoReceipt, PickupSelection } from "../../../../contracts/pickups.ts";
import type { ArsenalIntent, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { PlayerUi } from "../types.ts";

import type { PrimaryWeaponHandoff } from "../weapon-slot.ts";

export interface SelectedArsenal {
  readonly family: "q1" | "q2" | "q3";
  readonly provider: ProviderId;
  catalog(): readonly SelectedPickupWeapon[];
  has(actor: ActorId): boolean;
  admit(actor: OwnedActor, maxHealth: number, teamDeathmatch?: boolean): ArsenalState;
  read(actor: ActorId): ArsenalState;
  select(actor: ActorId, item: ItemId): boolean;
  pickupAmmo(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined;
  pickupWeapons(actor: OwnedActor, weapons: readonly ItemId[], selection: PickupSelection): undefined;
  pendingWeapon(actor: ActorId): ItemId | null;
  handoff(actor: ActorId): PrimaryWeaponHandoff;
  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult;
  remove(actor: ActorId): undefined;
  ui(actor: ActorId, source: ProviderReference): Pick<PlayerUi, "activeWeapon" | "ammo" | "items" | "weaponStatus" | "arsenalWarning">;
  view(actor: ActorId): { readonly path: string; readonly frame: number } | null;
}
