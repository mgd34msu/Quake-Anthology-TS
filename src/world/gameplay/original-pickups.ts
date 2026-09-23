import type { ActorId } from "../../contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupContinuation, OriginalPickupOffer, OriginalPickupOutcome, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import type { GameplayAuthority } from "./authority.ts";
import type { SharedInventoryTable } from "./inventory.ts";

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

  touch(offer: OriginalPickupOffer, continuation: OriginalPickupContinuation): OriginalPickupOutcome {
    const recipient = this.actors.resolveOwned(offer.recipient), pickup = this.actors.resolveOwned(offer.pickup);
    if (recipient === null || pickup === null || this.touching.has(pickup.id)) return "stale";
    if (!Number.isFinite(offer.time.value) || offer.count.kind === "override" && !Number.isFinite(offer.count.amount))
      throw new RangeError("Pickup time and count must be finite");
    const request: OriginalPickupOffer = Object.freeze({ ...offer, count: Object.freeze({ ...offer.count }), time: Object.freeze({ ...offer.time }),
      defaultResource: offer.defaultResource === null ? null : Object.freeze({ ...offer.defaultResource }) });
    this.touching.add(pickup.id);
    try {
      if (continuation.eligible?.() === false) return "refused";
      if (this.actors.resolveOwned(request.recipient) !== recipient || this.actors.resolveOwned(request.pickup) !== pickup) return "stale";
      const armor = this.combat.resolvePickup(recipient, request), items = this.inventory.resolvePickup(recipient, request);
      const matches = [...armor.matches, ...items.matches];
      if (matches.length > 1) throw new Error(`Multiple original pickup owners accept ${request.item}`);
      const selected = matches[0];
      if (selected !== undefined && request.grant === "map-coupled") throw new Error(`Original pickup replacement for ${request.item} requires its map lifecycle`);
      let taken: boolean;
      if (selected === undefined) taken = !armor.blocksPrimary && !items.blocksPrimary && continuation.original();
      else {
        if (!selected.current()) return "stale";
        taken = this.combat.withPickupProtection(recipient, selected.owner, stores => selected.take(request, stores)) === "accepted";
      }
      if (this.actors.resolveOwned(request.recipient) !== recipient || this.actors.resolveOwned(request.pickup) !== pickup
        || selected !== undefined && !selected.current()) return "stale";
      continuation.complete(taken);
      return taken ? "accepted" : "refused";
    } finally { this.touching.delete(pickup.id); }
  }
}
