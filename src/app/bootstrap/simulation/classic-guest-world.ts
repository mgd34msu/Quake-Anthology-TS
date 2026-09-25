import { classicPrimaryWorldProfile } from "../../../compat/q2/classic/world-profile.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../contracts/identity.ts";
import type { ModuleIdentity } from "../../../contracts/execution.ts";
import type { EquipmentMovement } from "../../../contracts/movement.ts";
import type { Q2EntityState, Q2PlayerState, Q2UserCommand } from "../../../contracts/protocol.ts";
import type { WindowsCapabilities } from "../../../guest/runtime/windows/index.ts";
import { ClassicGuestSource, type PreparedClassicGuest } from "./classic-guest-source.ts";
import { NativeInputBinding, type NativeInputServices } from "../../../compat/q2/native-input.ts";
import { ClassicGuestServices, type ClassicGuestMessage, type ClassicGuestServicesOptions, type ClassicGuestMapServices } from "./classic-guest-services.ts";

export interface ClassicGuestMap { readonly map: string; readonly entities: string; readonly spawnPoint: string }
export interface ClassicGuestWorldOptions {
  readonly prepared: PreparedClassicGuest;
  readonly services: ClassicGuestServicesOptions;
  readonly capabilities: WindowsCapabilities;
  readonly instructionBudget?: number;
}
export interface ClassicGuestRevisit { readonly levelPath: string; readonly restoreServerState: (world: ClassicGuestWorld) => void }
export interface ClassicGuestClient { readonly slot: number; readonly phase: "connected" | "active"; readonly userinfo: string }
interface CommandContext { value: { readonly arguments: readonly string[]; readonly args: string } | null }

/** API 3 owns time, movement and private gameplay data. The facade only sequences its exported calls. */
export class ClassicGuestWorld {
  readonly edition = "classic";
  #phase: "created" | "initialized" | "running" | "transferred" | "closed" = "created";
  #busy = false;
  private inputBinding: NativeInputBinding | null = null;
  private readonly inputRetirements = new Map<number, () => void>();
  bindInput(services: NativeInputServices): void {
    this.inputBinding?.close();
    this.inputBinding = new NativeInputBinding({ edition: "classic", host: this.source.host, retire: (slot, identity) => {
      this.source.host.edicts.retireInputClient(slot);
      this.inputRetirements.set(slot, () => services.retired(identity));
    } }, services);
  }
  private finishInputRetirements(): void {
    for (const [slot, complete] of this.inputRetirements) {
      const host = this.source.host;
      if (host.edicts.at(slot).bytes.getInt32(88, true) !== 0) host.clientEvent("ClientDisconnect", slot);
      host.edicts.releaseClient(slot); host.edicts.finishInputRetirement(slot);
      this.#clients.delete(slot); this.inputRetirements.delete(slot); complete();
    }
  }
  private discardInputRetirements(): void {
    for (const [slot, complete] of this.inputRetirements) {
      this.#clients.delete(slot); this.inputRetirements.delete(slot); complete();
    }
  }
  readonly #clients = new Map<number, ClassicGuestClient>();
  private constructor(private readonly retainedSource: ClassicGuestSource, private readonly retainedServices: ClassicGuestServices, private readonly commandContext: CommandContext) {}
  private requireOwnership(): void { if (this.#phase === "transferred") throw new Error("Native world ownership was transferred"); }
  get isRetired(): boolean { return this.#phase === "transferred" || this.#phase === "closed"; }
  get source(): ClassicGuestSource { this.requireOwnership(); return this.retainedSource; }
  get services(): ClassicGuestServices { this.requireOwnership(); return this.retainedServices; }
  static create(options: ClassicGuestWorldOptions): ClassicGuestWorld {
    const commandContext: CommandContext = { value: null };
    let adapter: ClassicGuestServices | null = null;
    const getAdapter = (): ClassicGuestServices => { if (adapter === null) throw new Error("Native services were not constructed"); return adapter; };
    const source = ClassicGuestSource.create(options.prepared, { capabilities: options.capabilities,
      ...(options.instructionBudget === undefined ? {} : { instructionBudget: options.instructionBudget }),
      services: memory => {
        adapter = new ClassicGuestServices(memory, { ...options.services, primaryWorld: options.prepared.primary?.profile.world ?? classicPrimaryWorldProfile(options.prepared.execution.artifact.digest),
          ...(options.prepared.primary === undefined ? {} : { pickupProfile: options.prepared.primary.profile.pickups }), command: () => commandContext.value ?? options.services.command() });
        return adapter.services;
      } });
    try { const services = getAdapter(); services.bindHost(source.host, source.imageBase); return new ClassicGuestWorld(source, services, commandContext); }
    catch (error) { source.discard(); throw error; }
  }
  get module(): ModuleIdentity { return this.source.memory.module; }
  get clients(): readonly ClassicGuestClient[] { this.requireOwnership(); return [...this.#clients.values()]; }
  private operation<T>(run: () => T): T {
    this.requireOwnership();
    if (this.#phase === "closed") throw new Error("Native world is closed");
    if (this.#busy) throw new Error("External native world operation is already active");
    this.#busy = true;
    try { const result = run(); this.finishInputRetirements(); return result; } finally { this.#busy = false; }
  }
  private requireRunning(): void { if (this.#phase !== "running") throw new Error("Native world has not spawned"); }
  private requireClient(slot: number, phase?: ClassicGuestClient["phase"]): ClassicGuestClient {
    const client = this.#clients.get(slot);
    if (client === undefined || phase !== undefined && client.phase !== phase) throw new Error(`Native client ${slot} is not ${phase ?? "connected"}`);
    return client;
  }
  init(): void {
    this.operation(() => { if (this.#phase !== "created") throw new Error("Native Init requires a fresh world"); this.source.init(); this.#phase = "initialized"; });
  }
  async initLoading(nextFrame: () => Promise<void>): Promise<void> {
    await this.operationLoading(async () => {
      if (this.#phase !== "created") throw new Error("Native Init requires a fresh world");
      await this.source.initLoading(nextFrame); this.#phase = "initialized";
    });
  }
  spawn(map: string, entities: string, spawnPoint = ""): void {
    this.operation(() => {
      if (this.#phase !== "initialized") throw new Error("Native SpawnEntities requires an initialized candidate");
      this.source.host.spawnEntities(map, entities, spawnPoint);
      this.source.host.runFrame(); this.source.host.runFrame();
      this.services.completeSpawn(); this.#phase = "running";
    });
  }
  private async operationLoading<T>(run: () => Promise<T>): Promise<T> {
    this.requireOwnership();
    if (this.#phase === "closed") throw new Error("Native world is closed");
    if (this.#busy) throw new Error("External native world operation is already active");
    this.#busy = true;
    try { const result = await run(); this.finishInputRetirements(); return result; } finally { this.#busy = false; }
  }
  async spawnLoading(map: string, entities: string, nextFrame: () => Promise<void>, spawnPoint = ""): Promise<void> {
    this.requireOwnership();
    if (this.#phase !== "initialized" || this.#busy) throw new Error("Native loading requires an idle initialized world");
    this.#busy = true;
    try {
      await this.source.host.spawnEntitiesLoading(map, entities, spawnPoint, nextFrame);
      await this.source.host.callLoading("RunFrame", [], nextFrame); await this.source.host.callLoading("RunFrame", [], nextFrame);
      this.services.completeSpawn(); this.#phase = "running";
    } finally { this.#busy = false; }
  }
  writeTravelLevel(path: string): void {
    this.operation(() => { this.requireRunning(); this.source.host.writeTravelLevel(path, this.services.options.maxClients); });
  }
  writeTravelLevelLoading(path: string, nextFrame: () => Promise<void>): Promise<void> {
    return this.operationLoading(() => { this.requireRunning(); return this.source.host.writeTravelLevelLoading(path, this.services.options.maxClients, nextFrame); });
  }
  /** Irreversible ownership transfer after the caller has staged the destination map. */
  travel(map: ClassicGuestMap, binding: ClassicGuestMapServices, revisit?: ClassicGuestRevisit): ClassicGuestWorld {
    return this.operation(() => {
      this.requireRunning();
      const source = this.source, services = this.services;
      services.validateMap(binding);
      if (revisit !== undefined && services.options.cvars.variableValue("deathmatch") !== 0) throw new Error("Original API 3 deathmatch does not restore hub levels");
      this.finishInputRetirements();
      const clients = this.clients;
      const next = new ClassicGuestWorld(source, services, this.commandContext);
      this.inputBinding?.close(); this.inputBinding = null;
      next.#phase = "initialized"; this.#phase = "transferred"; this.#clients.clear();
      try {
        for (const actor of services.options.engine.actors.ownedBy(source.host.options.provider)) services.options.engine.actors.release(actor);
        services.rebindWorld({ ...binding, command: () => this.commandContext.value ?? binding.command() });
        source.host.rebindWorld();
        source.host.spawnEntities(map.map, map.entities, map.spawnPoint);
        source.host.runFrame(); source.host.runFrame();
        if (revisit !== undefined) {
          services.drainMessages(); revisit.restoreServerState(next); source.host.save("ReadLevel", revisit.levelPath);
          for (let frame = 0; frame < 100; frame++) source.host.runFrame();
        }
        for (const client of clients) { source.host.edicts.retainClient(client.slot); next.#clients.set(client.slot, { ...client, phase: "connected" }); }
        services.completeSpawn(); next.#phase = "running";
        return next;
      } catch (error) {
        try { next.close(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "Native map travel and retained module cleanup failed"); }
        finally { next.#phase = "closed"; next.#clients.clear(); }
        throw error;
      }
    });
  }
  async travelLoading(map: ClassicGuestMap, binding: ClassicGuestMapServices, nextFrame: () => Promise<void>, revisit?: ClassicGuestRevisit): Promise<ClassicGuestWorld> {
    return this.operationLoading(async () => {
      this.requireRunning();
      const source = this.source, services = this.services;
      services.validateMap(binding);
      if (revisit !== undefined && services.options.cvars.variableValue("deathmatch") !== 0) throw new Error("Original API 3 deathmatch does not restore hub levels");
      this.finishInputRetirements();
      const clients = this.clients;
      const next = new ClassicGuestWorld(source, services, this.commandContext);
      this.inputBinding?.close(); this.inputBinding = null;
      next.#phase = "initialized"; this.#phase = "transferred"; this.#clients.clear();
      try {
        for (const actor of services.options.engine.actors.ownedBy(source.host.options.provider)) services.options.engine.actors.release(actor);
        services.rebindWorld({ ...binding, command: () => this.commandContext.value ?? binding.command() });
        source.host.rebindWorld();
        await source.host.spawnEntitiesLoading(map.map, map.entities, map.spawnPoint, nextFrame);
        await source.host.callLoading("RunFrame", [], nextFrame); await source.host.callLoading("RunFrame", [], nextFrame);
        if (revisit !== undefined) {
          services.drainMessages(); revisit.restoreServerState(next); await source.host.saveLoading("ReadLevel", revisit.levelPath, nextFrame);
          for (let frame = 0; frame < 100; frame++) { await source.host.callLoading("RunFrame", [], nextFrame); await nextFrame(); }
        }
        for (const client of clients) { source.host.edicts.retainClient(client.slot); next.#clients.set(client.slot, { ...client, phase: "connected" }); }
        services.completeSpawn(); next.#phase = "running";
        return next;
      } catch (error) {
        try { next.close(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "Native map travel and retained module cleanup failed"); }
        finally { next.#phase = "closed"; next.#clients.clear(); }
        throw error;
      }
    });
  }
  connect(slot: number, userinfo: string): ReturnType<ClassicGuestSource["host"]["clientConnect"]> {
    return this.operation(() => {
      this.requireRunning();
      if (!Number.isInteger(slot) || slot < 1 || slot > this.services.options.maxClients || this.#clients.has(slot)) throw new RangeError("Native client slot is unavailable");
      const result = this.source.host.clientConnect(slot, userinfo);
      if (result.allowed) { this.source.host.edicts.retainClient(slot); this.#clients.set(slot, { slot, phase: "connected", userinfo: result.userinfo }); }
      return result;
    });
  }
  begin(slot: number): void {
    this.operation(() => { this.requireRunning(); const client = this.requireClient(slot, "connected"); this.source.host.clientEvent("ClientBegin", slot); this.#clients.set(slot, { ...client, phase: "active" }); });
  }
  admit(slot: number, userinfo: string): ReturnType<ClassicGuestSource["host"]["clientConnect"]> {
    const result = this.connect(slot, userinfo); if (result.allowed) this.begin(slot); return result;
  }
  disconnect(slot: number): void {
    this.operation(() => { this.requireRunning(); this.requireClient(slot); this.source.host.clientEvent("ClientDisconnect", slot); this.source.host.edicts.releaseClient(slot); this.#clients.delete(slot); });
  }
  userinfo(slot: number, value: string): void {
    this.operation(() => { this.requireRunning(); const client = this.requireClient(slot); const userinfo = this.source.host.clientUserinfoChanged(slot, value); this.#clients.set(slot, { ...client, userinfo }); });
  }
  setUserinfoStorage(slot: number, value: string): void {
    this.requireRunning(); const client = this.requireClient(slot);
    if (new TextEncoder().encode(value).length >= 512 || value.includes("\0")) throw new RangeError("Classic userinfo exceeds its source string limits");
    this.#clients.set(slot, { ...client, userinfo: value });
  }
  command(slot: number, arguments_: readonly string[], args: string): void {
    this.operation(() => {
      this.requireRunning(); this.requireClient(slot, "active");
      this.commandContext.value = { arguments: [...arguments_], args };
      try { this.source.host.clientEvent("ClientCommand", slot); } finally { this.commandContext.value = null; }
    });
  }
  serverCommand(arguments_: readonly string[], args: string): void {
    this.operation(() => {
      this.requireRunning();
      this.commandContext.value = { arguments: [...arguments_], args };
      try { this.source.host.call("ServerCommand"); } finally { this.commandContext.value = null; }
    });
  }
  think(slot: number, command: Q2UserCommand, movement?: EquipmentMovement): void {
    this.operation(() => { this.requireRunning(); this.requireClient(slot, "active"); this.services.withPlayerMovement(movement, () => this.source.host.clientThink(slot, classicGuestUserCommand(command))); });
  }
  frame(milliseconds: number): void {
    this.operation(() => {
      this.requireRunning(); if (milliseconds !== 100) throw new RangeError("API 3 RunFrame requires the source 100ms cadence");
      this.source.host.runFrame(); this.services.publishEntities();
    });
  }
  actor(slot: number): ActorId | null { this.requireRunning(); return this.source.host.edicts.at(slot).currentActor(); }
  entityInfo(slot: number): { readonly actor: ActorId | null; readonly active: boolean; readonly serverFlags: number; readonly areas: readonly [number, number]; readonly clusters: readonly number[] | null; readonly firstCluster: number; readonly headnode: number; readonly ownerSlot: number | null } {
    this.requireRunning();
    const record = this.source.host.edicts.at(slot), view = record.bytes, count = view.getInt32(104, true);
    if (count < -1 || count > 16) throw new RangeError("API 3 edict has an invalid visibility cluster count");
    const owner = this.source.memory.readPointer(this.source.memory.offset(record.address, 256n));
    return { actor: record.currentActor(), active: view.getInt32(88, true) !== 0, serverFlags: view.getInt32(184, true),
      areas: [view.getInt32(176, true), view.getInt32(180, true)], clusters: count === -1 ? null : Array.from({ length: count }, (_, index) => view.getInt32(108 + index * 4, true)),
      firstCluster: view.getInt32(108, true), headnode: view.getInt32(172, true), ownerSlot: owner === null ? null : this.source.host.edicts.fromPointer(owner).slot };
  }
  entityStates(): readonly Q2EntityState[] {
    this.requireRunning(); const states: Q2EntityState[] = [];
    for (let slot = 1; slot < this.source.host.edicts.descriptor().count; slot++) {
      const view = this.source.host.edicts.at(slot).bytes;
      if (view.getInt32(88, true) !== 0 && (view.getInt32(184, true) & 1) === 0) {
        if (view.getInt32(0, true) !== slot) view.setInt32(0, slot, true);
        states.push(this.services.entityState(slot));
      }
    }
    return states;
  }
  entityState(slot: number): Q2EntityState { this.requireRunning(); return this.services.entityState(slot); }
  playerPing(slot: number): number {
    this.requireRunning(); const client = this.source.host.edicts.clientPrefix(slot);
    if (client === null) throw new Error("Native slot has no public client prefix");
    return client.getInt32(184, true);
  }
  setPlayerPing(slot: number, ping: number): void { this.operation(() => { this.requireRunning(); this.requireClient(slot); this.source.host.edicts.setClientPing(slot, ping); }); }
  playerState(slot: number): Q2PlayerState { this.requireRunning(); return this.services.playerState(slot); }
  modelAppearance(slot: number): ReturnType<ClassicGuestServices["modelAppearance"]> { this.requireRunning(); return this.services.modelAppearance(slot); }
  rawMessages(): readonly ClassicGuestMessage[] { return this.services.drainMessages(); }
  configstrings(): ReadonlyMap<number, string> { return this.services.configstrings(); }
  /** Original .sv2 engine metadata is restored before the DLL reads its level file. */
  restoreConfigstrings(values: ReadonlyMap<number, string>): void {
    if (this.#phase !== "initialized") throw new Error("Native configstring restoration requires the initialized candidate");
    for (const index of this.services.configstrings().keys()) if (!values.has(index)) this.services.setConfigstring(index, "");
    for (const [index, value] of values) this.services.setConfigstring(index, value);
  }
  writeOriginal(gamePath: string, levelPath: string, autosave = false): void {
    this.operation(() => { this.requireRunning(); this.source.host.save("WriteGame", gamePath, autosave); this.source.host.save("WriteLevel", levelPath); });
  }
  /** Source save files restore gameplay, not CPU/CRT process state. Clients subsequently follow original admission. */
  restoreOriginal(gamePath: string, levelPath: string, map: ClassicGuestMap, restoreServerState: () => void): void {
    this.operation(() => {
      if (this.#phase !== "initialized") throw new Error("Original API 3 import requires a fresh initialized candidate");
      this.source.host.save("ReadGame", gamePath);
      this.source.host.spawnEntities(map.map, map.entities, map.spawnPoint);
      this.source.host.runFrame(); this.source.host.runFrame();
      this.services.drainMessages();
      restoreServerState(); this.source.host.save("ReadLevel", levelPath);
      this.services.completeSpawn(); this.#phase = "running";
    });
  }
  async restoreOriginalLoading(gamePath: string, levelPath: string, map: ClassicGuestMap, restoreServerState: () => void, nextFrame: () => Promise<void>): Promise<void> {
    await this.operationLoading(async () => {
      if (this.#phase !== "initialized") throw new Error("Original API 3 import requires a fresh initialized candidate");
      await this.source.host.saveLoading("ReadGame", gamePath, nextFrame);
      await this.source.host.spawnEntitiesLoading(map.map, map.entities, map.spawnPoint, nextFrame);
      await this.source.host.callLoading("RunFrame", [], nextFrame); await this.source.host.callLoading("RunFrame", [], nextFrame);
      this.services.drainMessages();
      restoreServerState(); await this.source.host.saveLoading("ReadLevel", levelPath, nextFrame);
      this.services.completeSpawn(); this.#phase = "running";
    });
  }
  close(): void {
    if (this.isRetired) return;
    this.inputBinding?.close(); this.inputBinding = null;
    this.operation(() => {
      this.discardInputRetirements();
      try { this.retainedSource.close(); } finally { this.#phase = "closed"; this.#clients.clear(); }
    });
  }
  discard(): void {
    if (this.isRetired) return;
    this.inputBinding?.close(); this.inputBinding = null;
    this.operation(() => {
      this.discardInputRetirements();
      try { this.retainedSource.discard(); } finally { this.#phase = "closed"; this.#clients.clear(); }
    });
  }
}

export function classicGuestUserCommand(command: Q2UserCommand): Uint8Array {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setUint8(0, command.milliseconds); view.setUint8(1, command.buttons);
  for (const [index, value] of command.angleShorts.entries()) view.setInt16(2 + index * 2, value, true);
  view.setInt16(8, command.forwardMove, true); view.setInt16(10, command.sideMove, true); view.setInt16(12, command.upMove, true);
  view.setUint8(14, command.impulse); view.setUint8(15, command.lightLevel); return bytes;
}
