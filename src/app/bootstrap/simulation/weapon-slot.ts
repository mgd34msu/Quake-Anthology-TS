import type { ItemId } from "../../../contracts/gameplay.ts";
import type { ProviderId } from "../../../contracts/identity.ts";
import type { SourceWeaponBinding, SourceWeaponHandoff, SourceWeaponPresentation, WeaponReference } from "../../../contracts/source-items.ts";
export type { SourceWeaponHandoff as PrimaryWeaponHandoff, WeaponReference } from "../../../contracts/source-items.ts";

export interface EquipmentWeaponHandoff {
  readonly weapon: WeaponReference;
  holster(): void;
  isHolstered(): boolean;
  resume(): void;
}
export type WeaponSlotState =
  | { readonly kind: "active"; readonly provider: ProviderId }
  | { readonly kind: "switching"; readonly from: ProviderId; readonly next: WeaponReference };
/** Legacy saves are lowered once when their actual primary/equipment bindings are available. */
export type WeaponSlotRestoreState = WeaponSlotState
  | { readonly kind: "primary" | "equipment" }
  | { readonly kind: "holstering-primary" | "holstering-equipment"; readonly next: WeaponReference };
interface Binding { readonly handoff: SourceWeaponHandoff; readonly current: () => boolean; readonly read: (() => SourceWeaponPresentation) | null; }

/** One actor's source selection. Each bound source still owns its normal traversal. */
export class WeaponSlot {
  private current: WeaponSlotState;
  private restorePending: boolean;
  private readonly bindings = new Map<ProviderId, Binding>();
  constructor(private readonly primary: SourceWeaponHandoff, private readonly equipment?: EquipmentWeaponHandoff,
    restored?: WeaponSlotRestoreState, private readonly actorCurrent: () => boolean = () => true) {
    this.bindings.set(primary.provider, { handoff: primary, current: actorCurrent, read: null });
    if (equipment !== undefined) {
      if (equipment.weapon.provider === primary.provider) throw new Error("Equipment and primary weapon owners overlap");
      this.bindings.set(equipment.weapon.provider, { current: actorCurrent, read: null, handoff: {
        provider: equipment.weapon.provider, accepts: item => item === equipment.weapon.item,
        select: item => item === equipment.weapon.item, holster: () => equipment.holster(), isHolstered: () => equipment.isHolstered(), resume: () => { equipment.resume(); return true; },
      } });
    }
    this.current = this.restore(restored ?? { kind: "active", provider: primary.provider });
    this.restorePending = restored !== undefined;
  }
  private restore(state: WeaponSlotRestoreState): WeaponSlotState {
    switch (state.kind) {
      case "active": case "switching": return state;
      case "primary": return { kind: "active", provider: this.primary.provider };
      case "equipment": if (this.equipment === undefined) throw new Error("Saved equipment weapon has no owner"); return { kind: "active", provider: this.equipment.weapon.provider };
      case "holstering-primary": return { kind: "switching", from: this.primary.provider, next: state.next };
      case "holstering-equipment": if (this.equipment === undefined) throw new Error("Saved equipment transition has no owner"); return { kind: "switching", from: this.equipment.weapon.provider, next: state.next };
    }
  }
  snapshot(): WeaponSlotState { return this.current; }
  validateRestore(): void {
    if (!this.restorePending) return;
    const state = this.current, outgoing = this.binding(state.kind === "active" ? state.provider : state.from);
    if (!this.actorCurrent() || outgoing === null) throw new Error("Saved weapon source is not bound");
    if (outgoing.read !== null) {
      const presentation = outgoing.read();
      if (presentation.source.provider !== outgoing.handoff.provider || presentation.active !== null && !presentation.items.some(item => item.kind === "weapon" && item.item === presentation.active)
        || this.binding(outgoing.handoff.provider) !== outgoing) throw new Error("Saved active weapon is not declared by its source owner");
    }
    if (state.kind === "switching") {
      const incoming = this.binding(state.next.provider);
      if (incoming === null || !incoming.handoff.accepts(state.next.item) || this.binding(state.next.provider) !== incoming)
        throw new Error("Saved pending weapon is not admitted to its source owner");
    }
    this.restorePending = false;
  }
  selected(provider: ProviderId): boolean { return this.actorCurrent() && this.current.kind === "active" && this.current.provider === provider && this.binding(provider) !== null; }
  primarySelected(): boolean { return this.selected(this.primary.provider); }
  equipmentSelected(): boolean { return this.equipment !== undefined && this.selected(this.equipment.weapon.provider); }
  private binding(provider: ProviderId): Binding | null {
    const binding = this.bindings.get(provider); return binding !== undefined && binding.current() && this.bindings.get(provider) === binding ? binding : null;
  }
  bind(source: SourceWeaponBinding): () => undefined {
    if (!this.actorCurrent() || !source.current() || this.bindings.has(source.handoff.provider)) throw new Error("Source weapon owner is unavailable or already bound");
    const binding: Binding = { handoff: source.handoff, current: () => source.current(), read: () => source.read() };
    this.bindings.set(source.handoff.provider, binding);
    return () => {
      if (this.bindings.get(source.handoff.provider) !== binding) return undefined;
      this.bindings.delete(source.handoff.provider);
      if (!this.actorCurrent() || this.restorePending) return undefined;
      const state = this.current;
      if (state.kind === "active" && state.provider === source.handoff.provider || state.kind === "switching" && state.from === source.handoff.provider) this.fallback();
      else if (state.kind === "switching" && state.next.provider === source.handoff.provider) this.resume(state.from, null);
      return undefined;
    };
  }
  presentations(): readonly SourceWeaponPresentation[] {
    if (!this.actorCurrent()) return [];
    const result: SourceWeaponPresentation[] = [];
    for (const [provider, entry] of this.bindings) if (entry.read !== null && this.binding(provider) === entry) {
      const state = entry.read();
      if (state.source.provider !== provider) throw new Error("Source weapon presentation belongs to another owner");
      if (this.binding(provider) === entry) result.push(state);
    }
    return result;
  }
  request(weapon: WeaponReference): boolean {
    this.validateRestore();
    if (!this.actorCurrent()) return false;
    const destination = this.binding(weapon.provider);
    if (destination === null || !destination.handoff.accepts(weapon.item) || this.binding(weapon.provider) !== destination) return false;
    const state = this.current;
    if (state.kind === "switching") { this.current = { ...state, next: weapon }; return true; }
    if (state.provider === weapon.provider) { const accepted = destination.handoff.select(weapon.item); return accepted && this.actorCurrent() && this.binding(weapon.provider) === destination; }
    const outgoing = this.binding(state.provider);
    if (outgoing === null) { this.fallback(); return false; }
    this.current = { kind: "switching", from: state.provider, next: weapon };
    outgoing.handoff.holster(); return true;
  }
  private fallback(): void { this.resume(this.primary.provider, null); }
  private resume(provider: ProviderId, item: ItemId | null, outgoing?: { readonly provider: ProviderId; readonly binding: Binding }): void {
    const binding = this.binding(provider);
    if (binding === null) throw new Error("Weapon selection has no live source owner");
    const activated: WeaponSlotState = { kind: "active", provider }; this.current = activated;
    const accepted = binding.handoff.resume(item);
    if (accepted || !this.actorCurrent() || this.current !== activated || this.binding(provider) !== binding) return;
    if (outgoing !== undefined && this.binding(outgoing.provider) === outgoing.binding) { this.resume(outgoing.provider, null); return; }
    throw new Error("Original source refused weapon resumption");
  }
  /** Reconcile after source traversal; this never advances a source animation itself. */
  reconcile(): void {
    this.validateRestore();
    if (!this.actorCurrent()) return;
    const state = this.current;
    if (state.kind === "active") { if (this.binding(state.provider) === null) this.fallback(); return; }
    const outgoing = this.binding(state.from), incoming = this.binding(state.next.provider);
    if (outgoing === null) { this.fallback(); return; }
    const accepted = incoming !== null && incoming.handoff.accepts(state.next.item);
    if (!this.actorCurrent() || this.current !== state) return;
    if (!accepted || incoming === null || this.binding(state.next.provider) !== incoming) { this.resume(state.from, null); return; }
    if (outgoing.handoff.isHolstered() && this.current === state && this.binding(state.from) === outgoing && this.binding(state.next.provider) === incoming)
      this.resume(state.next.provider, state.next.item, { provider: state.from, binding: outgoing });
  }
}
