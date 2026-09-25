// SPDX-License-Identifier: GPL-2.0-or-later
import { allocateNativeMemory, nativeAllocationBytes } from "../../../guest/runtime/common/memory.ts";
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestLayout, RawEntityTable, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { EquipmentMovement } from "../../../contracts/movement.ts";
import type { Q2RereleaseUserCommand } from "../../../contracts/protocol.ts";
import type { GuestCallRunner } from "../../../guest/abi/runner.ts";
import { requiredPointer } from "../../../guest/runtime/common/memory.ts";
import type { GuestCallSignature } from "../../../guest/core/contracts.ts";
import { cgameExports, cgameExportLayout, cgameImportLayout, cgameImports, gameExports, gameExportLayout, gameImportLayout, gameImports, getApiSignature, rereleaseAbi } from "./api.ts";
import type { CgameExportName, CgameImportName, GameExportName, GameImportName } from "./api.ts";
import { edictLayout, fieldOffset, pmoveLayout, rectangleLayout, usercmdLayout } from "./layouts.ts";
import { bindNativeModEntry, type NativeModEntryBinding } from "../native-mod-entries.ts";
import { prepareRereleaseEquipmentMovement, withRereleaseEquipmentMovement } from "./equipment-movement.ts";
import { writeRereleaseUserCommand } from "./player-state.ts";

export type RereleaseImportName = GameImportName | CgameImportName;
export interface RereleaseImportCall {
  readonly api: "game" | "cgame";
  readonly name: RereleaseImportName;
  readonly context: GuestCallContext;
  readonly arguments: readonly GuestCallValue[];
}
export interface RereleaseModuleOptions {
  readonly runner: GuestCallRunner;
  readonly getGameApi: GuestAddress;
  readonly getCgameApi: GuestAddress;
  readonly invokeImport: (call: RereleaseImportCall) => GuestCallResult;
  readonly actorAtSlot: (slot: number) => ActorId | null;
  readonly instructionBudget?: number;
  readonly loadingInstructionBudget?: number;
  readonly serializationInstructionBudget?: number;
  readonly frameMilliseconds?: number;
}
export class MissingRereleaseImport extends Error {
  constructor(readonly call: RereleaseImportCall) {
    super(`Missing Q2 rerelease ${call.api} import ${call.name} at 0x${call.context.callback.kind === "native-guest" ? call.context.callback.address.byteOffset.toString(16) : "unknown"}`);
    this.name = "MissingRereleaseImport";
  }
}
export const guestPointer = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
export const guestInt = (value: number): GuestCallValue => ({ kind: "int32", value });
export const guestBool = (value: boolean): GuestCallValue => ({ kind: "uint32", value: value ? 1 : 0 });
export function resultPointer(result: GuestCallResult): GuestAddress | null {
  if (result.kind !== "pointer") throw new TypeError("Guest pointer return required");
  return result.value;
}

/** One interpreter, memory and synchronous runner serve both API tables. */
export class RereleaseGuestModule {
  readonly memory;
  readonly gameImportAddress: GuestAddress;
  readonly cgameImportAddress: GuestAddress;
  #game: GuestAddress | null = null;
  #cgame: GuestAddress | null = null;
  #movement: { readonly address: GuestAddress; readonly binding: NativeModEntryBinding } | null = null;
  #inputMovement: { readonly boundary: (address: GuestAddress, run: () => undefined) => undefined; readonly active: () => boolean } | null = null;
  readonly #equipment: { readonly client: RawEntityView; readonly value: EquipmentMovement; applied: boolean }[] = [];
  constructor(readonly options: RereleaseModuleOptions) {
    this.memory = options.runner.options.cpu.memory;
    if (this.memory.pointerBytes !== 8) throw new TypeError("Rerelease Windows ABI requires 64-bit guest memory");
    this.gameImportAddress = this.#imports("game", gameImports, gameImportLayout);
    this.cgameImportAddress = this.#imports("cgame", cgameImports, cgameImportLayout);
  }
  #imports(api: "game" | "cgame", entries: readonly { readonly name: RereleaseImportName; readonly signature: GuestCallSignature }[], layout: GuestLayout): GuestAddress {
    const address = this.memory.allocate({ byteLength: layout.byteLength, alignment: 8n, label: `Q2 ${api} imports` });
    const milliseconds = this.options.frameMilliseconds ?? 25;
    if (!Number.isInteger(milliseconds) || milliseconds <= 0 || 1000 % milliseconds !== 0) throw new RangeError("Q2 source frame duration requires an integral tick rate");
    this.memory.writeUint32(address, 1000 / milliseconds);
    this.memory.writeFloat32(this.memory.offset(address, 4n), milliseconds / 1000);
    this.memory.writeUint32(this.memory.offset(address, 8n), milliseconds);
    for (const entry of entries) {
      const callback = this.options.runner.options.callbacks.bind({ id: `${this.memory.module.id}:q2-${api}-${entry.name}`, signature: entry.signature,
        invoke: (context, arguments_) => this.options.invokeImport({ api, name: entry.name, context, arguments: arguments_ }) });
      this.memory.writePointer(this.memory.offset(address, BigInt(fieldOffset(layout, entry.name))), callback);
    }
    return address;
  }
  invoke(target: GuestAddress, signature: GuestCallSignature, arguments_: readonly GuestCallValue[], self: RawEntityView | null = null, other: RawEntityView | null = null): GuestCallResult {
    return this.options.runner.invoke({ target, signature, arguments: arguments_, instructionBudget: this.options.instructionBudget ?? 2_000_000,
      context: { module: this.memory.module, callback: { kind: "native-guest", module: this.memory.module, address: target, abi: rereleaseAbi }, parent: this.options.runner.currentContext, self, other } });
  }
  bindGame(): GuestAddress {
    if (this.#game !== null) return this.#game;
    const address = resultPointer(this.invoke(this.options.getGameApi, getApiSignature, [guestPointer(this.gameImportAddress)]));
    if (address === null) throw new Error("GetGameAPI returned null");
    this.memory.check(address, gameExportLayout.byteLength, "read");
    if (this.memory.readInt32(address) !== 2023) throw new Error("Q2 rerelease game API must be 2023");
    this.#game = address;
    return address;
  }
  bindCgame(): GuestAddress {
    if (this.#cgame !== null) return this.#cgame;
    const address = resultPointer(this.invoke(this.options.getCgameApi, getApiSignature, [guestPointer(this.cgameImportAddress)]));
    if (address === null) throw new Error("GetCGameAPI returned null");
    this.memory.check(address, cgameExportLayout.byteLength, "read");
    if (this.memory.readInt32(address) !== 2022) throw new Error("Q2 rerelease cgame API must be 2022");
    this.#cgame = address;
    return address;
  }
  callGame(name: GameExportName, arguments_: readonly GuestCallValue[] = [], self: RawEntityView | null = null, other: RawEntityView | null = null): GuestCallResult {
    const entry = gameExports.find(value => value.name === name);
    if (entry === undefined) throw new Error(`Unknown game export ${name}`);
    return this.invoke(this.#function(this.bindGame(), gameExportLayout, name), entry.signature, arguments_, self, other);
  }
  private invokeLoading(target: GuestAddress, signature: GuestCallSignature, arguments_: readonly GuestCallValue[], nextFrame: () => Promise<void>, instructionBudget = this.options.loadingInstructionBudget ?? this.options.instructionBudget ?? 50_000_000): Promise<GuestCallResult> {
    return this.options.runner.invokeLoading({ target, signature, arguments: arguments_, instructionBudget,
      context: { module: this.memory.module, callback: { kind: "native-guest", module: this.memory.module, address: target, abi: rereleaseAbi }, parent: null, self: null, other: null } }, nextFrame);
  }
  async callGameLoading(name: GameExportName, arguments_: readonly GuestCallValue[], nextFrame: () => Promise<void>): Promise<GuestCallResult> {
    if (this.#game === null) {
      const address = resultPointer(await this.invokeLoading(this.options.getGameApi, getApiSignature, [guestPointer(this.gameImportAddress)], nextFrame));
      if (address === null) throw new Error("GetGameAPI returned null");
      this.memory.check(address, gameExportLayout.byteLength, "read");
      if (this.memory.readInt32(address) !== 2023) throw new Error("Q2 rerelease game API must be 2023");
      this.#game = address;
    }
    const entry = gameExports.find(value => value.name === name);
    if (entry === undefined) throw new Error(`Unknown game export ${name}`);
    const serializationBudget = name === "WriteGameJson" || name === "WriteLevelJson" || name === "ReadGameJson" || name === "ReadLevelJson"
      ? this.options.serializationInstructionBudget ?? 100_000_000 : undefined;
    return await this.invokeLoading(this.#function(this.#game, gameExportLayout, name), entry.signature, arguments_, nextFrame, serializationBudget);
  }
  callCgame(name: CgameExportName, arguments_: readonly GuestCallValue[] = []): GuestCallResult {
    const entry = cgameExports.find(value => value.name === name);
    if (entry === undefined) throw new Error(`Unknown cgame export ${name}`);
    return this.invoke(this.#function(this.bindCgame(), cgameExportLayout, name), entry.signature, arguments_);
  }
  #function(table: GuestAddress, layout: GuestLayout, name: string): GuestAddress {
    const address = this.memory.readPointer(this.memory.offset(table, BigInt(fieldOffset(layout, name))));
    if (address === null) throw new Error(`Q2 rerelease export ${name} is null`);
    this.memory.check(address, 1, "execute");
    return address;
  }
  preInit(): void { this.callGame("PreInit"); }
  init(): void { this.callGame("Init"); }
  prepFrame(): void { this.callGame("PrepFrame"); }
  runFrame(mainLoop: boolean): void { this.callGame("RunFrame", [guestBool(mainLoop)]); }
  clientConnect(slot: number, userinfo: string, socialId: string, isBot: boolean): { readonly accepted: boolean; readonly userinfo: string } {
    const infoBytes = new TextEncoder().encode(userinfo), socialBytes = new TextEncoder().encode(socialId);
    if (infoBytes.length >= 2048 || socialBytes.length >= 256 || userinfo.includes("\0") || socialId.includes("\0")) throw new RangeError("Rerelease client identity exceeds its source string limits");
    const info = this.memory.allocate({ byteLength: 2048, label: "Q2 mutable client userinfo" });
    const social = this.string(socialId), client = this.entities().atSlot(slot);
    this.memory.write(info, infoBytes);
    try {
      const result = this.callGame("ClientConnect", [guestPointer(client.address), guestPointer(info), guestPointer(social), guestBool(isBot)], client);
      if (result.kind !== "uint32") throw new TypeError("ClientConnect did not return its native boolean");
      const output = this.memory.copy(info, 2048), end = output.indexOf(0);
      if (end < 0) throw new Error("ClientConnect returned unterminated userinfo");
      return { accepted: result.value !== 0, userinfo: new TextDecoder().decode(output.subarray(0, end)) };
    } finally { this.memory.unmap(info, 2048); this.memory.unmap(social, nativeAllocationBytes(socialBytes.length + 1)); }
  }
  clientBegin(slot: number): void { const client = this.entities().atSlot(slot); this.callGame("ClientBegin", [guestPointer(client.address)], client); }
  bindInputMovement(boundary: (address: GuestAddress, run: () => undefined) => undefined, active: () => boolean): () => undefined {
    if (this.#inputMovement !== null) throw new Error("Native Pmove already has an input owner");
    const owner = { boundary, active }; this.#inputMovement = owner;
    try { this.#bindMovement(); } catch (error) { this.#inputMovement = null; throw error; }
    return () => { if (this.#inputMovement === owner) this.#inputMovement = null; this.#releaseMovement(); return undefined; };
  }
  #releaseMovement(): void {
    if (this.#inputMovement !== null || this.#equipment.length !== 0) return;
    this.#movement?.binding.close(); this.#movement = null;
  }
  #bindMovement(): void {
    const entry = gameExports.find(value => value.name === "Pmove");
    if (entry === undefined) throw new Error("API2023 has no Pmove signature");
    const address = this.#function(this.bindGame(), gameExportLayout, "Pmove");
    if (this.#movement?.address.byteOffset === address.byteOffset) return;
    this.#movement?.binding.close(); this.#movement = null;
    const binding = bindNativeModEntry({ memory: this.memory, entries: this.options.runner.options, invoke: this.invoke.bind(this) },
      address, `${this.memory.module.id}:Pmove`, entry.signature, (values, original) => {
        const movement = requiredPointer(values, 0), scope = this.#equipment.at(-1);
        const player = this.memory.readPointer(this.memory.offset(movement, BigInt(fieldOffset(pmoveLayout, "player"))));
        const equipment = scope !== undefined && player?.byteOffset === scope.client.address.byteOffset ? scope : null;
        if (equipment !== null && !equipment.applied) {
          prepareRereleaseEquipmentMovement(this, movement, equipment.value); equipment.applied = true;
        }
        const run = (): undefined => {
          const execute = (): undefined => { const result = original(values); if (result.kind !== "void") throw new Error("Pmove returned a non-void result"); return undefined; };
          return withRereleaseEquipmentMovement(this, movement, equipment?.value, execute);
        };
        this.#inputMovement?.active() === true ? this.#inputMovement.boundary(movement, run) : run();
        return { kind: "void" };
      }, () => this.#inputMovement?.active() === true || this.#equipment.length !== 0);
    this.#movement = { address, binding };
  }
  clientThink(slot: number, command: Q2RereleaseUserCommand, equipment?: EquipmentMovement): void {
    const client = this.entities().atSlot(slot), address = this.memory.allocate({ byteLength: usercmdLayout.byteLength, alignment: 4n, label: "Q2 client command" });
    if (equipment !== undefined) this.#equipment.push({ client, value: equipment, applied: false });
    try {
      if (equipment !== undefined || this.#inputMovement !== null) this.#bindMovement();
      writeRereleaseUserCommand(this.memory.borrow(address, usercmdLayout.byteLength), command); this.callGame("ClientThink", [guestPointer(client.address), guestPointer(address)], client);
    } finally {
      if (equipment !== undefined) this.#equipment.pop();
      this.#releaseMovement(); this.memory.unmap(address, usercmdLayout.byteLength);
    }
  }
  clientDisconnect(slot: number): void { const client = this.entities().atSlot(slot); this.callGame("ClientDisconnect", [guestPointer(client.address)], client); }
  spawnEntities(map: string, entities: string, spawnpoint: string): void {
    const strings = [map, entities, spawnpoint].map(value => this.string(value));
    try { this.callGame("SpawnEntities", strings.map(guestPointer)); }
    finally { for (let index = 0; index < strings.length; index++) { const address = strings[index], text = [map, entities, spawnpoint][index]; if (address !== undefined && text !== undefined) this.memory.unmap(address, nativeAllocationBytes(new TextEncoder().encode(text).length + 1)); } }
  }
  string(text: string): GuestAddress {
    const bytes = new TextEncoder().encode(text);
    const address = allocateNativeMemory(this.memory, bytes.length + 1, "Q2 API string");
    this.memory.write(address, bytes);
    return address;
  }
  /** Export fields stay live: Init, spawn, load and frames can change this table. */
  entities(): RawEntityTable {
    const table = this.bindGame();
    const at = (name: string) => this.memory.offset(table, BigInt(fieldOffset(gameExportLayout, name)));
    const base = this.memory.readPointer(at("edicts"));
    const stride = this.memory.readUint64(at("edict_size"));
    const count = this.memory.readUint32(at("num_edicts")), capacity = this.memory.readUint32(at("max_edicts"));
    if (base === null) throw new Error("Q2 game edicts are not initialized");
    if (stride < BigInt(edictLayout.byteLength) || stride > BigInt(Number.MAX_SAFE_INTEGER) || count > capacity) throw new Error("Invalid Q2 rerelease edict table");
    const strideBytes = Number(stride), memory = this.memory;
    const atSlot = (slot: number): RawEntityView => {
      if (!Number.isSafeInteger(slot) || slot < 0 || slot >= capacity) throw new RangeError("Q2 edict slot is outside source capacity");
      const address = memory.offset(base, BigInt(slot) * stride);
      return { module: memory.module, slot, address, strideBytes, publicLayout: edictLayout, bytes: memory.borrow(address, strideBytes), currentActor: () => this.options.actorAtSlot(slot) };
    };
    return { module: memory.module, base, strideBytes, count, capacity, layout: edictLayout, atSlot,
      fromPointer: address => { memory.check(address, edictLayout.byteLength, "read"); const delta = address.byteOffset - base.byteOffset; if (delta < 0n || delta % stride !== 0n || delta / stride >= BigInt(capacity)) throw new RangeError("Pointer does not identify a Q2 edict"); return atSlot(Number(delta / stride)); } };
  }
  /** Split index and server player number are independent ABI arguments. */
  drawHud(split: number, serverData: GuestAddress, viewport: readonly [number, number, number, number], safeArea: readonly [number, number, number, number], scale: number, playerNumber: number, playerState: GuestAddress): void {
    const rect = (values: readonly number[]): GuestCallValue => { const bytes = new Uint8Array(16), view = new DataView(bytes.buffer); values.forEach((value, index) => view.setInt32(index * 4, value, true)); return { kind: "aggregate", layout: rectangleLayout, bytes }; };
    this.callCgame("DrawHUD", [guestInt(split), guestPointer(serverData), rect(viewport), rect(safeArea), guestInt(scale), guestInt(playerNumber), guestPointer(playerState)]);
  }
}
