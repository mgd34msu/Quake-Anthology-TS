import type { ProviderReference } from "../../../contracts/content.ts";
import type { PlayerUi, PlayerUiItem, SimulationPresentation } from "./types.ts";
import type { WeaponReference, WeaponSlotState } from "./weapon-slot.ts";
import type { ProviderId } from "../../../contracts/identity.ts";

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
export interface SourceWeaponProjection {
  readonly provider: ProviderId;
  readonly active: WeaponReference | null;
  readonly pending: WeaponReference | null;
  readonly items: readonly PlayerUiItem[];
  readonly weaponStatus: PlayerUi["weaponStatus"];
  readonly ammo: PlayerUi["ammo"];
  readonly model: SimulationPresentation | null;
}

/** The outgoing weapon remains visible through its own drop animation. */
export function projectWeaponSlot(
  state: WeaponSlotState, primary: PrimaryWeaponProjection, equipment?: EquipmentWeaponProjection, sources: readonly SourceWeaponProjection[] = [],
): WeaponSlotProjection {
  const projections: readonly SourceWeaponProjection[] = equipment === undefined ? sources : [...sources, { provider: equipment.weapon.provider,
    active: equipment.weapon, pending: null, items: [equipment.item], model: equipment.model, ammo: null,
    weaponStatus: { source: equipment.source, item: equipment.weapon.item, label: equipment.item.label, ammo: { kind: "unmetered" } } }];
  const provider = state.kind === "active" ? state.provider : state.from, visible = projections.find(source => source.provider === provider);
  const supplied = new Map(projections.flatMap(source => source.items.map(item => [item.id, item] satisfies readonly [typeof item.id, PlayerUiItem])));
  const items = [...primary.ui.items.filter(item => !supplied.has(item.id)), ...supplied.values()];
  return { active: visible === undefined ? primary.active : visible.active,
    pending: state.kind === "switching" ? state.next : visible === undefined ? primary.pending : visible.pending,
    ui: { ...primary.ui, items, weaponStatus: visible === undefined ? primary.ui.weaponStatus : visible.weaponStatus,
      activeWeapon: visible === undefined ? primary.ui.activeWeapon : visible.active?.item ?? null, ammo: visible === undefined ? primary.ui.ammo : visible.ammo },
    model: visible === undefined ? primary.model : visible.model };
}
