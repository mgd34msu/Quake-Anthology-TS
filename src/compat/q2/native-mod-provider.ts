import type { NativeModArmorField } from "../../contracts/native-mod-callbacks.ts";
import { SourceModClientOutputs, validateModClientOutputs } from "../../world/session/mod-client-outputs.ts";
import { ModSourceObjectives } from "../../world/session/mod-objectives.ts";
import { originalTeam, sourceTeam, type SourceMatchPlayer, readSourceMatchField, writeSourceMatchField, validateSourceMatchField } from "../../contracts/source-match.ts";
import { NativeModInvocations, type NativeModInvocationResult } from "./native-mod-invocations.ts";
import { planGuestCall } from "../../guest/abi/classify.ts";
import type { NativeModProtectionRegion } from "../../contracts/native-mod-region.ts";
import { NativeModRegionExecution, validateNativeModRegion, type NativeModRegionAuthority } from "./native-mod-region.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../guest/abi/runner.ts";
import { NativeModItems, validateNativeModItems, readNativeItemCheckpoint, type NativeItemCheckpoint } from "./native-mod-items.ts";
import { NativeModActors, type SavedNativeActors } from "./native-mod-actors.ts";
import { NativeModClientsBinding } from "./native-mod-clients.ts";
import type { ModClientPresentationSource } from "../../world/session/mod-client-presentation.ts";
import { NativeModClientStages, nativeModUserCommand } from "./native-mod-client-stages.ts";
import { NativeModProtection, type NativeProtectionInventoryCommit } from "./native-mod-protection.ts";
import { NativeModPickups, validateNativeModPickups } from "./native-mod-pickups.ts";
import { readNativeDeferredDamage } from "./native-mod-deferred.ts";
import { asciiFold, type CommandInvocation } from "../../core/commands/index.ts";
import type { FrameContext } from "../../contracts/time.ts";
import { isDeepStrictEqual } from "node:util";
import type { GuestAddress, GuestCallResult, GuestCallValue, GuestValueLayout, ModuleIdentity, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ModCallbackInput, ModClientInputOutput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { NativeModActorField, NativeModActorRecord, NativeModAddress, NativeModDeclaration, NativeModScalar, NativeModSourceCall, NativeModValue, NativeModInputOutput, NativeModPickup } from "../../contracts/native-mod-callbacks.ts";
import type { OriginalPickupExecution, OriginalPickupOffer } from "../../contracts/original-pickups.ts";
import type { ProviderCheckpoint, SavedActorId } from "../../contracts/session.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import { modClientInputValues } from "../../world/session/mod-client-input-values.ts";
import type { SimulationPresentation } from "../../app/bootstrap/simulation/types.ts";
import { readNativeModPresentation, type NativeModPresentationCheckpoint } from "../../app/bootstrap/simulation/native-mod-presentation.ts";
import type { NativeModHost, NativeModProjection, NativeModSourceSave } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { readModule } from "../../persistence/execution.ts";
import { decodeQ2ClassicOriginalSave } from "../../persistence/q2-classic-guest.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveReader } from "../../persistence/value.ts";
import { decodeValue, encodeValue, storageBytes } from "../../guest/abi/values.ts";
import { X86AbiAdapter } from "../../guest/abi/adapter.ts";
import { allocateClassicString, classicStringAllocationBytes, readClassicString, writeClassicString, readClassicVector, writeClassicVector } from "./classic/records.ts";

type Inputs = ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
type SharedField = Extract<NativeModActorField, { readonly binding: "team" | "score" | "health" | "inventory" | "inventory-capacity" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" }>;
interface Observation { readonly actor: ActorId; readonly address: GuestAddress; readonly field: SharedField; readonly bytes: Uint8Array; }
interface Invocation { observations: readonly Observation[]; readonly pending: (() => void)[]; cursor: number; }
interface InventoryChanges { count?: number; capacity?: number; }
interface InputScope { readonly application: ModClientApplication; readonly values: Inputs; }
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function shared(field: NativeModActorField): field is SharedField { return field.binding === "team" || field.binding === "score" || field.binding === "health" || field.binding === "inventory" || field.binding === "inventory-capacity" || field.binding === "origin" || field.binding === "velocity" || field.binding === "angles" || field.binding === "bounds-min" || field.binding === "bounds-max"; }
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
  return { kind: "scalar", storage: value.kind === "time" ? value.encoding : value.kind === "client" ? "int32" : value.kind === "actor" || value.kind === "address" || value.kind === "vector" || value.kind === "string" || value.kind === "userinfo" || value.kind === "user-command" ? "pointer" : value.kind };
}
export function validateNativeModDeclaration(declaration: NativeModDeclaration): void {
  validateNativeModItems(declaration);
  validateNativeModPickups(declaration);
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
      if (field.binding === "team" || field.binding === "score") validateSourceMatchField(field);
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
  const outputField = (field: { readonly record: string; readonly offset: number }, length: number): void => {
    const record = records.get(field.record);
    if (clients === undefined || record === undefined || !clients.records.includes(record.id) && record.id !== declaration.entityRecord
      || !Number.isInteger(field.offset) || field.offset < 0
      || !record.fields.some(value => value.binding === "private" && value.offset <= field.offset && field.offset + length <= value.offset + value.byteLength)
      || (clients.inputFields ?? []).some(value => value.record === field.record && value.offset < field.offset + length && field.offset < value.offset + (value.value.kind === "vector" ? 12 : scalarSize(value.value.kind === "time" ? value.value.encoding : value.value.kind)))
      || (clients.pose === undefined ? [] : [clients.pose.viewHeight, clients.pose.crouched.field]).some(value => value.record === field.record && value.offset < field.offset + length && field.offset < value.offset + scalarSize(value.encoding)))
      throw new Error("Native client output requires exclusive private client storage");
  };
  validateModClientOutputs(clients?.outputs ?? [], { scalar: field => outputField(field, scalarSize(field.encoding)), vector: field => outputField(field, 12) });
  if (declaration.clientPresentation !== undefined && (clients === undefined || owned === undefined || (clients.endFrame?.length ?? 0) === 0))
    throw new Error("Native client presentation requires declared original end-frame calls");
  const protections = declaration.protection ?? [];
  const channels = new Set<string>();
  for (const protection of protections) {
    if (channels.has(protection.channel)) throw new Error("Duplicate native protection channel");
    channels.add(protection.channel);
    if (clients === undefined || declaration.entityRecord === null || !protection.id || protection.storage.length === 0
      || protection.absorb.abi !== "source-call" && protection.absorb.abi !== "source-region" && protection.absorb.flags !== expectedAbi) throw new Error("Native protection requires declared clients and its matching source ABI");
  }
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
  const checkValues = (values: readonly NativeModValue[], available: ReadonlySet<ModCallbackInput>): void => {
    for (const value of values) {
      if (value.kind === "user-command") { if (!available.has("view-angles")) throw new Error("Native user command requires an active input application"); continue; }
      if (value.kind === "address") continue;
      if (value.kind === "client" || value.kind === "userinfo") { if (clients === undefined || !available.has(value.input)) throw new Error("Unavailable native client input"); continue; }
      if (value.kind === "actor") { if (!available.has(value.input) || !records.has(value.record)) throw new Error("Unavailable native actor input"); continue; }
      if (value.kind === "time") { if (!available.has(value.input)) throw new Error("Unavailable native time input"); continue; }
      const input = value.value;
      if (input.kind === "input" && !available.has(input.name)) throw new Error(`Unavailable native callback input ${input.name}`);
      const kind = input.kind !== "input" ? input.kind : ["point", "direction", "normal", "view-angles"].includes(input.name) ? "vector" : input.name === "item" ? "string" : ["self", "other", "activator", "attacker", "inflictor"].includes(input.name) ? "actor" : "float";
      if (kind !== (value.kind === "vector" || value.kind === "string" ? value.kind : "float")) throw new Error("Native callback input representation differs from its declaration");
    }
  };
  const check = (call: NativeModSourceCall, available: ReadonlySet<ModCallbackInput>): void => {
    checkValues([...call.arguments, ...call.globals.map(entry => entry.value)], available);
    const regions = call.skips ?? [];
    for (const [index, region] of regions.entries()) {
      if (!Number.isSafeInteger(region.entry) || !Number.isSafeInteger(region.join) || region.entry < 0 || region.join <= region.entry
        || regions.slice(0, index).some(other => region.entry === other.entry)) throw new Error("Invalid or repeated native source exclusion");
    }
  };
  for (const objective of declaration.objectives ?? []) {
    for (const address of [objective.state.storage.address, objective.carrier, objective.target]) if (address !== null)
      checkValues([{ kind: "address", value: address }], new Set());
    if (objective.role === "owned" && objective.change !== null) check(objective.change, new Set(["self", "other", "activator", "amount", "time"]));
  }
  for (const pickup of declaration.pickups ?? []) {
    const available = new Set<ModCallbackInput>(["self", "other", "item", "time", "pickup-count", "pickup-has-count", "pickup-dropped"]);
    check(pickup.operation.grant, available);
    if (pickup.operation.kind === "gate-then-grant") check(pickup.operation.gate, available);
    const ranges: { readonly record: string; readonly start: number; readonly end: number }[] = [];
    for (const field of pickup.context) {
      checkValues([field.value], available);
      const record = records.get(field.record), length = field.value.kind === "vector" ? 12
        : field.value.kind === "address" ? declaration.target.abi.pointerBytes : scalarSize(field.value.kind === "time" ? field.value.encoding : field.value.kind);
      if (record === undefined || clients?.records.includes(record.id) || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset + length > record.stride
        || !record.fields.some(value => (value.binding === "private" || value.binding === "constant" || value.binding === "address" || value.binding === "constant-vector")
          && value.offset <= field.offset && field.offset + length <= value.offset + size(value, declaration.target.abi.pointerBytes))
        || ranges.some(range => range.record === field.record && field.offset < range.end && range.start < field.offset + length))
        throw new Error("Native pickup context requires separate declared source storage");
      ranges.push({ record: field.record, start: field.offset, end: field.offset + length });
      if (field.record === declaration.entityRecord && owned !== undefined) {
        const pointers = [owned.fields.ground, owned.fields.think, ...owned.fields.use === null ? [] : [owned.fields.use],
          ...Object.values(owned.callbacks ?? {}).filter((offset): offset is number => typeof offset === "number")];
        if (pointers.some(offset => field.offset < offset + declaration.target.abi.pointerBytes && offset < field.offset + length)
          || field.offset < owned.fields.nextthink.offset + scalarSize(owned.fields.nextthink.encoding) && owned.fields.nextthink.offset < field.offset + length)
          throw new Error("Native pickup context overlaps source actor lifetime");
      }
    }
  }
  for (const protection of protections) {
    const available = new Set<ModCallbackInput>(["self", "attacker", "inflictor", "time", "amount", "damage-flags", "regular-protection-scale", "knockback", "direction", "point", "normal"]);
    if (protection.absorb.abi === "source-call" || protection.absorb.abi === "source-region") {
      if (protection.absorb.abi === "source-region") {
        const region = protection.absorb, abi = declaration.target.abi;
        validateNativeModRegion(region, abi.pointerBytes); checkValues(region.inputs.map(input => input.value), available);
        const plan = planGuestCall({ abi, parameters: region.call.arguments.map(layout), result: region.call.returns === "void" ? "void" : { kind: "scalar", storage: region.call.returns }, variadic: false });
        if (region.frame.argumentBytes !== plan.stackBytes - abi.pointerBytes) throw new Error("Native donor argument area differs from its original call ABI");
        for (const input of region.inputs) { const value = layout(input.value); if (value.kind !== "scalar" || value.storage !== input.target.storage) throw new Error("Native donor input differs from its machine storage"); }
      }
      if (protection.absorb.abi === "source-call" && protection.absorb.call.returns === "void") throw new Error("Native protection requires a source return value");
      check(protection.absorb.call, available);
    } else checkValues((protection.absorb.globals ?? []).map(global => global.value), available);
  }
  for (const item of declaration.items?.definitions ?? []) for (const call of [item.actions?.use, item.actions?.drop].filter(call => call !== undefined)) check(call, new Set(["self", "time"]));
  for (const value of declaration.items?.weapons?.selection.values ?? []) check(value.request, new Set(["self", "time"]));
  for (const call of declaration.initialize) check(call, new Set(["time"]));
  for (const call of [...declaration.project, ...declaration.release]) check(call, new Set(["self", "time"]));
  if (clients !== undefined) for (const call of [...clients.admit, ...clients.userinfo, ...clients.disconnect, ...clients.command, ...clients.frame ?? [], ...clients.endFrame ?? []]) check(call, new Set(["self", "time"]));
  if (clients !== undefined) {
    if (((clients.frame?.length ?? 0) !== 0 || (clients.endFrame?.length ?? 0) !== 0) && owned === undefined) throw new Error("Native client frames require the original source actor clock");
    const available = new Set<ModCallbackInput>(["self", "time", "elapsed", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"]);
    for (const binding of clients.input ?? []) for (const call of binding.calls) check(call, available);
    const ranges = new Map<string, { readonly start: number; readonly end: number }[]>();
    if ((clients.inputFields?.length ?? 0) !== 0 && (clients.input?.length ?? 0) === 0) throw new Error("Native input fields require declared input callbacks");
    for (const field of clients.inputFields ?? []) {
      const record = records.get(field.record), length = field.value.kind === "vector" ? 12 : scalarSize(field.value.kind === "time" ? field.value.encoding : field.value.kind);
      if (record === undefined || field.record !== declaration.entityRecord && !clients.records.includes(field.record)
        || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset + length > record.stride
        || !record.fields.some(candidate => candidate.binding === "private" && field.offset >= candidate.offset && field.offset + length <= candidate.offset + candidate.byteLength))
        throw new Error("Native input field requires declared private client storage");
      const previous = ranges.get(field.record) ?? [];
      if (previous.some(range => field.offset < range.end && range.start < field.offset + length)) throw new Error("Overlapping native input fields");
      previous.push({ start: field.offset, end: field.offset + length }); ranges.set(field.record, previous);
      checkValues([field.value], available);
    }
    for (const field of clients.pose === undefined ? [] : [clients.pose.viewHeight, clients.pose.crouched.field]) {
      const record = records.get(field.record);
      if (record === undefined || field.record !== declaration.entityRecord && !clients.records.includes(field.record)
        || !Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset + scalarSize(field.encoding) > record.stride
        || record.fields.some(value => shared(value) && field.offset < value.offset + size(value, declaration.target.abi.pointerBytes) && value.offset < field.offset + scalarSize(field.encoding)))
        throw new Error("Native client pose requires separate private source fields");
    }
    if (clients.pose !== undefined && (!Number.isSafeInteger(clients.pose.crouched.mask) || clients.pose.crouched.mask < 1 || clients.pose.crouched.mask > 0x7fffffff)) throw new Error("Invalid native source crouch mask");
    for (const binding of clients.input ?? []) if (binding.phase === "before") for (const output of binding.outputs ?? []) {
      if (output.kind === "handler") {
        checkValues(output.arguments, available);
        if (output.arguments.filter(value => value.kind === "actor" && value.input === "self").length !== 1)
          throw new Error("Native output handler requires its exact client actor argument");
      }
      if (output.kind === "field" && !(clients.inputFields ?? []).some(field => field.record === output.record && field.offset === output.offset && field.value.kind !== "time" && field.value.value.kind === "input"
        && ["view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"].includes(field.value.value.name))) throw new Error("Native input output requires its declared input field");
    }
  }
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
interface SavedNativeMod { readonly items: NativeItemCheckpoint | null; readonly owned: SavedNativeActors | null; readonly map: string; readonly source: NativeModSourceSave; readonly presentation: NativeModPresentationCheckpoint; readonly actors: readonly { readonly actor: SavedActorId; readonly slot: number; readonly appearance: boolean }[];
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
  if ((reader.field("items").value != null) !== (declaration.items !== undefined)) throw new Error("Native item checkpoint differs from source declaration");
  const items = declaration.items === undefined ? null : readNativeItemCheckpoint(reader.field("items"), declaration.items);
  if (items?.requests.some(request => !clients.some(client => client.admitted && client.actor.slot === request.actor.slot && client.actor.generation === request.actor.generation))) throw new Error("Saved native item request has no admitted client");
  return { items, map, source, actors, owned, clients, presentation: readNativeModPresentation(reader.field("presentation")) };
}
export function validateNativeModCheckpoint(record: ProviderCheckpoint, module: ModuleIdentity, declaration: NativeModDeclaration): void { readCheckpoint(record, module, declaration); }

/** Typed component callbacks run in the original native module and borrow canonical actors. */
export class NativeModProvider implements NativeModProjection {
  private host_: NativeModHost | null = null;
  private owned: NativeModActors | null = null;
  private clients: NativeModClientsBinding | null = null;
  private stages: NativeModClientStages | null = null;
  private items: NativeModItems | null = null;
  private readonly protection: NativeModProtection | null;
  private readonly pickups: NativeModPickups;
  private readonly records = new Map<string, NativeModActorRecord>();
  private readonly nonclientRecords: readonly NativeModActorRecord[];
  private readonly projections = new Map<ActorId, number>();
  private readonly frames: Invocation[] = [];
  private readonly pickupScopes: { readonly actor: ActorId; readonly execution: OriginalPickupExecution; readonly frame: Invocation }[] = [];
  private projectionWrites = 0;
  private readonly inputScopes: InputScope[] = [];
  private inputContext: InputScope | null = null;
  private readonly appearanceActors = new Set<ActorId>();
  private readonly pendingReleases = new Set<ActorId>();
  private readonly unsubscribe: () => undefined;
  private readonly clientOutputs: SourceModClientOutputs<NativeModArmorField, { readonly record: string; readonly offset: number }>;
  private closed = false;
  private closing = false;
  private sourceCalls = 0;
  private readonly regionAuthorities: NativeModRegionAuthority[] = [];
  private invocations: NativeModInvocations | null = null;
  private pendingHostClose = false;
  private ready = false;
  private readonly objectives: ModSourceObjectives<{ readonly address: NativeModAddress; readonly encoding: NativeModScalar }, NativeModAddress, NativeModSourceCall>;
  private releaseMatch: (() => void) | null = null;
  private lifecycle = false;
  private restoring = false;
  private readonly restoreLinks = new Map<number, { readonly address: GuestAddress; readonly invoke: () => GuestCallResult }>();
  constructor(readonly declaration: NativeModDeclaration, readonly services: ModHostServices, readonly instance: ProviderId,
    readonly map: string, private readonly assertCurrent: () => void) {
    this.objectives = new ModSourceObjectives(instance, declaration.objectives ?? [], services.match, {
      location: declaration => [declaration.state.storage.address, declaration.carrier, declaration.target].map(address => address === null ? "none" : this.objectiveAddress(address).byteOffset).join("|"),
      current: () => !this.closed && !this.closing && !this.restoring,
      readScalar: storage => this.scalarRead(this.objectiveAddress(storage.address), storage.encoding),
      writeScalar: (storage, value) => this.scalarWrite(this.objectiveAddress(storage.address), value, storage.encoding),
      readActor: storage => { const pointer = this.host.memory.readPointer(this.objectiveAddress(storage)); if (pointer === null) return null;
        const table = this.host.entities(), delta = pointer.byteOffset - table.base.byteOffset;
        if (delta < 0n || delta % BigInt(table.stride) !== 0n || delta / BigInt(table.stride) >= BigInt(table.count)) throw new Error("Native objective pointer is outside the source actor table");
        const actor = this.actorAt(Number(delta / BigInt(table.stride))); if (actor === null) throw new Error("Native objective references an absent actor"); return actor; },
      writeActor: (storage, actor) => { const pointer = actor === null ? null : this.address(actor); this.host.memory.writePointer(this.objectiveAddress(storage), pointer); },
      invoke: (call, inputs) => { this.execute(call, inputs, true); }, seconds: () => { const time = services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; },
    });
    validateNativeModDeclaration(declaration); for (const record of declaration.actorRecords) this.records.set(record.id, record);
    this.clientOutputs = new SourceModClientOutputs(instance, declaration.clients?.outputs ?? [], services.clients?.claimOutputs, {
      scalar: (actor, field) => this.scalarRead(this.clientOutputAddress(actor, field), field.encoding),
      vector: (actor, field) => readClassicVector(this.host.memory, this.clientOutputAddress(actor, field)),
    });
    this.nonclientRecords = declaration.actorRecords.filter(record => !declaration.clients?.records.includes(record.id));
    this.pickups = new NativeModPickups(declaration.pickups ?? [], services, instance, {
      current: () => this.current(), eligible: actor => this.clients?.admitted(actor) === true,
      context: (definition, offer, inputs, execute) => this.pickupContext(definition, offer, inputs, execute),
      observe: (actor, execution, execute) => {
        const observe = () => this.observePickup(actor, execution, execute);
        return this.protection === null ? this.transfer(observe) : this.protection.observe(actor, execution, observe);
      },
      invoke: (call, inputs) => this.execute(call, inputs, false),
    });
    this.protection = (declaration.protection?.length ?? 0) === 0 ? null : new NativeModProtection(declaration.protection ?? [], declaration, services, instance, {
      current: () => this.current(), slot: actor => this.slotOf(actor), eligible: actor => this.clients?.admitted(actor) === true,
      pickups: (actor, channel) => this.pickups.protection(actor, channel),
      scalar: (base, field, value) => { const address = this.host.memory.offset(base, BigInt(field.offset)); if (value !== undefined) this.scalarWrite(address, value, field.encoding); return this.scalarRead(address, field.encoding); },
      transfer: invoke => this.transfer(invoke), flush: fuel => this.flush(fuel), invoke: (call, inputs, region, authority) => this.execute(call, inputs, false, region, authority),
    });
    this.unsubscribe = services.actors.onRelease(actor => { this.clientOutputs.release(actor.id); this.items?.release(actor.id); this.pickups.release(actor.id); this.protection?.release(actor.id); if (this.projections.has(actor.id)) { this.pendingReleases.add(actor.id); this.host_?.presentation.release(actor.id); } return undefined; });
  }
  reserveProtection(): void { this.current(); this.protection?.reserve(); }
  private matchPlayer(actor: ActorId): SourceMatchPlayer | null {
    const owned = this.services.actors.resolveOwned(actor), slot = this.owned?.slotOf(actor), record = this.declaration.entityRecord === null ? undefined : this.records.get(this.declaration.entityRecord);
    if (this.closed || this.closing || owned?.owner !== this.instance || slot == null || record === undefined) return null;
    const team = record.fields.find(field => field.binding === "team"), score = record.fields.find(field => field.binding === "score");
    const current = (offset: number): GuestAddress => { this.current(); if (this.services.actors.resolveOwned(actor) !== owned || this.owned?.slotOf(actor) !== slot) throw new Error("Native match actor was retired"); return this.host.memory.offset(this.host.entity(slot).address, BigInt(offset)); };
    return { owner: this.instance, team: () => team?.binding === "team" ? sourceTeam(team.values, this.scalarRead(current(team.offset), team.encoding)) : null,
      score: () => { if (score?.binding !== "score") throw new Error("Native match actor has no score field"); return this.scalarRead(current(score.offset), score.encoding); },
      setTeam: value => { if (team?.binding !== "team") throw new Error("Native match actor has no team field"); this.scalarWrite(current(team.offset), originalTeam(team.values, value), team.encoding); },
      setScore: value => { if (score?.binding !== "score") throw new Error("Native match actor has no score field"); this.scalarWrite(current(score.offset), value, score.encoding); } };
  }
  activateProtection(): void { this.current(); this.objectives.activate();
    if (this.releaseMatch === null && this.declaration.actorRecords.some(record => record.fields.some(field => field.binding === "team" || field.binding === "score"))) {
      const match = this.services.match; if (match === undefined) throw new Error("Declared match fields require destination match services");
      this.releaseMatch = match.bindSource(this.instance, actor => this.matchPlayer(actor));
    } this.protection?.activate(); this.pickups.activate(); }
  attach(host: NativeModHost): void { if (this.host_ !== null) throw new Error("Native mod already attached"); this.host_ = host;
    this.stages = new NativeModClientStages(host);
    if (this.declaration.protection?.some(protection => protection.absorb.abi === "source-region")) this.invocations = new NativeModInvocations(host.entries.cpu.state);
    this.protection?.attach(host);
    if (this.declaration.items !== undefined) this.items = new NativeModItems(this.declaration.items, this.declaration.target.abi, host, this.services, this.instance, host.content, {
      pointer: (actor, record) => { const address = this.pointer(actor, record); if (address === null) throw new Error("Native source item lost its record"); return address; },
      resolve: value => this.resolve(value), live: actor => !this.closed && !this.closing && !this.restoring && this.clients?.admitted(actor) === true && this.services.actors.isLive(actor),
      read: (address, encoding) => this.scalarRead(address, encoding), write: (address, encoding, value) => this.scalarWrite(address, value, encoding),
      invoke: (actor, call) => { this.execute(call, this.inputs(actor), true); },
      model: actor => { const slot = this.clients?.slot(actor); if (slot === null || slot === undefined) throw new Error("Native viewmodel lost its client"); return host.weaponModel(slot + 1); },
      pickup: () => this.pickupScopes.at(-1)?.execution,
    });
    if (this.declaration.clients !== undefined) {
      const services = this.services.clients;
      if (services === undefined) throw new Error("Native component clients require destination client services");
      this.clients = new NativeModClientsBinding({ services, declaration: this.declaration.clients, content: host.content,
        project: actor => { this.protection?.reserveActor(actor); this.address(actor); }, admitted: actor => { this.clientOutputs.publish(actor); this.items?.admit(actor); this.protection?.bindActor(actor); this.pickups.bindActor(actor); }, release: actor => {
          this.clientOutputs.release(actor);
          this.items?.release(actor);
          this.pickups.release(actor);
          this.protection?.release(actor);
          if (this.closing) { host.presentation.release(actor); this.projections.delete(actor); this.appearanceActors.delete(actor); this.pendingReleases.delete(actor); }
          else { this.pendingReleases.add(actor); this.releasePending(); }
        },
        invoke: (call, actor) => this.execute(call, this.inputs(actor), true), openInput: application => this.openInput(application),
        invokeInput: (call, application) => {
          const scope = this.inputScopes.find(current => current.application === application);
          if (scope === undefined) throw new Error("Native input callback has no active application");
          const previous = this.inputContext; this.inputContext = scope;
          try { this.execute(call, scope.values, true); } finally { this.inputContext = previous; }
        },
        inputOutput: (outputs, application, run) => this.inputOutput(outputs, application, run),
        withCommand: (command, invoke) => host.withCommand(command, invoke) });
    }
    if (this.declaration.sourceActors !== undefined) this.owned = new NativeModActors(this.declaration.sourceActors, this.declaration, host, this.services, this.instance, {
      resolve: address => this.resolve(address), scalar: (address, value, encoding) => this.scalarWrite(address, value, encoding),
      combat: { eligible: actor => !this.clients?.rejects(actor), transfer: invoke => this.transfer(invoke), sourceExecution: (actor, invoke) => this.sourceExecution(actor, invoke), scalar: (base, field, value) => { const address = host.memory.offset(base, BigInt(field.offset)); if (value !== undefined) this.scalarWrite(address, value, field.encoding); return this.scalarRead(address, field.encoding); },
        synchronize: () => { this.flush(); this.refresh(); const frame = this.frames.at(-1); if (frame !== undefined) frame.observations = this.observe(); } },
      invoke: (entry, values, returns, actor) => this.executeEntry(entry, values, returns, actor), address: actor => this.address(actor), actorAt: slot => this.actorAt(slot),
      clientFrame: slot => this.clients?.frame(slot) ?? false, synchronizeFrame: (seconds, frame) => host.synchronizeFrame(seconds, frame),
      beginFrame: () => { for (const entry of this.entries()) this.host.clearEntityEvent(entry.slot); this.host.presentation.beginFrame(); }, endFrame: () => { this.clients?.endFrame(); if (!this.closed) this.publish(); } });
  }
  clientPresentation() {
    const provider = this;
    return this.clientSource ??= { get generation() { return provider.host.presentation.generation; },
      frame(actor: ActorId) { provider.current(); return provider.clients?.admitted(actor) === true ? provider.host.presentation.clientFrame(actor) : null; },
      assertCurrent: () => provider.current() };
  }
  private clientSource: ModClientPresentationSource | null = null;
  private get host(): NativeModHost { if (this.host_ === null) throw new Error("Native mod has no source host"); return this.host_; }
  private current(): void { if (!this.closing) this.assertCurrent(); if (this.closed) throw new Error("Native mod is closed"); }
  private inputs(actor?: ActorId): Map<ModCallbackInput, ModRuntimeValue> {
    const scope = this.inputContext, values = new Map<ModCallbackInput, ModRuntimeValue>(scope?.values);
    if (scope === null) { const time = this.services.time(); values.set("time", { kind: "float", value: this.owned?.sourceTime ?? (time.kind === "seconds" ? time.value : time.value / 1000) }); }
    if (actor !== undefined) values.set("self", { kind: "actor", value: actor }); return values;
  }
  private openInput(application: ModClientApplication): () => void {
    this.current();
    const actor = application.identity.actor, slot = this.projections.get(actor), memory = this.host.memory;
    if (slot === undefined) throw new Error("Native input client has no source row");
    const values = new Map(modClientInputValues(application));
    if (this.items?.acceptsAttack(actor) === false) values.set("attack", { kind: "float", value: 0 });
    const scope: InputScope = { application, values };
    let outer: InputScope | undefined;
    for (const current of this.inputScopes) if (current.application.identity.actor.equals(actor)) outer = current;
    const stores = (this.declaration.clients?.inputFields ?? []).map(field => {
      const record = this.records.get(field.record); if (record === undefined) throw new Error("Native input record is unavailable");
      const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset)), value = field.value;
      let bytes: Uint8Array;
      if (value.kind === "vector") {
        const input = value.value.kind === "input" ? values.get(value.value.name) : value.value;
        if (input?.kind !== "vector") throw new Error("Native input vector is unavailable");
        bytes = new Uint8Array(12); const view = new DataView(bytes.buffer);
        [input.value.x, input.value.y, input.value.z].forEach((component, index) => { scalar(component, "float32"); view.setFloat32(index * 4, component, true); });
      } else {
        const lowered = this.lower(value, values, [], []);
        bytes = encodeValue({ kind: "scalar", storage: value.kind === "time" ? value.encoding : value.kind }, lowered, memory);
      }
      memory.check(address, bytes.length, "write");
      return { address, bytes, previous: memory.copy(address, bytes.length) };
    });
    this.inputScopes.push(scope);
    const live = () => !this.closed && this.services.actors.isLive(actor) && this.services.clients?.actor(application.identity.client)?.equals(actor) === true
      && this.services.clients.forActor(actor)?.equals(application.identity.client) === true;
    const close = (failed: boolean): void => {
      const index = this.inputScopes.indexOf(scope); if (index < 0) return;
      this.inputScopes.splice(index, 1);
      if (failed || outer !== undefined && this.inputScopes.includes(outer)) {
        const errors: unknown[] = [];
        for (const store of stores) {
          if (!live()) break;
          try { memory.write(store.address, store.previous); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "Native input field restoration failed");
      }
    };
    try { for (const store of stores) { this.current(); if (!live()) break; memory.write(store.address, store.bytes); } }
    catch (error) {
      try { close(true); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native input staging and rollback failed"); }
      throw error;
    }
    return () => close(false);
  }
  private inputOutput(outputs: readonly NativeModInputOutput[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[] {
    const result: ModClientInputOutput[] = [], remove: (() => void)[] = [], read: (() => void)[] = [], memory = this.host.memory;
    const actor = application.identity.actor, slot = this.projections.get(actor);
    if (slot === undefined) throw new Error("Native output client has no source row");
    const live = () => !this.closed && this.services.actors.isLive(actor) && this.clients?.admitted(actor) === true;
    try {
      for (const output of outputs) {
        if (output.kind === "handler") {
          const address = output.entry.kind === "export" ? this.host.entry(output.entry.name) : memory.offset(this.host.imageBase, BigInt(output.entry.rva));
          let called = false;
          const index = output.arguments.findIndex(value => value.kind === "actor" && value.input === "self"), value = output.arguments[index];
          if (value?.kind !== "actor") throw new Error("Native output handler lacks its client actor argument");
          const expected = this.pointer(actor, value.record), abi = new X86AbiAdapter(this.declaration.target.abi);
          remove.push(this.host.entries.callbacks.observeEntry(address, () => {
            if (this.inputContext?.application !== application || !live()) return;
            const actual = abi.arguments(this.host.entries.cpu, { abi: this.declaration.target.abi,
              parameters: output.arguments.map(layout), result: "void", variadic: false })[index];
            if (actual?.kind === "pointer" && actual.value !== null && actual.value.byteOffset === expected?.byteOffset) called = true;
          }));
          read.push(() => { if (called) result.push({ kind: "consume", inputs: output.inputs }); });
          continue;
        }
        const field = this.declaration.clients?.inputFields?.find(field => field.record === output.record && field.offset === output.offset), record = this.records.get(output.record);
        if (field === undefined || record === undefined || field.value.kind === "time" || field.value.value.kind !== "input") throw new Error("Native output lacks its declared input field");
        const name = field.value.value.name;
        if (name !== "view-angles" && name !== "attack" && name !== "jump" && name !== "impulse" && name !== "forward-move" && name !== "side-move" && name !== "up-move") throw new Error("Native output field is not a client input");
        const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset)), kind = field.value.kind;
        const bytes = kind === "vector" ? 12 : scalarSize(kind), before = memory.copy(address, bytes);
        read.push(() => {
          if (isDeepStrictEqual(before, memory.copy(address, bytes))) return;
          if (name === "view-angles" && kind === "vector") result.push({ kind: "set", input: name, value: readClassicVector(memory, address) });
          else if (name !== "view-angles" && kind !== "vector") result.push({ kind: "set", input: name, value: this.scalarRead(address, kind) });
          else throw new Error("Native output representation differs from its input");
        });
      }
      run(); if (live()) for (const output of read) output();
      return result;
    } finally { for (const close of remove.reverse()) close(); }
  }
  private objectiveAddress(value: NativeModAddress): GuestAddress {
    return this.resolve(value, () => { this.current(); if (this.closing || this.restoring) throw new Error("Native objective source is unavailable"); });
  }
  private resolve(value: NativeModAddress, current?: () => void): GuestAddress {
    current?.();
    const memory = this.host.memory; let address = memory.offset(this.host.imageBase, BigInt(value.rva));
    for (const offset of value.indirections) { current?.(); const pointer = memory.readPointer(address); if (pointer === null) throw new Error("Native mod layout follows a null source pointer"); address = memory.offset(pointer, BigInt(offset)); }
    current?.(); return address;
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
  private observePickup<Result>(actor: ActorId, execution: OriginalPickupExecution, run: () => Result): Result {
    const frame = this.frames.at(-1); if (frame === undefined) throw new Error("Pickup requires its native source frame");
    const scope = { actor, execution, frame }, removers: (() => void)[] = [];
    this.pickupScopes.push(scope);
    try {
      for (const [projected, slot] of this.projections) for (const record of this.actorRecords(projected))
        removers.push(this.host.memory.observeWrites(this.recordAddress(record, slot), record.stride, () => {
          if (this.pickupScopes.at(-1) !== scope || this.frames.at(-1) !== frame || this.projectionWrites !== 0) return;
          if (!execution.current()) throw new Error("Original pickup resource binding is no longer current");
          this.flush();
        }));
      return run();
    } finally { for (const remove of removers) remove(); this.pickupScopes.pop(); }
  }
  private pickupScope() { const scope = this.pickupScopes.at(-1); return scope?.frame === this.frames.at(-1) ? scope : undefined; }
  private validatePickupWrites(changes: readonly Observation[]): void {
    const scope = this.pickupScope(); if (scope === undefined || changes.length === 0 || this.projectionWrites !== 0) return;
    if (!scope.execution.current()) throw new Error("Original pickup resource binding is no longer current");
    const owner = this.services.actors.resolveOwned(scope.actor);
    if (owner === null) throw new Error("Original pickup recipient was retired");
    for (const { actor, field } of changes) {
      if (!actor.equals(scope.actor) || field.binding !== "inventory" && field.binding !== "inventory-capacity") throw new Error("Original pickup changed an undeclared resource");
      const permitted = scope.execution.writes.some(write => write.kind === "inventory" ? write.item === field.item
        && (write.fields === "count-and-capacity" || write.fields === (field.binding === "inventory" ? "count" : "capacity"))
        : field.binding === "inventory" && this.services.combat.protectionInventoryItems(owner, write.channel).includes(field.item));
      if (!permitted) throw new Error(`Original pickup changed undeclared ${field.binding} ${field.item}`);
    }
  }
  private clientOutputAddress(actor: ActorId, field: { readonly record: string; readonly offset: number }): GuestAddress {
    const record = this.records.get(field.record), slot = this.projections.get(actor);
    if (record === undefined || slot === undefined) throw new Error("Native client output lost its source projection");
    return this.host.memory.offset(this.recordAddress(record, slot), BigInt(field.offset));
  }
  private publishClientOutputs(): void {
    if (!this.clientOutputs.enabled) return;
    for (const actor of this.projections.keys()) if (this.services.actors.isLive(actor) && this.clientOutputs.has(actor) && this.clients?.admitted(actor) === true) this.clientOutputs.publish(actor);
  }
  private refresh(): void {
    this.objectives.refresh();
    this.projectionWrites++;
    try {
    const memory = this.host.memory;
    for (const [actor, slot] of this.projections) {
      this.validateInventoryCapacity(actor);
      const inventory = this.services.inventory.entries(actor);
      for (const record of this.actorRecords(actor)) for (const field of record.fields) if (shared(field)) {
        const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset));
        if (field.binding === "team" || field.binding === "score") this.scalarWrite(address, readSourceMatchField(this.services.match, actor, field), field.encoding);
        else if (field.binding === "health") this.scalarWrite(address, this.services.combat.read(actor)?.health ?? 0, field.encoding);
        else if (field.binding === "inventory" || field.binding === "inventory-capacity") {
          const entry = inventory.find(entry => entry.item === field.item);
          this.scalarWrite(address, entry === undefined ? 0 : field.binding === "inventory" ? entry.count : entry.capacity, field.encoding);
        }
        else { const state = this.services.bodies.read(actor); writeClassicVector(memory, address, state === null ? zero : field.binding === "bounds-min" ? state.bounds.min : field.binding === "bounds-max" ? state.bounds.max : state[field.binding]); }
      }
      const pose = this.declaration.clients?.pose;
      if (pose !== undefined && this.clients?.admitted(actor)) {
        const client = this.services.clients?.forActor(actor), view = client === undefined || client === null ? undefined : this.services.clients?.playerView?.(client);
        if (view === undefined) throw new Error("Native client pose requires the live destination movement view");
        const at = (field: typeof pose.viewHeight): GuestAddress => { const record = this.records.get(field.record); if (record === undefined) throw new Error("Native pose record is unavailable"); return memory.offset(this.recordAddress(record, slot), BigInt(field.offset)); };
        const height = pose.viewHeight, crouch = pose.crouched, address = at(crouch.field), flags = this.scalarRead(address, crouch.field.encoding);
        this.scalarWrite(at(height), height.encoding === "float32" || height.encoding === "float64" ? view.viewOffset.z : Math.trunc(view.viewOffset.z), height.encoding);
        this.scalarWrite(address, view.crouched ? flags | crouch.mask : flags & ~crouch.mask, crouch.field.encoding);
        const sourceSlot = this.slotOf(actor);
        if (sourceSlot === null) throw new Error("Native pose lost its source entity");
        this.host.projectPlayerView?.(sourceSlot, view.viewOffset.z);
      }
    }
    if (this.frames.length !== 0) { const observations = this.observe(); for (const frame of this.frames) frame.observations = observations; }
    } finally { this.projectionWrites--; }
  }
  private observe(): readonly Observation[] {
    const values: Observation[] = [], memory = this.host.memory;
    for (const [actor, slot] of this.projections) for (const record of this.actorRecords(actor)) for (const field of record.fields) if (shared(field)) {
      const address = memory.offset(this.recordAddress(record, slot), BigInt(field.offset)); values.push({ actor, address, field, bytes: memory.copy(address, size(field, memory.pointerBytes)) });
    }
    return values;
  }
  private flush(inventoryCommit?: NativeProtectionInventoryCommit): void {
    this.objectives.flush();
    const frame = this.frames.at(-1); if (frame === undefined) return;
    const memory = this.host.memory, changed = frame.observations.filter(entry => !isDeepStrictEqual(entry.bytes, memory.copy(entry.address, entry.bytes.length)));
    this.validatePickupWrites(changed);
    for (const active of this.frames) active.observations = this.observe();
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
      if (field.binding === "team" || field.binding === "score") {
        const value = this.scalarRead(address, field.encoding); queue(actor, () => {
          writeSourceMatchField(this.services.match, actor, field, value);
          if (this.services.actors.isLive(actor) && this.projections.has(actor)) {
            this.projectionWrites++;
            try { this.scalarWrite(address, readSourceMatchField(this.services.match, actor, field), field.encoding); }
            finally { this.projectionWrites--; }
          }
        });
      } else if (field.binding === "health") { const value = this.scalarRead(address, field.encoding); queue(actor, owner => { this.services.combat.setHealth(owner, value); }); }
      else if (field.binding === "inventory" || field.binding === "inventory-capacity") {
        const changes = inventoryChanges.get(actor)?.get(field.item); if (changes === undefined) throw new Error("Native inventory changes lost their source observation");
        if (committedInventory.has(changes)) continue;
        committedInventory.add(changes); queue(actor, owner => {
          const entry = this.services.inventory.entries(actor).find(entry => entry.item === field.item); if (entry === undefined) throw new Error("Native mod wrote an undeclared destination item");
          if (changes.capacity !== undefined && !this.services.inventory.mutableCapacity(actor, field.item)) throw new Error(`Native mod requires mutable inventory capacity for ${field.item}`);
          const scope = this.pickupScope();
          if (scope !== undefined && !scope.execution.current()) throw new Error("Original pickup resource binding is no longer current");
          this.services.inventory.configure(owner, { ...entry, ...changes }, scope !== undefined || inventoryCommit !== undefined ? change => {
            if (inventoryCommit?.actor.equals(actor) === true && inventoryCommit.items.includes(field.item)) inventoryCommit.committed(change);
            this.projectionWrites++;
            try {
              for (const observation of this.observe()) if (observation.actor.equals(actor)
                && (observation.field.binding === "inventory" || observation.field.binding === "inventory-capacity") && observation.field.item === field.item)
                this.scalarWrite(observation.address, observation.field.binding === "inventory" ? change.after.count : change.after.capacity, observation.field.encoding);
            } finally { this.projectionWrites--; }
            for (const invocation of this.frames) invocation.observations = this.observe();
            this.flush(inventoryCommit);
            return undefined;
          } : undefined);
          if (scope !== undefined) {
            if (!scope.execution.current()) throw new Error("Original pickup resource binding is no longer current");
            this.refresh();
          }
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
    if (value.kind === "user-command") {
      const application = this.inputContext?.application;
      if (application === undefined) throw new Error("Native user command requires its active input application");
      const bytes = nativeModUserCommand(application, this.declaration.target.api.kind === "q2-rerelease-game", this.owned?.sourceFrame ?? 0, this.inputContext?.values);
      const address = this.host.memory.allocate({ byteLength: bytes.length, label: "native component command" });
      allocations.push({ address, bytes: bytes.length }); this.host.memory.write(address, bytes);
      return { kind: "pointer", value: address };
    }
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
    if (resolved?.kind !== "float") throw new Error("Missing native scalar input");
    if (value.value.kind === "input" && value.value.name === "pickup-count" && value.kind !== "float32" && value.kind !== "float64" && !Number.isInteger(resolved.value))
      throw new Error("Native pickup count does not fit its declared integer ABI");
    return scalar(resolved.value, value.kind);
  }
  private pickupContext<Result>(definition: NativeModPickup, offer: OriginalPickupOffer, inputs: Inputs, execute: () => Result): Result {
    this.current();
    if (offer.pickup.equals(offer.recipient) || this.services.actors.resolveOwned(offer.pickup)?.owner === this.instance || this.owned?.slotOf(offer.pickup) != null
      || this.services.clients?.forActor(offer.pickup) != null || this.services.engine?.world()?.equals(offer.pickup) === true)
      throw new Error("Native pickup context requires a borrowed foreign pickup actor");
    const memory = this.host.memory, stores: { readonly address: GuestAddress; readonly bytes: Uint8Array }[] = [];
    const allocations: { readonly address: GuestAddress; readonly bytes: number }[] = [], corrections: (() => void)[] = [];
    try {
      for (const field of definition.context) {
        this.current();
        const base = this.pointer(offer.pickup, field.record);
        if (base === null) throw new Error("Native pickup has no original source projection");
        if (field.record === this.declaration.entityRecord) {
          const slot = this.slotOf(offer.pickup);
          if (slot === null || field.offset < this.host.entity(slot).publicLayout.byteLength) throw new Error("Native pickup context overlaps the public entity record");
        }
        const address = memory.offset(base, BigInt(field.offset)), value = this.lower(field.value, inputs, allocations, corrections), storage = layout(field.value);
        const length = field.value.kind === "vector" ? 12 : storage.kind === "scalar" ? storageBytes(storage.storage, memory.pointerBytes) : storage.layout.byteLength;
        stores.push({ address, bytes: memory.copy(address, length) });
        if (field.value.kind === "vector") {
          if (value.kind !== "pointer" || value.value === null) throw new Error("Native pickup vector storage is unavailable");
          memory.write(address, memory.copy(value.value, length));
        } else if (value.kind === "pointer") memory.writePointer(address, value.value);
        else if (value.kind === "aggregate") throw new Error("Native pickup requires a scalar context field");
        else memory.write(address, encodeValue(storage, value, memory));
      }
      return execute();
    } finally {
      if (!this.closed) try { for (const store of stores.reverse()) memory.write(store.address, store.bytes); }
      finally { for (const allocation of allocations.reverse()) memory.unmap(allocation.address, allocation.bytes); }
    }
  }
  private gameEntry(call: NativeModSourceCall): GuestAddress {
    if (call.entry.kind !== "game-export") throw new Error("Expected public native game entry");
    const entry = this.host.gameEntry(call.entry.name);
    const signature = { abi: this.declaration.target.abi, parameters: call.arguments.map(layout),
      result: call.returns === "void" ? "void" : { kind: "scalar", storage: call.returns }, variadic: false };
    if (!isDeepStrictEqual(signature, entry.signature)) throw new Error("Native component callback differs from its public game ABI");
    return entry.address;
  }
  private sourceExecution<Result>(actor: ActorId | null, invoke: () => Result): NativeModInvocationResult<Result> {
    if (this.invocations === null) return { kind: "completed", value: invoke() };
    const client = actor === null ? null : this.services.clients?.forActor(actor);
    return this.invocations.run(() => !this.closed && !this.closing && (actor === null || this.services.actors.isLive(actor)
      && (client == null || this.services.clients?.forActor(actor)?.equals(client) === true && this.services.clients.actor(client)?.equals(actor) === true)), invoke);
  }
  private execute(call: NativeModSourceCall, inputs: Inputs, transfer: boolean, region?: NativeModProtectionRegion, regionAuthority?: NativeModRegionAuthority): number | null {
    this.sourceCalls++;
    try {
      const self = inputs.get("self"), result = this.sourceExecution(self?.kind === "actor" ? self.value : null, () => {
        const invoke = () => this.executeCurrent(call, inputs, transfer, region, regionAuthority);
        if (regionAuthority === undefined) return invoke();
        if (this.invocations === null) throw new Error("Native donor invocation is unavailable");
        return this.invocations.guard(regionAuthority, invoke);
      });
      return result.kind === "retired" ? null : result.value;
    } finally {
      try { if (!this.closed && transfer && this.frames.length === 0) this.releasePending(); }
      finally { this.sourceCalls--; this.finishHostClose(); }
    }
  }
  private executeCurrent(call: NativeModSourceCall, inputs: Inputs, transfer: boolean, region?: NativeModProtectionRegion, regionAuthority?: NativeModRegionAuthority): number {
    this.current(); this.owned?.synchronizeClock(); if (transfer) this.flush();
    const allocations: { readonly address: GuestAddress; readonly bytes: number }[] = [], globals: { readonly address: GuestAddress; readonly bytes: Uint8Array }[] = [], corrections: (() => void)[] = [];
    let frame: Invocation | null = null;
    const self = inputs.get("self"), cancellation = self?.kind === "actor" && self.value !== null ? this.items?.cancellation(self.value) : undefined;
    const processor = cancellation === undefined ? null : captureAbiProcessorState(this.host.entries.cpu.state);
    if (regionAuthority !== undefined) this.regionAuthorities.push(regionAuthority);
    try {
      const arguments_ = call.arguments.map(value => this.lower(value, inputs, allocations, corrections));
      const regional = region === undefined ? null : new NativeModRegionExecution(this.host, region, region.inputs.map(input => this.lower(input.value, inputs, allocations, corrections)), regionAuthority);
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
      if (this.stages === null) throw new Error("Native source stages are unavailable");
      const result = this.stages.run(call, () => this.host.invoke(target, { abi: this.declaration.target.abi, parameters: call.arguments.map(layout), result: call.returns === "void" ? "void" : { kind: "scalar", storage: call.returns }, variadic: false }, arguments_), regional === null ? undefined : () => regional.bind(target));
      for (const correct of corrections) correct();
      if (transfer) {
        this.flush();
        for (const [actor, before] of appearances) { const slot = this.slotOf(actor); if (slot !== null && before !== this.host.presentation.signature(slot)) this.appearanceActors.add(actor); }
        this.publish();
      }
      return numberResult(regional?.result() ?? result);
    } catch (error) {
      if (cancellation === undefined || processor === null || !cancellation.accepts(error)) throw error;
      restoreAbiProcessorState(this.host.entries.cpu.state, processor); return 0;
    } finally {
      if (regionAuthority !== undefined) { const active = this.regionAuthorities.pop(); if (active !== regionAuthority) throw new Error("Native donor invocation ownership changed"); }
      if (frame !== null) this.frames.pop();
      if (!this.closed) for (const global of globals.reverse()) this.host.memory.write(global.address, global.bytes);
      if (!this.closed) for (const allocation of allocations.reverse()) this.host.memory.unmap(allocation.address, allocation.bytes);
    }
  }
  private transfer<Result>(invoke: () => Result): Result {
    this.current(); this.owned?.synchronizeClock(); this.flush(); this.refresh();
    const frame: Invocation = { observations: this.observe(), pending: [], cursor: 0 }; this.frames.push(frame); this.sourceCalls++;
    try {
      const result = invoke(); if (this.closed || this.closing) return result; this.flush();
      if (this.owned?.advancing !== true) this.publish(); return result;
    } finally { this.frames.pop(); this.sourceCalls--; this.finishHostClose(); }
  }
  private executeEntry(entry: GuestAddress, values: readonly Extract<GuestCallValue, { readonly kind: "pointer" }>[], returns: NativeModScalar | "void", actor: ActorId | null): GuestCallResult | null {
    const result = this.transfer(() => this.sourceExecution(actor, () => this.host.invoke(entry, { abi: this.declaration.target.abi,
      parameters: values.map(() => ({ kind: "scalar", storage: "pointer" })),
      result: returns === "void" ? "void" : { kind: "scalar", storage: returns }, variadic: false }, values)));
    return result.kind === "retired" ? null : result.value;
  }
  invokeCommand(command: CommandInvocation): boolean {
    if (asciiFold(command.argv[0] ?? "") !== "sv") return this.clients?.invokeCommand(command) ?? false;
    command.assertActive(); this.releasePending();
    return this.transfer(() => {
      const appearances = new Map<ActorId, string>();
      for (const actor of this.projections.keys()) { const slot = this.slotOf(actor); if (slot !== null) appearances.set(actor, this.host.presentation.signature(slot)); }
      const result = this.sourceExecution(null, () => this.host.invokeCommand(command));
      if (result.kind === "retired") return true;
      for (const [actor, before] of appearances) { const slot = this.slotOf(actor); if (slot !== null && before !== this.host.presentation.signature(slot)) this.appearanceActors.add(actor); }
      return result.value;
    });
  }
  private entries(): readonly { readonly actor: ActorId; readonly slot: number }[] {
    const result = [...(this.owned?.entries() ?? [])];
    for (const actor of this.projections.keys()) { const slot = this.slotOf(actor); if (slot !== null && this.services.actors.isLive(actor)) result.push({ actor, slot }); }
    return result;
  }
  private publish(events = true): void { if (!this.closing) { this.publishClientOutputs(); this.host.presentation.publish(this.entries(), events); } }
  presentations(): readonly SimulationPresentation[] { return (this.owned?.entries() ?? []).flatMap(({ actor, slot }) => this.host.presentation.appearance(actor, slot)); }
  advance(frame: FrameContext): undefined { this.current(); this.releasePending(); this.owned?.advance(frame); if (this.closed) return undefined; this.publish(); if (this.owned === null) { for (const entry of this.entries()) this.host.clearEntityEvent(entry.slot); this.host.presentation.beginFrame(); } return undefined; }
  importBoundary(name: string, values: readonly GuestCallValue[], invoke: () => GuestCallResult): GuestCallResult {
    const authority = this.regionAuthorities.at(-1);
    if (authority !== undefined && !authority.current()) throw authority.error;
    const result = this.importCurrent(name, values, invoke);
    if (authority !== undefined && !authority.current()) throw authority.error;
    return result;
  }
  private importCurrent(name: string, values: readonly GuestCallValue[], invoke: () => GuestCallResult): GuestCallResult {
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
    this.current(); this.protection?.reserve(); this.owned?.suspend(restoring); await this.host.initialize(restoring); this.current();
    if (!restoring) this.owned?.validate();
    if (!restoring) { this.validateRecords(); for (const call of this.declaration.initialize) this.execute(call, this.inputs(), false); }
    const clients = this.declaration.clients;
    for (const call of [...this.declaration.initialize, ...this.declaration.project, ...this.declaration.release, ...this.declaration.callbacks, ...(this.declaration.objectives?.flatMap(value => value.role === "owned" && value.change !== null ? [value.change] : []) ?? []), ...(this.declaration.items?.weapons?.selection.values.map(value => value.request) ?? []), ...(this.declaration.items?.definitions.flatMap(item => [item.actions?.use, item.actions?.drop].filter(call => call !== undefined)) ?? []),
      ...(clients === undefined ? [] : [...clients.admit, ...clients.userinfo, ...clients.disconnect, ...clients.command, ...(clients.frame ?? []), ...(clients.endFrame ?? []), ...(clients.input ?? []).flatMap(binding => binding.calls)])]) {
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
    this.pickups.assertIdle();
    this.current(); if (this.frames.length !== 0 || this.inputScopes.length !== 0) throw new Error("Cannot save an active native mod callback"); this.releasePending();
    this.flush(); this.refresh();
    const clients = this.clients?.checkpoint() ?? [];
    const source = await this.host.checkpoint(); this.current(); if (this.pendingReleases.size !== 0) throw new Error("Actors changed during native mod capture");
    return { provider: this.instance, schema: "native:mod", version: 1, bytes: encodeCheckpointValue({ module: this.host.memory.module, map: this.map, source, items: this.items?.checkpoint() ?? null, owned: this.owned?.checkpoint() ?? null, presentation: this.host.presentation.checkpoint(),
      clients: clients.map(entry => ({ actor: { slot: entry.actor.slot, generation: entry.actor.generation }, slot: entry.slot, admitted: entry.admitted })),
      actors: [...this.projections].map(([actor, slot]) => ({ actor: { slot: actor.slot, generation: actor.generation }, slot, appearance: this.appearanceActors.has(actor) })) }) };
  }
  async restore(record: ProviderCheckpoint): Promise<void> {
    this.pickups.assertIdle();
    this.current(); if (this.frames.length !== 0 || this.inputScopes.length !== 0) throw new Error("Cannot restore an active native callback");
    const saved = readCheckpoint(record, this.host.memory.module, this.declaration); if (saved.map !== this.map) throw new Error("Native mod source save belongs to another map");
    const actors = saved.actors.map(entry => ({ actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"), slot: entry.slot, appearance: entry.appearance }));
    for (const entry of actors) if (!this.services.actors.isLive(entry.actor)) throw new Error("Saved native projection actor is unavailable");
    const clients = saved.clients.map(entry => ({ ...entry, actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current") }));
    this.clients?.validateRestore(clients);
    const clientActors = new Set(clients.map(entry => entry.actor));
    for (const entry of actors) this.validateInventoryCapacity(entry.actor, clientActors.has(entry.actor));
    for (const entry of saved.presentation.fog) { const actor = this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"); if (!this.services.actors.isLive(actor)) throw new Error("Saved native presentation player is unavailable"); }
    const ownedActors = saved.owned === null ? [] : this.owned?.validateSaved(saved.owned) ?? [];
    this.clientOutputs.clear();
    this.items?.clear(); this.pickups.close(); this.protection?.prepareRestore();
    this.lifecycle = true; this.restoring = true; this.restoreLinks.clear(); this.owned?.suspend(true);
    try { this.clients?.restore(clients); this.appearanceActors.clear(); for (const entry of actors) if (entry.appearance) this.appearanceActors.add(entry.actor); this.projections.clear(); for (const entry of actors) this.projections.set(entry.actor, entry.slot); this.pendingReleases.clear(); await this.host.restore(saved.source);
      this.validateRecords(); this.protection?.validateRestoredInventory(); for (const [actor, slot] of this.projections) this.seed(actor, slot, false); this.refresh(); this.host.presentation.restore(saved.presentation);
      if (saved.owned !== null) this.owned?.restore(saved.owned, ownedActors);
      for (const [slot, link] of this.restoreLinks) if (this.owned?.actorAt(slot) != null) {
        if (this.host.entity(slot).address.byteOffset !== link.address.byteOffset) throw new Error("Native restore retained a stale source link");
        link.invoke();
      }
      this.publish(false); }
    finally { this.lifecycle = false; this.restoring = false; this.restoreLinks.clear(); this.owned?.suspend(false); }
    this.objectives.restored();
    for (const client of clients) if (client.admitted) { this.clientOutputs.publish(client.actor); this.items?.admit(client.actor); }
    if (this.items !== null && saved.items !== null) this.items.restore(saved.items);
    this.clients?.start();
  }
  private finishHostClose(): void {
    if (!this.pendingHostClose || this.sourceCalls !== 0) return;
    this.pendingHostClose = false; this.host_?.close();
  }
  close(): undefined {
    this.objectives.close(); this.releaseMatch?.(); this.releaseMatch = null;
    if (this.closed || this.closing) return undefined; this.closing = true;
    const errors: unknown[] = [];
    this.clientOutputs.close();
    try { this.items?.close(); } catch (error) { errors.push(error); }
    try { this.pickups.close(); } catch (error) { errors.push(error); }
    try { this.protection?.close(); } catch (error) { errors.push(error); }
    try { this.clients?.close(); } catch (error) { errors.push(error); }
    try { this.owned?.close(); } catch (error) { errors.push(error); }
    this.closed = true; this.unsubscribe(); this.projections.clear(); this.appearanceActors.clear(); this.pendingReleases.clear();
    try { this.host_?.presentation.close(); } catch (error) { errors.push(error); }
    this.pendingHostClose = true;
    try { this.finishHostClose(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native mod cleanup failed");
    return undefined;
  }
}
