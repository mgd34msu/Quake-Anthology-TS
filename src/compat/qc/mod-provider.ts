import type { ModuleIdentity, QuakeCCheckpoint } from "../../contracts/execution.ts";
import type { ContentId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ModActorField, ModCallbackDeclaration, ModCallbackInput, ModCallbackValue, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { RandomSource, RandomState } from "../../contracts/numeric.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { createNumericOperations, Q1_DONOR_PROFILE } from "../../core/numeric.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import { encodeCheckpointValue, decodeCheckpointValue, SaveReader } from "../../persistence/value.ts";
import { createQcBuiltins } from "./builtins.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import { createQcPresentationBindings } from "./presentation-host.ts";
import type { QcPrecachedResource } from "./presentation-host.ts";
import { createQcSpatialBindings } from "./spatial-host.ts";
import { QcModActors } from "./mod-actors.ts";
import { QcModCombat, validateQcModCombat } from "./mod-combat.ts";
import { QcModMessages } from "./mod-messages.ts";
import { createQcMovementBindings } from "./movement-host.ts";
import { QcModEnvironment } from "./mod-environment.ts";
import { qcConsoleCall } from "./mod-commands.ts";
import { asciiFold, tokenizeCommand, type CommandInvocation } from "../../core/commands/index.ts";
import type { ModCommandPort } from "../../world/session/mod-commands.ts";
import type { FrameContext } from "../../contracts/time.ts";
import { createQcBodyBinding, QcActorState } from "./actor-state.ts";
import { createQcPusherServices } from "./pusher-host.ts";
import type { Q1PusherServices } from "../../movement/q1/types.ts";
import { executeQuakeCPhysics } from "../../app/bootstrap/simulation/actor-execution.ts";
import type { SimulationPresentation } from "../../app/bootstrap/simulation/types.ts";
import { q1WaterTransition } from "../../movement/q1/water-transition.ts";
import { captureQcCheckpoint, restoreQcCheckpoint } from "./executor.ts";
import type { QcExecutorHost } from "./executor.ts";
import { QcMachine } from "./machine.ts";
import type { QcBuiltin, QcEntityStoreObservation } from "./machine.ts";
import { QcEntityMemory, QcWords } from "./memory.ts";
import { classicQcEntityLayout } from "./profile.ts";
import type { QcProgram, QcValueType } from "./program.ts";

export type QcModValue = ModRuntimeValue;
export type QcModInputs = ReadonlyMap<ModCallbackInput, QcModValue>;
export interface QcModRandom extends RandomSource { checkpoint(): RandomState; restore(state: RandomState): undefined; }
export interface QcModMedia {
  readonly content: ContentId;
  readonly resources: ReadonlyMap<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>;
}
interface FieldBinding { readonly declaration: ModActorField; readonly offset: number; readonly words: 1 | 3; }
function inputType(value: ModCallbackValue): QcValueType {
  if (value.kind !== "input") return value.kind;
  switch (value.name) {
    case "self": case "other": case "activator": case "attacker": case "inflictor": return "entity";
    case "point": case "direction": case "normal": return "vector";
    case "item": return "string";
    default: return "float";
  }
}
function validateCall(program: QcProgram, call: ModSourceCall, available: ReadonlySet<ModCallbackInput>, label: string): void {
  for (const value of [...call.arguments, ...call.globals.map(global => global.value)]) if (value.kind === "input" && !available.has(value.name))
    throw new Error(`Mod ${label} cannot read ${value.name}`);
  const fn = program.functionNamed(call.function);
  if (fn.index === 0 || fn.firstStatement <= 0 || fn.parameterSizes.length !== call.arguments.length
    || fn.parameterSizes.some((size, index) => { const value = call.arguments[index]; return value === undefined || size !== (inputType(value) === "vector" ? 3 : 1); }))
    throw new Error(`Mod callback ${call.function} has an incompatible source signature`);
  const globals = new Set<string>();
  for (const global of call.globals) {
    if (globals.has(global.name) || program.globalsByName.get(global.name)?.type !== inputType(global.value))
      throw new Error(`Mod callback global ${global.name} is duplicated or has an incompatible type`);
    globals.add(global.name);
  }
}
export function validateQcMod(program: QcProgram, declaration: ModCallbackDeclaration): void {
  if (program.digest !== declaration.program.digest) throw new Error("Gameplay mod program differs from its declared artifact digest");
  const fields = new Set<number>();
  const think = declaration.actorFields.filter(field => field.binding === "think"), nextthink = declaration.actorFields.filter(field => field.binding === "nextthink");
  if (think.length !== nextthink.length || think.length > 1) throw new Error("Mod source scheduling requires one think and one nextthink binding together");
  for (const entry of declaration.actorFields) {
    const field = program.fieldsByName.get(entry.field);
    if (field === undefined) throw new Error(`Missing mod actor field ${entry.field}`);
    const type = entry.binding === "private" ? field.type : entry.binding === "constant" ? entry.value.kind
      : entry.binding === "classname" ? "string" : entry.binding === "think" ? "function"
      : entry.binding === "health" || entry.binding === "inventory" || entry.binding === "nextthink" || entry.binding === "client-flags" ? "float" : "vector";
    if (field.type !== type) throw new Error(`Mod actor field ${entry.field} requires ${type}, found ${field.type}`);
    for (let word = field.offset; word < field.offset + (type === "vector" ? 3 : 1); word++) {
      if (fields.has(word)) throw new Error(`Overlapping mod actor field ${entry.field}`);
      fields.add(word);
    }
  }
  const callbacks = new Set<string>();
  const commands = new Set<string>();
  for (const command of declaration.commands ?? []) {
    const name = asciiFold(command.name), tokens = tokenizeCommand(command.name, program.api.kind).argv;
    if (tokens.length !== 1 || tokens[0] !== command.name || command.name.includes(";") || commands.has(name)) throw new Error(`Invalid or duplicate mod command ${command.name}`);
    commands.add(name);
    validateCall(program, qcConsoleCall(command, [], ""), new Set<ModCallbackInput>(), `console command ${command.name}`);
  }
  for (const call of declaration.initialize ?? []) validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "initialization");
  if (declaration.frame !== undefined) validateCall(program, declaration.frame, new Set<ModCallbackInput>(["self", "time", "elapsed"]), "source frame");
  const cvars = new Set<string>();
  for (const variable of declaration.cvars ?? []) {
    if (cvars.has(variable.name)) throw new Error(`Duplicate mod cvar ${variable.name}`);
    cvars.add(variable.name);
  }
  for (const call of declaration.callbacks) {
    if (callbacks.has(call.id)) throw new Error(`Duplicate mod callback ${call.id}`);
    callbacks.add(call.id);
    const available = new Set<ModCallbackInput>(["self", "time"]);
    if (call.stage === "observe") available.add("result");
    const additional: readonly ModCallbackInput[] = call.operation === "damage" ? ["attacker", "inflictor", "amount", "knockback", "direction", "point", "normal"]
      : call.operation === "inventory.give" || call.operation === "inventory.consume" ? ["item", "amount"]
      : call.operation === "actor.use" ? ["other", "activator"] : call.operation === "actor.touch" ? ["other"]
      : call.operation === "actor.think" ? ["elapsed"] : call.operation === "actor.pain" ? ["attacker", "amount", "knockback"]
      : ["attacker", "inflictor", "amount", "knockback", "point"];
    for (const name of additional) available.add(name);
    validateCall(program, call, available, call.id);
  }
  if (declaration.combat !== undefined) {
    validateQcModCombat(program, declaration.combat);
    validateCall(program, declaration.combat.damage, new Set<ModCallbackInput>(["self", "attacker", "inflictor", "amount", "knockback", "point", "direction", "normal", "time"]), "combat damage");
  }
}

/** Isolated source words project existing actors; every declared shared store keeps its canonical owner. */
export class QcModProvider {
  readonly machine: QcMachine;
  private readonly fields: readonly FieldBinding[];
  private readonly projections = new Map<ActorId, number>();
  private readonly actorsBySlot = new Map<number, ActorId>();
  private readonly hostState: QcExecutorHost;
  private readonly ownedActors: QcModActors;
  private readonly combat: QcModCombat | null;
  private readonly messages: QcModMessages | null;
  private readonly environment: QcModEnvironment;
  private readonly precached = new Map<string, QcPrecachedResource>();
  private readonly actorState: QcActorState;
  private readonly sourcePhysics = new Map<ActorId, () => undefined>();
  private readonly pusherServices: Q1PusherServices | null;
  private readonly releaseProjection: () => undefined;
  private frame: FrameContext | null = null;
  private depth = 0;
  private loading = false;
  private initialized = false;
  private closed = false;
  private commands: ModCommandPort | null = null;
  constructor(readonly program: QcProgram, readonly module: ModuleIdentity, readonly declaration: ModCallbackDeclaration,
    readonly services: ModHostServices, readonly random: QcModRandom, readonly media?: QcModMedia) {
    validateQcMod(program, declaration);
    this.fields = declaration.actorFields.map(entry => {
      const field = program.fieldsByName.get(entry.field);
      if (field === undefined) throw new Error(`Missing validated actor field ${entry.field}`);
      return { declaration: entry, offset: field.offset, words: field.type === "vector" ? 3 : 1 };
    });
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8192);
    this.environment = new QcModEnvironment(services, program, declaration, actor => this.reference(actor));
    const host = new Map<QcHostBuiltinName, QcBuiltin>();
    const movement = new Map<QcHostBuiltinName, QcBuiltin>();
    if (services.engine?.physics !== undefined) for (const name of ["walkmove", "movetogoal", "changeyaw", "checkbottom"] satisfies readonly QcHostBuiltinName[]) host.set(name, vm => {
      const builtin = movement.get(name); if (builtin === undefined) return vm.fail(`Source movement service ${name} was not initialized`); return builtin(vm);
    });
    host.set("spawn", vm => this.ownedActors.spawn(vm));
    host.set("remove", vm => this.ownedActors.remove(vm));
    if (services.engine !== undefined) for (const [name, builtin] of createQcSpatialBindings({
      options: { program, entities, scene: services.engine.scene, numeric: Q1_DONOR_PROFILE, model: name => {
        if (media === undefined) return null;
        const resource = media.resources.get(name);
        const precached = this.lookup("model", name);
        return resource?.modelBounds == null || precached === null ? null : { index: precached.index, bounds: resource.modelBounds };
      } },
      prepareEntities: () => this.prepareEntities(), actor: slot => {
        const actor = services.actors.resolveOwned(this.actor(entities.reference(slot)));
        if (actor === null) throw new Error("Spatial builtin references a released mod actor"); return actor;
      }, reference: actor => this.reference(actor), isFreeEntity: slot => {
        const actor = this.actorsBySlot.get(slot); return actor === undefined || !services.actors.isLive(actor);
      }, link: slot => {
        const actor = services.actors.resolveOwned(this.actor(entities.reference(slot)));
        if (actor === null) throw new Error("Cannot link a released mod actor");
        services.bodies.link(actor);
      },
    })) host.set(name, builtin);
    this.messages = null;
    if (services.engine !== undefined && media !== undefined && program.api.kind !== "q1-quakeworld") {
      const lookup = (kind: "model" | "sound", name: string) => this.lookup(kind, name);
      const world = { options: { program, entities, slots: { at: (slot: number) => {
        const reference = slot === 0 ? services.engine?.world() : this.actorsBySlot.get(slot);
        return reference == null ? null : services.actors.resolveOwned(reference);
      } } }, host, actor: (slot: number) => {
        const actor = services.actors.resolveOwned(this.actor(entities.reference(slot)));
        if (actor === null) throw new Error("Presentation references a released mod actor");
        return actor;
      } };
      this.messages = new QcModMessages(world, services, media.content, (kind, index) => {
        for (const [name, resource] of this.precached) if (name.startsWith(`${kind}:`) && resource.index === index) return name.slice(kind.length + 1);
        throw new Error(`Unknown mod ${kind} index ${index}`);
      });
      for (const [name, builtin] of this.messages.messages.host) host.set(name, builtin);
      for (const [name, builtin] of createQcPresentationBindings(world, { ...services.engine, nq: this.messages.route, content: media.content, printBroadcastsToClients: true,
        loading: () => this.loading, lookup, precache: (kind, name) => {
          const resource = lookup(kind, name); if (resource === null) throw new Error(`Mod resource was not prepared: ${kind}/${name}`); return resource;
        } })) host.set(name, builtin);
    }
    for (const [name, builtin] of this.environment.host) host.set(name, builtin);
    host.set("localcmd", vm => {
      if (this.commands === null) return vm.fail("Mod localcmd requires the destination command service");
      this.commands.append(vm.argString(0));
    });
    this.machine = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), serverActive: () => !this.loading,
      builtins: createQcBuiltins({ kind: program.api.kind === "q1-quakeworld" ? "quakeworld" : "netquake", random, host,
        prepareEntities: () => this.prepareEntities(),
        isFreeEntity: slot => { const actor = this.actorsBySlot.get(slot); return actor === undefined || !services.actors.isLive(actor); } }),
      validateEntityAccess: (reference, word, words, kind) => {
        const actor = this.actor(reference);
        if (services.actors.observe(actor)?.owner === module.id) return undefined;
        for (let offset = word; offset < word + words; offset++) if (!this.fields.some(field => offset >= field.offset && offset < field.offset + field.words))
          throw new Error(`Mod ${module.id} accessed unmapped actor field word ${offset}`);
        if (kind === "read") this.refresh(actor, entities.slot(reference), word, words);
        return undefined;
      }, ...(declaration.combat === undefined ? {} : { functionBoundary: {
        functions: new Set(program.functions.filter(fn => fn.index > 0 && fn.firstStatement > 0 && !fn.namedBuiltin).map(fn => fn.index)),
        run: (call, execute) => this.combat === null ? execute() : this.combat.damage.functionBoundary.run(call, execute),
      } }), observeCall: call => this.combat?.damage.observeCall(call), observeEntityStore: store => {
        this.writeThrough(store); return this.combat?.damage.observeEntityStore(store);
      } });
    this.environment.initializeGlobals(this.machine);
    this.actorState = new QcActorState({ machine: this.machine, rerelease: media?.content.includes(":rerelease:") === true,
      sourceSlot: actor => { const source = services.actors.sourceOf(actor); return source?.provider === module.id ? source.slot : null; },
      reference: reference => this.actor(reference), isClient: () => false });
    this.ownedActors = new QcModActors({ machine: this.machine, services, provider: module.id,
      think: program.fieldsByName.get("think")?.offset ?? null,
      nextthink: program.fieldsByName.get("nextthink")?.offset ?? null,
      body: slot => createQcBodyBinding(program, entities, slot, { reference: actor => this.reference(actor), actor: reference => {
        if (reference === 0) return services.engine?.world() ?? null;
        const actor = this.actorsBySlot.get(entities.slot(reference)); return actor !== undefined && services.actors.isLive(actor) ? actor : null;
      } }),
      retired: actor => { this.sourcePhysics.get(actor.id)?.(); this.sourcePhysics.delete(actor.id); },
      admitted: actor => {
        this.combat?.admit(actor);
        this.sourcePhysics.get(actor.id)?.();
        const physics = services.engine?.physics;
        if (physics !== undefined) this.sourcePhysics.set(actor.id, physics.bindSource(actor, {
          collision: () => this.actorState.collision(actor), motion: () => {
            const body = services.bodies.read(actor.id); return body === null ? null : this.actorState.motion(actor, body);
          }, flags: () => this.actorState.flags(actor), writeFlags: value => this.actorState.writeFlags(actor, value),
          writeAngularVelocity: value => this.actorState.writeAngularVelocity(actor, value), waterTransition: () => this.waterTransition(actor.id),
        }));
      },
      touch: (actor, other) => {
        const source = services.actors.sourceOf(actor.id); if (source === null) return undefined;
        const index = entities.at(source.slot).int(this.machine.fieldOffset("touch"));
        if (index !== 0) this.invokeOwned(index, actor.id, other, this.frame?.time ?? services.time());
        return undefined;
      },
      use: (actor, other, activator) => this.invokeActorField(actor.id, "use", other, activator),
      pain: reaction => this.combat?.pain(reaction), die: reaction => this.combat?.die(reaction),
      step: (actor, frame, think) => {
        this.frame = frame;
        try {
          const source = services.actors.sourceOf(actor.id); if (source === null) return undefined;
          const move = entities.at(source.slot).float(this.machine.fieldOffset("movetype"));
          if (move === 0) return think();
          const physics = services.engine?.physics, pusherServices = this.pusherServices;
          if (physics === undefined || pusherServices === null) throw new Error("Moving mod actors require destination source physics");
          return executeQuakeCPhysics({ readMoveType: () => move, runThink: think, pusherServices,
            motion: (actor, body) => this.actorState.motion(actor, body), checkWaterTransition: () => this.waterTransition(actor.id) },
            actor, { actors: services.actors, bodies: services.bodies, frame, elapsed: frame.elapsed.value, physics });
        } finally { this.frame = null; }
      },
      remember: (actor, slot) => {
        const previous = this.actorsBySlot.get(slot); if (previous !== undefined) this.projections.delete(previous);
        this.projections.set(actor, slot); this.actorsBySlot.set(slot, actor);
      }, invoke: (actor, index, frame) => {
        this.invokeOwned(index, actor.id, null, frame.time);
        return undefined;
      } });
    this.combat = declaration.combat === undefined ? null : new QcModCombat({ program, module, services, machine: this.machine,
      slots: this.ownedActors.slots, declaration: declaration.combat,
      actor: reference => this.actor(reference), reference: actor => this.reference(actor),
      invoke: (call, inputs) => this.invoke(call, inputs) });
    if (services.engine?.physics !== undefined) for (const [name, builtin] of createQcMovementBindings({
      options: { actors: services.actors, bodies: services.bodies, entities, slots: this.ownedActors.slots, program, numeric: Q1_DONOR_PROFILE },
      actor: slot => { const actor = services.actors.resolveOwned(this.actor(entities.reference(slot))); if (actor === null) throw new Error("Movement references a released mod actor"); return actor; },
      reference: actor => this.reference(actor), link: slot => { const actor = this.ownedActors.slots.at(slot); if (actor !== null) services.bodies.link(actor); },
    }, { scene: services.engine.scene, random, touchTriggers: actor => services.engine?.physics?.touchTriggers(actor), actorReference: reference => {
      const actor = this.actorsBySlot.get(entities.slot(reference)); return actor !== undefined && services.actors.isLive(actor) ? actor : null;
    } })) movement.set(name, builtin);
    const physics = services.engine?.physics;
    this.pusherServices = physics === undefined || services.engine === undefined ? null : createQcPusherServices({
      options: { program, entities, actors: services.actors, slots: this.ownedActors.slots, bodies: services.bodies, scene: services.engine.scene, numeric: Q1_DONOR_PROFILE,
        model: () => null, foreignReference: actor => this.reference(actor) }, reference: actor => this.reference(actor),
      link: slot => { const actor = this.ownedActors.slots.at(slot); if (actor !== null) services.bodies.link(actor); },
    }, this.machine, { physical: projection => physics.q1PusherServices(projection), foreign: { read: actor => physics.readQ1Pusher(actor), write: entity => physics.writeQ1Pusher(entity) },
      touchTriggers: actor => physics.touchTriggers(actor), serverTime: () => {
        const now = this.frame?.time ?? services.time(); return now.kind === "seconds" ? now.value : now.value / 1000;
      }, invoke: (actor, callback, other) => {
        const frame = this.frame;
        if (frame === null) throw new Error("Mod pusher callback needs an active source frame");
        if (callback === "think") {
          if (services.callbacks === undefined) throw new Error("Mod pusher think requires shared callbacks");
          services.callbacks.think(actor, frame);
        } else {
          const source = services.actors.sourceOf(actor.id);
          if (source !== null) this.invokeOwned(entities.at(source.slot).int(this.machine.fieldOffset("blocked")), actor.id, other, frame.time);
        }
        return undefined;
      } });
    this.hostState = {
      checkpoint: () => ({ state: { module, format: "quakec:mod-host-v3", bytes: encodeCheckpointValue({
        projections: [...this.projections].map(([actor, slot]) => ({ actor: savedActorId(actor), slot })), precached: [...this.precached.keys()],
        messages: this.messages?.capture() ?? null, cvars: this.environment.cvars.captureQuakeCState(), visibility: this.environment.visibility?.capture() ?? null,
        initialized: this.initialized }) }, random: [random.checkpoint()], callbacks: [] }),
      restore: state => {
        if (state.state.format !== "quakec:mod-host-v3" || state.random.length !== 1) throw new Error("Invalid gameplay mod host state");
        const savedRandom = state.random[0]; if (savedRandom === undefined) throw new Error("Missing gameplay mod random state");
        random.restore(savedRandom); this.projections.clear(); this.actorsBySlot.clear();
        const savedHost = new SaveReader(decodeCheckpointValue(state.state.bytes));
        const resolve = (saved: Parameters<NonNullable<ModHostServices["referenceSaved"]>>[0]) => services.referenceSaved?.(saved) ?? services.actors.referenceSaved(saved, "current");
        savedHost.field("projections").list(entry => {
          const slot = entry.field("slot").integer(1), saved = readSavedActor(entry.field("actor"));
          const actor = resolve(saved);
          if (slot >= entities.count || this.actorsBySlot.has(slot) || this.projections.has(actor)) throw new Error("Invalid gameplay mod actor projection");
          this.projections.set(actor, slot); this.actorsBySlot.set(slot, actor);
        });
        this.precached.clear();
        for (const key of savedHost.field("precached").list(entry => entry.string())) {
          const kind = key.startsWith("model:") ? "model" : key.startsWith("sound:") ? "sound" : null;
          if (kind === null || this.precached.has(key) || this.lookup(kind, key.slice(kind.length + 1)) === null) throw new Error("Saved mod resource no longer resolves");
        }
        const messages = savedHost.field("messages");
        if (this.messages === null ? messages.value !== null : messages.value === null) throw new Error("Saved mod message services differ");
        this.messages?.restore(messages, resolve);
        this.environment.cvars.restoreQuakeCState(savedHost.field("cvars").value);
        const visibility = savedHost.field("visibility");
        if (this.environment.visibility === null ? visibility.value !== null : visibility.value === null) throw new Error("Saved mod client visibility differs");
        this.environment.visibility?.restore(visibility.value);
        this.initialized = savedHost.field("initialized").boolean();
        this.ownedActors.restored();
        return undefined;
      },
    };
    this.releaseProjection = services.actors.onRelease(actor => {
      const slot = this.projections.get(actor.id);
      if (slot !== undefined) this.actorsBySlot.delete(slot);
      this.projections.delete(actor.id);
      return undefined;
    });
  }
  private lookup(kind: "model" | "sound", name: string): QcPrecachedResource | null {
    const key = `${kind}:${name}`, previous = this.precached.get(key);
    if (previous !== undefined) return previous;
    const resource = this.media?.resources.get(name);
    if (resource === undefined) return null;
    const value = { index: [...this.precached.keys()].filter(key => key.startsWith(`${kind}:`)).length + 1, resource: resource.resource };
    this.precached.set(key, value); return value;
  }
  private actor(reference: number): ActorId {
    if (reference === 0) {
      const world = this.services.engine?.world();
      if (world == null || !this.services.actors.isLive(world)) throw new Error("Mod source world has no canonical actor");
      return world;
    }
    const actor = this.actorsBySlot.get(this.machine.entities.slot(reference));
    if (actor === undefined || !this.services.actors.isLive(actor)) throw new Error("Gameplay mod references an absent or expired actor projection");
    return actor;
  }
  private reference(actor: ActorId | null): number {
    if (actor === null) return 0;
    const world = this.services.engine?.world();
    if (world != null && actor.equals(world)) return 0;
    if (!this.services.actors.isLive(actor)) throw new Error("Gameplay mod cannot project a stale actor");
    const existing = this.projections.get(actor);
    if (existing !== undefined) return this.machine.entities.reference(existing);
    const slot = this.machine.entities.count;
    this.machine.entities.setCount(slot + 1);
    this.projections.set(actor, slot); this.actorsBySlot.set(slot, actor);
    for (const field of this.fields) if (field.declaration.binding === "constant") this.write(this.machine.entities.at(slot), field.offset, field.declaration.value);
    return this.machine.entities.reference(slot);
  }
  private prepareEntities(): void { for (const actor of this.services.actors.observations()) this.reference(actor.id); }
  private refresh(actor: ActorId, slot: number, word: number, count: number): void {
    const words = this.machine.entities.at(slot);
    for (const field of this.fields) {
      if (word + count <= field.offset || word >= field.offset + field.words) continue;
      const declared = field.declaration;
      switch (declared.binding) {
        case "constant": case "private": case "think": case "nextthink": break;
        case "classname": {
          const name = this.services.engine?.classname?.(actor);
          if (name === undefined) throw new Error("Mod classname field requires canonical actor metadata");
          words.setInt(field.offset, this.machine.strings.setEngine(`mod-classname:${name}`, name, Math.max(128, name.length + 1))); break;
        }
        case "client-flags": { const client = this.environment.client(actor); words.setFloat(field.offset, client === null ? 0 : 8 | (client.notarget ? 128 : 0)); break; }
        case "view-offset": { words.setVector(field.offset, this.environment.client(actor)?.viewOffset ?? { x: 0, y: 0, z: 0 }); break; }
        case "health": {
          words.setFloat(field.offset, this.services.combat.read(actor)?.health ?? 0); break;
        }
        case "inventory": {
          const entry = this.services.inventory.entries(actor).find(entry => entry.item === declared.item);
          words.setFloat(field.offset, entry?.count ?? 0); break;
        }
        case "origin": case "angles": case "velocity": case "bounds-min": case "bounds-max": {
          const body = this.services.bodies.read(actor);
          words.setVector(field.offset, body === null ? { x: 0, y: 0, z: 0 }
            : declared.binding === "bounds-min" ? body.bounds.min : declared.binding === "bounds-max" ? body.bounds.max : body[declared.binding]); break;
        }
      }
    }
  }
  private writeThrough(store: QcEntityStoreObservation): undefined {
    const actor = this.services.actors.resolveOwned(this.actor(store.reference));
    if (actor === null) throw new Error("Mod actor was released before its source store");
    const words = this.machine.entities.fromReference(store.reference);
    if (actor.owner === this.module.id) {
      for (const name of ["think", "nextthink"]) {
        const offset = this.program.fieldsByName.get(name)?.offset;
        if (offset !== undefined && store.word <= offset && store.word + store.after.length / 4 > offset) return this.ownedActors.schedule(actor);
      }
      return undefined;
    }
    for (const field of this.fields) {
      if (store.word + store.after.length / 4 <= field.offset || store.word >= field.offset + field.words) continue;
      const declared = field.declaration;
      switch (declared.binding) {
        case "constant": case "private": break;
        case "classname": case "client-flags": case "view-offset": throw new Error(`Mod ${declared.binding} store requires its canonical owner`);
        case "think": case "nextthink": this.ownedActors.schedule(actor); break;
        case "health":
          if (this.services.combat.read(actor.id) === null) throw new Error("Mod health store requires a combat actor");
          this.services.combat.setHealth(actor, words.float(field.offset)); break;
        case "inventory": {
          const entry = this.services.inventory.entries(actor.id).find(entry => entry.item === declared.item);
          if (entry === undefined) throw new Error(`Mod inventory store requires ${declared.item}`);
          this.services.inventory.configure(actor, { ...entry, count: words.float(field.offset) }); break;
        }
        case "origin": case "angles": case "velocity": {
          const body = this.services.bodies.read(actor.id); if (body === null) throw new Error("Mod body binding disappeared");
          this.services.bodies.write(actor, { ...body, [declared.binding]: words.vector(field.offset) }); break;
        }
        case "bounds-min": case "bounds-max": {
          const body = this.services.bodies.read(actor.id); if (body === null) throw new Error("Mod bounds store requires a physical actor");
          this.services.bodies.write(actor, { ...body, bounds: { ...body.bounds, [declared.binding === "bounds-min" ? "min" : "max"]: words.vector(field.offset) } }); break;
        }
      }
    }
    return undefined;
  }
  private write(words: QcWords, offset: number, value: QcModValue): void {
    switch (value.kind) {
      case "float": if (!Number.isFinite(Math.fround(value.value))) throw new Error("Mod callback number exceeds binary32 range"); words.setFloat(offset, value.value); break;
      case "vector":
        if (![value.value.x, value.value.y, value.value.z].every(component => Number.isFinite(Math.fround(component)))) throw new Error("Mod callback vector exceeds binary32 range");
        words.setVector(offset, value.value); break;
      case "string": words.setInt(offset, this.machine.strings.setEngine(`mod-value:${value.value}`, value.value, Math.max(128, value.value.length + 1))); break;
      case "actor": words.setInt(offset, this.reference(value.value)); break;
    }
  }
  get cvars() { return this.environment.cvars; }
  bindCommands(commands: ModCommandPort): void {
    if (this.commands !== null) throw new Error("Mod commands are already bound");
    this.commands = commands;
  }
  consoleCommand(invocation: CommandInvocation): boolean {
    invocation.assertActive();
    const name = asciiFold(invocation.argv[0] ?? ""), command = this.declaration.commands?.find(command => asciiFold(command.name) === name);
    if (command === undefined) return false;
    this.invoke(qcConsoleCall(command, invocation.argv, invocation.argsText), new Map<ModCallbackInput, QcModValue>());
    return true;
  }
  invoke(call: ModSourceCall, inputs: QcModInputs): number {
    if (this.closed) throw new Error("Gameplay mod is closed");
    if (this.depth >= 64) throw new Error("Gameplay mod callback recursion exceeded 64 calls");
    const resolve = (value: ModCallbackValue): QcModValue => {
      if (value.kind !== "input") return value;
      const input = inputs.get(value.name);
      if (input === undefined) throw new Error(`Gameplay callback ${call.function} has no ${value.name} input`);
      return input;
    };
    const args = call.arguments.map(resolve), globals = call.globals.map(global => ({ definition: this.program.globalsByName.get(global.name), value: resolve(global.value) }));
    const staging = this.machine.globals.bytes.slice(4, 112), savedGlobals = globals.map(({ definition }) => {
      if (definition === undefined) throw new Error("Missing validated callback global");
      return { offset: definition.offset * 4, bytes: this.machine.globals.bytes.slice(definition.offset * 4, (definition.offset + (definition.type === "vector" ? 3 : 1)) * 4) };
    });
    this.depth++;
    try {
      for (const [index, value] of args.entries()) this.write(this.machine.globals, 4 + index * 3, value);
      for (const { definition, value } of globals) if (definition !== undefined) this.write(this.machine.globals, definition.offset, value);
      this.machine.execute(this.program.functionNamed(call.function).index, args.length);
      if (this.depth === 1) this.messages?.messages.flush();
      return this.machine.globals.float(1);
    } finally {
      this.machine.globals.bytes.set(staging, 4);
      for (const global of savedGlobals) this.machine.globals.bytes.set(global.bytes, global.offset);
      this.depth--;
    }
  }
  private invokeOwned(index: number, actor: ActorId, other: ActorId | null, time: FrameContext["time"]): void {
    const fn = this.program.functionAt(index);
    if (fn.parameterSizes.length !== 0 || fn.index === 0) throw new Error("Mod actor callback must be a no-argument source function");
    this.invoke({ function: fn.name, arguments: [], globals: [{ name: "self", value: { kind: "input", name: "self" } },
      { name: "other", value: { kind: "input", name: "other" } }, { name: "time", value: { kind: "input", name: "time" } }] },
      new Map<ModCallbackInput, QcModValue>([["self", { kind: "actor", value: actor }], ["other", { kind: "actor", value: other }],
        ["time", { kind: "float", value: time.kind === "seconds" ? time.value : time.value / 1000 }]]));
  }
  private invokeActorField(actor: ActorId, field: string, other: ActorId | null, activator: ActorId | null): undefined {
    const source = this.services.actors.sourceOf(actor);
    if (source === null) return undefined;
    const index = this.machine.entities.at(source.slot).int(this.machine.fieldOffset(field));
    if (index === 0) return undefined;
    const fn = this.program.functionAt(index), now = this.frame?.time ?? this.services.time();
    this.invoke({ function: fn.name, arguments: [], globals: [{ name: "self", value: { kind: "input", name: "self" } },
      { name: "other", value: { kind: "input", name: "other" } }, { name: "activator", value: { kind: "input", name: "activator" } },
      { name: "time", value: { kind: "input", name: "time" } }] },
      new Map<ModCallbackInput, QcModValue>([["self", { kind: "actor", value: actor }], ["other", { kind: "actor", value: other }],
        ["activator", { kind: "actor", value: activator }], ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }]]));
    return undefined;
  }
  private waterTransition(actor: ActorId): undefined {
    const engine = this.services.engine, source = this.services.actors.sourceOf(actor);
    if (engine === undefined || source === null) return undefined;
    const words = this.machine.entities.at(source.slot), field = (name: string) => this.machine.fieldOffset(name);
    const contents = engine.scene.pointContents({ point: words.vector(field("origin")), target: { kind: "world" },
      policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor });
    if (contents.kind !== "q1") throw new Error("QC mod water transition requires source Q1 contents");
    const decision = q1WaterTransition(words.float(field("watertype")), contents.contents);
    if (decision.splash && this.media !== undefined) {
      const path = "misc/h2ohit1.wav", asset = this.media.resources.get(path);
      if (asset !== undefined) {
        engine.events.registerResource(this.media.content, asset.resource.requestedPath, asset.resource);
        engine.events.emit(this.media.content, { kind: "q1", event: { kind: "sound", actor, path, channel: "auto", volume: 1, attenuation: 1 } });
      }
    }
    words.setFloat(field("watertype"), decision.waterType); words.setFloat(field("waterlevel"), decision.waterLevel);
    return undefined;
  }
  presentations(): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [];
    for (const actor of this.services.actors.ownedBy(this.module.id)) {
      const source = this.services.actors.sourceOf(actor.id); if (source === null) continue;
      const words = this.machine.entities.at(source.slot), field = (name: string) => this.machine.fieldOffset(name);
      const path = this.machine.strings.get(words.int(field("model")));
      if (path === "") continue;
      const asset = this.media?.resources.get(path);
      if (asset === undefined || this.media === undefined) throw new Error(`Mod model was not prepared: ${path}`);
      this.services.engine?.events.registerResource(this.media.content, asset.resource.requestedPath, asset.resource);
      const scalar = (name: string): number => { const field = this.program.fieldsByName.get(name); return field === undefined ? 0 : words.float(field.offset); };
      const frame = scalar("frame"), alpha = scalar("alpha"), scale = scalar("scale");
      result.push({ actor: actor.id, content: this.media.content, family: "q1", path, frame, oldFrame: frame, skin: scalar("skin"), effects: scalar("effects"), renderFlags: 0,
        origin: words.vector(field("origin")), angles: words.vector(field("angles")), scale: scale === 0 ? 1 : scale,
        alpha: alpha === 0 ? 1 : Math.max(0, Math.min(1, alpha)), visible: true, viewWeapon: false });
    }
    return result;
  }
  checkpoint(): QuakeCCheckpoint { if (this.depth !== 0) throw new Error("Mod checkpoint requires an idle callback boundary"); return captureQcCheckpoint(this.machine, this.module, this.hostState); }
  initialize(): undefined {
    if (this.initialized || this.depth !== 0) throw new Error("Mod source initialization must run once at an idle boundary");
    this.loading = true;
    try {
      const now = this.services.time();
      const inputs = new Map<ModCallbackInput, QcModValue>([["self", { kind: "actor", value: null }], ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }]]);
      for (const call of this.declaration.initialize ?? []) this.invoke(call, inputs);
      this.initialized = true;
    } finally { this.loading = false; }
    return undefined;
  }
  advance(frame: FrameContext): undefined {
    const elapsed = frame.elapsed.kind === "seconds" ? frame.elapsed.value : frame.elapsed.value / 1000;
    const time = (frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000) - elapsed;
    const frametime = this.program.globalsByName.get("frametime");
    if (frametime?.type === "float") this.machine.globals.setFloat(frametime.offset, elapsed);
    if (this.declaration.frame !== undefined) this.invoke(this.declaration.frame, new Map<ModCallbackInput, QcModValue>([
      ["self", { kind: "actor", value: null }], ["time", { kind: "float", value: time }], ["elapsed", { kind: "float", value: elapsed }],
    ]));
    return this.ownedActors.advance(frame);
  }
  restore(saved: QuakeCCheckpoint): undefined { if (this.depth !== 0) throw new Error("Mod restore requires an idle callback boundary"); return restoreQcCheckpoint(this.machine, this.module, this.hostState, saved); }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    try { this.ownedActors.close(); } finally {
      this.releaseProjection();
      this.messages?.close();
      for (const release of this.sourcePhysics.values()) release(); this.sourcePhysics.clear(); this.projections.clear(); this.actorsBySlot.clear();
    }
    return undefined;
  }
}
