import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { UserCommand } from "../../../content/q3/base/shared/player-state.ts";
import { ServerEntityFlags } from "../../../content/q3/base/shared/entity-shared.ts";
import { Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import { tokenizeCommand } from "../../../core/commands/text.ts";
import { SourceBotDirector, SharedBotPopulation, q3BotGame, q3BotNavigation } from "../../../bots/behavior/index.ts";
import type { BotSourceFiles, SelectedBotNavigation } from "../../../bots/behavior/index.ts";
import type { BotLogIoResult, BotLogOpenResult } from "../../../bots/behavior/library/log.ts";
import { ServerReliableCommands } from "../../../network/q3/reliable.ts";
import type { EngineSession, SessionClient } from "../../../world/session/session.ts";
import { selectApplicationQ3Snapshot } from "../q3-client/visibility.ts";
import { selectedQ3Command } from "./q3-commands.ts";
import type { Q3SourceRuntime } from "./q3/runtime.ts";
import type { Q3SourceBots } from "./q3/types.ts";
import type { SharedSimulation } from "./runtime.ts";
import type { SimulationPresentationEvent } from "./types.ts";

/** Stable source imports are installed before the game and bound before bot admission. */
export class SimulationBotServices {
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
  readonly navigation: SelectedBotNavigation;
  readonly leafCount: number;
  readonly restart?: boolean;
  readonly automaticFrame?: boolean;
  /** Existing bot connections survive source map restart/new-map session replacement. */
  readonly clients?: readonly ApplicationBotClient[];
  insertConsoleCommand(text: string): void;
  print(text: string): void;
  openLog(filename: string): BotLogOpenResult;
}

export interface ApplicationBotClient {
  readonly client: SessionClient;
  readonly reliable: ServerReliableCommands;
}
interface BotConnection extends ApplicationBotClient { readonly actor: OwnedActor; }

/** Local bot connections consume the same source snapshot selector and reliable command ring as clients. */
export class ApplicationBots {
  readonly director: SourceBotDirector;
  readonly population: SharedBotPopulation;
  readonly source: Q3SourceRuntime;
  private readonly connections = new Map<number, BotConnection>();
  private readonly snapshots = new Map<number, readonly number[]>();
  private elapsedMilliseconds = 0;
  private closed = false;

  constructor(readonly options: ApplicationBotsOptions) {
    const source = options.simulation.q3Source();
    if (source === null) throw new Error("The arena director requires selected Q3 game rules");
    if (options.session.session !== options.simulation.session) throw new Error("Bot clients and simulation belong to different sessions");
    this.source = source;
    const game = q3BotGame(source, options.insertConsoleCommand);
    this.director = new SourceBotDirector({ files: options.files, entities: source.options.entities,
      host: { game, provider: "q3:bot", allocateClient: () => this.allocateClient(),
        actor: client => this.connections.get(client)?.actor ?? null,
        encodeCommand: (client, command) => this.encodeCommand(client, command),
        snapshotEntity: (client, sequence) => this.snapshotEntity(client, sequence),
        consoleMessage: client => this.consoleMessage(client), pointContents: point => source.world.pointContents(point, -1) },
      library: { files: options.files, random: { nextInt: () => options.simulation.random.nextInteger() }, debug: false,
        milliseconds: () => options.simulation.timeSeconds * 1000,
        print: (_severity, text) => { options.print(text); return undefined; }, openLog: options.openLog,
        clientCommand: (client, text) => {
          const connection = this.connection(client), argv = tokenizeCommand(text, "q3").argv;
          source.playerCommand(connection.actor.id, argv[0] ?? "", argv.slice(1)); return undefined;
        } },
      navigation: library => q3BotNavigation(game, library, options.navigation) });
    this.population = new SharedBotPopulation(actor => options.simulation.actors.isLive(actor), this.director);
    options.simulation.botServices.attach(this.director, this);
    try {
      this.director.load(options.restart ?? false);
      for (const client of options.clients ?? []) this.restoreClient(client);
    } catch (error) {
      this.director.close(); options.simulation.botServices.detach(this.director);
      throw error;
    }
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
    for (let slot = 0; slot < this.source.pool.maxClients; slot++) {
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
    if (player.arsenal.state.kind !== "q3") throw new Error("Q3 brain weapon inventory requires a selected arsenal projection");
    const sourcePlayer = this.source.pool.at(client).client;
    if (sourcePlayer === null) throw new Error("Source bot lost its player state");
    const angles = player.profile.kind === "q3" ? command.angles : {
      x: (command.angles.x + sourcePlayer.ps.deltaAngles.x) & 65535,
      y: (command.angles.y + sourcePlayer.ps.deltaAngles.y) & 65535,
      z: (command.angles.z + sourcePlayer.ps.deltaAngles.z) & 65535 };
    const weapon = Q3_WEAPON_ITEMS.find(item => item.weapon === command.weapon)?.item ?? null;
    return { command: selectedQ3Command({ ...command, angles }, player, this.elapsedMilliseconds),
      arsenal: { provider: player.arsenal.provider, weapon, useHoldable: (command.buttons & 4) !== 0 } };
  }

  private snapshotEntity(client: number, sequence: number): number {
    if (!Number.isInteger(sequence) || sequence < -2147483648 || sequence > 2147483647) throw new RangeError("Bot snapshot sequence must be a signed source integer");
    if (sequence < 0) return -1;
    let snapshot = this.snapshots.get(client);
    if (snapshot === undefined) {
      const source = this.source.sourceState(), player = source.clients.find(value => value.slot === client);
      if (player === undefined) return -1;
      snapshot = selectApplicationQ3Snapshot(player.state, source, this.options.simulation.scene,
        number => this.source.world.linkState(number)?.absbounds ?? null, this.options.leafCount, this.options.print)
        .entities.map(entity => entity.number);
      this.snapshots.set(client, snapshot);
    }
    return snapshot[sequence] ?? -1;
  }
  private consoleMessage(client: number): string | null {
    const ring = this.connection(client).reliable;
    if (ring.acknowledge === ring.sequence) return null;
    ring.assignAcknowledgement(ring.acknowledge + 1);
    return ring.lookupMasked(ring.acknowledge) || null;
  }
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const event of events) {
      if (event.kind !== "q3-source" || event.event.kind !== "server-command") continue;
      for (const [slot, connection] of this.connections) {
        if (event.event.client !== -1 && event.event.client !== slot) continue;
        if (connection.reliable.add(event.event.text).kind === "overflow") this.source.host.engine.dropClient(slot, "Server command overflow");
      }
    }
  }
  frame(timeMilliseconds: number, elapsedMilliseconds: number): readonly ActorCommand[] {
    if (this.closed) throw new Error("Bot transport is closed");
    this.elapsedMilliseconds = elapsedMilliseconds;
    this.snapshots.clear();
    const sourceTime = this.options.automaticFrame === true && this.source.host.cvars.variableValue("dedicated") !== 0
      ? this.source.level.time : timeMilliseconds;
    return this.population.frame({ timeMilliseconds: sourceTime, elapsedMilliseconds });
  }
  clients(): readonly ApplicationBotClient[] {
    return Array.from(this.connections.values(), connection => ({ client: connection.client, reliable: connection.reliable }));
  }
  actor(client: ClientId): ActorId | null {
    const connection = this.connections.get(client.slot);
    return connection?.client.id.equals(client) ? connection.actor.id : null;
  }
  consoleCommand(argv: readonly string[]): void { this.director.consoleCommand(argv); }
  disconnect(client: number): boolean {
    const connection = this.connections.get(client);
    if (connection === undefined) return false;
    this.options.simulation.disconnectPlayer(connection.actor.id);
    this.connections.delete(client); this.snapshots.delete(client);
    this.options.session.closeClient(connection.client.id);
    return true;
  }
  close(restart = false): void {
    if (this.closed) return;
    this.director.close(restart); this.options.simulation.botServices.detach(this.director);
    this.snapshots.clear(); this.connections.clear(); this.closed = true;
  }
}

export function openApplicationBotLog(filename: string): BotLogOpenResult {
  const result = (operation: () => void): BotLogIoResult => {
    try { operation(); return { kind: "ok" }; }
    catch (error) { return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }; }
  };
  try {
    const directory = join(homedir(), ".local", "state", "quake-typescript", "bots");
    mkdirSync(directory, { recursive: true });
    const descriptor = openSync(join(directory, basename(filename)), "w");
    return { kind: "opened", stream: {
      write: bytes => result(() => {
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
          if (written === 0) throw new Error("Bot log write made no progress");
          offset += written;
        }
      }),
      flush: () => result(() => { fsyncSync(descriptor); }),
      close: () => result(() => { closeSync(descriptor); }),
    } };
  } catch (error) { return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }; }
}
