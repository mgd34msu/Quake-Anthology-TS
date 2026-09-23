import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ProtectionChannel } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { OriginalPickupDecision, OriginalPickupExecution, OriginalPickupOffer, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { QvmModCallbackDeclaration, QvmModPickup, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";

type Inputs = ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
interface Operations {
  current(): void;
  eligible(actor: ActorId): boolean;
  context<Result>(definition: QvmModPickup, offer: OriginalPickupOffer, inputs: Inputs, execute: () => Result): Result;
  observe<Result>(actor: ActorId, observer: OriginalPickupExecution, execute: () => Result): Result;
  invoke(call: QvmModSourceCall, inputs: Inputs): number;
}

export function validateQvmModPickups(declaration: QvmModCallbackDeclaration): void {
  const ids = new Set<string>(), offered = new Set<string>();
  for (const rule of declaration.pickups ?? []) {
    if (declaration.clients === undefined || ids.has(rule.id) || rule.id.length === 0 || rule.offered.length === 0)
      throw new Error("QVM pickups require unique rules and source client admission");
    ids.add(rule.id);
    for (const item of rule.offered) {
      if (offered.has(item)) throw new Error("Ambiguous QVM original pickup item");
      offered.add(item);
    }
    for (const resource of rule.writes) {
      if (resource.kind === "protection") {
        if (!declaration.protection?.some(protection => protection.channel === resource.channel)) throw new Error("QVM pickup has no protection owner");
      } else if (resource.fields !== "capacity" && !declaration.actorRecords.some(record => record.fields.some(field => field.binding === "inventory" && field.item === resource.item)))
        throw new Error("QVM pickup has no declared inventory storage");
      if (resource.kind === "inventory" && resource.fields !== "count") throw new Error("QVM pickup has no declared mutable capacity storage");
    }
    if (rule.operation.kind === "boolean-grant" && rule.operation.grant.returns === "void"
      || rule.operation.kind === "gate-then-grant" && (rule.operation.gate.returns === "void"
        || rule.operation.grantAccepts === "nonzero" && rule.operation.grant.returns === "void")) throw new Error("QVM pickup requires its declared source decision");
    const occupied = new Set<string>();
    for (const field of rule.context) {
      const record = declaration.actorRecords.find(record => record.id === field.record), key = `${field.record}:${field.offset}`;
      if (record === undefined || declaration.clients.records.includes(record.id) || occupied.has(key)
        || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset % 4 !== 0 || field.offset + 4 > record.stride)
        throw new Error("Invalid QVM pickup source context");
      occupied.add(key);
      for (const binding of record.fields) {
        const width = binding.binding === "private" ? binding.byteLength
          : ["origin", "velocity", "angles", "bounds-min", "bounds-max", "constant-vector"].includes(binding.binding) ? 12 : 4;
        if (binding.offset < field.offset + 4 && field.offset < binding.offset + width && binding.binding !== "private" && binding.binding !== "constant")
          throw new Error("QVM pickup context overlaps shared or linked storage");
      }
      const source = declaration.sourceActors;
      if (record.id === declaration.entityRecord && source !== undefined && (field.offset === source.inuse
        || Object.values(source.callbacks ?? {}).includes(field.offset))) throw new Error("QVM pickup context overlaps source actor lifetime");
    }
  }
}

/** Rules travel with the current resource binding; this object owns only source execution and inventory delegates. */
export class QvmModPickups {
  private active = false;
  private readonly rules = new Map<ActorId, readonly OriginalPickupRule[]>();
  private depth = 0;
  private readonly delegates = new Map<ActorId, readonly (() => undefined)[]>();
  constructor(private readonly definitions: readonly QvmModPickup[], private readonly services: ModHostServices,
    private readonly owner: ProviderId, private readonly operations: Operations) {}
  get isActive(): boolean { return this.active; }
  protection(actor: ActorId, channel: ProtectionChannel): readonly OriginalPickupRule[] {
    return this.actorRules(actor).filter(rule => rule.writes.some(write => write.kind === "protection" && write.channel === channel));
  }
  private actorRules(actor: ActorId): readonly OriginalPickupRule[] {
    let rules = this.rules.get(actor);
    if (rules === undefined) { rules = this.definitions.map(definition => this.rule(actor, definition)); this.rules.set(actor, rules); }
    return rules;
  }
  private rule(actor: ActorId, definition: QvmModPickup): OriginalPickupRule {
    return { id: definition.id, offered: definition.offered, writes: definition.writes, take: (offer, stores) => this.take(actor, definition, offer, stores) };
  }
  activate(): void {
    this.operations.current(); this.active = true;
    for (const identity of this.services.clients?.clients() ?? []) this.bindActor(identity.actor);
  }
  bindActor(actor: ActorId): void {
    if (!this.active || !this.operations.eligible(actor) || this.delegates.has(actor)) return;
    const owned = this.services.actors.resolveOwned(actor);
    if (owned === null) throw new Error("QVM pickup recipient is retired");
    const rules = this.actorRules(actor).filter(rule => rule.writes.some(write => write.kind === "inventory"));
    const removers: (() => undefined)[] = [];
    try {
      if (rules.length !== 0) removers.push(this.services.inventory.bindPickup(owned, { owner: this.owner, rules }));
      this.delegates.set(actor, removers);
    } catch (error) { for (const remove of removers.reverse()) remove(); throw error; }
  }
  private take(actor: ActorId, definition: QvmModPickup, offer: OriginalPickupOffer, observer: OriginalPickupExecution): OriginalPickupDecision {
    this.operations.current();
    const current = (): boolean => observer.current() && this.active && this.services.actors.isLive(actor) && this.operations.eligible(actor)
      && this.services.actors.isLive(offer.pickup);
    if (!offer.recipient.equals(actor) || !definition.offered.includes(offer.item) || !current()) throw new Error("QVM pickup rule is no longer current");
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["other", { kind: "actor", value: offer.pickup }], ["item", { kind: "string", value: offer.item }],
      ["time", { kind: "float", value: offer.time.kind === "seconds" ? offer.time.value : offer.time.value / 1000 }],
      ["pickup-count", { kind: "float", value: offer.count.kind === "override" ? offer.count.amount : 0 }],
      ["pickup-has-count", { kind: "float", value: offer.count.kind === "override" ? 1 : 0 }],
      ["pickup-dropped", { kind: "float", value: offer.dropped ? 1 : 0 }],
    ]);
    this.depth++;
    try {
      return this.operations.context(definition, offer, inputs, () => this.operations.observe(actor, observer, () => {
        const operation = definition.operation;
        if (operation.kind === "gate-then-grant" && (this.operations.invoke(operation.gate, inputs) === 0 || !current())) return "refused";
        const result = this.operations.invoke(operation.grant, inputs);
        return operation.kind === "gate-then-grant" && operation.grantAccepts === "always" || result !== 0 ? "accepted" : "refused";
      }));
    } finally { this.depth--; }
  }
  assertIdle(): void { if (this.depth !== 0) throw new Error("Cannot save or restore during QVM original pickup execution"); }
  release(actor: ActorId): void {
    const removers = this.delegates.get(actor); this.delegates.delete(actor); this.rules.delete(actor);
    const errors: unknown[] = [];
    for (const remove of removers ?? []) try { remove(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QVM pickup delegate cleanup failed");
  }
  close(): void {
    this.active = false; this.rules.clear(); const errors: unknown[] = [];
    for (const actor of [...this.delegates.keys()]) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QVM pickup cleanup failed");
  }
}
