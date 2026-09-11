import type { ArsenalIntent, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { PlayerUi } from "../types.ts";

export interface SelectedArsenal {
  readonly family: "q1" | "q2" | "q3";
  readonly provider: ProviderId;
  admit(actor: OwnedActor, maxHealth: number, teamDeathmatch?: boolean): ArsenalState;
  read(actor: ActorId): ArsenalState;
  select(actor: ActorId, item: ItemId): boolean;
  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult;
  remove(actor: ActorId): undefined;
  ui(actor: ActorId): Pick<PlayerUi, "activeWeapon" | "ammo" | "items">;
  view(actor: ActorId): { readonly path: string; readonly frame: number } | null;
}
