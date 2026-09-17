import { UnifiedRemotePresentation } from "./network/remote-unified.ts";
import { UnifiedClientNetwork } from "./network/unified-client.ts";
import { loadUnifiedContent } from "./network/unified-content.ts";
import { applicationOptionsForRecipe } from "./content.ts";
import { loadQ3Character } from "../../content/q3/foundation/index.ts";
import { saveCvarArchive } from "./cvar-archives.ts";
import { RemoteSeatPump } from "./remote-seat-pump.ts";
import { eventTargetsSeat } from "../../world/session/session.ts";
import { RemoteSeatSource } from "./remote-seat-source.ts";
import { RemoteSeatChannel } from "./remote-seats.ts";
import { RemoteSeatView } from "./remote-seat-view.ts";
import { seatViewport } from "./presentation.ts";
import type { ApplicationAudioSeatEvents } from "./audio.ts";
import { ApplicationKeys, type ApplicationKeyProfile } from "./keys.ts";
import { prepareRemoteSeatIdentities } from "./remote-seat-identities.ts";
import { SeatInput } from "../../input/seat.ts";
import { SeatUiPreferences } from "../../ui/settings/index.ts";
import { SeatMediaCaptions } from "../../text/media-captions.ts";
import { ClientDemoRecording } from "./demo-recording-commands.ts";
import type { DemoRecordingSink } from "./demo-recording.ts";
import { readQ2DemoHeader } from "../../network/q2/demo.ts";
import { readAudioOutputCvars } from "./audio/output-settings.ts";
import { CampaignCinematic, type ScreenCinematicRequest } from "./campaign-cinematic.ts";
import { UnifiedAudio } from "../../audio/index.ts";
import type { SceneImageRegistry } from "../../render/scene/resources.ts";
import { defaultAudioOutputFormat } from "../../audio/output.ts";
import { applyAudioOutputSettings } from "./shared-setting-cvars.ts";
import { ApplicationVideoRestart, prepareVideoGuests, type PreparedVideoPresentation } from "./video-restart.ts";
import { MusicControls } from "../../audio/music.ts";
import { legacyConfigurationOptions, prepareProfileConfiguration, type ConfigurationCommandRequest, type PreparedProfileConfiguration } from "./configuration.ts";
import { PreparedStartup } from "./prepared-startup.ts";
import { RecordedRemoteSource, demoTimingText } from "./network/recorded-source.ts";
import type { DemoResource, DemoFamily } from "./demo-playback.ts";
import type { DemoCompletion } from "./demo-commands.ts";
import { ClientSourcePublicationError } from "./client-bootstrap.ts";
import { CollisionMapSettings } from "../../world/collision/q3/settings.ts";
import { createStartupScriptReader } from "./startup-config.ts";
import { nextActorGeneration } from '../../world/actors/registry.ts';
import { PresentationTime } from "./frame-clock.ts";
import { readFrameTimeControls, registerFrameTimeCvars, sourceFrameMilliseconds } from "./frame-time.ts";
import { initializeQ3ClientCvars } from "./q3-client/userinfo.ts";
import { remoteContentSelection, remoteContentProduct, expectedProducts } from "../../content/catalog/index.ts";
import { setImmediate } from "node:timers/promises";
import type { CommandContext } from "../../contracts/common.ts";
import { ClientSocksSettings } from "./network/socks-settings.ts";
import { ApplicationViewSettings } from "./view-settings.ts";
import { loadAudioSettings, saveAudioSettings } from "./audio-settings.ts";
import { createClientDownloadPermission } from "./network/client-download-policy.ts";
import type { ClientDownloadProgress, ClientDownloadPermission } from "./network/client-download-policy.ts";
import { ApplicationCapture, applicationCaptureRoot, inputCaptureServices } from "./capture.ts";
import type { ClientBootstrap, ClientRecordingFeed } from "./client-bootstrap.ts";
import type { SessionConnection } from "../../world/session/session.ts";
import type { CommandCvarRouting, CommandHandler } from "../../core/commands/index.ts";
import type { CommandDocumentation } from "../../core/commands/documentation.ts";
import { consoleConfigRoot, ConsoleScriptFiles, sourceScriptReader } from "./config-scripts.ts";
import { CvarFlag, CvarRegistry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import { StartupServerBrowser } from "./server-browser.ts";
import { homedir } from "node:os";
import { compareQ3Packages } from "../../network/q3/pure.ts";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { existsSync } from "node:fs";
import { ServerPakSet } from "../../network/q3/pak-references.ts";
import { Q3ApplicationPackages } from "./network/q3-downloads.ts";
import { Q3ApplicationClientDownloads, q3DownloadPath } from "./network/q3-client-downloads.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { q3InfoValue } from "../../network/q3/admission.ts";
import { Q3ClientContent } from "./network/q3-client-content.ts";
import type { Q3ClientConnection } from "../../network/q3/client.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { SimulationOutput } from "../../contracts/session.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { openApplicationTransport, resolveApplicationAddress } from "./network/transport.ts";
import type { ApplicationTransport, ApplicationNetworkAddress } from "./network/transport.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { Q2_DATAGRAM_LIMITS, UNIFIED_DATAGRAM_LIMITS } from "../../network/common/transport.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { loadNativeUiArt } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import type { SessionSeat } from "../../world/session/index.ts";
import { EngineSession } from "../../world/session/index.ts";
import type { ApplicationHost } from "./application.ts";
import { ApplicationAssets } from "./assets.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { ApplicationAudio } from "./audio.ts";
import { loadApplicationContent, openRemoteApplicationContent, openRemoteContent, remoteConfigurationContent } from "./content.ts";
import type { LoadedApplicationContent, MountedApplicationContent, RemoteContentMounts, ApplicationConfigurationContent } from "./content.ts";
import { ApplicationEffects } from "./effects.ts";
import type { UnhandledApplicationEffect } from "./effects.ts";
import { ApplicationInput, movementDialect } from "./input.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import type { ApplicationInputCommandOwner, LocalPlayer } from "./input.ts";
import { loadMenuArtImage } from "./menu-art.ts";
import { Q3ClientNetwork } from "./network/q3-client.ts";
import { Q3BrowserView } from "../../network/q3/browser-view.ts";
import { Q3RemotePresentation } from "./network/remote-q3.ts";
import { ApplicationQ3Client } from "./q3-client.ts";
import { q3WeaponItem } from "../../content/q3/foundation/arsenal.ts";
import type { QwServerData } from "./network/qw-types.ts";
import { QwClientNetwork } from "./network/qw-client.ts";
import { QwRemotePresentation } from "./network/remote-qw.ts";
import { quakeWorldMapChecksum2 } from "../../network/q1/checksum.ts";
import { QwDownloadReceiver } from "./network/qw-downloads.ts";
import { Q1ClientNetwork } from "./network/q1-client.ts";
import { Q1RemotePresentation } from "./network/remote-q1.ts";
import type { Q1RemoteWorld } from "./network/remote-q1.ts";
import { Q2ClientNetwork } from "./network/q2.ts";
import { q2ApplicationLayout } from "./network/q2-layout.ts";
import { Q2RemotePresentation } from "./network/remote.ts";
import type { ApplicationNetworkPhase, Q2ApplicationGameState } from "./network/types.ts";
import { mapResourcePath } from "./options.ts";
import type { ApplicationOptions } from "./options.ts";
import { WorldSeatPresentation } from "./presentation.ts";
import { NativeRenderer } from "./renderer.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import { ApplicationSeatUi } from "./ui.ts";

interface RemoteWorldFrontend {
  readonly assets: ApplicationAssets;
  font: TextFontSelection;
  readonly art: NativeUiArt;
  readonly audio: ApplicationAudio;
  readonly effects: ApplicationEffects;
  readonly scene: SceneQueries;
}
interface RemoteSeatPeer {
  readonly seat: SessionSeat;
  readonly source: RemoteSeatSource;
  readonly channel: RemoteSeatChannel;
  content: RemoteContentMounts | null;
  map: string | null;
  loadedContent: LoadedApplicationContent | null;
  view: RemoteSeatView | null;
  generation: number;
  closed: boolean;
  readonly pump: RemoteSeatPump;
  disconnected: string | null;
  cinematicEnded: (() => void) | null;
  userinfo: string | null;
}
interface RemoteCommand { readonly name: string; readonly args: readonly string[]; readonly seat: SeatId | null; readonly source?: CommandContext; }
export interface RemoteApplicationHost extends ApplicationHost {
  readonly serverBrowser?: StartupServerBrowser;
}
export interface RemoteDemoApplicationHost extends RemoteApplicationHost { readonly serverBrowser: StartupServerBrowser; }
type RemoteCommandOwner = ApplicationInputCommandOwner & { readonly scripts: ConsoleScriptFiles };
type RemoteOwnership = { readonly kind: "owned" } | { readonly kind: "borrowed"; readonly client: ClientBootstrap };
interface RemoteConfiguration {
  readonly prepared: PreparedStartup;
  readonly profile: PreparedProfileConfiguration;
  readonly seat: SessionSeat;
  readonly seats: readonly SessionSeat[];
  readonly seatSources: ReadonlyMap<SeatId,CvarRegistry>;
  readonly identities: ReturnType<typeof prepareRemoteSeatIdentities>;
  readonly settings: ConfigStore;
  readonly socks: ClientSocksSettings;
  readonly images: ReturnType<ApplicationImageSettings["prepareClientSettings"]>;
  readonly downloadPermission: ClientDownloadPermission | null;
  readonly downloadPermissions: ReadonlyMap<SeatId, ClientDownloadPermission | null>;
  readonly source: CvarRegistry;
  readonly routing: CommandCvarRouting;
  prepareTransport(transport: Pick<ApplicationTransport, "connectSocks">): Promise<void>;
  validateSource(): void;
  publishSource(): void;
}
interface PeerDirectoryAdmission {
  readonly content: RemoteContentMounts;
  readonly options: ApplicationOptions;
  readonly assertCurrent: () => void;
  phase: "requested" | "published";
  readonly suspension: { resume(): void; cancel(error: Error): void } | null;
}
type RemoteAdvanceOutcome = { readonly kind: "complete" } | { readonly kind: "failed"; readonly error: unknown };
interface PendingRemoteAdvance {
  readonly completion: Promise<RemoteAdvanceOutcome>;
  boundary: Promise<{ readonly kind: "boundary" }>;
  signalBoundary(): void;
}
type RemoteCinematic = { readonly movie: CampaignCinematic; readonly images: SceneImageRegistry; readonly ownedAudio: UnifiedAudio | null; readonly ended: () => void };

type RemoteBrowser = { readonly kind: "owned" | "borrowed"; readonly browser: StartupServerBrowser };

type LiveNetwork = UnifiedClientNetwork<ApplicationNetworkAddress> | QwClientNetwork | Q2ClientNetwork<ApplicationNetworkAddress> | Q1ClientNetwork | Q3ClientNetwork;
type DemoLaunch = { readonly kind: "recorded"; readonly playback: { readonly resource: DemoResource; readonly timedemo: boolean }; readonly complete: (reason: DemoCompletion) => void };
type RemoteLaunch = { readonly kind: "live"; readonly unified?: boolean; readonly family: DemoFamily; readonly transport: ApplicationTransport; readonly address: ApplicationNetworkAddress } | DemoLaunch;
type RemoteSource = { readonly kind: "live"; readonly network: LiveNetwork; readonly transport: ApplicationTransport }
  | { readonly kind: "recorded"; readonly playback: RecordedRemoteSource };

/** One native seat presents received server state; its session has no authoritative world. */
export class RemoteApplication {
  get serverBrowser(): StartupServerBrowser { return this.browser.browser; }
  private clientCommandOwner: RemoteCommandOwner | null;
  get clientCommands(): RemoteCommandOwner | null { return this.clientCommandOwner; }
  readonly viewSettings = new ApplicationViewSettings(value => {
    this.presentation?.q3Client?.cvars.set("cg_fov", String(value));
    if (this.network instanceof Q2ClientNetwork && this.remote instanceof Q2RemotePresentation) {this.configuration.source.set("fov",String(value));this.network.userinfo(this.remote.userinfo());}
    for(const peer of this.remoteSeats){peer.view?.presentation.q3Client?.cvars.set("cg_fov",String(value));if(peer.source.remote instanceof Q2RemotePresentation)this.configuration.seatSources.get(peer.seat.id)?.set("fov",String(value));}
  });
  private releaseViewCvars: (() => void) | null = null;
  private readonly socksSettings: ClientSocksSettings;
  private clientConfig: ConfigStore | null;
  private inputConfig: ConfigStore;
  private readonly downloadPermission: ClientDownloadPermission | null;
  private readonly initialRemote: UnifiedRemotePresentation | QwRemotePresentation | Q2RemotePresentation | Q1RemotePresentation | Q3RemotePresentation;
  private primaryPeer: RemoteSeatPeer | null = null;
  get remote() { return this.primaryPeer?.source.remote ?? this.initialRemote; }
  private readonly initialSource: RemoteSource;
  private get source(): RemoteSource {
    const peer = this.primaryPeer;
    return peer === null ? this.initialSource : { kind: "live", network: peer.source.network, transport: peer.source.transport };
  }
  private family: DemoFamily;
  private get network(): LiveNetwork | null { return this.source.kind === "live" ? this.source.network : null; }
  private sendCommand(text: string): void { if (this.source.kind === "live") this.source.network.command(text); }
  private loadedContent: LoadedApplicationContent | null = null;
  private frontend: RemoteWorldFrontend | null = null;
  private cinematic: RemoteCinematic | null = null;
  private cinematicPresented = false;
  get presentedCinematic(): boolean { return this.cinematicPresented; }
  get hasCinematic(): boolean { return this.cinematic !== null; }

  private readonly retiredFrontends: { readonly frontend: RemoteWorldFrontend; readonly content: LoadedApplicationContent | null }[] = [];
  private controls: ApplicationInput | null = null;
  private capture: ApplicationCapture | null = null;
  private ownedVideoRestart: ApplicationVideoRestart | null = null;
  private initialPresentation: WorldSeatPresentation | null = null;
  private get presentation(): WorldSeatPresentation | null { return this.primaryPeer === null ? this.initialPresentation : this.primaryPeer.view?.presentation ?? null; }
  private set presentation(value: WorldSeatPresentation | null) {
    if (this.primaryPeer === null) this.initialPresentation = value;
    else if (value !== null) throw new Error("Promoted presentation belongs to its seat view");
  }
  private commands: RemoteCommand[] = [];
  private elapsed = 0;
  private readonly presentationTime = new PresentationTime();
  private frames = 0;
  private stopping = false;
  private closed = false;
  private closing = false;
  private closeResult: Promise<void> | null = null;
  private ownedRecording: ClientDemoRecording | null = null;
  private worldLoadGeneration = 0;
  private primaryViewGeneration = -1;
  private get primaryViewCurrent():boolean {return this.presentation!==null && (this.primaryPeer !== null || this.primaryViewGeneration===this.worldLoadGeneration);}
  private stepping = false;
  private q3Content: Q3ClientContent | null = null;
  private qwAllSkins = '';
  private qwDownloads: QwDownloadReceiver | null = null;
  private remoteContent: RemoteContentMounts | null = null;
  private remoteContentGeneration = 0;
  private peerAdmission: PeerDirectoryAdmission | null = null;
  private pendingAdvance: PendingRemoteAdvance | null = null;
  private resetFrameElapsed = false;
  private q3Downloads: Q3ApplicationClientDownloads | null = null;
  private q3InitialViewPending = false;
  private clientInputs: { readonly generation: number; readonly client: ApplicationQ3Client; readonly event: SeatInputEvent }[] = [];
  private q3Browser: Q3BrowserView | null = null;
  private sourceEvents: readonly SimulationPresentationEvent[] = [];
  private unhandledEffects: readonly UnhandledApplicationEffect[] = [];
  private readonly reportedEffectGaps = new Set<string>();
  private sourceConnection: SessionConnection | null = null;
  private publicationStarted = false;
  private configurationPublished = false;
  private readonly sourceHandlers = new Map<string, CommandHandler>();
  private readonly sourceDocumentation = new Map<string, CommandDocumentation>();
  private readonly initialSeatId: SeatId;
  private get seatId(): SeatId { return this.primaryPeer?.seat.id ?? this.initialSeatId; }
  private uiPreferences: ApplicationSeatUi["preferences"]["values"] | null = null;

  private readonly remoteSeats: RemoteSeatPeer[] = [];
  private readonly qports = new Set<number>();
  private initialQport: number | null = null;
  private initialUserinfo: string | null = null;
  private allocateQport(): number {
    let port = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0;
    while ((port & 255) === 0 || [...this.qports].some(value => (value & 255) === (port & 255))) port = (port + 1) & 65535;
    this.qports.add(port);
    return port;
  }
  private readonly musicControls: MusicControls;
  private keyProfile: ApplicationKeyProfile | null;
  private constructor(private launchOptions: ApplicationOptions, private readonly mountedContent: MountedApplicationContent,
    readonly session: EngineSession, private readonly renderer: NativeRenderer, private readonly host: ApplicationHost,
    private readonly imageSettings: ApplicationImageSettings, launch: RemoteLaunch, private readonly identity: ReturnType<typeof createIdentityOwner>,
    private readonly browser: RemoteBrowser, private readonly ownership: RemoteOwnership, private configuration: RemoteConfiguration,
    private readonly keys: ApplicationKeys, keyProfile: ApplicationKeyProfile | null) {
    this.keyProfile = keyProfile;
    this.musicControls = ownership.kind === "borrowed" ? ownership.client.musicControls : new MusicControls();
    this.family = launch.kind === "live" ? launch.family : launch.playback.resource.kind;
    this.initialSeatId = configuration.seat.id;
    this.inputConfig = configuration.settings;
    this.socksSettings = configuration.socks;
    this.downloadPermission = configuration.downloadPermission;
    const family = this.family === "q3" ? "q3" : this.family === "qw" ? "qw" : this.family === "q1" ? "nq" : "q2";
    const cvars = configuration.source;
    const scripts = configuration.profile.scripts;
    const routing = configuration.routing;
    const commands = configuration.prepared.commands;
      if (family === "qw") {
        for (const name of ["skins", "allskins"]) this.sourceHandlers.set(name, invocation => this.queueCommand(name, invocation.args, null));
        this.sourceHandlers.set("color", invocation => this.queueCommand("color", invocation.args, null, invocation.source));
      }
      this.clientCommandOwner = { cvars, commands, scripts, routing, movement: launchOptions.network.kind === "unified-client" ? configuration.profile.movement : cvars, fallback: cvars };
      this.clientConfig = this.inputConfig;
    const client = configuration.seat.client;
    const nextGeneration = (slot: number): number => nextActorGeneration(session.session, slot);
    if (launch.kind === "live" && launch.unified === true) {
      const remote = new UnifiedRemotePresentation({identity,client,seat:this.seatId,nextGeneration,
        loadContent: async (offer, assertCurrent) => {
          const content = await loadUnifiedContent({...this.options,mode:offer.mode},offer.composition,this.mountedContent.catalog);
          try { assertCurrent(); } catch (error) { await content.close(); throw error; }
          try { await this.adoptUnifiedProfile(content,offer.mode,assertCurrent); }
          catch(error){await content.close();throw error;}
          try{return await this.loadServerWorld({map:content.recipe.map.geometry.requestedPath,models:[],sounds:[]},content);}
          catch(error){if(this.loadedContent!==content)await content.close();throw error;}
        },
        model: async (key,brush) => {
          if(brush!==null)return {kind:"brush-model",world:this.content.world,model:brush};
          if(this.frontend===null)throw new Error("Unified model has no published content");
          return (await this.frontend.assets.model(key.content,key.path)).model;
        },
        publish:output=>this.publishRemote(output),print:text=>this.print(text),
        disconnected:reason=>{this.print(`${reason}\n`);this.disconnectSource();},
        sendCommand:(name,args)=>{if(this.network instanceof UnifiedClientNetwork)this.network.playerCommand(name,args);}});
      this.initialRemote=remote;
      this.initialSource={kind:"live",transport:launch.transport,network:new UnifiedClientNetwork({transport:launch.transport,remote:launch.address,host:remote,userinfo:()=>this.clientCommands?.cvars.infoString(CvarFlag.UserInfo)??""})};
    } else if (this.family === "qw") {
      const remote = new QwRemotePresentation({ cameraOptions: { hightrack: () => this.clientCommands?.cvars.variableValue("cl_hightrack") ?? 0, chasecam: () => this.clientCommands?.cvars.variableValue("cl_chasecam") ?? 0 }, identity, session, client, seat: this.seatId, nextGeneration, content: null,
        publish: output => this.publishRemote(output), disconnected: reason => { this.print(`${reason}\n`); this.disconnectSource(); },
        presentationTime: () => this.presentationTime.milliseconds,
        skinOptions: { read: async path => (await this.mounts.open(path))?.bytes ?? null,
          noskins: () => this.clientCommands?.cvars.variableValue("noskins") ?? 0,
          baseskin: () => this.clientCommands?.cvars.variableString("baseskin") ?? "base", allskins: () => this.qwAllSkins },
        downloads: {
          request: (path, category) => { if (this.qwDownloads === null) throw new Error("QW download before serverdata"); return this.qwDownloads.request(path, category); },
          receive: result => { if (this.qwDownloads === null) throw new Error("QW download before serverdata"); return this.qwDownloads.receive(result); },
          close: () => { this.remoteContentGeneration++; this.qwDownloads?.close(); this.qwDownloads = null; },
        },
        prepareServerData: data => this.prepareQwDownloads(data),
        print: text => this.print(text), sendCommand: text => this.sendCommand(text),
        loadContent: world => this.loadServerWorld(world, undefined, true),
        mapChecksum: async world => quakeWorldMapChecksum2(await this.content.mounts.read(world.map)) });
      this.initialRemote = remote;
      this.initialSource = launch.kind === "live" ? { kind: "live", transport: launch.transport, network: new QwClientNetwork({ transport: launch.transport.udpSocket(), remote: requireQwAddress(launch.address), host: remote, qport: this.initialQport = this.allocateQport(), userinfo: () => this.clientCommands?.cvars.propagatedInfo("client-userinfo") ?? "" }) } : this.recordedSource(launch, remote);
    } else if (this.family === "q1") {
      const remote = new Q1RemotePresentation({ identity, session, client, nextGeneration, content: null,
        publish: output => this.publishRemote(output), disconnected: reason => { this.print(`${reason}\n`); this.disconnectSource(); },
        presentationTime: () => this.presentationTime.milliseconds,
        print: text => this.print(text), sendCommand: text => this.sendCommand(text),
        loadContent: world => this.loadServerWorld(world) });
      this.initialRemote = remote;
      this.initialSource = launch.kind === "live" ? { kind: "live", transport: launch.transport, network: new Q1ClientNetwork({ transport: launch.transport, remote: launch.address, host: remote,
        seat: { name: cvars.variableString("name"), color: cvars.get("color")?.integerValue??0, spawnParameters: "", extensionFlags: null } }) } : this.recordedSource(launch, remote);
    } else if (this.family === "q3") {
      const remote = new Q3RemotePresentation({ identity, session, client, nextGeneration, content: null,
        publish: output => this.publishRemote(output), disconnected: () => { this.disconnectSource(); },
        presentationTime: () => this.presentationTime.milliseconds,
        timescale: () => this.clientCommands?.cvars.variableValue("timescale") ?? 1,
        timeNudge: () => this.clientCommands?.cvars.get("cl_timeNudge")?.integerValue ?? 0,
        userinfo: () => this.clientCommands?.cvars.infoString(CvarFlag.UserInfo) ?? "",
        print: text => this.print(text), sendCommand: text => this.sendCommand(text),
        loadContent: (world, connection) => this.loadQ3ServerWorld(world, connection), initialize: connection => this.bindSeat(connection),
        downloads: { prepare: connection => this.prepareQ3Downloads(connection),
          publishSize: size => { if (this.q3Downloads === null) throw new Error("Q3 download has no content owner"); return this.q3Downloads.publishSize(size); },
          receive: async block => { if (this.q3Downloads === null) throw new Error("Q3 download has no content owner"); await this.q3Downloads.receive(block); },
          close: () => { this.q3Downloads?.close(); this.q3Downloads = null; } }, shutdown: async () => {
          const presentation = this.presentation;
          if (presentation !== null) {
            this.uiPreferences = { ...presentation.ui.preferences.values };
            await presentation.q3Client?.shutdown();
            this.clearSourcePresentation(); this.clientInputs = [];
          }
        } });
      if (this.clientCommands === null) throw new Error("Q3 remote requires its engine cvar owner");
      remote.bindCollisionSettings(new CollisionMapSettings(this.clientCommands.cvars));
      this.initialRemote = remote;
      if (launch.kind === "live") {
        const address = launch.address;
        if (address.kind !== "ipv4" && address.kind !== "ipx") throw new Error("Native Q3 remote requires IPv4");
        this.initialSource = { kind: "live", transport: launch.transport, network: new Q3ClientNetwork({ transport: launch.transport, remote: address, host: remote, cvars: this.clientCommands.cvars, authorization: this.keys.authorization, qport: this.initialQport = this.allocateQport() }) };
      } else this.initialSource = this.recordedSource(launch, remote);
    } else {
      if (this.downloadPermission === null) throw new Error("Q2 remote client has no download policy");
      const remote: Q2RemotePresentation = new Q2RemotePresentation({ cinematic: { start: (name, ended) => this.startCinematic({ name, loop: false, hold: false, silent: false }, ended), stop: () => this.stopCinematic() }, downloadPermission: this.downloadPermission, identity, session, client, seat: this.seatId,
        publish: output => this.publishRemote(output), disconnected: () => this.disconnectSource(), nextGeneration, content: null, protocol: launch.kind === "recorded" ? readQ2DemoHeader(launch.playback.resource.bytes).protocol : launchOptions.q2Protocol ?? (mountedContent.catalog.product(launchOptions.product).expectation.edition === "rerelease" ? { kind: "q2-rerelease", version: 1038 } : { kind: "q2-classic", version: 34 }),
        presentationTime: () => this.presentationTime.milliseconds,
        userinfo: () => cvars.infoString(CvarFlag.UserInfo),
        print: text => this.print(text), sendCommand: text => this.sendCommand(text),
        prepareServerData: (data, assertCurrent) => this.selectRemoteContent(remoteContentSelection(remote.protocol.kind === "q2-rerelease" || remote.protocol.kind === "q2-kex" || remote.protocol.kind === "q2-kex-demo" ? "q2-rerelease-baseq2" : "q2-classic-baseq2", data.gamedir), assertCurrent),
        loadContent: state => this.loadQ2ServerWorld(state), refreshDownloads: assertCurrent => this.refreshRemoteContent(assertCurrent) });
      this.initialRemote = remote;
      this.initialSource = launch.kind === "live" ? { kind: "live", transport: launch.transport, network: new Q2ClientNetwork({ transport: launch.transport, remote: launch.address, host: remote, qport: this.initialQport = this.allocateQport() }) } : this.recordedSource(launch, remote);
    }
    if (this.clientCommands !== null) {
      const inputSettings = configuration.profile.seats.find(seat => seat.id.equals(this.seatId))?.mouse;
      if (inputSettings === undefined) throw new Error("Remote configuration has no primary input owner");
      this.clientCommandOwner = { ...this.clientCommands, inputSettings };
    }
    if (ownership.kind === "owned") {
      this.sourceConnection = client.connect("remote");
    }
  }

  private recordedSource(launch: DemoLaunch, remote: Q1RemotePresentation | QwRemotePresentation | Q2RemotePresentation | Q3RemotePresentation): RemoteSource {
    if (this.clientCommands === null) throw new Error("Recording requires a command owner");
    return { kind: "recorded", playback: new RecordedRemoteSource(launch.playback.resource, remote, launch.playback.timedemo, this.clientCommands.cvars, (reason, timing) => { if (timing !== null) this.print(demoTimingText(timing)); if (reason === "truncated") this.print(`Demo ${launch.playback.resource.path} is truncated.\n`); launch.complete(reason); }) };
  }

  private static recordedOptions(options: ApplicationOptions, resource: DemoResource): ApplicationOptions {
    const { remoteContent: priorSelection, quakeCProgram: _program, q1Protocol: _q1, q2Protocol: _q2, botSkill: _bots, ...retained } = options;
    const family = resource.kind === "qw" ? "q1" : resource.kind;
    const selected = expectedProducts.find(product => product.id === options.product);
    const netQuakeProduct = selected?.family === "q1" && selected.edition === "classic" ? selected.id : "q1-classic-id1";
    const q2 = resource.kind === "q2" ? readQ2DemoHeader(resource.bytes).protocol : null;
    const base = resource.kind === "qw" ? "q1-quakeworld" : resource.kind === "q2" ? q2?.kind === "q2-rerelease" || q2?.kind === "q2-kex" || q2?.kind === "q2-kex-demo" ? "q2-rerelease-baseq2" : "q2-classic-baseq2" : "q3-baseq3";
    const selection = resource.kind === "q1" ? null : priorSelection?.base === base ? priorSelection
      : remoteContentSelection(base, resource.kind === "qw" ? "qw" : resource.kind === "q2" ? "baseq2" : "baseq3");
    return { ...retained, network: { kind: "offline" }, seats: 1, dedicated: false, rules: "standard", movement: family, character: family,
      characterModel: options.character === family ? options.characterModel : family === "q1" ? "player" : family === "q2" ? "male" : "sarge",
      product: selection === null ? netQuakeProduct : remoteContentProduct(selection), ...(selection === null ? {} : { remoteContent: selection }) };
  }

  static openDemoBorrowed(client: ClientBootstrap, options: ApplicationOptions, host: RemoteDemoApplicationHost,
    playback: { readonly resource: DemoResource; readonly timedemo: boolean }, complete: (reason: DemoCompletion) => void): Promise<RemoteApplication> {
    return RemoteApplication.openSource({ kind: "borrowed", client }, options, host, { kind: "recorded", playback, complete });
  }

  static open(options: ApplicationOptions, host: RemoteApplicationHost): Promise<RemoteApplication> {
    return RemoteApplication.openSource({ kind: "owned" }, options, host);
  }

  static openBorrowed(client: ClientBootstrap, options: ApplicationOptions, host: RemoteApplicationHost): Promise<RemoteApplication> {
    return RemoteApplication.openSource({ kind: "borrowed", client }, options, host);
  }

  private static async openSource(ownership: RemoteOwnership, options: ApplicationOptions, host: RemoteApplicationHost, recording?: DemoLaunch): Promise<RemoteApplication> {
    if (recording !== undefined && host.serverBrowser === undefined) throw new Error("Recorded playback requires the retained server browser");
    if (recording !== undefined) options = RemoteApplication.recordedOptions(options, recording.playback.resource);
    const unified = recording === undefined && options.network.kind === "unified-client";
    const selected = recording?.playback.resource.kind ?? (unified ? expectedProducts.find(product=>product.id===options.product)?.family : undefined);
    const qw = selected === undefined ? options.network.kind === "qw-client" : selected === "qw", q1 = selected === undefined ? options.network.kind === "q1-client" || qw : selected === "q1" || qw, q3 = selected === undefined ? options.network.kind === "q3-client" : selected === "q3";
    if (!unified && selected === undefined && !q1 && !q3 && options.network.kind !== "q2-client") throw new Error("RemoteApplication requires a native connect address");
    const family = q1 ? "q1" : q3 ? "q3" : "q2";
    if (options.dedicated || !Number.isInteger(options.seats) || options.seats < 1 || options.seats > 4 || !unified && (options.movement !== family || options.character !== family))
      throw new Error(`Native ${family} remote play requires one to four graphical seats with matching movement and character providers`);
    if (!unified && !q1 && !q3 && !["male", "female", "cyborg"].includes(options.characterModel))
      throw new Error("Remote Q2 character selection requires an installed male, female or cyborg player appearance");
    const network = options.network;
    const address = recording !== undefined ? null : network.kind === "qw-client" || network.kind === "q1-client" || network.kind === "q2-client" || network.kind === "q3-client" || network.kind === "unified-client"
      ? await resolveApplicationAddress(network.remote, unified ? 27960 : qw ? 27500 : q1 ? 26000 : q3 ? 27960 : 27910, options.networkTransport ?? { kind: "udp" }, qw ? "qw" : family) : null;
    if (recording === undefined && address === null) throw new Error("Missing remote address");
    const content = await openRemoteApplicationContent(options);
    if (content.q3Product !== null) options = { ...options, q3Product: content.q3Product };
    const identity = ownership.kind === "borrowed" ? ownership.client.identity : createIdentityOwner(`quake:remote:${address === null ? recording?.playback.resource.path : addressKey(address)}`);
    const session = ownership.kind === "borrowed" ? ownership.client.session : new EngineSession(identity, { kind: "local" });
    let renderer: NativeRenderer | null = null, transport: ApplicationTransport | null = null, application: RemoteApplication | null = null, imageSettings: ApplicationImageSettings | null = null;
    let browser: RemoteBrowser | null = null;
    let configuration: RemoteConfiguration | null = null;
    try {
      const product = content.catalog.product(options.product);
      if (!unified && (product.expectation.family !== family || product.expectation.edition === "rerelease" && family !== "q2" || recording === undefined && q1 && options.product !== "q1-classic-id1" && !(qw && options.product === remoteContentProduct(options.remoteContent ?? remoteContentSelection("q1-quakeworld", "qw"))) || q3 && options.product !== remoteContentProduct(options.remoteContent ?? remoteContentSelection("q3-baseq3", "baseq3"))))
        throw new Error("Remote application requires content matching the selected native protocol");
      const audioProduct = content.catalog.require(qw ? "q1-quakeworld" : options.product);
      const audioSettings = new ConfigStore(audioProduct.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), audioProduct.expectation.contentDirectory));
      imageSettings = ownership.kind === "borrowed" ? ownership.client.imageSettings : await ApplicationImageSettings.open({ audioOutputFormat: (await loadAudioSettings(audioSettings)).outputFormat ?? defaultAudioOutputFormat, context: { session: session.session, origin: { kind: "local-console" } },
        dialect: qw ? "q1-quakeworld" : q1 ? "q1-netquake" : q3 ? "q3" : product.expectation.edition === "rerelease" ? "q2-rerelease" : "q2-classic", gamma: options.gamma, ...(options.renderWorker === undefined ? {} : { renderWorker: options.renderWorker }), ...(options.displayOverrides === undefined ? {} : { displayOverrides: options.displayOverrides }), ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }),
        print: text => { if (application === null) host.print(text); else application.print(text); } });
      renderer = ownership.kind === "borrowed" ? ownership.client.renderer : await NativeRenderer.open({ ...options, renderWorker: imageSettings.cvars.variableValue("r_smp") !== 0 }, { identity: Symbol("remote application renderer"), session: session.session, generation: 0 });
      if (ownership.kind === "owned") await imageSettings.refreshDisplay(renderer);
      if (address !== null) transport = await openApplicationTransport({ selection: options.networkTransport ?? { kind: "udp" }, family: qw ? "qw" : family, host: address.kind === "ipv6" ? "::" : "0.0.0.0", port: 0, limits: unified || q1 || q3 ? UNIFIED_DATAGRAM_LIMITS : Q2_DATAGRAM_LIMITS });
      const browserSettings = host.saveDirectory !== undefined ? join(host.saveDirectory, "..", "settings")
        : join(homedir(), ".local", "share", "quake-typescript", "settings");
      browser = host.serverBrowser === undefined
        ? { kind: "owned", browser: await StartupServerBrowser.open(new ConfigStore(browserSettings)) }
        : { kind: "borrowed", browser: host.serverBrowser };
      const launch: RemoteLaunch = recording !== undefined ? recording : address !== null && transport !== null
        ? { kind: "live", unified, family: qw ? "qw" : q1 ? "q1" : q3 ? "q3" : "q2", address, transport } : (() => { throw new Error("Remote transport missing"); })();
      configuration = await prepareRemoteConfiguration(options, content, session, imageSettings, ownership, host,
        () => application?.remote instanceof Q3RemotePresentation && q3InfoValue(application.remote.sourceRecords[1] ?? "", "sv_cheats") === "1");
      const keys = ownership.kind === "borrowed" ? ownership.client.keys : new ApplicationKeys(host.print);
      const keyProfile = await keys.prepare(configuration.profile.options, content.catalog, configuration.source);
      application = new RemoteApplication(options, content, session, renderer, host, imageSettings, launch, identity, browser, ownership, configuration, keys, keyProfile);
      application.initializeQ3Browser();
      await application.prepareRemoteSeats();
      if (ownership.kind === "owned") {
        application.activateSourceCommands();
        const current = application;
        const video = new ApplicationVideoRestart(current.renderer, {
          renderWorker: () => current.imageSettings.cvars.variableValue("r_smp") !== 0,
          capture: () => current.capture, prepare: () => current.prepareVideoRestart(),
          publishWindow: window => { current.controls?.publishWindow(window); },
          published: renderer => { current.launchOptions = { ...current.launchOptions, renderer }; },
          settled: () => {}, print: (text, source) => current.print(text, source), failed: async error => {
            try { await current.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Remote video restart and shutdown failed"); }
            throw error;
          },
        });
        if (current.clientCommands === null) throw new Error("Remote video restart requires client commands");
        video.register(current.clientCommands.commands); current.ownedVideoRestart = video;
      }
      if (ownership.kind === "owned") {
      application.publishConfiguration();
      for (const peer of application.remoteSeats) peer.channel.publishConnection()?.close();
      await application.viewSettings.load(application.inputConfig);
      application.releaseViewCvars = application.viewSettings.bindCvars(application.imageSettings.cvars);
      }
      if (transport !== null) await application.socksSettings.connect(transport);
      if (ownership.kind === "borrowed") await application.publishConnecting(ownership.client);
      host.print(recording === undefined && address !== null ? `Connecting to ${qw ? "QuakeWorld" : q1 ? "Quake" : q3 ? "Quake III" : "Quake II"} server ${addressKey(address)}.\n` : `Playing ${recording?.playback.resource.path}.\n`);
      return application;
    } catch (error) {
      if (application !== null) {
        const failures: unknown[] = [error];
        try { await application.close(); } catch (cleanup) { failures.push(cleanup); }
        if (application.publicationStarted) throw new ClientSourcePublicationError(failures);
        if (failures.length > 1) throw new AggregateError(failures, "Remote preparation and cleanup failed");
      } else {
        const failures: unknown[]=[error];
        for(const close of [()=>transport?.close(),()=>configuration?.profile.scripts.close(),()=>configuration?.images.settings.close(),
          ()=>configuration?.identities.discard(),()=>{if(ownership.kind==="owned")renderer?.close();},()=>{if(ownership.kind==="owned")session.close();},
          ()=>ownership.kind==="owned"?imageSettings?.close():undefined,()=>content.close(),()=>browser?.kind==="owned"?browser.browser.close():undefined]) {
          try{await close();}catch(cleanup){failures.push(cleanup);}
        }
        if(failures.length>1)throw new AggregateError(failures,"Remote preparation and resource cleanup failed");
      }
      throw error;
    }
  }

  get options(): ApplicationOptions { return this.launchOptions; }
  get finished(): boolean { return this.stopping || this.closed || this.options.frameLimit !== null && this.frames >= this.options.frameLimit; }
  get clientCommandsBlocked(): boolean { return this.capture?.pendingReadback === true || this.videoRestart?.pending === true; }
  private get videoRestart(): ApplicationVideoRestart | null { return this.ownership.kind === "borrowed" ? this.ownership.client.videoRestart : this.ownedVideoRestart; }
  pumpClientInput(): void { this.controls?.pump(false); }
  advanceClientStartup(): Promise<boolean> { return this.configuration.prepared.advanceFrame(); }
  async flushClientCommands(): Promise<void> {
    if (this.peerAdmission?.phase === "requested") await this.publishPeerConfiguration(this.peerAdmission);
    await this.dispatchCommands();
  }

  private ownsPublishedSource(): boolean {
    return !this.closed && !this.closing && (this.ownership.kind === "owned" || this.ownership.client.source.current === this)
      && (this.primaryPeer !== null ? !this.primaryPeer.closed : this.sourceConnection !== null && this.remote.client.connection === this.sourceConnection);
  }

  private publishRemote(output: SimulationOutput): void {
    if (this.ownsPublishedSource() && this.presentation !== null) this.session.publish({...output,
      events:output.events.filter(event=>eventTargetsSeat(event,this.seatId,this.configuration.seat.client.id)).map(event=>({...event,audience:{kind:"seat",seat:this.seatId} satisfies import("../../contracts/session.ts").EventAudience}))});
  }

  private disconnectSource(): void {
    if ((this.primaryPeer !== null ? !this.primaryPeer.closed : this.sourceConnection !== null && this.remote.client.connection === this.sourceConnection)) this.remote.client.disconnect();
  }

  private activateSourceCommands(): void {
    for (const [name, handler] of this.sourceHandlers) this.clientCommands?.commands.register(name, handler, this.sourceDocumentation.get(name));
  }

  private clearSourcePresentation(): void {
    const presentation = this.presentation;
    this.presentation = null;
    if (presentation !== null && presentation.local.player.seat.presentation === presentation) presentation.local.player.seat.clearPresentation();
  }

  private async retireFrontends(): Promise<void> {
    const failures: unknown[] = [];
    for (const retired of this.retiredFrontends.splice(0)) {
      try { this.releaseFrontend(retired.frontend); } catch (error) { failures.push(error); }
      try { await retired.content?.close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Remote frontend retirement failed");
  }

  private startupReader(scripts: ConsoleScriptFiles): ReturnType<typeof createStartupScriptReader> {
    const catalog = this.remoteContent?.catalog ?? this.loadedContent?.catalog ?? this.mountedContent.catalog, product = catalog.product(this.options.product);
    const base = product.expectation.baseProduct === null ? product : catalog.product(product.expectation.baseProduct);
    const roots = (selected: typeof product): readonly string[] => [selected.userContent?.root, selected.looseRoot].filter((root): root is string => root !== null && root !== undefined);
    return createStartupScriptReader({ mounted: name => scripts.readMountedScript(name),
      user: (name, source) => scripts.read(name, source), baseLooseRoots: roots(base), gameLooseRoots: roots(product), seatRoot: consoleConfigRoot(this.options.userContentRoot) });
  }

  private async adoptUnifiedProfile(content:LoadedApplicationContent,mode:ApplicationOptions["mode"],assertSourceCurrent:()=>void):Promise<void> {
    const assertCurrent=():void=>{assertSourceCurrent();if(this.closed||this.closing)throw new Error("Unified profile loading was cancelled");};
    assertCurrent();
    const {remoteContent:_nativeSelection,q3Product:_oldProduct,...retained}=this.options;
    const options=applicationOptionsForRecipe({...retained,mode,...(content.q3Product===null?{}:{q3Product:content.q3Product})},content);
    const recipe=content.recipe,sourceDialect=recipe.timing.find(value=>value.provider===recipe.engineBehavior.provider)?.clock.kind;
    const movement=movementDialect(options,recipe),previous=this.configuration;
    const family=sourceDialect==="q1-quakeworld"?"qw":content.world.kind==="q1-bsp"?"q1":content.world.kind==="q2-bsp"?"q2":"q3";
    if(previous.profile.options.product===options.product && previous.source.dialect===sourceDialect && previous.profile.movement.dialect===movement
      && previous.profile.options.character===options.character && previous.profile.options.characterModel===options.characterModel){this.launchOptions=options;this.family=family;return;}
    await this.prepareRetirement();assertCurrent();
    const release=content.retainMainMounts();let released=false;
    const close=async():Promise<void>=>{if(!released){released=true;release();}};
    const mounted:MountedApplicationContent={catalog:content.catalog,mounts:content.mounts,q3Product:content.q3Product,close};
    const selected:ApplicationConfigurationContent={catalog:content.catalog,mounts:content.mounts,close,...(content.q3Product===null?{}:{q3Product:content.q3Product}),
      selection:{source:recipe.map.entities,engineBehavior:recipe.engineBehavior,match:recipe.match,combat:recipe.combat,movement:recipe.movement,timing:recipe.timing}};
    let candidate:RemoteConfiguration|null=null,published=false;
    const oldScripts=this.clientCommands?.scripts;
    const retire=async():Promise<void>=>{const failures:unknown[]=[];for(const action of [()=>oldScripts?.close(),()=>previous.images.settings.close()])try{await action();}catch(error){failures.push(error);}if(failures.length!==0)throw new AggregateError(failures,"Unified profile retirement failed");};
    try{
      candidate=await prepareRemoteConfiguration(options,mounted,this.session,this.imageSettings,this.ownership,this.host,()=>false,previous,selected);
      const keyProfile=await this.keys.prepare(options,content.catalog,candidate.source);assertCurrent();
      candidate.profile.program.validatePublication();candidate.images.validatePublication();candidate.validateSource();
      const next=candidate;
      const commit=():void=>{published=true;this.releaseSettings();this.keyProfile=keyProfile;this.publishConfiguration(next);this.launchOptions=options;this.family=family;
        const owner=this.clientCommands;if(owner===null)throw new Error("Unified profile lost its command owner");if(this.controls!==null && this.controls.dialect===(owner.movement ?? owner.cvars).dialect && previous.source.dialect===owner.cvars.dialect)this.controls.adoptClientSource(owner);
        if(this.ownership.kind==="borrowed")this.ownership.client.configuration.current={scripts:next.profile.scripts,options};this.resetFrameElapsed=true;};
      if(this.ownership.kind==="borrowed")this.ownership.client.activateFrontend({releaseCommands:next.profile.program.releaseCommands,publish:commit});
      else{if(this.controls!==null)this.controls.releaseForProfileChange(next.profile.program.releaseCommands);else for(const seat of previous.prepared.seats)seat.input.release(performance.now(),next.profile.program.releaseCommands);commit();}
    }catch(error){
      const failures:unknown[]=[error];
      if(!published){try{candidate?.identities.discard();}catch(cleanup){failures.push(cleanup);}try{if(candidate===null)await close();else await candidate.profile.scripts.close();}catch(cleanup){failures.push(cleanup);}try{await candidate?.images.settings.close();}catch(cleanup){failures.push(cleanup);}}
      if(published)try{await retire();}catch(cleanup){failures.push(cleanup);}
      if(failures.length>1)throw new AggregateError(failures,"Unified profile publication failed");throw error;
    }
    await retire();
  }

  private async publishPeerConfiguration(request: PeerDirectoryAdmission): Promise<void> {
    let mounted: MountedApplicationContent | null = null;
    let images: ReturnType<ApplicationImageSettings["prepareClientSettings"]> | null = null;
    let profile: PreparedProfileConfiguration | null = null;
    let published = false;
    try {
      request.assertCurrent();
      await this.prepareRetirement();
      request.assertCurrent();
      const previous = this.configuration, owner = this.clientCommands;
      if (owner === null) throw new Error("Peer configuration has no retained command owner");
      mounted = await openRemoteApplicationContent(request.options);
      request.assertCurrent();
      images = this.imageSettings.prepareClientSettings();
      const sources = new Map([...previous.seatSources].map(([id, registry]) => [id, { registry, transfer: registry.prepareCandidate(this.host.print) }]));
      const source = sources.get(this.seatId);
      if (source === undefined) throw new Error("Peer configuration lost its primary source registry");
      const socks = this.socksSettings.cvars.prepareCandidate(this.host.print);
      const remap = (registry: CvarRegistry): CvarRegistry => {
        if (registry === this.socksSettings.cvars) return published ? registry : socks.cvars;
        if (published) for (const source of sources.values()) if (registry === source.transfer.cvars) return source.registry;
        return registry;
      };
      const route = (base: CommandCvarRouting): CommandCvarRouting => {
        const routed = this.socksSettings.route(base);
        return { owner: (name, context) => remap(routed.owner(name, context)),
          visible: context => routed.visible(context).map(remap) };
      };
      const keyProfile = await this.keys.prepare({ ...request.options, ...(mounted.q3Product === null ? {} : { q3Product: mounted.q3Product }) }, mounted.catalog, owner.cvars);
      request.assertCurrent();
      const product = mounted.catalog.require(request.options.product);
      const settings = new ConfigStore(product.userContent?.root ?? userProductDirectory(request.options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
      const seat = previous.prepared.seats.find(candidate => candidate.id.equals(this.seatId));
      if (seat === undefined) throw new Error("Peer configuration lost its retained seat");
      profile = await prepareProfileConfiguration({ prepared: previous.prepared,
        clientSource: { inputState: "retained", cvars: source.transfer.cvars, archive: await settings.loadText("settings/client.cfg"),
          seatCvars: new Map([...sources].map(([id, source]) => [id, source.transfer.cvars])), route },
        seats: previous.seats.map(selected => {
          const prepared = previous.prepared.seats.find(candidate => candidate.id.equals(selected.id));
          if (prepared === undefined) throw new Error("Peer configuration lost a retained seat input");
          return { seat: selected, input: prepared.input };
        }), options: request.options,
        content: remoteConfigurationContent(request.options, mounted), settings, shared: images.settings.cvars,
        host: this.host, sourceArchive: [], defaultCapacity: 1, nextFrame: async () => { await setImmediate(); } });
      request.assertCurrent();
      const configuration: RemoteConfiguration = { prepared: previous.prepared, profile, seat: previous.seat,
        seats: previous.seats, seatSources: previous.seatSources, identities: previous.identities,
        settings, socks: this.socksSettings, images, downloadPermission: previous.downloadPermission, downloadPermissions: previous.downloadPermissions,
        source: owner.cvars, routing: route(profile.routing),
        prepareTransport: transport => this.socksSettings.connect(transport, published ? this.socksSettings.cvars : socks.cvars),
        validateSource() { for (const source of sources.values()) source.transfer.validatePublication(); socks.validatePublication(); },
        publishSource() { for (const source of sources.values()) source.transfer.publish(); socks.publish(); published = true; } };
      profile.program.validatePublication(); images.validatePublication(); configuration.validateSource();
      this.releaseSettings();
      const oldContent = this.remoteContent;
      let oldScripts = owner.scripts;
      const commit = (): void => {
        this.keyProfile = keyProfile;
        this.publishConfiguration(configuration);
        this.remoteContent = request.content; this.launchOptions = request.options;
        if (this.ownership.kind === "borrowed") {
          oldScripts = this.ownership.client.configuration.current.scripts;
          this.ownership.client.configuration.current = { scripts: configuration.profile.scripts, options: request.options };
        }
        request.phase = "published"; this.resetFrameElapsed = true;
      };
      if (this.ownership.kind === "borrowed") this.ownership.client.activateFrontend({ releaseCommands: profile.program.releaseCommands, publish: commit });
      else {
        if (this.controls !== null) this.controls.releaseForProfileChange(profile.program.releaseCommands);
        else for (const retained of previous.prepared.seats) retained.input.release(performance.now(), profile.program.releaseCommands);
        commit();
      }
      const retirementErrors: unknown[] = [];
      for (const retire of [() => {
        this.viewSettings.setFieldOfView(this.imageSettings.cvars.variableValue("fov"));
        this.releaseViewCvars = this.viewSettings.bindCvars(this.imageSettings.cvars);
      }, () => oldContent?.mounts.close(), () => oldScripts.close(), () => previous.images.settings.close()]) {
        try { await retire(); } catch (error) { retirementErrors.push(error); }
      }
      if (retirementErrors.length !== 0) throw new AggregateError(retirementErrors, "Peer configuration retirement failed");
    } catch (error) {
      request.suspension?.cancel(error instanceof Error ? error : new Error("Peer configuration failed", { cause: error }));
      const failures: unknown[] = [error];
      if (!published) {
        try { if (profile === null) await mounted?.close(); else await profile.scripts.close(); }
        catch (cleanup) { failures.push(cleanup); }
        try { await images?.settings.close(); } catch (cleanup) { failures.push(cleanup); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "Peer configuration preparation failed");
      throw error;
    }
  }

  private async advanceSource(operation: () => Promise<void>): Promise<boolean> {
    let pending = this.pendingAdvance;
    if (pending === null) {
      let signalBoundary = (): void => {};
      const boundary = new Promise<{ readonly kind: "boundary" }>(resolve => { signalBoundary = () => resolve({ kind: "boundary" }); });
      const completion = Promise.resolve().then(operation).then<RemoteAdvanceOutcome, RemoteAdvanceOutcome>(
        () => ({ kind: "complete" }), (error: unknown) => ({ kind: "failed", error }));
      pending = { completion, boundary, signalBoundary };
      this.pendingAdvance = pending;
    } else if (this.peerAdmission !== null) {
      if (this.peerAdmission.phase === "requested") return false;
      const admission = this.peerAdmission;
      this.peerAdmission = null;
      const current = pending;
      current.boundary = new Promise(resolve => { current.signalBoundary = () => resolve({ kind: "boundary" }); });
      admission.suspension?.resume();
    }
    const result = await Promise.race([pending.completion, pending.boundary]);
    if (result.kind === "boundary") return false;
    this.pendingAdvance = null;
    if (result.kind === "failed") throw result.error;
    return true;
  }

  private async presentLoadingFrame(): Promise<void> {
    if (this.ownership.kind !== "owned") return;
    this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
      commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "swap-buffers" }] });
    await this.capture?.drain();
  }

  private publishConfiguration(configuration = this.configuration): void {
    const owner = this.clientCommands;
    if (owner === null) throw new Error("Remote configuration has no command owner");
    const { prepared, profile, images } = configuration;
    profile.program.validatePublication(); images.validatePublication(); configuration.validateSource();
    configuration.publishSource(); images.publish(); profile.program.publish();
    const seats = [...prepared.seats.filter(seat => !profile.seats.some(next => next.id.equals(seat.id))), ...profile.seats.map(seat => {
      const cvars = configuration.seatSources.get(seat.id);
      if (cvars === undefined) throw new Error("Published remote configuration lost its source registry");
      return { ...seat, cvars };
    })];
    const order = (id: SeatId): number => { const index = configuration.seats.findIndex(seat => seat.id.equals(id)); return index < 0 ? 4 + id.index : index; };
    seats.sort((a, b) => order(a.id) - order(b.id));
    prepared.publishSeats(seats, configuration.seats.map(seat => seat.id));
    for(const seat of profile.seats)if(seat.profile!==null && configuration.identities.added.some(added=>added.seat.id.equals(seat.id)))seat.input.gamepad.tuning=structuredClone(seat.profile.gamepad);
    for (const choices of profile.bindingChoices) {
      const seat = prepared.seats.find(candidate => candidate.id.equals(choices.id));
      if (seat === undefined) throw new Error("Published remote configuration lost its seat");
      seat.selectedBindings = choices.selectedBindings; seat.allBindingsChosen = choices.allBindingsChosen;
      seat.overriddenKeys.clear(); for (const key of choices.overriddenKeys) seat.overriddenKeys.add(key);
    }
    prepared.adopt(configuration.routing, (name, args, source) => {
      let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
      return this.queueCommand(name, args, origin.kind === "local-seat" ? origin.seat : null, source);
    }, { source: configuration.source, movement: profile.movement, fallback: configuration.source, scripts: profile.scripts, read: profile.read });
    profile.forwardCommands(request => this.queueCommand(request.name, request.arguments_, request.seat, request.source));
    for (const request of profile.requests) this.queueCommand(request.name, request.arguments_, request.seat, request.source);
    profile.publishContinuation(prepared);
    if (this.ownership.kind === "borrowed") for (const identity of configuration.identities.selected) {
      const preparedSeat = prepared.seats.find(seat => seat.id.equals(identity.seat.id));
      if (preparedSeat === undefined) throw new Error("Remote identity publication lost its prepared input");
      const entry = { ...identity, prepared: preparedSeat };
      const index = this.ownership.client.locals.findIndex(local => local.seat === identity.seat);
      if (index < 0) this.ownership.client.locals.push(entry); else this.ownership.client.locals.splice(index,1,entry);
    }
    this.configuration = configuration;
    for(const peer of this.remoteSeats){const cvars=configuration.seatSources.get(peer.seat.id);if(cvars!==undefined)peer.channel.adoptCvars(cvars);}
    this.keys.publish(this.keyProfile, configuration.source);
    const mouse = prepared.seats.find(seat => seat.id.equals(this.seatId))?.mouse;
    if (mouse === undefined) throw new Error("Remote publication lost its mouse owner");
    this.clientCommandOwner = { ...owner, cvars: configuration.source, movement: profile.options.network.kind === "unified-client" ? profile.movement : configuration.source, fallback: configuration.source, routing: configuration.routing, scripts: profile.scripts, inputSettings: mouse };
    this.inputConfig = configuration.settings; this.clientConfig = configuration.settings;
    this.configurationPublished = true;
  }

  private async publishConnecting(client: ClientBootstrap): Promise<void> {
    const previous = client.source.current, owner = this.clientCommands;
    if (owner === null) throw new Error("Remote source has no command owner");
    await client.capture.beforeWorldChange();
    await previous?.prepareRetirement();
    client.session.resources.assertOpen();
    client.prepared.validateOwners(this.configuration.profile);
    this.configuration.profile.program.validatePublication(); this.configuration.images.validatePublication();
    const failures: unknown[] = [];
    let retired: ReturnType<EngineSession["detachWorld"]> | null = null;
    let oldConnection: SessionConnection | null = null;
    const oldSeatConnections: SessionConnection[] = [];
    let retiredConfiguration: ConsoleScriptFiles | null = null;
    this.publicationStarted = true;
    try {
      previous?.releaseSettings();
      client.activateFrontend({ releaseCommands: this.configuration.profile.program.releaseCommands, publish: () => this.publishConfiguration() });
      retired = client.session.detachWorld();
      const replacement = this.remote.client.replaceConnection(this.source.kind === "live" ? "remote" : "demo");
      this.sourceConnection = replacement.connection; oldConnection = replacement.retired;
      for (const peer of this.remoteSeats) { const previous = peer.channel.publishConnection(); if (previous !== null) oldSeatConnections.push(previous); }
      client.source.current = this; client.sourceProfile.current = null;
      retiredConfiguration = client.configuration.current.scripts;
      client.configuration.current = { scripts: owner.scripts, options: this.options };
      this.viewSettings.setFieldOfView(this.imageSettings.cvars.variableValue("fov"));
      this.releaseViewCvars = this.viewSettings.bindCvars(this.imageSettings.cvars);
    } catch (error) { failures.push(error); }
    finally {
      try { await previous?.retire(); } catch (error) { failures.push(error); }
      try { retired?.close(); } catch (error) { failures.push(error); }
      try { oldConnection?.close(); } catch (error) { failures.push(error); }
      for (const connection of oldSeatConnections) try { connection.close(); } catch (error) { failures.push(error); }
      try { await retiredConfiguration?.close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new ClientSourcePublicationError(failures);
    this.activateSourceCommands();
  }

  get captureMap(): string | null { return this.loadedContent?.recipe.map.geometry.requestedPath ?? null; }

  async prepareVideoRestart(): Promise<PreparedVideoPresentation | null> {
    const input=this.controls;
    if(input===null)return null;
    const presentations=[...(this.presentation===null?[]:[this.presentation]),...this.remoteSeats.flatMap(peer=>peer === this.primaryPeer || peer.view===null?[]:[peer.view.presentation])];
    const guests=presentations.flatMap(presentation=>{
      const client=presentation.q3Client;
      if(client===null || client.options.kind!=="qvm")return [];
      return [{client,viewport:(window:NativeRenderer["window"])=>{
        const index=input.locals.findIndex(local=>local.player.seat===presentation.local.player.seat),size=window.drawableSize;
        return seatViewport(index,input.locals.length,size.width,size.height);
      },publish:(candidate:ApplicationQ3Client)=>{presentation.replaceQ3Client(candidate);this.clientInputs=this.clientInputs.filter(event=>event.client!==client);}}];
    });
    if(guests.length===0)return null;
    return prepareVideoGuests(input,this.renderer,guests,()=>{
      if(this.closed || this.closing || this.controls!==input || presentations.some(presentation=>presentation.local.player.seat.presentation!==presentation))
        throw new Error("Remote guest changed during video preparation");
    });
  }

  async prepareRetirement(): Promise<void> {
    await this.capture?.beforeWorldChange();
    await this.saveSourceSettings();
  }
  releaseSettings(): void { this.releaseViewCvars?.(); this.releaseViewCvars = null; }
  retire(): Promise<void> { return this.close(); }

  private async saveSourceSettings(): Promise<void> {
    if (this.configurationPublished) await this.keys.save();
    await this.controls?.saveSettings();
    if (this.frontend !== null) {
      await this.viewSettings.save(this.inputConfig);
      await saveAudioSettings(this.inputConfig, this.frontend.audio);
    }
    if (this.clientCommands !== null) await this.clientConfig?.saveCvars("settings/client.cfg", this.clientCommands.cvars, this.socksSettings.cvars.archiveCommands());
    if(this.loadedContent!==null)for(const [id,cvars] of this.configuration.seatSources)await saveCvarArchive(this.inputConfig,["client",this.loadedContent.recipe.engineBehavior.content,this.loadedContent.recipe.engineBehavior.provider,String(id.index)],cvars);
  }
  get content(): LoadedApplicationContent {
    if (this.loadedContent === null) throw new Error("Remote server has not supplied a world");
    return this.loadedContent;
  }
  private get mounts() { return this.remoteContent?.mounts ?? this.loadedContent?.mounts ?? this.mountedContent.mounts; }
  get frameCount(): number { return this.frames; }
  get timeMilliseconds(): number { return this.elapsed; }
  get window(): NativeRenderer["window"] { return this.renderer.window; }
  get networkAddress(): ApplicationNetworkAddress { if (this.source.kind !== "live") throw new Error("Recorded source has no network address"); return this.source.transport.address; }
  get networkPhase(): ApplicationNetworkPhase { return this.source.kind === "live" ? this.source.network.phase : this.source.playback.phase; }
  readClientResource(path: string): Promise<Uint8Array | undefined> { return this.mounts.open(path).then(resource => resource?.bytes); }
  get localPlayers(): readonly LocalPlayer[] { return this.controls?.locals.map(local => local.player) ?? []; }
  get presentationEvents(): readonly SimulationPresentationEvent[] { return this.sourceEvents; }
  get unhandledPresentationEffects(): readonly UnhandledApplicationEffect[] { return this.unhandledEffects; }

  private print(text: string, source?: CommandContext): void {
    if (this.controls === null) this.host.print(text);
    else this.controls.print(text, source ?? this.clientCommands?.commands.executionContext);
  }

  private initializeQ3Browser(): void {
    if (this.family !== "q3") return;
    const input = this.clientCommands;
    if (input === null) throw new Error("Q3 browser requires the client command owner");
    this.q3Browser = new Q3BrowserView({ browser: this.serverBrowser, now: () => performance.now(),
      maxPing: () => input.cvars.variableValue("cl_maxPing"), statusResendTime: () => input.cvars.variableValue("cl_serverStatusResendTime"),
      print: text => this.print(text) });
    for (const entry of [
      { name: "localservers", summary: "Discover Quake III servers on the local network.", usage: "localservers", examples: ["localservers"] },
      { name: "globalservers", summary: "Request Quake III servers from the configured master.", usage: "globalservers <master# 0-1> <protocol> [keywords]", examples: ["globalservers 0 68"] },
      { name: "ping", summary: "Query a Quake III server's latency and information.", usage: "ping <server>", examples: ["ping localhost:27960"] },
      { name: "serverstatus", summary: "Print a Quake III server's settings and players.", usage: "serverstatus [server]", examples: ["serverstatus", "serverstatus localhost:27960"] },
    ]) {
      this.sourceHandlers.set(entry.name, invocation => this.queueCommand(entry.name, invocation.args, null));
      this.sourceDocumentation.set(entry.name, entry);
    }
  }

  private async browserCommand(name: string, args: readonly string[], print: (text: string) => void): Promise<boolean> {
    const browser = this.q3Browser;
    if (browser === null) return false;
    switch (name) {
      case "localservers": print("Scanning for servers on the local network...\n"); browser.localServers(); return true;
      case "globalservers": {
        if (args.length < 2) { print("usage: globalservers <master# 0-1> <protocol> [keywords]\n"); return true; }
        const cvars = this.clientCommands?.cvars;
        if (cvars === undefined) throw new Error("Q3 browser requires client cvars");
        const keywords = args.slice(2);
        if (cvars.variableValue("fs_restrict") !== 0) keywords.push("demo");
        print("Requesting servers from the master...\n");
        await browser.globalServers(nativeAtoi(args[0] ?? "") === 1 ? 1 : 2, cvars.variableString("sv_master1"), nativeAtoi(args[1] ?? ""), keywords);
        return true;
      }
      case "ping":
        if (args.length !== 1) print("usage: ping [server]\n");
        else await browser.ping(args[0] ?? "");
        return true;
      case "serverstatus": {
        const server = args.length === 1 ? args[0] : this.networkPhase === "active" && this.options.network.kind === "q3-client" ? this.options.network.remote : undefined;
        if (server === undefined) print("Not connected to a server.\nUsage: serverstatus [server]\n");
        else await browser.serverStatusCommand(server);
        return true;
      }
      default: return false;
    }
  }

  private async loadFrontend(content: LoadedApplicationContent): Promise<RemoteWorldFrontend> {
    const assets = new ApplicationAssets(content, this.renderer.owner, undefined, { imageRegistry: this.renderer.images, imagePolicy: this.imageSettings.policy, modelPolicy: this.imageSettings.modelPolicy });
    let art: NativeUiArt | null = null, audio: ApplicationAudio | null = null, effects: ApplicationEffects | null = null;
    try {
      await assets.loadWorld();
      const font = await assets.loadConsoleFont(), source = font.classic.picture.image.source;
      if (source.kind !== "resource") throw new Error("Remote console font has no mounted resource identity");
      art = await loadNativeUiArt(source.resource.id, assets.images, loadMenuArtImage);
      audio = new ApplicationAudio(content, () => this.elapsed, this.options.seed, this.options.characterModel, text => { this.print(text); return undefined; }, { ...await loadAudioSettings(this.inputConfig), musicControls: this.musicControls, ...(this.ownership.kind === "borrowed" ? { deferOutput: true } : {}) });
      const scene: SceneQueries = {
        trace: query => this.remote.scene.trace(query), pointContents: query => this.remote.scene.pointContents(query),
        boxLeaves: (bounds, limit) => this.remote.scene.boxLeaves(bounds, limit),
        areasConnected: (first, second) => this.remote.scene.areasConnected(first, second),
        clusterVisible: (from, to, kind) => this.remote.scene.clusterVisible(from, to, kind),
      };
      await audio.prepareEnvironment(scene);
      effects = new ApplicationEffects(assets, scene, actor => this.remote.isPlayer(actor), this.options.seed);
      for (const failure of await effects.preloadTransientResources()) this.print(`Optional effect preload skipped: ${failure.content}/${failure.path}: ${failure.error}\n`);
      return { assets, font, art, audio, effects, scene };
    } catch (error) { effects?.close(); audio?.close(); art?.close(); assets.close();
      try { this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [] }); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Remote frontend preparation and image retirement failed"); }
      throw error; }
  }

  private releaseFrontend(frontend: RemoteWorldFrontend): void {
    frontend.audio.close(); frontend.effects.close(); frontend.art.close(); frontend.assets.close();
    if (this.closed) return;
    this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames,
      commands: frontend.assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
  }

  private async refreshImages(): Promise<void> {
    const frontend = this.frontend;
    if (frontend === null) return;
    await this.imageSettings.refresh(frontend.assets, [...(this.presentation === null ? [] : [this.presentation]),...this.remoteSeats.flatMap(peer=>peer === this.primaryPeer || peer.view===null?[]:[peer.view.presentation])], null, this.renderer);
    frontend.font = await frontend.assets.loadConsoleFont();
    for(const peer of this.remoteSeats)if(peer.view!==null && peer.view.assets!==frontend.assets)await this.imageSettings.refresh(peer.view.assets,[peer.view.presentation],null,this.renderer);
  }

  private async loadQ2ServerWorld(state: Q2ApplicationGameState): Promise<LoadedApplicationContent> {
    if (!(this.remote instanceof Q2RemotePresentation)) throw new Error("Q2 world requires its native presentation owner");
    const layout = q2ApplicationLayout(this.remote.protocol);
    const map = state.configStrings.get(layout.models + 1);
    if (map === undefined) throw new Error("Q2 server supplied no world model");
    const names = (first: number, maximum: number): string[] => Array.from({ length: maximum - 1 }, (_, index) => state.configStrings.get(first + index + 1) ?? '').filter(Boolean);
    return this.loadServerWorld({ map, models: names(layout.models, layout.maxModels), sounds: names(layout.sounds, layout.maxSounds), images: names(layout.images, layout.maxImages) }, undefined, true);
  }

  private async selectRemoteContent(selection: RemoteContentMounts["selection"], assertPeerCurrent: () => void): Promise<RemoteContentMounts> {
    const generation = ++this.remoteContentGeneration;
    this.worldLoadGeneration++;
    const roots = this.options;
    const assertCurrent = (): void => {
      assertPeerCurrent();
      if (this.closed || this.closing || generation !== this.remoteContentGeneration) throw new Error("Remote directory selection was cancelled");
    };
    const prepared = await openRemoteContent(roots, selection, assertCurrent, generation);
    try { assertCurrent(); }
    catch (error) { prepared.mounts.close(); throw error; }
    const options = { ...roots, product: prepared.product.expectation.id, remoteContent: prepared.selection,
      ...(prepared.q3Product === null ? {} : { q3Product: prepared.q3Product }) };
    if (options.product !== roots.product) {
      if (this.primaryPeer !== null) {
        await this.publishPeerConfiguration({ content: prepared, options, assertCurrent, phase: "requested", suspension: null });
        assertCurrent();
        return prepared;
      }
      if (this.peerAdmission !== null || this.pendingAdvance === null) { prepared.mounts.close(); throw new Error("Peer directory admission has no active source frame"); }
      let resume = (): void => {}, cancel = (_error: Error): void => {};
      const admitted = new Promise<void>((resolve, reject) => { resume = resolve; cancel = reject; });
      const request: PeerDirectoryAdmission = { content: prepared, options, assertCurrent, phase: "requested", suspension: { resume, cancel } };
      this.peerAdmission = request; this.pendingAdvance.signalBoundary();
      try { await admitted; assertCurrent(); }
      catch (error) { if (this.remoteContent !== prepared) prepared.mounts.close(); throw error; }
    } else {
      const previous = this.remoteContent;
      this.remoteContent = prepared; this.launchOptions = options;
      previous?.mounts.close();
    }
    return prepared;
  }

  private refreshRemoteContent(assertCurrent: () => void): Promise<RemoteContentMounts> {
    const selection = this.options.remoteContent;
    if (selection === undefined) throw new Error("Remote package refresh has no selected directory");
    return this.selectRemoteContent(selection, assertCurrent);
  }

  private async prepareQwDownloads(data: QwServerData): Promise<void> {
    if (this.source.kind === "recorded") { await this.selectRemoteContent(remoteContentSelection("q1-quakeworld", data.gameDirectory), () => {}); return; }
    this.qwDownloads?.close(); this.qwDownloads = null;
    const generation = this.remoteContentGeneration + 1;
    const prepared = await this.selectRemoteContent(remoteContentSelection("q1-quakeworld", data.gameDirectory), () => {});
    const current = (): boolean => !this.closed && !this.closing && generation === this.remoteContentGeneration;
    const assertCurrent = (): void => { if (!current()) throw new Error("QW directory selection was cancelled"); };
    assertCurrent();
    const gameRoot = prepared.writeRoot, skinRoot = prepared.baseWriteRoot;
    this.qwDownloads = new QwDownloadReceiver({ gameRoot, skinRoot,
      exists: async (path, category) => {
        if (!current()) return false;
        const owner = this.mounts;
        try { return existsSync(join(category === "skin" ? skinRoot : gameRoot, path)) || await owner.resolve(path) !== null; }
        catch (error) { if (!current()) return false; throw error; }
      },
      sendCommand: text => { assertCurrent(); this.sendCommand(text); }, print: text => this.print(text), noskins: () => this.clientCommands?.cvars.variableValue("noskins") ?? 0,
      demoRecording: () => this.ownership.kind === "borrowed" && this.ownership.client.recording.path !== null, demoPlayback: () => this.source.kind === "recorded" });
  }

  private async prepareQ3Downloads(connection: Q3ClientConnection): Promise<boolean> {
    const generation = connection.generation;
    const assertCurrent = (): void => {
      if (this.closed || this.closing || !(this.network instanceof Q3ClientNetwork) || this.network.native !== connection || generation !== connection.generation)
        throw new Error("Q3 package download belongs to a retired connection");
    };
    assertCurrent();
    this.q3Downloads?.close(); this.q3Downloads = null;
    const selected = remoteContentSelection("q3-baseq3", q3InfoValue(connection.gameState.get(1) ?? "", "fs_game") || "baseq3");
    const seed = await this.selectRemoteContent(selected, assertCurrent);
    const root = dirname(seed.writeRoot), packages = await Q3ApplicationPackages.open(seed, connection.checksumFeed);
    assertCurrent();
    if (this.remoteContent !== seed) throw new Error("Q3 package content selection was replaced");
    const info = connection.gameState.get(1) ?? "", referenced = new ServerPakSet();
    referenced.setChecksums(q3InfoValue(info, "sv_referencedPaks"));
    referenced.setNames(q3InfoValue(info, "sv_referencedPakNames"));
    const downloads = new Q3ApplicationClientDownloads(root, { assertCurrent: () => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 package download was replaced"); },
      permission: request => this.downloadPermission?.(request) === true,
      reliable: text => connection.reliable.add(text), sendPacket: () => { assertCurrent(); if (this.network instanceof Q3ClientNetwork) this.network.sendPacket(); },
      progress: (name, count, size) => { if (count === 0 || count === size) this.print(`Downloading ${name}: ${count}/${size} bytes\n`); },
      reloadPackages: async () => {
        await this.refreshRemoteContent(() => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 package refresh was cancelled"); });
      } }, seed);
    this.q3Downloads = downloads;
    const loadedChecksums = packages.packs.map(pack => pack.pack.checksum), exists = (path: string): boolean => existsSync(join(root, path));
    if (this.downloadPermission?.({ transport: "native", category: "package" }) !== true) {
      const missing = compareQ3Packages(referenced.snapshot(), loadedChecksums, path => exists(q3DownloadPath(path, seed)), false);
      if (missing.length !== 0) this.print(`Missing server packages: ${missing}\nDownloads are disabled. Enable cl_allowDownload to download server packages.\n`);
      return false;
    }
    const pending = downloads.begin(referenced.snapshot(), loadedChecksums, exists);
    if (pending) { await mkdir(root, { recursive: true }); assertCurrent(); if (this.q3Downloads !== downloads) throw new Error("Q3 download setup was cancelled"); }
    return pending;
  }

  private async loadQ3ServerWorld(world: Q1RemoteWorld, connection: Q3ClientConnection): Promise<LoadedApplicationContent> {
    if (this.source.kind === "recorded") await this.selectRemoteContent(remoteContentSelection("q3-baseq3", q3InfoValue(connection.gameState.get(1) ?? "", "fs_game") || "baseq3"), () => { if (this.closed || this.closing) throw new Error("Recorded Q3 source was retired"); });
    const generation = connection.generation, contentGeneration = this.remoteContentGeneration;
    const seed = this.remoteContent;
    if (seed === null) throw new Error("Q3 world loading requires its selected content owner");
    const assertCurrent = (): void => {
      if (this.closed || this.closing || generation !== connection.generation || contentGeneration !== this.remoteContentGeneration)
        throw new Error("Remote Q3 content loading was cancelled");
    };
    assertCurrent();
    const prepared = await Q3ClientContent.open({ ...this.options, map: mapResourcePath(world.map) }, connection.gameState.get(1) ?? "", connection.checksumFeed, seed, this.source.kind === "recorded" ? { kind: "recorded", family: this.family } : undefined);
    try {
      assertCurrent();
      const content = await this.loadServerWorld(world, prepared.content);
      assertCurrent();
      this.q3Content = prepared;
      return content;
    } catch (error) { await prepared.close(); throw error; }
  }

  private async loadServerWorld(world: Q1RemoteWorld & { readonly images?: readonly string[] }, preparedContent?: LoadedApplicationContent, refreshContent = false): Promise<LoadedApplicationContent> {
    const generation = ++this.worldLoadGeneration;
    const options = { ...this.options, map: mapResourcePath(world.map) }, pending = this.remoteContent;
    const assertCurrent = (): void => { if (this.closing || this.closed || generation !== this.worldLoadGeneration) throw new Error("Remote world loading was cancelled"); };
    assertCurrent();
    await this.capture?.beforeWorldChange();
    assertCurrent();
    await this.retireRemoteViews();
    assertCurrent();
    this.controls?.stopHaptics();
    const path = world.map;
    const map = mapResourcePath(path);
    if (this.presentation !== null) this.uiPreferences = { ...this.presentation.ui.preferences.values };
    const differentMap = map !== this.loadedContent?.recipe.map.geometry.requestedPath;
    const replaceContent = differentMap || preparedContent !== undefined || refreshContent || pending !== null;
    if (replaceContent || this.presentation !== null || this.remote.player !== null) {
      const content = preparedContent ?? (replaceContent ? await loadApplicationContent(options, undefined, undefined, this.source.kind === "recorded" ? pending?.catalog : undefined, this.source.kind === "recorded" ? { kind: "recorded", family: this.family } : undefined) : this.content);
      const previous = this.frontend, previousOutput = previous?.audio.selectedOutput ?? null;
      let frontend: RemoteWorldFrontend;
      let outputDetached = false;
      try {
        assertCurrent();
        if (previous !== null && this.ownership.kind === "owned") {
          await saveAudioSettings(this.inputConfig, previous.audio);
          assertCurrent();
          previous.audio.detachOutput(); outputDetached = true;
        }
        frontend = await this.loadFrontend(content);
        try { assertCurrent(); } catch (error) { this.releaseFrontend(frontend); throw error; }
      }
      catch (error) {
        if (replaceContent) await content.close();
        if (outputDetached && previous !== null && this.frontend === previous && !this.closing && !this.closed && generation === this.worldLoadGeneration) {
          try { previous.audio.selectOutput(previousOutput); }
          catch (restoreError) { throw new AggregateError([error, restoreError], "Remote audio preparation and output restoration failed"); }
        }
        throw error;
      }
      const oldContent = this.loadedContent;
      this.clearSourcePresentation();
      if (previous !== null) {
        frontend.audio.effectsVolume = previous.audio.effectsVolume;
        frontend.audio.musicVolume = previous.audio.musicVolume;
        if (this.ownership.kind === "borrowed") this.retiredFrontends.push({ frontend: previous, content: replaceContent ? oldContent : null });
        else this.releaseFrontend(previous);
      }
      this.frontend = frontend; this.loadedContent = content; this.launchOptions = options;
      if (replaceContent && (previous === null || this.ownership.kind === "owned")) await oldContent?.close();
    } else {
      this.clearSourcePresentation();
    }
    const frontend = this.frontend;
    if (frontend === null) throw new Error("Remote frontend has not loaded");
    const provider = await frontend.assets.provider(this.content.recipe.map.entities.content);
    assertCurrent();
    for (const model of world.models) {
      if (model === path || model.startsWith("#")) continue;
      const asset = await frontend.assets.model(this.content.recipe.map.entities.content, model);
      assertCurrent();
      this.remote.registerResource(this.content.recipe.map.entities.content, model, asset.resource);
    }
    for (const sound of world.sounds) {
      if (sound.startsWith("*")) continue;
      const path = sound.startsWith("#") ? sound.slice(1) : this.remote instanceof Q3RemotePresentation ? sound : `sound/${sound}`;
      const resource = await provider.mounts.resolve(path);
      assertCurrent();
      if (resource === null) {
        if (this.remote instanceof QwRemotePresentation) { this.print(`QW sound is unavailable: ${path}\n`); continue; }
        throw new Error(`Server sound is absent from mounted content: ${path}`);
      }
      this.remote.registerResource(this.content.recipe.map.entities.content, path, resource);
    }
    for (const image of world.images ?? []) {
      const path = image.startsWith("/") || image.startsWith("\\") ? image.slice(1) : `pics/${image}.pcx`;
      if (await provider.textures.load(path, { mipmap: false, wrap: "clamp" }) === null) throw new Error(`Server image is absent from mounted content: ${path}`);
    }
    assertCurrent();
    this.sourceEvents = [];
    this.print(`Loaded remote world ${map}.\n`);
    if (this.remoteContent === pending) { pending?.mounts.close(); this.remoteContent = null; }
    return this.content;
  }

  private async bindSeat(connection?: Q3ClientConnection): Promise<void> {
    if (this.primaryPeer !== null) { await this.bindRemoteSeat(this.primaryPeer, connection); return; }
    const generation = this.worldLoadGeneration;
    let published = false;
    const assertCurrent = (): void => { if ((!published && this.closing) || this.closed || generation !== this.worldLoadGeneration) throw new Error("Remote seat loading was cancelled"); };
    const remote = this.remote, frontend = this.frontend;
    const player = connection !== undefined && remote instanceof Q3RemotePresentation ? remote.admittedPlayer : remote.player;
    if (connection === undefined && this.q3InitialViewPending && player !== null && remote.output !== null && this.controls !== null) {
      const local = this.controls.locals.find(local => local.player.seat.id.equals(this.seatId));
      if (local === undefined) throw new Error("Q3 first snapshot lost its seat");
      local.input.release(performance.now());
      local.player.actor = player.actor;
      local.builder.setViewAngles(remote.playerView(player.actor).angles);
      this.q3InitialViewPending = false;
    }
    if (player === null || (connection === undefined && remote.output === null) || frontend === null || this.presentation !== null) return;
    const owner = this.clientCommands;
    if (owner === null || owner.inputSettings === undefined) throw new Error("Remote input has no retained command and mouse owner");
    const previous = this.controls, previousCapture = this.capture;
    let retiredScripts: ConsoleScriptFiles | null = null;
    let candidateScripts: ConsoleScriptFiles | null = null;
    let retired = false;
    const retirePrevious = async (): Promise<void> => {
      if (retired) return;
      retired = true;
      const failures: unknown[] = [];
      try { if (this.ownership.kind === "owned") await previousCapture?.close(); } catch (error) { failures.push(error); }
      try { previous?.close(); } catch (error) { failures.push(error); }
      try { await retiredScripts?.close(); } catch (error) { failures.push(error); }
      if (failures.length !== 0) throw new AggregateError(failures, "Previous remote input retirement failed");
    };
    const previousLocal = previous?.locals[0];
    if (previous !== null && previousLocal === undefined) throw new Error("Remote input lost its local seat");
    const retainedSeat = this.configuration.seat;
    const seat = previousLocal?.player.seat ?? retainedSeat;
    const context: CommandContext = { session: this.session.session, origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } };
    let input: ApplicationInput | null = null, ui: ApplicationSeatUi | null = null, q3: ApplicationQ3Client | null = null;
    let candidateCinematic: RemoteCinematic | null = null;
    try {
      const mounts = this.content.mounts, releaseMounts = this.content.retainMainMounts();
      const scripts = new ConsoleScriptFiles({ ...legacyConfigurationOptions(this.options, this.content.catalog, this.content.recipe.engineBehavior.content),
        consoleRoot: consoleConfigRoot(this.options.userContentRoot), settings: this.inputConfig,
        mountedScript: sourceScriptReader(this.content.catalog, mounts, this.content.recipe.engineBehavior.content),
        mountedResource: name => mounts.open(name),
      mountedFiles: (directory, extension) => mounts.listFiles(directory, extension),
      mounted: name => mounts.open(name).then(resource => resource?.bytes) }, async () => { releaseMounts(); });
      candidateScripts = scripts;
      const q3Scene = remote instanceof Q3RemotePresentation ? { remote, queries: remote.scene } : null;
      const image = this.imageSettings.prepareClientSettings();
      const live = new Set([...owner.routing.visible(context), owner.cvars, owner.movement ?? owner.cvars, owner.fallback ?? owner.cvars, owner.inputSettings.cvars, this.imageSettings.cvars]);
      const transfers = new Map<CvarRegistry, ReturnType<CvarRegistry["prepareCandidate"]>>();
      for (const registry of live) if (registry !== this.imageSettings.cvars) transfers.set(registry, registry.prepareCandidate(text => this.host.print(text)));
      const staged = (registry: CvarRegistry): CvarRegistry => {
        if (registry === this.imageSettings.cvars) return image.settings.cvars;
        const transfer = transfers.get(registry);
        if (transfer === undefined) throw new Error("Remote candidate reached an unstaged cvar owner");
        return transfer.cvars;
      };
      const routing: import("../../core/commands/index.ts").CommandCvarRouting = {
        owner: (name, source) => { const registry = owner.routing.owner(name, source); return published ? registry : staged(registry); },
        visible: source => owner.routing.visible(source).map(registry => published ? registry : staged(registry)),
      };
      const actions: RemoteCommand[] = [];
      let quit = false;
      const execute = (name: string, args: readonly string[], id: SeatId | null, source?: CommandContext): undefined => {
        if (published) return this.queueCommand(name, args, id, source);
        actions.push({ name, args: [...args], seat: id, ...(source === undefined ? {} : { source }) }); return undefined;
      };
      const requestQuit = (): undefined => { if (published) return this.requestQuit(); quit = true; return undefined; };
      const borrowedClient = this.ownership.kind === "borrowed" ? this.ownership.client : null;
      const prepareInput = borrowedClient === null ? ApplicationInput.prepare
        : (...args: Parameters<typeof ApplicationInput.prepare>) => ApplicationInput.prepareForClient(borrowedClient, ...args);
      input = await prepareInput(live, this.window, [{ seat, actor: player.actor }], this.options, movementDialect(this.options, remote instanceof UnifiedRemotePresentation ? this.content.recipe : undefined), remote,
        { ...(this.host.llm === undefined ? {} : { llm: this.host.llm }), quit: requestQuit, execute, print: text => this.host.print(text), sharedCvars: image.settings.cvars, scripts, startupReader: selected => this.startupReader(selected),
          localPlayerCapacity:()=>this.source.kind === "live" ? 4 : 1, canRemoveLocalPlayer:()=>this.source.kind === "live",
          clientCapturesInput: id => { if (this.cinematic !== null) return true; const client = id.equals(this.seatId) ? this.presentation?.q3Client : this.remoteSeats.find(peer=>!peer.closed && peer.seat.id.equals(id))?.view?.presentation.q3Client; return client !== null && client !== undefined && client.options.local.player.seat.id.equals(id) && client.capturesInput; },
          clientInput: event => {
            if (published && this.cinematic !== null) return this.cinematic.movie.input(event);
            const client = event.seat.equals(this.seatId) ? this.presentation?.q3Client : this.remoteSeats.find(peer=>!peer.closed && peer.seat.id.equals(event.seat))?.view?.presentation.q3Client;
            if (!published || client === null || client === undefined || !client.options.local.player.seat.id.equals(event.seat) || !client.capturesInput) return false;
            this.clientInputs.push({ generation: this.worldLoadGeneration, client, event }); return true;
          } }, () => performance.now(), this.inputConfig,
        { ...owner, scripts, cvars: staged(owner.cvars), movement: staged(owner.movement ?? owner.cvars), fallback: staged(owner.fallback ?? owner.cvars), inputSettings: new MouseSettings(staged(owner.inputSettings.cvars)), routing }, previous ?? undefined, this.configuration.prepared);
      assertCurrent();
      const controls = input, local = controls.locals[0];
      if (local === undefined) throw new Error("Remote input has no local seat");
      if (local.builder.dialect === "q3" && connection !== undefined) {
        const command = connection.commands.read(connection.commands.currentNumber);
        local.builder.setViewAngles(command === null ? { x: 0, y: 0, z: 0 } : { x: (command.angles[0] << 16 >> 16) * (360 / 65536),
          y: (command.angles[1] << 16 >> 16) * (360 / 65536), z: (command.angles[2] << 16 >> 16) * (360 / 65536) });
      }
      const typography = await frontend.assets.loadMenuTypography();
      assertCurrent();
      ui = new ApplicationSeatUi(local, frontend.art, controls, operation => this.renderer.mutateWindow(operation), remote, frontend.font, frontend.audio,
        requestQuit, (name, args) => execute(name, args, seat.id), typography, undefined, undefined, undefined, this.viewSettings.binding(), this.host.llm);
      if (this.uiPreferences !== null) ui.preferences.values = this.uiPreferences;
      if (q3Scene !== null) {
        const remote = q3Scene.remote;
        if (connection === undefined) throw new Error("Q3 guest seat must initialize with its gamestate");
        if (this.q3Browser === null) throw new Error("Q3 guest seat requires its application browser");
        if (this.keyProfile === null) throw new Error("Q3 remote guest requires its published key profile");
        q3 = await ApplicationQ3Client.create({ keys: this.keyProfile, saveFontData: () => (controls.sharedCvars?.variableValue("r_saveFontData") ?? 0) !== 0, kind: "qvm", assertCurrent, source: remote.cgameSource, connection,
          commandBuffer: controls.guestCommands, guestCvars: controls.guestCvars(seat.id), guestInput: controls.guestInput(seat.id), cvars: controls.cvars,
          systemCinematics: { open: async request => {
            const movie = await this.prepareCinematic(request, () => {
              const owner = this.clientCommands;
              if (owner === null) return;
              const next = owner.cvars.variableString("nextmap"); owner.cvars.set("nextmap", "", true);
              if (next !== "") owner.commands.append(`${next}\n`, context);
            }, frontend.audio.engine);
            if (published) { this.stopCinematic(); this.cinematic = movie; }
            else { if (candidateCinematic !== null) this.closeCinematic(candidateCinematic); candidateCinematic = movie; }
            return { get status() { return movie.movie.status; }, skip: () => movie.movie.skip(), stop: () => {
              if (this.cinematic === movie) this.stopCinematic();
              else if (candidateCinematic === movie) { candidateCinematic = null; this.closeCinematic(movie); }
            } };
          } },
          renderer: this.renderer, browser: this.q3Browser, commandRegistration: controls.clientCommandRegistration(seat.id),
          clientState: () => ({ phase: this.networkPhase === "active" ? 8 : this.networkPhase === "loading" ? 6 : 5,
            connectPacketCount: this.network instanceof Q3ClientNetwork ? this.network.connectPacketCount : 0, clientNumber: connection.clientNumber,
            serverName: this.options.network.kind === "q3-client" ? this.options.network.remote : "", message: "" }),
          assets: frontend.assets, queries: q3Scene.queries, local, audio: frontend.audio,
          viewport: () => this.seatViewport(seat.id), get splitScreen() { return controls.locals.length>1; }, now: () => performance.now(),
          commands: { reliable: text => controls.enqueueClientReliable(text, context, command => this.sendCommand(command)),
            console: text => controls.enqueueClientCommand(text, { session: context.session, origin: { kind: "script", name: "q3-cgame", caller: context.origin } }),
            print: text => controls.print(text, context) } });
        assertCurrent();
      }
      const pure = connection === undefined ? null : this.q3Content?.referencedPureCommand(nativeAtoi(q3InfoValue(connection.gameState.get(1) ?? "", "sv_serverid")));
      if (connection !== undefined && pure === undefined) throw new Error("Q3 guest initialization has no content owner");
      const characters = remote instanceof UnifiedRemotePresentation && this.options.character === "q3"
        ? await loadQ3Character(await this.content.forContent(this.content.recipe.character.appearance.content),
          {model:this.options.characterModel,skin:"default",headModel:"",headSkin:"default",team:null,teamName:""}) : null;
      assertCurrent();
      const presentation = new WorldSeatPresentation(local, frontend.assets, this.renderer, remote, 1, frontend.font, characters, ui, frontend.effects, q3, null,
        () => this.imageSettings.cvars.variableValue("gl_debug_distfrac"), () => this.viewSettings.fieldOfView, null, () => this.imageSettings.cvars.variableValue("con_scale"));
      const capture = this.ownership.kind === "borrowed" ? this.ownership.client.capture
        : new ApplicationCapture(inputCaptureServices(controls, applicationCaptureRoot(this.options.userContentRoot), () => this.captureMap ?? "menu", text => this.print(text)), this.renderer);
      assertCurrent();
      presentation.publishLayout(0,controls.locals.length);
      seat.validatePresentation(presentation);
      controls.validateStartupAdoption(); controls.validateCandidateCommands(); image.validatePublication();
      for (const transfer of transfers.values()) transfer.validatePublication();
      const borrowed = this.ownership.kind === "borrowed" ? this.ownership.client : null;
      const publishAudio = borrowed?.output.current.prepareOutputTransfer(frontend.audio.engine);
      if (previous !== null && borrowed === null) controls.releaseIntoCandidate(previous, true);
      // From this point a failure retires the published source instead of discarding a candidate.
      published = true;
      this.controls = controls; this.presentation = presentation; this.capture = capture; this.primaryViewGeneration=generation;
      {
        if (borrowed === null) controls.publishCandidateCommands();
        this.releaseViewCvars?.(); this.releaseViewCvars = null;
        q3?.adoptCvars(owner.cvars);
        for (const [registry, transfer] of transfers) { transfer.publish(); controls.adoptCvarOwner(transfer.cvars, registry); }
        image.publish(); controls.publishSharedCvars(this.imageSettings.cvars);
        controls.adoptMouseOwner(seat.id, owner.inputSettings);
        this.viewSettings.setFieldOfView(this.imageSettings.cvars.variableValue("fov"));
        this.releaseViewCvars = this.viewSettings.bindCvars(this.imageSettings.cvars);
        if (q3 !== null && this.viewSettings.override !== null) q3.cvars.set("cg_fov", String(this.viewSettings.fieldOfView));
        frontend.audio.bindHaptics(controls); frontend.audio.bindVolumeCvars(this.imageSettings.cvars);
        frontend.audio.bindOutputCvars(this.imageSettings.cvars);
        seat.attachPresentation(presentation, () => presentation.close());
        if (borrowed !== null) {
          controls.publishClientPlatform(borrowed, "retain");
          publishAudio?.(); borrowed.output.current = frontend.audio.engine;
        } else if (previous === null) controls.activatePreparedPlatform(); else previous.transferPlatformTo(controls);
        if (candidateCinematic !== null) { this.stopCinematic(); this.cinematic = candidateCinematic; candidateCinematic = null; }
        applyAudioOutputSettings(this.imageSettings.cvars, frontend.audio);
        retiredScripts = borrowed === null ? owner.scripts : borrowed.configuration.current.scripts;
        this.clientCommandOwner = { ...owner, scripts };
        if (borrowed !== null) borrowed.configuration.current = { scripts, options: this.options };
        candidateScripts = null;
        if (remote.output !== null) this.publishRemote(remote.output);
        await this.retireFrontends();
        await retirePrevious();
        assertCurrent();
        if (this.ownership.kind === "owned") capture.activate();
        if (connection !== undefined && pure !== null && pure !== undefined) connection.reliable.add(pure);
        this.commands.push(...actions);
        if (quit) this.requestQuit();
        this.q3InitialViewPending = connection !== undefined;
        if (q3 === null) { await frontend.audio.startWorldMusic(); assertCurrent(); }
      }
    } catch (error) {
      if (published) {
        const failures: unknown[] = [error];
        if (candidateCinematic !== null) { try { this.closeCinematic(candidateCinematic); } catch (cleanup) { failures.push(cleanup); } candidateCinematic = null; }
        try { await retirePrevious(); } catch (cleanup) { failures.push(cleanup); }
        try { await this.close(); } catch (cleanup) { failures.push(cleanup); }
        try { await candidateScripts?.close(); } catch (cleanup) { failures.push(cleanup); }
        if (failures.length > 1) throw new AggregateError(failures, "Remote seat publication and shutdown failed");
      } else {
        const failures: unknown[] = [error];
        if (candidateCinematic !== null) { try { this.closeCinematic(candidateCinematic); } catch (cleanup) { failures.push(cleanup); } candidateCinematic = null; }
        for (const discard of [() => q3?.close(), () => ui?.close(), () => input?.close()]) {
          try { discard(); } catch (cleanup) { failures.push(cleanup); }
        }
        try { await candidateScripts?.close(); } catch (cleanup) { failures.push(cleanup); }
        if (failures.length > 1) throw new AggregateError(failures, "Remote candidate and cleanup failed");
      }
      throw error;
    }
  }

  private async startCinematic(request: ScreenCinematicRequest, ended: () => void): Promise<void> {
    this.stopCinematic();
    this.cinematic = await this.prepareCinematic(request, ended);
    this.resetFrameElapsed = true;
  }

  private async prepareCinematic(request: ScreenCinematicRequest, ended: () => void, candidateAudio?: UnifiedAudio): Promise<RemoteCinematic> {
    const images = this.renderer.images.fork();
    let ownedAudio: UnifiedAudio | null = null;
    try {
      const retained = candidateAudio ?? (this.ownership.kind === "borrowed" ? this.ownership.client.output.current : this.frontend?.audio.engine);
      if (retained === undefined) {
        ownedAudio = new UnifiedAudio({ milliseconds: () => Math.trunc(performance.now()), random: () => 0,
          outputFormat: readAudioOutputCvars(this.imageSettings.cvars) });
        ownedAudio.openDevice();
      }
      const engine = retained ?? ownedAudio;
      if (engine === null) throw new Error("Cinematic has no audio output owner");
      const preferences = new SeatUiPreferences(this.seatId, this.imageSettings.cvars);
      const mounts = this.mounts, captions = new SeatMediaCaptions(this.seatId, async path => (await mounts.open(path))?.bytes ?? null);
      const movie = await CampaignCinematic.openMedia(request,
        { mounts }, { images }, { engine }, this.renderer, this.seatId, {
          prepare: source => captions.prepare(source, "english"),
          commands: (timeline, viewport) => {
            const presentation = this.presentation;
            if (presentation === null) {
              if (this.ownership.kind !== "borrowed") return [];
              const enabled = preferences.values.captions;
              return this.ownership.client.captionCommands(captions.active(timeline, { subtitles: enabled, soundCaptions: enabled, speakers: true }), viewport, timeline.elapsedMilliseconds);
            }
            const enabled = presentation.ui.preferences.values.captions;
            return presentation.ui.captionCommands(captions.active(timeline, { subtitles: enabled, soundCaptions: enabled, speakers: true }),
              { binding: { ...presentation.state.presentation, viewport, safeArea: viewport }, timeMilliseconds: timeline.elapsedMilliseconds });
          },
        });
      return { movie, images, ownedAudio, ended };
    } catch (error) {
      const failures: unknown[] = [error];
      for (const close of [() => images.close(), () => ownedAudio?.close(),
        () => this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [] })]) {
        try { close(); } catch (cleanup) { failures.push(cleanup); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "Cinematic preparation and cleanup failed");
      throw error;
    }
  }

  private stopCinematic(): void {
    const current = this.cinematic;
    if (current === null) return;
    this.cinematic = null;
    this.closeCinematic(current);
  }

  private closeCinematic(current: RemoteCinematic): void {
    const errors: unknown[] = [];
    for (const close of [() => this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [] }), () => current.movie.close(this.frames), () => current.images.close(), () => current.ownedAudio?.close(),
      () => this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [] })]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    if (errors.length !== 0) throw new AggregateError(errors, "Cinematic retirement failed");
  }

  input(event: SeatInputEvent): boolean {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
    return this.cinematic?.movie.input(event) ?? this.controls?.input(event) ?? false;
  }

  queueCommand(name: string, args: readonly string[], seat: SeatId | null, source: CommandContext | undefined = this.clientCommands?.commands.executionContext): undefined {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
    if(seat===null && source!==undefined){let origin=source.origin;while(origin.kind==="script")origin=origin.caller;if(origin.kind==="local-seat")seat=origin.seat;}
    this.commands.push({ name, args: [...args], seat, ...(source === undefined ? {} : { source }) });
    return undefined;
  }

  private async dispatchCommands(): Promise<void> {
    const pending = this.commands; this.commands = [];
    for (const [index, command] of pending.entries()) {
      if (this.videoRestart?.pending) { this.commands.unshift(...pending.slice(index)); return; }
      const source = command.source ?? { session: this.session.session, origin: { kind: "local-console" } } satisfies CommandContext;
      if (this.ownership.kind === "borrowed") await this.ownership.client.dispatchApplicationRequest({ target: "application", name: command.name, arguments_: command.args, seat: command.seat, source });
      else await this.executeRemoteCommand(command);
    }
  }

  attachConnectingRecording(sink: DemoRecordingSink): () => void {
    if (this.closed || this.closing || this.source.kind !== "live" || !(this.source.network instanceof QwClientNetwork)) throw new Error("Signon recording requires a live QuakeWorld connection");
    return this.source.network.recording.attach(sink);
  }

  private standaloneRecording(): ClientDemoRecording {
    if (this.ownership.kind !== "owned") throw new Error("Borrowed sources use the retained client recorder");
    if (this.ownedRecording !== null) return this.ownedRecording;
    let feed: ClientRecordingFeed | null = null;
    this.ownedRecording = new ClientDemoRecording({
      root: () => { if (feed === null) throw new Error("Recording has no selected source"); return feed.root; },
      seed: async source => { feed = await this.prepareRecording(source); return feed.seed(); },
      attach: sink => { if (feed === null) throw new Error("Recording has no prepared feed"); return feed.attach(sink); },
      reconnectRecording: async () => { throw new Error("rerecord requires the retained client connection owner"); },
      print: text => this.host.print(text),
      stage: intent => { this.queueCommand(intent.kind === "stop" ? "stop" : intent.kind, intent.kind === "stop" || intent.name === undefined ? [] : [intent.name], null, intent.source); },
    });
    return this.ownedRecording;
  }

  async prepareRecording(context: CommandContext): Promise<ClientRecordingFeed> {
    if (context.session !== this.session.session) throw new Error("Recording command belongs to another session");
    if (this.source.kind !== "live" || this.networkPhase !== "active") throw new Error("Recording requires an active live connection");
    let origin=context.origin;while(origin.kind==="script")origin=origin.caller;
    const seatOrigin=origin;
    const peer=seatOrigin.kind==="local-seat"?this.remoteSeats.find(peer=>!peer.closed && peer.seat.id.equals(seatOrigin.seat)):undefined;
    if(peer!==undefined && (peer.closed || !peer.channel.active))throw new Error("Recording seat has no active connection");
    const network = peer?.source.network ?? this.source.network, recording = "recording" in network ? network.recording : undefined;
    if (recording === undefined) throw new Error("The selected native protocol has no demo recorder");
    return { root: this.remoteContent?.writeRoot ?? this.configuration.settings.root,
      seed: () => recording.seed(), attach: sink => {
        if (this.closed || this.closing || this.source.kind !== "live" || (peer===undefined ? this.source.network!==network : peer.closed || peer.source.network!==network)) throw new Error("Recording connection was retired");
        return recording.attach(sink);
      } };
  }

  private primaryDownloadProgress(): readonly ClientDownloadProgress[] {
    if (this.remote instanceof Q2RemotePresentation) return this.remote.downloadProgress;
    return this.qwDownloads?.progress ?? this.q3Downloads?.progress ?? [];
  }

  get downloadProgress(): readonly ClientDownloadProgress[] {
    return [...this.primaryDownloadProgress(), ...this.remoteSeats.flatMap(peer => peer.closed ? [] : peer.source.downloadProgress)];
  }

  cancelDownloads(seat: SeatId | null = null): void {
    if (seat === null || seat.equals(this.seatId)) {
      if (this.remote instanceof Q2RemotePresentation) this.remote.cancelDownloads();
      this.qwDownloads?.cancel(); this.q3Downloads?.cancel();
    }
    for (const peer of this.remoteSeats) if (!peer.closed && (seat === null || peer.seat.id.equals(seat))) peer.source.cancelDownloads();
  }

  async retryDownloads(seat: SeatId | null = null): Promise<void> {
    if (seat === null || seat.equals(this.seatId)) {
      if (this.remote instanceof Q2RemotePresentation) this.remote.retryDownloads();
      await this.qwDownloads?.retry(); this.q3Downloads?.retry();
    }
    for (const peer of this.remoteSeats) if (!peer.closed && (seat === null || peer.seat.id.equals(seat))) await peer.source.retryDownloads();
  }

  executeApplicationRequest(request: ConfigurationCommandRequest): Promise<void> {
    return this.executeRemoteCommand({ name: request.name, args: request.arguments_, seat: request.seat, source: request.source });
  }

  private async executeRemoteCommand(command: RemoteCommand): Promise<void> {
      const local = this.controls?.locals.find(local => command.seat !== null && local.player.seat.id.equals(command.seat));
      const source: CommandContext | undefined = command.source ?? (local === undefined ? undefined : { session: this.session.session,
        origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } });
      const print = (text: string): void => {
        if (source !== undefined || command.seat === null) this.print(text, source);
        else this.host.print(text);
      };
      try {
        if (source !== undefined) {
          if (source.session !== this.session.session) throw new Error("Remote command belongs to another session");
          let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
          if (origin.kind === "remote-client") throw new Error("Remote gameplay commands require a local client");
          const seatOrigin=origin;
          if (seatOrigin.kind === "local-seat" && !this.configuration.seats.some(seat=>seat.id.equals(seatOrigin.seat) && seat.client.id.equals(seatOrigin.client)))
            throw new Error("Remote command belongs to a retired local client");
        }
        if (command.seat !== null && !this.configuration.seats.some(seat=>command.seat !== null && seat.id.equals(command.seat))) throw new Error("Remote command belongs to an inactive local seat");
        if(command.name==="local_join") { if (command.args.length !== 0) throw new Error("Usage: local_join"); await this.joinRemoteSeat(); return; }
        if(command.name==="local_drop") {
          const index=command.args.length===0?command.seat?.index:Number(command.args[0])-1;
          if(command.args.length>1 || index===undefined || !Number.isSafeInteger(index) || index<0)throw new Error("Usage: local_drop [player number]");
          await this.dropRemoteSeat(index); return;
        }
        if(command.name==="color" && this.family==="qw") {
          const cvars=command.seat===null?this.configuration.source:this.configuration.seatSources.get(command.seat);
          if(cvars===undefined)throw new Error("Color command has no source seat");
          if(command.args.length===0){print(`"color" is "${cvars.variableString("topcolor")} ${cvars.variableString("bottomcolor")}"\n`);return;}
          const top=Math.min(13,nativeAtoi(command.args[0]??"")&15),bottom=Math.min(13,nativeAtoi(command.args[1]??command.args[0]??"")&15);
          cvars.set("topcolor",String(top));cvars.set("bottomcolor",String(bottom));return;
        }
        if (command.name === "in_restart" || command.name === "midiinfo") {
          const input = this.controls;
          if (input === null) { print("Input devices are not active before signon.\n"); return; }
          if (command.name === "midiinfo") input.inputDevices.info();
          else { input.releaseForProfileChange(); input.inputDevices.restart(); input.router.restart(); }
          return;
        }
        if (command.name === "record" || command.name === "stop" || command.name === "stoprecord" || command.name === "rerecord") {
          const context = source ?? { session: this.session.session, origin: { kind: "local-console" } } satisfies CommandContext;
          if (command.name === "stop" || command.name === "stoprecord") await this.standaloneRecording().stop();
          else {
            const name = command.args[0];
            if (command.args.length > 1 || command.name === "rerecord" && name === undefined) throw new Error(`Usage: ${command.name} <name>`);
            if (command.name === "rerecord" && name !== undefined) await this.standaloneRecording().rerecord(name, context);
            else await this.standaloneRecording().start(name, context);
          }
          return;
        }
        if (command.name === "cinematic") {
          const name = command.args[0], mode = command.args[1];
          if (name === undefined || command.args.length > 2) throw new Error("Usage: cinematic <name> [loop|hold]");
          await this.startCinematic({ name, loop: mode === "2" || mode === "loop", hold: mode === "1" || mode === "hold", silent: false }, () => {
            const owner = this.clientCommands;
            if (owner === null) return;
            const next = owner.cvars.variableString("nextmap"); owner.cvars.set("nextmap", "", true);
            if (next !== "") owner.commands.append(`${next}\n`, source);
          });
          return;
        }
        if (command.name === "cinematicpause" || command.name === "stopcinematic") {
          if (this.cinematic === null) throw new Error("No cinematic is playing");
          if (command.name === "stopcinematic") this.stopCinematic();
          else this.cinematic.movie.pause(this.cinematic.movie.status !== "paused");
          return;
        }
        if (command.name === "demopause") {
          if (this.source.kind !== "recorded") throw new Error("Demo pause requires active playback");
          this.source.playback.setPaused(!this.source.playback.isPaused);
          return;
        }
        if (command.name === "downloadstatus") {
          const progress = command.seat === null ? this.downloadProgress : command.seat.equals(this.seatId) ? this.primaryDownloadProgress()
            : this.remoteSeats.find(peer => !peer.closed && command.seat !== null && peer.seat.id.equals(command.seat))?.source.downloadProgress ?? [];
          if (progress.length === 0) print("No downloads are pending.\n");
          for (const file of progress) print(`${file.path}: ${file.phase} ${file.received}/${file.total ?? "?"} bytes (${file.transport})\n`);
          return;
        }
        if (command.name === "stopdownload") { this.cancelDownloads(command.seat); print("Downloads paused. Use retrydownload to resume.\n"); return; }
        if (command.name === "retrydownload") { await this.retryDownloads(command.seat); return; }
        if (command.name === "quit") { this.requestQuit(); return; }
        if (command.name === "disconnect") {
          const peer=this.remoteSeats.find(peer=>!peer.closed && command.seat!==null && peer.seat.id.equals(command.seat));
          if(peer===undefined)this.requestQuit();else await this.retireRemoteSeat(peer,true);
          return;
        }
        if (await this.browserCommand(command.name, command.args, print)) return;
        const peer=this.remoteSeats.find(peer=>!peer.closed && command.seat!==null && peer.seat.id.equals(command.seat));
        const network=peer?.source.network??this.network;
        if (network instanceof QwClientNetwork && (command.name === "skins" || command.name === "allskins")) {
          if (command.name === "allskins") { if(peer===undefined)this.qwAllSkins=command.args[0]??'';else peer.source.setAllSkins(command.args[0]??''); }
          await network.refreshSkins(); return;
        }
        if (this.frontend !== null && await this.frontend.audio.command({ name: command.name, args: command.args, seat: command.seat,
          registrations: this.presentation?.q3Client?.media.bank.registrations() ?? [], print })) return;
        if (["map", "save", "load"].includes(command.name)) throw new Error(`${command.name} requires the authoritative server console`);
        const player = this.localPlayers.find(player => command.seat === null || player.seat.id.equals(command.seat));
        if (player === undefined || this.networkPhase !== "active") throw new Error("Remote command requires a connected local player");
        const remote=this.sourceForActor(player.actor);
        const q3 = peer===undefined ? this.presentation?.q3Client : peer.view?.presentation.q3Client;
        if (command.name === "centerview") {
          const local = this.controls?.locals.find(local => local.player.actor.equals(player.actor));
          if (local !== undefined) {
            const state = local.builder.dialect === "q3" && q3 != null ? q3.source.read(q3.source.current().number)?.playerState : undefined;
            local.builder.setViewAngles({ ...local.builder.viewAngles, x: state === undefined ? 0 : -(state.deltaAngles.x << 16 >> 16) * (360 / 65536) });
          }
          return;
        }
        if (q3 !== null && q3 !== undefined) {
          if (command.name === "use") { const selected = remote.playerUi(player.actor).items.find(item => item.id === command.args[0]); if (selected !== undefined && await q3.command(["weapon", String(selected.sourceOrdinal)])) return; }
          if (await q3.command([command.name, ...command.args])) return;
        }
        if (this.source.kind === "recorded") throw new Error("Gameplay commands require a live server");
        remote.playerCommand(player.actor, command.name, command.args);
      } catch (error) { print(`${error instanceof Error ? error.message : String(error)}\n`); }
  }

  private underwater(camera: SceneCamera, actor: ActorId, scene: SceneQueries): boolean {
    const timing = this.content.recipe.timing.find(timing => timing.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("Remote world has no numeric profile for camera contents");
    const contents = scene.pointContents({ point: camera.origin, target: { kind: "world" }, passActor: actor, numeric: timing.numeric,
      policy: this.family === "qw" || this.family === "q1" ? { kind: "q1", move: "normal", hull: null } : this.family === "q3" ? { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } : { kind: "q2", contentsMask: -1, leafContents: "merged" } });
    return contents.kind === "q1" ? contents.contents <= -3 && contents.contents >= -5 : contents.kind === "q3" ? (contents.contents & 56) !== 0 : contents.kind === "q2" && (contents.merged & 56) !== 0;
  }

  private async drainSeatPublications(): Promise<void> {
    for (const peer of this.remoteSeats) { await peer.pump.drainReady(); peer.pump.throwFailure(); }
  }

  private sourceForActor(actor: ActorId): typeof this.remote {
    if (this.remote.player?.actor.equals(actor) || this.remote instanceof Q3RemotePresentation && this.remote.admittedPlayer.actor.equals(actor)) return this.remote;
    for (const peer of this.remoteSeats) {
      if (peer.closed) continue;
      const remote = peer.source.remote;
      if (remote.player?.actor.equals(actor) || remote instanceof Q3RemotePresentation && remote.admittedPlayer.actor.equals(actor)) return remote;
    }
    throw new Error("Remote input actor has no active native channel");
  }

  private seatViewport(id: SeatId) {
    const ids = this.controls?.locals.map(local => local.player.seat.id) ?? [this.seatId];
    const index = ids.findIndex(candidate => candidate.equals(id)), size = this.window.drawableSize;
    return seatViewport(index, ids.length, size.width, size.height);
  }

  private publishRemoteLayouts(): void {
    const locals = this.controls?.locals ?? [];
    for (const [index, local] of locals.entries()) {
      const presentation = local.player.seat.id.equals(this.seatId) ? this.presentation
        : this.remoteSeats.find(peer => !peer.closed && peer.seat.id.equals(local.player.seat.id))?.view?.presentation;
      presentation?.publishLayout(index, locals.length);
    }
  }

  private async joinRemoteSeat(): Promise<void> {
    if (this.source.kind !== "live") throw new Error("Recorded playback has one recorded viewpoint");
    if (this.configuration.seats.length >= 4) throw new Error("Four local players are already connected");
    const controls = this.controls;
    if (controls === null || !this.primaryViewCurrent) throw new Error("Wait for the current player to finish connecting");
    await controls.saveSettings();
    const previous = this.configuration, previousScripts = this.clientCommands?.scripts;
    const options = { ...this.options, seats: previous.seats.length + 1 };
    const mounted = await openRemoteApplicationContent(options);
    const candidate = await prepareRemoteConfiguration(options, mounted, this.session,
      this.imageSettings, this.ownership, this.host, () => previous.source.variableValue("sv_cheats") === 1, previous);
    const before = new Set(this.remoteSeats);
    let published = false;
    try {
      await this.prepareRemoteSeats(candidate);
      const input = await controls.prepareLocalSeats(controls.locals.map(local => local.player.seat));
      candidate.profile.program.validatePublication(); candidate.images.validatePublication(); candidate.validateSource();
      controls.releaseForProfileChange(candidate.profile.program.releaseCommands);
      this.publishConfiguration(candidate); published = true;
      this.launchOptions = options;
      const sourceOwner = this.clientCommands;
      if (sourceOwner === null) throw new Error("Remote source publication lost its command owner");
      controls.adoptClientSource(sourceOwner);
      for (const peer of this.remoteSeats) if (!before.has(peer)) peer.channel.publishConnection()?.close();
      input.publish(controls.locals.map(local => local.player), this.ownership.kind === "borrowed" ? this.ownership.client : undefined,
        { playerView: actor => this.sourceForActor(actor).playerView(actor) }, "retain");
      if (this.ownership.kind === "borrowed") this.ownership.client.configuration.current = { scripts: candidate.profile.scripts, options };
      await previousScripts?.close();
      await previous.images.settings.close();
    } catch (error) {
      const failures: unknown[] = [error];
      if (!published) {
        for (const peer of [...this.remoteSeats]) if (!before.has(peer)) try { await this.retireRemoteSeat(peer, false); } catch (cleanup) { failures.push(cleanup); }
        try { candidate.identities.discard(); } catch (cleanup) { failures.push(cleanup); }
        try { await candidate.profile.scripts.close(); } catch (cleanup) { failures.push(cleanup); }
        try { await candidate.images.settings.close(); } catch (cleanup) { failures.push(cleanup); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "Remote player admission failed");
      throw error;
    }
  }

  private async dropRemoteSeat(index: number): Promise<void> {
    if (this.source.kind !== "live") throw new Error("Recorded playback has one recorded viewpoint");
    const seat = this.configuration.seats.find(seat => seat.id.index === index);
    if (seat === undefined) throw new Error("That player is not connected");
    if (this.configuration.seats.length === 1) throw new Error("Use disconnect to leave the last connection");
    const controls = this.controls;
    if (controls === null) throw new Error("Wait for the current player to finish connecting");
    await controls.saveSettings();
    const oldPrimary = this.primaryPeer;
    const primary = seat.id.equals(this.seatId);
    const replacement = primary ? this.remoteSeats.find(peer => !peer.closed && peer !== oldPrimary && peer.view !== null && peer.channel.active && peer.map === this.options.map) : undefined;
    if (primary && replacement === undefined) throw new Error("Wait for another player to finish connecting before removing this player");
    const survivors = controls.locals.filter(local => !local.player.seat.id.equals(seat.id)).map(local => local.player);
    if (replacement !== undefined) survivors.sort((a, b) => a.seat === replacement.seat ? -1 : b.seat === replacement.seat ? 1 : a.seat.id.index - b.seat.id.index);
    const prepared = await controls.prepareLocalSeats(survivors.map(player => player.seat));
    const previousSource = this.configuration.source;
    if (replacement !== undefined) {
      this.primaryPeer = replacement;
      const cvars = this.configuration.seatSources.get(replacement.seat.id);
      if (cvars === undefined) throw new Error("Promoted player lost its source registry");
      const previousRouting = this.configuration.routing;
      const routing: CommandCvarRouting = {
        owner: (name, context) => {
          let origin = context.origin; while (origin.kind === "script") origin = origin.caller;
          const owner = previousRouting.owner(name, context);
          return origin.kind === "local-console" && owner === previousSource ? cvars : owner;
        },
        visible: context => previousRouting.visible(context).map(owner => owner === previousSource ? cvars : owner),
      };
      this.configuration = { ...this.configuration, seat: replacement.seat, source: cvars, routing };
      const owner = this.clientCommands;
      const mouse = this.configuration.prepared.seats.find(seat => seat.id.equals(replacement.seat.id))?.mouse;
      if (owner === null || mouse === undefined) throw new Error("Promoted player lost its command owner");
      this.clientCommandOwner = { ...owner, cvars, routing, inputSettings: mouse };
      this.configuration.prepared.adopt(routing, (name, args, source) => {
        let origin = source.origin; while (origin.kind === "script") origin = origin.caller;
        return this.queueCommand(name, args, origin.kind === "local-seat" ? origin.seat : null, source);
      }, { source: cvars, movement: this.configuration.prepared.movement, fallback: cvars, scripts: owner.scripts, read: this.configuration.profile.read });
      controls.adoptClientSource(this.clientCommandOwner);
      this.keys.publish(this.keyProfile, cvars);
    }
    this.configuration = { ...this.configuration, seats: this.configuration.seats.filter(candidate => candidate !== seat) };
    this.launchOptions = { ...this.options, seats: this.configuration.seats.length };
    prepared.publish(survivors, this.ownership.kind === "borrowed" ? this.ownership.client : undefined,
      { playerView: actor => this.sourceForActor(actor).playerView(actor) }, "retain");
    this.publishRemoteLayouts();
    if (primary && oldPrimary === null) {
      await this.initialPresentation?.q3Client?.shutdown();
      if (this.initialPresentation !== null && seat.presentation === this.initialPresentation) seat.clearPresentation();
      this.initialPresentation = null;
      this.qwDownloads?.close(); this.qwDownloads = null;
      this.q3Downloads?.close(); this.q3Downloads = null;
      if (this.initialSource.kind === "live") await this.initialSource.network.close();
      if (seat.client.connection === this.sourceConnection) seat.client.disconnect();
      this.sourceConnection = null;
      if (this.initialQport !== null) this.qports.delete(this.initialQport);
    } else {
      const peer = oldPrimary !== null && primary ? oldPrimary : this.remoteSeats.find(peer => !peer.closed && peer.seat === seat);
      if (peer !== undefined) await this.retireRemoteSeat(peer, false);
    }
  }

  private async prepareRemoteSeats(configuration = this.configuration): Promise<void> {
    if (this.source.kind !== "live" || configuration.seats.length === 1) return;
    const network = this.options.network;
    if (network.kind !== "q1-client" && network.kind !== "qw-client" && network.kind !== "q2-client" && network.kind !== "q3-client" && network.kind !== "unified-client") throw new Error("Remote seat requires a native server address");
    for (const seat of configuration.seats) {
      if (seat.id.equals(this.seatId) || this.remoteSeats.some(peer => !peer.closed && peer.seat === seat)) continue;
      const cvars = configuration.seatSources.get(seat.id);
      if (cvars === undefined) throw new Error("Remote seat has no source registry");
      const address = await resolveApplicationAddress(network.remote, network.kind === "unified-client" ? 27960 : this.family === "q1" ? 26000 : this.family === "qw" ? 27500 : this.family === "q3" ? 27960 : 27910, this.options.networkTransport ?? { kind: "udp" }, this.family);
      const transport = await openApplicationTransport({ selection: this.options.networkTransport ?? { kind: "udp" }, family: this.family, host: address.kind === "ipv6" ? "::" : "0.0.0.0", port: 0,
        limits: network.kind !== "unified-client" && this.family === "q2" ? Q2_DATAGRAM_LIMITS : UNIFIED_DATAGRAM_LIMITS });
      let qport: number | null = null;
      try {
        await configuration.prepareTransport(transport);
        const clock = new PresentationTime();
        let created: RemoteSeatPeer | null = null;
        const current = (): RemoteSeatPeer => {
          if (created === null) throw new Error("Remote seat source has not been constructed");
          if (created.closed || this.closed || this.closing) throw created.pump.retirementError;
          return created;
        };
        const select = (selection: RemoteContentMounts["selection"], assertCurrent: () => void): Promise<RemoteContentMounts> => current().pump.enqueue(async () => {
            const peer = current(); assertCurrent();
            if (peer === this.primaryPeer) {
              const content = await this.selectRemoteContent(selection, assertCurrent);
              peer.content = content; return content;
            }
            const content = await openRemoteContent(this.options, selection, assertCurrent, ++peer.generation);
            try { current(); assertCurrent(); } catch (error) { content.mounts.close(); throw error; }
            const previous = peer.content; peer.content = content; previous?.mounts.close(); return content;
          }, () => current() === this.primaryPeer || this.primaryViewCurrent && this.options.product === remoteContentProduct(selection));
        const load = (world: Q1RemoteWorld & { readonly images?: readonly string[] }, prepared?: LoadedApplicationContent): Promise<LoadedApplicationContent> => current().pump.enqueue(async () => {
            const peer = current();
            await peer.view?.close(); peer.view = null;
            peer.map = mapResourcePath(world.map);
            peer.loadedContent = peer === this.primaryPeer ? await this.loadServerWorld(world, prepared) : prepared ?? this.content;
            if (peer === this.primaryPeer && this.remoteContent === null) peer.content = null;
            return peer.loadedContent;
          }, () => current() === this.primaryPeer || this.primaryViewCurrent && this.loadedContent?.recipe.map.geometry.requestedPath === mapResourcePath(world.map));
        const common = { identity: this.identity, session: this.session, seat, cvars: () => this.configuration.seatSources.get(seat.id) ?? cvars, clock, transport, address, qport: qport = this.allocateQport(),
          downloadPermission: configuration.downloadPermissions.get(seat.id) ?? null,
          hooks: {
            options: () => this.options, mounts: () => current().content?.mounts ?? this.mounts, content: () => this.content,
            currentContent: () => current().content, selectContent: select,
            refreshContent: (assertCurrent: () => void) => {
              const selection = current().content?.selection;
              if (selection === undefined) throw new Error("Remote seat package refresh has no selected directory");
              return select(selection, assertCurrent);
            },
            loadQ1World: (world: Q1RemoteWorld) => load(world),
            loadQ2World: (state: Q2ApplicationGameState) => {
              const remote = current().source.remote;
              if (!(remote instanceof Q2RemotePresentation)) throw new Error("Q2 remote seat has no protocol owner");
              const layout = q2ApplicationLayout(remote.protocol), map = state.configStrings.get(layout.models + 1);
              if (map === undefined) throw new Error("Q2 remote seat server supplied no world model");
              const names = (first: number, maximum: number): string[] => Array.from({ length: maximum - 1 }, (_, index) => state.configStrings.get(first + index + 1) ?? "").filter(Boolean);
              return load({map,models:names(layout.models,layout.maxModels),sounds:names(layout.sounds,layout.maxSounds),images:names(layout.images,layout.maxImages)});
            },
            loadQ3World: (world: Q1RemoteWorld, _connection: Q3ClientConnection, prepared: LoadedApplicationContent) => load(world, prepared),
            initializeQ3: (connection: Q3ClientConnection) => current().pump.enqueue(() => this.bindRemoteSeat(current(), connection), () => current() === this.primaryPeer || this.primaryViewCurrent),
            shutdownQ3: () => created===null || created.closed ? Promise.resolve() : created.pump.enqueue(async () => { const peer=current(); await peer.view?.close(); peer.view=null; }),
            cinematic: { start: (name: string, ended: () => void) => current().pump.enqueue(async () => { if (current() === this.primaryPeer) await this.startCinematic({ name, loop: false, hold: false, silent: false }, ended); else current().cinematicEnded = ended; }, () => current() === this.primaryPeer || this.cinematic !== null), stop: () => { if(created!==null)created.cinematicEnded = null; } },
            publish: (output: SimulationOutput) => { if(created!==null && !created.closed && !this.closing && created.view!==null) { if (created === this.primaryPeer) this.publishRemote(output); else created.channel.receive(output); } },
            disconnected: (reason: string) => { if(created!==null && !created.closed)created.disconnected=reason; },
            print: (text: string) => this.print(text,{session:seat.id.session,origin:{kind:"local-seat",seat:seat.id,client:seat.client.id}}),
            recording: () => this.ownership.kind === "borrowed" ? this.ownership.client.recording.path !== null : this.ownedRecording?.path !== null && this.ownedRecording !== null,
          } };
        const source = network.kind === "unified-client" ? new RemoteSeatSource({...common,family:"unified",unified:{
          loadContent:(offer,assertCurrent)=>current().pump.enqueue(async()=>{
            const peer=current();assertCurrent();
            if(peer===this.primaryPeer){
              const content=await loadUnifiedContent({...this.options,mode:offer.mode},offer.composition,this.mountedContent.catalog);
              try{current();assertCurrent();}catch(error){await content.close();throw error;}
              try{await this.adoptUnifiedProfile(content,offer.mode,assertCurrent);}catch(error){await content.close();throw error;}
              await peer.view?.close();peer.view=null;
              try{peer.loadedContent=await this.loadServerWorld({map:content.recipe.map.geometry.requestedPath,models:[],sounds:[]},content);}
              catch(error){if(this.loadedContent!==content)await content.close();throw error;}
            }else{await peer.view?.close();peer.view=null;assertCurrent();peer.loadedContent=this.content;}
            peer.map=peer.loadedContent.recipe.map.geometry.requestedPath;return peer.loadedContent;
          },()=>current()===this.primaryPeer || this.remote instanceof UnifiedRemotePresentation && this.remote.loadedEpoch===offer.epoch && this.loadedContent!==null && this.remote.compositionDigest===offer.composition.digest),
          model:async(key,brush)=>{
            const content=current().loadedContent;if(content===null||this.frontend===null)throw new Error("Unified peer model has no admitted world");
            if(brush!==null)return {kind:"brush-model",world:content.world,model:brush};
            return (await this.frontend.assets.model(key.content,key.path)).model;
          }
        }}) : this.family === "q3" ? new RemoteSeatSource({...common,family:"q3",authorization:this.keys.authorization})
          : this.family === "q2" ? new RemoteSeatSource({...common,family:"q2",protocol:this.options.q2Protocol ?? (this.mountedContent.catalog.product(this.options.product).expectation.edition === "rerelease" ? {kind:"q2-rerelease",version:1038} : {kind:"q2-classic",version:34})})
          : new RemoteSeatSource({...common,family:this.family});
        const channel = new RemoteSeatChannel(seat,clock,{network:source.network,remote:source.remote,cvars});
        created = { seat, source, channel, content:null, map:null, loadedContent:null, view:null, generation:0, closed:false, pump:new RemoteSeatPump(source), disconnected:null, cinematicEnded:null, userinfo:null };
        this.remoteSeats.push(created);
      } catch (error) { transport.close(); if (qport !== null) this.qports.delete(qport); throw error; }
    }
  }

  private peerWorldCurrent(peer:RemoteSeatPeer):boolean {
    if(peer.map!==this.options.map)return false;
    if(!(peer.source.remote instanceof UnifiedRemotePresentation))return true;
    return this.remote instanceof UnifiedRemotePresentation && peer.source.remote.epoch===this.remote.epoch && peer.loadedContent===this.loadedContent;
  }

  private async bindRemoteSeat(peer: RemoteSeatPeer, connection?: Q3ClientConnection): Promise<void> {
    if(peer.source.remote instanceof UnifiedRemotePresentation && !this.peerWorldCurrent(peer))return;
    const controls = this.controls, frontend = this.frontend, remote = peer.source.remote;
    const content=peer.loadedContent;
    if (peer.closed || peer.view !== null || controls === null || frontend === null || content===null || this.primaryPeer !== peer && this.presentation === null) return;
    const player = connection !== undefined && remote instanceof Q3RemotePresentation ? remote.admittedPlayer : remote.player;
    if (player === null || connection === undefined && remote.output === null) return;
    const generation = this.worldLoadGeneration;
    const assertCurrent = (): void => { if (peer.closed || this.closed || this.closing || generation !== this.worldLoadGeneration || this.controls !== controls || this.frontend !== frontend) throw new Error("Remote seat presentation was replaced"); };
    const players = [...controls.locals.filter(local => !local.player.seat.id.equals(peer.seat.id)).map(local=>local.player), {seat:peer.seat,actor:player.actor}].sort((a,b)=>a.seat.id.equals(this.seatId)?-1:b.seat.id.equals(this.seatId)?1:a.seat.id.index-b.seat.id.index);
    const prepared = await controls.prepareLocalSeats(players.map(player=>player.seat)); assertCurrent();
    prepared.publish(players,this.ownership.kind === "borrowed" ? this.ownership.client : undefined,{playerView: actor=>this.sourceForActor(actor).playerView(actor)},"retain");
    const local = controls.locals.find(local=>local.player.seat.id.equals(peer.seat.id));
    if (local === undefined) throw new Error("Remote input publication lost its admitted seat");
    const cvars = this.configuration.seatSources.get(peer.seat.id);
    if (cvars === undefined) throw new Error("Remote seat presentation lost its registry");
    const q3 = connection === undefined ? null : this.q3Browser !== null && this.keyProfile !== null
      ? {connection,browser:this.q3Browser,keys:this.keyProfile} : (()=>{throw new Error("Q3 remote seat has no guest services");})();
    const view = await RemoteSeatView.prepare({ local,controls,source:peer.source,cvars,assets:frontend.assets,content,art:frontend.art,font:frontend.font,audio:frontend.audio,
      renderer:this.renderer,images:this.imageSettings,view:this.viewSettings,options:this.options,q3,
      viewport:()=>this.seatViewport(peer.seat.id),count:()=>controls.locals.length,index:()=>controls.locals.indexOf(local),now:()=>performance.now(),assertCurrent,
      quit:()=>this.requestQuit(),execute:(name,args)=>this.queueCommand(name,args,peer.seat.id),print:text=>this.print(text) });
    try { assertCurrent(); view.publish(controls.locals.indexOf(local),controls.locals.length); peer.view=view;
      if(view.presentation.q3Client!==null && this.viewSettings.override!==null)view.presentation.q3Client.cvars.set("cg_fov",String(this.viewSettings.fieldOfView)); this.publishRemoteLayouts(); }
    catch(error){await view.close();throw error;}
    if(connection!==undefined){const pure=peer.source.pureCommand(nativeAtoi(q3InfoValue(connection.gameState.get(1)??"","sv_serverid")));if(pure!==null)connection.reliable.add(pure);}
  }

  private pollRemoteSeats(now: number): void {
    for (const peer of this.remoteSeats) if (!peer.closed && peer.disconnected===null) peer.pump.poll(now);
  }

  private async retireRemoteSeat(peer: RemoteSeatPeer, removeInput: boolean): Promise<void> {
    if (peer.closed) return;
    if (removeInput) { await this.dropRemoteSeat(peer.seat.id.index); return; }
    peer.closed = true;
    const errors: unknown[] = [];
    try { await peer.view?.close(); } catch (error) { errors.push(error); }
    peer.view = null;
    try { await peer.pump.close(); } catch(error) { errors.push(error); }
    try { await peer.channel.close(); } catch(error) { errors.push(error); }
    try { peer.content?.mounts.close(); } catch(error) { errors.push(error); }
    peer.content=null;
    peer.loadedContent=null;
    this.qports.delete(peer.source.qport);
    const index = this.remoteSeats.indexOf(peer);
    if (index >= 0) this.remoteSeats.splice(index, 1);
    if(errors.length!==0)throw new AggregateError(errors,"Remote seat retirement failed");
  }

  private async retireRemoteViews(): Promise<void> {
    const errors: unknown[]=[];
    for(const peer of this.remoteSeats) {
      try { await peer.view?.close(); } catch(error) { errors.push(error); }
      peer.view=null;
    }
    if(errors.length!==0)throw new AggregateError(errors,"Remote seat views failed to retire");
  }

  private async prepareRemoteSeatFrames(now:number, wallElapsed:number): Promise<void> {
    for(const peer of [...this.remoteSeats]) {
      if(peer.closed || peer === this.primaryPeer)continue;
      if(peer.disconnected!==null) {
        this.print(`Player ${peer.seat.id.index+1}: ${peer.disconnected}\n`);
        await this.retireRemoteSeat(peer,true); continue;
      }
      const remote=peer.source.remote;
      if(!peer.channel.active || !this.peerWorldCurrent(peer))continue;
      if(peer.source.network instanceof Q2ClientNetwork && remote instanceof Q2RemotePresentation){const info=remote.userinfo();if(info!==peer.userinfo){peer.source.network.userinfo(info);peer.userinfo=info;}}
      remote.samplePresentation(now);
      if(remote instanceof QwRemotePresentation)await remote.prepareSkins();
      if(!(remote instanceof Q3RemotePresentation))await this.bindRemoteSeat(peer);
      const view=peer.view, controls=this.controls, output=remote.output, player=remote.player;
      if(view===null || controls===null || output===null || player===null)continue;
      const local=controls.locals.find(local=>local.player.seat.id.equals(peer.seat.id));
      if(local===undefined)throw new Error("Remote source has a view without input ownership");
      local.player.actor=player.actor;
      const q3=view.presentation.q3Client;
      if(q3!==null) {
        const selection=q3.userCommandSelection;
        controls.setQ3CommandSelection(peer.seat.id,selection);
        controls.setArsenalSelection(peer.seat.id,{provider:this.content.recipe.inventory.provider,weapon:q3WeaponItem(selection.weapon)?.item??null});
      }
      peer.channel.submit(controls.buildForSeat(peer.seat.id,peer.channel.frameMilliseconds,peer.channel.elapsedMilliseconds,output.snapshot.frame.frame,wallElapsed),now);
    }
    this.pollRemoteSeats(now);
  }

  async step(elapsedMilliseconds: number): Promise<SimulationOutput | null> {
    if (this.closed || this.closing) throw new Error("Remote application is closed");
    if (this.stepping) throw new Error("Remote application step is already in progress");
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) throw new RangeError("Remote application step requires positive elapsed milliseconds");
    if (this.ownership.kind === "owned") await this.ownedVideoRestart?.drain();
    this.stepping = true;
    this.cinematicPresented = false;
    try {
      this.serverBrowser.poll();
      this.q3Browser?.poll();
      this.sourceEvents = []; this.unhandledEffects = [];
      await this.drainSeatPublications();
      if (this.ownership.kind === "owned" && this.controls !== null) this.controls.pump(false);
      else if (this.ownership.kind === "owned") for (const event of this.window.pollEvents()) if (event.kind === "quit" || event.kind === "window" && event.event === 14) this.requestQuit();
      if (this.ownership.kind === "owned") {
        await this.flushClientCommands();
        if (!this.clientCommandsBlocked) {
          const continued = await this.advanceClientStartup();
          await this.dispatchCommands();
          if (!continued) await this.clientCommands?.commands.executeScriptsAsync(() => this.dispatchCommands(), () => !this.clientCommandsBlocked);
        }
      }
      if (this.stopping) { await this.presentLoadingFrame(); return null; }
      if (this.resetFrameElapsed) { elapsedMilliseconds = 1; this.resetFrameElapsed = false; }
      const timeCvars = this.clientCommands?.cvars;
      const frameMilliseconds = timeCvars === undefined ? elapsedMilliseconds : sourceFrameMilliseconds(timeCvars.dialect, elapsedMilliseconds,
        readFrameTimeControls(timeCvars), { dedicated: false, localServer: false });
      this.elapsed += frameMilliseconds;
      const now = performance.now();
      this.presentationTime.advance(now, elapsedMilliseconds, frameMilliseconds);
      if (this.network instanceof Q2ClientNetwork && this.remote instanceof Q2RemotePresentation && this.network.phase === "active") {
        const info = this.remote.userinfo(), previous = this.primaryPeer === null ? this.initialUserinfo : this.primaryPeer.userinfo;
        if (info !== previous) {
          this.network.userinfo(info);
          if (this.primaryPeer === null) this.initialUserinfo = info; else this.primaryPeer.userinfo = info;
        }
      }
      for(const peer of this.remoteSeats)if(!peer.closed)peer.channel.beginFrame(now,elapsedMilliseconds);
      if (!await this.advanceSource(async () => {
        if (this.source.kind === "live") { if (this.primaryPeer === null) await this.source.network.poll(now); }
        else await this.source.playback.advance(frameMilliseconds, this.frames, Math.trunc(this.presentationTime.milliseconds));
      })) { await this.presentLoadingFrame(); return null; }
      this.pollRemoteSeats(now);
      await this.drainSeatPublications();
      if (this.remote instanceof QwRemotePresentation) { this.clientCommands?.cvars.takeEffects(); await this.remote.prepareSkins(); }
      this.frames++;
      const clientInputs = this.clientInputs; this.clientInputs = [];
      for (const input of clientInputs) {
        if (!this.closed && input.generation === this.worldLoadGeneration && (this.presentation?.q3Client === input.client || this.remoteSeats.some(peer=>peer.view?.presentation.q3Client===input.client))) await input.client.input(input.event);
      }
      if (this.networkPhase === "closed" || this.networkPhase === "rejected") {
        const successor = this.remoteSeats.find(peer => !peer.closed && peer !== this.primaryPeer && peer.channel.active && peer.view !== null && peer.map === this.options.map);
        if (successor === undefined) { this.controls?.stopHaptics(); this.requestQuit(); return null; }
        await this.dropRemoteSeat(this.seatId.index);
      }
      const cinematic = this.cinematic;
      if (cinematic !== null) {
        const consoleOpen = this.controls?.locals.some(local => local.input.focus.kind === "console")
          ?? (this.ownership.kind === "borrowed" && this.ownership.client.prepared.seats.some(seat => seat.input.focus.kind === "console"));
        const ended = cinematic.movie.frame(frameMilliseconds, this.frames, consoleOpen);
        this.cinematicPresented = !consoleOpen;
        const output = this.remote.output, presentation = this.presentation;
        if (consoleOpen && output !== null && presentation !== null) {
          await presentation.prepare(output.snapshot, this.remote.presentations(), this.remote.characterViews());
          presentation.local.player.seat.present(output.snapshot, this.renderer.backend);
          this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
          this.cinematicPresented = true;
        }
        if (this.cinematicPresented) await (this.ownership.kind === "borrowed" ? this.ownership.client.capture : this.capture)?.drain();
        else if (this.ownership.kind === "owned") await this.presentLoadingFrame();
        if (ended && this.cinematic === cinematic) { this.stopCinematic(); cinematic.ended();
          for(const peer of this.remoteSeats){const ended=peer.cinematicEnded;peer.cinematicEnded=null;ended?.();} }
        return null;
      }
      if (this.networkPhase !== "active" || this.remote.output === null) {
        this.controls?.stopHaptics();
        if (this.ownership.kind === "owned") await this.dispatchCommands();
        await this.refreshImages();
        await this.presentLoadingFrame();
        return null;
      }
      if (this.source.kind === "live") this.remote.samplePresentation(now);
      await this.bindSeat();
      const q3 = this.presentation?.q3Client;
      if (q3 !== null && q3 !== undefined) {
        const seat = q3.options.local.player.seat.id, selection = q3.userCommandSelection;
        this.controls?.setQ3CommandSelection(seat, selection);
        this.controls?.setArsenalSelection(seat, { provider: this.content.recipe.inventory.provider, weapon: q3WeaponItem(selection.weapon)?.item ?? null });
      }
      if (this.source.kind === "live" && this.controls !== null) {
        const duration=this.primaryPeer?.channel.frameMilliseconds??frameMilliseconds;
        const command=this.controls.buildForSeat(this.seatId,duration,this.primaryPeer?.channel.elapsedMilliseconds??this.elapsed,this.remote.output.snapshot.frame.frame,elapsedMilliseconds);
        if(this.source.network instanceof UnifiedClientNetwork)this.source.network.submitTimed([command],now,duration);
        else this.source.network.submit([command],now);
      }
      await this.prepareRemoteSeatFrames(now,elapsedMilliseconds);
      if (this.ownership.kind === "owned") await this.dispatchCommands();
      if (this.source.kind === "live" && !await this.advanceSource(async () => { if (this.source.kind === "live") { if (this.primaryPeer === null) await this.source.network.poll(now); } })) { await this.presentLoadingFrame(); return null; }
      if (this.remote instanceof QwRemotePresentation) await this.remote.prepareSkins();
      if (this.networkPhase !== "active") { this.controls?.stopHaptics(); return null; }
      await this.bindSeat();
      await this.refreshImages();
      const output = this.source.kind === "live" ? this.remote.samplePresentation(performance.now()) : this.remote.output, frontend = this.frontend, presentation = this.presentation;
      if (output === null) return null;
      if (frontend === null || presentation === null) throw new Error("Active remote player has no frontend");
      if(this.primaryPeer===null && this.remote instanceof UnifiedRemotePresentation)this.publishRemote({...output,events:this.remote.drainSimulationEvents()});
      this.sourceEvents = this.primaryPeer === null ? this.remote.drainPresentationEvents() : [];
      const models = this.remote.presentations(), characters = this.remote.characterViews();
      if (this.primaryPeer === null) {
        frontend.effects.receive(this.sourceEvents);
        if (!(this.remote instanceof Q3RemotePresentation)) await frontend.effects.prepare(output.snapshot, models, characters);
      }
      this.unhandledEffects = frontend.effects.drainUnhandled();
      for (const effect of this.unhandledEffects) {
        const key = `${effect.source.content}:${effect.reason}`;
        if (!this.reportedEffectGaps.has(key)) { this.reportedEffectGaps.add(key); this.print(`Unresolved ${effect.source.kind} effect: ${effect.reason}\n`); }
      }
      const primaryBatch = this.primaryPeer?.view === null || this.primaryPeer === null ? null : await this.primaryPeer.view.prepareFrame(output);
      const audioBatches: ApplicationAudioSeatEvents[] = [primaryBatch === null ? {seat:this.seatId,snapshot:output.snapshot,events:this.sourceEvents,music:true,scene:this.remote.scene,effectSounds:frontend.effects.drainSounds()} : { ...primaryBatch, music: true }];
      if (primaryBatch === null) { presentation.sourceEvents(this.sourceEvents); await presentation.prepare(output.snapshot, models, characters); }
      else this.sourceEvents = primaryBatch.events;
      presentation.local.player.seat.present(output.snapshot, this.renderer.backend);
      const camera = presentation.camera();
      const listeners = [{seat:presentation.local.player.seat.id,actor:presentation.local.player.actor,origin:camera.origin,axis:camera.axis,gain:1,
        underwater:this.underwater(camera,presentation.local.player.actor,frontend.scene)}];
      for(const peer of this.remoteSeats) {
        if(peer.closed || peer === this.primaryPeer || peer.view===null || !peer.channel.active || !this.peerWorldCurrent(peer))continue;
        const received=peer.source.remote.samplePresentation(now);
        if(received===null)continue;
        audioBatches.push(await peer.view.prepareFrame(received));
        const view=peer.view.presentation;
        view.local.player.seat.present(received.snapshot,this.renderer.backend);
        const camera=view.camera();
        listeners.push({seat:peer.seat.id,actor:view.local.player.actor,origin:camera.origin,axis:camera.axis,gain:1,
          underwater:this.underwater(camera,view.local.player.actor,peer.source.remote.scene)});
      }
      this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [{ kind: "swap-buffers" }] });
      await this.capture?.drain();
      await frontend.audio.frame(output.snapshot,listeners,[],now,audioBatches);
      return output;
    } catch (error) { await this.capture?.beforeWorldChange(); throw error; }
    finally { this.stepping = false; }
  }

  requestQuit(): undefined { this.stopping = true; return undefined; }
  async run(): Promise<void> {
    let previous = performance.now();
    while (!this.stopping && !this.closed && (this.options.frameLimit === null || this.frames < this.options.frameLimit)) {
      const now = performance.now(), elapsed = now - previous;
      if (elapsed < 4) { await Bun.sleep(4 - elapsed); continue; }
      previous = now;
      const generation = this.videoRestart?.generation;
      await this.step(elapsed);
      if (this.videoRestart?.generation !== generation) previous = performance.now();
      await setImmediate();
    }
  }
  readPixels(): Uint8Array { return this.renderer.readPixels(); }
  captureNextFrame(): Promise<Uint8Array> { return this.renderer.captureNextFrame().then(frame => frame.pixels); }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closing = true; this.stopping = true;
    this.closeResult = this.closeOwned();
    return this.closeResult;
  }
  private async closeOwned(): Promise<void> {
    const errors: unknown[] = [];
    for(const peer of [...this.remoteSeats])try{await this.retireRemoteSeat(peer,false);}catch(error){errors.push(error);}
    if (this.ownership.kind === "borrowed") { try { await this.ownership.client.stopRecording(this); } catch (error) { errors.push(error); } }
    try { await this.ownedRecording?.stop(); } catch (error) { errors.push(error); }
    if (this.peerAdmission !== null) {
      const canceled = new Error("Remote source retired during peer configuration");
      this.peerAdmission.suspension?.cancel(canceled); this.peerAdmission = null;
      const outcome = await this.pendingAdvance?.completion;
      this.pendingAdvance = null;
      if (outcome?.kind === "failed" && outcome.error !== canceled) errors.push(outcome.error);
    }
    try { this.stopCinematic(); } catch (error) { errors.push(error); }
    try { this.ownedVideoRestart?.close(); } catch (error) { errors.push(error); }
    this.ownedVideoRestart = null;
    if (this.configurationPublished && (this.ownership.kind === "owned" || this.ownership.client.source.current === this)) {
      try { await this.saveSourceSettings(); } catch (error) { errors.push(error); }
    }
    if (this.ownership.kind === "borrowed" && this.ownership.client.source.current === this) {
      try { await this.ownership.client.capture.beforeWorldChange(); } catch (error) { errors.push(error); }
      try { this.ownership.client.activateFrontend(); } catch (error) { errors.push(error); }
      this.ownership.client.source.current = null;
    }
    const closingDuringStep = this.stepping;
    if (closingDuringStep) { try { this.q3Browser?.close(); } catch (error) { errors.push(error); } }
    try { if (this.ownership.kind === "owned") await this.capture?.close(); } catch (error) { errors.push(error); }
    this.capture = null;
    if (!closingDuringStep) {
      try { await this.presentation?.q3Client?.shutdown(); } catch (error) { errors.push(error); }
    }
    if (!closingDuringStep) { try { this.q3Browser?.close(); } catch (error) { errors.push(error); } }
    try { this.releaseSettings(); } catch (error) { errors.push(error); }
    try { this.clearSourcePresentation(); } catch (error) { errors.push(error); }
    try { this.disconnectSource(); } catch (error) { errors.push(error); }
    this.closed = true; this.stopping = true; this.worldLoadGeneration++; this.clientInputs = [];
    const frontend = this.frontend; this.frontend = null;
    for (const close of [() => this.remoteContent?.mounts.close(), () => this.qwDownloads?.close(), () => this.q3Downloads?.close(), () => { if (this.source.kind === "live") this.source.network.close(); else this.source.playback.close(); }, () => { if (this.source.kind === "live") this.source.transport.close(); }, () => this.controls?.close(), () => frontend?.audio.close(),
      () => frontend?.effects.close(), () => frontend?.art.close(), () => frontend?.assets.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    try { await this.retireFrontends(); } catch (error) { errors.push(error); }
    try { this.renderer.execute({ owner: this.renderer.owner, sequence: this.frames, commands: [] }); } catch (error) { errors.push(error); }
    for (const [name, handler] of this.sourceHandlers) this.clientCommands?.commands.unregister(name, handler);
    if (this.ownership.kind === "owned" || this.ownership.client.prepared.scripts !== this.clientCommands?.scripts && this.ownership.client.configuration.current.scripts !== this.clientCommands?.scripts) {
      try { await this.clientCommands?.scripts.close(); } catch (error) { errors.push(error); }
    }
    if (this.ownership.kind === "owned") {
      for (const close of [() => this.session.close(), () => this.renderer.close(), () => this.imageSettings.close()]) {
        try { await close(); } catch (error) { errors.push(error); }
      }
    }
    try { if (this.browser.kind === "owned") await this.serverBrowser.close(); } catch (error) { errors.push(error); }
    try { await this.loadedContent?.close(); } catch (error) { errors.push(error); }
    try { if(!this.configuration.identities.published)this.configuration.identities.discard(); } catch(error){errors.push(error);}
    try { await this.configuration.images.settings.close(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Remote application shutdown failed");
  }
}

async function prepareRemoteConfiguration(options: ApplicationOptions, content: MountedApplicationContent, session: EngineSession,
  imageSettings: ApplicationImageSettings, ownership: RemoteOwnership, host: ApplicationHost, cheatsAllowed: () => boolean, current?: RemoteConfiguration, selectedContent?: ApplicationConfigurationContent): Promise<RemoteConfiguration> {
  const selected = selectedContent ?? remoteConfigurationContent(options, content);
  const dialect = selected.selection.timing.find(timing => timing.provider === selected.selection.engineBehavior.provider)?.clock.kind;
  if (dialect === undefined) throw new Error("Remote configuration has no source timing");
  const borrowedSeats = ownership.kind === "borrowed" ? [...ownership.client.locals].sort((a, b) => {
    const order = (id: SeatId): number => { const index = ownership.client.prepared.seats.findIndex(seat => seat.id.equals(id)); return index < 0 ? 4 + id.index : index; };
    return order(a.seat.id) - order(b.seat.id);
  }) : [];
  const retainedSeats = current === undefined ? borrowedSeats : [...current.seats, ...current.identities.selected.map(entry => entry.seat).filter(seat => !current.seats.includes(seat))].map(seat => {
    const prepared = current.prepared.seats.find(owner => owner.id.equals(seat.id));
    if (prepared === undefined) throw new Error("Active remote seat lost its profile");
    return { client: seat.client, seat, prepared };
  });
  const identities = prepareRemoteSeatIdentities(session,retainedSeats,options.seats);
  let seedScripts:ConsoleScriptFiles|null=null;
  try {
  const seats = identities.selected.map(entry=>entry.seat), seat=current?.seat ?? seats[0];
  if(seat===undefined)throw new Error("Remote configuration has no primary seat");
  const retained = retainedSeats.find(entry=>entry.seat===seat);
  const sourceContext: CommandContext = { session: session.session, origin: { kind: "local-console" } };
  const product = content.catalog.require(options.product);
  const settings = new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
  const seatSources=new Map<SeatId,CvarRegistry>();
  const transfers = new Map<CvarRegistry, { readonly owner: CvarRegistry; readonly transfer: ReturnType<CvarRegistry["prepareCandidate"]> }>();
  for(const seat of seats){
    const context:CommandContext={session:session.session,origin:{kind:"local-seat",seat:seat.id,client:seat.client.id}};
    const retained=retainedSeats.find(entry=>entry.seat===seat);
  const original = current?.seatSources.get(seat.id);
  const transfer = original?.dialect === dialect ? original.prepareCandidate(host.print) : undefined;
  const cvars = transfer?.cvars ?? new CvarRegistry({ dialect, context, print: host.print, cheatsAllowed });
  if (original !== undefined && transfer !== undefined) transfers.set(cvars, { owner: original, transfer });
  if (transfer === undefined && retained?.prepared.cvars.dialect === dialect) cvars.restoreSaveState(retained.prepared.cvars.captureWorldTransferState());
  registerFrameTimeCvars(cvars);
  if(dialect==="q1-netquake"){cvars.register("name",seat.id.index===0?"Player":`Player ${seat.id.index+1}`,CvarFlag.Archive | (options.network.kind === "unified-client" ? CvarFlag.UserInfo : 0));cvars.register("color","0",CvarFlag.Archive);}
  if(dialect==="q1-netquake" && options.network.kind==="unified-client")cvars.register("password","",CvarFlag.UserInfo);
  if(dialect==="q2-classic" || dialect==="q2-rerelease") {
    const flags=CvarFlag.Archive|CvarFlag.UserInfo;
    for(const [name,value] of [["name",seat.id.index===0?"Player":`Player ${seat.id.index+1}`],["skin",`${options.characterModel}/${options.characterModel==="female"?"athena":options.characterModel==="cyborg"?"oni911":"grunt"}`],["rate","15000"],["msg","1"],["hand","0"],["fov","90"],["gender",options.characterModel==="female"?"female":"male"]] satisfies readonly(readonly[string,string])[])cvars.register(name,value,flags);
    cvars.register("password","",CvarFlag.UserInfo);cvars.register("spectator","0",CvarFlag.UserInfo);
  }
  if (dialect === "q3") initializeQ3ClientCvars(cvars, { name: seat.id.index===0 ? "Player" : `Player ${seat.id.index+1}`, model: options.characterModel });
  if (dialect === "q1-quakeworld") {
    cvars.register("cl_hightrack", "0", 0); cvars.register("cl_chasecam", "0", 0);
    cvars.register("rate", "25000", CvarFlag.Archive | CvarFlag.UserInfo);
    cvars.register("noskins", "0", CvarFlag.Archive); cvars.register("baseskin", "base", CvarFlag.Archive);
    for (const variable of [{ name: "name", value: "unnamed" }, { name: "team", value: "" }, { name: "skin", value: "" },
      { name: "topcolor", value: "0" }, { name: "bottomcolor", value: "0" }, { name: "noaim", value: "0" }, { name: "msg", value: "1" }])
      cvars.register(variable.name, variable.value, CvarFlag.Archive | CvarFlag.UserInfo);
    cvars.register("password", "", CvarFlag.UserInfo);
  }
    seatSources.set(seat.id,cvars);
  }
  const cvars=seatSources.get(seat.id);
  if(cvars===undefined)throw new Error("Remote source registry is missing");
  const downloadPermissions = new Map(current?.source.dialect===dialect ? current.downloadPermissions : undefined);
  for (const [id, registry] of seatSources) if (!downloadPermissions.has(id)) {
    downloadPermissions.set(id, dialect === "q3" ? createClientDownloadPermission(registry, "q3")
      : dialect === "q2-classic" || dialect === "q2-rerelease" ? createClientDownloadPermission(registry, "q2") : null);
  }
  const downloadPermission = downloadPermissions.get(seat.id) ?? null;
  const socks = current?.socks ?? new ClientSocksSettings(sourceContext, host.print);
  const stagedSocks = current === undefined ? null : socks.cvars.prepareCandidate(host.print);
  if (stagedSocks !== null) transfers.set(stagedSocks.cvars, { owner: socks.cvars, transfer: stagedSocks });
  const stagedRouting = (base: CommandCvarRouting): CommandCvarRouting => {
    const routing = socks.route(base);
    const stage = (registry: CvarRegistry): CvarRegistry => registry === socks.cvars && stagedSocks !== null ? stagedSocks.cvars : registry;
    return { owner: (name, context) => stage(routing.owner(name, context)), visible: context => routing.visible(context).map(stage) };
  };
  seedScripts = current === undefined && ownership.kind === "owned" ? new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings, mounted: undefined }) : null;
  const seed = new CvarRegistry({ dialect, context: sourceContext, print: host.print });
  const prepared = current?.prepared ?? (ownership.kind === "borrowed" ? ownership.client.prepared : seedScripts === null
    ? (() => { throw new Error("Owned remote configuration requires its script owner"); })()
    : new PreparedStartup(seed, seed, seedScripts, { startupCommands: options.startupCommands ?? [], dialect, movementDialect: dialect,
      seats: seats.map(seat=>{const context:CommandContext={session:session.session,origin:{kind:"local-seat",seat:seat.id,client:seat.client.id}};
        return {id:seat.id,context,cvars:new CvarRegistry({dialect,context,print:host.print}),mouse:new MouseSettings(new CvarRegistry({dialect,context,print:host.print})),profile:null,archive:[],mouseArchive:[]};}),
      shared: imageSettings.cvars, sharedNames: [], print: host.print, forward: () => undefined }));
  const inputs=seats.map(seat=>({seat,input:prepared.seats.find(candidate=>candidate.id.equals(seat.id))?.input
    ??new SeatInput({seat:seat.id,dialect,context:{session:session.session,origin:{kind:"local-seat",seat:seat.id,client:seat.client.id}},commands:prepared.commands,uiEvent:()=>false})}));
  const images = imageSettings.prepareClientSettings();
  try {
    const sameProfile = current !== undefined && current.profile.options.product === options.product && current.source.dialect === dialect || ownership.kind === "borrowed" && ownership.client.configuration.current.options.product === options.product
      && retained?.prepared.cvars.dialect === dialect;
    const archive = sameProfile ? null : await settings.loadText("settings/client.cfg");
    const profile = await prepareProfileConfiguration({ prepared, clientSource: { inputState: current === undefined && ownership.kind === "owned" ? "fresh" : "retained", ...(current === undefined && ownership.kind === "owned" ? { startupCommands: options.startupCommands ?? [] } : {}), cvars, archive, seatCvars:seatSources, seatArchives:new Map([...seatSources].map(([id,registry])=>[id,sameProfile && retainedSeats.some(retained=>retained.seat.id.equals(id))?registry.archiveEntries():[]])), route: stagedRouting },
      seats: inputs, options, content: selected, settings, shared: images.settings.cvars, host, sourceArchive: sameProfile ? cvars.archiveEntries() : [], defaultCapacity: 1,
      nextFrame: async () => { await setImmediate(); } });
    if(options.network.kind === "unified-client" && current !== undefined && current.source.dialect !== dialect) {
      for(const [id,registry] of seatSources) for(const name of ["name","password"]) {
        const identity=current.seatSources.get(id)?.get(name),destination=registry.get(name);
        if(identity!==undefined && destination!==undefined && (identity.flags&CvarFlag.UserInfo)!==0 && (destination.flags&CvarFlag.UserInfo)!==0)
          registry.set(destination.name,identity.value);
      }
    }
    const remap = (registry: CvarRegistry): CvarRegistry => transfers.get(registry)?.owner ?? registry;
    const routing = socks.route(profile.routing);
    return { prepared, profile, seat, seats, seatSources: new Map([...(current?.seatSources ?? []), ...[...seatSources].map(([id, registry]): [SeatId, CvarRegistry] => [id, remap(registry)])]), identities, settings, socks, images, downloadPermission, downloadPermissions, source: remap(profile.source),
      routing: { owner: (name, context) => remap(routing.owner(name, context)), visible: context => routing.visible(context).map(remap) },
      prepareTransport: transport => socks.connect(transport, identities.published ? socks.cvars : stagedSocks?.cvars ?? socks.cvars),
      validateSource() { if(!identities.published)identities.validate(); for (const { transfer } of transfers.values()) transfer.validatePublication(); },
      publishSource() { if(!identities.published)identities.publish(); for (const { transfer } of transfers.values()) transfer.publish(); } };
  } catch (error) {
    try { await images.settings.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Remote configuration preparation failed"); }
    throw error;
  }
  } catch (error) {
    const failures:unknown[]=[error];
    try{identities.discard();}catch(cleanup){failures.push(cleanup);}
    const retired=seedScripts;seedScripts=null;
    try{await retired?.close();}catch(cleanup){failures.push(cleanup);}
    if(failures.length>1)throw new AggregateError(failures,"Remote configuration preparation cleanup failed");
    throw error;
  } finally {await seedScripts?.close();}
}

function requireQwAddress(address: ApplicationNetworkAddress) {
  if (address.kind === "ipx") throw new Error("QuakeWorld requires UDP");
  return address;
}
