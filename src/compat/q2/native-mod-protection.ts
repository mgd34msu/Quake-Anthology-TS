import { isDeepStrictEqual } from "node:util";
import type { OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { GuestAddress } from "../../contracts/execution.ts";
import type { ActorId, ClientId, ProviderId } from "../../contracts/identity.ts";
import type { ArmorStageInput, ArmorStageResult, ArmorState, ItemId, ProtectionChannel, ProtectionObserver } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModArmorField, NativeModDeclaration, NativeModProtectionDefinition, NativeModScalarField, NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ProtectionClaim, ProtectionReservation } from "../../world/gameplay/authority.ts";
import type { InventoryCommittedChange } from "../../world/gameplay/inventory.ts";
import { NativeModArmorState } from "./native-mod-armor.ts";

interface Entry { readonly client: ClientId; readonly reservations: readonly ProtectionReservation[]; bound: boolean; }
interface Stage { readonly actor: ActorId; armor: ArmorState; suppressed: number; stop(): void; }
interface Counter { readonly channel: ProtectionChannel; readonly selection: ItemId | "screen" | "shield" | null; readonly field: NativeModArmorField; readonly inventory: ItemId | null; }
export interface NativeProtectionInventoryCommit {
  readonly actor: ActorId;
  readonly items: readonly ItemId[];
  committed(change: InventoryCommittedChange): undefined;
}
interface Operations {
  current(): void;
  pickups(actor: ActorId, channel: ProtectionChannel): readonly OriginalPickupRule[];
  slot(actor: ActorId): number | null;
  eligible(actor: ActorId): boolean;
  scalar(base: GuestAddress, field: NativeModScalarField, value?: number): number;
  transfer<Result>(invoke: () => Result): Result;
  flush(inventory?: NativeProtectionInventoryCommit): void;
  invoke(call: NativeModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
}

/** Component armor uses original storage and original absorption code. */
export class NativeModProtection {
  private readonly entries = new Map<ActorId, Entry>();
  private readonly counters: readonly Counter[];
  private readonly stages: Stage[] = [];
  private host: NativeModHost | null = null;
  private storage: NativeModArmorState | null = null;
  private active = false;
  constructor(private readonly definitions: readonly NativeModProtectionDefinition[], private readonly declaration: NativeModDeclaration,
    private readonly services: ModHostServices, private readonly instance: ProviderId, private readonly operations: Operations) {
    const counters: Counter[] = [];
    for (const definition of definitions) {
      const fields = definition.channel === "regular" ? definition.storage.map(item => ({ selection: item.item, field: item.points }))
        : definition.storage.map(item => ({ selection: item.kind, field: item.cells }));
      for (const { selection, field } of fields) {
        const record = declaration.actorRecords.find(record => record.id === field.record);
        const shared = record?.fields.find(value => value.binding === "inventory" && value.offset === field.offset && value.encoding === field.encoding);
        if (definition.channel === "powered" && shared?.binding !== "inventory") throw new Error("Native power fuel requires one declared canonical inventory field");
        counters.push({ channel: definition.channel, selection, field, inventory: shared?.binding === "inventory" ? shared.item : null });
      }
    }
    this.counters = counters;
  }
  private claim(definition: NativeModProtectionDefinition): ProtectionClaim {
    return { owner: this.instance, rule: definition.id, admission: definition.admission ?? { kind: "claim" } };
  }
  private inventoryItems(channel?: ProtectionChannel): readonly ItemId[] {
    return [...new Set(this.counters.flatMap(counter => counter.inventory === null || channel !== undefined && counter.channel !== channel ? [] : [counter.inventory]))];
  }
  attach(host: NativeModHost): void {
    this.host = host;
    this.storage = new NativeModArmorState({ kind: "source",
      regular: this.definitions.flatMap(definition => definition.channel === "regular" ? definition.storage : []),
      power: this.definitions.flatMap(definition => definition.channel === "powered" ? definition.storage : []) }, this.declaration, host, this.operations.scalar);
    for (const definition of this.definitions) {
      const entry = definition.absorb.abi === "source-call" ? definition.absorb.call.entry : definition.absorb.entry;
      const target = entry.kind === "game-export" ? host.gameEntry(entry.name).address : entry.kind === "export" ? host.entry(entry.name) : host.memory.offset(host.imageBase, BigInt(entry.rva));
      host.memory.check(target, 1, "execute");
    }
  }
  reserve(): void {
    const clients = this.services.clients;
    if (clients === undefined) throw new Error("Native protection requires canonical clients");
    for (const { actor } of clients.clients()) this.reserveActor(actor);
  }
  reserveActor(actor: ActorId): void {
    this.operations.current();
    if (this.entries.has(actor)) { this.require(actor); return; }
    const client = this.services.clients?.forActor(actor), owner = this.services.actors.resolveOwned(actor);
    if (client === undefined || client === null || owner === null || this.services.clients?.actor(client)?.equals(actor) !== true)
      throw new Error("Native protection requires a live canonical client");
    const inventory = this.services.inventory.entries(actor);
    for (const item of this.inventoryItems()) if (!inventory.some(entry => entry.item === item)) throw new Error("Native protection item has no canonical inventory owner: " + item);
    const reservations: ProtectionReservation[] = [];
    try {
      for (const definition of this.definitions) reservations.push(this.services.combat.reserveProtection(owner, definition.channel, this.claim(definition)));
    } catch (error) {
      const errors: unknown[] = [error];
      for (const reservation of reservations) try { reservation.close(); } catch (failure) { errors.push(failure); }
      throw errors.length === 1 ? error : new AggregateError(errors, "Native protection reservation failed");
    }
    this.entries.set(actor, { client, reservations, bound: false });
  }
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor);
    if (entry === undefined || !this.services.actors.isLive(actor) || this.services.clients?.forActor(actor)?.equals(entry.client) !== true
      || this.services.clients.actor(entry.client)?.equals(actor) !== true) throw new Error("Native protection client is no longer live");
    return entry;
  }
  private source(actor: ActorId): { readonly storage: NativeModArmorState; readonly slot: number } {
    this.operations.current(); this.require(actor);
    if (!this.operations.eligible(actor)) throw new Error("Native protection client has not been admitted");
    const slot = this.operations.slot(actor);
    if (slot === null || this.storage === null || this.host === null || this.host.client(slot) === null) throw new Error("Native protection has no source client record");
    if (!this.host.active(slot)) throw new Error("Native protection requires an active source record retained by original saves");
    return { storage: this.storage, slot };
  }
  private counter(channel: ProtectionChannel, state: ArmorState): Counter | undefined {
    if (channel === "regular" ? state.regular.kind !== "source" : state.powered.kind === "none") return undefined;
    const selection = channel === "regular" && state.regular.kind === "source" ? state.regular.item : state.powered.kind;
    return this.counters.find(counter => counter.channel === channel && counter.selection === selection);
  }
  private read(actor: ActorId): ArmorState {
    const { storage, slot } = this.source(actor), state = storage.read(slot), regular = this.counter("regular", state), power = this.counter("powered", state);
    return { regular: state.regular.kind === "none" || regular?.inventory == null ? state.regular : { ...state.regular, points: this.services.inventory.count(actor, regular.inventory) },
      powered: state.powered.kind === "none" || power?.inventory == null ? state.powered : { ...state.powered, cells: this.services.inventory.count(actor, power.inventory) } };
  }
  private validateWrite(actor: ActorId, channel: ProtectionChannel, next: ArmorState): undefined {
    const { storage, slot } = this.source(actor), current = storage.read(slot);
    if (channel === "powered" && current.powered.kind !== next.powered.kind) throw new Error("Native power activation requires its original source operation");
    storage.validateWrite(slot, channel === "regular" ? { ...current, regular: next.regular } : { ...current, powered: next.powered }); return undefined;
  }
  private write(actor: ActorId, channel: ProtectionChannel, next: ArmorState): undefined {
    this.validateWrite(actor, channel, next);
    this.suppressCurrent(() => this.operations.transfer(() => {
      const { storage, slot } = this.source(actor), current = storage.read(slot);
      storage.write(slot, channel === "regular" ? { ...current, regular: next.regular } : { ...current, powered: next.powered });
    }));
    if (this.services.actors.isLive(actor)) {
      const armor = this.read(actor);
      for (const stage of this.stages) if (stage.actor.equals(actor)) stage.armor = armor;
    }
    return undefined;
  }
  private suppressCurrent<Result>(invoke: () => Result): Result {
    const stages = [...this.stages];
    for (const stage of stages) stage.suppressed++;
    try { return invoke(); }
    finally { for (const stage of stages) stage.suppressed--; }
  }
  bindActor(actor: ActorId): void {
    if (!this.active || !this.operations.eligible(actor)) return;
    const entry = this.require(actor); if (entry.bound) return;
    this.source(actor);
    try { for (const reservation of entry.reservations) {
      const definition = this.definitions.find(definition => definition.channel === reservation.channel);
      if (definition === undefined) throw new Error("Native protection reservation has no declaration");
      const shared = { ...this.claim(definition), inventoryItems: this.inventoryItems(reservation.channel), pickups: this.operations.pickups(actor, reservation.channel) };
      if (reservation.channel === "regular") reservation.bind({ ...shared, channel: "regular", read: () => this.read(actor).regular,
        validateWrite: regular => this.validateWrite(actor, "regular", { ...this.read(actor), regular }),
        write: regular => this.write(actor, "regular", { ...this.read(actor), regular }),
        absorb: (input, observer) => this.absorb(actor, definition, input, observer) });
      else reservation.bind({ ...shared, channel: "powered", read: () => this.read(actor).powered,
        validateWrite: powered => this.validateWrite(actor, "powered", { ...this.read(actor), powered }),
        write: powered => this.write(actor, "powered", { ...this.read(actor), powered }),
        absorb: (input, observer) => this.absorb(actor, definition, input, observer) });
    } entry.bound = true; }
    catch (error) { try { this.release(actor); } catch (failure) { throw new AggregateError([error, failure], "Native protection binding failed"); } throw error; }
  }
  activate(): void { this.reserve(); this.active = true; for (const actor of this.entries.keys()) this.bindActor(actor); }
  prepareRestore(): void { this.close(); this.reserve(); }
  validateRestoredInventory(): void {
    for (const actor of this.entries.keys()) {
      const { storage, slot } = this.source(actor);
      for (const counter of this.counters) if (counter.inventory !== null && storage.readCount(slot, counter.field) !== this.services.inventory.count(actor, counter.inventory))
        throw new Error("Restored native protection count differs from its canonical inventory");
    }
  }
  private absorb(actor: ActorId, definition: NativeModProtectionDefinition, input: ArmorStageInput,
    observer: ProtectionObserver): ArmorStageResult {
    if (!input.request.target.equals(actor)) throw new Error("Native armor stage target differs from its binding");
    const scale = input.flags.regularProtectionScale ?? 1, absorb = definition.absorb;
    if (definition.channel === "regular" && scale !== 1 && (absorb.abi !== "source-call"
      || ![...absorb.call.arguments, ...absorb.call.globals.map(global => global.value)].some(value =>
        (value.kind === "float32" || value.kind === "float64") && value.value.kind === "input" && value.value.name === "regular-protection-scale")))
      throw new Error("Native regular protection scale requires an explicit source input");
    const time = this.services.time();
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["attacker", { kind: "actor", value: input.request.attack.attacker }],
      ["inflictor", { kind: "actor", value: input.request.attack.inflictor }], ["amount", { kind: "float", value: input.amount }],
      ["damage-flags", { kind: "float", value: this.damageFlags(definition, input) }], ["regular-protection-scale", { kind: "float", value: scale }],
      ["point", { kind: "vector", value: input.geometry.point }], ["normal", { kind: "vector", value: input.geometry.normal }],
      ["direction", { kind: "vector", value: input.geometry.direction }], ["knockback", { kind: "float", value: input.request.knockback }],
      ["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }],
    ]);
    const record = this.declaration.entityRecord; if (record === null) throw new Error("Native protection requires a declared source entity");
    const call = this.sourceCall(definition, record, input);
    return { saved: this.observe(actor, observer, () => this.operations.invoke(call, inputs)) };
  }
  observe<Result>(actor: ActorId, observer: ProtectionObserver, invoke: () => Result): Result {
    return this.operations.transfer(() => {
      const { storage, slot } = this.source(actor), stage: Stage = { actor, armor: this.read(actor), suppressed: 0, stop: () => {} };
      this.stages.push(stage);
      try {
        const publish = (): void => {
          if (!this.services.actors.isLive(actor)) return;
          this.source(actor);
          const before = stage.armor, after = this.read(actor);
          const regular = isDeepStrictEqual(before.regular, after.regular) ? undefined : { before: before.regular, after: after.regular };
          const powered = isDeepStrictEqual(before.powered, after.powered) ? undefined : { before: before.powered, after: after.powered };
          for (const active of this.stages) if (active.actor.equals(actor)) active.armor = after;
          if (regular !== undefined) observer.stored({ regular, ...(powered === undefined ? {} : { powered }) });
          else if (powered !== undefined) observer.stored({ powered });
        };
        stage.stop = storage.observe(slot, () => {
          if (this.stages.at(-1) !== stage || stage.suppressed > 0 || !this.services.actors.isLive(actor)) return;
          this.require(actor);
          this.operations.flush({ actor, items: this.inventoryItems(), committed: change => {
            this.source(actor);
            if (change.before === null) throw new Error("Native protection count lost its canonical baseline");
            this.suppressCurrent(() => {
              for (const counter of this.counters) if (counter.inventory === change.after.item && storage.readCount(slot, counter.field) !== change.after.count)
                storage.writeCount(slot, counter.field, change.after.count);
            });
            publish(); return undefined;
          } });
          publish();
        });
        return invoke();
      } finally { stage.stop(); const index = this.stages.indexOf(stage); if (index >= 0) this.stages.splice(index, 1); }
    });
  }
  private damageFlags(definition: NativeModProtectionDefinition, input: ArmorStageInput): number {
    const flags = input.flags, classic = this.declaration.target.api.kind === "q2-classic-game";
    return (input.request.delivery === "radius" ? 1 : 0)
      | (flags.noArmor || classic && (definition.channel === "powered" ? flags.noPowerArmor : flags.noRegularArmor) ? 2 : 0)
      | (flags.energy ? 4 : 0) | (flags.noRegularArmor ? 128 : 0) | (!classic && flags.noPowerArmor ? 256 : 0);
  }
  private sourceCall(definition: NativeModProtectionDefinition, record: string, input: ArmorStageInput): NativeModSourceCall {
    const absorb = definition.absorb;
    if (absorb.abi === "source-call") return absorb.call;
    const lowered = this.damageFlags(definition, input);

    return { entry: absorb.entry, globals: absorb.globals ?? [], returns: "int32",
      arguments: [{ kind: "actor", record, input: "self" }, { kind: "vector", value: { kind: "input", name: "point" } },
        { kind: "vector", value: { kind: "input", name: "normal" } }, { kind: "int32", value: { kind: "input", name: "amount" } },
        ...(absorb.abi === "q2-check-armor" ? [{ kind: "int32", value: { kind: "float", value: absorb.sparks } } satisfies NativeModSourceCall["arguments"][number]] : []),
        { kind: "int32", value: { kind: "float", value: lowered } }] };
  }
  release(actor: ActorId): void {
    for (const stage of this.stages) if (stage.actor.equals(actor)) stage.stop();
    const entry = this.entries.get(actor); if (entry === undefined) return;
    const errors: unknown[] = [];
    try { for (const reservation of entry.reservations) try { reservation.close(); } catch (error) { errors.push(error); } }
    finally { this.entries.delete(actor); }
    if (errors.length > 0) throw new AggregateError(errors, "Native protection release failed");
  }
  close(): void {
    this.active = false; const errors: unknown[] = [];
    for (const actor of [...this.entries.keys()]) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length > 0) throw new AggregateError(errors, "Native protection close failed");
  }
}
