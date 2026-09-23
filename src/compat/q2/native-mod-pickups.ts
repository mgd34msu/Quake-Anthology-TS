import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ItemId, ProtectionChannel, ProtectionObserver } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { OriginalPickupDecision, OriginalPickupOffer, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { NativeModDeclaration, NativeModPickup, NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";

type Inputs = ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
interface Operations {
  current(): void;
  eligible(actor: ActorId): boolean;
  context<Result>(definition: NativeModPickup, offer: OriginalPickupOffer, inputs: Inputs, execute: () => Result): Result;
  observe<Result>(actor: ActorId, observer: ProtectionObserver, execute: () => Result): Result;
  invoke(call: NativeModSourceCall, inputs: Inputs): number;
}

export function validateNativeModPickups(declaration: NativeModDeclaration): void {
  const ids = new Set<string>(), offered = new Set<string>();
  for (const rule of declaration.pickups ?? []) {
    if (declaration.clients === undefined || ids.has(rule.id) || rule.id.length === 0 || rule.offered.length === 0)
      throw new Error("Native pickups require unique rules and source client admission");
    ids.add(rule.id);
    for (const item of rule.offered) {
      if (offered.has(item)) throw new Error("Ambiguous native original pickup item");
      offered.add(item);
    }
    const resource = rule.resource;
    if (resource.kind === "protection") {
      if (!declaration.protection?.some(protection => protection.channel === resource.channel)) throw new Error("Native pickup has no protection owner");
    } else if (!declaration.actorRecords.some(record => record.fields.some(field => field.binding === "inventory" && field.item === resource.item)))
      throw new Error("Native pickup has no declared inventory storage");
    if (rule.operation.kind === "boolean-grant" && rule.operation.grant.returns === "void"
      || rule.operation.kind === "gate-then-grant" && (rule.operation.gate.returns === "void"
        || rule.operation.grantAccepts === "nonzero" && rule.operation.grant.returns === "void")) throw new Error("Native pickup requires its declared source decision");
  }
}

/** Rules travel with the current resource binding; this object owns only source execution and inventory delegates. */
export class NativeModPickups {
  private active = false;
  private depth = 0;
  private readonly delegates = new Map<ActorId, readonly (() => undefined)[]>();
  constructor(private readonly definitions: readonly NativeModPickup[], private readonly services: ModHostServices,
    private readonly owner: ProviderId, private readonly operations: Operations) {}
  protection(actor: ActorId, channel: ProtectionChannel): readonly OriginalPickupRule[] {
    return this.definitions.filter(rule => rule.resource.kind === "protection" && rule.resource.channel === channel).map(rule => this.rule(actor, rule));
  }
  private rule(actor: ActorId, definition: NativeModPickup): OriginalPickupRule {
    return { id: definition.id, offered: definition.offered, take: (offer, stores) => this.take(actor, definition, offer, stores) };
  }
  activate(): void {
    this.operations.current(); this.active = true;
    for (const identity of this.services.clients?.clients() ?? []) this.bindActor(identity.actor);
  }
  bindActor(actor: ActorId): void {
    if (!this.active || !this.operations.eligible(actor) || this.delegates.has(actor)) return;
    const owned = this.services.actors.resolveOwned(actor);
    if (owned === null) throw new Error("Native pickup recipient is retired");
    const rules = new Map<ItemId, OriginalPickupRule[]>();
    for (const definition of this.definitions) if (definition.resource.kind === "inventory") {
      let group = rules.get(definition.resource.item);
      if (group === undefined) { group = []; rules.set(definition.resource.item, group); }
      group.push(this.rule(actor, definition));
    }
    const removers: (() => undefined)[] = [];
    try {
      for (const [item, group] of rules) removers.push(this.services.inventory.bindPickup(owned, { owner: this.owner, item, rules: group }));
      this.delegates.set(actor, removers);
    } catch (error) { for (const remove of removers.reverse()) remove(); throw error; }
  }
  private take(actor: ActorId, definition: NativeModPickup, offer: OriginalPickupOffer, observer: ProtectionObserver): OriginalPickupDecision {
    this.operations.current();
    const current = (): boolean => this.active && this.services.actors.isLive(actor) && this.operations.eligible(actor)
      && this.services.actors.isLive(offer.pickup);
    if (!offer.recipient.equals(actor) || !definition.offered.includes(offer.item) || !current()) throw new Error("Native pickup rule is no longer current");
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["other", { kind: "actor", value: offer.pickup }], ["item", { kind: "string", value: offer.item }],
      ["time", { kind: "float", value: offer.time.kind === "seconds" ? offer.time.value : offer.time.value / 1000 }],
      ["pickup-count", { kind: "float", value: offer.count.kind === "override" ? offer.count.amount : 0 }],
      ["pickup-has-count", { kind: "float", value: offer.count.kind === "override" ? 1 : 0 }],
      ["pickup-dropped", { kind: "float", value: offer.dropped ? 1 : 0 }],
    ]);
    this.depth++;
    try {
      return this.operations.observe(actor, observer, () => this.operations.context(definition, offer, inputs, () => {
        const operation = definition.operation;
        if (operation.kind === "gate-then-grant" && (this.operations.invoke(operation.gate, inputs) === 0 || !current())) return "refused";
        const result = this.operations.invoke(operation.grant, inputs);
        return operation.kind === "gate-then-grant" && operation.grantAccepts === "always" || result !== 0 ? "accepted" : "refused";
      }));
    } finally { this.depth--; }
  }
  assertIdle(): void { if (this.depth !== 0) throw new Error("Cannot save or restore during Native original pickup execution"); }
  release(actor: ActorId): void {
    const removers = this.delegates.get(actor); this.delegates.delete(actor);
    const errors: unknown[] = [];
    for (const remove of removers ?? []) try { remove(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native pickup delegate cleanup failed");
  }
  close(): void {
    this.active = false; const errors: unknown[] = [];
    for (const actor of [...this.delegates.keys()]) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native pickup cleanup failed");
  }
}
