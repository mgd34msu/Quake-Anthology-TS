import type { GuestAddress } from "../../contracts/execution.ts";
import type { ActorId, ClientId, ProviderId } from "../../contracts/identity.ts";
import type { ArmorStageInput, ArmorStageObserver, ArmorStageResult, ItemId, PoweredProtectionState } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModDeclaration, NativeModPoweredProtection, NativeModScalarField, NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { PoweredProtectionClaim, PoweredProtectionReservation } from "../../world/gameplay/authority.ts";
import type { InventoryCommittedChange } from "../../world/gameplay/inventory.ts";
import { NativeModArmorState } from "./native-mod-armor.ts";

interface Entry { readonly client: ClientId; readonly reservation: PoweredProtectionReservation; bound: boolean; }
interface Stage { readonly actor: ActorId; stop(): void; }
export interface NativePowerFuelCommit {
  readonly actor: ActorId;
  readonly item: ItemId;
  committed(change: InventoryCommittedChange): undefined;
}
interface Operations {
  current(): void;
  slot(actor: ActorId): number | null;
  eligible(actor: ActorId): boolean;
  scalar(base: GuestAddress, field: NativeModScalarField, value?: number): number;
  transfer<Result>(invoke: () => Result): Result;
  flush(fuel?: NativePowerFuelCommit): void;
  invoke(call: NativeModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
}

/** Independent client power uses original storage and the original absorption leaf. */
export class NativeModProtection {
  private readonly entries = new Map<ActorId, Entry>();
  private readonly fuels = new Map<"screen" | "shield", ItemId>();
  private readonly stages: Stage[] = [];
  private host: NativeModHost | null = null;
  private storage: NativeModArmorState | null = null;
  private active = false;
  private readonly suppressed = new Map<Stage, number>();
  private readonly claim: PoweredProtectionClaim;
  constructor(private readonly definition: NativeModPoweredProtection, private readonly declaration: NativeModDeclaration,
    private readonly services: ModHostServices, instance: ProviderId, private readonly operations: Operations) {
    this.claim = { owner: instance, rule: definition.id, admission: definition.admission ?? { kind: "claim" } };
    for (const item of definition.storage) {
      const record = declaration.actorRecords.find(record => record.id === item.cells.record);
      const field = record?.fields.find(field => field.binding === "inventory" && field.offset === item.cells.offset && field.encoding === item.cells.encoding);
      if (field?.binding !== "inventory") throw new Error("Native power fuel requires one declared canonical inventory field");
      this.fuels.set(item.kind, field.item);
    }
  }
  attach(host: NativeModHost): void {
    this.host = host;
    this.storage = new NativeModArmorState({ kind: "q2", regular: [], power: this.definition.storage }, this.declaration, host, this.operations.scalar);
    const entry = this.definition.absorb.entry;
    const target = entry.kind === "export" ? host.entry(entry.name) : host.memory.offset(host.imageBase, BigInt(entry.rva));
    host.memory.check(target, 1, "execute");
  }
  reserve(): void {
    const clients = this.services.clients;
    if (clients === undefined) throw new Error("Native powered protection requires canonical clients");
    for (const { actor } of clients.clients()) this.reserveActor(actor);
  }
  reserveActor(actor: ActorId): void {
    this.operations.current();
    if (this.entries.has(actor)) { this.require(actor); return; }
    const client = this.services.clients?.forActor(actor), owner = this.services.actors.resolveOwned(actor);
    if (client === undefined || client === null || owner === null || this.services.clients?.actor(client)?.equals(actor) !== true)
      throw new Error("Native powered protection requires a live canonical client");
    const inventory = this.services.inventory.entries(actor);
    for (const fuel of this.fuels.values()) if (!inventory.some(entry => entry.item === fuel)) throw new Error(`Native power fuel ${fuel} has no canonical inventory owner`);
    const reservation = this.services.combat.reservePoweredProtection(owner, this.claim);
    this.entries.set(actor, { client, reservation, bound: false });
  }
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor);
    if (entry === undefined || !this.services.actors.isLive(actor) || this.services.clients?.forActor(actor)?.equals(entry.client) !== true
      || this.services.clients.actor(entry.client)?.equals(actor) !== true) throw new Error("Native powered protection client is no longer live");
    return entry;
  }
  private source(actor: ActorId): { readonly storage: NativeModArmorState; readonly slot: number } {
    this.operations.current(); this.require(actor);
    if (!this.operations.eligible(actor)) throw new Error("Native powered protection client has not been admitted");
    const slot = this.operations.slot(actor);
    if (slot === null || this.storage === null || this.host === null || this.host.client(slot) === null) throw new Error("Native powered protection has no source client record");
    if (!this.host.active(slot)) throw new Error("Native powered protection requires an active source record retained by original saves");
    return { storage: this.storage, slot };
  }
  private read(actor: ActorId): PoweredProtectionState {
    const { storage, slot } = this.source(actor), power = storage.read(slot).powered;
    if (power.kind === "none") return power;
    const fuel = this.fuels.get(power.kind); if (fuel === undefined) throw new Error("Native power fuel declaration is unavailable");
    return { ...power, cells: this.services.inventory.count(actor, fuel) };
  }
  private validateWrite(actor: ActorId, next: PoweredProtectionState): undefined {
    const { storage, slot } = this.source(actor);
    if (storage.read(slot).powered.kind !== next.kind) throw new Error("Native power activation requires its original source operation");
    storage.validateWrite(slot, { regular: { kind: "none" }, powered: next }); return undefined;
  }
  private write(actor: ActorId, next: PoweredProtectionState): undefined {
    this.validateWrite(actor, next);
    this.suppressCurrent(() => this.operations.transfer(() => { const { storage, slot } = this.source(actor); storage.write(slot, { regular: { kind: "none" }, powered: next }); }));
    return undefined;
  }
  private suppressCurrent<Result>(invoke: () => Result): Result {
    const stages = [...this.stages];
    for (const stage of stages) this.suppressed.set(stage, (this.suppressed.get(stage) ?? 0) + 1);
    try { return invoke(); }
    finally { for (const stage of stages) { const count = (this.suppressed.get(stage) ?? 1) - 1; if (count === 0) this.suppressed.delete(stage); else this.suppressed.set(stage, count); } }
  }
  bindActor(actor: ActorId): void {
    if (!this.active || !this.operations.eligible(actor)) return;
    const entry = this.require(actor); if (entry.bound) return;
    this.source(actor);
    entry.reservation.bind({ ...this.claim, fuelItems: [...new Set(this.fuels.values())], read: () => this.read(actor), validateWrite: next => this.validateWrite(actor, next),
      write: next => this.write(actor, next), absorb: (input, observer) => this.absorb(actor, input, observer) });
    entry.bound = true;
  }
  activate(): void { this.reserve(); this.active = true; for (const actor of this.entries.keys()) this.bindActor(actor); }
  prepareRestore(): void { this.close(); this.reserve(); }
  validateRestoredFuel(): void {
    for (const actor of this.entries.keys()) {
      const { storage, slot } = this.source(actor);
      for (const [kind, item] of this.fuels) if (storage.readPowerCells(slot, kind) !== this.services.inventory.count(actor, item))
        throw new Error("Restored native power fuel differs from its canonical inventory");
    }
  }
  private absorb(actor: ActorId, input: ArmorStageInput, observer: ArmorStageObserver): ArmorStageResult {
    if (!input.request.target.equals(actor)) throw new Error("Native power stage target differs from its binding");
    return this.operations.transfer(() => {
      const { storage, slot } = this.source(actor), stage: Stage = { actor, stop: () => {} };
      const flags = input.flags, classic = this.definition.absorb.flags === "q2-classic";
      const loweredFlags = (input.request.delivery === "radius" ? 1 : 0) | (flags.noArmor || classic && flags.noPowerArmor ? 2 : 0)
        | (flags.energy ? 4 : 0) | (flags.noRegularArmor ? 128 : 0) | (!classic && flags.noPowerArmor ? 256 : 0);
      const time = this.services.time();
      const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
        ["self", { kind: "actor", value: actor }], ["amount", { kind: "float", value: input.amount }],
        ["point", { kind: "vector", value: input.request.point }], ["normal", { kind: "vector", value: input.request.normal }],
        ["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }],
      ]);
      const record = this.declaration.entityRecord; if (record === null) throw new Error("Native power requires a declared source entity");
      const call: NativeModSourceCall = { entry: this.definition.absorb.entry, globals: this.definition.absorb.globals ?? [], returns: "int32",
        arguments: [{ kind: "actor", record, input: "self" }, { kind: "vector", value: { kind: "input", name: "point" } },
          { kind: "vector", value: { kind: "input", name: "normal" } }, { kind: "int32", value: { kind: "input", name: "amount" } },
          { kind: "int32", value: { kind: "float", value: loweredFlags } }] };
      this.stages.push(stage);
      try {
        stage.stop = storage.observe(slot, (before, after) => {
          if (this.stages.at(-1) !== stage || this.suppressed.has(stage) || !this.services.actors.isLive(actor)) return;
          this.require(actor);
          const power = before.powered.kind === "none" ? after.powered : before.powered, fuel = power.kind === "none" ? undefined : this.fuels.get(power.kind);
          let committed = false;
          this.operations.flush(fuel === undefined ? undefined : { actor, item: fuel, committed: change => {
            this.source(actor);
            if (change.before === null) throw new Error("Native power fuel lost its canonical baseline");
            if (power.kind === "none") throw new Error("Inactive native power cannot publish a fuel stage");
            this.suppressCurrent(() => storage.writePowerCells(slot, power.kind, change.after.count));
            this.source(actor);
            const current = storage.read(slot).powered;
            observer.stored({ before: before.powered.kind === "none" ? before.powered : { ...before.powered, cells: change.before.count }, after: current });
            committed = true; return undefined;
          } });
          if (!committed && this.services.actors.isLive(actor)) {
            this.source(actor); observer.stored({ before: before.powered, after: storage.read(slot).powered });
          }
        });
        return { saved: this.operations.invoke(call, inputs) };
      } finally { stage.stop(); const index = this.stages.indexOf(stage); if (index >= 0) this.stages.splice(index, 1); }
    });
  }
  release(actor: ActorId): void {
    for (const stage of this.stages) if (stage.actor.equals(actor)) stage.stop();
    const entry = this.entries.get(actor); if (entry === undefined) return; this.entries.delete(actor); entry.reservation.close();
  }
  close(): void { this.active = false; for (const actor of [...this.entries.keys()]) this.release(actor); }
}
