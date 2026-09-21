import type { ActorId, OwnedActor, ProviderId } from "./identity.ts";
import type { Vec3 } from "./math.ts";
import type { SourceTime } from "./time.ts";

export type ItemId = `${string}:${string}`;
export interface ActivePowerupTimer {
  readonly item: ItemId;
  readonly label: string;
  readonly remainingSeconds: number;
}
export type ObjectiveId = `${string}:${string}`;

/** Selected arsenal controls travel with a command independently of its movement dialect. */
export interface ArsenalIntent {
  readonly provider: ProviderId;
  /** Null retains the current selection; the arsenal owner validates named weapons. */
  readonly weapon: ItemId | null;
  readonly useHoldable: boolean;
  readonly impulse?: number;
}

/** Original mod encodings differ between classic game DLLs and the rerelease mod_t. */
export type Q2NativeCause =
  | { readonly edition: "classic"; readonly game: "base" | "xatrix" | "rogue" | "ctf"; readonly value: number }
  | { readonly edition: "rerelease"; readonly id: number; readonly friendlyFire: boolean; readonly noPointLoss: boolean };

/** Captured before any combat mutation, including source flags and selected decision owners. */
export interface AttackProvenance {
  readonly sequence: number;
  readonly time: SourceTime;
  readonly attacker: ActorId | null;
  readonly inflictor: ActorId | null;
  readonly originatingProjectile?: ActorId;
  readonly weapon: ItemId | null;
  readonly weaponProvider: ProviderId;
  readonly combatProvider: ProviderId;
  readonly inventoryProvider: ProviderId;
  readonly movementProvider: ProviderId;
  readonly cause:
    | { readonly kind: "q1"; readonly deathType: string; readonly armorEffect?: "bypass" | "half-effectiveness" }
    /** meansOfDeath is the canonical engine cause ID, never an unconverted native ordinal. */
    | { readonly kind: "q2"; readonly meansOfDeath: number; readonly damageFlags: number; readonly native?: Q2NativeCause }
    | { readonly kind: "q3"; readonly meansOfDeath: number; readonly damageFlags: number }
    | { readonly kind: "environment"; readonly hazard: "fall" | "drown" | "lava" | "slime" | "crush" | "trigger" };
}

export interface DamageRequest {
  readonly attack: AttackProvenance;
  readonly target: ActorId;
  readonly amount: number;
  readonly knockback: number;
  readonly direction: Vec3;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly delivery: "direct" | "radius";
}

export type RegularArmorState =
  | { readonly kind: "none" }
  | { readonly kind: "q1"; readonly points: number; readonly absorption: number; readonly item: ItemId }
  | { readonly kind: "q2"; readonly points: number; readonly normalProtection: number; readonly energyProtection: number; readonly item: ItemId }
  | { readonly kind: "q3"; readonly points: number; readonly protection: number };

/** Effective protection; held equipment and inactive fuel remain in their inventory/source owner. */
export type PoweredProtectionState = { readonly kind: "none" } | { readonly kind: "screen" | "shield"; readonly cells: number };

export interface ArmorState {
  readonly regular: RegularArmorState;
  readonly powered: PoweredProtectionState;
}

export interface CombatState {
  readonly health: number;
  readonly armor: ArmorState;
  readonly mass: number;
  readonly canTakeDamage: boolean;
  readonly invulnerable: boolean;
  /** Source entity immunity to damage momentum, independent of its physical mass. */
  readonly noKnockback?: boolean;
  readonly team: string | null;
}

/** Ordered source operations are consumed exactly once by the corresponding table owner. */
export type DamageMutation =
  | { readonly kind: "health"; readonly before: number; readonly after: number }
  | { readonly kind: "armor"; readonly before: ArmorState; readonly after: ArmorState }
  | { readonly kind: "source-velocity"; readonly before: Vec3; readonly after: Vec3; readonly movementProvider: ProviderId }
  | { readonly kind: "impulse"; readonly impulse: Vec3; readonly movementProvider: ProviderId };

export interface DamageDecision {
  readonly request: DamageRequest;
  readonly mutations: readonly DamageMutation[];
  readonly appliedDamage: number;
  readonly reaction: "none" | "pain" | "death";
  /** Source savings, including protection credited as armor; never infer these from spent inventory. */
  readonly feedback?:
    | { readonly kind: "q2"; readonly powerArmor: number; readonly armor: number; readonly blood: number; readonly knockback: number }
    | { readonly kind: "q3"; readonly knockback: number; readonly battlesuit: boolean };
  /** Source TeamHealthDam runs after armor/momentum commit and before health is read again. */
  readonly continuation?: { readonly kind: "q1-health"; readonly damage: number; readonly take: number };
}

export interface CurrentCombatState { target(): CombatState | null; attacker(): CombatState | null; }

export interface CombatPolicy {
  readonly id: ProviderId;
  /** Source stages such as empathy may synchronously reenter combat before armor is read. */
  prepare?(request: DamageRequest, target: CombatState, attacker: CombatState | null): DamagePreparation;
  decide(request: DamageRequest, target: CombatState, attacker: CombatState | null, prepared?: { readonly amount: number }): DamageDecision;
  /** May synchronously reenter. Returned mutations use freshly read state after that call returns. */
  resume?(decision: DamageDecision, current: CurrentCombatState): DamageDecision;
  /** Runs after committed health and before pain/death; reentrant effects read current actors. */
  afterHealth?(decision: DamageDecision, current: CurrentCombatState): DamageDecision["reaction"];
}

export type DamagePreparation = { readonly kind: "continue"; readonly amount: number } | { readonly kind: "cancel" };

export type DamageOutcome =
  | { readonly kind: "stale-target"; readonly request: DamageRequest }
  | { readonly kind: "committed"; readonly decision: DamageDecision; readonly survived: boolean };

export interface DamageAuthority {
  apply(request: DamageRequest): DamageOutcome;
}

export type InventoryCountPolicy = { readonly kind: "stack" } | { readonly kind: "source-counter"; readonly arithmetic: "binary32" | "binary64" | "int32" };
export interface InventoryEntry {
  readonly item: ItemId;
  readonly count: number;
  readonly capacity: number;
  /** Original source fields can retain signed values; absence on a new entry selects a nonnegative stack. */
  readonly countPolicy?: InventoryCountPolicy;
}

export interface InventoryTable {
  entries(actor: ActorId): readonly InventoryEntry[];
  count(actor: ActorId, item: ItemId): number;
  consume(actor: OwnedActor, item: ItemId, count: number): boolean;
  give(actor: OwnedActor, item: ItemId, count: number): number;
}

export interface MissionGate {
  readonly objective: ObjectiveId;
  readonly satisfied: boolean;
}

export type TransitionIntent =
  | { readonly kind: "campaign-level"; readonly campaign: ProviderId; readonly map: `${string}:${string}`; readonly spawnPoint: string; readonly gates: readonly MissionGate[]; readonly cause: ActorId | null }
  | { readonly kind: "campaign-complete"; readonly campaign: ProviderId; readonly gates: readonly MissionGate[] }
  | { readonly kind: "round-complete"; readonly match: ProviderId; readonly winner: string | null }
  | { readonly kind: "match-rotation"; readonly match: ProviderId; readonly map: `${string}:${string}` };

export type CampaignTransitionIntent = Extract<TransitionIntent, { readonly kind: "campaign-level" | "campaign-complete" }>;
export type MatchTransitionIntent = Extract<TransitionIntent, { readonly kind: "round-complete" | "match-rotation" }>;

export type TransitionMode =
  | { readonly kind: "campaign"; readonly campaign: ProviderId; readonly allowRoundRestart: boolean }
  | { readonly kind: "competitive"; readonly match: ProviderId }
  | { readonly kind: "combined"; readonly campaign: ProviderId; readonly match: ProviderId; readonly levelAuthority: "campaign-gates"; readonly simultaneous: "campaign-first" | "round-first" };

export type TransitionDecision =
  | { readonly kind: "stay"; readonly blocked: readonly ObjectiveId[] }
  | { readonly kind: "round"; readonly winner: string | null }
  | { readonly kind: "travel"; readonly map: `${string}:${string}`; readonly spawnPoint: string; readonly completeCampaign: boolean }
  | { readonly kind: "campaign-complete"; readonly campaign: ProviderId };

export interface CampaignController {
  readonly id: ProviderId;
  gates(): readonly MissionGate[];
  proposeTransition(): CampaignTransitionIntent | null;
}

export interface MatchController {
  readonly id: ProviderId;
  confirmedDamage(outcome: DamageOutcome): undefined;
  proposeTransition(): MatchTransitionIntent | null;
}

/** The coordinator alone commits travel after resolving campaign and match intent order. */
export interface TransitionCoordinator {
  resolve(mode: TransitionMode, intents: readonly TransitionIntent[]): TransitionDecision;
  commit(decision: TransitionDecision): undefined;
}
