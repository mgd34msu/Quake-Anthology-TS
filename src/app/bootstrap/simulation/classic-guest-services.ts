// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import type { Q2EntityState, Q2PlayerState } from "../../../contracts/protocol.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { classicNumber, classicPointer, classicRequiredPointer, type ClassicQ2EngineServices, type ClassicQ2GuestHost, type ClassicQ2WorldLink } from "../../../compat/q2/classic/host.ts";
import { readClassicString, readClassicVector } from "../../../compat/q2/classic/records.ts";
import { runClassicGuestPmove } from "../../../compat/q2/classic/pmove.ts";
import { SizeBuf, SZ_Init, SZ_Clear, MSG_WriteChar, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteFloat, MSG_WriteString, MSG_WritePos, MSG_WriteDir, MSG_WriteAngle } from "../../../network/q2/message.ts";
import type { ActorCollision, SharedSceneQueries } from "../../../world/collision/index.ts";

export type ClassicGuestAudience = { readonly kind: "unicast"; readonly slot: number } | { readonly kind: "multicast"; readonly origin: Vec3; readonly scope: "all" | "phs" | "pvs" };
export interface ClassicGuestMessage { readonly audience: ClassicGuestAudience; readonly reliable: boolean; readonly bytes: Uint8Array }
export interface ClassicGuestServicesOptions {
  readonly engine: ClassicQ2EngineServices["engine"] & Pick<Q2FoundationHost, "emit">;
  readonly scene: SharedSceneQueries;
  readonly cvars: CvarRegistry;
  readonly numeric: NumericOperations;
  readonly mapPath: string;
  readonly maxClients: number;
  readonly admit: (record: RawEntityView, actor: OwnedActor) => undefined;
  readonly collision: (actor: OwnedActor, collision: ActorCollision) => undefined;
  readonly print: (text: string) => void;
  readonly command: ClassicQ2EngineServices["command"];
  readonly addCommand: ClassicQ2EngineServices["addCommand"];
  readonly debugGraph: ClassicQ2EngineServices["debugGraph"];
}
export type ClassicGuestMapServices = Pick<ClassicGuestServicesOptions, "engine" | "scene" | "mapPath" | "admit" | "collision" | "print" | "command" | "addCommand" | "debugGraph">;
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function vector(view: DataView, offset: number): Vec3 { return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) }; }
function storeVector(view: DataView, offset: number, value: Vec3): void { view.setFloat32(offset, value.x, true); view.setFloat32(offset + 4, value.y, true); view.setFloat32(offset + 8, value.z, true); }
function tuple(value: Vec3): Float32Array { return new Float32Array([value.x, value.y, value.z]); }

/** API 3 uses the shared actor/collision tables and retains the DLL's public-prefix authority. */
export class ClassicGuestServices {
  readonly services: ClassicQ2EngineServices;
  readonly #configstrings = new Map<number, string>();
  readonly #messages: ClassicGuestMessage[] = [];
  readonly #buffer = new SizeBuf();
  #host: ClassicQ2GuestHost | null = null;
  #loading = true;
  #options: ClassicGuestServicesOptions;
  get options(): ClassicGuestServicesOptions { return this.#options; }
  constructor(readonly memory: MappedGuestMemory, options: ClassicGuestServicesOptions) {
    this.#options = options;
    if (!Number.isInteger(options.maxClients) || options.maxClients < 1 || options.maxClients > 256) throw new RangeError("Invalid API 3 maxclients");
    if (options.scene.geometry.models.length > 255) throw new RangeError("API 3 map exceeds MAX_MODELS");
    options.cvars.set("maxclients", String(options.maxClients), true);
    SZ_Init(this.#buffer, new Uint8Array(1400), 1400);
    this.#configstrings.set(33, options.mapPath);
    for (let model = 1; model < options.scene.geometry.models.length; model++) this.#configstrings.set(33 + model, `*${model}`);
    const owner = this;
    this.services = {
      get engine() { return owner.options.engine; }, cvars: options.cvars,
      bindEntity: (record, actor) => this.bindEntity(record, actor),
      linkBody: (record, actor) => this.linkBody(record, actor),
      print: (destination, entity, level, text) => this.print(destination, entity, level, text),
      configstring: (index, value) => this.setConfigstring(index, value),
      resourceIndex: (kind, name) => this.resourceIndex(kind, name),
      sound: (origin, entity, channel, index, volume, attenuation, offset) => this.sound(origin, entity, channel, index, volume, attenuation, offset),
      areasConnected: (first, second) => this.options.scene.areasConnected(first, second),
      worldLink: bounds => this.worldLink(bounds),
      boxEdicts: (bounds, kind) => this.options.scene.queryActors(bounds, kind).map(item => item.body.actor),
      message: (operation, values) => this.message(operation, values),
      command: () => this.options.command(), addCommand: text => this.options.addCommand(text), debugGraph: (value, color) => this.options.debugGraph(value, color),
      pmove: (address, host) => runClassicGuestPmove(address, host, { numeric: options.numeric, airAccelerate: options.cvars.variableValue("sv_airaccelerate") }),
    };
  }
  validateMap(binding: ClassicGuestMapServices): void {
    if (binding.scene.geometry.models.length > 255) throw new RangeError("API 3 map exceeds MAX_MODELS");
  }
  rebindWorld(binding: ClassicGuestMapServices): void {
    this.validateMap(binding);
    const { engine, scene, mapPath, admit, collision, print, command, addCommand, debugGraph } = binding;
    this.#options = { ...this.#options, engine, scene, mapPath, admit, collision, print, command, addCommand, debugGraph };
    this.#loading = true; this.#configstrings.clear(); this.#messages.length = 0; SZ_Clear(this.#buffer);
    this.#configstrings.set(33, binding.mapPath);
    for (let model = 1; model < binding.scene.geometry.models.length; model++) this.#configstrings.set(33 + model, `*${model}`);
  }
  bindHost(host: ClassicQ2GuestHost): void {
    if (this.#host !== null || host.memory !== this.memory) throw new Error("API 3 services already bound or guest memory mismatch");
    this.#host = host;
  }
  get host(): ClassicQ2GuestHost { if (this.#host === null) throw new Error("API 3 services have no guest host"); return this.#host; }
  completeSpawn(): void { this.#loading = false; }
  configstrings(): ReadonlyMap<number, string> { return new Map(this.#configstrings); }
  drainMessages(): readonly ClassicGuestMessage[] { return this.#messages.splice(0); }
  resource(kind: "model" | "sound" | "image", index: number): string { return this.#configstrings.get((kind === "model" ? 32 : kind === "sound" ? 288 : 544) + index) ?? ""; }
  resourceIndex(kind: "model" | "sound" | "image", name: string): number {
    if (name === "") return 0;
    for (let index = 1; index < 256; index++) {
      const current = this.resource(kind, index);
      if (current === name) return index;
      if (current === "") { this.setConfigstring((kind === "model" ? 32 : kind === "sound" ? 288 : 544) + index, name); return index; }
    }
    throw new Error(`API 3 ${kind} index overflow`);
  }
  setConfigstring(index: number, value: string): undefined {
    if (!Number.isInteger(index) || index < 0 || index >= 2080) throw new RangeError("API 3 configstring index outside MAX_CONFIGSTRINGS");
    const text = value;
    this.#configstrings.set(index, text);
    if (index > 32 && index < 288) this.#host?.setModelName(index - 32, text);
    if (index >= 800 && index < 1056) this.options.engine.emit({ kind: "lightstyle", style: index - 800, pattern: text });
    if (index === 1) this.options.engine.emit({ kind: "music", track: text });
    if (!this.#loading) { SZ_Clear(this.#buffer); MSG_WriteByte(this.#buffer, 13); MSG_WriteShort(this.#buffer, index); MSG_WriteString(this.#buffer, text); this.multicast(zero, 3); }
    return undefined;
  }
  private body(record: RawEntityView): BodyState {
    const view = record.bytes;
    return { origin: vector(view, 4), angles: vector(view, 16), velocity: zero, bounds: { min: vector(view, 188), max: vector(view, 200) }, ground: null };
  }
  private bindEntity(record: RawEntityView, actor: OwnedActor): undefined {
    this.options.engine.bodies.bind(actor, { read: () => this.body(record), write: state => {
      storeVector(record.bytes, 4, state.origin); storeVector(record.bytes, 16, state.angles);
      storeVector(record.bytes, 188, state.bounds.min); storeVector(record.bytes, 200, state.bounds.max); return undefined;
    } });
    return this.options.admit(record, actor);
  }
  private linkBody(record: RawEntityView, actor: OwnedActor): undefined {
    const view = record.bytes, solid = view.getInt32(248, true), flags = view.getInt32(184, true);
    const ownerAddress = this.memory.readPointer(this.memory.offset(record.address, 256n));
    const owner = ownerAddress === null ? null : this.host.edicts.observe(ownerAddress)?.id ?? null;
    const modelName = this.resource("model", view.getInt32(40, true));
    const deadMonster = (flags & 2) !== 0, monster = (flags & 4) !== 0;
    this.options.collision(actor, { family: "q2", shape: solid === 3 ? { kind: "model", model: Number(modelName.slice(1)) } : { kind: "box" },
      contents: solid === 3 ? 1 : deadMonster ? 0x4000000 : 0x2000000, owner, role: solid === 1 ? "trigger" : "solid", monster, deadMonster });
    return this.options.engine.bodies.restoreLinkState(actor, { linkCount: view.getInt32(92, true), linked: { state: this.body(record), absoluteBounds: { min: vector(view, 212), max: vector(view, 224) } } });
  }
  worldLink(bounds: Bounds): ClassicQ2WorldLink {
    const query = this.options.scene.boxLeaves(bounds, 128), clusters: number[] = [];
    let first = 0, second = 0;
    for (const leaf of query.leaves) {
      const area = this.options.scene.leafArea(leaf), cluster = this.options.scene.leafCluster(leaf);
      if (area !== 0) { if (first !== 0 && first !== area) second = area; else first = area; }
      if (cluster >= 0 && !clusters.includes(cluster)) clusters.push(cluster);
    }
    return { clusters: query.overflow || query.leaves.length >= 128 || clusters.length > 16 ? null : clusters, headnode: query.topnode ?? 0, areas: [first, second] };
  }
  private enqueue(audience: ClassicGuestAudience, reliable: boolean): void {
    this.#messages.push({ audience, reliable, bytes: this.#buffer.data.slice(0, this.#buffer.cursize) }); SZ_Clear(this.#buffer);
  }
  private multicast(origin: Vec3, destination: number): void {
    if (!Number.isInteger(destination) || destination < 0 || destination > 5) throw new RangeError("API 3 invalid multicast destination");
    this.enqueue({ kind: "multicast", origin: { ...origin }, scope: destination % 3 === 0 ? "all" : destination % 3 === 1 ? "phs" : "pvs" }, destination >= 3);
  }
  private unicast(entity: GuestAddress | null, reliable: boolean): void {
    if (entity === null) return;
    const record = this.host.edicts.fromPointer(entity);
    if (record.slot < 1 || record.slot > this.options.maxClients) return;
    this.enqueue({ kind: "unicast", slot: record.slot }, reliable);
  }
  private message(operation: string, values: readonly GuestCallValue[]): undefined {
    const number = () => classicNumber(values, 0), pointer = () => classicRequiredPointer(values, 0);
    switch (operation) {
      case "WriteChar": MSG_WriteChar(this.#buffer, number()); break;
      case "WriteByte": MSG_WriteByte(this.#buffer, number()); break;
      case "WriteShort": MSG_WriteShort(this.#buffer, number()); break;
      case "WriteLong": MSG_WriteLong(this.#buffer, number()); break;
      case "WriteFloat": MSG_WriteFloat(this.#buffer, number()); break;
      case "WriteString": { const address = classicPointer(values, 0); MSG_WriteString(this.#buffer, address === null ? "" : readClassicString(this.memory, address)); break; }
      case "WritePosition": MSG_WritePos(this.#buffer, tuple(readClassicVector(this.memory, pointer()))); break;
      case "WriteDir": { const address = classicPointer(values, 0); if (address === null) MSG_WriteByte(this.#buffer, 0); else MSG_WriteDir(this.#buffer, tuple(readClassicVector(this.memory, address))); break; }
      case "WriteAngle": MSG_WriteAngle(this.#buffer, number()); break;
      case "multicast": this.multicast(readClassicVector(this.memory, pointer()), classicNumber(values, 1)); break;
      case "unicast": this.unicast(classicPointer(values, 0), classicNumber(values, 1) !== 0); break;
      default: throw new Error(`Invalid API 3 message operation ${operation}`);
    }
    return undefined;
  }
  private print(destination: "broadcast" | "debug" | "client" | "center", entity: GuestAddress | null, level: number, text: string): undefined {
    if (destination === "debug" || destination === "client" && entity === null) { this.options.print(text); return undefined; }
    if (destination !== "broadcast" && entity === null) return undefined;
    if (destination !== "broadcast" && entity !== null) {
      const slot = this.host.edicts.fromPointer(entity).slot;
      if (slot < 1 || slot > this.options.maxClients) { if (destination === "center") return undefined; throw new Error("API 3 cprintf on non-client edict"); }
    }
    const packet = new SizeBuf(); SZ_Init(packet, new Uint8Array(1400), 1400);
    MSG_WriteByte(packet, destination === "center" ? 15 : 10);
    if (destination !== "center") MSG_WriteByte(packet, level);
    MSG_WriteString(packet, text);
    const audience: ClassicGuestAudience = destination === "broadcast" ? { kind: "multicast", origin: zero, scope: "all" } : { kind: "unicast", slot: this.host.edicts.fromPointer(entity ?? this.host.edicts.at(0).address).slot };
    this.#messages.push({ audience, reliable: true, bytes: packet.data.slice(0, packet.cursize) });
    if (destination === "broadcast") this.options.print(text);
    return undefined;
  }
  private sound(explicitOrigin: Vec3 | null, entity: GuestAddress | null, channel: number, index: number, volume: number, attenuation: number, offset: number): undefined {
    if (volume < 0 || volume > 1 || attenuation < 0 || attenuation > 4 || offset < 0 || offset > 0.255) throw new RangeError("API 3 sound parameters outside source ranges");
    if (entity === null) throw new Error("API 3 sound requires an entity");
    const record = this.host.edicts.fromPointer(entity), view = record.bytes;
    const solid = view.getInt32(248, true), bounds = this.body(record).bounds;
    const origin = explicitOrigin ?? (solid === 3 ? { x: vector(view, 4).x + (bounds.min.x + bounds.max.x) * 0.5, y: vector(view, 4).y + (bounds.min.y + bounds.max.y) * 0.5, z: vector(view, 4).z + (bounds.min.z + bounds.max.z) * 0.5 } : vector(view, 4));
    const positioned = explicitOrigin !== null || (view.getInt32(184, true) & 1) !== 0 || solid === 3;
    const flags = 8 | (volume !== 1 ? 1 : 0) | (attenuation !== 1 ? 2 : 0) | (positioned ? 4 : 0) | (offset !== 0 ? 16 : 0);
    MSG_WriteByte(this.#buffer, 9); MSG_WriteByte(this.#buffer, flags); MSG_WriteByte(this.#buffer, index);
    if ((flags & 1) !== 0) MSG_WriteByte(this.#buffer, volume * 255);
    if ((flags & 2) !== 0) MSG_WriteByte(this.#buffer, attenuation * 64);
    if ((flags & 16) !== 0) MSG_WriteByte(this.#buffer, offset * 1000);
    MSG_WriteShort(this.#buffer, record.slot << 3 | channel & 7);
    if (positioned) MSG_WritePos(this.#buffer, tuple(origin));
    this.multicast(origin, ((channel & 8) !== 0 || attenuation === 0 ? 0 : 1) + ((channel & 8) === 0 && (channel & 16) !== 0 ? 3 : 0));
    return undefined;
  }
  entityState(slot: number): Q2EntityState {
    const view = this.host.edicts.at(slot).bytes;
    return { number: view.getInt32(0, true), origin: vector(view, 4), angles: vector(view, 16), oldOrigin: vector(view, 28),
      modelIndexes: [view.getInt32(40, true), view.getInt32(44, true), view.getInt32(48, true), view.getInt32(52, true)], frame: view.getInt32(56, true), skin: view.getInt32(60, true),
      effects: view.getUint32(64, true), renderEffects: view.getInt32(68, true), solid: view.getInt32(72, true), sound: view.getInt32(76, true), event: view.getInt32(80, true) };
  }
  playerState(slot: number): Q2PlayerState {
    const view = this.host.edicts.clientPrefix(slot);
    if (view === null) throw new Error("API 3 client slot has no gclient prefix");
    const shorts = (offset: number): [number, number, number] => [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true)];
    return { kind: "q2-classic", movement: { kind: "q2-classic", type: view.getInt32(0, true), originEighths: shorts(4), velocityEighths: shorts(10), flags: view.getUint8(16), timeEightMilliseconds: view.getUint8(17), gravity: view.getInt16(18, true), deltaAngleShorts: shorts(20) },
      viewAngles: vector(view, 28), viewOffset: vector(view, 40), kickAngles: vector(view, 52), gunAngles: vector(view, 64), gunOffset: vector(view, 76), gunIndex: view.getInt32(88, true), gunFrame: view.getInt32(92, true),
      blend: { x: view.getFloat32(96, true), y: view.getFloat32(100, true), z: view.getFloat32(104, true), w: view.getFloat32(108, true) }, fov: view.getFloat32(112, true), renderFlags: view.getInt32(116, true), stats: Array.from({ length: 32 }, (_, index) => view.getInt16(120 + index * 2, true)) };
  }
  modelAppearance(slot: number): { readonly path: string; readonly skin: number; readonly skinPath: string | null; readonly attachedModels: readonly string[] } {
    const state = this.entityState(slot);
    const value = this.#configstrings.get(1312 + (state.skin & 255)) ?? "player\\male/grunt";
    const appearance = value.slice(value.indexOf("\\") + 1), slash = appearance.indexOf("/");
    const model = slash < 0 ? "male" : appearance.slice(0, slash), skin = slash < 0 ? "grunt" : appearance.slice(slash + 1);
    const weapons = ["weapon.md2"];
    for (let index = 1; index < 256; index++) { const name = this.resource("model", index); if (name.startsWith("#") && weapons.length < 20) weapons.push(name.slice(1)); }
    const weapon = weapons[(state.skin >>> 8) & 255] ?? weapons[0] ?? "weapon.md2";
    return { path: state.modelIndexes[0] === 255 ? `players/${model}/tris.md2` : this.resource("model", state.modelIndexes[0]),
      skin: state.modelIndexes[0] === 255 ? 0 : state.skin, skinPath: state.modelIndexes[0] === 255 ? `players/${model}/${skin}.pcx` : null,
      attachedModels: state.modelIndexes.slice(1).map(index => index === 255 ? `players/${model}/${weapon}` : this.resource("model", index)) };
  }
  publishEntities(): void {
    for (const actor of this.options.engine.actors.ownedBy(this.host.options.provider)) {
      const record = this.host.edicts.fromPointer(this.host.edicts.pointer(actor.id));
      if (record.slot === 0) continue;
      const state = this.entityState(record.slot);
      this.options.engine.emit({ kind: "visibility", actor: actor.id, visible: (record.bytes.getInt32(184, true) & 1) === 0 });
      const appearance = this.modelAppearance(record.slot);
      this.options.engine.emit({ kind: "model", actor: actor.id, path: appearance.path, attachedModels: appearance.attachedModels, frame: state.frame, oldFrame: state.frame, scale: 1, alpha: (state.renderEffects & 32) !== 0 ? 0.3 : 1, skin: appearance.skin, effects: state.effects, renderFlags: state.renderEffects });
      if (state.event !== 0) this.options.engine.emit({ kind: "entity-event", actor: actor.id, event: state.event });
    }
  }
}
