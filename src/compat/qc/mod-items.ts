import { resolveItemIcon } from "../../content/item-icon.ts";
import { sourceItemActionNames } from "../../contracts/source-items.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { ModCallbackDeclaration, ModCallbackInput, ModQcItems, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { SourceItemAdmission, SourceItemDefinition, SourceItemLease, SourceItemStore, SourceWeaponBinding, SourceWeaponPresentation } from "../../contracts/source-items.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { QcEntityStoreObservation, QcMachine } from "./machine.ts";
import type { QcProgram } from "./program.ts";
import { qcDeclaredWeaponStage, QcWeaponStageBinding } from "../../content/q1/quakec/weapon-stage.ts";
import type { QcModMedia } from "./mod-provider.ts";
import type { OriginalPickupExecution } from "../../contracts/original-pickups.ts";

interface Operations {
  machine(): QcMachine;
  reference(actor: ActorId): number;
  actor(reference: number): ActorId;
  invoke(call: ModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
}
interface Entry { readonly actor: OwnedActor; readonly reference: number; readonly lease: SourceItemLease; readonly removeWeapon: () => undefined; }


export function validateQcItems(program: QcProgram, declaration: ModCallbackDeclaration): void {
  const items = declaration.items; if (items === undefined) return;
  if (declaration.clients === undefined || items.definitions.length === 0) throw new Error("QC source items require canonical clients and definitions");
  const definitions = new Map(items.definitions.map(definition => [definition.item, definition]));
  if (definitions.size !== items.definitions.length || items.definitions.some(definition => definition.label.length === 0)) throw new Error("QC item definitions are empty or duplicated");
  const field = (name: string, type: "float" | "string", input = false): number => {
    const definition = program.fieldsByName.get(name);
    if (definition?.type !== type || !declaration.actorFields.some(field => field.field === name && (field.binding === "private" || input && field.binding === "client-input")))
      throw new Error(`QC item storage ${name} requires declared original ${type} storage`);
    return definition.offset;
  };
  const bound = new Set<ItemId>(), fields = new Map<number, "count" | "capacity">();
  const bind = (item: ItemId): void => { if (!definitions.has(item) || bound.has(item)) throw new Error(`QC item ${item} lacks distinct declared storage`); bound.add(item); };
  for (const storage of items.storage) {
    const countField = field(storage.field, "float");
    if (fields.has(countField)) throw new Error("QC item storage fields overlap"); fields.set(countField, "count");
    if (storage.kind === "counter") {
      bind(storage.item);
      if (storage.capacity.kind === "field") {
        const capacityField = field(storage.capacity.field, "float");
        if (fields.get(capacityField) === "count") throw new Error("QC item capacity overlaps source storage"); fields.set(capacityField, "capacity");
      }
      else if (!Number.isFinite(storage.capacity.value) || storage.capacity.value < 0 || Math.fround(storage.capacity.value) !== storage.capacity.value) throw new Error("QC item capacity exceeds its source ABI");
    } else {
      let mask = storage.privateMask;
      if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffff || storage.items.length === 0) throw new Error("QC packed inventory requires an exact binary32 mask");
      for (const entry of storage.items) {
        bind(entry.item);
        if (!Number.isInteger(entry.mask) || entry.mask < 1 || entry.mask > 0x800000 || (entry.mask & (entry.mask - 1)) !== 0 || (mask & entry.mask) !== 0)
          throw new Error("QC packed inventory masks overlap or exceed source precision");
        mask |= entry.mask;
      }
    }
  }
  if (bound.size !== definitions.size) throw new Error("QC item definition has no source storage");
  const weapons = items.definitions.filter(definition => definition.kind === "weapon");
  if (weapons.length === 0 ? items.weapons !== undefined : items.weapons === undefined) throw new Error("QC weapon definitions require their original source consumer");
  if (items.weapons !== undefined) {
    qcDeclaredWeaponStage(program, items.weapons.stage);
    for (const name of ["think", "nextthink"]) if (!declaration.actorFields.some(field => field.field === name && field.binding === name)) throw new Error("QC weapons require continuing source think ownership");
    for (const mapping of [items.weapons.selected, items.weapons.select]) {
      field(mapping.field, "float", mapping === items.weapons.select);
      if (mapping.values.length !== weapons.length || new Set(mapping.values.map(value => value.item)).size !== weapons.length
        || new Set(mapping.values.map(value => value.value)).size !== weapons.length || weapons.some(weapon => !mapping.values.some(value => value.item === weapon.item))
        || mapping.values.some(value => !Number.isFinite(value.value) || Math.fround(value.value) !== value.value || value.value === 0)) throw new Error("QC weapon selectors differ from their definitions");
    }
    field(items.weapons.model.field, "string"); field(items.weapons.model.frame, "float");
    for (const weapon of weapons) if (weapon.ammo !== null && !definitions.has(weapon.ammo)
      && !declaration.actorFields.some(field => field.binding === "inventory" && field.item === weapon.ammo)) throw new Error("QC weapon has no declared ammo source");
  }
}

/** Original words own admitted items; the shared inventory exposes their current projection. */
export class QcModItems {
  readonly weapons: QcWeaponStageBinding | null;
  private readonly entries = new Map<ActorId, Entry>();
  private readonly admissions: readonly SourceItemAdmission[];
  private readonly definitions: readonly SourceItemDefinition[];
  private readonly offsets: ReadonlyMap<string, number>;
  private readonly storageByItem: ReadonlyMap<ItemId, ModQcItems["storage"][number]>;
  private readonly watchedWords: readonly number[];
  private readonly watched: readonly { readonly storage: ModQcItems["storage"][number]; readonly words: readonly number[] }[];
  constructor(private readonly definition: ModQcItems, private readonly provider: ProviderId,
    private readonly services: ModHostServices, private readonly media: QcModMedia, private readonly operations: Operations, program: QcProgram) {
    this.admissions = definition.definitions.map(({ admission, actions, icon, ...item }) => ({ admission, definition: { ...item, source: { provider, content: media.content }, ...(icon === undefined ? {} : { icon: icon === null ? null : resolveItemIcon(icon, media.content) }), ...(actions === undefined ? {} : { actions: sourceItemActionNames(actions) }) } }));
    this.definitions = this.admissions.map(item => item.definition);
    this.offsets = new Map(program.fields.map(field => [field.name, field.offset]));
    this.watched = definition.storage.map(storage => ({ storage, words: [this.offset(storage.field), ...(storage.kind === "counter" && storage.capacity.kind === "field" ? [this.offset(storage.capacity.field)] : [])] }));
    this.watchedWords = [...new Set(this.watched.flatMap(entry => entry.words))];
    this.storageByItem = new Map(definition.storage.flatMap(storage => (storage.kind === "counter" ? [storage.item] : storage.items.map(entry => entry.item)).map(item => [item, storage] satisfies readonly [ItemId, ModQcItems["storage"][number]])));
    if (definition.weapons !== undefined && services.weapons === undefined) throw new Error("QC weapons require the destination weapon slot service");
    const stage = definition.weapons === undefined ? null : qcDeclaredWeaponStage(program, definition.weapons.stage);
    this.weapons = stage === null ? null : new QcWeaponStageBinding(stage, operations.machine, reference => {
      const actor = operations.actor(reference);
      return services.clients?.forActor(actor) == null || services.weapons?.selected(actor, provider) === true;
    });
  }
  private words(actor: ActorId) { return this.operations.machine().entities.fromReference(this.operations.reference(actor)); }
  private offset(name: string): number { const offset = this.offsets.get(name); if (offset === undefined) throw new Error(`Missing admitted source field ${name}`); return offset; }
  private read(actor: ActorId, previous?: QcEntityStoreObservation, storage = this.definition.storage): readonly InventoryEntry[] {
    const words = this.words(actor);
    const scalar = (name: string): number => {
      const offset = this.offset(name), index = (offset - (previous?.word ?? 0)) * 4;
      return previous !== undefined && index >= 0 && index + 4 <= previous.before.length
        ? new DataView(previous.before.buffer, previous.before.byteOffset, previous.before.byteLength).getFloat32(index, true) : words.float(offset);
    };
    return storage.flatMap((storage): readonly InventoryEntry[] => {
      if (storage.kind === "counter") return [{ item: storage.item, count: scalar(storage.field), capacity: storage.capacity.kind === "constant" ? storage.capacity.value : scalar(storage.capacity.field), countPolicy: { kind: "source-counter", arithmetic: "binary32" } }];
      const value = scalar(storage.field), mask = storage.items.reduce((mask, entry) => mask | entry.mask, storage.privateMask);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffff || (value & ~mask) !== 0) throw new Error("Original QC inventory contains undeclared bits");
      return storage.items.map(entry => ({ item: entry.item, count: (value & entry.mask) === 0 ? 0 : 1, capacity: 1 }));
    });
  }
  private entry(actor: ActorId, item: ItemId): InventoryEntry | undefined {
    const storage = this.storageByItem.get(item); if (storage === undefined) return undefined;
    const words = this.words(actor), count = words.float(this.offset(storage.field));
    if (storage.kind === "counter") return { item, count, capacity: storage.capacity.kind === "constant" ? storage.capacity.value : words.float(this.offset(storage.capacity.field)), countPolicy: { kind: "source-counter", arithmetic: "binary32" } };
    const bit = storage.items.find(entry => entry.item === item); if (bit === undefined) throw new Error("Admitted packed item is missing");
    return { item, count: (count & bit.mask) === 0 ? 0 : 1, capacity: 1 };
  }
  private write(actor: ActorId, entry: InventoryEntry): undefined {
    const current = this.entries.get(actor);
    if (current === undefined || !current.lease.current()) throw new Error("QC source items are no longer current");
    const words = this.words(actor);
    for (const storage of this.definition.storage) {
      if (storage.kind === "counter" && storage.item === entry.item) {
        if (!Number.isFinite(Math.fround(entry.count)) || !Number.isFinite(Math.fround(entry.capacity))) throw new Error("QC inventory exceeds source scalar precision");
        if (storage.capacity.kind === "constant" && entry.capacity !== storage.capacity.value) throw new Error("QC source capacity is immutable");
        words.setFloat(this.offset(storage.field), entry.count);
        if (storage.capacity.kind === "field") words.setFloat(this.offset(storage.capacity.field), entry.capacity);
        return undefined;
      }
      if (storage.kind === "bits") {
        const bit = storage.items.find(value => value.item === entry.item); if (bit === undefined) continue;
        if (entry.capacity !== 1 || entry.count !== 0 && entry.count !== 1) throw new Error("QC weapon ownership must be one source bit");
        const offset = this.offset(storage.field), bits = words.float(offset);
        words.setFloat(offset, entry.count === 0 ? bits & ~bit.mask : bits | bit.mask); return undefined;
      }
    }
    throw new Error("QC item write has no source field");
  }
  admit(actor: ActorId): void {
    if (this.entries.has(actor)) return;
    const owner = this.services.actors.resolveOwned(actor), client = this.services.clients?.forActor(actor);
    if (owner === null || client == null || this.services.clients?.actor(client)?.equals(actor) !== true) throw new Error("QC items require a live canonical client");
    const reference = this.operations.reference(actor);
    const lease = this.services.inventory.bindItems(owner, { owner: this.provider, items: this.admissions, invoke: (item, action) => {
      const current = this.entries.get(actor), call = this.definition.definitions.find(value => value.item === item)?.actions?.[action];
      if (current === undefined || !this.current(current) || call === undefined) throw new Error("Source item action is no longer admitted");
      this.invoke(actor, call);
    }, state: { read: () => this.read(actor), entry: item => this.entry(actor, item), write: entry => this.write(actor, entry),
      mutableCapacity: item => this.definition.storage.some(storage => storage.kind === "counter" && storage.item === item && storage.capacity.kind === "field") } });
    const entry: Entry = { actor: owner, reference, lease, removeWeapon: () => undefined }; this.entries.set(actor, entry);
    try {
      if (this.definition.weapons !== undefined) {
        const removeWeapon = this.services.weapons?.bind(owner, this.weapon(entry));
        if (removeWeapon === undefined) throw new Error("QC source weapon service is absent");
        this.entries.set(actor, { ...entry, removeWeapon });
      }
    } catch (error) { lease.close(); this.entries.delete(actor); throw error; }
  }
  private current(entry: Entry): boolean {
    return this.services.actors.resolveOwned(entry.actor.id) === entry.actor && this.entries.get(entry.actor.id)?.lease === entry.lease
      && entry.lease.current() && this.operations.reference(entry.actor.id) === entry.reference;
  }
  private invoke(actor: ActorId, call: ModSourceCall): void {
    const now = this.services.time();
    this.operations.invoke(call, new Map<ModCallbackInput, ModRuntimeValue>([["self", { kind: "actor", value: actor }], ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }]]));
  }
  private active(actor: ActorId): ItemId | null {
    const selected = this.definition.weapons?.selected; if (selected === undefined) return null;
    const value = this.words(actor).float(this.offset(selected.field)), item = selected.values.find(entry => entry.value === value)?.item;
    if (item === undefined && value !== 0) throw new Error("Original QC selected an undeclared source weapon");
    return item ?? null;
  }
  private weapon(entry: Entry): SourceWeaponBinding {
    const definition = this.definition.weapons, stage = this.weapons;
    if (definition === undefined || stage === null) throw new Error("Missing qualified QC weapon consumer");
    const actor = entry.actor.id, accepts = (item: ItemId): boolean => this.current(entry) && definition.selected.values.some(value => value.item === item) && this.services.inventory.count(actor, item) > 0;
    const select = (item: ItemId): boolean => {
      if (!accepts(item)) return false;
      const value = definition.select.values.find(value => value.item === item); if (value === undefined) return false;
      this.words(actor).setFloat(this.offset(definition.select.field), value.value); this.invoke(actor, definition.select.call);
      return this.current(entry) && this.active(actor) === item;
    };
    return { current: () => this.current(entry), read: () => this.presentation(entry), handoff: {
      kind: "immediate", provider: this.provider, accepts, select, holster: () => { if (!this.current(entry)) throw new Error("QC source weapon retired while holstering"); }, isHolstered: () => this.current(entry) && stage.settled(entry.reference),
      resume: item => { if (!this.current(entry)) throw new Error("QC source weapon retired while resuming");
        if (item !== null) return select(item);
        for (const call of definition.resume) { if (!this.current(entry)) throw new Error("QC source weapon retired while resuming"); this.invoke(actor, call); }
        return this.current(entry);
      },
    } };
  }
  private presentation(entry: Entry): SourceWeaponPresentation {
    if (!this.current(entry)) throw new Error("QC source weapon presentation has expired");
    const definition = this.definition.weapons; if (definition === undefined) throw new Error("QC source has no weapon presentation");
    const words = this.words(entry.actor.id), path = this.operations.machine().strings.get(words.int(this.offset(definition.model.field))), asset = this.media.resources.get(path);
    if (path !== "" && asset === undefined) throw new Error(`Original QC weapon model was not prepared: ${path}`);
    return { source: { provider: this.provider, content: this.media.content }, active: this.active(entry.actor.id), pending: null,
      model: asset === undefined ? null : { kind: "resolved", resource: asset.resource, frame: words.float(this.offset(definition.model.frame)) },
      items: this.definitions };
  }
  observe(store: QcEntityStoreObservation, pickup?: OriginalPickupExecution): void {
    const end = store.word + store.after.length / 4;
    let touched = false;
    for (const word of this.watchedWords) if (word >= store.word && word < end) { touched = true; break; }
    if (!touched) return;
    const affected = this.watched.filter(entry => entry.words.some(word => word >= store.word && word < end)).map(entry => entry.storage);
    const actor = this.operations.actor(store.reference), entry = this.entries.get(actor);
    if (entry === undefined) return;
    if (!this.current(entry)) throw new Error("QC source item store belongs to a retired actor");
    const before = this.read(actor, store, affected), after = this.read(actor, undefined, affected), changes: SourceItemStore[] = [];
    for (const value of after) {
      const previous = before.find(entry => entry.item === value.item);
      if (previous === undefined || previous.count === value.count && previous.capacity === value.capacity) continue;
      if (pickup !== undefined && !pickup.writes.some(write => write.kind === "inventory" && write.item === value.item
        && (previous.count === value.count || write.fields !== "capacity") && (previous.capacity === value.capacity || write.fields !== "count"))) throw new Error("Original pickup changed an undeclared source item");
      changes.push({ before: previous, after: value });
    }
    if (changes.length !== 0) entry.lease.stored(changes);
  }
  release(actor: ActorId): void {
    const entry = this.entries.get(actor); if (entry === undefined) return;
    // Invalidate the selection capability before exposing the underlying inventory again.
    this.entries.delete(actor);
    try { entry.removeWeapon(); } finally { entry.lease.close(); }
  }
  close(): void {
    const errors: unknown[] = [];
    for (const actor of this.entries.keys()) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QC source item release failed");
  }
}
