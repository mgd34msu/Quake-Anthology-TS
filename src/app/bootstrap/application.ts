import { componentEngineCommands } from "./component-commands.ts";
import { readComponentClients, saveComponentClients, requireComponentClientPresentation } from "./component-client-save.ts";
import { SaveReader } from "../../persistence/value.ts";
import { componentMediaControl, preparePresentationAudio, preparePresentationShaders, primaryShaderControl, presentationAudioControl } from "./component-media.ts";
import type { ComponentClientCommandRequest } from "./mod-presentations.ts";
import { ApplicationModPresentations } from "./mod-presentations.ts";
import { ApplicationSelectedQ3Presentations } from "./selected-q3-presentation.ts";
import { q3Hardware } from "../../render/q3-hardware.ts";
import type { WireSelection } from "../../network/common/session.ts";
import { ModCommands, readModCommand } from "../../world/session/mod-commands.ts";
import { ModUserFiles } from "../../world/session/mod-files.ts";
import { ApplicationQ3Rankings } from "./q3-rankings.ts";
import type { RankingServiceProvider, RankingPlayerState } from "../../network/services/rankings.ts";
import type { RankingAccountActions } from "../../ui/settings/rankings.ts";
import { SpectatorState } from "../../content/q3/base/game/state.ts";
import { prepareQ2MatchReports, q2MatchReports, q2MatchCompleted, type NativeQ2MapTransition } from "./q2-match-reports.ts";
import { preflightApplicationMatch } from "./match-preflight.ts";
import { parseSaveRequest, parseLoadRequest, saveCommandDocumentation, type ApplicationSaveFormat } from "./save-requests.ts";
import { q1SessionDepartures, sourceLevelCompletion } from "./q1-session-actions.ts";
import { configuredWeaponBehaviorOptions, prepareConfiguredApplicationRecipe } from "./weapon-behavior-selection.ts";
import { loadServerLocalizationResources } from "../../text/localization-resources.ts";
import { q2LocalizedText } from "./q2-localization.ts";
import { writeSdlClipboard } from "../../platform/sdl.ts";
import { createRereleaseNativeQ2ApplicationServerHost } from "./simulation/network-q2-rerelease-native.ts";
import { q3InfoValue } from "../../network/q3/admission.ts";
import { liveQ2Protocol } from "./options.ts";
import { registerPlayerUserinfo, playerUserinfo } from "./player-userinfo.ts";
import { ServerOperatorState, sourceServerAdministration, registerSourceAdministrationCvars, sourceAdministrationCommandNames, type ServerOperatorHost } from "./server-administration.ts";
import type { NetworkAddress } from "../../network/common/endpoint.ts";
import { q3ProductMapCommands } from "../../core/q3-product-policy.ts";
import { applyQ3MapLaunch, q3MapLaunch, type Q3MapLaunch } from "./q3-map-command.ts";
import { NativeQ2ClientPresentation } from "./native-q2-client.ts";
import type { NativeQ2HudFrame } from "../../ui/hud/q2-native.ts";
import type { ApplicationAudioSeatEvents } from "./audio.ts";
import { createClassicQ2ApplicationServerHost } from "./simulation/network-q2-guest.ts";
import { mkdirSync } from "node:fs";
import { classicGuestFiles } from "./simulation/classic-guest-files.ts";
import { SourceDebugGraph, debugGraphColor, type DebugGraphSettings } from "../../render/debug-graph.ts";
import type { ComponentDrawings } from "./component-drawings.ts";
import type { Draw2D } from "../../text/draw2d.ts";
import { readStartupCommand } from "./startup-commands.ts";
import { teamArenaDemo, type TeamArenaDemo } from "./team-arena-demo.ts";
import { DemoLibrary } from "./demo-library.ts";
import { ClientDemoRecording } from "./demo-recording-commands.ts";
import { localWorldDemoCommands, type ClientDemoCommands } from "./demo-commands.ts";
import { LocalDemoRecording, type LocalRecordingSource } from "./demo-local-recording.ts";
import type { ClientRecordingFeed } from "./client-bootstrap.ts";
import { ApplicationKeys, type ApplicationKeyProfile } from "./keys.ts";
import { prepareLocalSeatChange, type LocalSeatRequest } from "./local-seat-change.ts";
import { ApplicationTools } from "./application-tools.ts";
import { randomUUID } from "node:crypto";
import { arenaSelection } from "./base-arena-selection.ts";
import { BaseArenaProgression } from "./base-arena-progression.ts";
import { parseArenaPostgame, arenaPostgamePresentation, type ArenaPostgamePresentation } from "./base-arena-postgame.ts";
import { readBaseArenaCatalog, baseArenaForMap, type BaseArenaCatalog } from "./base-arena-catalog.ts";
import type { BaseArenaMenuService } from "./base-arena-menu.ts";
import { PlayerProgressStore } from "./player-progress.ts";
import { defaultAudioOutputFormat } from "../../audio/output.ts";
import { applyAudioOutputSettings } from "./shared-setting-cvars.ts";
import { ApplicationVideoRestart, prepareVideoGuests, type PreparedVideoPresentation, type VideoGuestSeat } from "./video-restart.ts";
import { MusicControls } from "../../audio/music.ts";
import { SceneImageRegistry } from "../../render/scene/resources.ts";
import { legacyConfigurationOptions, openInitialConfigurationContent, prepareInitialConfiguration, prepareProfileConfiguration, configurationDialect, configurationStore, type PreparedProfileConfiguration, type ConfigurationCommandRequest } from "./configuration.ts";
import { SeatInput } from "../../input/seat.ts";
import { ClientSourcePublicationError, type ClientBootstrap } from "./client-bootstrap.ts";
import { readQ1ViewSettings } from "./q1-client-settings.ts";
import { cloneQ1SourceCvars, registerQ1BotControls } from "./q1-source-cvars.ts";
import { captureTeamArenaOverrides, readTeamArenaOverrides, saveTeamArenaOverrides, applyTeamArenaOverrides, releaseTeamArenaOverrides, teamArenaArchiveEntries, type TeamArenaOverrides, type OverrideRegistry } from "./team-arena-overrides.ts";
import { ApplicationConsoleRouting, q1ConsoleServer } from "./console.ts";
import { PreparedStartup } from "./prepared-startup.ts";
import { resolveStartupRules } from "./startup-source.ts";
import { ConsoleScriptFiles, sourceScriptReader } from "./config-scripts.ts";
import { consoleConfigRoot } from "./config-scripts.ts";
import { createStartupScriptReader } from "./startup-config.ts";
import { frameTimeCvarNames, q3ServerPaused, readFrameTimeControls, registerFrameTimeCvars, sourceFrameMilliseconds } from "./frame-time.ts";
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
import type { Q3GuestOutput, Q3GuestMapTransition } from "./simulation/q3/guest-runtime.ts";
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
import { botAdmissionError, openApplicationBotLog, resumeApplicationBotLog } from "./simulation/bots.ts";
import type { ApplicationBotClient, ApplicationBotsOptions, ApplicationBotTransportCheckpoint, ApplicationBotService } from "./simulation/bots.ts";
import { loadApplicationBotAssets } from "./simulation/bot-assets.ts";
import { createApplicationBots } from "./simulation/bot-rerelease.ts";
import { createApplicationBotNavigation } from "./simulation/navigation.ts";
import type { ActorId, ClientId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ContentId, ExecutableRecipe } from "../../contracts/content.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { TransitionDecision } from "../../contracts/gameplay.ts";
import type { Rect, SceneCamera } from "../../contracts/render.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { ActorCommand, SaveImage, SimulationOutput, SimulationProgress } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { openApplicationTransport } from "./network/transport.ts";
import type { ApplicationNetworkAddress } from "./network/transport.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { Q2_DATAGRAM_LIMITS, Q3_DATAGRAM_LIMITS, UNIFIED_DATAGRAM_LIMITS } from "../../network/common/transport.ts";
import { CommandBuffer, tokenizeCommand, type CommandBufferOptions, type CommandHandler, type CommandInvocation } from "../../core/commands/index.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { CvarRegistry, CvarFlag } from "../../core/cvars/index.ts";
import type { CvarSnapshot } from "../../core/cvars/index.ts";
import { DedicatedConsole } from "../../console/dedicated.ts";
import { loadQ3Character } from "../../content/q3/foundation/index.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../content/q3/foundation/arsenal.ts";
import { saveCommandPath, saveUnavailable, TimedAutosave, type SavePurpose } from "../../persistence/save-policy.ts";
import { writeSavedGame } from "../../persistence/saved-game.ts";
import { prepareApplicationSave } from "./original-save.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { SessionClient, SessionConnection, SessionSeat } from "../../world/session/index.ts";
import { SharedTransitionCoordinator } from "../../world/gameplay/transitions.ts";
import { parseQ2Travel, q2NextServerCommand, type Q2TravelTarget } from "./q2-travel.ts";
import { CampaignCinematic, type ScreenCinematicRequest, type ScreenCinematicCaptions } from "./campaign-cinematic.ts";
import { SeatMediaCaptions } from "../../text/media-captions.ts";
import type { SystemCinematicHandle, SystemCinematicHost } from "./q3-client/cinematics.ts";
import { CampaignUnit } from "./campaign-unit.ts";
import { q3GrappleProfile } from "../../content/q3/equipment/grapple-profiles.ts";
import { authoredCampaignStart } from "./authored-start.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationAudio } from "./audio.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import { resolveApplicationMovement, applicationPreset, applicationOptionsForRecipe, loadApplicationContent, resolveApplicationTravel } from "./content.ts";
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
import { loadSimulation, savedSimulationSettings, savedBotCheckpoint } from "./simulation/index.ts";
import { createQ2ApplicationServerHost } from "./simulation/network.ts";
import { Q2ServerNetwork } from "./network/q2.ts";
import { Q2GameCallbackError, q2GameCallback } from "./network/types.ts";
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

import { createUnifiedApplicationServerHost } from "./simulation/network-unified.ts";
import { UnifiedServerNetwork } from "./network/unified-server.ts";
import { buildUnifiedComposition } from "./network/unified-content.ts";

type NativeServerHost = { readonly kind: "q1"; readonly host: Q1ApplicationServerHost }
  | { readonly kind: "qw"; readonly host: QwApplicationServerHost }
  | { readonly kind: "q2"; readonly host: Q2ApplicationServerHost }
  | { readonly kind: "q3"; readonly host: Q3ApplicationServerHost };
type NativeServer = { readonly address: ApplicationNetworkAddress } & (
  { readonly kind: "q1"; readonly server: Q1ServerNetwork<ApplicationNetworkAddress> }
  | { readonly kind: "qw"; readonly server: QwServerNetwork }
  | { readonly kind: "q2"; readonly server: Q2ServerNetwork<ApplicationNetworkAddress> }
  | { readonly kind: "q3"; readonly server: Q3ServerNetwork }
  | { readonly kind: "unified"; readonly server: UnifiedServerNetwork<ApplicationNetworkAddress> });

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
type ApplicationCommandRequest = ComponentClientCommandRequest | { readonly target: "application" | "client" | "source"; readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; readonly source?: CommandContext; };
type Q3SeatClient = { readonly kind: "native"; readonly client: ApplicationQ3Client; readonly prediction: ReturnType<typeof createSimulationPredictionHost> }
  | { readonly kind: "qvm"; readonly client: ApplicationQ3Client; readonly state: LocalQ3ClientState };
interface NativeQ2SeatClient { userinfo: string; readonly cvars: CvarRegistry; readonly client: NativeQ2ClientPresentation; readonly effects: ApplicationEffects; readonly descriptor: { readonly frame: () => NativeQ2HudFrame; readonly ownsEffects: true }; }

interface GraphicalApplication {
  readonly modPresentations: ApplicationModPresentations;
  readonly selectedQ3Presentations: ApplicationSelectedQ3Presentations;
  readonly renderer: NativeRenderer;
  readonly assets: ApplicationAssets;
  readonly input: ApplicationInput;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly art: NativeUiArt;
  readonly presentations: readonly WorldSeatPresentation[];
  readonly q3: Map<SeatId, Q3SeatClient>;
  readonly nativeQ2: Map<SeatId, NativeQ2SeatClient>;
  readonly rerelease: ApplicationRereleasePresentation;
}

export interface ApplicationHost {
  readonly lobby?: { complete(): Promise<void>; returnToLobby(): Promise<void> };
  readonly rankings?: { readonly provider: RankingServiceProvider; readonly gameKey: string };
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
  private q3MenuPause = false;
  private lobbyCompletion: SharedSimulation | null = null;
  private rankings: { readonly simulation: SharedSimulation; readonly owner: ApplicationQ3Rankings; enabled: boolean; pending: boolean; task: Promise<void> | null; readonly clients: Map<number, ClientId> } | null = null;
  private readonly rankingMenuRequests = new Set<SeatId>();
  private readonly rankingStatuses = new Map<number, RankingPlayerState>();

  rankingAccountActions(seat: SeatId): RankingAccountActions | null {
    const state = this.rankings, local = this.localPlayers.find(player => player.seat.id.equals(seat));
    if (state === null || state.simulation !== this.simulation || local === undefined) return null;
    const client = this.simulation.playerClient(local.actor);
    if (client === null) return null;
    const actions = state.owner.accountActions(client.slot);
    return { ...actions, player: () => this.rankings === state ? this.rankingStatuses.get(client.slot) ?? actions.player() : actions.player() };
  }
  takeRankingMenuRequest(seat: SeatId): boolean { return this.rankingMenuRequests.delete(seat); }
  private publishRankingState(simulation: SharedSimulation): void {
    const cvars = simulation.q3Source()?.host.cvars;
    if (cvars === undefined) return;
    const state = this.rankings;
    const value = state?.simulation === simulation && cvars.variableValue("sv_enableRankings") !== 0 && state.owner.lifecycle.state().kind === "active" ? "1" : "0";
    if (cvars.variableString("sv_rankingsActive") !== value) cvars.set("sv_rankingsActive", value, true);
  }
  private async disconnectRankings(simulation: SharedSimulation, client: ClientId): Promise<void> {
    const state = this.rankings;
    if (state === null || state.simulation !== simulation) return;
    await state.task;
    await state.owner.disconnect(client.slot); state.clients.delete(client.slot); this.rankingStatuses.delete(client.slot);
    for (const seat of this.localSeats.values()) if (seat.client.id.equals(client)) this.rankingMenuRequests.delete(seat.id);
  }
  private async closeRankings(simulation?: SharedSimulation): Promise<void> {
    const state = this.rankings;
    if (state === null || simulation !== undefined && state.simulation !== simulation) return;
    this.rankings = null;
    this.publishRankingState(state.simulation);
    try {
      await state.task;
      if ((state.simulation.q3Source()?.level.intermissionTime ?? 0) !== 0) await state.owner.gameOver();
    } finally {
      this.rankingMenuRequests.clear(); this.rankingStatuses.clear();
      await state.owner.close();
    }
  }
  private queueRankingFrame(): void {
    const state = this.rankings, source = this.simulation.q3Source();
    if (state === null || source === null) return;
    if (state.task !== null) { state.pending = true; return; }
    const kind = state.owner.lifecycle.state().kind;
    if ((kind === "disabled" || kind === "unavailable") && state.enabled === (source.host.cvars.variableValue("sv_enableRankings") !== 0)) return;
    const task: Promise<void> = (async () => {
      do { state.pending = false; await this.rankingFrame(); }
      while (state.pending && this.rankings === state && !this.closed && state.owner.lifecycle.state().kind === "active");
    })().catch((error: unknown) => { this.host.print(`Ranking service failed: ${error instanceof Error ? error.message : String(error)}\n`); })
      .finally(() => { if (state.task === task) state.task = null; });
    state.task = task;
  }
  private async rankingFrame(): Promise<void> {
    const simulation = this.simulation, source = simulation.q3Source();
    if (source === null) return;
    const enabled = source.host.cvars.variableValue("sv_enableRankings") !== 0;
    let state = this.rankings;
    if (state !== null && state.simulation !== this.simulation) throw new Error("Ranking owner outlived its Q3 world");
    if (state === null) {
      const entity = (slot: number) => {
        const value = source.pool.get(slot);
        if (value === null || value === undefined || value.client === null || !value.inuse) throw new Error("Ranking client has left its source world");
        return value;
      };
      const owner: ApplicationQ3Rankings = new ApplicationQ3Rankings(source.pool, source.level, this.host.rankings?.provider ?? null, {
        serviceStatus: () => { if (this.rankings?.owner === owner && this.simulation === simulation) this.publishRankingState(simulation); },
        status: (slot, status) => { if (this.rankings?.owner === owner) this.rankingStatuses.set(slot, status); },
        menu: slot => { if (this.rankings?.owner !== owner || this.simulation !== simulation) return; for (const seat of this.localSeats.values()) if (seat.client.id.slot === slot) this.rankingMenuRequests.add(seat.id); },
        spectator: slot => {
          if (this.rankings?.owner !== owner || this.simulation !== simulation) return;
          const value = entity(slot), client = value.client;
          if (client === null) throw new Error("Ranking client has no source state");
          client.sess.sessionTeam = Team.TEAM_SPECTATOR; client.sess.spectatorState = SpectatorState.FREE;
          source.spawns.clientSpawn(value);
        },
        activate: slot => { if (this.rankings?.owner !== owner || this.simulation !== simulation) return; source.commands.setTeam(entity(slot), "free"); },
        scoreboard: slot => { if (this.rankings?.owner !== owner || this.simulation !== simulation) return; source.commands.scoreboard(entity(slot)); },
        dropBot: slot => { if (this.rankings?.owner !== owner || this.simulation !== simulation) return; source.host.engine.dropClient(slot, "Bots cannot participate in ranked games"); },
        gameType: () => source.host.cvars.variableValue("g_gametype"),
        cvar: name => source.host.cvars.variableString(name), setCvar: (name, value) => { source.host.cvars.set(name, value, true); },
      });
      state = { simulation, owner, enabled, pending: false, task: null, clients: new Map<number, ClientId>() }; this.rankings = state;
      await owner.begin(enabled, source.host.cvars.variableValue("g_gametype") === GameType.GT_SINGLE_PLAYER, this.host.rankings?.gameKey ?? "");
      const status = owner.lifecycle.state();
      if (status.kind === "unavailable") this.host.print(`Rankings unavailable: ${status.reason}\n`);
    } else if (state.enabled !== enabled) {
      if (!enabled) {
        const ending = state.owner.lifecycle.end();
        this.publishRankingState(state.simulation);
        await ending;
      }
      state.enabled = enabled;
      await state.owner.begin(enabled, source.host.cvars.variableValue("g_gametype") === GameType.GT_SINGLE_PLAYER, this.host.rankings?.gameKey ?? "");
      const status = state.owner.lifecycle.state();
      if (status.kind === "unavailable") this.host.print(`Rankings unavailable: ${status.reason}\n`);
    }
    const clients = state.simulation.clientIdentities();
    for (const client of [...state.clients.values()]) if (!clients.some(current => current.equals(client))) { await state.owner.disconnect(client.slot); state.clients.delete(client.slot); this.rankingStatuses.delete(client.slot); }
    for (const client of clients) state.clients.set(client.slot, client);
    await state.owner.frame();
    if (source.level.intermissionTime !== 0) await state.owner.gameOver();
  }
  private tools: ApplicationTools | null = null;
  private debugGraph = new SourceDebugGraph();
  private ownedVideoRestart: ApplicationVideoRestart | null = null;
  private frontendOverrides: FrontendPreferenceOverrides = {};
  private imageSettings: ApplicationImageSettings | null = null;
  private frontendBaseline: FrontendPreferenceValues | null = null;
  private bots: ApplicationBotService | null = null;
  private clientCvars = new Map<SeatId, CvarRegistry>();
  private readonly publishedUserinfo = new WeakMap<CvarRegistry, string>();
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
  private readonly keys: ApplicationKeys;
  private readonly keyProfiles = new WeakMap<SharedSimulation, ApplicationKeyProfile>();
  private clientInputs: SeatInputEvent[] = [];
  private deferredInput: SeatInputEvent[] = [];
  private stopping = false;
  private closed = false;
  private stepping = false;
  private worldOperation: "idle" | "saving" | "loading" | "travel" = "idle";
  private worldOperationCompletion: Promise<void> | null = null;
  private stepCompletion: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private ownedRecording: ClientDemoRecording | null = null;
  private ownedDemos: { readonly service: ClientDemoCommands; readonly release: () => void } | null = null;
  private elapsed = 0;
  private frames = 0;
  private presentationFrames = 0;
  private presentationMilliseconds: number | null = null;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly serverProfileStore = new ConfigStore(join(homedir(), ".local", "share", "quake-typescript", "settings"));
  private readonly inputConfig: ConfigStore;
  private readonly reportedEffectGaps = new Set<string>();
  private network: NativeServer | null = null;
  private recordingHost: NativeServerHost | null = null;
  private localRecording: LocalDemoRecording | null = null;
  private localRecordingActive = false;
  private recordingSeat: SeatId | null = null;

  private readonly transitions = new SharedTransitionCoordinator(decision => { this.pendingTransition = decision; return undefined; });
  private pendingTransition: Exclude<TransitionDecision, { readonly kind: "stay" }> | null = null;
  private readonly movieRequests = new WeakMap<SharedSimulation, object>();
  private readonly movies = new Map<SharedSimulation, { readonly playback: CampaignCinematic; readonly request: object; readonly componentOwned?: true; current(): boolean; complete(): Promise<void> }>();
  private get campaignMovie() { return this.movies.get(this.simulation) ?? null; }
  private set campaignMovie(movie: { readonly playback: CampaignCinematic; readonly request: object; readonly componentOwned?: true; current(): boolean; complete(): Promise<void> } | null) {
    if (movie === null) { this.movies.delete(this.simulation); this.movieRequests.delete(this.simulation); } else this.movies.set(this.simulation, movie);
  }
  private pendingMap: string | null = null;
  private pendingQ3Map: Q3MapLaunch | undefined;
  private pendingNativeTravel: Q2TravelTarget | null = null;
  private readonly baseArenaProgress = new WeakMap<SharedSimulation, { readonly catalog: BaseArenaCatalog; readonly progression: BaseArenaProgression; result: ArenaPostgamePresentation | null; resultAt: number; announced: boolean; moviePlayed: boolean }>();
  private playerProgress: Promise<PlayerProgressStore> | null = null;
  private readonly teamArenaDemos = new WeakMap<SharedSimulation, TeamArenaDemo>();
  private pendingTeamArena: "next" | "retry" | null = null;
  private pendingTeamArenaPostgame: TeamArenaPostgameStats | null = null;
  private sourceCommands: CommandBuffer | null = null;
  private operatorState: ServerOperatorState | null = null;
  private operatorOutput: { write: ((text: string) => void) | null } = { write: null };
  private operatorSend: ((to: NetworkAddress, bytes: Uint8Array) => boolean) | null = null;
  private sourceCommandBinding: Pick<PreparedSourceCommands, "options"> | null = null;
  private releaseSourceCommands: () => void = () => {};
  private releaseModInputCommands: () => void = () => {};
  private modInputCommands: CommandBuffer | null = null;
  private q2Console: ApplicationQ2Console | null = null;
  private pendingRestart: number | null = null;
  private lastRestartFrame = -1;
  private localSnapshotServerBit: 0 | 4 = 0;
  private fatalWorldFailure = false;
  private roundPresentationEvents: SimulationPresentationEvent[] = [];
  private pendingSave: { readonly path: string; readonly sourceProduct?: string } | null = null;
  private savedGames: StartupSaves | null = null;
  private localGuest: LocalQ3GuestWorld | null = null;
  private guestBrowser: LocalQ3GuestBrowser | null = null;
  private saveOperation: { readonly run: () => Promise<void>; readonly resolve: () => void; readonly reject: (error: unknown) => void } | null = null;
  private lastOutput: { readonly simulation: SharedSimulation; readonly output: SimulationOutput } | null = null;
  private timedAutosave = new TimedAutosave(30_000);
  private campaignUnit = new CampaignUnit();
  private get saveDirectory(): string { return this.host.saveDirectory ?? join(homedir(), ".local", "share", "quake-typescript", "saves"); }
  private saveUnavailable(purpose: SavePurpose): string | null {
    const players = this.options.dedicated ? this.simulation.players() : this.localPlayers.map(player => player.actor);
    const native = this.simulation.q2Native();
    if (native !== null && native.services.options.cvars.variableValue("deathmatch") !== 0) return "Native Quake II deathmatch games cannot be saved";
    return saveUnavailable({ authority: this.network === null && this.options.network.kind === "offline" ? "offline" : "server",
      family: this.simulation.q3Source() !== null || this.simulation.q3Guest() !== null ? "q3"
        : this.simulation.q2Source() !== null || native !== null ? "q2" : "q1",
      mode: this.options.mode, active: !this.closed && (this.campaignMovie === null || this.campaignMovie.componentOwned === true),
      intermission: players.some(actor => this.simulation.movementPlayer(actor)?.intermission === true)
        || (this.simulation.q3Source()?.level.intermissionTime ?? 0) !== 0
        || this.simulation.q3Guest()?.state.configstrings.get(22) === "1",
      playerHealth: players.map(actor => native === null ? this.simulation.combat.read(actor)?.health ?? 0 : this.simulation.playerUi(actor).health) }, purpose);
  }
  private levelRecoveryAvailable(simulation: SharedSimulation, options: ApplicationOptions): boolean {
    return !options.dedicated && options.network.kind === "offline" && simulation.options.mode === "singleplayer"
      && (simulation.q1Source() !== null || simulation.q2Source() !== null || simulation.quakecSource() !== null);
  }

  private async autosaveLevel(): Promise<void> {
    if (!this.levelRecoveryAvailable(this.simulation, this.options) || this.saveUnavailable("autosave") !== null
      || this.sourceCvars()?.variableValue("sv_autosave") === 0) return;
    const directory = join(this.saveDirectory, this.content.catalog.product(this.content.recipe.map.entities.content).expectation.id);
    try {
      await mkdir(directory, { recursive: true });
      const path = join(directory, "autosave.sav");
      await this.saveGame(path);
      this.host.print(`Autosaved ${path}.\n`);
    } catch (error) { this.host.print(`Autosave failed: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { this.timedAutosave.completed(); }
  }

  private async advanceAutosave(milliseconds: number): Promise<void> {
    const cvars = this.sourceCvars();
    if (cvars === null) return;
    const interval = cvars.variableValue("sv_autosave_interval") * 1000;
    if (!Number.isFinite(interval) || interval <= 0 || cvars.variableValue("sv_autosave") === 0) return;
    if (interval !== this.timedAutosave.intervalMilliseconds) this.timedAutosave = new TimedAutosave(interval);
    const eligible = this.levelRecoveryAvailable(this.simulation, this.options) && this.saveUnavailable("autosave") === null
      && this.worldOperation === "idle" && this.campaignMovie === null && this.pendingTeamArena === null && this.pendingMap === null
      && this.pendingRestart === null && this.pendingTransition === null && this.pendingSave === null && this.saveOperation === null;
    if (this.timedAutosave.advance(milliseconds, eligible)) {
      try { await this.autosaveLevel(); } finally { this.timedAutosave.completed(); }
    }
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
    private readonly localSeats: Map<ClientId, SessionSeat>,
    private readonly networkPlayerIdentities: Map<ClientId, { readonly seat: number; readonly socialId: string }>, inputConfig: ConfigStore,
    private readonly ownership: { readonly kind: "owned" } | { readonly kind: "borrowed"; readonly client: ClientBootstrap }) {
    this.inputConfig = inputConfig;
    this.keys = ownership.kind === "borrowed" ? ownership.client.keys : new ApplicationKeys(text => host.print(text));
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

  private static nativeCommandContext(content: LoadedApplicationContent, session: CommandContext["session"]): CommandContext {
    const prepared = content.preparedQ2Game;
    if (prepared === null) throw new Error("Native source command has no selected game module");
    const execution = prepared.execution;
    return { session, origin: { kind: "server-console" }, producer: { kind: "game-module", module: {
      id: execution.owner.provider, artifactPath: execution.artifact.requestedPath,
      digest: execution.artifact.digest, revision: execution.artifact.digest,
    } } };
  }

  private static async guestOptions(content: LoadedApplicationContent, options: ApplicationOptions, host: ApplicationHost,
    commands: () => CommandBuffer, graph: SourceDebugGraph, nativeCommand?: (text: string) => undefined): Promise<Pick<SimulationOptions, "q3Guest" | "q2Guest" | "weaponBehaviorClock" | "weaponBehaviorRealTime">> {
    const realTime: NonNullable<SimulationOptions["weaponBehaviorRealTime"]> = output => {
        const now = new Date(), year = now.getFullYear();
        output?.({ second: now.getSeconds(), minute: now.getMinutes(), hour: now.getHours(), day: now.getDate(),
          month: now.getMonth(), year: year - 1900, weekday: now.getDay(),
          yearDay: Math.trunc((Date.UTC(year, now.getMonth(), now.getDate()) - Date.UTC(year, 0, 1)) / 86400000),
          isDst: now.getTimezoneOffset() < Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset()) ? 1 : 0 });
        return Math.trunc(now.getTime() / 1000);
      };
    const components = {
      ...(content.preparedWeaponBehaviors.some(entry => entry.kind === "qvm") || content.preparedQvmGrapple !== null ? { weaponBehaviorRealTime: realTime } : {}),
      ...(content.preparedQvmGrapple === null ? {} : { preparedQvmGrapple: content.preparedQvmGrapple }),
      ...(content.preparedWeaponBehaviors.some(entry => entry.kind === "rerelease-native") || content.recipe.mods?.some(mod => mod.declaration.runtime === "native") === true ? { weaponBehaviorClock: {
        nowMilliseconds: () => Math.trunc(performance.now()), performanceCounter: () => BigInt(Math.trunc(performance.now() * 1000)), performanceFrequency: 1_000_000n } } : {}) };

    if (content.preparedQ2Game !== null) {
      const product = content.catalog.product(content.recipe.map.entities.content);
      const directory = product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory);
      mkdirSync(directory, { recursive: true });
      const writable = classicGuestFiles(directory), installed = product.looseRoot === null ? null : classicGuestFiles(product.looseRoot);
      const callbacks: Pick<NonNullable<SimulationOptions["q2Guest"]>, "capabilities" | "print" | "addCommand" | "debugGraph"> = {
        capabilities: { nowMilliseconds: () => Math.trunc(performance.now()), performanceCounter: () => BigInt(Math.trunc(performance.now() * 1000)), performanceFrequency: 1_000_000n,
          openFile: (path, mode) => writable(path, mode) ?? (mode.write ? null : installed?.(path, mode) ?? null),
          standardOutput: (_stream, bytes) => host.print(new TextDecoder().decode(bytes)) },
        print: text => host.print(text), addCommand: text => { if (nativeCommand !== undefined) return nativeCommand(text); const owner = commands(); owner.append(text, Application.nativeCommandContext(content, owner.context.session)); return undefined; },
        debugGraph: (value, color) => { graph.add(value, color); return undefined; },
      };
      const prepared = content.preparedQ2Game;
      if (prepared.edition === "classic") return { ...components, q2Guest: { ...callbacks, edition: "classic", prepared } };
      const mounts = await content.forContent(prepared.execution.owner.content);
      const localization = await loadServerLocalizationResources("english", async path => (await mounts.open(path))?.bytes ?? null, "q2-rerelease");
      return { ...components, q2Guest: { ...callbacks, edition: "rerelease", prepared,
        localize: (text, arguments_) => q2LocalizedText(localization, text, arguments_),
        clipboard: options.dedicated ? { kind: "dedicated" } : { kind: "client", write: writeSdlClipboard },
      } };
    }
    if (content.preparedQ3Game === null) return components;
    if (!options.dedicated && options.network.kind !== "offline") throw new Error("Local Q3 guests require offline operation");
    const product = content.catalog.product(content.recipe.map.entities.content);
    return { ...components, q3Guest: {
      prepared: content.preparedQ3Game,
      writable: new UserFileStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory)),
      gameDirectory: basename(product.expectation.contentDirectory), print: text => host.print(text),
      common: { milliseconds: () => Math.trunc(performance.now()), realTime, commands: { executeNow: text => { commands().executeNow(text); }, append: text => commands().append(text), insert: text => commands().insert(text) } },
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
    const originalHost = host, originalPrint = (text: string): void => originalHost.print(text), operatorOutput: { write: ((text: string) => void) | null } = { write: null };
    host = { ...host, print: text => { (operatorOutput.write ?? originalPrint)(text); return undefined; } };
    if ((options.network.kind === "qw-client" || options.network.kind === "q1-client" || options.network.kind === "q2-client" || options.network.kind === "q3-client" || options.network.kind === "unified-client")) throw new Error("Remote clients require RemoteApplication without a local simulation");
    if (initialSave !== undefined && options.dedicated) requireComponentClientPresentation(initialSave);
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
    let catalog = preparation.content.catalog;
    try {
      options = recipe === undefined ? resolveApplicationMovement(catalog, options) : applicationOptionsForRecipe(options, { catalog, recipe });
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
      const networkPlayerIdentities = new Map<ClientId, { readonly seat: number; readonly socialId: string }>();
      let application: Application | null = null;
      let guestConsole: CommandBuffer | null = null;
      const modCommands = new ModCommands({ context: { session: session.session, origin: { kind: "server-console" } }, commands: () => guestConsole });
      let startup: Awaited<ReturnType<typeof prepareInitialConfiguration>> | null = null;
      let startupDemos: Application["ownedDemos"] = null;
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
            if (options.q3MapLaunch !== undefined) applyQ3MapLaunch(borrowedSource, options.q3MapLaunch);
            const resolved = resolveStartupRules(options, borrowedSource, options.q3MapLaunch?.maxClients ?? defaultCapacity, definitions, options.q3MapLaunch === undefined);
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
          const prepare = (nextFrame: () => Promise<void>) => prepareInitialConfiguration(options, configuration, session, identity, localSeats, inputConfig, host, sourceArchive, defaultCapacity, nextFrame, prepared => {
            const service = localWorldDemoCommands({ dedicated: options.dedicated, commands: prepared.commands,
              source: () => {
                if (application === null) return prepared.source;
                const current = application.sourceCvars();
                if (current === null) throw new Error("Local demo commands require the active world's source cvars");
                return current;
              },
              print: text => {
                if (application === null || application.graphical === null) host.print(text);
                else application.graphical.input.print(text, prepared.commands.executionContext);
              } });
            startupDemos = { service, release: service.attach(prepared.commands) };
          });
          startup = host.loading?.nextFrame === undefined ? await serviceLoading(prepare, () => {}) : await prepare(host.loading.nextFrame);
        }
        if (startup !== null) options = startup.options;
        if (initialSave === undefined) {
          const configuredSource = borrowedSource ?? startup?.prepared.source;
          if (configuredSource !== undefined) options = configuredWeaponBehaviorOptions(options, configuredSource);
          if (recipe !== undefined) {
            const selected = await prepareConfiguredApplicationRecipe(catalog, options, recipe);
            catalog = selected.catalog; recipe = selected.recipe;
          }
        }
        host.loading?.stage("Loading map...");
        const content = preparation.kind === "restored" ? preparation.content : await loadApplicationContent(options, recipe, undefined, catalog);
        const nativeContext = Application.nativeCommandContext.bind(null, content, session.session);
        const nativeCommand = (text: string): undefined => {
          modCommands.append(text, nativeContext(), Application.contentDialect(content));
          return undefined;
        };
        if (preparation.kind === "borrowed" && profileConfiguration === null) await preparation.content.close();
        loadedContent = content;
        if (content.q3Product !== null) options = { ...options, q3Product: content.q3Product };
        if (initialSave === undefined) {
          const source = borrowedSource ?? startup?.prepared.source;
          const values = source?.snapshots().map(value => ({ name: value.name, value: value.latchedValue ?? value.value })) ?? sourceArchive;
          preflightApplicationMatch(content, options, [...values,
            ...(options.teamArenaSkirmish === undefined ? [] : teamArenaSourceCvars(options.teamArenaSkirmish, values)), ...(options.q3MapLaunch?.cvars ?? [])]);
        }
        host.loading?.stage("Preparing world...");
        const monsterNavigation = await preloadApplicationMonsterNavigation(content);
        const authoredStart = initialSave === undefined && options.authoredCampaignStart === true
          ? authoredCampaignStart(await content.catalog.authoredStartsFor(content.recipe.map.entities.content), options.map) : null;
        const maxClients = Math.max(startup?.maxClients ?? savedSettings?.maxClients ?? options.teamArenaSkirmish?.maxClients ?? borrowedCapacity,
          ...[...localSeats.keys()].map(client => client.slot + 1));
        if (borrowedSource !== null) borrowedSource.set(borrowedSource.dialect === "q3" ? "sv_maxclients" : "maxclients", String(maxClients), true);
        const candidateGraph = new SourceDebugGraph();
        const loadSource = async (nextFrame: () => Promise<void>) => loadSimulation({ dedicated: options.dedicated, sourceArchive,
          ...(authoredStart === null ? {} : { startItems: authoredStart.startItems,
            ...(authoredStart.target.kind === "map" ? { initialSpawnPoint: authoredStart.target.spawnPoint, q2NextServer: q2NextServerCommand(authoredStart.target) } : {}) }),
          ...(borrowedSource !== null ? { sourceRegistry: borrowedSource } : startup === null ? {} : { sourceRegistry: startup.prepared.source }),
          ...(ownership.kind !== "borrowed" || initialSave !== undefined || options.teamArenaSkirmish === undefined
            || options.teamArenaSkirmish.cvars.every(setting => borrowedSource?.variableString(setting.name) === setting.value)
            ? {} : { q3Cvars: teamArenaSourceCvars(options.teamArenaSkirmish, borrowedSource?.snapshots() ?? sourceArchive) }),
          ...await Application.guestOptions(content, options, host, guestCommands, candidateGraph, nativeCommand), prepareRereleaseNavigation: simulation => createApplicationBotNavigation({ content, simulation }), ...(content.preparedQuakeC === null ? {} : { preparedQuakeC: content.preparedQuakeC }), ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity, weaponBehaviors: content.preparedWeaponBehaviors, recipe: content.recipe, world: content.world, mounts: content.mounts,
          preparedMods: content.preparedMods, enabledMods: content.recipe.mods?.map(mod => mod.selection) ?? [], modCommands,
          modFiles: new ModUserFiles(options.userContentRoot ?? defaultUserContentRoot()),
          skill: options.skill, mode: options.mode, seed: options.seed, ...(options.serverProfile === undefined ? {} : { serverProfile: options.serverProfile }),
          ...(initialSave === undefined ? {} : { restore: initialSave, restoredClients: [...restoredClients.values()].map(client => client.id) }),
          maxClients,
          promptSupported: client => !options.dedicated && localSeats.has(client),
          playerIdentity: client => networkPlayerIdentities.get(client) ?? ({ seat: localSeats.get(client)?.id.index ?? 0, socialId: "" }) }, nextFrame);
        const simulation = host.loading?.nextFrame === undefined ? await serviceLoading(loadSource, () => {}) : await loadSource(host.loading.nextFrame);
        if (ownership.kind === "owned") session.attachWorld(simulation);
        if (options.botSkill !== undefined) {
          const source = simulation.q3Source();
          if (source === null) throw new Error("--bot-skill requires the Quake III game provider");
          source.host.cvars.set("g_spSkill", String(options.botSkill), true);
        }
        const { authoredCampaignStart: consumedCampaignStart, q3MapLaunch: consumedMapLaunch, ...retainedOptions } = options;
        application = new Application(retainedOptions, content, session, simulation, host, identity, localSeats, networkPlayerIdentities, inputConfig, ownership);
        application.ownedDemos = startupDemos;
        application.operatorOutput = operatorOutput;
        application.operatorState = await ServerOperatorState.open(Application.sourceConfig(options, content), "settings/server-operator.json");
        application.debugGraph = candidateGraph;
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
          application.campaignUnit.restore(initialSave);
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
        modCommands.flush();
        await application.prepareGuestBots(content, simulation);
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
          application.imageSettings ??= await ApplicationImageSettings.open({ audioOutputFormat: (await loadAudioSettings(application.inputConfig)).outputFormat ?? defaultAudioOutputFormat, deferPersistence: true, context: { session: session.session, origin: { kind: "local-console" } },
            dialect: application.sourceDialect(), gamma: options.gamma, ...(options.renderWorker === undefined ? {} : { renderWorker: options.renderWorker }), ...(options.displayOverrides === undefined ? {} : { displayOverrides: options.displayOverrides }), ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }), print: text => {
              host.print(text); for (const local of frontend.graphical?.input.locals ?? []) local.console.print(text);
            } });
          application.releaseViewCvars = application.imageSettings.bindViewSettings(application.viewSettings);
          await application.openGraphical(initialSave);
        }
        if (ownership.kind === "borrowed") {
          if (borrowedImages === null) throw new Error("Borrowed source has no image candidate");
          await application.openNetwork();
          await application.publishBorrowed(ownership.client, borrowedImages);
        } else { application.sourcePublished = true; application.publishKeys(); }
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
        await application.rankingFrame();
        if (initialSave === undefined && ownership.kind === "owned") await application.commands();
        host.print(`Loaded ${content.recipe.map.geometry.requestedPath} with ${content.recipe.movement.provider} and ${content.recipe.character.appearance.provider}.\n`);
        application.enableStartupPersistence();
        if (initialSave === undefined) {
          if (options.teamArenaSkirmish !== undefined) application.startTeamArenaSkirmish(options.teamArenaSkirmish);
          await application.autosaveLevel();
          if (authoredStart !== null && authoredStart.target.kind !== "map") await application.advanceQ2Travel(authoredStart.target, simulation.captureTravel());
        }
        else application.requestRestoredScores();
        return application;
      } catch (error) {
        const errors: unknown[] = [error];
        if (application !== null) {
          try { if (initialSave !== undefined) application.simulation.q3Guest()?.discard(); await application.close(); }
          catch (cleanup) { errors.push(cleanup); }
        } else {
          for (const close of [() => startupDemos?.release(), () => ownership.kind === "owned" ? session.close() : undefined,
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

  private async prepareGuestBots(content: LoadedApplicationContent, simulation: SharedSimulation): Promise<void> {
    const guest = simulation.q3Guest();
    if (guest === null) return;
    const assets = await loadApplicationBotAssets(content, simulation);
    const selected = await createApplicationBotNavigation({ content, simulation });
    const authority = createQ3ApplicationServerHost({ session: this.session, simulation, content, mode: "restore", print: text => this.host.print(text) });
    guest.attachBots({ selected,
      library: { files: assets.files, random: { nextInt: () => simulation.random.nextInteger() }, debug: false,
        milliseconds: () => Math.trunc(simulation.timeSeconds * 1000), print: (_severity, text) => { this.host.print(text); return undefined; },
        openLog: openApplicationBotLog, resumeLog: resumeApplicationBotLog },
      createClient: slot => {
        if (this.session.clientAt(slot) !== null) return null;
        const client = this.session.createClient(slot); client.connect("loopback"); return client.id;
      },
      freeClient: client => { this.session.closeClient(client); },
      snapshotEntities: player => authority.snapshot(player).entities.map(entity => entity.number),
    });
  }

  private async createBots(content: LoadedApplicationContent, simulation: SharedSimulation,
    setup: Pick<ApplicationBotsOptions, "clients" | "restart" | "restore"> & {
      readonly requested?: boolean; readonly commands?: Pick<CommandBuffer, "insert"> | null;
    } = {}): Promise<ApplicationBotService | null> {
    const { clients = [], restart = false, requested = false, commands = this.sourceCommands, restore } = setup;
    if (simulation.q3Source() === null && clients.length === 0 && !requested && restore === undefined) return null;
    const unsupported = botAdmissionError(simulation);
    if (unsupported !== null) {
      if (clients.length !== 0 || requested || restore !== undefined) throw new Error(unsupported);
      return null;
    }
    const assets = await loadApplicationBotAssets(content, simulation);
    const navigation = simulation.rereleaseNavigation() ?? await createApplicationBotNavigation({ content, simulation });
    const configuration = simulation.q1Source()?.cvars ?? simulation.q2ServerCvars() ?? undefined;
    return createApplicationBots({ session: this.session, simulation, files: assets.files, navigation, ...(restore === undefined ? { clients, restart } : { restore }), automaticFrame: true,
      ...(configuration === undefined ? {} : { configuration }),
      leafCount: content.world.leaves.length, print: text => { this.host.print(text); },
      insertConsoleCommand: text => {
        if (commands === null) throw new Error("Bot console has no source command buffer");
        commands.insert(text);
      }, openLog: openApplicationBotLog, resumeLog: resumeApplicationBotLog }, assets);
  }

  get frontendSettings(): FrontendPreferenceOverrides {
    const current = this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio);
    return current === null || this.frontendBaseline === null ? this.frontendOverrides : changedFrontendPreferences(this.frontendBaseline, current, this.frontendOverrides);
  }
  get frontendValues(): FrontendPreferenceValues | null { return this.graphical === null ? null : readFrontendPreferences(this.graphical.input, this.graphical.audio); }
  get botClients(): readonly ApplicationBotClient[] { return this.bots?.clients() ?? []; }
  get frameCount(): number { return this.frames; }
  get finished(): boolean { return this.stopping || this.closed || this.options.frameLimit !== null && this.frames >= this.options.frameLimit; }
  get clientCommandsBlocked(): boolean { return this.captureBlocksTransition() || this.videoRestart?.pending === true; }
  private get videoRestart(): ApplicationVideoRestart | null { return this.ownership.kind === "borrowed" ? this.ownership.client.videoRestart : this.ownedVideoRestart; }
  pumpClientInput(): void { this.graphical?.input.pump(false); }
  advanceClientStartup(): Promise<boolean> {
    return this.clientCommandsBlocked ? Promise.resolve(true)
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
  get networkAddress(): ApplicationNetworkAddress | null { return this.network?.address ?? null; }
  get networkWire(): WireSelection | null { return this.network?.server.wire ?? null; }

  async returnToLobby(): Promise<void> {
    if (this.host.lobby === undefined) throw new Error("This session has no retained lobby");
    await this.host.lobby.returnToLobby();
  }
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
    const player = this.localPlayers.find(player => player.seat.id.equals(event.seat));
    if (player !== undefined && !this.simulation.actors.isLive(player.actor)) return false;
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
    for (const name of ["save", "load", "map", "say", "addbot", "removebot", "botlist"]) commands.register(name, invocation => this.queueCommand(name, invocation.args, null), saveCommandDocumentation(name));
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
    return { localPlayerCapacity: () => {
      let available = 0;
      for (let slot = 0; slot < simulation.options.maxClients; slot++) if (this.session.clientAt(slot) === null) available++;
      return this.localSeats.size + available;
    }, readScript: path => content.mounts.open(path).then(resource => resource?.bytes),
    readMountedScript: sourceScriptReader(content.catalog, content.mounts, content.recipe.engineBehavior.content),
      startupReader: (scripts, options) => Application.startupScriptReader(content, options, scripts),
      ...(this.host.llm === undefined ? {} : { llm: this.host.llm }), quit: () => { if (localGuest !== null && localGuest !== this.localGuest) throw new Error("Guest candidate requested quit"); return this.requestQuit(); },
      execute: (name, arguments_, seat, source) => candidateAction !== undefined ? candidateAction({ target: "application", name, arguments_: [...arguments_], seat, ...(source === undefined ? {} : { source }) })
        : localGuest === null ? this.queueCommand(name, arguments_, seat, source)
        : this.queueLocalGuestCommand(localGuest, { target: "application", name, arguments_: [...arguments_], seat, ...(source === undefined ? {} : { source }) }), print: text => this.host.print(text),
      arsenalImpulseProvider: seat => {
        const client = [...this.localSeats].find(([, local]) => local.id.equals(seat))?.[0];
        const actor = client === undefined ? undefined : simulation.players().find(actor => simulation.playerClient(actor)?.equals(client));
        const player = actor === undefined ? null : simulation.movementPlayer(actor);
        return player !== null && (simulation.q1Source() !== null || player.arsenal.state.kind === "q1") ? player.arsenal.provider : null;
      },
      bindingItems: seat => {
        const client = [...this.localSeats].find(([, local]) => local.id.equals(seat))?.[0];
        const player = client === undefined ? undefined : simulation.players().find(actor => simulation.playerClient(actor)?.equals(client));
        return player === undefined ? [] : simulation.playerUi(player).items;
      },
      bindingCapabilities: () => ({ chat: simulation.q1Source() !== null || simulation.q2Source() !== null || simulation.q2Native() !== null || simulation.q3Source() !== null || simulation.q3Guest() !== null,
        scoreCommand: simulation.q2Source() !== null || simulation.q2Native() !== null ? "score" : simulation.q3Source() !== null || simulation.q3Guest() !== null ? "+scores" : null,
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
  private debugGraphSettings(): DebugGraphSettings {
    const cvars = this.sourceCvars();
    return { debuggraph: cvars?.variableValue("debuggraph") ?? 0, timegraph: cvars?.variableValue("timegraph") ?? 0,
      netgraph: cvars?.variableValue("netgraph") ?? 0, height: cvars?.variableValue("graphheight") ?? 32,
      scale: cvars?.variableValue("graphscale") ?? 1, shift: cvars?.variableValue("graphshift") ?? 0 };
  }

  private async createDebugGraphOverlay(assets: ApplicationAssets): Promise<(draw: Draw2D, view: Rect, components: ComponentDrawings) => void> {
    const provider = await assets.provider(assets.content.recipe.presentation.assets);
    return (draw, view, components) => {
      const settings = this.debugGraphSettings(), white = { kind: "image", name: "white", image: assets.world.shaders.textures.white.image } satisfies import("../../text/draw2d.ts").PictureAsset;
      const occupied = components.drawGraphs(draw, view, settings, white);
      if (provider.family === "q2" && occupied < view.height) {
        const palette = provider.palette;
        if (palette === null) throw new Error("Quake II debug graph requires its mounted palette");
        this.debugGraph.draw(draw, { ...view, height: view.height - occupied }, settings, index => debugGraphColor(palette, index), white);
      }
    };
  }

  private refreshApplicationTools(): void {
    const commands = this.sourceCommands;
    if (commands === null) return;
    const inputCommands = this.graphical?.input.commands ?? null;
    if (inputCommands !== this.modInputCommands) {
      this.releaseModInputCommands(); this.modInputCommands = inputCommands;
      const handler: CommandHandler = command => { this.modCommand(command, this.simulation); return undefined; };
      const installed = inputCommands?.register("modcmd", handler, { summary: "Run a command for one enabled component.", usage: "modcmd PRODUCT/COMPONENT_ID <command>", examples: ["modcmd addon/component echo ready"] }) ?? false;
      this.releaseModInputCommands = () => { if (installed) inputCommands?.unregister("modcmd", handler); };
    }
    if (this.tools === null) this.tools = new ApplicationTools(commands, {
      mounts: () => this.content.mounts, outputRoot: () => applicationCaptureRoot(this.options.userContentRoot),
      milliseconds: () => this.elapsed, cvars: () => this.sourceCvars(),
      frame: () => ({ frame: this.frames, milliseconds: this.elapsed, map: this.options.map,
        renderer: this.graphical?.renderer.diagnostics().backend ?? "headless", clients: this.simulation.players().length }),
      renderer: () => { if (this.graphical === null) throw new Error("Renderer is not active"); return this.graphical.renderer.diagnostics(); },
      shaders: sorted => { if (this.graphical === null) throw new Error("Renderer is not active"); return this.graphical.assets.materialRegistrations.snapshot(sorted); },
      resources: source => {
        let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
        const seat = origin.kind === "local-seat" ? origin.seat : this.localPlayers[0]?.seat.id;
        return seat === undefined ? null : this.graphical?.q3.get(seat)?.client.resourceDiagnostics() ?? null;
      },
      print: (text, source) => {
        if (source !== undefined && this.graphical !== null) this.graphical.input.print(text, source);
        else { this.host.print(text); for (const local of this.graphical?.input.locals ?? []) local.console.print(text); }
      },
    });
    this.tools.bind([commands, ...(this.graphical !== null && (this.sourcePublished || this.ownership.kind === "owned") ? [this.graphical.input.commands] : [])]);
  }

  private async bindSourceCommands(restoring = false): Promise<void> {
    const prepared = await this.prepareSourceCommands(this.simulation, this.content, restoring, request => { this.requestedCommands.push(request); return undefined; });
    this.publishSourceCommands(prepared);
  }

  private modCommand(command: CommandInvocation, simulation: SharedSimulation): void {
    const { selection, text } = readModCommand(command.raw);
    const mods = simulation.options.modCommands;
    if (mods === undefined) throw new Error("This world has no component command services");
    mods.execute(selection, text, command.source);
  }

  private publishSourceCommands(prepared: PreparedSourceCommands): void {
    const options = prepared.options;
    if (options === null) throw new Error("Published world requires source command bindings");
    this.releaseSourceCommands();
    this.sourceCommandBinding = { options };
    if (this.sourceCommands === null) {
      this.sourceCommands = new CommandBuffer({ dialect: options.dialect, context: options.context,
        cvarRouting: {
          owner: (name, source) => {
            const current = this.sourceCommandBinding?.options;
            const cvars = current?.cvarRouting?.owner(name, source) ?? current?.cvars;
            if (cvars === undefined) throw new Error("Published authority requires a source registry");
            return cvars;
          },
          visible: source => { const current = this.sourceCommandBinding?.options;
            return current?.cvarRouting?.visible(source) ?? (current?.cvars === undefined ? [] : [current.cvars]); },
        }, print: text => this.host.print(text),
        readScript: (name, source) => this.sourceCommandBinding?.options?.readScript?.(name, source),
        sourceCommand: (command, registered) => this.sourceCommandBinding?.options?.sourceCommand?.(command, registered) ?? false,
        clientGame: command => this.sourceCommandBinding?.options?.clientGame?.(command) ?? false,
        serverGame: command => this.sourceCommandBinding?.options?.serverGame?.(command) ?? false,
        forwardToServer: command => this.sourceCommandBinding?.options?.forwardToServer?.(command) });
    } else this.sourceCommands.setProfile(options.dialect, undefined);
    const releaseSource = prepared.activate(this.sourceCommands);
    const releaseDemos = this.ownedDemos?.service.attach(this.sourceCommands);
    this.releaseSourceCommands = () => { releaseDemos?.(); releaseSource(); };
    this.q2Console = prepared.q2Console;
    this.refreshApplicationTools();
  }

  private async prepareSourceCommands(simulation: SharedSimulation, content: LoadedApplicationContent, restoring: boolean, action: (request: ApplicationCommandRequest) => undefined): Promise<PreparedSourceCommands> {
    const mods = simulation.options.modCommands;
    const engineCommands = componentEngineCommands(Application.contentDialect(content), content);
    const queue = (name: string, args: readonly string[], seat: SeatId | null, source?: CommandContext): undefined => {
      if (source?.producer?.instance !== undefined && !engineCommands.has(name.toLowerCase()))
        throw new Error(`Command ${name} belongs to the primary world; component ${source.producer.module.id} has no declared command with that name`);
      return action({ target: "application", name, arguments_: [...args], seat, ...(source === undefined ? {} : { source }) });
    };
    const sourceAction = (name: string, args: readonly string[], source: CommandContext): undefined =>
      action({ target: "source", name, arguments_: [...args], seat: null, source });
    let program: ReturnType<CommandBuffer["prepareProgram"]> | null = null;
    let options: CommandBufferOptions | null = null;
    const bindings: ((commands: CommandBuffer) => () => void)[] = [];
    const readSourceScript = sourceScriptReader(content.catalog, content.mounts, content.recipe.engineBehavior.content);
    const create = (selected: CommandBufferOptions): CommandBuffer => {
      let commands: CommandBuffer;
      options = { ...selected,
        cvarRouting: {
          owner: (name, source) => {
            const registry = mods?.cvars(source) ?? selected.cvarRouting?.owner(name, source) ?? selected.cvars;
            if (registry === undefined) throw new Error("Source command has no cvar registry"); return registry;
          },
          visible: source => { const registry = mods?.cvars(source);
            return registry === undefined || registry === null ? selected.cvarRouting?.visible(source) ?? (selected.cvars === undefined ? [] : [selected.cvars]) : [registry]; },
        },
        readScript: (name, source) => {
          if (source.producer?.instance !== undefined) return mods?.readScript(name, source);
          return selected.readScript?.(name, source) ?? readSourceScript(name).then(bytes => bytes === undefined ? undefined : new TextDecoder().decode(bytes));
        },
        sourceCommand: (command, registered) => {
          const name = (command.argv[0] ?? "").toLowerCase();
          if (command.source.producer?.instance === undefined || engineCommands.has(name)) return false;
          if (mods?.handles(name, command.source)
            || name === "sv" && mods?.cvars(command.source)?.dialect.startsWith("q2")) {
            if (mods?.invoke(command) !== true) throw new Error(`Component command was not handled: ${command.raw}`);
            return true;
          }
          if (registered) throw new Error(`Command ${name} belongs to the primary world; component ${command.source.producer.module.id} has no declared command with that name`);
          return false;
        },
        clientGame: command => command.source.producer?.instance === undefined ? selected.clientGame?.(command) : false,
        serverGame: command => command.source.producer?.instance === undefined ? selected.serverGame?.(command)
          : mods?.invoke(command) ?? false,
        forwardToServer: command => {
          if (command.source.producer?.instance === undefined) return selected.forwardToServer?.(command);
          if (command.dialect === "q3" || mods?.invoke(command) !== true) this.host.print(`Unknown component command: ${command.raw}\n`);
          return undefined;
        },
      };
      if (this.sourceCommands === null) commands = new CommandBuffer(options);
      else { program = this.sourceCommands.prepareProgram(options); commands = program.commands; }
      const worldCommands = ["changelevel", "gamemap", "save", "load"];
      const operatorNames = sourceAdministrationCommandNames(selected.dialect).filter(name =>
        !worldCommands.includes(name) && name !== "sv" && name !== "addlrconcmd" && name !== "dellrconcmd" && name !== "listlrconcmds"
        && !(selected.dialect === "q3" && name !== "heartbeat"));
      for (const name of operatorNames) register(commands, name, invocation => {
        if (name === "setmaster" && this.options.dedicated && (selected.dialect === "q2-classic" || selected.dialect === "q2-rerelease"))
          selected.cvars?.set("public", "1");
        return queue(name, invocation.args, null, invocation.source);
      });
      if (selected.dialect === "q2-classic" || selected.dialect === "q2-rerelease") for (const name of ["addlrconcmd", "dellrconcmd", "listlrconcmds"])
        register(commands, name, invocation => { if (this.operatorState === null) throw new Error("Server operator is unavailable");
          this.operatorState.limitedRconCommand(name, invocation.argsText, text => this.host.print(text)); return undefined; });
      for (const name of applicationAudioCommands) register(commands, name, invocation => {
        let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
        return queue(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
      });
      register(commands, "modcmd", command => { this.modCommand(command, simulation); return undefined; });
      for (const name of worldCommands) register(commands, name, command => queue(name, command.args, null, command.source));
      return commands;
    };
    const register = (commands: CommandBuffer, name: string, handler: CommandHandler): void => {
      commands.register(name, handler, saveCommandDocumentation(name));
      bindings.push(owner => {
        const installed = owner.register(name, handler, saveCommandDocumentation(name));
        return () => { if (installed) owner.unregister(name, handler); };
      });
    };
    const bind = (commands: CommandBuffer, install: (commands: CommandBuffer) => () => void): void => { install(commands); bindings.push(install); };
    const prepared = (): PreparedSourceCommands => ({ commands: sourceCommands, program, q2Console, options,
      activate: commands => {
        const disposers = bindings.map(install => install(commands));
        return () => { for (const dispose of [...disposers].reverse()) dispose(); };
      } });
    const timeCvars = this.sourceCvars(simulation);
    if (timeCvars !== null) {
      registerFrameTimeCvars(timeCvars);
      registerSourceAdministrationCvars(timeCvars);
      const register = (name: string, defaultValue: string, flags: number): void => {
        if (!timeCvars.dialect.startsWith("q1") || timeCvars.find(name) === undefined || timeCvars.isConsoleCreated(name))
          timeCvars.register(name, defaultValue, flags);
        else timeCvars.addFlags(name, flags);
      };
      register("cl_avidemo", "0", 0);
      register("cl_forceavidemo", "0", 0);
      register("debuggraph", "0", 0);
      register("timegraph", "0", 0);
      register("netgraph", "0", 0);
      register("graphheight", "32", 0);
      register("graphscale", "1", 0);
      register("graphshift", "0", 0);
      if (this.levelRecoveryAvailable(simulation, this.options)) {
        register("sv_autosave", "1", CvarFlag.Archive);
        register("sv_autosave_interval", "30", CvarFlag.Archive);
      }
    }
    let sourceCommands: CommandBuffer | null = null;
    let q2Console: ApplicationQ2Console | null = null;
    const nativeQ2 = simulation.q2Native();
    if (nativeQ2 !== null) {
      const commands = create({ dialect: nativeQ2.edition === "classic" ? "q2-classic" : "q2-rerelease", cvars: nativeQ2.services.options.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => this.host.print(text) });
      for (const name of ["quit", "map"]) register(commands, name, invocation => queue(name, invocation.args, null, invocation.source));
      register(commands, "sv", invocation => { if (["addip", "removeip", "listip", "writeip"].includes(invocation.args[0] ?? "")) return queue("sv", invocation.args, null, invocation.source); q2GameCallback(() => nativeQ2.serverCommand(invocation.argv, invocation.argsText)); return undefined; });
      sourceCommands = commands;
      bind(commands, owner => this.bindServerSettingCommand(owner, simulation));
      return prepared();
    }
    if (simulation.q2Source() !== null) {
      q2Console = new ApplicationQ2Console({ simulation: () => simulation, content: () => content,
        print: text => { this.host.print(text); return undefined; }, execute: (name, args, source) => queue(name, args, null, source) });
      sourceCommands = create({ dialect: q2Console.cvars.dialect, cvars: q2Console.cvars,
        context: { session: this.session.session, origin: { kind: "server-console" } }, print: text => this.host.print(text) });
      const console = q2Console; bind(sourceCommands, commands => console.bind(commands));
      register(sourceCommands, "sv", invocation => queue("sv", invocation.args, null, invocation.source));
      if (this.ownership.kind === "owned") for (const name of ["mvdrecord", "mvdstop", "serverrecord", "serverstop"]) register(sourceCommands, name, invocation => queue(name, invocation.args, null, invocation.source));
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
        if (invocation.source.producer?.instance !== undefined) { invocation.executeScript(); return undefined; }
        if (guest.game.module.interpreter.isActive) throw new Error("Q3 guest immediate exec is unsupported; append the script command");
        queue("exec", invocation.args, null, { session: invocation.source.session, origin: invocation.source.origin });
        return undefined;
      });
      for (const name of [...q3ProductMapCommands(content.q3Product?.policy ?? { kind: "retail" }), "map_restart", "addbot", "removebot", "botlist", "kick", "cinematic"])
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
    for (const name of q3ProductMapCommands(content.q3Product?.policy ?? { kind: "retail" }))
      register(commands, name, invocation => queue(name, invocation.args, null, invocation.source));
    register(commands, "map_restart", invocation => queue("map_restart", invocation.args, null, invocation.source));
    register(commands, "cinematic", invocation => queue("cinematic", invocation.args, null, invocation.source));
    prepareQ2MatchReports(simulation, restoring);
    await this.prepareBaseArenaProgress(simulation, content, restoring);
    if (this.isTeamArenaSkirmish(simulation) || this.baseArenaProgress.has(simulation))
      register(commands, "postgame", invocation => sourceAction("postgame", invocation.args, invocation.source));
    if (this.baseArenaProgress.has(simulation)) {
      register(commands, "spPostgame", invocation => sourceAction("spPostgame", invocation.args, invocation.source));
      register(commands, "iamacheater", invocation => sourceAction("arena-unlock", invocation.args, invocation.source));
      register(commands, "iamamonkey", invocation => sourceAction("arena-medals", invocation.args, invocation.source));
      register(commands, "arena-reset", invocation => sourceAction("arena-reset", invocation.args, invocation.source));
    }
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

  private async requestRestart(args: readonly string[]): Promise<undefined> {
    const source = this.simulation.q3Source();
    const guest = this.simulation.q3Guest();
    if (source === null && guest === null) throw new Error("map_restart requires the Quake III game provider");
    if (this.lastRestartFrame === this.frames || this.pendingRestart !== null) return undefined;
    const delay = args[0] === undefined ? 5 : nativeAtoi(args[0]);
    const cvars = source?.host.cvars ?? guest?.state.cvars;
    const now = source?.host.now() ?? guest?.timeMilliseconds ?? this.elapsed;
    const scheduled = delay !== 0 && cvars?.variableValue("g_doWarmup") === 0;
    this.pendingRestart = scheduled ? (now + Math.imul(delay, 1000)) | 0 : now;
    if (scheduled && source !== null) source.host.configstrings.set(5, String(this.pendingRestart));
    else if (scheduled && guest !== null) await guest.setConfigstring(5, String(this.pendingRestart));
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
    const locals = this.localPlayers.map(player => ({ actor: player.actor, seat: player.seat.id }));
    const reports = q2MatchReports(this.simulation, locals);
    if (reports.length > 0) {
      this.playerProgress ??= PlayerProgressStore.open(join(this.inputConfig.root, "player-progress.json"));
      const progress = await this.playerProgress;
      for (const report of reports) await progress.record(report);
    }
    const leaving = q1SessionDepartures(events, locals);
    if (leaving.length > 0 && leaving.length === locals.length) {
      if (this.host.lobby === undefined) this.requestQuit();
      else await this.returnToLobby();
    }
    else for (const seat of leaving) {
      if (!this.requestedCommands.some(command => command.name === "local_drop" && command.seat?.equals(seat)))
        this.queueCommand("local_drop", [], seat);
    }
    const droppingSimulation = this.simulation;
    for (const request of droppingSimulation.takeModClientDrops()) {
      const { actor, client, reason } = request;
      if (this.simulation !== droppingSimulation || !droppingSimulation.playerClient(actor)?.equals(client)) continue;
      const localSeat = [...this.localSeats].find(([id]) => id.equals(client))?.[1];
      if (localSeat !== undefined && this.localSeats.size > 1) {
        await this.changeLocalPlayers("drop", [], localSeat.id);
        this.host.print(`${request.content}: client ${client.slot}: ${reason}\n`);
        continue;
      }
      await this.disconnectRankings(droppingSimulation, client);
      if (this.simulation !== droppingSimulation || !droppingSimulation.playerClient(actor)?.equals(client)) continue;
      if (this.bots?.disconnect(client.slot)) continue;
      if (await this.network?.server.disconnectClient(client, reason)) continue;
      const local = [...this.localSeats.keys()].some(id => id.equals(client));
      const guest = this.simulation.q3Guest(), player = guest?.player(client);
      if (guest !== null && player !== undefined && player !== null) await guest.disconnect(player);
      else this.simulation.disconnectPlayer(actor);
      this.session.closeClient(client); this.localSeats.delete(client);
      this.host.print(`${request.content}: client ${client.slot}: ${reason}\n`);
      if (local) this.requestQuit();
    }
    for (const source of events) {
      await this.recordPlayerProgress(source);
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
        if (source.event.kind === "restart-level") { this.pendingMap = mapResourcePath(source.event.map); this.pendingQ3Map = undefined; }
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
        const dropped = this.simulation.clientIdentities().find(client => client.slot === event.client);
        if (dropped !== undefined) await this.disconnectRankings(this.simulation, dropped);
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
      const library = new DemoLibrary(files.root, {
        listFiles: (directory, extension) => this.content.mounts.listFiles(directory, extension),
        read: async path => (await this.content.mounts.open(path))?.bytes,
      });
      const demo = await teamArenaDemo(this.options.map.replace(/^maps\//, "").replace(/\.bsp$/, ""), source.gameType,
        source.host.cvars.get("protocol")?.integerValue ?? 68, async path => await library.read(path) !== undefined);
      if (demo === null) this.teamArenaDemos.delete(this.simulation); else this.teamArenaDemos.set(this.simulation, demo);
    }
  }

  private standaloneRecording(): ClientDemoRecording {
    if (this.ownership.kind !== "owned") throw new Error("Borrowed sources use the retained client recorder");
    if (this.ownedRecording !== null) return this.ownedRecording;
    let feed: ClientRecordingFeed | null = null;
    this.ownedRecording = new ClientDemoRecording({
      root: () => { if (feed === null) throw new Error("Recording has no selected source"); return feed.root; },
      seed: async source => { feed = await this.prepareRecording(source); return feed.seed(); },
      attach: sink => { if (feed === null) throw new Error("Recording has no prepared feed"); return feed.attach(sink); },
      serverRecording: {
        seed: async source => { feed = this.prepareServerRecording(source); return feed.seed(); },
        attach: sink => { if (feed === null) throw new Error("Server recording has no prepared feed"); return feed.attach(sink); },
      },
      mvdRecording: {
        seed: async source => { feed = this.prepareMvdRecording(source); return feed.seed(); },
        attach: sink => { if (feed === null) throw new Error("Multiview recording has no prepared feed"); return feed.attach(sink); },
      },
      reconnectRecording: async () => { throw new Error("rerecord requires the retained client connection owner"); },
      print: text => this.host.print(text),
      stage: intent => { this.queueCommand(intent.kind === "stop" ? "stop" : intent.kind, intent.kind === "stop" || intent.kind === "mvdstop" || intent.kind === "serverstop" || intent.name === undefined ? [] : [intent.name], null, intent.source); },
    });
    return this.ownedRecording;
  }

  prepareMvdRecording(context: CommandContext): ClientRecordingFeed {
    if (context.session !== this.session.session) throw new Error("Multiview command belongs to another session");
    let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "remote-client") throw new Error("Multiview recording requires the local server console");
    const network = this.network;
    if (network?.kind !== "q2") throw new Error("mvdrecord requires a hosted Quake II server");
    const feed = network.server.mvdRecording;
    if (feed === undefined) throw new Error("The hosted Quake II server does not support multiview recording");
    const product = this.content.catalog.product(this.content.recipe.engineBehavior.content);
    return { root: product.userContent?.root ?? userProductDirectory(this.options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory),
      seed: () => feed.seed(), attach: sink => {
        if (this.closed || this.closing || this.network !== network) throw new Error("Multiview server was retired before attachment");
        return feed.attach(sink);
      } };
  }

  prepareServerRecording(context: CommandContext): ClientRecordingFeed {
    if (context.session !== this.session.session) throw new Error("Server demo command belongs to another session");
    let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "remote-client") throw new Error("Server demo recording requires the local server console");
    const network = this.network;
    if (network?.kind !== "q2") throw new Error("serverrecord requires a hosted Quake II server");
    const feed = network.server.serverRecording;
    if (feed === undefined) throw new Error("The hosted Quake II server does not support classic server demo recording");
    const product = this.content.catalog.product(this.content.recipe.engineBehavior.content);
    return { root: product.userContent?.root ?? userProductDirectory(this.options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory),
      seed: () => feed.seed(), attach: sink => {
        if (this.closed || this.closing || this.network !== network) throw new Error("Server demo source was retired before attachment");
        return feed.attach(sink);
      } };
  }

  async prepareRecording(context: CommandContext): Promise<ClientRecordingFeed> {
    if (context.session !== this.session.session) throw new Error("Recording command belongs to another session");
    let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "remote-client") throw new Error("Recording requires a local player");
    const requested = origin.kind === "local-seat" ? origin : null;
    const player = this.localPlayers.find(player => requested === null || player.seat.id.equals(requested.seat) && player.seat.client.id.equals(requested.client));
    if (player === undefined) throw new Error("Recording requires an active local player");
    if (this.recordingHost === null) {
      this.recordingHost = this.localGuest === null ? await this.networkHost() : { kind: "q3", host: this.localGuest.authority };
      if (this.recordingHost.kind === "q3" && this.localGuest === null) {
        const cvars = this.sourceCvars();
        if (cvars?.find("sv_serverid") === undefined) throw new Error("Q3 recording requires the published source epoch");
        await this.recordingHost.host.prepare(0, cvars.variableValue("sv_serverid"));
      }
      if (this.recordingHost.kind !== "q3") this.recordingHost.host.observe(this.simulation.currentOutput(), []);
    }
    this.recordingSeat = player.seat.id;
    const recording = this.localRecording ?? new LocalDemoRecording(() => this.localRecordingSource());
    this.localRecording = recording;
    const product = this.content.catalog.product(this.content.recipe.engineBehavior.content);
    return { root: product.userContent?.root ?? userProductDirectory(this.options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory),
      seed: () => recording.seed(), attach: sink => {
        if (this.closed || this.closing) throw new Error("Recording source was retired");
        const detach = recording.attach(sink); this.localRecordingActive = true;
        return () => { detach(); this.localRecordingActive = false; };
      } };
  }

  private localRecordingSource(): LocalRecordingSource {
    const host = this.recordingHost, local = this.graphical?.input.locals.find(local => this.recordingSeat?.equals(local.player.seat.id));
    if (host === null || local === undefined) throw new Error("Recorded local player is no longer active");
    const client = local.player.seat.client.id, world = this.simulation;
    switch (host.kind) {
      case "q1": return { kind: "q1", world, host: host.host, player: host.host.carriedPlayer(client), viewAngles: local.builder.viewAngles };
      case "qw": {
        const game = this.simulation.quakecSource();
        if (game?.kind !== "quakeworld") throw new Error("QW recording lost its source clock");
        return { kind: "qw", world, host: host.host, player: host.host.carriedPlayer(client), viewAngles: local.builder.viewAngles, seconds: game.timeSeconds };
      }
      case "q2": return { kind: "q2", world, host: host.host, player: host.host.carriedPlayer(client), protocol: host.host.protocol };
      case "q3": {
        const published = this.network?.kind === "q3" ? this.network.server.recordingSource : null;
        const cvars = this.sourceCvars();
        if (published === null && cvars?.find("sv_serverid") === undefined) throw new Error("Q3 recording lost its source epoch");
        return { kind: "q3", world, host: published?.host ?? host.host, player: (published?.host ?? host.host).carriedPlayer(client),
          serverId: published?.serverId ?? cvars?.variableValue("sv_serverid") ?? 0,
          snapshotServerBit: published?.snapshotServerBit ?? this.localSnapshotServerBit };
      }
    }
  }

  private operatorHost(): ServerOperatorHost {
    const cvars = this.sourceCvars();
    if (cvars === null) throw new Error("Server administration has no source cvars");
    return { dialect: cvars.dialect, cvars, dedicated: this.options.dedicated, print: text => this.host.print(text),
      send: (to, bytes) => this.operatorSend?.(to, bytes) ?? false,
      writeConfig: (name, text) => Application.sourceConfig(this.options, this.content).dump(name, text),
      heartbeat: () => { const server = this.network?.server; if (server !== undefined && "heartbeat" in server) server.heartbeat(performance.now()); } };
  }
  private async executeAdministration(text: string, output: (text: string) => void, limited = false): Promise<void> {
    const commands = this.sourceCommands;
    if (commands === null) throw new Error("Server administration has no source command owner");
    if (this.operatorOutput.write !== null) throw new Error("Nested server administration is not supported");
    const pending = this.requestedCommands; this.requestedCommands = [];
    const restoreOutput = commands.bindOutput(output); this.operatorOutput.write = output;
    try {
      await commands.executeCommandAsync(text, { session: this.session.session, origin: { kind: "server-console" } }, () => this.commands(undefined, undefined, false), limited ? "none" : "source");
    } catch (error) {
      if (error instanceof Q3GameCallbackError || error instanceof Q2GameCallbackError || this.fatalWorldFailure) throw error;
      output(`${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      this.operatorOutput.write = null; restoreOutput();
      this.requestedCommands.unshift(...pending);
    }
  }

  private async networkHost(simulation = this.simulation, content = this.content, serverCount = this.nativeWorldCount): Promise<NativeServerHost> {
    const source = content.catalog.product(content.recipe.map.entities.content).expectation;
    if (this.options.q2Protocol !== undefined && source.family !== "q2") throw new Error("--q2-protocol requires a Quake II source game");
    if (this.options.q1Protocol !== undefined && source.family !== "q1") throw new Error("--q1-protocol requires a Quake I source game");
    if (this.options.network.kind === "q2-server" && source.family !== "q2") throw new Error("--listen-q2 requires a Quake II source game; use --listen for the selected native protocol");
    const cvars = this.sourceCvars(simulation), state = this.operatorState;
    if (cvars === null || state === null) throw new Error("Server administration was not initialized");
    const shared = { state, cvars, dedicated: this.options.dedicated, execute: (text: string, output: (text: string) => void) => this.executeAdministration(text, output),
      record: (event: { readonly address: NetworkAddress; readonly result: string }) => this.host.print(`Rcon ${addressKey(event.address)}: ${event.result}\n`) };
    const administration = sourceServerAdministration({ ...shared, dialect: cvars.dialect });
    const common = { session: this.session, simulation, content, print: (text: string): void => { this.host.print(text); } };
    switch (source.family) {
      case "q1": return source.edition === "quakeworld"
        ? { kind: "qw", host: await createQwApplicationServerHost({ ...common, serverCount, masters: () => administration.masters().filter(address => address.kind === "ipv4" || address.kind === "ipv6"),
          administration: { get rconPassword() { return administration.rconPassword(); }, blocked: administration.rejects,
            status: () => `${cvars.infoString(CvarFlag.ServerInfo)}\n`, log: () => null, executeAdmin: administration.execute } }) }
        : { kind: "q1", host: await createQ1ApplicationServerHost({ ...common, rejects: administration.rejects, protocol: this.options.q1Protocol ?? { kind: "q1-netquake", version: 15 } }) };
      case "q2": {
        const world = simulation.q2Native(), protocol = liveQ2Protocol(this.options, source.edition === "rerelease");
        const operator = { rconPassword: administration.rconPassword, profile: source.edition === "rerelease" ? "rerelease" : "classic",
          limitedRcon: () => state.limitedRcon(cvars), rconRateAllowed: now => state.rconRateAllowed(cvars, now, text => this.host.print(text)), rechargeRconRate: () => state.rechargeRconRate(),
          executeRcon: (text: string, limited: boolean, output: (text: string) => void) => this.executeAdministration(text, output, limited) } satisfies NonNullable<import("./network/types.ts").Q2ApplicationServerHost["administration"]>;
        const binding = { ...common, protocol, administration: operator, masters: administration.masters, rejects: administration.rejects,
          playerIdentity: (client: ClientId, identity: { readonly seat: number; readonly socialId: string } | null): void => {
            if (identity === null) this.networkPlayerIdentities.delete(client); else this.networkPlayerIdentities.set(client, identity);
          } };
        return { kind: "q2", host: world === null ? await createQ2ApplicationServerHost(binding) : world.edition === "classic"
          ? await createClassicQ2ApplicationServerHost({ ...binding, world }) : await createRereleaseNativeQ2ApplicationServerHost({ ...binding, world }) };
      }
      case "q3": {
        const host = await createQ3ApplicationServerHost({ ...common, administration });
        return { kind: "q3", host: { ...host, disconnect: async (player, reason) => {
          try { await this.disconnectRankings(simulation, player.client); }
          finally { await host.disconnect(player, reason); }
        } } };
      }
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
    this.recordingHost = next;
    switch (next.kind) {
      case "q1": if (network.kind !== "q1") throw new Error("Native Q1 host cannot replace another wire family"); network.server.changeWorld(next.host); return;
      case "qw": if (network.kind !== "qw") throw new Error("Native QW host cannot replace another wire family"); network.server.changeWorld(next.host); this.nativeWorldCount++; return;
      case "q2":
        if (network.kind !== "q2") throw new Error("Native Q2 host cannot replace another wire family");
        {
          const recorder = this.ownership.kind === "borrowed" ? this.ownership.client.recording : this.ownedRecording;
          if (recorder?.serverPath != null) await recorder.stopServer();
        }
        network.server.changeWorld(next.host); return;
      case "q3": if (network.kind !== "q3") throw new Error("Native Q3 host cannot replace another wire family"); await network.server.changeWorld(next.host); return;
    }
  }

  private async openNetwork(): Promise<void> {
    const selection = this.options.network;
    if (selection.kind === "unified-server") {
      const host = createUnifiedApplicationServerHost({ session: this.session, simulation: this.simulation, content: this.content, print: text => { this.host.print(text); } });
      const composition = await buildUnifiedComposition(this.content);
      const transport = await openApplicationTransport({ selection: { kind: "udp" }, family: "q2", host: selection.host, port: selection.port, limits: UNIFIED_DATAGRAM_LIMITS });
      try {
        this.network = { kind: "unified", address: transport.address, server: new UnifiedServerNetwork({ transport, host, composition, print: text => { this.host.print(text); } }) };
        this.host.print(`Listening for mixed-game peers on ${addressKey(transport.address)}.\n`);
      } catch (error) { transport.close(); throw error; }
      return;
    }
    if (selection.kind !== "q2-server" && selection.kind !== "native-server") {
      if (this.simulation.q2Native() !== null) this.recordingHost = await this.networkHost();
      return;
    }
    const selected = await this.networkHost();
    this.validateNetworkHost(selected);
    this.recordingHost = selected;
    const limits = selected.kind === "q1" ? UNIFIED_DATAGRAM_LIMITS : selected.kind === "q2" ? Q2_DATAGRAM_LIMITS : Q3_DATAGRAM_LIMITS;
    const transport = await openApplicationTransport({ selection: this.options.networkTransport ?? { kind: "udp" }, family: selected.kind, host: selection.host, port: selection.port, limits });
    this.operatorSend = (to, bytes) => to.kind !== "loopback" && transport.send(to, bytes);
    const random = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    try {
      switch (selected.kind) {
        case "q1": this.network = { kind: "q1", address: transport.address, server: new Q1ServerNetwork({ transport, host: selected.host }) }; break;
        case "qw": this.network = { kind: "qw", address: transport.address, server: new QwServerNetwork({ transport: transport.udpSocket(), host: selected.host, random: () => Math.trunc(Math.random() * 0x7fffffff) }) }; break;
        case "q2": this.network = { kind: "q2", address: transport.address, server: new Q2ServerNetwork({ transport, host: selected.host, random }) }; break;
        case "q3": this.network = { kind: "q3", address: transport.address, server: new Q3ServerNetwork({ transport, host: selected.host, random }) }; break;
      }
      this.host.print(`Listening for ${selected.kind.toUpperCase()} peers on ${addressKey(transport.address)}.\n`);
    } catch (error) { transport.close(); throw error; }
  }


  private async prepareNativeQ2Seat(local: LocalInput, assets: ApplicationAssets, simulation: SharedSimulation, cvars: CvarRegistry | undefined): Promise<NativeQ2SeatClient | null> {
    const world = simulation.q2Native(); if (world === null) return null;
    if (cvars === undefined) throw new Error("Native local player has no userinfo registry");
    const client = new NativeQ2ClientPresentation(world, local.player.seat.client.id.slot + 1, local.player.actor, simulation.recipe.map.entities.content);
    const effects = new ApplicationEffects(assets, simulation.scene, actor => simulation.players().some(player => player.equals(actor)), simulation.options.seed);
    try {
      for (const failure of await effects.preloadTransientResources()) this.host.print(`Optional effect preload skipped: ${failure.content}/${failure.path}: ${failure.error}\n`);
      return { client, effects, cvars, userinfo: cvars.infoString(CvarFlag.UserInfo), descriptor: { ownsEffects: true, frame: () => ({ protocol: world.edition === "classic" ? { kind: "q2-classic", version: 34 } : { kind: "q2-rerelease", version: 1038 }, stats: client.playerState.stats,
        configstrings: client.configstrings, layout: client.layout, inventory: client.inventory, playerNumber: client.sourceSlot - 1,
        serverFrame: world.edition === "rerelease" ? world.services.serverFrame : simulation.currentOutput().snapshot.frame.frame, timeMilliseconds: simulation.timeSeconds * 1000,
        frameTimeMilliseconds: world.edition === "classic" ? 100 : world.services.options.frameMilliseconds }) } };
    } catch (error) { try { effects.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native seat effects preparation failed"); } throw error; }
  }

  private async openGraphical(save?: SaveImage): Promise<void> {
    const restoring = save !== undefined;
    const client = this.ownership.kind === "borrowed" ? this.ownership.client : null;
    const owner = client?.renderer.owner ?? { identity: Symbol("application renderer"), session: this.session.session, generation: 0 };
    const rootImages = client?.renderer.images ?? new SceneImageRegistry(owner);
    const assets = new ApplicationAssets(this.content, owner, undefined, { imageRegistry: rootImages,
      ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
    let renderer: NativeRenderer | null = null, input: ApplicationInput | null = null, audio: ApplicationAudio | null = null;
    let art: NativeUiArt | null = null;
    let effects: ApplicationEffects | null = null;
    const sourceClients: ApplicationQ3Client[] = [];
    const nativeQ2 = new Map<SeatId, NativeQ2SeatClient>();
    try {
      this.host.loading?.stage("Loading textures...");
      await assets.loadWorld();
      this.host.loading?.stage("Loading characters...");
      const font = await assets.loadConsoleFont(), typography = await assets.loadMenuTypography();
      const characters = this.options.character === "q3" ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
        { model: this.options.characterModel, skin: "default", headModel: "", headSkin: "default", team: null, teamName: "" }) : null;
      renderer = client?.renderer ?? await NativeRenderer.open({ ...this.options, renderWorker: (this.imageSettings?.cvars.variableValue("r_smp") ?? 0) !== 0, ...(this.host.loading?.deferWindowVisibility ? { hidden: true } : {}) }, owner, rootImages);
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
            this.simulation.q3Source()?.host.engine.getUserinfo(seat.client.id.slot) ?? this.simulation.q2Native()?.clients.find(client => client.slot === seat.client.id.slot + 1)?.userinfo ?? this.simulation.players().filter(actor => this.simulation.playerClient(actor)?.equals(seat.client.id)).map(actor => this.simulation.sourcePlayerUserinfo(actor))[0] ?? null, undefined, archive));
          const actor = this.simulation.players().find(actor => this.simulation.playerClient(actor)?.equals(seat.client.id));
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
          const player = this.simulation.q2Native() === null ? this.simulation.admitPlayer(client.id, undefined, playerUserinfo(cvars))
            : this.simulation.admitQ2NativePlayer(client.id, `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`);
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
      this.restoreSourceInputAngles(input, this.simulation);
      if (restoring) {
        input.resumeCommands(Math.max(0, ...players.map(player => (this.simulation.movementPlayer(player.actor)?.lastSequence ?? -1) + 1)));
      }
      if (this.localGuest !== null) {
        this.guestBrowser = await this.openGuestBrowser();
        this.publishLocalGuestSnapshots();
      }
      audio = new ApplicationAudio(this.content, () => this.elapsed, this.options.seed, this.options.characterModel, text => this.host.print(text),
        { ...await loadAudioSettings(this.inputConfig), musicControls: this.musicControls, q3TeamGame: () => this.simulation.teamGame(), deferOutput: client !== null });
      if (this.imageSettings?.cvars.find("volume") !== undefined) {
        if (this.preparedStartup === null) {
          this.imageSettings.cvars.set("volume", String(audio.effectsVolume));
          this.imageSettings.cvars.set("bgmvolume", String(audio.musicVolume));
        }
        audio.bindVolumeCvars(this.imageSettings.cvars);
        audio.bindOutputCvars(this.imageSettings.cvars);
        if (client === null) applyAudioOutputSettings(this.imageSettings.cvars, audio);
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
      const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor })), input.sharedSettings());
      const presentations: WorldSeatPresentation[] = [], q3 = new Map<SeatId, Q3SeatClient>();
      for (const local of input.locals) {
        const sourceClient = await this.createQ3SeatClient(local, assets, audioOwner, inputOwner, native, this.simulation);
        if (sourceClient !== null) { sourceClients.push(sourceClient.client); q3.set(local.player.seat.id, sourceClient); }
        if (this.viewSettings.override !== null) {
          if (sourceClient?.kind !== "qvm") this.simulation.setPlayerFieldOfView(local.player.actor, this.viewSettings.fieldOfView, restoring ? "restore" : "change");
          sourceClient?.client.cvars.set("cg_fov", String(this.viewSettings.fieldOfView));
        }
        if (restoring && sourceClient?.kind === "qvm") await sourceClient.client.prepare(this.presentationFrames);
        const nativeSeat = await this.prepareNativeQ2Seat(local, assets, this.simulation, this.clientCvars.get(local.player.seat.id));
        if (nativeSeat !== null) nativeQ2.set(local.player.seat.id, nativeSeat);
        const ui = new ApplicationSeatUi(local, menuArt, inputOwner, operation => native.mutateWindow(operation), this.simulation, font, audioOwner, () => this.requestQuit(),
          (name, args) => this.queueCommand(name, args, local.player.seat.id), typography, { bindings: () => this.simulation.serverSettings(), store: this.serverProfileStore },
          await rerelease.languageBinding(local.player.seat.id, this.content.recipe.map.entities.content, error => local.console.print(`Language reload failed: ${String(error)}\n`)), this.saveMenu(this.simulation, this.options), this.viewSettings.binding(), this.host.llm, sourceClient?.kind === "qvm", this.teamArenaResults(this.simulation, local.player.seat), this.uiSourceOptions(this.simulation, rerelease, local.player.seat.id));
        const presentation = new WorldSeatPresentation(local, assets, native, this.simulation, this.options.seats, font, characters, ui, nativeSeat?.effects ?? worldEffects, sourceClient?.client ?? null, rerelease, () => this.imageSettings?.cvars.variableValue("gl_debug_distfrac") ?? 0.004, () => this.viewSettings.fieldOfView, { lines: () => this.simulation.debugLines(), lineWidth: () => this.imageSettings?.debugLineWidth ?? 2 }, () => this.imageSettings?.cvars.variableValue("con_scale") ?? 0, () => readQ1ViewSettings(this.imageSettings?.cvars ?? null, this.sourceDialect()), () => (this.imageSettings?.cvars.variableValue("r_shadows") ?? 0) !== 0, camera => this.tools?.applyCamera(camera) ?? camera, await this.createDebugGraphOverlay(assets), nativeSeat?.descriptor);
        if (client === null) local.player.seat.attachPresentation(presentation, () => presentation.close());
        presentations.push(presentation);
      }
      this.graphical = { renderer, assets, input, audio, effects, art, presentations, q3, rerelease, nativeQ2,
        selectedQ3Presentations: new ApplicationSelectedQ3Presentations({ assets, audio, queries: this.simulation.scene,
          print: text => this.host.print(text), nextFrame: this.host.loading?.nextFrame ?? setImmediate,
          clock: { now: () => this.presentationMilliseconds ?? this.elapsed, frameNumber: () => this.presentationFrames }, hardware: () => q3Hardware(native.driver?.renderer ?? "") === "ragepro" ? "ragepro" : "generic" }),
        modPresentations: new ApplicationModPresentations({ assets, audio, input, queueCommand: request => { this.requestedCommands.push(request); }, renderer: native, queries: this.simulation.scene,
          presentationMedia: componentMediaControl(this.simulation.events, audio, assets),
          systemCinematics: (_source, presentation, scope) => this.systemCinematics(this.simulation, this.content, assets, audioOwner, native, presentation.local.player.seat.id, inputOwner, scope),
          print: text => this.host.print(text), nextFrame: this.host.loading?.nextFrame ?? setImmediate,
          clock: { now: () => this.presentationMilliseconds ?? this.elapsed, frameNumber: () => this.presentationFrames } }) };
      if (save !== undefined) {
        await this.restoreComponentClients(save, this.graphical, this.simulation);
        this.graphical.modPresentations.publishRestored();
      }
      this.refreshApplicationTools();
      this.capture = client?.capture ?? new ApplicationCapture(inputCaptureServices(input, applicationCaptureRoot(this.options.userContentRoot), () => this.options.map, text => this.host.print(text)), renderer);
      if (client === null) {
        this.capture.activate();
        const video = new ApplicationVideoRestart(renderer, {
          renderWorker: () => (this.imageSettings?.cvars.variableValue("r_smp") ?? 0) !== 0,
          capture: () => this.capture, prepare: () => this.prepareVideoRestart(),
          publishWindow: window => { const current = this.graphical; if (current === null) throw new Error("Video input has retired"); current.input.publishWindow(window); },
          published: renderer => { this.launchOptions = { ...this.launchOptions, renderer }; },
          settled: () => {}, print: (text, source) => { if (this.graphical === null) this.host.print(text); else this.graphical.input.print(text, source); }, failed: error => this.closeFailedWorld(error),
        });
        video.register(input.commands); this.ownedVideoRestart = video;
      }
      if (q3.size === 0) await audio.startWorldMusic();
    } catch (error) {
      this.graphical?.modPresentations.close();
      for (const seat of nativeQ2.values()) seat.effects.close();
      for (const client of sourceClients) client.close();
      if (restoring) this.simulation.q3Guest()?.discard(); else await this.simulation.shutdownQ3Guest();
      for (const { state } of this.localGuest?.seats.values() ?? []) state.retire();
      this.localGuest?.seats.clear(); this.localGuest = null;
      audio?.close(); effects?.close(); input?.close(); art?.close(); assets.close();
      if (client === null) { this.session.close(); if (renderer === null) rootImages.close(); else renderer.close(); }
      else {
        try { client.renderer.execute({ owner, sequence: this.presentationFrames, commands: [] }); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "Graphical preparation and image retirement failed"); }
      }
      this.graphical = null;
      throw error;
    }
  }

  get captureMap(): string { return this.content.recipe.map.geometry.requestedPath; }

  async prepareVideoRestart(): Promise<PreparedVideoPresentation | null> {
    const graphical = this.graphical;
    if (graphical === null || this.closed) throw new Error("Video source has retired");
    const seats: VideoGuestSeat[] = [];
    for (const [id, current] of graphical.q3) {
      if (current.kind !== "qvm") continue;
      const presentation = graphical.presentations.find(value => value.local.player.seat.id.equals(id));
      const guest = this.localGuest?.seats.get(id);
      if (presentation === undefined || guest === undefined || guest.client !== current.client) throw new Error("Guest video seat has no current presentation");
      seats.push({ client: current.client,
        viewport: window => { const size = window.drawableSize; return this.localViewport(id, size.width, size.height); },
        publish: client => { graphical.q3.set(id, { ...current, client }); guest.client = client; presentation.replaceQ3Client(client); this.clientInputs = this.clientInputs.filter(event => !event.seat.equals(id)); } });
    }
    return prepareVideoGuests(graphical.input, graphical.renderer, seats, () => {
      if (this.closed || this.graphical !== graphical || seats.some(seat => ![...graphical.q3.values()].some(value => value.client === seat.client)))
        throw new Error("Guest video source changed during preparation");
    });
  }

  async prepareRetirement(): Promise<void> {
    await this.tools?.drain();
    await this.capture?.beforeWorldChange();
    await this.keyProfiles.get(this.simulation)?.save();
  }

  async readClientResource(path: string): Promise<Uint8Array | undefined> {
    const content = this.content;
    if (this.closed) throw new Error("Client source has retired");
    const resource = await content.mounts.open(path);
    if (this.closed || this.content !== content) throw new Error("Client source changed during resource read");
    return resource?.bytes;
  }

  releaseSettings(): void { this.tools?.beforeWorldChange(); this.releaseViewCvars?.(); this.releaseViewCvars = null; }

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
      graphical.audio.bindOutputCvars(client.imageSettings.cvars);
      this.viewSettings.setFieldOfView(client.imageSettings.cvars.variableValue("fov"));
      this.releaseViewCvars = this.viewSettings.bindCvars(client.imageSettings.cvars);
      graphical.input.publishClientPlatform(client, "replace");
      this.publishKeys();
      this.refreshApplicationTools();
      if (this.configurationScripts !== null && this.configurationScripts !== client.configuration.current.scripts) {
        retiredConfiguration = client.configuration.current.scripts;
        client.configuration.current = { scripts: this.configurationScripts, options: this.options };
        this.configurationScripts = null;
      }
      publishAudio(); client.output.current = graphical.audio.engine;
      applyAudioOutputSettings(client.imageSettings.cvars, graphical.audio);
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
    return createStartupScriptReader({ mounted: name => scripts.readMountedScript(name),
      user: (name, source) => scripts.read(name, source), baseLooseRoots: roots(base), gameLooseRoots: roots(product), seatRoot: consoleConfigRoot(options.userContentRoot) });
  }

  private static sourceScripts(content: LoadedApplicationContent, options: ApplicationOptions, settings: ConfigStore): ConsoleScriptFiles {
    const mounts = content.mounts, release = content.retainMainMounts();
    return new ConsoleScriptFiles({ ...legacyConfigurationOptions(options, content.catalog, content.recipe.engineBehavior.content),
      consoleRoot: consoleConfigRoot(options.userContentRoot), settings,
      mountedScript: sourceScriptReader(content.catalog, mounts, content.recipe.engineBehavior.content),
      mountedResource: name => mounts.open(name),
      mountedFiles: (directory, extension) => mounts.listFiles(directory, extension),
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
      levelShot: () => this.queueLocalGuestCommand(world, { target: "application", name: "clientLevelShot", arguments_: [], seat: seat.id }),
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
            if (name !== undefined && value !== undefined && name !== "ip") {
              if (cvars.dialect === "q1-netquake" && name === "name") cvars.register("_cl_name", value, CvarFlag.Archive);
              else cvars.register(name, value, CvarFlag.UserInfo);
            }
          }
        }
        const available = (name: string) => ((cvars.find(name)?.flags ?? 0) & CvarFlag.UserInfo) === 0;
        cvars.applyArchive((previous?.archiveEntries() ?? archive).filter(entry => available(entry.name)));
        for (const value of previous?.snapshots() ?? []) if ((value.flags & CvarFlag.UserInfo) === 0) cvars.set(value.name, value.value, true);
      }
    }
    registerPlayerUserinfo(cvars, seat.id.index, options.character === "q2" ? options.characterModel : "male");
    if (userinfo !== null && cvars.dialect === "q1-netquake") cvars.set("_cl_color", String((cvars.variableValue("topcolor") << 4) | (cvars.variableValue("bottomcolor") & 15)), true);
    if (simulation.q2Native() !== null) {
      for (const { name, value } of [{ name: "name", value: "unnamed" }, { name: "skin", value: "male/grunt" }, { name: "rate", value: "25000" },
        { name: "msg", value: "1" }, { name: "hand", value: "0" }, { name: "fov", value: "90" }, { name: "gender", value: "male" }]) {
        cvars.register(name, value, CvarFlag.UserInfo | CvarFlag.Archive);
      }
    }
    if (cvars.dialect === "q3") {
      initializeQ3ClientCvars(cvars, { name: `Player ${seat.id.index + 1}`, model: options.characterModel });
      for (const name of ["cl_paused", "sv_paused"]) {
        if (cvars.find(name) === undefined) cvars.register(name, "0", CvarFlag.ReadOnly);
        else cvars.addFlags(name, CvarFlag.ReadOnly);
        cvars.set(name, "0", true);
      }
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
    this.publishedUserinfo.set(cvars, playerUserinfo(cvars));
    return cvars;
  }

  private isTeamArenaSkirmish(simulation = this.simulation): boolean {
    const source = simulation.q3Source();
    return source?.options.product === "missionpack" && source.host.cvars.variableString("nextmap") === "teamarena-results";
  }

  private uiSourceOptions(simulation: SharedSimulation, rerelease: ApplicationRereleasePresentation, seat: SeatId, clients = this.clientCvars) {
    const cvars = this.sourceCvars(simulation);
    const client = clients.get(seat);
    const baseArena = this.baseArenaMenu(simulation, seat);
    const weaponPickupPolicy: "shared" | "source-owned" = simulation.q1Source() === null ? "source-owned" : "shared";
    return { ...(this.host.lobby === undefined ? {} : { lobby: { returnToLobby: () => {
      void this.returnToLobby().catch((error: unknown) => this.host.print(`Return to lobby failed: ${String(error)}\n`));
    } } }), ...(simulation.q3Source() === null ? {} : { rankings: { current: () => this.rankingAccountActions(seat), takeMenuRequest: () => this.takeRankingMenuRequest(seat) } }), ...(cvars === null ? {} : { gameplay: { cvars, weaponPickupPolicy, ...(client === undefined ? {} : { client }) } }), ...(baseArena === undefined ? {} : { baseArena }),
      nativeHudLocalizer: (content: ContentId) => rerelease.sourceLocalizer(seat, content),
      localize: (content: ContentId, text: string, args?: readonly string[]) => rerelease.localizeMessage(seat, content, text, args) };
  }

  private async recordPlayerProgress(source: SimulationPresentationEvent): Promise<void> {
    const achievement = source.kind === "q1" && source.event.kind === "achievement"
      ? { family: "q1", id: source.event.id, actor: source.event.player }
      : source.kind === "q2-rerelease" && source.event.kind === "achievement" ? { family: "q2", id: source.event.id, actor: null } : null;
    const completion = sourceLevelCompletion(source);
    if ((achievement === null || achievement.id === "") && completion === null) return;
    this.playerProgress ??= PlayerProgressStore.open(join(this.inputConfig.root, "player-progress.json"));
    const store = await this.playerProgress;
    for (const seat of this.localSeats.values()) {
      if (source.recipient !== undefined && !this.simulation.playerClient(source.recipient)?.equals(seat.client.id)) continue;
      if (achievement?.actor !== null && achievement?.actor !== undefined
        && !this.simulation.movementPlayer(achievement.actor)?.client.equals(seat.client.id)) continue;
      const participant = `local-seat:${seat.id.index}`;
      if (achievement !== null && achievement.id !== "") await store.record({ kind: "achievement", source: achievement.family === "q1" ? "q1" : "q2", participant,
        event: `achievement:${source.content}:${achievement.id}`, award: achievement.id });
      if (completion !== null) await store.record({ kind: "level-completed", source: completion, participant,
        event: `level:${source.content}:${this.options.map}`, map: this.options.map });
    }
  }

  private async prepareBaseArenaProgress(simulation: SharedSimulation, content: LoadedApplicationContent, restoring: boolean): Promise<void> {
    const source = simulation.q3Source();
    if (source === null || source.options.product === "missionpack" || source.gameType !== GameType.GT_SINGLE_PLAYER) return;
    const catalog = await readBaseArenaCatalog(content.mounts);
    const progression = new BaseArenaProgression(source.host.cvars, { regularLevels: catalog.regularCount,
      training: catalog.arenas.find(arena => arena.special.toLowerCase() === "training")?.number ?? null,
      final: catalog.arenas.find(arena => arena.special.toLowerCase() === "final")?.number ?? null,
      totalLevels: catalog.regularCount + catalog.arenas.filter(arena => arena.special !== "").length });
    const arena = catalog.arenas.find(arena => arena.map.toLowerCase() === content.recipe.map.geometry.requestedPath.toLowerCase());
    if (arena !== undefined && !restoring) {
      source.host.cvars.register("ui_spSelection", "0", CvarFlag.Archive);
      source.host.cvars.set("ui_spSelection", String(arena.selection), true);
    }
    source.host.cvars.register("g_spRoundIdentity", "", CvarFlag.Archive);
    source.host.cvars.register("g_spCompletedRound", "", CvarFlag.Archive);
    if (!restoring || source.host.cvars.variableString("g_spRoundIdentity") === "") source.host.cvars.set("g_spRoundIdentity", randomUUID(), true);
    this.baseArenaProgress.set(simulation, { catalog, progression, result: null, resultAt: 0, announced: false, moviePlayed: false });
  }

  private async completeBaseArena(args: readonly string[]): Promise<void> {
    const state = this.baseArenaProgress.get(this.simulation), source = this.simulation.q3Source();
    if (state === undefined || source === null) throw new Error("Base arena postgame lost its source owner");
    const arena = baseArenaForMap(state.catalog, this.options.map), rawSkill = source.host.cvars.variableValue("g_spSkill");
    const skill = rawSkill >= 5 ? 5 : rawSkill >= 4 ? 4 : rawSkill >= 3 ? 3 : rawSkill >= 2 ? 2 : 1;
    const game = parseArenaPostgame(args, arena.number, skill);
    const round = `${source.host.cvars.variableString("g_spRoundIdentity")}:${source.level.startTime}`;
    if (source.host.cvars.variableString("g_spCompletedRound") === round) {
      state.result = arenaPostgamePresentation(game, { rank: game.result.rank, completedTier: state.progression.completedTier(arena.number),
        unlockedMovie: null, awards: [], nextLevel: state.progression.currentLevel() });
      state.announced = true; state.moviePlayed = true;
      return;
    }
    const local = [...this.localSeats.values()].find(seat => seat.client.id.slot === game.playerClient);
    if (local !== undefined) {
      this.playerProgress ??= PlayerProgressStore.open(join(this.inputConfig.root, "player-progress.json"));
      await (await this.playerProgress).record({ kind: "match-completed", source: "q3", participant: `local-seat:${local.id.index}`,
        event: round, map: arena.map, score: game.result.frags });
    }
    const names = ["g_spScores1", "g_spScores2", "g_spScores3", "g_spScores4", "g_spScores5", "g_spAwards", "g_spVideos", "g_spCompletedRound"];
    const before = names.map(name => ({ name, value: source.host.cvars.variableString(name) }));
    const result = state.progression.record(game.result);
    source.host.cvars.set("g_spCompletedRound", round, true);
    try { await this.saveSourceArchive(this.options, this.content, this.simulation, this.teamArenaOverrides); }
    catch (error) { for (const value of before) source.host.cvars.set(value.name, value.value, true); throw error; }
    state.result = arenaPostgamePresentation(game, result);
    state.resultAt = performance.now(); state.announced = false; state.moviePlayed = false;
    const music = state.result.musicCommand.split(" ");
    this.queueCommand("music", music.slice(1), local?.id ?? null);
  }

  private baseArenaMenu(simulation: SharedSimulation, seat: SeatId): BaseArenaMenuService | undefined {
    const state = this.baseArenaProgress.get(simulation);
    if (state === undefined) return undefined;
    return {
      selection: () => arenaSelection(state.catalog, state.progression, simulation.q3Source()?.host.cvars.variableString("ui_spSelection") ?? ""),
      skill: () => {
        const value = simulation.q3Source()?.host.cvars.variableValue("g_spSkill") ?? 2;
        return value >= 5 ? 5 : value >= 4 ? 4 : value >= 3 ? 3 : value >= 2 ? 2 : 1;
      },
      play: (map, skill) => {
        const row = state.catalog.arenas.find(arena => arena.map === map);
        if (row === undefined || !state.progression.levelAvailable(row.number)) throw new Error("That arena is not unlocked in this profile.");
        const source = simulation.q3Source();
        if (source === null) throw new Error("Arena selection lost its game owner");
        source.host.cvars.set("g_spSkill", String(skill), true);
        this.queueCommand("spmap", [map], seat);
      },
      result: () => {
        const result = state.result;
        if (result === null) return null;
        const elapsed = performance.now() - state.resultAt;
        if (!state.announced && elapsed >= result.winnerAnnouncementAfterMilliseconds) {
          state.announced = true;
          const winner = result.podium[0];
          const name = winner === undefined ? "" : simulation.q3Source()?.pool.clientAt(winner.client).pers.netname.replace(/\^[0-9]/g, "").toLowerCase() ?? "";
          if (result.result.rank === 1 || name !== "") this.queueCommand("play", [result.result.rank === 1
            ? "sound/player/announce/youwin.wav" : `sound/player/announce/${name}_wins.wav`], seat);
        }
        if (!state.moviePlayed && result.result.unlockedMovie !== null && elapsed >= 5000 + Math.max(5000, result.result.awards.length * 2000)) {
          state.moviePlayed = true;
          const movie = state.progression.catalog.final !== null && result.result.completedTier === state.progression.catalog.regularLevels / 4 + 1
            ? "end.RoQ" : `tier${result.result.unlockedMovie}.RoQ`;
          this.queueCommand("cinematic", [movie], seat);
        }
        return result;
      },
      playerName: client => simulation.q3Source()?.pool.clientAt(client).pers.netname ?? `Player ${client + 1}`,
      progress: () => {
        const medals = ["Accuracy", "Impressive", "Excellent", "Gauntlet", "Frags", "Perfect"];
        return [...state.catalog.arenas.map(arena => {
          const best = state.progression.best(arena.number);
          return { label: arena.title, value: best.rank === 0 ? state.progression.levelAvailable(arena.number) ? "Available" : "Locked"
            : `Best rank ${best.rank}, skill ${best.skill}` };
        }), ...medals.map((label, medal) => ({ label, value: String(state.progression.award(medal)) }))];
      },
      retry: () => { this.queueCommand("spmap", [this.options.map], seat); },
      next: () => {
        const next = state.catalog.arenas.find(arena => arena.number === state.progression.currentLevel());
        if (next !== undefined) this.queueCommand("spmap", [next.map], seat);
      },
      quit: () => { this.requestQuit(); },
      reset: () => { this.requestedCommands.push({ target: "source", name: "arena-reset", arguments_: [], seat }); },
    };
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
    }, demo: {
      available: () => this.preparedStartup !== null && this.teamArenaDemos.has(simulation),
      play: () => {
        const demo = this.teamArenaDemos.get(simulation), prepared = this.preparedStartup;
        if (demo === undefined || prepared === null) return;
        prepared.commands.append(`${readStartupCommand(["+demo", demo.path], 0).text}\n`,
          { session: seat.id.session, origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } }, "q3");
      },
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

  private restoreSourceInputAngles(input: ApplicationInput, simulation: SharedSimulation, seat?: SeatId): void {
    if (simulation.q2Native() !== null) {
      for (const local of input.locals) if (seat === undefined || local.player.seat.id.equals(seat))
        local.builder.setViewAngles(simulation.playerView(local.player.actor).angles);
      return;
    }
    const state = simulation.q3Source()?.host.serverState ?? simulation.q3Guest()?.state;
    if (state === undefined) return;
    for (const local of input.locals) {
      if (local.builder.dialect !== "q3" || seat !== undefined && !local.player.seat.id.equals(seat)) continue;
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

  private async prepareKeys(content: LoadedApplicationContent, simulation: SharedSimulation): Promise<ApplicationKeyProfile> {
    const current = this.keyProfiles.get(simulation);
    if (current !== undefined) return current;
    const cvars = this.sourceCvars(simulation);
    if (cvars === null) throw new Error("Q3 key profile requires its actual source registry");
    const profile = await this.keys.prepare({ ...this.options, product: content.recipe.engineBehavior.content, ...(content.q3Product === null ? {} : { q3Product: content.q3Product }) }, content.catalog, cvars);
    if (profile === null) throw new Error("Q3 guest has no Q3 key profile");
    this.keyProfiles.set(simulation, profile);
    return profile;
  }

  private publishKeys(): void {
    const profile = this.keyProfiles.get(this.simulation), cvars = this.sourceCvars();
    if (profile !== undefined && cvars !== null) this.keys.publish(profile, cvars);
  }

  private async createQ3SeatClient(local: LocalInput, assets: ApplicationAssets, audio: ApplicationAudio, input: ApplicationInput,
    renderer: NativeRenderer, simulation: SharedSimulation, settings?: readonly CvarSnapshot[], localGuest = this.localGuest, browser = this.guestBrowser,
    cvars = this.clientCvars.get(local.player.seat.id)): Promise<Q3SeatClient | null> {
    const guest = simulation.q3Guest();
    if (guest !== null) {
      const seat = localGuest?.seats.get(local.player.seat.id);
      if (localGuest === null || seat === undefined || browser === null) throw new Error("Local guest client services are not prepared");
      const { state, cvars } = seat;
      const keys = await this.prepareKeys(assets.content, simulation);
      const primaryArtifact = assets.content.preparedQ3Game?.artifact;
      const equipmentProfile = primaryArtifact === undefined ? null : q3GrappleProfile(primaryArtifact);
      const client = await ApplicationQ3Client.create({ saveFontData: () => (input.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0, kind: "qvm", keys, localServer: true, source: state.source, connection: state, cvars,
        equipmentWeapon: () => {
          const grapple = simulation.recipe.equipment.grapple;
          if (simulation.arsenalState(local.player.actor) !== null) {
            const player = guest.player(local.player.seat.client.id);
            return player === null ? null : { primaryWeapon: guest.records.player(player.sourceEntity).weapon, warning: simulation.playerUi(local.player.actor).arsenalWarning };
          }
          if (equipmentProfile === null || grapple.kind !== "enabled" || grapple.binding !== "slot") return null;
          const selected = simulation.weaponSlot(local.player.actor).active;
          if (selected?.provider !== grapple.source.provider || selected.item !== "q3:weapon_grapplinghook") return null;
          const player = guest.player(local.player.seat.client.id);
          return player === null ? null : { primaryWeapon: guest.records.player(player.sourceEntity).weapon, warning: simulation.playerUi(local.player.actor).arsenalWarning };
        },
        systemCinematics: this.systemCinematics(simulation, assets.content, assets, audio, renderer, local.player.seat.id, input),
        remapShader: primaryShaderControl(simulation.events, assets, () => simulation.q3Guest() === guest && !guest.isRetired
          && !local.player.seat.client.isClosed && simulation.actors.isLive(local.player.actor)),
        assets, queries: simulation.scene, local, audio, renderer, browser: browser.view, commandBuffer: input.guestCommands, guestCvars: input.guestCvars(local.player.seat.id), guestInput: input.guestInput(local.player.seat.id),
        commandRegistration: input.clientCommandRegistration(local.player.seat.id),
        get splitScreen() { return input.locals.length > 1; },
        timeCvars: guest.state.cvars,
        assertCurrent: () => { if (simulation.q3Guest()?.isRetired !== false || local.player.seat.client.isClosed) throw new Error("Guest presentation world is retired"); },
        clientState: () => ({ phase: 8, connectPacketCount: 0, clientNumber: state.clientNumber, serverName: "localhost", message: "" }),
        viewport: () => { const size = renderer.window.drawableSize; return this.localViewport(local.player.seat.id, size.width, size.height); },
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
    const client = await ApplicationQ3Client.create({ saveFontData: () => (input.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0, weaponHud: () => { const ui = simulation.playerUi(local.player.actor); return { status: ui.weaponStatus, warning: ui.arsenalWarning }; }, assets, renderer, queries: simulation.scene, initial, local, audio, movement: prediction,
      systemCinematics: this.systemCinematics(simulation, assets.content, assets, audio, renderer, local.player.seat.id, input),
        remapShader: primaryShaderControl(simulation.events, assets, () => simulation.q3Source() === source
          && !local.player.seat.client.isClosed && simulation.actors.isLive(local.player.actor)),
      commandRegistration: input.clientCommandRegistration(local.player.seat.id),
      get splitScreen() { return input.locals.length > 1; },
      timeCvars: source.host.cvars,
      ...(cvars === undefined ? {} : { cvars }),
      ...(settings === undefined ? {} : { settings }), predictionCommand: (command, time) => prediction.submit(command, time),
      linkBounds: number => source.world.linkState(number)?.absbounds ?? null,
      sourceActor: number => { const record = source.records.get(number); return record?.inuse ? record.actor.id : null; },
      serverSettings: () => source.host.cvars.snapshots().filter(variable => source.settings.definitions.some(definition => definition.name === variable.name)),
      viewport: () => { const size = renderer.window.drawableSize; return this.localViewport(local.player.seat.id, size.width, size.height); },
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

  private async replaceWorld(map: string, carry: SimulationTravel | null, initialSourceMilliseconds = 0, save?: SaveImage, skirmish?: TeamArenaSkirmish, published?: () => void, nativeTravel?: Q2TravelTarget, q3Map?: Q3MapLaunch, guestRestart = false, q2NextServer = ""): Promise<void> {
    if (this.campaignMovie !== null) throw new Error("Finish or skip the campaign cinematic before changing worlds");
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    this.worldOperation = "travel";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try {
      try { await serviceLoading(nextFrame => this.prepareAndReplaceWorld(map, carry, initialSourceMilliseconds, save, skirmish, nativeTravel, q3Map, nextFrame, guestRestart, q2NextServer), () => {
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
    this.timedAutosave.worldChanged();
    if (published !== undefined) published();
    else this.campaignUnit.stage({ content: this.content.recipe.map.geometryContent, path: this.content.recipe.map.geometry.requestedPath }, nativeTravel?.newUnit ?? false, null).commit();
    if (save === undefined) await this.autosaveLevel();
  }

  private async prepareAndReplaceWorld(map: string, carry: SimulationTravel | null, initialSourceMilliseconds = 0, save?: SaveImage, skirmish?: TeamArenaSkirmish, nativeTravel?: Q2TravelTarget, q3Map?: Q3MapLaunch, nextFrame: () => Promise<void> = async () => { await Bun.sleep(0); }, guestRestart = false, q2NextServer = "", restoredOptions?: ApplicationOptions): Promise<void> {
    if (save !== undefined && this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
    if (save !== undefined && this.graphical === null) requireComponentClientPresentation(save);
    if (save === undefined && carry === null && this.simulation.quakecSource()?.kind === "quakeworld") carry = this.simulation.captureTravel();
    const settings = save === undefined ? null : savedSimulationSettings(save);
    const savedBots = save === undefined ? null : savedBotCheckpoint(save);
    const { authoredCampaignStart: consumedCampaignStart, ...travelOptions } = restoredOptions ?? this.options;
    let options = { ...travelOptions, map: mapResourcePath(map),
      ...(skirmish === undefined ? {} : { teamArenaSkirmish: skirmish, characterModel: skirmish.playerModel }),
      ...(settings === null ? {} : { skill: settings.skill, mode: settings.mode, seed: settings.seed }) };
    if (save !== undefined || q3Map !== undefined) { const { teamArenaSkirmish, ...restoredOptions } = options; options = restoredOptions; }
    if (q3Map !== undefined) options = { ...options, mode: q3Map.singlePlayer ? "singleplayer" : q3Map.gameType === 2 ? "singleplayer" : "deathmatch" };
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
    if (content.q3Product !== null) options = { ...options, q3Product: content.q3Product };
    const previousContent = this.content, previous = this.graphical, previousSimulation = this.simulation, previousLocalGuest = this.localGuest;
    const previousOptions = this.options, previousClientCvars = this.clientCvars, previousOverrides = this.teamArenaOverrides;
    const previousNativeClients = previousSimulation.q2Native()?.clients ?? [];
    let nextOverrides = previousOverrides;
    const sameClientOwner = content.recipe.engineBehavior.content === previousContent.recipe.engineBehavior.content
      && content.recipe.engineBehavior.provider === previousContent.recipe.engineBehavior.provider;
    const sameSourceOwner = content.recipe.map.entities.content === previousContent.recipe.map.entities.content
      && content.recipe.map.entities.provider === previousContent.recipe.map.entities.provider;
    const frontendOverrides = this.frontendSettings;
    const q3 = this.simulation.q3Source();
    const previousBotClients = this.bots?.clients() ?? [];
    const preserveBots = q3Map === undefined ? skirmish === undefined && (initialSourceMilliseconds !== 0 || q3?.gameType !== 2) : !q3Map.killBots;
    const botClients = preserveBots ? previousBotClients : [];
    const previousBots = this.bots;
    const currentSource = this.sourceCvars();
    const nextRules = q3Map === undefined && save === undefined && skirmish === undefined && sameSourceOwner && currentSource !== null
      ? resolveStartupRules(options, currentSource, this.simulation.options.maxClients, [], false) : null;
    if (nextRules !== null) options = nextRules.options;
    const q3Session = q3?.captureSession();
    const serverProfile = this.simulation.serverProfile();
    const previousQ1Cvars = this.simulation.q1Source()?.cvars;
    const q1CvarsSource = save === undefined && content.world.kind === "q1-bsp" && content.preparedQuakeC === null ? previousQ1Cvars : undefined;
    const sourceArchive = this.sourceCvars()?.archiveEntries() ?? [];
    const q2Cvars = this.simulation.q2ServerCvars()?.snapshots().map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value }));
    let q3Cvars = q3?.host.cvars.snapshots().filter(variable => variable.name !== "sv_mapname" && variable.name !== "mapname")
      .map(variable => ({ name: variable.name, value: variable.latchedValue ?? variable.value }));
    const candidateGraph = new SourceDebugGraph();
    let simulation: SharedSimulation | null = null, assets: ApplicationAssets | null = null, art: NativeUiArt | null = null;
    let nextBots: ApplicationBotService | null = null;
    let nextLocalGuest: LocalQ3GuestWorld | null = null;
    const previousGuestBrowser = this.guestBrowser;
    let nextGuestBrowser = previousGuestBrowser;
    let savedClients: SavedApplicationClients | null = null;
    let nextAudio: ApplicationAudio | null = null;
    let nextEffects: ApplicationEffects | null = null;
    let nextInput: ApplicationInput | null = null;
    let nextScripts: ConsoleScriptFiles | null = null;
    let retiredScripts: ConsoleScriptFiles | null = null;
    let committed = false, nativeCommitted = false;
    let guestTransition: Q3GuestMapTransition | null = null;
    let guestNetworkPublished = false;
    const guestRejectedClients = new Map<ClientId, string>();
    const guestNetworkCommands: { readonly slot: number; readonly text: string }[] = [];
    let guestNetworkCommandBytes = 0;
    const guestCandidateOutput: Q3GuestOutput = {
      configstring: (index, value) => { if (guestNetworkPublished) return this.guestOutput().configstring(index, value); },
      sendServerCommand: (slot, text) => {
        if (guestNetworkPublished) return this.guestOutput().sendServerCommand(slot, text);
        guestNetworkCommandBytes += text.length;
        if (guestNetworkCommands.length >= 1024 || guestNetworkCommandBytes > 1024 * 1024) throw new Error("Q3 map initialization overflowed pending reliable commands");
        guestNetworkCommands.push({ slot, text });
      },
      dropClient: async (slot, reason) => {
        if (!guestNetworkPublished) {
          const carried = guestTransition?.clients.find(entry => entry.client.slot === slot);
          if (this.network?.kind !== "q3" || carried === undefined) throw new Error(`Q3 map initialization dropped client ${slot}: ${reason}`);
          guestRejectedClients.set(carried.client, reason); return;
        }
        await this.guestOutput().dropClient(slot, reason);
      },
    };
    const carriedGuestCommands = new Map(previousSimulation.q3Guest()?.players().map(player => [player.client.slot, previousSimulation.q3Guest()?.state.getUserCommand(player.sourceEntity)]));
    let nextGraphical: GraphicalApplication | null = null;
    const nextClientCvars = new Map<SeatId, CvarRegistry>();
    const stagedPresentations: WorldSeatPresentation[] = [];
    const nextNativeQ2 = new Map<SeatId, NativeQ2SeatClient>();
    const stagedClients: ApplicationQ3Client[] = [];
    let stagedCapture: ApplicationCapture | null = null;
    let candidateImages: ReturnType<ApplicationImageSettings["prepareClientSettings"]> | null = null;
    try {
      if (save === undefined) preflightApplicationMatch(content, options, [...q3Cvars ?? [],
        ...(skirmish === undefined ? [] : teamArenaSourceCvars(skirmish, q3Cvars ?? [])), ...(q3Map?.cvars ?? [])]);
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
      const modCommands = new ModCommands({ context: { session: this.session.session, origin: { kind: "server-console" } },
        commands: () => candidatePublished ? this.sourceCommands : candidateCommands });
      const candidateActions: ApplicationCommandRequest[] = [];
      const candidateAction = (request: ApplicationCommandRequest): undefined => {
        if (candidatePublished) this.requestedCommands.push(request); else candidateActions.push(request);
        return undefined;
      };
      const nativeContext = Application.nativeCommandContext.bind(null, content, this.session.session);
      const nativeCommand = (text: string): undefined => {
        modCommands.append(text, nativeContext(), Application.contentDialect(content));
        return undefined;
      };
      const guestCommands = (): CommandBuffer => {
        const commands = candidatePublished ? this.sourceCommands : candidateCommands;
        if (commands === null) throw new Error("Q3 guest candidate console is unavailable");
        return commands;
      };
      const monsterNavigation = await preloadApplicationMonsterNavigation(content);
      const modTravel = save === undefined ? await previousSimulation.checkpointModsForTravel() : undefined;
      const continueQ3Clock = save === undefined && q3 !== null && content.recipe.map.entities.provider.startsWith("q3:")
        && !content.recipe.execution.some(module => module.kind === "qvm" && module.role === "server-game");
      const destinationSourceMilliseconds = continueQ3Clock && q3 !== null ? q3.host.now() : initialSourceMilliseconds;
      if (nativeTravel !== undefined) {
        const oldNative = previousSimulation.q2Native(), prepared = content.preparedQ2Game;
        if (save !== undefined || carry !== null || nativeTravel.kind !== "map" || oldNative === null || prepared === null
          || oldNative.module.id !== prepared.execution.owner.provider || oldNative.module.digest !== prepared.execution.artifact.digest
          || (nextRules?.maxClients ?? previousSimulation.options.maxClients) !== previousSimulation.options.maxClients)
          throw new Error("Native gamemap requires the retained module and client capacity");
        if (previous !== null) {
          assets = new ApplicationAssets(content, previous.renderer.owner, undefined, { imageRegistry: previous.renderer.images,
            ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
          await assets.loadWorld(); await assets.loadConsoleFont(); await assets.loadMenuTypography();
        }
        await this.capture?.beforeWorldChange();
        if (this.closed || this.simulation !== previousSimulation) throw new Error("Native source changed during map preparation");
        nativeCommitted = true;
        for (const presentation of previous?.presentations ?? []) presentation.ui.closeMenus();
        this.tools?.beforeWorldChange();
      }
      const oldGuest = previousSimulation.q3Guest();
      if (save === undefined && oldGuest !== null) {
        if (content.preparedQ3Game === null) throw new Error("QVM map travel requires a destination qagame");
        if (previous !== null && assets === null) {
          assets = new ApplicationAssets(content, previous.renderer.owner, undefined, { imageRegistry: previous.renderer.images,
            ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
          await assets.loadWorld(); await assets.loadConsoleFont(); await assets.loadMenuTypography();
        }
        await this.capture?.beforeWorldChange();
        if (this.closed || this.simulation !== previousSimulation) throw new Error("Guest source changed during map preparation");
        nativeCommitted = true;
        for (const client of previous?.q3.values() ?? []) if (client.kind === "qvm") await client.client.close();
        guestTransition = await oldGuest.shutdownForMapChange(guestRestart);
        q3Cvars = guestTransition.cvars.variables.flatMap(variable => variable === null || variable.name === "mapname" || variable.name === "sv_mapname"
          ? [] : [{ name: variable.name, value: variable.latchedValue ?? variable.value }]);
      }
      const retainedNative = nativeTravel === undefined ? undefined : await previousSimulation.captureNativeQ2Travel(nativeTravel.newUnit, nativeTravel.spawnPoint, nextFrame);
      simulation = await loadSimulation({ ...(retainedNative === undefined ? {} : { nativeQ2Travel: retainedNative }), dedicated: options.dedicated, ...await Application.guestOptions(content, options, this.host, guestCommands, candidateGraph, nativeCommand), prepareRereleaseNavigation: simulation => createApplicationBotNavigation({ content, simulation }), ...(content.preparedQuakeC === null ? {} : { preparedQuakeC: content.preparedQuakeC }), ...(monsterNavigation === undefined ? {} : { monsterNavigation }), identity: this.identity, weaponBehaviors: content.preparedWeaponBehaviors, recipe: content.recipe, world: content.world, mounts: content.mounts,
        preparedMods: content.preparedMods, enabledMods: content.recipe.mods?.map(mod => mod.selection) ?? [], modCommands, ...(modTravel === undefined ? {} : { modTravel }),
        modFiles: new ModUserFiles(options.userContentRoot ?? defaultUserContentRoot()),
        skill: options.skill, mode: options.mode, seed: options.seed, maxClients: settings?.maxClients ?? (q3Map?.maxClients === undefined ? undefined : previousSimulation.q3Guest() === null ? q3Map.maxClients : Math.max(q3Map.maxClients, ...clients.map(client => client.slot + 1))) ?? skirmish?.maxClients ?? nextRules?.maxClients ?? this.simulation.options.maxClients,
        promptSupported: client => !options.dedicated && this.localSeats.has(client),
        playerIdentity: client => this.networkPlayerIdentities.get(client) ?? ({ seat: this.localSeats.get(client)?.id.index ?? 0, socialId: "" }),
        ...(save === undefined ? { q2NextServer, ...(skirmish === undefined && q3Map === undefined ? { serverProfile } : {}), sourceArchive, ...(q1SourceRegistry === undefined ? {} : { sourceRegistry: q1SourceRegistry }), ...(q2Cvars === undefined ? {} : { q2Cvars }), ...(carry === null ? {} : { travel: carry }), ...(q3Session === undefined || skirmish !== undefined ? {} : { q3Session }),
          ...(guestRestart || continueQ3Clock || q3Session !== undefined && skirmish === undefined ? { initialSourceMilliseconds: destinationSourceMilliseconds } : {}),
          ...(q3Cvars === undefined ? {} : { q3Cvars: [...q3Cvars, ...(skirmish === undefined ? [] : teamArenaSourceCvars(skirmish, q3Cvars)), ...(q3Map?.cvars ?? [])] }) } : { restore: save, restoredClients: clients, ...(carry === null ? {} : { travel: carry }) }) }, nextFrame);
      const nextSimulation = simulation;
      const nextGuest = nextSimulation.q3Guest();
      if (guestTransition !== null && nextGuest !== null) {
        nextGuest.state.cvars.restoreSaveState(guestTransition.cvars);
        for (const variable of guestTransition.cvars.variables) if (variable !== null && variable.latchedValue !== null)
          nextGuest.state.cvars.set(variable.name, variable.latchedValue, true);
        if (q3Map !== undefined) applyQ3MapLaunch(nextGuest.state.cvars, q3Map, "spawn");
        nextGuest.state.cvars.set("sv_maxclients", String(nextSimulation.options.maxClients), true);
        const mapName = content.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, "");
        nextGuest.state.cvars.set("mapname", mapName, true); nextGuest.state.cvars.set("sv_mapname", mapName, true);
      }
      if (save !== undefined && nextSimulation.q3Source() !== null && savedBots === null) throw new Error("Q3 application restoration requires saved bot service state");
      if (previous !== null && nextSimulation.q3Guest() === null) for (const local of previous.input.locals) {
        const seat = local.player.seat;
        const cvars = this.createClientCvars(nextSimulation, content, options, seat,
          save === undefined ? null : nextSimulation.q3Source()?.host.engine.getUserinfo(seat.client.id.slot) ?? nextSimulation.q2Native()?.clients.find(client => client.slot === seat.client.id.slot + 1)?.userinfo ?? nextSimulation.players().filter(actor => nextSimulation.playerClient(actor)?.equals(seat.client.id)).map(actor => nextSimulation.sourcePlayerUserinfo(actor))[0] ?? null,
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
        if (save === undefined) {
          const seat = [...this.localSeats.values()].find(seat => seat.client.id.equals(client));
          const cvars = seat === undefined ? undefined : nextClientCvars.get(seat.id);
          if (seat === undefined && this.network?.kind === "q1" && nextSimulation.quakecSource()?.kind === "netquake") {
            const sourceInfo = previousSimulation.quakecSource()?.clientInfo(client);
            return [client.slot, nextSimulation.reserveNetQuakeClient(client, sourceInfo)];
          }
          const userinfo = cvars === undefined ? previousNativeClients.find(record => record.slot === client.slot + 1)?.userinfo
            : `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`;
          if (nextSimulation.q2Native() !== null && userinfo === undefined) throw new Error("Native carried client has no source userinfo");
          const player = nextSimulation.q2Native() === null || userinfo === undefined ? nextSimulation.admitPlayer(client, undefined, cvars === undefined ? undefined : playerUserinfo(cvars))
            : nextSimulation.admitQ2NativePlayer(client, userinfo, seat !== undefined);
          return [client.slot, player.actor];
        }
        const actor = nextSimulation.players().find(actor => nextSimulation.playerClient(actor)?.equals(client));
        if (actor === undefined) throw new Error(`Restore did not bind client ${client.slot}`);
        return [client.slot, actor];
      }));
      let nextNetworkHost: NativeServerHost | null = null;
      const nextUnifiedHost = this.network?.kind === "unified" ? {
        host: createUnifiedApplicationServerHost({ session: this.session, simulation, content, print: text => { this.host.print(text); } }),
        composition: await buildUnifiedComposition(content),
      } : null;
      let recordingTransitionError: unknown = null;
      if (this.network !== null && this.network.kind !== "unified") {
        nextNetworkHost = await this.networkHost(simulation, content, this.nativeWorldCount + 1);
        this.validateNetworkHost(nextNetworkHost);
      } else if (simulation.q2Native() !== null) {
        nextNetworkHost = await this.networkHost(simulation, content, this.nativeWorldCount + 1);
        this.validateNetworkHost(nextNetworkHost);
      } else if (this.localRecordingActive) {
        try {
          nextNetworkHost = await this.networkHost(simulation, content, this.nativeWorldCount + 1);
          this.validateNetworkHost(nextNetworkHost);
          const previous = this.recordingHost;
          if (previous === null || previous.kind !== nextNetworkHost.kind
            || previous.kind === "q1" && nextNetworkHost.kind === "q1" && JSON.stringify(previous.host.protocol) !== JSON.stringify(nextNetworkHost.host.protocol)
            || previous.kind === "q2" && nextNetworkHost.kind === "q2" && JSON.stringify(previous.host.protocol) !== JSON.stringify(nextNetworkHost.host.protocol))
            throw new Error("The destination uses a different demo protocol");
        } catch (error) { recordingTransitionError = error; nextNetworkHost = null; }
      }
      const preparedCommands = await this.prepareSourceCommands(nextSimulation, content, save !== undefined, candidateAction);
      candidateCommands = preparedCommands.commands;
      modCommands.flush();
      await this.prepareGuestBots(content, nextSimulation);
      const restoredGuest = nextSimulation.q3Guest();
      if (guestTransition !== null && restoredGuest !== null) {
        const authority = createQ3ApplicationServerHost({ session: this.session, simulation: nextSimulation, content, print: text => this.host.print(text) });
        const serverId = (restoredGuest.state.cvars.variableValue("sv_serverid") + 1) | 0;
        if (this.network === null) {
          nextLocalGuest = { worldSound: createIdentityOwner("local-qvm-world-audio").actor(1022, 0), authority,
            seats: new Map<SeatId, LocalQ3GuestSeat>(), pendingCommands: [] };
          await authority.prepare(0, serverId);
        }
        await restoredGuest.initialize(this.network === null ? this.guestOutput(nextLocalGuest) : guestCandidateOutput,
          { kind: guestRestart ? "map-restart" : "map-change", clients: guestTransition.clients });
        if (q3Map !== undefined) applyQ3MapLaunch(restoredGuest.state.cvars, q3Map, "finish");
        for (const carried of guestTransition.clients) {
          if (guestRejectedClients.has(carried.client)) continue;
          const admission = await restoredGuest.reconnect(carried.client);
          if (admission.kind === "rejected") {
            if (this.network?.kind !== "q3") throw new Error(admission.reason);
            guestRejectedClients.set(carried.client, admission.reason); continue;
          }
          const local = previous?.input.locals.find(local => local.player.seat.client.id.equals(carried.client));
          if (local !== undefined && nextLocalGuest !== null) {
            const seat = local.player.seat, userinfo = restoredGuest.state.getUserinfo(carried.client.slot) ?? carried.userinfo;
            const cvars = this.createClientCvars(nextSimulation, content, options, seat, userinfo, previousClientCvars.get(seat.id));
            this.prepareLocalGuestSeat(nextLocalGuest, nextSimulation, seat, cvars, userinfo, authority.gameState(admission.player, serverId));
            nextClientCvars.set(seat.id, cvars);
          }
          if (this.network === null) await restoredGuest.begin(admission.player, carriedGuestCommands.get(carried.client.slot)
            ?? { serverTime: destinationSourceMilliseconds, angles: [0, 0, 0], forwardmove: 0, rightmove: 0, upmove: 0, buttons: 0, weapon: 2 });
          admissions.set(carried.client.slot, admission.player.actor);
        }
        this.publishLocalGuestSnapshots(nextLocalGuest, nextSimulation);
        if (previous !== null) nextGuestBrowser ??= await this.openGuestBrowser();
      }
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
        if (assets === null) {
          assets = new ApplicationAssets(content, previous.renderer.owner, undefined, { imageRegistry: previous.renderer.images,
            ...(this.imageSettings === null ? {} : { imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy }) });
          await assets.loadWorld();
        }
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
        this.restoreSourceInputAngles(input, nextSimulation);
        input.resumeCommands(Math.max(previous.input.nextCommandSequence,
          ...players.map(player => (nextSimulation.movementPlayer(player.actor)?.lastSequence ?? -1) + 1)));
        const audio = new ApplicationAudio(content, () => this.elapsed, options.seed, options.characterModel, text => this.host.print(text),
          { ...await loadAudioSettings(this.inputConfig), musicControls: this.musicControls, q3TeamGame: () => nextSimulation.teamGame(), deferOutput: true });
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
        if (candidateImages !== null) {
          audio.bindVolumeCvars(candidateImages.settings.cvars);
          audio.bindOutputCvars(candidateImages.settings.cvars);
        }
        if (input !== previous.input) {
          applyFrontendPreferences(frontendOverrides, input, audio);
          for (const local of input.locals) {
            const previousSettings = seatInputPreferences.get(local.player.seat.id);
            if (previousSettings !== undefined) applyFrontendInput(previousSettings, local);
          }
        }
        const current = simulation, worldAssets = assets, menuArt = art;
        const rerelease = new ApplicationRereleasePresentation(assets, players.map(player => ({ seat: player.seat.id, actor: player.actor })), input.sharedSettings());
        const presentations: WorldSeatPresentation[] = [], q3Clients = new Map<SeatId, Q3SeatClient>();
        for (const [index, local] of input.locals.entries()) {
          const sourceClient = await this.createQ3SeatClient(local, worldAssets, audio, input, previous.renderer, current, undefined, nextLocalGuest, nextGuestBrowser, nextClientCvars.get(local.player.seat.id));
          if (sourceClient !== null) { stagedClients.push(sourceClient.client); q3Clients.set(local.player.seat.id, sourceClient); }
          if (this.viewSettings.override !== null) {
            if (sourceClient?.kind !== "qvm") current.setPlayerFieldOfView(local.player.actor, this.viewSettings.fieldOfView, save === undefined ? "change" : "restore");
            sourceClient?.client.cvars.set("cg_fov", String(this.viewSettings.fieldOfView));
          }
          if (sourceClient?.kind === "qvm") await sourceClient.client.prepare(this.presentationFrames);
          const nativeSeat = await this.prepareNativeQ2Seat(local, worldAssets, current, nextClientCvars.get(local.player.seat.id));
          if (nativeSeat !== null) nextNativeQ2.set(local.player.seat.id, nativeSeat);
          const ui = new ApplicationSeatUi(local, menuArt, input, operation => previous.renderer.mutateWindow(operation), current, font, audio, () => this.requestQuit(),
            (name, args) => this.queueCommand(name, args, local.player.seat.id), typography, { bindings: () => current.serverSettings(), store: this.serverProfileStore },
            await rerelease.languageBinding(local.player.seat.id, content.recipe.map.entities.content, error => local.console.print(`Language reload failed: ${String(error)}\n`)), this.saveMenu(current, options), this.viewSettings.binding(), this.host.llm, sourceClient?.kind === "qvm", this.teamArenaResults(current, local.player.seat), this.uiSourceOptions(current, rerelease, local.player.seat.id, nextClientCvars));
          const preference = preferences[index]; if (preference !== undefined) ui.preferences.values = preference;
          const presentation = new WorldSeatPresentation(local, worldAssets, previous.renderer, current, options.seats, font, characters, ui, nativeSeat?.effects ?? effects, sourceClient?.client ?? null, rerelease, () => this.imageSettings?.cvars.variableValue("gl_debug_distfrac") ?? 0.004, () => this.viewSettings.fieldOfView, { lines: () => current.debugLines(), lineWidth: () => this.imageSettings?.debugLineWidth ?? 2 }, () => this.imageSettings?.cvars.variableValue("con_scale") ?? 0, () => readQ1ViewSettings(this.imageSettings?.cvars ?? null, this.sourceDialect(content)), () => (this.imageSettings?.cvars.variableValue("r_shadows") ?? 0) !== 0, camera => this.tools?.applyCamera(camera) ?? camera, await this.createDebugGraphOverlay(worldAssets), nativeSeat?.descriptor);
          stagedPresentations.push(presentation);
          presentations.push(presentation);
        }
        nextGraphical = { renderer: previous.renderer, input, audio, effects, art, assets, presentations, q3: q3Clients, rerelease, nativeQ2: nextNativeQ2,
          selectedQ3Presentations: new ApplicationSelectedQ3Presentations({ assets, audio, queries: current.scene,
            print: text => this.host.print(text), nextFrame: this.host.loading?.nextFrame ?? setImmediate,
            clock: { now: () => this.presentationMilliseconds ?? this.elapsed, frameNumber: () => this.presentationFrames }, hardware: () => q3Hardware(previous.renderer.driver?.renderer ?? "") === "ragepro" ? "ragepro" : "generic" }),
          modPresentations: new ApplicationModPresentations({ assets, audio, input, queueCommand: request => { this.requestedCommands.push(request); }, renderer: previous.renderer, queries: current.scene,
            presentationMedia: componentMediaControl(current.events, audio, assets),
            systemCinematics: (_source, presentation, scope) => this.systemCinematics(current, content, worldAssets, audio, previous.renderer, presentation.local.player.seat.id, input, scope),
            print: text => this.host.print(text), nextFrame: this.host.loading?.nextFrame ?? setImmediate,
            clock: { now: () => committed ? this.presentationMilliseconds ?? this.elapsed : destinationSourceMilliseconds, frameNumber: () => this.presentationFrames } }) };
        if (save !== undefined) await this.restoreComponentClients(save, nextGraphical, nextSimulation);
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
        await retire("ranking retirement", () => this.closeRankings(previousSimulation));
        if (this.archivePersistence && !this.preparedStartup?.pending && !sameSourceOwner) await retire("previous source archive", () => this.saveSourceArchive(previousOptions, previousContent, previousSimulation, previousOverrides));
        if (this.archivePersistence && !this.preparedStartup?.pending && !sameClientOwner) await retire("previous client archives", () => this.saveClientArchives(previousOptions, previousContent, previousClientCvars, previousOverrides));
        if (this.ownership.kind === "owned") await retire("capture retirement", () => previousCapture?.close());
        await retire("bot retirement", () => previousBots?.close(initialSourceMilliseconds !== 0));
        for (const { state } of previousLocalGuest?.seats.values() ?? []) await retire("guest seat retirement", () => state.retire());
        previousLocalGuest?.seats.clear();
        for (const source of previous?.q3.values() ?? []) if (source.kind === "qvm")
          await retire("guest client retirement", () => source.client.close());
        await retire("component presentation retirement", () => previous?.modPresentations.close());
        await retire("selected source presentation retirement", () => previous?.selectedQ3Presentations.close());
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
          await retire("renderer resource retirement", () => previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.presentationFrames,
            commands: previous.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) }));
        }
        await retire("content retirement", () => previousContent.close());
      };
      const adoptHeadless = (() => {
        const prepared = this.preparedStartup;
        if (nextGraphical !== null || prepared === null) return () => {};
        const scripts = new ConsoleScriptFiles({ ...legacyConfigurationOptions(options, content.catalog, content.recipe.engineBehavior.content),
          consoleRoot: consoleConfigRoot(options.userContentRoot), settings: this.inputConfig,
          mountedScript: sourceScriptReader(content.catalog, content.mounts, content.recipe.engineBehavior.content),
          mountedResource: name => content.mounts.open(name),
    mountedFiles: (directory, extension) => content.mounts.listFiles(directory, extension),
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
      this.debugGraph = candidateGraph;
      this.loadedContent = content;
      this.launchOptions = options;
      this.bots = nextBots;
      this.graphical = nextGraphical;
      this.clientCvars = nextClientCvars;
      this.teamArenaOverrides = nextOverrides;
      this.localGuest = nextLocalGuest;
      if (recordingTransitionError !== null) {
        if (this.ownership.kind === "borrowed") await this.ownership.client.stopRecording(this); else await this.ownedRecording?.stop();
        this.host.print(`Demo recording stopped at world change: ${recordingTransitionError instanceof Error ? recordingTransitionError.message : String(recordingTransitionError)}\n`);
      }
      if (this.network === null && !this.localRecordingActive && this.simulation.q2Native() === null) this.recordingHost = null;
      if (nextNetworkHost !== null && this.network === null) {
        if (nextNetworkHost.kind === "qw") this.nativeWorldCount++;
        this.recordingHost = nextLocalGuest === null ? nextNetworkHost : { kind: "q3", host: nextLocalGuest.authority };
        if (this.recordingHost.kind === "q3" && nextLocalGuest === null) {
          const cvars = this.sourceCvars();
          if (cvars?.find("sv_serverid") === undefined) throw new Error("Q3 recording replacement has no published epoch");
          await this.recordingHost.host.prepare(0, cvars.variableValue("sv_serverid"));
        }
      }
      this.guestBrowser = nextGuestBrowser;
      this.frontendOverrides = frontendOverrides;
      this.capture = nextCapture;
      this.tools?.beforeWorldChange();
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
        this.refreshApplicationTools();
        if (candidateImages !== null && this.imageSettings !== null) {
          const fovChanged = candidateImages.settings.cvars.variableString("fov") !== this.imageSettings.cvars.variableString("fov");
          this.releaseViewCvars?.(); this.releaseViewCvars = null;
          candidateImages.publish();
          nextGraphical?.input.publishSharedCvars(this.imageSettings.cvars);
          nextGraphical?.audio.bindVolumeCvars(this.imageSettings.cvars);
          nextGraphical?.audio.bindOutputCvars(this.imageSettings.cvars);
          if (fovChanged) this.viewSettings.setFieldOfView(Number(this.imageSettings.cvars.variableString("fov")));
          this.releaseViewCvars = this.viewSettings.bindCvars(this.imageSettings.cvars);
        }
        if (this.ownership.kind === "borrowed" && nextGraphical !== null)
          nextGraphical.input.publishClientSeats(this.ownership.client, "replace");
        if (previous !== null && nextGraphical !== null) previous.input.transferPlatformTo(nextGraphical.input);
        else nextGraphical?.input.adoptStartup();
        this.publishKeys();
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
        nextGraphical?.modPresentations.publishRestored();
        if (nextGraphical !== null && this.imageSettings !== null) applyAudioOutputSettings(this.imageSettings.cvars, nextGraphical.audio);
        if (this.ownership.kind === "borrowed" && nextGraphical !== null) {
          this.ownership.client.platform.current = { kind: "world", input: nextGraphical.input };
          this.ownership.client.output.current = nextGraphical.audio.engine;
          this.ownership.client.sourceProfile.current = content.recipe.map.entities;
        }
        adoptHeadless();
        this.ownedDemos?.service.refresh();
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
      if (nextNetworkHost !== null && this.network !== null) {
        if (guestTransition === null) await retire("network publication", () => this.changeNetworkWorld(nextNetworkHost));
        else {
          if (this.network.kind !== "q3" || nextNetworkHost.kind !== "q3") throw new Error("Guest map publication requires the Q3 network owner");
          this.recordingHost = nextNetworkHost;
          await this.network.server.changeWorld(nextNetworkHost.host, [...guestRejectedClients].map(([client, reason]) => ({ client, reason })));
          guestNetworkPublished = true;
          for (const command of guestNetworkCommands.splice(0)) await this.guestOutput().sendServerCommand(command.slot, command.text);
        }
      }
      if (nextUnifiedHost !== null) {
        const network = this.network;
        if (network?.kind !== "unified") throw new Error("Mixed-game travel lost its retained server");
        network.server.changeWorld(nextUnifiedHost.host, nextUnifiedHost.composition);
      }
      if (skirmish !== undefined) this.startTeamArenaSkirmish(skirmish);
      for (const failure of retirementErrors) this.host.print(`Entered world; ${failure.label} failed: ${String(failure.error)}\n`);
      await this.rankingFrame();
      this.host.print(`Entered ${content.recipe.map.geometry.requestedPath}.\n`);
    } catch (error) {
      if (committed) { this.fatalWorldFailure = true; this.closed = true; this.stopping = true; throw error; }
      if (nativeCommitted) this.fatalWorldFailure = true;
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
      await discard(() => nextGraphical?.modPresentations.close());
      for (const presentation of stagedPresentations) await discard(() => presentation.close());
      for (const seat of nextNativeQ2.values()) await discard(() => seat.effects.close());
      await discard(() => nextAudio?.close());
      await discard(() => nextEffects?.close());
      await discard(() => nextInput?.close());
      await discard(() => nextScripts?.close());
      await discard(() => nextBots?.close());
      if (guestTransition !== null) await discard(() => simulation?.shutdownQ3Guest());
      await discard(() => simulation?.q3Guest()?.discard());
      await discard(() => simulation?.close());
      for (const client of savedClients?.added ?? []) await discard(() => client.close());
      await discard(() => art?.close());
      await discard(() => assets?.close());
      if (previous !== null) await discard(() => previous.renderer.execute({ owner: previous.renderer.owner, sequence: this.presentationFrames, commands: [] }));
      await discard(() => content.close());
      if (errors.length > 1) throw new AggregateError(errors, "World preparation failed");
      throw error;
    }
  }

  async changeLevel(map: string, spawnPoint = ""): Promise<void> {
    if (this.closed || this.stepping) throw new Error("World travel requires an idle open application");
    const native = this.simulation.q2Native() !== null;
    const campaign = this.simulation.q2Source() !== null && this.network === null && this.options.network.kind === "offline"
      && (this.options.mode === "singleplayer" || this.options.mode === "coop");
    if (native || campaign) {
      await this.advanceQ2Travel({ kind: "map", name: map, spawnPoint, newUnit: false, next: null }, native ? null : this.simulation.captureTravel(spawnPoint));
      return;
    }
    await this.replaceWorld(map, this.simulation.q3Source() === null && this.simulation.q3Guest() === null ? this.simulation.captureTravel(spawnPoint) : null);
  }

  private async restoreComponentClients(image: SaveImage, graphical: NonNullable<Application["graphical"]>, simulation: SharedSimulation): Promise<void> {
    const checkpoint = readComponentClients(image), sources = simulation.modPresentationSources();
    if (checkpoint === null) {
      if (sources.length !== 0) this.host.print("This save predates component client continuation; original component clients will initialize from the restored world.\n");
      return;
    }
    await graphical.modPresentations.restoreCheckpoint(checkpoint, graphical.presentations, sources, saved => simulation.actors.referenceSaved(saved, "checkpoint"));
  }

  async saveGame(path: string, format: ApplicationSaveFormat = "shared"): Promise<void> {
    if (this.closed) throw new Error("Application is closed");
    const unavailable = this.saveUnavailable("manual");
    if (unavailable !== null) throw new Error(unavailable);
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    if ((this.campaignMovie !== null && this.campaignMovie.componentOwned !== true) || this.pendingTeamArena !== null || (this.pendingMap !== null || this.pendingNativeTravel !== null) || this.pendingRestart !== null || this.pendingTransition !== null || this.pendingSave !== null)
      throw new Error("Saving requires pending world travel or restoration to finish");
    if (this.requestedCommands.some(command => command.target === "component-client") || this.graphical?.modPresentations.pendingCommands)
      throw new Error("Saving requires pending component commands to finish");
    this.worldOperation = "saving";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try {
      if (format !== "shared") {
        if (this.campaignMovie !== null) throw new Error("Active component cinematics require a shared save");
        const product = this.content.catalog.product(this.content.recipe.map.entities.content);
        const data = this.simulation.captureOriginalSave(format === "v5" ? { version: 5 } : { version: 6, gameDirectories: basename(product.expectation.contentDirectory) }, basename(path, ".sav"));
        await writeSavedGame(this.saveDirectory, path, { kind: "q1-source", data });
        return;
      }
      const captured = await serviceLoading(nextFrame => this.simulation.checkpointLoading(nextFrame), () => {
        if (!this.closed) this.graphical?.input.pollLoadingEvents();
      });
      if (this.requestedCommands.some(command => command.target === "component-client")) throw new Error("Component commands changed during checkpoint capture");
      const sources = this.simulation.modPresentationSources();
      if (this.campaignMovie?.componentOwned === true && (this.graphical === null || sources.length === 0)) throw new Error("Active component cinematic has no saved client owner");
      const clients = this.graphical === null || sources.length === 0 ? captured : saveComponentClients(captured,
        this.graphical.modPresentations.captureCheckpoint(this.graphical.presentations, sources));
      const image = this.campaignUnit.attach(saveTeamArenaOverrides(clients, this.teamArenaOverrides, this.overrideSeats()));
      await writeSavedGame(this.saveDirectory, path, { kind: "shared", image });
    }
    finally { this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve(); this.resumeInput(); }
  }

  async loadGame(path: string, sourceProduct?: string): Promise<void> {
    if (this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
    if (this.closed || this.stepping) throw new Error("Save restoration requires an idle open application");
    await this.restoreSavedGame(path, sourceProduct);
  }

  private async restoreSavedGame(path: string, sourceProduct?: string): Promise<void> {
    if (this.campaignMovie !== null) throw new Error("Finish or skip the campaign cinematic before loading a save");
    if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
    this.worldOperation = "loading";
    const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
    try {
      try {
        await serviceLoading(async nextFrame => {
          const { image, options } = await prepareApplicationSave(this.options, this.content.catalog, path, sourceProduct);
          const unit = new CampaignUnit(); unit.restore(image);
          await this.prepareAndReplaceWorld(image.recipe.map.geometry.requestedPath, null, 0, image, undefined, undefined, undefined, nextFrame, false, "", options);
          this.campaignUnit = unit;
        }, () => { if (!this.closed) this.graphical?.input.pollLoadingEvents(); });
        this.pendingTeamArena = null; this.pendingMap = null; this.pendingQ3Map = undefined; this.pendingNativeTravel = null; this.pendingRestart = null; this.pendingTransition = null; this.pendingSave = null;
        this.timedAutosave.worldChanged();
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
        await this.closeRankings(simulation);
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
      await this.rankingFrame();
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
      || (this.pendingMap !== null || this.pendingNativeTravel !== null) || this.pendingTransition !== null || this.simulation.pendingMatchMap() !== null
      || this.pendingRestart !== null && this.elapsed >= this.pendingRestart);
  }

  private async applyTransition(): Promise<void> {
    if (this.clientCommandsBlocked) return;
    if (this.pendingSave !== null) {
      const { path, sourceProduct } = this.pendingSave, previous = this.content;
      this.pendingSave = null;
      try {
        await this.restoreSavedGame(path, sourceProduct);
        this.pendingTeamArena = null; this.pendingMap = null; this.pendingQ3Map = undefined; this.pendingNativeTravel = null; this.pendingRestart = null; this.pendingTransition = null;
      } catch (error) {
        if (this.fatalWorldFailure || this.content !== previous) throw error;
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
        const setup = await readTeamArenaSkirmish(this.content.catalog, skill, { map: this.options.map, gameType, advance: action === "next" },
          { player: source.host.cvars.variableString("ui_teamName"), opponent: source.host.cvars.variableString("ui_opponentName") },
          { mounts: this.content.mounts, policy: this.content.q3Product?.policy ?? { kind: "retail" } });
        await this.replaceWorld(setup.map, null, 0, undefined, setup);
      } catch (error) {
        if (this.fatalWorldFailure || this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    const matchMap = this.simulation.pendingMatchMap();
    if (matchMap !== null) {
      if (this.host.lobby !== undefined && await this.finishQ2Match()) return;
      await this.replaceWorld(mapResourcePath(matchMap), this.simulation.captureTravel()); return;
    }
    if (this.pendingNativeTravel !== null) {
      const target = this.pendingNativeTravel; this.pendingNativeTravel = null;
      try { await this.advanceQ2Travel(target, null); }
      catch (error) { if (this.fatalWorldFailure) throw error; this.reportCampaignTravelError(error); }
      return;
    }
    if (this.pendingMap !== null) {
      const map = this.pendingMap, previous = this.content, q3Map = this.pendingQ3Map;
      this.pendingQ3Map = undefined;
      this.pendingMap = null; this.pendingQ3Map = undefined; this.pendingNativeTravel = null;
      this.pendingTransition = null;
      this.pendingRestart = null;
      try { await this.replaceWorld(map, null, 0, undefined, undefined, undefined, undefined, q3Map); }
      catch (error) {
        if (this.fatalWorldFailure || this.content !== previous) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.host.print(`${message}\n`);
        for (const local of this.graphical?.input.locals ?? []) local.console.print(`${message}\n`);
      }
      return;
    }
    if (this.pendingRestart !== null && (this.simulation.q3Source()?.host.now() ?? this.simulation.q3Guest()?.timeMilliseconds ?? this.elapsed) >= this.pendingRestart) {
      this.pendingRestart = null;
      if (this.simulation.q3Guest() !== null) {
        await this.replaceWorld(this.options.map, null, this.simulation.q3Guest()?.timeMilliseconds ?? this.elapsed, undefined, undefined, undefined, undefined, undefined, true);
        this.lastRestartFrame = this.frames; return;
      }
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
      if (this.host.lobby !== undefined && await this.finishQ2Match()) return;
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

  private async advanceQ2Travel(target: Q2TravelTarget, carry: SimulationTravel | null): Promise<void> {
    if (target.kind === "map") {
      if (carry === null) {
        if (this.simulation.q2Native() === null) throw new Error("Native campaign travel has no retained DLL");
        await this.replaceWorld(target.name, null, 0, undefined, undefined, undefined, target, undefined, false, q2NextServerCommand(target));
        return;
      }
      if (this.worldOperation !== "idle") throw new Error("Another world operation is in progress");
      this.worldOperation = "travel";
      const completion = Promise.withResolvers<void>(); this.worldOperationCompletion = completion.promise;
      let captured: SaveImage;
      try { captured = await serviceLoading(nextFrame => this.simulation.checkpointLoading(nextFrame), () => {
        if (!this.closed) this.graphical?.input.pollLoadingEvents();
      }); }
      finally { this.worldOperation = "idle"; this.worldOperationCompletion = null; completion.resolve(); }
      const visit = this.campaignUnit.stage({ content: this.content.recipe.map.geometryContent, path: target.name }, target.newUnit, captured);
      await this.replaceWorld(target.name, { ...carry, spawnPoint: target.spawnPoint }, 0, visit.restore ?? undefined, undefined, () => {
        this.sourceCvars()?.set("nextserver", q2NextServerCommand(target), true);
        visit.commit();
      }, undefined, undefined, false, q2NextServerCommand(target));
      return;
    }
    const graphical = this.graphical, seat = this.localPlayers[0]?.seat.id;
    if (graphical === null || seat === undefined || this.network !== null)
      throw new Error("Campaign cinematics require an offline local presentation");
    const simulation = this.simulation, request = this.reserveMovie(simulation);
    const current = (): boolean => !this.closed && !this.stopping && this.simulation === simulation && this.movieRequests.get(simulation) === request;
    const playback = await CampaignCinematic.prepare({ name: target.name, loop: false, hold: false, silent: false }, this.content,
      graphical.assets, graphical.audio, graphical.renderer, seat, current, this.screenCaptions(simulation, this.content, seat));
    if (!current()) { playback.close(this.presentationFrames); throw new Error("Campaign cinematic belongs to a retired world request"); }
    const next = target.kind === "picture" && target.name.toLowerCase() === "victory.pcx" && this.options.mode === "coop"
      ? parseQ2Travel("*base1") : target.next;
    this.activateMovie(playback);
    this.movies.set(simulation, { playback, request, current, complete: async () => {
      if (!current()) return;
      if (next !== null) await this.advanceQ2Travel(carry === null && target.newUnit ? { ...next, newUnit: true } : next, carry); else this.requestQuit();
    } });
  }

  private activateMovie(playback: CampaignCinematic): void {
    try { playback.activate(); }
    catch (error) {
      try { playback.close(this.presentationFrames); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Cinematic activation and cleanup failed"); }
      throw error;
    }
  }

  private reserveMovie(simulation: SharedSimulation): object {
    const request = {}; this.movieRequests.set(simulation, request);
    const previous = this.movies.get(simulation);
    if (previous !== undefined) { this.movies.delete(simulation); previous.playback.close(this.presentationFrames); }
    return request;
  }

  private screenCaptions(simulation: SharedSimulation, content: Pick<LoadedApplicationContent, "mounts">, seat: SeatId): ScreenCinematicCaptions {
    const captions = new SeatMediaCaptions(seat, async path => (await content.mounts.open(path))?.bytes ?? null, null, "subtitle", {
      read: () => this.graphical?.rerelease.selectedLanguage(seat) ?? "english", failed: error => this.host.print(`Caption language reload failed: ${String(error)}\n`) });
    return {
      prepare: source => captions.prepare(source, this.graphical?.rerelease.selectedLanguage(seat) ?? "english"),
      commands: (timeline, viewport) => {
        if (this.simulation !== simulation) return [];
        const presentation = this.graphical?.presentations.find(value => value.local.player.seat.id.equals(seat));
        if (presentation === undefined) return [];
        return presentation.ui.captionCommands(captions.active(timeline, { subtitles: presentation.ui.preferences.values.captions,
          soundCaptions: presentation.ui.preferences.values.captions, speakers: true }), {
          binding: { ...presentation.state.presentation, viewport, safeArea: viewport }, timeMilliseconds: timeline.elapsedMilliseconds });
      },
    };
  }

  private systemCinematics(simulation: SharedSimulation, content: LoadedApplicationContent, assets: ApplicationAssets,
    audio: ApplicationAudio, renderer: NativeRenderer, seat: SeatId, input: ApplicationInput,
    component?: { readonly cvars: CvarRegistry; readonly mounts: LoadedApplicationContent["mounts"]; append(text: string): void }): SystemCinematicHost {
    const resources = component === undefined ? content : { mounts: component.mounts };
    const prepare = async (request: ScreenCinematicRequest | null, consumerCurrent: () => boolean, saved?: SaveReader): Promise<SystemCinematicHandle> => {
      let phase = saved?.field("phase").choice("playing", "completed", "stopped") ?? "playing";
      if (saved !== undefined && phase !== "playing" && saved.field("playback").value !== null) saved.fail("terminal system cinematic retained an active decoder");
      const local = input.locals.find(value => value.player.seat.id.equals(seat));
      if (local === undefined) throw new Error("Cinematic has no admitted viewing seat");
      const cvars = component?.cvars ?? this.sourceCvars(simulation);
      let published = saved === undefined, playback: CampaignCinematic | null = null;
      const ticket = saved === undefined ? this.reserveMovie(simulation) : {};
      const current = (): boolean => !this.closed && !this.stopping && consumerCurrent()
        && input.locals.includes(local) && (!published || this.movieRequests.get(simulation) === ticket);
      const complete = (): void => {
        if (phase !== "playing" || !current() || this.simulation !== simulation) return;
        phase = "completed";
        const next = cvars?.variableString("nextmap") ?? "";
        if (next.length === 0) return;
        if (component !== undefined) component.append(`${next}\n`);
        else input.enqueueClientCommand(`${next}\n`, { session: this.session.session, origin: { kind: "script", name: "cinematic",
          caller: { kind: "local-seat", seat, client: local.player.seat.client.id } } });
        cvars?.set("nextmap", "", true);
      };
      if (phase === "playing") {
        if (saved === undefined) {
          if (request === null) throw new Error("Missing system cinematic request");
          playback = await CampaignCinematic.prepare(request, resources, assets, audio, renderer, seat, current, this.screenCaptions(simulation, resources, seat));
        } else playback = await CampaignCinematic.restore(saved.field("playback").value, resources, assets, audio, renderer, seat, current, this.screenCaptions(simulation, resources, seat));
        if (!current()) { playback.close(this.presentationFrames); throw new Error("System cinematic belongs to a retired destination request"); }
        if (saved !== undefined && this.movies.has(simulation)) { playback.close(this.presentationFrames); throw new Error("Saved component cinematics have competing fullscreen owners"); }
        const movie: NonNullable<Application["campaignMovie"]> = { playback, request: ticket, current, complete: async (): Promise<void> => { complete(); },
          ...(component === undefined ? {} : { componentOwned: true }) };
        if (published && this.simulation === simulation) this.activateMovie(playback);
        this.movies.set(simulation, movie);
      }
      const detach = (): void => {
        if (this.movies.get(simulation)?.request === ticket) this.movies.delete(simulation);
        if (this.movieRequests.get(simulation) === ticket) this.movieRequests.delete(simulation);
      };
      return { get status() { return phase === "completed" ? "ended" : phase === "stopped" || !current() ? "stopped" : playback?.status ?? "stopped"; },
        skip: () => {
          if (phase !== "playing" || !current()) return;
          playback?.skip(); playback?.close(this.presentationFrames);
          try { complete(); } finally { detach(); }
        }, stop: () => { phase = "stopped"; detach(); playback?.close(this.presentationFrames); },
        ...(component === undefined ? {} : {
          captureCheckpoint: () => {
            const active = phase === "playing" && current();
            return { version: 1, phase: active ? "playing" : phase === "completed" ? "completed" : "stopped",
              playback: active ? playback?.captureCheckpoint() : null };
          },
          publishRestored: () => {
            if (published) return;
            if (!current()) throw new Error("Restored component movie has retired before publication");
            if (phase === "playing") {
              if (playback === null || this.movies.get(simulation)?.request !== ticket) throw new Error("Restored fullscreen cinematic lost its destination owner");
              this.movieRequests.set(simulation, ticket); published = true; this.activateMovie(playback);
            } else published = true;
          },
        }) };
    };
    return { open: (request, current) => prepare(request, current), ...(component === undefined ? {} : {
      restore: (value: unknown, current: () => boolean) => {
        const r = new SaveReader(value, "component-system-cinematic"); r.field("version").literal(1);
        return prepare(null, current, r);
      },
    }) };
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

  private localViewport(seat: SeatId, width: number, height: number) {
    const seats = [...this.localSeats.values()].sort((a,b)=>a.id.index-b.id.index);
    const index = seats.findIndex(local=>local.id.equals(seat));
    return seatViewport(index,seats.length,width,height);
  }

  private async retireRemovedLocalPlayers(): Promise<void> {
    const graphical = this.graphical;
    if (graphical === null) return;
    const removed = graphical.input.locals.filter(local => !this.simulation.actors.isLive(local.player.actor));
    if (removed.length === 0) return;
    const seats = removed.map(local => local.player.seat), clients = [...new Set(seats.map(seat => seat.client))];
    const presentations = graphical.presentations.filter(presentation => !seats.includes(presentation.local.player.seat));
    const failures: unknown[] = [], dispose = (run: () => void): void => { try { run(); } catch (error) { failures.push(error); } };
    // Publish the reduced readers before resource disposal can invoke another host callback.
    this.graphical = { ...graphical, presentations };
    dispose(() => graphical.modPresentations.retainPresentations(presentations));
    dispose(() => graphical.selectedQ3Presentations.retainPresentations(presentations));
    for (const seat of seats) {
      const source = graphical.q3.get(seat.id); graphical.q3.delete(seat.id); graphical.nativeQ2.delete(seat.id);
      try { await source?.client.shutdown(); } catch (error) { failures.push(error); }
      const guest = this.localGuest?.seats.get(seat.id); this.localGuest?.seats.delete(seat.id);
      dispose(() => guest?.state.retire());
      this.clientCvars.delete(seat.id); this.rankingMenuRequests.delete(seat.id);
    }
    if (seats.some(seat => this.recordingSeat?.equals(seat.id) === true)) {
      try {
        if (this.ownership.kind === "borrowed") await this.ownership.client.stopRecording(this); else await this.ownedRecording?.stop();
      } catch (error) { failures.push(error); }
      this.recordingSeat = null; this.localRecordingActive = false;
    }
    dispose(() => graphical.input.retireLocalSeats(seats, this.ownership.kind === "borrowed" ? this.ownership.client : undefined));
    for (const client of clients) {
      this.localSeats.delete(client.id); this.sourceConnections.delete(client);
      for (const buffer of new Set([this.sourceCommands, this.dedicatedCommands])) if (buffer !== null) dispose(() => buffer.discardClient(client.id));
      try { await this.disconnectRankings(this.simulation, client.id); } catch (error) { failures.push(error); }
      dispose(() => this.session.closeClient(client.id));
    }
    this.requestedCommands = this.requestedCommands.filter(command => !seats.some(seat => command.seat?.equals(seat.id) === true));
    this.clientInputs = this.clientInputs.filter(event => !seats.some(seat => seat.id.equals(event.seat)));
    this.deferredInput = this.deferredInput.filter(event => !seats.some(seat => seat.id.equals(event.seat)));
    dispose(() => graphical.rerelease.publishSeats(graphical.input.locals.map(local => ({ seat: local.player.seat.id, actor: local.player.actor }))));
    for (const [index, presentation] of presentations.entries()) dispose(() => presentation.publishLayout(index, presentations.length));
    if (presentations.length === 0) this.requestQuit();
    else this.launchOptions = { ...this.options, seats: presentations.length };
    if (failures.length !== 0) throw new AggregateError(failures, "Retired local player cleanup failed");
  }

  private async changeLocalPlayers(kind: "join" | "drop", args: readonly string[], invokingSeat: SeatId | null): Promise<void> {
    const graphical = this.graphical;
    if (graphical === null || this.worldOperation !== "idle") throw new Error("Local player changes require an active graphical world");
    if (args.length > (kind === "drop" ? 1 : 0)) throw new Error(kind === "join" ? "Usage: local_join" : "Usage: local_drop [player number]");
    const selected = args[0] === undefined ? invokingSeat ?? graphical.input.locals.at(-1)?.player.seat.id : graphical.input.locals.find(local => local.player.seat.id.index + 1 === Number(args[0]))?.player.seat.id;
    if (kind === "drop" && (selected === undefined || graphical.input.locals.length === 1)) throw new Error("Keep at least one local player in the world");
    const request: LocalSeatRequest | null = kind === "join" ? { kind } : selected === undefined ? null : { kind, seat: selected };
    if (request === null) throw new Error("Unknown local player");
    const change = prepareLocalSeatChange(this.session, graphical.input.locals.map(local => ({client:local.player.seat.client,seat:local.player.seat})), request,
      {localSeats:4,clients:this.simulation.options.maxClients});
    let committed = false;
    let stagedPresentation: WorldSeatPresentation | null = null;
    let stagedUi: ApplicationSeatUi | null = null;
    let stagedNativeSeat: NativeQ2SeatClient | null = null;
    let preparedInput: Awaited<ReturnType<ApplicationInput["prepareLocalSeats"]>> | null = null;
    try {
      await graphical.input.saveSettings();
      await this.saveClientArchives(this.options,this.content,this.clientCvars,this.teamArenaOverrides);
      preparedInput = await graphical.input.prepareLocalSeats(change.next.map(local => local.seat));
      const added = change.added;
      const archive = added === null ? [] : await this.loadClientArchive(added.seat,this.content);
      const font = await graphical.assets.loadConsoleFont(), typography = await graphical.assets.loadMenuTypography();
      const characters = added !== null && this.options.character === "q3" ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
        {model:this.options.characterModel,skin:"default",headModel:"",headSkin:"default",team:null,teamName:""}) : null;
      change.validate();
      if (this.graphical !== graphical || this.closed) throw new Error("World changed during local player preparation");
      committed = true;
      const players = graphical.input.locals.filter(local => local.player.seat !== change.removed?.seat).map(local => local.player);
      if (added !== null) {
        const cvars = this.createClientCvars(this.simulation,this.content,this.options,added.seat,null,undefined,archive,true);
        this.localSeats.set(added.client.id,added.seat); this.clientCvars.set(added.seat.id,cvars);
        this.sourceConnections.set(added.client,added.client.connect("loopback"));
        if (this.localGuest !== null) {
          const authority=this.localGuest.authority, userinfo=`${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`;
          const admission=await authority.connect(added.client.id,userinfo);
          if(admission.kind==="rejected") throw new Error(admission.reason);
          this.prepareLocalGuestSeat(this.localGuest,this.simulation,added.seat,cvars,userinfo,authority.gameState(admission.player,1));
          await authority.begin?.(admission.player,{serverTime:0,angles:[0,0,0],forwardmove:0,rightmove:0,upmove:0,buttons:0,weapon:2});
          players.push({seat:added.seat,actor:admission.player.actor});
        } else {
          this.simulation.q3Source()?.host.engine.setUserinfo(added.client.id.slot,`${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`);
          const admitted = this.simulation.q2Native() === null ? this.simulation.admitPlayer(added.client.id, undefined, playerUserinfo(cvars))
            : this.simulation.admitQ2NativePlayer(added.client.id, `${cvars.infoString(CvarFlag.UserInfo)}\\ip\\localhost`);
          players.push({seat:added.seat,actor:admitted.actor});
        }
      }
      if(change.removed!==null) {
        const removed=graphical.input.locals.find(local=>local.player.seat===change.removed?.seat);
        if(removed===undefined)throw new Error("Dropped player is missing");
        graphical.presentations.find(presentation => presentation.local.player.seat === change.removed?.seat)?.ui.closeMenus();
        await this.disconnectRankings(this.simulation, change.removed.client.id);
        await graphical.q3.get(change.removed.seat.id)?.client.shutdown();
        const guest=this.simulation.q3Guest();
        if(guest!==null){const player=guest.players().find(player=>player.actor.equals(removed.player.actor));if(player===undefined)throw new Error("Guest player is missing");await guest.disconnect(player);}
        else this.simulation.disconnectPlayer(removed.player.actor);
        this.localSeats.delete(change.removed.client.id);this.clientCvars.delete(change.removed.seat.id);
        this.localGuest?.seats.delete(change.removed.seat.id);graphical.q3.delete(change.removed.seat.id);
        this.sourceConnections.delete(change.removed.client);
        const removedSeat = change.removed.seat.id;
        this.requestedCommands = this.requestedCommands.filter(command => command.seat === null || !command.seat.equals(removedSeat));
        this.clientInputs = this.clientInputs.filter(event => !event.seat.equals(removedSeat));
      }
      players.sort((a,b)=>a.seat.id.index-b.seat.id.index);
      preparedInput.publish(players,this.ownership.kind==="borrowed"?this.ownership.client:undefined);
      if (added !== null) this.restoreSourceInputAngles(graphical.input,this.simulation,added.seat.id);
      this.launchOptions={...this.options,seats:players.length};
      graphical.rerelease.publishSeats(players.map(player=>({seat:player.seat.id,actor:player.actor})));
      const presentations=graphical.presentations.filter(presentation=>presentation.local.player.seat!==change.removed?.seat);
      const additions: Parameters<EngineSession["publishLocalSeats"]>[0][number][]=[];
      if(added!==null){
        const local=graphical.input.locals.find(local=>local.player.seat===added.seat);
        if(local===undefined)throw new Error("Admitted local input is missing");
        const sourceClient=await this.createQ3SeatClient(local,graphical.assets,graphical.audio,graphical.input,graphical.renderer,this.simulation);
        if(sourceClient!==null)graphical.q3.set(added.seat.id,sourceClient);
        if(this.viewSettings.override!==null){if(sourceClient?.kind!=="qvm")this.simulation.setPlayerFieldOfView(local.player.actor,this.viewSettings.fieldOfView,"change");sourceClient?.client.cvars.set("cg_fov",String(this.viewSettings.fieldOfView));}
        const nativeSeat = await this.prepareNativeQ2Seat(local, graphical.assets, this.simulation, this.clientCvars.get(local.player.seat.id));
        stagedNativeSeat = nativeSeat;
        const ui=new ApplicationSeatUi(local,graphical.art,graphical.input,operation=>graphical.renderer.mutateWindow(operation),this.simulation,font,graphical.audio,()=>this.requestQuit(),
          (name,args)=>this.queueCommand(name,args,local.player.seat.id),typography,{bindings:()=>this.simulation.serverSettings(),store:this.serverProfileStore},
          await graphical.rerelease.languageBinding(local.player.seat.id,this.content.recipe.map.entities.content,error=>local.console.print(`Language reload failed: ${String(error)}\n`)),this.saveMenu(this.simulation,this.options),this.viewSettings.binding(),this.host.llm,sourceClient?.kind==="qvm",this.teamArenaResults(this.simulation,local.player.seat),this.uiSourceOptions(this.simulation,graphical.rerelease,local.player.seat.id));
        stagedUi=ui;
        const presentation=new WorldSeatPresentation(local,graphical.assets,graphical.renderer,this.simulation,players.length,font,characters,ui,nativeSeat?.effects??graphical.effects,sourceClient?.client??null,graphical.rerelease,()=>this.imageSettings?.cvars.variableValue("gl_debug_distfrac")??0.004,()=>this.viewSettings.fieldOfView,{lines:()=>this.simulation.debugLines(),lineWidth:()=>this.imageSettings?.debugLineWidth??2},()=>this.imageSettings?.cvars.variableValue("con_scale")??0,()=>readQ1ViewSettings(this.imageSettings?.cvars??null,this.sourceDialect()),()=>(this.imageSettings?.cvars.variableValue("r_shadows")??0)!==0, camera => this.tools?.applyCamera(camera) ?? camera, await this.createDebugGraphOverlay(graphical.assets), nativeSeat?.descriptor);
        stagedPresentation=presentation;
        presentations.push(presentation);additions.push({seat:added.seat,presentation,cleanup:()=>presentation.close()});
      }
      presentations.sort((a,b)=>a.local.player.seat.id.index-b.local.player.seat.id.index);
      for(const [index,presentation]of presentations.entries())presentation.publishLayout(index,presentations.length);
      const retired=change.publish(additions);
      for (const seat of [...graphical.nativeQ2.keys()]) if (!presentations.some(presentation => presentation.local.player.seat.id.equals(seat))) graphical.nativeQ2.delete(seat);
      if (stagedNativeSeat !== null && stagedPresentation !== null) graphical.nativeQ2.set(stagedPresentation.local.player.seat.id, stagedNativeSeat);
      this.graphical={...graphical,presentations};
      const publicationFailures: unknown[] = [];
      try { this.publishLocalGuestSnapshots(); } catch (error) { publicationFailures.push(error); }
      finally { try { retired.close(); } catch (error) { publicationFailures.push(error); } }
      if (publicationFailures.length === 1) throw publicationFailures[0];
      if (publicationFailures.length > 1) throw new AggregateError(publicationFailures, "Local player publication and retirement failed");
      this.host.print(`Local players: ${players.length}\n`);
    }catch(error){
      if(committed){
        this.fatalWorldFailure=true;
        if (!change.published) {
          const failures: unknown[] = [error];
          if (stagedPresentation !== null) { try { stagedPresentation.close(); } catch (cleanup) { failures.push(cleanup); } }
          else {
            try { stagedUi?.close(); } catch (cleanup) { failures.push(cleanup); }
            try { stagedNativeSeat?.effects.close(); } catch (cleanup) { failures.push(cleanup); }
          }
          if (failures.length > 1) throw new AggregateError(failures, "Local player publication cleanup failed");
        }
        throw error;
      }
      preparedInput?.discard();
      try{change.discard();}catch(cleanup){throw new AggregateError([error,cleanup],"Local player preparation cleanup failed");}
      throw error;
    }
  }

  private commandActor(seat: SeatId | null): ActorId {
    const player = this.localPlayers.find(player => seat === null || player.seat.id.equals(seat));
    if (player === undefined) throw new Error("Command requires a player");
    return player.actor;
  }

  private async afterCommandDispatch(): Promise<void> {
    await this.retireRemovedLocalPlayers();
    await this.tools?.drain();
    if (this.closed || this.fatalWorldFailure || this.clientCommandsBlocked || this.pendingShellPublication) return;
    do {
      await this.commands(async () => {
        if (this.closed) return;
        await this.applyTransition();
        if (this.requestedCommands.length !== 0) await this.afterCommandDispatch();
      });
      if (this.closed || this.pendingShellPublication || this.videoRestart?.pending) return;
      await this.applyTransition();
    } while (this.requestedCommands.length !== 0 && !this.clientCommandsBlocked);
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

  private async nativeMatchTransition(request: ApplicationCommandRequest): Promise<boolean> {
    const producer = request.source?.producer;
    if ((request.name !== "map" && request.name !== "gamemap") || request.target !== "application"
      || request.arguments_.length !== 1 || producer?.kind !== "game-module" || producer.instance !== undefined
      || request.source?.session !== this.session.session || this.simulation.q2Native() === null) return false;
    return this.finishQ2Match({ kind: "game-module-map-transition", module: producer.module });
  }

  private async finishQ2Match(transition?: NativeQ2MapTransition): Promise<boolean> {
    if (!q2MatchCompleted(this.simulation, transition)) return false;
    const locals = this.localPlayers.map(player => ({ actor: player.actor, seat: player.seat.id }));
    const reports = q2MatchReports(this.simulation, locals, transition);
    if (reports.length !== 0) {
      this.playerProgress ??= PlayerProgressStore.open(join(this.inputConfig.root, "player-progress.json"));
      const progress = await this.playerProgress;
      for (const report of reports) await progress.record(report);
    }
    if (this.host.lobby === undefined) return false;
    if (this.lobbyCompletion !== this.simulation) {
      await this.host.lobby.complete(); this.lobbyCompletion = this.simulation;
    }
    await this.returnToLobby();
    return true;
  }

  private async commands(afterRequest?: () => Promise<void>, direct?: readonly ApplicationCommandRequest[], routeApplications = direct === undefined): Promise<void> {
    const pending = direct ?? this.requestedCommands;
    if (direct === undefined) this.requestedCommands = [];
    for (const [index, request] of pending.entries()) {
      await this.retireRemovedLocalPlayers();
      let origin = request.source?.origin; while (origin?.kind === "script") origin = origin.caller;
      if ((origin?.kind === "local-seat" || origin?.kind === "remote-client") && this.session.clientAt(origin.client.slot)?.id.equals(origin.client) !== true) continue;
      if (this.graphical !== null && request.seat !== null && !this.localPlayers.some(player => request.seat?.equals(player.seat.id) === true)) continue;
      if (request.source?.producer?.kind === "game-module" && request.source.producer.instance !== undefined && this.simulation.options.modCommands?.active(request.source) !== true) continue;
      if (this.stepping && (this.pendingShellPublication || this.videoRestart?.pending)) { this.requestedCommands.unshift(...pending.slice(index)); return; }
      if (request.source?.producer?.kind === "game-module" && (request.name === "map" || request.name === "gamemap")) {
        if (this.captureBlocksTransition()) { this.requestedCommands.unshift(...pending.slice(index)); return; }
        if (await this.nativeMatchTransition(request)) continue;
      }
      if (request.target === "component-client") {
        await this.graphical?.modPresentations.dispatchCommand(request); continue;
      }
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
        if (this.operatorOutput.write !== null) { this.operatorOutput.write(text); return; }
        if (source !== undefined && this.graphical !== null) this.graphical.input.print(text, source);
        else {
          this.host.print(text);
          if (command.seat === null) for (const local of this.graphical?.input.locals ?? []) local.console.print(text);
        }
      };
      try {
        if (command.target === "application" && this.ownedDemos?.service.handle(command.name, command.arguments_, source ?? { session: this.session.session, origin: { kind: "local-console" } })) continue;
        if (command.target === "application" && command.name === "clientLevelShot") {
          const local = this.graphical?.input.locals.find(local => command.seat !== null && local.player.seat.id.equals(command.seat));
          if (local !== undefined && this.simulation.q3Guest() !== null) {
            local.console.close();
            this.graphical?.input.enqueueClientCommand("wait; wait; wait; wait; screenshot levelshot\n", { session: this.session.session,
              origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } });
          }
          continue;
        }
        if (command.name === "local_join" || command.name === "local_drop") {
          await this.changeLocalPlayers(command.name === "local_join" ? "join" : "drop", command.arguments_, command.seat);
          continue;
        }
        if (command.target === "application" && (command.name === "record" || command.name === "stop" || command.name === "stoprecord" || command.name === "rerecord" || command.name === "mvdrecord" || command.name === "mvdstop" || command.name === "serverrecord" || command.name === "serverstop")) {
          const context = source ?? { session: this.session.session, origin: { kind: "local-console" } } satisfies CommandContext;
          if (command.name === "stop" || command.name === "stoprecord") await this.standaloneRecording().stop();
          else if (command.name === "serverstop") {
            if (command.arguments_.length !== 0) throw new Error("Usage: serverstop");
            await this.standaloneRecording().stopServer();
          }
          else if (command.name === "mvdstop") {
            if (command.arguments_.length !== 0) throw new Error("Usage: mvdstop");
            await this.standaloneRecording().stopMvd();
          }
          else {
            const name = command.arguments_[0];
            if (command.arguments_.length > 1 || (command.name === "rerecord" || command.name === "mvdrecord" || command.name === "serverrecord") && name === undefined) throw new Error(`Usage: ${command.name} <name>`);
            if (command.name === "rerecord" && name !== undefined) await this.standaloneRecording().rerecord(name, context);
            else if (command.name === "serverrecord" && name !== undefined) await this.standaloneRecording().startServer(name, context);
            else if (command.name === "mvdrecord" && name !== undefined) await this.standaloneRecording().startMvd(name, context);
            else await this.standaloneRecording().start(name, context);
          }
          continue;
        }
        if (command.name === "cinematicpause" || command.name === "stopcinematic") {
          const movie = this.campaignMovie;
          if (movie === null) throw new Error("No cinematic is playing");
          if (command.name === "stopcinematic") { movie.playback.close(this.presentationFrames); this.campaignMovie = null; }
          else movie.playback.pause(movie.playback.status !== "paused");
          continue;
        }
        if (command.name === "cinematic") {
          const name = command.arguments_[0], graphical = this.graphical;
          const seat = command.seat ?? this.localPlayers[0]?.seat.id;
          if (name === undefined || graphical === null || seat === undefined) throw new Error("cinematic requires a movie and a local presentation");
          const mode = command.arguments_[1];
          await this.systemCinematics(this.simulation, this.content, graphical.assets, graphical.audio, graphical.renderer, seat, graphical.input)
            .open({ name, loop: mode?.startsWith("2") === true || mode === "loop",
              hold: mode?.startsWith("1") === true || mode === "hold" || ["end.roq", "demoend.roq"].includes(name.toLowerCase().split("/").at(-1) ?? ""), silent: false }, () => true);
          continue;
        }
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
        if (this.operatorState !== null) {
          const operator = this.operatorHost();
          if (["addlrconcmd", "dellrconcmd", "listlrconcmds"].includes(command.name)
            && this.operatorState.limitedRconCommand(command.name, command.arguments_[0] ?? "", text => print(text))) continue;
          if (command.name === "setmaster") { await this.operatorState.setMasters(operator, command.arguments_); continue; }
          if (command.name === "heartbeat") { operator.heartbeat(); continue; }
          if (await this.operatorState.filterCommand(operator, command.name, command.arguments_)) continue;
        }
        if (command.target === "source") {
          if ((command.name === "postgame" || command.name === "spPostgame") && this.baseArenaProgress.has(this.simulation)) {
            await this.completeBaseArena(command.arguments_);
          } else if (command.name === "arena-reset" || command.name === "arena-unlock" || command.name === "arena-medals") {
            const state = this.baseArenaProgress.get(this.simulation);
            if (state === undefined) throw new Error("No base arena progression is active");
            if (command.name === "arena-reset") { state.progression.reset(); state.result = null; }
            else if (command.name === "arena-unlock") state.progression.unlockLevels();
            else state.progression.unlockMedals();
            await this.saveSourceArchive(this.options, this.content, this.simulation, this.teamArenaOverrides);
          } else if (command.name === "postgame") {
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
        if (command.target === "application" && (command.name === "in_restart" || command.name === "midiinfo")) {
          const input = this.graphical?.input;
          if (input === undefined) { print("Input devices require a graphical client.\n"); continue; }
          if (command.name === "midiinfo") input.inputDevices.info();
          else { input.releaseForProfileChange(); input.inputDevices.restart(); input.router.restart(); }
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
        if (guest !== null && command.target !== "client" && (q3ProductMapCommands(this.content.q3Product?.policy ?? { kind: "retail" }).includes(command.name) || command.name === "map_restart")) {
          if (command.name === "map_restart") await this.requestRestart(command.arguments_);
          else {
            const map = command.arguments_[0];
            if (map === undefined || command.arguments_.length !== 1) throw new Error(`Usage: ${command.name} <name>`);
            this.pendingQ3Map = q3MapLaunch(this.content.q3Product?.policy ?? { kind: "retail" }, command.name, Number(guest.state.cvars.find("g_gametype")?.latchedValue ?? guest.state.cvars.variableString("g_gametype")));
            this.pendingMap = mapResourcePath(map); this.pendingNativeTravel = null; this.pendingRestart = null;
          }
          continue;
        }
        if (guest !== null && command.target !== "client" && ["addbot", "removebot", "botlist"].includes(command.name)) {
          if (command.name === "addbot") {
            if (!await q3GameCallback(() => guest.consoleCommand([command.name, ...command.arguments_]))) print("The selected game module does not provide addbot.\n");
          } else {
            const bots = guest.players().filter(player => guest.isBot(player.client));
            if (command.name === "botlist") {
              for (const player of bots) print(`${player.sourceEntity}: ${q3InfoValue(guest.state.getUserinfo(player.sourceEntity) ?? "", "name")}\n`);
              print(`${bots.length} bot(s).\n`);
            } else {
              const target = command.arguments_[0];
              if (target === undefined) throw new Error("Usage: removebot <slot|name|all>");
              for (const player of bots) if (target === "all" || target === String(player.sourceEntity)
                || target === q3InfoValue(guest.state.getUserinfo(player.sourceEntity) ?? "", "name")) await guest.disconnect(player);
            }
          }
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
        if ((guest === null || command.seat !== null) && (command.name === "use" || command.name === "drop")
          && this.simulation.sourceItemCommand(this.commandActor(command.seat), command.name, command.arguments_)) continue;
        if (guest !== null && command.seat !== null && ["use", "weapon", "weapnext", "weapprev"].includes(command.name)) {
          const actor = this.commandActor(command.seat);
          const selected = resolveWeaponSelection(command.name, command.arguments_, this.simulation.playerUi(actor).items);
          if (this.simulation.selectedWeaponCommand(actor, selected === null ? command.name : "use", selected === null ? command.arguments_ : [selected.item])) continue;
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
        if (command.name === "use" || command.name === "weapon") {
          const selected = resolveWeaponSelection(command.name, command.arguments_, this.simulation.playerUi(this.commandActor(command.seat)).items);
          if (selected !== null) command = { ...command, name: "use", arguments_: [selected.item] };
        }
        const sourceClient = command.seat === null ? this.graphical?.q3.values().next().value : this.graphical?.q3.get(command.seat);
        if (sourceClient !== undefined && (command.name === "use" || command.name === "weapnext" || command.name === "weapprev")) {
          const actor = this.commandActor(command.seat);
          const player = this.simulation.movementPlayer(actor);
          if (player?.arsenal.state.kind === "q3" && this.simulation.hasWeaponSlot(actor)) {
            this.simulation.playerCommand(actor, command.name, command.arguments_);
            const slot = this.simulation.weaponSlot(actor), selected = slot.pending ?? slot.active;
            const weapon = selected?.provider === player.arsenal.provider ? Q3_WEAPON_ITEMS.find(weapon => weapon.item === selected.item) : undefined;
            if (weapon !== undefined) await sourceClient.client.command(["weapon", String(weapon.weapon)]);
            continue;
          }
          if (player?.arsenal.state.kind !== "q3" || player.arsenal.provider !== this.simulation.recipe.map.entities.provider) {
            this.simulation.playerCommand(actor, command.name, command.arguments_); continue;
          }
        }
        if (command.name === "use") {
          const actor = this.commandActor(command.seat), items = this.simulation.playerUi(actor).items;
          const choice = resolveWeaponSelection(command.name, command.arguments_, items);
          const item = items.find(item => item.kind === "weapon" && item.owned && item.id === choice?.item);
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
          const { name, format } = parseSaveRequest(command.arguments_);
          const path = saveCommandPath(this.saveDirectory, name);
          await this.saveGame(path, format);
          print(`Saved ${path}.\n`);
        } else if (command.name === "weapnext" || command.name === "weapprev" || command.name === "use") {
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        } else if (command.name === "say" || command.name === "say_team") {
          if (this.simulation.q1Source() === null && this.simulation.q2Source() === null && this.simulation.q2Native() === null && this.simulation.q3Source() === null) throw new Error("Selected guest source chat requires its native command channel");
          this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else if (command.name === "map_restart") await this.requestRestart(command.arguments_);
        else if (command.name === "load") {
          const { name, sourceProduct } = parseLoadRequest(command.arguments_);
          const path = saveCommandPath(this.saveDirectory, name);
          if (this.network !== null) throw new Error("Save/load unavailable while hosting a network game.");
          this.pendingSave = { path, ...(sourceProduct === undefined ? {} : { sourceProduct }) };
        }
        else if (command.name === "teamarena-next" || command.name === "teamarena-retry") {
          if (!this.isTeamArenaSkirmish() || this.simulation.q3Source()?.level.intermissionTime === 0) throw new Error("Team Arena match has not finished");
          this.pendingTeamArena = command.name === "teamarena-next" ? "next" : "retry";
        }
        else if ((command.name === "gamemap" || command.name === "changelevel") && this.simulation.q2Native() !== null) {
          const map = command.arguments_[0];
          if (map === undefined || command.arguments_.length !== 1) throw new Error(`Usage: ${command.name} <map>`);
          this.pendingNativeTravel = parseQ2Travel(map); this.pendingMap = null; this.pendingQ3Map = undefined; this.pendingRestart = null; this.pendingTransition = null;
        }
        else if (["map", "gamemap", "changelevel"].includes(command.name) || this.simulation.q3Source() !== null && ["devmap", "spmap", "spdevmap"].includes(command.name)) {
          const map = command.arguments_[0];
          if (map === undefined) throw new Error("Usage: map <name>");
          const source = this.simulation.q3Source();
          this.pendingQ3Map = source === null ? undefined : q3MapLaunch(this.content.q3Product?.policy ?? { kind: "retail" }, command.name === "gamemap" || command.name === "changelevel" ? "map" : command.name, Number(source.host.cvars.find("g_gametype")?.latchedValue ?? source.host.cvars.variableString("g_gametype")));
          this.pendingMap = mapResourcePath(map); this.pendingNativeTravel = null;
        }
        else if ((command.name === "pause" || command.name === "status" || command.name === "ping")
          && (this.simulation.q1Source() !== null || this.simulation.quakecSource() !== null)) {
          if (command.arguments_.length !== 0) throw new Error(`Usage: ${command.name}`);
          if (command.name === "pause") {
            let origin = source?.origin; while (origin?.kind === "script") origin = origin.caller;
            print(this.simulation.toggleQ1Pause(origin?.kind === "server-console" ? null : this.commandActor(command.seat)));
          } else {
            const pings = this.network?.kind === "q1" || this.network?.kind === "qw" ? this.network.server.clientPings() : new Map<ClientId, number>();
            print(command.name === "ping" ? "Client ping times:\n" : `map: ${this.options.map}\nplayers: ${this.simulation.players().length} active (${this.simulation.options.maxClients} max)\n`);
            for (const actor of this.simulation.players()) {
              const client = this.simulation.playerClient(actor); if (client === null) continue;
              print(command.name === "ping" ? `${pings.get(client) ?? 0} ${this.simulation.sourcePlayerName(actor)}\n`
                : `#${client.slot + 1} ${this.simulation.sourcePlayerName(actor)}\n`);
            }
          }
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
        else if (this.simulation.q1Source() !== null || this.simulation.quakecSource() !== null || this.simulation.q2Source() !== null || this.simulation.q2Native() !== null || this.simulation.q3Source() !== null) {
          const handled = this.simulation.q3Source()?.serverCommands.consoleCommand([command.name, ...command.arguments_]) ?? false;
          if (!handled) this.simulation.playerCommand(this.commandActor(command.seat), command.name, command.arguments_);
        }
        else throw new Error(`Unknown application command: ${command.name}`);
      } catch (error) {
        if (this.fatalWorldFailure || error instanceof Q3GameCallbackError || error instanceof Q2GameCallbackError || error instanceof ClientSourcePublicationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        print(`${message}\n`);
      } finally {
        await afterRequest?.();
      }
    }
  }

  private async presentOutput(output: SimulationOutput, context: {
    readonly sourceEvents: readonly SimulationPresentationEvent[];
    readonly roundEvents: readonly SimulationPresentationEvent[];
    readonly localCommands: readonly ActorCommand[];
    readonly frameMilliseconds: number;
    readonly frameStartedAt: number;
    readonly timeMilliseconds: number;
  }): Promise<void> {
    const { sourceEvents, roundEvents, localCommands, frameMilliseconds, frameStartedAt, timeMilliseconds } = context;
    const presentationFrame = ++this.presentationFrames;
    const previousTime = this.presentationMilliseconds;
    this.presentationMilliseconds = timeMilliseconds;
    try {
      const graphical = this.graphical;
      if (graphical !== null) {
        if (this.sourceDialect().startsWith("q2")) this.debugGraph.addFrame(frameMilliseconds / 1000, this.debugGraphSettings());
        this.simulation.beginPresentationFrame(presentationFrame);
        const presentations = this.simulation.presentations(), characters = this.simulation.characterViews();
        graphical.rerelease.receive(sourceEvents);
        await graphical.rerelease.prepare();
        const presentationEvents = [...roundEvents, ...sourceEvents.filter(event => event.kind !== "q2-composition" || event.event.kind !== "kick" && event.event.kind !== "grapple-prediction"), ...graphical.rerelease.drainPrints()];
        const nativeQ3 = this.simulation.q3Source()?.sourceState();
        for (const source of graphical.q3.values()) {
          if (source.kind === "qvm") continue;
          if (nativeQ3 === undefined) throw new Error("Cgame has no authoritative source state");
          source.prediction.captureSource(nativeQ3);
          source.client.receive(nativeQ3, sourceEvents.filter(event => event.recipient === undefined || event.recipient.equals(source.client.options.local.player.actor)), localCommands);
        }
        const selectedQ3 = this.simulation.selectedQ3SourceState();
        const sharedPresentationEvents = presentationEvents.filter(event => selectedQ3 === null || event.content !== selectedQ3.content
          || event.kind !== "q3-source" || event.event.kind !== "entity-event");
        const effectEvents = graphical.q3.size === 0 ? sharedPresentationEvents : sharedPresentationEvents.filter(event =>
          event.kind === "q3-source" ? event.event.kind === "sound" : event.kind !== "q3-character");
        const commonEvents = effectEvents.filter(event => event.recipient === undefined);
        const eventsFor = (actor: ActorId, events: readonly SimulationPresentationEvent[]) => events.filter(event => event.recipient === undefined || event.recipient.equals(actor));
        const nativeEvents = new Map<SeatId, readonly SimulationPresentationEvent[]>();
        const seatAudio: ApplicationAudioSeatEvents[] = [];
        const unhandled: UnhandledApplicationEffect[] = [];
        if (graphical.nativeQ2.size === 0) {
          graphical.effects.receive(effectEvents);
          await graphical.effects.prepare(output.snapshot, presentations, characters, this.simulation.weaponPresentationClock());
          unhandled.push(...graphical.effects.drainUnhandled());
          graphical.audio.receiveEffectSounds(graphical.effects.drainSounds());
          const privateSounds = graphical.effects.drainRecipientSounds();
          for (const presentation of graphical.presentations) {
            const actor = presentation.local.player.actor;
            const events = effectEvents.filter(event => event.recipient?.equals(actor));
            const sounds = privateSounds.filter(batch => batch.recipient.equals(actor)).flatMap(batch => batch.sounds);
            if (events.length !== 0 || sounds.length !== 0) seatAudio.push({ seat: presentation.local.player.seat.id,
              snapshot: output.snapshot, events, music: presentation === graphical.presentations[0], effectSounds: sounds });
          }
        } else {
          const host = this.recordingHost;
          if (host?.kind !== "q2" || host.host.rawMessages === undefined) throw new Error("Native Q2 presentation lost its source message owner");
          for (const presentation of graphical.presentations) {
            const local = presentation.local, seat = local.player.seat.id, native = graphical.nativeQ2.get(seat);
            if (native === undefined) throw new Error("Native Q2 presentation has no recipient state");
            const player = host.host.carriedPlayer(local.player.seat.client.id);
            for (const record of native.client.receive((host.host.localMessages?.(player) ?? host.host.sourceMessages?.(player) ?? host.host.rawMessages(player)), timeMilliseconds / 1000)) {
              const event = record.event;
              if (event.kind === "nop") continue;
              if (event.kind === "print") local.console.print(event.text);
              else if (event.kind === "disconnect") { local.console.print("Disconnected by the source game.\n"); this.requestQuit(); }
              else if (event.kind === "localized-print") native.client.print(event.value.flags,
                await graphical.rerelease.localizeMessage(seat, native.client.content, event.value.base, event.value.args), timeMilliseconds / 1000);
              else if (event.kind === "command-text") graphical.input.enqueueClientCommand(event.text,
                { session: this.session.session, origin: { kind: "script", name: "q2-game", caller: { kind: "local-seat", seat, client: local.player.seat.client.id } } });
              else throw new Error(`Unsupported native Q2 local service ${event.kind}`);
            }
            const sourceEvents = native.client.takeEvents();
            graphical.rerelease.receive(sourceEvents);
            await graphical.rerelease.prepare();
            const events = [...sourceEvents, ...graphical.rerelease.drainPrints()];
            for (const event of events) await this.recordPlayerProgress(event);
            nativeEvents.set(seat, events);
            const privateEvents = effectEvents.filter(event => event.recipient?.equals(local.player.actor));
            native.effects.receive([...eventsFor(local.player.actor, effectEvents), ...events]);
            await native.effects.prepare(output.snapshot, presentations, characters, this.simulation.weaponPresentationClock());
            unhandled.push(...native.effects.drainUnhandled());
            seatAudio.push({ seat, snapshot: output.snapshot, events: [...privateEvents, ...events], music: false,
              effectSounds: [...native.effects.drainSounds(), ...native.effects.drainRecipientSounds().flatMap(batch => batch.sounds)] });
          }
        }
        this.unhandledEffects = unhandled;
        for (const effect of this.unhandledEffects) {
          const key = `${effect.source.content}:${effect.reason}`;
          if (!this.reportedEffectGaps.has(key)) {
            this.reportedEffectGaps.add(key);
            this.host.print(`Unresolved ${effect.source.kind} effect: ${effect.reason}\n`);
          }
        }
        await preparePresentationAudio(this.simulation.events, graphical.audio, commonEvents, seatAudio);
        await preparePresentationShaders(this.simulation.events, graphical.assets);
        for (const presentation of graphical.presentations) {
          presentation.sourceEvents([...eventsFor(presentation.local.player.actor, presentationEvents), ...(nativeEvents.get(presentation.local.player.seat.id) ?? [])]);
          if (this.tools === null) await presentation.prepare(output.snapshot, presentations, characters);
          else await this.tools.measureAsync("presentation", () => presentation.prepare(output.snapshot, presentations, characters));
        }
        await graphical.modPresentations.prepare(graphical.presentations, this.simulation.modPresentationSources(), presentationEvents, presentationFrame);
        await graphical.selectedQ3Presentations.prepare(graphical.presentations, selectedQ3, presentationEvents, presentationFrame);
        for (const presentation of graphical.presentations) {
          const render = () => presentation.local.player.seat.present(output.snapshot, graphical.renderer.backend);
          if (this.tools === null) render(); else this.tools.timer.measure("render", render);
        }
        graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: presentationFrame, commands: [{ kind: "swap-buffers" }] });
        const listeners = graphical.presentations.map(presentation => {
          const camera = presentation.camera();
          return { seat: presentation.local.player.seat.id, actor: presentation.local.player.actor, origin: camera.origin,
            axis: camera.axis, gain: 1 / graphical.presentations.length, underwater: this.underwater(camera, presentation.local.player.actor) };
        });
        await graphical.audio.frame(output.snapshot, listeners, commonEvents.filter(event => !presentationAudioControl(event)), frameStartedAt,
          seatAudio.map(batch => ({ ...batch, events: batch.events.filter(event => !presentationAudioControl(event)) })));
      }
    } finally { this.presentationMilliseconds = previousTime; }
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput> {
    if (this.closed) throw new Error("Application is closed");
    if (this.stepping) throw new Error("Application step is already in progress");
    if (this.worldOperation !== "idle") throw new Error("A world operation is in progress");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) throw new RangeError("Application step requires positive elapsed milliseconds");
    if (this.ownership.kind === "owned") await this.ownedVideoRestart?.drain();
    this.stepping = true;
    const completion = Promise.withResolvers<void>(); this.stepCompletion = completion.promise;
    const frameStartedAt = performance.now();
    try {
      await this.retireRemovedLocalPlayers();
      if (this.stopping && this.localPlayers.length === 0) return this.lastOutput?.output ?? this.simulation.currentOutput();
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
      let movie = this.campaignMovie;
      if (movie !== null && !movie.current()) {
        const retired = movie; if (this.movies.get(this.simulation) === retired) this.movies.delete(this.simulation);
        if (this.movieRequests.get(this.simulation) === retired.request) this.movieRequests.delete(this.simulation);
        retired.playback.close(this.presentationFrames); movie = null;
      }
      if (movie !== null) {
        const retained = this.lastOutput?.simulation === this.simulation ? this.lastOutput : { simulation: this.simulation, output: this.simulation.currentOutput() };
        try {
          const graphical = this.graphical;
          const consoleOpen = graphical?.input.locals.some(local => local.input.focus.kind === "console") ?? false;
          const menuOpen = graphical?.presentations.some(presentation => presentation.ui.pauseMenuOpen) ?? false;
          movie.playback.activate();
          this.frames++;
          if (movie.playback.frame(elapsedMilliseconds, ++this.presentationFrames, consoleOpen, menuOpen)) {
            if (this.movies.get(retained.simulation) === movie) this.movies.delete(retained.simulation);
            movie.playback.close(this.presentationFrames);
            if (movie.current() && this.simulation === retained.simulation) await movie.complete();
            if (this.movieRequests.get(retained.simulation) === movie.request) this.movieRequests.delete(retained.simulation);
          } else if (consoleOpen && graphical !== null) {
            const presentations = this.simulation.presentations(), characters = this.simulation.characterViews();
            for (const presentation of graphical.presentations) {
              await presentation.prepare(retained.output.snapshot, presentations, characters);
              presentation.local.player.seat.present(retained.output.snapshot, graphical.renderer.backend);
            }
            graphical.renderer.execute({ owner: graphical.assets.images.owner, sequence: this.presentationFrames, commands: [{ kind: "swap-buffers" }] });
          }
        } catch (error) {
          if (this.movies.get(retained.simulation) === movie) this.movies.delete(retained.simulation);
          if (this.movieRequests.get(retained.simulation) === movie.request) this.movieRequests.delete(retained.simulation);
          try { movie.playback.close(this.presentationFrames); } catch (closeError) { this.host.print(`${String(closeError)}\n`); }
          this.reportCampaignTravelError(error);
        }
        await this.commands();
        if (this.simulation === retained.simulation) return retained.output;
      }
      await this.retireRemovedLocalPlayers();
      if (this.stopping && this.localPlayers.length === 0) return this.lastOutput?.output ?? this.simulation.currentOutput();
      await this.dispatchClientInputs();
      const q1 = this.simulation.q1Source() ?? this.simulation.quakecSource();
      const beforeFrameEvents = q1 === null ? [] : this.simulation.drainPresentationEvents();
      this.appendQ1Commands(beforeFrameEvents);
      if (this.dedicatedCommands !== null) this.dedicatedConsole?.drain(this.dedicatedCommands);
      await this.sourceCommands?.executeAsync(() => this.afterCommandDispatch(), () => !this.clientCommandsBlocked && !this.pendingShellPublication);
      if (this.dedicatedCommands !== null && this.dedicatedCommands !== this.sourceCommands)
        await this.dedicatedCommands.executeAsync(() => this.afterCommandDispatch(), () => !this.clientCommandsBlocked && !this.pendingShellPublication);
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
      const remote = await this.network?.server.poll(performance.now()) ?? [];
      if (this.closed) throw new Error("Application closed during step");
      const menuPause = this.graphical?.presentations.some(presentation => presentation.ui.pauseMenuOpen) === true;
      const q3Cvars = this.simulation.q3Source()?.host.cvars ?? this.simulation.q3Guest()?.state.cvars;
      if (q3Cvars !== undefined && menuPause !== this.q3MenuPause) {
        for (const cvars of this.clientCvars.values()) cvars.set("cl_paused", menuPause ? "1" : "0", true);
      }
      this.q3MenuPause = q3Cvars !== undefined && menuPause;
      const paused = q3Cvars !== undefined ? q3ServerPaused(q3Cvars,
        menuPause || [...this.clientCvars.values()].some(cvars => cvars.variableValue("cl_paused") !== 0),
        this.simulation.clientIdentities().filter(client => !this.botClients.some(bot => bot.client.id.equals(client))).length)
        : this.options.mode === "singleplayer" && this.network === null
          && this.simulation.players().length === this.localPlayers.length + this.botClients.length && menuPause
          && retained !== null && retained.simulation === this.simulation;
      if (q3Cvars !== undefined) for (const cvars of this.clientCvars.values()) cvars.set("sv_paused", q3Cvars.variableString("sv_paused"), true);
      const timeCvars = this.sourceCvars();
      const sourceMilliseconds = timeCvars === null ? elapsedMilliseconds : sourceFrameMilliseconds(this.sourceDialect(), elapsedMilliseconds,
        readFrameTimeControls(timeCvars), { dedicated: this.options.dedicated, localServer: true });
      const captureFrame = this.graphical === null ? { milliseconds: sourceMilliseconds, capture: false }
        : this.tools?.frameTime(sourceMilliseconds, true) ?? { milliseconds: sourceMilliseconds, capture: false };
      const frameMilliseconds = captureFrame.milliseconds;
      if (captureFrame.capture) this.capture?.captureFrame();
      this.tools?.timer.stamp("frame begin");
      if (!paused) this.elapsed += frameMilliseconds;
      if (this.closed) throw new Error("Application closed during step");
      const serverCvars = this.sourceCvars();
      if (serverCvars?.dialect === "q3" && this.options.dedicated && serverCvars.variableValue("dedicated") === 2 && this.operatorState !== null && this.network !== null)
        this.operatorState.refreshQ3Masters(serverCvars, text => this.host.print(text));
      for (const local of this.graphical?.input.locals ?? []) {
        const cvars = this.clientCvars.get(local.player.seat.id);
        if (cvars !== undefined) {
          const userinfo = playerUserinfo(cvars);
          if (this.publishedUserinfo.get(cvars) !== userinfo) {
            await this.simulation.updatePlayerUserinfo(local.player.actor, userinfo);
            this.publishedUserinfo.set(cvars, userinfo);
          }
        }
      }
      for (const native of this.graphical?.nativeQ2.values() ?? []) {
        const userinfo = native.cvars.infoString(CvarFlag.UserInfo);
        if (userinfo === native.userinfo) continue;
        q2GameCallback(() => native.client.world.userinfo(native.client.sourceSlot, `${userinfo}\\ip\\localhost`));
        const actor = native.client.world.actor(native.client.sourceSlot);
        if (actor !== null) this.simulation.notifyClientEvent("userinfo", actor);
        native.userinfo = userinfo;
      }
      for (const local of this.graphical?.input.locals ?? []) {
        const arsenal = this.simulation.arsenalState(local.player.actor);
        if (arsenal !== null) this.graphical?.input.bindArsenalProvider(local.player.seat.id, arsenal.provider);
      }
      for (const [seat, source] of this.graphical?.q3 ?? []) {
        const selection = source.client.userCommandSelection;
        this.graphical?.input.setQ3CommandSelection(seat, selection);
        const actor = source.client.options.local.player.actor, arsenal = this.simulation.arsenalState(actor);
        const explicitWeapon = source.client.consumeWeaponSelection();
        const slot = arsenal === null ? null : this.simulation.weaponSlot(actor);
        const supplemental = slot !== null && [slot.active, slot.pending].some(weapon => weapon !== null && weapon.provider !== arsenal?.provider);
        const selectedSource = arsenal !== null && (this.simulation.q3Guest() !== null || arsenal.provider !== this.simulation.recipe.map.entities.provider);
        const weapon = supplemental || selectedSource ? explicitWeapon : selection.weapon;
        this.graphical?.input.setArsenalSelection(seat, arsenal === null ? null
          : { provider: arsenal.provider, weapon: arsenal.state.kind === "q3" && weapon !== null ? q3WeaponItem(weapon)?.item ?? null : null });
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
      const progressedEvents: SimulationPresentationEvent[] = [], progressedRoundEvents: SimulationPresentationEvent[] = [];
      let pendingBeforeFrameEvents = beforeFrameEvents, displayedMilliseconds = this.elapsed - frameMilliseconds, progressedEventCount = 0;
      const progress = this.graphical === null || this.simulation.q2Native() === null ? undefined : async (frame: SimulationProgress): Promise<void> => {
        progressedEventCount += frame.output.events.length;
        this.pumpClientInput();
        const host = this.recordingHost;
        if (host?.kind !== "q2" || host.host.observeProgress === undefined || host.host.localMessages === undefined)
          throw new Error("Native source progress lost its message publication owner");
        host.host.observeProgress();
        const events = this.simulation.drainPresentationEvents();
        progressedEvents.push(...events);
        const rounds = this.roundPresentationEvents.splice(0); progressedRoundEvents.push(...rounds);
        const incoming = [...pendingBeforeFrameEvents, ...events]; pendingBeforeFrameEvents = [];
        const timeMilliseconds = this.elapsed - frame.pendingMilliseconds;
        await this.presentOutput(frame.output, { sourceEvents: incoming, roundEvents: rounds, localCommands: [],
          frameMilliseconds: Math.max(0, timeMilliseconds - displayedMilliseconds), frameStartedAt: performance.now(), timeMilliseconds });
        displayedMilliseconds = timeMilliseconds;
        await new Promise<void>(resolve => { setTimeout(resolve, 0); });
        this.pumpClientInput();
      };
      const advanceSimulation = () => this.session.stepAsync({ elapsedMilliseconds: frameMilliseconds, commands: [...localCommands, ...remote] }, progress);
      const output = paused ? retained !== null && retained.simulation === this.simulation ? { snapshot: retained.output.snapshot, events: [] } : this.simulation.currentOutput() : this.tools === null ? await advanceSimulation()
        : await this.tools.measureAsync("simulation", advanceSimulation);
      await this.retireRemovedLocalPlayers();
      const completedLobbySimulation = this.host.lobby !== undefined && q2MatchCompleted(this.simulation) ? this.simulation : null;
      this.queueRankingFrame();
      this.lastOutput = { simulation: this.simulation, output };
      if (!paused) this.publishLocalGuestSnapshots();
      this.guestBrowser?.host.poll(); this.guestBrowser?.view.poll();
      this.frames++;
      const frameEvents = this.simulation.drainPresentationEvents();
      if (q1 !== null) this.appendQ1Commands(frameEvents);
      this.sourceEvents = [...beforeFrameEvents, ...progressedEvents, ...frameEvents];
      if (!paused) this.bots?.receive(this.sourceEvents);
      if (this.closed) throw new Error("Application closed during step");
      if (!paused) await this.network?.server.publish(output, this.sourceEvents, performance.now());
      if (this.network === null && this.recordingHost !== null && this.recordingHost.kind !== "q3" && (this.localRecordingActive || this.simulation.q2Native() !== null)) this.recordingHost.host.observe(output, this.sourceEvents);
      if (this.localRecording !== null && this.localRecordingActive) {
        await this.localRecording.publish(output, this.sourceEvents);
      }
      const intents = paused ? [] : this.simulation.takeTransitions();
      if (intents.length !== 0) {
        const campaign = this.content.recipe.campaign;
        const mode = campaign.kind === "campaign" ? { kind: "campaign", campaign: campaign.mission.provider, allowRoundRestart: false } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0]
          : { kind: "competitive", match: this.content.recipe.match.provider } satisfies Parameters<SharedTransitionCoordinator["resolve"]>[0];
        this.transitions.commit(this.transitions.resolve(mode, intents));
      }
      const finalRoundEvents = this.roundPresentationEvents.splice(0), roundEvents = [...progressedRoundEvents, ...finalRoundEvents];
      const finalPresentation = progressedEventCount === 0 ? output : { snapshot: output.snapshot, events: output.events.slice(progressedEventCount) };
      await this.presentOutput(finalPresentation, { sourceEvents: [...pendingBeforeFrameEvents, ...frameEvents], roundEvents: finalRoundEvents,
        localCommands, frameMilliseconds: Math.max(0, this.elapsed - displayedMilliseconds), frameStartedAt, timeMilliseconds: this.elapsed });
      await this.capture?.drain();
      this.tools?.timer.stamp("frame end");
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
      if (!paused && this.lastOutput?.simulation === this.simulation) await this.advanceAutosave(frameMilliseconds);
      if (completedLobbySimulation !== null && this.lobbyCompletion !== completedLobbySimulation && this.host.lobby !== undefined) {
        await this.host.lobby.complete();
        this.lobbyCompletion = completedLobbySimulation;
      }
      return output;
    } catch (error) {
      if (!this.fatalWorldFailure) { await this.capture?.beforeWorldChange(); throw error instanceof Q3GameCallbackError || error instanceof Q2GameCallbackError ? error.cause : error; }
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
      const generation = this.videoRestart?.generation;
      await this.step(elapsed);
      if (this.videoRestart?.generation !== generation) previous = performance.now();
      await setImmediate();
    }
  }

  readPixels(): Uint8Array {
    if (this.graphical === null) throw new Error("Dedicated applications have no framebuffer");
    return this.graphical.renderer.readPixels();
  }

  captureNextFrame(): Promise<Uint8Array> {
    if (this.graphical === null) return Promise.reject(new Error("Dedicated applications have no framebuffer"));
    return this.graphical.renderer.captureNextFrame().then(frame => frame.pixels);
  }

  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true; this.stopping = true;
    this.operatorState?.close();
    this.closing = this.closeOwned(); return this.closing;
  }
  private async closeFailedWorld(error: unknown): Promise<never> {
    const original = error instanceof Q3GameCallbackError || error instanceof Q2GameCallbackError ? error.cause : error;
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
    if (this.ownership.kind === "borrowed") { try { await this.ownership.client.stopRecording(this); } catch (error) { errors.push(error); } }
    try { await this.ownedRecording?.stopAll(); } catch (error) { errors.push(error); }
    try { this.ownedDemos?.release(); } catch (error) { errors.push(error); }
    this.ownedDemos = null;
    try { await this.tools?.close(); } catch (error) { errors.push(error); }
    this.tools = null;
    try { this.ownedVideoRestart?.close(); } catch (error) { errors.push(error); }
    this.ownedVideoRestart = null;
    if (this.ownership.kind === "borrowed" && this.ownership.client.source.current === this) {
      try { await this.ownership.client.capture.beforeWorldChange(); } catch (error) { errors.push(error); }
    }
    for (const movie of this.movies.values()) { try { movie.playback.close(this.presentationFrames); } catch (error) { errors.push(error); } }
    this.movies.clear();
    try { if (this.ownership.kind === "owned") await this.capture?.close(); } catch (error) { errors.push(error); }
    this.capture = null;
    if (this.sourcePublished) { try { await this.keyProfiles.get(this.simulation)?.save(); } catch (error) { errors.push(error); } }
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
    try { graphical?.modPresentations.close(); } catch (error) { errors.push(error); }
    try { graphical?.selectedQ3Presentations.close(); } catch (error) { errors.push(error); }
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
    for (const close of [() => this.closeRankings(), () => this.bots?.close(), () => this.network?.server.close(), () => this.simulation.shutdownQ3Guest(),
      () => this.session.world?.simulation === this.simulation ? this.session.closeWorld() : this.simulation.close(),
      () => graphical?.input.close(), () => graphical?.audio.close(), () => graphical?.effects.close(), () => this.dedicatedConsole?.close(),
      () => graphical?.art.close(), () => graphical?.assets.close(),
      () => graphical?.renderer.execute({ owner: graphical.renderer.owner, sequence: this.presentationFrames, commands: [] })]) {
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
    try { this.releaseModInputCommands(); } catch (error) { errors.push(error); }
    try { this.profileConfiguration?.routing.close(); } catch (error) { errors.push(error); }
    this.profileConfiguration = null;
    try { await this.configurationScripts?.close(); } catch (error) { errors.push(error); }
    this.configurationScripts = null;
    try { await this.content.close(); } catch (error) { errors.push(error); }
    this.localSeats.clear(); this.networkPlayerIdentities.clear();
    if (this.ownership.kind === "borrowed" && this.ownership.client.source.current === this) {
      this.ownership.client.source.current = null;
      this.ownership.client.sourceProfile.current = null;
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application shutdown failed");
  }
}

export function openApplication(options: ApplicationOptions, host: ApplicationHost, recipe?: ExecutableRecipe, preferences?: FrontendPreferenceOverrides): Promise<Application> { return Application.open(options, host, recipe, preferences); }
