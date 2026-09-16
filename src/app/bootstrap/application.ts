import { MusicControls } from "../../audio/music.ts";
import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { openInitialConfigurationContent, prepareInitialConfiguration, prepareProfileConfiguration, configurationDialect, configurationStore, type PreparedProfileConfiguration, type ConfigurationCommandRequest } from "./configuration.ts";
import { SeatInput } from "../../input/seat.ts";
import { ClientSourcePublicationError, type ClientBootstrap } from "./client-bootstrap.ts";
import { readQ1ViewSettings } from "./q1-client-settings.ts";
import { cloneQ1SourceCvars, registerQ1BotControls } from "./q1-source-cvars.ts";
import { captureTeamArenaOverrides, readTeamArenaOverrides, saveTeamArenaOverrides, applyTeamArenaOverrides, releaseTeamArenaOverrides, teamArenaArchiveEntries, type TeamArenaOverrides, type OverrideRegistry } from "./team-arena-overrides.ts";
import { ApplicationConsoleRouting, q1ConsoleServer } from "./console.ts";
import { PreparedStartup } from "./prepared-startup.ts";
import { resolveStartupRules } from "./startup-source.ts";
import { ConsoleScriptFiles } from "./config-scripts.ts";
import { consoleConfigRoot } from "./config-scripts.ts";
import { createStartupScriptReader } from "./startup-config.ts";
import { frameTimeCvarNames, readFrameTimeControls, registerFrameTimeCvars, sourceFrameMilliseconds } from "./frame-time.ts";
import { q3GameCvarDefinitions } from "../../content/q3/base/settings.ts";
import { prepareApplicationResources } from "./precache.ts";
import { registerQ1ClientCommands, resolveQ1HostCommandActor } from "./q1-client-commands.ts";
import { resolveWeaponSelection } from "../../input/weapon-bindings.ts";
import { loadCvarArchive, saveCvarArchive } from "./cvar-archives.ts";
import type { CvarArchiveEntry } from "../../core/cvars/index.ts";
import { initializeQ3ClientCvars } from "./q3-client/userinfo.ts";
import { q3ConfigstringCommands } from "../../network/q3/configstrings.ts";
import { LocalQ3ClientState } from "./q3-client/client-state.ts";
import { StartupServerBrowser } from "./server-browser.ts";
import { Q3BrowserView } from "../../network/q3/browser-view.ts";
import { fromQ3UserCommand } from "../../network/q3/adapters.ts";
import type { Q3GuestOutput } from "./simulation/q3/guest-runtime.ts";
import { serviceLoading } from "./loading.ts";
import { UserFileStore } from "../../platform/files/writable.ts";
import { setImmediate } from "node:timers/promises";
import type { LlmCommandRequester } from "../../console/llm.ts";
import type { LlmSettingsUi } from "../../ui/settings/llm.ts";
import { StartupSaves } from "./startup-saves.ts";
import type { SavedGameMenuService } from "../../ui/saves/menu.ts";
import { ApplicationViewSettings } from "./view-settings.ts";
import { loadAudioSettings, saveAudioSettings } from "./audio-settings.ts";
import { ApplicationCapture, applicationCaptureRoot, inputCaptureServices } from "./capture.ts";
import { ConfigStore } from "../../settings/config.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { applicationAudioCommands } from "./audio/commands.ts";
import { parseServerProfile, serverDefinitionsForRecipe, serverDefinitionsForSelection, writeServerSetting } from "../../settings/server/index.ts";
import { applyFrontendPreferences, readFrontendPreferences, changedFrontendPreferences, readFrontendInput, applyFrontendInput } from "./frontend-preferences.ts";
import type { FrontendPreferenceOverrides, FrontendPreferenceValues } from "./frontend-preferences.ts";
import { ApplicationQ2Console, q2OperatorPlayerName } from "./q2-console.ts";
import { preloadApplicationMonsterNavigation } from "./simulation/monster-navigation.ts";
import { botAdmissionError, ApplicationBots, openApplicationBotLog, resumeApplicationBotLog } from "./simulation/bots.ts";
import type { ApplicationBotClient, ApplicationBotsOptions, ApplicationBotTransportCheckpoint } from "./simulation/bots.ts";
import { createApplicationBotNavigation } from "./simulation/navigation.ts";
import { loadMountedBotAssetFiles } from "../../bots/behavior/index.ts";
import type { ActorId, ClientId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExecutableRecipe } from "../../contracts/content.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { TransitionDecision } from "../../contracts/gameplay.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SaveImage, SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import type { IpAddress } from "../../network/common/endpoint.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { UdpTransport, Q2_DATAGRAM_LIMITS, Q3_DATAGRAM_LIMITS, UNIFIED_DATAGRAM_LIMITS } from "../../network/common/transport.ts";
import { CommandBuffer, tokenizeCommand, type CommandBufferOptions, type CommandHandler } from "../../core/commands/index.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { CvarRegistry, CvarFlag } from "../../core/cvars/index.ts";
import type { CvarSnapshot } from "../../core/cvars/index.ts";
import { DedicatedConsole } from "../../console/dedicated.ts";
import { loadQ3Character } from "../../content/q3/foundation/index.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../content/q3/foundation/arsenal.ts";
import { readSaveImage, writeSaveImage } from "../../persistence/save-image.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { SessionClient, SessionConnection, SessionSeat } from "../../world/session/index.ts";
import { SharedTransitionCoordinator } from "../../world/gameplay/transitions.ts";
import { parseQ2Travel, type Q2TravelTarget } from "./q2-travel.ts";
import { CampaignCinematic } from "./campaign-cinematic.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationAudio } from "./audio.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import { applicationPreset, applicationOptionsForRecipe, loadApplicationContent, resolveApplicationTravel } from "./content.ts";
import type { ApplicationConfigurationContent, LoadedApplicationContent } from "./content.ts";
import { ApplicationInput, movementDialect } from "./input.ts";
import type { ApplicationInputCommands, LocalInput, LocalPlayer } from "./input.ts";
import { mapResourcePath } from "./options.ts";
import type { ApplicationOptions } from "./options.ts";
import { seatViewport, WorldSeatPresentation } from "./presentation.ts";
import { ApplicationQ3Client } from "./q3-client.ts";
import { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";
import { createSimulationPredictionHost } from "./simulation/prediction.ts";
import { NativeRenderer } from "./renderer.ts";
import { GameType, Team, PersistentIndex } from "../../content/q3/base/shared/definitions.ts";
import { parseTeamArenaPostgame, recordTeamArenaScore, type TeamArenaPostgameStats } from "./team-arena-scores.ts";
import type { TeamArenaResultService } from "./team-arena-results.ts";
import { readTeamArenaSkirmish, teamArenaSourceCvars, teamArenaClientCvars, teamArenaServerOverrides, type TeamArenaSkirmish } from "./team-arena-skirmish.ts";
import { ApplicationSeatUi } from "./ui.ts";
import { loadMenuArtImage } from "./menu-art.ts";
import { createSimulation, savedSimulationSettings, savedBotCheckpoint } from "./simulation/index.ts";
import { createQ2ApplicationServerHost } from "./simulation/network.ts";
import { Q2ServerNetwork } from "./network/q2.ts";
import { Q1ServerNetwork } from "./network/q1.ts";
import { QwServerNetwork } from "./network/qw-server.ts";
import type { QwApplicationServerHost } from "./network/qw-server-types.ts";
import { createQwApplicationServerHost } from "./simulation/network-qw.ts";
import { Q3ServerNetwork } from "./network/q3.ts";
import { Q3GameCallbackError, q3GameCallback } from "./network/q3-types.ts";
import type { Q1ApplicationServerHost } from "./network/q1-types.ts";
import type { Q3ApplicationServerHost, Q3NetworkRoundRestart } from "./network/q3-types.ts";
import { createQ1ApplicationServerHost } from "./simulation/network-q1.ts";
import { createQ3ApplicationServerHost } from "./simulation/network-q3.ts";

import type { ApplicationNetworkPlayer, Q2ApplicationServerHost } from "./network/types.ts";
import type { SharedSimulation, SimulationOptions } from "./simulation/index.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { SimulationTravel } from "./simulation/types.ts";

type NativeServerHost = { readonly kind: "q1"; readonly host: Q1ApplicationServerHost }
  | { readonly kind: "qw"; readonly host: QwApplicationServerHost }
  | { readonly kind: "q2"; readonly host: Q2ApplicationServerHost }
  | { readonly kind: "q3"; readonly host: Q3ApplicationServerHost };
type NativeServer = { readonly address: IpAddress } & (
  { readonly kind: "q1"; readonly server: Q1ServerNetwork<IpAddress> }
  | { readonly kind: "qw"; readonly server: QwServerNetwork }
  | { readonly kind: "q2"; readonly server: Q2ServerNetwork<IpAddress> }
  | { readonly kind: "q3"; readonly server: Q3ServerNetwork });

type SavedBotClientId = ApplicationBotTransportCheckpoint["connections"][number]["client"];
interface SavedApplicationClients {
  readonly clients: readonly ClientId[];
  readonly added: readonly SessionClient[];
  readonly removed: readonly SessionClient[];
  resolveBotClient(saved: SavedBotClientId): SessionClient | null;
}

interface PreparedSourceCommands {
  readonly commands: CommandBuffer | null;
  readonly program: ReturnType<CommandBuffer["prepareProgram"]> | null;
  readonly q2Console: ApplicationQ2Console | null;
  readonly options: CommandBufferOptions | null;
  activate(commands: CommandBuffer): () => void;
}
interface ApplicationCommandRequest { readonly target: "application" | "client" | "source"; readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; readonly source?: CommandContext; }
type Q3SeatClient = { readonly kind: "native"; readonly client: ApplicationQ3Client; readonly prediction: ReturnType<typeof createSimulationPredictionHost> }
  | { readonly kind: "qvm"; readonly client: ApplicationQ3Client; readonly state: LocalQ3ClientState };
interface GraphicalApplication {
  readonly renderer: NativeRenderer;
  readonly assets: ApplicationAssets;
  readonly input: ApplicationInput;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly art: NativeUiArt;
  readonly presentations: readonly WorldSeatPresentation[];
  readonly q3: Map<SeatId, Q3SeatClient>;
  readonly rerelease: ApplicationRereleasePresentation;
}

export interface ApplicationHost {
  readonly llm?: LlmSettingsUi & LlmCommandRequester;
  readonly saveDirectory?: string;
  readonly loading?: { readonly deferWindowVisibility: boolean; readonly nextFrame?: () => Promise<void>; stage(message: string): void };
  print(text: string): undefined;
}

/** A single authoritative simulation owns every local and remote player's game state. */
type LocalQ3GuestSeat = { readonly state: LocalQ3ClientState; readonly cvars: CvarRegistry; userinfo: string; client: ApplicationQ3Client | null };
type LocalQ3GuestBrowser = { readonly host: StartupServerBrowser; readonly view: Q3BrowserView };
type LocalQ3GuestWorld = { readonly worldSound: ActorId; readonly authority: ReturnType<typeof createQ3ApplicationServerHost>;
  readonly seats: Map<SeatId, LocalQ3GuestSeat>; readonly pendingCommands: ApplicationCommandRequest[] };

export class Application {
  private releaseViewCvars: (() => void) | null = null;
  readonly viewSettings = new ApplicationViewSettings(value => {
    for (const presentation of this.graphical?.presentations ?? []) {
      if (presentation.q3Client?.options.kind !== "qvm") this.simulation.setPlayerFieldOfView(presentation.local.player.actor, value);
      presentation.q3Client?.cvars.set("cg_fov", String(value));
    }
  });
  private graphical: GraphicalApplication | null = null;
  private capture: ApplicationCapture | null = null;
  private frontendOverrides: FrontendPreferenceOverrides = {};
  private imageSettings: ApplicationImageSettings | null = null;
  private frontendBaseline: FrontendPreferenceValues | null = null;
  private bots: ApplicationBots | null = null;
  private clientCvars = new Map<SeatId, CvarRegistry>();
  private teamArenaOverrides: TeamArenaOverrides | null = null;

  private overrideSeats(clients: ReadonlyMap<SeatId, CvarRegistry> = this.clientCvars): readonly OverrideRegistry[] {
    return [...this.localSeats.values()].map(seat => {
      const cvars = clients.get(seat.id);
      if (cvars === undefined) throw new Error("Missing local override registry");
      return { seat: seat.id.index, client: seat.client.id.slot, cvars };
    });
  }
  private archivePersistence = false;
  private dedicatedConsole: DedicatedConsole | null = null;
  private dedicatedCommands: CommandBuffer | null = null;
  private requestedCommands: ApplicationCommandRequest[] = [];
  private preparedStartup: PreparedStartup | null = null;
  private clientInputs: SeatInputEvent[] = [];
  private deferredInput: SeatInputEvent[] = [];
  private stopping = false;
  private closed = false;
  private stepping = false;
  private worldOperation: "idle" | "saving" | "loading" | "travel" = "idle";
  private worldOperationCompletion: Promise<void> | null = null;
  private stepCompletion: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private elapsed = 0;
  private frames = 0;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly serverProfileStore = new ConfigStore(join(homedir(), ".local", "share", "quake-typescript", "settings"));
  private readonly inputConfig: ConfigStore;
  private readonly reportedEffectGaps = new Set<string>();
  private network: NativeServer | null = null;
  private readonly transitions = new SharedTransitionCoordinator(decision => { this.pendingTransition = decision; return undefined; });
  private pendingTransition: Exclude<TransitionDecision, { readonly kind: "stay" }> | null = null;
  private campaignMovie: { readonly playback: CampaignCinematic; readonly next: Q2TravelTarget | null; readonly carry: SimulationTravel } | null = null;
  private pendingMap: string | null = null;
  private pendingTeamArena: "next" | "retry" | null = null;
  private pendingTeamArenaPostgame: TeamArenaPostgameStats | null = null;
  private sourceCommands: CommandBuffer | null = null;
  private sourceCommandBinding: Pick<PreparedSourceCommands, "options"> | null = null;
  private releaseSourceCommands: () => void = () => {};
  private q2Console: ApplicationQ2Console | null = null;
  private pendingRestart: number | null = null;
  private lastRestartFrame = -1;
  private localSnapshotServerBit: 0 | 4 = 0;
  private fatalWorldFailure = false;
  private roundPresentationEvents: SimulationPresentationEvent[] = [];
  private pendingSave: SaveImage | null = null;
  private savedGames: StartupSaves | null = null;
  private localGuest: LocalQ3GuestWorld | null = null;
  private guestBrowser: LocalQ3GuestBrowser | null = null;
  private saveOperation: { readonly run: () => Promise<void>; readonly resolve: () => void; readonly reject: (error: unknown) => void } | null = null;
  private lastOutput: { readonly simulation: SharedSimulation; readonly output: SimulationOutput } | null = null;
  private get saveDirectory(): string { return this.host.saveDirectory ?? join(homedir(), ".local", "share", "quake-typescript", "saves"); }
  private levelRecoveryAvailable(simulation: SharedSimulation, options: ApplicationOptions): boolean {
    return !options.dedicated && options.network.kind === "offline" && options.mode === "singleplayer"
      && (simulation.q1Source() !== null || simulation.q2Source() !== null || simulation.quakecSource() !== null);
  }

  private async autosaveLevel(): Promise<void> {
    if (!this.levelRecoveryAvailable(this.simulation, this.options) || this.network !== null || this.localPlayers.length === 0) return;
    const directory = join(this.saveDirectory, this.content.catalog.product(this.content.recipe.map.entities.content).expectation.id);
    try {
      await mkdir(directory, { recursive: true });
      const path = join(directory, "autosave.sav");
      await this.saveGame(path);
      this.host.print(`Autosaved ${path}.\n`);
    } catch (error) { this.host.print(`Autosave failed: ${error instanceof Error ? error.message : String(error)}\n`); }
  }

  private saveMenu(simulation: SharedSimulation, options: ApplicationOptions): SavedGameMenuService {
    const saves = this.savedGames ??= new StartupSaves(this.content.catalog, this.saveDirectory);
    const queue = (run: () => Promise<void>): Promise<void> => new Promise((resolve, reject) => {
      if (this.closed || this.saveOperation !== null) { reject(new Error("Another save operation is in progress.")); return; }
      this.saveOperation = { run, resolve, reject };
    });
    return { list: () => saves.list, refresh: () => saves.refresh(),
      ...(this.levelRecoveryAvailable(simulation, options) ? { recovery: { restart: () => queue(() => this.replaceWorld(this.content.recipe.map.geometry.requestedPath, null)) } } : {}),
      unavailable: () => this.network !== null ? "Save/load unavailable while hosting a network game."
        : null,
      save: (name, overwrite) => queue(async () => { await this.saveGame(overwrite === null ? await saves.namedPath(name) : saves.path(overwrite)); }),
      load: id => queue(() => this.restoreSavedGame(saves.path(id))) };
  }
  private nativeWorldCount = 1;
  private configurationScripts: ConsoleScriptFiles | null = null;
  private profileConfiguration: PreparedProfileConfiguration | null = null;
  private sourcePublished = false;
  private sourceSeatsPublished = false;
  private readonly sourceConnections = new Map<SessionClient, SessionClient["connection"]>();
  private readonly sourceClientChanges: { added: SessionClient[]; removed: SessionClient[] } = { added: [], removed: [] };
  private readonly sourceSeatChanges: { added: SessionSeat[]; removed: SessionSeat[] } = { added: [], removed: [] };

  private readonly musicControls: MusicControls;
  private constructor(private launchOptions: ApplicationOptions, private loadedContent: LoadedApplicationContent,
    readonly session: EngineSession, private worldSimulation: SharedSimulation, private readonly host: ApplicationHost, private readonly identity: IdentityOwner,
    private readonly localSeats: Map<ClientId, SessionSeat>, inputConfig: ConfigStore,
    private readonly ownership: { readonly kind: "owned" } | { readonly kind: "borrowed"; readonly client: ClientBootstrap }) {
    this.inputConfig = inputConfig;
    this.musicControls = ownership.kind === "borrowed" ? ownership.client.musicControls : new MusicControls();
  }

  private static sourceConfig(options: ApplicationOptions, content: LoadedApplicationContent): ConfigStore {
    const product = content.catalog.product(content.recipe.map.entities.content);
    return new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
  }

  private static clientConfig(options: ApplicationOptions, content: LoadedApplicationContent): ConfigStore {
    const product = content.catalog.product(content.recipe.engineBehavior.content);
    return new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
  }

  private enableStartupPersistence(): void {
    if (this.options.dedicated || this.preparedStartup?.pending) return;
    this.archivePersistence = true;
    this.graphical?.input.enableArchivePersistence();
    this.imageSettings?.enablePersistence();
  }

  private async saveSourceArchive(options: ApplicationOptions, content: LoadedApplicationContent, simulation: SharedSimulation, overrides: TeamArenaOverrides | null): Promise<void> {
    const cvars = this.sourceCvars(simulation);
    if (cvars !== null) await saveCvarArchive(Application.sourceConfig(options, content),
      ["source", content.recipe.map.entities.content, content.recipe.map.entities.provider], cvars, teamArenaArchiveEntries(cvars, overrides));
  }

  private async saveClientArchives(options: ApplicationOptions, content: LoadedApplicationContent, clients: ReadonlyMap<SeatId, CvarRegistry>, overrides: TeamArenaOverrides | null): Promise<void> {
    const store = Application.clientConfig(options, content);
    for (const [seat, cvars] of clients) await saveCvarArchive(store,
      ["client", content.recipe.engineBehavior.content, content.recipe.engineBehavior.provider, String(seat.index)], cvars, teamArenaArchiveEntries(cvars, overrides, seat.index));
  }

  private sourceCvars(simulation = this.simulation): CvarRegistry | null {
    return simulation.q3Guest()?.state.cvars ?? simulation.q3Source()?.host.cvars ?? simulation.q2ServerCvars()
      ?? simulation.q1Source()?.cvars ?? simulation.quakecSource()?.cvars ?? null;
  }

  private static guestOptions(content: LoadedApplicationContent, options: ApplicationOptions, host: ApplicationHost,
    commands: () => CommandBuffer): Pick<SimulationOptions, "q3Guest"> {
    if (content.preparedQ3Game === null) return {};
    if (!options.dedicated && options.network.kind !== "offline") throw new Error("Local Q3 guests require offline operation");
    const product = content.catalog.product(content.recipe.map.entities.content);
    return { q3Guest: {
      prepared: content.preparedQ3Game,
      writable: new UserFileStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory)),
      gameDirectory: basename(product.expectation.contentDirectory), print: text => host.print(text),
      common: { milliseconds: () => Math.trunc(performance.now()), realTime: output => {
        const now = new Date(), year = now.getFullYear();
        output?.({ second: now.getSeconds(), minute: now.getMinutes(), hour: now.getHours(), day: now.getDate(),
          month: now.getMonth(), year: year - 1900, weekday: now.getDay(),
          yearDay: Math.trunc((Date.UTC(year, now.getMonth(), now.getDate()) - Date.UTC(year, 0, 1)) / 86400000),
          isDst: now.getTimezoneOffset() < Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset()) ? 1 : 0 });
        return Math.trunc(now.getTime() / 1000);
      }, commands: { executeNow: text => { commands().executeNow(text); }, append: text => commands().append(text), insert: text => commands().insert(text) } },
    } };
  }

  private guestOutput(localGuest = this.localGuest): Q3GuestOutput {
    if (this.network?.kind === "q3") return this.network.server.gameOutput();
    if (this.options.network.kind !== "offline") throw new Error("Q3 guest has no server output owner");
    const send = (slot: number, text: string): void => {
      for (const { state } of localGuest?.seats.values() ?? []) if (slot === -1 || state.clientNumber === slot)
        state.receiveServerCommand(state.serverCommandSequence + 1, text);
    };
    return { configstring: (index, value) => {
      for (const command of q3ConfigstringCommands(index, value)) send(-1, command);
    }, sendServerCommand: send, dropClient: async (slot, reason) => {
      if ([...localGuest?.seats.values() ?? []].some(({ state }) => state.clientNumber === slot)) {
        if (localGuest !== this.localGuest) throw new Error(`Restored guest dropped a local client: ${reason}`);
        this.host.print(`Local guest client dropped: ${reason}\n`); this.requestQuit();
      }
    } };
  }

  static async open(options: ApplicationOptions, host: ApplicationHost, recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides, initialSave?: SaveImage): Promise<Application> {
    return Application.openSource({ kind: "owned" }, options, host, recipe, preferences, initialSave);
  }

  static async openBorrowed(client: ClientBootstrap, options: ApplicationOptions, host: ApplicationHost,
    recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides, initialSave?: SaveImage): Promise<Application> {
    if (options.dedicated) throw new Error("Dedicated applications cannot borrow a graphical client");
    client.session.resources.assertOpen();
    return Application.openSource({ kind: "borrowed", client }, options, host, recipe, preferences, initialSave);
  }

  private static async openSource(ownership: Application["ownership"], options: ApplicationOptions, host: ApplicationHost,
    recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides, initialSave?: SaveImage): Promise<Application> {
    if ((options.network.kind === "qw-client" || options.network.kind === "q1-client" || options.network.kind === "q2-client" || options.network.kind === "q3-client")) throw new Error("Remote clients require RemoteApplication without a local simulation");
    const savedSettings = initialSave === undefined ? null : savedSimulationSettings(initialSave);
    const savedBots = initialSave === undefined ? null : savedBotCheckpoint(initialSave);
    if (initialSave !== undefined && savedSettings !== null) {
      if (options.network.kind !== "offline") throw new Error("Save/load unavailable while hosting a network game.");
      const { botSkill, teamArenaSkirmish, serverProfile, serverProfilePath, ...frontendOptions } = options;
      const humanSlots = savedSettings.clientSlots.filter(slot => !savedBots?.transport.connections.some(connection => connection.client.slot === slot));
      if (!options.dedicated && (humanSlots.length < 1 || humanSlots.length > 4)) throw new Error("Saved local player count must be between one and four");
      options = { ...frontendOptions, map: initialSave.recipe.map.geometry.requestedPath, skill: savedSettings.skill,
        mode: savedSettings.mode, seed: savedSettings.seed, seats: options.dedicated ? options.seats : humanSlots.length };
      recipe = initialSave.recipe;
    }
    host.loading?.stage(initialSave === undefined ? "Preparing configuration..." : "Loading saved world...");
    const preparation: { readonly kind: "configuration" | "borrowed"; readonly content: ApplicationConfigurationContent }
      | { readonly kind: "restored"; readonly content: LoadedApplicationContent } = initialSave === undefined
      ? { kind: ownership.kind === "borrowed" ? "borrowed" : "configuration", content: await openInitialConfigurationContent(options, recipe) }
      : { kind: "restored", content: await loadApplicationContent(options, recipe) };
    const catalog = preparation.content.catalog;
    try {
      if (recipe !== undefined) options = applicationOptionsForRecipe(options, { catalog, recipe });
      const definitions = preparation.kind === "restored" ? serverDefinitionsForRecipe(preparation.content.recipe)
        : serverDefinitionsForSelection(preparation.content.selection);
      if (options.serverProfilePath !== undefined) {
        const value: unknown = JSON.parse(await Bun.file(options.serverProfilePath).text());
        options = { ...options, serverProfile: parseServerProfile(value, definitions) };
      } else if (options.serverProfile !== undefined) options = { ...options, serverProfile: parseServerProfile(options.serverProfile, definitions) };
      const product = catalog.require(options.product);
      const inputConfig = new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
      const identity = ownership.kind === "borrowed" ? ownership.client.identity : createIdentityOwner(`quake:${options.product}:${options.map}`);
      const session = ownership.kind === "borrowed" ? ownership.client.session : new EngineSession(identity, options.dedicated ? { kind: "headless" } : { kind: "local" });
      const localSeats = new Map<ClientId, SessionSeat>();
      let application: Application | null = null;
      let guestConsole: CommandBuffer | null = null;
      let startup: Awaited<ReturnType<typeof prepareInitialConfiguration>> | null = null;
      let loadedContent: LoadedApplicationContent | null = null;
      let profileConfiguration: PreparedProfileConfiguration | null = null;
      const borrowedImages = ownership.kind === "borrowed" ? ownership.client.imageSettings.prepareClientSettings() : null;
      const restoredClients = new Map<number, SessionClient>();
      const stagedClients: { added: SessionClient[]; removed: SessionClient[] } = { added: [], removed: [] };
      const stagedSeats: { added: SessionSeat[]; removed: SessionSeat[] } = { added: [], removed: [] };
      try {
        if (ownership.kind === "borrowed") {
          const locals = ownership.client.locals;
          const slots = savedSettings === null ? locals.slice(0, options.seats).map(local => local.client.id.slot)
            : savedSettings.clientSlots.filter(slot => !savedBots?.transport.connections.some(connection => connection.client.slot === slot));
          while (slots.length < options.seats) { let slot = 0; while (slots.includes(slot)) slot++; slots.push(slot); }
          for (const [index, slot] of slots.entries()) {
            const retained = locals.find(local => local.client.id.slot === slot);
            let client = retained?.client;
            if (client === undefined) {
              const previous = session.clientAt(slot);
              client = session.prepareClient(slot, previous ?? undefined); stagedClients.added.push(client);
              if (previous !== null) stagedClients.removed.push(previous);
            }
            const incumbent = locals.find(local => local.seat.id.index === index)?.seat;
            const seat = retained?.seat.id.index === index ? retained.seat : session.prepareSeat(index, client, incumbent);
            if (seat !== retained?.seat) stagedSeats.added.push(seat);
            localSeats.set(client.id, seat);
          }
          for (const local of locals) {
            if (![...localSeats.values()].includes(local.seat)) stagedSeats.removed.push(local.seat);
            if (!localSeats.has(local.client.id)) stagedClients.removed.push(local.client);
          }
        }
        const sourceArchive = initialSave !== undefined || options.dedicated ? [] : preparation.kind !== "restored" ? await loadCvarArchive(configurationStore(options, preparation.content, preparation.content.selection.source.content),
            ["source", preparation.content.selection.source.content, preparation.content.selection.source.provider], configurationDialect(preparation.content)) : [];
        const guestCommands = () => {
          const commands = guestConsole;
          if (commands === null) throw new Error("Q3 guest console is unavailable");
          return commands;
        };
        if (savedSettings !== null) {
          for (const slot of savedSettings.clientSlots) {
            if (ownership.kind === "owned") restoredClients.set(slot, session.createClient(slot));
            else {
              const retained = [...localSeats.values()].find(local => local.client.id.slot === slot)?.client;
              if (retained !== undefined) restoredClients.set(slot, retained);
              else {
                const previous = session.clientAt(slot);
                const client = session.prepareClient(slot, previous ?? undefined);
                restoredClients.set(slot, client); stagedClients.added.push(client);
                if (previous !== null && !stagedClients.removed.includes(previous)) stagedClients.removed.push(previous);
              }
            }
          }
          if (!options.dedicated && ownership.kind === "owned") for (const client of restoredClients.values()) {
            if (savedBots?.transport.connections.some(connection => connection.client.slot === client.id.slot)) continue;
            client.connect("loopback");
            localSeats.set(client.id, session.createSeat(localSeats.size, client));
          }
        }
        const engine = preparation.kind === "restored" ? preparation.content.recipe.engineBehavior : preparation.content.selection.engineBehavior;
        const defaultCapacity = savedSettings?.maxClients ?? (options.product === "q1-quakeworld" ? 8 : options.mode === "singleplayer" ? catalog.product(engine.content).expectation.family === "q3" ? 8 : 1 : 16);
        let borrowedSource: CvarRegistry | null = null;
        let borrowedCapacity = defaultCapacity;
        if (ownership.kind === "borrowed" && preparation.kind === "borrowed" && initialSave === undefined) {
          const profile = ownership.client.sourceProfile.current, destination = preparation.content.selection.source;
          const movement = preparation.content.selection.timing.find(timing => timing.provider === preparation.content.selection.movement.provider)?.clock.kind;
          if (movement === undefined || borrowedImages === null) throw new Error("Borrowed configuration has no movement or image owner");
          if (profile?.content === destination.content && profile.provider === destination.provider
            && ownership.client.prepared.commands.dialect === configurationDialect(preparation.content)
            && ownership.client.prepared.movement.dialect === movement) {
            const source = ownership.client.prepared.source;
            borrowedSource = new CvarRegistry({ dialect: source.dialect, context: source.context, print: text => host.print(text) });
            borrowedSource.restoreSaveState(source.captureWorldTransferState());
            const resolved = resolveStartupRules(options, borrowedSource, defaultCapacity, definitions);
            options = resolved.options; borrowedCapacity = resolved.maxClients;
          } else {
            const prepared = ownership.client.prepared;
            const seats = [...localSeats.values()].map(seat => {
              const retained = prepared.seats.find(local => local.id.equals(seat.id) && local.context.origin.kind === "local-seat"
                && local.context.origin.client.equals(seat.client.id));
              const input = retained?.input ?? new SeatInput({ seat: seat.id, dialect: movement,
                context: { session: session.session, origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } }, commands: prepared.commands, uiEvent: () => false });
              return { seat, input };
            });
            profileConfiguration = await prepareProfileConfiguration({ prepared, seats, options, content: preparation.content,
              settings: inputConfig, shared: borrowedImages.settings.cvars, host, sourceArchive, defaultCapacity,
              nextFrame: host.loading?.nextFrame ?? (async () => { await Bun.sleep(0); }) });
            options = profileConfiguration.options; borrowedCapacity = profileConfiguration.maxClients; borrowedSource = profileConfiguration.source;
          }
        }
        if (preparation.kind === "configuration") {
          const configuration = preparation.content;
          const prepare = (nextFrame: () => Promise<void>) => prepareInitialConfiguration(options, configuration, session, identity, localSeats, inputConfig, host, sourceArchive, defaultCapacity, nextFrame);
          startup = host.loading?.nextFrame === undefined ? await serviceLoading(prepare, () => {}) : await prepare(host.loading.nextFrame);
        }
        if (startup !== null) options = startup.options;
        host.loading?.stage("Loading map...");
        const content = preparation.kind === "restored" ? preparation.content : await loadApplicationContent(options, recipe, undefined, catalog);
        if (preparation.kind === "borrowed" && profileConfiguration === null) await preparation.content.close();
        loadedContent = content;
        host.loading?.stage("Preparing world...");
        const monsterNavigation = await preloadApplicationMonsterNavigation(content);
        const maxClients = Math.max(startup?.maxClients ?? savedSettings?.maxClients ?? options.teamArenaSkirmish?.maxClients ?? borrowedCapacity,
          ...[...localSeats.keys()].map(client => client.slot + 1));
        if (borrowedSource !== null) borrowedSource.set(borrowedSource.dialect === "q3" ? "sv_maxclients" : "maxclients", String(maxClients), true);
        const simulation = createSimulation({ dedicated: options.dedicated, sourceArchive,
          ...(borrowedSource !== null ? { sourceRegistry: borrowedSource } : startup === null ? {} : { sourceRegistry: startup.prepared.source }),
          ...(ownership.kind !== "borrowed" || initialSave !== undefined || options.teamArenaSkirmish === undefined
            || options.teamArenaSkirmish.cvars.every(setting => borrowedSource?.variableString(setting.name) === setting.value)
            ? {} : { q3Cvars: teamArenaSourceCvars(options.teamArenaSkirmish, borrowedSource?.snapshots() ?? sourceArchive) }),
          ...Application.guestOptions(content, options, host, guestCommands), ...(content.preparedQuakeC === null ? {} : { preparedQuakeC: content.preparedQuakeC }), ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
          skill: options.skill, mode: options.mode, seed: options.seed, ...(options.serverProfile === undefined ? {} : { serverProfile: options.serverProfile }),
          ...(initialSave === undefined ? {} : { restore: initialSave, restoredClients: [...restoredClients.values()].map(client => client.id) }),
          maxClients,
          promptSupported: client => !options.dedicated && localSeats.has(client),
          playerIdentity: client => ({ seat: localSeats.get(client)?.id.index ?? 0, socialId: "" }) });
        if (ownership.kind === "owned") session.attachWorld(simulation);
        if (options.botSkill !== undefined) {
          const source = simulation.q3Source();
          if (source === null) throw new Error("--bot-skill requires the Quake III game provider");
          source.host.cvars.set("g_spSkill", String(options.botSkill), true);
        }
        application = new Application(options, content, session, simulation, host, identity, localSeats, inputConfig, ownership);
        application.sourceClientChanges.added.push(...stagedClients.added);
        application.sourceClientChanges.removed.push(...stagedClients.removed);
        application.sourceSeatChanges.added.push(...stagedSeats.added);
        application.sourceSeatChanges.removed.push(...stagedSeats.removed);
        if (ownership.kind === "owned") for (const seat of localSeats.values()) application.sourceConnections.set(seat.client, seat.client.connection);
        application.preparedStartup = ownership.kind === "borrowed" ? ownership.client.prepared : startup?.prepared ?? null;
        application.configurationScripts = profileConfiguration?.scripts ?? startup?.scripts
          ?? (initialSave === undefined ? null : Application.sourceScripts(content, options, inputConfig));
        application.profileConfiguration = profileConfiguration;
        application.imageSettings = borrowedImages?.settings ?? startup?.image ?? null;
        if (initialSave !== undefined) {
          application.teamArenaOverrides = readTeamArenaOverrides(initialSave, [...localSeats.values()].map(seat => ({ seat: seat.id.index, client: seat.client.id.slot })));
          if (application.isTeamArenaSkirmish() && application.teamArenaOverrides === null) host.print("Legacy Team Arena save has no per-seat timer baseline; current timer preferences will be preserved.\n");
        }
        const startupApplication = application;
        startup?.prepared.forwardCommands((name, args, source) => {
          let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
          startupApplication.requestedCommands.push({ target: "application", name, arguments_: args, seat: origin.kind === "local-seat" ? origin.seat : null, source });
          return undefined;
        });
        if (startup !== null) application.requestedCommands.push(...startup.requests);
        if (profileConfiguration !== null) application.requestedCommands.push(...profileConfiguration.requests);
        application.frontendOverrides = preferences ?? {};
        application.elapsed = savedSettings?.hostMilliseconds ?? 0;
        if (initialSave !== undefined && simulation.q3Source() !== null && savedBots === null) throw new Error("Q3 application restoration requires saved bot service state");
        await application.bindSourceCommands(initialSave !== undefined);
        guestConsole = application.sourceCommands;
        if (!options.dedicated && simulation.q3Guest() !== null) {
          const authority = createQ3ApplicationServerHost({ session, simulation, content, print: text => host.print(text), ...(initialSave === undefined ? {} : { mode: "restore" }) });
          application.localGuest = { worldSound: createIdentityOwner("local-qvm-world-audio").actor(1022, 0), authority, seats: new Map<SeatId, LocalQ3GuestSeat>(), pendingCommands: [] };
          await authority.prepare(0, initialSave === undefined ? 1 : simulation.q3Guest()?.state.cvars.variableValue("sv_serverid") ?? 0);
          if (initialSave === undefined) {
            await simulation.q3Guest()?.initialize(application.guestOutput());
            const initialized = application;
            await initialized.sourceCommands?.executeAsync(() => initialized.commands());
          }
        }
        if (initialSave !== undefined) simulation.q3Guest()?.completeRestore(application.guestOutput());
        if (options.dedicated) application.openDedicatedConsole();
        else {
          if (startup === null && ownership.kind === "owned") await application.viewSettings.load(application.inputConfig);
          const frontend = application;
          application.imageSettings ??= await ApplicationImageSettings.open({ deferPersistence: true, context: { session: session.session, origin: { kind: "local-console" } },
            dialect: application.sourceDialect(), gamma: options.gamma, ...(options.displayOverrides === undefined ? {} : { displayOverrides: options.displayOverrides }), ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }), print: text => {
              host.print(text); for (const local of frontend.graphical?.input.locals ?? []) local.console.print(text);
            } });
          application.releaseViewCvars = application.imageSettings.bindViewSettings(application.viewSettings);
          await application.openGraphical(initialSave !== undefined);
        }
        if (ownership.kind === "borrowed") {
          if (borrowedImages === null) throw new Error("Borrowed source has no image candidate");
          await application.openNetwork();
          await application.publishBorrowed(ownership.client, borrowedImages);
        } else application.sourcePublished = true;
        host.loading?.stage("Starting game...");
        if (initialSave === undefined) application.bots = await application.createBots(content, simulation);
        else if (savedBots !== null) application.bots = await application.createBots(content, simulation, { restore: {
          image: savedBots, resolveClient: saved => savedBots.transport.connections.some(connection => connection.client.slot === saved.slot && connection.client.generation === saved.generation)
            ? restoredClients.get(saved.slot) ?? null : null,
        } });
        if (ownership.kind === "owned") await application.openNetwork();
        const guest = simulation.q3Guest();
        if (guest !== null && options.dedicated && initialSave === undefined) {
          await guest.initialize(application.guestOutput());
          const initialized = application;
          await initialized.sourceCommands?.executeAsync(() => initialized.commands());
        }
        if (initialSave === undefined && ownership.kind === "owned") await application.commands();
        host.print(`Loaded ${content.recipe.map.geometry.requestedPath} with ${content.recipe.movement.provider} and ${content.recipe.character.appearance.provider}.\n`);
        application.enableStartupPersistence();
        if (initialSave === undefined) {
          if (options.teamArenaSkirmish !== undefined) application.startTeamArenaSkirmish(options.teamArenaSkirmish);
          await application.autosaveLevel();
        }
        else application.requestRestoredScores();
        return application;
      } catch (error) {
        const errors: unknown[] = [error];
        if (application !== null) {
          try { if (initialSave !== undefined) application.simulation.q3Guest()?.discard(); await application.close(); }
          catch (cleanup) { errors.push(cleanup); }
        } else {
          for (const close of [() => ownership.kind === "owned" ? session.close() : undefined,
            ...stagedSeats.added.map(seat => () => seat.close()), ...stagedClients.added.map(client => () => client.close()),
            () => profileConfiguration?.routing.close(), () => profileConfiguration?.scripts.close(),
            () => startup?.image?.close(), () => startup?.scripts.close(), () => loadedContent?.close()]) {
            try { await close(); } catch (cleanup) { errors.push(cleanup); }
          }
        }
        if (ownership.kind === "borrowed" && application?.sourcePublished) throw new ClientSourcePublicationError(errors);
        if (errors.length > 1) throw new AggregateError(errors, "Application initialization and cleanup failed");
        throw error;
      }
    } catch (error) {
      try { await preparation.content.close(); }
      catch (cleanup) {
        if (error instanceof ClientSourcePublicationError) throw new ClientSourcePublicationError([error, cleanup]);
        throw new AggregateError([error, cleanup], "Application preparation and cleanup failed");
      }
      throw error;
    }
  }

  private async createBots(content: LoadedApplicationContent, simulation: SharedSimulation,
    setup: Pick<ApplicationBotsOptions, "clients" | "restart" | "restore"> & {
      readonly requested?: boolean; readonly commands?: Pick<CommandBuffer, "insert"> | null;
    } = {}): Promise<ApplicationBots | null> {
    const { clients = [], restart = false, requested = false, commands = this.sourceCommands, restore } = setup;
    if (simulation.q3Source() === null && clients.length === 0 && !requested && restore === undefined) return null;
    const unsupported = botAdmissionError(simulation);
    if (unsupported !== null) {
      if (clients.length !== 0 || requested || restore !== undefined) throw new Error(unsupported);
      return null;
    }
    const definitions = simulation.q3Source() === null ? content.catalog.product("q3-baseq3").id : content.recipe.map.entities.content;
    const files = await loadMountedBotAssetFiles(await content.forContent(definitions), content.catalog);
    const navigation = await createApplicationBotNavigation({ content, simulation });
    const configuration = simulation.q1Source()?.cvars ?? simulation.q2ServerCvars() ?? undefined;
    return new ApplicationBots({ session: this.session, simulation, files, navigation, ...(restore === undefined ? { clients, restart } : { restore }), automaticFrame: true,
      ...(configuration === undefined ? {} : { configuration }),
      leafCount: content.world.leaves.length, print: text => { this.host.print(text); },
      insertConsoleCommand: text => {
        if (commands === null) throw new Error("Bot console has no source command buffer");
        commands.insert(text);
      }, openLog: openApplicationBotLog, resumeLog: resumeApplicationBotLog });
  }

  get frontendSettings(): FrontendPreferenceOverrides {
    const current = this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio);
    return current === null || this.frontendBaseline === null ? this.frontendOverrides : changedFrontendPreferences(this.frontendBaseline, current, this.frontendOverrides);
  }
  get frontendValues(): FrontendPreferenceValues | null { return this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio); }
  get botClients(): readonly ApplicationBotClient[] { return this.bots?.clients() ?? []; }
  get frameCount(): number { return this.frames; }
  get finished(): boolean { return this.stopping || this.closed || this.options.frameLimit !== null && this.frames >= this.options.frameLimit; }
  get clientCommandsBlocked(): boolean { return this.captureBlocksTransition(); }
  pumpClientInput(): void { this.graphical?.input.pump(false); }
  advanceClientStartup(): Promise<boolean> {
    return this.captureBlocksTransition() ? Promise.resolve(true)
      : this.graphical?.input.advanceStartup() ?? this.preparedStartup?.advanceFrame() ?? Promise.resolve(false);
  }
  flushClientCommands(): Promise<void> { return this.afterCommandDispatch(); }
  get options(): ApplicationOptions { return this.launchOptions; }
  get content(): LoadedApplicationContent { return this.loadedContent; }
  get simulation(): SharedSimulation { return this.worldSimulation; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] | null { return this.graphical?.renderer.window ?? null; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get unhandledPresentationEffects(): readonly UnhandledApplicationEffect[] { return this.unhandledEffects; }
  get networkAddress(): IpAddress | null { return this.network?.address ?? null; }
  get networkClients(): readonly ApplicationNetworkPlayer[] {
    return this.network?.kind === "qw" ? this.network.server.clients.map(player => ({ ...player, sourceEntity: player.slot + 1 })) : this.network?.server.clients ?? [];
  }
  get localPlayers(): readonly LocalPlayer[] { return this.graphical?.input.locals.map(local => local.player) ?? []; }

  input(event: SeatInputEvent): boolean {
    if (this.closed) throw new Error("Application is closed");
    if (this.worldOperation !== "idle") {
      if (this.graphical === null) return false;
      this.deferredInput.push(event); return true;
    }
    return this.graphical?.input.input(event) ?? false;
  }

  private resumeInput(): void {
    const events = this.deferredInput; this.deferredInput = [];
    if (this.closed) return;
    for (const event of events) this.graphical?.input.input(event);
  }

  private openDedicatedConsole(): void {
    if (this.sourceCommands !== null) {
      this.dedicatedCommands = this.sourceCommands;
      this.dedicatedConsole = new DedicatedConsole();
      return;
    }
    const commands = new CommandBuffer({ dialect: this.sourceDialect(),
      context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => { this.host.print(text); } });
    commands.register("quit", () => this.requestQuit());
    for (const name of ["save", "load", "map", "say", "addbot", "removebot", "botlist"]) commands.register(name, invocation => this.queueCommand(name, invocation.args, null));
    this.dedicatedCommands = commands;
    this.dedicatedConsole = new DedicatedConsole();
  }

  private sourceDialect(content = this.content): CommandDialect { return Application.contentDialect(content); }
  private static contentDialect(content: LoadedApplicationContent): CommandDialect {
    const source = content.catalog.product(content.recipe.engineBehavior.content).expectation;
    return source.family === "q1" ? source.edition === "quakeworld" ? "q1-quakeworld" : "q1-netquake" : source.family === "q2" ? source.edition === "rerelease" ? "q2-rerelease" : "q2-classic" : "q3";
  }

  private inputActions(simulation = this.simulation, content = this.content, q2Console = this.q2Console, localGuest = this.localGuest, clientCvars = this.clientCvars,
    sharedCvars = this.imageSettings?.cvars, candidateAction?: (request: ApplicationCommandRequest) => undefined): ApplicationInputCommands {
    return { readScript: path => content.mounts.open(path).then(resource => resource?.bytes),
      startupReader: (scripts, options) => Application.startupScriptReader(content, options, scripts),
      ...(this.host.llm === undefined ? {} : { llm: this.host.llm }), quit: () => { if (localGuest !== null && localGuest !== this.localGuest) throw new Error("Guest candidate requested quit"); return this.requestQuit(); },
      execute: (name, arguments_, seat, source) => candidateAction !== undefined ? candidateAction({ target: "application", name, arguments_: [...arguments_], seat, ...(source === undefined ? {} : { source }) })
        : localGuest === null ? this.queueCommand(name, arguments_, seat, source)
        : this.queueLocalGuestCommand(localGuest, { target: "application", name, arguments_: [...arguments_], seat, ...(source === undefined ? {} : { source }) }), print: text => this.host.print(text),
      arsenalImpulseProvider: seat => {
        const client = [...this.localSeats].find(([, local]) => local.id.equals(seat))?.[0];
        const actor = client === undefined ? undefined : simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
        const player = actor === undefined ? null : simulation.movementPlayer(actor);
        return player !== null && (simulation.q1Source() !== null || player.arsenal.state.kind === "q1") ? player.arsenal.provider : null;
      },
      bindingItems: seat => {
        const client = [...this.localSeats].find(([, local]) => local.id.equals(seat))?.[0];
        const player = client === undefined ? undefined : simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
        return player === undefined ? [] : simulation.playerUi(player).items;
      },
      bindingCapabilities: () => ({ chat: simulation.q2Source() !== null || simulation.q3Source() !== null || simulation.q3Guest() !== null,
        scoreCommand: simulation.q2Source() !== null ? "score" : simulation.q3Source() !== null || simulation.q3Guest() !== null ? "+scores" : null,
        offhandGrapple: simulation.recipe.equipment.grapple.kind === "enabled" && simulation.recipe.equipment.grapple.binding === "offhand",
        offhandGrenades: simulation.recipe.equipment.handGrenades.kind === "enabled" }),
      ...(sharedCvars === undefined ? {} : { sharedCvars }),
      console: { dialect: () => this.sourceDialect(content), server: () => {
        const source = simulation.q3Source();
        if (source !== null) return { cvars: source.host.cvars, sharedNames: [...source.settings.definitions.map(definition => definition.name), ...frameTimeCvarNames(source.host.cvars.dialect)] };
        if (q2Console !== null) return { cvars: q2Console.cvars, sharedNames: [...q2Console.sharedNames, ...frameTimeCvarNames(q2Console.cvars.dialect)] };
        const guest = simulation.q3Guest();
        if (guest !== null) return { cvars: guest.state.cvars, sharedNames: [...q3GameCvarDefinitions("missionpack").map(definition => definition.name), ...frameTimeCvarNames(guest.state.cvars.dialect)] };
        return q1ConsoleServer(simulation);
      }, seat: id => localGuest?.seats.get(id)?.cvars ?? clientCvars.get(id) ?? null },
      clientCapturesInput: seat => this.campaignMovie !== null || (this.graphical?.q3.get(seat)?.client.capturesInput ?? false),
      clientInput: event => {
        if (this.campaignMovie !== null) return this.campaignMovie.playback.input(event);
        const source = this.graphical?.q3.get(event.seat);
        if (source === undefined || !source.client.capturesInput) return false;
        this.clientInputs.push(event); return true;
      } };
  }

  private async dispatchClientInputs(): Promise<void> {
    const events = this.clientInputs; this.clientInputs = [];
    for (const event of events) {
      const client = this.graphical?.q3.get(event.seat)?.client; if (client === undefined) continue;
      await client.input(event);
    }
  }

  private bindServerSettingCommand(commands: CommandBuffer, simulation: SharedSimulation): () => void {
    const handler: CommandHandler = invocation => {
      const id = invocation.args[0], value = invocation.args[1];
      if (id === undefined || value === undefined || invocation.args.length !== 2) throw new Error("Usage: server_setting <server:setting-id> <value>");
      const binding = simulation.serverSettings().find(binding => binding.definition.id === id);
      if (binding === undefined) throw new Error(`No selected server setting ${id}`);
      const status = writeServerSetting(binding, value);
      this.host.print(`${id} = ${status.desired}${status.pending ? ` (effective ${status.effective}; ${status.applyAt})` : ""}\n`);
      return undefined;
    };
    commands.register("server_setting", handler);
    return () => { commands.unregister("server_setting", handler); };
  }
  private async bindSourceCommands(restoring = false): Promise<void> {
    const prepared = await this.prepareSourceCommands(this.simulation, this.content, restoring, request => { this.requestedCommands.push(request); return undefined; });
    this.publishSourceCommands(prepared);
  }

  private publishSourceCommands(prepared: PreparedSourceCommands): void {
    const options = prepared.options;
    if (options === null) throw new Error("Published world requires source command bindings");
    this.releaseSourceCommands();
    this.sourceCommandBinding = { options };
    if (this.sourceCommands === null) {
      this.sourceCommands = new CommandBuffer({ dialect: options.dialect, context: options.context,
        cvarRouting: {
          owner: () => {
            const cvars = this.sourceCommandBinding?.options?.cvars;
            if (cvars === undefined) throw new Error("Published authority requires a source registry");
            return cvars;
          },
          visible: () => { const cvars = this.sourceCommandBinding?.options?.cvars; return cvars === undefined ? [] : [cvars]; },
        }, print: text => this.host.print(text),
        readScript: (name, source) => this.sourceCommandBinding?.options?.readScript?.(name, source),
        clientGame: command => this.sourceCommandBinding?.options?.clientGame?.(command) ?? false,
        serverGame: command => this.sourceCommandBinding?.options?.serverGame?.(command) ?? false,
        forwardToServer: command => this.sourceCommandBinding?.options?.forwardToServer?.(command) });
    } else this.sourceCommands.setProfile(options.dialect, undefined);
    this.releaseSourceCommands = prepared.activate(this.sourceCommands);
    this.q2Console = prepared.q2Console;
  }

  private async prepareSourceCommands(simulation: SharedSimulation, content: LoadedApplicationContent, restoring: boolean, action: (request: ApplicationCommandRequest) => undefined): Promise<PreparedSourceCommands> {
    const queue = (name: string, args: readonly string[], seat: SeatId | null, source?: CommandContext): undefined =>
      action({ target: "application", name, arguments_: [...args], seat, ...(source === undefined ? {} : { source }) });
    const sourceAction = (name: string, args: readonly string[], source: CommandContext): undefined =>
      action({ target: "source", name, arguments_: [...args], seat: null, source });
    let program: ReturnType<CommandBuffer["prepareProgram"]> | null = null;
    let options: CommandBufferOptions | null = null;
    const bindings: ((commands: CommandBuffer) => () => void)[] = [];
    const create = (selected: CommandBufferOptions): CommandBuffer => {
      options = { ...selected, readScript: selected.readScript ?? (async name => {
        const resource = await content.mounts.open(name); return resource === null ? undefined : new TextDecoder().decode(resource.bytes);
      }) };
      if (this.sourceCommands === null) return new CommandBuffer(options);
      program = this.sourceCommands.prepareProgram(options); return program.commands;
    };
    const register = (commands: CommandBuffer, name: string, handler: CommandHandler): void => {
      commands.register(name, handler);
      bindings.push(owner => {
        const installed = owner.register(name, handler);
        return () => { if (installed) owner.unregister(name, handler); };
      });
    };
    const bind = (commands: CommandBuffer, install: (commands: CommandBuffer) => () => void): void => { install(commands); bindings.push(install); };
    const prepared = (): PreparedSourceCommands => ({ commands: sourceCommands, program, q2Console, options,
      activate: commands => {
        const disposers = bindings.map(install => install(commands));
        for (const name of ["save", "load"]) {
          const handler: CommandHandler = invocation => queue(name, invocation.args, null, invocation.source);
          if (commands.register(name, handler)) disposers.push(() => { commands.unregister(name, handler); });
        }
        return () => { for (const dispose of [...disposers].reverse()) dispose(); };
      } });
    const timeCvars = this.sourceCvars(simulation);
    if (timeCvars !== null) registerFrameTimeCvars(timeCvars);
    let sourceCommands: CommandBuffer | null = null;
    let q2Console: ApplicationQ2Console | null = null;
    if (simulation.q2Source() !== null) {
      q2Console = new ApplicationQ2Console({ simulation: () => simulation, content: () => content,
        print: text => { this.host.print(text); return undefined; }, execute: (name, args, source) => queue(name, args, null, source) });
      sourceCommands = create({ dialect: q2Console.cvars.dialect, cvars: q2Console.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => this.host.print(text) });
      const console = q2Console; bind(sourceCommands, commands => console.bind(commands));
      for (const name of ["addbot", "removebot", "botlist", "kick"]) register(sourceCommands, name, invocation => queue(name, invocation.args, null, invocation.source));
      if (!restoring) await q2Console.initialize();
      register(sourceCommands, "fly", invocation => queue("fly", invocation.args, null, invocation.source));
      bind(sourceCommands, commands => this.bindServerSettingCommand(commands, simulation));
      return prepared();
    }
    const q1 = simulation.q1Source() ?? simulation.quakecSource();
    if (q1 !== null) {
      const commands = create({ dialect: q1.cvars.dialect, cvars: q1.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => { this.host.print(text); } });
      register(commands, "quit", invocation => queue("quit", invocation.args, null, invocation.source));
      bind(commands, owner => registerQ1ClientCommands(owner, q1.cvars.dialect, (name, args, seat, source) => queue(name, args, seat, source)));
      for (const name of ["map", "say", "addbot", "removebot", "botlist", "kick"]) register(commands, name, invocation => queue(name, invocation.args, null, invocation.source));
      if (!restoring) registerQ1BotControls(q1.cvars);
      sourceCommands = commands; return prepared();
    }
    const guest = simulation.q3Guest();
    if (guest !== null) {
      const commands = create({ dialect: "q3", cvars: guest.state.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => this.host.print(text),
        serverGame: invocation => {
          if (guest.game.module.interpreter.isActive) throw new Error("Nested Q3 guest console exports are unsupported");
          const name = invocation.argv[0]; if (name === undefined) return false;
          queue(name, invocation.args, null, invocation.source); return true;
        } });
      register(commands, "quit", invocation => queue("quit", invocation.args, null, invocation.source));
      commands.unregister("exec");
      bindings.push(owner => { owner.unregister("exec"); return () => {}; });
      register(commands, "exec", invocation => {
        if (guest.game.module.interpreter.isActive) throw new Error("Q3 guest immediate exec is unsupported; append the script command");
        queue("exec", invocation.args, null, { session: invocation.source.session, origin: invocation.source.origin });
        return undefined;
      });
      for (const name of ["map", "map_restart", "devmap", "spmap", "spdevmap", "addbot", "removebot", "botlist", "kick"])
        register(commands, name, invocation => queue(name, invocation.args, null, invocation.source));
      sourceCommands = commands; bind(commands, owner => this.bindServerSettingCommand(owner, simulation)); return prepared();
    }
    const source = simulation.q3Source();
    if (source === null) return prepared();
    if (!restoring) source.host.cvars.set("dedicated", this.options.dedicated ? "1" : "0", true);
    const game = () => {
      const current = simulation.q3Source();
      if (current === null) throw new Error("Source console no longer owns a Quake III game");
      return current;
    };
    const commands = create({ dialect: "q3", context: { session: this.session.session, origin: { kind: "server-console" } },
      get cvars() { return game().host.cvars; }, print: text => { this.host.print(text); },
      clientGame: command => {
        const name = command.argv[0]; if (name === undefined) return false;
        const local = (this.simulation === simulation ? this.graphical : null)?.presentations.find(presentation => presentation.q3Client?.handlesCommand(name));
        if (local === undefined) return false;
        queue(name, command.args, local.local.player.seat.id, command.source); return true;
      }, serverGame: command => game().serverCommands.consoleCommand(command.argv),
      forwardToServer: command => { this.host.print(`Unbound source engine command: ${command.raw}\n`); return undefined; } });
    register(commands, "fly", invocation => queue("fly", invocation.args, null, invocation.source));
    register(commands, "map", invocation => queue("map", invocation.args, null, invocation.source));
    register(commands, "map_restart", invocation => queue("map_restart", invocation.args, null, invocation.source));
    if (this.isTeamArenaSkirmish(simulation)) register(commands, "postgame", invocation => sourceAction("postgame", invocation.args, invocation.source));
    register(commands, "teamarena-results", invocation => sourceAction("teamarena-results", invocation.args, invocation.source));
    register(commands, "kick", invocation => sourceAction("kick", invocation.args, invocation.source));
    register(commands, "removebot", invocation => queue("removebot", invocation.args, null, invocation.source));
    register(commands, "centerview", invocation => sourceAction("centerview", invocation.args, invocation.source));
    register(commands, "quit", invocation => queue("quit", invocation.args, null, invocation.source));
    sourceCommands = commands;
    bind(commands, owner => this.bindServerSettingCommand(owner, simulation));
    return prepared();
  }

  private kickTargets(args: readonly string[]): readonly ActorId[] {
    const source = this.simulation.q3Source(), target = args[0];
    if (target === undefined) throw new Error("Usage: kick <player name|slot|all|allbots>");
    const selected = this.simulation.players().filter(actor => {
      const player = this.simulation.movementPlayer(actor);
      if (player === null || this.localSeats.has(player.client)) return false;
      if (target.toLowerCase() === "all") return true;
      if (target.toLowerCase() === "allbots") return this.bots !== null && this.bots.actor(player.client) !== null;
      const q2Player = this.simulation.q2Source()?.players.states.get(actor);
      const name = source?.pool.clientAt(player.client.slot).pers.netname ?? (q2Player === undefined ? "" : q2OperatorPlayerName(q2Player));
      return String(player.client.slot) === target || name.replace(/\^[0-9]/g, "").toLowerCase() === target.toLowerCase();
    });
    if (selected.length === 0) throw new Error(`Player ${target} is not on the server`);
    return selected;
  }

  private async kickClients(args: readonly string[]): Promise<undefined> {
    const source = this.simulation.q3Source();
    for (const actor of this.kickTargets(args)) {
      const player = this.simulation.movementPlayer(actor);
      if (player === null) continue;
      if (source !== null) source.host.engine.dropClient(player.client.slot, "was kicked");
      else if (!this.bots?.disconnect(player.client.slot) && !await this.network?.server.disconnectClient(player.client, "was kicked")) {
        this.simulation.disconnectPlayer(actor); this.session.closeClient(player.client);
      }
    }
    return undefined;
  }

  private requestRestart(args: readonly string[]): undefined {
    const source = this.simulation.q3Source();
    if (source === null) throw new Error("map_restart requires the Quake III game provider");
    if (this.lastRestartFrame === this.frames || this.pendingRestart !== null) return undefined;
    const delay = args[0] === undefined ? 5 : nativeAtoi(args[0]);
    const scheduled = delay !== 0 && source.host.cvars.variableValue("g_doWarmup") === 0;
    this.pendingRestart = scheduled ? (source.host.now() + Math.imul(delay, 1000)) | 0 : source.host.now();
    if (scheduled) source.host.configstrings.set(5, String(this.pendingRestart));
    return undefined;
  }

  private appendQ1Commands(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      if (source.kind !== "q1" || source.event.kind !== "server-command") continue;
      if (this.sourceCommands === null) throw new Error("Q1 source console has no command owner");
      this.sourceCommands.append(source.event.text);
    }
  }

  private async sourceActions(events: readonly SimulationPresentationEvent[] = this.sourceEvents): Promise<void> {
    for (const source of events) {
      if (source.kind === "q1-composition") {
        const event = source.event.kind === "addon" ? source.event.event : source.event;
        if (event.kind === "developer-message") {
          this.host.print(event.text);
          for (const local of this.graphical?.input.locals ?? []) local.console.print(event.text);
        }
        continue;
      }
      if (source.kind === "q2-composition" && source.event.kind === "kick") {
        const player = this.simulation.movementPlayer(source.event.actor);
        if (player !== null) {
          if (await this.network?.server.disconnectClient(player.client, "was kicked")) continue;
          const local = this.localSeats.has(player.client);
          this.simulation.disconnectPlayer(source.event.actor);
          this.session.closeClient(player.client); this.localSeats.delete(player.client);
          if (local) this.requestQuit();
        }
        continue;
      }
      if (source.kind === "q2-rerelease") {
        if (source.event.kind === "restart-level") this.pendingMap = mapResourcePath(source.event.map);
        else if (source.event.kind === "autosave") {
          await this.autosaveLevel();
        }
        continue;
      }
      if (source.kind !== "q3-source") continue;
      const event = source.event;
      if (event.kind === "print") this.host.print(event.text);
      else if (event.kind === "console-command") {
        if (this.sourceCommands === null) throw new Error("Q3 source console has no command owner");
        if (event.execution === "now") this.sourceCommands.executeNow(event.text);
        else this.sourceCommands.append(event.text);
      } else if (event.kind === "drop-client") {
        if (this.bots?.disconnect(event.client)) { this.host.print(`Client ${event.client}: ${event.reason}\n`); continue; }
        const actor = this.simulation.players().find(actor => this.simulation.movementPlayer(actor)?.client.slot === event.client);
        if (actor === undefined) continue;
        const player = this.simulation.movementPlayer(actor);
        if (player === null) throw new Error("Source disconnect lost its client identity");
        if (await this.network?.server.disconnectClient(player.client, event.reason)) continue;
        const local = this.localPlayers.some(local => local.actor.equals(actor));
        this.simulation.disconnectPlayer(actor);
        this.session.closeClient(player.client);
        this.localSeats.delete(player.client);
        this.host.print(`Client ${event.client}: ${event.reason}\n`);
        if (local) this.requestQuit();
      }
    }
    if (this.pendingTeamArenaPostgame !== null) {
      const stats = this.pendingTeamArenaPostgame;
      this.pendingTeamArenaPostgame = null;
      const source = this.simulation.q3Source();
      if (source === null || !this.isTeamArenaSkirmish()) throw new Error("Team Arena postgame lost its source owner");
      const files = new UserFileStore(Application.sourceConfig(this.options, this.content).root);
      const result = await recordTeamArenaScore({ stats, map: this.options.map.replace(/^maps\//, "").replace(/\.bsp$/, ""), gameType: source.gameType,
        matchStartTime: source.level.startTime, skill: source.host.cvars.variableValue("g_spSkill"), timeToBeat: source.host.cvars.variableValue("ui_teamArenaTimeToBeat") }, {
        readFile: async path => { const file = Bun.file(join(files.root, path)); return await file.exists() ? new Uint8Array(await file.arrayBuffer()) : null; },
        writeFile: async (path, bytes) => {
          const file = files.open(path, "write", text => this.host.print(text));
          if (file === null) throw new Error("Cannot open Team Arena score file");
          try { if (file.write(bytes) !== bytes.length) throw new Error("Incomplete Team Arena score write"); } finally { file.close(); }
        },
      });
      source.host.cvars.set("ui_scoreScore", String(result.score.score), true);
      source.host.cvars.set("ui_scoreTime", `${Math.trunc(result.score.time / 60).toString().padStart(2, "0")}:${(result.score.time % 60).toString().padStart(2, "0")}`, true);
      source.host.cvars.set("ui_scoreTeam", `${result.score.redScore} to ${result.score.blueScore}`, true);
      for (const setting of teamArenaServerOverrides) source.host.cvars.set(setting.name, source.host.cvars.variableString(setting.saved), true);
      this.teamArenaOverrides = releaseTeamArenaOverrides(this.teamArenaOverrides, this.overrideSeats());
      if (result.newHighScore) this.host.print(`New Team Arena high score: ${result.score.score}\n`);
    }
  }

  private async networkHost(simulation = this.simulation, content = this.content, serverCount = this.nativeWorldCount): Promise<NativeServerHost> {
    const source = content.catalog.product(content.recipe.map.entities.content).expectation;
    if (this.options.q1Protocol !== undefined && source.family !== "q1") throw new Error("--q1-protocol requires a Quake I source game");
    if (this.options.network.kind === "q2-server" && source.family !== "q2") throw new Error("--listen-q2 requires a Quake II source game; use --listen for the selected native protocol");
    const common = { session: this.session, simulation, content, print: (text: string): void => { this.host.print(text); } };
    switch (source.family) {
      case "q1": return source.edition === "quakeworld"
        ? { kind: "qw", host: await createQwApplicationServerHost({ ...common, serverCount }) }
        : { kind: "q1", host: await createQ1ApplicationServerHost({ ...common, protocol: this.options.q1Protocol ?? { kind: "q1-netquake", version: 15 } }) };
      case "q2": return { kind: "q2", host: await createQ2ApplicationServerHost({ ...common,
        protocol: source.edition === "rerelease" ? { kind: "q2-rerelease", version: 1038 } : { kind: "q2-classic", version: 34 } }) };
      case "q3": return { kind: "q3", host: await createQ3ApplicationServerHost(common) };
    }
  }

  private validateNetworkHost(next: NativeServerHost): void {
    if (this.network !== null && this.network.kind !== next.kind) throw new Error("A native server cannot change wire families while carrying connected clients");
    const supported = next.host.supportsSourceWire();
    if (supported.kind === "unsupported") throw new Error(`Native ${next.kind.toUpperCase()} wire is unavailable: ${supported.reasons.join("; ")}`);
  }

  private async changeNetworkWorld(next: NativeServerHost): Promise<void> {
    const network = this.network;
    if (network === null) throw new Error("Native world replacement requires an open server");
    switch (next.kind) {
      case "q1": if (network.kind !== "q1") throw new Error("Native Q1 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
      case "qw": if (network.kind !== "qw") throw new Error("Native QW host cannot replace another wire family"); network.server.changeWorld(next.host); this.nativeWorldCount++; return;
      case "q2": if (network.kind !== "q2") throw new Error("Native Q2 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
      case "q3": if (network.kind !== "q3") throw new Error("Native Q3 host cannot replace another wire family"); await network.server.changeWorld(next.host); return;
    }
  }

  private async openNetwork(): Promise<void> {
    const selection = this.options.network;
    if (selection.kind !== "q2-server" && selection.kind !== "native-server") return;
    const selected = await this.networkHost();
    this.validateNetworkHost(selected);
    const limits = selected.kind === "q1" ? UNIFIED_DATAGRAM_LIMITS : selected.kind === "q2" ? Q2_DATAGRAM_LIMITS : Q3_DATAGRAM_LIMITS;
    const transport = await UdpTransport.bind({ host: selection.host, port: selection.port, limits });
    const random = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    try {
      switch (selected.kind) {
        case "q1": this.network = { kind: "q1", address: transport.address, server: new Q1ServerNetwork({ transport, host: selected.host }) }; break;
        case "qw": this.network = { kind: "qw", address: transport.address, server: new QwServerNetwork({ transport, host: selected.host, random: () => Math.trunc(Math.random() * 0x7fffffff) }) }; break;
        case "q2": this.network = { kind: "q2", address: transport.address, server: new Q2ServerNetwork({ transport, host: selected.host, random }) }; break;
        case "q3": this.network = { kind: "q3", address: transport.address, server: new Q3ServerNetwork({ transport, host: selected.host, random }) }; break;
      }
      this.host.print(`Listening for ${selected.kind.toUpperCase()} peers on ${addressKey(transport.address)}.\n`);
    } catch (error) { transport.close(); throw error; }
  }


  private async openGraphical(restoring = false): Promise<void> {
    const client = this.ownership.kind === "borrowed" ? this.ownership.client : null;
    const owner = client?.renderer.owner ?? { identity: Symbol("application renderer"), session: this.session.session, generation: 0 };
    const rootImages = client?.renderer.images ?? new SceneImageRegistry(owner);
    const assets = new ApplicationAssets(this.content, owner, undefined, { imageRegistry: rootImages,
      ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
    let renderer: NativeRenderer | null = null, input: ApplicationInput | null = null, audio: ApplicationAudio | null = null;
    let art: NativeUiArt | null = null;
    let effects: ApplicationEffects | null = null;
    const sourceClients: ApplicationQ3Client[] = [];
    try {
      this.host.loading?.stage("Loading textures...");
      await assets.loadWorld();
      this.host.loading?.stage("Loading characters...");
      const font = await assets.loadConsoleFont(), typography = await assets.loadMenuTypography();
      const characters = this.options.character === "q3" ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
        { model: this.options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
      renderer = client?.renderer ?? NativeRenderer.open(this.host.loading?.deferWindowVisibility ? { ...this.options, hidden: true } : this.options, owner, rootImages);
      if (client === null) await this.imageSettings?.refreshDisplay(renderer);
      const players: LocalPlayer[] = [];
      if (restoring) for (const seat of this.localSeats.values()) {
        const archive = await this.loadClientArchive(seat, this.content);
        if (this.localGuest !== null) {
          players.push({ seat, actor: this.prepareRestoredGuestSeat(this.localGuest, this.simulation, seat, this.content, this.options, undefined, archive) });
          const cvars = this.localGuest.seats.get(seat.id)?.cvars;
          if (cvars === undefined) throw new Error("Restored guest seat cvars are missing");
          this.clientCvars.set(seat.id, cvars);
        } else {
          this.clientCvars.set(seat.id, this.createClientCvars(this.simulation, this.content, this.options, seat,
            this.simulation.q3Source()?.host.engine.getUserinfo(seat.client.id.slot) ?? null, undefined, archive));
          const actor = this.simulation.players().find(actor => this.simulation.movementPlayer(actor)?.client.equals(seat.client.id));
          if (actor === undefined) throw new Error("Restored world is missing a local player");
          players.push({ seat, actor });
        }
      }
      else for (let index = 0; index < this.options.seats; index++) {
        const existingSeat = [...this.localSeats.values()].find(local => local.id.index === index);
        const client = existingSeat?.client ?? this.session.createClient(index);
        if (this.ownership.kind === "owned") this.sourceConnections.set(client, client.connect("loopback"));
        const seat = existingSeat ?? this.session.createSeat(index, client);
        this.localSeats.set(client.id, seat);
        const cvars = this.createClientCvars(this.simulation, this.content, this.options, seat, null, undefined,
          await this.loadClientArchive(seat, this.content), true);
        this.clientCvars.set(seat.id, cvars);
        if (this.localGuest !== null) {
          const authority = this.localGuest.authority;
          const userinfo = `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`;
          const admission = await authority.connect(client.id, userinfo);
          if (admission.kind === "rejected") throw new Error(admission.reason);
          this.prepareLocalGuestSeat(this.localGuest, this.simulation, seat, cvars, userinfo, authority.gameState(admission.player, 1));
          await authority.begin?.(admission.player, { serverTime: 0, angles: [0, 0, 0], forwardmove: 0, rightmove: 0, upmove: 0, buttons: 0, weapon: 2 });
          players.push({ seat, actor: admission.player.actor });
        } else {
          this.simulation.q3Source()?.host.engine.setUserinfo(client.id.slot, `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`);
          const player = this.simulation.admitPlayer(client.id);
          players.push({ seat, actor: player.actor });
        }
      }
      if (restoring) applyTeamArenaOverrides(this.teamArenaOverrides, this.overrideSeats());
      else if (this.options.teamArenaSkirmish !== undefined) this.teamArenaOverrides = captureTeamArenaOverrides(this.overrideSeats());
      this.host.loading?.stage("Loading sounds...");
      const configuration = this.profileConfiguration;
      const actions = { ...this.inputActions(), ...(this.configurationScripts === null ? {} : { scripts: this.configurationScripts }) };
      const inputArguments: Parameters<typeof ApplicationInput.open> = [renderer.window, players, this.options, movementDialect(this.options, this.simulation.recipe), this.simulation,
        configuration === null ? actions : { ...actions, configuration, startupReader: () => configuration.read },
        () => performance.now(), this.inputConfig, undefined, undefined, this.preparedStartup ?? undefined];
      input = client === null ? await ApplicationInput.open(...inputArguments)
        : await ApplicationInput.prepareForClient(client, new Set([client.imageSettings.cvars, client.prepared.source, client.prepared.movement,
          client.prepared.fallback, ...client.prepared.seats.flatMap(seat => [seat.cvars, seat.mouse.cvars])]), ...inputArguments);
      this.restoreQ3InputAngles(input, this.simulation);
      if (restoring) {
        input.resumeCommands(Math.max(0, ...players.map(player => (this.simulation.movementPlayer(player.actor)?.lastSequence ?? -1) + 1)));
      }
      if (this.localGuest !== null) {
        this.guestBrowser = await this.openGuestBrowser();
        this.publishLocalGuestSnapshots();
      }
      audio = new ApplicationAudio(this.content, () => this.elapsed, this.options.seed, this.options.characterModel, text => this.host.print(text),
        { ...await loadAudioSettings(this.inputConfig), musicControls: this.musicControls, deferOutput: client !== null });
      if (this.imageSettings?.cvars.find("volume") !== undefined) {
        if (this.preparedStartup === null) {
          this.imageSettings.cvars.set("volume", String(audio.effectsVolume));
          this.imageSettings.cvars.set("bgmvolume", String(audio.musicVolume));
        }
        audio.bindVolumeCvars(this.imageSettings.cvars);
      }
      audio.bindHaptics(input);
      await audio.prepareEnvironment(this.simulation.scene);
      applyFrontendPreferences(this.frontendOverrides, input, audio);
      this.frontendBaseline = readFrontendPreferences(input, audio);
      const fontSource = font.classic.picture.image.source;
      if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
      art = await loadNativeUiArt(fontSource.resource.id, assets.images, loadMenuArtImage);
      const effectSimulation = this.simulation;
      effects = new ApplicationEffects(assets, effectSimulation.scene, actor => effectSimulation.players().some(player => player.equals(actor)), this.options.seed);
      for (const failure of await effects.preloadTransientResources()) this.host.print(`Optional effect preload skipped: ${failure.content}/${failure.path}: ${failure.error}\n`);
      await prepareApplicationResources({ content: assets.content, simulation: this.simulation, audio, effects,
        progress: message => this.host.loading?.stage(message), print: message => this.host.print(message) });
      const native = renderer;
      const inputOwner = input, audioOwner = audio, menuArt = art, worldEffects = effects;
      const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor })));
      const presentations: WorldSeatPresentation[] = [], q3 = new Map<SeatId, Q3SeatClient>();
      for (const local of input.locals) {
        const sourceClient = await this.createQ3SeatClient(local, assets, audioOwner, inputOwner, native, this.simulation);
        if (sourceClient !== null) { sourceClients.push(sourceClient.client); q3.set(local.player.seat.id, sourceClient); }
        if (this.viewSettings.override !== null) {
          if (sourceClient?.kind !== "qvm") this.simulation.setPlayerFieldOfView(local.player.actor, this.viewSettings.fieldOfView, restoring ? "restore" : "change");
          sourceClient?.client.cvars.set("cg_fov", String(this.viewSettings.fieldOfView));
        }
        if (restoring && sourceClient?.kind === "qvm") await sourceClient.client.prepare(this.frames);
        const ui = new ApplicationSeatUi(local, menuArt, inputOwner, this.simulation, font, audioOwner, () => this.requestQuit(),
          (name, args) => this.queueCommand(name, args, local.player.seat.id), typography, { bindings: () => this.simulation.serverSettings(), store: this.serverProfileStore },
          await rerelease.languageBinding(local.player.seat.id, this.content.recipe.map.entities.content, error => local.console.print(`Language reload failed: ${String(error)}\n`)), this.saveMenu(this.simulation, this.options), this.viewSettings.binding(), this.host.llm, sourceClient?.kind === "qvm", this.teamArenaResults(this.simulation, local.player.seat));
        const presentation = new WorldSeatPresentation(local, assets, native, this.simulation, this.options.seats, font, characters, ui, worldEffects, sourceClient?.client ?? null, rerelease, () => this.imageSettings?.cvars.variableValue("gl_debug_distfrac") ?? 0.004, () => this.viewSettings.fieldOfView, { lines: () => this.simulation.debugLines(), lineWidth: () => this.imageSettings?.debugLineWidth ?? 2 }, () => this.imageSettings?.cvars.variableValue("con_scale") ?? 0, () => readQ1ViewSettings(this.imageSettings?.cvars ?? null, this.sourceDialect()));
        if (client === null) local.player.seat.attachPresentation(presentation, () => presentation.close());
        presentations.push(presentation);
      }
      this.graphical = { renderer, assets, input, audio, effects, art, presentations, q3, rerelease };
      this.capture = client?.capture ?? new ApplicationCapture(inputCaptureServices(input, applicationCaptureRoot(this.options.userContentRoot), () => this.options.map, text => this.host.print(text)), renderer);
      if (client === null) this.capture.activate();
      if (q3.size === 0) await audio.startWorldMusic();
    } catch (error) {
      for (const client of sourceClients) client.close();
      if (restoring) this.simulation.q3Guest()?.discard(); else await this.simulation.shutdownQ3Guest();
      for (const { state } of this.localGuest?.seats.values() ?? []) state.retire();
      this.localGuest?.seats.clear(); this.localGuest = null;
      audio?.close(); effects?.close(); input?.close(); art?.close(); assets.close();
      if (client === null) { this.session.close(); if (renderer === null) rootImages.close(); else renderer.close(); }
      else {
        try { client.renderer.execute({ owner, sequence: this.frames, commands: [] }); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "Graphical preparation and image retirement failed"); }
      }
      this.graphical = null;
      throw error;
    }
  }

  get captureMap(): string { return this.content.recipe.map.geometry.requestedPath; }

  async prepareRetirement(): Promise<void> {
    await this.capture?.beforeWorldChange();
  }

  async readClientResource(path: string): Promise<Uint8Array | undefined> {
    const content = this.content;
    if (this.closed) throw new Error("Client source has retired");
    const resource = await content.mounts.open(path);
    if (this.closed || this.content !== content) throw new Error("Client source changed during resource read");
    return resource?.bytes;
  }

  releaseSettings(): void { this.releaseViewCvars?.(); this.releaseViewCvars = null; }

  retire(): Promise<void> { return this.close(); }

  private async publishBorrowed(client: ClientBootstrap,
    images: ReturnType<ApplicationImageSettings["prepareClientSettings"]>): Promise<void> {
    const graphical = this.graphical;
    if (graphical === null) throw new Error("Borrowed application has no graphical source");
    const previous = client.source.current;
    await client.capture.beforeWorldChange();
    await previous?.prepareRetirement();
    client.session.resources.assertOpen();
    graphical.input.validateStartupAdoption();
    graphical.input.validateCandidateCommands();
    images.validatePublication();
    const presentations = graphical.presentations.map(presentation => ({ seat: presentation.local.player.seat,
      presentation, cleanup: () => presentation.close() }));
    client.session.validateWorldReplacement(this.simulation, presentations, this.sourceClientChanges, this.sourceSeatChanges);
    const publishAudio = client.output.current.prepareOutputTransfer(graphical.audio.engine);
    let retired: ReturnType<EngineSession["replaceWorld"]>["retired"] | null = null;
    let retiredConfiguration: ConsoleScriptFiles | null = null;
    const retiredConnections: SessionConnection[] = [];
    const failures: unknown[] = [];
    this.sourcePublished = true;
    client.source.current = this;
    try {
      previous?.releaseSettings();
      for (const local of graphical.input.locals) {
        const replacement = local.player.seat.client.replaceConnection("loopback");
        this.sourceConnections.set(local.player.seat.client, replacement.connection);
        if (replacement.retired !== null) retiredConnections.push(replacement.retired);
      }
      retired = client.session.replaceWorld(this.simulation, presentations, this.sourceClientChanges, this.sourceSeatChanges).retired;
      this.sourceSeatsPublished = true;
      client.sourceProfile.current = this.content.recipe.map.entities;
      this.releaseSettings();
      images.publish();
      this.imageSettings = client.imageSettings;
      graphical.input.publishSharedCvars(client.imageSettings.cvars);
      graphical.audio.bindVolumeCvars(client.imageSettings.cvars);
      this.viewSettings.setFieldOfView(client.imageSettings.cvars.variableValue("fov"));
      this.releaseViewCvars = this.viewSettings.bindCvars(client.imageSettings.cvars);
      graphical.input.publishClientPlatform(client, "replace");
      if (this.configurationScripts !== null && this.configurationScripts !== client.configuration.current.scripts) {
        retiredConfiguration = client.configuration.current.scripts;
        client.configuration.current = { scripts: this.configurationScripts, options: this.options };
        this.configurationScripts = null;
      }
      publishAudio(); client.output.current = graphical.audio.engine;
    } catch (error) { failures.push(error); this.fatalWorldFailure = true; }
    finally {
      try { await previous?.retire(); } catch (error) { failures.push(error); }
      try { retired?.close(); } catch (error) { failures.push(error); }
      try { await retiredConfiguration?.close(); } catch (error) { failures.push(error); }
      for (const connection of retiredConnections) { try { connection.close(); } catch (error) { failures.push(error); } }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Client source publication failed after retirement began");
  }

  private static startupScriptReader(content: LoadedApplicationContent, options: ApplicationOptions, scripts: ConsoleScriptFiles): ReturnType<typeof createStartupScriptReader> {
    const product = content.catalog.product(content.recipe.engineBehavior.content);
    const base = product.expectation.baseProduct === null ? product : content.catalog.product(product.expectation.baseProduct);
    const roots = (selected: typeof product): readonly string[] => [selected.userContent?.root, selected.looseRoot].filter((root): root is string => root !== undefined && root !== null);
    return createStartupScriptReader({ mounted: name => scripts.readMounted(name),
      user: (name, source) => scripts.read(name, source), baseLooseRoots: roots(base), gameLooseRoots: roots(product), seatRoot: consoleConfigRoot(options.userContentRoot) });
  }

  private static sourceScripts(content: LoadedApplicationContent, options: ApplicationOptions, settings: ConfigStore): ConsoleScriptFiles {
    const mounts = content.mounts, release = content.retainMainMounts();
    return new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings,
      mounted: name => mounts.open(name).then(resource => resource?.bytes) }, async () => { release(); });
  }


  private async openGuestBrowser(): Promise<LocalQ3GuestBrowser> {
    const host = await StartupServerBrowser.open(this.inputConfig);
    try {
      return { host, view: new Q3BrowserView({ browser: host, now: () => performance.now(),
        maxPing: () => this.localGuest?.seats.values().next().value?.cvars.variableValue("cl_maxPing") ?? 800,
        statusResendTime: () => this.localGuest?.seats.values().next().value?.cvars.variableValue("cl_serverStatusResendTime") ?? 750,
        print: text => this.host.print(text) }) };
    } catch (error) { await host.close(); throw error; }
  }

  private queueLocalGuestCommand(world: LocalQ3GuestWorld, command: ApplicationCommandRequest): undefined {
    if (world === this.localGuest) this.requestedCommands.push(command);
    else world.pendingCommands.push(command);
    return undefined;
  }

  private prepareLocalGuestSeat(world: LocalQ3GuestWorld, simulation: SharedSimulation, seat: SessionSeat, cvars: CvarRegistry,
    userinfo: string, initial: ConstructorParameters<typeof LocalQ3ClientState>[0]): void {
    const guest = simulation.q3Guest(); if (guest === null) throw new Error("Local guest authority is missing");
    const state = new LocalQ3ClientState(initial, {
      assertCurrent: () => { if (seat.client.isClosed || guest.isRetired) throw new Error("Guest client world is retired"); },
      actorAt: number => { if (number === 1022) return world.worldSound;
        const actor = simulation.actors.atSource(simulation.recipe.map.entities.provider, number);
        if (actor === null) throw new Error(`Guest entity ${number} is not published`); return actor.id; },
      systemInfo: () => { world.seats.get(seat.id)?.client?.refreshSystemInfo(); },
      mapRestart: () => { throw new Error("Local guest map restart is unsupported"); },
      levelShot: () => this.queueLocalGuestCommand(world, { target: "application", name: "levelshot", arguments_: [], seat: seat.id }),
      print: text => this.host.print(text),
    });
    world.seats.set(seat.id, { state, cvars, userinfo, client: null });
  }

  private loadClientArchive(seat: SessionSeat, content: LoadedApplicationContent, options = this.options): Promise<readonly CvarArchiveEntry[]> {
    return loadCvarArchive(Application.clientConfig(options, content), ["client", content.recipe.engineBehavior.content, content.recipe.engineBehavior.provider, String(seat.id.index)], this.sourceDialect(content));
  }

  private createClientCvars(simulation: SharedSimulation, content: LoadedApplicationContent, options: ApplicationOptions, seat: SessionSeat,
    userinfo: string | null, previous?: CvarRegistry, archive: readonly CvarArchiveEntry[] = [], selectedIdentity = false): CvarRegistry {
    const startupSeat = previous === undefined && this.graphical === null ? this.preparedStartup?.seats.find(local => local.id.equals(seat.id)
      && local.context.origin.kind === "local-seat" && local.context.origin.client.equals(seat.client.id)) : undefined;
    const prepared = this.graphical === null ? this.profileConfiguration?.seats.find(local => local.id.equals(seat.id) && local.context.origin.kind === "local-seat"
      && local.context.origin.client.equals(seat.client.id)) ?? (this.ownership.kind === "owned" ? startupSeat : undefined) : undefined;
    previous ??= startupSeat?.cvars;
    const cvars = prepared?.cvars ?? new CvarRegistry({ dialect: this.sourceDialect(content), context: { session: this.session.session,
      origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } }, print: text => this.host.print(text),
      cheatsAllowed: () => this.sourceCvars(simulation)?.variableValue("sv_cheats") === 1 });
    if (prepared === undefined) {
      if (userinfo === null && previous?.dialect === cvars.dialect) cvars.restoreSaveState(previous.captureSaveState());
      else {
        if (userinfo !== null) {
          const fields = userinfo.split("\\");
          for (let index = fields[0] === "" ? 1 : 0; index + 1 < fields.length; index += 2) {
            const name = fields[index], value = fields[index + 1];
            if (name !== undefined && value !== undefined && name !== "ip") cvars.register(name, value, CvarFlag.UserInfo);
          }
        }
        const available = (name: string) => ((cvars.find(name)?.flags ?? 0) & CvarFlag.UserInfo) === 0;
        cvars.applyArchive((previous?.archiveEntries() ?? archive).filter(entry => available(entry.name)));
        for (const value of previous?.snapshots() ?? []) if ((value.flags & CvarFlag.UserInfo) === 0) cvars.set(value.name, value.value, true);
      }
    }
    if (cvars.dialect === "q3") {
      initializeQ3ClientCvars(cvars, { name: `Player ${seat.id.index + 1}`, model: options.characterModel });
      if (selectedIdentity) for (const name of ["model", "headmodel", "team_model", "team_headmodel"])
        cvars.set(name, `${options.characterModel}/default`, true);
    }
    if (userinfo === null && options.teamArenaSkirmish !== undefined && selectedIdentity) {
      const setup = options.teamArenaSkirmish;
      if (seat.id.index === 0) simulation.q3Source()?.host.cvars.set("ui_drawTimer", String(cvars.variableValue("cg_drawTimer")), true);
      for (const name of ["model", "team_model"]) cvars.set(name, setup.playerModel, true);
      for (const name of ["headmodel", "team_headmodel"]) cvars.set(name, setup.playerHeadModel, true);
      for (const setting of teamArenaClientCvars(setup, cvars.snapshots())) cvars.set(setting.name, setting.value, true);
    }
    return cvars;
  }

  private isTeamArenaSkirmish(simulation = this.simulation): boolean {
    const source = simulation.q3Source();
    return source?.options.product === "missionpack" && source.host.cvars.variableString("nextmap") === "teamarena-results";
  }

  private teamArenaResults(simulation: SharedSimulation, seat: SessionSeat): TeamArenaResultService | undefined {
    if (!this.isTeamArenaSkirmish(simulation)) return undefined;
    return { read: () => {
      const source = simulation.q3Source();
      if (source === null || source.level.intermissionTime === 0) return null;
      const human = source.pool.clientAt(seat.client.id.slot);
      const team = human.sess.sessionTeam;
      const score = source.gameType >= GameType.GT_CTF ? source.level.teamScores.get(team)
        : human.ps.persistant.get(PersistentIndex.PERS_SCORE);
      const opponent = source.gameType >= GameType.GT_CTF ? source.level.teamScores.get(team === Team.TEAM_RED ? Team.TEAM_BLUE : Team.TEAM_RED)
        : source.pool.clients.filter(client => client !== human).reduce((highest, client) => Math.max(highest, client.ps.persistant.get(PersistentIndex.PERS_SCORE)), -9999);
      return { title: source.host.cvars.variableString("ui_scoreMap"),
        won: source.gameType >= GameType.GT_CTF ? score > opponent : source.level.sortedClients[0] === seat.client.id.slot, score, opponent,
        points: source.host.cvars.variableValue("ui_scoreScore"), time: source.host.cvars.variableString("ui_scoreTime") };
    }, next: () => this.queueCommand("teamarena-next", [], seat.id), retry: () => this.queueCommand("teamarena-retry", [], seat.id), quit: () => this.requestQuit() };
  }

  private startTeamArenaSkirmish(setup: TeamArenaSkirmish): void {
    const commands = this.sourceCommands;
    if (commands === null || this.simulation.q3Source() === null) throw new Error("Team Arena requires the native Quake III source command owner");
    for (const bot of setup.bots) commands.append(`addbot ${bot.ai} ${setup.skill} ${bot.team === "" ? "," : bot.team} ${bot.delayMilliseconds} ${bot.name}\n`);
    for (const source of this.graphical?.q3.values() ?? []) source.client.options.commands.reliable(`team ${setup.playerTeam}`);
  }

  private prepareRestoredGuestSeat(world: LocalQ3GuestWorld, simulation: SharedSimulation, seat: SessionSeat,
    content: LoadedApplicationContent, options: ApplicationOptions, previous?: CvarRegistry, archive: readonly CvarArchiveEntry[] = []): ActorId {
    const guest = simulation.q3Guest(), player = guest?.player(seat.client.id);
    if (guest === null || player === undefined || player === null) throw new Error("Restored guest is missing a connected local player");
    const userinfo = guest.state.getUserinfo(player.sourceEntity);
    if (userinfo === undefined) throw new Error("Restored guest is missing local userinfo");
    const cvars = this.createClientCvars(simulation, content, options, seat, userinfo, previous, archive);
    this.prepareLocalGuestSeat(world, simulation, seat, cvars, userinfo,
      world.authority.gameState(player, guest.state.cvars.variableValue("sv_serverid")));
    const command = guest.state.getUserCommand(player.sourceEntity);
    if (command !== undefined) world.seats.get(seat.id)?.state.commands.append(command);
    return player.actor;
  }

  private restoreQ3InputAngles(input: ApplicationInput, simulation: SharedSimulation): void {
    const state = simulation.q3Source()?.host.serverState ?? simulation.q3Guest()?.state;
    if (state === undefined) return;
    for (const local of input.locals) {
      if (local.builder.dialect !== "q3") continue;
      const command = state.getUserCommand(local.player.seat.client.id.slot);
      local.builder.setViewAngles(command === undefined ? { x: 0, y: 0, z: 0 } : { x: (command.angles[0] << 16 >> 16) * (360 / 65536),
        y: (command.angles[1] << 16 >> 16) * (360 / 65536), z: (command.angles[2] << 16 >> 16) * (360 / 65536) });
    }
  }

  private publishLocalGuestSnapshots(local = this.localGuest, simulation = this.simulation): void {
    const guest = simulation.q3Guest();
    if (local === null || guest === null) return;
    for (const { state } of local.seats.values()) {
      const player = guest.players().find(player => player.sourceEntity === state.clientNumber);
      if (player === undefined) continue;
      const snapshot = local.authority.snapshot(player);
      state.receiveSnapshot({ messageNumber: state.serverMessageSequence + 1, serverTime: local.authority.time(), deltaNumber: -1, flags: 0,
        serverCommandNumber: state.serverCommandSequence, parseEntitiesNumber: 0, playerState: snapshot.player,
        entities: snapshot.entities, areaMask: snapshot.areaMask });
    }
  }

  private async createQ3SeatClient(local: LocalInput, assets: ApplicationAssets, audio: ApplicationAudio, input: ApplicationInput,
    renderer: NativeRenderer, simulation: SharedSimulation, settings?: readonly CvarSnapshot[], localGuest = this.localGuest, browser = this.guestBrowser,
    cvars = this.clientCvars.get(local.player.seat.id)): Promise<Q3SeatClient | null> {
    const guest = simulation.q3Guest();
    if (guest !== null) {
      const seat = localGuest?.seats.get(local.player.seat.id);
      if (localGuest === null || seat === undefined || browser === null) throw new Error("Local guest client services are not prepared");
      const { state, cvars } = seat;
      const client = await ApplicationQ3Client.create({ saveFontData: () => (input.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0, kind: "qvm", localServer: true, source: state.source, connection: state, cvars,
        assets, queries: simulation.scene, local, audio, renderer, browser: browser.view, commandBuffer: input.guestCommands, guestCvars: input.guestCvars(local.player.seat.id), guestInput: input.guestInput(local.player.seat.id),
        commandRegistration: input.clientCommandRegistration(local.player.seat.id),
        splitScreen: this.options.seats > 1,
        timeCvars: guest.state.cvars,
        assertCurrent: () => { if (simulation.q3Guest()?.isRetired !== false || local.player.seat.client.isClosed) throw new Error("Guest presentation world is retired"); },
        clientState: () => ({ phase: 8, connectPacketCount: 0, clientNumber: state.clientNumber, serverName: "localhost", message: "" }),
        viewport: () => { const size = renderer.window.drawableSize; return seatViewport(local.player.seat.id.index, this.options.seats, size.width, size.height); },
        now: () => performance.now(), commands: {
          reliable: text => { const [name, ...args] = tokenizeCommand(text, "q3").argv; if (name !== undefined)
            this.queueLocalGuestCommand(localGuest, { target: "client", name, arguments_: args, seat: local.player.seat.id }); },
          console: text => input.enqueueClientCommand(text, { session: this.session.session, origin: { kind: "script", name: "q3-cgame", caller: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } } }),
          print: text => { this.host.print(text); local.console.print(text); },
        } });
      seat.client = client;
      return { kind: "qvm", client, state };
    }
    const source = simulation.q3Source(); if (source === null) return null;
    const prediction = createSimulationPredictionHost(simulation, local.player.actor, local.player.seat.id);
    const initial = source.sourceState(); prediction.captureSource(initial);
    const client = await ApplicationQ3Client.create({ saveFontData: () => (input.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0, weaponHud: () => { const ui = simulation.playerUi(local.player.actor); return { status: ui.weaponStatus, warning: ui.arsenalWarning }; }, assets, queries: simulation.scene, initial, local, audio, movement: prediction,
      commandRegistration: input.clientCommandRegistration(local.player.seat.id),
      splitScreen: this.options.seats > 1,
      timeCvars: source.host.cvars,
      ...(cvars === undefined ? {} : { cvars }),
      ...(settings === undefined ? {} : { settings }), predictionCommand: (command, time) => prediction.submit(command, time),
      linkBounds: number => source.world.linkState(number)?.absbounds ?? null,
      sourceActor: number => { const record = source.records.get(number); return record?.inuse ? record.actor.id : null; },
      serverSettings: () => source.host.cvars.snapshots().filter(variable => source.settings.definitions.some(definition => definition.name === variable.name)),
      viewport: () => { const size = renderer.window.drawableSize; return seatViewport(local.player.seat.id.index, this.options.seats, size.width, size.height); },
      now: () => performance.now(), commands: {
        reliable: text => input.enqueueClientReliable(text, { session: this.session.session, origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } }, (text, source) => {
          const [name, ...args] = tokenizeCommand(text, "q3").argv;
          if (name !== undefined) this.requestedCommands.push({ target: "client", name, arguments_: args, seat: local.player.seat.id, source });
        }),
        console: text => input.enqueueClientCommand(text, { session: this.session.session, origin: { kind: "script", name: "q3-cgame", caller: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } } }),
        print: text => { this.host.print(text); local.console.print(text); },
      } });
    return { kind: "native", client, prediction };
  }

  private requestRestoredScores(): void {
    for (const source of this.graphical?.q3.values() ?? []) source.client.options.commands.reliable("score");
  }

  requestQuit(): undefined { this.stopping = true; return undefined; }

  queueCommand(name: string, arguments_: readonly string[], seat: SeatId | null, source?: CommandContext): undefined {
    this.requestedCommands.push({ target: "application", name, arguments_: [...arguments_], seat, ...(source === undefined ? {} : { source }) });
    return undefined;
  }

  private prepareSavedClients(slots: readonly number[], botClients: readonly SavedBotClientId[]): SavedApplicationClients {
    const previousBots = new Map((this.bots?.clients() ?? []).map(bot => [bot.client.id.slot, bot.client]));
    const savedBots = new Map(botClients.map(client => [client.slot, client]));
    const humanClients = this.simulation.clientIdentities().filter(client => previousBots.get(client.slot)?.id.equals(client) !== true);
    const humanSlots = slots.filter(slot => !savedBots.has(slot));
    if (humanClients.length !== humanSlots.length || humanClients.some(client => !humanSlots.includes(client.slot)))
      throw new Error("Saved human players do not match the connected session client slots");
    for (const client of this.localSeats.keys()) {
      if (savedBots.has(client.slot) || !humanClients.some(current => current.equals(client)))
        throw new Error("Saved bot slots conflict with a local seat");
    }
    const added: SessionClient[] = [], restoredBots = new Map<number, SessionClient>();
    try {
      for (const saved of botClients) {
        const existing = previousBots.get(saved.slot);
        if (existing?.isClosed) throw new Error("Current bot client is closed");
        const client = existing ?? this.session.prepareClient(saved.slot);
        if (existing === undefined) added.push(client);
        restoredBots.set(saved.slot, client);
      }
      const clients = slots.map(slot => {
        const client = restoredBots.get(slot)?.id ?? humanClients.find(client => client.slot === slot);
        if (client === undefined) throw new Error("Saved client slot has no restored session identity");
        return client;
      });
      return { clients, added, removed: [...previousBots.values()].filter(client => !savedBots.has(client.id.slot)),
        resolveBotClient: saved => savedBots.get(saved.slot)?.generation === saved.generation ? restoredBots.get(saved.slot) ?? null : null };
    } catch (error) {
      const failures: unknown[] = [error];
      for (const client of added) { try { client.close(); } catch (failure) { failures.push(failure); } }
      if (failures.length > 1) throw new AggregateError(failures, "Saved client preparation failed");
      throw error;
    }
  }

  private async replaceWorld(map: string, carry: SimulationTravel | null, initialSourceMilliseconds = 0, save?: SaveImage, skirmish?: TeamArenaSkirmish): Promise<void> {
    if (this.campaignMovie !== null) throw new Error("Finish or skip the campaign cinematic before changing worlds");
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    this.worldOperation = "travel";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try {
      try { await serviceLoading(() => this.prepareAndReplaceWorld(map, carry, initialSourceMilliseconds, save, skirmish), () => {
        if (!this.closed) this.graphical?.input.pollLoadingEvents();
      }); }
      finally {
        this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve();
        if (!this.closed) this.resumeInput();
      }
    } catch (error) {
      if (this.fatalWorldFailure && !this.stepping) await this.closeFailedWorld(error);
      throw error;
    }
    if (save === undefined) await this.autosaveLevel();
  }

  private async prepareAndReplaceWorld(map: string, carry: SimulationTravel | null, initialSourceMilliseconds = 0, save?: SaveImage, skirmish?: TeamArenaSkirmish): Promise<void> {
    if (save === undefined && this.simulation.q3Guest() !== null) throw new Error("Q3 guest map changes and restart are unsupported");
    if (save !== undefined && this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
    if (save === undefined && carry === null && this.simulation.quakecSource()?.kind === "quakeworld") carry = this.simulation.captureTravel();
    const settings = save === undefined ? null : savedSimulationSettings(save);
    const savedBots = save === undefined ? null : savedBotCheckpoint(save);
    let options = { ...this.options, map: mapResourcePath(map),
      ...(skirmish === undefined ? {} : { teamArenaSkirmish: skirmish, characterModel: skirmish.playerModel }),
      ...(settings === null ? {} : { skill: settings.skill, mode: settings.mode, seed: settings.seed }) };
    if (save !== undefined) { const { teamArenaSkirmish, ...restoredOptions } = options; options = restoredOptions; }
    let recipe: ExecutableRecipe;
    if (save !== undefined) recipe = save.recipe;
    else if (skirmish !== undefined) {
      const preset = applicationPreset(this.content.catalog, options, { movement: this.content.recipe.movement, character: this.content.recipe.character.definition });
      recipe = await resolveLaunch({ catalog: this.content.catalog, preset, choice: presetChoice(preset.id) });
    } else recipe = await resolveApplicationTravel(this.content, options.map);
    if (save !== undefined && recipe.execution.some(module => module.kind === "qvm" && module.role === "server-game")) {
      const { botSkill, ...savedOptions } = options;
      options = savedOptions;
    }
    const content = await loadApplicationContent(options, recipe);
    const previousContent = this.content, previous = this.graphical, previousSimulation = this.simulation, previousLocalGuest = this.localGuest;
    const previousOptions = this.options, previousClientCvars = this.clientCvars, previousOverrides = this.teamArenaOverrides;
    let nextOverrides = previousOverrides;
    const sameClientOwner = content.recipe.engineBehavior.content === previousContent.recipe.engineBehavior.content
      && content.recipe.engineBehavior.provider === previousContent.recipe.engineBehavior.provider;
    const sameSourceOwner = content.recipe.map.entities.content === previousContent.recipe.map.entities.content
      && content.recipe.map.entities.provider === previousContent.recipe.map.entities.provider;
    const frontendOverrides = this.frontendSettings;
    const q3 = this.simulation.q3Source();
    const previousBotClients = this.bots?.clients() ?? [];
    const preserveBots = skirmish === undefined && (initialSourceMilliseconds !== 0 || q3?.gameType !== 2);
    const botClients = preserveBots ? previousBotClients : [];
    const previousBots = this.bots;
    const currentSource = this.sourceCvars();
    const nextRules = save === undefined && skirmish === undefined && sameSourceOwner && currentSource !== null
      ? resolveStartupRules(options, currentSource, this.simulation.options.maxClients, [], false) : null;
    if (nextRules !== null) options = nextRules.options;
    const q3Session = q3?.captureSession();
    const serverProfile = this.simulation.serverProfile();
    const previousQ1Cvars = this.simulation.q1Source()?.cvars;
    const q1CvarsSource = save === undefined && content.world.kind === "q1-bsp" && content.preparedQuakeC === null ? previousQ1Cvars : undefined;
    const sourceArchive = this.sourceCvars()?.archiveEntries() ?? [];
    const q2Cvars = this.simulation.q2ServerCvars()?.snapshots().map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value }));
    const q3Cvars = q3?.host.cvars.snapshots().filter(variable => variable.name !== "sv_mapname" && variable.name !== "mapname")
      .map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value }));
    let simulation: SharedSimulation | null = null, assets: ApplicationAssets | null = null, art: NativeUiArt | null = null;
    let nextBots: ApplicationBots | null = null;
    let nextLocalGuest: LocalQ3GuestWorld | null = null;
    const previousGuestBrowser = this.guestBrowser;
    let nextGuestBrowser = previousGuestBrowser;
    let savedClients: SavedApplicationClients | null = null;
    let nextAudio: ApplicationAudio | null = null;
    let nextEffects: ApplicationEffects | null = null;
    let nextInput: ApplicationInput | null = null;
    let nextScripts: ConsoleScriptFiles | null = null;
    let retiredScripts: ConsoleScriptFiles | null = null;
    let committed = false;
    let nextGraphical: GraphicalApplication | null = null;
    const nextClientCvars = new Map<SeatId, CvarRegistry>();
    const stagedPresentations: WorldSeatPresentation[] = [];
    const stagedClients: ApplicationQ3Client[] = [];
    let stagedCapture: ApplicationCapture | null = null;
    let candidateImages: ReturnType<ApplicationImageSettings["prepareClientSettings"]> | null = null;
    try {
      candidateImages = previous === null ? null : this.imageSettings?.prepareClientSettings() ?? null;
      const q1SourceRegistry = q1CvarsSource === undefined ? undefined : cloneQ1SourceCvars(q1CvarsSource, text => this.host.print(text));
      if (save !== undefined) nextOverrides = readTeamArenaOverrides(save, [...this.localSeats.values()].map(seat => ({ seat: seat.id.index, client: seat.client.id.slot })));
      if (settings !== null) {
        options = applicationOptionsForRecipe(options, content);
        initialSourceMilliseconds = settings.hostMilliseconds;
      }
      if (settings !== null) savedClients = this.prepareSavedClients(settings.clientSlots, savedBots?.transport.connections.map(connection => connection.client) ?? []);
      const clients = savedClients?.clients ?? this.simulation.clientIdentities().filter(client => preserveBots || !previousBotClients.some(bot => bot.client.id.equals(client)));
      let candidatePublished = false;
      let candidateCommands: CommandBuffer | null = null;
      const candidateActions: ApplicationCommandRequest[] = [];
      const candidateAction = (request: ApplicationCommandRequest): undefined => {
        if (candidatePublished) this.requestedCommands.push(request); else candidateActions.push(request);
        return undefined;
      };
      const guestCommands = (): CommandBuffer => {
        const commands = candidatePublished ? this.sourceCommands : candidateCommands;
        if (commands === null) throw new Error("Q3 guest candidate console is unavailable");
        return commands;
      };
      const monsterNavigation = await preloadApplicationMonsterNavigation(content);
      const continueQ3Clock = save === undefined && q3 !== null && content.recipe.map.entities.provider.startsWith("q3:")
        && !content.recipe.execution.some(module => module.kind === "qvm" && module.role === "server-game");
      const destinationSourceMilliseconds = continueQ3Clock && q3 !== null ? q3.host.now() : initialSourceMilliseconds;
      simulation = createSimulation({ dedicated: options.dedicated, ...Application.guestOptions(content, options, this.host, guestCommands), ...(content.preparedQuakeC === null ? {} : { preparedQuakeC: content.preparedQuakeC }), ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity: this.identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: options.skill, mode: options.mode, seed: options.seed, maxClients: settings?.maxClients ?? skirmish?.maxClients ?? nextRules?.maxClients ?? this.simulation.options.maxClients,
        promptSupported: client => !options.dedicated && this.localSeats.has(client),
        playerIdentity: client => ({ seat: this.localSeats.get(client)?.id.index ?? 0, socialId: "" }),
        ...(save === undefined ? { ...(skirmish === undefined ? { serverProfile } : {}), sourceArchive, ...(q1SourceRegistry === undefined ? {} : { sourceRegistry: q1SourceRegistry }), ...(q2Cvars === undefined ? {} : { q2Cvars }), ...(carry === null ? {} : { travel: carry }), ...(q3Session === undefined || skirmish !== undefined ? {} : { q3Session }),
          ...(continueQ3Clock || q3Session !== undefined && skirmish === undefined ? { initialSourceMilliseconds: destinationSourceMilliseconds } : {}),
          ...(q3Cvars === undefined ? {} : { q3Cvars: [...q3Cvars, ...(skirmish === undefined ? [] : teamArenaSourceCvars(skirmish, q3Cvars))] }) } : { restore: save, restoredClients: clients }) });
      const nextSimulation = simulation;
      if (save !== undefined && nextSimulation.q3Source() !== null && savedBots === null) throw new Error("Q3 application restoration requires saved bot service state");
      if (previous !== null && nextSimulation.q3Guest() === null) for (const local of previous.input.locals) {
        const seat = local.player.seat;
        const cvars = this.createClientCvars(nextSimulation, content, options, seat,
          save === undefined ? null : nextSimulation.q3Source()?.host.engine.getUserinfo(seat.client.id.slot) ?? null,
          sameClientOwner ? previousClientCvars.get(seat.id) : undefined, sameClientOwner ? [] : await this.loadClientArchive(seat, content, options), skirmish !== undefined);
        nextClientCvars.set(seat.id, cvars);
        if (save === undefined) nextSimulation.q3Source()?.host.engine.setUserinfo(seat.client.id.slot, `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`);
      }
      if (previous !== null && nextSimulation.q3Guest() === null) {
        if (save !== undefined) applyTeamArenaOverrides(nextOverrides, this.overrideSeats(nextClientCvars));
        else if (skirmish !== undefined) nextOverrides = captureTeamArenaOverrides(this.overrideSeats(nextClientCvars));
        else if (!sameClientOwner || nextSimulation.q3Source() === null) nextOverrides = null;
      }
      const admissions = nextSimulation.q3Guest() !== null || nextSimulation.quakecSource()?.kind === "quakeworld" ? new Map<number, ActorId>() : new Map(clients.filter(client => !botClients.some(bot => bot.client.id.equals(client))).map(client => {
        if (save === undefined) return [client.slot, nextSimulation.admitPlayer(client).actor];
        const actor = nextSimulation.players().find(actor => nextSimulation.movementPlayer(actor)?.client.equals(client));
        if (actor === undefined) throw new Error(`Restore did not bind client ${client.slot}`);
        return [client.slot, actor];
      }));
      const nextNetworkHost = this.network === null ? null : await this.networkHost(simulation, content, this.nativeWorldCount + 1);
      if (nextNetworkHost !== null) this.validateNetworkHost(nextNetworkHost);
      const preparedCommands = await this.prepareSourceCommands(nextSimulation, content, save !== undefined, candidateAction);
      candidateCommands = preparedCommands.commands;
      const restoredGuest = nextSimulation.q3Guest();
      if (save !== undefined && restoredGuest !== null) {
        if (previous !== null) {
          const authority = createQ3ApplicationServerHost({ session: this.session, simulation: nextSimulation, content,
            print: text => this.host.print(text), mode: "restore" });
          nextLocalGuest = { worldSound: createIdentityOwner("local-qvm-world-audio").actor(1022, 0), authority,
            seats: new Map<SeatId, LocalQ3GuestSeat>(), pendingCommands: [] };
          const serverId = restoredGuest.state.cvars.variableValue("sv_serverid");
          await authority.prepare(0, serverId);
          for (const local of previous.input.locals) {
            const seat = local.player.seat;
            admissions.set(seat.client.id.slot, this.prepareRestoredGuestSeat(nextLocalGuest, nextSimulation, seat, content, options,
              sameClientOwner ? previousClientCvars.get(seat.id) : undefined, sameClientOwner ? [] : await this.loadClientArchive(seat, content, options)));
          }
          for (const [seat, local] of nextLocalGuest.seats) nextClientCvars.set(seat, local.cvars);
          this.publishLocalGuestSnapshots(nextLocalGuest, nextSimulation);
          nextGuestBrowser ??= await this.openGuestBrowser();
        }
        restoredGuest.completeRestore(this.guestOutput(nextLocalGuest));
      }
      if (save === undefined) nextBots = await this.createBots(content, simulation, {
        clients: botClients, restart: initialSourceMilliseconds !== 0, commands: { insert: text => guestCommands().insert(text) } });
      else if (savedBots !== null && savedClients !== null) nextBots = await this.createBots(content, simulation, {
        commands: { insert: text => guestCommands().insert(text) }, restore: { image: savedBots, resolveClient: savedClients.resolveBotClient } });
      if (previous !== null) {
        assets = new ApplicationAssets(content, previous.renderer.owner, undefined, { imageRegistry: previous.renderer.images,
          ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
        await assets.loadWorld();
        const font = await assets.loadConsoleFont(), typography = await assets.loadMenuTypography(), fontSource = font.classic.picture.image.source;
        if (fontSource.kind !== "resource") throw new Error("Native menu font has no mounted resource identity");
        art = await loadNativeUiArt(fontSource.resource.id, assets.images, loadMenuArtImage);
        const characters = options.character === "q3" ? await loadQ3Character(await content.forContent(content.recipe.character.appearance.content),
          { model: options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
        const players = previous.input.locals.map(local => {
          const player = admissions.get(local.player.seat.client.id.slot);
          if (player === undefined) throw new Error("Travel admission is missing a connected local player");
          return { seat: local.player.seat, actor: player };
        });
        const seatInputPreferences = new Map(previous.input.locals.map(local => [local.player.seat.id, readFrontendInput(local)]));
        const preferences = previous.presentations.map(presentation => presentation.ui.preferences.values);
        await saveAudioSettings(this.inputConfig, previous.audio);
        await previous.input.saveSettings();
        nextScripts = Application.sourceScripts(content, options, this.inputConfig);
        const input = await ApplicationInput.open(previous.renderer.window, players, options, movementDialect(options, simulation.recipe), simulation,
          { ...this.inputActions(simulation, content, preparedCommands.q2Console, nextLocalGuest, nextClientCvars, candidateImages?.settings.cvars, candidateAction), scripts: nextScripts }, () => performance.now(), this.inputConfig, undefined, previous.input);
        nextInput = input;
        this.restoreQ3InputAngles(input, nextSimulation);
        input.resumeCommands(Math.max(previous.input.nextCommandSequence,
          ...players.map(player => (nextSimulation.movementPlayer(player.actor)?.lastSequence ?? -1) + 1)));
        const audio = new ApplicationAudio(content, () => this.elapsed, options.seed, options.characterModel, text => this.host.print(text),
          { ...await loadAudioSettings(this.inputConfig), musicControls: this.musicControls, deferOutput: true });
        audio.bindHaptics(input);
        nextAudio = audio;
        await audio.prepareEnvironment(nextSimulation.scene);
        const effects = new ApplicationEffects(assets, nextSimulation.scene, actor => nextSimulation.players().some(player => player.equals(actor)), options.seed);
        nextEffects = effects;
        for (const failure of await effects.preloadTransientResources()) this.host.print(`Optional effect preload skipped: ${failure.content}/${failure.path}: ${failure.error}\n`);
        await prepareApplicationResources({ content: assets.content, simulation: nextSimulation, audio, effects,
          progress: message => this.host.loading?.stage(message), print: message => this.host.print(message) });
        audio.effectsVolume = previous.audio.effectsVolume;
        audio.musicVolume = previous.audio.musicVolume;
        if (candidateImages !== null) audio.bindVolumeCvars(candidateImages.settings.cvars);
        if (input !== previous.input) {
          applyFrontendPreferences(frontendOverrides, input, audio);
          for (const local of input.locals) {
            const previousSettings = seatInputPreferences.get(local.player.seat.id);
            if (previousSettings !== undefined) applyFrontendInput(previousSettings, local);
          }
        }
        const current = simulation, worldAssets = assets, menuArt = art;
        const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor, language: previous.rerelease.selectedLanguage(player.seat.id) })));
        const presentations: WorldSeatPresentation[] = [], q3Clients = new Map<SeatId, Q3SeatClient>();
        for (const [index, local] of input.locals.entries()) {
          const sourceClient = await this.createQ3SeatClient(local, worldAssets, audio, input, previous.renderer, current, undefined, nextLocalGuest, nextGuestBrowser, nextClientCvars.get(local.player.seat.id));
          if (sourceClient !== null) { stagedClients.push(sourceClient.client); q3Clients.set(local.player.seat.id, sourceClient); }
          if (this.viewSettings.override !== null) {
            if (sourceClient?.kind !== "qvm") current.setPlayerFieldOfView(local.player.actor, this.viewSettings.fieldOfView, save === undefined ? "change" : "restore");
            sourceClient?.client.cvars.set("cg_fov", String(this.viewSettings.fieldOfView));
          }
          if (sourceClient?.kind === "qvm") await sourceClient.client.prepare(this.frames);
          const ui = new ApplicationSeatUi(local, menuArt, input, current, font, audio, () => this.requestQuit(),
            (name, args) => this.queueCommand(name, args, local.player.seat.id), typography, { bindings: () => current.serverSettings(), store: this.serverProfileStore },
            await rerelease.languageBinding(local.player.seat.id, content.recipe.map.entities.content, error => local.console.print(`Language reload failed: ${String(error)}\n`)), this.saveMenu(current, options), this.viewSettings.binding(), this.host.llm, sourceClient?.kind === "qvm", this.teamArenaResults(current, local.player.seat));
          const preference = preferences[index]; if (preference !== undefined) ui.preferences.values = preference;
          const presentation = new WorldSeatPresentation(local, worldAssets, previous.renderer, current, options.seats, font, characters, ui, effects, sourceClient?.client ?? null, rerelease, () => this.imageSettings?.cvars.variableValue("gl_debug_distfrac") ?? 0.004, () => this.viewSettings.fieldOfView, { lines: () => current.debugLines(), lineWidth: () => this.imageSettings?.debugLineWidth ?? 2 }, () => this.imageSettings?.cvars.variableValue("con_scale") ?? 0, () => readQ1ViewSettings(this.imageSettings?.cvars ?? null, this.sourceDialect(content)));
          stagedPresentations.push(presentation);
          presentations.push(presentation);
        }
        nextGraphical = { renderer: previous.renderer, input, audio, effects, art, assets, presentations, q3: q3Clients, rerelease };
      }
      const previousCapture = this.capture;
      const nextCapture = nextGraphical === null ? null : this.ownership.kind === "borrowed" ? this.ownership.client.capture
        : new ApplicationCapture(inputCaptureServices(nextGraphical.input, applicationCaptureRoot(options.userContentRoot),
          () => this.options.map, text => this.host.print(text)), nextGraphical.renderer);
      stagedCapture = this.ownership.kind === "owned" ? nextCapture : null;
      await this.capture?.beforeWorldChange();
      const publishAudio = previous !== null && nextGraphical !== null ? previous.audio.prepareOutputTransfer(nextGraphical.audio) : null;
      if (this.closed) throw new Error("Application closed during world preparation");
      const replacementPresentations = stagedPresentations.map(presentation => ({
        seat: presentation.local.player.seat, presentation, cleanup: () => presentation.close(),
      }));
      const replacementClients = savedClients ?? { added: [], removed: [] };
      const retirementErrors: { readonly label: string; readonly error: unknown }[] = [];
      const retire = async (label: string, close: () => unknown): Promise<void> => {
        try { await close(); } catch (error) { retirementErrors.push({ label, error }); }
      };
      const retirePrevious = async (retired: ReturnType<EngineSession["replaceWorld"]>["retired"]): Promise<void> => {
        if (this.archivePersistence && !this.preparedStartup?.pending && !sameSourceOwner) await retire("previous source archive", () => this.saveSourceArchive(previousOptions, previousContent, previousSimulation, previousOverrides));
        if (this.archivePersistence && !this.preparedStartup?.pending && !sameClientOwner) await retire("previous client archives", () => this.saveClientArchives(previousOptions, previousContent, previousClientCvars, previousOverrides));
        if (this.ownership.kind === "owned") await retire("capture retirement", () => previousCapture?.close());
        await retire("bot retirement", () => previousBots?.close(initialSourceMilliseconds !== 0));
        for (const { state } of previousLocalGuest?.seats.values() ?? []) await retire("guest seat retirement", () => state.retire());
        previousLocalGuest?.seats.clear();
        for (const source of previous?.q3.values() ?? []) if (source.kind === "qvm")
          await retire("guest client retirement", () => source.client.close());
        await retire("guest shutdown", () => previousSimulation.shutdownQ3Guest());
        await retire("world retirement", () => retired.close());
        if (save === undefined && !preserveBots) for (const bot of previousBotClients)
          await retire("bot disconnect", () => this.session.closeClient(bot.client.id));
        if (previous !== null) {
          await retire("audio retirement", () => previous.audio.close());
          await retire("effects retirement", () => previous.effects.close());
          await retire("art retirement", () => previous.art.close());
          await retire("asset retirement", () => previous.assets.close());
          await retire("input retirement", () => previous.input.close());
          await retire("renderer resource retirement", () => previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.frames,
            commands: previous.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) }));
        }
        await retire("content retirement", () => previousContent.close());
      };
      const adoptHeadless = (() => {
        const prepared = this.preparedStartup;
        if (nextGraphical !== null || prepared === null) return () => {};
        const scripts = new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings: this.inputConfig,
          mounted: name => content.mounts.open(name).then(resource => resource?.bytes) });
        const source = this.sourceCvars(nextSimulation);
        if (source === null) throw new Error("Prepared authority requires a source registry");
        const dialect = movementDialect(options, content.recipe);
        const movement = prepared.movement.dialect === dialect ? prepared.movement
          : new CvarRegistry({ dialect, context: source.context, print: text => this.host.print(text) });
        const routing = new ApplicationConsoleRouting({ fallback: source, sourceDialect: () => source.dialect,
          server: () => ({ cvars: source, sharedNames: [] }), seat: () => source, input: () => movement });
        const owners = { source, movement, fallback: source, scripts, read: Application.startupScriptReader(content, options, scripts) };
        prepared.validateOwners(owners);
        return () => prepared.adopt(routing, (name, args, context) => {
          let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
          return this.queueCommand(name, args, origin.kind === "local-seat" ? origin.seat : null, context);
        }, owners);
      })();
      if (preparedCommands.options === null) throw new Error("Published world requires source command bindings");
      this.sourceCommands?.validateProfile(preparedCommands.options.dialect, undefined);
      preparedCommands.program?.validatePublication();
      nextGraphical?.input.validateStartupAdoption();
      nextGraphical?.input.validateCandidateCommands();
      candidateImages?.validatePublication();
      this.session.validateWorldReplacement(nextSimulation, replacementPresentations, replacementClients);
      if (previous !== null && nextGraphical !== null) nextGraphical.input.releaseIntoCandidate(previous.input);
      const replacement = this.session.replaceWorld(nextSimulation, replacementPresentations, replacementClients);
      committed = true;
      this.worldSimulation = nextSimulation;
      this.loadedContent = content;
      this.launchOptions = options;
      this.bots = nextBots;
      this.graphical = nextGraphical;
      this.clientCvars = nextClientCvars;
      this.teamArenaOverrides = nextOverrides;
      this.localGuest = nextLocalGuest;
      this.guestBrowser = nextGuestBrowser;
      this.frontendOverrides = frontendOverrides;
      this.capture = nextCapture;
      this.elapsed = destinationSourceMilliseconds;
      this.sourceEvents = []; this.roundPresentationEvents = []; this.localSnapshotServerBit = 0;
      this.clientInputs = [];
      this.unhandledEffects = [];
      this.reportedEffectGaps.clear();
      try {
        this.publishSourceCommands(preparedCommands);
        preparedCommands.program?.publish();
        candidatePublished = true;
        candidateCommands = null;
        this.requestedCommands.push(...candidateActions.splice(0));
        nextGraphical?.input.publishCandidateCommands();
        if (candidateImages !== null && this.imageSettings !== null) {
          const fovChanged = candidateImages.settings.cvars.variableString("fov") !== this.imageSettings.cvars.variableString("fov");
          this.releaseViewCvars?.(); this.releaseViewCvars = null;
          candidateImages.publish();
          nextGraphical?.input.publishSharedCvars(this.imageSettings.cvars);
          nextGraphical?.audio.bindVolumeCvars(this.imageSettings.cvars);
          if (fovChanged) this.viewSettings.setFieldOfView(Number(this.imageSettings.cvars.variableString("fov")));
          this.releaseViewCvars = this.viewSettings.bindCvars(this.imageSettings.cvars);
        }
        if (this.ownership.kind === "borrowed" && nextGraphical !== null)
          nextGraphical.input.publishClientSeats(this.ownership.client, "replace");
        if (previous !== null && nextGraphical !== null) previous.input.transferPlatformTo(nextGraphical.input);
        else nextGraphical?.input.adoptStartup();
        if (nextScripts !== null) {
          if (this.ownership.kind === "borrowed") {
            retiredScripts = this.ownership.client.configuration.current.scripts;
            this.ownership.client.configuration.current = { scripts: nextScripts, options };
          } else {
            retiredScripts = this.configurationScripts;
            this.configurationScripts = nextScripts;
          }
          nextScripts = null;
        }
        publishAudio?.();
        if (this.ownership.kind === "borrowed" && nextGraphical !== null) {
          this.ownership.client.platform.current = { kind: "world", input: nextGraphical.input };
          this.ownership.client.output.current = nextGraphical.audio.engine;
          this.ownership.client.sourceProfile.current = content.recipe.map.entities;
        }
        adoptHeadless();
        this.enableStartupPersistence();
        if (nextLocalGuest !== null) this.requestedCommands.push(...nextLocalGuest.pendingCommands.splice(0));
        if (options.dedicated) this.dedicatedCommands = this.sourceCommands;
        if (save !== undefined) this.requestRestoredScores();
      } finally {
        await retirePrevious(replacement.retired);
        await retire("configuration retirement", () => retiredScripts?.close());
        await retire("unpublished configuration retirement", () => nextScripts?.close());
        if (this.ownership.kind === "owned") nextCapture?.activate();
      }
      if (nextGraphical !== null) {
        this.frontendBaseline = readFrontendPreferences(nextGraphical.input, nextGraphical.audio);
        const graphical = nextGraphical;
        if (graphical.q3.size === 0) await retire("world music", () => graphical.audio.startWorldMusic());
      }
      if (nextNetworkHost !== null) await retire("network publication", () => this.changeNetworkWorld(nextNetworkHost));
      if (skirmish !== undefined) this.startTeamArenaSkirmish(skirmish);
      for (const failure of retirementErrors) this.host.print(`Entered world; ${failure.label} failed: ${String(failure.error)}\n`);
      this.host.print(`Entered ${content.recipe.map.geometry.requestedPath}.\n`);
    } catch (error) {
      if (committed) { this.fatalWorldFailure = true; this.closed = true; this.stopping = true; throw error; }
      const errors: unknown[] = [error];
      const discard = async (close: () => unknown): Promise<void> => { try { await close(); } catch (failure) { errors.push(failure); } };
      await discard(() => stagedCapture?.close());
      for (const client of stagedClients) await discard(() => client.close());
      for (const { state } of nextLocalGuest?.seats.values() ?? []) state.retire();
      nextLocalGuest?.seats.clear();
      if (nextGuestBrowser !== null && nextGuestBrowser !== previousGuestBrowser) {
        const browser = nextGuestBrowser;
        await discard(() => browser.view.close());
        await discard(() => browser.host.close());
      }
      for (const presentation of stagedPresentations) await discard(() => presentation.close());
      await discard(() => nextAudio?.close());
      await discard(() => nextEffects?.close());
      await discard(() => nextInput?.close());
      await discard(() => nextScripts?.close());
      await discard(() => nextBots?.close());
      await discard(() => simulation?.q3Guest()?.discard());
      await discard(() => simulation?.close());
      for (const client of savedClients?.added ?? []) await discard(() => client.close());
      await discard(() => art?.close());
      await discard(() => assets?.close());
      if (previous !== null) await discard(() => previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.frames, commands: [] }));
      await discard(() => content.close());
      if (errors.length > 1) throw new AggregateError(errors, "World preparation failed");
      throw error;
    }
  }

  async changeLevel(map: string, spawnPoint = ""): Promise<void> {
    if (this.closed || this.stepping) throw new Error("World travel requires an idle open application");
    await this.replaceWorld(map, this.simulation.q3Source() === null ? this.simulation.captureTravel(spawnPoint) : null);
  }

  async saveGame(path: string): Promise<void> {
    if (this.closed) throw new Error("Application is closed");
    if (this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    if (this.campaignMovie !== null || this.pendingTeamArena !== null || this.pendingMap !== null || this.pendingRestart !== null || this.pendingTransition !== null || this.pendingSave !== null)
      throw new Error("Saving requires pending world travel or restoration to finish");
    const image = saveTeamArenaOverrides(this.simulation.checkpoint(), this.teamArenaOverrides, this.overrideSeats());
    this.worldOperation = "saving";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try { await writeSaveImage(path, image); }
    finally { this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve(); this.resumeInput(); }
  }

  async loadGame(path: string): Promise<void> {
    if (this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
    if (this.closed || this.stepping) throw new Error("Save restoration requires an idle open application");
    await this.restoreSavedGame(path);
  }

  private async restoreSavedGame(path: string): Promise<void> {
    if (this.campaignMovie !== null) throw new Error("Finish or skip the campaign cinematic before loading a save");
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    this.worldOperation = "loading";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try {
      try {
        await serviceLoading(async () => {
          const image = await readSaveImage(path);
          await this.prepareAndReplaceWorld(image.recipe.map.geometry.requestedPath, null, 0, image);
        }, () => { if (!this.closed) this.graphical?.input.pollLoadingEvents(); });
        this.pendingTeamArena = null; this.pendingMap = null; this.pendingRestart = null; this.pendingTransition = null; this.pendingSave = null;
      } finally {
        this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve();
        if (!this.closed) this.resumeInput();
      }
    } catch (error) {
      if (this.fatalWorldFailure && !this.stepping) await this.closeFailedWorld(error);
      throw error;
    }
  }

  private async restartSourceRound(): Promise<boolean> {
    const simulation = this.simulation, graphical = this.graphical, network = this.network;
    if (simulation.sourceRestartPlan().kind !== "source-reset" || network !== null && network.kind !== "q3"
      || this.campaignMovie !== null || this.localGuest !== null) return false;
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    const snapshot = this.session.snapshot, oldSource = simulation.q3Source();
    if (snapshot === null || oldSource === null) return false;
    const serverId = oldSource.host.cvars.variableValue("sv_serverid");
    if (network === null && (!Number.isInteger(serverId) || serverId < 0 || serverId >= 0x7fffffff))
      throw new Error("Local Q3 server id exhausted");
    const clients = [...simulation.clientIdentities()].sort((left, right) => left.slot - right.slot);
    for (const local of graphical?.input.locals ?? []) {
      if (local.player.seat.isClosed || local.player.seat.client.isClosed
        || !clients.some(client => client.equals(local.player.seat.client.id)))
        throw new Error("Round restart has no live local client");
      const presentation = graphical?.q3.get(local.player.seat.id);
      if (presentation?.kind !== "native") return false;
      presentation.client.assertCanRestartRound();
    }
    this.worldOperation = "travel";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    let mutated = false;
    try {
      for (;;) {
        const oldEvents = simulation.drainPresentationEvents();
        if (oldEvents.length === 0) break;
        for (const presentation of graphical?.q3.values() ?? []) presentation.client.receiveEvents(oldEvents);
        for (const presentation of graphical?.presentations ?? []) presentation.sourceEvents(oldEvents);
        this.bots?.receive(oldEvents);
        await network?.server.publish({ snapshot, events: [] }, oldEvents, performance.now());
        await this.sourceActions(oldEvents);
      }
      if (this.closed) throw new Error("Application closed before round restart");
      if (this.stopping) return true;
      const clients = [...simulation.clientIdentities()].sort((left, right) => left.slot - right.slot);
      for (const local of graphical?.input.locals ?? []) {
        if (local.player.seat.isClosed || local.player.seat.client.isClosed
          || !clients.some(client => client.equals(local.player.seat.client.id)))
          throw new Error("Round restart lost a local client during old event delivery");
        const presentation = graphical?.q3.get(local.player.seat.id);
        if (presentation?.kind !== "native") throw new Error("Round restart lost its local cgame during old event delivery");
        presentation.client.assertCanRestartRound();
      }
      if (simulation.sourceRestartPlan().kind !== "source-reset") return false;
      const restart = async (round: Q3NetworkRoundRestart | null): Promise<void> => {
        mutated = true; this.lastRestartFrame = this.frames;
        const epochEvents = simulation.drainPresentationEvents();
        graphical?.effects.resetRound(); graphical?.audio.resetRound();
        this.bots?.beginRoundRestart();
        if (network === null) oldSource.host.cvars.set("sv_serverid", String(serverId + 1), true);
        simulation.restartSourceRound();
        simulation.beginSourceRoundSettlement();
        this.bots?.bindRestartedRound();
        await round?.bindSource();
        const source = simulation.q3Source();
        if (source === null) throw new Error("Round restart lost its native source");
        const bit = this.localSnapshotServerBit === 0 ? 4 : 0;
        const deliver = async (initial: readonly SimulationPresentationEvent[] = []): Promise<void> => {
          let pending = initial;
          for (;;) {
            const events = pending.length === 0 ? simulation.drainPresentationEvents() : pending; pending = [];
            if (events.length === 0) break;
            for (const presentation of graphical?.q3.values() ?? []) presentation.client.receiveEvents(events);
            this.bots?.receive(events);
            await round?.receiveEvents(events);
            await this.sourceActions(events);
            this.roundPresentationEvents.push(...events);
          }
          if (this.closed) throw new Error("Application closed during round restart");
        };
        const settle = async (): Promise<SimulationOutput> => {
          const output = await this.session.stepAsync({ elapsedMilliseconds: 100, commands: [] });
          this.elapsed += 100;
          this.lastOutput = { simulation, output };
          await deliver();
          return output;
        };
        await deliver(epochEvents);
        for (let frame = 0; frame < 3; frame++) await settle();
        const players: LocalPlayer[] = [];
        for (const client of clients) {
          if (await round?.reconnectClient(client)) { await deliver(); continue; }
          if (this.bots?.reconnectRestartedClient(client)) { await deliver(); continue; }
          const local = graphical?.input.locals.find(local => local.player.seat.client.id.equals(client));
          if (local === undefined || graphical === null) throw new Error("Round restart client has no admission owner");
          const presentation = graphical.q3.get(local.player.seat.id);
          if (presentation?.kind !== "native") throw new Error("Round restart lost its local cgame");
          presentation.client.beginRoundRestart(bit, source.sourceState());
          players.push({ seat: local.player.seat, actor: simulation.admitPlayer(client).actor });
          await deliver();
        }
        graphical?.input.rebindPlayers(players, simulation, "source-round");
        for (const local of graphical?.input.locals ?? []) {
          const presentation = graphical?.q3.get(local.player.seat.id);
          if (presentation?.kind !== "native") throw new Error("Round restart lost its prediction owner");
          const prediction = createSimulationPredictionHost(simulation, local.player.actor, local.player.seat.id);
          const initial = source.sourceState(); prediction.captureSource(initial);
          presentation.client.rebindRound({ actor: local.player.actor, initial, movement: prediction,
            predictionCommand: (command, time) => prediction.submit(command, time),
            linkBounds: number => source.world.linkState(number)?.absbounds ?? null,
            sourceActor: number => { const record = source.records.get(number); return record?.inuse ? record.actor.id : null; },
            serverSettings: () => source.host.cvars.snapshots().filter(variable => source.settings.definitions.some(definition => definition.name === variable.name)) });
          graphical?.q3.set(local.player.seat.id, { kind: "native", client: presentation.client, prediction });
        }
        await settle();
        simulation.completeSourceRoundSettlement();
        this.localSnapshotServerBit = bit;
      };
      if (network?.kind === "q3") {
        await network.server.restartSourceRound(restart, () => { mutated = true; this.lastRestartFrame = this.frames; return undefined; });
      } else await restart(null);
      this.bots?.resumeRoundBots();
      const final = this.lastOutput, source = simulation.q3Source();
      if (final === null || final.simulation !== simulation || source === null) throw new Error("Round restart has no final frame");
      const state = source.sourceState();
      for (const presentation of graphical?.q3.values() ?? []) {
        if (presentation.kind !== "native") throw new Error("Round restart has a foreign cgame");
        presentation.prediction.captureSource(state); presentation.client.receive(state, [], []);
      }
      await network?.server.publish(final.output, [], performance.now());
      return true;
    } catch (error) {
      if (mutated) { this.fatalWorldFailure = true; this.closed = true; this.stopping = true; }
      throw error;
    } finally {
      this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve();
      if (!this.closed) this.resumeInput();
    }
  }

  private captureBlocksTransition(): boolean {
    return this.capture?.pendingReadback === true && (this.pendingSave !== null || this.pendingTeamArena !== null
      || this.pendingMap !== null || this.pendingTransition !== null || this.simulation.pendingMatchMap() !== null
      || this.pendingRestart !== null && this.elapsed >= this.pendingRestart);
  }

  private async applyTransition(): Promise<void> {
    if (this.captureBlocksTransition()) return;
    if (this.pendingSave !== null) {
      const image = this.pendingSave, previous = this.content;
      this.pendingSave = null;
      try {
        await this.replaceWorld(image.recipe.map.geometry.requestedPath, null, 0, image);
        this.pendingTeamArena = null; this.pendingMap = null; this.pendingRestart = null; this.pendingTransition = null;
      } catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    if (this.pendingTeamArena !== null) {
      const action = this.pendingTeamArena;
      this.pendingTeamArena = null;
      const source = this.simulation.q3Source();
      if (source === null || !this.isTeamArenaSkirmish()) throw new Error("Team Arena progression has no native source owner");
      const gameType = source.gameType, skill = source.host.cvars.variableValue("g_spSkill");
      if ((gameType !== 1 && gameType !== 4 && gameType !== 5 && gameType !== 6 && gameType !== 7)
        || (skill !== 1 && skill !== 2 && skill !== 3 && skill !== 4 && skill !== 5)) throw new Error("Team Arena source settings do not identify an authored match");
      const previous = this.content;
      try {
        const setup = await readTeamArenaSkirmish(this.content.catalog, skill, { map: this.options.map, gameType, advance: action === "next" });
        await this.replaceWorld(setup.map, null, 0, undefined, setup);
      } catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    const matchMap = this.simulation.pendingMatchMap();
    if (matchMap !== null) { await this.replaceWorld(mapResourcePath(matchMap), this.simulation.captureTravel()); return; }
    if (this.pendingMap !== null) {
      const map = this.pendingMap, previous = this.content;
      this.pendingMap = null;
      this.pendingTransition = null;
      this.pendingRestart = null;
      try { await this.replaceWorld(map, null); }
      catch (error) {
        if (this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    if (this.pendingRestart !== null && (this.simulation.q3Source()?.host.now() ?? 0) >= this.pendingRestart) {
      this.pendingRestart = null;
      if (this.simulation.q3Source() === null) throw new Error("Quake III restart has no source game");
      if (!await this.restartSourceRound()) {
        await this.replaceWorld(this.options.map, null, this.elapsed); this.lastRestartFrame = this.frames;
      }
      return;
    }
    const decision = this.pendingTransition;
    this.pendingTransition = null;
    if (decision === null) return;
    if (decision.kind === "travel") {
      const colon = decision.map.indexOf(":"), family = decision.map.slice(0, colon);
      if (family !== this.content.catalog.product(this.options.product).expectation.family) throw new Error("Campaign travel selected another content provider without a resolved launch recipe");
      const carry = this.simulation.captureTravel(decision.spawnPoint);
      if (family === "q2") {
        const original = this.simulation.takeLevelChange()?.map
          ?? `${decision.map.slice(colon + 1)}${decision.spawnPoint === "" ? "" : `$${decision.spawnPoint}`}`;
        try { await this.advanceQ2Travel(parseQ2Travel(original), carry); }
        catch (error) { this.reportCampaignTravelError(error); }
      } else {
        const map = decision.map.slice(colon + 1).replace(/^\*/, "");
        await this.replaceWorld(map, carry);
      }
    } else if (decision.kind === "campaign-complete") this.host.print("Campaign complete.\n");
    else throw new Error("Round restart requires the selected match provider");
  }

  private reportCampaignTravelError(error: unknown): void {
    if (this.fatalWorldFailure) throw error;
    const message = `Campaign transition failed: ${error instanceof Error ? error.message : String(error)}\n`;
    this.host.print(message);
    for (const local of this.graphical?.input.locals ?? []) {
      local.console.print(message);
      local.input.setFocus({ kind: "console" }, this.graphical?.input.now() ?? 0);
    }
  }

  private async advanceQ2Travel(target: Q2TravelTarget, carry: SimulationTravel): Promise<void> {
    if (target.kind === "map") {
      await this.replaceWorld(target.name, { ...carry, spawnPoint: target.spawnPoint });
      return;
    }
    const graphical = this.graphical, seat = this.localPlayers[0]?.seat.id;
    if (graphical === null || seat === undefined || this.network !== null)
      throw new Error("Campaign cinematics require an offline local presentation");
    const playback = await CampaignCinematic.open(target, this.content, graphical.assets, graphical.audio, graphical.renderer, seat);
    const next = target.kind === "picture" && target.name.toLowerCase() === "victory.pcx" && this.options.mode === "coop"
      ? parseQ2Travel("*base1") : target.next;
    this.campaignMovie = { playback, next, carry };
  }

  private underwater(camera: SceneCamera, actor: ActorId): boolean {
    const timing = this.content.recipe.timing.find(timing => timing.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("World has no numeric profile for camera contents");
    const contents = this.simulation.scene.pointContents({ point: camera.origin, target: { kind: "world" }, passActor: actor, numeric: timing.numeric,
      policy: this.content.world.kind === "q1-bsp" ? { kind: "q1", move: "normal", hull: null }
        : this.content.world.kind === "q2-bsp" ? { kind: "q2", contentsMask: -1, leafContents: "merged" }
        : { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
    return contents.kind === "q1" ? contents.contents <= -3 && contents.contents >= -5 : ((contents.kind === "q2" ? contents.merged : contents.contents) & 56) !== 0;
  }

  private commandActor(seat: SeatId | null): ActorId {
    const player = this.localPlayers.find(player => seat === null || player.seat.id.equals(seat));
    if (player === undefined) throw new Error("Command requires a player");
    return player.actor;
  }

  private async afterCommandDispatch(): Promise<void> {
    if (this.closed || this.fatalWorldFailure || this.captureBlocksTransition() || this.pendingShellPublication) return;
    do {
      await this.commands(async () => {
        if (this.closed) return;
        await this.applyTransition();
        if (this.requestedCommands.length !== 0) await this.afterCommandDispatch();
      });
      if (this.closed || this.pendingShellPublication) return;
      await this.applyTransition();
    } while (this.requestedCommands.length !== 0 && !this.captureBlocksTransition());
  }

  async executeApplicationRequest(request: ConfigurationCommandRequest): Promise<void> {
    await this.commands(async () => {
      if (this.closed) return;
      await this.applyTransition();
      if (this.requestedCommands.length !== 0) await this.afterCommandDispatch();
    }, [request]);
  }

  private get pendingShellPublication(): boolean { return this.ownership.kind === "borrowed" && this.ownership.client.hasPendingSource; }

  takePendingClientCommands(): () => Promise<void> {
    const pending = this.requestedCommands; this.requestedCommands = [];
    return () => this.commands(undefined, pending, true);
  }

  private async commands(afterRequest?: () => Promise<void>, direct?: readonly ApplicationCommandRequest[], routeApplications = direct === undefined): Promise<void> {
    const pending = direct ?? this.requestedCommands;
    if (direct === undefined) this.requestedCommands = [];
    for (const [index, request] of pending.entries()) {
      if (this.stepping && this.pendingShellPublication) { this.requestedCommands.unshift(...pending.slice(index)); return; }
      if (routeApplications && request.target === "application" && this.sourcePublished && this.ownership.kind === "borrowed") {
        const source = request.source ?? this.ownership.client.prepared.commands.context;
        if (this.stepping) {
          if (this.ownership.client.routeCommand(request.name, request.arguments_, source)) {
            this.requestedCommands.unshift(...pending.slice(index + 1));
            return;
          }
        } else {
          await this.ownership.client.dispatchApplicationRequest({ ...request, target: request.target, source });
          continue;
        }
      }
      if (this.closed) continue;
      if (this.captureBlocksTransition()) { this.requestedCommands.unshift(...pending.slice(index)); return; }
      let command = request;
      const local = this.graphical?.input.locals.find(local => command.seat !== null && local.player.seat.id.equals(command.seat));
      const source: CommandContext | undefined = command.source ?? (local === undefined ? undefined : { session: this.session.session,
        origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } });
      const print = (text: string): void => {
        if (source !== undefined && this.graphical !== null) this.graphical.input.print(text, source);
        else {
          this.host.print(text);
          if (command.seat === null) for (const local of this.graphical?.input.locals ?? []) local.console.print(text);
        }
      };
      try {
        if (command.name === "centerview") {
          for (const target of this.graphical?.input.locals ?? []) {
            if (command.seat !== null && !target.player.seat.id.equals(command.seat)) continue;
            const client = this.graphical?.q3.get(target.player.seat.id)?.client;
            const state = target.builder.dialect === "q3" && client !== undefined
              ? client.source.read(client.source.current().number)?.playerState : undefined;
            target.builder.setViewAngles({ ...target.builder.viewAngles, x: state === undefined ? 0 : -(state.deltaAngles.x << 16 >> 16) * (360 / 65536) });
          }
          continue;
        }
        if (command.target === "source") {
          if (command.name === "postgame") {
            this.pendingTeamArenaPostgame = parseTeamArenaPostgame(command.arguments_);
            print("Match complete. Choose Next match, Retry match, or Main menu.\n");
          } else if (command.name === "teamarena-results") {
            if (!this.isTeamArenaSkirmish()) throw new Error("No Team Arena skirmish is active");
          } else if (command.name === "kick") {
            const game = this.simulation.q3Source();
            if (game === null) throw new Error("Source kick requires Quake III");
            for (const actor of this.kickTargets(command.arguments_)) {
              const player = this.simulation.movementPlayer(actor);
              if (player !== null) game.host.engine.dropClient(player.client.slot, "was kicked");
            }
          } else throw new Error("Unknown source application action " + command.name);
          continue;
        }
        if (command.name === "quit") { this.requestQuit(); continue; }
        if (command.target === "application" && applicationAudioCommands.includes(command.name)) {
          const graphical = this.graphical;
          if (graphical === null) throw new Error("Sound system is not started");
          await graphical.audio.command({ name: command.name, args: command.arguments_, seat: command.seat,
            registrations: [...graphical.q3.values()].flatMap(value => value.client.media.bank.registrations()),
            print });
          continue;
        }
        const guest = this.simulation.q3Guest();
        if (command.target === "client" && guest === null) {
          if (command.seat === null) throw new Error("Reliable client command requires an invoking local seat");
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
          continue;
        }
        if (guest !== null && command.seat !== null && (command.target === "client" || command.name !== "save" && command.name !== "load")) {
          const source = this.graphical?.q3.get(command.seat);
          if (source?.kind !== "qvm") throw new Error("Guest command has no local client");
          if (["map", "map_restart", "devmap", "spmap", "spdevmap", "addbot", "removebot", "botlist"].includes(command.name)) throw new Error(`Q3 guest command ${command.name} is unsupported`);
          if (command.target === "client" || !await source.client.command([command.name, ...command.arguments_])) {
            const player = guest.player(source.client.options.local.player.seat.client.id);
            if (player === null) throw new Error("Guest local client is disconnected");
            await guest.command(player, [command.name, ...command.arguments_]);
          }
          continue;
        }
        if (guest !== null && command.name !== "save" && command.name !== "load") {
          if (command.seat !== null) throw new Error("Q3 guest local seats are unsupported");
          if (["map", "map_restart", "devmap", "spmap", "spdevmap", "addbot", "removebot", "botlist"].includes(command.name))
            throw new Error(`Q3 guest command ${command.name} is unsupported`);
          if (command.name === "exec") {
            const argument = command.arguments_[0];
            if (argument === undefined || command.arguments_.length !== 1) throw new Error("Usage: exec <filename>");
            const path = /\.[^/]+$/.test(argument) ? argument : `${argument}.cfg`;
            const script = await this.content.mounts.open(path);
            if (script === null) print(`couldn't exec ${path}\n`);
            else {
              print(`execing ${path}\n`);
              const caller: CommandContext = source ?? { session: this.session.session, origin: { kind: "server-console" } };
              this.sourceCommands?.insert(new TextDecoder().decode(script.bytes), { session: caller.session,
                origin: { kind: "script", name: path, caller: caller.origin } });
            }
          } else if (command.name === "kick") {
            const target = command.arguments_[0]; if (target === undefined) throw new Error("Usage: kick <slot|all>");
            for (const player of guest.players()) if (target === "all" || target === String(player.sourceEntity))
              await this.network?.server.disconnectClient(player.client, "was kicked");
          } else if (!await q3GameCallback(() => guest.consoleCommand([command.name, ...command.arguments_]))) print(`Unknown game command: ${command.name}\n`);
          continue;
        }
        if (["+grapple", "-grapple", "+grenade", "-grenade"].includes(command.name)) {
          if (command.seat === null) throw new Error("Offhand commands require an invoking local seat");
          const actor = this.commandActor(command.seat), held = command.name.startsWith("+");
          const equipment = this.simulation.recipe.equipment;
          const available = command.name.endsWith("grapple") ? equipment.grapple.kind === "enabled" && equipment.grapple.binding === "offhand"
            : equipment.handGrenades.kind === "enabled";
          if (!available) { if (held) throw new Error("No selected offhand action is available"); continue; }
          if (command.name.endsWith("grapple")) this.simulation.setGrappleInput(actor, held);
          else this.simulation.setHandGrenadeInput(actor, held);
          continue;
        }
        if (command.name === "use" || command.name === "weapon") {
          const selected = resolveWeaponSelection(command.name, command.arguments_, this.simulation.playerUi(this.commandActor(command.seat)).items);
          if (selected !== null) command = { ...command, name: "use", arguments_: [selected.item] };
        }
        const sourceClient = command.seat === null ? this.graphical?.q3.values().next().value : this.graphical?.q3.get(command.seat);
        if (sourceClient !== undefined && (command.name === "use" || command.name === "weapnext" || command.name === "weapprev")) {
          const actor = this.commandActor(command.seat);
          if (this.simulation.movementPlayer(actor)?.arsenal.state.kind !== "q3") {
            this.simulation.playerCommand(actor, command.name, command.arguments_); continue;
          }
        }
        if (command.name === "use") {
          const actor = this.commandActor(command.seat), requested = command.arguments_.join("").toLowerCase().replaceAll(" ", "");
          const item = this.simulation.playerUi(actor).items.find(item => item.kind === "weapon" && item.owned
            && (item.id === requested || item.label.toLowerCase().replaceAll(" ", "") === requested));
          const weapon = Q3_WEAPON_ITEMS.find(weapon => weapon.item === item?.id), player = this.simulation.movementPlayer(actor);
          if (weapon !== undefined && player?.arsenal.state.kind === "q3") {
            if (sourceClient !== undefined) { await sourceClient.client.command(["weapon", String(weapon.weapon)]); continue; }
            const local = this.graphical?.input.locals.find(local => local.player.actor.equals(actor));
            if (local !== undefined) {
              this.graphical?.input.setArsenalSelection(local.player.seat.id, { provider: player.arsenal.provider, weapon: weapon.item });
              this.simulation.requestWeapon(actor, { provider: player.arsenal.provider, item: weapon.item });
              continue;
            }
          }
        }
        if (sourceClient !== undefined && await sourceClient.client.command([command.name, ...command.arguments_])) continue;
        if (command.name === "addbot" || command.name === "botlist") {
          if (this.bots === null) this.bots = await this.createBots(this.content, this.simulation, { requested: true });
          if (this.bots === null) throw new Error("Bot observations are unavailable for this world");
          this.bots.consoleCommand([command.name, ...command.arguments_]);
        } else if (command.name === "kick") { await this.kickClients(command.arguments_);
        } else if (command.name === "removebot") {
          const argument = command.arguments_[0];
          const bot = this.botClients.find(bot => argument === undefined || String(bot.client.id.slot) === argument);
          if (bot !== undefined) this.bots?.disconnect(bot.client.id.slot);
        } else if (command.name === "save") {
          const path = command.arguments_[0];
          if (path === undefined || path.length === 0) throw new Error("Usage: save <path>");
          await this.saveGame(path);
          print(`Saved ${path}.\n`);
        } else if (command.name === "weapnext" || command.name === "weapprev" || command.name === "use") {
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        } else if (command.name === "say" || command.name === "say_team") {
          if (this.simulation.q2Source() === null && this.simulation.q3Source() === null) throw new Error("Selected Quake source chat commands are not yet joined");
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else if (command.name === "map_restart") this.requestRestart(command.arguments_);
        else if (command.name === "load") {
          const path = command.arguments_[0]; if (path === undefined || path.length === 0) throw new Error("Usage: load <path>");
          if (this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
          this.pendingSave = await readSaveImage(path);
        }
        else if (command.name === "teamarena-next" || command.name === "teamarena-retry") {
          if (!this.isTeamArenaSkirmish() || this.simulation.q3Source()?.level.intermissionTime === 0) throw new Error("Team Arena match has not finished");
          this.pendingTeamArena = command.name === "teamarena-next" ? "next" : "retry";
        }
        else if (command.name === "map") {
          const map = command.arguments_[0];
          if (map === undefined) throw new Error("Usage: map <name>");
          this.pendingMap = mapResourcePath(map);
        }
        else if (command.name === "god" || command.name === "notarget" || command.name === "noclip" || command.name === "fly"
          || command.name === "give" || command.name === "giveall" || command.name === "kill" || command.name === "suicide") {
          const players = this.simulation.players().flatMap(actor => {
            const player = this.simulation.movementPlayer(actor); return player === null ? [] : [{ actor, client: player.client }];
          });
          const actor = resolveQ1HostCommandActor(command.name, command.arguments_, source, players, () => this.commandActor(command.seat), command.name === "give");
          let origin = source?.origin; while (origin?.kind === "script") origin = origin.caller;
          this.simulation.playerCommand(actor, command.name, origin?.kind === "server-console" ? command.arguments_.slice(1) : command.arguments_);
        }
        else if (this.simulation.q1Source() !== null || this.simulation.quakecSource() !== null || this.simulation.q2Source() !== null || this.simulation.q3Source() !== null) {
          const handled = this.simulation.q3Source()?.serverCommands.consoleCommand([command.name, ...command.arguments_]) ?? false;
          if (!handled) this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else throw new Error(`Unknown application command: ${command.name}`);
      } catch (error) {
        if (this.fatalWorldFailure || error instanceof Q3GameCallbackError || error instanceof ClientSourcePublicationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        print(`${message}\n`);
      } finally {
        await afterRequest?.();
      }
    }
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput> {
    if (this.closed) throw new Error("Application is closed");
    if (this.stepping) throw new Error("Application step is already in progress");
    if (this.worldOperation !== "idle") throw new Error("A world operation is in progress");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) throw new RangeError("Application step requires positive elapsed milliseconds");
    this.stepping = true;
    const completion = Promise.withResolvers<void>(); this.stepCompletion = completion.promise;
    const frameStartedAt = performance.now();
    try {
      const operation = this.saveOperation; this.saveOperation = null;
      if (operation !== null) {
        try { await operation.run(); operation.resolve(); } catch (error) {
          operation.reject(error);
          if (this.fatalWorldFailure) throw error;
        }
      }
      await this.applyTransition();
      if (this.ownership.kind === "owned") {
        const startupFrame = await this.advanceClientStartup();
        await this.flushClientCommands();
        this.pumpClientInput();
        if (!startupFrame) await this.graphical?.input.commands.executeAsync(() => this.flushClientCommands(), () => !this.clientCommandsBlocked);
      }
      this.enableStartupPersistence();
      const movie = this.campaignMovie;
      if (movie !== null) {
        const retained = this.lastOutput;
        if (retained === null || retained.simulation !== this.simulation) throw new Error("Campaign movie has no completed world frame");
        try {
          const graphical = this.graphical;
          const consoleOpen = graphical?.input.locals.some(local => local.input.focus.kind === "console") ?? false;
          if (movie.playback.frame(elapsedMilliseconds, ++this.frames, consoleOpen)) {
            movie.playback.close(this.frames); this.campaignMovie = null;
            if (movie.next !== null) await this.advanceQ2Travel(movie.next, movie.carry);
            else this.requestQuit();
          } else if (consoleOpen && graphical !== null) {
            const presentations = this.simulation.presentations(), characters = this.simulation.characterViews();
            for (const presentation of graphical.presentations) {
              await presentation.prepare(retained.output.snapshot, presentations, characters);
              presentation.local.player.seat.present(retained.output.snapshot, graphical.renderer.backend);
            }
            graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
          }
        } catch (error) {
          this.campaignMovie = null;
          try { movie.playback.close(this.frames); } catch (closeError) { this.host.print(`${String(closeError)}\n`); }
          this.reportCampaignTravelError(error);
        }
        await this.commands();
        if (this.simulation === retained.simulation) return retained.output;
      }
      await this.dispatchClientInputs();
      const q1 = this.simulation.q1Source() ?? this.simulation.quakecSource();
      const beforeFrameEvents = q1 === null ? [] : this.simulation.drainPresentationEvents();
      this.appendQ1Commands(beforeFrameEvents);
      if (this.dedicatedCommands !== null) this.dedicatedConsole?.drain(this.dedicatedCommands);
      await this.sourceCommands?.executeAsync(() => this.afterCommandDispatch(), () => !this.captureBlocksTransition() && !this.pendingShellPublication);
      if (this.dedicatedCommands !== null && this.dedicatedCommands !== this.sourceCommands)
        await this.dedicatedCommands.executeAsync(() => this.afterCommandDispatch(), () => !this.captureBlocksTransition() && !this.pendingShellPublication);
      const captureTransitionPending = this.captureBlocksTransition();
      const botConfiguration = this.simulation.q1Source()?.cvars ?? this.q2Console?.cvars;
      if (this.bots === null && this.simulation.q3Source() === null && (botConfiguration?.variableValue("bot_minplayers") ?? 0) > 0) {
        const unsupported = botAdmissionError(this.simulation);
        if (unsupported === null) this.bots = await this.createBots(this.content, this.simulation, { requested: true });
        else { this.host.print(`${unsupported}\n`); botConfiguration?.set("bot_minplayers", "0", true); }
      }
      if (this.localGuest !== null) for (const seat of this.localGuest.seats.values()) {
        const player = this.simulation.q3Guest()?.players().find(player => player.sourceEntity === seat.state.clientNumber);
        const userinfo = `${seat.cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`;
        if (player !== undefined && userinfo !== seat.userinfo) { await this.localGuest.authority.userinfo(player, userinfo); seat.userinfo = userinfo; }
      }
      const retained = this.lastOutput;
      const paused = this.options.mode === "singleplayer" && this.network === null
        && this.simulation.players().length === this.localPlayers.length + this.botClients.length && this.graphical?.presentations.some(presentation => presentation.ui.pauseMenuOpen) === true
        && retained !== null && retained.simulation === this.simulation;
      const timeCvars = this.sourceCvars();
      const frameMilliseconds = timeCvars === null ? elapsedMilliseconds : sourceFrameMilliseconds(this.sourceDialect(), elapsedMilliseconds,
        readFrameTimeControls(timeCvars), { dedicated: this.options.dedicated, localServer: true });
      if (!paused) this.elapsed += frameMilliseconds;
      if (this.closed) throw new Error("Application closed during step");
      const remote = await this.network?.server.poll(performance.now()) ?? [];
      if (this.closed) throw new Error("Application closed during step");
      for (const [seat, source] of this.graphical?.q3 ?? []) {
        const selection = source.client.userCommandSelection;
        this.graphical?.input.setQ3CommandSelection(seat, selection);
        const player = this.simulation.movementPlayer(source.client.options.local.player.actor);
        this.graphical?.input.setArsenalSelection(seat, player?.arsenal.state.kind === "q3"
          ? { provider: player.arsenal.provider, weapon: q3WeaponItem(selection.weapon)?.item ?? null } : null);
      }
      if (paused && this.graphical !== null) for (const local of this.graphical.input.locals) local.input.sample(this.graphical.input.now(), elapsedMilliseconds);
      const localCommands = paused ? [] : this.graphical?.input.build(frameMilliseconds, this.elapsed, this.frames, elapsedMilliseconds) ?? [];
      for (const command of localCommands) if (command.source.kind === "local-seat") {
        const state = this.localGuest?.seats.get(command.source.seat)?.state;
        if (state !== undefined) {
          if (command.command.kind !== "q3") throw new Error("Guest local input must use Q3 commands");
          state.commands.append(fromQ3UserCommand(command.command));
        }
      }
      const output = paused ? { snapshot: retained.output.snapshot, events: [] } : await this.session.stepAsync({ elapsedMilliseconds: frameMilliseconds,
        commands: [...localCommands, ...remote] });
      this.lastOutput = { simulation: this.simulation, output };
      this.publishLocalGuestSnapshots();
      this.guestBrowser?.host.poll(); this.guestBrowser?.view.poll();
      this.frames++;
      const frameEvents = this.simulation.drainPresentationEvents();
      if (q1 !== null) this.appendQ1Commands(frameEvents);
      this.sourceEvents = [...beforeFrameEvents, ...frameEvents];
      if (!paused) this.bots?.receive(this.sourceEvents);
      if (this.closed) throw new Error("Application closed during step");
      await this.network?.server.publish(output, this.sourceEvents, performance.now());
      const intents = paused ? [] : this.simulation.takeTransitions();
      if (intents.length !== 0) {
        const campaign = this.content.recipe.campaign;
        const mode = campaign.kind === "campaign" ? { kind: "campaign", campaign: campaign.mission.provider, allowRoundRestart: false } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0]
          : { kind: "competitive", match: this.content.recipe.match.provider } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0];
        this.transitions.commit(this.transitions.resolve(mode, intents));
      }
      const roundEvents = this.roundPresentationEvents.splice(0);
      const graphical = this.graphical;
      if (graphical !== null) {
        this.simulation.beginPresentationFrame(this.frames);
        const presentations = this.simulation.presentations(), characters = this.simulation.characterViews();
        graphical.rerelease.receive(this.sourceEvents);
        await graphical.rerelease.prepare();
        const presentationEvents = [...roundEvents, ...this.sourceEvents.filter(event => event.kind !== "q2-composition" || event.event.kind !== "kick" && event.event.kind !== "grapple-prediction"), ...graphical.rerelease.drainPrints()];
        const nativeQ3 = this.simulation.q3Source()?.sourceState();
        for (const source of graphical.q3.values()) {
          if (source.kind === "qvm") continue;
          if (nativeQ3 === undefined) throw new Error("Cgame has no authoritative source state");
          source.prediction.captureSource(nativeQ3);
          source.client.receive(nativeQ3, this.sourceEvents, localCommands);
        }
        const commonEvents = graphical.q3.size === 0 ? presentationEvents : presentationEvents.filter(event => event.kind !== "q3-source" && event.kind !== "q3-character");
        graphical.effects.receive(commonEvents);
        await graphical.effects.prepare(output.snapshot, presentations, characters, this.simulation.weaponPresentationClock());
        this.unhandledEffects = graphical.effects.drainUnhandled();
        for (const effect of this.unhandledEffects) {
          const key = `${effect.source.content}:${effect.reason}`;
          if (!this.reportedEffectGaps.has(key)) {
            this.reportedEffectGaps.add(key);
            this.host.print(`Unresolved ${effect.source.kind} effect: ${effect.reason}\n`);
          }
        }
        graphical.audio.receiveEffectSounds(graphical.effects.drainSounds());
        for (const presentation of graphical.presentations) {
          presentation.sourceEvents(presentationEvents);
          await presentation.prepare(output.snapshot, presentations, characters);
          presentation.local.player.seat.present(output.snapshot, graphical.renderer.backend);
        }
        graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
        const listeners = graphical.presentations.map(presentation => {
          const camera = presentation.camera();
          return { seat: presentation.local.player.seat.id, actor: presentation.local.player.actor, origin: camera.origin,
            axis: camera.axis, gain: 1 / graphical.presentations.length, underwater: this.underwater(camera, presentation.local.player.actor) };
        });
        await graphical.audio.frame(output.snapshot, listeners, commonEvents, frameStartedAt);
      }
      await this.capture?.drain();
      if (captureTransitionPending) {
        const heldRequests = this.requestedCommands;
        this.requestedCommands = [];
        try {
          await this.sourceActions();
          await this.commands();
          await this.applyTransition();
        } finally { this.requestedCommands.push(...heldRequests); }
        await this.afterCommandDispatch();
      } else {
        await this.commands();
        await this.sourceActions();
        await this.commands();
      }
      const currentGraphics = this.graphical;
      if (currentGraphics !== null) await this.imageSettings?.refresh(currentGraphics.assets, currentGraphics.presentations, currentGraphics.rerelease, currentGraphics.renderer);
      this.sourceEvents = [...roundEvents, ...this.sourceEvents];
      return output;
    } catch (error) {
      if (!this.fatalWorldFailure) { await this.capture?.beforeWorldChange(); throw error instanceof Q3GameCallbackError ? error.cause : error; }
      this.stepping = false; this.stepCompletion = null; completion.resolve();
      return await this.closeFailedWorld(error);
    }
    finally { this.stepping = false; this.stepCompletion = null; completion.resolve(); }
  }

  async run(): Promise<void> {
    let previous = performance.now();
    while (!this.stopping && !this.closed && (this.options.frameLimit === null || this.frames < this.options.frameLimit)) {
      const now = performance.now();
      const elapsed = now - previous;
      if (elapsed < 4) { await Bun.sleep(4 - elapsed); continue; }
      previous = now;
      await this.step(elapsed);
      await setImmediate();
    }
  }

  readPixels(): Uint8Array {
    if (this.graphical === null) throw new Error("Dedicated applications have no framebuffer");
    return this.graphical.renderer.readPixels();
  }

  captureNextFrame(): Promise<Uint8Array> {
    if (this.graphical === null) return Promise.reject(new Error("Dedicated applications have no framebuffer"));
    return this.graphical.renderer.captureNextFrame();
  }

  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true; this.stopping = true;
    this.closing = this.closeOwned(); return this.closing;
  }
  private async closeFailedWorld(error: unknown): Promise<never> {
    const original = error instanceof Q3GameCallbackError ? error.cause : error;
    const errors: unknown[] = [original];
    try { await this.capture?.beforeWorldChange(); } catch (cleanup) { errors.push(cleanup); }
    try { await this.close(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "World publication and shutdown failed");
    throw original;
  }
  private async closeOwned(): Promise<void> {
    await this.stepCompletion;
    await this.worldOperationCompletion;
    this.saveOperation?.reject(new Error("Application closed before the save operation completed.")); this.saveOperation = null;
    this.stopping = true;
    const graphical = this.graphical;
    this.graphical = null;
    const errors: unknown[] = [];
    if (this.ownership.kind === "borrowed" && this.ownership.client.source.current === this) {
      try { await this.ownership.client.capture.beforeWorldChange(); } catch (error) { errors.push(error); }
    }
    try { this.campaignMovie?.playback.close(this.frames); } catch (error) { errors.push(error); }
    this.campaignMovie = null;
    try { if (this.ownership.kind === "owned") await this.capture?.close(); } catch (error) { errors.push(error); }
    this.capture = null;
    if (this.sourcePublished && this.archivePersistence && !this.preparedStartup?.pending) {
      try { await this.saveSourceArchive(this.options, this.content, this.simulation, this.teamArenaOverrides); } catch (error) { errors.push(error); }
      try { await this.saveClientArchives(this.options, this.content, this.clientCvars, this.teamArenaOverrides); } catch (error) { errors.push(error); }
    }
    try { this.releaseSettings(); } catch (error) { errors.push(error); }
    try { if (this.ownership.kind === "owned") await this.imageSettings?.close(); } catch (error) { errors.push(error); }
    if (this.sourcePublished) {
      try { await graphical?.input.saveSettings(); } catch (error) { errors.push(error); }
      try { if (graphical !== null && !this.preparedStartup?.pending) await this.viewSettings.save(this.inputConfig); } catch (error) { errors.push(error); }
      try { if (graphical !== null) await saveAudioSettings(this.inputConfig, graphical.audio); } catch (error) { errors.push(error); }
    }
    for (const source of graphical?.q3.values() ?? []) { try { await source.client.shutdown(); } catch (error) { errors.push(error); } }
    for (const presentation of graphical?.presentations ?? []) {
      try {
        const seat = presentation.local.player.seat;
        if (seat.presentation === presentation) seat.replacePresentation(null)?.close();
        else presentation.close();
      } catch (error) { errors.push(error); }
    }
    for (const { state } of this.localGuest?.seats.values() ?? []) state.retire();
    this.localGuest?.seats.clear(); this.localGuest = null;
    this.guestBrowser?.view.close();
    try { await this.guestBrowser?.host.close(); } catch (error) { errors.push(error); }
    this.guestBrowser = null;
    for (const close of [() => this.bots?.close(), () => this.network?.server.close(), () => this.simulation.shutdownQ3Guest(),
      () => this.session.world?.simulation === this.simulation ? this.session.closeWorld() : this.simulation.close(),
      () => graphical?.input.close(), () => graphical?.audio.close(), () => graphical?.effects.close(), () => this.dedicatedConsole?.close(),
      () => graphical?.art.close(), () => graphical?.assets.close(),
      () => graphical?.renderer.execute({ owner: graphical.renderer.owner, sequence: this.frames, commands: [] })]) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    for (const [client, connection] of this.sourceConnections) {
      try { if (client.connection === connection) client.disconnect(); } catch (error) { errors.push(error); }
    }
    this.sourceConnections.clear();
    for (const seat of this.sourceSeatChanges.added) {
      try { if (!this.sourceSeatsPublished) seat.close(); } catch (error) { errors.push(error); }
    }
    for (const client of this.sourceClientChanges.added) {
      try { if (this.session.clientAt(client.id.slot) !== client) client.close(); } catch (error) { errors.push(error); }
    }
    if (this.ownership.kind === "owned") for (const close of [() => this.session.close(), () => graphical?.renderer.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { this.releaseSourceCommands(); } catch (error) { errors.push(error); }
    try { this.profileConfiguration?.routing.close(); } catch (error) { errors.push(error); }
    this.profileConfiguration = null;
    try { await this.configurationScripts?.close(); } catch (error) { errors.push(error); }
    this.configurationScripts = null;
    try { await this.content.close(); } catch (error) { errors.push(error); }
    this.localSeats.clear();
    if (this.ownership.kind === "borrowed" && this.ownership.client.source.current === this) {
      this.ownership.client.source.current = null;
      this.ownership.client.sourceProfile.current = null;
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application shutdown failed");
  }
}

export function openApplication(options: ApplicationOptions, host: ApplicationHost, recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides): Promise<Application> { return Application.open(options, host, recipe, preferences); }
