import type { ItemId } from "../../../contracts/gameplay.ts";
import type { ProviderId } from "../../../contracts/identity.ts";

export interface WeaponReference {
  readonly provider: ProviderId;
  readonly item: ItemId;
}

/** Actor-bound source adapter. Its usual traversal still owns time and committed actions. */
export interface PrimaryWeaponHandoff {
  readonly provider: ProviderId;
  /** Read-only ownership and source availability validation. */
  accepts(item: ItemId): boolean;
  /** Ordinary primary selection; native pending selection stays with the source. */
  select(item: ItemId): boolean;
  /** Idempotently requests the source's real drop and committed-action settlement. */
  holster(): void;
  /** Reads saved source handoff state; lifecycle and timers continue while holstered. */
  isHolstered(): boolean;
  /**
   * Requests a source-safe raise. Null retains the prior real primary item.
   * If that item, or a queued explicit item, became unavailable, the source chooses
   * its normal valid fallback (including no weapon when native rules require it).
   */
  resume(item: ItemId | null): void;
}

/** The selected equipment's actor-bound animation adapter, separate from its mechanic. */
export interface EquipmentWeaponHandoff {
  readonly weapon: WeaponReference;
  holster(): void;
  isHolstered(): boolean;
  resume(): void;
}

export type WeaponSlotState =
  | { readonly kind: "primary" }
  | { readonly kind: "equipment" }
  | { readonly kind: "holstering-primary"; readonly next: WeaponReference }
  | { readonly kind: "holstering-equipment"; readonly next: WeaponReference };

/** One actor's cross-provider selection. No source frames, timers, ammo or native pending item. */
export class WeaponSlot {
  private current: WeaponSlotState;

  constructor(
    private readonly primary: PrimaryWeaponHandoff,
    private readonly equipment: EquipmentWeaponHandoff,
    restored: WeaponSlotState = { kind: "primary" },
  ) {
    this.current = restored;
  }

  snapshot(): WeaponSlotState { return this.current; }

  /** Only gates new primary attacks; source lifecycle and committed attacks still execute. */
  primarySelected(): boolean { return this.current.kind === "primary"; }
  equipmentSelected(): boolean { return this.current.kind === "equipment"; }

  request(weapon: WeaponReference): boolean {
    const equipment = this.isEquipment(weapon);
    if (!equipment && (weapon.provider !== this.primary.provider || !this.primary.accepts(weapon.item))) return false;
    switch (this.current.kind) {
      case "primary":
        if (!equipment) return this.primary.select(weapon.item);
        this.current = { kind: "holstering-primary", next: weapon };
        this.primary.holster();
        return true;
      case "equipment":
        if (equipment) return true;
        this.current = { kind: "holstering-equipment", next: weapon };
        this.equipment.holster();
        return true;
      case "holstering-primary":
      case "holstering-equipment":
        this.current = { kind: this.current.kind, next: weapon };
        return true;
    }
  }

  /** Called after the existing source traversal. It never advances either weapon. */
  reconcile(): void {
    const state = this.current;
    if (state.kind === "primary" || state.kind === "equipment") return;
    const outgoing = state.kind === "holstering-primary" ? this.primary : this.equipment;
    if (!outgoing.isHolstered()) return;
    if (this.isEquipment(state.next)) {
      this.equipment.resume();
      this.current = { kind: "equipment" };
    } else {
      this.primary.resume(state.next.item);
      this.current = { kind: "primary" };
    }
  }

  private isEquipment(weapon: WeaponReference): boolean {
    return weapon.provider === this.equipment.weapon.provider && weapon.item === this.equipment.weapon.item;
  }
}
