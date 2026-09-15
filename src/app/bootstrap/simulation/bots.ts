import type { SourceBotDirectorHost } from "../../../bots/behavior/director.ts";
import { createBotArsenalBinding, type BotArsenalBinding } from "./bot-arsenal.ts";
import { SaveReader } from "../../../persistence/value.ts";
import type { ApplicationBotNavigation, ApplicationBotNavigationCheckpoint } from "./navigation.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { createSharedBotWorld } from "./bot-world.ts";
import type { SourceBotGame } from "../../../bots/behavior/q3/game-host.ts";
import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import type { ActorCommand, SavedActorId } from "../../../contracts/session.ts";
import type { UserCommand } from "../../../content/q3/base/shared/player-state.ts";
import { ServerEntityFlags } from "../../../content/q3/base/shared/entity-shared.ts";
import { Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import { tokenizeCommand } from "../../../core/commands/text.ts";
import { SourceBotDirector, SharedBotPopulation, q3BotGame, q3BotNavigation } from "../../../bots/behavior/index.ts";
import type { BotSourceFiles, SelectedBotNavigation } from "../../../bots/behavior/index.ts";
import type { BotLogIoResult, BotLogOpenResult } from "../../../bots/behavior/library/log.ts";
import { MAX_WEAPON_STATES } from "../../../bots/behavior/library/weapons.ts";
import { MAX_RELIABLE_COMMANDS, ServerReliableCommands } from "../../../network/q3/reliable.ts";
import type { EngineSession, SessionClient } from "../../../world/session/session.ts";
import { selectApplicationQ3Snapshot } from "../q3-client/visibility.ts";
import { selectedQ3Command } from "./q3-commands.ts";
import type { Q3SourceRuntime } from "./q3/runtime.ts";
import type { Q3SourceBots } from "./q3/types.ts";
import type { SharedSimulation } from "./runtime.ts";
import type { SimulationPresentationEvent } from "./types.ts";

/** Stable source imports are installed before the game and bound before bot admission. */
export class SimulationBotServices {
  isBot(actor: ActorId): boolean { return this.transport?.isBot(actor) ?? false; }
  get configuration(): CvarRegistry | null { return this.transport?.game.options.cvars ?? null; }
  checkpoint(): ApplicationBotsCheckpoint | null { return this.transport?.checkpoint() ?? null; }
  private director: SourceBotDirector | null = null;
  private transport: ApplicationBots | null = null;
  frame(time: number, elapsed: number): readonly ActorCommand[] { return this.transport?.options.automaticFrame === true ? this.transport.frame(time, elapsed) : []; }
  readonly source: Q3SourceBots = {
    kind: "available",
    connect: (client, restart) => this.require().connect(client, restart),
    shutdownClient: (client, restart) => this.require().shutdownClient(client, restart),
    removeQueuedBegin: client => { this.director?.removeQueuedBegin(client); },
    testAas: origin => { this.director?.testAas(origin); },
    interbreedEndMatch: () => { this.director?.interbreedEndMatch(); },
    consoleCommand: argv => this.require().consoleCommand(argv),
  };
  attach(director: SourceBotDirector, transport: ApplicationBots): void {
    if (this.director !== null) throw new Error("Source bot services already have a director");
    this.director = director; this.transport = transport;
  }
  detach(director: SourceBotDirector): void {
    if (this.director !== director) throw new Error("Cannot detach a different source bot director");
    this.director = null; this.transport = null;
  }
  private require(): SourceBotDirector {
    if (this.director === null) throw new Error("Source bot transport must be attached before bot commands");
    return this.director;
  }
}

export interface ApplicationBotsOptions {
  readonly session: EngineSession;
  readonly simulation: SharedSimulation;
  readonly files: BotSourceFiles;
  readonly navigation: SelectedBotNavigation | ApplicationBotNavigation;
  readonly leafCount: number;
  readonly configuration?: CvarRegistry;
  readonly restart?: boolean;
  readonly automaticFrame?: boolean;
  /** Existing bot connections survive source map restart/new-map session replacement. */
  readonly clients?: readonly ApplicationBotClient[];
  readonly restore?: {
    readonly image: DecodedApplicationBotsCheckpoint;
    resolveClient(saved: { readonly slot: number; readonly generation: number }): SessionClient | null;
  };
  insertConsoleCommand(text: string): void;
  print(text: string): void;
  openLog(filename: string): BotLogOpenResult;
  resumeLog?(filename: string, position: number): BotLogOpenResult;
}

export interface ApplicationBotClient {
  readonly client: SessionClient;
  readonly reliable: ServerReliableCommands;
  readonly userinfo?: string;
}
interface BotConnection extends ApplicationBotClient { readonly actor: OwnedActor; }

/** Transport state only; the director and shared observation world are separate owners. */
export interface ApplicationBotTransportCheckpoint {
  readonly version: 1;
  readonly elapsedMilliseconds: number;
  readonly connections: readonly {
    readonly client: { readonly slot: number; readonly generation: number };
    readonly actor: SavedActorId;
    readonly reliable: { readonly sequence: number; readonly acknowledge: number; readonly slots: readonly string[] };
  }[];
  readonly snapshots: readonly { readonly client: number; readonly entities: readonly number[] }[];
}

export interface ApplicationBotsCheckpoint {
  readonly version: 1;
  readonly transport: ApplicationBotTransportCheckpoint;
  readonly director: ReturnType<SourceBotDirector["captureSaveState"]>;
  readonly navigation: ApplicationBotNavigationCheckpoint;
  readonly knowledge: ReturnType<BotArsenalBinding["checkpoint"]> | null;
  readonly sharedWorld: ReturnType<ReturnType<typeof createSharedBotWorld>["checkpoint"]> | null;
  readonly observations: readonly { readonly number: number; readonly actor: SavedActorId }[];
}
export interface DecodedApplicationBotsCheckpoint {
  readonly version: 1;
  readonly transport: ApplicationBotTransportCheckpoint;
  readonly director: unknown;
  readonly navigation: unknown;
  readonly knowledge: unknown;
  readonly sharedWorld: unknown;
  readonly observations: readonly { readonly number: number; readonly actor: SavedActorId }[];
}
export function decodeApplicationBotsCheckpoint(value: unknown): DecodedApplicationBotsCheckpoint {
  const reader = new SaveReader(value, "application.bots");
  return { version: reader.field("version").literal(1), transport: decodeBotTransport(reader.field("transport").value),
    director: reader.field("director").value, navigation: reader.field("navigation").value,
    knowledge: reader.field("knowledge").value, sharedWorld: reader.field("sharedWorld").value,
    observations: reader.field("observations").list(entry => ({ number: entry.field("number").integer(0),
      actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) } })) };
}
function decodeBotTransport(value: unknown): ApplicationBotTransportCheckpoint {
  const reader = new SaveReader(value, "application.bots.transport");
  return { version: reader.field("version").literal(1), elapsedMilliseconds: reader.field("elapsedMilliseconds").finite(),
    connections: reader.field("connections").list(entry => ({
      client: { slot: entry.field("client").field("slot").integer(0), generation: entry.field("client").field("generation").integer(0) },
      actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) },
      reliable: { sequence: entry.field("reliable").field("sequence").integer(0), acknowledge: entry.field("reliable").field("acknowledge").integer(),
        slots: entry.field("reliable").field("slots").list(slot => slot.string()) } })),
    snapshots: reader.field("snapshots").list(entry => ({ client: entry.field("client").integer(0), entities: entry.field("entities").list(entity => entity.integer(0)) })) };
}
function persistentNavigation(navigation: SelectedBotNavigation | ApplicationBotNavigation): ApplicationBotNavigation {
  if (!("checkpoint" in navigation) || !("restoreCheckpoint" in navigation)) throw new Error("Exact bot persistence requires navigation continuation support");
  return navigation;
}

class RestoredBotReliableCommands extends ServerReliableCommands {
  constructor(image: ApplicationBotTransportCheckpoint["connections"][number]["reliable"]) {
    super();
    if (!Number.isInteger(image.sequence) || image.sequence < 0 || image.sequence > 0x7fffffff
      || !Number.isInteger(image.acknowledge) || image.acknowledge < -0x80000000 || image.acknowledge > 0x7fffffff
      || image.slots.length !== MAX_RELIABLE_COMMANDS) throw new Error("Invalid saved bot reliable command ring");
    for (const [index, text] of image.slots.entries()) {
      if (text.length > 1023 || text.includes("\0")) throw new Error("Invalid saved bot reliable command text");
      this.replace(index, text);
    }
    this.currentSequence = image.sequence;
    this.acknowledgedSequence = image.acknowledge;
  }
}

/** Local bot connections consume the same source snapshot selector and reliable command ring as clients. */
export class ApplicationBots {
  readonly director: SourceBotDirector;
  readonly population: SharedBotPopulation;
  private sourceValue: Q3SourceRuntime | null;
  private gameValue: SourceBotGame;
  get source(): Q3SourceRuntime | null { return this.sourceValue; }
  get game(): SourceBotGame { return this.gameValue; }
  private restartPhase: { readonly kind: "active" }
    | { readonly kind: "detached"; readonly source: Q3SourceRuntime; readonly clients: readonly ApplicationBotClient[] }
    | { readonly kind: "bound"; readonly clients: readonly ApplicationBotClient[]; readonly pending: Set<number> } = { kind: "active" };
  private arsenal: BotArsenalBinding | null;
  private readonly shared: ReturnType<typeof createSharedBotWorld> | null;
  private readonly connections = new Map<number, BotConnection>();
  private readonly snapshots = new Map<number, readonly number[]>();
  private elapsedMilliseconds = 0;
  private closed = false;

  constructor(readonly options: ApplicationBotsOptions) {
    const error = botAdmissionError(options.simulation);
    if (error !== null) throw new Error(error);
    const source = options.simulation.q3Source();
    if (options.session.session !== options.simulation.session) throw new Error("Bot clients and simulation belong to different sessions");
    this.sourceValue = source;
    this.arsenal = source === null ? null : createBotArsenalBinding(options.simulation, client =>
      options.simulation.players().find(actor => options.simulation.movementPlayer(actor)?.client.slot === client) ?? null);
    if (source === null && options.configuration === undefined) throw new Error("Shared bot configuration requires the application console registry");
    this.shared = source === null && options.configuration !== undefined ? createSharedBotWorld({ simulation: options.simulation, cvars: options.configuration,
      restoring: options.restore !== undefined,
      actor: client => this.connections.get(client)?.actor.id ?? null,
      connect: (client, restart) => this.director.connect(client, restart), drop: client => { this.disconnect(client); },
      begin: client => { const actor = this.connections.get(client)?.actor.id;
        if (actor === undefined) throw new Error("Bot begin has no actual player");
        const player = options.simulation.movementPlayer(actor);
        if (player === null) throw new Error("Bot begin has no actual view");
        this.resetView(actor, player.viewAngles);
        this.resetWeapon(actor);
      },
      print: options.print, console: options.insertConsoleCommand,
      message: (client, text) => { for (const [slot, connection] of this.connections) if (client === -1 || client === slot) connection.reliable.add(text); } }) : null;
    const game = source === null ? this.shared?.game : q3BotGame(source, options.insertConsoleCommand, this.arsenal ?? undefined);
    if (game === undefined) throw new Error("Bot world projection is unavailable");
    this.gameValue = game;
    this.director = new SourceBotDirector({ files: options.files, entities: source?.options.entities ?? options.simulation.sourceEntityText,
      restoring: options.restore !== undefined,
      host: this.directorHost(game),
      library: { files: options.files, random: { nextInt: () => options.simulation.random.nextInteger() }, debug: false,
        milliseconds: () => options.simulation.timeSeconds * 1000,
        print: (_severity, text) => { options.print(text); return undefined; }, openLog: options.openLog,
        ...(options.resumeLog === undefined ? {} : { resumeLog: options.resumeLog }),
        clientCommand: (client, text) => {
          const connection = this.connection(client), argv = tokenizeCommand(text, "q3").argv;
          options.simulation.playerCommand(connection.actor.id, argv[0] ?? "", argv.slice(1)); return undefined;
        } },
      navigation: library => q3BotNavigation(game, library, options.navigation) });
    this.population = new SharedBotPopulation(actor => options.simulation.actors.isLive(actor), this.director);
    let attached = false;
    try {
      if (options.restore !== undefined) {
        this.restoreCheckpoint(options.restore.image, options.restore.resolveClient);
        options.simulation.botServices.attach(this.director, this); attached = true;
      } else {
        options.simulation.botServices.attach(this.director, this); attached = true;
        this.director.load(options.restart ?? false);
        for (const client of options.clients ?? []) this.restoreClient(client);
      }
    } catch (error) {
      if (attached) options.simulation.botServices.detach(this.director);
      try {
        if (options.restore === undefined) this.director.close();
        else this.director.library.log.shutdown();
      } finally { this.director.library.memory.dispose(); }
      throw error;
    }
  }

  checkpoint(): ApplicationBotsCheckpoint {
    if (this.closed) throw new Error("Cannot checkpoint a closed bot transport");
    const observations: { readonly number: number; readonly actor: SavedActorId }[] = [];
    if (this.source !== null) {
      for (const [number, record] of this.source.records.captureOwnership().entries()) {
        if (record.actor === null) continue;
        const actor = record.actor.id;
        observations.push({ number, actor: { slot: actor.slot, generation: actor.generation } });
      }
    } else {
      for (const actor of this.options.simulation.players()) {
        const player = this.options.simulation.movementPlayer(actor);
        if (player !== null) observations.push({ number: player.client.slot, actor: { slot: actor.slot, generation: actor.generation } });
      }
    }
    const knowledge = this.arsenal ?? this.shared?.knowledge ?? null;
    return { version: 1, transport: this.checkpointOrchestration(), director: this.director.captureSaveState(),
      navigation: persistentNavigation(this.options.navigation).checkpoint(), knowledge: knowledge?.checkpoint() ?? null,
      sharedWorld: this.shared?.checkpoint() ?? null, observations };
  }
  private restoreCheckpoint(image: DecodedApplicationBotsCheckpoint,
    resolveClient: (saved: { readonly slot: number; readonly generation: number }) => SessionClient | null): void {
    const simulation = this.options.simulation, navigation = persistentNavigation(this.options.navigation);
    const actor = (saved: SavedActorId) => simulation.actors.referenceSaved(saved);
    if ((image.sharedWorld === null) !== (this.shared === null)) throw new Error("Saved bot world projection differs from selected source");
    navigation.restoreCheckpoint(image.navigation);
    this.shared?.restoreCheckpoint(image.sharedWorld, actor);
    this.restoreOrchestration(image.transport, resolveClient);
    const observations = new Map<number, SavedActorId>();
    const nativeOwnership = this.source?.records.captureOwnership();
    for (const entry of image.observations) {
      if (observations.has(entry.number) || this.source === null && entry.number >= 64) throw new Error("Invalid saved bot observation authority");
      const current = nativeOwnership?.[entry.number]?.actor?.id ?? this.shared?.actorForId(entry.number) ?? null;
      if (current === null || !current.equals(actor(entry.actor))) throw new Error("Saved bot observation authority differs from restored source");
      observations.set(entry.number, entry.actor);
    }
    if (observations.size !== (nativeOwnership?.filter(record => record.actor !== null).length ?? simulation.players().length)) throw new Error("Saved bot observation authority is incomplete");
    this.director.restoreSaveState(image.director, actor, saved => simulation.actors.resolveSaved(saved),
      (client, edge) => navigation.forClient(client).graph.edges.find(value => value.id === edge) ?? null,
      (number, generation) => {
        const saved = observations.get(number);
        return { number, generation: saved === undefined || generation === 0 ? generation : actor({ slot: saved.slot, generation }).generation };
      });
    const knowledge = this.arsenal ?? this.shared?.knowledge ?? null;
    if ((image.knowledge === null) !== (knowledge === null)) throw new Error("Saved bot arsenal knowledge differs from selected source");
    knowledge?.restoreCheckpoint(image.knowledge, actor, handle => {
      if (!Number.isInteger(handle) || handle < 0 || handle > MAX_WEAPON_STATES) throw new Error("Saved bot knowledge weapon handle exceeds source capacity");
      return handle;
    });
  }

  private directorHost(game: SourceBotGame): SourceBotDirectorHost {
    return { game, provider: "q3:bot", allocateClient: () => this.allocateClient(),
      actor: client => this.connections.get(client)?.actor ?? null,
      encodeCommand: (client, command) => this.encodeCommand(client, command),
      snapshotEntity: (client, sequence) => this.snapshotEntity(client, sequence),
      consoleMessage: client => this.consoleMessage(client), pointContents: point => game.world.pointContents(point, -1) };
  }
  beginRoundRestart(): readonly ApplicationBotClient[] {
    if (this.closed || this.restartPhase.kind !== "active" || this.source === null) throw new Error("Bot fast restart requires an active native Q3 round");
    const navigation = this.options.navigation;
    if (!("restartRound" in navigation)) throw new Error("Bot fast restart requires retained application navigation");
    const clients = this.clients(), source = this.source;
    this.director.beginRoundRestart();
    this.options.simulation.botServices.detach(this.director);
    this.connections.clear(); this.snapshots.clear(); this.elapsedMilliseconds = 0;
    this.restartPhase = { kind: "detached", source, clients };
    return clients;
  }
  bindRestartedRound(): void {
    const phase = this.restartPhase, source = this.options.simulation.q3Source(), navigation = this.options.navigation;
    if (this.closed || phase.kind !== "detached" || source === null || source === phase.source) throw new Error("Publish a new source round before rebinding bots");
    if (!("restartRound" in navigation)) throw new Error("Bot fast restart lost application navigation");
    navigation.restartRound();
    this.sourceValue = source;
    this.arsenal = createBotArsenalBinding(this.options.simulation, client => this.connections.get(client)?.actor.id ?? null);
    const game = q3BotGame(source, this.options.insertConsoleCommand, this.arsenal ?? undefined);
    this.gameValue = game;
    this.director.bindRestartedRound(this.directorHost(game), library => q3BotNavigation(game, library, navigation));
    this.options.simulation.botServices.attach(this.director, this);
    this.restartPhase = { kind: "bound", clients: phase.clients, pending: new Set(phase.clients.filter(client => !client.client.isClosed).map(client => client.client.id.slot)) };
  }
  /** Call once for each preserved slot after the three source settle frames; humans return false. */
  reconnectRestartedClient(client: ClientId): boolean {
    const phase = this.restartPhase;
    if (this.closed || phase.kind !== "bound") throw new Error("Bind the new bot round before reconnecting clients");
    const saved = phase.clients.find(entry => entry.client.id.equals(client));
    if (saved === undefined) return false;
    if (saved.client.isClosed) { phase.pending.delete(client.slot); return true; }
    if (!phase.pending.has(client.slot)) throw new Error("Bot restart client was already reconnected");
    if (!this.appendReliable(saved, "map_restart\n")) return true;
    this.restoreClient(saved);
    phase.pending.delete(client.slot);
    return true;
  }
  /** The caller owns the final source settle frame and must complete it before resuming. */
  resumeRoundBots(): void {
    const phase = this.restartPhase;
    if (this.closed || phase.kind !== "bound" || phase.pending.size !== 0) throw new Error("Reconnect every preserved bot before resuming");
    this.director.resumeRoundBots();
    this.restartPhase = { kind: "active" };
  }

  private connection(client: number): BotConnection {
    const connection = this.connections.get(client);
    if (connection === undefined) throw new Error(`Source bot ${client} has no session connection`);
    return connection;
  }
  private prepare(client: SessionClient, reliable = new ServerReliableCommands()): BotConnection {
    if (client.isClosed) throw new Error("Cannot admit a closed bot client");
    const actor = this.options.simulation.prepareBotClient(client.id);
    const connection = { client, actor, reliable };
    this.connections.set(client.id.slot, connection);
    return connection;
  }
  private allocateClient(): number {
    const simulation = this.options.simulation;
    const occupied = new Set(simulation.players().map(actor => simulation.movementPlayer(actor)?.client.slot));
    for (let slot = 0; slot < this.game.maxClients; slot++) {
      if (occupied.has(slot)) continue;
      const client = this.options.session.createClient(slot);
      try { this.prepare(client); } catch (error) { this.options.session.closeClient(client.id); throw error; }
      return slot;
    }
    return -1;
  }
  private restoreClient(connection: ApplicationBotClient): void {
    const { client } = connection;
    this.prepare(client, connection.reliable);
    if (this.source === null) {
      this.game.activateBot(client.id.slot);
      this.game.options.engine.setUserinfo(client.id.slot, connection.userinfo ?? "");
      const rejection = this.game.clientConnect(client.id.slot, false, true);
      if (rejection !== null) throw new Error(rejection);
      this.game.clientBegin(client.id.slot); return;
    }
    this.game.options.engine.setUserinfo(client.id.slot, connection.userinfo ?? this.game.options.engine.getUserinfo(client.id.slot));
    const entity = this.source.pool.at(client.id.slot);
    entity.r.svFlags |= ServerEntityFlags.BOT;
    this.source.pool.activateClient(client.id.slot);
    const rejection = this.source.admission.connect(client.id.slot, false, true);
    if (rejection !== null) throw new Error(`Source bot restoration rejected: ${rejection}`);
    this.source.admission.begin(client.id.slot);
  }
  private encodeCommand(client: number, command: UserCommand): Pick<ActorCommand, "command" | "arsenal"> {
    const connection = this.connection(client), player = this.options.simulation.movementPlayer(connection.actor.id);
    if (player === null) throw new Error("Admitted bot has no selected movement player");
    if (this.shared !== null) return { command: selectedQ3Command(command, player, this.elapsedMilliseconds),
      arsenal: { provider: player.arsenal.provider, weapon: this.shared.knowledge.resolveWeapon(client, command.weapon), useHoldable: false } };
    if (this.source === null) throw new Error("Bot source observation is unavailable");
    const sourcePlayer = this.source.pool.at(client).client;
    if (sourcePlayer === null) throw new Error("Source bot lost its player state");
    const angles = player.profile.kind === "q3" ? command.angles : {
      x: (command.angles.x + sourcePlayer.ps.deltaAngles.x) & 65535,
      y: (command.angles.y + sourcePlayer.ps.deltaAngles.y) & 65535,
      z: (command.angles.z + sourcePlayer.ps.deltaAngles.z) & 65535 };
    const weapon = this.arsenal === null ? Q3_WEAPON_ITEMS.find(item => item.weapon === command.weapon)?.item ?? null
      : this.arsenal.resolveWeapon(client, command.weapon);
    return { command: selectedQ3Command({ ...command, angles, weapon: this.arsenal === null ? command.weapon : sourcePlayer.ps.weapon }, player, this.elapsedMilliseconds),
      arsenal: { provider: player.arsenal.provider, weapon, useHoldable: (command.buttons & 4) !== 0 } };
  }

  private snapshotEntity(client: number, sequence: number): number {
    if (!Number.isInteger(sequence) || sequence < -2147483648 || sequence > 2147483647) throw new RangeError("Bot snapshot sequence must be a signed source integer");
    if (sequence < 0) return -1;
    let snapshot = this.snapshots.get(client);
    if (snapshot === undefined && this.source === null) {
      snapshot = Array.from({ length: this.game.entityCount }, (_, number) => number).filter(number => {
        const entity = this.game.entity(number); return entity.present && entity.linked && !entity.hidden;
      });
      this.snapshots.set(client, snapshot);
    }
    if (snapshot === undefined && this.source !== null) {
      const q3 = this.source;
      const source = q3.sourceState(), player = source.clients.find(value => value.slot === client);
      if (player === undefined) return -1;
      snapshot = selectApplicationQ3Snapshot(player.state, source, this.options.simulation.scene,
        number => q3.world.linkState(number)?.absbounds ?? null, this.options.leafCount, this.options.print)
        .entities.map(entity => entity.number);
      this.snapshots.set(client, snapshot);
    }
    return snapshot?.[sequence] ?? -1;
  }
  private consoleMessage(client: number): string | null {
    const ring = this.connection(client).reliable;
    if (ring.acknowledge === ring.sequence) return null;
    ring.assignAcknowledgement(ring.acknowledge + 1);
    return ring.lookupMasked(ring.acknowledge) || null;
  }
  private resetView(actor: ActorId, angles: import("../../../contracts/math.ts").Vec3): void {
    if (!this.options.simulation.actors.isLive(actor)) return;
    const entry = this.director.roster().find(entry => entry.actor.id.equals(actor));
    if (entry === undefined) return;
    Object.assign(entry.state.viewangles, angles); Object.assign(entry.state.idealViewangles, angles);
  }
  private resetWeapon(actor: ActorId): void {
    if (!this.options.simulation.actors.isLive(actor)) return;
    const entry = this.director.roster().find(entry => entry.actor.id.equals(actor));
    if (entry === undefined) return;
    const observed = this.game.entity(entry.sourceClient).player;
    if (observed === null) throw new Error("Bot spawn has no actual arsenal observation");
    entry.state.weaponNum = observed.state.weapon;
  }
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const event of events) {
      if (event.kind === "view-reset" && this.shared !== null) { this.resetView(event.actor, event.angles); if (event.reason === "spawn") this.resetWeapon(event.actor); continue; }
      if (event.kind !== "q3-source" || event.event.kind !== "server-command") continue;
      for (const client of this.clients()) {
        if (event.event.client !== -1 && event.event.client !== client.client.id.slot) continue;
        this.appendReliable(client, event.event.text);
      }
    }
  }
  private appendReliable(client: ApplicationBotClient, text: string): boolean {
    if (client.reliable.add(text).kind !== "overflow") return true;
    this.game.options.engine.dropClient(client.client.id.slot, "Server command overflow");
    this.disconnect(client.client.id.slot);
    return false;
  }
  frame(timeMilliseconds: number, elapsedMilliseconds: number): readonly ActorCommand[] {
    if (this.closed) throw new Error("Bot transport is closed");
    if (this.restartPhase.kind !== "active") return [];
    this.elapsedMilliseconds = elapsedMilliseconds;
    this.snapshots.clear();
    this.shared?.refresh();
    const sourceTime = this.options.automaticFrame === true && this.source !== null && this.source.host.cvars.variableValue("dedicated") !== 0
      ? this.source.level.time : timeMilliseconds;
    return this.population.frame({ timeMilliseconds: sourceTime, elapsedMilliseconds });
  }
  clients(): readonly ApplicationBotClient[] {
    if (this.restartPhase.kind !== "active") return this.restartPhase.clients.filter(client => !client.client.isClosed);
    return Array.from(this.connections.values(), connection => ({ client: connection.client, reliable: connection.reliable, userinfo: this.game.options.engine.getUserinfo(connection.client.id.slot) }));
  }
  checkpointOrchestration(): ApplicationBotTransportCheckpoint {
    if (this.closed) throw new Error("Cannot checkpoint a closed bot transport");
    return { version: 1, elapsedMilliseconds: this.elapsedMilliseconds,
      connections: [...this.connections.values()].map(({ client, actor, reliable }) => ({
        client: { slot: client.id.slot, generation: client.id.generation }, actor: { slot: actor.id.slot, generation: actor.id.generation },
        reliable: { sequence: reliable.sequence, acknowledge: reliable.acknowledge,
          slots: Array.from({ length: MAX_RELIABLE_COMMANDS }, (_, index) => reliable.lookupMasked(index)) },
      })), snapshots: [...this.snapshots].map(([client, entities]) => ({ client, entities: [...entities] })) };
  }
  /** Bind existing restored players without allocating clients, spawning actors or invoking admission. */
  restoreOrchestration(value: unknown,
    resolveClient: (saved: ApplicationBotTransportCheckpoint["connections"][number]["client"]) => SessionClient | null): void {
    const image = decodeBotTransport(value);
    if (this.closed || image.version !== 1 || !Number.isFinite(image.elapsedMilliseconds) || image.elapsedMilliseconds < 0) throw new Error("Invalid bot transport restoration");
    const connections = new Map<number, BotConnection>(), snapshots = new Map<number, readonly number[]>(), actors = new Set<OwnedActor>();
    for (const entry of image.connections) {
      const client = resolveClient(entry.client), actor = this.options.simulation.actors.resolveSaved(entry.actor);
      if (client === null || client.isClosed || client.id.session !== this.options.session.session || client.id.slot !== entry.client.slot
        || actor === null || actors.has(actor) || connections.has(client.id.slot)) throw new Error("Invalid saved bot transport binding");
      const player = this.options.simulation.movementPlayer(actor.id);
      if (player === null || !player.client.equals(client.id)) throw new Error("Saved bot transport does not match the restored player client");
      actors.add(actor);
      connections.set(client.id.slot, { client, actor, reliable: new RestoredBotReliableCommands(entry.reliable) });
    }
    for (const snapshot of image.snapshots) {
      if (!connections.has(snapshot.client) || snapshots.has(snapshot.client)
        || snapshot.entities.some(entity => !Number.isSafeInteger(entity) || entity < 0 || entity >= this.game.entityCount)) throw new Error("Invalid saved bot entity snapshot");
      snapshots.set(snapshot.client, [...snapshot.entities]);
    }
    this.connections.clear(); this.snapshots.clear();
    for (const [client, connection] of connections) this.connections.set(client, connection);
    for (const [client, snapshot] of snapshots) this.snapshots.set(client, snapshot);
    this.elapsedMilliseconds = image.elapsedMilliseconds;
  }
  isBot(actor: ActorId): boolean { return [...this.connections.values()].some(connection => connection.actor.id.equals(actor)); }
  actor(client: ClientId): ActorId | null {
    const connection = this.connections.get(client.slot);
    return connection?.client.id.equals(client) ? connection.actor.id : null;
  }
  consoleCommand(argv: readonly string[]): void { this.director.consoleCommand(argv); }
  disconnect(client: number): boolean {
    const connection = this.connections.get(client);
    const phase = this.restartPhase;
    const sessionClient = connection?.client ?? (phase.kind === "active" ? undefined : phase.clients.find(entry => entry.client.id.slot === client)?.client);
    if (sessionClient === undefined || sessionClient.isClosed) return false;
    if (connection !== undefined) {
      if (this.source === null) this.director.shutdownClient(client, false);
      this.options.simulation.disconnectPlayer(connection.actor.id);
    }
    this.connections.delete(client); this.snapshots.delete(client);
    if (phase.kind === "bound") phase.pending.delete(client);
    this.options.session.closeClient(sessionClient.id);
    return true;
  }
  close(restart = false): void {
    if (this.closed) return;
    this.director.close(restart);
    if (this.restartPhase.kind !== "detached") this.options.simulation.botServices.detach(this.director);
    this.snapshots.clear(); this.connections.clear(); this.closed = true;
  }
}

export function openApplicationBotLog(filename: string): BotLogOpenResult {
  return applicationBotLog(filename, null);
}
export function resumeApplicationBotLog(filename: string, position: number): BotLogOpenResult {
  return applicationBotLog(filename, position);
}
function applicationBotLog(filename: string, resumePosition: number | null): BotLogOpenResult {
  const result = (operation: () => void): BotLogIoResult => {
    try { operation(); return { kind: "ok" }; }
    catch (error) { return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }; }
  };
  try {
    const directory = join(homedir(), ".local", "state", "quake-typescript", "bots");
    if (resumePosition !== null && (!Number.isSafeInteger(resumePosition) || resumePosition < 0)) throw new Error("Invalid saved bot log position");
    if (resumePosition === null) mkdirSync(directory, { recursive: true });
    const descriptor = openSync(join(directory, basename(filename)), resumePosition === null ? "w" : "r+");
    if (resumePosition !== null && fstatSync(descriptor).size < resumePosition) { closeSync(descriptor); throw new Error("Saved bot log position exceeds retained file"); }
    let position = resumePosition ?? 0;
    return { kind: "opened", stream: {
      checkpoint: () => ({ position }),
      write: bytes => result(() => {
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(descriptor, bytes, offset, bytes.length - offset, position);
          if (written === 0) throw new Error("Bot log write made no progress");
          offset += written; position += written;
        }
      }),
      flush: () => result(() => { fsyncSync(descriptor); }),
      close: () => result(() => { closeSync(descriptor); }),
    } };
  } catch (error) { return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }; }
}

export function botAdmissionError(simulation: SharedSimulation): string | null {
  const q3 = simulation.q3Source();
  if (q3 !== null) return simulation.recipe.weapons[0]?.provider.startsWith("q3:") === true
    || q3.options.product === "baseq3" && (simulation.q2WeaponSource() !== null || simulation.q1WeaponSource() !== null) && simulation.options.mode === "deathmatch" && q3.gameType === 0
    ? null : "Q3-map bots support native Q3 weapons or selected Q1/Q2 weapons in base Q3 deathmatch";
  const q1 = simulation.q1Source(), q2 = simulation.q2Source();
  if (simulation.q2WeaponSource() === null && simulation.q1WeaponSource() === null && simulation.selectedQ3WeaponSource() === null) return "Shared bot arsenal observation is unavailable";
  if (simulation.options.mode !== "deathmatch" || q1 !== null && (q1.composition.selection.program !== "id1" || q1.cvars.variableValue("teamplay") !== 0)
    || q2 !== null && q2.product.match.selection.kind !== "standard") return "Shared bots support standard deathmatch; team and campaign objectives are not yet bound";
  return q1 !== null || q2 !== null ? null : "Bot world observation is unavailable";
}
