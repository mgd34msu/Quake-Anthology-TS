import { botClearActivateGoalStack } from "./q3/ai-navigation.ts";
import { botOrderActive, botOrderStatus, sameBotOrder } from "./orders.ts";
import type { BotGoalStatus, BotOrder } from "./orders.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { UserCommand } from "../../content/q3/base/shared/player-state.ts";
import { CommonParseState } from "../../core/common-parse.ts";
import { CvarFlag } from "../../core/cvars/index.ts";
import { infoValueForKey } from "../../core/info-string.ts";
import type { BotSourceFiles } from "./assets.ts";
import { AasBspEntities } from "./library/bsp-entities.ts";
import type { GoalNavigation, SourcePickupGoal, SourcePickupGoals } from "./library/goals.ts";
import { GameAi } from "./q3/ai-main.ts";
import type { BotSettings, BotState } from "./q3/ai-state.ts";
import { GameBotCatalog } from "./q3/catalog.ts";
import type { SourceBotGame, BotObservedPickup } from "./q3/game-host.ts";
import type { BotNavigation } from "./q3/navigation-types.ts";
import { BotLibrary } from "./q3/library.ts";
import type { SourceBotLibraryOptions } from "./q3/library.ts";

export interface SourceBotDirectorHost {
  readonly game: SourceBotGame;
  readonly provider: ProviderId;
  /** Allocate the real session player and source client binding, without starting movement. */
  allocateClient(): number;
  actor(client: number): OwnedActor | null;
  encodeCommand(client: number, command: UserCommand): Pick<ActorCommand, "command" | "arsenal">;
  snapshotEntity(client: number, sequence: number): number;
  consoleMessage(client: number): string | null;
  pointContents(point: import("../../contracts/math.ts").Vec3): number;
}

export interface SourceBotDirectorOptions {
  readonly host: SourceBotDirectorHost;
  readonly library: SourceBotLibraryOptions;
  readonly files: BotSourceFiles;
  readonly entities: string;
  navigation(library: BotLibrary): BotNavigation & GoalNavigation;
}

export interface SourceBotRosterEntry {
  readonly actor: OwnedActor;
  readonly sourceClient: number;
  readonly settings: Readonly<BotSettings>;
  readonly state: BotState;
}

/** Source arena/AI scheduling generates commands for the existing shared player pipeline. */
export class SourceBotDirector {
  readonly library: BotLibrary;
  readonly navigation: BotNavigation & GoalNavigation;
  readonly ai: GameAi;
  readonly catalog: GameBotCatalog;
  readonly bspEntities: AasBspEntities;
  private readonly sequences = new Map<OwnedActor, number>();
  private readonly generated: ActorCommand[] = [];
  private loaded = false;
  private closed = false;

  constructor(readonly options: SourceBotDirectorOptions) {
    const { host } = options, game = host.game;
    this.library = new BotLibrary(options.library);
    this.navigation = options.navigation(this.library);
    this.bspEntities = new AasBspEntities((severity, text) => options.library.print(severity, text), this.library.memory);
    this.bspEntities.load(options.entities);
    this.ai = new GameAi(game, this.library, { navigation: this.navigation, bspEntities: this.bspEntities,
      pointContents: point => host.pointContents(point),
      getSnapshotEntity: (client, sequence) => host.snapshotEntity(client, sequence),
      getConsoleMessage: client => host.consoleMessage(client),
      insertConsoleCommand: text => game.options.engine.insertConsoleCommand(text),
      checkBotSpawn: () => this.catalog.checkSpawn(),
      loadMap: () => this.library.loadMap({ bspEntities: this.bspEntities, navigation: this.navigation,
        ...(game.pickups === null ? {} : { sourcePickups: this.sourcePickupGoals(game) }),
        pointArea: origin => this.navigation.pointArea(origin), host: {
          trace: (start, end, bounds, passEntity, mask) => game.world.trace({ start, end, passEntityNum: passEntity, mask,
            shape: bounds === null ? { kind: "point" } : { kind: "box", mins: bounds.min, maxs: bounds.max } }),
          pointContents: point => host.pointContents(point),
          nextEntity: after => this.ai.context.observations.nextEntity(after),
          entityInfo: entity => this.ai.context.observations.info(entity),
        } }),
      userCommand: (client, command) => {
        const actor = host.actor(client);
        if (actor === null) throw new Error(`Bot command has no admitted shared actor for client ${client}`);
        const sequence = this.sequences.get(actor) ?? 0;
        this.sequences.set(actor, sequence + 1);
        this.generated.push({ actor: actor.id, source: { kind: "bot", provider: host.provider }, sequence,
          ...host.encodeCommand(client, { ...command, angles: { ...command.angles } }) });
      } });
    this.catalog = new GameBotCatalog(game, options.files, new CommonParseState(), {
      allocateClient: () => host.allocateClient(), setupClient: (client, settings, restart) => this.ai.setupClient(client, settings, restart),
      shutdownClient: (client, restart) => { this.ai.shutdownClient(client, restart); const actor = host.actor(client); if (actor !== null) this.sequences.delete(actor); },
    });
  }

  private sourcePickupGoals(game: SourceBotGame): SourcePickupGoals {
    const pickups = game.pickups;
    const goal = (client: number, pickup: BotObservedPickup | null): SourcePickupGoal | null => {
      const state = this.ai.context.states.get(client);
      if (pickup === null || state === undefined || state === null || pickup.observation.availability.kind !== "ready" || !pickup.observation.availability.eligible) return null;
      const utility = game.knowledge.pickupUtility(this.library, state, pickup.preview);
      return utility > 0 ? { actor: pickup.observation.actor, entity: pickup.entity, origin: pickup.origin,
        bounds: pickup.bounds, name: pickup.name, utility } : null;
    };
    return { ...(pickups?.ownsItemGoal === undefined ? {} : { ownsItemGoal: pickups.ownsItemGoal.bind(pickups) }), candidates: client => {
      const candidates: SourcePickupGoal[] = [];
      for (const pickup of game.pickups?.candidates(client) ?? []) {
        const candidate = goal(client, pickup);
        if (candidate !== null) candidates.push(candidate);
      }
      return candidates;
    }, inspect: (client, actor) => goal(client, game.pickups?.inspect(client, actor) ?? null) };
  }

  load(restart = false): void {
    if (this.closed || this.loaded) throw new Error("Bot director map lifetime is already loaded or closed");
    if (!this.navigation.ready) throw new Error("Bot arena admission requires completed selected-movement navigation");
    const cvars = this.options.host.game.options.cvars;
    cvars.register("bot_enable", "1");
    cvars.register("g_spSkill", "2", CvarFlag.Archive | CvarFlag.Latch);
    if (!this.ai.setup(false)) throw new Error("Source BotAISetup failed while loading behavior data");
    if (!this.ai.loadMap(false)) throw new Error("Source BotAILoadMap failed while loading map goals");
    this.catalog.initializeBots(restart);
    this.loaded = true;
  }

  /** Called once by the session's source frame phase; it never runs actor physics itself. */
  frame(milliseconds: number): readonly ActorCommand[] {
    if (!this.loaded || this.closed) throw new Error("Bot commands require a live loaded director");
    if (this.generated.length !== 0) throw new Error("Bot command output from the previous source frame was not drained");
    this.ai.startFrame(milliseconds);
    return this.generated.splice(0);
  }
  connect(client: number, restart: boolean): boolean { return this.catalog.connect(client, restart); }
  shutdownClient(client: number, restart: boolean): void { this.catalog.shutdownClient(client, restart); }
  removeQueuedBegin(client: number): void { this.catalog.removeQueuedBegin(client); }
  consoleCommand(argv: readonly string[]): void { this.catalog.consoleCommand(argv); }
  testAas(origin: import("../../contracts/math.ts").Vec3): void { this.ai.testAas(origin); }
  interbreedEndMatch(): void { this.ai.interbreedEndMatch(); }
  roster(): readonly SourceBotRosterEntry[] {
    const result: SourceBotRosterEntry[] = [];
    for (let client = 0; client < this.options.host.game.maxClients; client++) {
      const state = this.ai.context.states.get(client), actor = this.options.host.actor(client);
      if (state !== null && state.inuse && actor !== null) result.push({ actor, sourceClient: client, settings: { ...state.settings }, state });
    }
    return result;
  }
  requestMoveToPoint(client: number, point: Vec3): BotGoalStatus {
    if (![point.x, point.y, point.z].every(Number.isFinite)) return 0;
    return this.setOrder(client, { kind: "point", point: { ...point } });
  }
  requestFollowEntity(client: number, number: number): BotGoalStatus {
    if (!Number.isInteger(number) || number < 0 || number >= this.options.host.game.entityCount) return 0;
    const entity = this.options.host.game.entity(number);
    if (!entity.present) return 0;
    return this.setOrder(client, { kind: "follow", entity: { number, generation: entity.generation } });
  }
  clearGoal(client: number): void {
    const state = this.orderState(client);
    if (state === null || state.scriptedOrder === null) return;
    if (botOrderActive(state.scriptedOrder)) {
      botClearActivateGoalStack(this.ai.context, state);
      if (state.aiNode === "seek-activate-entity") state.aiNode = "seek-ltg";
    }
    state.scriptedOrder = null;
    this.library.moveStates.resetAvoidReach(state.ms);
  }
  goalStatus(client: number): BotGoalStatus {
    const state = this.orderState(client), order = state?.scriptedOrder;
    if (state === null || order === undefined || order === null) return 0;
    if (order.order.kind === "follow") {
      const reference = order.order.entity, entity = this.options.host.game.entity(reference.number);
      if (!entity.present || entity.generation !== reference.generation) state.scriptedOrder = { ...order, progress: "error" };
    }
    return botOrderStatus(state.scriptedOrder);
  }
  private orderState(client: number): BotState | null {
    if (!this.loaded || this.closed || !Number.isInteger(client) || client < 0 || client >= this.options.host.game.maxClients) return null;
    const state = this.ai.context.states.get(client);
    return state !== null && state.inuse && this.options.host.actor(client) !== null ? state : null;
  }
  private setOrder(client: number, order: BotOrder): BotGoalStatus {
    const state = this.orderState(client);
    if (state === null) return 0;
    if (state.scriptedOrder !== null && sameBotOrder(state.scriptedOrder.order, order)) return this.goalStatus(client);
    botClearActivateGoalStack(this.ai.context, state);
    if (state.aiNode === "seek-activate-entity") state.aiNode = "seek-ltg";
    state.scriptedOrder = { order, progress: "in-progress" };
    this.library.moveStates.resetAvoidReach(state.ms);
    return 2;
  }
  arenaRoster(map: string): readonly { readonly name: string; readonly info: string }[] {
    const info = this.catalog.getArenaInfoByMap(map);
    if (info === null) return [];
    return infoValueForKey(info, "bots").split(" ").filter(Boolean).map(name => {
      const bot = this.catalog.getBotInfoByName(name);
      if (bot === null) throw new Error(`Arena ${map} names undefined source bot ${name}`);
      return { name, info: bot };
    });
  }
  close(restart = false): void {
    if (this.closed) return;
    for (const entry of this.roster()) this.catalog.shutdownClient(entry.sourceClient, restart);
    this.bspEntities.dump(); this.library.shutdown();
    this.sequences.clear(); this.generated.length = 0; this.closed = true;
  }
}
