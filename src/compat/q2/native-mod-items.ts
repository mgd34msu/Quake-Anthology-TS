import { resolveItemIcon } from "../../content/item-icon.ts";
import { sourceItemActionNames } from "../../contracts/source-items.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { GuestAddress, NativeAbi } from "../../contracts/execution.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { NativeItemField, NativeItemCapacity, NativeItemStorage, NativeModItems as Definition } from "../../contracts/native-mod-items.ts";
import type { NativeModAddress, NativeModDeclaration, NativeModScalar, NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { SourceItemAdmission, SourceItemLease, SourceItemStore, SourceWeaponBinding, SourceWeaponPresentation, SourceWeaponRequest } from "../../contracts/source-items.ts";
import { SourceItemRetired } from "../../contracts/source-items.ts";
import type { OriginalPickupExecution } from "../../contracts/original-pickups.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { storageBytes } from "../../guest/abi/values.ts";
import { NativeModWeaponStage } from "./native-mod-weapon-stage.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";

interface Operations {
  pointer(actor: ActorId, record: string): GuestAddress;
  resolve(address: NativeModAddress): GuestAddress;
  live(actor: ActorId): boolean;
  read(address: GuestAddress, encoding: NativeModScalar): number;
  write(address: GuestAddress, encoding: NativeModScalar, value: number): void;
  invoke(actor: ActorId, call: NativeModSourceCall): void;
  model(actor: ActorId): SourceWeaponPresentation["model"];
  pickup(): OriginalPickupExecution | undefined;
}
interface Request { readonly id: number; readonly item: ItemId | null; status: "pending" | "accepted" | "refused"; }
export interface NativeItemCheckpoint {
  readonly version: 1;
  readonly nextRequest: number;
  readonly requests: readonly { readonly actor: SavedActorId; readonly id: number; readonly item: ItemId | null; readonly status: Request["status"] }[];
}
export function readNativeItemCheckpoint(reader: SaveReader, definition: Definition): NativeItemCheckpoint {
  reader.field("version").literal(1);
  const nextRequest = reader.field("nextRequest").integer(0), ids = new Set<number>(), actors = new Set<string>();
  const requests = reader.field("requests").list(row => {
    const actor = readSavedActor(row.field("actor")), id = row.field("id").integer(1), item = row.field("item").nullable(namespaced), status = row.field("status").choice("pending", "accepted", "refused");
    const key = `${actor.slot}:${actor.generation}`;
    if (id > nextRequest || ids.has(id) || actors.has(key) || definition.weapons === undefined || item !== null && !definition.weapons.selection.values.some(value => value.item === item)) throw new Error("Saved native request differs from its source declaration");
    ids.add(id); actors.add(key); return { actor, id, item, status };
  });
  return { version: 1, nextRequest, requests };
}
interface Entry {
  readonly actor: OwnedActor;
  readonly addresses: ReadonlyMap<string, bigint>;
  readonly lease: SourceItemLease;
  readonly removals: (() => void)[];
  readonly previous: Map<ItemId, InventoryEntry>;
  removeWeapon: () => undefined;
  request: Request | null;
  sourceSelection: ItemId | null;
}
function fields(storage: NativeItemStorage): readonly NativeItemField[] {
  return storage.kind === "counter" && storage.capacity.kind === "field" ? [storage.field, storage.capacity.field] : [storage.field];
}
function scalarBytes(field: NativeItemField): number { return storageBytes(field.encoding, 4); }
function validateCounter(value: number, field: NativeItemField): void {
  if (!Number.isFinite(value)) throw new Error("Native inventory requires a finite source count");
  if (field.encoding === "float32" || field.encoding === "float64") return;
  const bits = scalarBytes(field) * 8, signed = field.encoding.startsWith("int"), bound = 2 ** (bits - (signed ? 1 : 0));
  if (!Number.isSafeInteger(value) || value < (signed ? -bound : 0) || value >= bound) throw new Error("Native inventory count exceeds its original integer storage");
}
export function validateNativeModItems(declaration: NativeModDeclaration): void {
  const items = declaration.items;
  if (items === undefined) return;
  if (declaration.clients === undefined || items.definitions.length === 0) throw new Error("Native items require original client admission");
  const definitions = new Map(items.definitions.map(value => [value.item, value])), bound = new Set<ItemId>(), occupied = new Map<string, Map<number, string | null>>();
  if (definitions.size !== items.definitions.length) throw new Error("Duplicate native source item");
  const field = (value: { readonly record: string; readonly offset: number }, length: number, exclusive = false, sharedCapacity: string | null = null): void => {
    const record = declaration.actorRecords.find(record => record.id === value.record);
    if (record === undefined || !declaration.clients?.records.includes(value.record) || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset + length > record.stride) throw new Error("Native source item exceeds its client record");
    if (exclusive) {
      const bytes = occupied.get(value.record) ?? new Map<number, string | null>(); occupied.set(value.record, bytes);
      for (let index = value.offset; index < value.offset + length; index++) {
        if (bytes.has(index) && (sharedCapacity === null || bytes.get(index) !== sharedCapacity)) throw new Error("Overlapping native source item storage");
        bytes.set(index, sharedCapacity);
      }
      for (const projection of record.fields) {
        const size = projection.binding === "private" ? projection.byteLength : "encoding" in projection ? storageBytes(projection.encoding, declaration.target.abi.pointerBytes)
          : projection.binding === "record" || projection.binding === "address" ? declaration.target.abi.pointerBytes : 12;
        if (projection.offset < value.offset + length && value.offset < projection.offset + size && projection.binding !== "private" && projection.binding !== "constant") throw new Error("Native source item overlaps another canonical projection");
      }
    }
  };
  const bind = (item: ItemId): void => { if (!definitions.has(item) || bound.has(item)) throw new Error("Native source item lacks distinct storage"); bound.add(item); };
  for (const storage of items.storage) {
    field(storage.field, scalarBytes(storage.field), true);
    if (storage.kind === "counter") {
      if (storage.capacity.kind === "field") {
        const capacity = storage.capacity.field;
        field(capacity, scalarBytes(capacity), true, `${capacity.offset}:${capacity.encoding}`);
      }
      bind(storage.item);
      if (storage.capacity.kind === "constant" && (!Number.isFinite(storage.capacity.value) || storage.capacity.value < 0)) throw new Error("Invalid native source capacity");
    } else {
      if (!["int8", "uint8", "int16", "uint16", "int32", "uint32"].includes(storage.field.encoding) || storage.items.length === 0 || !Number.isInteger(storage.privateMask) || storage.privateMask < 0 || storage.privateMask > 0xffffffff) throw new Error("Invalid native packed inventory");
      let mask = storage.privateMask;
      for (const value of storage.items) { bind(value.item);
        if (!Number.isInteger(value.mask) || value.mask < 1 || value.mask > 0x80000000 || (value.mask & (value.mask - 1)) !== 0 || (mask & value.mask) !== 0) throw new Error("Overlapping native item bits");
        mask |= value.mask;
      }
      if (scalarBytes(storage.field) < 4 && (mask >>> 0) >= 2 ** (scalarBytes(storage.field) * 8)) throw new Error("Native packed item exceeds storage width");
    }
  }
  if (bound.size !== definitions.size) throw new Error("Native item definition lacks source storage");
  const weapons = items.definitions.filter(value => value.kind === "weapon");
  if (weapons.length === 0 ? items.weapons !== undefined : items.weapons === undefined) throw new Error("Native weapon items require an original dispatcher");
  const stage = items.weapons;
  if (stage === undefined) return;
  const dispatcher = stage.dispatcher;
  if (!declaration.actorRecords.some(value => value.id === dispatcher.record) || !Number.isSafeInteger(dispatcher.arguments) || dispatcher.arguments < 1 || dispatcher.arguments > 16
    || !Number.isSafeInteger(dispatcher.argument) || dispatcher.argument < 0 || dispatcher.argument >= dispatcher.arguments || stage.decisions.length === 0 || stage.settled.length === 0 || stage.settled.some(tests => tests.length === 0) || stage.continuations.length === 0 || stage.continuations.some(tests => tests.length === 0) || stage.committedInput?.some(tests => tests.length === 0)) throw new Error("Native weapon stage lacks original decisions or actor ABI");
  const regions = new Set<number>();
  for (const region of stage.decisions) {
    if (!Number.isSafeInteger(region.entry) || !Number.isSafeInteger(region.join) || region.entry < 0 || region.join <= region.entry || regions.has(region.entry) || region.fields.length === 0) throw new Error("Invalid native weapon input-read region"); regions.add(region.entry);
    for (const value of region.fields) {
      field(value.field, scalarBytes(value.field));
      if (!["int8", "uint8", "int16", "uint16", "int32", "uint32"].includes(value.field.encoding) || !Number.isInteger(value.clearMask) || value.clearMask < 1 || value.clearMask > 0x7fffffff) throw new Error("Invalid native weapon input projection");
    }
  }
  field(stage.selection.active, declaration.target.abi.pointerBytes); if (stage.selection.pending !== null) field(stage.selection.pending, declaration.target.abi.pointerBytes);
  for (const test of [...stage.settled.flat(), ...stage.continuations.flat(), ...(stage.committedInput?.flat() ?? [])]) field(test.field, test.kind === "pointer" ? declaration.target.abi.pointerBytes : scalarBytes(test.field));
  if (stage.selection.values.length !== weapons.length || new Set(stage.selection.values.map(value => value.item)).size !== weapons.length
    || stage.selection.values.some(value => !weapons.some(weapon => weapon.item === value.item))) throw new Error("Native weapon pointers differ from admitted source definitions");
  for (const weapon of weapons) if (weapon.ammo !== null && !definitions.has(weapon.ammo)) throw new Error("Native weapon ammo lacks original storage");
}

/** Inventory borrows original native words; observers publish committed stores exactly once. */
export class NativeModItems {
  private readonly entries = new Map<ActorId, Entry>();
  private readonly admissions: readonly SourceItemAdmission[];
  private readonly byItem: ReadonlyMap<ItemId, NativeItemStorage>;
  private readonly stage: NativeModWeaponStage | null;
  private nextRequest = 0;
  private writing = 0;
  private readonly requesting = new Set<ActorId>();
  constructor(private readonly definition: Definition, abi: NativeAbi, private readonly host: NativeModHost, private readonly services: ModHostServices,
    private readonly provider: ProviderId, private readonly content: ContentId, private readonly operations: Operations) {
    this.admissions = definition.definitions.map(({ admission, actions, icon, ...item }) => ({ admission, definition: { ...item, source: { provider, content }, ...(icon === undefined ? {} : { icon: icon === null ? null : resolveItemIcon(icon, content) }), ...(actions === undefined ? {} : { actions: sourceItemActionNames(actions) }) } }));
    this.byItem = new Map(definition.storage.flatMap(storage => (storage.kind === "counter" ? [storage.item] : storage.items.map(value => value.item)).map(item => [item, storage] satisfies readonly [ItemId, NativeItemStorage])));
    this.stage = definition.weapons === undefined ? null : new NativeModWeaponStage(definition.weapons, abi, host, provider, {
      actor: (record, address) => { for (const entry of this.entries.values()) if (operations.live(entry.actor.id) && operations.pointer(entry.actor.id, record).byteOffset === address.byteOffset) {
        if (!this.current(entry)) throw new SourceItemRetired(entry.lease, entry.actor, provider); return entry.actor.id;
      } return null; },
      current: actor => { const entry = this.entries.get(actor); return entry !== undefined && this.current(entry); },
      selected: actor => services.weapons?.selected(actor, provider) === true,
      pointer: (actor, field) => this.address(actor, field), resolve: value => operations.resolve(value),
      read: (actor, field) => operations.read(this.address(actor, field), field.encoding), write: (actor, field, value) => operations.write(this.address(actor, field), field.encoding, value),
      invoke: (actor, call) => operations.invoke(actor, call), cancellation: actor => this.cancellation(actor), completed: actor => this.completed(actor),
    });
  }
  private address(actor: ActorId, field: { readonly record: string; readonly offset: number }): GuestAddress { return this.host.memory.offset(this.operations.pointer(actor, field.record), BigInt(field.offset)); }
  private capacity(actor: ActorId, capacity: NativeItemCapacity): number {
    return capacity.kind === "constant" ? capacity.value : capacity.kind === "field" ? this.operations.read(this.address(actor, capacity.field), capacity.field.encoding)
      : this.operations.read(this.operations.resolve(capacity.address), capacity.encoding);
  }
  private read(actor: ActorId, storage: NativeItemStorage): readonly InventoryEntry[] {
    const count = this.operations.read(this.address(actor, storage.field), storage.field.encoding);
    if (storage.kind === "counter") return [{ item: storage.item, count, capacity: this.capacity(actor, storage.capacity), countPolicy: { kind: "source-counter", arithmetic: storage.field.encoding === "float32" ? "binary32" : storage.field.encoding === "int32" ? "int32" : "binary64" } }];
    const mask = storage.items.reduce((mask, value) => mask | value.mask, storage.privateMask);
    const packed = count & (scalarBytes(storage.field) === 4 ? -1 : 2 ** (scalarBytes(storage.field) * 8) - 1);
    if ((packed & ~mask) !== 0) throw new Error("Native inventory contains undeclared item bits");
    return storage.items.map(value => ({ item: value.item, count: (count & value.mask) === 0 ? 0 : 1, capacity: 1 }));
  }
  private current(entry: Entry): boolean {
    if (this.entries.get(entry.actor.id) !== entry || this.services.actors.resolveOwned(entry.actor.id) !== entry.actor || !this.operations.live(entry.actor.id) || !entry.lease.current()) return false;
    for (const [record, address] of entry.addresses) if (this.operations.pointer(entry.actor.id, record).byteOffset !== address) return false;
    return true;
  }
  private write(actor: ActorId, value: InventoryEntry): undefined {
    const entry = this.entries.get(actor), storage = this.byItem.get(value.item);
    if (entry === undefined || !this.current(entry) || storage === undefined) throw new Error("Native item lease lost its original storage");
    this.writing++;
    try {
      if (storage.kind === "counter") {
        if (storage.capacity.kind !== "field" && value.capacity !== this.capacity(actor, storage.capacity)) throw new Error("Native capacity is owned by its original source");
        validateCounter(value.count, storage.field);
        if (storage.capacity.kind === "field") validateCounter(value.capacity, storage.capacity.field);
        this.operations.write(this.address(actor, storage.field), storage.field.encoding, value.count);
        if (storage.capacity.kind === "field") this.operations.write(this.address(actor, storage.capacity.field), storage.capacity.field.encoding, value.capacity);
      } else {
        const bit = storage.items.find(bit => bit.item === value.item);
        if (bit === undefined || value.capacity !== 1 || value.count !== 0 && value.count !== 1) throw new Error("Native item requires its original ownership bit");
        const address = this.address(actor, storage.field), previous = this.operations.read(address, storage.field.encoding);
        const next = value.count === 0 ? previous & ~bit.mask : previous | bit.mask;
        const bits = scalarBytes(storage.field) * 8, stored = storage.field.encoding.startsWith("int") ? next << (32 - bits) >> (32 - bits) : next >>> 0;
        this.operations.write(address, storage.field.encoding, stored);
      }
    } finally { this.writing--; this.changed(entry, this.definition.storage, value.item); }
    return undefined;
  }
  private changed(entry: Entry, storage: readonly NativeItemStorage[], canonicalWrite?: ItemId): void {
    if (this.writing !== 0 || !this.current(entry)) return;
    const after = storage.flatMap(value => this.read(entry.actor.id, value)), changes: SourceItemStore[] = [];
    for (const value of after) {
      const before = entry.previous.get(value.item);
      if (value.item !== canonicalWrite && before !== undefined && (before.count !== value.count || before.capacity !== value.capacity)) {
        const pickup = this.operations.pickup();
        if (pickup !== undefined && !pickup.writes.some(write => write.kind === "inventory" && write.item === value.item
          && (before.count === value.count || write.fields !== "capacity") && (before.capacity === value.capacity || write.fields !== "count"))) throw new Error("Original pickup changed an undeclared native source item");
        changes.push({ before, after: value });
      }
    }
    for (const value of after) entry.previous.set(value.item, value);
    if (changes.length !== 0) {
      entry.lease.stored(changes);
      if (!this.current(entry)) throw new SourceItemRetired(entry.lease, entry.actor, this.provider);
    }
  }
  admit(actor: ActorId): void {
    if (this.entries.has(actor)) return;
    const owner = this.services.actors.resolveOwned(actor);
    if (owner === null || !this.operations.live(actor)) throw new Error("Native items require the current admitted client");
    const addresses = new Map(this.definition.storage.flatMap(storage => fields(storage)).map(field => [field.record, this.operations.pointer(actor, field.record).byteOffset]));
    const previous = new Map(this.definition.storage.flatMap(storage => this.read(actor, storage)).map(value => [value.item, value]));
    const lease = this.services.inventory.bindItems(owner, { owner: this.provider, items: this.admissions, invoke: (item, action) => {
      const current = this.entries.get(actor), call = this.definition.definitions.find(value => value.item === item)?.actions?.[action];
      if (current === undefined || !this.current(current) || call === undefined) throw new Error("Source item action is no longer admitted");
      this.operations.invoke(actor, call);
    }, state: {
      read: () => this.definition.storage.flatMap(storage => this.read(actor, storage)),
      entry: item => { const storage = this.byItem.get(item); return storage === undefined ? undefined : this.read(actor, storage).find(value => value.item === item); },
      write: value => this.write(actor, value), mutableCapacity: item => { const storage = this.byItem.get(item); return storage?.kind === "counter" && storage.capacity.kind === "field"; },
    } });
    const entry: Entry = { actor: owner, addresses, lease, previous, removals: [], removeWeapon: () => undefined, request: null, sourceSelection: this.stage?.pending(actor) ?? this.stage?.active(actor) ?? null }; this.entries.set(actor, entry);
    try {
      for (const storage of this.definition.storage) {
        for (const field of fields(storage)) entry.removals.push(this.host.memory.observeWrites(this.address(actor, field), scalarBytes(field), () => this.changed(entry, [storage])));
        if (storage.kind === "counter" && storage.capacity.kind === "source") entry.removals.push(this.host.memory.observeWrites(this.operations.resolve(storage.capacity.address), storageBytes(storage.capacity.encoding, this.host.memory.pointerBytes), () => this.changed(entry, [storage])));
      }
      if (this.stage !== null) {
        const remove = this.services.weapons?.bind(owner, this.binding(entry));
        if (remove === undefined) throw new Error("Native source weapon service is unavailable"); entry.removeWeapon = remove;
        const selection = this.definition.weapons?.selection;
        if (selection !== undefined) for (const pointer of [selection.active, selection.pending]) if (pointer !== null) entry.removals.push(this.host.memory.observeWrites(this.address(actor, pointer), this.host.memory.pointerBytes, () => {
          if (!this.current(entry)) return;
          const item = this.stage?.pending(actor) ?? this.stage?.active(actor) ?? null, previous = entry.sourceSelection; entry.sourceSelection = item;
          if (item !== null && item !== previous && !this.requesting.has(actor)) this.services.weapons?.request(actor, { provider: this.provider, item });
        }));
      }
    } catch (error) { this.release(actor); throw error; }
  }
  cancellation(actor: ActorId) {
    const entry = this.entries.get(actor);
    return { accepts: (error: unknown): boolean => entry !== undefined && error instanceof SourceItemRetired && error.lease === entry.lease && error.actor === entry.actor && error.owner === this.provider,
      sourceCurrent: (): boolean => entry !== undefined && this.services.actors.resolveOwned(actor) === entry.actor && this.operations.live(actor) };
  }
  acceptsAttack(actor: ActorId): boolean { return this.stage === null || this.services.weapons?.selected(actor, this.provider) === true || this.stage.continuing(actor); }
  private completed(actor: ActorId): void {
    const entry = this.entries.get(actor), stage = this.stage;
    if (entry?.request?.status !== "pending" || stage === null) return;
    if (stage.active(actor) === entry.request.item) entry.request.status = "accepted";
    else if (stage.pending(actor) !== entry.request.item) entry.request.status = "refused";
  }
  private capability(entry: Entry, request: Request): SourceWeaponRequest {
    return { id: request.id, status: () => this.current(entry) && entry.request === request ? request.status : "refused",
      cancel: () => { if (this.current(entry) && entry.request === request && request.status === "pending") { request.status = "refused"; entry.request = null; } } };
  }
  private binding(entry: Entry): SourceWeaponBinding {
    const stage = this.stage; if (stage === null) throw new Error("Missing native weapon stage");
    const actor = entry.actor.id, accepts = (item: ItemId): boolean => this.current(entry) && this.definition.weapons?.selection.values.some(value => value.item === item) === true && this.services.inventory.count(actor, item) > 0;
    const request = (item: ItemId | null): SourceWeaponRequest => {
      if (!this.current(entry)) throw new Error("Native weapon request lost its original actor");
      const value: Request = { id: ++this.nextRequest, item, status: "pending" }; entry.request = value;
      if (item === null) value.status = stage.active(actor) !== null && stage.settled(actor) ? "accepted" : "refused";
      else {
        this.requesting.add(actor);
        try { if (!accepts(item) || !stage.request(actor, item)) value.status = "refused";
          else if (stage.active(actor) === item) value.status = "accepted";
        } finally { this.requesting.delete(actor); }
      }
      return this.capability(entry, value);
    };
    return { current: () => this.current(entry), read: () => {
      if (!this.current(entry)) throw new Error("Native weapon presentation lost its source owner");
      return { source: { provider: this.provider, content: this.content }, active: stage.active(actor), pending: stage.pending(actor), model: this.operations.model(actor), items: this.admissions.map(value => value.definition) };
    }, handoff: { kind: "source-input", provider: this.provider, accepts, select: item => accepts(item) && request(item).status() !== "refused",
      holster: () => { if (!this.current(entry)) throw new Error("Native weapon retired while holstering"); }, isHolstered: () => this.current(entry) && stage.settled(actor), resume: request,
      restoreRequest: (id, item) => { const request = entry.request;
        if (!this.current(entry) || request === null || request.id !== id || request.item !== item) throw new Error("Saved native weapon request differs from its source owner");
        return this.capability(entry, request);
      } } };
  }
  checkpoint(): NativeItemCheckpoint { return { version: 1, nextRequest: this.nextRequest, requests: [...this.entries.values()].flatMap(entry => entry.request === null ? [] : [{ actor: savedActorId(entry.actor.id), ...entry.request }]) }; }
  restore(value: NativeItemCheckpoint): void {
    this.nextRequest = value.nextRequest;
    for (const row of value.requests) {
      const actor = this.services.referenceSaved?.(row.actor) ?? this.services.actors.referenceSaved(row.actor, "current"), entry = this.entries.get(actor);
      if (entry === undefined || !this.current(entry)) throw new Error("Saved native request lost its exact source owner");
      entry.request = { id: row.id, item: row.item, status: row.status };
    }
  }
  release(actor: ActorId): void {
    const entry = this.entries.get(actor); if (entry === undefined) return;
    this.entries.delete(actor); entry.request = null; for (const remove of entry.removals.splice(0).reverse()) remove();
    try { entry.removeWeapon(); } finally { entry.lease.close(); }
  }
  clear(): void { for (const actor of this.entries.keys()) this.release(actor); }
  close(): void { this.stage?.close(); this.clear(); }
}
