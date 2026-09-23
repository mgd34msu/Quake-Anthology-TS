import type { ModuleIdentity, QuakeCCheckpoint } from "../../contracts/execution.ts";
import type { ContentId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ModActorField, ModCallbackDeclaration, ModCallbackInput, ModCallbackValue, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { RandomSource, RandomState } from "../../contracts/numeric.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { createNumericOperations, nativeAtoi, Q1_DONOR_PROFILE } from "../../core/numeric.ts";
import { quakeWorldInfo } from "../../network/q1/handshake.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import { encodeCheckpointValue, decodeCheckpointValue, SaveReader } from "../../persistence/value.ts";
import { createQcBuiltins } from "./builtins.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import { createQcPresentationBindings } from "./presentation-host.ts";
import type { QcPrecachedResource } from "./presentation-host.ts";
import { createQcSpatialBindings } from "./spatial-host.ts";
import { QcModProtection, qcProtectionRegions } from "./mod-protection.ts";
import type { QcArmorStage } from "../../content/q1/quakec/armor-stage.ts";
import { QcModClientBindings } from "./mod-clients.ts";
import { QcModInput } from "./mod-input.ts";
import { createQcAimBinding } from "./client-host.ts";
import { QcModActors } from "./mod-actors.ts";
import { QcModCombat, validateQcModCombat } from "./mod-combat.ts";
import { qcArmorStage } from "../../content/q1/quakec/armor-stage.ts";
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
import { thinkCallbackTime } from "../../world/scheduler.ts";
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
    case "point": case "direction": case "normal": case "view-angles": return "vector";
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
  qcProtectionRegions(program, declaration);
  for (const protection of declaration.protection ?? []) validateCall(program, protection.absorb.call, new Set<ModCallbackInput>(["self", "attacker", "inflictor", "amount", "knockback", "damage-flags", "regular-protection-scale", "direction", "point", "normal", "time"]), "protection");
  const fields = new Set<number>();
  const think = declaration.actorFields.filter(field => field.binding === "think"), nextthink = declaration.actorFields.filter(field => field.binding === "nextthink");
  if (think.length !== nextthink.length || think.length > 1) throw new Error("Mod source scheduling requires one think and one nextthink binding together");
  for (const entry of declaration.actorFields) {
    if (entry.binding === "client-input" && (declaration.clients?.input === undefined || declaration.clients.input.length === 0
      || entry.update === "nonzero" && entry.input === "view-angles")) throw new Error("Mod client input fields require declared applications and scalar nonzero updates");
    if (entry.binding === "client-flags" && entry.privateMask !== undefined
      && (!Number.isInteger(entry.privateMask) || entry.privateMask < 0 || entry.privateMask > 0x7fffff || (entry.privateMask & (8 | 128 | (entry.grounded ? 512 : 0))) !== 0))
      throw new Error("Mod private client flags overlap canonical flags or exceed the source flag word");
    if (entry.binding === "userinfo" && (declaration.clients === undefined || entry.key.length === 0 || /[\\\x00]/u.test(entry.key))) throw new Error("Mod userinfo field requires a declared client and valid info key");
    if (entry.binding === "client-input" && entry.scale !== undefined && (!Number.isFinite(entry.scale) || entry.scale === 0 || entry.input === "view-angles")) throw new Error("QC input scale requires a finite nonzero scalar encoding");
    const field = program.fieldsByName.get(entry.field);
    if (field === undefined) throw new Error(`Missing mod actor field ${entry.field}`);
    const type = entry.binding === "private" ? field.type : entry.binding === "constant" ? entry.value.kind
      : entry.binding === "client-input" ? entry.input === "view-angles" ? "vector" : "float"
      : entry.binding === "classname" || entry.binding === "userinfo" ? "string" : entry.binding === "think" ? "function"
      : entry.binding === "health" || entry.binding === "inventory" || entry.binding === "nextthink" || entry.binding === "client-flags" ? "float" : "vector";
    if (field.type !== type) throw new Error(`Mod actor field ${entry.field} requires ${type}, found ${field.type}`);
    for (let word = field.offset; word < field.offset + (type === "vector" ? 3 : 1); word++) {
      if (fields.has(word)) throw new Error(`Overlapping mod actor field ${entry.field}`);
      fields.add(word);
    }
  }
  if (declaration.clients !== undefined) {
    if (!Number.isInteger(declaration.clients.maximum) || declaration.clients.maximum < 1 || declaration.clients.maximum >= 8191)
      throw new Error("Mod client capacity must fit reserved QuakeC edicts");
    for (const call of [...declaration.clients.admit, ...declaration.clients.userinfo, ...declaration.clients.disconnect])
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "client lifecycle");
    for (const call of declaration.clients.frame ?? [])
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time", "elapsed"]), "client frame");
    for (const binding of declaration.clients.input ?? []) if (binding.phase === "before") {
      const outputs = new Set<string>();
      for (const output of binding.outputs ?? []) {
        const key = output.kind === "field" ? `field:${output.field}` : `handler:${output.function}`;
        if (outputs.has(key)) throw new Error("QC input output declaration is duplicated");
        outputs.add(key);
        if (output.kind === "field") {
          if (!declaration.actorFields.some(field => field.binding === "client-input" && field.field === output.field)) throw new Error("QC output requires declared client input storage");
        } else {
          const fn = program.functionNamed(output.function);
          if (fn.index === 0 || fn.firstStatement <= 0 || fn.namedBuiltin || program.globalsByName.get("self")?.type !== "entity"
            || output.inputs.length === 0 || new Set(output.inputs).size !== output.inputs.length) throw new Error("QC output requires an original actor handler and distinct controls");
        }
      }
    }
    for (const binding of declaration.clients.input ?? []) for (const call of binding.calls)
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time", "elapsed", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"]), "client input");
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
  private readonly clients: QcModClientBindings | null;
  private readonly input: QcModInput;
  private readonly retiredProjections = new Set<ActorId>();
  private readonly combat: QcModCombat | null;
  private readonly protection: QcModProtection | null;
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
    if (declaration.clients !== undefined && services.clients === undefined) throw new Error("QuakeC component clients require destination client services");
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8192, (declaration.clients?.maximum ?? 0) + 1);
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
    if (services.engine !== undefined) host.set("aim", createQcAimBinding({
      options: { program, entities, bodies: services.bodies, scene: services.engine.scene, numeric: Q1_DONOR_PROFILE },
      actor: slot => {
        const actor = services.actors.resolveOwned(this.actor(entities.reference(slot)));
        if (actor === null) throw new Error("Aim references a released component actor"); return actor;
      },
    }, { aimThreshold: () => this.cvars.variableValue("sv_aim"), teamplay: () => this.cvars.variableValue("teamplay"),
      noAim: actor => {
        const client = services.clients?.forActor(actor);
        return program.api.kind === "q1-quakeworld" && client != null && services.clients !== undefined
          && nativeAtoi(quakeWorldInfo(services.clients.userinfo(client)).get("noaim") ?? "0") > 0;
      }, targets: () => {
        this.prepareEntities();
        const targets: { actor: ActorId; reference: number }[] = [];
        for (let slot = 1; slot < entities.count; slot++) {
          const actor = this.actorsBySlot.get(slot);
          if (actor !== undefined && services.actors.isLive(actor)) targets.push({ actor, reference: entities.reference(slot) });
        }
        return targets;
      } }));
    this.messages = null;
    if (services.engine !== undefined && media !== undefined) {
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
      }, { loading: () => this.loading, phs: () => this.cvars.variableValue("sv_phs") !== 0 });
      const qw = this.messages.routes.qw;
      for (const [name, builtin] of this.messages.messages.host) host.set(name, builtin);
      for (const [name, builtin] of createQcPresentationBindings(world, { ...services.engine, ...this.messages.routes, content: media.content, printBroadcastsToClients: true,
        ...(qw === undefined ? {} : { broadcastPrint: (text: string, level: number) =>
          qw.route([{ message: { kind: "print", text, level }, actor: null }], { kind: "broadcast", reliable: true }) }),
        loading: () => this.loading, lookup, precache: (kind, name) => {
          const resource = lookup(kind, name); if (resource === null) throw new Error(`Mod resource was not prepared: ${kind}/${name}`); return resource;
        } })) host.set(name, builtin);
    }
    for (const [name, builtin] of this.environment.host) host.set(name, builtin);
    if (declaration.clients !== undefined && program.api.kind === "q1-quakeworld") {
      host.set("infokey", vm => {
        const reference = vm.argInt(0), key = vm.argString(1);
        const actor = reference === 0 ? null : this.actorsBySlot.get(vm.entities.slot(reference));
        const value = reference === 0 ? this.cvars.variableString(key)
          : actor === undefined || actor === null || this.clients?.slot(actor) == null ? "" : this.clients.userinfo(actor, key);
        vm.returnInt(vm.strings.setEngine(`mod-infokey:${reference}:${key}`, value, Math.max(1024, value.length + 1)));
      });
      if (this.messages === null) for (const name of ["sprint", "centerprint", "stuffcmd"] satisfies readonly QcHostBuiltinName[]) host.set(name, vm => {
        const actor = this.actor(vm.argInt(0));
        if (this.clients?.slot(actor) == null) { services.engine?.print(`tried to ${name} to a non-client\n`); return; }
        const message = services.engine?.message; if (message === undefined) return vm.fail("Mod client message requires a destination message sink");
        const text = vm.varString(name === "sprint" ? 2 : 1);
        return message(name === "sprint" ? { kind: "print", level: Math.trunc(vm.argFloat(1)), text }
          : name === "centerprint" ? { kind: "center-print", text } : { kind: "command-text", text }, actor);
      });
    }
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
      } }), inlineBoundary: {
        regions: (() => {
          const primary = declaration.combat === undefined ? null : qcArmorStage(program, declaration.combat.armorStage);
          return [...new Map([...(primary === null ? [] : [primary]), ...qcProtectionRegions(program, declaration)].map(stage => [stage.entry, stage.region])).values()];
        })(),
        run: (region, execute) => this.combat === null ? execute() : this.combat.damage.inlineBoundary.run(region, execute),
      }, observeCall: call => { this.input.observeCall(call); return this.combat?.damage.observeCall(call); }, observeEntityStore: store => {
        this.protection?.observe(store); this.writeThrough(store); return this.combat?.damage.observeEntityStore(store);
      } });
    this.protection = declaration.protection === undefined ? null : new QcModProtection(declaration, module.id, services, { machine: this.machine, reference: actor => this.reference(actor), actor: reference => this.actor(reference), invoke: (call, inputs, region) => this.invoke(call, inputs, region) });
    this.input = new QcModInput(this.machine, this.fields.flatMap(field => field.declaration.binding === "client-input" ? [{ ...field, declaration: field.declaration }] : []), actor => this.reference(actor), actor => services.actors.isLive(actor));
    this.clients = declaration.clients === undefined || services.clients === undefined ? null : new QcModClientBindings({ services: services.clients, declaration: declaration.clients,
      ...(declaration.actorFields.some(field => field.binding === "think") ? { think: (actor: ActorId, frame: FrameContext, live: () => boolean) => this.runClientThink(actor, frame, live) } : {}),
      reserve: actor => this.protection?.reserve(actor), admitted: actor => this.protection?.activate(actor),
      project: actor => { this.reference(actor); }, release: actor => { this.protection?.release(actor); return this.releaseClientProjection(actor); }, invoke: (call, actor, frame) => {
        const previous = this.frame, now = frame?.time ?? services.time();
        if (frame !== undefined) this.frame = frame;
        try {
          const inputs = new Map<ModCallbackInput, QcModValue>([["self", { kind: "actor", value: actor }],
            ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }]]);
          if (frame !== undefined) inputs.set("elapsed", { kind: "float", value: frame.elapsed.kind === "seconds" ? frame.elapsed.value : frame.elapsed.value / 1000 });
          this.invoke(call, inputs);
        } finally { this.frame = previous; }
      }, input: {
        open: application => { const close = this.input.open(application); return () => { try { close(); } finally { this.drainRetiredProjections(); } }; },
        invoke: (call, application) => { this.invoke(call, this.input.values(application)); },
        output: (outputs, application, run) => this.input.output(outputs, application, run),
      } });
    this.environment.initializeGlobals(this.machine);
    this.actorState = new QcActorState({ machine: this.machine, rerelease: media?.content.includes(":rerelease:") === true,
      sourceSlot: actor => { const source = services.actors.sourceOf(actor); return source?.provider === module.id ? source.slot : null; },
      reference: reference => this.actor(reference), isClient: () => false });
    this.ownedActors = new QcModActors({ machine: this.machine, services, provider: module.id, firstDynamicSlot: (declaration.clients?.maximum ?? 0) + 1,
      ...(declaration.clients === undefined || (declaration.clients.frame?.length ?? 0) === 0 && !declaration.actorFields.some(field => field.binding === "think")
        ? {} : { clientFrame: (slot: number, frame: FrameContext) => this.clients?.frame(slot, frame) ?? false }),
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
        initialized: this.initialized, clients: this.clients?.checkpoint().map(entry => ({ ...entry, actor: savedActorId(entry.actor) })) ?? null }) }, random: [random.checkpoint()], callbacks: [] }),
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
        const clients = savedHost.field("clients");
        if (this.clients !== null) {
          this.clients.restore(clients.list(entry => ({ actor: resolve(readSavedActor(entry.field("actor"))), slot: entry.field("slot").integer(1), admitted: entry.field("admitted").boolean() })));
          const projected = this.clients.checkpoint();
          if (entities.count <= (declaration.clients?.maximum ?? 0) || projected.some(entry => this.projections.get(entry.actor) !== entry.slot)
            || [...this.actorsBySlot].some(([slot, actor]) => slot <= (declaration.clients?.maximum ?? 0) && !projected.some(entry => entry.slot === slot && entry.actor.equals(actor))))
            throw new Error("Saved QuakeC client projection differs from its reserved slot");
        } else if (clients.value !== undefined && clients.value !== null) throw new Error("Saved QuakeC clients require the declared lifecycle service");
        this.ownedActors.restored();
        for (const client of this.clients?.checkpoint() ?? []) { this.protection?.reserve(client.actor); if (client.admitted) this.protection?.activate(client.actor); }
        this.clients?.start();
        return undefined;
      },
    };
    this.releaseProjection = services.actors.onRelease(actor => {
      this.protection?.release(actor.id); this.retiredProjections.add(actor.id); this.drainRetiredProjections();
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
    const current = this.services.actors.resolveOwned(actor)?.id;
    if (current === undefined) throw new Error("Gameplay mod cannot project a stale actor");
    const existing = this.projections.get(current);
    if (existing !== undefined) return this.machine.entities.reference(existing);
    const clientSlot = this.clients?.slot(current) ?? null, slot = clientSlot ?? this.machine.entities.count;
    if (clientSlot === null) this.machine.entities.setCount(slot + 1);
    else this.machine.entities.at(slot).bytes.fill(0);
    this.projections.set(current, slot); this.actorsBySlot.set(slot, current);
    for (const field of this.fields) if (field.declaration.binding === "constant") this.write(this.machine.entities.at(slot), field.offset, field.declaration.value);
    return this.machine.entities.reference(slot);
  }
  private releaseClientProjection(actor: ActorId): "released" | "deferred" {
    if (this.depth !== 0 || this.input.active) { this.retiredProjections.add(actor); return "deferred"; }
    const slot = this.projections.get(actor);
    if (slot !== undefined) { this.projections.delete(actor); this.actorsBySlot.delete(slot); this.machine.entities.at(slot).bytes.fill(0); }
    return "released";
  }
  private drainRetiredProjections(): void {
    if (this.depth !== 0 || this.input.active) return;
    for (const actor of this.retiredProjections) {
      this.clients?.forget(actor); this.releaseClientProjection(actor); this.retiredProjections.delete(actor);
    }
  }
  private prepareEntities(): void { for (const actor of this.services.actors.observations()) this.reference(actor.id); }
  private refresh(actor: ActorId, slot: number, word: number, count: number): void {
    const words = this.machine.entities.at(slot);
    for (const field of this.fields) {
      if (word + count <= field.offset || word >= field.offset + field.words) continue;
      const declared = field.declaration;
      switch (declared.binding) {
        case "constant": case "private": case "client-input": case "think": case "nextthink": break;
        case "userinfo": {
          if (this.clients === null) throw new Error("Mod userinfo field requires client services");
          if (this.clients.slot(actor) === null) break;
          const value = this.clients.userinfo(actor, declared.key);
          words.setInt(field.offset, this.machine.strings.setEngine(`mod-userinfo:${slot}:${declared.key}`, value, Math.max(128, value.length + 1))); break;
        }
        case "classname": {
          const name = this.services.engine?.classname?.(actor);
          if (name === undefined) throw new Error("Mod classname field requires canonical actor metadata");
          words.setInt(field.offset, this.machine.strings.setEngine(`mod-classname:${name}`, name, Math.max(128, name.length + 1))); break;
        }
        case "client-flags": {
          const client = this.environment.client(actor);
          let canonical = client === null ? 0 : 8 | (client.notarget ? 128 : 0);
          if (client !== null && declared.grounded) {
            const identity = this.services.clients?.forActor(actor), grounded = this.services.clients?.grounded;
            if (identity == null || grounded === undefined) throw new Error("Mod grounded flags require canonical client movement state");
            if (grounded(identity)) canonical |= 512;
          }
          words.setFloat(field.offset, canonical | (Math.trunc(words.float(field.offset)) & (declared.privateMask ?? 0))); break;
        }
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
        case "constant": case "private": case "client-input": break;
        case "userinfo": {
          if (this.clients === null) throw new Error("Mod userinfo field requires client services");
          if (this.clients.slot(actor.id) !== null) this.clients.setUserinfo(actor.id, declared.key, this.machine.strings.get(words.int(field.offset)));
          break;
        }
        case "client-flags": {
          const before = new DataView(store.before.buffer, store.before.byteOffset, store.before.byteLength).getFloat32((field.offset - store.word) * 4, true);
          const next = Math.trunc(words.float(field.offset));
          const changed = (Math.trunc(before) ^ next) & ~(declared.privateMask ?? 0);
          if (changed !== 0) {
            if (!declared.grounded || changed !== 512 || (next & 512) !== 0) throw new Error("Mod client-flags store requires its canonical owner");
            const body = this.services.bodies.read(actor.id);
            if (body === null) throw new Error("Mod ground detachment requires a live body");
            this.services.bodies.write(actor, { ...body, ground: null });
          }
          break;
        }
        case "classname": case "view-offset": throw new Error(`Mod ${declared.binding} store requires its canonical owner`);
        case "think": case "nextthink":
          if (this.machine.entities.slot(store.reference) > (this.declaration.clients?.maximum ?? 0)) this.ownedActors.schedule(actor);
          break;
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
  invoke(call: ModSourceCall, inputs: QcModInputs, region?: QcArmorStage): number {
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
      let result: number;
      if (region === undefined) { this.machine.execute(this.program.functionNamed(call.function).index, args.length); result = this.machine.globals.float(1); }
      else result = this.machine.executeRegion(region.region, args.length);
      if (this.depth === 1) this.messages?.messages.flush();
      return result;
    } finally {
      this.machine.globals.bytes.set(staging, 4);
      for (const global of savedGlobals) this.machine.globals.bytes.set(global.bytes, global.offset);
      this.depth--;
      this.drainRetiredProjections();
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
  private runClientThink(actor: ActorId, frame: FrameContext, live: () => boolean): void {
    const nextthink = this.machine.fieldOffset("nextthink"), think = this.machine.fieldOffset("think");
    const profile = this.program.api.kind === "q1-quakeworld"
      ? { kind: "q1-quakeworld", maximumCommandMilliseconds: 100 } satisfies import("../../contracts/time.ts").ClockProfile
      : { kind: "q1-netquake", minimumFrameSeconds: 0, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } satisfies import("../../contracts/time.ts").ClockProfile;
    while (live()) {
      const words = this.machine.entities.fromReference(this.reference(actor));
      const time = thinkCallbackTime(profile, { kind: "seconds", value: words.float(nextthink) }, frame);
      if (time === null) return;
      const index = words.int(think); words.setFloat(nextthink, 0);
      const previous = this.frame; this.frame = { ...frame, time, phase: "entity-think" };
      try { this.invokeOwned(index, actor, null, time); }
      finally { this.frame = previous; }
      if (profile.kind !== "q1-quakeworld") return;
    }
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
  checkpoint(): QuakeCCheckpoint { this.protection?.assertIdle(); if (this.depth !== 0 || this.input.active) throw new Error("Mod checkpoint requires an idle callback boundary"); return captureQcCheckpoint(this.machine, this.module, this.hostState); }
  initialize(): undefined {
    if (this.initialized || this.depth !== 0) throw new Error("Mod source initialization must run once at an idle boundary");
    this.loading = true;
    try {
      for (const client of this.services.clients?.clients() ?? []) this.protection?.reserve(client.actor);
      const now = this.services.time();
      const inputs = new Map<ModCallbackInput, QcModValue>([["self", { kind: "actor", value: null }], ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }]]);
      for (const call of this.declaration.initialize ?? []) this.invoke(call, inputs);
      this.initialized = true;
    } finally { this.loading = false; }
    this.clients?.start();
    this.messages?.start();
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
  restore(saved: QuakeCCheckpoint): undefined {
    this.protection?.assertIdle();
    if (this.depth !== 0 || this.input.active) throw new Error("Mod restore requires an idle callback boundary");
    this.protection?.close();
    return restoreQcCheckpoint(this.machine, this.module, this.hostState, saved);
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.protection?.close(); this.closed = true; this.clients?.close();
    try { this.ownedActors.close(); } finally {
      this.releaseProjection();
      this.messages?.close();
      for (const release of this.sourcePhysics.values()) release(); this.sourcePhysics.clear(); this.projections.clear(); this.actorsBySlot.clear();
    }
    return undefined;
  }
}
