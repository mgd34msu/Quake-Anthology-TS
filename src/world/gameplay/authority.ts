import type { ArmorStageInput, ProtectionObserver, ProtectionChannel, ArmorStageResult, ArmorState, RegularArmorState, PoweredProtectionState, CombatPolicy, CombatProgress, CombatState, DamageAuthority, DamageDecision, DamageMutation, DamageOutcome, DamageRequest, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorCallbackTable } from "../actors/callbacks.ts";
import { copyVector } from "../actors/body.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import { ModOperation } from "./mod-composition.ts";
import type { OriginalPickupOffer, OriginalPickupResolution, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import { captureOriginalPickupRules, type CapturedOriginalPickupRule } from "./original-pickups.ts";

export type CombatTraits = Pick<CombatState, "canTakeDamage" | "mass" | "invulnerable" | "team" | "noKnockback">;
export interface PowerArmorCellBinding { read(): number; write(count: number): undefined; }
export type SourceDamageResult = Pick<DamageDecision, "appliedDamage" | "reaction">;
export interface SourceDamageObserver {
  stored(write: Exclude<DamageMutation, { readonly kind: "impulse" }>): undefined;
  beforeReaction(result: SourceDamageResult): undefined;
}
interface SourceDamageCursor {
  readonly request: DamageRequest;
  readonly mutations: DamageMutation[];
  health: number; armor: ArmorState; velocity: Vec3 | null;
  active: boolean;
  reaction: SourceDamageResult | null;
}

export type ProtectionAdmission = { readonly kind: "claim" } | { readonly kind: "replace-primary"; readonly owner: ProviderId } | { readonly kind: "replace-current-primary" };
export interface ProtectionClaim {
  readonly owner: ProviderId;
  readonly rule: string;
  readonly admission: ProtectionAdmission;
}
export type ProtectionBinding<K extends ProtectionChannel = ProtectionChannel> = {
  [P in K]: ProtectionClaim & {
    readonly channel: P;
    readonly inventoryItems: readonly ItemId[];
    readonly pickups?: readonly OriginalPickupRule[];
    readonly read: () => ArmorState[P];
    readonly validateWrite: (next: ArmorState[P]) => undefined;
    readonly write: (next: ArmorState[P]) => undefined;
    readonly absorb: (input: ArmorStageInput, observer: ProtectionObserver) => ArmorStageResult;
  };
}[K];
export interface SourceArmorStage {
  bind(intercept: (input: ArmorStageInput, original: () => number) => number): () => undefined;
}
export type ProtectionReservation<K extends ProtectionChannel = ProtectionChannel> = {
  [P in K]: { readonly channel: P; readonly bind: (binding: ProtectionBinding<P>) => () => undefined; readonly close: () => undefined };
}[K];
type BoundProtection = { [K in ProtectionChannel]: Omit<ProtectionBinding<K>, "pickups"> & { readonly pickups: readonly CapturedOriginalPickupRule[] } }[ProtectionChannel];
interface ProtectionSlot { readonly claim: ProtectionClaim; binding: BoundProtection | null; removeSource: (() => undefined) | null; }
interface ProtectionSlots { regular: ProtectionSlot | null; powered: ProtectionSlot | null; }

export interface CombatStateBinding {
  sourceDamage?(request: DamageRequest): DamageOutcome;
  readonly protection?: { readonly [K in ProtectionChannel]?: { readonly owner: ProviderId | null; readonly stage?: SourceArmorStage } };
  admitDamage?(request: DamageRequest): "continue" | "handled";
  adjustDamage?(request: DamageRequest): Pick<DamageRequest, "amount" | "knockback"> | null;
  read(): CombatState;
  writeHealth(health: number): undefined;
  writeArmor(armor: ArmorState): undefined;
  /** Reject unsupported source representations before a bound fuel reservoir is changed. */
  validateArmor?(armor: ArmorState): undefined;
  normalizeLegacyArmor?(armor: ArmorState): ArmorState;
  /** Present when the source provider exposes mutable traits through this semantic binding. */
  writeTraits?(traits: CombatTraits): undefined;
}

export interface GameplayHooks {
  /** Applies at the source mutation site, including the selected movement provider's arithmetic. */
  impulse(actor: OwnedActor, impulse: Vec3, movement: ProviderId): undefined;
  /** Feedback and game-specific reactions run before the ordinary pain/death callback. */
  beforeReaction(actor: OwnedActor, decision: DamageDecision): undefined;
  /** Match scoring observes each completed call, including nested calls, exactly once. */
  confirmed(outcome: DamageOutcome): undefined;
}

export function copyArmor(armor: ArmorState): ArmorState {
  return Object.freeze({ regular: Object.freeze({ ...armor.regular }), powered: Object.freeze({ ...armor.powered }) });
}

export function copyCombat(state: CombatState): CombatState { return Object.freeze({ ...state, armor: copyArmor(state.armor) }); }

export function captureRequest(request: DamageRequest): DamageRequest {
  if (!Number.isFinite(request.amount) || !Number.isFinite(request.knockback)) throw new RangeError("Damage and knockback must be finite");
  const source = request.attack.cause;
  const cause = source.kind === "q2" && source.native !== undefined ? { ...source, native: Object.freeze({ ...source.native }) } : { ...source };
  return Object.freeze({ ...request, attack: Object.freeze({ ...request.attack, time: Object.freeze({ ...request.attack.time }), cause: Object.freeze(cause) }),
    direction: copyVector(request.direction), point: copyVector(request.point), normal: copyVector(request.normal) });
}

function regularArmorEqual(left: RegularArmorState, right: RegularArmorState): boolean {
  switch (left.kind) {
    case "none": return right.kind === "none";
    case "q1": return right.kind === "q1" && left.points === right.points && left.absorption === right.absorption && left.item === right.item;
    case "q2": return right.kind === "q2" && left.points === right.points && left.normalProtection === right.normalProtection && left.energyProtection === right.energyProtection && left.item === right.item;
    case "q3": return right.kind === "q3" && left.points === right.points && left.protection === right.protection;
    case "source": return right.kind === "source" && left.points === right.points && left.item === right.item;
  }
}

function poweredArmorEqual(left: PoweredProtectionState, right: PoweredProtectionState): boolean {
  return left.kind === right.kind && (left.kind === "none" || right.kind !== "none" && left.cells === right.cells);
}

function armorEqual(left: ArmorState, right: ArmorState): boolean {
  return regularArmorEqual(left.regular, right.regular) && poweredArmorEqual(left.powered, right.powered);
}

/** Old power-only views fabricated regular armor using this exact source-owned item. */
export function normalizeLegacyPowerOnlyArmor(legacy: ArmorState, current: ArmorState, placeholder: ItemId): ArmorState {
  const regular = legacy.regular;
  return current.regular.kind === "none" && regular.kind === "q2" && regular.item === placeholder
    && regular.points === 0 && regular.normalProtection === 0 && regular.energyProtection === 0
    && legacy.powered.kind === current.powered.kind && legacy.powered.kind !== "none" && current.powered.kind !== "none"
    && legacy.powered.cells === current.powered.cells ? { ...legacy, regular: { kind: "none" } } : legacy;
}

function captureDecision(proposed: DamageDecision, request: DamageRequest): DamageDecision {
  if (proposed.request !== request) throw new Error("Combat policy replaced attack provenance");
  const mutations = proposed.mutations.map((mutation): DamageMutation => {
    switch (mutation.kind) {
      case "source-velocity": return Object.freeze({ ...mutation, before: copyVector(mutation.before), after: copyVector(mutation.after) });
      case "health": return Object.freeze({ ...mutation });
      case "armor": return Object.freeze({ ...mutation, before: copyArmor(mutation.before), after: copyArmor(mutation.after) });
      case "impulse": return Object.freeze({ ...mutation, impulse: copyVector(mutation.impulse) });
    }
  });
  return Object.freeze({ ...proposed, request, mutations: Object.freeze(mutations) });
}

/** Combat decisions are pure. Their stores commit synchronously before source callbacks may reenter. */
export class GameplayAuthority implements DamageAuthority {
  readonly damageOperation = new ModOperation<DamageRequest, DamageOutcome>("damage");
  private readonly dispatchedDamage = new WeakSet<DamageRequest>();
  private readonly sourceCursors = new Map<OwnedActor, Set<SourceDamageCursor>>();
  private readonly bindings = new Map<OwnedActor, CombatStateBinding>();
  private readonly powerArmorCells = new Map<OwnedActor, PowerArmorCellBinding>();
  private readonly protection = new Map<OwnedActor, ProtectionSlots>();
  private readonly copiedBindings = new WeakSet<CombatStateBinding>();
  private readonly policies = new Map<ProviderId, CombatPolicy>();
  private activeHits = 0;
  private activePickups = 0;

  constructor(private readonly actors: SessionActorRegistry, private readonly callbacks: ActorCallbackTable, private readonly hooks: GameplayHooks) {
    actors.onRelease(actor => {
      const slots = this.protection.get(actor);
      this.protection.delete(actor);
      const errors: unknown[] = [];
      for (const slot of [slots?.regular, slots?.powered]) try { slot?.removeSource?.(); } catch (error) { errors.push(error); }
      this.bindings.delete(actor); this.powerArmorCells.delete(actor);
      if (errors.length !== 0) throw new AggregateError(errors, "Failed to detach actor protection");
      return undefined;
    });
  }

  register(policy: CombatPolicy): () => undefined {
    if (this.policies.has(policy.id)) throw new Error(`Combat policy already registered: ${policy.id}`);
    this.policies.set(policy.id, policy);
    return () => { if (this.policies.get(policy.id) === policy) this.policies.delete(policy.id); return undefined; };
  }

  bind(actor: OwnedActor, binding: CombatStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.bindings.has(actor)) throw new Error("Actor already has a combat binding");
    this.bindings.set(actor, binding);
    return undefined;
  }

  rebind(actor: OwnedActor, binding: CombatStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.protection.has(actor)) throw new Error("Cannot replace a combat binding with a reserved protection owner");
    this.bindings.set(actor, binding);
    return undefined;
  }

  bindDamageAdjustment(actor: OwnedActor, adjustDamage: NonNullable<CombatStateBinding["adjustDamage"]>): undefined {
    const binding = this.binding(actor);
    if (binding.adjustDamage !== undefined) throw new Error("Actor already has source damage adjustment");
    const adjusted = { ...binding, adjustDamage };
    if (this.copiedBindings.has(binding)) this.copiedBindings.add(adjusted);
    this.bindings.set(actor, adjusted);
    return undefined;
  }

  bindDamageAdmission(actor: OwnedActor, admitDamage: NonNullable<CombatStateBinding["admitDamage"]>): undefined {
    const binding = this.binding(actor);
    if (binding.admitDamage !== undefined) throw new Error("Actor already has source damage admission");
    const admitted = { ...binding, admitDamage };
    if (this.copiedBindings.has(binding)) this.copiedBindings.add(admitted);
    this.bindings.set(actor, admitted);
    return undefined;
  }

  /** A player's power armor and energy weapons consume the same source inventory field. */
  bindPowerArmorCells(actor: OwnedActor, cells: PowerArmorCellBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.powerArmorCells.has(actor)) throw new Error("Power armor cells already have an inventory binding");
    if (this.protection.get(actor)?.powered != null) throw new Error("Cannot replace primary power ownership after a component reserved it");
    this.powerArmorCells.set(actor, cells);
    return undefined;
  }

  /** A reservation performs no source reads or initialization. */
  reserveProtection(actor: OwnedActor, channel: "regular", claim: ProtectionClaim): ProtectionReservation<"regular">;
  reserveProtection(actor: OwnedActor, channel: "powered", claim: ProtectionClaim): ProtectionReservation<"powered">;
  reserveProtection(actor: OwnedActor, channel: ProtectionChannel, claim: ProtectionClaim): ProtectionReservation;
  reserveProtection(actor: OwnedActor, channel: ProtectionChannel, claim: ProtectionClaim): ProtectionReservation {
    if (this.activeHits !== 0) throw new Error("Cannot reserve protection during combat execution");
    const primary = this.binding(actor);
    let slots = this.protection.get(actor);
    if (slots?.[channel] != null) throw new Error("Protection channel already has a component owner");
    const declared = primary.protection?.[channel];
    const owner = declared === undefined ? channel === "regular" || this.powerArmorCells.has(actor) ? actor.owner : null : declared.owner;
    if (claim.admission.kind === "claim" ? owner !== null : claim.admission.kind === "replace-primary" && owner !== claim.admission.owner)
      throw new Error("Protection admission does not match primary ownership");
    if (primary.sourceDamage !== undefined && declared?.stage === undefined)
      throw new Error(`Original source combat has no declared ${channel} armor stage`);
    const slot: ProtectionSlot = { claim: Object.freeze({ ...claim, admission: Object.freeze({ ...claim.admission }) }), binding: null, removeSource: null };
    if (slots === undefined) { slots = { regular: null, powered: null }; this.protection.set(actor, slots); }
    slots[channel] = slot;
    const close = (): undefined => {
      const current = this.protection.get(actor);
      if (current?.[channel] !== slot) return undefined;
      const cursor = this.currentCursor(actor);
      if (cursor !== undefined && cursor.reaction === null && !armorEqual(this.readState(actor, primary).armor, cursor.armor))
        throw new Error("Protection closed with an unobserved armor store");
      current[channel] = null;
      if (current.regular === null && current.powered === null) this.protection.delete(actor);
      const remove = slot.removeSource;
      slot.removeSource = null; slot.binding = null;
      try { remove?.(); }
      finally {
        if (cursor !== undefined && this.actors.isLive(actor.id)) {
          const write = { kind: "armor", before: cursor.armor, after: this.readState(actor, primary).armor } satisfies DamageMutation;
          if (cursor.reaction === null) this.observeStore(actor, primary, cursor, write);
          else this.advanceSourceCursors(actor, write);
        }
      }
      return undefined;
    };
    const bind = (original: ProtectionBinding): (() => undefined) => {
      const binding = { ...original, pickups: captureOriginalPickupRules(original.pickups ?? []) };
      if (this.activeHits !== 0) throw new Error("Cannot attach protection during combat execution");
      this.actors.assertOwned(actor);
      if (this.protection.get(actor)?.[channel] !== slot || slot.binding !== null) throw new Error("Protection reservation is closed or bound");
      if (binding.channel !== channel || binding.owner !== claim.owner || binding.rule !== claim.rule || binding.admission.kind !== claim.admission.kind
        || binding.admission.kind === "replace-primary" && (claim.admission.kind !== "replace-primary" || binding.admission.owner !== claim.admission.owner))
        throw new Error("Protection binding differs from its reservation");
      slot.binding = binding;
      try {
        const remove = declared?.stage?.bind((input, original) => {
          if (this.protection.get(actor)?.[channel] !== slot || slot.binding === null) return original();
          return this.absorbProtection(actor, primary, this.cursorFor(actor, input.request), input, binding).saved;
        }) ?? null;
        if (this.protection.get(actor)?.[channel] !== slot) { remove?.(); throw new Error("Protection reservation closed during attachment"); }
        slot.removeSource = remove;
      } catch (error) { close(); throw error; }
      return close;
    };
    return channel === "regular" ? { channel, close, bind } : { channel, close, bind };
  }

  bindProtection(actor: OwnedActor, binding: ProtectionBinding): () => undefined {
    return binding.channel === "regular" ? this.reserveProtection(actor, "regular", binding).bind(binding)
      : this.reserveProtection(actor, "powered", binding).bind(binding);
  }

  protectionOwner(actor: OwnedActor, channel: ProtectionChannel): ProviderId | null {
    this.actors.assertOwned(actor);
    return this.protection.get(actor)?.[channel]?.claim.owner ?? null;
  }

  protectionInventoryItems(actor: OwnedActor, channel: ProtectionChannel): readonly ItemId[] {
    this.actors.assertOwned(actor);
    const slot = this.protection.get(actor)?.[channel];
    if (slot == null) return [];
    if (slot.binding === null) throw new Error("Protection reservation has not been bound");
    return Object.freeze([...slot.binding.inventoryItems]);
  }

  resolvePickup(actor: OwnedActor, offer: OriginalPickupOffer): OriginalPickupResolution {
    this.actors.assertOwned(actor);
    const slots = this.protection.get(actor);
    const matches = [slots?.regular, slots?.powered].flatMap(slot => {
      const binding = slot?.binding;
      if (binding == null) return [];
      return binding.pickups.filter(rule => rule.offered.includes(offer.item)).flatMap(rule => rule.writes
        .filter(write => write.kind === "protection" && write.channel === binding.channel).map(write => ({ owner: binding.owner,
        current: () => this.actors.isLive(actor.id) && this.protection.get(actor)?.[binding.channel] === slot && slot?.binding === binding,
        operation: rule.operation, captured: rule, write })));
    });
    return { matches, blocksPrimary: offer.defaultResource?.kind === "protection" && slots?.[offer.defaultResource.channel] != null };
  }

  /** Original pickup stores can reenter combat; reconcile each committed source store before that happens. */
  withPickupProtection<T>(actor: OwnedActor, owner: ProviderId, operation: (observer: ProtectionObserver) => T): T {
    this.actors.assertOwned(actor);
    const primary = this.bindings.get(actor), slots = this.protection.get(actor);
    const regular = slots?.regular?.binding, powered = slots?.powered?.binding;
    let open = true;
    const failure: { value: { error: unknown } | null } = { value: null };
    const stored: ProtectionObserver["stored"] = change => {
      if (!open) throw new Error("Pickup protection observer is closed");
      this.actors.assertOwned(actor);
      if (this.bindings.get(actor) !== primary) throw new Error("Pickup combat binding changed");
      if (primary === undefined) throw new Error("Inventory-only pickup cannot report protection without a combat binding");
      if (change.regular !== undefined && (regular?.owner !== owner || this.protection.get(actor)?.regular?.binding !== regular)
        || change.powered !== undefined && (powered?.owner !== owner || this.protection.get(actor)?.powered?.binding !== powered))
        throw new Error("Pickup reported protection outside its current owner");
      const after = this.readState(actor, primary).armor;
      if (change.regular !== undefined && !regularArmorEqual(change.regular.after, after.regular)
        || change.powered !== undefined && !poweredArmorEqual(change.powered.after, after.powered))
        throw new Error("Pickup protection report does not match committed source state");
      const cursor = this.currentCursor(actor);
      if (cursor === undefined) return undefined;
      const write = { kind: "armor", before: { regular: change.regular?.before ?? cursor.armor.regular,
        powered: change.powered?.before ?? cursor.armor.powered }, after } satisfies DamageMutation;
      if (cursor.reaction === null) return this.observeStore(actor, primary, cursor, write);
      this.advanceSourceCursors(actor, write);
      return undefined;
    };
    const observer: ProtectionObserver = { stored: change => {
      try { return stored(change); }
      catch (error) { failure.value ??= { error }; throw error; }
    } };
    this.activePickups++;
    try {
      const result = operation(observer), cursor = this.currentCursor(actor);
      if (failure.value !== null) throw failure.value.error;
      if (this.actors.isLive(actor.id)) {
        if (this.bindings.get(actor) !== primary) throw new Error("Pickup combat binding changed");
        if (primary !== undefined && cursor !== undefined && !armorEqual(this.readState(actor, primary).armor, cursor.armor))
          throw new Error("Pickup omitted a committed protection store");
      }
      return result;
    } finally { open = false; this.activePickups--; }
  }

  copiedPrimaryArmor(actor: OwnedActor): ArmorState | null {
    this.actors.assertOwned(actor);
    const binding = this.bindings.get(actor);
    if (binding === undefined || !this.copiedBindings.has(binding)) return null;
    const armor = binding.read().armor, cells = this.powerArmorCells.get(actor);
    return copyArmor(cells === undefined || armor.powered.kind === "none" ? armor : { ...armor, powered: { ...armor.powered, cells: cells.read() } });
  }

  assertIdle(): undefined {
    if (this.activeHits !== 0 || this.activePickups !== 0) throw new Error("Cannot checkpoint during combat or pickup execution");
    return undefined;
  }

  create(actor: OwnedActor, initial: CombatState, admitDamage?: CombatStateBinding["admitDamage"]): undefined {
    if (initial.armor.regular.kind === "source") throw new Error("Copied primary armor cannot own a source formula");
    let state = copyCombat(initial);
    const binding: CombatStateBinding = { ...(admitDamage === undefined ? {} : { admitDamage }), read: () => state,
      writeHealth: health => { state = copyCombat({ ...state, health }); return undefined; },
      writeArmor: armor => { state = copyCombat({ ...state, armor }); return undefined; },
      writeTraits: traits => { state = copyCombat({ ...state, ...traits }); return undefined; } };
    this.copiedBindings.add(binding);
    return this.bind(actor, binding);
  }

  read(actor: ActorId): CombatState | null {
    const owner = this.actors.resolveOwned(actor);
    const binding = owner === null ? undefined : this.bindings.get(owner);
    return binding === undefined || owner === null ? null : this.readState(owner, binding);
  }

  setHealth(actor: OwnedActor, health: number): undefined {
    if (!Number.isFinite(health)) throw new RangeError("Health must be finite");
    const binding = this.binding(actor);
    binding.writeHealth(health);
    return this.observePublicWrite(actor, binding, "health");
  }

  setArmor(actor: OwnedActor, armor: ArmorState): undefined {
    const binding = this.binding(actor);
    this.writeArmor(actor, binding, armor);
    return this.observePublicWrite(actor, binding, "armor");
  }

  normalizeLegacyArmor(actor: OwnedActor, armor: ArmorState): ArmorState {
    return this.binding(actor).normalizeLegacyArmor?.(armor) ?? armor;
  }

  setRegularPoints(actor: OwnedActor, points: number): undefined {
    if (!Number.isFinite(points)) throw new RangeError("Armor points must be finite");
    const binding = this.binding(actor), armor = this.readState(actor, binding).armor;
    if (armor.regular.kind === "none") throw new Error("Armor points require an explicit regular armor selection");
    return this.setArmor(actor, { ...armor, regular: { ...armor.regular, points } });
  }

  setRegularArmor(actor: OwnedActor, regular: RegularArmorState): undefined {
    const binding = this.binding(actor);
    return this.setArmor(actor, { ...this.readState(actor, binding).armor, regular });
  }

  setPoweredProtection(actor: OwnedActor, powered: PoweredProtectionState): undefined {
    const binding = this.binding(actor);
    return this.setArmor(actor, { ...this.readState(actor, binding).armor, powered });
  }


  setTraits(actor: OwnedActor, changes: Partial<CombatTraits>): undefined {
    const binding = this.binding(actor);
    if (binding.writeTraits === undefined) throw new Error("Source combat binding does not expose trait mutation");
    const { canTakeDamage, mass, invulnerable, team, noKnockback } = binding.read();
    const traits = Object.freeze({ canTakeDamage, mass, invulnerable, team, ...(noKnockback === undefined ? {} : { noKnockback }), ...changes });
    if (!Number.isFinite(traits.mass)) throw new RangeError("Actor mass must be finite");
    return binding.writeTraits(traits);
  }

  runSourceDamage(input: DamageRequest, execute: (observer: SourceDamageObserver, request: DamageRequest) => SourceDamageResult): DamageOutcome {
    this.activeHits++;
    try {
      return this.damageOperation.active && !this.dispatchedDamage.has(input)
        ? this.composeDamage(input, request => this.runSourceDamageCanonical(request, execute)) : this.runSourceDamageCanonical(input, execute);
    } finally { this.activeHits--; }
  }

  private runSourceDamageCanonical(input: DamageRequest, execute: (observer: SourceDamageObserver, request: DamageRequest) => SourceDamageResult): DamageOutcome {
    const request = this.dispatchedDamage.has(input) ? input : captureRequest(input), target = this.actors.resolveOwned(request.target);
    if (target === null) return { kind: "stale-target", request };
    const binding = this.binding(target), initial = this.readState(target, binding);
    const cursor = this.openCursor(target, request, initial);
    const decision = (result: SourceDamageResult): DamageDecision => {
      if (!Number.isFinite(result.appliedDamage)) throw new Error("Source applied damage must be finite");
      return captureDecision({ request, mutations: cursor.mutations, appliedDamage: result.appliedDamage, reaction: result.reaction }, request);
    };
    let result: SourceDamageResult;
    try {
      result = execute({
        stored: write => {
          if (write.kind === "armor") {
            const regular = this.protectionBinding(target, "regular"), powered = this.protectionBinding(target, "powered");
            return this.observeStore(target, binding, cursor, { kind: "armor",
              before: { regular: regular === null ? write.before.regular : cursor.armor.regular, powered: powered === null ? write.before.powered : cursor.armor.powered },
              after: { regular: regular === null ? write.after.regular : cursor.armor.regular, powered: powered === null ? write.after.powered : cursor.armor.powered } });
          }
          return this.observeStore(target, binding, cursor, write);
        },
        beforeReaction: value => {
          this.assertCursor(target, cursor);
          if (cursor.reaction !== null) throw new Error("Source damage reaction was already observed");
          const captured = decision(value);
          cursor.reaction = { appliedDamage: captured.appliedDamage, reaction: captured.reaction };
          this.hooks.beforeReaction(target, captured);
          return undefined;
        },
      }, request);
    } finally { this.closeCursor(target, cursor); }
    const completed = decision(result);
    if (cursor.reaction !== null && (cursor.reaction.appliedDamage !== completed.appliedDamage || cursor.reaction.reaction !== completed.reaction)) throw new Error("Source damage result disagrees with its reaction boundary");
    if (cursor.reaction === null) {
      if (completed.reaction !== "none") throw new Error("Source damage omitted its reaction boundary");
      if (this.actors.isLive(target.id)) this.hooks.beforeReaction(target, completed);
    }
    const current = this.read(target.id);
    const outcome: DamageOutcome = Object.freeze({ kind: "committed", decision: completed, survived: current !== null && current.health > 0 });
    this.hooks.confirmed(outcome);
    return outcome;
  }

  /** A source deferred its callback after committing damage in an earlier call. */
  sourceReaction(input: DamageRequest, result: { readonly reaction: "pain" | "death"; readonly appliedDamage: number }): undefined {
    const request = captureRequest(input), target = this.actors.resolveOwned(request.target);
    if (target === null) return undefined;
    if (!Number.isFinite(result.appliedDamage)) throw new Error("Source applied damage must be finite");
    this.hooks.beforeReaction(target, captureDecision({ request, mutations: [], ...result }, request));
    return undefined;
  }

  apply(input: DamageRequest): DamageOutcome {
    this.activeHits++;
    try { return this.damageOperation.active ? this.composeDamage(input, request => this.applyCanonical(request)) : this.applyCanonical(input); }
    finally { this.activeHits--; }
  }

  private composeDamage(input: DamageRequest, canonical: (request: DamageRequest) => DamageOutcome): DamageOutcome {
    return this.damageOperation.dispatch(captureRequest(input), request => {
      const captured = captureRequest(request);
      this.dispatchedDamage.add(captured);
      try { return canonical(captured); } finally { this.dispatchedDamage.delete(captured); }
    });
  }

  private applyCanonical(input: DamageRequest): DamageOutcome {
    let request = this.dispatchedDamage.has(input) ? input : captureRequest(input);
    const target = this.actors.resolveOwned(request.target);
    if (target === null) return { kind: "stale-target", request };
    const binding = this.binding(target);
    if (binding.sourceDamage !== undefined) return binding.sourceDamage(request);
    const policy = this.policies.get(request.attack.combatProvider);
    if (policy === undefined) throw new Error(`Missing combat policy: ${request.attack.combatProvider}`);
    const admission = binding.admitDamage?.(request);
    if (admission === "handled") {
      const decision = captureDecision({ request, mutations: [], appliedDamage: 0, reaction: "none" }, request);
      const current = this.read(target.id);
      const outcome: DamageOutcome = Object.freeze({ kind: "committed", decision, survived: current !== null && current.health > 0 });
      this.hooks.confirmed(outcome);
      return outcome;
    }
    if (!this.actors.isLive(target.id)) return { kind: "stale-target", request };
    const adjustment = binding.adjustDamage?.(request);
    if (!this.actors.isLive(target.id)) return { kind: "stale-target", request };
    if (adjustment != null) request = captureRequest({ ...request, amount: adjustment.amount, knockback: adjustment.knockback });
    const prepared = policy.prepare?.(request, this.readState(target, binding), request.attack.attacker === null ? null : this.read(request.attack.attacker));
    if (!this.actors.isLive(target.id)) return { kind: "stale-target", request };
    if (prepared?.kind === "continue" && !Number.isFinite(prepared.amount)) throw new RangeError("Prepared source damage must be finite");
    const initial = this.readState(target, binding);
    const cursor = this.openCursor(target, request, initial);
    const currentState = { target: () => this.read(target.id), attacker: () => request.attack.attacker === null ? null : this.read(request.attack.attacker) };
    let decision: DamageDecision;
    try {
      let progress: CombatProgress = prepared?.kind === "cancel"
        ? { kind: "complete", request, mutations: [], result: { appliedDamage: 0, reaction: "none" } }
        : policy.decide(request, initial, currentState.attacker(), prepared);
      for (;;) {
        if (progress.request !== request) throw new Error("Combat policy replaced attack provenance");
        const pending = captureDecision({ request, mutations: progress.mutations, appliedDamage: 0, reaction: "none" }, request).mutations;
        const latest = this.read(target.id);
        if (latest === null) {
          if (pending.length !== 0) throw new Error("Combat continuation mutated a removed actor");
          decision = captureDecision({ request, mutations: cursor.mutations, appliedDamage: 0, reaction: "none" }, request);
          break;
        }
        this.commitMutations(target, binding, latest, pending);
        if (progress.kind === "complete") {
          if (!Number.isFinite(progress.result.appliedDamage)) throw new Error("Combat applied damage must be finite");
          decision = captureDecision({ request, mutations: cursor.mutations, ...progress.result }, request);
          break;
        }
        if (!this.actors.isLive(target.id)) {
          decision = captureDecision({ request, mutations: cursor.mutations, appliedDamage: 0, reaction: "none" }, request);
          break;
        }
        if (progress.kind === "source-continuation") { progress = progress.resume(currentState); continue; }
        if (progress.input.request !== request || !Number.isFinite(progress.input.amount)) throw new Error("Invalid armor stage input");
        const component = this.protectionBinding(target, progress.channel);
        let result: ArmorStageResult;
        if (component !== null) result = this.absorbProtection(target, binding, cursor, progress.input, component);
        else {
          const state = this.readState(target, binding), absorbed = progress.fallback(state.armor);
          const saved = progress.channel === "regular" ? absorbed.regularSaved : absorbed.powerSaved;
          const otherUnchanged = progress.channel === "regular"
            ? absorbed.powerSaved === 0 && armorEqual({ ...absorbed.armor, regular: state.armor.regular }, state.armor)
            : absorbed.regularSaved === 0 && regularArmorEqual(absorbed.armor.regular, state.armor.regular);
          if (!otherUnchanged || !Number.isFinite(saved)) throw new Error("Armor fallback changed another channel or returned invalid savings");
          if (!armorEqual(absorbed.armor, state.armor)) {
            const write: DamageMutation = { kind: "armor", before: state.armor, after: absorbed.armor };
            this.commitMutations(target, binding, state, [write]);
          }
          result = { saved };
        }
        if (!this.actors.isLive(target.id)) {
          decision = captureDecision({ request, mutations: cursor.mutations, appliedDamage: 0, reaction: "none" }, request);
          break;
        }
        progress = progress.resume(result, currentState);
      }
      if (policy.afterHealth !== undefined && decision.mutations.some(mutation => mutation.kind === "health") && this.actors.isLive(target.id)) {
        const reaction = policy.afterHealth(decision, currentState);
        decision = captureDecision({ ...decision, reaction }, request);
      }
      if (this.actors.isLive(target.id)) this.hooks.beforeReaction(target, decision);
      if (this.actors.isLive(target.id)) {
        const kick = decision.feedback?.kind === "q2" ? decision.feedback.knockback : request.knockback;
        const reaction = { attack: request.attack, self: target, attacker: request.attack.attacker, kick, damage: decision.appliedDamage };
        if (decision.reaction === "death") this.callbacks.die({ ...reaction, inflictor: request.attack.inflictor, point: request.point });
        else if (decision.reaction === "pain") this.callbacks.pain(reaction);
      }
    } finally { this.closeCursor(target, cursor); }
    const current = this.read(target.id);
    const outcome: DamageOutcome = Object.freeze({ kind: "committed", decision, survived: current !== null && current.health > 0 });
    this.hooks.confirmed(outcome);
    return outcome;
  }

  private binding(actor: OwnedActor): CombatStateBinding {
    this.actors.assertOwned(actor);
    const binding = this.bindings.get(actor);
    if (binding === undefined) throw new Error("Actor has no combat binding");
    return binding;
  }

  private protectionBinding(actor: OwnedActor, channel: "regular"): ProtectionBinding<"regular"> | null;
  private protectionBinding(actor: OwnedActor, channel: "powered"): ProtectionBinding<"powered"> | null;
  private protectionBinding(actor: OwnedActor, channel: ProtectionChannel): ProtectionBinding | null;
  private protectionBinding(actor: OwnedActor, channel: ProtectionChannel): ProtectionBinding | null {
    return this.protection.get(actor)?.[channel]?.binding ?? null;
  }

  private readState(actor: OwnedActor, binding: CombatStateBinding): CombatState {
    const state = binding.read(), regular = this.protectionBinding(actor, "regular"), power = this.protectionBinding(actor, "powered");
    const cells = this.powerArmorCells.get(actor);
    const powered = power !== null ? power.read() : cells === undefined || state.armor.powered.kind === "none"
      ? state.armor.powered : { ...state.armor.powered, cells: cells.read() };
    return copyCombat({ ...state, armor: { regular: regular?.read() ?? state.armor.regular, powered } });
  }

  private writeArmor(actor: OwnedActor, binding: CombatStateBinding, armor: ArmorState): undefined {
    const regular = this.protectionBinding(actor, "regular"), power = this.protectionBinding(actor, "powered");
    const primary = copyArmor(binding.read().armor), effective = this.readState(actor, binding).armor;
    const writesRegular = !regularArmorEqual(effective.regular, armor.regular);
    const writesPower = !poweredArmorEqual(effective.powered, armor.powered);
    const original = { regular: regular === null ? armor.regular : primary.regular, powered: power === null ? armor.powered : primary.powered };
    if (this.copiedBindings.has(binding) && original.regular.kind === "source") throw new Error("Copied primary armor cannot own a source formula");
    binding.validateArmor?.(original);
    regular?.validateWrite(armor.regular); power?.validateWrite(armor.powered);
    const ownership = (): void => {
      this.actors.assertOwned(actor);
      if (this.bindings.get(actor) !== binding || this.protectionBinding(actor, "regular") !== regular || this.protectionBinding(actor, "powered") !== power)
        throw new Error("Armor ownership changed during a protection write");
    };
    if (regular !== null && writesRegular) { regular.write(armor.regular); ownership(); }
    if (writesPower && !poweredArmorEqual(this.readState(actor, binding).armor.powered, effective.powered))
      throw new Error("Powered armor changed during a regular write");
    if (power !== null && writesPower) { power.write(armor.powered); ownership(); }
    if (power === null && writesPower) {
      const cells = this.powerArmorCells.get(actor);
      if (cells !== undefined && armor.powered.kind !== "none" && cells.read() !== armor.powered.cells) { cells.write(armor.powered.cells); ownership(); }
    }
    ownership();
    const latest = binding.read().armor;
    if (regular === null && writesRegular && !regularArmorEqual(primary.regular, latest.regular))
      throw new Error("Primary regular armor changed during a protection write");
    const updated = { regular: regular === null && writesRegular ? armor.regular : latest.regular,
      powered: power === null && writesPower ? armor.powered : latest.powered };
    binding.validateArmor?.(updated);
    if (!armorEqual(latest, updated)) binding.writeArmor(copyArmor(updated));
    return undefined;
  }

  private currentCursor(target: OwnedActor): SourceDamageCursor | undefined {
    const cursors = this.sourceCursors.get(target);
    if (cursors === undefined) return undefined;
    let current: SourceDamageCursor | undefined;
    for (const cursor of cursors) current = cursor;
    return current;
  }

  private observePublicWrite(target: OwnedActor, binding: CombatStateBinding, kind: "health" | "armor"): undefined {
    const cursor = this.currentCursor(target);
    if (cursor === undefined || !this.actors.isLive(target.id)) return undefined;
    const write = kind === "health" ? { kind, before: cursor.health, after: binding.read().health }
      : { kind, before: cursor.armor, after: this.readState(target, binding).armor };
    if (write.kind === "health" ? write.before === write.after : armorEqual(write.before, write.after)) return undefined;
    if (cursor.reaction === null) return this.observeStore(target, binding, cursor, write);
    this.advanceSourceCursors(target, write);
    return undefined;
  }

  private openCursor(target: OwnedActor, request: DamageRequest, initial: CombatState): SourceDamageCursor {
    if (this.currentCursor(target) !== undefined) {
      const binding = this.binding(target);
      this.observePublicWrite(target, binding, "health");
      this.observePublicWrite(target, binding, "armor");
    }
    const cursor: SourceDamageCursor = { request, mutations: [], health: initial.health, armor: initial.armor, velocity: null, active: true, reaction: null };
    let cursors = this.sourceCursors.get(target);
    if (cursors === undefined) { cursors = new Set(); this.sourceCursors.set(target, cursors); }
    cursors.add(cursor);
    return cursor;
  }

  private closeCursor(target: OwnedActor, cursor: SourceDamageCursor): void {
    cursor.active = false;
    const cursors = this.sourceCursors.get(target);
    cursors?.delete(cursor);
    if (cursors?.size === 0) this.sourceCursors.delete(target);
  }

  private assertCursor(target: OwnedActor, cursor: SourceDamageCursor): void {
    if (!cursor.active) throw new Error("Source damage observer is closed");
    this.actors.assertOwned(target);
  }

  private cursorFor(target: OwnedActor, request: DamageRequest): SourceDamageCursor {
    let found: SourceDamageCursor | null = null;
    for (const cursor of this.sourceCursors.get(target) ?? []) if (cursor.request === request && cursor.active) found = cursor;
    if (found === null) throw new Error("Original armor stage has no active damage observation");
    return found;
  }

  private observeStore(target: OwnedActor, binding: CombatStateBinding, cursor: SourceDamageCursor, write: Exclude<DamageMutation, { readonly kind: "impulse" }>): undefined {
    this.assertCursor(target, cursor);
    if (cursor.reaction !== null) throw new Error("Source damage store follows its reaction boundary");
    switch (write.kind) {
      case "health":
        if (write.before !== cursor.health || !Number.isFinite(write.after) || binding.read().health !== write.after) throw new Error("Invalid observed source health store");
        break;
      case "armor":
        if (!armorEqual(write.before, cursor.armor) || !armorEqual(this.readState(target, binding).armor, write.after)) throw new Error("Invalid observed source armor store");
        if (armorEqual(write.before, write.after)) return undefined;
        break;
      case "source-velocity":
        if (![write.before.x, write.before.y, write.before.z, write.after.x, write.after.y, write.after.z].every(Number.isFinite)
          || cursor.velocity !== null && (cursor.velocity.x !== write.before.x || cursor.velocity.y !== write.before.y || cursor.velocity.z !== write.before.z)) throw new Error("Invalid observed source velocity store");
        break;
    }
    this.advanceSourceCursors(target, write);
    const captured = captureDecision({ request: cursor.request, mutations: [write], appliedDamage: 0, reaction: "none" }, cursor.request).mutations[0];
    if (captured === undefined) throw new Error("Missing source damage store");
    cursor.mutations.push(captured);
    return undefined;
  }

  private absorbProtection(target: OwnedActor, binding: CombatStateBinding, cursor: SourceDamageCursor, input: ArmorStageInput, protection: ProtectionBinding): ArmorStageResult {
    this.assertCursor(target, cursor);
    if (input.request !== cursor.request || !Number.isFinite(input.amount)) throw new Error("Invalid armor stage input");
    const { direction, point, normal } = input.geometry;
    if (![direction.x, direction.y, direction.z, point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite))
      throw new Error("Armor stage geometry must be finite");
    if (input.amount <= 0 || input.flags.noArmor || (protection.channel === "powered" ? input.flags.noPowerArmor : input.flags.noRegularArmor)) return { saved: 0 };
    let open = true;
    const observer: ProtectionObserver = { stored: change => {
      if (!open) throw new Error("Armor observer is closed");
      if (this.protectionBinding(target, protection.channel) !== protection) throw new Error("Armor owner was removed");
      if (change.regular !== undefined && this.protectionBinding(target, "regular")?.owner !== protection.owner
        || change.powered !== undefined && this.protectionBinding(target, "powered")?.owner !== protection.owner)
        throw new Error("Component reported protection owned by another provider");
      return this.observeStore(target, binding, cursor, { kind: "armor",
        before: { regular: change.regular?.before ?? cursor.armor.regular, powered: change.powered?.before ?? cursor.armor.powered },
        after: { regular: change.regular?.after ?? cursor.armor.regular, powered: change.powered?.after ?? cursor.armor.powered } });
    } };
    try {
      const captured = Object.freeze({ ...input, flags: Object.freeze({ ...input.flags }),
        geometry: Object.freeze({ direction: copyVector(direction), point: copyVector(point), normal: copyVector(normal) }) });
      const result = protection.absorb(captured, observer);
      if (!Number.isFinite(result.saved) || result.saved < 0 || result.saved > input.amount) throw new Error("Armor savings must be within the current damage amount");
      if (this.actors.isLive(target.id)) {
        const current = this.readState(target, binding);
        if (!armorEqual(current.armor, cursor.armor)) throw new Error("Armor stage omitted a committed armor observation");
        if (current.health !== cursor.health) throw new Error("Armor stage changed health without damage observation");
      }
      return { saved: result.saved };
    } finally { open = false; }
  }

  private advanceSourceCursors(target: OwnedActor, mutation: DamageMutation): void {
    const cursors = this.sourceCursors.get(target);
    if (cursors === undefined) return;
    for (const cursor of cursors) {
      switch (mutation.kind) {
        case "health": cursor.health = mutation.after; break;
        case "armor": cursor.armor = copyArmor(mutation.after); break;
        case "source-velocity": cursor.velocity = copyVector(mutation.after); break;
        case "impulse": cursor.velocity = null; break;
      }
    }
  }

  private commitMutations(target: OwnedActor, binding: CombatStateBinding, initial: CombatState, mutations: readonly DamageMutation[]): undefined {
    this.validateMutations(initial, mutations);
    for (const mutation of mutations) {
      this.actors.assertOwned(target);
      switch (mutation.kind) {
        case "source-velocity": throw new Error("Observed source velocity cannot be replayed by a combat policy");
        case "health":
          if (binding.read().health !== mutation.before) throw new Error("Combat health changed before its decision committed");
          binding.writeHealth(mutation.after);
          this.observePublicWrite(target, binding, "health");
          break;
        case "armor":
          if (!armorEqual(this.readState(target, binding).armor, mutation.before)) throw new Error("Combat armor changed before its decision committed");
          this.writeArmor(target, binding, mutation.after);
          this.observePublicWrite(target, binding, "armor");
          break;
        case "impulse": {
          const cursor = this.currentCursor(target);
          this.hooks.impulse(target, mutation.impulse, mutation.movementProvider);
          this.advanceSourceCursors(target, mutation);
          cursor?.mutations.push(mutation);
          break;
        }
      }
    }
    return undefined;
  }

  private validateMutations(initial: CombatState, mutations: readonly DamageMutation[]): undefined {
    if (mutations.some(mutation => mutation.kind === "source-velocity")) throw new Error("Observed source velocity cannot be replayed by a combat policy");
    let health = initial.health;
    let armor = initial.armor;
    for (const mutation of mutations) {
      if (mutation.kind === "health") {
        if (mutation.before !== health || !Number.isFinite(mutation.after)) throw new Error("Invalid ordered health mutation");
        health = mutation.after;
      } else if (mutation.kind === "armor") {
        if (!armorEqual(mutation.before, armor)) throw new Error("Invalid ordered armor mutation");
        armor = mutation.after;
      }
    }
    return undefined;
  }
}
