import type { ActorId, ClientId, ProviderId } from "../../contracts/identity.ts";
import type { ProtectionChannel, ProtectionObserver } from "../../contracts/gameplay.ts";
import type { ModCallbackDeclaration, ModCallbackInput, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { ModPickupRule, OriginalPickupDecision, OriginalPickupOffer, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { ModHostServices } from "../../world/session/mods.ts";

interface Entry { readonly client: ClientId; readonly remove: (() => undefined)[]; }
interface Operations {
  invoke(call: ModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
  watch<T>(actor: ActorId, observer: ProtectionObserver, run: () => T): T;
}

export class QcModPickups {
  private readonly entries = new Map<ActorId, Entry>();
  constructor(private readonly declaration: ModCallbackDeclaration, private readonly provider: ProviderId,
    private readonly services: ModHostServices, private readonly operations: Operations) {}

  admit(actor: ActorId): void {
    if (this.entries.has(actor)) return;
    const owner = this.services.actors.resolveOwned(actor), client = this.services.clients?.forActor(actor);
    if (owner === null || client == null || this.services.clients?.actor(client)?.equals(actor) !== true) throw new Error("QC pickups require a live canonical client");
    const entry: Entry = { client, remove: [] }; this.entries.set(actor, entry);
    try {
      const items = new Set(this.declaration.pickups?.flatMap(rule => rule.resource.kind === "inventory" ? [rule.resource.item] : []) ?? []);
      for (const item of items) entry.remove.push(this.services.inventory.bindPickup(owner, { owner: this.provider, item,
        rules: (this.declaration.pickups ?? []).filter(rule => rule.resource.kind === "inventory" && rule.resource.item === item).map(rule => this.rule(actor, rule)) }));
    } catch (error) {
      try { this.release(actor); } catch (cleanup) { throw new AggregateError([error, cleanup], "QC pickup admission failed"); }
      throw error;
    }
  }
  protection(actor: ActorId, channel: ProtectionChannel): readonly OriginalPickupRule[] {
    return (this.declaration.pickups ?? []).filter(rule => rule.resource.kind === "protection" && rule.resource.channel === channel).map(rule => this.rule(actor, rule));
  }
  private rule(actor: ActorId, definition: ModPickupRule<ModSourceCall>): OriginalPickupRule {
    return { id: definition.id, offered: definition.offered, take: (offer, stores) => this.take(actor, definition, offer, stores) };
  }
  private current(actor: ActorId, entry: Entry): boolean {
    return this.entries.get(actor) === entry && this.services.actors.isLive(actor)
      && this.services.clients?.forActor(actor)?.equals(entry.client) === true && this.services.clients.actor(entry.client)?.equals(actor) === true;
  }
  private take(actor: ActorId, definition: ModPickupRule<ModSourceCall>, offer: OriginalPickupOffer, observer: ProtectionObserver): OriginalPickupDecision {
    const entry = this.entries.get(actor);
    if (entry === undefined || !this.current(actor, entry) || !offer.recipient.equals(actor) || !this.services.actors.isLive(offer.pickup)
      || !definition.offered.includes(offer.item)) throw new Error("QC pickup invocation differs from its admitted source binding");
    const count = offer.count.kind === "override" ? offer.count.amount : 0, time = offer.time.kind === "seconds" ? offer.time.value : offer.time.value / 1000;
    if (!Number.isFinite(count) || Math.fround(count) !== count || !Number.isFinite(Math.fround(time))) throw new RangeError("QC pickup input exceeds its source scalar ABI");
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["other", { kind: "actor", value: offer.pickup }], ["item", { kind: "string", value: offer.item }],
      ["time", { kind: "float", value: time }], ["pickup-count", { kind: "float", value: count }],
      ["pickup-has-count", { kind: "float", value: offer.count.kind === "override" ? 1 : 0 }], ["pickup-dropped", { kind: "float", value: offer.dropped ? 1 : 0 }],
    ]);
    const accepts = (value: number): boolean => {
      if (!Number.isFinite(value)) throw new Error("QC pickup returned a non-finite source result");
      return value !== 0;
    };
    return this.operations.watch(actor, observer, () => {
      const operation = definition.operation;
      if (operation.kind === "gate-then-grant") {
        if (!accepts(this.operations.invoke(operation.gate, inputs)) || !this.current(actor, entry) || !this.services.actors.isLive(offer.pickup)) return "refused";
      }
      const result = this.operations.invoke(operation.grant, inputs);
      return operation.kind === "gate-then-grant" && operation.grantAccepts === "always" || accepts(result) ? "accepted" : "refused";
    });
  }
  release(actor: ActorId): void {
    const entry = this.entries.get(actor); if (entry === undefined) return;
    const errors: unknown[] = [];
    for (const remove of entry.remove) try { remove(); } catch (error) { errors.push(error); }
    this.entries.delete(actor);
    if (errors.length !== 0) throw new AggregateError(errors, "QC pickup release failed");
  }
  close(): void {
    const errors: unknown[] = [];
    for (const actor of this.entries.keys()) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QC pickup close failed");
  }
}
