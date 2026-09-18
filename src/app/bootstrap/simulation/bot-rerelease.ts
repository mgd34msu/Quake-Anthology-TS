import { q1BotChatText } from "../../../bots/behavior/rerelease/chat-text.ts";
import type { RereleaseGoalStatus } from "../../../compat/q2/rerelease/navigation.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { ActorId, ClientId, OwnedActor } from "../../../contracts/identity.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import { RereleaseBotBehavior, type RereleaseBehaviorCheckpoint } from "../../../bots/behavior/rerelease/profile.ts";
import { readRereleaseBehavior } from "../../../bots/behavior/rerelease/checkpoint.ts";
import type { BotWorldT, BotUsercmdT, BotSoundT } from "../../../bots/behavior/rerelease/world.ts";
import { ServerReliableCommands, MAX_RELIABLE_COMMANDS } from "../../../network/q3/reliable.ts";
import { SaveReader } from "../../../persistence/value.ts";
import { savedActorId } from "../../../persistence/save-image.ts";
import type { ApplicationBotNavigation } from "./navigation.ts";
import { ApplicationBots, RestoredBotReliableCommands, type ApplicationBotService, type ApplicationBotsOptions, type ApplicationBotClient, type ApplicationBotsCheckpoint } from "./bots.ts";
import type { ApplicationBotAssets } from "./bot-assets.ts";
import { createRereleaseBotWorld, nativeWeaponItem } from "./bot-rerelease-world.ts";
import { rereleaseBotObjectives } from "./bot-objectives.ts";
import type { SimulationPresentationEvent } from "./types.ts";
import { rereleaseBotCommand } from "./bot-commands.ts";
interface Connection extends ApplicationBotClient {
  readonly actor: OwnedActor; readonly behavior: RereleaseBotBehavior; readonly world: BotWorldT;
  readonly name: string; readonly skill: string; readonly selection: { number: number }; sequence: number;
}
export interface RereleasePopulationCheckpoint {
  readonly version: 1; readonly kind: "rerelease"; readonly assets: string; readonly nextObservation: number;
  readonly heard: readonly BotSoundT[];
  readonly clients: readonly { readonly slot: number; readonly name: string; readonly skill: string; readonly sequence: number; readonly selection: number; readonly behavior: RereleaseBehaviorCheckpoint }[];
}
/** Source decisions drive existing shared player commands; this owns no simulation or collision state. */
export class ApplicationRereleaseBots implements ApplicationBotService {
  readonly configuration: import("../../../core/cvars/index.ts").CvarRegistry;
  private readonly navigation: ApplicationBotNavigation;
  private readonly connections = new Map<number, Connection>();
  private readonly observations = new Map<number, ActorId>();
  private nextObservation = 1;
  private elapsedMilliseconds = 0;
  private heard: BotSoundT[] = [];
  private closed = false;
  private readonly objectives;
  constructor(readonly options: ApplicationBotsOptions, readonly assets: Extract<ApplicationBotAssets, { readonly kind: "rerelease" }>) {
    const configuration = options.configuration ?? options.simulation.q1Source()?.cvars ?? options.simulation.q2ServerCvars();
    if (configuration === null || configuration === undefined) throw new Error("Native bot configuration unavailable");
    this.configuration = configuration;
    if (!("checkpoint" in options.navigation)) throw new Error("Native bot navigation requires shared checkpoint lifetime");
    this.navigation = options.navigation;
    this.objectives = rereleaseBotObjectives(options.simulation, assets.knowledge);
    this.configuration.register("bot_minplayers", "0");
    this.configuration.register("bot_enable", "1");
    if (options.restore !== undefined) this.restore(options.restore);
    else for (const saved of options.clients ?? []) this.connect(saved, this.name(saved), this.defaultSkill());
    options.simulation.botServices.attachTransport(this);
  }
  private defaultSkill(): string {
    const skills = this.assets.knowledge.skills;
    const selected = skills[Math.min(skills.length - 1, this.options.simulation.options.skill + 1)] ?? skills[0];
    if (selected === undefined) throw new Error("Native bot assets contain no source skill settings");
    return selected.skill;
  }
  private name(saved: ApplicationBotClient): string {
    const fields = (saved.userinfo ?? "").split("\\");
    const index = fields.indexOf("name");
    return index < 0 ? this.assets.knowledge.characters[0]?.name ?? "Bot" : fields[index + 1] ?? "Bot";
  }
  private identify = (actor: ActorId): number => {
    for (const [number, existing] of this.observations) if (existing.equals(actor)) return number;
    const number = this.nextObservation++; this.observations.set(number, actor); return number;
  };
  private connect(saved: ApplicationBotClient, name: string, skill: string, restoredActor?: OwnedActor): Connection {
    const { simulation } = this.options;
    if (saved.client.isClosed || this.connections.has(saved.client.id.slot)) throw new Error("Native bot client is closed or already admitted");
    const existing = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(saved.client.id));
    const actor = restoredActor ?? simulation.actors.resolveOwned(existing ?? simulation.admitPlayer(saved.client.id).actor);
    if (actor === null) throw new Error("Native bot admission has no shared actor");
    const player = simulation.movementPlayer(actor.id);
    if (player === null) throw new Error("Native bot admission lost selected movement");
    const character = this.assets.knowledge.characters.find(value => value.name.toLowerCase() === name.toLowerCase());
    const selection = { number: 0 };
    const definition = this.assets.files.provenance?.();
    if (definition === undefined) throw new Error("Native bot assets require saved provenance");
    const behavior = new RereleaseBotBehavior({ definition, source: this.assets.source, knowledge: this.assets.knowledge,
      skill, seed: restoredActor === undefined ? simulation.random.nextInteger() : 0, gameMode: this.objectives.mode(), ...(character === undefined ? {} : { character }),
      maxHealth: 100, runSpeed: player.profile.kind.startsWith("q2") ? 300 : 320, walkSpeed: 160,
      movement: { gravity: simulation.physics.gravity, jumpVelocity: 270, jumpAirSeconds: 540 / simulation.physics.gravity,
        maximumLandingRise: 18, startAbove: 56, bodyMins: player.standingBounds.min, bodyMaxs: player.standingBounds.max },
      callbacks: { time: () => simulation.timeSeconds,
        preThink: () => {}, postThink: () => {},
        chat: event => {
          const connection = this.connections.get(saved.client.id.slot);
          if (connection === undefined) throw new Error("Native bot chat lost its admitted client");
          const lookup = (key: string): string | null => this.assets.localization.lookup(key);
          const text = this.assets.source === "q1-rerelease" ? q1BotChatText(event.locstring, lookup, connection.behavior.random)
            : lookup(event.locstring) ?? event.locstring;
          simulation.playerCommand(actor.id, event.teamOnly ? "say_team" : "say", [text]);
        },
        selectWeapon: number => { selection.number = number; }, weaponImpulse: number => { selection.number = number; return 0; },
        humanTeammateNear: () => simulation.players().some(other => !this.isBot(other) && this.objectives.team(other) === this.objectives.team(actor.id)
          && (() => { const body = simulation.bodies.read(other), own = simulation.bodies.read(actor.id); return body !== null && own !== null && Math.hypot(body.origin.x-own.origin.x, body.origin.y-own.origin.y, body.origin.z-own.origin.z) < 256; })()) } });
    const world = createRereleaseBotWorld({ simulation, navigation: this.navigation, knowledge: this.assets.knowledge, objectives: this.objectives,
      identify: this.identify, isBot: actor => this.isBot(actor), elapsed: () => this.elapsedMilliseconds, sounds: () => this.heard }, actor.id);
    const connection: Connection = { ...saved, userinfo: saved.userinfo ?? `\\name\\${name}`, actor, behavior, world, name, skill, selection, sequence: 0 };
    this.connections.set(saved.client.id.slot, connection);
    if (restoredActor === undefined) {
      const cosmetic = !this.objectives.mode().hasTeams && character !== undefined;
      simulation.setSourcePlayerIdentity(actor.id, { name,
        ...(cosmetic && this.assets.source === "q2-rerelease" && character.skin !== "" ? { skin: character.skin } : {}),
        ...(cosmetic && this.assets.source === "q1-rerelease" ? { shirt: character.shirtColor, pants: character.pantsColor } : {}) });
      this.objectives.admit(actor.id);
    }
    return connection;
  }
  private add(name: string, skill = this.defaultSkill()): void {
    const occupied = new Set(this.options.simulation.clientIdentities().map(id => id.slot));
    for (let slot = 0; slot < this.options.simulation.options.maxClients; slot++) {
      if (occupied.has(slot)) continue;
      const client = this.options.session.createClient(slot);
      try { this.connect({ client, reliable: new ServerReliableCommands() }, name, skill); }
      catch (error) {
        const cleanup: unknown[] = [];
        try {
          const actor = this.options.simulation.players().find(actor => this.options.simulation.movementPlayer(actor)?.client.equals(client.id));
          if (actor !== undefined) this.options.simulation.disconnectPlayer(actor);
        } catch (failure) { cleanup.push(failure); }
        this.connections.delete(client.id.slot);
        try { this.options.session.closeClient(client.id); } catch (failure) { cleanup.push(failure); }
        if (cleanup.length !== 0) throw new AggregateError([error, ...cleanup], "Native bot admission and cleanup failed");
        throw error;
      }
      return;
    }
    this.options.print("Unable to add bot: server is full\n");
  }
  consoleCommand(argv: readonly string[]): void {
    const command = argv[0]?.toLowerCase();
    if (command === "addbot") {
      const names = this.assets.knowledge.characters, name = argv[1] ?? names[this.connections.size % Math.max(1, names.length)]?.name ?? "Bot";
      const raw = argv[2], numeric = raw === undefined ? NaN : Number(raw);
      const skill = Number.isFinite(numeric) ? this.assets.knowledge.skills[Math.max(0, Math.min(this.assets.knowledge.skills.length - 1, Math.trunc(numeric)))]?.skill ?? this.defaultSkill() : raw ?? this.defaultSkill();
      this.add(name, skill);
    } else if (command === "botlist") for (const character of this.assets.knowledge.characters) this.options.print(`${character.name}\n`);
    else throw new Error(`Unknown native bot command ${command}`);
  }
  frame(_milliseconds: number, elapsed: number): readonly ActorCommand[] {
    if (this.closed) throw new Error("Native bot transport is closed");
    this.elapsedMilliseconds = elapsed;
    const simulation = this.options.simulation;
    const minimum = Math.min(simulation.options.maxClients, Math.max(0, Math.trunc(this.configuration.variableValue("bot_minplayers"))));
    if (this.configuration.variableValue("bot_enable") !== 0 && simulation.clientIdentities().length < minimum) this.add(this.assets.knowledge.characters[this.connections.size % Math.max(1, this.assets.knowledge.characters.length)]?.name ?? "Bot");
    const commands: ActorCommand[] = [];
    for (const connection of this.connections.values()) {
      const player = simulation.movementPlayer(connection.actor.id);
      if (player === null || !simulation.actors.isLive(connection.actor.id)) throw new Error("Native bot command targets a retired actor");
      connection.behavior.brain.setGameMode(this.objectives.mode());
      const objective = this.objectives.goal(connection.actor.id);
      connection.behavior.setObjectiveGoal(objective);
      const source = connection.behavior.think(connection.world);
      const command = this.command(source, connection);
      commands.push({ actor: connection.actor.id, source: { kind: "bot", provider: this.assets.source === "q1-rerelease" ? "q1:bot" : "q2:bot" }, sequence: connection.sequence++, command,
        arsenal: { provider: player.arsenal.provider, weapon: nativeWeaponItem(simulation, connection.actor.id, this.assets.knowledge, connection.selection.number), useHoldable: false } });
    }
    this.heard = [];
    return commands;
  }
  private command(source: BotUsercmdT, connection: Connection): ActorCommand["command"] {
    const player = this.options.simulation.movementPlayer(connection.actor.id);
    if (player === null) throw new Error("Native bot lost command player");
    return rereleaseBotCommand(source, player.profile.kind, this.elapsedMilliseconds, Math.trunc(this.options.simulation.timeSeconds * 1000));
  }
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const event of events) {
      if ((event.kind === "q1" || event.kind === "q2") && event.event.kind === "sound") {
        const source = event.event, origin = source.origin ?? (source.actor === null ? null : this.options.simulation.bodies.read(source.actor)?.origin);
        if (origin !== null && origin !== undefined) this.heard.push({ origin, sourceId: source.actor === null ? -1 : this.identify(source.actor), time: event.seconds, loudness: source.volume });
      }
    }
  }
  clients(): readonly ApplicationBotClient[] { return [...this.connections.values()].map(({ client, reliable, userinfo }) => ({ client, reliable, ...(userinfo === undefined ? {} : { userinfo }) })); }
  moveToPoint(actor: ActorId, point: Vec3, tolerance: number): RereleaseGoalStatus {
    const connection = [...this.connections.values()].find(value => value.actor.id.equals(actor));
    const body = this.options.simulation.bodies.read(actor);
    if (connection === undefined || body === null) return 0;
    const before = connection.behavior.goalStatus();
    connection.behavior.requestMoveToPoint(point);
    if (Math.hypot(body.origin.x - point.x, body.origin.y - point.y, body.origin.z - point.z) <= tolerance) return 3;
    const status = connection.behavior.goalStatus();
    return status === 0 ? 0 : status === 1 ? 3 : before === 0 ? 1 : 2;
  }
  followActor(actor: ActorId, target: ActorId): RereleaseGoalStatus {
    const connection = [...this.connections.values()].find(value => value.actor.id.equals(actor));
    const body = this.options.simulation.bodies.read(target);
    if (connection === undefined || body === null) return 0;
    const before = connection.behavior.goalStatus();
    connection.behavior.requestFollowEntity(this.identify(target), body.origin);
    const status = connection.behavior.goalStatus();
    return status === 0 ? 0 : status === 1 ? 3 : before === 0 ? 1 : 2;
  }
  isBot(actor: ActorId): boolean { return [...this.connections.values()].some(connection => connection.actor.id.equals(actor)); }
  actor(client: ClientId): ActorId | null { return this.connections.get(client.slot)?.client.id.equals(client) === true ? this.connections.get(client.slot)?.actor.id ?? null : null; }
  disconnect(slot: number): boolean {
    const client = this.connections.get(slot); if (client === undefined) return false;
    this.options.simulation.disconnectPlayer(client.actor.id); this.connections.delete(slot); this.options.session.closeClient(client.client.id); return true;
  }
  close(_restart = false): void { if (this.closed) return; this.options.simulation.botServices.detachTransport(this); this.connections.clear(); this.closed = true; }
  beginRoundRestart(): readonly ApplicationBotClient[] { throw new Error("Native rerelease bots use shared map replacement, not Q3 fast restart"); }
  bindRestartedRound(): void { throw new Error("Native rerelease bots cannot bind a Q3 round"); }
  reconnectRestartedClient(_client: ClientId): boolean { throw new Error("Native rerelease bots cannot reconnect a Q3 round"); }
  resumeRoundBots(): void { throw new Error("Native rerelease bots cannot resume a Q3 round"); }
  checkpoint(): ApplicationBotsCheckpoint {
    const assets = this.assets.files.provenance?.(); if (assets === undefined) throw new Error("Native bot assets lack save provenance");
    return { version: 1, transport: { version: 1, elapsedMilliseconds: this.elapsedMilliseconds, snapshots: [], connections: [...this.connections.values()].map(connection => ({
      client: { slot: connection.client.id.slot, generation: connection.client.id.generation }, actor: savedActorId(connection.actor.id),
      reliable: { sequence: connection.reliable.sequence, acknowledge: connection.reliable.acknowledge, slots: Array.from({ length: MAX_RELIABLE_COMMANDS }, (_, index) => connection.reliable.lookupMasked(index)) } })) },
      director: { version: 1, kind: "rerelease", assets, nextObservation: this.nextObservation, heard: this.heard.map(sound => ({ ...sound, origin: { ...sound.origin } })), clients: [...this.connections.values()].map(connection => ({ slot: connection.client.id.slot, name: connection.name, skill: connection.skill, sequence: connection.sequence, selection: connection.selection.number, behavior: connection.behavior.checkpoint() })) },
      navigation: this.navigation.checkpoint(), knowledge: null, sharedWorld: null,
      observations: [...this.observations].map(([number, actor]) => ({ number, actor: savedActorId(actor) })) };
  }
  private restore(restore: NonNullable<ApplicationBotsOptions["restore"]>): void {
    const { image } = restore, r = new SaveReader(image.director, "bot.rerelease.population");
    r.field("version").literal(1); r.field("kind").literal("rerelease");
    if (r.field("assets").string() !== this.assets.files.provenance?.()) throw new Error("Saved native bot assets differ from mounted definitions");
    this.navigation.restoreCheckpoint(image.navigation);
    this.nextObservation = r.field("nextObservation").integer(1);
    this.heard = r.field("heard").list(sound => ({ origin: { x: sound.field("origin").field("x").finite(), y: sound.field("origin").field("y").finite(), z: sound.field("origin").field("z").finite() }, sourceId: sound.field("sourceId").integer(), time: sound.field("time").finite(), loudness: sound.field("loudness").finite() })).slice();
    for (const entry of image.observations) {
      if (entry.number < 1 || entry.number >= this.nextObservation || this.observations.has(entry.number)) throw new Error("Invalid native bot observation sequence");
      this.observations.set(entry.number, this.options.simulation.actors.referenceSaved(entry.actor));
    }
    const clients = r.field("clients").list(entry => ({ slot: entry.field("slot").integer(0), name: entry.field("name").string(), skill: entry.field("skill").string(), sequence: entry.field("sequence").integer(0), selection: entry.field("selection").integer(0), behavior: readRereleaseBehavior(entry.field("behavior").value) }));
    if (clients.length !== image.transport.connections.length || new Set(clients.map(client => client.slot)).size !== clients.length)
      throw new Error("Saved native bot decisions and transport clients differ");
    for (const entry of image.transport.connections) {
      const client = restore.resolveClient(entry.client), actor = this.options.simulation.actors.resolveSaved(entry.actor), state = clients.find(value => value.slot === entry.client.slot);
      if (client === null || actor === null || state === undefined) throw new Error("Saved native bot lacks its original client/actor");
      if (this.options.simulation.movementPlayer(actor.id)?.client.equals(client.id) !== true)
        throw new Error("Saved native bot actor belongs to a different client");
      const reliable = new RestoredBotReliableCommands(entry.reliable);
      const connection = this.connect({ client, reliable }, state.name, state.skill, actor);
      connection.sequence = state.sequence; connection.selection.number = state.selection; connection.behavior.restore(state.behavior);
    }
    this.elapsedMilliseconds = image.transport.elapsedMilliseconds;
  }
}
export function createApplicationBots(options: ApplicationBotsOptions, assets: ApplicationBotAssets): ApplicationBotService {
  return assets.kind === "rerelease" ? new ApplicationRereleaseBots(options, assets) : new ApplicationBots(options);
}
