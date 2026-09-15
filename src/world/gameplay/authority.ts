import type { ArmorState, CombatPolicy, CombatState, DamageAuthority, DamageDecision, DamageMutation, DamageOutcome, DamageRequest } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorCallbackTable } from "../actors/callbacks.ts";
import { copyVector } from "../actors/body.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";

export type CombatTraits = Pick<CombatState, "canTakeDamage" | "mass" | "invulnerable" | "team" | "noKnockback">;
export interface PowerArmorCellBinding { read(): number; write(count: number): undefined; }
export type SourceDamageResult = Pick<DamageDecision, "appliedDamage" | "reaction">;
export interface SourceDamageObserver {
  stored(write: Exclude<DamageMutation, { readonly kind: "impulse" }>): undefined;
  beforeReaction(result: SourceDamageResult): undefined;
}

export interface CombatStateBinding {
  admitDamage?(request: DamageRequest): "continue" | "handled";
  adjustDamage?(request: DamageRequest): Pick<DamageRequest, "amount" | "knockback"> | null;
  read(): CombatState;
  writeHealth(health: number): undefined;
  writeArmor(armor: ArmorState): undefined;
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
  return armor.kind === "q2" ? Object.freeze({ ...armor, powerArmor: Object.freeze({ ...armor.powerArmor }) }) : Object.freeze({ ...armor });
}

export function copyCombat(state: CombatState): CombatState { return Object.freeze({ ...state, armor: copyArmor(state.armor) }); }

export function captureRequest(request: DamageRequest): DamageRequest {
  if (!Number.isFinite(request.amount) || !Number.isFinite(request.knockback)) throw new RangeError("Damage and knockback must be finite");
  const source = request.attack.cause;
  const cause = source.kind === "q2" && source.native !== undefined ? { ...source, native: Object.freeze({ ...source.native }) } : { ...source };
  return Object.freeze({ ...request, attack: Object.freeze({ ...request.attack, time: Object.freeze({ ...request.attack.time }), cause: Object.freeze(cause) }),
    direction: copyVector(request.direction), point: copyVector(request.point), normal: copyVector(request.normal) });
}

function armorEqual(left: ArmorState, right: ArmorState): boolean {
  switch (left.kind) {
    case "none": return right.kind === "none";
    case "q1": return right.kind === "q1" && left.points === right.points && left.absorption === right.absorption && left.item === right.item;
    case "q2": return right.kind === "q2" && left.points === right.points && left.normalProtection === right.normalProtection && left.energyProtection === right.energyProtection && left.item === right.item &&
      left.powerArmor.kind === right.powerArmor.kind && (left.powerArmor.kind === "none" || (right.powerArmor.kind !== "none" && left.powerArmor.cells === right.powerArmor.cells));
    case "q3": return right.kind === "q3" && left.points === right.points && left.protection === right.protection;
  }
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
  return Object.freeze({ ...proposed, request, mutations: Object.freeze(mutations), ...(proposed.continuation === undefined ? {} : { continuation: Object.freeze({ ...proposed.continuation }) }) });
}

/** Combat decisions are pure. Their stores commit synchronously before source callbacks may reenter. */
export class GameplayAuthority implements DamageAuthority {
  private readonly bindings = new Map<OwnedActor, CombatStateBinding>();
  private readonly powerArmorCells = new Map<OwnedActor, PowerArmorCellBinding>();
  private readonly policies = new Map<ProviderId, CombatPolicy>();

  constructor(private readonly actors: SessionActorRegistry, private readonly callbacks: ActorCallbackTable, private readonly hooks: GameplayHooks) {
    actors.onRelease(actor => { this.bindings.delete(actor); this.powerArmorCells.delete(actor); return undefined; });
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
    this.powerArmorCells.set(actor, cells);
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
    return this.binding(actor).writeHealth(health);
  }

  setArmor(actor: OwnedActor, armor: ArmorState): undefined { return this.writeArmor(actor, this.binding(actor), armor); }

  setTraits(actor: OwnedActor, changes: Partial<CombatTraits>): undefined {
    const binding = this.binding(actor);
    if (binding.writeTraits === undefined) throw new Error("Source combat binding does not expose trait mutation");
    const { canTakeDamage, mass, invulnerable, team, noKnockback } = binding.read();
    const traits = Object.freeze({ canTakeDamage, mass, invulnerable, team, ...(noKnockback === undefined ? {} : { noKnockback }), ...changes });
    if (!Number.isFinite(traits.mass)) throw new RangeError("Actor mass must be finite");
    return binding.writeTraits(traits);
  }

  runSourceDamage(input: DamageRequest, execute: (observer: SourceDamageObserver) => SourceDamageResult): DamageOutcome {
    const request = captureRequest(input), target = this.actors.resolveOwned(request.target);
    if (target === null) return { kind: "stale-target", request };
    const binding = this.binding(target), initial = this.readState(target, binding);
    const mutations: DamageMutation[] = [];
    let health = initial.health, armor = initial.armor, velocity: Vec3 | null = null;
    let active = true;
    const observed: { reaction: SourceDamageResult | null } = { reaction: null };
    const assertActive = (): void => { if (!active) throw new Error("Source damage observer is closed"); };
    const decision = (result: SourceDamageResult): DamageDecision => {
      if (!Number.isFinite(result.appliedDamage)) throw new Error("Source applied damage must be finite");
      return captureDecision({ request, mutations, appliedDamage: result.appliedDamage, reaction: result.reaction }, request);
    };
    let result: SourceDamageResult;
    try {
      result = execute({
        stored: write => {
          assertActive(); this.actors.assertOwned(target);
          if (observed.reaction !== null) throw new Error("Source damage store follows its reaction boundary");
          switch (write.kind) {
            case "health":
              if (write.before !== health || !Number.isFinite(write.after) || binding.read().health !== write.after) throw new Error("Invalid observed source health store");
              health = write.after; break;
            case "armor":
              if (!armorEqual(write.before, armor) || !armorEqual(this.readState(target, binding).armor, write.after)) throw new Error("Invalid observed source armor store");
              armor = copyArmor(write.after); break;
            case "source-velocity":
              if (![write.before.x, write.before.y, write.before.z, write.after.x, write.after.y, write.after.z].every(Number.isFinite)
                || velocity !== null && (velocity.x !== write.before.x || velocity.y !== write.before.y || velocity.z !== write.before.z)) throw new Error("Invalid observed source velocity store");
              velocity = copyVector(write.after); break;
          }
          const captured = captureDecision({ request, mutations: [write], appliedDamage: 0, reaction: "none" }, request).mutations[0];
          if (captured === undefined) throw new Error("Missing source damage store");
          mutations.push(captured);
          return undefined;
        },
        beforeReaction: value => {
          assertActive(); this.actors.assertOwned(target);
          if (observed.reaction !== null) throw new Error("Source damage reaction was already observed");
          const captured = decision(value);
          observed.reaction = { appliedDamage: captured.appliedDamage, reaction: captured.reaction };
          this.hooks.beforeReaction(target, captured);
          return undefined;
        },
      });
    } finally { active = false; }
    const completed = decision(result);
    if (observed.reaction !== null && (observed.reaction.appliedDamage !== completed.appliedDamage || observed.reaction.reaction !== completed.reaction)) throw new Error("Source damage result disagrees with its reaction boundary");
    if (observed.reaction === null) {
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
    let request = captureRequest(input);
    const target = this.actors.resolveOwned(request.target);
    if (target === null) return { kind: "stale-target", request };
    const binding = this.binding(target);
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
    const proposed: DamageDecision = prepared?.kind === "cancel" ? { request, mutations: [], appliedDamage: 0, reaction: "none" }
      : policy.decide(request, initial, request.attack.attacker === null ? null : this.read(request.attack.attacker), prepared);
    let decision = captureDecision(proposed, request);
    this.commitMutations(target, binding, initial, decision.mutations);
    if (decision.continuation !== undefined) {
      if (policy.resume === undefined) throw new Error("Combat policy has no source continuation implementation");
      const resumed = captureDecision(policy.resume(decision, { target: () => this.read(target.id), attacker: () => request.attack.attacker === null ? null : this.read(request.attack.attacker) }), request);
      if (resumed.continuation !== undefined) throw new Error("Combat source health continuation did not complete");
      const latest = this.read(target.id);
      if (latest === null) {
        if (resumed.mutations.length !== 0) throw new Error("Combat continuation mutated a removed actor");
      } else this.commitMutations(target, binding, latest, resumed.mutations);
      decision = captureDecision({ ...resumed, mutations: [...decision.mutations, ...resumed.mutations] }, request);
    }
    if (policy.afterHealth !== undefined && decision.mutations.some(mutation => mutation.kind === "health")) {
      const reaction = policy.afterHealth(decision, { target: () => this.read(target.id), attacker: () => request.attack.attacker === null ? null : this.read(request.attack.attacker) });
      decision = captureDecision({ ...decision, reaction }, request);
    }
    if (this.actors.isLive(target.id)) this.hooks.beforeReaction(target, decision);
    if (this.actors.isLive(target.id)) {
      const kick = decision.feedback?.kind === "q2" ? decision.feedback.knockback : request.knockback;
      const reaction = { attack: request.attack, self: target, attacker: request.attack.attacker, kick, damage: decision.appliedDamage };
      if (decision.reaction === "death") this.callbacks.die({ ...reaction, inflictor: request.attack.inflictor, point: request.point });
      else if (decision.reaction === "pain") this.callbacks.pain(reaction);
    }
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
    const state = binding.read();
    const cells = this.powerArmorCells.get(actor);
    if (cells === undefined || state.armor.kind !== "q2" || state.armor.powerArmor.kind === "none") return copyCombat(state);
    return copyCombat({ ...state, armor: { ...state.armor, powerArmor: { ...state.armor.powerArmor, cells: cells.read() } } });
  }

  private writeArmor(actor: OwnedActor, binding: CombatStateBinding, armor: ArmorState): undefined {
    const cells = this.powerArmorCells.get(actor);
    if (cells !== undefined && armor.kind === "q2" && armor.powerArmor.kind !== "none") cells.write(armor.powerArmor.cells);
    return binding.writeArmor(copyArmor(armor));
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
