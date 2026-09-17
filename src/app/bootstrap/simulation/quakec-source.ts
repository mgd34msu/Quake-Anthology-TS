import type { Q1SaveData } from "../../../persistence/q1.ts";
import { captureQ1SourceSave, restoreQ1SourceSave } from "../../../persistence/q1-source.ts";
import { registerQuakeWorldEngineCvars } from "./quakeworld-cvars.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue, namespaced } from "../../../persistence/value.ts";
import { captureQcCheckpoint, restoreQcCheckpoint, type QcExecutorHost } from "../../../compat/qc/executor.ts";
import type { QuakeCCheckpoint, ModuleIdentity } from "../../../contracts/execution.ts";
import { savedQcActor, captureQcDestination, readQcDestination } from "../../../compat/qc/presentation-host.ts";
import { Id1Environment, type Id1PhysicsCallback } from "../../../content/q1/quakec/id1-environment.ts";
import { id1ProgramBinding } from "../../../content/q1/quakec/id1-program.ts";
import { donorAngleVectors } from "../../../core/math.ts";
import { Id1ProjectileAttacks } from "../../../content/q1/quakec/id1-projectiles.ts";
import { QcBroadcastMessages } from "../../../compat/qc/presentation-host.ts";
import { Id1SynchronousAttacks } from "../../../content/q1/quakec/id1-attacks.ts";
import type { Q1UserCommand, QwUserCommand } from "../../../contracts/protocol.ts";
import type { ClientId } from "../../../contracts/identity.ts";
import type { QuakeCSourceTravel } from "./types.ts";
import type { Q1MovementState, QwMovementState, QwMovementProfile, ArsenalState, ActorAnimationState } from "../../../contracts/movement.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import type { InventoryEntry, ItemId } from "../../../contracts/gameplay.ts";
import { WEAPONS, weaponItem } from "../../../content/q1/foundation/types.ts";
import type { ExecutableRecipe, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { DamageRequest, ArmorState } from "../../../contracts/gameplay.ts";
import type { Q1WorldGeometry } from "../../../contracts/scene.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { Q2Motion } from "../../../content/q2/foundation/host.ts";
import { Id1DamageBinding } from "../../../content/q1/quakec/id1-damage.ts";
import type { Id1DamageCall } from "../../../content/q1/quakec/id1-damage.ts";
import { decodeQuakeWav } from "../../../audio/wav.ts";
import { parseQ12Model } from "../../../formats/q12-model/index.ts";
import { readQ1Bsp } from "../../../formats/q1-map/index.ts";
import { parseEntities } from "../../../core/common-parse.ts";
import { CvarRegistry } from "../../../core/cvars/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations, nativeAtoi } from "../../../core/numeric.ts";
import { QcMachine, QcEntityMemory, loadQcProgram, classicQcEntityLayout, createQcSourceSlotStorage, QcWorldHost,
  createQcBuiltins, createQcPresentationBindings, applyQcEntityPairs } from "../../../compat/qc/index.ts";
import { qcByteString } from "../../../compat/qc/program.ts";
import type { QcProgram } from "../../../compat/qc/program.ts";
import type { QcPrecachedResource, QcMessageDestination, QcRoutedMessage, QcQuakeWorldMessageServices } from "../../../compat/qc/presentation-host.ts";
import { createQcMovementBindings } from "../../../compat/qc/movement-host.ts";
import { createQcPusherServices } from "../../../compat/qc/pusher-host.ts";
import { QcClientHost, createQcAimBinding } from "../../../compat/qc/client-host.ts";
import { SourceActorSlots, quakeEdictLifetime } from "../../../world/actors/index.ts";
import type { SessionActorRegistry, ActorCallbackTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import { q1WaterTransition } from "../../../movement/q1/water-transition.ts";
import { thinkCallbackTime } from "../../../world/scheduler.ts";
import type { Q1PusherServices } from "../../../movement/q1/types.ts";
import type { SharedPhysics, SharedSolid, SharedPhysicsFlags } from "./physics.ts";
import type { SimulationEvents } from "./events.ts";
import type { SourceRandom } from "./random.ts";

type QuakeCExecution = Extract<ExecutableRecipe["execution"][number], { readonly kind: "quakec" }>;
interface NativeWeapon {
  readonly item: ItemId;
  readonly bit: number;
  readonly impulse: number;
  readonly via?: number;
}
function nativeWeapons(program: QcProgram): readonly NativeWeapon[] {
  const base = WEAPONS.map((weapon, index) => ({ item: weaponItem(weapon), bit: index === 0 ? 4096 : 1 << (index - 1), impulse: index + 1 }));
  if (program.digest !== "sha256:35a2fdc3acb04bdafe8d0269f5327cd1d5b47971f1ef024429f1572d3201dc82") return base;
  // This artifact's W_ChangeWeapon uses 225/226 and toggles grenade/proximity with impulse 6.
  return [...base, { item: weaponItem("hipnotic:laser"), bit: 8388608, impulse: 225 },
    { item: weaponItem("hipnotic:mjolnir"), bit: 128, impulse: 226 },
    { item: weaponItem("hipnotic:proximity"), bit: 65536, impulse: 6, via: 16 }];
}
export interface PreparedQuakeCSource {
  readonly execution: QuakeCExecution;
  readonly program: QcProgram;
  readonly resources: ReadonlyMap<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>;
}

/** Decode the selected artifact and genuine assets before synchronous source precaching. */
export async function prepareQuakeCSource(execution: QuakeCExecution, mounts: MountedContent, entityText = ""): Promise<PreparedQuakeCSource> {
  const artifact = await mounts.open(execution.artifact.requestedPath);
  if (artifact === null || artifact.reference.digest !== execution.artifact.digest || artifact.reference.id !== execution.artifact.id)
    throw new Error("Selected QuakeC artifact no longer matches its resolved identity");
  const program = loadQcProgram(artifact.bytes);
  id1ProgramBinding(program);
  if (execution.api.kind !== program.api.kind || execution.api.programVersion !== program.api.programVersion || execution.api.systemCrc !== program.api.systemCrc)
    throw new Error("Shared QuakeC artifact API differs from the selected execution");
  const resources = new Map<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>();
  const names = new Set<string>();
  for (let offset = 0; offset < program.strings.length;) {
    const name = qcByteString(program.strings, offset);
    if (/\.(mdl|spr|bsp|wav)$/.test(name)) names.add(name);
    offset += name.length + 1;
  }
  for (const entity of parseEntities(entityText)) for (const name of entity.values())
    if (/\.(mdl|spr|bsp|wav)$/.test(name)) names.add(name);
  for (const name of names) {
    const asset = await mounts.open(name.endsWith(".wav") ? `sound/${name}` : name);
    if (asset === null) continue; // Conditional source precache fails if it actually requests this absent asset.
    let modelBounds: Bounds | null = null;
    if (/\.(mdl|spr)$/.test(name)) {
      const model = parseQ12Model(asset.bytes, name);
      modelBounds = model.kind === "q1-mdl" ? { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } } : model.bounds;
    } else if (name.endsWith(".bsp")) {
      const model = readQ1Bsp(asset.bytes, { source: name }).models[0];
      if (model === undefined) throw new Error(`No world model in ${name}`);
      modelBounds = model.bounds;
    } else decodeQuakeWav(asset.bytes, name);
    resources.set(name, { resource: asset.reference, modelBounds });
  }
  return { execution, program, resources };
}

export type QuakeCPhysicsCallback = Id1PhysicsCallback;

export interface QuakeCSourceOptions {
  readonly originalSaveCandidate?: boolean;
  readonly sourceRegistry?: CvarRegistry;
  readonly restore?: { readonly checkpoint: QuakeCCheckpoint; readonly clients: readonly ClientId[] };
  readonly recipe: ExecutableRecipe;
  readonly world: Q1WorldGeometry;
  readonly scene: SharedSceneQueries;
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly physics: SharedPhysics;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly events: SimulationEvents;
  readonly random: SourceRandom;
  readonly skill: 0 | 1 | 2 | 3;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly maxClients: number;
  readonly initialSourceTimeSeconds: number;
  readonly admit: (actor: OwnedActor, slot: number, source: QuakeCSource) => undefined;
  readonly damageRequest: (call: Id1DamageCall) => DamageRequest;
  readonly print: (text: string) => undefined;
  readonly changeLevel: (map: string) => undefined;
}

/** One source state owner, borrowed by the session's existing actor traversal. */
export class QuakeCSource {
  readonly machine: QcMachine;
  readonly attacks: Id1SynchronousAttacks;
  readonly projectiles: Id1ProjectileAttacks;
  readonly environment: Id1Environment;
  readonly messages: QcBroadcastMessages;
  readonly entities: QcEntityMemory;
  readonly slots: SourceActorSlots;
  readonly worldHost: QcWorldHost;
  readonly cvars: CvarRegistry;
  readonly clients: QcClientHost;
  readonly pusherServices: Q1PusherServices;
  readonly reservedClientSlots: number;
  private currentTime: number;
  private changeLevelIssued = false;
  private readonly activeClients = new Set<ActorId>();
  private readonly weapons: readonly NativeWeapon[];
  private readonly pendingWeapons = new Map<ActorId, { readonly weapon: NativeWeapon; readonly following: boolean }>();
  private readonly userInfo = new Map<number, ReadonlyMap<string, string>>();
  private readonly spawnParameters = new Map<number, readonly number[]>();
  private readonly clientIdentities = new Map<number, ClientId>();
  private originalSaveRestored = false;
  private originalSaveExtensionText = "";
  private readonly spectatorSlots = new Set<number>();
  private readonly preparedClients = new Set<number>();
  private readonly fragRecords: { readonly killer: ActorId; readonly victim: ActorId }[] = [];
  private readonly routed: { readonly entries: readonly QcRoutedMessage[]; readonly destination: QcMessageDestination }[] = [];
  private readonly signon: QcRoutedMessage[] = [];
  private physicsCallback: QuakeCPhysicsCallback | null = null;
  private spawning = true;
  private readonly models = new Map<string, { readonly index: number; readonly bounds: Bounds }>();
  private readonly precached = new Map<string, QcPrecachedResource>();
  private modelCount: number;
  private soundCount = 1;
  constructor(readonly prepared: PreparedQuakeCSource, readonly options: QuakeCSourceOptions) {
    const binding = id1ProgramBinding(prepared.program);
    this.weapons = nativeWeapons(prepared.program);
    if (!options.recipe.execution.some(value => value.kind === "quakec" && value.owner.provider === prepared.execution.owner.provider
      && value.owner.content === prepared.execution.owner.content && value.artifact.digest === prepared.execution.artifact.digest)) throw new Error("QC source differs from selected execution");
    if (!Number.isFinite(options.initialSourceTimeSeconds) || options.initialSourceTimeSeconds < 0 || !Number.isSafeInteger(options.maxClients) || options.maxClients < 1 || options.maxClients >= 2048)
      throw new Error("Invalid dedicated QC source timing or reserved clients");
    this.currentTime = options.initialSourceTimeSeconds;
    if (binding.kind === "quakeworld" && options.maxClients > 32) throw new Error("Native QuakeWorld supports at most 32 clients");
    this.reservedClientSlots = binding.kind === "quakeworld" ? 32 : options.maxClients;
    options.actors.onRelease(actor => { this.activeClients.delete(actor.id); this.pendingWeapons.delete(actor.id); return undefined; });
    this.entities = new QcEntityMemory(classicQcEntityLayout(prepared.program), binding.kind === "quakeworld" ? 768 : 2048, this.reservedClientSlots + 1);
    this.slots = new SourceActorSlots(options.actors, { provider: prepared.execution.owner.provider, capacity: this.entities.capacity,
      lifetime: quakeEdictLifetime(this.reservedClientSlots + 1), storage: createQcSourceSlotStorage({ program: prepared.program, entities: this.entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: binding.kind === "quakeworld" ? 100 : 92 }),
      now: () => ({ kind: "seconds", value: this.currentTime }), unlink: actor => options.physics.bodies.unlink(actor), exhausted: () => { throw new Error("QC source edicts exhausted"); } });
    if (options.restore === undefined) for (let slot = 0; slot <= this.reservedClientSlots; slot++) this.slots.bindExisting(slot, slot === 0 ? "quakec:worldspawn" : "quakec:reserved-client");
    this.modelCount = options.world.models.length + 1;
    this.models.set(options.recipe.map.geometry.requestedPath, { index: 1, bounds: options.scene.modelBounds(0) });
    for (let model = 1; model < options.world.models.length; model++) this.models.set(`*${model}`, { index: model + 1, bounds: options.scene.modelBounds(model) });
    this.worldHost = new QcWorldHost({ program: prepared.program, entities: this.entities, actors: options.actors, slots: this.slots,
      bodies: options.physics.bodies, scene: options.scene, numeric: Q1_DONOR_PROFILE,
      model: name => name === "" ? { index: 0, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } } : this.models.get(name) ?? null,
      foreignReference: () => { throw new Error("Dedicated id1 QC does not admit foreign source actors"); }, admit: (actor, slot) => this.admit(actor, slot) });
    this.cvars = options.sourceRegistry ?? new CvarRegistry({ dialect: prepared.program.api.kind, context: { session: options.actors.session, origin: { kind: "server-console" } }, print: options.print });
    if (options.sourceRegistry === undefined) for (const [name, value] of Object.entries({ skill: String(options.skill), deathmatch: options.mode === "deathmatch" ? "1" : "0", coop: options.mode === "coop" ? "1" : "0",
      teamplay: "0", sv_cheats: "0", sv_aim: "0.93", sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", registered: "1" })) this.cvars.register(name, value);
    this.clients = new QcClientHost(this.worldHost, { scene: options.scene, maxClients: this.reservedClientSlots, serverTime: () => this.currentTime });
    const qw: QcQuakeWorldMessageServices | undefined = binding.kind === "quakeworld" ? {
      loading: () => this.spawning, client: actor => this.isReservedClient(actor), phs: () => this.cvars.variableValue("sv_phs") !== 0,
      route: (entries, destination) => { if (destination.kind === "signon") this.signon.push(...entries); else this.routed.push({ entries, destination }); return undefined; },
    } : undefined;
    const presentation = createQcPresentationBindings(this.worldHost, { ...(qw === undefined ? {} : { qw }), content: prepared.execution.owner.content, events: options.events,
      loading: () => this.spawning, print: options.print, message: (event, actor) => { if (!this.activeClients.has(actor)) throw new Error("QC message requires an admitted client"); return options.events.message(event, actor); }, precache: (kind, name) => this.precache(kind, name), lookup: (kind, name) => this.precached.get(`${kind}:${name}`) ?? null });
    const movement = createQcMovementBindings(this.worldHost, { scene: options.scene, random: options.random, touchTriggers: actor => options.physics.touchTriggers(actor) });
    this.messages = new QcBroadcastMessages(this.worldHost, event => options.events.emit(prepared.execution.owner.content, { kind: "q1", event }), qw);
    const host = new Map([...this.worldHost.host, ...presentation, ...movement, ...this.clients.host, ...this.messages.host]);
    host.set("cvar", vm => { vm.returnFloat(this.cvars.variableValue(vm.argString(0))); });
    host.set("changelevel", vm => {
      if (this.changeLevelIssued) return undefined;
      this.changeLevelIssued = true;
      return options.changeLevel(vm.argString(0));
    });
    host.set("cvar_set", vm => { const name = vm.argString(0); this.cvars.set(name, vm.argString(1)); if (name === "sv_gravity") options.physics.setWorldGravity(this.cvars.variableValue(name)); });
    const aim = createQcAimBinding(this.worldHost, { aimThreshold: () => this.cvars.variableValue("sv_aim"), teamplay: () => this.cvars.variableValue("teamplay") });
    host.set("aim", vm => {
      if (binding.kind === "quakeworld" && nativeAtoi(this.userInfo.get(this.entities.slot(vm.argInt(0)))?.get("noaim") ?? "0") > 0) {
        vm.returnVector(vm.globals.vector(vm.globalOffset("v_forward"))); return undefined;
      }
      return aim(vm);
    });
    if (binding.kind === "quakeworld") {
      registerQuakeWorldEngineCvars(this.cvars);
      host.set("infokey", vm => {
        const slot = this.entities.slot(vm.argInt(0)), key = vm.argString(1);
        const value = this.userInfo.get(slot)?.get(key) ?? (slot === 0 ? this.cvars.variableString(key) : "");
        vm.returnInt(vm.strings.setEngine(`qw-infokey:${slot}:${key}`, value, 1024));
      });
      host.set("logfrag", vm => {
        const killer = this.slots.at(this.entities.slot(vm.argInt(0))), victim = this.slots.at(this.entities.slot(vm.argInt(1)));
        if (killer !== null && victim !== null && this.isReservedClient(killer.id) && this.isReservedClient(victim.id)) this.fragRecords.push({ killer: killer.id, victim: victim.id });
      });
    }
    this.attacks = new Id1SynchronousAttacks(this.worldHost.options, () => this.machine);
    this.projectiles = new Id1ProjectileAttacks(this.worldHost.options, () => this.machine);
    this.environment = new Id1Environment(this.worldHost.options, () => this.machine);
    const damage = new Id1DamageBinding(this.worldHost.options, options.combat, () => this.machine, options.damageRequest);
    this.machine = new QcMachine({ program: prepared.program, entities: this.entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind: binding.kind, random: options.random, host, isFreeEntity: this.worldHost.isFreeEntity }), serverActive: () => !this.spawning,
      functionBoundary: this.projectiles.compose(this.attacks.compose(damage.functionBoundary)), observeCall: call => damage.observeCall(call),
      observeEntityStore: store => { this.projectiles.observeStore(store); return damage.observeEntityStore(store); } });
    const pushers = createQcPusherServices(this.worldHost, this.machine, { physical: projection => options.physics.q1PusherServices(projection),
      foreign: { read: actor => options.physics.readQ1Pusher(actor), write: entity => options.physics.writeQ1Pusher(entity) },
      touchTriggers: actor => options.physics.touchTriggers(actor), serverTime: () => this.currentTime });
    this.pusherServices = { ...pushers, blocked: (actor, other) => {
      const slot = this.sourceSlot(actor.id); if (slot === null) throw new Error("Missing live blocked QC actor");
      const prior = this.physicsCallback;
      this.physicsCallback = { kind: "blocked", actor: actor.id, other, functionIndex: this.entities.at(slot).int(this.field("blocked")) };
      try { return pushers.blocked(actor, other); } finally { this.physicsCallback = prior; }
    } };
    if (options.restore === undefined) {
      for (let slot = 0; slot <= this.reservedClientSlots; slot++) this.worldHost.actor(slot);
    } else {
      restoreQcCheckpoint(this.machine, this.module, this.checkpointHost(), options.restore.checkpoint);
      for (let slot = 0; slot < this.entities.count; slot++) {
        const actor = this.slots.at(slot);
        if (actor === null) {
          if (slot <= this.reservedClientSlots || !this.slots.options.storage.read(slot).free) throw new Error("Saved QC edict has no restored actor");
          continue;
        }
        if (slot > this.reservedClientSlots && this.slots.options.storage.read(slot).free) throw new Error("Saved free QC edict has a live actor");
        this.worldHost.actor(slot);
        if (this.activeClients.has(actor.id)) this.bindClientInventory(actor, slot);
      }
    }
  }
  private get module(): ModuleIdentity {
    const execution = this.prepared.execution;
    return { id: execution.owner.provider, artifactPath: execution.artifact.requestedPath, digest: execution.artifact.digest, revision: execution.artifact.digest };
  }
  checkpoint(): QuakeCCheckpoint {
    if (this.spawning || this.physicsCallback !== null) throw new Error("QC save requires a completed source frame");
    for (const slot of this.clientIdentities.keys()) {
      const actor = this.slots.at(slot);
      if (actor === null || !this.activeClients.has(actor.id)) throw new Error("QC save requires pending client handshakes to finish");
    }
    this.attacks.assertIdle();
    return captureQcCheckpoint(this.machine, this.module, this.checkpointHost());
  }
  captureOriginalSave(format: Q1SaveData["format"], comment: string): Q1SaveData {
    const actor = this.slots.at(1), parameters = this.spawnParameters.get(1);
    if (actor === null || !this.activeClients.has(actor.id) || parameters === undefined) throw new Error("Original Quake save requires an active source client");
    return captureQ1SourceSave(this, format, comment, parameters, this.originalSaveExtensionText);
  }
  restoreOriginalSave(save: Q1SaveData): ReturnType<typeof restoreQ1SourceSave> {
    if (this.options.originalSaveCandidate !== true || this.originalSaveRestored) throw new Error("Original Quake restore requires a fresh staged candidate");
    const actor = this.slots.at(1);
    if (actor === null || !this.activeClients.has(actor.id)) throw new Error("Original Quake restore requires an active source client binding");
    this.originalSaveRestored = true;
    return restoreQ1SourceSave(this, save, header => {
      this.currentTime = header.time; this.spawnParameters.set(1, [...header.spawnParameters]);
      this.changeLevelIssued = false; this.pendingWeapons.clear(); this.originalSaveExtensionText = save.extensionText;
      return undefined;
    });
  }
  private checkpointHost(): QcExecutorHost {
    return { checkpoint: () => ({ state: { module: this.module, format: "quakec:source-v1", bytes: encodeCheckpointValue({
      kind: this.kind, maxClients: this.options.maxClients, reservedClientSlots: this.reservedClientSlots, currentTime: this.currentTime,
      changeLevelIssued: this.changeLevelIssued, spawning: this.spawning, activeClients: [...this.activeClients].map(savedQcActor),
      pendingWeapons: [...this.pendingWeapons].map(([actor, pending]) => ({ actor: savedQcActor(actor), weapon: pending.weapon.item, following: pending.following })),
      userInfo: [...this.userInfo].map(([slot, values]) => ({ slot, values: [...values].map(([key, value]) => ({ key, value })) })),
      spectatorSlots: [...this.spectatorSlots], originalSaveExtensionText: this.originalSaveExtensionText,
      spawnParameters: [...this.spawnParameters].map(([slot, values]) => ({ slot, values })),
      clientIdentities: [...this.clientIdentities].map(([slot, client]) => ({ slot, clientSlot: client.slot })), preparedClients: [...this.preparedClients],
      fragRecords: this.fragRecords.map(entry => ({ killer: savedQcActor(entry.killer), victim: savedQcActor(entry.victim) })),
      routed: this.routed.map(entry => ({ entries: this.messages.captureEntries(entry.entries), destination: captureQcDestination(entry.destination) })),
      signon: this.messages.captureEntries(this.signon), models: [...this.models].map(([name, model]) => ({ name, ...model })),
      precached: [...this.precached].map(([key, entry]) => ({ key, index: entry.index, id: entry.resource.id, digest: entry.resource.digest })),
      modelCount: this.modelCount, soundCount: this.soundCount, cvars: this.cvars.captureQuakeCState(),
      visibility: this.clients.visibility.capture(), messages: this.messages.capture(), projectiles: this.projectiles.capture(),
    }) }, random: [], callbacks: [] }), restore: saved => {
      if (saved.state.format !== "quakec:source-v1" || saved.random.length !== 0 || saved.callbacks.length !== 0) throw new Error("Unsupported QC source host checkpoint");
      this.restoreHost(decodeCheckpointValue(saved.state.bytes)); return undefined;
    } };
  }
  private restoreHost(value: unknown): void {
    const reader = new SaveReader(value, "quakec.source"), restore = this.options.restore;
    if (restore === undefined) return reader.fail("missing restore clients");
    reader.field("kind").literal(this.kind); reader.field("maxClients").literal(this.options.maxClients);
    reader.field("reservedClientSlots").literal(this.reservedClientSlots); reader.field("spawning").literal(false);
    this.spawning = false; this.currentTime = reader.field("currentTime").finite();
    if (this.currentTime < 0) reader.fail("negative source frame-entry time");
    this.changeLevelIssued = reader.field("changeLevelIssued").boolean();
    const extension = reader.field("originalSaveExtensionText");
    this.originalSaveExtensionText = extension.value === undefined ? "" : extension.string();
    const reference = (entry: SaveReader) => this.options.actors.referenceSaved({ slot: entry.field("slot").integer(0), generation: entry.field("generation").integer(0) });
    const live = (entry: SaveReader) => { const actor = reference(entry); if (this.sourceSlot(actor) === null) entry.fail("missing live QC actor"); return actor; };
    const clientSlot = (entry: SaveReader) => { const slot = entry.integer(1); if (slot > this.reservedClientSlots) entry.fail("invalid reserved client slot"); return slot; };
    this.activeClients.clear(); for (const actor of reader.field("activeClients").list(live)) {
      if (!this.isReservedClient(actor) || this.activeClients.has(actor)) reader.fail("invalid active QC client"); this.activeClients.add(actor);
    }
    this.pendingWeapons.clear(); for (const entry of reader.field("pendingWeapons").list(item => item)) {
      const actor = live(entry.field("actor")), weapon = this.weapons.find(weapon => weapon.item === namespaced(entry.field("weapon")));
      if (weapon === undefined || !this.activeClients.has(actor) || this.pendingWeapons.has(actor)) return entry.fail("invalid pending weapon");
      this.pendingWeapons.set(actor, { weapon, following: entry.field("following").boolean() });
    }
    this.userInfo.clear(); for (const entry of reader.field("userInfo").list(item => item)) {
      const slot = clientSlot(entry.field("slot")); if (this.userInfo.has(slot)) entry.fail("duplicate userinfo slot");
      this.userInfo.set(slot, new Map(entry.field("values").list(item => [item.field("key").string(), item.field("value").string()] satisfies [string, string])));
    }
    this.spawnParameters.clear(); for (const entry of reader.field("spawnParameters").list(item => item)) {
      const slot = clientSlot(entry.field("slot")), values = entry.field("values").list(item => item.number());
      if (values.length !== 16 || this.spawnParameters.has(slot)) entry.fail("invalid spawn parameters"); this.spawnParameters.set(slot, values);
    }
    this.clientIdentities.clear(); for (const entry of reader.field("clientIdentities").list(item => item)) {
      const slot = clientSlot(entry.field("slot")), clientSlotValue = entry.field("clientSlot").integer(0);
      const client = restore.clients.find(client => client.slot === clientSlotValue);
      if (slot !== clientSlotValue + 1 || client === undefined || this.clientIdentities.has(slot)) return entry.fail("missing restored QC client identity");
      this.clientIdentities.set(slot, client);
    }
    this.spectatorSlots.clear();
    const spectators = reader.field("spectatorSlots");
    if (spectators.value !== undefined) for (const slot of spectators.list(clientSlot)) {
      if (this.kind !== "quakeworld" || !this.clientIdentities.has(slot) || this.spectatorSlots.has(slot)) spectators.fail("invalid spectator slot");
      this.spectatorSlots.add(slot);
    }
    this.preparedClients.clear(); for (const slot of reader.field("preparedClients").list(clientSlot)) {
      if (this.preparedClients.has(slot) || !this.clientIdentities.has(slot)) reader.fail("invalid prepared client phase"); this.preparedClients.add(slot);
    }
    if (this.activeClients.size !== this.clientIdentities.size) reader.fail("client phase identity mismatch");
    for (const actor of this.activeClients) {
      const slot = this.sourceSlot(actor);
      if (slot === null || !this.clientIdentities.has(slot) || (this.kind === "quakeworld" && !this.preparedClients.has(slot))) reader.fail("incomplete saved client phase");
    }
    this.fragRecords.length = 0; this.fragRecords.push(...reader.field("fragRecords").list(item => ({ killer: reference(item.field("killer")), victim: reference(item.field("victim")) })));
    const resolve = (saved: Parameters<SessionActorRegistry["referenceSaved"]>[0]) => this.options.actors.referenceSaved(saved);
    this.routed.length = 0; this.routed.push(...reader.field("routed").list(item => ({ entries: this.messages.restoreEntries(item.field("entries").value, resolve), destination: readQcDestination(item.field("destination"), resolve) })));
    this.signon.length = 0; this.signon.push(...this.messages.restoreEntries(reader.field("signon").value, resolve));
    const vector = (item: SaveReader): Vec3 => ({ x: item.field("x").finite(), y: item.field("y").finite(), z: item.field("z").finite() });
    this.models.clear(); for (const entry of reader.field("models").list(item => item)) {
      const name = entry.field("name").string(), bounds = entry.field("bounds");
      if (this.models.has(name)) entry.fail("duplicate model");
      this.models.set(name, { index: entry.field("index").integer(1), bounds: { min: vector(bounds.field("min")), max: vector(bounds.field("max")) } });
    }
    this.precached.clear(); for (const entry of reader.field("precached").list(item => item)) {
      const key = entry.field("key").string(), colon = key.indexOf(":"), name = key.slice(colon + 1);
      const resource = this.prepared.resources.get(name)?.resource;
      if (colon < 1 || resource === undefined || resource.id !== entry.field("id").string() || resource.digest !== entry.field("digest").string() || this.precached.has(key)) return entry.fail("saved precache resource differs from mounted content");
      this.precached.set(key, { index: entry.field("index").integer(1), resource });
    }
    this.modelCount = reader.field("modelCount").integer(1); this.soundCount = reader.field("soundCount").integer(1);
    this.cvars.restoreQuakeCState(reader.field("cvars").value); this.clients.visibility.restore(reader.field("visibility").value);
    this.messages.restore(reader.field("messages").value, resolve); this.projectiles.restore(reader.field("projectiles").value);
  }
  get currentPhysicsCallback(): QuakeCPhysicsCallback | null { return this.physicsCallback; }
  get worldActor(): OwnedActor { return this.worldHost.actor(0); }
  get timeSeconds(): number { return this.currentTime; }
  get loading(): boolean { return this.spawning; }
  get kind(): "netquake" | "quakeworld" { return id1ProgramBinding(this.prepared.program).kind; }
  deathType(actor: ActorId): string {
    const field = this.prepared.program.fieldsByName.get("deathtype");
    return field === undefined ? "" : this.machine.strings.get(this.entities.fromReference(this.reference(actor)).int(field.offset));
  }
  setClientInfo(client: ClientId, values: ReadonlyMap<string, string>): void {
    if (client.slot < 0 || client.slot >= this.options.maxClients) throw new Error("QC userinfo slot is unavailable");
    this.userInfo.set(client.slot + 1, new Map(values));
    const actor = this.slots.at(client.slot + 1);
    if (actor !== null && (this.activeClients.has(actor.id) || this.preparedClients.has(client.slot + 1))) this.entities.at(client.slot + 1).setInt(this.field("netname"),
      this.kind === "quakeworld" ? this.machine.strings.setEngine(`qw-name:${client.slot + 1}`, values.get("name") ?? "unnamed", 32) : this.machine.strings.allocate(values.get("name") ?? "unnamed"));
  }
  setClientRole(client: ClientId, role: "player" | "spectator"): void {
    if (role === "spectator" && this.kind !== "quakeworld") throw new Error("Spectator clients require the QuakeWorld host ABI");
    const actor = this.reservedClient(client), slot = client.slot + 1;
    if (this.activeClients.has(actor.id)) throw new Error("QC client role must be selected before begin");
    if (role === "spectator") this.spectatorSlots.add(slot); else this.spectatorSlots.delete(slot);
  }
  isSpectatorClient(actor: ActorId): boolean {
    const slot = this.sourceSlot(actor);
    return slot !== null && this.kind === "quakeworld" && this.spectatorSlots.has(slot);
  }
  private spectatorCallback(name: "SpectatorConnect" | "SpectatorThink" | "SpectatorDisconnect", slot: number): undefined {
    const callback = this.prepared.program.functionsByName.get(name);
    if (callback !== undefined && callback.index !== 0) this.invoke(callback.index, slot, 0, this.currentTime);
    return undefined;
  }
  reservedClient(client: ClientId): OwnedActor {
    if (client.slot < 0 || client.slot >= this.options.maxClients || this.spawning) throw new Error("QC reserved client is unavailable");
    const existing = this.clientIdentities.get(client.slot + 1);
    if (existing !== undefined && !existing.equals(client)) throw new Error("QC client slot still belongs to an earlier connection");
    this.clientIdentities.set(client.slot + 1, client);
    if (!this.spawnParameters.has(client.slot + 1)) {
      this.invoke(this.prepared.program.functionNamed("SetNewParms").index, 0, 0, this.currentTime);
      this.spawnParameters.set(client.slot + 1, Array.from({ length: 16 }, (_, index) => this.machine.globals.float(this.machine.globalOffset(`parm${index + 1}`))));
    }
    return this.worldHost.actor(client.slot + 1);
  }
  clientInfo(client: ClientId): ReadonlyMap<string, string> { return this.userInfo.get(client.slot + 1) ?? new Map<string, string>(); }
  captureTravel(): QuakeCSourceTravel {
    if (this.spawning) throw new Error("Native QuakeC travel requires a loaded source world");
    const serverFlags = this.machine.globals.float(this.machine.globalOffset("serverflags"));
    const clients: QuakeCSourceTravel["clients"][number][] = [];
    for (const [slot, client] of [...this.clientIdentities].sort(([a], [b]) => a - b)) {
      const actor = this.slots.at(slot);
      if (actor !== null && this.activeClients.has(actor.id)) {
        this.invoke(this.prepared.program.functionNamed("SetChangeParms").index, slot, 0, this.currentTime);
        this.spawnParameters.set(slot, Array.from({ length: 16 }, (_, index) => this.machine.globals.float(this.machine.globalOffset(`parm${index + 1}`))));
      }
      const parameters = this.spawnParameters.get(slot);
      if (parameters === undefined) throw new Error("Native QuakeC connection has no spawn parameters");
      clients.push({ client, role: this.spectatorSlots.has(slot) ? "spectator" : "player", parameters: [...parameters], userInfo: new Map(this.userInfo.get(slot)) });
    }
    return { kind: this.kind, serverFlags, clients, cvars: this.cvars.snapshots().map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value })) };
  }
  restoreTravel(travel: QuakeCSourceTravel): void {
    if (travel.kind !== this.kind || !this.spawning || this.clientIdentities.size !== 0) throw new Error("Native QuakeC travel requires a fresh source world with the same ABI");
    this.machine.globals.setFloat(this.machine.globalOffset("serverflags"), travel.serverFlags);
    for (const variable of travel.cvars) {
      if (this.cvars.get(variable.name) === undefined) this.cvars.register(variable.name, variable.value);
      this.cvars.set(variable.name, variable.value, true);
    }
    for (const record of travel.clients) {
      const slot = record.client.slot + 1;
      if (slot < 1 || slot > this.reservedClientSlots || this.clientIdentities.has(slot) || record.parameters.length !== 16 || record.parameters.some(value => !Number.isFinite(value)))
        throw new Error("Invalid native QuakeC travel client parameters");
      if (record.role === "spectator") {
        if (this.kind !== "quakeworld") throw new Error("NetQuake travel cannot contain a spectator");
        this.spectatorSlots.add(slot);
      }
      this.clientIdentities.set(slot, record.client); this.spawnParameters.set(slot, [...record.parameters]); this.userInfo.set(slot, new Map(record.userInfo));
    }
  }
  prepareClientSpawn(client: ClientId): void {
    const actor = this.reservedClient(client), slot = client.slot + 1;
    if (this.kind !== "quakeworld" || this.activeClients.has(actor.id)) throw new Error("QW spawn requires an inactive reserved client");
    const words = this.entities.at(slot); words.bytes.fill(0);
    words.setFloat(this.field("colormap"), slot); words.setFloat(this.field("team"), 0);
    words.setInt(this.field("netname"), this.machine.strings.setEngine(`qw-name:${slot}`, this.userInfo.get(slot)?.get("name") ?? "unnamed", 32));
    for (const [name, value] of [["gravity", 1], ["maxspeed", this.cvars.variableValue("sv_maxspeed")]] satisfies readonly (readonly [string, number])[]) {
      const field = this.prepared.program.fieldsByName.get(name); if (field !== undefined) words.setFloat(field.offset, value);
    }
    this.preparedClients.add(slot);
  }
  drainFragLog(): readonly { readonly killer: ActorId; readonly victim: ActorId }[] { return this.fragRecords.splice(0); }
  drainMessages(): readonly { readonly entries: readonly QcRoutedMessage[]; readonly destination: QcMessageDestination }[] { this.messages.flush(); return this.routed.splice(0); }
  signonMessages(): readonly QcRoutedMessage[] { return this.signon; }
  precacheNames(kind: "model" | "sound"): readonly string[] {
    if (kind === "model") return [...this.models.entries()].sort((a, b) => a[1].index - b[1].index).map(([name]) => name);
    return [...this.precached.entries()].filter(([key]) => key.startsWith("sound:")).sort((a, b) => a[1].index - b[1].index).map(([key]) => key.slice(6));
  }
  private field(name: string): number { const field = this.prepared.program.fieldsByName.get(name); if (field === undefined) throw new Error(`Missing id1 field ${name}`); return field.offset; }
  sourceSlot(actor: ActorId): number | null {
    if (!this.options.actors.isLive(actor)) return null;
    const source = this.options.actors.sourceOf(actor); return source?.provider === this.prepared.execution.owner.provider ? source.slot : null;
  }
  isReservedClient(actor: ActorId): boolean { const slot = this.sourceSlot(actor); return slot !== null && slot > 0 && slot <= this.reservedClientSlots; }
  isActiveClient(actor: ActorId): boolean { return this.activeClients.has(actor); }
  hostCheat(actor: ActorId, name: "god" | "notarget" | "noclip" | "fly" | "give", args: readonly string[] = []): undefined {
    const slot = this.sourceSlot(actor);
    if (slot === null || !this.activeClients.has(actor)) throw new Error("QC host command requires an admitted client");
    const message = (text: string) => this.options.events.message({ kind: "print", level: 2, text }, actor);
    // QW's server -cheats authority is represented by the source-owned server cvar.
    const denied = this.kind === "quakeworld" ? this.cvars.variableValue("sv_cheats") === 0
      : this.machine.globals.float(this.machine.globalOffset("deathmatch")) !== 0;
    if (denied) return message("Cheats are disabled on this server.\n");
    const words = this.entities.at(slot);
    if (name === "give") {
      this.hostGive(actor, slot, args);
      const refresh = this.prepared.program.functionsByName.get("W_SetCurrentAmmo");
      if (refresh !== undefined) this.invoke(refresh.index, slot, 0, this.currentTime);
      return undefined;
    }
    let enabled: boolean;
    if (name === "noclip" || name === "fly") {
      const moveType = name === "fly" ? 5 : 8;
      enabled = words.float(this.field("movetype")) !== moveType;
      words.setFloat(this.field("movetype"), enabled ? moveType : 3);
    } else {
      const bit = name === "god" ? 64 : 128, flags = Math.trunc(words.float(this.field("flags"))) ^ bit;
      words.setFloat(this.field("flags"), flags); enabled = (flags & bit) !== 0;
    }
    return message(`${name === "god" ? "godmode" : name} ${enabled ? "ON" : "OFF"}\n`);
  }
  private hostGive(actor: ActorId, slot: number, args: readonly string[]): undefined {
    const input = args[0]?.toLowerCase(); if (input === undefined) throw new Error("Usage: give <all|weapons|ammo|health|armor|keys|item> [amount]");
    const words = this.entities.at(slot), all = input === "all", amount = args[1] === undefined ? undefined : nativeAtoi(args[1]);
    const write = (name: string, value: number) => { words.setFloat(this.field(name), value); };
    const addItems = (bits: number) => write("items", Math.trunc(words.float(this.field("items"))) | bits);
    if (all || input === "health" || input === "h") { write("health", amount ?? (input === "h" ? 0 : 100)); if (!all) return undefined; }
    if (all || input === "armor" || input === "a") {
      const points = amount ?? (input === "a" ? 0 : 200), armorBit = points > 150 ? 32768 : points > 100 ? 16384 : points > 0 ? 8192 : 0;
      write("items", (Math.trunc(words.float(this.field("items"))) & ~(8192 | 16384 | 32768)) | armorBit);
      write("armorvalue", points); write("armortype", points > 150 ? 0.8 : points > 100 ? 0.6 : points > 0 ? 0.3 : 0);
      if (!all) return undefined;
    }
    if (all || input === "weapons") { for (const weapon of this.weapons) addItems(weapon.bit); if (!all) return undefined; }
    if (all || input === "ammo") {
      for (const [field, value] of [["ammo_shells", 100], ["ammo_nails", 200], ["ammo_rockets", 100], ["ammo_cells", 100]] satisfies readonly (readonly [string, number])[]) write(field, value);
      for (const field of ["ammo_shells1", "ammo_nails1", "ammo_rockets1", "ammo_cells1", "ammo_lava_nails", "ammo_multi_rockets", "ammo_plasma"]) {
        const definition = this.prepared.program.fieldsByName.get(field); if (definition !== undefined) words.setFloat(definition.offset, field.includes("nails") ? 200 : 100);
      }
      if (!all) return undefined;
    }
    if (all || input === "keys") { addItems(131072 | 262144); return undefined; }
    if (input === "items") {
      for (const item of ["quad", "pent", "ring", "suit"]) this.hostGive(actor, slot, [item]);
      return undefined;
    }
    const hipnotic = this.weapons.some(weapon => weapon.item === "q1:weapon/hipnotic:laser");
    const named = hipnotic && input === "6a" ? "q1:weapon/hipnotic:proximity" : hipnotic && input === "9" ? "q1:weapon/hipnotic:laser"
      : hipnotic && input === "0" ? "q1:weapon/hipnotic:mjolnir" : /^[2-8]$/.test(input) ? this.weapons[Number(input) - 1]?.item : undefined;
    const weapon = this.weapons.find(weapon => weapon.item === named || weapon.item === input || weapon.item.split("/").at(-1) === input);
    if (weapon !== undefined) { addItems(weapon.bit); return undefined; }
    const ammo = input === "s" || input === "shells" ? "ammo_shells" : input === "n" || input === "nails" ? "ammo_nails"
      : input === "r" || input === "rockets" ? "ammo_rockets" : input === "c" || input === "cells" ? "ammo_cells"
        : input === "l" ? "ammo_lava_nails" : input === "m" ? "ammo_multi_rockets" : input === "p" ? "ammo_plasma" : null;
    if (ammo !== null) {
      const value = amount ?? 0, alternate = this.prepared.program.fieldsByName.get(`${ammo}1`);
      if (alternate !== undefined) words.setFloat(alternate.offset, value);
      if (alternate === undefined || ammo === "ammo_shells" || words.float(this.field("weapon")) <= 64) write(ammo, value);
      const native = ammo === "ammo_lava_nails" ? "ammo_nails" : ammo === "ammo_multi_rockets" ? "ammo_rockets" : ammo === "ammo_plasma" ? "ammo_cells" : null;
      if (native !== null && words.float(this.field("weapon")) > 64) write(native, value);
      return undefined;
    }
    const classname = input === "quad" ? "item_artifact_super_damage" : input === "pent" ? "item_artifact_invulnerability"
      : input === "ring" ? "item_artifact_invisibility" : input === "suit" ? "item_artifact_envirosuit" : input;
    if (!classname.startsWith("item_") && !classname.startsWith("weapon_")) throw new Error(`Unknown QuakeC item: ${input}`);
    let template: Uint8Array | null = null;
    for (let candidate = this.reservedClientSlots + 1; candidate < this.entities.count; candidate++) {
      const owner = this.slots.at(candidate), source = this.entities.at(candidate);
      if (owner !== null && this.options.actors.isLive(owner.id) && source.int(this.field("touch")) !== 0
        && this.machine.strings.get(source.int(this.field("classname"))) === classname) { template = source.bytes.slice(); break; }
    }
    if (template === null) throw new Error(`Cannot give ${classname}: this map has no source item template`);
    this.machine.execute(this.prepared.program.functionNamed("spawn").index);
    const reference = this.machine.globals.int(1), itemSlot = this.entities.slot(reference), item = this.worldHost.actor(itemSlot), itemWords = this.entities.at(itemSlot);
    try {
      itemWords.bytes.set(template); itemWords.setVector(this.field("origin"), words.vector(this.field("origin")));
      itemWords.setFloat(this.field("solid"), 1); itemWords.setFloat(this.field("nextthink"), 0);
      for (const name of ["target", "targetname", "killtarget"]) {
        const field = this.prepared.program.fieldsByName.get(name); if (field !== undefined) itemWords.setInt(field.offset, 0);
      }
      const touch = itemWords.int(this.field("touch"));
      this.invoke(touch, itemSlot, this.reference(actor), this.currentTime);
    } finally { if (this.options.actors.isLive(item.id)) this.options.actors.release(item); }
    return undefined;
  }
  admitClient(client: ClientId): OwnedActor {
    const slot = client.slot + 1;
    if (slot > this.options.maxClients || this.spawning) throw new Error("QC client slot is unavailable");
    const reserved = this.reservedClient(client);
    if (this.activeClients.has(reserved.id)) throw new Error("QC reserved client is active");
    if (this.classname(reserved.id) === "player") this.options.actors.release(reserved);
    const actor = this.worldHost.actor(slot);
    const words = this.entities.at(slot);
    const parameters = this.spawnParameters.get(slot);
    if (parameters === undefined) throw new Error("Native QuakeC client has no source spawn parameters");
    if (this.kind === "quakeworld") {
      if (!this.preparedClients.has(slot)) throw new Error("QW begin requires completed source spawn preparation");
    } else {
      words.bytes.fill(0);
      words.setFloat(this.field("colormap"), slot); words.setFloat(this.field("team"), 1);
      words.setInt(this.field("netname"), this.machine.strings.allocate(this.userInfo.get(slot)?.get("name") ?? `Player ${slot}`));
    }
    const spectator = this.spectatorSlots.has(slot), spectatorConnect = this.prepared.program.functionsByName.get("SpectatorConnect");
    if (!spectator || spectatorConnect !== undefined && spectatorConnect.index !== 0)
      for (const [index, value] of parameters.entries()) this.machine.globals.setFloat(this.machine.globalOffset(`parm${index + 1}`), value);
    this.activeClients.add(actor.id);
    this.bindClientInventory(actor, slot);
    if (spectator) {
      words.setVector(this.field("origin"), { x: 0, y: 0, z: 0 });
      words.setVector(this.field("view_ofs"), { x: 0, y: 0, z: 22 });
      for (let candidate = this.reservedClientSlots - 1; candidate < this.entities.count; candidate++) {
        const entity = this.entities.at(candidate);
        if (this.machine.strings.get(entity.int(this.field("classname"))) !== "info_player_start") continue;
        words.setVector(this.field("origin"), entity.vector(this.field("origin"))); break;
      }
      this.spectatorCallback("SpectatorConnect", slot);
    } else {
      this.invoke(this.prepared.program.functionNamed("ClientConnect").index, slot, 0, this.currentTime);
      this.invoke(this.prepared.program.functionNamed("PutClientInServer").index, slot, 0, this.currentTime);
    }
    return actor;
  }
  clientKill(actor: ActorId): boolean {
    const slot = this.sourceSlot(actor);
    if (slot === null || !this.activeClients.has(actor) || this.isSpectatorClient(actor) || this.entities.at(slot).float(this.field("health")) <= 0) return false;
    this.invoke(this.prepared.program.functionNamed("ClientKill").index, slot, 0, this.currentTime);
    return true;
  }
  hasClient(client: ClientId): boolean { return this.clientIdentities.get(client.slot + 1)?.equals(client) === true; }
  disconnectClient(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id);
    if (slot === null || !this.isReservedClient(actor.id)) throw new Error("QC disconnect requires a reserved client");
    if (this.activeClients.has(actor.id)) {
      if (this.isSpectatorClient(actor.id)) this.spectatorCallback("SpectatorDisconnect", slot);
      else this.invoke(this.prepared.program.functionNamed("ClientDisconnect").index, slot, 0, this.currentTime);
    }
    this.spectatorSlots.delete(slot);
    this.activeClients.delete(actor.id);
    this.pendingWeapons.delete(actor.id);
    this.preparedClients.delete(slot); this.spawnParameters.delete(slot); this.userInfo.delete(slot); this.clientIdentities.delete(slot);
    return undefined;
  }
  private bindClientInventory(actor: OwnedActor, slot: number): undefined {
    const words = this.entities.at(slot), itemOffset = this.field("items");
    const weapons = this.weapons;
    const ammo: readonly { readonly item: ItemId; readonly field: string; readonly capacity: number }[] = [
      { item: "q1:ammo/shells", field: "ammo_shells", capacity: 100 }, { item: "q1:ammo/nails", field: "ammo_nails", capacity: 200 },
      { item: "q1:ammo/rockets", field: "ammo_rockets", capacity: 100 }, { item: "q1:ammo/cells", field: "ammo_cells", capacity: 100 },
    ];
    return this.options.inventory.bind(actor, {
      read: () => [...weapons.map(entry => ({ item: entry.item, count: (Math.trunc(words.float(itemOffset)) & entry.bit) === 0 ? 0 : 1, capacity: 1 })),
        ...ammo.map((entry): InventoryEntry => ({ item: entry.item, count: words.float(this.field(entry.field)), capacity: entry.capacity,
          countPolicy: { kind: "source-counter", arithmetic: "binary32" } }))],
      write: entry => {
        const weapon = weapons.find(value => value.item === entry.item), counter = ammo.find(value => value.item === entry.item);
        if (weapon !== undefined) { const bits = Math.trunc(words.float(itemOffset)); words.setFloat(itemOffset, entry.count > 0 ? bits | weapon.bit : bits & ~weapon.bit); }
        else if (counter !== undefined) words.setFloat(this.field(counter.field), entry.count);
        else throw new Error(`Unsupported QC inventory field ${entry.item}`);
        return undefined;
      },
    });
  }
  clientInput(actor: ActorId, command: Q1UserCommand): undefined {
    const slot = this.sourceSlot(actor); if (slot === null || !this.activeClients.has(actor)) throw new Error("QC input requires an admitted client");
    const words = this.entities.at(slot);
    words.setVector(this.field("v_angle"), command.viewAngles);
    words.setFloat(this.field("button0"), command.buttons & 1); words.setFloat(this.field("button2"), (command.buttons >> 1) & 1);
    if (command.impulse !== 0) { this.pendingWeapons.delete(actor); words.setFloat(this.field("impulse"), command.impulse); }
    return undefined;
  }
  readQuakeWorldState(actor: ActorId, state: QwMovementState): QwMovementState {
    const words = this.entities.fromReference(this.reference(actor)), origin = words.vector(this.field("origin")), mins = words.vector(this.field("mins"));
    return { ...state, origin: { x: origin.x + mins.x + 16, y: origin.y + mins.y + 16, z: origin.z + mins.z + 24 },
      velocity: words.vector(this.field("velocity")), angles: words.vector(this.field("v_angle")),
      waterJumpTimeSeconds: words.float(this.field("teleport_time")), dead: words.float(this.field("health")) <= 0,
      spectator: this.isSpectatorClient(actor) ? 1 : 0 };
  }
  writeQuakeWorldState(actor: ActorId, state: QwMovementState): undefined {
    const words = this.entities.fromReference(this.reference(actor)), mins = words.vector(this.field("mins"));
    words.setVector(this.field("origin"), { x: state.origin.x - mins.x - 16, y: state.origin.y - mins.y - 16, z: state.origin.z - mins.z - 24 });
    words.setVector(this.field("velocity"), state.velocity); words.setVector(this.field("v_angle"), state.angles);
    words.setFloat(this.field("teleport_time"), state.waterJumpTimeSeconds);
    const grounded = state.ground.kind !== "none";
    words.setFloat(this.field("flags"), (Math.trunc(words.float(this.field("flags"))) & ~512) | (grounded ? 512 : 0));
    if (grounded) words.setInt(this.field("groundentity"), state.ground.kind === "actor" ? this.reference(state.ground.actor) : 0);
    return undefined;
  }
  quakeWorldWater(actor: ActorId, level: number, type: number): undefined {
    const words = this.entities.fromReference(this.reference(actor));
    words.setFloat(this.field("waterlevel"), level); words.setFloat(this.field("watertype"), type); return undefined;
  }
  quakeWorldProfile(actor: ActorId, profile: QwMovementProfile): QwMovementProfile {
    const words = this.entities.fromReference(this.reference(actor));
    const field = (name: string, fallback: number): number => { const value = this.prepared.program.fieldsByName.get(name); return value === undefined ? fallback : words.float(value.offset); };
    return { ...profile, parameters: { ...profile.parameters, gravity: this.cvars.variableValue("sv_gravity"),
      stopSpeed: this.cvars.variableValue("sv_stopspeed"), spectatorMaxSpeed: this.cvars.variableValue("sv_spectatormaxspeed"),
      accelerate: this.cvars.variableValue("sv_accelerate"), airAccelerate: this.cvars.variableValue("sv_airaccelerate"),
      waterAccelerate: this.cvars.variableValue("sv_wateraccelerate"), friction: this.cvars.variableValue("sv_friction"), waterFriction: this.cvars.variableValue("sv_waterfriction"),
      maxSpeed: field("maxspeed", this.cvars.variableValue("sv_maxspeed")), entityGravity: field("gravity", 1) } };
  }
  quakeWorldPreThink(actor: OwnedActor, command: QwUserCommand, frame: FrameContext): undefined {
    if (this.kind !== "quakeworld" || !this.activeClients.has(actor.id)) throw new Error("QW movement requires a begun native client");
    const words = this.entities.fromReference(this.reference(actor.id));
    if (words.float(this.field("fixangle")) === 0) {
      words.setVector(this.field("v_angle"), command.angles);
    }
    words.setFloat(this.field("button0"), command.buttons & 1); words.setFloat(this.field("button2"), (command.buttons >> 1) & 1);
    if (command.impulse !== 0) words.setFloat(this.field("impulse"), command.impulse);
    if (words.float(this.field("health")) > 0) {
      const angles = { ...words.vector(this.field("angles")) };
      if (words.float(this.field("fixangle")) === 0) { angles.x = -command.angles.x / 3; angles.y = command.angles.y; }
      const right = { x: 0, y: 0, z: 0 }, velocity = words.vector(this.field("velocity"));
      donorAngleVectors(angles, null, right, null);
      const side = velocity.x * right.x + velocity.y * right.y + velocity.z * right.z;
      angles.z = (Math.abs(side) < 200 ? Math.abs(side) * 2 / 200 : 2) * (side < 0 ? -1 : 1) * 4;
      words.setVector(this.field("angles"), angles);
    }
    if (this.isSpectatorClient(actor.id)) return undefined;
    this.machine.globals.setFloat(this.machine.globalOffset("frametime"), command.milliseconds * 0.001);
    this.clientPreThink(actor);
    return this.runThink(actor, { ...frame, time: { kind: "seconds", value: this.currentTime }, elapsed: { kind: "seconds", value: command.milliseconds * 0.001 } });
  }
  takeNewMissile(): OwnedActor | null {
    if (this.kind !== "quakeworld") return null;
    const offset = this.machine.globalOffset("newmis"), reference = this.machine.globals.int(offset);
    if (reference === 0) return null;
    this.machine.globals.setInt(offset, 0);
    return this.slots.at(this.entities.slot(reference));
  }
  runActorOnce(actor: ActorId, frame: FrameContext): boolean {
    if (this.kind !== "quakeworld") return true;
    const time = Math.fround(frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000);
    const words = this.entities.fromReference(this.reference(actor)), field = this.field("lastruntime");
    if (words.float(field) === time) return false;
    words.setFloat(field, time); return true;
  }
  readClientState(actor: ActorId, state: Q1MovementState): Q1MovementState {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("QC player has no source slot");
    const words = this.entities.at(slot), vector = (name: string) => words.vector(this.field(name)), scalar = (name: string) => words.float(this.field(name));
    return { ...state, origin: vector("origin"), velocity: vector("velocity"), angles: vector("angles"), oldOrigin: vector("oldorigin"),
      angularVelocity: vector("avelocity"), viewAngles: scalar("fixangle") !== 0 ? vector("angles") : vector("v_angle"), punchAngles: vector("punchangle"),
      moveType: scalar("movetype"), flags: Math.trunc(scalar("flags")), waterLevel: scalar("waterlevel"), waterType: scalar("watertype"),
      teleportTimeSeconds: scalar("teleport_time"), waterJumpDirection: vector("movedir"), idealPitch: scalar("idealpitch"), fixAngle: scalar("fixangle") !== 0, health: scalar("health") };
  }
  writeClientState(actor: ActorId, state: Q1MovementState): undefined {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("QC player has no source slot");
    const words = this.entities.at(slot);
    for (const [name, value] of [["oldorigin", state.oldOrigin], ["avelocity", state.angularVelocity], ["v_angle", state.viewAngles],
      ["punchangle", state.punchAngles], ["movedir", state.waterJumpDirection]] satisfies readonly (readonly [string, Vec3])[]) words.setVector(this.field(name), value);
    for (const [name, value] of [["movetype", state.moveType], ["flags", state.flags], ["waterlevel", state.waterLevel], ["watertype", state.waterType],
      ["teleport_time", state.teleportTimeSeconds], ["idealpitch", state.idealPitch], ["fixangle", Number(state.fixAngle)]] satisfies readonly (readonly [string, number])[]) words.setFloat(this.field(name), value);
    return undefined;
  }
  consumeClientViewReset(actor: ActorId): Vec3 | null {
    const slot = this.sourceSlot(actor); if (slot === null) return null;
    const words = this.entities.at(slot);
    if (words.float(this.field("fixangle")) === 0) return null;
    words.setFloat(this.field("fixangle"), 0);
    return words.vector(this.field("angles"));
  }
  requestClientWeapon(actor: ActorId, item: ItemId): boolean {
    const slot = this.sourceSlot(actor), weapon = this.weapons.find(weapon => weapon.item === item);
    if (slot === null || weapon === undefined || this.options.inventory.count(actor, item) <= 0) return false;
    const words = this.entities.at(slot), current = words.float(this.field("weapon"));
    this.pendingWeapons.delete(actor);
    if (current === weapon.bit) { words.setFloat(this.field("impulse"), 0); return true; }
    if (weapon.via !== undefined && current !== weapon.via && (Math.trunc(words.float(this.field("items"))) & weapon.via) !== 0)
      this.pendingWeapons.set(actor, { weapon, following: false });
    words.setFloat(this.field("impulse"), weapon.impulse);
    return true;
  }
  clientPreThink(actor: OwnedActor): undefined {
    if (this.isSpectatorClient(actor.id)) return undefined;
    const slot = this.sourceSlot(actor.id); if (slot === null) throw new Error("Missing QC client");
    this.invoke(this.prepared.program.functionNamed("PlayerPreThink").index, slot, 0, this.currentTime);
    return undefined;
  }
  clientPostThink(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) return undefined;
    if (this.isSpectatorClient(actor.id)) return this.spectatorCallback("SpectatorThink", slot);
    const words = this.entities.at(slot), pending = this.pendingWeapons.get(actor.id), impulse = words.float(this.field("impulse"));
    if (pending !== undefined && (this.options.inventory.count(actor.id, pending.weapon.item) <= 0 || words.float(this.field("health")) <= 0)) {
      this.pendingWeapons.delete(actor.id);
      if (impulse === pending.weapon.impulse) words.setFloat(this.field("impulse"), 0);
    } else if (pending !== undefined && impulse !== 0 && impulse !== pending.weapon.impulse) this.pendingWeapons.delete(actor.id);
    this.invoke(this.prepared.program.functionNamed("PlayerPostThink").index, slot, 0, this.currentTime);
    const selection = this.pendingWeapons.get(actor.id);
    if (selection !== undefined && words.float(this.field("impulse")) === 0) {
      this.pendingWeapons.delete(actor.id);
      if (!selection.following && words.float(this.field("weapon")) === selection.weapon.via && this.options.inventory.count(actor.id, selection.weapon.item) > 0) {
        this.pendingWeapons.set(actor.id, { weapon: selection.weapon, following: true });
        words.setFloat(this.field("impulse"), selection.weapon.impulse);
      }
    }
    return undefined;
  }
  clientArsenal(actor: ActorId): ArsenalState {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("Missing QC arsenal actor");
    const words = this.entities.at(slot), value = words.float(this.field("weapon"));
    const weapon = this.weapons.find(weapon => weapon.bit === value);
    if (weapon === undefined) throw new Error(`Unsupported actual QC weapon ${value}`);
    return { provider: this.prepared.execution.owner.provider, activeWeapon: weapon.item, ammo: this.options.inventory.entries(actor),
      state: { kind: "q1", sourceWeapon: value, frame: words.float(this.field("weaponframe")), attackFinishedSeconds: words.float(this.field("attack_finished")) } };
  }
  clientAnimation(actor: ActorId): ActorAnimationState {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("Missing QC animation actor");
    const words = this.entities.at(slot);
    return { provider: this.options.recipe.character.definition.provider, state: { kind: "q1", frame: words.float(this.field("frame")), nextFrameSeconds: words.float(this.field("nextthink")) } };
  }
  clientViewOffset(actor: ActorId): Vec3 {
    const words = this.entities.fromReference(this.reference(actor));
    if (this.kind === "quakeworld") return { x: 0, y: 0, z: words.vector(this.field("mins")).z !== -24 ? 8 : words.float(this.field("health")) <= 0 ? -16 : 22 };
    return words.vector(this.field("view_ofs"));
  }
  private reference(actor: ActorId): number { return this.worldHost.reference(actor); }
  private precache(kind: "model" | "sound", name: string): QcPrecachedResource {
    const key = `${kind}:${name}`, prior = this.precached.get(key); if (prior !== undefined) return prior;
    const resource = this.prepared.resources.get(name); if (resource === undefined) throw new Error(`Unprepared actual QC ${kind} resource ${name}`);
    const index = kind === "model" ? this.modelCount++ : this.soundCount++;
    if (index >= 256) throw new Error(`NetQuake ${kind} precache limit exceeded`);
    if (kind === "model") { if (resource.modelBounds === null) throw new Error(`Missing actual model bounds ${name}`); this.models.set(name, { index, bounds: resource.modelBounds }); }
    const value = { index, resource: resource.resource }; this.precached.set(key, value); return value;
  }
  private armor(slot: number): ArmorState {
    const words = this.entities.at(slot), items = Math.trunc(words.float(this.field("items")));
    const item = (items & 32768) !== 0 ? "q1:item_armorInv" : (items & 16384) !== 0 ? "q1:item_armor2" : (items & 8192) !== 0 ? "q1:item_armor1" : null;
    return item === null ? { kind: "none" } : { kind: "q1", item, points: words.float(this.field("armorvalue")), absorption: words.float(this.field("armortype")) };
  }
  private admit(actor: OwnedActor, slot: number): undefined {
    const words = this.entities.at(slot);
    this.options.combat.bind(actor, {
      admitDamage: () => { throw new Error("QC damage must enter the verified source function with explicit provenance"); },
      read: () => ({ health: words.float(this.field("health")), armor: this.armor(slot), mass: 200,
        canTakeDamage: words.float(this.field("takedamage")) !== 0, invulnerable: words.float(this.field("invincible_finished")) >= this.currentTime, team: null }),
      writeHealth: health => { words.setFloat(this.field("health"), health); return undefined; },
      writeArmor: armor => {
        if (armor.kind !== "none" && armor.kind !== "q1") throw new Error("Cannot store foreign armor in native id1 fields");
        words.setFloat(this.field("armorvalue"), armor.kind === "none" ? 0 : armor.points);
        words.setFloat(this.field("armortype"), armor.kind === "none" ? 0 : armor.absorption);
        const bit = armor.kind === "none" ? 0 : armor.item === "q1:item_armorInv" ? 32768 : armor.item === "q1:item_armor2" ? 16384 : 8192;
        words.setFloat(this.field("items"), (Math.trunc(words.float(this.field("items"))) & ~57344) | bit); return undefined;
      },
    });
    this.options.callbacks.bind(actor, { think: (_actor, frame) => this.runThink(actor, frame), pain: null, die: null, use: null,
      touch: contact => {
        const current = this.sourceSlot(contact.self.id); if (current === null) return undefined;
        const source = this.entities.at(current), callback = source.int(this.field("touch"));
        if (callback !== 0 && source.float(this.field("solid")) !== 0) {
          const prior = this.physicsCallback;
          this.physicsCallback = { kind: "touch", actor: contact.self.id, other: contact.other, functionIndex: callback };
          try { this.invoke(callback, current, this.reference(contact.other), this.currentTime); }
          finally { this.physicsCallback = prior; }
        }
        return undefined;
      } });
    return this.options.admit(actor, slot, this);
  }
  private invoke(callback: number, slot: number, other: number, time: number): undefined {
    const globals = this.machine.globals, selfOffset = this.machine.globalOffset("self"), otherOffset = this.machine.globalOffset("other");
    const self = globals.int(selfOffset), savedOther = globals.int(otherOffset);
    try {
      globals.setInt(selfOffset, this.entities.reference(slot)); globals.setInt(otherOffset, other);
      globals.setFloat(this.machine.globalOffset("time"), time); this.machine.execute(callback);
    } finally { globals.setInt(selfOffset, self); globals.setInt(otherOffset, savedOther); }
    return undefined;
  }
  spawnMap(): undefined {
    if (!this.spawning) throw new Error("QC map was already spawned");
    const world = this.entities.at(0), map = this.options.recipe.map.geometry.requestedPath;
    world.setInt(this.field("model"), this.machine.strings.allocate(map)); world.setFloat(this.field("modelindex"), 1);
    world.setFloat(this.field("solid"), 4); world.setFloat(this.field("movetype"), 7);
    this.machine.globals.setFloat(this.machine.globalOffset("time"), this.currentTime);
    for (const name of ["skill", "deathmatch", "coop", "teamplay"]) {
      const offset = this.prepared.program.globalsByName.get(name)?.offset;
      if (offset !== undefined) this.machine.globals.setFloat(offset, this.cvars.variableValue(name));
    }
    this.machine.globals.setInt(this.machine.globalOffset("mapname"), this.machine.strings.allocate(map.replace(/^maps\//, "").replace(/\.bsp$/, "")));
    for (const [ordinal, pairs] of parseEntities(this.options.world.entities).entries()) {
      const actor = ordinal === 0 ? this.worldActor : this.slots.allocate("quakec:authored");
      const slot = this.sourceSlot(actor.id); if (slot === null) throw new Error("Missing authored QC source slot");
      this.worldHost.actor(slot);
      applyQcEntityPairs(this.machine, slot, [...pairs].map(([key, value]) => ({ key, value })));
      const excluded = this.options.mode === "deathmatch" ? 2048 : this.options.skill === 0 ? 256 : this.options.skill === 1 ? 512 : 1024;
      if ((Math.trunc(this.entities.at(slot).float(this.field("spawnflags"))) & excluded) !== 0) { this.slots.free(actor); continue; }
      const classname = this.machine.strings.get(this.entities.at(slot).int(this.field("classname")));
      this.invoke(this.prepared.program.functionNamed(classname).index, slot, 0, this.currentTime);
      this.messages.flushSignon();
    }
    this.spawning = false; this.options.physics.setWorldGravity(this.cvars.variableValue("sv_gravity"));
    this.messages.flush();
    return undefined;
  }
  beginFrame(frame: FrameContext): undefined {
    if (frame.time.kind !== "seconds" || frame.elapsed.kind !== "seconds" || !Number.isFinite(frame.time.value)) throw new Error("QC frame requires source seconds");
    this.currentTime = frame.time.value;
    this.machine.globals.setFloat(this.machine.globalOffset("frametime"), frame.elapsed.value);
    this.options.physics.setWorldGravity(this.cvars.variableValue("sv_gravity"));
    return this.invoke(this.prepared.program.functionNamed("StartFrame").index, 0, 0, this.currentTime);
  }
  beforeActor(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id);
    if (slot !== null && this.machine.globals.float(this.machine.globalOffset("force_retouch")) !== 0) {
      this.worldHost.link(slot); this.options.physics.touchTriggers(actor);
    }
    return undefined;
  }
  endFrame(): undefined {
    this.messages.flush();
    const offset = this.machine.globalOffset("force_retouch"), current = this.machine.globals.float(offset);
    if (current !== 0) this.machine.globals.setFloat(offset, this.machine.numeric.subtract(current, 1));
    return undefined;
  }
  runThink(actor: OwnedActor, frame: FrameContext): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) return undefined;
    const words = this.entities.at(slot), due = words.float(this.field("nextthink"));
    const time = thinkCallbackTime({ kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null }, { kind: "seconds", value: due }, frame);
    if (time === null) return undefined;
    words.setFloat(this.field("nextthink"), 0);
    return this.invoke(words.int(this.field("think")), slot, 0, time.value);
  }
  readMoveType(actor: ActorId): number | null { const slot = this.sourceSlot(actor); return slot === null ? null : this.entities.at(slot).float(this.field("movetype")); }
  collision(actor: OwnedActor): SharedSolid | null {
    const slot = this.sourceSlot(actor.id); if (slot === null) return null;
    const words = this.entities.at(slot), solid = words.float(this.field("solid")), flags = Math.trunc(words.float(this.field("flags")));
    const name = this.machine.strings.get(words.int(this.field("model"))), model = name.startsWith("*") ? Number(name.slice(1)) : slot === 0 ? 0 : null;
    const corpse = solid === 5 && this.options.recipe.engineBehavior.content.startsWith("q1:rerelease:");
    return { family: "q1", ...(corpse ? { q1Corpse: true } : {}), solid: solid === 0 || solid === 5 && !corpse ? "none" : solid === 1 ? "trigger" : solid === 4 ? "brush" : "box", model,
      owner: words.int(this.field("owner")) === 0 ? null : this.slots.at(this.entities.slot(words.int(this.field("owner"))))?.id ?? null,
      monster: (flags & 32) !== 0, item: (flags & 256) !== 0 };
  }
  motion(actor: OwnedActor, body: BodyState): Q2Motion | null {
    const slot = this.sourceSlot(actor.id); if (slot === null) return null;
    const words = this.entities.at(slot), move = words.float(this.field("movetype"));
    let kind: Q2Motion["kind"];
    switch (move) {
      case 0: case 8: kind = "stationary"; break;
      case 3: case 4: kind = "step"; break;
      case 5: kind = "fly"; break;
      case 6: kind = "toss"; break;
      case 7: kind = "push"; break;
      case 9: kind = "fly-missile"; break;
      case 10: kind = "bounce"; break;
      case 11:
        if (!this.options.recipe.engineBehavior.content.startsWith("q1:rerelease:")) throw new Error(`Unsupported id1 movetype ${move}`);
        kind = "bounce"; break;
      default: throw new Error(`Unsupported id1 movetype ${move}`);
    }
    return { actor, kind, velocity: body.velocity, angularVelocity: words.vector(this.field("avelocity")), gravity: this.prepared.program.fieldsByName.has("gravity") ? words.float(this.field("gravity")) || 1 : 1,
      gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 3, owner: this.collision(actor)?.owner ?? null };
  }
  flags(actor: OwnedActor): SharedPhysicsFlags {
    const slot = this.sourceSlot(actor.id); if (slot === null) return {};
    const words = this.entities.at(slot), flags = Math.trunc(words.float(this.field("flags")));
    return { fly: (flags & 1) !== 0, swim: (flags & 2) !== 0, partialGround: (flags & 1024) !== 0, player: this.isReservedClient(actor.id),
      waterLevel: words.float(this.field("waterlevel")), waterType: words.float(this.field("watertype")), dead: words.float(this.field("health")) <= 0 };
  }
  writeFlags(actor: OwnedActor, changes: SharedPhysicsFlags): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) return undefined;
    const words = this.entities.at(slot); let flags = Math.trunc(words.float(this.field("flags")));
    for (const [value, bit] of [[changes.fly, 1], [changes.swim, 2], [changes.partialGround, 1024]] satisfies readonly (readonly [boolean | undefined, number])[]) {
      if (value !== undefined) flags = value ? flags | bit : flags & ~bit;
    }
    words.setFloat(this.field("flags"), flags);
    if (changes.waterLevel !== undefined) words.setFloat(this.field("waterlevel"), changes.waterLevel);
    if (changes.waterType !== undefined) words.setFloat(this.field("watertype"), changes.waterType);
    return undefined;
  }
  classname(actor: ActorId): string { const slot = this.sourceSlot(actor); return slot === null ? "" : this.machine.strings.get(this.entities.at(slot).int(this.field("classname"))); }
  checkWaterTransition(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) return undefined;
    const words = this.entities.at(slot), contents = this.options.scene.pointContents({ point: words.vector(this.field("origin")), target: { kind: "world" },
      policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor.id });
    if (contents.kind !== "q1") throw new Error("QC water transition requires Q1 contents");
    const decision = q1WaterTransition(words.float(this.field("watertype")), contents.contents);
    if (decision.splash) {
      const path = "misc/h2ohit1.wav", sound = this.precached.get(`sound:${path}`);
      if (sound === undefined) this.options.print(`SV_StartSound: ${path} not precacheed\n`);
      else this.options.events.emit(this.prepared.execution.owner.content, { kind: "q1", event: { kind: "sound", actor: actor.id, path, channel: "auto", volume: 1, attenuation: 1 } });
    }
    words.setFloat(this.field("watertype"), decision.waterType); words.setFloat(this.field("waterlevel"), decision.waterLevel);
    return undefined;
  }
  writeAngularVelocity(actor: OwnedActor, value: Vec3): undefined { const slot = this.sourceSlot(actor.id); if (slot !== null) this.entities.at(slot).setVector(this.field("avelocity"), value); return undefined; }
}
