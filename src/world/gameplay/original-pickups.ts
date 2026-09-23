import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupContinuation, OriginalPickupOffer, OriginalPickupOutcome, OriginalPickupRule, PickupWrite, PickupWrites, SourcePickupSelection } from "../../contracts/original-pickups.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import type { GameplayAuthority } from "./authority.ts";
import type { SharedInventoryTable } from "./inventory.ts";

interface PickupScope {
  readonly recipient: OwnedActor;
  readonly pickup: OwnedActor;
  readonly request: OriginalPickupOffer;
  open: boolean;
}

export interface CapturedOriginalPickupRule extends OriginalPickupRule { readonly operation: OriginalPickupRule; }
export function pickupWriteKey(write: PickupWrite): string { return write.kind === "protection" ? `protection:${write.channel}` : `inventory:${write.item}`; }
export function captureOriginalPickupRules(rules: readonly OriginalPickupRule[]): readonly CapturedOriginalPickupRule[] {
  const ids = new Set<string>(), offered = new Set<string>();
  return Object.freeze(rules.map(rule => {
    if (rule.id.length === 0 || ids.has(rule.id) || rule.offered.length === 0) throw new Error("Original pickup rules require unique IDs and offered items");
    ids.add(rule.id);
    for (const item of rule.offered) {
      if (offered.has(item)) throw new Error(`Ambiguous original pickup rule for ${item}`);
      offered.add(item);
    }
    const [first, ...rest] = rule.writes;
    if (first === undefined) throw new Error("Original pickup requires a nonempty write set");
    const writes: PickupWrites = [Object.freeze({ ...first }), ...rest.map(write => Object.freeze({ ...write }))];
    if (new Set(writes.map(pickupWriteKey)).size !== writes.length) throw new Error("Original pickup has duplicate resource writes");
    return Object.freeze({ operation: rule, id: rule.id, offered: Object.freeze([...rule.offered]), writes: Object.freeze(writes), take: rule.take.bind(rule) });
  }));
}

/** The map retains its complete touch continuation; resource bindings select original recipient code. */
export class SharedOriginalPickupAdmission implements OriginalPickupAdmission {
  private readonly touching = new Set<ActorId>();
  constructor(private readonly actors: SessionActorRegistry, private readonly combat: GameplayAuthority, private readonly inventory: SharedInventoryTable,
    private readonly eligible?: (offer: OriginalPickupOffer) => boolean) {}

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
    const allowed = this.eligible?.(request) !== false;
    if (!this.current(scope)) return { kind: "stale" };
    if (!allowed) return { kind: "blocked" };
    const armor = this.combat.resolvePickup(recipient, request), items = this.inventory.resolvePickup(recipient, request);
    const matches = [...armor.matches, ...items.matches];
    const selected = matches[0];
    if (selected === undefined) return { kind: armor.blocksPrimary || items.blocksPrimary ? "blocked" : "original" };
    if (matches.some(match => match.owner !== selected.owner || match.operation !== selected.operation))
      throw new Error(`Multiple original pickup owners accept ${request.item}`);
    const declared = selected.captured.writes, keys = new Set(matches.map(match => pickupWriteKey(match.write)));
    if (keys.size !== declared.length || declared.some(write => !keys.has(pickupWriteKey(write)))
      || matches.some(match => JSON.stringify(match.captured.writes) !== JSON.stringify(declared)))
      throw new Error(`Original pickup ${request.item} has an incomplete or changed resource write set`);
    if (request.grant === "map-coupled") throw new Error(`Original pickup replacement for ${request.item} requires its map lifecycle`);
    const current = (): boolean => this.current(scope) && matches.every(match => match.current());
    let used = false;
    return { kind: "replacement", current, grant: () => {
      if (used) throw new Error("Original source pickup grant already consumed");
      used = true;
      if (!current()) return "stale";
      const outcome = this.combat.withPickupProtection(recipient, selected.owner, stores => {
        let open = true;
        const failure: { value: { error: unknown } | null } = { value: null };
        try {
          const result = selected.captured.take(request, { current: () => open && current(), writes: declared, stored: change => {
            try {
              if (!open) throw new Error("Original pickup observer is closed");
              if (!current()) throw new Error("Original pickup resource binding is no longer current");
              if (change.regular !== undefined && !declared.some(write => write.kind === "protection" && write.channel === "regular")
                || change.powered !== undefined && !declared.some(write => write.kind === "protection" && write.channel === "powered"))
                throw new Error("Original pickup changed undeclared protection");
              return stores.stored(change);
            } catch (error) { failure.value = { error }; throw error; }
          } });
          if (failure.value !== null) throw failure.value.error;
          return result;
        } finally { open = false; }
      });
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
