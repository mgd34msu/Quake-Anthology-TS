import type { PresentationOwner } from "../../contracts/presentation.ts";
import type { ActiveModClientPresentation, ModClientPresentationAdmission, ModClientPresentationSource } from "./mod-client-presentation.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import { modInstanceProvider, modSelectionKey } from "../../contracts/mods.ts";
import type { ModCheckpoint, ModDescription, ModIdentity, ModPrivateCheckpoint, ModSelection, ModSessionCheckpoint, ModTravelCheckpoint } from "../../contracts/mods.ts";
import { ModSelectionSet } from "../../content/mods/selection.ts";
import type { ActorCallbackTable } from "../actors/callbacks.ts";
import type { GameplayAuthority } from "../gameplay/authority.ts";
import type { SharedInventoryTable } from "../gameplay/inventory.ts";
import type { ModOperation, ModOperationRegistration, ModRegistrationIdentity } from "../gameplay/mod-composition.ts";
import { ResourceScope } from "./resources.ts";
import type { SessionResource } from "./resources.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import type { SharedBodyTable } from "../actors/body.ts";
import type { FrameContext, SourceTime } from "../../contracts/time.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { SharedSceneQueries } from "../collision/index.ts";
import type { QcPresentationServices } from "../../compat/qc/presentation-host.ts";
import type { SharedPhysics } from "../../app/bootstrap/simulation/physics.ts";
import type { SimulationPresentation } from "../../app/bootstrap/simulation/types.ts";
import type { SimulationEvents } from "../../app/bootstrap/simulation/events.ts";
import type { AttackProvenance } from "../../contracts/gameplay.ts";
import type { NativeModHostContext } from "../../app/bootstrap/simulation/native-mod-host.ts";
import type { QuakeCLocalMessageHost } from "../../app/bootstrap/simulation/quakec-local-messages.ts";
import type { NetworkEvent } from "../../contracts/protocol.ts";
import type { Q1ClientVisibilityScene, Q1VisibilityClient } from "../gameplay/q1-client-visibility.ts";
import type { ModCommands } from "./mod-commands.ts";
import type { ModUserFiles } from "./mod-files.ts";
import type { ModClientServices } from "./mod-clients.ts";
import type { ActiveModPresentation, ModQvmPresentationSource } from "./mod-presentations.ts";
import type { QvmModPresentationDeclaration } from "../../contracts/qvm-mod-presentation.ts";
import type { QvmModuleOptions } from "../../compat/qvm/module.ts";
import type { SourceWeaponServices } from "../../contracts/source-items.ts";

export interface ModOperations {
  readonly actors: ActorCallbackTable["operations"];
  readonly damage: GameplayAuthority["damageOperation"];
  readonly inventory: SharedInventoryTable["operations"];
}

type WithoutOwner<T> = T extends ModRegistrationIdentity ? Omit<T, "provider" | "order"> : never;
export type ModContribution<Request, Result> = WithoutOwner<ModOperationRegistration<Request, Result>>;

export class ModRegistrations {
  constructor(readonly instance: ProviderId, readonly operations: ModOperations,
    private readonly order: number, private readonly resources: ResourceScope) {}

  register<Request, Result>(operation: ModOperation<Request, Result>, contribution: NoInfer<ModContribution<Request, Result>>): () => undefined {
    this.resources.assertOpen();
    const remove = operation.register({ ...contribution, provider: this.instance, order: this.order });
    this.resources.defer(remove);
    return remove;
  }
}

export interface ModInitialization {
  readonly restoring?: boolean;
  readonly services: ModHostServices | null;
  readonly instance: ProviderId;
  /** Own partial acquisitions immediately so failed initialization can release them. */
  readonly resources: ResourceScope;
  nextFrame(): Promise<void>;
  assertCurrent(): void;
}
export interface ModHostServices {
  readonly weapons?: SourceWeaponServices;
  readonly clients?: ModClientServices;
  readonly commands?: Pick<ModCommands, "bind">;
  readonly files?: Pick<ModUserFiles, "for">;
  readonly native?: NativeModHostContext;
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly seed: number;
  readonly callbacks?: ActorCallbackTable;
  damageContext?(source: ProviderId): Pick<AttackProvenance, "sequence" | "weaponProvider" | "combatProvider" | "inventoryProvider" | "movementProvider">;
  referenceSaved?(actor: SavedActorId): ActorId;
  readonly engine?: Pick<QcPresentationServices, "print"> & {
    readonly environment?: { readonly skill: number; readonly mode: "singleplayer" | "coop" | "deathmatch"; readonly maxClients: number; readonly gravity: number; };
    readonly clients?: { readonly maximum: number; readonly visibility: Q1ClientVisibilityScene; at(slot: number): Q1VisibilityClient; };
    classname?(actor: ActorId): string;
    inlineModel?(index: number): { readonly bounds: Bounds; readonly content: ContentId; readonly family: "q1" | "q2" | "q3" };
    areaEntities?(bounds: Bounds): readonly ActorId[];
    message?(event: NetworkEvent, actor: ActorId | null): undefined;
    readonly presentation?: Pick<QuakeCLocalMessageHost, "map" | "camera"> & { players(): readonly ActorId[]; };
    readonly events: Pick<SimulationEvents, "emit" | "registerResource">;
    readonly scene: Pick<SceneQueries, "trace" | "pointContents"> & Partial<Pick<SharedSceneQueries,
      "geometry" | "boxLeaves" | "leafArea" | "areasConnected" | "adjustAreaPortalState" | "adjustAreaPortalContribution" | "nativeQ3ClipModels">>;
    world(): ActorId | null;
    readonly physics?: Pick<SharedPhysics, "bindSource" | "setCollision" | "step" | "touchTriggers" | "q1PusherServices" | "readQ1Pusher" | "writeQ1Pusher">;
  };
  time(): SourceTime;
}

export interface ModRuntime extends SessionResource {
  clientPresentation?(): ModClientPresentationSource;
  qvmPresentation?(): ModQvmPresentationSource;
  /** Attach prepared actor bindings after original source state has initialized or restored. */
  activate?(): undefined;
  register(registrations: ModRegistrations): undefined;
  advance?(frame: FrameContext): undefined;
  presentations?(): readonly SimulationPresentation[];
  /** Body replacements carry the mod's assets; later enabled mods take precedence. */
  appearanceOverrides?(): readonly SimulationPresentation[];
  /** Return detached source snapshots at an idle gameplay boundary. */
  checkpoint(): Promise<ModPrivateCheckpoint>;
  restore(state: ModPrivateCheckpoint): Promise<void>;
}

export interface PreparedMod {
  readonly clientPresentation?: ModClientPresentationAdmission;
  readonly description: ModDescription;
  readonly identity: ModIdentity;
  readonly presentation?: { readonly kind: "qvm"; readonly artifact: QvmModuleOptions["artifact"];
    readonly source: ModuleIdentity; readonly declaration: QvmModPresentationDeclaration };
  /** Native source save callbacks retain executable state through their declared provider records. */
  readonly moduleCheckpoint?: "guest" | "provider";
  /** Only adapters with state independent of the old world's actor graph may retain it. */
  readonly travel?: "restart" | "retain";
  /** Validate source layouts and state without changing a live instance. */
  validateState(state: ModPrivateCheckpoint): void;
  initialize(context: ModInitialization): Promise<ModRuntime>;
}

interface PreparedEntry { readonly prepared: PreparedMod; readonly identity: ModIdentity; }
interface ActiveMod extends PreparedEntry { readonly presentationOwner: PresentationOwner | null; readonly resources: ResourceScope; readonly runtime: ModRuntime; }
const emptyAppearances: ReadonlyMap<ActorId, readonly SimulationPresentation[]> = new Map<ActorId, readonly SimulationPresentation[]>();

export interface SessionModsOptions {
  readonly presentation?: Pick<SimulationEvents, "bindOwner" | "finishOwnerRestore" | "refreshOwner">;
  readonly services?: ModHostServices;
  readonly prepared: readonly PreparedMod[];
  readonly enabled: readonly ModSelection[];
  readonly operations: ModOperations;
  nextFrame(): Promise<void>;
}

function sameModule(left: ModuleIdentity, right: ModuleIdentity): boolean {
  return left.id === right.id && left.artifactPath === right.artifactPath && left.digest === right.digest && left.revision === right.revision;
}
function sameIdentity(left: ModIdentity, right: ModIdentity): boolean {
  return modSelectionKey(left.selection) === modSelectionKey(right.selection)
    && left.source.provider === right.source.provider && left.source.content === right.source.content
    && left.declarationDigest === right.declarationDigest && left.modules.length === right.modules.length
    && left.modules.every((module, index) => { const other = right.modules[index]; return other !== undefined && sameModule(module, other); })
    && left.providers.length === right.providers.length && left.providers.every((provider, index) => {
      const other = right.providers[index];
      return other !== undefined && provider.provider === other.provider && provider.schema === other.schema && provider.version === other.version;
    });
}
function retainIdentity(identity: ModIdentity): ModIdentity {
  return Object.freeze({ ...identity, selection: Object.freeze({ ...identity.selection }), source: Object.freeze({ ...identity.source }),
    modules: Object.freeze(identity.modules.map(module => Object.freeze({ ...module }))),
    providers: Object.freeze(identity.providers.map(provider => Object.freeze({ ...provider }))) });
}
function closeScopes(scopes: readonly ResourceScope[]): void {
  const errors: unknown[] = [];
  for (const scope of [...scopes].reverse()) try { scope.close(); } catch (error) { errors.push(error); }
  if (errors.length > 0) throw new AggregateError(errors, "Mod cleanup failed");
}

/** Source adapters own execution; this owner orders and releases their shared registrations. */
export class SessionMods implements SessionResource {
  private readonly prepared = new Map<string, PreparedEntry>();
  private readonly pending = new Set<ResourceScope>();
  private active: readonly ActiveMod[] = [];
  private closed = false;
  private busy = false;
  private nextOrder = 0;

  private constructor(private readonly options: SessionModsOptions) {
    for (const prepared of options.prepared) {
      const key = modSelectionKey(prepared.description.selection), identity = retainIdentity(prepared.identity);
      if (this.prepared.has(key)) throw new Error(`Duplicate prepared mod: ${key}`);
      if (key !== modSelectionKey(identity.selection) || identity.source.provider !== prepared.description.source.provider
        || identity.source.content !== prepared.description.source.content) throw new Error(`Prepared mod identity differs from its declaration: ${key}`);
      this.prepared.set(key, { prepared, identity });
    }
  }

  static async open(options: SessionModsOptions, saved?: ModSessionCheckpoint, travel?: ModTravelCheckpoint): Promise<SessionMods> {
    if (saved !== undefined && travel !== undefined) throw new Error("Mod save restoration and world travel are distinct lifecycle operations");
    const owner = new SessionMods(options);
    try {
      await owner.exclusive(async () => { await owner.apply(owner.selection(options.enabled).enabled(), saved, travel); });
      options.presentation?.finishOwnerRestore();
      return owner;
    } catch (error) {
      try { owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Mod initialization and cleanup failed"); }
      throw error;
    }
  }

  enabled(): readonly ModSelection[] { return this.active.map(entry => entry.identity.selection); }
  owns(provider: ProviderId): boolean { return this.active.some(entry => modInstanceProvider(entry.identity.selection) === provider); }
  presentations(): readonly SimulationPresentation[] { return this.active.flatMap(entry => entry.runtime.presentations?.() ?? []); }
  appearanceOverrides(): ReadonlyMap<ActorId, readonly SimulationPresentation[]> {
    let appearances: Map<ActorId, readonly SimulationPresentation[]> | null = null;
    for (const entry of this.active) {
      const source = entry.runtime.appearanceOverrides?.();
      if (source === undefined || source.length === 0) continue;
      appearances ??= new Map<ActorId, readonly SimulationPresentation[]>();
      const models = new Map<ActorId, SimulationPresentation[]>();
      for (const appearance of source) {
        if (appearance.viewWeapon) throw new Error("Mod body appearance cannot replace a view weapon");
        const group = models.get(appearance.actor);
        if (group === undefined) models.set(appearance.actor, [appearance]); else group.push(appearance);
      }
      for (const [actor, group] of models) appearances.set(actor, group);
    }
    return appearances ?? emptyAppearances;
  }

  advance(frame: FrameContext): undefined {
    this.assertOpen();
    if (this.busy) throw new Error("Cannot advance mods during a lifecycle operation");
    this.busy = true;
    try { for (const entry of this.active) { entry.runtime.advance?.(frame); this.assertOpen(); } }
    finally { this.busy = false; }
    return undefined;
  }

  async setEnabled(selection: ModSelection, enabled: boolean): Promise<void> {
    await this.exclusive(async () => {
      const next = this.selection(this.enabled()); next.setEnabled(selection, enabled);
      await this.apply(next.enabled());
    });
  }

  async checkpoint(): Promise<ModSessionCheckpoint> {
    return await this.exclusive(() => this.capture());
  }

  clientPresentationSources(): readonly ActiveModClientPresentation[] {
    this.assertOpen();
    if (this.busy) throw new Error("Cannot read component client output during a lifecycle operation");
    return this.active.flatMap(entry => {
      if (entry.prepared.clientPresentation === undefined) return [];
      const source = entry.runtime.clientPresentation?.();
      if (source === undefined || entry.presentationOwner === null) throw new Error("Declared client presentation has no source owner");
      return [{ owner: entry.presentationOwner, identity: entry.identity, source }];
    });
  }

  presentationSources(): readonly ActiveModPresentation[] {
    this.assertOpen();
    if (this.busy) throw new Error("Cannot read mod presentation during a lifecycle operation");
    return this.active.flatMap(entry => {
      const prepared = entry.prepared.presentation;
      if (prepared === undefined) return [];
      const source = entry.runtime.qvmPresentation?.();
      if (source === undefined) throw new Error("Declared QVM presentation has no live source context");
      return [{ identity: entry.identity, prepared, source }];
    });
  }

  async checkpointForTravel(): Promise<ModTravelCheckpoint> {
    return await this.exclusive(async () => {
      this.options.services?.combat.assertIdle();
      const mods: ModTravelCheckpoint["mods"][number][] = [];
      for (const entry of this.active) {
        const state = entry.prepared.travel === "retain" ? await entry.runtime.checkpoint() : null;
        this.assertOpen(); this.options.services?.combat.assertIdle();
        if (state !== null) this.validateState(entry, state);
        mods.push({ identity: entry.identity, state });
      }
      return { version: 1, mods };
    });
  }

  async restore(saved: ModSessionCheckpoint): Promise<void> {
    await this.exclusive(async () => {
      this.validateSaved(this.active, saved);
      const previous = await this.capture(), changed: number[] = [];
      try {
        for (const [index, entry] of this.active.entries()) {
          const checkpoint = saved.mods[index];
          if (checkpoint === undefined) throw new Error("Validated mod checkpoint disappeared");
          changed.push(index);
          if (this.options.services?.engine !== undefined) this.options.presentation?.refreshOwner(modInstanceProvider(entry.identity.selection));
          await entry.runtime.restore(checkpoint.state); this.assertOpen(); entry.runtime.activate?.(); this.assertOpen();
        }
      } catch (error) {
        if (this.closed) throw error;
        const errors: unknown[] = [error];
        for (const index of changed.reverse()) {
          const entry = this.active[index], checkpoint = previous.mods[index];
          if (entry === undefined || checkpoint === undefined) throw new Error("Mod restore lost its rollback state");
          try {
            if (this.options.services?.engine !== undefined) this.options.presentation?.refreshOwner(modInstanceProvider(entry.identity.selection));
            await entry.runtime.restore(checkpoint.state); entry.runtime.activate?.(); } catch (rollback) { errors.push(rollback); }
        }
        if (errors.length > 1) {
          try { this.close(); } catch (cleanup) { errors.push(cleanup); }
          throw new AggregateError(errors, "Mod restore and rollback failed; mod runtimes were closed");
        }
        throw error;
      }
    });
  }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const scopes = [...this.active.map(entry => entry.resources), ...this.pending];
    this.active = []; this.pending.clear();
    closeScopes(scopes);
    return undefined;
  }

  private assertOpen(): void { if (this.closed) throw new Error("Mod session is closed"); }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.busy) throw new Error("Mod session lifecycle operation is already active");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private selection(enabled: readonly ModSelection[]): ModSelectionSet {
    return new ModSelectionSet([...this.prepared.values()].map(entry => entry.prepared.description), enabled);
  }
  private entries(selections: readonly ModSelection[]): readonly PreparedEntry[] {
    return selections.map(selection => {
      const entry = this.prepared.get(modSelectionKey(selection));
      if (entry === undefined) throw new Error(`Selected mod is not prepared: ${modSelectionKey(selection)}`);
      return entry;
    });
  }
  private validateState(entry: PreparedEntry, state: ModPrivateCheckpoint): void {
    const identity = entry.identity, key = modSelectionKey(identity.selection);
    if (state.guests.length !== (entry.prepared.moduleCheckpoint === "provider" ? 0 : identity.modules.length) || !state.guests.every((guest, index) => {
      const module = identity.modules[index]; return module !== undefined && sameModule(guest.module, module);
    })) throw new Error(`Mod guest state ownership differs: ${key}`);
    if (state.providers.length !== identity.providers.length || !state.providers.every((provider, index) => {
      const expected = identity.providers[index];
      return expected !== undefined && provider.provider === expected.provider && provider.schema === expected.schema && provider.version === expected.version;
    })) throw new Error(`Mod provider state ownership differs: ${key}`);
    entry.prepared.validateState(state);
  }
  private validateSaved(entries: readonly PreparedEntry[], saved: ModSessionCheckpoint): void {
    if (saved.version !== 1 || saved.mods.length !== entries.length) throw new Error("Saved mod selection differs from the enabled mods");
    for (const [index, entry] of entries.entries()) {
      const checkpoint = saved.mods[index];
      if (checkpoint === undefined || !sameIdentity(entry.identity, checkpoint.identity)) throw new Error(`Saved mod order or identity differs: ${modSelectionKey(entry.identity.selection)}`);
      this.validateState(entry, checkpoint.state);
    }
  }
  private validateTravel(entries: readonly PreparedEntry[], travel: ModTravelCheckpoint): void {
    if (travel.version !== 1 || travel.mods.length !== entries.length) throw new Error("Travel mod selection differs from the enabled mods");
    for (const [index, entry] of entries.entries()) {
      const checkpoint = travel.mods[index];
      if (checkpoint === undefined || !sameIdentity(entry.identity, checkpoint.identity)) throw new Error(`Travel mod order or identity differs: ${modSelectionKey(entry.identity.selection)}`);
      if ((checkpoint.state !== null) !== (entry.prepared.travel === "retain")) throw new Error("Mod travel state differs from its source lifecycle");
      if (checkpoint.state !== null) this.validateState(entry, checkpoint.state);
    }
  }
  private async capture(): Promise<ModSessionCheckpoint> {
    this.options.services?.combat.assertIdle();
    const mods: ModCheckpoint[] = [];
    for (const entry of this.active) {
      const state = await entry.runtime.checkpoint(); this.assertOpen(); this.options.services?.combat.assertIdle();
      this.validateState(entry, state); mods.push({ identity: entry.identity, state });
    }
    return { version: 1, mods };
  }

  private async apply(selections: readonly ModSelection[], saved?: ModSessionCheckpoint, travel?: ModTravelCheckpoint): Promise<void> {
    const prepared = this.entries(selections);
    let hud: PreparedEntry | null = null, view: PreparedEntry | null = null;
    for (const entry of prepared) {
      const claim = entry.prepared.clientPresentation;
      if (claim?.hud === "replace") {
        if (hud !== null) throw new Error(`Component HUD replacement conflict: ${modSelectionKey(hud.identity.selection)} and ${modSelectionKey(entry.identity.selection)}`);
        hud = entry;
      }
      if (claim?.view === true) {
        if (view !== null) throw new Error(`Component camera control conflict: ${modSelectionKey(view.identity.selection)} and ${modSelectionKey(entry.identity.selection)}`);
        view = entry;
      }
    }
    if (saved !== undefined) this.validateSaved(prepared, saved);
    if (travel !== undefined) this.validateTravel(prepared, travel);
    const retained = new Map(this.active.map(entry => [modSelectionKey(entry.identity.selection), entry]));
    const opened: ActiveMod[] = [], scopes: ResourceScope[] = [], next: ActiveMod[] = [];
    try {
      for (const [index, entry] of prepared.entries()) {
        const previous = retained.get(modSelectionKey(entry.identity.selection));
        if (previous !== undefined) { next.push(previous); continue; }
        const resources = new ResourceScope(`mod ${modSelectionKey(entry.identity.selection)}`);
        scopes.push(resources); this.pending.add(resources);
        const assertCurrent = (): void => { this.assertOpen(); resources.assertOpen(); };
        const state = saved?.mods[index]?.state ?? travel?.mods[index]?.state;
        let services = this.options.services ?? null;
        let presentationOwner: PresentationOwner | null = null;
        if (services?.engine !== undefined) {
          if (this.options.presentation === undefined) throw new Error("Component engine output requires presentation ownership");
          const events = resources.own(this.options.presentation.bindOwner(modInstanceProvider(entry.identity.selection), entry.identity.source.content, state != null));
          presentationOwner = events.owner;
          services = { ...services, engine: { ...services.engine, events } };
        }
        const runtime = await entry.prepared.initialize({ instance: modInstanceProvider(entry.identity.selection), resources, assertCurrent, services, restoring: state != null,
          nextFrame: async () => { assertCurrent(); await this.options.nextFrame(); assertCurrent(); } });
        if (resources.isClosed) { runtime.close(); throw new Error("Mod session closed during initialization"); }
        resources.own(runtime); assertCurrent();
        const active = { ...entry, resources, runtime, presentationOwner }; opened.push(active); next.push(active);
        if (state !== undefined && state !== null) { await runtime.restore(state); assertCurrent(); }
        runtime.activate?.(); assertCurrent();
      }
      for (const entry of opened) {
        entry.runtime.register(new ModRegistrations(modInstanceProvider(entry.identity.selection), this.options.operations, this.nextOrder++, entry.resources));
        this.assertOpen();
      }
    } catch (error) {
      try { closeScopes(scopes); } catch (cleanup) { throw new AggregateError([error, cleanup], "Mod preparation and cleanup failed"); }
      throw error;
    } finally { for (const scope of scopes) this.pending.delete(scope); }
    const removed = this.active.filter(entry => !next.includes(entry));
    this.active = next;
    closeScopes(removed.map(entry => entry.resources));
  }
}
