// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, ClientId } from "../../../contracts/identity.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { q2Userinfo } from "../../../content/q2/base/player/index.ts";
import type { Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { ArsenalState, MovementState, QwMovementProfile, QwMovementState } from "../../../contracts/movement.ts";
import type { QwUserCommand } from "../../../contracts/protocol.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { Q1TravelState } from "../../../content/q1/base/index.ts";
import { Q2Lmctf } from "../../../content/q2/multiplayer/lmctf/runtime.ts";
import type { Q3SourceRuntime } from "./q3/runtime.ts";
import { seconds } from "./actor-execution.ts";
import { quakeCFreeMovement } from "./quakec-client-adapter.ts";
import type { MovementPlayer, PlayerMovementHost } from "./players.ts";
import type { PlayerAdmission, SimulationTravel } from "./types.ts";
import type { SourceRuntime } from "./runtime.ts";

type Of<K extends SourceRuntime["kind"]> = Extract<SourceRuntime, { readonly kind: K }>;

/** What a strategy may ask of the simulation that owns it; the simulation's own stores stay the single copy. */
export interface SourceStrategyHost {
  readonly q2Views: Map<ActorId, Q2PlayerView>;
  playerClient(actor: ActorId): ClientId | null;
  nativeQ2Client(actor: ActorId): ClientId;
  /** Whether the Q2 player has a cutscene camera. */
  hasCutscene(actor: ActorId): boolean;
  /** Raises the userinfo client event when the source's stored userinfo no longer equals `previous`. */
  userinfoChanged(actor: ActorId, previous: string | null): void;
  readonly playerStates: ReadonlyMap<OwnedActor, MovementPlayer>;
  /** The simulation's current clock reading in seconds. */
  readonly timeSeconds: number;
  readonly sourceFrame: FrameContext;
  requirePlayer(actor: ActorId): MovementPlayer;
  isLive(actor: ActorId): boolean;
  admitPlayer(client: ClientId): PlayerAdmission;
  admitQ2NativePlayer(client: ClientId, userinfo: string): PlayerAdmission;
  admitQuakeCPlayer(source: Of<"quakec">, client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission;
  admitQ3Player(client: ClientId, game: Q3SourceRuntime): PlayerAdmission;
  prepareQ3Client(client: ClientId, game: Q3SourceRuntime, bot: boolean): OwnedActor;
  /** Whether a bot may take the client's slot: owned by this session, in range and unoccupied. */
  botSlotAvailable(client: ClientId): boolean;
  spawnQ1Player(source: Of<"q1">, actor: OwnedActor, player: MovementPlayer): void;
  attachQ2Character(player: MovementPlayer): void;
  /** Whether the Q2 weapon set drives the player: no selected arsenal replaces it. */
  usesQ2Weapons(): boolean;
  hasPendingStartItems(actor: ActorId): boolean;
  giveQ2StartItems(actor: ActorId): void;
  resumeQ2Presentation(actor: ActorId): void;
  projectQuakeCAttack(actor: OwnedActor, before: ArsenalState): void;
  arsenal(player: MovementPlayer): ArsenalState;
  syncQuakeCClientView(player: MovementPlayer): void;
  syncQ3Player(player: MovementPlayer): void;
  runQuakeWorldNewMissile(): void;
  runEntityThink(actor: ActorId, frame: FrameContext): void;
  /** The Q1 and Q2 character presentation steps that follow a client's think. */
  afterClientThink(actor: OwnedActor): void;
  /** Re-links the actor's body and fires the triggers it now touches. */
  relink(actor: OwnedActor): void;
  commitAttachments(): void;
  setQ3Command(actor: OwnedActor, command: ActorCommand | null): void;
  setWorldGravity(gravity: number): void;
  health(actor: ActorId): number;
}

export type CarriedPlayerState = SimulationTravel["players"][number]["state"];
export type PlayerBindings = Pick<PlayerMovementHost, "netQuake" | "sourceClient" | "quakeWorld">;
type Q3NativeClient = NonNullable<ReturnType<Of<"q3">["game"]["records"]["nativeByActor"]>>["client"];
type Q2Entity = ReturnType<Of<"q2">["game"]["attachPlayer"]>;
type Moved = ReturnType<MovementPlayer["move"]>;

/** One command batch the Q1 pre-think phase reads. */
export interface PreFrameInput {
  readonly elapsed: number;
  readonly commands: readonly ActorCommand[];
  readonly players: Iterable<MovementPlayer>;
  /** Whether a mod client application defers the command's own pre-think to its execution. */
  readonly deferred: boolean;
  readonly pending: Map<MovementPlayer, number> | null;
}

export interface PauseControl {
  readonly cvars: CvarRegistry;
  isSpectator(actor: ActorId): boolean;
}

/** The per-source behavior of a SharedSimulation, chosen once when its source is created. */
export interface SourceStrategy {
  /** The actor's userinfo string as the source stores it, or null when the source has none. */
  userinfo(actor: ActorId): string | null;
  /** Replaces the stored userinfo without running the source's change callbacks. */
  storeUserinfo(actor: ActorId, client: ClientId, userinfo: string): void;
  /** Applies a userinfo change through the source's own path; the result is awaited by the caller. */
  updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void | Promise<void>;
  /** Pause settings, or null when the source cannot pause. */
  pause(): PauseControl | null;

  // Spawn.
  /** Admits through the source's own path, or null when the shared Q1/Q2 admission applies. */
  admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission | null;
  prepareBot(client: ClientId): OwnedActor;
  initialArsenalState(): ArsenalState["state"];
  /** Attaches the source entity of a new player; null when the source has none. */
  attachEntity(actor: OwnedActor, player: MovementPlayer): Q2Entity;
  configureAdmitted(actor: OwnedActor, client: ClientId, player: MovementPlayer, entity: Q2Entity, userinfo: string | undefined, travel: SimulationTravel | undefined): void;
  /** Attaches the Q2 character presentation a Q1 source gives its Q2-dressed players. */
  attachForeignCharacter(player: MovementPlayer): void;
  /** Lands the source's own carry; true when it carried the player. */
  admitCarry(actor: OwnedActor, entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean;
  enterWorld(actor: OwnedActor, player: MovementPlayer, fresh: boolean): void;
  captureEntryCarry(actor: OwnedActor): Q1TravelState | null;
  movementBindings(actor: OwnedActor, selectedClock: string): PlayerBindings;
  q2Gibbed(actor: ActorId): boolean;
  /** The native Q3 client of the actor: null when the source is not Q3, undefined when it has no record. */
  q3Client(actor: ActorId): Q3NativeClient | null | undefined;
  /** Whether the source's own gamecode supplies the punch angles. */
  suppliesPunch(): boolean;
  skipsTriggerTouch(actor: ActorId): boolean;

  // Step.
  lmctf(): Q2Lmctf | null;
  preparesQ1Clients(): boolean;
  intermissionFading(): boolean;
  fadeIntermission(): void;
  beginTimedFrame(elapsed: number): void;
  beginGuestFrame(frame: FrameContext): void;
  /** Starts the source's turn over its actors for one boundary. */
  beginActorTurns(frame: FrameContext): void;
  intermissionActive(): boolean;
  requestIntermissionExit(actor: ActorId, buttons: number): void;
  preFrame(input: PreFrameInput): void;
  /** Runs the deferred pre-think of a Q1 player; false when the player did not survive it. */
  preThink(player: MovementPlayer, command: ActorCommand): boolean;
  /** Runs the player's command through the source's own think; false when the shared movement applies. */
  playerThink(player: MovementPlayer, command: ActorCommand): boolean;
  /** Whether the source tracks per-player gravity in the movement state. */
  tracksGravity(): boolean;
  gravityScale(actor: ActorId): number;
  movementApplied(actor: ActorId, moved: Moved): void;
  afterPlayerCommand(player: MovementPlayer, paused: boolean): void;
  beforeClientActor(actor: OwnedActor): void;
  retouch(actor: OwnedActor): void;
  spectating(actor: ActorId): boolean;
  /** Runs the actor through the source's own player turn; false when it has none. */
  runPlayerActor(actor: OwnedActor): boolean;
  watchesTransitions(): boolean;
}

function joinInfo(values: Iterable<readonly [string, string]>): string {
  return [...values].map(([name, value]) => `\\${name}\\${value}`).join("");
}
function sameInfo(previous: ReadonlyMap<string, string>, values: ReadonlyMap<string, string>): boolean {
  return previous.size === values.size && [...values].every(([name, value]) => previous.get(name) === value);
}

class LoadingStrategy implements SourceStrategy {
  userinfo(_actor: ActorId): string | null { return null; }
  storeUserinfo(_actor: ActorId, _client: ClientId, _userinfo: string): void { throw new Error("Component userinfo requires an initialized source"); }
  updateUserinfo(_actor: ActorId, _userinfo: string, _previous: string | null): void | Promise<void> { /* no source yet: nothing stores userinfo */ }
  pause(): PauseControl | null { return null; }

  admitClient(_client: ClientId, _travel: SimulationTravel | undefined, _userinfo: string | undefined): PlayerAdmission | null { throw new Error("Map spawn is incomplete"); }
  prepareBot(_client: ClientId): OwnedActor { throw new Error("Bot admission requires a supported source observation binding"); }
  initialArsenalState(): ArsenalState["state"] { throw new Error("Player spawn requires a Q1 or Q2 source"); }
  attachEntity(_actor: OwnedActor, _player: MovementPlayer): Q2Entity { return null; }
  configureAdmitted(_actor: OwnedActor, _client: ClientId, _player: MovementPlayer, _entity: Q2Entity, _userinfo: string | undefined, _travel: SimulationTravel | undefined): void { /* only Q1 and Q2 sources configure a shared admission */ }
  attachForeignCharacter(_player: MovementPlayer): void { /* only Q1 sources dress their players in a Q2 character */ }
  admitCarry(_actor: OwnedActor, _entity: Q2Entity, _carried: CarriedPlayerState | undefined): boolean { return false; }
  enterWorld(_actor: OwnedActor, _player: MovementPlayer, _fresh: boolean): void { /* only Q1 and Q2 sources enter the world through the shared admission */ }
  captureEntryCarry(_actor: OwnedActor): Q1TravelState | null { return null; }
  movementBindings(_actor: OwnedActor, _selectedClock: string): PlayerBindings { return {}; }
  q2Gibbed(_actor: ActorId): boolean { return false; }
  q3Client(_actor: ActorId): Q3NativeClient | null | undefined { return null; }
  suppliesPunch(): boolean { return false; }
  skipsTriggerTouch(_actor: ActorId): boolean { return false; }

  lmctf(): Q2Lmctf | null { return null; }
  preparesQ1Clients(): boolean { return false; }
  intermissionFading(): boolean { return false; }
  fadeIntermission(): void { /* only a Q2 rerelease source fades an intermission */ }
  beginTimedFrame(_elapsed: number): void { /* only a Q1 source takes timed frames */ }
  beginGuestFrame(_frame: FrameContext): void { /* only a QuakeC source takes guest frames */ }
  beginActorTurns(_frame: FrameContext): void { /* the source has no per-boundary actor setup */ }
  intermissionActive(): boolean { return false; }
  requestIntermissionExit(_actor: ActorId, _buttons: number): void { /* only a Q1 source has an intermission to leave */ }
  preFrame(_input: PreFrameInput): void { /* only a Q1 source runs a client pre-frame */ }
  preThink(_player: MovementPlayer, _command: ActorCommand): boolean { return true; }
  playerThink(_player: MovementPlayer, _command: ActorCommand): boolean { return false; }
  tracksGravity(): boolean { return false; }
  gravityScale(_actor: ActorId): number { return 1; }
  movementApplied(_actor: ActorId, _moved: Moved): void { /* only a Q2 source reacts to movement impacts */ }
  afterPlayerCommand(_player: MovementPlayer, _paused: boolean): void { /* the source has no post-command client think */ }
  beforeClientActor(_actor: OwnedActor): void { /* the source has no per-client actor setup */ }
  retouch(_actor: OwnedActor): void { /* only a Q1 source forces retouches */ }
  spectating(_actor: ActorId): boolean { return false; }
  runPlayerActor(_actor: OwnedActor): boolean { return false; }
  watchesTransitions(): boolean { return false; }
}

class Q1Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q1">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null { return joinInfo(this.source.composition.clients.require(actor).userinfo); }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const info = this.source.composition.clients.require(actor).userinfo; info.clear();
    for (const [name, value] of q2Userinfo(userinfo)) info.set(name, value);
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const current = this.source.composition.clients.require(actor).userinfo, values = q2Userinfo(userinfo);
    if (sameInfo(current, values)) return;
    this.source.composition.userinfo(actor, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl { return { cvars: this.source.cvars, isSpectator: () => false }; }

  override admitClient(): null { return null; }
  override prepareBot(client: ClientId): OwnedActor { return this.host.requirePlayer(this.host.admitPlayer(client).actor).actor; }
  override initialArsenalState(): ArsenalState["state"] { return { kind: "q1", frame: 0, attackFinishedSeconds: 0, sourceWeapon: 1 }; }
  override configureAdmitted(actor: OwnedActor, client: ClientId, _player: MovementPlayer, _entity: Q2Entity, userinfo: string | undefined): void {
    const source = this.source;
    source.game.attachPlayer(actor);
    source.composition.attach(actor, { slot: client.slot, userinfo: userinfo === undefined ? new Map([["name", `Player ${client.slot + 1}`], ["topcolor", "0"], ["bottomcolor", "0"]]) : q2Userinfo(userinfo) });
  }
  override attachForeignCharacter(player: MovementPlayer): void { if (player.character === "q2") this.host.attachQ2Character(player); }
  override admitCarry(actor: OwnedActor, _entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean {
    if (carried?.kind !== "q1") return false;
    this.source.composition.admitTravel(actor, carried.carry);
    return true;
  }
  override enterWorld(actor: OwnedActor, player: MovementPlayer): void { this.host.spawnQ1Player(this.source, actor, player); }
  override captureEntryCarry(actor: OwnedActor): Q1TravelState { return this.source.composition.captureTravel(actor); }
  override movementBindings(actor: OwnedActor): PlayerBindings {
    const source = this.source, host = this.host;
    return { netQuake: {
      projection: null, jumpAuthority: "selected-movement",
      input: command => source.composition.input(actor.id, { attack: (command.buttons & 1) !== 0, jump: (command.buttons & 2) !== 0,
        use: (command.buttons & 4) !== 0, impulse: command.impulse }),
      beforePhysics: frame => {
        const player = host.requirePlayer(actor.id);
        source.composition.playerPreThink(actor.id); source.game.playerFrame(actor, seconds(frame.time), player.waterLevel);
        return undefined;
      },
      think: frame => { host.runEntityThink(actor.id, frame); return undefined; },
      afterPhysics: frame => { source.game.playerAfterPhysics(actor, seconds(frame.time)); source.composition.playerPostThink(actor.id);
        host.afterClientThink(actor); return undefined; },
    } };
  }

  override preparesQ1Clients(): boolean { return true; }
  override beginTimedFrame(elapsed: number): void { this.source.game.beginFrame(this.host.timeSeconds, elapsed); }
  override intermissionActive(): boolean { return this.source.game.intermission !== null; }
  override requestIntermissionExit(actor: ActorId, buttons: number): void {
    this.source.composition.requestIntermissionExit(buttons !== 0, { actor, attack: (buttons & 1) !== 0 });
  }
  override preFrame(input: PreFrameInput): void {
    const source = this.source, host = this.host;
    host.setWorldGravity(source.cvars.variableValue("sv_gravity"));
    source.composition.preFrame(input.elapsed);
    for (const player of input.players) {
      if (player.profile.kind === "q1-netquake") continue;
      const received = [...input.commands].reverse().find(value => sameActor(value.actor, player.actor.id) && value.sequence > player.lastSequence);
      if (input.deferred && received !== undefined && player.cutscene === null && !player.intermission) { input.pending?.set(player, received.sequence); continue; }
      const command = received?.command;
      const jump = command === undefined ? (player.buttons & 2) !== 0 : command.kind === "q1-netquake" ? (command.buttons & 2) !== 0
        : command.kind === "q2-rerelease" ? (command.buttons & 8) !== 0 : command.upMove > 0;
      source.composition.input(player.actor.id, { attack: player.cutscene === null && ((command?.buttons ?? player.buttons) & 1) !== 0, jump: player.cutscene === null && jump,
        use: ((command?.buttons ?? player.buttons) & 4) !== 0, impulse: command !== undefined && "impulse" in command ? command.impulse : received?.arsenal?.impulse ?? 0 });
      source.composition.playerPreThink(player.actor.id);
      source.game.playerFrame(player.actor, host.timeSeconds, player.waterLevel);
    }
  }
  override preThink(player: MovementPlayer, command: ActorCommand): boolean {
    const source = this.source, effective = command.command;
    const jump = effective.kind === "q1-netquake" || effective.kind === "q1-quakeworld" ? (effective.buttons & 2) !== 0
      : effective.kind === "q2-rerelease" ? (effective.buttons & 8) !== 0 : effective.upMove > 0;
    source.composition.input(player.actor.id, { attack: (effective.buttons & 1) !== 0, jump,
      use: (effective.buttons & 4) !== 0, impulse: command.arsenal?.impulse ?? ("impulse" in effective ? effective.impulse : 0) });
    source.composition.playerPreThink(player.actor.id);
    source.game.playerFrame(player.actor, this.host.timeSeconds, player.waterLevel);
    return this.host.isLive(player.actor.id);
  }
  override afterPlayerCommand(player: MovementPlayer): void {
    if (!this.host.isLive(player.actor.id)) return;
    this.source.game.playerAfterPhysics(player.actor, this.host.timeSeconds); this.source.composition.playerPostThink(player.actor.id);
  }
  override beforeClientActor(actor: OwnedActor): void { this.retouch(actor); }
  override retouch(actor: OwnedActor): void { if (this.source.game.forceRetouch > 0) this.host.relink(actor); }
}

class QuakeCStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"quakec">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : joinInfo(this.source.game.clientInfo(client));
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.setClientInfoStorage(client, q2Userinfo(userinfo)); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor); if (client === null) return;
    const values = q2Userinfo(userinfo);
    if (sameInfo(this.source.game.clientInfo(client), values)) return;
    this.source.game.setClientInfo(client, values);
    this.host.userinfoChanged(actor, previous);
  }
  override pause(): PauseControl {
    const game = this.source.game;
    return { cvars: game.cvars, isSpectator: actor => game.kind === "quakeworld" && game.isSpectatorClient(actor) };
  }

  override admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission {
    return this.host.admitQuakeCPlayer(this.source, client, travel, userinfo);
  }
  override movementBindings(actor: OwnedActor, selectedClock: string): PlayerBindings {
    const source = this.source, host = this.host, game = source.game;
    const mixedQc = selectedClock !== (game.kind === "quakeworld" ? "q1-quakeworld" : "q1-netquake");
    if (game.kind === "netquake" && !mixedQc) return { netQuake: {
      projection: { read: state => game.readClientState(actor.id, state), write: state => game.writeClientState(actor.id, state) },
      jumpAuthority: "source-gamecode", input: command => game.clientInput(actor.id, command),
      beforePhysics: () => { const before = game.clientArsenal(actor.id); game.clientPreThink(actor); host.projectQuakeCAttack(actor, before); return undefined; },
      think: frame => { const before = game.clientArsenal(actor.id); game.runThink(actor, frame); host.projectQuakeCAttack(actor, before); return undefined; }, afterPhysics: () => {
        const before = game.clientArsenal(actor.id);
        game.clientPostThink(actor); host.projectQuakeCAttack(actor, before); return undefined;
      },
    } };
    if (mixedQc) return { sourceClient: {
      projectState: (state: MovementState) => game.isSpectatorClient(actor.id) ? quakeCFreeMovement(state) : state,
      beforeMovement: (input: ActorCommand, frame: FrameContext, sourceCommand?: QwUserCommand) => {
        const before = game.clientArsenal(actor.id), result = sourceCommand === undefined
          ? game.mixedClientPreThink(actor, input.command, frame)
          : game.mixedQuakeWorldPreThink(actor, sourceCommand, input.command, frame);
        host.projectQuakeCAttack(actor, before); return result;
      },
      afterMovement: (player: MovementPlayer, _frame: FrameContext, sourceCommand?: QwUserCommand): undefined => {
        const before = game.clientArsenal(actor.id);
        game.mixedClientPostThink(actor, player.ground, player.waterLevel, player.waterType, player.profile.kind, sourceCommand === undefined ? "immediate" : "deferred");
        host.projectQuakeCAttack(actor, before);
        player.arsenal = host.arsenal(player);
        return undefined;
      },
    } };
    if (game.kind !== "quakeworld") return {};
    return { quakeWorld: {
      read: (state: QwMovementState) => game.readQuakeWorldState(actor.id, state),
      write: (state: QwMovementState) => game.writeQuakeWorldState(actor.id, state),
      beforePhysics: (command: QwUserCommand, frame: FrameContext) => {
        const before = game.clientArsenal(actor.id); game.quakeWorldPreThink(actor, command, frame);
        host.projectQuakeCAttack(actor, before); return undefined;
      },
      water: (level: number, type: number) => game.quakeWorldWater(actor.id, level, type),
      profile: (profile: QwMovementProfile) => game.quakeWorldProfile(actor.id, profile),
    } };
  }
  override suppliesPunch(): boolean { return this.source.game.kind === "netquake"; }
  override skipsTriggerTouch(actor: ActorId): boolean { const game = this.source.game; return game.kind === "quakeworld" && game.isSpectatorClient(actor); }

  override preparesQ1Clients(): boolean { return this.source.game.kind === "netquake"; }
  override beginGuestFrame(frame: FrameContext): void { this.source.game.beginFrame(frame); }
  override beforeClientActor(actor: OwnedActor): void { this.source.game.beforeActor(actor); }
  override afterPlayerCommand(player: MovementPlayer): void {
    const game = this.source.game, host = this.host;
    if (game.kind !== "quakeworld" || player.profile.kind !== "q1-quakeworld" || !host.isLive(player.actor.id)) return;
    const before = game.clientArsenal(player.actor.id);
    game.clientPostThink(player.actor); host.projectQuakeCAttack(player.actor, before);
    if (!game.isSpectatorClient(player.actor.id)) host.runQuakeWorldNewMissile();
    player.arsenal = host.arsenal(player); if (player.character === "q1") player.animation = game.clientAnimation(player.actor.id);
    player.state = player.readState(); host.syncQuakeCClientView(player);
  }
}

class Q2Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q2">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null { return this.source.players.states.get(actor)?.userinfo ?? null; }
  override storeUserinfo(actor: ActorId, _client: ClientId, userinfo: string): void {
    const player = this.source.players.states.get(actor); if (player === undefined) throw new Error("Component userinfo has no Q2 player");
    player.userinfo = userinfo;
  }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const source = this.source, state = source.players.states.get(actor), entity = source.game.entity(actor);
    if (state === undefined || entity === null || state.userinfo === userinfo) return;
    const previousFov = state.fov, previousRequest = q2Userinfo(state.userinfo).get("fov");
    source.players.userinfoChanged(entity, source.game, userinfo);
    if (this.host.hasCutscene(actor) || state.chaseTarget !== null || (entity.flags & 0x4000) !== 0 || previousRequest === q2Userinfo(userinfo).get("fov")) state.fov = previousFov;
    const view = this.host.q2Views.get(actor);
    if (view?.fov === previousFov) this.host.q2Views.set(actor, { ...view, fov: state.fov });
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(): null { return null; }
  override prepareBot(client: ClientId): OwnedActor {
    const admitted = this.host.admitPlayer(client), entity = this.source.game.entity(admitted.actor);
    if (entity === null) throw new Error("Bot admission lost its shared source entity");
    entity.serverFlags |= 16; return entity.actor;
  }
  override initialArsenalState(): ArsenalState["state"] {
    return { kind: "q2", gunFrame: 0, state: 0, pendingWeapon: null, machinegunShots: 0, grenadeTime: { kind: "seconds", value: 0 }, grenadeBlewUp: false };
  }
  override attachEntity(actor: OwnedActor, player: MovementPlayer): Q2Entity {
    const entity = this.source.game.attachPlayer(actor);
    if (entity !== null) { entity.viewHeight = player.viewHeight; entity.solid = "box"; }
    return entity;
  }
  override configureAdmitted(actor: OwnedActor, client: ClientId, player: MovementPlayer, entity: Q2Entity, userinfo: string | undefined, travel: SimulationTravel | undefined): void {
    const source = this.source;
    source.items.configurePlayer(actor, source.game, true);
    if (entity === null) return;
    const model = player.character === "q2" ? player.characterAppearance.provider.split("/").at(-1) ?? "male" : "male";
    source.product.admit(actor, { slot: client.slot, userinfo: userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\${model}/grunt\\fov\\90`, initializeInventory: false, useQ2Weapons: this.host.usesQ2Weapons() }, travel?.source.kind === "q2" && travel.source.landmark?.clientSlot === client.slot ? { ...travel.source.landmark, player: actor.id } : null);
  }
  override admitCarry(actor: OwnedActor, entity: Q2Entity, carried: CarriedPlayerState | undefined): boolean {
    if (carried?.kind !== "q2") return false;
    if (entity !== null) this.source.players.restoreCarry(entity, this.source.game, carried.carry);
    return true;
  }
  override enterWorld(actor: OwnedActor, _player: MovementPlayer, fresh: boolean): void {
    if (fresh || this.host.hasPendingStartItems(actor.id)) this.host.giveQ2StartItems(actor.id);
    this.host.resumeQ2Presentation(actor.id);
  }
  override q2Gibbed(actor: ActorId): boolean { return this.source.players.states.get(actor)?.gibbed === true; }

  override lmctf(): Q2Lmctf | null { const match = this.source.product.match.source; return match instanceof Q2Lmctf ? match : null; }
  override intermissionFading(): boolean { return this.source.product.rerelease?.players.intermissionFadeUntil != null; }
  override fadeIntermission(): void { this.source.product.rerelease?.players.fadeFrame(this.source.game); }
  override beginActorTurns(): void { this.source.monsters.beginFrame(this.source.game); }
  override tracksGravity(): boolean { return true; }
  override gravityScale(actor: ActorId): number {
    const source = this.source;
    const matchGravity = source.product.match.gravityScale(actor);
    const flightGravity = source.product.items.playerPowerups(actor).flightUntil > this.host.timeSeconds ? 0.1 : 1;
    return matchGravity * flightGravity;
  }
  override movementApplied(actor: ActorId, moved: Moved): void {
    if (moved.kind === "q2-rerelease" && moved.status === "active") this.source.product.movementImpact(actor, moved.impactDelta, (moved.state.flags & 128) !== 0);
  }
  override afterPlayerCommand(player: MovementPlayer, paused: boolean): void {
    const source = this.source;
    if (paused || !this.host.isLive(player.actor.id)) return;
    const entity = source.game.entity(player.actor.id);
    if (entity === null) return;
    if (!player.intermission) entity.viewHeight = player.character === "q2" && this.host.health(player.actor.id) <= 0
      ? source.players.states.get(player.actor.id)?.gibbed === true ? 8 : -2 : player.viewHeight;
    source.players.afterClientThink(entity, source.game);
  }
  override spectating(actor: ActorId): boolean { return this.source.players.states.get(actor)?.spectator === true; }
  override watchesTransitions(): boolean { return true; }
}

class Q2NativeStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q2-native">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    return this.source.game.clients.find(client => client.slot === slot)?.userinfo ?? null;
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.setUserinfoStorage(client.slot + 1, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const slot = this.host.nativeQ2Client(actor).slot + 1;
    if (this.source.game.clients.find(client => client.slot === slot)?.userinfo !== userinfo) this.source.game.userinfo(slot, userinfo);
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(client: ClientId, travel: SimulationTravel | undefined, userinfo: string | undefined): PlayerAdmission {
    if (travel !== undefined) throw new Error("Native Quake II travel requires its source file lifecycle");
    return this.host.admitQ2NativePlayer(client, userinfo ?? `\\name\\Player ${client.slot + 1}\\skin\\male/grunt\\fov\\90`);
  }
}

class Q3Strategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q3">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : this.source.game.host.engine.getUserinfo(client.slot);
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.host.engine.setUserinfo(client.slot, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, previous: string | null): void {
    const client = this.host.playerClient(actor); if (client === null) throw new Error("Q3 userinfo has no admitted client");
    this.source.game.host.engine.setUserinfo(client.slot, userinfo);
    this.source.game.admission.userinfoChanged(client.slot);
    this.host.userinfoChanged(actor, previous);
  }

  override admitClient(client: ClientId): PlayerAdmission { return this.host.admitQ3Player(client, this.source.game); }
  override prepareBot(client: ClientId): OwnedActor {
    if (!this.host.botSlotAvailable(client)) throw new Error("Bot client is not an available session slot");
    const actor = this.host.prepareQ3Client(client, this.source.game, true); this.source.game.prepareClient(actor, client.slot); return actor;
  }
  override q3Client(actor: ActorId): Q3NativeClient | undefined { return this.source.game.records.nativeByActor(actor)?.client; }
  override skipsTriggerTouch(): boolean { return true; }
  override beginActorTurns(frame: FrameContext): void { this.source.game.beginFrame(frame); }
  override playerThink(player: MovementPlayer, command: ActorCommand): boolean {
    this.host.setQ3Command(player.actor, command);
    try { this.source.game.playerThink(command); } finally { this.host.setQ3Command(player.actor, null); }
    this.host.syncQ3Player(player);
    return true;
  }
  override runPlayerActor(actor: OwnedActor): boolean {
    const game = this.source.game, host = this.host;
    if (!(host.playerStates.has(actor) || game.records.byActor(actor.id) !== null)) return false;
    game.runActor(actor); host.commitAttachments();
    const player = host.playerStates.get(actor); if (player !== undefined) host.syncQ3Player(player);
    return true;
  }
}

class Q3QvmStrategy extends LoadingStrategy {
  constructor(private readonly source: Of<"q3-qvm">, private readonly host: SourceStrategyHost) { super(); }
  override userinfo(actor: ActorId): string | null {
    const client = this.host.playerClient(actor);
    return client === null ? null : this.source.game.state.getUserinfo(client.slot) ?? null;
  }
  override storeUserinfo(_actor: ActorId, client: ClientId, userinfo: string): void { this.source.game.state.setUserinfo(client.slot, userinfo); }
  override updateUserinfo(actor: ActorId, userinfo: string, _previous: string | null): void | Promise<void> {
    const player = this.source.game.players().find(player => player.actor.equals(actor));
    if (player === undefined) throw new Error("Q3 guest userinfo has no admitted client");
    return this.source.game.userinfo(player, userinfo);
  }

  override admitClient(): PlayerAdmission { throw new Error("Q3 guest admission requires the awaited native network lifecycle"); }
}

export function createSourceStrategy(source: SourceRuntime, host: SourceStrategyHost): SourceStrategy {
  switch (source.kind) {
    case "loading": return new LoadingStrategy();
    case "quakec": return new QuakeCStrategy(source, host);
    case "q1": return new Q1Strategy(source, host);
    case "q3": return new Q3Strategy(source, host);
    case "q3-qvm": return new Q3QvmStrategy(source, host);
    case "q2-native": return new Q2NativeStrategy(source, host);
    case "q2": return new Q2Strategy(source, host);
  }
}
