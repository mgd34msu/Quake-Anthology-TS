import type { ProviderReference } from "../../../contracts/content.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { NativeModDeclaration } from "../../../contracts/native-mod-callbacks.ts";
import type { ProviderCheckpoint } from "../../../contracts/session.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import { nativeProviderTiming } from "../../../content/catalog/timing.ts";
import { asciiFold, type CommandInvocation } from "../../../core/commands/index.ts";
import type { ModCommandPort } from "../../../world/session/mod-commands.ts";
import { CvarRegistry } from "../../../core/cvars/index.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import type { GuestCallSignature, MappedGuestMemory } from "../../../guest/core/contracts.ts";
import type { WindowsCapabilities } from "../../../guest/runtime/windows/contracts.ts";
import type { RereleaseNavigationServices } from "../../../compat/q2/rerelease/navigation.ts";
import type { ActorCollision, SharedSceneQueries } from "../../../world/collision/index.ts";
import type { ModHostServices } from "../../../world/session/mods.ts";
import { ClassicOriginalSaveFiles, decodeQ2ClassicOriginalSave, encodeQ2ClassicOriginalSave } from "../../../persistence/q2-classic-guest.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../persistence/value.ts";
import { ClassicGuestSource, type PreparedClassicGuest } from "./classic-guest-source.ts";
import { RereleaseGuestSource, type PreparedRereleaseGuest } from "./rerelease-guest-source.ts";
import { ClassicGuestServices, type ClassicGuestServicesOptions } from "./classic-guest-services.ts";
import { RereleaseGuestServices } from "./rerelease-guest-services.ts";
import type { ActorHostRuntime } from "./source-hosts.ts";
import { SourceRandom } from "./random.ts";
import type { GuestCallRunnerOptions } from "../../../guest/abi/runner.ts";
import { RereleasePublicEdict } from "../../../compat/q2/rerelease/public-state.ts";
import { NativeModPresentation } from "./native-mod-presentation.ts";

export interface NativeModHostContext {
  readonly scene: SharedSceneQueries;
  readonly mapPath: string;
  readonly maxClients: number;
  readonly frameMilliseconds: number;
  readonly skill: number;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly gravity: number;
  readonly clock: Required<Pick<WindowsCapabilities, "nowMilliseconds" | "performanceCounter" | "performanceFrequency">>;
  readonly navigation: RereleaseNavigationServices;
  collision(actor: OwnedActor, collision: ActorCollision): undefined;
  engine(source: ProviderReference, runtime: ActorHostRuntime): ClassicGuestServicesOptions["engine"] & Pick<Q2FoundationHost, "worldActor">;
}
export interface NativeModProjection {
  project(record: RawEntityView): OwnedActor | null;
  actorAt(slot: number): ActorId | null;
  slotOf(actor: ActorId): number | null;
  acceptsClient(slot: number): boolean;
  address(actor: ActorId): GuestAddress;
  importBoundary(name: string, values: readonly GuestCallValue[], invoke: () => GuestCallResult): GuestCallResult;
}
export type NativeModSourceSave =
  | { readonly edition: "classic"; readonly original: ProviderCheckpoint }
  | { readonly edition: "rerelease"; readonly game: Uint8Array; readonly level: Uint8Array; readonly cvars: Uint8Array;
      readonly configstrings: readonly { readonly index: number; readonly value: string }[] };
export interface NativeModHost {
  readonly memory: MappedGuestMemory;
  readonly imageBase: GuestAddress;
  readonly cvars: CvarRegistry;
  readonly presentation: NativeModPresentation;
  readonly entries: Pick<GuestCallRunnerOptions, "callbacks" | "cpu">;
  entity(slot: number): RawEntityView;
  active(slot: number): boolean;
  clearEntityEvent(slot: number): void;
  encodeTrace(trace: TraceResult): Uint8Array;
  invokeCommand(command: CommandInvocation): boolean;
  entry(name: string): GuestAddress;
  entities(): { readonly base: GuestAddress; readonly stride: number; readonly count: number; readonly capacity: number };
  invoke(entry: GuestAddress, signature: GuestCallSignature, values: readonly GuestCallValue[]): GuestCallResult;
  initialize(restoring: boolean): Promise<void>;
  checkpoint(): Promise<NativeModSourceSave>;
  restore(save: NativeModSourceSave): Promise<void>;
  close(): undefined;
}
export interface NativeModHostOptions {
  readonly prepared: PreparedClassicGuest | PreparedRereleaseGuest;
  readonly declaration: NativeModDeclaration;
  readonly source: ProviderReference;
  readonly context: NativeModHostContext;
  readonly services: ModHostServices;
  readonly projection: NativeModProjection;
  bindCommands?(cvars: CvarRegistry): ModCommandPort;
  localize(key: string, arguments_: readonly string[]): string;
  nextFrame(): Promise<void>;
}

/** Reuses the selected DLL's real imports and original save callbacks in an isolated host. */
export function createNativeModHost(options: NativeModHostOptions): NativeModHost {
  const { context, services, prepared, declaration } = options;
  const rerelease = prepared.edition === "rerelease", timing = nativeProviderTiming(options.source, "q2", rerelease);
  const cvars = new CvarRegistry({ dialect: rerelease ? "q2-rerelease" : "q2-classic",
    context: { session: services.actors.session, origin: { kind: "server-console" } }, print: text => services.engine?.print(text) });
  for (const [name, value] of Object.entries({ maxclients: String(context.maxClients), skill: String(context.skill),
    deathmatch: context.mode === "deathmatch" ? "1" : "0", coop: context.mode === "coop" ? "1" : "0", sv_gravity: String(context.gravity) })) cvars.register(name, value);
  for (const cvar of declaration.cvars) { if (cvars.find(cvar.name) === undefined) cvars.register(cvar.name, cvar.value); else cvars.set(cvar.name, cvar.value, true); }
  const commands = options.bindCommands?.(cvars) ?? null;
  let currentCommand: CommandInvocation | null = null;
  const invokeCommand = (command: CommandInvocation, run: () => void): boolean => {
    if (asciiFold(command.argv[0] ?? "") !== "sv") return false;
    command.assertActive(); const parent = currentCommand; currentCommand = command;
    try { run(); return true; } finally { currentCommand = parent; }
  };
  const runtime: ActorHostRuntime = { numeric: timing.numeric, random: new SourceRandom(services.seed, rerelease ? "q2-rerelease" : "classic"),
    now: () => { const time = services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; },
    frameSeconds: () => rerelease ? context.frameMilliseconds / 1000 : 0.1,
    schedule: () => { throw new Error("Native mod scheduling requires a declared source lifecycle callback"); } };
  const unavailable = (operation: string): never => { throw new Error(`Native gameplay mod requires a declared ${operation} binding`); };
  const shared: ClassicGuestServicesOptions = { engine: context.engine(options.source, runtime), scene: context.scene, cvars,
    numeric: createNumericOperations(timing.numeric), mapPath: context.mapPath, maxClients: context.maxClients,
    admit: () => unavailable("owned actor"), collision: context.collision, acceptsClient: slot => options.projection.acceptsClient(slot),
    print: text => services.engine?.print(text), command: () => {
      currentCommand?.assertActive(); return { arguments: currentCommand?.argv ?? [], args: currentCommand?.argsText ?? "" };
    },
    addCommand: text => { if (commands === null) return unavailable("command buffer"); commands.append(text, currentCommand?.source); return undefined; }, debugGraph: () => unavailable("debug graph") };
  const map = context.mapPath.replace(/^maps\//, "").replace(/\.bsp$/, "");
  if (prepared.edition === "classic") {
    const files = new ClassicOriginalSaveFiles(); let adapter: ClassicGuestServices | null = null;
    const source = ClassicGuestSource.create(prepared, { capabilities: { ...context.clock, openFile: files.openFile }, importBoundary: (name, values, invoke) => options.projection.importBoundary(name, values, invoke),
      services(memory) { adapter = new ClassicGuestServices(memory, shared); return { ...adapter.services, projection: options.projection }; } });
    if (adapter === null) { source.close(); throw new Error("Classic mod did not initialize its imports"); }
    const retained: ClassicGuestServices = adapter; retained.bindHost(source.host);
    const spawn = async (): Promise<void> => { if (declaration.spawnEntities !== null) await source.host.spawnEntitiesLoading(map, declaration.spawnEntities, "", options.nextFrame); retained.completeSpawn(); };
    const identity = { module: source.memory.module, map: context.mapPath };
    const presentation = new NativeModPresentation({ edition: "classic", configstrings: () => retained.configstrings(), drainMessages: () => retained.drainMessages(),
      state(slot) { const state = retained.entityState(slot), record = source.host.edicts.at(slot); return { active: record.bytes.getInt32(88, true) !== 0 && (record.bytes.getInt32(184, true) & 1) === 0, sound: state.sound, event: state.event, origin: state.origin, volume: 1, attenuation: 1 }; },
      signature(slot) { const state = retained.entityState(slot); return JSON.stringify([state.modelIndexes, state.skin]); },
      appearance(slot) { const state = retained.entityState(slot), record = source.host.edicts.at(slot);
        return { ...retained.modelAppearance(slot), frame: state.frame, oldFrame: state.frame, effects: state.effects, renderFlags: state.renderEffects,
          scale: 1, alpha: (state.renderEffects & 32) !== 0 ? 0.3 : 1, visible: record.bytes.getInt32(88, true) !== 0 && (record.bytes.getInt32(184, true) & 1) === 0,
          origin: state.origin, angles: state.angles }; } }, options.source.content, options.projection, services, context, options.source.provider);
    return { memory: source.memory, imageBase: source.imageBase, cvars, presentation, entry: name => source.entry(name),
      encodeTrace: trace => source.host.traceBytes(trace),
      invokeCommand: command => invokeCommand(command, () => { source.host.call("ServerCommand"); }),
      clearEntityEvent: slot => { source.host.edicts.at(slot).bytes.setInt32(80, 0, true); },
      entries: source.host.options.runner.options, entity: slot => source.host.edicts.at(slot), active: slot => source.host.edicts.at(slot).bytes.getInt32(88, true) !== 0,
      entities: () => source.host.edicts.descriptor(), invoke: (entry, signature, values) => source.host.invoke(entry, signature, values),
      async initialize(restoring) { await source.initLoading(options.nextFrame); if (!restoring) await spawn(); },
      async checkpoint() { return { edition: "classic", original: encodeQ2ClassicOriginalSave(files.capture(identity,
        () => ({ cvars: encodeCheckpointValue(cvars.captureWorldTransferState()), configstrings: [...retained.configstrings()].map(([index, value]) => ({ index, value })), portals: [] }),
        (game, level, autosave) => { source.host.save("WriteGame", game, autosave); source.host.save("WriteLevel", level); })) }; },
      async restore(save) {
        if (save.edition !== "classic") throw new Error("Native mod save ABI differs");
        const original = decodeQ2ClassicOriginalSave(save.original, identity); cvars.restoreSaveState(decodeCheckpointValue(original.server.cvars));
        await files.restoreLoading(original, identity, async (game, level) => { await source.host.saveLoading("ReadGame", game, options.nextFrame); await spawn();
          for (const entry of original.server.configstrings) retained.setConfigstring(entry.index, entry.value);
          await source.host.saveLoading("ReadLevel", level, options.nextFrame); });
      }, close() { source.close(); return undefined; } };
  }
  const adapter = new RereleaseGuestServices({ ...shared, engine: context.engine(options.source, runtime), frameMilliseconds: context.frameMilliseconds,
    localize: options.localize, clipboard: { kind: "dedicated" }, navigation: context.navigation,
    debugShapes: () => unavailable("debug shape presentation"), worldText: () => unavailable("world text presentation"),
    semanticBindings: { project: record => options.projection.project(record), foreignAddress: actor => options.projection.address(actor),
      bind: () => unavailable("owned actor") } });
  const source = RereleaseGuestSource.create(prepared, { ...adapter.hostOptions, clock: context.clock, services: memory => adapter.bindMemory(memory),
    importBoundary: (name, values, invoke) => options.projection.importBoundary(name, values, invoke) });
  adapter.bindHost(source.host);
  const spawn = async (): Promise<void> => { if (declaration.spawnEntities !== null) await source.host.spawnEntitiesLoading(map, declaration.spawnEntities, "", options.nextFrame); adapter.completeSpawn(); };
  const presentation = new NativeModPresentation({ edition: "rerelease", configstrings: () => adapter.configstrings(), drainMessages: () => adapter.drainMessages(),
    state(slot) { const state = adapter.entityState(slot), info = adapter.entityInfo(slot); return { active: info.active && (info.serverFlags & 1) === 0, sound: state.sound, event: state.event, origin: state.origin, volume: state.loopVolume, attenuation: state.loopAttenuation }; },
    signature(slot) { const state = adapter.entityState(slot); return JSON.stringify([state.modelIndexes, state.skin]); },
    appearance(slot) { const state = adapter.entityState(slot), info = adapter.entityInfo(slot);
      if (state.effects > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Native mod effects exceed lossless shared presentation");
      return { ...adapter.modelAppearance(slot), frame: state.frame, oldFrame: state.oldFrame, effects: Number(state.effects), renderFlags: state.renderEffects,
        scale: state.scale === 0 ? 1 : state.scale, alpha: state.alpha === 0 ? (state.renderEffects & 32) !== 0 ? 0.3 : 1 : state.alpha,
        visible: info.active && (info.serverFlags & 1) === 0, origin: state.origin, angles: state.angles }; } }, options.source.content, options.projection, services, context, options.source.provider);
  return { memory: source.memory, imageBase: source.imageBase, cvars, presentation, entry: name => source.entry(name),
    encodeTrace: trace => { const result = source.host.encodeTrace(trace); if (result.kind !== "aggregate") throw new Error("Native trace must be an aggregate"); return result.bytes; },
    invokeCommand: command => invokeCommand(command, () => { source.host.module.callGame("ServerCommand"); }),
    clearEntityEvent: slot => { const record = new RereleasePublicEdict(source.memory, source.host.module.entities().atSlot(slot)); source.memory.writeUint8(record.address("s.event"), 0); },
    entries: source.host.module.options.runner.options, entity: slot => source.host.module.entities().atSlot(slot), active: slot => adapter.entityInfo(slot).active,
    entities() { const table = source.host.module.entities(); return { base: table.base, stride: table.strideBytes, count: table.count, capacity: table.capacity }; },
    invoke: (entry, signature, values) => source.host.module.invoke(entry, signature, values),
    async initialize(restoring) { await source.initLoading(options.nextFrame); if (!restoring) await spawn(); },
    async checkpoint() { const game = await source.host.writeSaveLoading("game", false, options.nextFrame), level = await source.host.writeSaveLoading("level", false, options.nextFrame);
      if (game.deferredDamage.length || game.projections.length || level.deferredDamage.length || level.projections.length) throw new Error("Unexpected whole-world native mod save state");
      return { edition: "rerelease", game: game.native, level: level.native, cvars: encodeCheckpointValue(cvars.captureWorldTransferState()),
        configstrings: [...adapter.configstrings()].map(([index, value]) => ({ index, value })) }; },
    async restore(save) { if (save.edition !== "rerelease") throw new Error("Native mod save ABI differs");
      cvars.restoreSaveState(decodeCheckpointValue(save.cvars)); source.host.core.refreshCvars();
      await source.host.readSaveLoading("game", { native: save.game, deferredDamage: [], projections: [] }, options.nextFrame); await spawn();
      adapter.restoreConfigstrings(new Map(save.configstrings.map(entry => [entry.index, entry.value])));
      await source.host.readSaveLoading("level", { native: save.level, deferredDamage: [], projections: [] }, options.nextFrame);
    }, close() { source.close(); return undefined; } };
}
