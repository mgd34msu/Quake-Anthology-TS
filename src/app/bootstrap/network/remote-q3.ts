import type { WorldText } from "../../../text/world.ts";
import { remoteContentSelection } from "../../../content/catalog/index.ts";
/* Q3 CL_ParseGamestate / CL_SetCGameTime and cgame host projection. GPL-2.0-or-later. */
import type { ActorId, IdentityOwner, SeatId } from '../../../contracts/identity.ts';
import type { ContentId, ResolvedResourceReference } from '../../../contracts/content.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { ItemId } from '../../../contracts/gameplay.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { Q3ClientConnection } from '../../../network/q3/client.ts';
import { q3InfoValue } from '../../../network/q3/admission.ts';
import { Q3ClientClock } from '../../../network/q3/clock.ts';
import { toQ3PlayerState } from '../../../network/q3/adapters.ts';
import type { WireUserCommand } from '../../../network/q3/message.ts';
import type { Download, Gamestate, Snapshot } from '../../../network/q3/server-message.ts';
import { HistorySnapshotSource } from '../../../content/q3/presentation/snapshots.ts';
import { retailSnapshot } from '../../../content/q3/presentation/retail-snapshot.ts';
import { Q3_WEAPON_ITEMS, q3WeaponItem } from '../../../content/q3/foundation/arsenal.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import { createSceneQueries } from '../../../world/collision/index.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { PlayerUi, PlayerView, SimulationPresentation, SimulationPresentationEvent } from '../simulation/types.ts';
import { q3ArsenalWarning, q3WeaponStatus } from '../simulation/arsenal/weapon-status.ts';
import { relativeQ3SourceCommand } from '../simulation/q3-commands.ts';
import { presentationSourceCommand } from '../simulation/prediction/presentation.ts';
import { movementProfile } from '../simulation/players.ts';
import { createPresentationMovementHost } from '../simulation/prediction/presentation.ts';
import type { PresentationPredictionAdapter } from '../simulation/prediction/presentation.ts';
import { readPredictionSourceState, predictionSourceHit } from '../simulation/prediction/source-state.ts';
import type { MovementPredictionSnapshot } from '../simulation/prediction/types.ts';
import type { Q3ApplicationClientHost } from './q3-client.ts';
import type { ApplicationQ3ClientSource } from '../q3-client.ts';
import type { RemotePresentationAccess } from './types.ts';
export interface Q3RemoteWorld { readonly map: string; readonly models: readonly string[]; readonly sounds: readonly string[]; }
export interface Q3RemotePresentationOptions {
  readonly identity: IdentityOwner;
  readonly session: EngineSession;
  readonly content: LoadedApplicationContent;
  readonly userinfo: () => string;
  loadContent(world: Q3RemoteWorld, connection: Q3ClientConnection): Promise<LoadedApplicationContent>;
  readonly downloads?: {
    prepare(connection: Q3ClientConnection): Promise<boolean>;
    publishSize(size: number): number;
    receive(block: Download): Promise<void>;
    close(): void;
  };
  shutdown?(): Promise<void>;
  initialize?(connection: Q3ClientConnection): Promise<void>;
  sendCommand(text: string): void;
  print(text: string): void;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const bounds = { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } };
export class Q3RemotePresentation implements Q3ApplicationClientHost, RemotePresentationAccess {
  readonly client;
  readonly identity;
  readonly userinfo;
  readonly clock = new Q3ClientClock();
  private connection: Q3ClientConnection | null = null;
  private content: LoadedApplicationContent;
  private collision;
  private readonly actors = new Map<number, ActorId>();
  private generation = 0;
  private ordinal = 0;
  private current: Snapshot | null = null;
  private loadingDownloads = false;
  get downloading(): boolean { return this.loadingDownloads; }
  private published: SimulationOutput | null = null;
  private gameStateMessage = 0;
  private gameStateCommands = 0;
  private prediction: PresentationPredictionAdapter | null = null;
  private source: ApplicationQ3ClientSource | null = null;
  constructor(readonly options: Q3RemotePresentationOptions) {
    this.content = options.content; this.collision = createSceneQueries(this.content.world);
    this.client = options.session.createClient(0); this.client.connect('remote');
    this.identity = { client: this.client.id, seat: null }; this.userinfo = options.userinfo;
  }
  get scene() { return this.collision; }
  get output(): SimulationOutput | null { return this.published; }
  get player() { return this.current === null ? null : { actor: this.actorAt(this.current.playerState.clientNum), client: this.client.id, sourceEntity: this.current.playerState.clientNum }; }
  get admittedPlayer() { const connection = this.connection; if (connection === null) throw new Error("Q3 seat has no decoded connection"); return { actor: this.actorAt(connection.clientNumber), client: this.client.id, sourceEntity: connection.clientNumber }; }
  get initialPlayer(): Snapshot['playerState'] { if (this.current === null) throw new Error('Q3 cgame needs its first decoded player state'); return this.current.playerState; }
  get cgameSource(): ApplicationQ3ClientSource { if (this.source === null) throw new Error('Q3 cgame has no connection source'); return this.source; }
  get sourceRecords(): readonly string[] { return this.connection?.gameState.copyStrings() ?? []; }
  actorAt(number: number): ActorId {
    if (!Number.isInteger(number) || number < 0 || number >= 1024) throw new Error('Invalid Q3 source entity');
    const old = this.actors.get(number); if (old !== undefined) return old;
    const actor = this.options.identity.actor(this.ordinal++, this.generation); this.actors.set(number, actor); return actor;
  }
  numberOf(actor: ActorId): number | null { for (const [number, value] of this.actors) if (value.equals(actor)) return number; return null; }
  isPlayer(actor: ActorId): boolean { const number = this.numberOf(actor); return number !== null && number < 64; }
  attach(connection: Q3ClientConnection): void {
    this.connection = connection;
    const history = new HistorySnapshotSource(connection.history, () => connection.parseEntities.number, text => this.print(text));
    const remote = this;
    this.source = {
      get time() { return remote.clock.time; }, get clientNumber() { return connection.clientNumber; },
      get serverMessageSequence() { return remote.gameStateMessage; }, get lastExecutedServerCommand() { return remote.gameStateCommands; },
      current: () => history.current(), read: number => history.read(number), actorAt: number => remote.actorAt(number),
      getGameState: () => connection.gameState.copyStrings(), systemInfo: () => connection.gameState.get(1) ?? '', getServerCommand: sequence => connection.getServerCommand(sequence), snapshotPing: number => connection.snapshotPing(number),
      commands: { get currentNumber() { return connection.commands.currentNumber; }, read: number => {
        const value = connection.commands.read(number); return value === null ? null : { ...value, angles: { x: value.angles[0], y: value.angles[1], z: value.angles[2] } };
      } },
    };
  }
  async clearActive(): Promise<void> { await this.options.shutdown?.(); this.options.downloads?.close(); this.loadingDownloads = false; this.generation++; this.actors.clear(); this.current = null; this.published = null; this.prediction = null; this.clock.clear(); }
  async systemInfo(info: string): Promise<void> {
    if (Number(q3InfoValue(info, 'sv_pure')) !== 0 && this.options.initialize === undefined) throw new Error('This server requires pure verification, which is not supported yet.');
    remoteContentSelection('q3-baseq3', q3InfoValue(info, 'fs_game'));
  }
  async gamestate(state: Gamestate, _generation: number): Promise<void> {
    const connection = this.connection; if (connection === null) throw new Error('Q3 gamestate has no connection');
    const info = connection.gameState.get(0) ?? '';
    if (q3InfoValue(info, 'protocol') !== '68') throw new Error('Q3 remote requires protocol 68');
    const gameType = Number(q3InfoValue(info, 'g_gametype'));
    if (!Number.isInteger(gameType) || gameType < 0 || gameType > 4) throw new Error('Q3 remote requires a baseq3 game type');
    const map = q3InfoValue(info, 'mapname'); if (!/^[A-Za-z0-9_/-]+$/.test(map) || map.includes('..')) throw new Error('Invalid Q3 remote map name');
    const names = (first: number, count: number): string[] => Array.from({ length: count }, (_, i) => connection.gameState.get(first + i) ?? '').filter(value => value.length > 0);
    this.gameStateMessage = connection.serverMessageSequence; this.gameStateCommands = state.commandSequence;
    this.loadingDownloads = await this.options.downloads?.prepare(connection) ?? false;
    if (this.loadingDownloads) return;
    this.content = await this.options.loadContent({ map: `maps/${map}.bsp`, models: names(32, 256), sounds: names(288, 256) }, connection);
    this.collision = createSceneQueries(this.content.world);
    await this.options.initialize?.(connection);
  }
  downloadSize(size: number): number {
    if (this.options.downloads === undefined) throw new Error("Q3 package downloads have no writable content owner");
    return this.options.downloads.publishSize(size);
  }
  async download(block: Download): Promise<void> {
    if (this.options.downloads === undefined) throw new Error("Q3 package downloads have no writable content owner");
    await this.options.downloads.receive(block);
  }
  snapshot(snapshot: Snapshot, _ping: number): void {
    this.current = snapshot; this.clock.publish(snapshot);
    if (this.prediction !== null) this.prediction.capture(this.predictionSnapshot());
    this.publish(snapshot.serverTime);
  }
  mapRestart(): void { if (this.prediction !== null && this.current !== null) this.prediction.capture(this.predictionSnapshot()); }
  private requirePlayer(actor: ActorId): Snapshot {
    if (this.current === null || !this.actorAt(this.current.playerState.clientNum).equals(actor)) throw new Error('No decoded Q3 player state'); return this.current;
  }
  worldText(): readonly WorldText[] { return []; }

  playerView(actor: ActorId): PlayerView { if (this.current === null && this.admittedPlayer.actor.equals(actor)) return { origin: zero, angles: zero, viewHeight: 0 }; const ps = this.requirePlayer(actor).playerState; return { origin: ps.origin, angles: ps.viewangles, viewHeight: ps.viewheight }; }
  playerUi(actor: ActorId): PlayerUi {
    const ps = this.requirePlayer(actor).playerState, weapon = q3WeaponItem(ps.weapon), source = this.content.recipe.weapons[0];
    if (source === undefined) throw new Error('Q3 remote has no native weapon provider');
    const definitions = Q3_WEAPON_ITEMS.filter(value => value.weapon <= 10);
    const count = (item: ItemId): number => { const definition = definitions.find(value => value.item === item || value.ammo === item); return definition === undefined ? 0 : definition.item === item ? (ps.stats.get(2) & (1 << definition.weapon)) !== 0 ? 1 : 0 : ps.ammo.get(definition.weapon); };
    const inventory = definitions.flatMap(value => [{ item: value.item, count: count(value.item), capacity: 1 }, ...(value.ammo === null ? [] : [{ item: value.ammo, count: count(value.ammo), capacity: 200 }])]);
    return { health: ps.stats.get(0), armor: ps.stats.get(3) === 0 ? { kind: 'none' } : { kind: 'q3', points: ps.stats.get(3), protection: Math.fround(0.66) },
      activeWeapon: weapon?.item ?? null, ammo: weapon?.ammo === null || weapon === null ? null : { item: weapon.ammo, count: ps.ammo.get(weapon.weapon) },
      inventory, weaponStatus: q3WeaponStatus(weapon?.item ?? null, 'baseq3', count, source), arsenalWarning: q3ArsenalWarning('baseq3', count),
      items: definitions.map(value => ({ id: value.item, label: value.item.slice('q3:weapon/'.length), kind: 'weapon', sourceOrdinal: value.weapon, owned: count(value.item) > 0,
        hasAmmo: value.ammo === null || count(value.ammo) > 0, count: value.ammo === null ? null : count(value.ammo), warningCount: 0 })) };
  }
  characterViews(): ReturnType<RemotePresentationAccess['characterViews']> { return []; }
  presentations(): readonly SimulationPresentation[] { return []; }
  registerResource(_content: ContentId, _path: string, _resource: ResolvedResourceReference): undefined { return undefined; }
  playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
    this.requirePlayer(actor);
    if ([name, ...args].some(value => /["\n\r;]/.test(value))) throw new Error('Invalid Q3 command delimiter');
    this.options.sendCommand([name, ...args.map(value => `"${value}"`)].join(' ')); return undefined;
  }
  command(command: ActorCommand): WireUserCommand {
    const snapshot = this.requirePlayer(command.actor); if (command.command.kind !== 'q3') throw new Error('Native Q3 remote requires Q3 commands');
    const delta = snapshot.playerState.deltaAngles;
    const source = relativeQ3SourceCommand(command.source, presentationSourceCommand(command, this.clock.time, command.command.weapon), delta);
    return { ...source, serverTime: this.clock.time, angles: [source.angles.x & 65535, source.angles.y & 65535, source.angles.z & 65535] };
  }
  private publish(time: number): void {
    const snapshot = this.current, player = this.player; if (snapshot === null || player === null) return;
    const recipe = this.content.recipe, ps = snapshot.playerState;
    const bodies = snapshot.entities.filter(entity => entity.number !== ps.clientNum).map(entity => ({ actor: this.actorAt(entity.number), body: { origin: entity.pos.base, angles: entity.apos.base, velocity: entity.pos.delta, bounds, ground: null } }));
    bodies.push({ actor: player.actor, body: { origin: ps.origin, angles: ps.viewangles, velocity: ps.velocity, bounds, ground: null } });
    this.published = { snapshot: { session: this.options.session.session, frame: { frame: snapshot.messageNumber, time: { kind: 'milliseconds', value: time }, elapsed: { kind: 'milliseconds', value: 0 }, phase: 'frame-exit' },
      actors: bodies.map(body => ({ id: body.actor, owner: recipe.map.entities.provider, definition: 'q3:remote-entity' })), bodies, inventories: [{ actor: player.actor, entries: this.playerUi(player.actor).inventory }],
      configurations: [{ actor: player.actor, movement: recipe.movement, character: recipe.character, weapons: recipe.weapons, inventory: recipe.inventory }],
      scene: { session: this.options.session.session, time: { kind: 'milliseconds', value: time }, world: { resource: recipe.map.geometry, geometry: this.content.world }, entities: [], lights: [], particles: [], lightStyles: [], areaBits: snapshot.areaMask } }, events: [] };
    this.options.session.publish(this.published);
  }
  samplePresentation(now: number): SimulationOutput | null {
    const time = this.clock.advance(Math.trunc(now), { paused: false, timeNudge: 0, timescale: 1, demo: false, freezeDemo: false, timedemo: false });
    if (time === null) return null; this.publish(time); return this.published;
  }
  private predictionSnapshot(): MovementPredictionSnapshot {
    const current = this.current, player = this.player; if (current === null || player === null) throw new Error('Q3 prediction needs a snapshot');
    const ps = current.playerState, canonical = toQ3PlayerState(ps), recipe = this.content.recipe;
    const entities = { actorAt: (number: number) => this.actorAt(number), numberOf: (actor: ActorId) => this.numberOf(actor) };
    const base: MovementPredictionSnapshot = { sequence: this.connection?.commands.currentNumber ?? 0, commandTimeMilliseconds: ps.commandTime,
      state: { ...canonical, kind: 'q3', ground: predictionSourceHit(ps.groundEntityNum, entities), predictableEventSequence: ps.eventSequence, jumpPad: ps.jumppadEnt === 0 ? null : this.actorAt(ps.jumppadEnt), movementFrame: ps.pmoveFramecount, jumpPadFrame: ps.jumppadFrame },
      arsenal: { provider: recipe.inventory.provider, activeWeapon: q3WeaponItem(ps.weapon)?.item ?? null, ammo: this.playerUi(player.actor).inventory, state: { kind: 'q3', sourceWeapon: ps.weapon, state: ps.weaponState, timeMilliseconds: ps.weaponTime } },
      animation: { provider: recipe.character.definition.provider, state: { kind: 'q3', legs: ps.legsAnim, torso: ps.torsoAnim, legsTimerMilliseconds: ps.legsTimer, torsoTimerMilliseconds: ps.torsoTimer } },
      environment: { health: ps.stats.get(0), flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, bounds, viewAngles: ps.viewangles, viewHeight: ps.viewheight, viewOffset: { ...zero, z: ps.viewheight }, contact: null, q3Arsenal: null };
    return readPredictionSourceState(base, retailSnapshot(current).playerState, entities);
  }
  movement(seat: SeatId): PresentationPredictionAdapter {
    if (this.prediction !== null) return this.prediction;
    const player = this.player; if (player === null) throw new Error('Q3 prediction has no player');
    this.prediction = createPresentationMovementHost({ movement: { actor: this.options.identity.ownedActor(player.actor, this.content.recipe.map.entities.provider), seat, recipe: this.content.recipe,
      profile: movementProfile(this.content.recipe), standingBounds: bounds, standingViewHeight: 26, scene: this.scene, isBrush: hit => hit.kind === 'world' || hit.kind === 'actor' && this.current?.entities.some(entity => entity.solid === 0xffffff && this.actorAt(entity.number).equals(hit.actor)) === true },
      initial: this.predictionSnapshot(), entities: { actorAt: number => this.actorAt(number), numberOf: actor => this.numberOf(actor) } });
    return this.prediction;
  }
  drainPresentationEvents(): readonly SimulationPresentationEvent[] { return []; }
  print(text: string): void { this.options.print(text); }
  disconnected(reason: string): void { this.print(`${reason}\n`); this.client.disconnect(); }
}
