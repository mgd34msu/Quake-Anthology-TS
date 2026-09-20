// SPDX-License-Identifier: GPL-2.0-or-later
import { allocateNativeMemory, nativeAllocationBytes } from "../../../guest/runtime/common/memory.ts";
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestValueLayout, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, CallbackId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { GuestCallRunner } from "../../../guest/abi/index.ts";
import type { GuestCallSignature, GuestHostCallback, MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { ClassicQ2Cvars } from "./cvars.ts";
import { CLASSIC_Q2_ABI, CLASSIC_Q2_EXPORTS, CLASSIC_Q2_IMPORTS, CLASSIC_Q2_IMPORT_BYTES, CLASSIC_Q2_TRACE_LAYOUT, classicSignature, q2Pointer } from "./layout.ts";
import { classicPrintf, classicPrintfLayouts } from "./printf.ts";
import { ClassicQ2Edicts, allocateClassicString, classicStringAllocationBytes, readClassicString, readClassicVector, writeClassicString, writeClassicVector } from "./records.ts";
import type { ClassicQ2ActorProjection } from "./records.ts";

export interface ClassicQ2WorldLink {
  readonly clusters: readonly number[] | null;
  readonly headnode: number;
  readonly areas: readonly [number, number];
}
export interface ClassicQ2EngineServices {
  readonly projection?: ClassicQ2ActorProjection;
  readonly engine: Pick<Q2FoundationHost, "actors" | "bodies" | "combat" | "inventory" | "callbacks" | "trace" | "pointContents" | "inPvs" | "inPhs" | "setAreaPortal" | "setSolid" | "inlineModelBounds">;
  readonly cvars: CvarRegistry;
  readonly bindEntity: (record: RawEntityView, actor: OwnedActor) => undefined;
  readonly linkBody?: (record: RawEntityView, actor: OwnedActor) => undefined;
  readonly print: (destination: "broadcast" | "debug" | "client" | "center", entity: GuestAddress | null, level: number, text: string) => undefined;
  readonly configstring: (index: number, value: string) => undefined;
  readonly resourceIndex: (kind: "model" | "sound" | "image", name: string) => number;
  readonly sound: (origin: Vec3 | null, entity: GuestAddress | null, channel: number, index: number, volume: number, attenuation: number, timeOffset: number) => undefined;
  readonly areasConnected: (first: number, second: number) => boolean;
  readonly worldLink: (bounds: Bounds) => ClassicQ2WorldLink;
  readonly boxEdicts: (bounds: Bounds, kind: "solid" | "trigger") => readonly ActorId[];
  readonly message: (operation: string, values: readonly GuestCallValue[], context: GuestCallContext) => undefined;
  readonly command: () => { readonly arguments: readonly string[]; readonly args: string };
  readonly addCommand: (text: string) => undefined;
  readonly debugGraph: (value: number, color: number) => undefined;
  readonly pmove: (address: GuestAddress, host: ClassicQ2GuestHost) => undefined;
}
export interface ClassicQ2GuestHostOptions {
  readonly importBoundary?: (name: string, arguments_: readonly GuestCallValue[], invoke: () => GuestCallResult) => GuestCallResult;
  readonly runner: GuestCallRunner;
  readonly provider: ProviderId;
  readonly services: ClassicQ2EngineServices;
  readonly instructionBudget: number;
}
export function classicPointer(arguments_: readonly GuestCallValue[], index: number): GuestAddress | null {
  const value = arguments_[index];
  if (value?.kind !== "pointer") throw new TypeError(`API 3 argument ${index} must be a pointer`);
  return value.value;
}
export function classicRequiredPointer(arguments_: readonly GuestCallValue[], index: number): GuestAddress {
  const value = classicPointer(arguments_, index);
  if (value === null) throw new RangeError(`API 3 argument ${index} cannot be null`);
  return value;
}
export function classicNumber(arguments_: readonly GuestCallValue[], index: number): number {
  const value = arguments_[index];
  if (value === undefined || value.kind !== "int32" && value.kind !== "uint32" && value.kind !== "float32" && value.kind !== "float64") throw new TypeError(`API 3 argument ${index} must be numeric`);
  return value.value;
}
const voidResult: GuestCallResult = { kind: "void" };
function pointerResult(value: GuestAddress | null): GuestCallResult { return { kind: "pointer", value }; }
function intResult(value: number): GuestCallResult { return { kind: "int32", value }; }

/** The DLL owns gameplay bytes. Every call and nested callback uses the supplied CPU and memory. */
export class ClassicQ2GuestHost {
  readonly memory: MappedGuestMemory;
  #spawnInstructions = 0n;
  get spawnInstructions(): bigint { return this.#spawnInstructions; }
  readonly imports: GuestAddress;
  readonly cvars: ClassicQ2Cvars;
  readonly #callbackNames = new Map<CallbackId, string>();
  readonly #allocations = new Map<bigint, { readonly address: GuestAddress; readonly bytes: number; readonly tag: number }>();
  readonly #surfaces = new Map<string, GuestAddress>();
  readonly #models = new Map<number, string>();
  #edicts: ClassicQ2Edicts | null = null;
  #exports: GuestAddress | null = null;
  #initialized = false;
  #suppressReconcile = false;
  constructor(readonly options: ClassicQ2GuestHostOptions) {
    this.memory = options.runner.options.cpu.memory;
    if (this.memory.pointerBytes !== 4) throw new TypeError("Classic Q2 API 3 requires a 32-bit guest");
    this.cvars = new ClassicQ2Cvars(this.memory, options.services.cvars);
    this.imports = this.memory.allocate({ byteLength: CLASSIC_Q2_IMPORT_BYTES, label: "API 3 game_import_t" });
    for (const [index, entry] of CLASSIC_Q2_IMPORTS.entries()) {
      const id: CallbackId = `${options.provider}:api3.${entry.name}`;
      this.#callbackNames.set(id, entry.name);
      const address = options.runner.options.callbacks.bind({ id, signature: entry.signature,
        invoke: (context, arguments_) => options.importBoundary === undefined ? this.importCall(entry.name, context, arguments_)
          : options.importBoundary(entry.name, arguments_, () => this.importCall(entry.name, context, arguments_)) });
      this.memory.writePointer(this.memory.offset(this.imports, BigInt(index * 4)), address);
    }
  }
  get edicts(): ClassicQ2Edicts {
    if (this.#edicts === null) throw new Error("GetGameAPI has not returned its export table");
    return this.#edicts;
  }
  variadicLayouts(callback: GuestHostCallback, fixed: readonly GuestCallValue[]): readonly GuestValueLayout[] {
    const name = this.#callbackNames.get(callback.id);
    if (name === undefined) throw new Error(`Variadic callback ${callback.id} is not an API 3 import`);
    const index = name === "bprintf" || name === "centerprintf" ? 1 : name === "cprintf" ? 2 : 0;
    return classicPrintfLayouts(readClassicString(this.memory, classicRequiredPointer(fixed, index)));
  }
  invoke(target: GuestAddress, signature: GuestCallSignature, arguments_: readonly GuestCallValue[], self: RawEntityView | null = null, instructionBudget = this.options.instructionBudget): GuestCallResult {
    const context: GuestCallContext = { module: this.memory.module,
      callback: { kind: "native-guest", module: this.memory.module, address: target, abi: CLASSIC_Q2_ABI },
      parent: this.options.runner.currentContext, self, other: null };
    return this.options.runner.invoke({ target, signature, arguments: arguments_, context, instructionBudget });
  }
  getGameApi(target: GuestAddress): GuestAddress {
    if (this.#exports !== null) throw new Error("GetGameAPI already bound");
    const result = this.invoke(target, classicSignature([q2Pointer], q2Pointer), [{ kind: "pointer", value: this.imports }]);
    if (result.kind !== "pointer" || result.value === null) throw new Error("GetGameAPI returned null or a non-pointer result");
    const edicts = new ClassicQ2Edicts(this.memory, result.value, this.options.services.engine.actors, this.options.provider, this.options.services.bindEntity, this.options.services.projection);
    for (const entry of Object.values(CLASSIC_Q2_EXPORTS)) {
      const address = this.memory.readPointer(this.memory.offset(result.value, BigInt(entry.offset)));
      if (address === null) throw new Error(`Null API 3 export at byte ${entry.offset}`);
      this.memory.check(address, 1, "execute");
    }
    this.#exports = result.value; this.#edicts = edicts;
    return result.value;
  }
  call(name: string, arguments_: readonly GuestCallValue[] = [], self: RawEntityView | null = null, instructionBudget = this.options.instructionBudget): GuestCallResult {
    if (this.#exports === null) throw new Error("GetGameAPI must run before lifecycle calls");
    const entry = CLASSIC_Q2_EXPORTS[name];
    if (entry === undefined) throw new Error(`Unknown API 3 export ${name}`);
    const target = this.memory.readPointer(this.memory.offset(this.#exports, BigInt(entry.offset)));
    if (target === null) throw new Error(`Null API 3 export ${name}`);
    this.cvars.refresh();
    const result = this.invoke(target, entry.signature, arguments_, self, instructionBudget);
    if (this.#initialized && !this.#suppressReconcile && name !== "Shutdown") this.edicts.reconcile();
    return result;
  }
  async initLoading(nextFrame: () => Promise<void>): Promise<void> {
    if (this.#initialized) throw new Error("API 3 Init already completed");
    await this.callLoading("Init", [], nextFrame); this.#initialized = true; this.edicts.reconcile();
  }
  init(): undefined { if (this.#initialized) throw new Error("API 3 Init already completed"); this.call("Init"); this.#initialized = true; this.edicts.reconcile(); return undefined; }
  shutdown(): undefined {
    this.call("Shutdown"); this.#initialized = false;
    if (this.options.services.projection === undefined) for (const actor of this.options.services.engine.actors.ownedBy(this.options.provider)) this.options.services.engine.actors.release(actor);
    return undefined;
  }
  spawnEntities(map: string, entities: string, spawnPoint: string): undefined {
    if (this.options.services.projection === undefined) for (const actor of this.options.services.engine.actors.ownedBy(this.options.provider)) this.options.services.engine.actors.release(actor);
    const before = this.options.runner.instructionsExecuted;
    try {
      this.withStrings([map, entities, spawnPoint], pointers => {
        this.call("SpawnEntities", pointers, null, Math.min(Number.MAX_SAFE_INTEGER, this.options.instructionBudget * 10));
        return undefined;
      });
    } finally { this.#spawnInstructions = this.options.runner.instructionsExecuted - before; }
    return undefined;
  }
  async callLoading(name: string, arguments_: readonly GuestCallValue[], nextFrame: () => Promise<void>, instructionBudget = this.options.instructionBudget): Promise<GuestCallResult> {
    if (this.#exports === null) throw new Error("GetGameAPI must run before lifecycle calls");
    const entry = CLASSIC_Q2_EXPORTS[name];
    if (entry === undefined) throw new Error(`Unknown API 3 export ${name}`);
    const target = this.memory.readPointer(this.memory.offset(this.#exports, BigInt(entry.offset)));
    if (target === null) throw new Error(`Null API 3 export ${name}`);
    this.cvars.refresh();
    const result = await this.options.runner.invokeLoading({ target, signature: entry.signature, arguments: arguments_,
      context: { module: this.memory.module, callback: { kind: "native-guest", module: this.memory.module, address: target, abi: CLASSIC_Q2_ABI }, parent: null, self: null, other: null }, instructionBudget }, nextFrame);
    if (this.#initialized && !this.#suppressReconcile && name !== "Shutdown") this.edicts.reconcile();
    return result;
  }
  async saveLoading(name: "ReadGame" | "ReadLevel", filename: string, nextFrame: () => Promise<void>): Promise<void> {
    if (this.options.services.projection === undefined) for (const actor of this.options.services.engine.actors.ownedBy(this.options.provider)) this.options.services.engine.actors.release(actor);
    const address = allocateClassicString(this.memory, filename);
    try { await this.callLoading(name, [{ kind: "pointer", value: address }], nextFrame, Math.min(Number.MAX_SAFE_INTEGER, this.options.instructionBudget * 10)); }
    finally { this.memory.unmap(address, classicStringAllocationBytes(filename)); }
  }
  async spawnEntitiesLoading(map: string, entities: string, spawnPoint: string, nextFrame: () => Promise<void>): Promise<void> {
    if (this.options.services.projection === undefined) for (const actor of this.options.services.engine.actors.ownedBy(this.options.provider)) this.options.services.engine.actors.release(actor);
    const records = [map, entities, spawnPoint].map(text => ({ text, address: allocateClassicString(this.memory, text) }));
    const before = this.options.runner.instructionsExecuted;
    try {
      await this.callLoading("SpawnEntities", records.map(record => ({ kind: "pointer", value: record.address })), nextFrame,
        Math.min(Number.MAX_SAFE_INTEGER, this.options.instructionBudget * 10));
    } finally {
      this.#spawnInstructions = this.options.runner.instructionsExecuted - before;
      for (const record of records) this.memory.unmap(record.address, classicStringAllocationBytes(record.text));
    }
  }
  setModelName(index: number, name: string): void {
    if (!Number.isInteger(index) || index < 1 || index >= 256) throw new RangeError("API 3 model index outside MAX_MODELS");
    if (name === "") this.#models.delete(index); else this.#models.set(index, name);
  }
  rebindWorld(): void {
    if (!this.#initialized || this.#exports === null || this.options.runner.depth !== 0) throw new Error("API 3 world rebind requires an idle initialized module");
    this.#edicts = new ClassicQ2Edicts(this.memory, this.#exports, this.options.services.engine.actors, this.options.provider, this.options.services.bindEntity, this.options.services.projection);
    this.#models.clear();
  }
  writeTravelLevel(filename: string, maxClients: number): void {
    if (!this.#initialized || this.options.runner.depth !== 0 || this.#suppressReconcile) throw new Error("API 3 travel save requires an idle initialized module");
    const clients = Array.from({ length: maxClients }, (_, index) => this.edicts.at(index + 1));
    const inUse = clients.map(record => record.bytes.getInt32(88, true));
    this.#suppressReconcile = true;
    let failure: { readonly error: unknown } | null = null;
    try {
      for (const record of clients) record.bytes.setInt32(88, 0, true);
      this.save("WriteLevel", filename);
    } catch (error) { failure = { error }; } finally {
      for (const [index, record] of clients.entries()) record.bytes.setInt32(88, inUse[index] ?? 0, true);
      this.#suppressReconcile = false;
    }
    try { this.edicts.reconcile(); }
    catch (error) { if (failure !== null) throw new AggregateError([failure.error, error], "Travel WriteLevel and reconciliation failed"); throw error; }
    if (failure !== null) throw failure.error;
  }
  runFrame(): undefined { this.call("RunFrame"); return undefined; }
  clientConnect(slot: number, userinfo: string): { readonly allowed: boolean; readonly userinfo: string } {
    const buffer = this.memory.allocate({ byteLength: 516, label: "API 3 mutable userinfo" });
    try {
      writeClassicString(this.memory, buffer, userinfo, 512);
      const record = this.edicts.at(slot), result = this.call("ClientConnect", [{ kind: "pointer", value: record.address }, { kind: "pointer", value: buffer }], record);
      if (result.kind !== "int32") throw new Error("API 3 ClientConnect returned a non-integer result");
      return { allowed: result.value !== 0, userinfo: readClassicString(this.memory, buffer, 512) };
    } finally { this.memory.unmap(buffer, 516); }
  }
  clientEvent(name: "ClientBegin" | "ClientDisconnect" | "ClientCommand", slot: number): undefined {
    const record = this.edicts.at(slot); this.call(name, [{ kind: "pointer", value: record.address }], record); return undefined;
  }
  clientUserinfoChanged(slot: number, userinfo: string): string {
    const buffer = this.memory.allocate({ byteLength: 516, label: "API 3 mutable userinfo change" });
    try {
      writeClassicString(this.memory, buffer, userinfo, 512);
      const record = this.edicts.at(slot);
      this.call("ClientUserinfoChanged", [{ kind: "pointer", value: record.address }, { kind: "pointer", value: buffer }], record);
      return readClassicString(this.memory, buffer, 512);
    } finally { this.memory.unmap(buffer, 516); }
  }
  clientThink(slot: number, command: Uint8Array): undefined {
    if (command.byteLength !== 16) throw new RangeError("API 3 usercmd_t requires 16 source bytes");
    const address = this.memory.allocate({ byteLength: 16, label: "API 3 usercmd_t" });
    this.memory.write(address, command);
    try { const record = this.edicts.at(slot); this.call("ClientThink", [{ kind: "pointer", value: record.address }, { kind: "pointer", value: address }], record); }
    finally { this.memory.unmap(address, 16); }
    return undefined;
  }
  save(name: "WriteGame" | "ReadGame" | "WriteLevel" | "ReadLevel", filename: string, autosave = false): undefined {
    if ((name === "ReadGame" || name === "ReadLevel") && this.options.services.projection === undefined) for (const actor of this.options.services.engine.actors.ownedBy(this.options.provider)) this.options.services.engine.actors.release(actor);
    this.withStrings([filename], pointers => { this.call(name, name === "WriteGame" ? [...pointers, { kind: "int32", value: Number(autosave) }] : pointers); return undefined; });
    return undefined;
  }
  private withStrings(texts: readonly string[], operation: (pointers: readonly GuestCallValue[]) => undefined): undefined {
    const records = texts.map(text => ({ text, address: allocateClassicString(this.memory, text) }));
    try { return operation(records.map(record => ({ kind: "pointer", value: record.address }))); }
    finally { for (const record of records) this.memory.unmap(record.address, classicStringAllocationBytes(record.text)); }
  }
  importCall(name: string, context: GuestCallContext, arguments_: readonly GuestCallValue[]): GuestCallResult {
    const services = this.options.services, memory = this.memory;
    const number = (index: number) => classicNumber(arguments_, index);
    const pointer = (index: number) => classicPointer(arguments_, index);
    const required = (index: number) => classicRequiredPointer(arguments_, index);
    const string = (index: number) => readClassicString(memory, pointer(index));
    const vector = (index: number) => readClassicVector(memory, required(index));
    switch (name) {
      case "bprintf": case "dprintf": case "cprintf": case "centerprintf": case "error": {
        const offset = name === "bprintf" || name === "centerprintf" ? 1 : name === "cprintf" ? 2 : 0;
        const text = classicPrintf(memory, string(offset), arguments_.slice(offset + 1));
        if (name === "error") throw new Error(`API 3 game error: ${text}`);
        services.print(name === "dprintf" ? "debug" : name === "bprintf" ? "broadcast" : name === "cprintf" ? "client" : "center",
          name === "cprintf" || name === "centerprintf" ? pointer(0) : null, name === "bprintf" ? number(0) : name === "cprintf" ? number(1) : 0, text);
        return voidResult;
      }
      case "TagMalloc": {
        const requested = number(0), tag = number(1);
        if (!Number.isInteger(requested) || requested < 0) throw new RangeError("TagMalloc requires a nonnegative byte count");
        // MSVC's word-at-a-time string routines access the allocator's rounded tail.
        const bytes = nativeAllocationBytes(requested);
        const address = allocateNativeMemory(memory, requested, `API 3 tag ${tag}`);
        this.#allocations.set(address.byteOffset, { address, bytes, tag }); return pointerResult(address);
      }
      case "TagFree": {
        const address = required(0), record = this.#allocations.get(address.byteOffset);
        if (record === undefined) throw new Error("TagFree pointer is not a live API 3 allocation");
        memory.unmap(record.address, record.bytes); this.#allocations.delete(address.byteOffset); return voidResult;
      }
      case "FreeTags":
        for (const [key, record] of this.#allocations) if (record.tag === number(0)) { memory.unmap(record.address, record.bytes); this.#allocations.delete(key); }
        return voidResult;
      case "cvar": services.cvars.register(string(0), string(1), number(2)); return pointerResult(this.cvars.pointer(string(0)));
      case "cvar_set": case "cvar_forceset": services.cvars.set(string(0), string(1), name === "cvar_forceset"); return pointerResult(this.cvars.pointer(string(0)));
      case "configstring": services.configstring(number(0), string(1)); return voidResult;
      case "modelindex": case "soundindex": case "imageindex": {
        const path = string(0), index = services.resourceIndex(name === "modelindex" ? "model" : name === "soundindex" ? "sound" : "image", path);
        if (name === "modelindex") this.#models.set(index, path);
        return intResult(index);
      }
      case "sound": services.sound(null, pointer(0), number(1), number(2), number(3), number(4), number(5)); return voidResult;
      case "positioned_sound": services.sound(pointer(0) === null ? null : vector(0), pointer(1), number(2), number(3), number(4), number(5), number(6)); return voidResult;
      case "pointcontents": return intResult(services.engine.pointContents(vector(0)));
      case "inPVS": return intResult(Number(services.engine.inPvs(vector(0), vector(1))));
      case "inPHS": return intResult(Number(services.engine.inPhs(vector(0), vector(1))));
      case "SetAreaPortalState": services.engine.setAreaPortal(number(0), number(1) !== 0); return voidResult;
      case "AreasConnected": return intResult(Number(services.areasConnected(number(0), number(1))));
      case "setmodel": {
        const record = this.edicts.fromPointer(required(0)), model = string(1);
        const index = services.resourceIndex("model", model); this.#models.set(index, model); record.bytes.setInt32(40, index, true);
        if (model.startsWith("*")) {
          const bounds = services.engine.inlineModelBounds(Number(model.slice(1)));
          writeClassicVector(memory, memory.offset(record.address, 188n), bounds.min); writeClassicVector(memory, memory.offset(record.address, 200n), bounds.max);
          this.linkEntity(record.address);
        }
        return voidResult;
      }
      case "linkentity": this.linkEntity(required(0)); return voidResult;
      case "unlinkentity": { const actor = this.edicts.observe(required(0)); if (actor !== null) services.engine.bodies.unlink(actor); return voidResult; }
      case "BoxEdicts": {
        const maximum = number(3), area = number(4);
        if (maximum < 0 || area !== 1 && area !== 2) throw new RangeError("BoxEdicts invalid area type or maximum count");
        const results = services.boxEdicts({ min: vector(0), max: vector(1) }, area === 1 ? "solid" : "trigger").slice(0, maximum);
        for (const [index, actor] of results.entries()) memory.writePointer(memory.offset(required(2), BigInt(index * 4)), this.edicts.pointer(actor));
        return intResult(results.length);
      }
      case "trace": {
        const ignored = pointer(4), mins = pointer(1), maxs = pointer(2);
        const actor = ignored === null ? null : this.edicts.observe(ignored)?.id ?? null;
        return { kind: "aggregate", layout: CLASSIC_Q2_TRACE_LAYOUT, bytes: this.traceBytes(services.engine.trace({ start: vector(0), end: vector(3),
          bounds: mins === null && maxs === null ? null : { min: mins === null ? { x: 0, y: 0, z: 0 } : readClassicVector(memory, mins), max: maxs === null ? { x: 0, y: 0, z: 0 } : readClassicVector(memory, maxs) }, ignore: actor, mask: number(5) })) };
      }
      case "Pmove": services.pmove(required(0), this); return voidResult;
      case "argc": return intResult(services.command().arguments.length);
      case "argv": return pointerResult(this.cvars.string(services.command().arguments[number(0)] ?? ""));
      case "args": return pointerResult(this.cvars.string(services.command().args));
      case "AddCommandString": services.addCommand(string(0)); return voidResult;
      case "DebugGraph": services.debugGraph(number(0), number(1)); return voidResult;
      case "multicast": case "unicast": case "WriteChar": case "WriteByte": case "WriteShort": case "WriteLong": case "WriteFloat": case "WriteString": case "WritePosition": case "WriteDir": case "WriteAngle":
        services.message(name, arguments_, context); return voidResult;
      default: throw new Error(`Unsupported API 3 engine import ${name}`);
    }
  }
  traceBytes(trace: TraceResult): Uint8Array {
    if (trace.kind !== "q2") throw new TypeError("API 3 trace requires the shared Q2 trace contract");
    const bytes = new Uint8Array(56), view = new DataView(bytes.buffer), plane = trace.sourcePlane;
    view.setInt32(0, Number(trace.allSolid), true); view.setInt32(4, Number(trace.startSolid), true); view.setFloat32(8, trace.fraction, true);
    for (const [offset, vector] of [[12, trace.end], [24, plane.normal]] satisfies readonly (readonly [number, Vec3])[]) {
      view.setFloat32(offset, vector.x, true); view.setFloat32(offset + 4, vector.y, true); view.setFloat32(offset + 8, vector.z, true);
    }
    view.setFloat32(36, plane.distance, true); view.setUint8(40, plane.type); view.setUint8(41, plane.signbits); view.setInt32(48, trace.contents, true);
    if (trace.surface !== null) {
      const surface = trace.surface, key = JSON.stringify([surface.name, surface.flags, surface.value]);
      let address = this.#surfaces.get(key);
      if (address === undefined) {
        address = this.memory.allocate({ byteLength: 24, label: "API 3 csurface_t" });
        const raw = new Uint8Array(24), data = new DataView(raw.buffer);
        for (let index = 0; index < Math.min(16, surface.name.length); index++) raw[index] = surface.name.charCodeAt(index) & 255;
        data.setInt32(16, surface.flags, true); data.setInt32(20, surface.value, true); this.memory.write(address, raw); this.#surfaces.set(key, address);
      }
      view.setUint32(44, Number(address.byteOffset), true);
    }
    const entity = trace.hit.kind === "none" ? null : trace.hit.kind === "world" ? this.edicts.at(0).address : this.edicts.pointer(trace.hit.actor);
    view.setUint32(52, Number(entity?.byteOffset ?? 0n), true);
    return bytes;
  }
  linkEntity(address: GuestAddress): undefined {
    const record = this.edicts.fromPointer(address), actor = this.edicts.observe(address);
    if (actor === null || record.slot === 0) return undefined;
    const engine = this.options.services.engine, view = record.bytes;
    engine.bodies.unlink(actor);
    const origin = readClassicVector(this.memory, this.memory.offset(address, 4n)), angles = readClassicVector(this.memory, this.memory.offset(address, 16n));
    const mins = readClassicVector(this.memory, this.memory.offset(address, 188n)), maxs = readClassicVector(this.memory, this.memory.offset(address, 200n));
    const solid = view.getInt32(248, true), flags = view.getInt32(184, true);
    if (solid < 0 || solid > 3) throw new RangeError("Invalid API 3 solid_t");
    const clamp = (value: number, maximum: number) => Math.max(1, Math.min(maximum, Math.trunc(value)));
    view.setInt32(72, solid === 2 && (flags & 2) === 0 ? clamp(maxs.x / 8, 31) | clamp(-mins.z / 8, 31) << 5 | clamp((maxs.z + 32) / 8, 63) << 10 : solid === 3 ? 31 : 0, true);
    const radius = solid === 3 && (angles.x !== 0 || angles.y !== 0 || angles.z !== 0) ? Math.max(Math.abs(mins.x), Math.abs(mins.y), Math.abs(mins.z), Math.abs(maxs.x), Math.abs(maxs.y), Math.abs(maxs.z)) : null;
    const bounds: Bounds = { min: { x: Math.fround(Math.fround(origin.x + (radius === null ? mins.x : -radius)) - 1), y: Math.fround(Math.fround(origin.y + (radius === null ? mins.y : -radius)) - 1), z: Math.fround(Math.fround(origin.z + (radius === null ? mins.z : -radius)) - 1) },
      max: { x: Math.fround(Math.fround(origin.x + (radius === null ? maxs.x : radius)) + 1), y: Math.fround(Math.fround(origin.y + (radius === null ? maxs.y : radius)) + 1), z: Math.fround(Math.fround(origin.z + (radius === null ? maxs.z : radius)) + 1) } };
    writeClassicVector(this.memory, this.memory.offset(address, 212n), bounds.min); writeClassicVector(this.memory, this.memory.offset(address, 224n), bounds.max);
    writeClassicVector(this.memory, this.memory.offset(address, 236n), { x: maxs.x - mins.x, y: maxs.y - mins.y, z: maxs.z - mins.z });
    const link = this.options.services.worldLink(bounds);
    view.setInt32(104, link.clusters === null || link.clusters.length > 16 ? -1 : link.clusters.length, true);
    view.setInt32(172, link.headnode, true); view.setInt32(176, link.areas[0], true); view.setInt32(180, link.areas[1], true);
    for (const [index, cluster] of (link.clusters ?? []).slice(0, 16).entries()) view.setInt32(108 + index * 4, cluster, true);
    if (view.getInt32(92, true) === 0) writeClassicVector(this.memory, this.memory.offset(address, 28n), origin);
    view.setInt32(92, view.getInt32(92, true) + 1, true);
    const modelName = this.#models.get(view.getInt32(40, true));
    if (solid === 3 && (modelName === undefined || !/^\*\d+$/.test(modelName))) throw new Error("API 3 solid brush has no registered inline model");
    engine.setSolid(actor, solid === 0 ? "none" : solid === 1 ? "trigger" : solid === 2 ? "box" : "brush", solid === 3 && modelName !== undefined ? Number(modelName.slice(1)) : null);
    if (solid !== 0) {
      if (this.options.services.linkBody === undefined) engine.bodies.link(actor);
      else this.options.services.linkBody(record, actor);
    }
    return undefined;
  }
}
