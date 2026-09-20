import { RereleaseNavigationImports } from "../../../compat/q2/rerelease/navigation.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { TraceQuery } from "../../../contracts/scene.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { argument, integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { readGuestString, type RereleaseCoreServices } from "../../../compat/q2/rerelease/imports.ts";
import { guestBool, type RereleaseImportCall } from "../../../compat/q2/rerelease/module.ts";
import type { RereleaseQ2GuestHost, RereleaseQ2HostOptions, RereleaseActorBindings, RereleaseSemanticBindings } from "../../../compat/q2/rerelease/host.ts";
import { RereleasePublicEdict } from "../../../compat/q2/rerelease/public-state.ts";
import { rereleaseLinkBounds, rereleaseNetworkSolid } from "../../../compat/q2/rerelease/spatial.ts";
import type { RereleaseSoundEvent } from "../../../compat/q2/rerelease/sounds.ts";
import { SizeBuf, SZ_Init, SZ_Clear, MSG_WriteByte, MSG_WriteShort, MSG_WriteFloat, MSG_WriteString } from "../../../network/q2/message.ts";
import { traceActorBody } from "../../../world/collision/body.ts";
import type { ClassicGuestAudience } from "./classic-guest-services.ts";
import type { RereleaseGuestMapServices, RereleaseGuestMessage, RereleaseGuestServicesOptions, RereleaseGuestServicesPort } from "./rerelease-guest-services-contract.ts";
import { RereleaseCombatBindings } from "../../../compat/q2/rerelease/combat-binding.ts";
import { retailRereleaseClientProfile } from "../../../compat/q2/rerelease/client-profile.ts";
import { RereleaseSourceClient } from "../../../compat/q2/rerelease/source-state.ts";
import { rereleaseInventoryItems } from "../../../compat/q2/rerelease/semantics.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const resourceRanges = { model: { base: 62, count: 8192 }, sound: { base: 8254, count: 2048 }, image: { base: 10302, count: 512 } };
interface LinkMetadata { readonly clusters: readonly number[] | null; readonly firstCluster: number; readonly headnode: number; readonly areas: readonly [number, number] }
function messageBuffer(): SizeBuf { const buffer = new SizeBuf(); SZ_Init(buffer, new Uint8Array(65536), 65536); return buffer; }

/** Public API2023 imports borrow the shared engine while source RunFrame owns gameplay. */
export class RereleaseGuestServices implements RereleaseGuestServicesPort {
  #writePlayerVelocity: ((actor: OwnedActor, velocity: Vec3) => undefined) | null = null;
  #readPlayerVelocity: ((actor: ActorId) => Vec3 | undefined) | null = null;
  setPlayerVelocityWriter(write: (actor: OwnedActor, velocity: Vec3) => undefined, read: (actor: ActorId) => Vec3 | undefined): void {
    this.#writePlayerVelocity = write; this.#readPlayerVelocity = read;
  }
  readonly hostOptions: RereleaseGuestServicesPort["hostOptions"];
  readonly #strings = new Map<number, string>();
  readonly #messages: RereleaseGuestMessage[] = [];
  readonly #links = new Map<ActorId, LinkMetadata>();
  readonly #buffer = messageBuffer();
  #options: RereleaseGuestServicesOptions;
  #memory: MappedGuestMemory | null = null;
  #host: RereleaseQ2GuestHost | null = null;
  #combat: RereleaseCombatBindings | null = null;
  #loading = true;
  #frame = 0;
  get options(): RereleaseGuestServicesOptions { return this.#options; }
  get memory(): MappedGuestMemory { if (this.#memory === null) throw new Error("API2023 services have no guest memory"); return this.#memory; }
  get host(): RereleaseQ2GuestHost { if (this.#host === null) throw new Error("API2023 services have no guest host"); return this.#host; }
  constructor(options: RereleaseGuestServicesOptions) {
    this.#options = options;
    if (!Number.isInteger(options.maxClients) || options.maxClients < 1 || options.maxClients > 256) throw new RangeError("Invalid API2023 maxclients");
    if (!Number.isInteger(options.frameMilliseconds) || options.frameMilliseconds <= 0 || 1000 % options.frameMilliseconds !== 0) throw new RangeError("Invalid API2023 frame duration");
    this.validateMap(options); this.seedMap();
    options.cvars.set("maxclients", String(options.maxClients), true);
    const owner = this;
    const engine: RereleaseQ2HostOptions["engine"] = {
      get actors() { return owner.options.engine.actors; }, get bodies() { return owner.options.engine.bodies; },
      get callbacks() { return owner.options.engine.callbacks; }, get combat() { return owner.options.engine.combat; }, get inventory() { return owner.options.engine.inventory; },
      trace: query => owner.options.engine.trace(query), pointContents: point => owner.options.engine.pointContents(point),
      setAreaPortal: (portal, open) => owner.options.engine.setAreaPortal(portal, open),
      setSolid: (actor, solid, model) => owner.options.engine.setSolid(actor, solid, model),
      inlineModelBounds: model => owner.options.engine.inlineModelBounds(model), worldActor: () => owner.options.engine.worldActor(),
    };
    const semantics: RereleaseSemanticBindings = options.semanticBindings ?? { bind: (record: RawEntityView, actor: OwnedActor) => this.bindEntity(record, actor), foreignAddress: (actor: ActorId): GuestAddress => { throw new Error(`API2023 module requires a semantic projection extension for foreign actor ${actor.slot}`); } };
    this.hostOptions = { engine, frameMilliseconds: options.frameMilliseconds,
      ...(options.foreignDamage === undefined ? {} : { foreignDamage: { provenance: (attacker, inflictor, target) => {
        const binding = this.options.foreignDamage; if (binding === undefined) throw new Error("Native damage provenance is unavailable");
        return binding.provenance(attacker, inflictor, target);
      } } }),
      semantics: { ...semantics, bound: (record, actor) => { semantics.bound?.(record, actor); this.options.admit(record, actor); } },
      spatial: {
        areasConnected: (first, second) => this.options.scene.areasConnected(first, second),
        visibility: (kind, first, second, portals) => { const scene = this.options.scene, a = scene.pointLeaf(first), b = scene.pointLeaf(second); return scene.clusterVisible(scene.leafCluster(a), scene.leafCluster(b), kind) && (!portals || scene.areasConnected(scene.leafArea(a), scene.leafArea(b))); },
        surfaceId: surface => { const geometry = this.options.scene.geometry; if (geometry.kind !== "q2-bsp") return 0; const index = geometry.textureInfo.findIndex(value => value === surface || value.name === surface.name && value.flags === surface.flags && value.value === surface.value); return index < 0 ? 0 : index; },
        boxEdicts: (min, max, area) => { if (area !== 1 && area !== 2) throw new RangeError("Invalid API2023 BoxEdicts area"); return this.options.scene.queryActors({ min, max }, area === 1 ? "solid" : "trigger").map(value => value.body.actor); },
        inlineModel: index => this.inlineModel(index), prepareLink: (actor, record) => this.prepareLink(actor, record), linkMetadata: (actor, record) => this.linkMetadata(actor, record),
      },
      messages: { buffer: this.#buffer, acceptsClient: slot => this.acceptsClient(slot),
        unicast: value => this.enqueue({ kind: "unicast", slot: value.clientSlot }, value.reliable, value.bytes, value.dupeKey),
        multicast: value => this.enqueue({ kind: "multicast", origin: value.origin ?? zero, scope: value.destination }, value.reliable, value.bytes),
      },
      sound: event => this.sound(event), debugShapes: event => this.options.debugShapes(event), worldText: event => this.options.worldText(event),
    };
  }
  bindMemory(memory: MappedGuestMemory): RereleaseCoreServices {
    if (this.#memory !== null) throw new Error("API2023 memory already bound"); this.#memory = memory;
    return { cvars: this.options.cvars, print: text => { this.options.print(text); return undefined; },
      getConfigstring: index => this.#strings.get(index) ?? "", setConfigstring: (index, value) => this.setConfigstring(index, value),
      resourceIndex: (kind, name) => this.resourceIndex(kind, name), serverFrame: () => this.#frame,
      commandArguments: () => this.options.command().arguments, commandTail: () => this.options.command().args,
      addCommand: text => this.options.addCommand(text), extension: () => null, invoke: call => this.invoke(call),
    };
  }
  bindHost(host: RereleaseQ2GuestHost): void { if (this.#host !== null || host.module.memory !== this.memory) throw new Error("API2023 host/memory binding mismatch"); this.#host = host; this.#combat = new RereleaseCombatBindings(host); }
  notarget(slot: number): boolean | null { return this.#combat?.notarget(this.host.module.entities().atSlot(slot)) ?? null; }
  equipmentInventory(slot: number): InventoryStateBinding | null {
    const profile = retailRereleaseClientProfile, host = this.host;
    if (profile.authority.kind !== "artifact" || host.module.memory.module.digest !== profile.authority.digest) return null;
    const items = rereleaseInventoryItems(host.module, text => host.core.string(text)).filter(item => item.item === "q2:ammo_grenades");
    if (items.length !== 1) throw new Error("Native grenade inventory item is missing");
    const current = () => {
      const address = this.view(slot).pointer("client");
      if (address === null) throw new Error("Native grenade inventory requires a source client");
      return new RereleaseSourceClient(address, host.module, profile).inventory(items);
    };
    return { read: () => current().read(), write: entry => current().write(entry) };
  }
  validateMap(binding: RereleaseGuestMapServices): void { if (binding.scene.geometry.models.length >= 8191) throw new RangeError("API2023 map exceeds model capacity"); }
  private seedMap(): void { this.#strings.set(63, this.options.mapPath); for (let i = 1; i < this.options.scene.geometry.models.length; i++) this.#strings.set(63 + i + (i >= 254 ? 1 : 0), `*${i}`); }
  rebindWorld(binding: RereleaseGuestMapServices): void { this.validateMap(binding); this.#options = { ...this.#options, ...binding }; this.#loading = true; this.#frame = 0; this.#strings.clear(); this.#messages.length = 0; this.#links.clear(); SZ_Clear(this.#buffer); this.seedMap(); }
  completeSpawn(): void { this.#loading = false; }
  beginFrame(frame: number): void { if (!Number.isInteger(frame) || frame < 0 || frame > 0xffffffff) throw new RangeError("Invalid API2023 frame"); this.#frame = frame; for (const actor of this.#links.keys()) if (!this.options.engine.actors.isLive(actor)) this.#links.delete(actor); }
  configstrings(): ReadonlyMap<number, string> { return new Map(this.#strings); }
  restoreConfigstrings(values: ReadonlyMap<number, string>): void { for (const [index, value] of values) this.validateConfigstring(index, value); this.#strings.clear(); for (const [index, value] of values) this.#strings.set(index, value); }
  private validateConfigstring(index: number, value: string): void { if (!Number.isInteger(index) || index < 0 || index >= 12448 || value.includes("\0")) throw new RangeError("Invalid API2023 configstring"); }
  setConfigstring(index: number, value: string): undefined {
    this.validateConfigstring(index, value); if (this.#strings.get(index) === value) return undefined; this.#strings.set(index, value);
    if (index >= 10814 && index < 11070) this.options.engine.emit({ kind: "lightstyle", style: index - 10814, pattern: value });
    if (index === 1) this.options.engine.emit({ kind: "music", track: value });
    if (!this.#loading) { const buffer = messageBuffer(); MSG_WriteByte(buffer, 13); MSG_WriteShort(buffer, index); MSG_WriteString(buffer, value); this.enqueue({ kind: "multicast", origin: zero, scope: "all" }, true, buffer.data.slice(0, buffer.cursize)); }
    return undefined;
  }
  resource(kind: "model" | "sound" | "image", index: number): string { return this.#strings.get(resourceRanges[kind].base + index) ?? ""; }
  resourceIndex(kind: "model" | "sound" | "image", name: string): number { if (name === "") return 0; const range = resourceRanges[kind]; for (let index = 1; index < range.count; index++) { if (kind === "model" && index === 255) continue; const current = this.resource(kind, index); if (current === name) return index; if (current === "") { this.setConfigstring(range.base + index, name); return index; } } throw new RangeError(`API2023 ${kind} index overflow`); }
  private inlineModel(index: number): number { const path = this.resource("model", index); if (index === 1 && path === this.options.mapPath) return 0; const model = Number(path.slice(1)); if (!path.startsWith("*") || !Number.isInteger(model) || model < 0 || model >= this.options.scene.geometry.models.length) throw new Error(`Invalid API2023 inline model ${path}`); return model; }
  private view(slot: number): RereleasePublicEdict { return new RereleasePublicEdict(this.memory, this.host.module.entities().atSlot(slot)); }
  private body(view: RereleasePublicEdict): BodyState {
    const actor = view.record.currentActor(), pending = actor === null ? undefined : this.#readPlayerVelocity?.(actor);
    const velocity = pending ?? (view.record.slot > 0 && view.record.slot <= this.options.maxClients && view.pointer("client") !== null ? view.playerState().movement.velocity : view.vector("sv.velocity"));
    return { origin: view.vector("s.origin"), angles: view.vector("s.angles"), velocity, bounds: { min: view.vector("mins"), max: view.vector("maxs") }, ground: null };
  }
  private bindEntity(record: RawEntityView, actor: OwnedActor): RereleaseActorBindings {
    const view = new RereleasePublicEdict(this.memory, record); this.#links.delete(actor.id);
    return { body: { read: () => this.body(view), write: state => {
      const velocity = this.body(view).velocity;
      if (state.velocity.x !== velocity.x || state.velocity.y !== velocity.y || state.velocity.z !== velocity.z) {
        if (record.slot < 1 || record.slot > this.options.maxClients || view.pointer("client") === null || this.#writePlayerVelocity === null)
          throw new Error("API2023 velocity writes require a source semantic binding");
        this.#writePlayerVelocity(actor, state.velocity);
      }
      view.setVector("s.origin", state.origin); view.setVector("s.angles", state.angles); view.setVector("mins", state.bounds.min); view.setVector("maxs", state.bounds.max); return undefined; } },
      combat: this.#combat?.bind(record) ?? null, powerArmorCells: null, inventory: null, callbacks: { think: null, touch: null, use: null, pain: null, die: null } };
  }
  private worldLink(bounds: Bounds): LinkMetadata {
    const scene = this.options.scene, query = scene.boxLeaves(bounds, 128), clusters: number[] = []; let first = 0, second = 0;
    for (const leaf of query.leaves) { const area = scene.leafArea(leaf), cluster = scene.leafCluster(leaf); if (area !== 0) { if (first !== 0 && first !== area) second = area; else first = area; } if (cluster >= 0 && !clusters.includes(cluster)) clusters.push(cluster); }
    return { clusters: query.overflow || query.leaves.length >= 128 || clusters.length > 16 ? null : clusters, firstCluster: clusters[0] ?? 0, headnode: query.topnode ?? 0, areas: [first, second] };
  }
  private prepareLink(actor: OwnedActor, record: RawEntityView): void {
    const view = new RereleasePublicEdict(this.memory, record), solid = view.byte("solid"), flags = view.uint("svflags"), address = view.pointer("owner");
    const owner = address === null ? null : this.host.actor(this.host.module.entities().fromPointer(address))?.id ?? null;
    this.options.collision(actor, { family: "q2", shape: solid === 3 ? { kind: "model", model: this.inlineModel(view.int("s.modelindex")) } : { kind: "box" }, contents: solid === 0 ? 0 : solid === 3 ? 1 : (flags & 2) !== 0 ? 0x4000000 : (flags & 8) !== 0 ? 0x40000000 : (flags & 128) !== 0 ? 0x80000000 : 0x2000000, owner, role: solid === 1 ? "trigger" : "solid", monster: (flags & 4) !== 0, deadMonster: (flags & 2) !== 0 });
  }
  private linkMetadata(actor: OwnedActor, record: RawEntityView): { readonly area: number; readonly area2: number; readonly networkSolid: number } {
    const view = new RereleasePublicEdict(this.memory, record), state = this.body(view), solid = view.byte("solid"), flags = view.uint("svflags");
    const link = this.worldLink(rereleaseLinkBounds(state, solid)); this.#links.set(actor.id, link);
    return { area: link.areas[0], area2: link.areas[1], networkSolid: rereleaseNetworkSolid(state.bounds, solid, flags) };
  }
  entityState(slot: number): ReturnType<RereleasePublicEdict["state"]> { const view = this.view(slot); this.memory.writeUint32(view.address("s.number"), slot); return view.state(); }
  playerState(slot: number): ReturnType<RereleasePublicEdict["playerState"]> { return this.view(slot).playerState(); }
  playerPing(slot: number): number { return this.view(slot).ping(); }
  setPlayerPing(slot: number, ping: number): void { this.view(slot).setPing(ping); }
  entityInfo(slot: number): ReturnType<RereleaseGuestServicesPort["entityInfo"]> {
    const view = this.view(slot), actor = this.host.actor(view.record), link = actor === null ? undefined : this.#links.get(actor.id), owner = view.pointer("owner");
    return { actor: actor?.id ?? null, active: view.byte("inuse") !== 0, serverFlags: view.uint("svflags"), areas: [view.int("areanum"), view.int("areanum2")], clusters: link === undefined ? [] : link.clusters, firstCluster: link?.firstCluster ?? 0, headnode: link?.headnode ?? 0, ownerSlot: owner === null ? null : this.host.module.entities().fromPointer(owner).slot };
  }
  modelAppearance(slot: number): ReturnType<RereleaseGuestServicesPort["modelAppearance"]> {
    const state = this.entityState(slot);
    if (state.modelIndexes.every(index => index !== 255)) return { path: this.resource("model", state.modelIndexes[0]), skin: state.skin, skinPath: null, attachedModels: state.modelIndexes.slice(1).map(index => this.resource("model", index)) };
    const value = this.#strings.get(11582 + (state.skin & 255)) ?? "player\\male/grunt", appearance = value.slice(value.indexOf("\\") + 1), slash = appearance.indexOf("/");
    const model = slash < 0 ? "male" : appearance.slice(0, slash), skin = slash < 0 ? "grunt" : appearance.slice(slash + 1), weapons = ["weapon.md2"];
    for (let index = 1; index < 8192; index++) { const name = this.resource("model", index); if (name.startsWith("#")) weapons.push(name.slice(1)); }
    const weapon = weapons[(state.skin >>> 8) & 255] ?? "weapon.md2";
    return { path: state.modelIndexes[0] === 255 ? `players/${model}/tris.md2` : this.resource("model", state.modelIndexes[0]), skin: state.modelIndexes[0] === 255 ? 0 : state.skin, skinPath: state.modelIndexes[0] === 255 ? `players/${model}/${skin}.pcx` : null,
      attachedModels: state.modelIndexes.slice(1).map(index => index === 255 ? `players/${model}/${weapon}` : this.resource("model", index)) };
  }
  publishEntities(): void {
    const table = this.host.module.entities();
    for (let slot = 1; slot < table.count; slot++) { const view = this.view(slot), actor = this.host.actor(view.record); if (actor === null) continue; const state = this.entityState(slot), appearance = this.modelAppearance(slot);
      if (state.effects > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Shared model effect projection requires a lossless API2023 effect value");
      this.options.engine.emit({ kind: "visibility", actor: actor.id, visible: view.byte("inuse") !== 0 && (view.uint("svflags") & 1) === 0 });
      this.options.engine.emit({ kind: "model", actor: actor.id, path: appearance.path, attachedModels: appearance.attachedModels, frame: state.frame, oldFrame: state.oldFrame, scale: state.scale === 0 ? 1 : state.scale, alpha: state.alpha === 0 ? (state.renderEffects & 32) !== 0 ? 0.3 : 1 : state.alpha, skin: appearance.skin, effects: Number(state.effects), renderFlags: state.renderEffects });
      if (state.event !== 0) this.options.engine.emit({ kind: "entity-event", actor: actor.id, event: state.event });
    }
  }
  private acceptsClient(slot: number): boolean { if (this.options.acceptsClient !== undefined) return this.options.acceptsClient(slot); return slot >= 1 && slot <= this.options.maxClients && slot < this.host.module.entities().count && this.host.isClientReserved(slot); }
  private enqueue(audience: ClassicGuestAudience, reliable: boolean, bytes: Uint8Array, dupeKey = 0): void { this.#messages.push({ sourceDialect: "q2-multicast-float", audience, reliable, bytes, dupeKey }); }
  drainMessages(): readonly RereleaseGuestMessage[] { return this.#messages.splice(0); }
  private print(slot: number | null, level: number, text: string, broadcast: boolean, center = false): void {
    if (!broadcast && slot === null) { this.options.print(text); return; }
    if (slot !== null && !this.acceptsClient(slot)) return;
    const buffer = messageBuffer(); MSG_WriteByte(buffer, center ? 15 : 10); if (!center) MSG_WriteByte(buffer, level); MSG_WriteString(buffer, text);
    this.enqueue(broadcast ? { kind: "multicast", origin: zero, scope: "all" } : { kind: "unicast", slot: slot ?? 0 }, true, buffer.data.slice(0, buffer.cursize)); if (broadcast) this.options.print(text);
  }
  private sound(event: RereleaseSoundEvent): void {
    if (event.volume < 0 || event.volume > 1 || event.attenuation < 0 || event.attenuation > 4 || event.timeOffset < 0 || event.timeOffset > 0.255 || event.soundIndex < 0 || event.soundIndex >= 2048) throw new RangeError("Invalid API2023 sound arguments");
    const view = event.entitySlot === null ? null : this.view(event.entitySlot), state = view === null ? null : this.body(view);
    if (state === null && event.origin === null) throw new Error("API2023 sound has neither entity nor origin");
    const origin = event.origin ?? (state === null ? zero : view?.byte("solid") === 3 ? { x: state.origin.x + (state.bounds.min.x + state.bounds.max.x) * 0.5, y: state.origin.y + (state.bounds.min.y + state.bounds.max.y) * 0.5, z: state.origin.z + (state.bounds.min.z + state.bounds.max.z) * 0.5 } : state.origin);
    const positioned = true;
    const flags = (event.entitySlot === null ? 0 : 8) | (event.volume !== 1 ? 1 : 0) | (event.attenuation !== 1 ? 2 : 0) | (positioned ? 4 : 0) | (event.timeOffset !== 0 ? 16 : 0) | (event.soundIndex > 255 ? 32 : 0);
    const buffer = messageBuffer(); MSG_WriteByte(buffer, 9); MSG_WriteByte(buffer, flags); if ((flags & 32) !== 0) MSG_WriteShort(buffer, event.soundIndex); else MSG_WriteByte(buffer, event.soundIndex);
    if ((flags & 1) !== 0) MSG_WriteByte(buffer, event.volume * 255); if ((flags & 2) !== 0) MSG_WriteByte(buffer, event.attenuation * 64); if ((flags & 16) !== 0) MSG_WriteByte(buffer, event.timeOffset * 1000);
    if (event.entitySlot !== null) MSG_WriteShort(buffer, event.entitySlot << 3 | event.channel & 7);
    if (positioned) { MSG_WriteFloat(buffer, origin.x); MSG_WriteFloat(buffer, origin.y); MSG_WriteFloat(buffer, origin.z); }
    const audience: ClassicGuestAudience = event.audience.kind === "client" ? { kind: "unicast", slot: event.audience.clientSlot } : { kind: "multicast", origin, scope: (event.channel & 8) !== 0 || event.attenuation === 0 ? "all" : "phs" };
    this.enqueue(audience, (event.channel & 16) !== 0, buffer.data.slice(0, buffer.cursize), event.audience.kind === "client" ? event.audience.dupeKey : 0);
  }
  private vector(address: GuestAddress): Vec3 { return { x: this.memory.readFloat32(address), y: this.memory.readFloat32(this.memory.offset(address, 4n)), z: this.memory.readFloat32(this.memory.offset(address, 8n)) }; }
  private invoke(call: RereleaseImportCall): GuestCallResult | undefined {
    const args = call.arguments, number = (index: number) => Number(integer(args, index)), text = (index: number) => readGuestString(this.memory, requiredPointer(args, index));
    const slot = (index: number) => { const address = pointer(args, index); return address === null ? null : this.host.module.entities().fromPointer(address).slot; };
    switch (call.name) {
      case "Broadcast_Print": this.print(null, number(0), text(1), true); break;
      case "Client_Print": this.print(slot(0), number(1), text(2), false); break;
      case "Center_Print": this.print(slot(0), 5, text(1), false, true); break;
      case "Loc_Print": { const count = number(4); if (!Number.isInteger(count) || count < 0 || count > 8) throw new RangeError("API2023 localization argument count"); const values: string[] = []; if (count > 0) { const base = requiredPointer(args, 3); for (let i = 0; i < count; i++) { const at = this.memory.readPointer(this.memory.offset(base, BigInt(i * 8))); values.push(at === null ? "" : readGuestString(this.memory, at)); } } const level = number(1); this.print(slot(0), level & ~8, this.options.localize(text(2), values), (level & 8) !== 0); break; }
      case "DebugGraph": { const value = argument(args, 0); if (value.kind !== "float32") throw new TypeError("API2023 graph requires a float"); this.options.debugGraph(value.value, number(1)); break; }
      case "SendToClipBoard": if (this.options.clipboard.kind === "client") this.options.clipboard.write(text(0)); break;
      case "ReportMatchDetails_Multicast": SZ_Clear(this.#buffer); break;
      case "Bot_MoveToPoint": case "Bot_FollowActor": case "GetPathToGoal":
        return new RereleaseNavigationImports(this.memory, this.options.navigation, address =>
          this.host.actor(this.host.module.entities().fromPointer(address))?.id ?? null).invoke(call.name, call.arguments);
      case "Info_RemoveKey": case "Info_SetValueForKey": return this.info(call);
      case "clip": {
        const view = this.host.module.entities().fromPointer(requiredPointer(args, 0)), actor = this.host.actor(view), min = pointer(args, 2), max = pointer(args, 3);
        if ((min === null) !== (max === null)) throw new Error("API2023 clip requires both bounds or neither");
        const source = new RereleasePublicEdict(this.memory, view), state = this.body(source);
        const query: TraceQuery = { start: this.vector(requiredPointer(args, 1)), end: this.vector(requiredPointer(args, 4)), shape: min === null || max === null ? { kind: "point" } : { kind: "box", bounds: { min: this.vector(min), max: this.vector(max) } }, target: { kind: "world" }, policy: { kind: "q2", contentsMask: number(5), leafContents: "merged" }, numeric: this.options.numeric.profile, passActor: null };
        const solid = source.byte("solid"), sourceModel = this.resource("model", source.int("s.modelindex"));
        const hit = view.slot === 0 ? this.options.scene.geometryTrace(query)
          : solid === 3 || solid === 1 && sourceModel.startsWith("*") ? this.options.scene.geometryTrace({ ...query, target: { kind: "model", model: this.inlineModel(source.int("s.modelindex")), origin: state.origin, angles: state.angles } })
          : traceActorBody(query, { body: { actor: actor?.id ?? this.options.engine.worldActor(), state, absoluteBounds: rereleaseLinkBounds(state, solid), linkCount: source.int("linkcount") }, collision: { family: "q2", shape: { kind: "box" }, role: "solid", owner: null, monster: false, deadMonster: false, contents: 0x2000000 } });
        return this.host.encodeTrace(hit, view.address);
      }
      default: return undefined;
    }
    return { kind: "void" };
  }
  private info(call: RereleaseImportCall): GuestCallResult {
    const args = call.arguments, address = requiredPointer(args, 0), key = readGuestString(this.memory, requiredPointer(args, 1), 2048), input = readGuestString(this.memory, address, 2048);
    let output = "", found = false, cursor = 0;
    while (cursor < input.length) { const start = cursor; if (input[cursor] === "\\") cursor++; const separator = input.indexOf("\\", cursor); if (separator < 0) { output += input.slice(start); break; } const next = input.indexOf("\\", separator + 1), end = next < 0 ? input.length : next; if (input.slice(cursor, separator) === key) found = true; else output += input.slice(start, end); cursor = end; }
    let result = found;
    if (call.name === "Info_SetValueForKey") {
      const value = readGuestString(this.memory, requiredPointer(args, 2), 2048);
      if (key.length >= 64 || value.length >= 256 || /[\\";]/.test(key) || /[\\";]/.test(value)) return guestBool(false);
      result = value.length === 0 || output.length + key.length + value.length + 2 < 2048;
      if (result && value.length !== 0) { const pair = `\\${key}\\${value}`; for (let i = 0; i < pair.length; i++) { const byte = pair.charCodeAt(i) & 127; if (byte >= 32 && byte < 127) output += String.fromCharCode(byte); } }
    }
    const bytes = new TextEncoder().encode(output); this.memory.write(address, bytes); this.memory.writeUint8(this.memory.offset(address, BigInt(bytes.length)), 0); return guestBool(result);
  }
}
