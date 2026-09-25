import { resolveItemIcon } from "../../content/item-icon.ts";
import { sourceItemActionNames } from "../../contracts/source-items.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { SourceItemAdmission, SourceItemLease, SourceItemStore, SourceWeaponBinding, SourceWeaponRequest } from "../../contracts/source-items.ts";
import { SourceItemRetired } from "../../contracts/source-items.ts";
import type { QvmItemCapacity, QvmItemField, QvmItemStorage, QvmModItems as Declaration } from "../../contracts/qvm-mod-items.ts";
import type { QvmModCallbackDeclaration, QvmModInputPointer, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import type { QvmModule } from "./module.ts";
import type { QvmCommittedWrite } from "./memory-writes.ts";
import type { OriginalPickupExecution } from "../../contracts/original-pickups.ts";
import { QvmOpcode, type QvmImage } from "./image.ts";
import { QvmModWeaponStage, validateQvmWeaponStage } from "./mod-weapon-stage.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";

interface Operations {
  pointer(actor: ActorId, record: string): number;
  live(actor: ActorId): boolean;
  invoke(actor: ActorId, call: QvmModSourceCall): number;
  ground(actor: ActorId): number;
  pickup(): OriginalPickupExecution | undefined;
}
interface Request { readonly id: number; readonly item: ItemId | null; status: "pending" | "accepted" | "refused"; attempted: boolean; }
interface Entry {
  readonly actor: OwnedActor;
  readonly addresses: ReadonlyMap<string, number>;
  readonly lease: SourceItemLease;
  readonly unobserve: () => undefined;
  removeWeapon: () => undefined;
  request: Request | null;
}
function key(field: QvmItemField): string { return `${field.record}:${field.offset}`; }
function fields(storage: QvmItemStorage): readonly QvmItemField[] {
  return storage.kind === "counter" && storage.capacity.kind === "field" ? [storage.field, storage.capacity.field] : [storage.field];
}
function integer(value: number): boolean { return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647; }
function constant(image: QvmImage, instruction: number): number {
  const value = image.instructions[instruction];
  if (value?.opcode !== QvmOpcode.OP_CONST || value.operand < 0) throw new Error("QVM item capacity is not its declared original constant");
  return value.operand;
}
export function validateQvmModItems(items: Declaration, declaration: QvmModCallbackDeclaration, image: QvmImage): void {
  if (declaration.clients === undefined || items.definitions.length === 0) throw new Error("QVM items require source client admission");
  const definitions = new Map(items.definitions.map(value => [value.item, value]));
  if (definitions.size !== items.definitions.length) throw new Error("Duplicate QVM source item definition");
  const occupied = new Set<string>(), bound = new Set<ItemId>();
  const field = (source: QvmItemField, exclusive = true): void => {
    const record = declaration.actorRecords.find(value => value.id === source.record);
    if (record === undefined || !declaration.clients?.records.includes(record.id) || !Number.isSafeInteger(source.offset)
      || source.offset < 0 || source.offset % 4 !== 0 || source.offset + 4 > record.stride || exclusive && occupied.has(key(source))) throw new Error("Invalid QVM item source field");
    if (exclusive) occupied.add(key(source));
    for (const value of record.fields) {
      const length = value.binding === "private" ? value.byteLength : ["origin", "velocity", "angles", "bounds-min", "bounds-max", "constant-vector"].includes(value.binding) ? 12 : 4;
      if (value.offset < source.offset + 4 && source.offset < value.offset + length && value.binding !== "private" && value.binding !== "constant")
        throw new Error("QVM item field overlaps another canonical source projection");
    }
  };
  const bind = (item: ItemId): void => { if (!definitions.has(item) || bound.has(item)) throw new Error("QVM item lacks distinct declared storage"); bound.add(item); };
  for (const storage of items.storage) {
    for (const value of fields(storage)) field(value);
    if (storage.kind === "counter") {
      bind(storage.item);
      const capacity = storage.capacity;
      if (capacity.kind === "constant" && (!integer(capacity.value) || capacity.value < 0)) throw new Error("QVM item capacity exceeds its source ABI");
      if (capacity.kind === "source") {
        constant(image, capacity.instruction);
        for (const value of capacity.overrides) {
          constant(image, value.instruction);
          if (!integer(value.value) || !Number.isInteger(value.address) || value.address < 0 || value.address % 4 !== 0
            || value.address + 4 > image.initializedData.length + image.bssLength) throw new Error("QVM capacity selector exceeds original source storage");
        }
      }
    } else {
      if (!Number.isInteger(storage.privateMask) || storage.privateMask < 0 || storage.privateMask > 0xffffffff || storage.items.length === 0) throw new Error("Invalid QVM private inventory mask");
      let mask = storage.privateMask;
      for (const value of storage.items) {
        bind(value.item);
        if (!Number.isInteger(value.mask) || value.mask < 1 || value.mask > 0x80000000 || (value.mask & (value.mask - 1)) !== 0 || (mask & value.mask) !== 0)
          throw new Error("QVM packed item masks overlap");
        mask |= value.mask;
      }
    }
  }
  if (bound.size !== definitions.size) throw new Error("QVM item definition has no source storage");
  const weapons = items.definitions.filter(value => value.kind === "weapon");
  if (weapons.length === 0 ? items.weapons !== undefined : items.weapons === undefined) throw new Error("QVM weapon items require an original source consumer");
  if (items.weapons !== undefined) {
    const stage = items.weapons.stage; validateQvmWeaponStage(stage, image);
    const pointer = (source: QvmModInputPointer): void => {
      if (source.kind === "argument" ? !Number.isInteger(source.index) || source.index < 0 || source.index > 9
        : !Number.isInteger(source.address) || source.address < 0 || source.address % 4 !== 0 || source.address + 4 > image.initializedData.length + image.bssLength)
        throw new Error("QVM weapon pointer exceeds its original call ABI");
      for (const value of [...source.indirections, source.offset]) if (!Number.isSafeInteger(value) || value < 0 || value % 4 !== 0)
        throw new Error("QVM weapon pointer is not aligned source storage");
    };
    for (const source of [stage.dispatcher.actor, stage.continuation.actor]) {
      if (!declaration.clients.records.includes(source.record)) throw new Error("QVM weapon pointer is not an admitted client record");
      pointer(source.pointer);
    }
    const projection = stage.continuation.projection; pointer(projection.movement);
    if (!Number.isSafeInteger(projection.byteLength) || projection.byteLength < 12 || projection.byteLength % 4 !== 0)
      throw new Error("QVM weapon movement projection lacks its caller layout");
    for (const offset of [projection.minimum, projection.maximum]) if (!Number.isSafeInteger(offset) || offset < 0 || offset % 4 !== 0 || offset + 12 > projection.byteLength)
      throw new Error("QVM weapon bounds exceed their original caller storage");
    if (Math.abs(projection.minimum - projection.maximum) < 12) throw new Error("QVM weapon caller bounds overlap");
    const entry = items.weapons.input.entry;
    const inputs = declaration.clients.input?.flatMap(value => value.calls.filter(call => call.entry === entry).map(() => value)) ?? [];
    if (image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER
      || inputs.length !== 1 || inputs[0]?.scope !== "movement-slice" || inputs[0].phase !== "after")
      throw new Error("QVM weapon input requires one declared original callback after authoritative movement");
    field(stage.selection.field, false); field(items.weapons.input.clock, false);
    field(stage.continuation.projection.viewHeight, false); field(stage.continuation.projection.ground, false);
    for (const value of [...stage.settled, ...stage.request.accepted, ...stage.continuation.when]) {
      field(value.field, false);
      if (!integer(value.value) || value.mask !== null && (!Number.isInteger(value.mask) || value.mask < 0 || value.mask > 0x7fffffff)) throw new Error("Invalid QVM weapon source state predicate");
    }
    if (stage.selection.values.length !== weapons.length || new Set(stage.selection.values.map(value => value.item)).size !== weapons.length
      || new Set(stage.selection.values.map(value => value.value)).size !== weapons.length
      || stage.selection.values.some(value => !integer(value.value) || value.value < 1 || !weapons.some(weapon => weapon.item === value.item))) throw new Error("QVM weapon selection differs from its admitted definitions");
    for (const weapon of weapons) if (weapon.ammo !== null && !definitions.has(weapon.ammo)) throw new Error("QVM weapon ammo lacks its source storage");
  }
}

/** Canonical inventory borrows actual original words; source writes publish without replay. */
export class QvmModItems {
  readonly weapons: QvmModWeaponStage | null;
  private readonly entries = new Map<ActorId, Entry>();
  private readonly admissions: readonly SourceItemAdmission[];
  private readonly byItem: ReadonlyMap<ItemId, QvmItemStorage>;
  private nextRequest = 0;
  private readonly applied = new WeakSet<ModClientApplication>();
  constructor(private readonly definition: Declaration, private readonly module: QvmModule, private readonly image: QvmImage,
    private readonly services: ModHostServices, private readonly provider: ProviderId, private readonly content: ContentId, private readonly operations: Operations) {
    this.admissions = definition.definitions.map(({ admission, actions, icon, ...item }) => ({ admission, definition: { ...item, source: { provider, content }, ...(icon === undefined ? {} : { icon: icon === null ? null : resolveItemIcon(icon, content) }), ...(actions === undefined ? {} : { actions: sourceItemActionNames(actions) }) } }));
    this.byItem = new Map(definition.storage.flatMap(storage => (storage.kind === "counter" ? [storage.item] : storage.items.map(value => value.item))
      .map(item => [item, storage] satisfies readonly [ItemId, QvmItemStorage])));
    this.weapons = definition.weapons === undefined ? null : new QvmModWeaponStage(definition.weapons.stage, definition.weapons.input.entry, { module, ...operations,
      live: actor => { const entry = this.entries.get(actor); return entry !== undefined && this.current(entry); },
      posture: actor => {
        const body = services.bodies.read(actor), client = services.clients?.forActor(actor), view = client == null ? undefined : services.clients?.playerView?.(client);
        if (body === null || view === undefined) throw new Error("QVM weapon input requires the actual authoritative posture");
        return { bounds: body.bounds, viewHeight: view.viewOffset.z, ground: operations.ground(actor) };
      },
      selected: actor => services.weapons?.selected(actor, provider) === true,
      attempted: (actor, value) => { const request = this.entries.get(actor)?.request; if (request?.status === "pending" && this.value(request.item) === value) request.attempted = true; },
      accepted: (actor, value) => { const request = this.entries.get(actor)?.request; if (request?.status === "pending" && this.value(request.item) === value) request.status = "accepted"; },
      completed: actor => { const request = this.entries.get(actor)?.request;
        if (request?.status === "pending") {
          if (this.weapons?.active(actor) === request.item) request.status = "accepted";
          else if (request.attempted) request.status = "refused";
        }
      },
    });
  }
  private address(actor: ActorId, field: QvmItemField): number { return this.operations.pointer(actor, field.record) + field.offset; }
  private scalar(address: number, previous?: QvmCommittedWrite): number {
    if (previous === undefined) return this.module.memory.dataView(address, 4).getInt32(0, true);
    const bytes = this.module.memory.bytes.slice(address, address + 4);
    for (const range of previous.ranges) for (let index = 0; index < range.before.length; index++) {
      const target = range.byteOffset + index - address, value = range.before[index];
      if (target >= 0 && target < 4 && value !== undefined) bytes[target] = value;
    }
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
  }
  private capacity(actor: ActorId, capacity: QvmItemCapacity, previous?: QvmCommittedWrite): number {
    if (capacity.kind === "constant") return capacity.value;
    if (capacity.kind === "field") return this.scalar(this.address(actor, capacity.field), previous);
    for (const value of capacity.overrides) {
      const current = this.scalar(value.address, previous), matches = current === value.value;
      if (value.comparison === "equals" ? matches : !matches) return constant(this.image, value.instruction);
    }
    return constant(this.image, capacity.instruction);
  }
  private read(actor: ActorId, storage: QvmItemStorage, previous?: QvmCommittedWrite): readonly InventoryEntry[] {
    const count = this.scalar(this.address(actor, storage.field), previous);
    if (storage.kind === "counter") return [{ item: storage.item, count, capacity: this.capacity(actor, storage.capacity, previous), countPolicy: { kind: "source-counter", arithmetic: "int32" } }];
    const mask = storage.items.reduce((mask, value) => mask | value.mask, storage.privateMask);
    if ((count & ~mask) !== 0) throw new Error("Original QVM inventory contains undeclared bits");
    return storage.items.map(value => ({ item: value.item, count: (count & value.mask) === 0 ? 0 : 1, capacity: 1 }));
  }
  private write(actor: ActorId, entry: InventoryEntry): undefined {
    const current = this.entries.get(actor), storage = this.byItem.get(entry.item);
    if (current === undefined || !this.current(current) || storage === undefined) throw new Error("QVM item storage is no longer admitted");
    const view = this.module.memory.dataView(this.address(actor, storage.field), 4);
    if (storage.kind === "counter") {
      if (!integer(entry.count) || !integer(entry.capacity) || entry.capacity < 0) throw new Error("QVM item exceeds its signed source representation");
      if (storage.capacity.kind !== "field" && entry.capacity !== this.capacity(actor, storage.capacity)) throw new Error("QVM capacity is owned by its original source");
      view.setInt32(0, entry.count, true);
      if (storage.capacity.kind === "field") this.module.memory.dataView(this.address(actor, storage.capacity.field), 4).setInt32(0, entry.capacity, true);
    } else {
      const bit = storage.items.find(value => value.item === entry.item);
      if (bit === undefined || entry.capacity !== 1 || entry.count !== 0 && entry.count !== 1) throw new Error("QVM packed ownership requires one admitted bit");
      const previous = view.getInt32(0, true); view.setInt32(0, entry.count === 0 ? previous & ~bit.mask : previous | bit.mask, true);
    }
    return undefined;
  }
  private current(entry: Entry): boolean {
    if (this.entries.get(entry.actor.id) !== entry || this.services.actors.resolveOwned(entry.actor.id) !== entry.actor || !this.operations.live(entry.actor.id) || !entry.lease.current()) return false;
    for (const [record, address] of entry.addresses) if (this.operations.pointer(entry.actor.id, record) !== address) return false;
    return true;
  }
  admit(actor: ActorId): void {
    if (this.entries.has(actor)) return;
    const owner = this.services.actors.resolveOwned(actor);
    if (owner === null || !this.operations.live(actor)) throw new Error("QVM source items require the current admitted client");
    const addresses = new Map(this.definition.storage.flatMap(storage => fields(storage)).map(field => [field.record, this.operations.pointer(actor, field.record)]));
    const lease = this.services.inventory.bindItems(owner, { owner: this.provider, items: this.admissions, invoke: (item, action) => {
      const current = this.entries.get(actor), call = this.definition.definitions.find(value => value.item === item)?.actions?.[action];
      if (current === undefined || !this.current(current) || call === undefined) throw new Error("Source item action is no longer admitted");
      this.operations.invoke(actor, call);
    }, state: {
      read: () => this.definition.storage.flatMap(storage => this.read(actor, storage)),
      entry: item => { const storage = this.byItem.get(item); return storage === undefined ? undefined : this.read(actor, storage).find(value => value.item === item); },
      write: value => this.write(actor, value), mutableCapacity: item => { const storage = this.byItem.get(item); return storage?.kind === "counter" && storage.capacity.kind === "field"; },
    } });
    const watches = this.definition.storage.map(storage => ({ storage, addresses: [...fields(storage).map(field => this.address(actor, field)),
      ...(storage.kind === "counter" && storage.capacity.kind === "source" ? storage.capacity.overrides.map(value => value.address) : [])] }));
    const pending = new WeakMap<QvmCommittedWrite, readonly SourceItemStore[]>();
    const unobserve = this.module.memory.observeWrites(watches.flatMap(watch => watch.addresses.map(byteOffset => ({ byteOffset, byteLength: 4 }))), event => {
      const changes: SourceItemStore[] = [];
      for (const watch of watches) if (watch.addresses.some(address => event.ranges.some(range => address < range.byteOffset + range.after.length && range.byteOffset < address + 4))) {
        const before = this.read(actor, watch.storage, event), after = this.read(actor, watch.storage);
        for (const value of after) { const previous = before.find(entry => entry.item === value.item);
          if (previous !== undefined && (previous.count !== value.count || previous.capacity !== value.capacity)) {
            const pickup = this.operations.pickup();
            if (pickup !== undefined && !pickup.writes.some(write => write.kind === "inventory" && write.item === value.item
              && (previous.count === value.count || write.fields !== "capacity") && (previous.capacity === value.capacity || write.fields !== "count")))
              throw new Error("Original pickup changed an undeclared QVM source item");
            changes.push({ before: previous, after: value });
          }
        }
      }
      pending.set(event, changes); return undefined;
    }, event => { const changes = pending.get(event); pending.delete(event);
      const entry = this.entries.get(actor);
      if (changes !== undefined && changes.length !== 0 && entry !== undefined && this.current(entry)) {
        try { entry.lease.stored(changes); }
        catch (error) {
          if (error instanceof SourceItemRetired && error.lease === entry.lease && error.actor === entry.actor && error.owner === this.provider)
            this.weapons?.cancelRetired(actor);
          throw error;
        }
        if (!this.current(entry)) this.weapons?.cancelRetired(actor);
      }
      return undefined;
    });
    const entry: Entry = { actor: owner, addresses, lease, unobserve, request: null, removeWeapon: () => undefined }; this.entries.set(actor, entry);
    try { if (this.weapons !== null) {
      const remove = this.services.weapons?.bind(owner, this.binding(entry));
      if (remove === undefined) throw new Error("QVM source weapon service is unavailable"); entry.removeWeapon = remove;
    } } catch (error) { this.release(actor); throw error; }
  }
  private value(item: ItemId | null): number | null {
    return item === null ? null : this.definition.weapons?.stage.selection.values.find(value => value.item === item)?.value ?? null;
  }
  requested(actor: ActorId): number | null {
    const entry = this.entries.get(actor), request = entry?.request;
    return entry !== undefined && this.current(entry) && request !== null && request !== undefined && request.status !== "refused" ? this.value(request.item) : null;
  }
  private capability(entry: Entry, request: Request): SourceWeaponRequest {
    return { id: request.id, status: () => this.current(entry) && entry.request === request ? request.status : "refused",
      cancel: () => { if (this.current(entry) && entry.request === request && request.status === "pending") { request.status = "refused"; entry.request = null; } } };
  }
  private binding(entry: Entry): SourceWeaponBinding {
    const stage = this.weapons; if (stage === null) throw new Error("QVM weapon stage is absent");
    const actor = entry.actor.id, accepts = (item: ItemId): boolean => this.current(entry) && this.value(item) !== null && this.services.inventory.count(actor, item) > 0;
    const request = (item: ItemId | null): SourceWeaponRequest => {
      if (!this.current(entry)) throw new Error("QVM source weapon request lost its actor");
      const accepted = item === null ? stage.active(actor) !== null && stage.settled(actor) : accepts(item);
      const value: Request = { id: ++this.nextRequest, item, status: accepted ? item === null ? "accepted" : "pending" : "refused", attempted: false };
      entry.request = value; return this.capability(entry, value);
    };
    return { current: () => this.current(entry), read: () => {
      if (!this.current(entry)) throw new Error("QVM weapon presentation lost its original actor");
      const active = stage.active(actor), pending = entry.request?.status === "refused" || entry.request?.item === active ? null : entry.request?.item ?? null;
      return { source: { provider: this.provider, content: this.content }, active, pending, model: null, items: this.admissions.map(value => value.definition) };
    }, handoff: { kind: "source-input", provider: this.provider, accepts,
      select: item => accepts(item) && request(item).status() !== "refused",
      holster: () => { if (!this.current(entry)) throw new Error("QVM source weapon retired while holstering"); }, isHolstered: () => this.current(entry) && stage.settled(actor), resume: request,
      restoreRequest: (id, item) => { const request = entry.request;
        if (!this.current(entry) || request === null || request.id !== id || request.item !== item) throw new Error("Saved QVM weapon request differs from its original source owner");
        return this.capability(entry, request);
      },
    } };
  }
  open(application: ModClientApplication): () => void { return this.weapons?.open(application) ?? (() => {}); }
  applies(call: QvmModSourceCall): boolean { return this.definition.weapons?.input.entry === call.entry; }
  apply(application: ModClientApplication, run: () => number): number {
    const input = this.definition.weapons?.input;
    if (input === undefined) return run();
    if (application.scope !== "movement-slice" || this.applied.has(application)) throw new Error("QVM weapon input must consume each actual movement slice exactly once");
    const entry = this.entries.get(application.identity.actor);
    if (entry === undefined || !this.current(entry)) throw new Error("QVM weapon application lost its admitted actor");
    this.applied.add(application);
    const end = application.frame.time.kind === "seconds" ? application.frame.time.value * 1000 : application.frame.time.value;
    const elapsed = application.frame.elapsed.kind === "seconds" ? application.frame.elapsed.value * 1000 : application.frame.elapsed.value;
    if (!Number.isFinite(end) || !Number.isFinite(elapsed) || elapsed < 0) throw new Error("Invalid applied source weapon clock");
    this.module.memory.dataView(this.address(entry.actor.id, input.clock), 4).setInt32(0, Math.trunc(end) - Math.trunc(elapsed), true);
    return this.weapons?.apply(entry.actor.id, run) ?? run();
  }
  checkpoint() {
    return { version: 1, nextRequest: this.nextRequest, requests: [...this.entries.values()].flatMap(entry => entry.request === null ? []
      : [{ actor: savedActorId(entry.actor.id), id: entry.request.id, item: entry.request.item, status: entry.request.status }]) };
  }
  restore(value: unknown): void {
    const reader = new SaveReader(value, "qvm.items"), ids = new Set<number>(), actors = new Set<ActorId>();
    reader.field("version").literal(1); this.nextRequest = reader.field("nextRequest").integer(0);
    for (const row of reader.field("requests").list(value => value)) {
      const saved = readSavedActor(row.field("actor")), actor = this.services.referenceSaved?.(saved) ?? this.services.actors.referenceSaved(saved, "current");
      const id = row.field("id").integer(1), item = row.field("item").nullable(namespaced), status = row.field("status").choice("pending", "accepted", "refused");
      const entry = this.entries.get(actor);
      if (entry === undefined || !this.current(entry) || id > this.nextRequest || ids.has(id) || actors.has(actor) || item !== null && this.value(item) === null) throw new Error("Saved QVM weapon request is not its current admitted owner");
      ids.add(id); actors.add(actor); entry.request = { id, item, status, attempted: false };
    }
  }
  clear(): void { for (const actor of this.entries.keys()) this.release(actor); }
  release(actor: ActorId): void {
    const entry = this.entries.get(actor); if (entry === undefined) return;
    this.entries.delete(actor); entry.request = null; entry.unobserve();
    try { entry.removeWeapon(); } finally { entry.lease.close(); }
  }
  close(): void {
    this.weapons?.close(); const errors: unknown[] = [];
    for (const actor of this.entries.keys()) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QVM source item release failed");
  }
}
