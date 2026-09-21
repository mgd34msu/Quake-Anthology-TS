import { NativeModActors, type SavedNativeActors } from "./native-mod-actors.ts";
import { NativeModClientsBinding } from "./native-mod-clients.ts";
import { readNativeDeferredDamage } from "./native-mod-deferred.ts";
import { asciiFold, type CommandInvocation } from "../../core/commands/index.ts";
import type { FrameContext } from "../../contracts/time.ts";
import { isDeepStrictEqual } from "node:util";
import type { GuestAddress, GuestCallResult, GuestCallValue, GuestValueLayout, ModuleIdentity, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModActorField, NativeModActorRecord, NativeModAddress, NativeModDeclaration, NativeModScalar, NativeModSourceCall, NativeModValue } from "../../contracts/native-mod-callbacks.ts";
import type { ProviderCheckpoint, SavedActorId } from "../../contracts/session.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { SimulationPresentation } from "../../app/bootstrap/simulation/types.ts";
import { readNativeModPresentation, type NativeModPresentationCheckpoint } from "../../app/bootstrap/simulation/native-mod-presentation.ts";
import type { NativeModHost, NativeModProjection, NativeModSourceSave } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { readModule } from "../../persistence/execution.ts";
import { decodeQ2ClassicOriginalSave } from "../../persistence/q2-classic-guest.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveReader } from "../../persistence/value.ts";
import { decodeValue, encodeValue, storageBytes } from "../../guest/abi/values.ts";
import { allocateClassicString, classicStringAllocationBytes, readClassicString, writeClassicString, readClassicVector, writeClassicVector } from "./classic/records.ts";

type Inputs = ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
type SharedField = Extract<NativeModActorField, { readonly binding: "health" | "inventory" | "inventory-capacity" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" }>;
interface Observation { readonly actor: ActorId; readonly address: GuestAddress; readonly field: SharedField; readonly bytes: Uint8Array; }
interface Invocation { observations: readonly Observation[]; readonly pending: (() => void)[]; cursor: number; }
interface InventoryChanges { count?: number; capacity?: number; }
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function shared(field: NativeModActorField): field is SharedField { return field.binding === "health" || field.binding === "inventory" || field.binding === "inventory-capacity" || field.binding === "origin" || field.binding === "velocity" || field.binding === "angles" || field.binding === "bounds-min" || field.binding === "bounds-max"; }
function scalarSize(kind: NativeModScalar): number { return storageBytes(kind, 4); }
function size(field: NativeModActorField, pointerBytes: number): number { return field.binding === "private" ? field.byteLength : field.binding === "record" || field.binding === "address" ? pointerBytes : "encoding" in field ? scalarSize(field.encoding) : 12; }
function scalar(value: number, kind: NativeModScalar): GuestCallValue {
  if (!Number.isFinite(value)) throw new RangeError(`Native mod value exceeds ${kind}`);
  if (kind === "float32") { if (!Number.isFinite(Math.fround(value))) throw new RangeError("Native mod value exceeds float32"); return { kind, value: Math.fround(value) }; }
  if (kind === "float64") return { kind, value };
  const integer = Math.trunc(value);
  if (!Number.isSafeInteger(integer) || kind === "int32" && (integer < -0x80000000 || integer > 0x7fffffff)
    || kind === "uint32" && (integer < 0 || integer > 0xffffffff) || kind === "uint64" && integer < 0) throw new RangeError(`Native mod value exceeds ${kind}`);
  if (kind === "int64" || kind === "uint64") return { kind, value: BigInt(integer) };
  if (kind === "int8" || kind === "int16") { const maximum = kind === "int8" ? 127 : 32767; if (integer < -maximum - 1 || integer > maximum) throw new RangeError(`Native mod value exceeds ${kind}`); return { kind: "int32", value: integer }; }
  if (kind === "uint8" || kind === "uint16") { if (integer < 0 || integer > (kind === "uint8" ? 255 : 65535)) throw new RangeError(`Native mod value exceeds ${kind}`); return { kind: "uint32", value: integer }; }
  return { kind, value: integer };
}
function numberResult(result: GuestCallResult): number {
  if (result.kind === "void") return 0;
  if (result.kind === "aggregate" || result.kind === "pointer") throw new Error("Native mod operation must return a scalar");
  const value = Number(result.value);
  if (!Number.isFinite(value) || typeof result.value === "bigint" && !Number.isSafeInteger(value)) throw new Error("Native callback result cannot be represented by the shared operation");
  return value;
}
function layout(value: NativeModValue): GuestValueLayout {
  return { kind: "scalar", storage: value.kind === "time" ? value.encoding : value.kind === "client" ? "int32" : value.kind === "actor" || value.kind === "address" || value.kind === "vector" || value.kind === "string" || value.kind === "userinfo" ? "pointer" : value.kind };
}
export function validateNativeModDeclaration(declaration: NativeModDeclaration): void {
  const records = new Map<string, NativeModActorRecord>(), authority = new Set<string>();
  const owned = declaration.sourceActors;
  if (owned !== undefined && (!Number.isFinite(owned.frameSeconds) || owned.frameSeconds <= 0 || owned.clock.length === 0)) throw new Error("Native owned actors require a positive source frame period and clock");
  const expectedAbi = declaration.target.api.kind === "q2-classic-game" ? "q2-classic" : "q2-rerelease";
  if (owned?.callbacks !== undefined && owned.callbacks.abi !== expectedAbi) throw new Error("Native callback ABI differs from the selected module target");
  if (owned?.combat !== undefined && (owned.callbacks === undefined || owned.combat.damage.abi !== expectedAbi
    || (owned.combat.causes.edition === "classic") !== (expectedAbi === "q2-classic"))) throw new Error("Native combat requires its matching source callback and damage ABIs");
  if (owned?.combat?.deferred !== undefined && expectedAbi !== "q2-rerelease") throw new Error("Native deferred damage requires its declared rerelease mod_t ABI");
  for (const record of declaration.actorRecords) {
    if (!record.id || records.has(record.id) || !Number.isSafeInteger(record.stride) || record.stride < 4
      || !Number.isSafeInteger(record.capacity) || record.capacity < 1 || record.capacity > 65536 || !Number.isSafeInteger(record.firstSlot) || record.firstSlot < 0) throw new Error("Invalid native mod actor record");
    records.set(record.id, record); const occupied = new Set<number>();
    for (const field of record.fields) {
      const length = size(field, declaration.target.abi.pointerBytes);
      if (!Number.isSafeInteger(field.offset) || field.offset < 0 || !Number.isSafeInteger(length) || length < 1 || field.offset + length > record.stride) throw new Error("Native mod field exceeds its source record");
      for (let byte = field.offset; byte < field.offset + length; byte++) { if (occupied.has(byte)) throw new Error("Overlapping native mod fields"); occupied.add(byte); }
      if (shared(field)) { const key = field.binding === "inventory" || field.binding === "inventory-capacity" ? `${field.binding}:${field.item}` : field.binding;
        if (authority.has(key)) throw new Error(`Multiple native stores for ${key}`); authority.add(key); }
      if (field.binding === "constant") scalar(field.value, field.encoding);
      if (field.binding === "constant-vector") for (const value of [field.value.x, field.value.y, field.value.z]) scalar(value, "float32");
    }
  }
  if (declaration.entityRecord !== null && records.get(declaration.entityRecord)?.base.kind !== "entities") throw new Error("Native engine entity record must use the source public edict table");
  const clients = declaration.clients;
  if (clients !== undefined) {
    if (!Number.isSafeInteger(clients.maximum) || clients.maximum < 1 || clients.maximum > 256 || clients.records.length === 0
      || new Set(clients.records).size !== clients.records.length || declaration.entityRecord === null
      || records.get(declaration.entityRecord)?.firstSlot !== 1) throw new Error("Invalid native component client layout");
    for (const id of clients.records) {
      const record = records.get(id);
      if (record === undefined || record.base.kind === "entities" || record.capacity < clients.maximum) throw new Error("Native component clients require declared private record arrays");
    }
    for (const call of clients.admit) {
      if (call.accepts === "nonzero" && call.returns === "void") throw new Error("Native client admission requires its declared return value");
      if (call.entry.kind === "game-export" && call.entry.name === "ClientConnect" && call.accepts !== "nonzero") throw new Error("Original native ClientConnect rejection cannot be ignored");
    }
    for (const id of clients.records) { const record = records.get(id); if (record?.base.kind === "clients" && (record.firstSlot !== 0 || record.capacity !== clients.maximum)) throw new Error("Public native client rows must match the reserved source slots"); }
    for (const record of records.values()) if (record.capacity < clients.maximum) throw new Error("Native actor array cannot hold its declared clients");
  }
  for (const record of records.values()) for (const field of record.fields) if (field.binding === "record" && !records.has(field.record)) throw new Error("Unknown linked native actor record");
  for (const record of records.values()) if (record.base.kind === "clients" && !clients?.records.includes(record.id)) throw new Error("Native public client records require declared client ownership");
  if (records.size > 0 && (declaration.project.length === 0 || declaration.release.length === 0)) throw new Error("Native actor projections require authored initialization and release callbacks");
  const check = (call: NativeModSourceCall, available: ReadonlySet<ModCallbackInput>): void => {
    for (const value of [...call.arguments, ...call.globals.map(entry => entry.value)]) {
      if (value.kind === "address") continue;
      if (value.kind === "client" || value.kind === "userinfo") { if (clients === undefined || !available.has(value.input)) throw new Error("Unavailable native client input"); continue; }
      if (value.kind === "actor") { if (!available.has(value.input) || !records.has(value.record)) throw new Error("Unavailable native actor input"); continue; }
      if (value.kind === "time") { if (!available.has(value.input)) throw new Error("Unavailable native time input"); continue; }
      const input = value.value;
      if (input.kind === "input" && !available.has(input.name)) throw new Error(`Unavailable native callback input ${input.name}`);
      const kind = input.kind !== "input" ? input.kind : ["point", "direction", "normal"].includes(input.name) ? "vector" : input.name === "item" ? "string" : ["self", "other", "activator", "attacker", "inflictor"].includes(input.name) ? "actor" : "float";
      if (kind !== (value.kind === "vector" || value.kind === "string" ? value.kind : "float")) throw new Error("Native callback input representation differs from its declaration");
    }
  };
  for (const call of declaration.initialize) check(call, new Set(["time"]));
  for (const call of [...declaration.project, ...declaration.release]) check(call, new Set(["self", "time"]));
  if (clients !== undefined) for (const call of [...clients.admit, ...clients.userinfo, ...clients.disconnect, ...clients.command]) check(call, new Set(["self", "time"]));
  const ids = new Set<string>();
  for (const call of declaration.callbacks) {
    if (ids.has(call.id) || call.stage !== "observe" && call.returns === "void") throw new Error("Duplicate native callback or missing return value"); ids.add(call.id);
    const available = new Set<ModCallbackInput>(["self", "time"]); if (call.stage === "observe") available.add("result");
    const extra: readonly ModCallbackInput[] = call.operation === "damage" ? ["attacker", "inflictor", "amount", "knockback", "direction", "point", "normal"]
      : call.operation === "inventory.give" || call.operation === "inventory.consume" ? ["item", "amount"] : call.operation === "actor.use" ? ["other", "activator"]
      : call.operation === "actor.touch" ? ["other"] : call.operation === "actor.think" ? ["elapsed"] : call.operation === "actor.pain" ? ["attacker", "amount", "knockback"] : ["attacker", "inflictor", "amount", "knockback", "point"];
    for (const name of extra) available.add(name); check(call, available);
  }
}
interface SavedNativeMod { readonly owned: SavedNativeActors | null; readonly map: string; readonly source: NativeModSourceSave; readonly presentation: NativeModPresentationCheckpoint; readonly actors: readonly { readonly actor: SavedActorId; readonly slot: number; readonly appearance: boolean }[];
  readonly clients: readonly { readonly actor: SavedActorId; readonly slot: number; readonly admitted: boolean }[]; }
function readCheckpoint(record: ProviderCheckpoint, module: ModuleIdentity, declaration: NativeModDeclaration): SavedNativeMod {
  if (record.provider !== module.id || record.schema !== "native:mod" || record.version !== 1) throw new Error("Invalid native mod checkpoint owner");
  const reader = new SaveReader(decodeCheckpointValue(record.bytes));
  if (!isDeepStrictEqual(readModule(reader.field("module")), module)) throw new Error("Native mod checkpoint differs from the selected source");
  const state = reader.field("source"), edition = state.field("edition").choice("classic", "rerelease"), map = reader.field("map").string();
  let source: NativeModSourceSave;
  if (edition === "classic") {
    if (declaration.target.api.kind !== "q2-classic-game") throw new Error("Native mod checkpoint API differs");
    const value = state.field("original"); const original = { provider: namespaced(value.field("provider")), schema: namespaced(value.field("schema")), version: value.field("version").integer(1), bytes: value.field("bytes").bytes() };
    decodeQ2ClassicOriginalSave(original, { module, map }); source = { edition, original };
  } else {
    if (declaration.target.api.kind !== "q2-rerelease-game") throw new Error("Native mod checkpoint API differs");
    source = { edition, game: state.field("game").bytes(), level: state.field("level").bytes(), cvars: state.field("cvars").bytes(),
      configstrings: state.field("configstrings").list(entry => ({ index: entry.field("index").integer(0), value: entry.field("value").string() })) };
    if (source.game.includes(0) || source.level.includes(0) || source.game.length === 0 || source.level.length === 0) throw new Error("Invalid native source JSON save");
    decodeCheckpointValue(source.cvars);
  }
  const actors = reader.field("actors").list(entry => ({ actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) }, slot: entry.field("slot").integer(0), appearance: entry.field("appearance").boolean() }));
  const capacity = Math.min(...declaration.actorRecords.filter(record => !declaration.clients?.records.includes(record.id)).map(record => record.capacity));
  if (actors.length > 0 && declaration.actorRecords.length === 0 || actors.some(entry => entry.slot >= capacity)
    || new Set(actors.map(entry => entry.slot)).size !== actors.length || new Set(actors.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== actors.length) throw new Error("Invalid native mod actor checkpoint");
  const clientReader = reader.field("clients"), clients = clientReader.value === undefined ? [] : clientReader.list(entry => ({ actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) }, slot: entry.field("slot").integer(0), admitted: entry.field("admitted").boolean() }));
  const maximum = declaration.clients?.maximum ?? 0;
  if (declaration.clients !== undefined && clientReader.value === undefined || clients.length > maximum
    || new Set(clients.map(entry => entry.slot)).size !== clients.length || new Set(clients.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== clients.length
    || clients.some(entry => entry.slot >= maximum || !actors.some(actor => actor.slot === entry.slot && actor.actor.slot === entry.actor.slot && actor.actor.generation === entry.actor.generation))
    || actors.some(actor => actor.slot < maximum && !clients.some(client => client.slot === actor.slot))) throw new Error("Invalid native component client checkpoint");
  const ownedReader = reader.field("owned");
  const owned = ownedReader.value === undefined || ownedReader.value === null ? null : {
    nextFrame: ownedReader.field("nextFrame").finite(), frame: ownedReader.field("frame").integer(0),
    deferred: ownedReader.field("deferred").value === undefined ? [] : ownedReader.field("deferred").list(readNativeDeferredDamage),
    actors: ownedReader.field("actors").list(entry => ({ actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) }, slot: entry.field("slot").integer(1), linked: entry.field("linked").boolean() })) };
  if ((owned !== null) !== (declaration.sourceActors !== undefined) || owned !== null && (new Set(owned.actors.map(entry => entry.slot)).size !== owned.actors.length || new Set(owned.actors.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== owned.actors.length)) throw new Error("Invalid native owned actor checkpoint");
  if (owned !== null && (owned.deferred.length > 0 && declaration.sourceActors?.combat?.deferred === undefined || new Set(owned.deferred.map(entry => `${entry.target.slot}:${entry.target.generation}`)).size !== owned.deferred.length
    || owned.deferred.some(entry => !owned.actors.some(actor => actor.actor.slot === entry.target.slot && actor.actor.generation === entry.target.generation)))) throw new Error("Invalid native deferred attack checkpoint");
  return { map, source, actors, owned, clients, presentation: readNativeModPresentation(reader.field("presentation")) };
}
export function validateNativeModCheckpoint(record: ProviderCheckpoint, module: ModuleIdentity, declaration: NativeModDeclaration): void { readCheckpoint(record, module, declaration); }

/** Typed component callbacks run in the original native module and borrow canonical actors. */
export class NativeModProvider implements NativeModProjection {
  private host_: NativeModHost | null = null;
  private owned: NativeModActors | null = null;
  private clients: NativeModClientsBinding | null = null;
  private readonly records = new Map<string, NativeModActorRecord>();
  private readonly nonclientRecords: readonly NativeModActorRecord[];
  private readonly projections = new Map<ActorId, number>();
  private readonly frames: Invocation[] = [];
  private readonly appearanceActors = new Set<ActorId>();
  private readonly pendingReleases = new Set<ActorId>();
  private readonly unsubscribe: () => undefined;
  private closed = false;
  private closing = false;
  private ready = false;
  private lifecycle = false;
  private restoring = false;
  private readonly restoreLinks = new Map<number, { readonly address: GuestAddress; readonly invoke: () => GuestCallResult }>();
  constructor(readonly declaration: NativeModDeclaration, readonly services: ModHostServices, readonly instance: ProviderId,
    readonly map: string, private readonly assertCurrent: () => void) {
    validateNativeModDeclaration(declaration); for (const record of declaration.actorRecords) this.records.set(record.id, record);
    this.nonclientRecords = declaration.actorRecords.filter(record => !declaration.clients?.records.includes(record.id));
    this.unsubscribe = services.actors.onRelease(actor => { if (this.projections.has(actor.id)) { this.pendingReleases.add(actor.id); this.host_?.presentation.release(actor.id); } return undefined; });
  }
  attach(host: NativeModHost): void { if (this.host_ !== null) throw new Error("Native mod already attached"); this.host_ = host;
    if (this.declaration.clients !== undefined) {
      const services = this.services.clients;
      if (services === undefined) throw new Error("Native component clients require destination client services");
      this.clients = new NativeModClientsBinding({ services, declaration: this.declaration.clients, content: host.content,
        project: actor => { this.address(actor); }, release: actor => {
          if (this.closing) { host.presentation.release(actor); this.projections.delete(actor); this.appearanceActors.delete(actor); this.pendingReleases.delete(actor); }
          else { this.pendingReleases.add(actor); this.releasePending(); }
        },
        invoke: (call, actor) => this.execute(call, this.inputs(actor), true), withCommand: (command, invoke) => host.withCommand(command, invoke) });
    }
    if (this.declaration.sourceActors !== undefined) this.owned = new NativeModActors(this.declaration.sourceActors, this.declaration, host, this.services, this.instance, {
      resolve: address => this.resolve(address), scalar: (address, value, encoding) => this.scalarWrite(address, value, encoding),
      combat: { eligible: actor => !this.clients?.rejects(actor), transfer: invoke => this.transfer(invoke), scalar: (base, field, value) => { const address = host.memory.offset(base, BigInt(field.offset)); if (value !== undefined) this.scalarWrite(address, value, field.encoding); return this.scalarRead(address, field.encoding); },
        synchronize: () => { this.flush(); this.refresh(); const frame = this.frames.at(-1); if (frame !== undefined) frame.observations = this.observe(); } },
      invoke: (entry, values, returns) => this.executeEntry(entry, values, returns), address: actor => this.address(actor), actorAt: slot => this.actorAt(slot),
      beginFrame: () => { for (const entry of this.entries()) this.host.clearEntityEvent(entry.slot); this.host.presentation.beginFrame(); }, endFrame: () => this.publish() });
  }
  private get host(): NativeModHost { if (this.host_ === null) throw new Error("Native mod has no source host"); return this.host_; }
  private current(): void { if (!this.closing) this.assertCurrent(); if (this.closed) throw new Error("Native mod is closed"); }
  private inputs(actor?: ActorId): Map<ModCallbackInput, ModRuntimeValue> { const time = this.services.time(); const values = new Map<ModCallbackInput, ModRuntimeValue>([["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }]]); if (actor !== undefined) values.set("self", { kind: "actor", value: actor }); return values; }
  private resolve(value: NativeModAddress): GuestAddress {
    const memory = this.host.memory; let address = memory.offset(this.host.imageBase, BigInt(value.rva));
    for (const offset of value.indirections) { const pointer = memory.readPointer(address); if (pointer === null) throw new Error("Native mod layout follows a null source pointer"); address = memory.offset(pointer, BigInt(offset)); }
    return address;
  }
  private base(record: NativeModActorRecord): GuestAddress {
    const memory = this.host.memory;
    if (record.base.kind === "address") return memory.offset(this.resolve(record.base), BigInt(record.firstSlot * record.stride));
    if (record.base.kind === "clients") throw new Error("Native private client rows are addressed through their source edicts");
    const entities = this.host.entities();
    if (entities.stride !== record.stride || record.firstSlot + record.capacity > entities.capacity) throw new Error("Declared native actor layout differs from the source export table");
    return memory.offset(entities.base, BigInt(record.firstSlot * record.stride));
  }
  private recordAddress(record: NativeModActorRecord, slot: number): GuestAddress {
    if (record.base.kind === "clients") {
      const address = this.host.client(record.firstSlot + slot + 1);
      if (address === null) throw new Error("Authored native initialization has not provided this client's private storage");
      this.host.memory.check(address, record.stride, "write"); return address;
    }
    return this.host.memory.offset(this.base(record), BigInt(slot * record.stride));
  }
  private actorRecords(actor: ActorId): readonly NativeModActorRecord[] {
    return this.clients?.has(actor) === true ? this.declaration.actorRecords : this.nonclientRecords;
  }
  private scalarWrite(address: GuestAddress, value: number, kind: NativeModScalar): void {
    this.host.memory.write(address, encodeValue({ kind: "scalar", storage: kind }, scalar(value, kind), this.host.memory));
  }
  private scalarRead(address: GuestAddress, kind: NativeModScalar): number {
    return numberResult(decodeValue({ kind: "scalar", storage: kind }, this.host.memory.copy(address, scalarSize(kind)), this.host.memory));
  }
  private pointer(actor: ActorId | null, id: string): GuestAddress | null {
    if (actor === null) return null;
    const owned = this.owned?.slotOf(actor);
    if (owned !== undefined && owned !== null) { if (id !== this.declaration.entityRecord) throw new Error("Owned native actor requires its original edict record"); return this.host.entity(owned).address; }
    const record = this.records.get(id); if (record === undefined) throw new Error("Unknown native actor record");
    const clientSlot = this.clients?.slot(actor) ?? null;
    if (this.declaration.clients?.records.includes(id) && clientSlot === null) return null;
    let slot = this.projections.get(actor);
    if (slot === undefined) {
      if (!this.services.actors.isLive(actor)) throw new Error("Native mod cannot borrow an expired actor");
      this.validateInventoryCapacity(actor);
      this.releasePending(); const occupied = new Set(this.projections.values()); let next = clientSlot ?? this.declaration.clients?.maximum ?? 0;
      if (clientSlot === null) while (occupied.has(next)) next++;
      else if (occupied.has(next)) throw new Error("Native source client row is already projected");
      if (this.actorRecords(actor).some(record => next >= record.capacity)) throw new Error("Native actor projection capacity exceeded");
      for (const record of this.actorRecords(actor)) if (record.base.kind === "entities" && record.firstSlot + next >= this.host.entities().count) throw new Error("Native actor projection requires a slot allocated by its authored initialization");
      slot = next; this.projections.set(actor, slot);
      try {
        const sourceSlot = this.slotOf(actor), appearance = sourceSlot === null ? null : this.host.presentation.signature(sourceSlot);
        this.seed(actor, slot); if (clientSlot === null) for (const call of this.declaration.project) this.execute(call, this.inputs(actor), false); this.seed(actor, slot);
        if (sourceSlot !== null && appearance !== this.host.presentation.signature(sourceSlot)) this.appearanceActors.add(actor);
      }
      catch (error) { try { if (clientSlot === null) for (const call of this.declaration.release) this.execute(call, this.inputs(actor), false); } finally { this.host.presentation.release(actor); this.projections.delete(actor); this.appearanceActors.delete(actor); } throw error; }
    }
    return this.recordAddress(record, slot);
  }
  private seed(actor: ActorId, slot: number, constants = true): void {
    const memory = this.host.memory;
    for (const record of this.actorRecords(actor)) for (const field of record.fields) {
      const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset));
      if (field.binding === "constant" && constants) this.scalarWrite(address, field.value, field.encoding);
      else if (field.binding === "address") memory.writePointer(address, field.value === null ? null : this.resolve(field.value));
      else if (field.binding === "constant-vector" && constants) writeClassicVector(memory, address, field.value);
      else if (field.binding === "record") memory.writePointer(address, this.pointer(actor, field.record));
    }
  }
  slotOf(actor: ActorId): number | null {
    if (actor === this.services.engine?.world()) return 0;
    const owned = this.owned?.slotOf(actor); if (owned !== undefined && owned !== null) return owned;
    const index = this.projections.get(actor), definition = this.declaration.entityRecord === null ? undefined : this.records.get(this.declaration.entityRecord);
    return index === undefined || definition === undefined ? null : definition.firstSlot + index;
  }
  actorAt(slot: number): ActorId | null {
    if (slot === 0) return this.services.engine?.world() ?? null;
    const owned = this.owned?.actorAt(slot); if (owned !== undefined && owned !== null) return owned.id;
    for (const actor of this.projections.keys()) if (this.slotOf(actor) === slot && this.services.actors.isLive(actor)) return actor;
    return null;
  }
  acceptsClient(slot: number): boolean { const actor = this.actorAt(slot); return actor !== null && (this.clients?.has(actor) ?? (this.services.engine?.presentation?.players().includes(actor) ?? false)); }
  appearanceOverrides(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [];
    for (const actor of this.appearanceActors) { const slot = this.slotOf(actor); if (slot !== null && this.services.actors.isLive(actor)) result.push(...this.host.presentation.appearance(actor, slot)); }
    return result;
  }
  project(record: RawEntityView): OwnedActor | null {
    if (record.slot === 0) { const world = this.services.engine?.world() ?? null; return world === null ? null : this.services.actors.resolveOwned(world); }
    const owned = this.owned?.actorAt(record.slot); if (owned !== undefined && owned !== null) return owned;
    const definition = this.declaration.entityRecord === null ? undefined : this.records.get(this.declaration.entityRecord);
    if (definition === undefined) return null;
    const slot = record.slot - definition.firstSlot;
    for (const [actor, index] of this.projections) if (index === slot) return this.services.actors.resolveOwned(actor);
    return null;
  }
  address(actor: ActorId): GuestAddress {
    if (actor === this.services.engine?.world()) return this.host.entities().base;
    const owned = this.owned?.slotOf(actor); if (owned !== undefined && owned !== null) return this.host.entity(owned).address;
    if (this.declaration.entityRecord === null) throw new Error("Native mod requires a declared engine actor projection");
    const value = this.pointer(actor, this.declaration.entityRecord); if (value === null) throw new Error("Native actor projection returned null"); return value;
  }
  private validateInventoryCapacity(actor: ActorId, client = this.clients?.has(actor) === true): void {
    for (const record of client ? this.declaration.actorRecords : this.nonclientRecords) for (const field of record.fields) if (field.binding === "inventory-capacity"
      && !this.services.inventory.mutableCapacity(actor, field.item)) throw new Error(`Native mod requires mutable inventory capacity for ${field.item}`);
  }
  private refresh(): void {
    const memory = this.host.memory;
    for (const [actor, slot] of this.projections) {
      this.validateInventoryCapacity(actor);
      const inventory = this.services.inventory.entries(actor);
      for (const record of this.actorRecords(actor)) for (const field of record.fields) if (shared(field)) {
        const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset));
        if (field.binding === "health") this.scalarWrite(address, this.services.combat.read(actor)?.health ?? 0, field.encoding);
        else if (field.binding === "inventory" || field.binding === "inventory-capacity") {
          const entry = inventory.find(entry => entry.item === field.item);
          this.scalarWrite(address, entry === undefined ? 0 : field.binding === "inventory" ? entry.count : entry.capacity, field.encoding);
        }
        else { const state = this.services.bodies.read(actor); writeClassicVector(memory, address, state === null ? zero : field.binding === "bounds-min" ? state.bounds.min : field.binding === "bounds-max" ? state.bounds.max : state[field.binding]); }
      }
    }
    if (this.frames.length !== 0) { const observations = this.observe(); for (const frame of this.frames) frame.observations = observations; }
  }
  private observe(): readonly Observation[] {
    const values: Observation[] = [], memory = this.host.memory;
    for (const [actor, slot] of this.projections) for (const record of this.actorRecords(actor)) for (const field of record.fields) if (shared(field)) {
      const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset)); values.push({ actor, address, field, bytes: memory.copy(address, size(field, memory.pointerBytes)) });
    }
    return values;
  }
  private flush(): void {
    const frame = this.frames.at(-1); if (frame === undefined) return;
    const memory = this.host.memory, changed = frame.observations.filter(entry => !isDeepStrictEqual(entry.bytes, memory.copy(entry.address, entry.bytes.length)));
    frame.observations = this.observe();
    if (changed.length === 0 && frame.cursor === frame.pending.length) return;
    const inventoryChanges = new Map<ActorId, Map<ItemId, InventoryChanges>>();
    for (const { actor, address, field } of changed) if (field.binding === "inventory" || field.binding === "inventory-capacity") {
      let items = inventoryChanges.get(actor); if (items === undefined) { items = new Map<ItemId, InventoryChanges>(); inventoryChanges.set(actor, items); }
      let entry = items.get(field.item); if (entry === undefined) { entry = {}; items.set(field.item, entry); }
      if (field.binding === "inventory") entry.count = this.scalarRead(address, field.encoding); else entry.capacity = this.scalarRead(address, field.encoding);
    }
    const committedInventory = new Set<InventoryChanges>();
    const queue = (actor: ActorId, commit: (owner: OwnedActor) => void): void => { frame.pending.push(() => {
      if (this.clients?.rejects(actor)) return;
      const owner = this.services.actors.resolveOwned(actor); if (owner === null) throw new Error("Native mod wrote an expired actor");
      commit(owner);
    }); };
    for (const { actor, address, field } of changed) {
      if (field.binding === "health") { const value = this.scalarRead(address, field.encoding); queue(actor, owner => { this.services.combat.setHealth(owner, value); }); }
      else if (field.binding === "inventory" || field.binding === "inventory-capacity") {
        const changes = inventoryChanges.get(actor)?.get(field.item); if (changes === undefined) throw new Error("Native inventory changes lost their source observation");
        if (committedInventory.has(changes)) continue;
        committedInventory.add(changes); queue(actor, owner => {
          const entry = this.services.inventory.entries(actor).find(entry => entry.item === field.item); if (entry === undefined) throw new Error("Native mod wrote an undeclared destination item");
          if (changes.capacity !== undefined && !this.services.inventory.mutableCapacity(actor, field.item)) throw new Error(`Native mod requires mutable inventory capacity for ${field.item}`);
          this.services.inventory.configure(owner, { ...entry, ...changes });
        });
      }
      else {
        const value = readClassicVector(memory, address); for (const component of [value.x, value.y, value.z]) scalar(component, "float32");
        queue(actor, owner => {
          const body = this.services.bodies.read(actor); if (body === null) throw new Error("Native mod wrote an actor without a body");
          const next = field.binding === "bounds-min" ? { ...body, bounds: { ...body.bounds, min: value } } : field.binding === "bounds-max" ? { ...body, bounds: { ...body.bounds, max: value } } : { ...body, [field.binding]: value }; this.services.bodies.write(owner, next);
        });
      }
    }
    while (frame.cursor < frame.pending.length) { const commit = frame.pending[frame.cursor++]; if (commit === undefined) throw new Error("Native source commit disappeared"); commit(); }
    frame.pending.length = 0; frame.cursor = 0;
  }
  private lower(value: NativeModValue, inputs: Inputs, allocations: { readonly address: GuestAddress; readonly bytes: number }[], corrections: (() => void)[]): GuestCallValue {
    if (value.kind === "address") return { kind: "pointer", value: value.value === null ? null : this.resolve(value.value) };
    if (value.kind === "actor") { const input = inputs.get(value.input); if (input?.kind !== "actor") throw new Error("Missing native actor input"); return { kind: "pointer", value: this.pointer(input.value, value.record) }; }
    if (value.kind === "client" || value.kind === "userinfo") {
      const input = inputs.get(value.input), clients = this.clients;
      if (input?.kind !== "actor" || input.value === null || clients === null) throw new Error("Missing native client input");
      const actor = input.value, slot = clients.slot(actor);
      if (slot === null) throw new Error("Native client input does not identify a destination client");
      if (value.kind === "client") return { kind: "int32", value: slot };
      const capacity = this.declaration.target.api.kind === "q2-classic-game" ? 512 : 2048, bytes = capacity + 4;
      const address = this.host.memory.allocate({ byteLength: bytes, label: "native mod mutable userinfo" });
      allocations.push({ address, bytes });
      const before = clients.userinfo(actor);
      if (this.declaration.target.api.kind === "q2-classic-game") writeClassicString(this.host.memory, address, before, capacity);
      else { const bytes = new TextEncoder().encode(before); if (bytes.length >= capacity || bytes.includes(0)) throw new Error("Native userinfo exceeds its public API string limit"); this.host.memory.write(address, new Uint8Array([...bytes, 0])); }
      corrections.push(() => {
        let after: string;
        if (this.declaration.target.api.kind === "q2-classic-game") after = readClassicString(this.host.memory, address, capacity);
        else { const bytes = this.host.memory.copy(address, capacity), end = bytes.indexOf(0); if (end < 0) throw new Error("Original native userinfo is unterminated"); after = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)); }
        if (after !== before) clients.setUserinfo(actor, after);
      });
      return { kind: "pointer", value: address };
    }
    if (value.kind === "time") { const input = inputs.get(value.input); if (input?.kind !== "float") throw new Error("Missing native time input"); return scalar(input.value * (value.units === "milliseconds" ? 1000 : 1), value.encoding); }
    const resolved = value.value.kind === "input" ? inputs.get(value.value.name) : value.value;
    if (value.kind === "vector") { if (resolved?.kind !== "vector") throw new Error("Missing native vector input"); const address = this.host.memory.allocate({ byteLength: 12, label: "native mod vector argument" }); allocations.push({ address, bytes: 12 }); writeClassicVector(this.host.memory, address, resolved.value); return { kind: "pointer", value: address }; }
    if (value.kind === "string") { if (resolved?.kind !== "string") throw new Error("Missing native string input"); const address = allocateClassicString(this.host.memory, resolved.value); allocations.push({ address, bytes: classicStringAllocationBytes(resolved.value) }); return { kind: "pointer", value: address }; }
    if (resolved?.kind !== "float") throw new Error("Missing native scalar input"); return scalar(resolved.value, value.kind);
  }
  private gameEntry(call: NativeModSourceCall): GuestAddress {
    if (call.entry.kind !== "game-export") throw new Error("Expected public native game entry");
    const entry = this.host.gameEntry(call.entry.name);
    const signature = { abi: this.declaration.target.abi, parameters: call.arguments.map(layout),
      result: call.returns === "void" ? "void" : { kind: "scalar", storage: call.returns }, variadic: false };
    if (!isDeepStrictEqual(signature, entry.signature)) throw new Error("Native component callback differs from its public game ABI");
    return entry.address;
  }
  private execute(call: NativeModSourceCall, inputs: Inputs, transfer: boolean): number {
    this.current(); this.owned?.synchronizeClock(); if (transfer) this.flush();
    const allocations: { readonly address: GuestAddress; readonly bytes: number }[] = [], globals: { readonly address: GuestAddress; readonly bytes: Uint8Array }[] = [], corrections: (() => void)[] = [];
    let frame: Invocation | null = null;
    try {
      const arguments_ = call.arguments.map(value => this.lower(value, inputs, allocations, corrections));
      for (const global of call.globals) {
        const address = this.resolve(global.address), lowered = this.lower(global.value, inputs, allocations, corrections);
        const storage = layout(global.value);
        const length = global.value.kind === "vector" ? 12 : storage.kind === "scalar" ? storageBytes(storage.storage, this.host.memory.pointerBytes) : storage.layout.byteLength;
        globals.push({ address, bytes: this.host.memory.copy(address, length) });
        if (global.value.kind === "vector") { if (lowered.kind !== "pointer" || lowered.value === null) throw new Error("Missing native vector storage"); this.host.memory.write(address, this.host.memory.copy(lowered.value, 12)); }
        else if (lowered.kind === "pointer") this.host.memory.writePointer(address, lowered.value);
        else if (lowered.kind === "aggregate") throw new Error("Native mod aggregate global requires a declared layout");
        else this.host.memory.write(address, encodeValue(storage, lowered, this.host.memory));
      }
      const appearances = new Map<ActorId, string>();
      if (transfer) for (const actor of this.projections.keys()) { const slot = this.slotOf(actor); if (slot !== null) appearances.set(actor, this.host.presentation.signature(slot)); }
      if (transfer) { this.refresh(); frame = { observations: this.observe(), pending: [], cursor: 0 }; this.frames.push(frame); }
      const target = call.entry.kind === "game-export" ? this.gameEntry(call) : call.entry.kind === "export" ? this.host.entry(call.entry.name) : this.host.memory.offset(this.host.imageBase, BigInt(call.entry.rva));
      this.host.memory.check(target, 1, "execute");
      const result = this.host.invoke(target, { abi: this.declaration.target.abi, parameters: call.arguments.map(layout), result: call.returns === "void" ? "void" : { kind: "scalar", storage: call.returns }, variadic: false }, arguments_);
      for (const correct of corrections) correct();
      if (transfer) {
        this.flush();
        for (const [actor, before] of appearances) { const slot = this.slotOf(actor); if (slot !== null && before !== this.host.presentation.signature(slot)) this.appearanceActors.add(actor); }
        this.publish();
      }
      return numberResult(result);
    } finally {
      if (frame !== null) this.frames.pop();
      for (const global of globals.reverse()) this.host.memory.write(global.address, global.bytes);
      for (const allocation of allocations.reverse()) this.host.memory.unmap(allocation.address, allocation.bytes);
      if (transfer && this.frames.length === 0) this.releasePending();
    }
  }
  private transfer<Result>(invoke: () => Result): Result {
    this.current(); this.owned?.synchronizeClock(); this.flush(); this.refresh();
    const frame: Invocation = { observations: this.observe(), pending: [], cursor: 0 }; this.frames.push(frame);
    try {
      const result = invoke(); this.flush();
      if (this.owned?.advancing !== true) this.publish(); return result;
    } finally { this.frames.pop(); }
  }
  private executeEntry(entry: GuestAddress, values: readonly Extract<GuestCallValue, { readonly kind: "pointer" }>[], returns: NativeModScalar | "void"): GuestCallResult {
    return this.transfer(() => this.host.invoke(entry, { abi: this.declaration.target.abi,
      parameters: values.map(() => ({ kind: "scalar", storage: "pointer" })),
      result: returns === "void" ? "void" : { kind: "scalar", storage: returns }, variadic: false }, values));
  }
  invokeCommand(command: CommandInvocation): boolean {
    if (asciiFold(command.argv[0] ?? "") !== "sv") return this.clients?.invokeCommand(command) ?? false;
    command.assertActive(); this.releasePending();
    return this.transfer(() => {
      const appearances = new Map<ActorId, string>();
      for (const actor of this.projections.keys()) { const slot = this.slotOf(actor); if (slot !== null) appearances.set(actor, this.host.presentation.signature(slot)); }
      const result = this.host.invokeCommand(command);
      for (const [actor, before] of appearances) { const slot = this.slotOf(actor); if (slot !== null && before !== this.host.presentation.signature(slot)) this.appearanceActors.add(actor); }
      return result;
    });
  }
  private entries(): readonly { readonly actor: ActorId; readonly slot: number }[] {
    const result = [...(this.owned?.entries() ?? [])];
    for (const actor of this.projections.keys()) { const slot = this.slotOf(actor); if (slot !== null && this.services.actors.isLive(actor)) result.push({ actor, slot }); }
    return result;
  }
  private publish(events = true): void { this.host.presentation.publish(this.entries(), events); }
  presentations(): readonly SimulationPresentation[] { return (this.owned?.entries() ?? []).flatMap(({ actor, slot }) => this.host.presentation.appearance(actor, slot)); }
  advance(frame: FrameContext): undefined { this.current(); this.releasePending(); this.owned?.advance(frame); this.publish(); if (this.owned === null) { for (const entry of this.entries()) this.host.clearEntityEvent(entry.slot); this.host.presentation.beginFrame(); } return undefined; }
  importBoundary(name: string, values: readonly GuestCallValue[], invoke: () => GuestCallResult): GuestCallResult {
    if (!this.ready) return invoke();
    // ReadLevel and projection retirement rebuild private edicts; the destination owns their live links.
    if (this.lifecycle) {
      if (name !== "linkentity" && name !== "unlinkentity") return invoke();
      const value = values[0];
      if (this.restoring && value?.kind === "pointer" && value.value !== null) {
        const table = this.host.entities(), offset = value.value.byteOffset - table.base.byteOffset;
        if (offset < 0n || offset % BigInt(table.stride) !== 0n || offset / BigInt(table.stride) >= BigInt(table.count)) throw new Error("Native restore links outside its source table");
        this.restoreLinks.set(Number(offset / BigInt(table.stride)), { address: value.value, invoke });
      }
      return { kind: "void" };
    }
    this.flush();
    if (name === "linkentity" || name === "unlinkentity" || name === "setmodel") {
      const value = values[0]; if (value?.kind !== "pointer" || value.value === null) throw new Error("Native entity import requires an actor");
      const world = this.host.entities().base, actor = [...this.projections.keys()].find(actor => this.address(actor).byteOffset === value.value?.byteOffset);
      const owned = this.owned?.entries().find(entry => this.host.entity(entry.slot).address.byteOffset === value.value?.byteOffset);
      if (value.value.byteOffset !== world.byteOffset && actor === undefined && owned === undefined) throw new Error("Native source allocated an actor without a declared shared lifecycle");
      if (actor !== undefined && (name === "linkentity" || name === "unlinkentity")) {
        const owner = this.services.actors.resolveOwned(actor); if (owner === null) throw new Error("Native mod linked an expired actor");
        if (name === "linkentity") this.services.bodies.link(owner); else this.services.bodies.unlink(owner);
        return { kind: "void" };
      }
    }
    try { return invoke(); } finally { this.refresh(); const frame = this.frames.at(-1); if (frame !== undefined) frame.observations = this.observe(); }
  }
  private releasePending(): void {
    if (this.frames.length !== 0 || this.lifecycle || this.closed) return;
    this.owned?.drainReleases();
    this.lifecycle = true;
    try { for (const actor of this.pendingReleases) { if (!this.clients?.has(actor)) for (const call of this.declaration.release) this.execute(call, this.inputs(actor), false); this.host.presentation.release(actor); this.projections.delete(actor); this.appearanceActors.delete(actor); this.pendingReleases.delete(actor); this.clients?.forget(actor); } }
    finally { this.lifecycle = false; }
  }
  private validateRecords(): void {
    const ranges = [...this.records.values()].flatMap(record => record.base.kind === "clients"
      ? Array.from({ length: record.capacity }, (_, slot) => ({ address: this.recordAddress(record, slot), bytes: record.stride }))
      : [{ address: this.base(record), bytes: record.stride * record.capacity }]);
    for (const range of ranges) this.host.memory.check(range.address, range.bytes, "write");
    for (const [index, range] of ranges.entries()) for (const previous of ranges.slice(0, index)) if (range.address.byteOffset < previous.address.byteOffset + BigInt(previous.bytes) && previous.address.byteOffset < range.address.byteOffset + BigInt(range.bytes)) throw new Error("Overlapping native actor arrays");
  }
  async initialize(restoring = false): Promise<void> {
    this.current(); this.owned?.suspend(restoring); await this.host.initialize(restoring); this.current();
    if (!restoring) this.owned?.validate();
    if (!restoring) { this.validateRecords(); for (const call of this.declaration.initialize) this.execute(call, this.inputs(), false); }
    const clients = this.declaration.clients;
    for (const call of [...this.declaration.initialize, ...this.declaration.project, ...this.declaration.release, ...this.declaration.callbacks,
      ...(clients === undefined ? [] : [...clients.admit, ...clients.userinfo, ...clients.disconnect, ...clients.command])]) {
      const target = call.entry.kind === "game-export" ? this.gameEntry(call) : call.entry.kind === "export" ? this.host.entry(call.entry.name) : this.host.memory.offset(this.host.imageBase, BigInt(call.entry.rva)); this.host.memory.check(target, 1, "execute");
    }
    this.ready = true; if (!restoring) { this.clients?.start(); this.publish(); }
  }
  invoke(call: NativeModSourceCall, inputs: Inputs): number | null {
    this.current();
    for (const input of inputs.values()) if (input.kind === "actor" && input.value !== null && this.clients?.rejects(input.value)) return null;
    return this.execute(call, inputs, true);
  }
  async checkpoint(): Promise<ProviderCheckpoint> {
    this.current(); if (this.frames.length !== 0) throw new Error("Cannot save an active native mod callback"); this.releasePending();
    const clients = this.clients?.checkpoint() ?? [];
    const source = await this.host.checkpoint(); this.current(); if (this.pendingReleases.size !== 0) throw new Error("Actors changed during native mod capture");
    return { provider: this.instance, schema: "native:mod", version: 1, bytes: encodeCheckpointValue({ module: this.host.memory.module, map: this.map, source, owned: this.owned?.checkpoint() ?? null, presentation: this.host.presentation.checkpoint(),
      clients: clients.map(entry => ({ actor: { slot: entry.actor.slot, generation: entry.actor.generation }, slot: entry.slot, admitted: entry.admitted })),
      actors: [...this.projections].map(([actor, slot]) => ({ actor: { slot: actor.slot, generation: actor.generation }, slot, appearance: this.appearanceActors.has(actor) })) }) };
  }
  async restore(record: ProviderCheckpoint): Promise<void> {
    this.current(); if (this.frames.length !== 0) throw new Error("Cannot restore an active native callback");
    const saved = readCheckpoint(record, this.host.memory.module, this.declaration); if (saved.map !== this.map) throw new Error("Native mod source save belongs to another map");
    const actors = saved.actors.map(entry => ({ actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"), slot: entry.slot, appearance: entry.appearance }));
    for (const entry of actors) if (!this.services.actors.isLive(entry.actor)) throw new Error("Saved native projection actor is unavailable");
    const clients = saved.clients.map(entry => ({ ...entry, actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current") }));
    this.clients?.validateRestore(clients);
    const clientActors = new Set(clients.map(entry => entry.actor));
    for (const entry of actors) this.validateInventoryCapacity(entry.actor, clientActors.has(entry.actor));
    for (const entry of saved.presentation.fog) { const actor = this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"); if (!this.services.actors.isLive(actor)) throw new Error("Saved native presentation player is unavailable"); }
    const ownedActors = saved.owned === null ? [] : this.owned?.validateSaved(saved.owned) ?? [];
    this.lifecycle = true; this.restoring = true; this.restoreLinks.clear(); this.owned?.suspend(true);
    try { this.clients?.restore(clients); this.appearanceActors.clear(); for (const entry of actors) if (entry.appearance) this.appearanceActors.add(entry.actor); this.projections.clear(); for (const entry of actors) this.projections.set(entry.actor, entry.slot); this.pendingReleases.clear(); await this.host.restore(saved.source);
      this.validateRecords(); for (const [actor, slot] of this.projections) this.seed(actor, slot, false); this.refresh(); this.host.presentation.restore(saved.presentation);
      if (saved.owned !== null) this.owned?.restore(saved.owned, ownedActors);
      for (const [slot, link] of this.restoreLinks) if (this.owned?.actorAt(slot) != null) {
        if (this.host.entity(slot).address.byteOffset !== link.address.byteOffset) throw new Error("Native restore retained a stale source link");
        link.invoke();
      }
      this.publish(false); }
    finally { this.lifecycle = false; this.restoring = false; this.restoreLinks.clear(); this.owned?.suspend(false); }
    this.clients?.start();
  }
  close(): undefined {
    if (this.closed || this.closing) return undefined; this.closing = true;
    const errors: unknown[] = [];
    try { this.clients?.close(); } catch (error) { errors.push(error); }
    try { this.owned?.close(); } catch (error) { errors.push(error); }
    this.closed = true; this.unsubscribe(); this.projections.clear(); this.appearanceActors.clear(); this.pendingReleases.clear();
    try { this.host_?.presentation.close(); } catch (error) { errors.push(error); }
    try { this.host_?.close(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native mod cleanup failed");
    return undefined;
  }
}
