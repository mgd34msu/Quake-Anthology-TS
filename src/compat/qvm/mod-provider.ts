import type { ContentId } from "../../contracts/content.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { SimulationPresentation } from "../../app/bootstrap/simulation/types.ts";
import type { Q3SourceEvent } from "../../app/bootstrap/simulation/q3/host.ts";
import { EntityState } from "../../network/q3/state/entity.ts";
import { borrowQvmSharedEntity, qvmSharedEntityBytes } from "./shared-entity-record.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { QvmCheckpoint } from "../../contracts/execution.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorCollision } from "../../world/collision/index.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { QvmModActorField, QvmModActorRecord, QvmModCallbackDeclaration, QvmModScalar, QvmModSourceCall, QvmModValue } from "../../contracts/qvm-mod-callbacks.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { UserFileStore } from "../../platform/files/writable.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ModCommandPort } from "../../world/session/mod-commands.ts";
import type { CommandInvocation } from "../../core/commands/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { float32ToBits, nativeAtoi, Q3_BINARY32_PROFILE } from "../../core/numeric.ts";
import { createBoxModel, createCapsuleModel } from "../../world/collision/q3/model.ts";
import { encodeCheckpointValue, decodeCheckpointValue, SaveReader } from "../../persistence/value.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";
import { QvmOpcode } from "./image.ts";
import { QvmModule, qvmApi } from "./module.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmGameExport, QvmGameImport } from "./abi.ts";
import { qvmCommonSyscall } from "./common-syscalls.ts";
import { qvmServerInformationSyscall, type QvmServerInformationServices } from "./server-info-syscalls.ts";
import { QvmFiles, qvmFileSyscall } from "./file-syscalls.ts";
import { rejectQvmSyscall } from "./syscalls.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import { writeQvmTrace, QVM_TRACE_BYTES } from "./trace-record.ts";
import { QvmModActors, validateQvmModActors } from "./mod-actors.ts";
import { Q3GuestWorld } from "../../app/bootstrap/simulation/q3/guest-world.ts";

type Artifact = QvmModuleOptions["artifact"];
type Inputs = ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
type SharedField = Extract<QvmModActorField, { readonly binding: "health" | "inventory" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" }>;
interface Observation { readonly actor: ActorId; readonly address: number; readonly field: SharedField; readonly bytes: Uint8Array; }
interface Frame { observations: readonly Observation[]; }
function fieldSize(field: QvmModActorField): number {
  return field.binding === "private" ? field.byteLength
    : ["origin", "velocity", "angles", "bounds-min", "bounds-max", "constant-vector"].includes(field.binding) ? 12 : 4;
}
function shared(field: QvmModActorField): field is SharedField {
  return field.binding === "health" || field.binding === "inventory" || field.binding === "origin" || field.binding === "velocity"
    || field.binding === "angles" || field.binding === "bounds-min" || field.binding === "bounds-max";
}
function scalar(value: number, encoding: QvmModScalar): number {
  if (!Number.isFinite(value) || encoding === "float32" && !Number.isFinite(Math.fround(value))
    || encoding === "int32" && (value < -0x80000000 || value > 0x7fffffff)) throw new Error(`Mod value exceeds ${encoding}`);
  return encoding === "float32" ? float32ToBits(value) | 0 : Math.trunc(value);
}
function seconds(services: ModHostServices): number { const time = services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; }

export function validateQvmMod(artifact: Artifact, declaration: QvmModCallbackDeclaration): void {
  if (artifact.module.digest !== declaration.program.digest || artifact.module.artifactPath !== declaration.program.path
    || artifact.role !== "qagame" || (artifact.abiProfile ?? "q3-modern") !== declaration.abiProfile) throw new Error("Gameplay mod differs from its declared QVM artifact or ABI");
  const sourceEnd = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const range = (address: number, size: number): void => {
    if (!Number.isSafeInteger(address) || address < 0 || !Number.isSafeInteger(size) || size < 1 || address + size > sourceEnd)
      throw new Error("QVM mod declaration exceeds source data");
  };
  const records = new Map<string, QvmModActorRecord>(), canonical = new Set<string>();
  for (const record of declaration.actorRecords) {
    if (records.has(record.id) || record.id.length === 0 || record.address === 0 || record.address % 4 !== 0
      || !Number.isSafeInteger(record.stride) || record.stride < 4 || record.stride % 4 !== 0
      || !Number.isSafeInteger(record.capacity) || record.capacity < 1 || record.capacity > 1024) throw new Error("Invalid QVM mod actor array");
    range(record.address, record.stride * record.capacity);
    for (const previous of records.values()) if (record.address < previous.address + previous.stride * previous.capacity
      && previous.address < record.address + record.stride * record.capacity) throw new Error("Overlapping QVM mod actor arrays");
    records.set(record.id, record);
    const occupied = new Set<number>();
    for (const field of record.fields) {
      const size = fieldSize(field);
      if (!Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset % 4 !== 0 || size < 1 || field.offset + size > record.stride)
        throw new Error("QVM mod actor field exceeds its source record");
      for (let byte = field.offset; byte < field.offset + size; byte++) { if (occupied.has(byte)) throw new Error("Overlapping QVM mod actor fields"); occupied.add(byte); }
      if (shared(field)) {
        const key = field.binding === "inventory" ? `inventory:${field.item}` : field.binding;
        if (canonical.has(key)) throw new Error(`Multiple authoritative QVM mod stores for ${key}`);
        canonical.add(key);
      }
      if (field.binding === "constant") scalar(field.value, field.encoding);
      if (field.binding === "constant-vector") for (const value of [field.value.x, field.value.y, field.value.z]) scalar(value, "float32");
    }
  }
  if (declaration.entityRecord !== null && !records.has(declaration.entityRecord)) throw new Error("Unknown QVM engine entity record");
  for (const record of records.values()) for (const field of record.fields) if (field.binding === "record" && !records.has(field.record)) throw new Error("Unknown linked QVM actor record");
  const checkValue = (value: QvmModValue, available: ReadonlySet<ModCallbackInput>): void => {
    if (value.kind === "address") { if (value.value !== 0) range(value.value, 1); return; }
    if (value.kind === "actor") { if (!records.has(value.record) || !available.has(value.input)) throw new Error("Invalid QVM actor argument"); return; }
    if (value.kind === "time") { if (!available.has(value.input)) throw new Error("Unavailable QVM time input"); return; }
    const kind = value.value.kind === "input" ? ["self", "other", "activator", "attacker", "inflictor"].includes(value.value.name) ? "actor"
      : ["point", "direction", "normal"].includes(value.value.name) ? "vector" : value.value.name === "item" ? "string" : "float" : value.value.kind;
    if (value.value.kind === "input" && !available.has(value.value.name)) throw new Error(`Unavailable QVM callback input ${value.value.name}`);
    if (kind !== (value.kind === "int32" || value.kind === "float32" ? "float" : value.kind)) throw new Error("QVM callback value has an incompatible representation");
    if (value.value.kind === "float" && (value.kind === "int32" || value.kind === "float32")) scalar(value.value.value, value.kind);
  };
  const checkCall = (call: QvmModSourceCall, available: ReadonlySet<ModCallbackInput>): void => {
    if (artifact.image.instructions[call.entry]?.opcode !== QvmOpcode.OP_ENTER || call.arguments.length > 10) throw new Error("QVM mod callback requires a source function entry and at most ten argument words");
    const globals = new Set<number>();
    for (const value of call.arguments) checkValue(value, available);
    for (const global of call.globals) {
      const size = global.value.kind === "vector" ? 12 : 4;
      range(global.address, size); if (global.address % 4 !== 0) throw new Error("Unaligned QVM callback global");
      for (let byte = global.address; byte < global.address + size; byte++) { if (globals.has(byte)) throw new Error("Overlapping QVM callback globals"); globals.add(byte); }
      checkValue(global.value, available);
    }
  };
  const lifecycle = declaration.sourceActors;
  if (lifecycle !== undefined) {
    const entity = declaration.entityRecord === null ? undefined : records.get(declaration.entityRecord);
    if (entity === undefined || entity.stride < qvmSharedEntityBytes(declaration.abiProfile)
      || lifecycle.inuse < qvmSharedEntityBytes(declaration.abiProfile) || lifecycle.inuse % 4 !== 0 || lifecycle.inuse + 4 > entity.stride
      || !Number.isSafeInteger(lifecycle.eventEntityType) || lifecycle.eventEntityType < 0 || lifecycle.release.argument > 9 || lifecycle.allocate === lifecycle.release.entry
      || artifact.image.instructions[lifecycle.allocate]?.opcode !== QvmOpcode.OP_ENTER
      || artifact.image.instructions[lifecycle.release.entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Invalid QVM source actor lifecycle");
    if (lifecycle.update !== null) checkCall(lifecycle.update, new Set(["self", "time", "elapsed"]));
  }
  for (const call of declaration.initialize) checkCall(call, new Set(["time"]));
  if (declaration.combat !== undefined) checkCall({ entry: declaration.combat.entry, arguments: [], globals: declaration.combat.globals, returns: "void" }, new Set(["time"]));
  validateQvmModActors(artifact, declaration);
  const ids = new Set<string>();
  for (const call of declaration.callbacks) {
    if (ids.has(call.id) || call.stage !== "observe" && call.returns === "void") throw new Error("Duplicate QVM callback or missing source return value"); ids.add(call.id);
    const available = new Set<ModCallbackInput>(["self", "time"]);
    if (call.stage === "observe") available.add("result");
    const extra: readonly ModCallbackInput[] = call.operation === "damage" ? ["attacker", "inflictor", "amount", "knockback", "direction", "point", "normal"]
      : call.operation === "inventory.give" || call.operation === "inventory.consume" ? ["item", "amount"]
      : call.operation === "actor.use" ? ["other", "activator"] : call.operation === "actor.touch" ? ["other"]
      : call.operation === "actor.think" ? ["elapsed"] : call.operation === "actor.pain" ? ["attacker", "amount", "knockback"]
      : ["attacker", "inflictor", "amount", "knockback", "point"];
    for (const name of extra) available.add(name); checkCall(call, available);
  }
}

function hostImage(checkpoint: QvmCheckpoint, declaration: QvmModCallbackDeclaration) {
  if (checkpoint.hostState.format !== "qvm:mod-host-v1" || checkpoint.random.length !== 0 || checkpoint.callbacks.length !== 0) throw new Error("Invalid QVM mod host checkpoint");
  const reader = new SaveReader(decodeCheckpointValue(checkpoint.hostState.bytes)); reader.field("version").literal(1);
  const slots = new Set<number>(), actors = new Set<string>(), capacity = declaration.actorRecords.length === 0 ? 0 : Math.min(...declaration.actorRecords.map(record => record.capacity));
  const nextSlot = reader.field("nextSlot").integer(0);
  if (nextSlot > capacity) throw new Error("Invalid QVM projection allocation cursor");
  const projections = reader.field("projections").list(entry => {
    const actor = readSavedActor(entry.field("actor")), slot = entry.field("slot").integer(0), owned = entry.field("owned").boolean(), key = `${actor.slot}:${actor.generation}`;
    if ((owned ? declaration.sourceActors === undefined || slot >= (declaration.actorRecords.find(record => record.id === declaration.entityRecord)?.capacity ?? 0) : slot >= nextSlot) || slots.has(slot) || actors.has(key)) throw new Error("Invalid saved QVM actor projection");
    slots.add(slot); actors.add(key); entry.field("event").nullable(value => value.string()); return { actor, slot, owned };
  });
  const defaults = reader.field("defaults").list(entry => entry).map((entry, index) => {
    const record = declaration.actorRecords[index]; if (record === undefined) throw new Error("Unexpected QVM actor template");
    const id = entry.field("id").literal(record.id), bytes = entry.field("bytes").bytes();
    if (bytes.length !== record.stride * record.capacity) throw new Error("QVM actor template differs from its source layout");
    return { id, bytes };
  });
  if (defaults.length !== declaration.actorRecords.length) throw new Error("Missing QVM actor templates");
  const configstrings = reader.field("configstrings").list(entry => ({ index: entry.field("index").integer(0), value: entry.field("value").string() }));
  if (new Set(configstrings.map(entry => entry.index)).size !== configstrings.length || configstrings.some(entry => entry.index >= 1024)) throw new Error("Invalid QVM configstrings");
  return { projections, nextSlot, defaults, configstrings, cvars: reader.field("cvars").value, files: reader.field("files").value };
}
export function validateQvmModCheckpoint(artifact: Artifact, declaration: QvmModCallbackDeclaration, checkpoint: QvmCheckpoint): void {
  const module = artifact.module, api = qvmApi("qagame", declaration.abiProfile);
  if (checkpoint.module.id !== module.id || checkpoint.module.digest !== module.digest || checkpoint.module.artifactPath !== module.artifactPath
    || checkpoint.module.revision !== module.revision || checkpoint.data.length !== artifact.image.allocatedDataLength
    || checkpoint.api.kind !== api.kind || checkpoint.api.version !== api.version || (checkpoint.abiProfile ?? "q3-modern") !== declaration.abiProfile
    || checkpoint.instructionIndex !== 0 || checkpoint.operandStack.length !== 0 || checkpoint.programStack !== checkpoint.data.length
    || checkpoint.hostState.module.id !== module.id || checkpoint.hostState.module.digest !== module.digest
    || checkpoint.hostState.module.revision !== module.revision || checkpoint.hostState.module.artifactPath !== module.artifactPath)
    throw new Error("Incompatible QVM gameplay mod checkpoint");
  hostImage(checkpoint, declaration);
}

/** Source callbacks retain their own data image and borrow explicitly declared canonical actor fields. */
export class QvmModProvider {
  readonly module: QvmModule;
  private readonly records: ReadonlyMap<string, QvmModActorRecord>;
  private readonly projections = new Map<ActorId, number>();
  private readonly owned = new Map<ActorId, OwnedActor>();
  private readonly physics = new Map<ActorId, () => undefined>();
  private readonly removing = new Set<ActorId>();
  private readonly hooks: (() => void)[] = [];
  private readonly actorSemantics: QvmModActors | null;
  private readonly portals: Q3GuestWorld | null;
  private readonly configstrings = new Map<number, string>();
  private readonly eventKeys = new Map<ActorId, string>();
  private readonly defaults = new Map<string, Uint8Array>();
  private readonly frames: Frame[] = [];
  readonly cvars: CvarRegistry;
  private readonly information: QvmServerInformationServices;
  private commands: ModCommandPort | null = null;
  private files: QvmFiles | null;
  private readonly unsubscribe: () => undefined;
  private readonly scratchStart: number;
  private scratch: number;
  private nextSlot = 0;
  private closed = false;
  constructor(readonly artifact: Artifact, readonly declaration: QvmModCallbackDeclaration, readonly services: ModHostServices,
    private readonly assertCurrent: () => void, private readonly content: ContentId, private readonly mounts?: MountedContent,
    private readonly writable: UserFileStore | null = null) {
    validateQvmMod(artifact, declaration);
    if (declaration.sourceActors !== undefined && services.engine?.physics === undefined) throw new Error("QVM source actors require destination collision services");
    this.records = new Map(declaration.actorRecords.map(record => [record.id, record]));
    this.scratchStart = Math.ceil((artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength) / 16) * 16;
    this.scratch = this.scratchStart;
    this.cvars = this.newCvars();
    this.information = { abiProfile: declaration.abiProfile, cvars: this.cvars, configstrings: {
      get: index => this.configstrings.get(index) ?? "",
      set: (index, value) => {
        if ((this.configstrings.get(index) ?? "") === value) return;
        this.configstrings.set(index, value); this.emit({ kind: "configstring", index, value });
      },
    } };
    const scene = services.engine?.scene, topology = scene?.geometry, adjust = scene?.adjustAreaPortalState,
      contribution = scene?.adjustAreaPortalContribution, native = scene?.nativeQ3ClipModels;
    this.portals = topology === undefined || adjust === undefined || contribution === undefined || native === undefined ? null : new Q3GuestWorld({
      geometry: topology, adjustAreaPortalState: (first, second, open) => adjust.call(scene, first, second, open),
      adjustAreaPortalContribution: (portal, delta) => contribution.call(scene, portal, delta), nativeQ3ClipModels: () => native.call(scene),
    });
    this.files = mounts === undefined ? null : new QvmFiles({ mounts, writable, print: text => services.engine?.print(text), assertCurrent: () => this.current() });
    this.module = new QvmModule({ artifact, host: call => this.syscall(call), hostState: {
      checkpoint: () => ({ state: { module: artifact.module, format: "qvm:mod-host-v1", bytes: encodeCheckpointValue({ version: 1,
        projections: [...this.projections].map(([actor, slot]) => ({ actor: savedActorId(actor), slot, owned: this.owned.has(actor), event: this.eventKeys.get(actor) ?? null })), nextSlot: this.nextSlot,
        defaults: [...this.defaults].map(([id, bytes]) => ({ id, bytes })),
        configstrings: [...this.configstrings].map(([index, value]) => ({ index, value })),
        cvars: this.cvars.captureSaveState(), files: this.files?.captureCheckpoint() ?? null, portals: this.portals?.capturePortalCheckpoint() ?? null }) }, random: [], callbacks: [] }),
      restore: state => {
        const decoded = new SaveReader(decodeCheckpointValue(state.state.bytes));
        if (decoded.field("portals").value !== undefined && decoded.field("portals").value !== null) {
          if (this.portals === null) throw new Error("Saved QVM mod portals require destination topology");
          this.portals.restorePortalCheckpoint(decoded.field("portals").value);
        }
        const files = mounts === undefined ? null : new QvmFiles({ mounts, writable, print: text => services.engine?.print(text), assertCurrent: () => this.current() });
        try { files?.restoreCheckpoint(decoded.field("files").value); this.cvars.restoreSaveState(decoded.field("cvars").value); }
        catch (error) { files?.closeAll(); throw error; }
        this.files?.closeAll(); this.files = files; this.nextSlot = decoded.field("nextSlot").integer(0);
        this.defaults.clear();
        for (const entry of decoded.field("defaults").list(entry => ({ id: entry.field("id").string(), bytes: entry.field("bytes").bytes() }))) this.defaults.set(entry.id, entry.bytes.slice());
        for (const unbind of this.physics.values()) unbind(); this.physics.clear(); this.actorSemantics?.clearActors(); this.owned.clear(); this.projections.clear(); this.eventKeys.clear();
        this.configstrings.clear();
        for (const entry of decoded.field("configstrings").list(entry => ({ index: entry.field("index").integer(), value: entry.field("value").string() }))) this.configstrings.set(entry.index, entry.value);
        for (const entry of decoded.field("projections").list(entry => ({ actor: readSavedActor(entry.field("actor")), slot: entry.field("slot").integer(0), owned: entry.field("owned").boolean(), event: entry.field("event").nullable(value => value.string()) }))) {
          const actor = this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current");
          this.projections.set(actor, entry.slot);
          if (entry.event !== null) this.eventKeys.set(actor, entry.event);
          if (entry.owned) { const owner = this.services.actors.resolveOwned(actor); if (owner === null) throw new Error("Missing restored QVM source actor"); this.bindOwned(owner, entry.slot); }
        }
        return undefined;
      },
    } });
    this.actorSemantics = declaration.sourceActors?.callbacks === undefined && declaration.combat === undefined ? null : new QvmModActors({
      module: this.module, declaration, services, owned: this.owned,
      pointer: actor => {
        if (declaration.entityRecord === null) throw new Error("QVM actor semantics require an entity record");
        return this.pointer(actor, declaration.entityRecord);
      },
      actor: pointer => pointer === 0 ? null : this.actorAt(this.pointerSlot(pointer)) ?? (this.pointerSlot(pointer) === 1022 ? services.engine?.world() ?? null : null),
      invoke: (call, inputs) => this.invoke(call, inputs),
      scratch: (size, execute) => { const previous = this.scratch; try { return execute(this.allocate(size)); } finally { this.scratch = previous; } },
    });
    this.rememberDefaults();
    this.unsubscribe = services.actors.onRelease(actor => {
      const slot = this.projections.get(actor.id), owned = this.owned.has(actor.id);
      this.physics.get(actor.id)?.(); this.physics.delete(actor.id); this.owned.delete(actor.id); this.eventKeys.delete(actor.id);
      this.projections.delete(actor.id);
      if (owned && slot !== undefined && !this.closed && !this.removing.has(actor.id)) this.releaseSource(slot);
      else if (!owned && slot !== undefined && declaration.sourceActors !== undefined) this.view(this.entityAddress(slot) + declaration.sourceActors.inuse, 4).setInt32(0, 0, true);
      return undefined;
    });
    this.bindLifecycle();
  }
  private newCvars(): CvarRegistry { return new CvarRegistry({ dialect: "q3", context: { session: this.services.actors.session, origin: { kind: "server-console" } }, print: text => this.services.engine?.print(text) }); }
  private rememberDefaults(): void { for (const record of this.records.values()) this.defaults.set(record.id, this.module.memory.bytes.slice(record.address, record.address + record.stride * record.capacity)); }
  private current(): void { this.assertCurrent(); if (this.closed) throw new Error("QVM gameplay mod is closed"); }
  private view(address: number, size: number): DataView { return new DataView(this.module.memory.bytes.buffer, this.module.memory.bytes.byteOffset + address, size); }
  private vector(address: number): Vec3 { const view = this.view(address, 12); return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) }; }
  private writeVector(address: number, value: Vec3): void { const view = this.view(address, 12); [value.x, value.y, value.z].forEach((value, index) => view.setInt32(index * 4, scalar(value, "float32"), true)); }
  private pointer(actor: ActorId | null, recordId: string): number {
    if (actor === null) return 0;
    if (!this.services.actors.isLive(actor)) throw new Error("QVM mod cannot project a stale actor");
    const record = this.records.get(recordId); if (record === undefined) throw new Error("Missing validated QVM actor record");
    let slot = this.projections.get(actor);
    if (slot === undefined) {
      let next = 0; const used = new Set(this.projections.values()); while (used.has(next)) next++;
      if ([...this.records.values()].some(record => next >= record.capacity)) throw new Error("QVM mod actor projection capacity exceeded");
      slot = next; this.nextSlot = Math.max(this.nextSlot, next + 1);
      this.projections.set(actor, slot);
      for (const record of this.records.values()) {
        const address = record.address + slot * record.stride;
        const defaults = this.defaults.get(record.id); if (defaults === undefined) throw new Error("Missing source actor defaults");
        this.module.memory.bytes.set(defaults.subarray(slot * record.stride, (slot + 1) * record.stride), address);
        for (const field of record.fields) {
          if (field.binding === "constant") this.view(address + field.offset, 4).setInt32(0, scalar(field.value, field.encoding), true);
          else if (field.binding === "constant-vector") this.writeVector(address + field.offset, field.value);
          else if (field.binding === "record") this.view(address + field.offset, 4).setInt32(0, this.pointer(actor, field.record), true);
        }
      }
      if (this.declaration.sourceActors !== undefined) {
        this.view(this.entityAddress(slot) + this.declaration.sourceActors.inuse, 4).setInt32(0, 1, true);
        this.entity(slot).s.number = slot;
      }
    }
    if (slot >= record.capacity) throw new Error("Source actor has no declared auxiliary record");
    return record.address + slot * record.stride;
  }
  private refresh(): void {
    for (const [actor, slot] of this.projections) if (!this.owned.has(actor)) for (const record of this.records.values()) for (const field of record.fields) {
      const address = record.address + slot * record.stride + field.offset;
      if (!shared(field)) continue;
      if (field.binding === "health") {
        const state = this.services.combat.read(actor);
        this.view(address, 4).setInt32(0, scalar(state?.health ?? 0, field.encoding), true);
      } else if (field.binding === "inventory") {
        const entry = this.services.inventory.entries(actor).find(entry => entry.item === field.item);
        this.view(address, 4).setInt32(0, scalar(entry?.count ?? 0, field.encoding), true);
      } else {
        const state = this.services.bodies.read(actor);
        this.writeVector(address, state === null ? { x: 0, y: 0, z: 0 } : field.binding === "bounds-min" ? state.bounds.min : field.binding === "bounds-max" ? state.bounds.max : state[field.binding]);
      }
    }
  }
  private observe(): readonly Observation[] {
    const result: Observation[] = [];
    for (const [actor, slot] of this.projections) if (!this.owned.has(actor)) for (const record of this.records.values()) for (const field of record.fields) if (shared(field)) {
      const address = record.address + slot * record.stride + field.offset;
      result.push({ actor, address, field, bytes: this.module.memory.bytes.slice(address, address + fieldSize(field)) });
    }
    return result;
  }
  private flush(): void {
    const frame = this.frames.at(-1); if (frame === undefined) return;
    const changes = frame.observations.filter(entry => entry.bytes.some((byte, offset) => byte !== this.module.memory.bytes[entry.address + offset]));
    frame.observations = this.observe();
    for (const { actor, address, field } of changes) {
      const owner = this.services.actors.resolveOwned(actor); if (owner === null) throw new Error("QVM mod wrote an expired actor");
      if (field.binding === "health" || field.binding === "inventory") {
        const value = field.encoding === "int32" ? this.view(address, 4).getInt32(0, true) : this.view(address, 4).getFloat32(0, true);
        scalar(value, field.encoding);
        if (field.binding === "health") this.services.combat.setHealth(owner, value);
        else { const entry = this.services.inventory.entries(actor).find(entry => entry.item === field.item);
          if (entry === undefined) throw new Error("QVM mod inventory binding disappeared"); this.services.inventory.configure(owner, { ...entry, count: value }); }
      } else {
        const state = this.services.bodies.read(actor); if (state === null) throw new Error("QVM mod body binding disappeared");
        const value = this.vector(address); for (const component of [value.x, value.y, value.z]) scalar(component, "float32");
        const next = field.binding === "bounds-min" ? { ...state, bounds: { ...state.bounds, min: value } }
          : field.binding === "bounds-max" ? { ...state, bounds: { ...state.bounds, max: value } } : { ...state, [field.binding]: value };
        this.services.bodies.write(owner, next);
      }
    }
  }
  private allocate(size: number): number {
    const address = this.scratch; this.scratch += Math.ceil(size / 4) * 4;
    if (this.scratch > this.module.interpreter.stackPointer - 65536) throw new Error("QVM mod argument scratch exceeds its reserved space"); return address;
  }
  private lower(value: QvmModValue, inputs: Inputs): number {
    if (value.kind === "address") return value.value;
    if (value.kind === "actor") { const input = inputs.get(value.input); if (input?.kind !== "actor") throw new Error("Missing QVM actor input"); return this.pointer(input.value, value.record); }
    if (value.kind === "time") { const input = inputs.get(value.input); if (input?.kind !== "float") throw new Error("Missing QVM time input"); return scalar(input.value * (value.units === "milliseconds" ? 1000 : 1), value.encoding); }
    const resolved = value.value.kind === "input" ? inputs.get(value.value.name) : value.value;
    switch (value.kind) {
      case "int32": case "float32": if (resolved?.kind !== "float") throw new Error("Missing scalar QVM input"); return scalar(resolved.value, value.kind);
      case "vector": { if (resolved?.kind !== "vector") throw new Error("Missing vector QVM input"); const address = this.allocate(12); this.writeVector(address, resolved.value); return address; }
      case "string": { if (resolved?.kind !== "string" || resolved.value.includes("\0")) throw new Error("Invalid QVM string input");
        const address = this.allocate(resolved.value.length + 1); this.module.memory.writeString(address, resolved.value, resolved.value.length + 1); return address; }
    }
  }
  private begin(call: QvmModSourceCall, inputs: Inputs) {
    this.current(); if (this.frames.length >= 64) throw new Error("QVM mod callback recursion exceeds 64 calls");
    const scratch = this.scratch;
    const globals = call.globals.map(global => ({ address: global.address, bytes: this.module.memory.bytes.slice(global.address, global.address + (global.value.kind === "vector" ? 12 : 4)) }));
    try {
      const words = call.arguments.map(value => this.lower(value, inputs));
      for (const global of call.globals) { const word = this.lower(global.value, inputs);
        if (global.value.kind === "vector") this.module.memory.bytes.copyWithin(global.address, word, word + 12);
        else this.view(global.address, 4).setInt32(0, word, true); }
      const source = this.declaration.sourceActors;
      if (source !== undefined && call.entry === source.release.entry) {
        const pointer = words[source.release.argument]; if (pointer === undefined) throw new Error("Missing source release argument");
        const actor = this.actorAt(this.pointerSlot(pointer));
        if (actor !== null && !this.owned.has(actor)) throw new Error("QVM source removal of a foreign actor requires its owner continuation");
        if (actor !== null) this.actorSemantics?.beforeRelease(actor);
      }
      this.refresh(); const frame: Frame = { observations: this.observe() }; this.frames.push(frame);
      return { words, finish: () => { try { if (!this.closed) { this.current(); this.flush(); } } finally { this.frames.pop(); for (const global of globals) this.module.memory.bytes.set(global.bytes, global.address); this.scratch = scratch; } } };
    } catch (error) { for (const global of globals) this.module.memory.bytes.set(global.bytes, global.address); this.scratch = scratch; throw error; }
  }
  invoke(call: QvmModSourceCall, inputs: Inputs): number {
    const execution = this.begin(call, inputs);
    try { const result = this.module.call(execution.words, call.entry);
      this.completeDirectLifecycle(call, execution.words, result);
      if (call.returns === "void") return 0;
      if (call.returns === "int32") return result;
      const word = new DataView(new ArrayBuffer(4)); word.setInt32(0, result, true); const value = word.getFloat32(0, true);
      if (!Number.isFinite(value)) throw new Error("QVM mod returned a nonfinite scalar"); return value;
    } finally { execution.finish(); if (!this.closed && this.frames.length === 0) this.publish(); }
  }
  bindCommands(commands: ModCommandPort): void {
    this.current();
    if (this.commands !== null) throw new Error("QVM mod commands are already bound");
    this.commands = commands;
  }
  consoleCommand(command: CommandInvocation): boolean {
    this.current(); command.assertActive();
    const execution = this.begin({ entry: 0, arguments: [{ kind: "int32", value: { kind: "float", value: QvmGameExport.GAME_CONSOLE_COMMAND } }], globals: [], returns: "int32" }, new Map<ModCallbackInput, ModRuntimeValue>());
    try { return this.module.command(execution.words, command.argv) !== 0; }
    finally { execution.finish(); if (!this.closed && this.frames.length === 0) this.publish(); }
  }
  async readScript(name: string): Promise<string | undefined> {
    this.current();
    const resource = await this.mounts?.open(name);
    this.current(); return resource == null ? undefined : new TextDecoder().decode(resource.bytes);
  }
  private commandPort(): ModCommandPort {
    if (this.commands === null) throw new Error("QVM mod console execution requires its component command service");
    return this.commands;
  }
  async initialize(): Promise<void> {
    for (const call of this.declaration.initialize) {
      const execution = this.begin(call, new Map<ModCallbackInput, ModRuntimeValue>([["time", { kind: "float", value: seconds(this.services) }]]));
      try { const result = await this.module.callAsync(execution.words, call.entry, () => this.current()); this.completeDirectLifecycle(call, execution.words, result); } finally { execution.finish(); }
    }
    this.rememberDefaults(); this.publish();
  }
  private entityRecord(): QvmModActorRecord {
    const record = this.declaration.entityRecord === null ? undefined : this.records.get(this.declaration.entityRecord);
    if (record === undefined || record.stride < qvmSharedEntityBytes(this.declaration.abiProfile)) throw new Error("QVM engine service requires its declared sharedEntity_t array");
    return record;
  }
  private entityAddress(slot: number): number {
    const record = this.entityRecord();
    if (!Number.isInteger(slot) || slot < 0 || slot >= record.capacity) throw new Error("QVM entity exceeds its declared source array");
    return record.address + slot * record.stride;
  }
  private entity(slot: number) { return borrowQvmSharedEntity(this.view(this.entityAddress(slot), qvmSharedEntityBytes(this.declaration.abiProfile)), this.declaration.abiProfile); }
  private pointerSlot(pointer: number): number {
    const record = this.entityRecord(), slot = (pointer - record.address) / record.stride;
    this.entityAddress(slot); return slot;
  }
  private bindOwned(actor: OwnedActor, slot: number): void {
    const entity = this.entity(slot), physics = this.services.engine?.physics;
    if (physics === undefined) throw new Error("QVM source actors require destination collision services");
    this.owned.set(actor.id, actor);
    this.services.bodies.rebind(actor, {
      read: () => ({ origin: entity.r.currentOrigin, angles: entity.r.currentAngles, velocity: entity.s.pos.delta,
        bounds: { min: entity.r.mins, max: entity.r.maxs }, ground: this.actorAt(entity.s.groundEntityNum) }),
      write: body => { entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles;
        entity.s.pos = { ...entity.s.pos, delta: body.velocity }; entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
        entity.s.groundEntityNum = body.ground === null ? 1023 : this.entitySlot(body.ground); return undefined; },
      linked: body => { entity.r.linked = true; entity.r.linkcount = body.linkCount; entity.r.absmin = body.absoluteBounds.min; entity.r.absmax = body.absoluteBounds.max; return undefined; },
    });
    this.physics.set(actor.id, physics.bindSource(actor, {
      collision: () => ({ solid: entity.r.contents === 0 ? "none" : entity.r.model.kind === "inline" ? "brush" : (entity.r.contents & 0x40000000) !== 0 ? "trigger" : "box",
        family: "q3", model: entity.r.model.kind === "inline" ? entity.r.model.index : null, owner: this.actorAt(entity.r.ownerNum) }),
      motion: () => null, flags: () => ({}),
      writeFlags: () => { throw new Error("QVM source actor flags require an authored field declaration"); },
      writeAngularVelocity: () => { throw new Error("QVM source angular movement belongs to its declared update callback"); },
      waterTransition: () => undefined,
    }));
    physics.setCollision(actor, this.collision(slot));
    this.actorSemantics?.admit(actor);
    if (entity.r.linked) this.services.bodies.restoreLinkState(actor, { linkCount: entity.r.linkcount,
      linked: { state: this.services.bodies.read(actor.id) ?? { origin: entity.r.currentOrigin, angles: entity.r.currentAngles,
        velocity: entity.s.pos.delta, bounds: { min: entity.r.mins, max: entity.r.maxs }, ground: null },
        absoluteBounds: { min: entity.r.absmin, max: entity.r.absmax } } });
  }
  private bindLifecycle(): void {
    const source = this.declaration.sourceActors; if (source === undefined) return;
    const reference = (instructionIndex: number) => ({ kind: "qvm", module: this.artifact.module, instructionIndex } satisfies Parameters<QvmModule["bindFunction"]>[0]);
    this.hooks.push(this.module.bindFunction(reference(source.allocate), call => {
      const pointer = call.proceed(); this.adoptSource(pointer);
      return pointer;
    }));
    this.hooks.push(this.module.bindFunction(reference(source.release.entry), call => {
      const pointer = call.words.getInt32(source.release.argument * 4, true), slot = this.pointerSlot(pointer), actor = this.actorAt(slot);
      if (actor !== null && !this.owned.has(actor)) throw new Error("QVM source removal of a foreign actor requires its owner continuation");
      if (actor !== null) this.actorSemantics?.beforeRelease(actor);
      const result = call.proceed();
      this.retireSource(slot);
      return result;
    }));
  }
  private adoptSource(pointer: number): void {
    const source = this.declaration.sourceActors; if (source === undefined) throw new Error("Missing QVM source actor declaration");
    const slot = this.pointerSlot(pointer);
    if (this.actorAt(slot) !== null || this.view(pointer + source.inuse, 4).getInt32(0, true) === 0) throw new Error("Authored QVM allocator returned an occupied or inactive entity");
    const actor = this.services.actors.allocateAtSource(this.artifact.module.id, slot, "qvm:mod-actor");
    this.projections.set(actor.id, slot);
    try { this.bindOwned(actor, slot); }
    catch (error) { this.removing.add(actor.id); try { this.services.actors.release(actor); this.releaseSource(slot); } finally { this.removing.delete(actor.id); } throw error; }
  }
  private retireSource(slot: number): void {
    const source = this.declaration.sourceActors, actor = this.actorAt(slot);
    if (source === undefined || actor === null || this.view(this.entityAddress(slot) + source.inuse, 4).getInt32(0, true) !== 0) return;
    const owner = this.owned.get(actor); if (owner === undefined) throw new Error("QVM source removed a foreign actor without its owner continuation");
    this.removing.add(actor); try { this.services.actors.release(owner); } finally { this.removing.delete(actor); }
  }
  private completeDirectLifecycle(call: QvmModSourceCall, words: readonly number[], result: number): void {
    const source = this.declaration.sourceActors; if (source === undefined) return;
    if (call.entry === source.allocate) this.adoptSource(result);
    else if (call.entry === source.release.entry) {
      const pointer = words[source.release.argument]; if (pointer === undefined) throw new Error("Missing source release argument");
      this.retireSource(this.pointerSlot(pointer));
    }
  }
  private releaseSource(slot: number): void {
    const source = this.declaration.sourceActors; if (source === undefined) return;
    const words = new Array<number>(source.release.argument + 1).fill(0); words[source.release.argument] = this.entityAddress(slot);
    this.module.call(words, source.release.entry);
  }
  private emit(event: Q3SourceEvent): void {
    const engine = this.services.engine; if (engine === undefined) throw new Error("QVM presentation requires destination event services");
    engine.events.emit(this.content, { kind: "q3-source", event });
  }
  private publish(): void {
    for (const [actor] of this.owned) {
      const slot = this.projections.get(actor); if (slot === undefined) continue;
      const entity = this.entity(slot), state = entity.s;
      if (!entity.r.linked) continue;
      if (state.event === 0 && state.eType < (this.declaration.sourceActors?.eventEntityType ?? Number.POSITIVE_INFINITY)) { this.eventKeys.delete(actor); continue; }
      const key = `${state.event}:${state.eType}`;
      if (this.eventKeys.get(actor) === key) continue;
      this.eventKeys.set(actor, key);
      const snapshot = new EntityState(); snapshot.copyFrom(state);
      this.emit({ kind: "entity-event", actor, state: snapshot, origin: entity.r.currentOrigin, time: Math.trunc(seconds(this.services) * 1000) });
    }
  }
  advance(frame: FrameContext): undefined {
    const source = this.declaration.sourceActors; if (source === undefined) return undefined;
    const time = frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000;
    const elapsed = frame.elapsed.kind === "seconds" ? frame.elapsed.value : frame.elapsed.value / 1000;
    if (source.update !== null) for (const [actor] of [...this.owned].sort(([a], [b]) => (this.projections.get(a) ?? 0) - (this.projections.get(b) ?? 0))) {
      if (this.services.actors.isLive(actor)) this.invoke(source.update, new Map<ModCallbackInput, ModRuntimeValue>([
        ["self", { kind: "actor", value: actor }], ["time", { kind: "float", value: time }], ["elapsed", { kind: "float", value: elapsed }],
      ]));
    }
    this.publish(); return undefined;
  }
  presentations(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [];
    for (const [actor, slot] of this.projections) if (this.owned.has(actor)) {
      const entity = this.entity(slot), inline = entity.r.model.kind === "inline" ? this.inlineModel(entity.r.model.index) : null;
      const path = inline === null ? this.configstrings.get(32 + entity.s.modelindex) : `*${entity.s.modelindex}`;
      if (!entity.r.linked || (entity.r.svFlags & 1) !== 0 || entity.s.modelindex === 0 || path === undefined || path.length === 0) continue;
      result.push({ actor, content: inline?.content ?? this.content, family: inline?.family ?? "q3", path, frame: entity.s.frame, oldFrame: entity.s.frame, skin: 0,
        effects: 0, renderFlags: 0, origin: entity.r.currentOrigin, angles: entity.r.currentAngles, scale: 1, visible: true, viewWeapon: false });
    }
    return result;
  }
  private inlineModel(index: number) {
    const model = this.services.engine?.inlineModel;
    if (model === undefined) throw new Error("QVM inline models require destination map model services");
    return model(index);
  }
  private collision(slot: number): ActorCollision {
    const entity = this.entity(slot), model = entity.r.model;
    return { family: "q3", shape: model.kind === "inline" ? { kind: "model", model: model.index } : model,
      contents: entity.r.contents, owner: this.actorAt(entity.r.ownerNum), role: "solid", monster: false, deadMonster: false };
  }
  private link(slot: number): void {
    const entity = this.entity(slot), actor = this.actorAt(slot);
    if (actor === null) throw new Error("QVM linked an entity without its authored allocation");
    const owner = this.services.actors.resolveOwned(actor), physics = this.services.engine?.physics;
    if (owner === null) throw new Error("QVM linked a stale entity");
    if (physics === undefined) throw new Error("QVM entity links require destination collision services");
    if (entity.r.model.kind === "inline") this.inlineModel(entity.r.model.index);
    const byte = (value: number) => Math.max(1, Math.min(255, Math.trunc(value)));
    entity.s.solid = entity.r.model.kind === "inline" ? 0xffffff : (entity.r.contents & (1 | 0x2000000)) === 0 ? 0
      : (byte(Math.fround(entity.r.maxs.z + 32)) << 16) | (byte(-entity.r.mins.z) << 8) | byte(entity.r.maxs.x);
    this.services.bodies.unlink(owner); entity.r.linked = false;
    if (this.owned.has(actor)) physics.setCollision(owner, this.collision(slot));
    this.services.bodies.link(owner);
    const linked = this.services.bodies.linked(actor);
    if (linked !== null) { entity.r.linked = true; entity.r.linkcount = linked.linkCount; entity.r.absmin = linked.absoluteBounds.min; entity.r.absmax = linked.absoluteBounds.max; }
  }
  private engine(call: QvmHostCall): number | null {
    if (call.kind !== "engine" || call.role !== "qagame") return null;
    const word = (index: number) => call.words.getInt32(index * 4, true);
    switch (call.code) {
      case QvmGameImport.G_LOCATE_GAME_DATA: {
        const entity = this.entityRecord();
        if (word(1) !== entity.address || word(3) !== entity.stride || word(2) < 0 || word(2) > entity.capacity
          || ![...this.records.values()].some(record => record.address === word(4) && record.stride === word(5))) throw new Error("Authored QVM engine arrays differ from their declared layout");
        return 0;
      }
      case QvmGameImport.G_LINKENTITY: case QvmGameImport.G_UNLINKENTITY: {
        const slot = this.pointerSlot(word(1)), entity = this.entity(slot), actor = this.actorAt(slot);
        if (call.code === QvmGameImport.G_UNLINKENTITY) {
          if (actor !== null) { const owner = this.services.actors.resolveOwned(actor); if (owner !== null) this.services.bodies.unlink(owner); }
          entity.r.linked = false; return 0;
        }
        this.link(slot); return 0;
      }
      case QvmGameImport.G_SET_BRUSH_MODEL: {
        if (word(2) === 0) throw new Error("SV_SetBrushModel: NULL");
        const name = call.guest.readString(word(2));
        if (!name.startsWith("*")) throw new Error(`SV_SetBrushModel: ${name} is not a brush model`);
        const slot = this.pointerSlot(word(1)), index = nativeAtoi(name.slice(1)), model = this.inlineModel(index), entity = this.entity(slot);
        entity.r.model = { kind: "inline", index }; entity.r.mins = model.bounds.min; entity.r.maxs = model.bounds.max; entity.r.contents = -1;
        const actor = this.actorAt(slot), owner = actor === null ? null : this.services.actors.resolveOwned(actor);
        if (owner === null) throw new Error("QVM brush model has no live actor");
        if (!this.owned.has(owner.id)) {
          const body = this.services.bodies.read(owner.id); if (body === null) throw new Error("QVM brush model requires an existing body");
          this.services.bodies.write(owner, { ...body, bounds: model.bounds });
          const physics = this.services.engine?.physics; if (physics === undefined) throw new Error("QVM brush models require destination collision services");
          physics.setCollision(owner, this.collision(slot));
        }
        this.link(slot); return 0;
      }
      case QvmGameImport.G_SEND_SERVER_COMMAND: this.emit({ kind: "server-command", client: word(1), text: call.guest.readString(word(2)) }); return 0;
      case QvmGameImport.G_ADJUST_AREA_PORTAL_STATE: {
        const scene = this.services.engine?.scene, actor = this.actorAt(this.pointerSlot(word(1)));
        if (this.portals === null || scene?.boxLeaves === undefined || scene.leafArea === undefined) throw new Error("QVM portal state requires destination topology services");
        const bounds = actor === null ? undefined : this.services.bodies.linked(actor)?.absoluteBounds;
        if (bounds === undefined) return 0;
        const areas = [...new Set(scene.boxLeaves(bounds, 128).leaves.map(leaf => scene.leafArea?.(leaf)))].filter(area => area !== undefined);
        const first = areas[0], second = areas[1];
        if (first !== undefined && second !== undefined) this.portals.adjustAreaPortalState(first, second, word(2) !== 0);
        return 0;
      }
      case QvmGameImport.G_AREAS_CONNECTED: {
        const scene = this.services.engine?.scene;
        if (scene?.areasConnected === undefined) throw new Error("QVM area connectivity requires destination topology services");
        return Number(scene.areasConnected(word(1), word(2)));
      }
      default: return null;
    }
  }
  private entitySlot(actor: ActorId): number {
    const id = this.declaration.entityRecord; if (id === null) throw new Error("QVM mod has no engine entity record");
    this.pointer(actor, id); const slot = this.projections.get(actor); if (slot === undefined) throw new Error("Missing QVM actor slot"); return slot;
  }
  private actorAt(slot: number): ActorId | null { return [...this.projections].find(([, index]) => index === slot)?.[0] ?? null; }
  private spatial(call: QvmHostCall): number | null {
    if (call.kind !== "engine" || call.role !== "qagame") return null;
    const word = (index: number) => call.words.getInt32(index * 4, true), vector = (address: number): Vec3 => {
      const data = call.guest.view(address, 12); return { x: data.getFloat32(0, true), y: data.getFloat32(4, true), z: data.getFloat32(8, true) }; };
    const scene = this.services.engine?.scene;
    if (call.code === QvmGameImport.G_ENTITIES_IN_BOX) {
      const query = this.services.engine?.areaEntities; if (query === undefined) throw new Error("QVM area queries require destination spatial services");
      const maximum = word(4), found = query({ min: vector(word(1)), max: vector(word(2)) });
      const actors = maximum < 0 ? found : found.slice(0, maximum);
      if (actors.length !== 0) {
        const output = call.guest.view(word(3), actors.length * 4);
        actors.forEach((actor, index) => output.setInt32(index * 4, this.entitySlot(actor), true));
      }
      return actors.length;
    }
    if (call.code === QvmGameImport.G_ENTITY_CONTACT || call.code === QvmGameImport.G_ENTITY_CONTACTCAPSULE) {
      const entity = this.entity(this.pointerSlot(word(3))), model = entity.r.model, bounds = { min: vector(word(1)), max: vector(word(2)) }, zero = { x: 0, y: 0, z: 0 };
      const capsule = call.code === QvmGameImport.G_ENTITY_CONTACTCAPSULE;
      if (model.kind === "inline") {
        if (scene === undefined) throw new Error("QVM entity contact requires destination scene services");
        const result = scene.trace({ start: zero, end: zero, shape: { kind: capsule ? "capsule" : "box", bounds },
          target: { kind: "model", model: model.index, origin: entity.r.currentOrigin, angles: entity.r.currentAngles }, passActor: null,
          numeric: Q3_BINARY32_PROFILE, policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
        return Number(result.startSolid || result.allSolid);
      }
      const target = { min: entity.r.mins, max: entity.r.maxs }, temporary = model.kind === "capsule" ? createCapsuleModel(target) : createBoxModel(target);
      const result = temporary.transformedTraceSource({ start: zero, end: zero, mask: -1,
        shape: { kind: capsule ? "capsule" : "box", mins: bounds.min, maxs: bounds.max } }, entity.r.currentOrigin, entity.r.currentAngles);
      return Number(result.startSolid || result.allSolid);
    }
    if (call.code === QvmGameImport.G_TRACE || call.code === QvmGameImport.G_TRACECAPSULE) {
      if (scene === undefined) throw new Error("QVM trace requires destination scene services");
      const bounds = { min: word(3) === 0 ? { x: 0, y: 0, z: 0 } : vector(word(3)), max: word(4) === 0 ? { x: 0, y: 0, z: 0 } : vector(word(4)) };
      const result = scene.trace({ start: vector(word(2)), end: vector(word(5)), shape: { kind: call.code === QvmGameImport.G_TRACECAPSULE ? "capsule" : "box", bounds },
        target: { kind: "world" }, passActor: this.actorAt(word(6)), numeric: Q3_BINARY32_PROFILE, policy: { kind: "q3", contentsMask: word(7), curves: true, playerCurveClip: true } });
      if (result.kind !== "q3") throw new Error("QVM trace lost its source collision policy");
      writeQvmTrace(call.guest.view(word(1), QVM_TRACE_BYTES), { ...result, plane: result.sourcePlane, entityNum: result.hit.kind === "actor" ? this.entitySlot(result.hit.actor) : result.fraction === 1 ? 1023 : 1022 }); return 0;
    }
    if (call.code === QvmGameImport.G_POINT_CONTENTS) {
      if (scene === undefined) throw new Error("QVM point contents requires destination scene services");
      const result = scene.pointContents({ point: vector(word(1)), target: { kind: "world" }, passActor: this.actorAt(word(2)), numeric: Q3_BINARY32_PROFILE,
        policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
      if (result.kind !== "q3") throw new Error("QVM contents lost its source policy"); return result.contents;
    }
    return null;
  }
  private syscall(call: QvmHostCall): QvmHostResult {
    this.current(); this.flush();
    const result = qvmCommonSyscall(call, { role: "qagame", cvars: this.cvars, milliseconds: () => Math.trunc(seconds(this.services) * 1000), arguments: () => [],
      print: text => { if (this.services.engine === undefined) throw new Error("QVM print requires destination engine services"); this.services.engine.print(text); },
      commands: { executeNow: text => { this.commandPort().executeNow(text); }, append: text => this.commandPort().append(text), insert: text => this.commandPort().insert(text) }, realTime: () => { throw new Error("QVM real-time service is not bound"); } })
      ?? qvmServerInformationSyscall(call, this.information)
      ?? (this.files === null ? null : qvmFileSyscall(call, this.files)) ?? this.engine(call) ?? this.spatial(call);
    if (result === null) return rejectQvmSyscall(call);
    const refresh = (): void => { this.current(); this.refresh(); const frame = this.frames.at(-1); if (frame !== undefined) frame.observations = this.observe(); };
    if (result instanceof Promise) return result.then(value => { refresh(); return value; });
    refresh(); return result;
  }
  checkpoint(): QvmCheckpoint { this.current(); return this.module.checkpoint(); }
  restore(checkpoint: QvmCheckpoint): undefined {
    this.current(); validateQvmModCheckpoint(this.artifact, this.declaration, checkpoint);
    const saved = hostImage(checkpoint, this.declaration);
    for (const entry of saved.projections) {
      const actor = this.services.actors.resolveSaved(entry.actor);
      if (actor === null || entry.owned && (actor.owner !== this.artifact.module.id || this.services.actors.sourceOf(actor.id)?.slot !== entry.slot)) throw new Error("Saved QVM mod actor is unavailable or has the wrong owner");
      if (entry.owned) { const source = this.declaration.sourceActors;
        if (source === undefined || new DataView(checkpoint.data.buffer, checkpoint.data.byteOffset).getInt32(this.entityAddress(entry.slot) + source.inuse, true) === 0) throw new Error("Saved QVM source actor is inactive"); }
    }
    if (saved.projections.filter(entry => entry.owned).length !== this.services.actors.ownedBy(this.artifact.module.id).length) throw new Error("QVM mod source ownership differs from the saved world");
    this.newCvars().restoreSaveState(saved.cvars);
    if (this.mounts !== undefined) { const files = new QvmFiles({ mounts: this.mounts, writable: this.writable, assertCurrent: () => this.current() });
      try { files.restoreCheckpoint(saved.files); } finally { files.closeAll(); } }
    else if (saved.files !== null) throw new Error("Saved QVM mod filesystem is unavailable");
    this.module.restore(checkpoint); return undefined;
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const errors: unknown[] = [];
    for (const actor of [...this.owned.values()]) if (this.services.actors.isLive(actor.id)) {
      try { this.services.actors.release(actor); } catch (error) { errors.push(error); }
    }
    this.unsubscribe();
    try { this.commands?.close(); } catch (error) { errors.push(error); }
    try { this.portals?.close(); } catch (error) { errors.push(error); }
    try { this.actorSemantics?.close(); } catch (error) { errors.push(error); }
    for (const remove of this.hooks) try { remove(); } catch (error) { errors.push(error); }
    this.projections.clear(); this.owned.clear(); this.eventKeys.clear();
    try { this.files?.closeAll(); } catch (error) { errors.push(error); }
    try { this.module.retire(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QVM mod cleanup failed");
    return undefined;
  }
}
