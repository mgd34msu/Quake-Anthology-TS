import { RereleaseDebugShapeImports } from "./debug-shapes.ts";
import type { RereleaseDebugShapesEvent } from "./debug-shapes.ts";
import { RereleaseWorldTextImports } from "./world-text.ts";
import type { RereleaseWorldTextEvent } from "./world-text.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import { allocateNativeMemory, nativeAllocationBytes } from "../../../guest/runtime/common/memory.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BspPlane, Q2SurfaceInfo, TraceResult } from "../../../contracts/scene.ts";
import type { ActorCallbacks } from "../../../contracts/world.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import { integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import type { BodyStateBinding } from "../../../world/actors/body.ts";
import type { CombatStateBinding, PowerArmorCellBinding } from "../../../world/gameplay/authority.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import { edictLayout, fieldOffset, surfaceLayout, traceLayout } from "./layouts.ts";
import { signature, type GameExportName } from "./api.ts";
import { RereleaseCoreImports, readGuestString } from "./imports.ts";
import type { RereleaseCoreServices } from "./imports.ts";
import { RereleaseGuestModule, guestBool, guestPointer, resultPointer } from "./module.ts";
import type { RereleaseImportCall, RereleaseModuleOptions } from "./module.ts";
import { RereleaseMessageImports } from "./messages.ts";
import type { RereleaseMessageServices } from "./messages.ts";

import { RereleaseSoundImports } from "./sounds.ts";
import type { RereleaseSoundEvent } from "./sounds.ts";
import { RereleaseForeignActors } from "./foreign-actors.ts";
import type { RereleaseForeignDamageServices, RereleaseProjectionSave } from "./foreign-actors.ts";
import type { RereleaseDeferredDamageSave } from "./deferred-damage.ts";
import type { RereleaseNativeEntries } from "./native-entries.ts";
import type { OriginalPickupAdmission } from "../../../contracts/original-pickups.ts";
import { NativePrimaryPickups } from "../native-pickups.ts";
import { rereleasePickupProfile } from "./pickup-profile.ts";

export interface RereleaseActorBindings {
  readonly body: BodyStateBinding;
  readonly combat: CombatStateBinding | null;
  readonly powerArmorCells: PowerArmorCellBinding | null;
  readonly inventory: InventoryStateBinding | null;
  readonly callbacks: ActorCallbacks;
}
export interface RereleaseSourceSave {
  readonly native: Uint8Array;
  readonly deferredDamage: readonly RereleaseDeferredDamageSave[];
  readonly projections: readonly RereleaseProjectionSave[];
}
/** Private layouts and native gameplay policy are identified by the actual guest artifact. */
export interface RereleaseSemanticBindings {
  /** An isolated component borrows identities without binding or releasing primary authorities. */
  project?(view: RawEntityView, module: RereleaseGuestModule): OwnedActor | null;
  generation?(view: RawEntityView): number;
  bound?(view: RawEntityView, actor: OwnedActor): void;
  bind(view: RawEntityView, actor: OwnedActor, module: RereleaseGuestModule): RereleaseActorBindings;
  /** Foreign actors need source-compatible surrogate identity, never a null hit substitution. */
  foreignAddress(actor: ActorId): GuestAddress;
}
export interface RereleaseSpatialServices {
  areasConnected(first: number, second: number): boolean;
  visibility(kind: "pvs" | "phs", first: Vec3, second: Vec3, portals: boolean): boolean;
  surfaceId(surface: Q2SurfaceInfo): number;
  boxEdicts(min: Vec3, max: Vec3, area: number): readonly ActorId[];
  inlineModel(sourceModelIndex: number): number;
  prepareLink?(actor: OwnedActor, view: RawEntityView): void;
  linkMetadata(actor: OwnedActor, view: RawEntityView): { readonly area: number; readonly area2: number; readonly networkSolid: number };
}
export interface RereleaseQ2HostOptions extends Omit<RereleaseModuleOptions, "invokeImport" | "actorAtSlot"> {
  readonly pickups?: { readonly admission: OriginalPickupAdmission; readonly imageBase: GuestAddress };
  readonly importBoundary?: (name: string, arguments_: readonly GuestCallValue[], invoke: () => GuestCallResult) => GuestCallResult;
  readonly engine: Pick<Q2FoundationHost, "actors" | "bodies" | "callbacks" | "combat" | "inventory" | "trace" | "pointContents" | "setAreaPortal" | "setSolid" | "inlineModelBounds" | "worldActor">;
  readonly services: RereleaseCoreServices;
  readonly spatial: RereleaseSpatialServices;
  readonly semantics: RereleaseSemanticBindings;
  readonly messages?: RereleaseMessageServices;
  /** Explicit q2repro !USE_REF capability; absent renderer bindings still fail otherwise. */
  readonly debugDrawing?: "headless";
  readonly debugShapes?: (event: RereleaseDebugShapesEvent) => void;
  readonly worldText?: (event: RereleaseWorldTextEvent) => void;
  readonly sound?: (event: RereleaseSoundEvent) => void;
  readonly nativeEntries?: RereleaseNativeEntries;
  readonly foreignDamage?: RereleaseForeignDamageServices;
  /** Explicit component capability policy runs before imports can publish source side effects. */
  readonly interceptImport?: (call: RereleaseImportCall, host: RereleaseQ2GuestHost) => GuestCallResult | undefined;
}

/** Source bytes back the shared actor authorities. This class owns no simulation clock. */
export class RereleaseQ2GuestHost {
  readonly module: RereleaseGuestModule;
  readonly core: RereleaseCoreImports;
  readonly foreignActors: RereleaseForeignActors | null;
  readonly #messages: RereleaseMessageImports | null;
  readonly #debugShapes: RereleaseDebugShapeImports | null;
  readonly #worldText: RereleaseWorldTextImports | null;
  readonly #sounds: RereleaseSoundImports | null;
  readonly #lifetimes = new Map<number, { readonly actor: OwnedActor; readonly generation: number | null; readonly address: bigint }>();
  readonly #retiredInputClients = new Set<number>();
  retireInputClient(slot: number): void { this.#retiredInputClients.add(slot); }
  finishInputRetirement(slot: number): void { this.#retiredInputClients.delete(slot); this.#lifetimes.delete(slot); }
  readonly #surfaces = new Map<Q2SurfaceInfo, GuestAddress>();
  readonly #botEntities = new Map<ActorId, RawEntityView>();
  #filterDepth = 0;
  #unsubscribe: () => undefined;
  readonly #reservedClients = new Set<number>();
  #initialized = false;
  #closed = false;
  readonly #pickups: NativePrimaryPickups | null;
  constructor(readonly options: RereleaseQ2HostOptions) {
    if (options.pickups !== undefined && options.semantics.project !== undefined) throw new Error("Primary pickup callers cannot bind a component projection");
    if (options.debugDrawing === "headless" && (options.debugShapes !== undefined || options.worldText !== undefined))
      throw new Error("Headless Q2 debug drawing cannot bind renderer callbacks");
    this.core = new RereleaseCoreImports(options.runner.options.cpu.memory, options.services);
    this.module = new RereleaseGuestModule({ ...options,
      actorAtSlot: slot => options.semantics.project === undefined
        ? options.engine.actors.atSource(options.runner.options.cpu.memory.module.id, slot)?.id ?? null
        : this.actor(this.module.entities().atSlot(slot))?.id ?? null,
      invokeImport: call => this.#import(call) });
    this.#debugShapes = options.debugShapes === undefined ? null : new RereleaseDebugShapeImports(this.module.memory, options.debugShapes);
    this.#worldText = options.worldText === undefined ? null : new RereleaseWorldTextImports(this.module.memory, options.worldText);
    this.#sounds = options.sound === undefined ? null : new RereleaseSoundImports(this.module.memory, options.sound, address => this.module.entities().fromPointer(address).slot);
    this.#messages = options.messages === undefined ? null : new RereleaseMessageImports(this.module.memory, options.messages, address => this.module.entities().fromPointer(address).slot);
    if (options.foreignDamage !== undefined && options.nativeEntries === undefined) throw new Error("Foreign native damage requires verified entry points");
    this.foreignActors = options.foreignDamage === undefined || options.nativeEntries === undefined ? null : new RereleaseForeignActors(this, options.nativeEntries, options.foreignDamage);
    this.#unsubscribe = options.engine.actors.onRelease(actor => { try { this.foreignActors?.released(actor); } finally { this.#botEntities.delete(actor.id); } return undefined; });
    const profile = rereleasePickupProfile(this.module.memory.module.digest);
    this.#pickups = options.pickups === undefined || profile === null ? null : new NativePrimaryPickups({ memory: this.module.memory, runner: options.runner,
      invoke: (target, signature, values) => this.module.invoke(target, signature, values), record: address => this.module.entities().fromPointer(address),
      current: record => this.#retiredInputClients.has(record.slot) ? null : this.options.engine.actors.atSource(this.module.memory.module.id, record.slot)?.id ?? null,
      admission: () => { const pickups = this.options.pickups; if (pickups === undefined) throw new Error("API2023 primary pickup authority disappeared"); return pickups.admission; },
    }, options.pickups.imageBase, profile);
  }
  #at(view: RawEntityView, name: string): GuestAddress { return this.module.memory.offset(view.address, BigInt(fieldOffset(edictLayout, name))); }
  #vector(address: GuestAddress): Vec3 {
    const memory = this.module.memory;
    return { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) };
  }
  #writeVector(address: GuestAddress, vector: Vec3): void {
    const memory = this.module.memory;
    memory.writeFloat32(address, vector.x); memory.writeFloat32(memory.offset(address, 4n), vector.y); memory.writeFloat32(memory.offset(address, 8n), vector.z);
  }
  actor(view: RawEntityView): OwnedActor | null {
    if (this.#retiredInputClients.has(view.slot)) return null;
    if (this.options.semantics.project !== undefined) return this.options.semantics.project(view, this.module);
    const projected = this.foreignActors?.lookup(view);
    if (projected !== undefined) return projected;
    const { memory } = this.module, engine = this.options.engine;
    const live = memory.readUint8(this.#at(view, "inuse")) !== 0 || this.#reservedClients.has(view.slot);
    const generation = this.options.semantics.generation?.(view) ?? null;
    const previous = this.#lifetimes.get(view.slot);
    if (previous !== undefined && (!live || previous.generation !== generation || previous.address !== view.address.byteOffset || !engine.actors.isLive(previous.actor.id))) {
      this.#lifetimes.delete(view.slot);
      if (engine.actors.isLive(previous.actor.id)) engine.actors.release(previous.actor);
    }
    if (!live) return null;
    const current = this.#lifetimes.get(view.slot);
    if (current !== undefined) return current.actor;
    const actor = engine.actors.atSource(memory.module.id, view.slot) ?? engine.actors.allocateAtSource(memory.module.id, view.slot, "q2-rerelease:native-edict");
    const binding = this.options.semantics.bind(view, actor, this.module);
    engine.bodies.bind(actor, binding.body);
    if (binding.combat !== null) engine.combat.bind(actor, binding.combat);
    if (binding.powerArmorCells !== null) engine.combat.bindPowerArmorCells(actor, binding.powerArmorCells);
    if (binding.inventory !== null) engine.inventory.bind(actor, binding.inventory);
    const callbacks = binding.callbacks;
    const invoke = (call: () => undefined): undefined => { try { return call(); } finally { this.reconcile(); } };
    engine.callbacks.bind(actor, {
      think: callbacks.think === null ? null : (self, frame) => invoke(() => callbacks.think?.(self, frame)),
      touch: callbacks.touch === null ? null : contact => invoke(() => callbacks.touch?.(contact)),
      use: callbacks.use === null ? null : (self, other, activator) => invoke(() => callbacks.use?.(self, other, activator)),
      pain: callbacks.pain === null ? null : reaction => invoke(() => callbacks.pain?.(reaction)),
      die: callbacks.die === null ? null : reaction => invoke(() => callbacks.die?.(reaction)),
    });
    this.#lifetimes.set(view.slot, { actor, generation, address: view.address.byteOffset });
    this.options.semantics.bound?.(view, actor);
    return actor;
  }
  reserveClient(slot: number): OwnedActor {
    if (this.#closed || slot < 1 || !Number.isInteger(slot)) throw new Error("Invalid Q2 client reservation");
    this.#reservedClients.add(slot);
    const actor = this.actor(this.module.entities().atSlot(slot));
    if (actor === null) throw new Error("Q2 reserved source client has no actor");
    return actor;
  }
  isClientReserved(slot: number): boolean { return this.#reservedClients.has(slot); }
  releaseClientReservation(slot: number): void { this.#reservedClients.delete(slot); this.reconcile(); }
  rebindWorld(commit: () => void): void {
    this.#pickups?.assertIdle();
    if (this.#closed || !this.#initialized || this.#filterDepth !== 0) throw new Error("Q2 world rebind requires an idle initialized host");
    this.foreignActors?.clear(); this.#reservedClients.clear(); this.#releaseActors(); this.#unsubscribe(); this.#botEntities.clear();
    for (const address of this.#surfaces.values()) this.module.memory.unmap(address, surfaceLayout.byteLength);
    this.#surfaces.clear();
    commit();
    this.#unsubscribe = this.options.engine.actors.onRelease(actor => { try { this.foreignActors?.released(actor); } finally { this.#botEntities.delete(actor.id); } return undefined; });
  }
  reconcile(): void {
    const table = this.module.entities();
    for (const [slot, entry] of this.#lifetimes) if (slot >= table.count) { this.#lifetimes.delete(slot); if (this.options.engine.actors.isLive(entry.actor.id)) this.options.engine.actors.release(entry.actor); }
    for (let slot = 0; slot < table.count; slot++) this.actor(table.atSlot(slot));
  }
  /** Bot registration indexes the same live actors and raw server records. */
  botEntities(): readonly RawEntityView[] { return [...this.#botEntities.values()]; }
  addressForActor(actor: ActorId): GuestAddress {
    if (this.options.semantics.project !== undefined) return this.options.semantics.foreignAddress(actor);
    const source = this.options.engine.actors.sourceOf(actor);
    if (source !== null && source.provider === this.module.memory.module.id) return this.module.entities().atSlot(source.slot).address;
    return this.foreignActors?.address(actor) ?? this.options.semantics.foreignAddress(actor);
  }
  preInit(): void { this.core.refreshCvars(); this.module.preInit(); }
  init(): void {
    if (this.#closed) throw new Error("Q2 guest host is closed");
    try { this.core.refreshCvars(); this.module.init(); this.#initialized = true; this.reconcile(); }
    catch (error) { this.shutdown(); throw error; }
  }
  async callLoading(name: GameExportName, arguments_: readonly GuestCallValue[], nextFrame: () => Promise<void>): Promise<GuestCallResult> {
    if (this.#closed) throw new Error("Q2 guest host is closed");
    this.core.refreshCvars();
    const result = await this.module.callGameLoading(name, arguments_, nextFrame);
    if (this.#initialized) this.reconcile();
    return result;
  }
  async initLoading(nextFrame: () => Promise<void>): Promise<void> {
    if (this.#initialized) throw new Error("API 2023 Init already completed");
    await this.callLoading("PreInit", [], nextFrame);
    await this.callLoading("Init", [], nextFrame); this.#initialized = true; this.reconcile();
  }
  async spawnEntitiesLoading(map: string, entities: string, spawnpoint: string, nextFrame: () => Promise<void>): Promise<void> {
    const strings = [map, entities, spawnpoint].map(text => ({ text, address: this.module.string(text) }));
    try { await this.callLoading("SpawnEntities", strings.map(value => guestPointer(value.address)), nextFrame); }
    finally { for (const value of strings) this.module.memory.unmap(value.address, nativeAllocationBytes(new TextEncoder().encode(value.text).length + 1)); }
  }
  async runFrameLoading(mainLoop: boolean, nextFrame: () => Promise<void>): Promise<void> {
    await this.callLoading("PrepFrame", [], nextFrame);
    this.foreignActors?.synchronize(); await this.callLoading("RunFrame", [guestBool(mainLoop)], nextFrame);
  }
  async readSaveLoading(kind: "game" | "level", saved: RereleaseSourceSave, nextFrame: () => Promise<void>, domain: "checkpoint" | "current" = "current"): Promise<void> {
    this.#pickups?.assertIdle();
    const bytes = saved.native;
    if (bytes.includes(0)) throw new Error("Q2 JSON save contains an embedded terminator");
    if (this.foreignActors === null && (saved.deferredDamage.length !== 0 || saved.projections.length !== 0)) throw new Error("Native save requires its foreign actor binding");
    const memory = this.module.memory, address = allocateNativeMemory(memory, bytes.length + 1, "Q2 source save input");
    let restoring = false;
    try {
      memory.write(address, bytes); this.foreignActors?.beginRestore(saved.projections, domain); restoring = true;
      await this.callLoading(kind === "game" ? "ReadGameJson" : "ReadLevelJson", [guestPointer(address)], nextFrame);
      this.foreignActors?.deferred.restore(saved.deferredDamage, domain);
    } finally { if (restoring) this.foreignActors?.endRestore(); memory.unmap(address, nativeAllocationBytes(bytes.length + 1)); }
  }
  shutdown(): void {
    if (this.#closed) return;
    this.#closed = true; this.#pickups?.close();
    try { try { this.foreignActors?.close(); } finally { if (this.#initialized) this.module.callGame("Shutdown"); } }
    finally { try { this.#releaseActors(); } finally { this.#unsubscribe(); } }
  }
  #releaseActors(): void {
    const registry = this.options.engine.actors;
    // Restore creates source placeholders before this host encounters their edicts.
    // Projected components borrow actors and must never retire their primary owner.
    const actors = this.options.semantics.project === undefined ? registry.ownedBy(this.module.memory.module.id)
      : [...this.#lifetimes.values()].map(entry => entry.actor);
    for (const actor of actors) if (registry.isLive(actor.id)) registry.release(actor);
    this.#lifetimes.clear();
  }
  spawnEntities(map: string, entities: string, spawnpoint = ""): void { this.core.refreshCvars(); this.module.spawnEntities(map, entities, spawnpoint); this.reconcile(); }
  prepFrame(): void { this.core.refreshCvars(); this.module.prepFrame(); this.reconcile(); }
  runFrame(mainLoop: boolean): void { this.core.refreshCvars(); this.foreignActors?.synchronize(); this.module.runFrame(mainLoop); this.reconcile(); }
  clientConnect(...arguments_: Parameters<RereleaseGuestModule["clientConnect"]>): ReturnType<RereleaseGuestModule["clientConnect"]> {
    this.core.refreshCvars(); const result = this.module.clientConnect(...arguments_); this.reconcile(); return result;
  }
  clientBegin(slot: number): void { this.core.refreshCvars(); this.module.clientBegin(slot); this.reconcile(); }
  clientThink(...arguments_: Parameters<RereleaseGuestModule["clientThink"]>): void { this.core.refreshCvars(); this.module.clientThink(...arguments_); this.reconcile(); }
  clientDisconnect(slot: number): void { this.module.clientDisconnect(slot); this.reconcile(); }
  /** Save serialization runs in the guest so expanded source fields remain intact. */
  writeSave(kind: "game" | "level", automaticOrTransition: boolean): RereleaseSourceSave {
    this.#pickups?.assertIdle();
    const memory = this.module.memory, size = memory.allocate({ byteLength: 8, alignment: 8n, label: "Q2 save size" });
    let output: GuestAddress | null = null;
    try {
      output = resultPointer(this.module.callGame(kind === "game" ? "WriteGameJson" : "WriteLevelJson", [guestBool(automaticOrTransition), guestPointer(size)]));
      if (output === null) throw new Error("Q2 source save returned null");
      const length = memory.readUint64(size);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Q2 source save length exceeds host copy range");
      return { native: memory.copy(output, Number(length)), deferredDamage: kind === "level" ? this.foreignActors?.deferred.save() ?? [] : [],
        projections: kind === "level" ? this.foreignActors?.saveProjections() ?? [] : [] };
    } finally { if (output !== null) this.core.free(output); memory.unmap(size, 8); }
  }
  async writeSaveLoading(kind: "game" | "level", automaticOrTransition: boolean, nextFrame: () => Promise<void>): Promise<RereleaseSourceSave> {
    this.#pickups?.assertIdle();
    if (this.#closed) throw new Error("Q2 guest host is closed");
    this.core.refreshCvars();
    const memory = this.module.memory, size = memory.allocate({ byteLength: 8, alignment: 8n, label: "Q2 save size" });
    let output: GuestAddress | null = null;
    try {
      output = resultPointer(await this.module.callGameLoading(kind === "game" ? "WriteGameJson" : "WriteLevelJson", [guestBool(automaticOrTransition), guestPointer(size)], nextFrame));
      if (output === null) throw new Error("Q2 source save returned null");
      const length = memory.readUint64(size);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Q2 source save length exceeds host copy range");
      return { native: memory.copy(output, Number(length)), deferredDamage: kind === "level" ? this.foreignActors?.deferred.save() ?? [] : [],
        projections: kind === "level" ? this.foreignActors?.saveProjections() ?? [] : [] };
    } finally { if (output !== null) this.core.free(output); memory.unmap(size, 8); }
  }
  readSave(kind: "game" | "level", saved: RereleaseSourceSave, domain: "checkpoint" | "current" = "current"): void {
    this.#pickups?.assertIdle();
    const bytes = saved.native;
    if (bytes.includes(0)) throw new Error("Q2 JSON save contains an embedded terminator");
    if (this.foreignActors === null && (saved.deferredDamage.length !== 0 || saved.projections.length !== 0)) throw new Error("Native save requires its foreign actor binding");
    const memory = this.module.memory, address = allocateNativeMemory(memory, bytes.length + 1, "Q2 source save input");
    let restoring = false;
    try {
      memory.write(address, bytes); this.foreignActors?.beginRestore(saved.projections, domain); restoring = true;
      this.core.refreshCvars(); this.module.callGame(kind === "game" ? "ReadGameJson" : "ReadLevelJson", [guestPointer(address)]); this.reconcile(); this.foreignActors?.deferred.restore(saved.deferredDamage, domain);
    } finally { if (restoring) this.foreignActors?.endRestore(); memory.unmap(address, nativeAllocationBytes(bytes.length + 1)); }
  }
  #import(call: RereleaseImportCall): GuestCallResult {
    return this.options.importBoundary === undefined ? this.#dispatchImport(call)
      : this.options.importBoundary(call.name, call.arguments, () => this.#dispatchImport(call));
  }
  #dispatchImport(call: RereleaseImportCall): GuestCallResult {
    const intercepted = this.options.interceptImport?.(call, this);
    if (intercepted !== undefined) return intercepted;
    if (this.options.debugDrawing === "headless" && call.api === "game") {
      switch (call.name) {
        case "Draw_Line": case "Draw_Point": case "Draw_Circle": case "Draw_Bounds": case "Draw_Sphere":
        case "Draw_Cylinder": case "Draw_Ray": case "Draw_Arrow": case "Draw_OrientedWorldText": case "Draw_StaticWorldText":
          return { kind: "void" };
      }
    }
    const shapes = this.#debugShapes?.invoke(call);
    if (shapes !== undefined) return shapes;
    const text = this.#worldText?.invoke(call);
    if (text !== undefined) return text;
    const sound = this.#sounds?.invoke(call);
    if (sound !== undefined) return sound;
    const message = this.#messages?.invoke(call);
    if (message !== undefined) return message;
    const args = call.arguments, memory = this.module.memory, engine = this.options.engine;
    switch (call.name) {
      case "Bot_RegisterEdict": case "Bot_UnRegisterEdict": {
        const view = this.module.entities().fromPointer(requiredPointer(args, 0));
        if (this.foreignActors?.lookup(view) !== undefined) return { kind: "void" };
        const actor = this.actor(view);
        if (call.name === "Bot_RegisterEdict") {
          if (actor === null) throw new Error("Q2 bot registration requires a live source edict");
          this.#botEntities.set(actor.id, view);
        } else if (actor !== null) this.#botEntities.delete(actor.id);
        return { kind: "void" };
      }
      case "FreeTags": {
        // g_local.h TAG_GAME/TAG_LEVEL: native level resets can zero spawn_count
        // and reuse the same allocation; retire borrowed actor lifetimes first.
        const tag = integer(args, 0);
        if (tag === 765n || tag === 766n) { this.foreignActors?.clear(); this.#releaseActors(); }
        return this.core.invoke(call);
      }
      case "BoxEdicts": {
        const min = this.#vector(requiredPointer(args, 0)), max = this.#vector(requiredPointer(args, 1));
        const list = pointer(args, 2), maximum = integer(args, 3), area = Number(integer(args, 4));
        const filter = pointer(args, 5), data = pointer(args, 6);
        if (area !== 1 && area !== 2) throw new RangeError("Q2 BoxEdicts requires AREA_SOLID or AREA_TRIGGERS");
        if (maximum < 0n || maximum > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Invalid Q2 BoxEdicts capacity");
        if (maximum > 0n && list === null) throw new Error("Q2 BoxEdicts output is null with nonzero capacity");
        const filterSignature = signature([{ kind: "scalar", storage: "pointer" }, { kind: "scalar", storage: "pointer" }], { kind: "scalar", storage: "int32" });
        let count = 0n;
        for (const candidate of this.options.spatial.boxEdicts(min, max, area)) {
          const address = this.addressForActor(candidate);
          let outcome = 0;
          if (filter !== null) {
            this.#filterDepth++;
            try {
              const result = this.module.invoke(filter, filterSignature, [guestPointer(address), guestPointer(data)]);
              if (result.kind !== "int32") throw new TypeError("Q2 BoxEdicts filter must return its source enum");
              outcome = result.value;
            } finally { this.#filterDepth--; }
          }
          if ((outcome & ~65) !== 0) throw new RangeError(`Invalid Q2 BoxEdicts filter result ${outcome}`);
          if ((outcome & 1) === 0) {
            if (maximum === 0n) count++;
            else if (count < maximum && list !== null) { memory.writePointer(memory.offset(list, count * 8n), address); count++; }
          }
          if ((outcome & 64) !== 0) break;
        }
        return { kind: "uint64", value: count };
      }
      case "pointcontents": return { kind: "uint32", value: engine.pointContents(this.#vector(requiredPointer(args, 0))) };
      case "inPVS": case "inPHS": return guestBool(this.options.spatial.visibility(call.name === "inPVS" ? "pvs" : "phs", this.#vector(requiredPointer(args, 0)), this.#vector(requiredPointer(args, 1)), integer(args, 2) !== 0n));
      case "AreasConnected": return guestBool(this.options.spatial.areasConnected(Number(integer(args, 0)), Number(integer(args, 1))));
      case "SetAreaPortalState": engine.setAreaPortal(Number(integer(args, 0)), integer(args, 1) !== 0n); return { kind: "void" };
      case "trace": {
        const min = pointer(args, 1), max = pointer(args, 2), pass = pointer(args, 4);
        if ((min === null) !== (max === null)) throw new Error("Q2 trace requires both bounds or neither");
        const ignore = pass === null ? null : this.actor(this.module.entities().fromPointer(pass))?.id ?? null;
        const trace = engine.trace({ start: this.#vector(requiredPointer(args, 0)), end: this.#vector(requiredPointer(args, 3)), bounds: min === null || max === null ? null : { min: this.#vector(min), max: this.#vector(max) }, ignore, mask: Number(integer(args, 5)) });
        return this.encodeTrace(trace);
      }
      case "linkentity": case "unlinkentity": {
        if (this.#filterDepth !== 0) throw new Error("Q2 BoxEdicts filter cannot modify world links");
        const view = this.module.entities().fromPointer(requiredPointer(args, 0));
        if (view.slot === 0) return { kind: "void" };
        if (this.foreignActors?.lookup(view) !== undefined) return { kind: "void" };
        const actor = this.actor(view);
        if (actor === null) { memory.writeUint8(this.#at(view, "linked"), 0); return { kind: "void" }; }
        if (call.name === "unlinkentity") { engine.bodies.unlink(actor); memory.writeUint8(this.#at(view, "linked"), 0); return { kind: "void" }; }
        const solid = memory.readUint8(this.#at(view, "solid"));
        if (solid > 3) throw new Error(`Unsupported source Q2 solid ${solid}`);
        engine.setSolid(actor, solid === 0 ? "none" : solid === 1 ? "trigger" : solid === 2 ? "box" : "brush", solid === 3 ? this.options.spatial.inlineModel(memory.readInt32(this.#at(view, "s.modelindex"))) : null);
        this.options.spatial.prepareLink?.(actor, view);
        engine.bodies.link(actor);
        const metadata = this.options.spatial.linkMetadata(actor, view);
        const linked = engine.bodies.linked(actor.id);
        if (linked === null) throw new Error("Shared body failed to retain source link");
        this.#writeVector(this.#at(view, "absmin"), linked.absoluteBounds.min);
        this.#writeVector(this.#at(view, "absmax"), linked.absoluteBounds.max);
        const min = this.#vector(this.#at(view, "mins")), max = this.#vector(this.#at(view, "maxs"));
        this.#writeVector(this.#at(view, "size"), { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z });
        memory.writeInt32(this.#at(view, "areanum"), metadata.area); memory.writeInt32(this.#at(view, "areanum2"), metadata.area2);
        memory.writeUint32(this.#at(view, "s.solid"), metadata.networkSolid);
        if (memory.readInt32(this.#at(view, "linkcount")) === 0 && (memory.readUint32(this.#at(view, "s.renderfx")) & 128) === 0) this.#writeVector(this.#at(view, "s.old_origin"), this.#vector(this.#at(view, "s.origin")));
        memory.writeInt32(this.#at(view, "linkcount"), memory.readInt32(this.#at(view, "linkcount")) + 1);
        memory.writeUint8(this.#at(view, "linked"), solid === 0 ? 0 : 1);
        return { kind: "void" };
      }
      case "setmodel": {
        if (this.#filterDepth !== 0) throw new Error("Q2 BoxEdicts filter cannot modify world links");
        const view = this.module.entities().fromPointer(requiredPointer(args, 0));
        const name = readGuestString(memory, requiredPointer(args, 1));
        memory.writeInt32(this.#at(view, "s.modelindex"), this.options.services.resourceIndex("model", name));
        if (name.startsWith("*")) {
          const model = Number(name.slice(1));
          if (!Number.isSafeInteger(model) || model < 0) throw new Error("Invalid source inline model name");
          const bounds = engine.inlineModelBounds(model);
          this.#writeVector(this.#at(view, "mins"), bounds.min); this.#writeVector(this.#at(view, "maxs"), bounds.max);
          this.#import({ ...call, name: "linkentity", arguments: [args[0] ?? { kind: "pointer", value: null }] });
        }
        return { kind: "void" };
      }
      default: return this.core.invoke(call);
    }
  }
  encodeTrace(trace: TraceResult, clippedEntity?: GuestAddress): GuestCallResult {
    if (trace.kind !== "q2") throw new Error("Rerelease trace requires Q2 source collision fields");
    const bytes = new Uint8Array(traceLayout.byteLength), view = new DataView(bytes.buffer);
    const vector = (offset: number, value: Vec3) => { view.setFloat32(offset, value.x, true); view.setFloat32(offset + 4, value.y, true); view.setFloat32(offset + 8, value.z, true); };
    const plane = (offset: number, value: BspPlane) => { vector(offset, value.normal); view.setFloat32(offset + 12, value.distance, true); view.setUint8(offset + 16, value.type); view.setUint8(offset + 17, value.signbits); };
    view.setUint8(0, trace.allSolid ? 1 : 0); view.setUint8(1, trace.startSolid ? 1 : 0); view.setFloat32(4, trace.fraction, true);
    vector(8, trace.end); plane(20, trace.sourcePlane);
    view.setBigUint64(40, this.#surface(trace.surface)?.byteOffset ?? 0n, true); view.setUint32(48, trace.contents, true);
    // SV_Trace retains the world edict even when the sweep reaches its endpoint.
    const hit = clippedEntity ?? (trace.hit.kind === "actor" ? this.addressForActor(trace.hit.actor) : this.module.entities().atSlot(0).address);
    view.setBigUint64(56, hit.byteOffset, true);
    if (trace.secondary !== null) { plane(64, trace.secondary.plane); view.setBigUint64(88, this.#surface(trace.secondary.surface)?.byteOffset ?? 0n, true); }
    return { kind: "aggregate", layout: traceLayout, bytes };
  }
  #surface(surface: Q2SurfaceInfo | null): GuestAddress | null {
    if (surface === null) return null;
    const previous = this.#surfaces.get(surface);
    if (previous !== undefined) return previous;
    const memory = this.module.memory, address = memory.allocate({ byteLength: surfaceLayout.byteLength, alignment: 4n, label: "Q2 trace surface" });
    memory.write(address, new TextEncoder().encode(surface.name).slice(0, 31));
    memory.writeUint32(memory.offset(address, 32n), surface.flags); memory.writeInt32(memory.offset(address, 36n), surface.value);
    memory.writeUint32(memory.offset(address, 40n), this.options.spatial.surfaceId(surface));
    memory.write(memory.offset(address, 44n), new TextEncoder().encode(surface.material).slice(0, 15));
    this.#surfaces.set(surface, address);
    return address;
  }
}
