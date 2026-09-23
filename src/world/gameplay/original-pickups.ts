import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupContinuation, OriginalPickupOffer, OriginalPickupOutcome, OriginalPickupRule, SourcePickupSelection } from "../../contracts/original-pickups.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import type { GameplayAuthority } from "./authority.ts";
import type { SharedInventoryTable } from "./inventory.ts";

interface PickupScope {
  readonly recipient: OwnedActor;
  readonly pickup: OwnedActor;
  readonly request: OriginalPickupOffer;
  open: boolean;
}

export function captureOriginalPickupRules(rules: readonly OriginalPickupRule[]): readonly OriginalPickupRule[] {
  const ids = new Set<string>(), offered = new Set<string>();
  return Object.freeze(rules.map(rule => {
    if (rule.id.length === 0 || ids.has(rule.id) || rule.offered.length === 0) throw new Error("Original pickup rules require unique IDs and offered items");
    ids.add(rule.id);
    for (const item of rule.offered) {
      if (offered.has(item)) throw new Error(`Ambiguous original pickup rule for ${item}`);
      offered.add(item);
    }
    return Object.freeze({ id: rule.id, offered: Object.freeze([...rule.offered]), take: rule.take.bind(rule) });
  }));
}

/** The map retains its complete touch continuation; resource bindings select original recipient code. */
export class SharedOriginalPickupAdmission implements OriginalPickupAdmission {
  private readonly touching = new Set<ActorId>();
  constructor(private readonly actors: SessionActorRegistry, private readonly combat: GameplayAuthority, private readonly inventory: SharedInventoryTable) {}

  assertIdle(): undefined {
    if (this.touching.size !== 0) throw new Error("Cannot checkpoint during pickup execution");
    return undefined;
  }

  private open(offer: OriginalPickupOffer): PickupScope | null {
    const recipient = this.actors.resolveOwned(offer.recipient), pickup = this.actors.resolveOwned(offer.pickup);
    if (recipient === null || pickup === null || this.touching.has(pickup.id)) return null;
    if (!Number.isFinite(offer.time.value) || offer.count.kind === "override" && !Number.isFinite(offer.count.amount))
      throw new RangeError("Pickup time and count must be finite");
    const request: OriginalPickupOffer = Object.freeze({ ...offer, count: Object.freeze({ ...offer.count }), time: Object.freeze({ ...offer.time }),
      defaultResource: offer.defaultResource === null ? null : Object.freeze({ ...offer.defaultResource }) });
    this.touching.add(pickup.id);
    return { recipient, pickup, request, open: true };
  }

  private current(scope: PickupScope): boolean {
    return scope.open && this.actors.resolveOwned(scope.recipient.id) === scope.recipient && this.actors.resolveOwned(scope.pickup.id) === scope.pickup;
  }

  private close(scope: PickupScope): void {
    scope.open = false;
    this.touching.delete(scope.pickup.id);
  }

  private selection(scope: PickupScope): SourcePickupSelection {
    const { recipient, request } = scope;
    const armor = this.combat.resolvePickup(recipient, request), items = this.inventory.resolvePickup(recipient, request);
    const matches = [...armor.matches, ...items.matches];
    if (matches.length > 1) throw new Error(`Multiple original pickup owners accept ${request.item}`);
    const selected = matches[0];
    if (selected === undefined) return { kind: armor.blocksPrimary || items.blocksPrimary ? "blocked" : "original" };
    if (request.grant === "map-coupled") throw new Error(`Original pickup replacement for ${request.item} requires its map lifecycle`);
    const current = (): boolean => this.current(scope) && selected.current();
    let used = false;
    return { kind: "replacement", current, grant: () => {
      if (used) throw new Error("Original source pickup grant already consumed");
      used = true;
      if (!current()) return "stale";
      const outcome = this.combat.withPickupProtection(recipient, selected.owner, stores => selected.take(request, stores));
      return current() ? outcome : "stale";
    } };
  }

  runSource<Result>(offer: OriginalPickupOffer, execute: (selection: SourcePickupSelection) => Result | Promise<Result>): Result | Promise<Result> {
    const scope = this.open(offer);
    if (scope === null) return execute({ kind: "stale" });
    try {
      const result = execute(this.selection(scope));
      if (result instanceof Promise) return result.finally(() => this.close(scope));
      this.close(scope); return result;
    } catch (error) { this.close(scope); throw error; }
  }

  touch(offer: OriginalPickupOffer, continuation: OriginalPickupContinuation): OriginalPickupOutcome {
    const scope = this.open(offer);
    if (scope === null) return "stale";
    try {
      if (continuation.eligible?.() === false) return "refused";
      if (!this.current(scope)) return "stale";
      const selected = this.selection(scope);
      const outcome = selected.kind === "replacement" ? selected.grant()
        : selected.kind === "original" && continuation.original() ? "accepted" : "refused";
      if (outcome === "stale" || !this.current(scope) || selected.kind === "replacement" && !selected.current()) return "stale";
      const taken = outcome === "accepted";
      continuation.complete(taken);
      return outcome;
    } finally { this.close(scope); }
  }
}
