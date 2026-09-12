import { Id1Environment, type Id1PhysicsCallback } from "../../../content/q1/quakec/id1-environment.ts";
import { QcBroadcastMessages } from "../../../compat/qc/presentation-host.ts";
import { Id1SynchronousAttacks } from "../../../content/q1/quakec/id1-attacks.ts";
import type { Q1UserCommand } from "../../../contracts/protocol.ts";
import type { ClientId } from "../../../contracts/identity.ts";
import type { Q1MovementState, ArsenalState, ActorAnimationState } from "../../../contracts/movement.ts";
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
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../core/numeric.ts";
import { QcMachine, QcEntityMemory, loadQcProgram, classicQcEntityLayout, createQcSourceSlotStorage, QcWorldHost,
  createQcBuiltins, createQcPresentationBindings, applyQcEntityPairs } from "../../../compat/qc/index.ts";
import { qcByteString } from "../../../compat/qc/program.ts";
import type { QcProgram } from "../../../compat/qc/program.ts";
import type { QcPrecachedResource } from "../../../compat/qc/presentation-host.ts";
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

const id1Digest = "sha256:f2619787f9aa0f057246eea1665b622b4691b5c5a800b1a46133d1fe8b771580";
type QuakeCExecution = Extract<ExecutableRecipe["execution"][number], { readonly kind: "quakec" }>;
export interface PreparedQuakeCSource {
  readonly execution: QuakeCExecution;
  readonly program: QcProgram;
  readonly resources: ReadonlyMap<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>;
}

/** Decode the selected artifact and genuine assets before synchronous source precaching. */
export async function prepareQuakeCSource(execution: QuakeCExecution, mounts: MountedContent): Promise<PreparedQuakeCSource> {
  const artifact = await mounts.open(execution.artifact.requestedPath);
  if (artifact === null || artifact.reference.digest !== execution.artifact.digest || artifact.reference.id !== execution.artifact.id)
    throw new Error("Selected QuakeC artifact no longer matches its resolved identity");
  const program = loadQcProgram(artifact.bytes);
  if (program.digest !== id1Digest || execution.api.kind !== "q1-netquake" || execution.api.programVersion !== 6 || execution.api.systemCrc !== 5927)
    throw new Error("Shared QuakeC application supports only the verified classic id1 program");
  const resources = new Map<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>();
  const names = new Set<string>();
  for (let offset = 0; offset < program.strings.length;) {
    const name = qcByteString(program.strings, offset);
    if (/\.(mdl|spr|bsp|wav)$/.test(name)) names.add(name);
    offset += name.length + 1;
  }
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
}

/** One source state owner, borrowed by the session's existing actor traversal. */
export class QuakeCSource {
  readonly machine: QcMachine;
  readonly attacks: Id1SynchronousAttacks;
  readonly environment: Id1Environment;
  readonly messages: QcBroadcastMessages;
  readonly entities: QcEntityMemory;
  readonly slots: SourceActorSlots;
  readonly worldHost: QcWorldHost;
  readonly cvars: CvarRegistry;
  readonly clients: QcClientHost;
  readonly pusherServices: Q1PusherServices;
  private currentTime: number;
  private readonly activeClients = new Set<ActorId>();
  private physicsCallback: QuakeCPhysicsCallback | null = null;
  private spawning = true;
  private readonly models = new Map<string, { readonly index: number; readonly bounds: Bounds }>();
  private readonly precached = new Map<string, QcPrecachedResource>();
  private modelCount: number;
  private soundCount = 1;
  constructor(readonly prepared: PreparedQuakeCSource, readonly options: QuakeCSourceOptions) {
    if (prepared.program.digest !== id1Digest || !options.recipe.execution.some(value => value.kind === "quakec" && value.owner.provider === prepared.execution.owner.provider
      && value.owner.content === prepared.execution.owner.content && value.artifact.digest === prepared.execution.artifact.digest)) throw new Error("QC source differs from selected execution");
    if (!Number.isFinite(options.initialSourceTimeSeconds) || options.initialSourceTimeSeconds < 0 || !Number.isSafeInteger(options.maxClients) || options.maxClients < 1 || options.maxClients >= 2048)
      throw new Error("Invalid dedicated QC source timing or reserved clients");
    this.currentTime = options.initialSourceTimeSeconds;
    options.actors.onRelease(actor => { this.activeClients.delete(actor.id); return undefined; });
    this.entities = new QcEntityMemory(classicQcEntityLayout(prepared.program), 2048, options.maxClients + 1);
    this.slots = new SourceActorSlots(options.actors, { provider: prepared.execution.owner.provider, capacity: this.entities.capacity,
      lifetime: quakeEdictLifetime(options.maxClients + 1), storage: createQcSourceSlotStorage({ program: prepared.program, entities: this.entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
      now: () => ({ kind: "seconds", value: this.currentTime }), unlink: actor => options.physics.bodies.unlink(actor), exhausted: () => { throw new Error("QC source edicts exhausted"); } });
    for (let slot = 0; slot <= options.maxClients; slot++) this.slots.bindExisting(slot, slot === 0 ? "quakec:worldspawn" : "quakec:reserved-client");
    this.modelCount = options.world.models.length + 1;
    this.models.set(options.recipe.map.geometry.requestedPath, { index: 1, bounds: options.scene.modelBounds(0) });
    for (let model = 1; model < options.world.models.length; model++) this.models.set(`*${model}`, { index: model + 1, bounds: options.scene.modelBounds(model) });
    this.worldHost = new QcWorldHost({ program: prepared.program, entities: this.entities, actors: options.actors, slots: this.slots,
      bodies: options.physics.bodies, scene: options.scene, numeric: Q1_DONOR_PROFILE, model: name => this.models.get(name) ?? null,
      foreignReference: () => { throw new Error("Dedicated id1 QC does not admit foreign source actors"); }, admit: (actor, slot) => this.admit(actor, slot) });
    this.cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: options.actors.session, origin: { kind: "server-console" } }, print: options.print });
    for (const [name, value] of Object.entries({ skill: String(options.skill), deathmatch: options.mode === "deathmatch" ? "1" : "0", coop: options.mode === "coop" ? "1" : "0",
      teamplay: "0", sv_aim: "0.93", sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", registered: "1" })) this.cvars.register(name, value);
    this.clients = new QcClientHost(this.worldHost, { scene: options.scene, maxClients: options.maxClients, serverTime: () => this.currentTime });
    const presentation = createQcPresentationBindings(this.worldHost, { content: prepared.execution.owner.content, events: options.events,
      loading: () => this.spawning, print: options.print, message: (event, actor) => { if (!this.activeClients.has(actor)) throw new Error("QC message requires an admitted client"); return options.events.message(event, actor); }, precache: (kind, name) => this.precache(kind, name), lookup: (kind, name) => this.precached.get(`${kind}:${name}`) ?? null });
    const movement = createQcMovementBindings(this.worldHost, { scene: options.scene, random: options.random, touchTriggers: actor => options.physics.touchTriggers(actor) });
    this.messages = new QcBroadcastMessages(this.worldHost, event => options.events.emit(prepared.execution.owner.content, { kind: "q1", event }));
    const host = new Map([...this.worldHost.host, ...presentation, ...movement, ...this.clients.host, ...this.messages.host]);
    host.set("cvar", vm => { vm.returnFloat(this.cvars.variableValue(vm.argString(0))); });
    host.set("cvar_set", vm => { const name = vm.argString(0); this.cvars.set(name, vm.argString(1)); if (name === "sv_gravity") options.physics.setWorldGravity(this.cvars.variableValue(name)); });
    host.set("aim", createQcAimBinding(this.worldHost, { aimThreshold: () => this.cvars.variableValue("sv_aim"), teamplay: () => this.cvars.variableValue("teamplay") }));
    this.attacks = new Id1SynchronousAttacks(this.worldHost.options, () => this.machine);
    this.environment = new Id1Environment(this.worldHost.options, () => this.machine);
    const damage = new Id1DamageBinding(this.worldHost.options, options.combat, () => this.machine, options.damageRequest);
    this.machine = new QcMachine({ program: prepared.program, entities: this.entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind: "netquake", random: options.random, host, isFreeEntity: this.worldHost.isFreeEntity }), serverActive: () => !this.spawning,
      functionBoundary: this.attacks.compose(damage.functionBoundary), observeCall: call => damage.observeCall(call), observeEntityStore: store => damage.observeEntityStore(store) });
    const pushers = createQcPusherServices(this.worldHost, this.machine, { physical: projection => options.physics.q1PusherServices(projection),
      foreign: { read: actor => options.physics.readQ1Pusher(actor), write: entity => options.physics.writeQ1Pusher(entity) },
      touchTriggers: actor => options.physics.touchTriggers(actor), serverTime: () => this.currentTime });
    this.pusherServices = { ...pushers, blocked: (actor, other) => {
      const slot = this.sourceSlot(actor.id); if (slot === null) throw new Error("Missing live blocked QC actor");
      const prior = this.physicsCallback;
      this.physicsCallback = { kind: "blocked", actor: actor.id, other, functionIndex: this.entities.at(slot).int(this.field("blocked")) };
      try { return pushers.blocked(actor, other); } finally { this.physicsCallback = prior; }
    } };
    for (let slot = 0; slot <= options.maxClients; slot++) this.worldHost.actor(slot);
  }
  get currentPhysicsCallback(): QuakeCPhysicsCallback | null { return this.physicsCallback; }
  get worldActor(): OwnedActor { return this.worldHost.actor(0); }
  get timeSeconds(): number { return this.currentTime; }
  get loading(): boolean { return this.spawning; }
  private field(name: string): number { const field = this.prepared.program.fieldsByName.get(name); if (field === undefined) throw new Error(`Missing id1 field ${name}`); return field.offset; }
  sourceSlot(actor: ActorId): number | null {
    if (!this.options.actors.isLive(actor)) return null;
    const source = this.options.actors.sourceOf(actor); return source?.provider === this.prepared.execution.owner.provider ? source.slot : null;
  }
  isReservedClient(actor: ActorId): boolean { const slot = this.sourceSlot(actor); return slot !== null && slot > 0 && slot <= this.options.maxClients; }
  isActiveClient(actor: ActorId): boolean { return this.activeClients.has(actor); }
  admitClient(client: ClientId): OwnedActor {
    const slot = client.slot + 1;
    if (slot > this.options.maxClients || this.spawning) throw new Error("QC client slot is unavailable");
    const reserved = this.slots.at(slot);
    if (reserved !== null && this.activeClients.has(reserved.id)) throw new Error("QC reserved client is active");
    if (reserved !== null && this.classname(reserved.id) === "player") this.options.actors.release(reserved);
    const actor = this.worldHost.actor(slot);
    const words = this.entities.at(slot);
    words.bytes.fill(0);
    words.setFloat(this.field("colormap"), slot); words.setFloat(this.field("team"), 1);
    words.setInt(this.field("netname"), this.machine.strings.allocate(`Player ${slot}`));
    this.activeClients.add(actor.id);
    this.bindClientInventory(actor, slot);
    this.invoke(this.prepared.program.functionNamed("SetNewParms").index, 0, 0, this.currentTime);
    this.invoke(this.prepared.program.functionNamed("ClientConnect").index, slot, 0, this.currentTime);
    this.invoke(this.prepared.program.functionNamed("PutClientInServer").index, slot, 0, this.currentTime);
    return actor;
  }
  disconnectClient(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id);
    if (slot === null || !this.activeClients.has(actor.id)) throw new Error("QC disconnect requires an active client");
    this.invoke(this.prepared.program.functionNamed("ClientDisconnect").index, slot, 0, this.currentTime);
    this.activeClients.delete(actor.id);
    return undefined;
  }
  private bindClientInventory(actor: OwnedActor, slot: number): undefined {
    const words = this.entities.at(slot), itemOffset = this.field("items");
    const weapons = WEAPONS.map((weapon, index) => ({ item: weaponItem(weapon), bit: index === 0 ? 4096 : 1 << (index - 1) }));
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
    if (command.impulse !== 0) words.setFloat(this.field("impulse"), command.impulse);
    return undefined;
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
    const slot = this.sourceSlot(actor), index = WEAPONS.findIndex(weapon => weaponItem(weapon) === item);
    if (slot === null || index < 0 || this.options.inventory.count(actor, item) <= 0) return false;
    this.entities.at(slot).setFloat(this.field("impulse"), index + 1);
    return true;
  }
  clientPreThink(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) throw new Error("Missing QC client");
    this.invoke(this.prepared.program.functionNamed("PlayerPreThink").index, slot, 0, this.currentTime);
    return undefined;
  }
  clientPostThink(actor: OwnedActor): undefined {
    const slot = this.sourceSlot(actor.id); if (slot === null) return undefined;
    return this.invoke(this.prepared.program.functionNamed("PlayerPostThink").index, slot, 0, this.currentTime);
  }
  clientArsenal(actor: ActorId): ArsenalState {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("Missing QC arsenal actor");
    const words = this.entities.at(slot), value = words.float(this.field("weapon"));
    const index = value === 4096 ? 0 : WEAPONS.findIndex((_weapon, index) => index > 0 && 1 << (index - 1) === value);
    const weapon = WEAPONS[index];
    if (weapon === undefined) throw new Error(`Unsupported actual QC weapon ${value}`);
    return { provider: this.prepared.execution.owner.provider, activeWeapon: weaponItem(weapon), ammo: this.options.inventory.entries(actor),
      state: { kind: "q1", sourceWeapon: value, frame: words.float(this.field("weaponframe")), attackFinishedSeconds: words.float(this.field("attack_finished")) } };
  }
  clientAnimation(actor: ActorId): ActorAnimationState {
    const slot = this.sourceSlot(actor); if (slot === null) throw new Error("Missing QC animation actor");
    const words = this.entities.at(slot);
    return { provider: this.options.recipe.character.definition.provider, state: { kind: "q1", frame: words.float(this.field("frame")), nextFrameSeconds: words.float(this.field("nextthink")) } };
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
    for (const name of ["skill", "deathmatch", "coop", "teamplay"]) this.machine.globals.setFloat(this.machine.globalOffset(name), this.cvars.variableValue(name));
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
    }
    this.spawning = false; this.options.physics.setWorldGravity(this.cvars.variableValue("sv_gravity"));
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
    return { family: "q1", solid: solid === 0 ? "none" : solid === 1 ? "trigger" : solid === 4 ? "brush" : "box", model,
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
