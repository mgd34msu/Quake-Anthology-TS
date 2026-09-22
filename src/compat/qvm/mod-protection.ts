import type { ActorId, ClientId, ProviderId } from "../../contracts/identity.ts";
import type { ArmorStageInput, ArmorStageResult, ProtectionChannel, ProtectionObserver, RegularArmorState, PoweredProtectionState } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { QvmModCallbackDeclaration, QvmModProtection as QvmModProtectionDefinition, QvmModProtectionScalar, QvmModProtectionSelection, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ProtectionClaim, ProtectionReservation } from "../../world/gameplay/authority.ts";
import type { QvmModule } from "./module.ts";

function fields(definition: QvmModProtectionDefinition): readonly QvmModProtectionScalar[] {
  return definition.channel === "regular" ? [definition.storage.points, ...(definition.storage.selection === undefined ? [] : [definition.storage.selection.field])]
    : [definition.storage.cells, definition.storage.selection.field];
}
export function validateQvmModProtection(declaration: QvmModCallbackDeclaration): void {
  const channels = new Set<ProtectionChannel>(), ids = new Set<string>(), occupied = new Set<string>();
  for (const definition of declaration.protection ?? []) {
    if (declaration.clients === undefined || channels.has(definition.channel) || ids.has(definition.id) || definition.id.length === 0)
      throw new Error("QVM protection requires unique channels and rules with source client admission");
    channels.add(definition.channel); ids.add(definition.id);
    if (definition.absorb.returns === "void") throw new Error("QVM protection requires original source savings");
    for (const mask of Object.values(definition.flags)) if (!Number.isInteger(mask) || mask < 0 || mask > 0x7fffffff) throw new Error("Invalid QVM protection flag mask");
    const storage = fields(definition);
    for (const field of storage) {
      const record = declaration.actorRecords.find(record => record.id === field.record), key = `${field.record}:${field.offset}`;
      if (record === undefined || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset % 4 !== 0 || field.offset + 4 > record.stride
        || occupied.has(key)) throw new Error("Invalid QVM protection source storage");
      occupied.add(key);
      for (const value of record.fields) {
        const width = value.binding === "private" ? value.byteLength : ["origin", "velocity", "angles", "bounds-min", "bounds-max", "constant-vector"].includes(value.binding) ? 12 : 4;
        if (value.offset < field.offset + 4 && field.offset < value.offset + width && value.binding !== "private" && value.binding !== "constant")
          throw new Error("QVM protection storage overlaps a shared or linked source field");
      }
    }
    const selection = definition.storage.selection;
    if (selection !== undefined) {
      if (selection.mask !== null && (!Number.isInteger(selection.mask) || selection.mask < 0 || selection.mask > 0x7fffffff)) throw new Error("Invalid QVM protection selection mask");
      const values = new Set<number>();
      for (const entry of selection.values) {
        if (!Number.isFinite(entry.value) || values.has(entry.value) || selection.mask !== null && (!Number.isInteger(entry.value) || (entry.value & selection.mask) !== entry.value))
          throw new Error("Invalid QVM protection selection");
        values.add(entry.value);
      }
      if (values.size === 0) throw new Error("Empty QVM protection selection");
    }
  }
}
interface Entry { readonly client: ClientId; readonly reservation: ProtectionReservation; bound: boolean; }
interface Stage { readonly actor: ActorId; stop(): void; }
interface Component { readonly channels: QvmModProtection[]; readonly stages: Stage[]; }
interface Operations {
  current(): void;
  eligible(actor: ActorId): boolean;
  pointer(actor: ActorId, record: string): number;
  invoke(call: QvmModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
}

/** One source client and its original storage own each admitted protection channel. */
export class QvmModProtection {
  private readonly entries = new Map<ActorId, Entry>();
  private active = false;
  private readonly claim: ProtectionClaim;
  private constructor(private readonly definition: QvmModProtectionDefinition, private readonly module: QvmModule,
    private readonly services: ModHostServices, owner: ProviderId, private readonly operations: Operations, private readonly component: Component) {
    this.claim = { owner, rule: definition.id, admission: definition.admission };
  }
  static create(definitions: readonly QvmModProtectionDefinition[], module: QvmModule, services: ModHostServices,
    owner: ProviderId, operations: Operations): readonly QvmModProtection[] {
    const component: Component = { channels: [], stages: [] };
    for (const definition of definitions) component.channels.push(new QvmModProtection(definition, module, services, owner, operations, component));
    return component.channels;
  }
  get isActive(): boolean { return this.active; }
  reserve(): void {
    if (this.services.clients === undefined) throw new Error("QVM protection requires canonical clients");
    for (const identity of this.services.clients.clients()) this.reserveActor(identity.actor);
  }
  reserveActor(actor: ActorId): void {
    this.operations.current();
    if (this.entries.has(actor)) { this.require(actor); return; }
    const client = this.services.clients?.forActor(actor), owned = this.services.actors.resolveOwned(actor);
    if (client == null || owned === null || this.services.clients?.actor(client)?.equals(actor) !== true) throw new Error("QVM protection requires a live canonical client");
    const reservation = this.services.combat.reserveProtection(owned, this.definition.channel, this.claim);
    this.entries.set(actor, { client, reservation, bound: false });
  }
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor);
    if (entry === undefined || !this.services.actors.isLive(actor) || this.services.clients?.forActor(actor)?.equals(entry.client) !== true
      || this.services.clients.actor(entry.client)?.equals(actor) !== true) throw new Error("QVM protection client is no longer live");
    return entry;
  }
  private address(actor: ActorId, field: QvmModProtectionScalar): number {
    this.operations.current(); this.require(actor);
    if (!this.operations.eligible(actor)) throw new Error("QVM protection requires admitted source client storage");
    return this.operations.pointer(actor, field.record) + field.offset;
  }
  private scalar(actor: ActorId, field: QvmModProtectionScalar): number {
    const view = this.module.memory.dataView(this.address(actor, field), 4);
    return field.encoding === "int32" ? view.getInt32(0, true) : view.getFloat32(0, true);
  }
  private count(actor: ActorId, field: QvmModProtectionScalar): number {
    const value = this.scalar(actor, field);
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid QVM protection count");
    return value;
  }
  private selected<Value>(actor: ActorId, selection: QvmModProtectionSelection<Value>): Value {
    const source = this.scalar(actor, selection.field), value = selection.mask === null ? source : Math.trunc(source) & selection.mask;
    const selected = selection.values.find(entry => entry.value === value);
    if (selected === undefined) throw new Error("QVM protection source selection is undeclared");
    return selected.selected;
  }
  private regular(actor: ActorId): RegularArmorState {
    if (this.definition.channel !== "regular") throw new Error("QVM protection does not own regular armor");
    const { storage } = this.definition;
    return { kind: "source", points: this.count(actor, storage.points), item: storage.selection === undefined ? storage.item : this.selected(actor, storage.selection) };
  }
  private powered(actor: ActorId): PoweredProtectionState {
    if (this.definition.channel !== "powered") throw new Error("QVM protection does not own powered armor");
    const kind = this.selected(actor, this.definition.storage.selection);
    return kind === "none" ? { kind } : { kind, cells: this.count(actor, this.definition.storage.cells) };
  }
  private validateCount(field: QvmModProtectionScalar, count: number): void {
    if (!Number.isFinite(count) || count < 0 || field.encoding === "int32" && (!Number.isInteger(count) || count > 0x7fffffff)
      || field.encoding === "float32" && !Number.isFinite(Math.fround(count))) throw new Error("Protection count is not representable by its QVM source storage");
  }
  private validateRegular(actor: ActorId, next: RegularArmorState): undefined {
    const current = this.regular(actor);
    if (this.definition.channel !== "regular" || next.kind !== "source" || current.kind !== "source" || current.item !== next.item)
      throw new Error("QVM regular armor selection requires its original source operation");
    this.validateCount(this.definition.storage.points, next.points); return undefined;
  }
  private validatePowered(actor: ActorId, next: PoweredProtectionState): undefined {
    const current = this.powered(actor);
    if (this.definition.channel !== "powered" || current.kind !== next.kind) throw new Error("QVM powered armor selection requires its original source operation");
    if (next.kind !== "none") this.validateCount(this.definition.storage.cells, next.cells); return undefined;
  }
  private write(actor: ActorId, field: QvmModProtectionScalar, value: number): undefined {
    const view = this.module.memory.dataView(this.address(actor, field), 4);
    if (field.encoding === "int32") view.setInt32(0, value, true); else view.setFloat32(0, value, true);
    return undefined;
  }
  bindActor(actor: ActorId): void {
    if (!this.active || !this.operations.eligible(actor)) return;
    const entry = this.require(actor); if (entry.bound) return;
    if (entry.reservation.channel === "regular") {
      this.regular(actor);
      entry.reservation.bind({ ...this.claim, channel: "regular", inventoryItems: [], read: () => this.regular(actor), validateWrite: next => this.validateRegular(actor, next),
        write: next => {
          this.validateRegular(actor, next);
          if (this.definition.channel !== "regular" || next.kind !== "source") throw new Error("Missing QVM regular source storage");
          return this.write(actor, this.definition.storage.points, next.points);
        }, absorb: (input, observer) => this.absorb(actor, input, observer) });
    } else {
      this.powered(actor);
      entry.reservation.bind({ ...this.claim, channel: "powered", inventoryItems: [], read: () => this.powered(actor), validateWrite: next => this.validatePowered(actor, next),
        write: next => {
          this.validatePowered(actor, next);
          if (this.definition.channel !== "powered") throw new Error("Missing QVM powered source storage");
          return next.kind === "none" ? undefined : this.write(actor, this.definition.storage.cells, next.cells);
        }, absorb: (input, observer) => this.absorb(actor, input, observer) });
    }
    entry.bound = true;
  }
  activate(): void { this.reserve(); this.active = true; this.sync(); }
  sync(): void { if (this.active) for (const actor of this.entries.keys()) this.bindActor(actor); }
  private absorb(actor: ActorId, input: ArmorStageInput, observer: ProtectionObserver): ArmorStageResult {
    if (!input.request.target.equals(actor)) throw new Error("QVM protection target differs from its source owner");
    this.require(actor);
    const stage: Stage = { actor, stop: () => {} }, masks = this.definition.flags, flags = input.flags;
    const scale = flags.regularProtectionScale ?? 1;
    if (this.definition.channel === "regular" && scale !== 1 && ![...this.definition.absorb.arguments, ...this.definition.absorb.globals.map(global => global.value)]
      .some(value => (value.kind === "int32" || value.kind === "float32") && value.value.kind === "input" && value.value.name === "regular-protection-scale"))
      throw new Error("QVM regular protection scale has no declared source lowering");
    const lowered = (flags.noArmor ? masks.noArmor : 0) | (flags.noPowerArmor ? masks.noPowerArmor : 0)
      | (flags.noRegularArmor ? masks.noRegularArmor : 0) | (flags.energy ? masks.energy : 0) | (input.request.delivery === "radius" ? masks.radius : 0);
    const time = this.services.time();
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["attacker", { kind: "actor", value: input.request.attack.attacker }],
      ["inflictor", { kind: "actor", value: input.request.attack.inflictor }], ["amount", { kind: "float", value: input.amount }],
      ["knockback", { kind: "float", value: input.request.knockback }], ["damage-flags", { kind: "float", value: lowered }],
      ["regular-protection-scale", { kind: "float", value: scale }],
      ["point", { kind: "vector", value: input.geometry.point }], ["direction", { kind: "vector", value: input.geometry.direction }],
      ["normal", { kind: "vector", value: input.geometry.normal }], ["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }],
    ]);
    const channels = this.component.channels.filter(channel => channel.entries.get(actor)?.bound === true);
    const regular = channels.find(channel => channel.definition.channel === "regular"), powered = channels.find(channel => channel.definition.channel === "powered");
    let beforeRegular = regular?.regular(actor), beforePowered = powered?.powered(actor);
    const ranges = channels.flatMap(channel => fields(channel.definition).map(field => ({ byteOffset: channel.address(actor, field), byteLength: 4 })));
    this.component.stages.push(stage);
    try {
      stage.stop = this.module.memory.observeWrites(ranges, () => {
        if (!this.services.actors.isLive(actor) || !this.entries.has(actor)) return undefined;
        const afterRegular = regular?.regular(actor), afterPowered = powered?.powered(actor);
        const regularChange = beforeRegular !== undefined && afterRegular !== undefined && (beforeRegular.kind !== afterRegular.kind
          || beforeRegular.kind === "source" && afterRegular.kind === "source" && (beforeRegular.points !== afterRegular.points || beforeRegular.item !== afterRegular.item))
          ? { before: beforeRegular, after: afterRegular } : undefined;
        const poweredChange = beforePowered !== undefined && afterPowered !== undefined && (beforePowered.kind !== afterPowered.kind
          || beforePowered.kind !== "none" && afterPowered.kind !== "none" && beforePowered.cells !== afterPowered.cells)
          ? { before: beforePowered, after: afterPowered } : undefined;
        beforeRegular = afterRegular; beforePowered = afterPowered;
        let current: Stage | undefined;
        for (const entry of this.component.stages) if (entry.actor.equals(actor)) current = entry;
        if (current === stage) {
          if (regularChange !== undefined) observer.stored({ regular: regularChange, ...(poweredChange === undefined ? {} : { powered: poweredChange }) });
          else if (poweredChange !== undefined) observer.stored({ powered: poweredChange });
        }
        return undefined;
      });
      const saved = this.operations.invoke(this.definition.absorb, inputs);
      if (this.entries.has(actor) && this.services.actors.isLive(actor)) this.require(actor);
      return { saved };
    } finally { stage.stop(); const index = this.component.stages.indexOf(stage); if (index >= 0) this.component.stages.splice(index, 1); }
  }
  assertIdle(): void { if (this.component.stages.length !== 0) throw new Error("Cannot save or restore during QVM protection absorption"); }
  release(actor: ActorId): void {
    for (const stage of this.component.stages) if (stage.actor.equals(actor)) stage.stop();
    const entry = this.entries.get(actor); if (entry === undefined) return;
    try { entry.reservation.close(); } finally { this.entries.delete(actor); }
  }
  close(): void {
    this.active = false;
    const errors: unknown[] = [];
    for (const actor of [...this.entries.keys()]) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QVM protection cleanup failed");
  }
}
