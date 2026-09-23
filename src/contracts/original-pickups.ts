import type { ItemId, ProtectionChannel, ProtectionObserver } from "./gameplay.ts";
import type { ActorId, ProviderId } from "./identity.ts";
import type { SourceTime } from "./time.ts";

export type PickupResource =
  | { readonly kind: "protection"; readonly channel: ProtectionChannel }
  | { readonly kind: "inventory"; readonly item: ItemId };
export type PickupWrite = Extract<PickupResource, { readonly kind: "protection" }>
  | { readonly kind: "inventory"; readonly item: ItemId; readonly fields: "count" | "capacity" | "count-and-capacity" };
export type PickupWrites = readonly [PickupWrite, ...PickupWrite[]];
export type PickupCount = { readonly kind: "default" } | { readonly kind: "override"; readonly amount: number };
export interface PickupCargoEntry { readonly kind: "counter" | "weapon"; readonly item: ItemId; readonly count: number; }
export interface OriginalPickupOffer {
  readonly recipient: ActorId;
  readonly pickup: ActorId;
  readonly source: ProviderId;
  readonly item: ItemId;
  readonly defaultResource: PickupResource | null;
  readonly count: PickupCount;
  readonly dropped: boolean;
  readonly time: SourceTime;
  readonly cargo?: readonly PickupCargoEntry[];
  /** Some source grants also own map objectives; those require an explicit lifecycle handoff. */
  readonly grant?: "map-coupled";
}
export type OriginalPickupDecision = "accepted" | "refused";
export type OriginalPickupOutcome = OriginalPickupDecision | "stale";

/** The resource binding owns these rules; source descriptors and call layouts stay in its adapter. */
export interface OriginalPickupRule {
  readonly id: string;
  readonly offered: readonly ItemId[];
  readonly writes: PickupWrites;
  take(offer: OriginalPickupOffer, execution: OriginalPickupExecution): OriginalPickupDecision;
}
export interface OriginalPickupExecution extends ProtectionObserver {
  readonly writes: PickupWrites;
  current(): boolean;
}
export interface CurrentOriginalPickup {
  readonly owner: ProviderId;
  readonly operation: OriginalPickupRule;
  readonly captured: OriginalPickupRule;
  readonly write: PickupWrite;
  current(): boolean;
}
export interface OriginalPickupResolution {
  readonly matches: readonly CurrentOriginalPickup[];
  readonly blocksPrimary: boolean;
}
export interface OriginalPickupContinuation {
  /** Map touch eligibility can mutate its own attempt state and must share the same item scope. */
  eligible?(): boolean;
  original(): boolean;
  /** Map feedback, targets and lifecycle run for a settled attempt while its touch scope is held. */
  complete(taken: boolean): void;
}
export type SourcePickupSelection =
  | { readonly kind: "original" | "blocked" | "stale" }
  | { readonly kind: "replacement"; current(): boolean; grant(): OriginalPickupOutcome };
export interface SourcePickupLifetime {
  /** Only the qualified map executor can retire its pickup and continue with the recipient. */
  consumePickup(remove: () => undefined): undefined;
}
export interface OriginalPickupAdmission {
  /** Keep the current grant owner and item scope until the complete original caller unwinds. */
  runSource<Result>(offer: OriginalPickupOffer, execute: (selection: SourcePickupSelection, lifetime: SourcePickupLifetime) => Result | Promise<Result>): Result | Promise<Result>;
  touch(offer: OriginalPickupOffer, continuation: OriginalPickupContinuation): OriginalPickupOutcome;
}

/** Grant acceptance is explicit: many original grants return a respawn interval, not a boolean. */
export type OriginalPickupOperation<Call> =
  | { readonly kind: "boolean-grant"; readonly grant: Call }
  | { readonly kind: "gate-then-grant"; readonly gate: Call; readonly grant: Call; readonly grantAccepts: "nonzero" | "always" };
export interface ModPickupRule<Call> {
  readonly id: string;
  readonly writes: PickupWrites;
  readonly offered: readonly ItemId[];
  readonly operation: OriginalPickupOperation<Call>;
}
