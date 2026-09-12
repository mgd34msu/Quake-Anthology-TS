import type { ProviderReference } from "../../../contracts/content.ts";
import type { PlayerUi, PlayerUiItem, SimulationPresentation } from "./types.ts";
import type { WeaponReference, WeaponSlotState } from "./weapon-slot.ts";

export interface EquipmentWeaponProjection {
  readonly source: ProviderReference;
  readonly weapon: WeaponReference;
  readonly item: PlayerUiItem;
  readonly model: SimulationPresentation | null;
}
export interface WeaponSlotProjection {
  readonly active: WeaponReference | null;
  readonly pending: WeaponReference | null;
  readonly ui: PlayerUi;
  readonly model: SimulationPresentation | null;
}
export type PrimaryWeaponProjection = WeaponSlotProjection;

/** The outgoing weapon remains visible through its own drop animation. */
export function projectWeaponSlot(
  state: WeaponSlotState, primary: PrimaryWeaponProjection, equipment: EquipmentWeaponProjection,
): WeaponSlotProjection {
  const primaryVisible = state.kind === "primary" || state.kind === "holstering-primary";
  const items = [...primary.ui.items.filter(item => item.id !== equipment.item.id), equipment.item];
  const pending = state.kind === "holstering-primary" || state.kind === "holstering-equipment"
    ? state.next : primaryVisible ? primary.pending : null;
  return { active: primaryVisible ? primary.active : equipment.weapon, pending,
    ui: { ...primary.ui, items, weaponStatus: primaryVisible ? primary.ui.weaponStatus : { source: equipment.source, item: equipment.weapon.item, label: equipment.item.label, ammo: { kind: "unmetered" } }, activeWeapon: primaryVisible ? primary.ui.activeWeapon : equipment.weapon.item,
      ammo: primaryVisible ? primary.ui.ammo : null },
    model: primaryVisible ? primary.model : equipment.model };
}
