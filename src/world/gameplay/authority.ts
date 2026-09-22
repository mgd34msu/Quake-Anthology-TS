import type { ArmorStageInput, ArmorStageObserver, ArmorStageResult, ArmorState, RegularArmorState, PoweredProtectionState, CombatPolicy, CombatProgress, CombatState, DamageAuthority, DamageDecision, DamageMutation, DamageOutcome, DamageRequest, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorCallbackTable } from "../actors/callbacks.ts";
import { copyVector } from "../actors/body.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import { ModOperation } from "./mod-composition.ts";

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

export type PoweredProtectionAdmission = { readonly kind: "claim" } | { readonly kind: "replace-primary"; readonly owner: ProviderId };
export interface PoweredProtectionClaim {
  readonly owner: ProviderId;
  readonly rule: string;
  readonly admission: PoweredProtectionAdmission;
}
export interface PoweredProtectionBinding extends PoweredProtectionClaim {
  readonly fuelItems: readonly ItemId[];
  read(): PoweredProtectionState;
  validateWrite(next: PoweredProtectionState): undefined;
  write(next: PoweredProtectionState): undefined;
  absorb(input: ArmorStageInput, observer: ArmorStageObserver): ArmorStageResult;
}
export interface SourcePoweredArmorStage {
  bind(intercept: (input: ArmorStageInput, original: () => number) => number): () => undefined;
}
export interface PoweredProtectionReservation {
  bind(binding: PoweredProtectionBinding): () => undefined;
  close(): undefined;
}
interface PowerSlot { readonly claim: PoweredProtectionClaim; binding: PoweredProtectionBinding | null; removeSource: (() => undefined) | null; }

export interface CombatStateBinding {
  sourceDamage?(request: DamageRequest): DamageOutcome;
  readonly poweredProtectionOwner?: ProviderId;
  readonly poweredArmorStage?: SourcePoweredArmorStage;
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
  }
}

function armorEqual(left: ArmorState, right: ArmorState): boolean {
  return regularArmorEqual(left.regular, right.regular) && left.powered.kind === right.powered.kind
    && (left.powered.kind === "none" || right.powered.kind !== "none" && left.powered.cells === right.powered.cells);
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
  private readonly poweredProtection = new Map<OwnedActor, PowerSlot>();
  private readonly policies = new Map<ProviderId, CombatPolicy>();
  private activeHits = 0;

  constructor(private readonly actors: SessionActorRegistry, private readonly callbacks: ActorCallbackTable, private readonly hooks: GameplayHooks) {
    actors.onRelease(actor => {
      const power = this.poweredProtection.get(actor);
      this.poweredProtection.delete(actor); power?.removeSource?.();
      this.bindings.delete(actor); this.powerArmorCells.delete(actor); return undefined;
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
    if (this.poweredProtection.has(actor)) throw new Error("Cannot replace a combat binding with a reserved powered owner");
    this.bindings.set(actor, binding);
    return undefined;
  }

  bindDamageAdjustment(actor: OwnedActor, adjustDamage: NonNullable<CombatStateBinding["adjustDamage"]>): undefined {
    const binding = this.binding(actor);
    if (binding.adjustDamage !== undefined) throw new Error("Actor already has source damage adjustment");
    this.bindings.set(actor, { ...binding, adjustDamage });
    return undefined;
  }

  bindDamageAdmission(actor: OwnedActor, admitDamage: NonNullable<CombatStateBinding["admitDamage"]>): undefined {
    const binding = this.binding(actor);
    if (binding.admitDamage !== undefined) throw new Error("Actor already has source damage admission");
    this.bindings.set(actor, { ...binding, admitDamage });
    return undefined;
  }

  /** A player's power armor and energy weapons consume the same source inventory field. */
  bindPowerArmorCells(actor: OwnedActor, cells: PowerArmorCellBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.powerArmorCells.has(actor)) throw new Error("Power armor cells already have an inventory binding");
    if (this.poweredProtection.has(actor)) throw new Error("Cannot replace primary power ownership after a component reserved it");
    this.powerArmorCells.set(actor, cells);
    return undefined;
  }

  /** A reservation performs no source reads or initialization. */
  reservePoweredProtection(actor: OwnedActor, claim: PoweredProtectionClaim): PoweredProtectionReservation {
    const primary = this.binding(actor);
    if (this.poweredProtection.has(actor)) throw new Error("Powered protection already has a component owner");
    const owner = primary.poweredProtectionOwner ?? (this.powerArmorCells.has(actor) ? actor.owner : null);
    if (claim.admission.kind === "claim" ? owner !== null : owner !== claim.admission.owner)
      throw new Error("Powered protection admission does not match primary ownership");
    if (primary.sourceDamage !== undefined && primary.poweredArmorStage === undefined)
      throw new Error("Original source combat has no declared powered armor stage");
    const slot: PowerSlot = { claim: Object.freeze({ ...claim, admission: Object.freeze({ ...claim.admission }) }), binding: null, removeSource: null };
    this.poweredProtection.set(actor, slot);
    const close = (): undefined => {
      if (this.poweredProtection.get(actor) !== slot) return undefined;
      const cursor = this.currentCursor(actor);
      if (cursor !== undefined && cursor.reaction === null && !armorEqual(this.readState(actor, primary).armor, cursor.armor))
        throw new Error("Powered protection closed with an unobserved armor store");
      this.poweredProtection.delete(actor); slot.removeSource?.(); slot.removeSource = null; slot.binding = null;
      if (cursor !== undefined && this.actors.isLive(actor.id)) {
        const write = { kind: "armor", before: cursor.armor, after: this.readState(actor, primary).armor } satisfies DamageMutation;
        if (cursor.reaction === null) this.observeStore(actor, primary, cursor, write);
        else this.advanceSourceCursors(actor, write);
      }
      return undefined;
    };
    return { close, bind: binding => {
      this.actors.assertOwned(actor);
      if (this.poweredProtection.get(actor) !== slot || slot.binding !== null) throw new Error("Powered protection reservation is closed or bound");
      if (binding.owner !== claim.owner || binding.rule !== claim.rule || binding.admission.kind !== claim.admission.kind
        || binding.admission.kind === "replace-primary" && (claim.admission.kind !== "replace-primary" || binding.admission.owner !== claim.admission.owner))
        throw new Error("Powered protection binding differs from its reservation");
      slot.binding = binding;
      try {
        slot.removeSource = primary.poweredArmorStage?.bind((input, original) => {
          if (this.poweredProtection.get(actor) !== slot || slot.binding === null) return original();
          const cursor = this.cursorFor(actor, input.request);
          return this.absorbPowered(actor, primary, cursor, input, binding).saved;
        }) ?? null;
      } catch (error) { close(); throw error; }
      return close;
    } };
  }

  bindPoweredProtection(actor: OwnedActor, binding: PoweredProtectionBinding): () => undefined {
    return this.reservePoweredProtection(actor, binding).bind(binding);
  }

  poweredProtectionOwner(actor: OwnedActor): ProviderId | null {
    this.actors.assertOwned(actor);
    return this.poweredProtection.get(actor)?.claim.owner ?? null;
  }

  poweredProtectionFuelItems(actor: OwnedActor): readonly ItemId[] {
    this.actors.assertOwned(actor);
    const slot = this.poweredProtection.get(actor);
    if (slot === undefined) return [];
    if (slot.binding === null) throw new Error("Powered protection reservation has not been bound");
    return Object.freeze([...slot.binding.fuelItems]);
  }

  assertIdle(): undefined {
    if (this.activeHits !== 0) throw new Error("Cannot checkpoint during combat execution");
    return undefined;
  }

  create(actor: OwnedActor, initial: CombatState, admitDamage?: CombatStateBinding["admitDamage"]): undefined {
    let state = copyCombat(initial);
    return this.bind(actor, { ...(admitDamage === undefined ? {} : { admitDamage }), read: () => state,
      writeHealth: health => { state = copyCombat({ ...state, health }); return undefined; },
      writeArmor: armor => { state = copyCombat({ ...state, armor }); return undefined; },
      writeTraits: traits => { state = copyCombat({ ...state, ...traits }); return undefined; } });
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
          // A primary source observes its regular storage; the independent power owner
          // reports its own stores through the same hit cursor.
          if (write.kind === "armor" && this.poweredProtection.get(target)?.binding != null) {
            const powered = cursor.armor.powered;
            return this.observeStore(target, binding, cursor, { kind: "armor",
              before: { regular: write.before.regular, powered }, after: { regular: write.after.regular, powered } });
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
        cursor.mutations.push(...pending);
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
        if (progress.input.request !== request || !Number.isFinite(progress.input.amount)) throw new Error("Invalid powered armor stage input");
        const power = this.poweredProtection.get(target)?.binding;
        let result: ArmorStageResult;
        if (power != null) result = this.absorbPowered(target, binding, cursor, progress.input, power);
        else {
          const state = this.readState(target, binding), absorbed = progress.fallback(state.armor);
          if (absorbed.regularSaved !== 0 || !regularArmorEqual(absorbed.armor.regular, state.armor.regular) || !Number.isFinite(absorbed.powerSaved))
            throw new Error("Powered armor fallback changed regular armor or returned invalid savings");
          if (!armorEqual(absorbed.armor, state.armor)) {
            const write: DamageMutation = { kind: "armor", before: state.armor, after: absorbed.armor };
            this.commitMutations(target, binding, state, [write]);
            cursor.mutations.push(captureDecision({ request, mutations: [write], appliedDamage: 0, reaction: "none" }, request).mutations[0] ?? write);
          }
          result = { saved: absorbed.powerSaved };
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

  private readState(actor: OwnedActor, binding: CombatStateBinding): CombatState {
    const state = binding.read(), power = this.poweredProtection.get(actor)?.binding;
    if (power != null) return copyCombat({ ...state, armor: { ...state.armor, powered: power.read() } });
    const cells = this.powerArmorCells.get(actor);
    if (cells === undefined || state.armor.powered.kind === "none") return copyCombat(state);
    return copyCombat({ ...state, armor: { ...state.armor, powered: { ...state.armor.powered, cells: cells.read() } } });
  }

  private writeArmor(actor: OwnedActor, binding: CombatStateBinding, armor: ArmorState): undefined {
    const power = this.poweredProtection.get(actor)?.binding;
    const primary = copyArmor(binding.read().armor);
    const writesRegular = !regularArmorEqual(primary.regular, armor.regular);
    const original = power == null ? armor : { regular: armor.regular, powered: primary.powered };
    binding.validateArmor?.(original);
    power?.validateWrite(armor.powered);
    if (power != null) {
      if (!armorEqual({ regular: armor.regular, powered: power.read() }, armor)) power.write(armor.powered);
    } else {
      const cells = this.powerArmorCells.get(actor);
      if (cells !== undefined && armor.powered.kind !== "none" && cells.read() !== armor.powered.cells) cells.write(armor.powered.cells);
    }
    this.actors.assertOwned(actor);
    if (this.bindings.get(actor) !== binding || this.poweredProtection.get(actor)?.binding !== power)
      throw new Error("Armor ownership changed during a powered write");
    const latest = binding.read().armor;
    if (writesRegular && !regularArmorEqual(primary.regular, latest.regular)) throw new Error("Primary regular armor changed during a powered write");
    const updated = { regular: writesRegular ? armor.regular : latest.regular, powered: power == null ? armor.powered : latest.powered };
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
    if (found === null) throw new Error("Original powered armor stage has no active damage observation");
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

  private absorbPowered(target: OwnedActor, binding: CombatStateBinding, cursor: SourceDamageCursor, input: ArmorStageInput, power: PoweredProtectionBinding): ArmorStageResult {
    this.assertCursor(target, cursor);
    if (input.request !== cursor.request || !Number.isFinite(input.amount)) throw new Error("Invalid powered armor stage input");
    const { direction, point, normal } = input.geometry;
    if (![direction.x, direction.y, direction.z, point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite))
      throw new Error("Powered armor stage geometry must be finite");
    if (input.amount <= 0 || input.flags.noArmor || input.flags.noPowerArmor || power.read().kind === "none") return { saved: 0 };
    let open = true;
    try {
      const result = power.absorb(Object.freeze({ ...input, flags: Object.freeze({ ...input.flags }),
        geometry: Object.freeze({ direction: copyVector(direction), point: copyVector(point), normal: copyVector(normal) }) }), {
        stored: change => {
          if (!open) throw new Error("Powered armor observer is closed");
          if (this.poweredProtection.get(target)?.binding !== power) throw new Error("Powered armor owner was removed");
          return this.observeStore(target, binding, cursor, { kind: "armor", before: { regular: cursor.armor.regular, powered: change.before },
            after: { regular: cursor.armor.regular, powered: change.after } });
        },
      });
      if (!Number.isFinite(result.saved) || result.saved < 0 || result.saved > input.amount) throw new Error("Powered armor savings must be within the current damage amount");
      if (this.actors.isLive(target.id)) {
        const current = this.readState(target, binding);
        if (!armorEqual(current.armor, cursor.armor)) throw new Error("Powered armor stage omitted a committed armor observation");
        if (current.health !== cursor.health) throw new Error("Powered armor stage changed health without damage observation");
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
          break;
        case "armor":
          if (!armorEqual(this.readState(target, binding).armor, mutation.before)) throw new Error("Combat armor changed before its decision committed");
          this.writeArmor(target, binding, mutation.after);
          break;
        case "impulse": this.hooks.impulse(target, mutation.impulse, mutation.movementProvider); break;
      }
      this.advanceSourceCursors(target, mutation);
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
