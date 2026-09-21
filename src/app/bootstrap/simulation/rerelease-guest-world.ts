// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../contracts/identity.ts";
import type { ModuleIdentity } from "../../../contracts/execution.ts";
import type { EquipmentMovement } from "../../../contracts/movement.ts";
import type { Q2RereleaseEntityState, Q2RereleasePlayerState, Q2RereleaseUserCommand } from "../../../contracts/protocol.ts";
import type { WindowsCapabilities } from "../../../guest/runtime/windows/index.ts";
import type { RereleaseSourceSave } from "../../../compat/q2/rerelease/host.ts";
import { guestPointer } from "../../../compat/q2/rerelease/module.ts";
import { RereleaseGuestSource, type PreparedRereleaseGuest } from "./rerelease-guest-source.ts";
import { NativeInputBinding, type NativeInputServices } from "../../../compat/q2/native-input.ts";
import { RereleasePublicEdict } from "../../../compat/q2/rerelease/public-state.ts";
import { RereleaseGuestServices } from "./rerelease-guest-services.ts";
import type { RereleaseGuestServicesOptions, RereleaseGuestMapServices } from "./rerelease-guest-services-contract.ts";
import type { ClassicGuestMap, ClassicGuestClient } from "./classic-guest-world.ts";

export interface RereleaseGuestWorldOptions {
  readonly prepared: PreparedRereleaseGuest;
  readonly services: RereleaseGuestServicesOptions;
  readonly capabilities: WindowsCapabilities;
  readonly instructionBudget?: number;
}
export interface RereleaseGuestSave { readonly game: RereleaseSourceSave; readonly level: RereleaseSourceSave }
export interface RereleaseGuestRevisit { readonly level: RereleaseSourceSave; readonly restoreServerState: (world: RereleaseGuestWorld) => void }
interface CommandContext { value: { readonly arguments: readonly string[]; readonly args: string } | null }

export class RereleaseGuestWorld {
  readonly edition = "rerelease";
  #phase: "created" | "initialized" | "running" | "transferred" | "closed" = "created";
  #busy = false;
  private inputBinding: NativeInputBinding | null = null;
  private readonly inputRetirements = new Map<number, () => void>();
  bindInput(services: NativeInputServices): void {
    this.inputBinding?.close();
    this.inputBinding = new NativeInputBinding({ edition: "rerelease", host: this.source.host.module, retire: (slot, identity) => {
      this.source.host.retireInputClient(slot);
      this.inputRetirements.set(slot, () => services.retired(identity));
    } }, services);
  }
  private finishInputRetirements(): void {
    for (const [slot, complete] of this.inputRetirements) {
      const host = this.source.host, record = new RereleasePublicEdict(host.module.memory, host.module.entities().atSlot(slot));
      if (record.byte("inuse") !== 0) host.clientDisconnect(slot);
      host.releaseClientReservation(slot); host.finishInputRetirement(slot);
      this.#clients.delete(slot); this.inputRetirements.delete(slot); complete();
    }
  }
  private discardInputRetirements(): void {
    for (const [slot, complete] of this.inputRetirements) {
      this.#clients.delete(slot); this.inputRetirements.delete(slot); complete();
    }
  }
  #frame = 0;
  readonly #clients = new Map<number, ClassicGuestClient>();
  private constructor(private readonly retainedSource: RereleaseGuestSource, private readonly retainedServices: RereleaseGuestServices,
    private readonly commandContext: CommandContext) {}
  static create(options: RereleaseGuestWorldOptions): RereleaseGuestWorld {
    const context: CommandContext = { value: null };
    const services = new RereleaseGuestServices({ ...options.services, command: () => context.value ?? options.services.command() });
    const clock = options.capabilities;
    if (clock.nowMilliseconds === undefined || clock.performanceCounter === undefined || clock.performanceFrequency === undefined)
      throw new Error("Native rerelease game requires the host clock capabilities");
    const source = RereleaseGuestSource.create(options.prepared, { ...services.hostOptions,
      clock: { nowMilliseconds: clock.nowMilliseconds, performanceCounter: clock.performanceCounter, performanceFrequency: clock.performanceFrequency },
      ...(options.instructionBudget === undefined ? {} : { instructionBudget: options.instructionBudget }),
      services: memory => services.bindMemory(memory) });
    try { services.bindHost(source.host); return new RereleaseGuestWorld(source, services, context); }
    catch (error) { try { source.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native services binding and cleanup failed"); } throw error; }
  }
  private requireOwnership(): void { if (this.#phase === "transferred" || this.#phase === "closed") throw new Error("Native rerelease world is retired"); }
  get isRetired(): boolean { return this.#phase === "transferred" || this.#phase === "closed"; }
  get source(): RereleaseGuestSource { this.requireOwnership(); return this.retainedSource; }
  get services(): RereleaseGuestServices { this.requireOwnership(); return this.retainedServices; }
  get module(): ModuleIdentity { return this.source.memory.module; }
  get clients(): readonly ClassicGuestClient[] { this.requireOwnership(); return [...this.#clients.values()]; }
  private operation<T>(run: () => T): T {
    this.requireOwnership(); if (this.#busy) throw new Error("External native world operation is already active");
    this.#busy = true; try { const result = run(); this.finishInputRetirements(); return result; } finally { this.#busy = false; }
  }
  private async loading<T>(run: () => Promise<T>): Promise<T> {
    this.requireOwnership(); if (this.#busy) throw new Error("External native world operation is already active");
    this.#busy = true;
    try { const result = await run(); this.finishInputRetirements(); return result; } finally { this.#busy = false; }
  }
  private requireRunning(): void { this.requireOwnership(); if (this.#phase !== "running") throw new Error("Native world has not spawned"); }
  private client(slot: number, phase?: ClassicGuestClient["phase"]): ClassicGuestClient {
    const client = this.#clients.get(slot);
    if (client === undefined || phase !== undefined && client.phase !== phase) throw new Error(`Native client ${slot} is not ${phase ?? "connected"}`);
    return client;
  }
  private initialize(): void {
    if (this.#phase !== "created") throw new Error("Native Init requires a fresh world");
    this.source.host.preInit(); this.source.init(); this.#phase = "initialized";
  }
  init(): void { this.operation(() => this.initialize()); }
  initLoading(nextFrame: () => Promise<void>): Promise<void> {
    return this.loading(async () => {
      if (this.#phase !== "created") throw new Error("Native Init requires a fresh world");
      await this.source.initLoading(nextFrame); this.#phase = "initialized";
    });
  }
  private runFrame(mainLoop: boolean): void {
    this.services.beginFrame(++this.#frame); this.source.host.prepFrame(); this.source.host.runFrame(mainLoop); this.services.publishEntities();
  }
  private spawnMap(map: ClassicGuestMap): void {
    if (this.#phase !== "initialized") throw new Error("Native SpawnEntities requires an initialized candidate");
    this.#frame = 0; this.source.host.spawnEntities(map.map, map.entities, map.spawnPoint);
    this.runFrame(false); this.runFrame(false); this.services.completeSpawn(); this.#phase = "running";
  }
  spawn(map: string, entities: string, spawnPoint = ""): void { this.operation(() => this.spawnMap({ map, entities, spawnPoint })); }
  spawnLoading(map: string, entities: string, nextFrame: () => Promise<void>, spawnPoint = ""): Promise<void> {
    return this.loading(() => this.spawnMapLoading({ map, entities, spawnPoint }, nextFrame));
  }
  private async spawnMapLoading(map: ClassicGuestMap, nextFrame: () => Promise<void>): Promise<void> {
    if (this.#phase !== "initialized") throw new Error("Native SpawnEntities requires an initialized candidate");
    this.#frame = 0; await this.source.host.spawnEntitiesLoading(map.map, map.entities, map.spawnPoint, nextFrame);
    for (let frame = 0; frame < 2; frame++) {
      this.services.beginFrame(++this.#frame); await this.source.host.runFrameLoading(false, nextFrame); this.services.publishEntities();
    }
    this.services.completeSpawn(); this.#phase = "running";
  }
  private transfer(map: ClassicGuestMap, binding: RereleaseGuestMapServices, revisit?: RereleaseGuestRevisit): RereleaseGuestWorld {
    this.requireRunning(); this.services.validateMap(binding);
    if (revisit !== undefined && this.services.options.cvars.variableValue("deathmatch") !== 0) throw new Error("Native deathmatch does not restore hub levels");
    this.finishInputRetirements();
    const source = this.source, services = this.services, clients = this.clients;
    const next = new RereleaseGuestWorld(source, services, this.commandContext);
    this.inputBinding?.close(); this.inputBinding = null;
    next.#phase = "initialized"; this.#phase = "transferred"; this.#clients.clear();
    try {
      source.host.rebindWorld(() => services.rebindWorld({ ...binding, command: () => this.commandContext.value ?? binding.command() }));
      next.spawnMap(map);
      if (revisit !== undefined) { next.#phase = "initialized"; services.drainMessages(); revisit.restoreServerState(next); source.host.readSave("level", revisit.level); services.completeSpawn(); next.#phase = "running"; }
      for (const client of clients) { source.host.reserveClient(client.slot); next.#clients.set(client.slot, { ...client, phase: "connected" }); }
      return next;
    } catch (error) { try { next.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native map travel and cleanup failed"); } throw error; }
  }
  travel(map: ClassicGuestMap, binding: RereleaseGuestMapServices, revisit?: RereleaseGuestRevisit): RereleaseGuestWorld { return this.operation(() => this.transfer(map, binding, revisit)); }
  travelLoading(map: ClassicGuestMap, binding: RereleaseGuestMapServices, nextFrame: () => Promise<void>, revisit?: RereleaseGuestRevisit): Promise<RereleaseGuestWorld> {
    return this.loading(async () => {
      this.requireRunning(); this.services.validateMap(binding);
      if (revisit !== undefined && this.services.options.cvars.variableValue("deathmatch") !== 0) throw new Error("Native deathmatch does not restore hub levels");
      this.finishInputRetirements();
      const source = this.source, services = this.services, clients = this.clients;
      const next = new RereleaseGuestWorld(source, services, this.commandContext);
      this.inputBinding?.close(); this.inputBinding = null;
      next.#phase = "initialized"; this.#phase = "transferred"; this.#clients.clear();
      try {
        source.host.rebindWorld(() => services.rebindWorld({ ...binding, command: () => this.commandContext.value ?? binding.command() }));
        await next.spawnMapLoading(map, nextFrame);
        if (revisit !== undefined) { next.#phase = "initialized"; services.drainMessages(); revisit.restoreServerState(next); await source.host.readSaveLoading("level", revisit.level, nextFrame); services.completeSpawn(); next.#phase = "running"; }
        for (const client of clients) { source.host.reserveClient(client.slot); next.#clients.set(client.slot, { ...client, phase: "connected" }); }
        return next;
      } catch (error) { try { next.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native map travel and cleanup failed"); } throw error; }
    });
  }
  connect(slot: number, userinfo: string, socialId = "", isBot = false): { readonly allowed: boolean; readonly userinfo: string } {
    return this.operation(() => {
      this.requireRunning();
      if (!Number.isInteger(slot) || slot < 1 || slot > this.services.options.maxClients || this.#clients.has(slot)) throw new RangeError("Native client slot is unavailable");
      this.source.host.reserveClient(slot);
      try {
        const result = this.source.host.clientConnect(slot, userinfo, socialId, isBot);
        if (result.accepted) this.#clients.set(slot, { slot, phase: "connected", userinfo: result.userinfo });
        else this.source.host.releaseClientReservation(slot);
        return { allowed: result.accepted, userinfo: result.userinfo };
      } catch (error) { this.source.host.releaseClientReservation(slot); throw error; }
    });
  }
  begin(slot: number): void { this.operation(() => { this.requireRunning(); const client = this.client(slot, "connected"); this.source.host.clientBegin(slot); this.#clients.set(slot, { ...client, phase: "active" }); }); }
  admit(slot: number, userinfo: string, socialId = "", isBot = false): { readonly allowed: boolean; readonly userinfo: string } {
    const result = this.connect(slot, userinfo, socialId, isBot); if (result.allowed) this.begin(slot); return result;
  }
  disconnect(slot: number): void { this.operation(() => { this.requireRunning(); this.client(slot); this.source.host.clientDisconnect(slot); this.source.host.releaseClientReservation(slot); this.#clients.delete(slot); }); }
  userinfo(slot: number, value: string): void {
    this.operation(() => {
      this.requireRunning(); const client = this.client(slot), module = this.source.host.module, bytes = new TextEncoder().encode(value);
      if (bytes.length >= 2048 || value.includes("\0")) throw new RangeError("Rerelease userinfo exceeds its source string limits");
      const info = module.memory.allocate({ byteLength: 2048, label: "Q2 mutable userinfo" }), entity = module.entities().atSlot(slot);
      try {
        module.memory.write(info, bytes); this.source.host.core.refreshCvars();
        module.callGame("ClientUserinfoChanged", [guestPointer(entity.address), guestPointer(info)], entity); this.source.host.reconcile();
        const output = module.memory.copy(info, 2048), end = output.indexOf(0);
        if (end < 0) throw new Error("ClientUserinfoChanged returned unterminated userinfo");
        this.#clients.set(slot, { ...client, userinfo: new TextDecoder().decode(output.subarray(0, end)) });
      } finally { module.memory.unmap(info, 2048); }
    });
  }
  setUserinfoStorage(slot: number, value: string): void {
    this.requireRunning(); const client = this.client(slot);
    if (new TextEncoder().encode(value).length >= 2048 || value.includes("\0")) throw new RangeError("Rerelease userinfo exceeds its source string limits");
    this.#clients.set(slot, { ...client, userinfo: value });
  }
  command(slot: number, arguments_: readonly string[], args: string): void {
    this.operation(() => { this.requireRunning(); this.client(slot, "active"); const module = this.source.host.module, entity = module.entities().atSlot(slot);
      this.commandContext.value = { arguments: [...arguments_], args };
      try { this.source.host.core.refreshCvars(); module.callGame("ClientCommand", [guestPointer(entity.address)], entity); this.source.host.reconcile(); }
      finally { this.commandContext.value = null; }
    });
  }
  serverCommand(arguments_: readonly string[], args: string): void {
    this.operation(() => { this.requireRunning(); this.commandContext.value = { arguments: [...arguments_], args };
      try { this.source.host.core.refreshCvars(); this.source.host.module.callGame("ServerCommand", []); this.source.host.reconcile(); }
      finally { this.commandContext.value = null; }
    });
  }
  think(slot: number, command: Q2RereleaseUserCommand, movement?: EquipmentMovement): void { this.operation(() => { this.requireRunning(); this.client(slot, "active"); this.source.host.clientThink(slot, command, movement); }); }
  frame(milliseconds: number): void { this.operation(() => { this.requireRunning(); if (milliseconds !== this.services.options.frameMilliseconds) throw new RangeError("API 2023 frame differs from its import-table cadence"); this.runFrame(true); }); }
  actor(slot: number): ActorId | null { this.requireRunning(); return this.services.entityInfo(slot).actor; }
  entityInfo(slot: number): ReturnType<RereleaseGuestServices["entityInfo"]> { this.requireRunning(); return this.services.entityInfo(slot); }
  entityStates(): readonly Q2RereleaseEntityState[] {
    this.requireRunning(); const states: Q2RereleaseEntityState[] = [], count = this.source.host.module.entities().count;
    for (let slot = 1; slot < count; slot++) { const info = this.services.entityInfo(slot); if (info.active && (info.serverFlags & 1) === 0) states.push(this.services.entityState(slot)); }
    return states;
  }
  entityState(slot: number): Q2RereleaseEntityState { this.requireRunning(); return this.services.entityState(slot); }
  playerState(slot: number): Q2RereleasePlayerState { this.requireRunning(); return this.services.playerState(slot); }
  playerPing(slot: number): number { this.requireRunning(); return this.services.playerPing(slot); }
  setPlayerPing(slot: number, ping: number): void { this.operation(() => { this.requireRunning(); this.client(slot); this.services.setPlayerPing(slot, ping); }); }
  modelAppearance(slot: number): ReturnType<RereleaseGuestServices["modelAppearance"]> { this.requireRunning(); return this.services.modelAppearance(slot); }
  rawMessages(): ReturnType<RereleaseGuestServices["drainMessages"]> { return this.services.drainMessages(); }
  configstrings(): ReadonlyMap<number, string> { return this.services.configstrings(); }
  restoreConfigstrings(values: ReadonlyMap<number, string>): void { if (this.#phase !== "initialized") throw new Error("Native configstrings require the initialized candidate"); this.services.restoreConfigstrings(values); }
  writeSave(autosave = false): RereleaseGuestSave { return this.operation(() => { this.requireRunning(); return { game: this.source.host.writeSave("game", autosave), level: this.source.host.writeSave("level", false) }; }); }
  writeSaveLoading(autosave: boolean, nextFrame: () => Promise<void>): Promise<RereleaseGuestSave> {
    return this.loading(async () => {
      this.requireRunning();
      const game = await this.source.host.writeSaveLoading("game", autosave, nextFrame);
      const level = await this.source.host.writeSaveLoading("level", false, nextFrame);
      return { game, level };
    });
  }
  writeTravelLevel(): RereleaseSourceSave { return this.operation(() => { this.requireRunning(); return this.source.host.writeSave("level", true); }); }
  private restore(saved: RereleaseGuestSave, map: ClassicGuestMap, restoreServerState: () => void): void {
    if (this.#phase !== "initialized") throw new Error("Native import requires a fresh initialized candidate");
    this.source.host.readSave("game", saved.game, "checkpoint"); this.spawnMap(map); this.#phase = "initialized"; this.services.drainMessages();
    restoreServerState(); this.source.host.readSave("level", saved.level, "checkpoint"); this.services.completeSpawn(); this.#phase = "running";
  }
  readSave(saved: RereleaseGuestSave, map: ClassicGuestMap, restoreServerState: () => void): void { this.operation(() => this.restore(saved, map, restoreServerState)); }
  readSaveLoading(saved: RereleaseGuestSave, map: ClassicGuestMap, restoreServerState: () => void, nextFrame: () => Promise<void>): Promise<void> { return this.loading(async () => {
      if (this.#phase !== "initialized") throw new Error("Native import requires a fresh initialized candidate");
      await this.source.host.readSaveLoading("game", saved.game, nextFrame, "checkpoint");
      await this.spawnMapLoading(map, nextFrame); this.#phase = "initialized"; this.services.drainMessages(); restoreServerState();
      await this.source.host.readSaveLoading("level", saved.level, nextFrame, "checkpoint"); this.services.completeSpawn(); this.#phase = "running";
    }); }
  close(): void {
    if (this.isRetired) return;
    this.inputBinding?.close(); this.inputBinding = null;
    this.operation(() => {
      this.discardInputRetirements();
      try { this.retainedSource.close(); } finally { this.#phase = "closed"; this.#clients.clear(); }
    });
  }
  discard(): void { this.close(); }
}
