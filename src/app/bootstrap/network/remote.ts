import { RemoteWorldContent } from './remote-world.ts';
import type { RemoteContentMounts } from "../content.ts";
import type { ClientDownloadPermission } from './client-download-policy.ts';
import type { WorldText } from "../../../text/world.ts";
import type { ContentId, ResolvedResourceReference } from '../../../contracts/content.ts';
import type { ActorId, IdentityOwner } from '../../../contracts/identity.ts';
import { negotiatedR1Q2Protocol } from '../../../network/q2/codec.ts';
import type { Bounds, Vec3 } from '../../../contracts/math.ts';
import type { Q2ProtocolIdentity } from '../../../contracts/protocol.ts';
import type { ActorCommand, BodySnapshot, SimulationOutput } from '../../../contracts/session.ts';
import type { SceneLightStyle, SceneQueries } from '../../../contracts/scene.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { Q2_BASE_WEAPONS } from '../../../content/q2/foundation/weapons/index.ts';
import { muzzleOffset } from '../../../content/q2/foundation/monsters/muzzle.ts';
import { anglesVectors } from '../../../content/q2/foundation/monsters/ai.ts';
import { fromQ2Command, readElement, toQ2Command, toQ2Player } from '../../../network/q2/index.ts';
import type { Q2ServerRecord, Q2WireFrame, UsercmdT } from '../../../network/q2/index.ts';
import type { EngineSession, SessionClient } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { PlayerUi, PlayerView, SimulationPresentation, SimulationPresentationEvent } from '../simulation/types.ts';
import type { Q2ApplicationClientHost, Q2ApplicationGameState, Q2ApplicationPlayer, RemotePresentationAccess } from './types.ts';
import { q2WeaponStatus } from "../simulation/arsenal/weapon-status.ts";
import { q2ApplicationLayout } from './q2-layout.ts';
import { Q2DownloadReceiver } from './q2-downloads.ts';
import { q2EffectFromWire } from './q2-effects.ts';
import { SelectedMovementPrediction } from '../simulation/prediction.ts';
import type { MovementPredictionResult, MovementPredictionSnapshot } from '../simulation/prediction.ts';
import { movementOrigin, movementProfile } from '../simulation/players.ts';
export interface Q2RemotePresentationOptions {
    presentationTime?(): number;
    readonly identity: IdentityOwner;
    readonly session: EngineSession;
    readonly content: LoadedApplicationContent | null;
    readonly protocol: Q2ProtocolIdentity;
    readonly userinfo: () => string;
    readonly downloadPermission?: ClientDownloadPermission;
    print(text: string): void;
    sendCommand(text: string): void;
    loadContent?(state: Q2ApplicationGameState): Promise<LoadedApplicationContent>;
    prepareServerData(data: Q2ApplicationGameState["data"], assertCurrent: () => void): Promise<RemoteContentMounts>;
    refreshDownloads?(assertCurrent: () => void): Promise<RemoteContentMounts>;
}
export function q2RemoteEntityBounds(solid: number, longSolid: boolean): Bounds {
    const size = longSolid ? solid & 255 : (solid & 31) * 8;
    const down = longSolid ? solid >>> 8 & 255 : (solid >>> 5 & 31) * 8;
    const up = longSolid ? (solid >>> 16 & 65535) - 32768 : (solid >>> 10 & 63) * 8 - 32;
    return { min: { x: -size, y: -size, z: -down }, max: { x: size, y: size, z: up } };
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function vector(values: Float32Array): Vec3 { return { x: readElement(values, 0), y: readElement(values, 1), z: readElement(values, 2) }; }
function interpolate(from: Vec3, to: Vec3, fraction: number): Vec3 { return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, z: from.z + (to.z - from.z) * fraction }; }
function interpolateAngles(from: Vec3, to: Vec3, fraction: number): Vec3 {
    const angle = (a: number, b: number): number => a + (((b - a + 540) % 360) - 180) * fraction;
    return { x: angle(from.x, to.x), y: angle(from.y, to.y), z: angle(from.z, to.z) };
}
/** Decoded source records are presentation state. This owner has no Simulation or combat table. */
export class Q2RemotePresentation implements Q2ApplicationClientHost, RemotePresentationAccess {
    readonly downloads: Q2DownloadReceiver;
    private downloadContent: RemoteContentMounts | null = null;
    readonly client: SessionClient;
    private selectedProtocol: Q2ProtocolIdentity;
    private strafejumpHack = false;
    get protocol(): Q2ProtocolIdentity { return this.selectedProtocol; }
    readonly messageOptions;
    readonly userinfo: () => string;
    private readonly layout;
    private readonly actors = new Map<number, ActorId>();
    private readonly configs = new Map<number, string>();
    private readonly resources = new Map<string, ResolvedResourceReference>();
    private readonly events: SimulationPresentationEvent[] = [];
    private current: Q2WireFrame | null = null;
    private previousFrame: Q2WireFrame | null = null;
    private receivedAt = 0;
    private fraction = 1;
    private currentPlayer: Q2ApplicationPlayer | null = null;
    private published: SimulationOutput | null = null;
    private generation = 0;
    private nextActor = 0;
    private eventSequence = 0;
    private frameMilliseconds = 100;
    private inventory: readonly number[] = [];
    private lastRecords: readonly Q2ServerRecord[] = [];
    private layoutText = '';
    private readonly world: RemoteWorldContent;
    private predictionOwner: SelectedMovementPrediction | null = null;
    private predicted: MovementPredictionResult | null = null;
    private packetAcknowledged = 0;
    readonly prediction = {
        acknowledged: (sequence: number, _nowMilliseconds: number): void => { this.packetAcknowledged = sequence; },
        sent: (sequence: number, command: UsercmdT, nowMilliseconds: number): void => {
            this.predictionOwner?.submit({ sequence, timeMilliseconds: nowMilliseconds, command: toQ2Command(command) });
            this.predicted = this.predictionOwner?.replay() ?? null;
        },
    };
    constructor(readonly options: Q2RemotePresentationOptions) {
        if (options.protocol.kind !== 'q2-classic' && options.protocol.kind !== 'q2-r1q2')
            throw new Error('Remote application presentation binds Q2 protocol 34 or R1Q2');
        this.selectedProtocol = options.protocol;
        this.layout = q2ApplicationLayout(options.protocol);
        this.messageOptions = { maxConfigStrings: this.layout.maxConfigStrings, inventorySlots: 256 };
        this.userinfo = options.userinfo;
        this.world = new RemoteWorldContent(options.content);
        const refreshDownloads = options.refreshDownloads;
        this.downloads = new Q2DownloadReceiver(() => { if (this.downloadContent === null) throw new Error('Q2 downloads require prepared server content'); return this.downloadContent; }, options.sendCommand, options.print,
            refreshDownloads === undefined ? undefined : async () => {
                const revision = this.downloads.revision;
                const assertCurrent = (): void => { if (this.downloads.revision !== revision) throw new Error('Q2 package refresh was retired'); };
                const fresh = await refreshDownloads(assertCurrent);
                assertCurrent();
                this.downloadContent = fresh;
            }, options.downloadPermission);

        this.client = options.session.createClient(0);
        this.client.connect('remote');
    }
    get player(): Q2ApplicationPlayer | null { return this.currentPlayer; }
    get output(): SimulationOutput | null { return this.published; }
    /** Retained native fields include records whose specialized UI/effect handler is still unbound. */
    get sourceRecords(): readonly Q2ServerRecord[] { return this.lastRecords; }
    get nativeLayout(): string { return this.layoutText; }
    get scene(): SceneQueries { return this.world.scene; }
    isPlayer(actor: ActorId): boolean {
        if (this.currentPlayer?.actor.equals(actor)) return true;
        if (this.current === null) return false;
        const maximum = Number(this.configs.get(this.layout.maxClients));
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 256) throw new Error('Remote Q2 frame has no valid advertised client range');
        return this.current.entities.some(entity => entity.number >= 1 && entity.number <= maximum && this.actors.get(entity.number)?.equals(actor) === true);
    }
    private actor(number: number): ActorId {
        const current = this.actors.get(number);
        if (current !== undefined)
            return current;
        const actor = this.options.identity.actor(this.nextActor++, this.generation);
        this.actors.set(number, actor);
        return actor;
    }
    async serverData(data: Q2ApplicationGameState["data"], assertCurrent: () => void): Promise<void> {
        const revision = this.downloads.revision;
        const current = (): void => { assertCurrent(); if (revision !== this.downloads.revision) throw new Error('Q2 server content preparation was retired'); };
        const prepared = await this.options.prepareServerData(data, current);
        current(); this.downloadContent = prepared;
    }
    async gameState(state: Q2ApplicationGameState): Promise<void> {
        const offered = this.options.protocol;
        if (offered.kind === 'q2-r1q2') this.selectedProtocol = negotiatedR1Q2Protocol(offered, state.data.r1q2Version);
        this.strafejumpHack = offered.kind === 'q2-r1q2' && state.data.r1q2StrafejumpHack === true;
        const revision = this.downloads.revision;
        const content = this.options.loadContent === undefined ? this.world.content : await this.options.loadContent(state);
        if (revision !== this.downloads.revision) return;
        const path = state.configStrings.get(this.layout.models + 1);
        if (path !== content.recipe.map.geometry.requestedPath)
            throw new Error(`Q2 server map ${path ?? '<missing>'} requires application content replacement`);
        const checksum = state.configStrings.get(this.layout.mapChecksum);
        const mapBytes = await content.mounts.read(content.recipe.map.geometry);
        if (revision !== this.downloads.revision) return;
        if (checksum === undefined || (Number(checksum) >>> 0) !== blockChecksum(mapBytes))
            throw new Error('Q2 server map checksum differs from mounted content');
        if (state.data.clientnum < 0)
            throw new Error('Q2 remote multi-seat/cinematic serverdata requires its source presentation binding');
        this.world.content = content;
        const owner = this.downloadContent;
        if (owner !== null) this.downloadContent = { ...owner, catalog: content.catalog, product: content.catalog.product(owner.product.id), mounts: content.mounts };
        this.generation++;
        this.actors.clear();
        this.configs.clear();
        this.current = null;
        this.previousFrame = null;
        this.published = null;
        this.predictionOwner = null;
        this.predicted = null;

        this.inventory = [];
        this.layoutText = '';
        this.events.length = 0;
        for (const [index, value] of state.configStrings)
            this.configs.set(index, value);
        this.currentPlayer = { client: this.client.id, actor: this.actor(state.data.clientnum + 1), sourceEntity: state.data.clientnum + 1 };
        this.frameMilliseconds = 1000 / (state.data.serverFps ?? 10);
        for (const [index, value] of this.configs) this.playerInfo(index, value, 0);
    }
    private playerInfo(index: number, value: string, seconds: number): void {
        if (index < this.layout.playerSkins || index >= this.layout.playerSkins + 256) return;
        const slot = index - this.layout.playerSkins, split = value.indexOf('\\');
        this.events.push({ kind: 'q2-player', sequence: this.eventSequence++, content: this.world.content.recipe.map.entities.content, seconds, sourceEntity: slot + 1,
            event: { kind: 'userinfo', actor: this.actor(slot + 1), slot, name: split < 0 ? value : value.slice(0, split), skin: split < 0 ? '' : value.slice(split + 1) } });
    }
    private requirePlayer(actor: ActorId): {
        readonly player: Q2ApplicationPlayer;
        readonly frame: Q2WireFrame;
    } {
        if (this.currentPlayer === null || !this.currentPlayer.actor.equals(actor) || this.current === null)
            throw new Error('Remote Q2 player has no decoded frame');
        return { player: this.currentPlayer, frame: this.current };
    }
    private nativePlayer(frame: Q2WireFrame) { return toQ2Player(frame.player); }
    private playerOrigin(frame: Q2WireFrame): Vec3 { const movement = this.nativePlayer(frame).movement; return { x: movement.originEighths[0] / 8, y: movement.originEighths[1] / 8, z: movement.originEighths[2] / 8 }; }
    worldText(): readonly WorldText[] { return []; }

    playerView(actor: ActorId): PlayerView {
        const { frame } = this.requirePlayer(actor), origin = this.playerOrigin(frame), previous = this.previousFrame;
        const fieldOfView = previous === null ? frame.player.fov : previous.player.fov + (frame.player.fov - previous.player.fov) * this.fraction;
        const predicted = this.predicted;
        if (predicted?.status === 'predicted' || predicted?.status === 'disabled') return { origin: movementOrigin(predicted.player.state), angles: predicted.player.viewAngles,
            viewHeight: predicted.player.viewHeight, fieldOfView };
        if (previous === null)
            return { origin, fieldOfView, angles: vector(frame.player.viewangles), viewHeight: readElement(frame.player.viewoffset, 2) };
        const before = this.playerOrigin(previous), teleport = Math.max(Math.abs(origin.x - before.x), Math.abs(origin.y - before.y), Math.abs(origin.z - before.z)) > 256;
        return { fieldOfView, origin: teleport ? origin : interpolate(before, origin, this.fraction), angles: interpolateAngles(vector(previous.player.viewangles), vector(frame.player.viewangles), this.fraction), viewHeight: readElement(previous.player.viewoffset, 2) + (readElement(frame.player.viewoffset, 2) - readElement(previous.player.viewoffset, 2)) * this.fraction };
    }
    playerUi(actor: ActorId): PlayerUi {
        const { frame } = this.requirePlayer(actor), weaponModel = this.configs.get(this.layout.models + frame.player.gunindex), weapon = Q2_BASE_WEAPONS.find(item => item.viewModel === weaponModel);
        const source = this.world.content.recipe.weapons[0];
        if (source === undefined) throw new Error("Remote Q2 presentation requires its selected weapon provider");
        const entries = this.inventory.flatMap((count, ordinal) => {
            const label = this.configs.get(this.layout.items + ordinal), definition = Q2_BASE_WEAPONS.find(item => item.name === label?.toLowerCase().replaceAll(' ', ''));
            return count === 0 || definition === undefined ? [] : [{ item: definition.item, count, capacity: count }];
        });
        return { health: readElement(frame.player.stats, 1), armor: readElement(frame.player.stats, 5) === 0 ? { kind: 'none' } : { kind: 'q2', points: readElement(frame.player.stats, 5), normalProtection: 0, energyProtection: 0, item: 'q2:remote-armor', powerArmor: { kind: 'none' } },
            weaponStatus: q2WeaponStatus(weapon ?? null, () => readElement(frame.player.stats, 3), source), arsenalWarning: "none",
            activeWeapon: weapon?.item ?? null, ammo: weapon?.ammo === undefined || weapon.ammo === null ? null : { item: weapon.ammo, count: readElement(frame.player.stats, 3) }, inventory: entries,
            items: Q2_BASE_WEAPONS.map((definition, sourceOrdinal) => ({ id: definition.item, label: definition.name, kind: 'weapon', sourceOrdinal, owned: entries.some(entry => entry.item === definition.item) || weapon === definition, hasAmmo: definition.ammo === null || readElement(frame.player.stats, 3) >= definition.quantity, count: definition.ammo === null ? null : readElement(frame.player.stats, 3), warningCount: definition.warning })) };
    }
    characterViews(): ReturnType<RemotePresentationAccess['characterViews']> { return []; }
    presentations(): readonly SimulationPresentation[] {
        const current = this.current, player = this.currentPlayer;
        if (current === null || player === null)
            return [];
        const result: SimulationPresentation[] = [];
        for (const entity of current.entities) {
            let path = this.configs.get(this.layout.models + entity.modelindex), skinPath: string | null = null;
            if (entity.modelindex === 255) {
                const value = this.configs.get(this.layout.playerSkins + (entity.skinnum & 255)) ?? 'player\\male/grunt', appearance = value.slice(value.indexOf('\\') + 1), slash = appearance.indexOf('/'), model = slash < 0 ? 'male' : appearance.slice(0, slash), skin = slash < 0 ? 'grunt' : appearance.slice(slash + 1);
                path = `players/${model}/tris.md2`;
                skinPath = `players/${model}/${skin}.pcx`;
            }
            if (path === undefined || entity.modelindex === 0)
                continue;
            const prior = this.previousFrame?.entities.find(value => value.number === entity.number), continuous = prior !== undefined && prior.modelindex === entity.modelindex && entity.event !== 6 && entity.event !== 7 && Math.max(...[0, 1, 2].map(index => Math.abs(readElement(entity.origin, index) - readElement(prior.origin, index)))) <= 512;
            result.push({ actor: this.actor(entity.number), content: this.world.content.recipe.map.entities.content, family: 'q2', path, frame: entity.frame, oldFrame: continuous ? prior.frame : entity.frame, backLerp: continuous ? 1 - this.fraction : 0, skin: entity.modelindex === 255 ? 0 : entity.skinnum, skinPath, effects: entity.effects, renderFlags: entity.renderfx, origin: continuous ? interpolate(vector(prior.origin), vector(entity.origin), this.fraction) : vector(entity.origin), angles: continuous ? interpolateAngles(vector(prior.angles), vector(entity.angles), this.fraction) : vector(entity.angles), scale: entity.scale || 1, visible: true, viewWeapon: false });
        }
        const gunPath = this.configs.get(this.layout.models + current.player.gunindex);
        if (gunPath !== undefined && current.player.gunindex !== 0) {
            const view = this.playerView(player.actor), offset = vector(current.player.gunoffset);
            result.push({ actor: player.actor, content: this.world.content.recipe.map.entities.content, family: 'q2', path: gunPath, frame: current.player.gunframe, oldFrame: this.previousFrame?.player.gunindex === current.player.gunindex ? this.previousFrame.player.gunframe : current.player.gunframe, backLerp: 1 - this.fraction, skin: current.player.gunskin, effects: 0, renderFlags: 0, origin: { x: view.origin.x + offset.x, y: view.origin.y + offset.y, z: view.origin.z + view.viewHeight + offset.z }, angles: view.angles, scale: 1, visible: true, viewWeapon: true });
        }
        return result;
    }
    registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined { this.resources.set(`${content}/${path}`, resource); return undefined; }
    playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
        this.requirePlayer(actor);
        if ([name, ...args].some(value => /["\n\r;]/.test(value)))
            throw new Error('Q2 console argument contains a command delimiter');
        this.options.sendCommand([name, ...args.map(value => `"${value}"`)].join(' '));
        return undefined;
    }
    command(command: ActorCommand): UsercmdT {
        const { frame } = this.requirePlayer(command.actor);
        if (command.command.kind !== 'q2-classic' && command.command.kind !== 'q2-rerelease')
            throw new Error('Native Q2 client requires Q2 movement commands');
        const wire = fromQ2Command(command.command);
        for (let index = 0; index < 3; index++)
            wire.angles[index] = (readElement(wire.angles, index) - readElement(frame.player.pmove.delta_angles, index)) & 65535;
        return wire;
    }
    frame(frame: Q2WireFrame, records: readonly Q2ServerRecord[], nowMilliseconds: number): void {
        for (const { event } of records)
            if (event.kind === 'config-string')
                this.configs.set(event.index, event.value);
        const player = this.currentPlayer;
        if (player === null)
            throw new Error('Q2 frame precedes application signon');
        const previous = this.current;
        this.previousFrame = previous;
        this.current = frame;
        this.predicted = null;
        this.fraction = 1;
        this.receivedAt = this.options.presentationTime?.() ?? nowMilliseconds;
        const movement = this.nativePlayer(frame).movement, view = this.playerView(player.actor), velocity = { x: movement.velocityEighths[0] / 8, y: movement.velocityEighths[1] / 8, z: movement.velocityEighths[2] / 8 };
        const bodies: BodySnapshot[] = frame.entities.filter(entity => entity.number !== player.sourceEntity).map(entity => {
            const bounds = q2RemoteEntityBounds(entity.solid, this.protocol.kind === 'q2-r1q2' && this.protocol.revision >= 1905);
            return { actor: this.actor(entity.number), body: { origin: vector(entity.origin), angles: vector(entity.angles), velocity: zero, bounds, ground: null } };
        });
        bodies.push({ actor: player.actor, body: { origin: view.origin, angles: view.angles, velocity, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: view.viewHeight + 10 } }, ground: null } });
        const time = frame.serverFrame * this.frameMilliseconds, recipe = this.world.content.recipe;
        const lightStyles: SceneLightStyle[] = [];
        for (let style = 0; style < 256; style++) {
            const pattern = this.configs.get(this.layout.lights + style);
            if (pattern === undefined)
                continue;
            const value = pattern.length === 0 ? 1 : (pattern.charCodeAt(Math.floor(time / 100) % pattern.length) - 97) / 12;
            lightStyles.push({ kind: 'q2', style, rgb: { x: value, y: value, z: value }, white: value * 3 });
        }
        this.published = { snapshot: { session: this.options.session.session, frame: { frame: frame.serverFrame, time: { kind: 'milliseconds', value: time }, elapsed: { kind: 'milliseconds', value: previous === null ? this.frameMilliseconds : (frame.serverFrame - previous.serverFrame) * this.frameMilliseconds }, phase: 'frame-exit' },
                actors: bodies.map(body => ({ id: body.actor, owner: recipe.map.entities.provider, definition: 'q2:remote-entity' })), bodies, inventories: [{ actor: player.actor, entries: this.playerUi(player.actor).inventory }], configurations: [{ actor: player.actor, movement: recipe.movement, character: recipe.character, weapons: recipe.weapons, inventory: recipe.inventory }],
                scene: { session: this.options.session.session, time: { kind: 'milliseconds', value: time }, world: { resource: recipe.map.geometry, geometry: this.world.content.world }, entities: [], lights: [], particles: [], lightStyles, areaBits: frame.areaBits } }, events: [] };
        this.options.session.publish(this.published);
        this.linkSolids(frame, bodies);
        this.receivePrediction(frame);
        for (const entity of frame.entities)
            if (entity.event !== 0)
                this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: this.world.content.recipe.map.entities.content, seconds: time / 1000, sourceEntity: entity.number, event: { kind: 'entity-event', actor: this.actor(entity.number), event: entity.event } });
        for (const entity of previous?.entities ?? []) {
            if (entity.sound === 0 || frame.entities.some(current => current.number === entity.number && current.sound === entity.sound)) continue;
            this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: this.world.content.recipe.map.entities.content, seconds: time / 1000, sourceEntity: entity.number, event: { kind: 'sound', actor: this.actor(entity.number), origin: vector(entity.origin), path: this.configs.get(this.layout.sounds + entity.sound) ?? '', channel: 0, volume: 0, attenuation: 0, reliable: false, loop: 'stop' } });
        }
        for (const entity of frame.entities) {
            if (entity.sound === 0 || previous?.entities.some(old => old.number === entity.number && old.sound === entity.sound)) continue;
            const path = this.configs.get(this.layout.sounds + entity.sound);
            if (path === undefined) throw new Error(`Q2 loop sound ${entity.sound} has no configstring`);
            this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: this.world.content.recipe.map.entities.content, seconds: time / 1000, sourceEntity: entity.number, event: { kind: 'sound', actor: this.actor(entity.number), origin: vector(entity.origin), path, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: 'start' } });
        }
    }
    private receivePrediction(frame: Q2WireFrame): void {
        const player = this.currentPlayer;
        if (player === null) return;
        const native = this.nativePlayer(frame), recipe = this.world.content.recipe;
        const profile = movementProfile(recipe);
        if (profile.kind !== 'q2-classic' || native.kind !== 'q2-classic') return;
        const airAccelerate = (): number => Number(this.configs.get(this.layout.airAccelerate) ?? '0');
        const strafejumpHack = (): boolean => this.strafejumpHack;
        const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
        const snapshot: MovementPredictionSnapshot = { sequence: this.packetAcknowledged, commandTimeMilliseconds: frame.serverFrame * this.frameMilliseconds,
            state: native.movement, viewAngles: native.viewAngles, viewHeight: native.viewOffset.z, viewOffset: native.viewOffset, bounds,
            environment: { health: native.stats[1] ?? 0, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 },
            arsenal: { provider: recipe.inventory.provider, activeWeapon: this.playerUi(player.actor).activeWeapon,
                ammo: this.playerUi(player.actor).inventory, state: { kind: 'q2', gunFrame: native.gunFrame, state: 0, pendingWeapon: null,
                    machinegunShots: 0, grenadeTime: { kind: 'seconds', value: 0 }, grenadeBlewUp: false } },
            animation: { provider: recipe.character.definition.provider, state: { kind: 'q2', frame: 0, endFrame: 0, priority: 0, duck: false, run: false } },
            contact: null, q3Arsenal: null };
        if (this.predictionOwner === null) this.predictionOwner = new SelectedMovementPrediction({
            actor: this.options.identity.ownedActor(player.actor, recipe.map.entities.provider), seat: this.options.identity.seat(this.client.id.slot),
            recipe, get profile() { return { ...profile, airAccelerate: airAccelerate(), strafejumpHack: strafejumpHack() }; },
            standingBounds: bounds, standingViewHeight: 22, scene: this.world.scene,
            isBrush: hit => hit.kind === 'world' || hit.kind === 'actor' && (this.current?.entities.some(entity => this.actor(entity.number).equals(hit.actor) && entity.solid === 31) ?? false),
        }, snapshot);
        else this.predictionOwner.receive(snapshot);
        this.predicted = this.predictionOwner.replay();
    }
    private linkSolids(frame: Q2WireFrame, bodies: readonly BodySnapshot[]): void {
        for (const actor of this.actors.values())
            this.world.scene.unlink(actor);
        for (const entity of frame.entities) {
            if (entity.solid === 0)
                continue;
            const body = bodies.find(value => value.actor.equals(this.actor(entity.number)));
            if (body === undefined)
                continue;
            const path = this.configs.get(this.layout.models + entity.modelindex), model = entity.solid === 31 && path?.startsWith('*') ? Number(path.slice(1)) : null;
            if (entity.solid === 31 && (model === null || !Number.isInteger(model)))
                continue;
            const bounds = model === null ? body.body.bounds : this.world.scene.modelBounds(model), origin = body.body.origin;
            const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
            const rotated = model !== null && (body.body.angles.x !== 0 || body.body.angles.y !== 0 || body.body.angles.z !== 0), linkedBounds = rotated ? { min: { x: -radius, y: -radius, z: -radius }, max: { x: radius, y: radius, z: radius } } : bounds;
            this.world.scene.link({ actor: body.actor, state: { ...body.body, bounds }, linkCount: frame.serverFrame, absoluteBounds: { min: { x: origin.x + linkedBounds.min.x - 1, y: origin.y + linkedBounds.min.y - 1, z: origin.z + linkedBounds.min.z - 1 }, max: { x: origin.x + linkedBounds.max.x + 1, y: origin.y + linkedBounds.max.y + 1, z: origin.z + linkedBounds.max.z + 1 } } }, { family: 'q2', shape: model === null ? { kind: 'box' } : { kind: 'model', model }, contents: model === null ? 0x2000000 : 1, owner: null, role: 'solid', monster: model === null, deadMonster: false });
        }
    }
    /** Remote bodies remain presentation samples; pending moves replay in private player state. */
    samplePresentation(nowMilliseconds: number): SimulationOutput | null {
        nowMilliseconds = this.options.presentationTime?.() ?? nowMilliseconds;
        const current = this.current, output = this.published, player = this.currentPlayer;
        if (current === null || output === null || player === null)
            return null;
        this.fraction = Math.max(0, Math.min(1, (nowMilliseconds - this.receivedAt) / this.frameMilliseconds));
        const presentations = this.presentations(), view = this.playerView(player.actor);
        const time = (current.serverFrame - 1 + this.fraction) * this.frameMilliseconds;
        const priorTime = output.snapshot.frame.time.kind === 'milliseconds' ? output.snapshot.frame.time.value : output.snapshot.frame.time.value * 1000;
        const sampled: SimulationOutput = { ...output, snapshot: { ...output.snapshot,
                frame: { ...output.snapshot.frame, time: { kind: 'milliseconds', value: time }, elapsed: { kind: 'milliseconds', value: Math.max(0, time - priorTime) } },
                scene: { ...output.snapshot.scene, time: { kind: 'milliseconds', value: time } },
                bodies: output.snapshot.bodies.map(body => {
                    if (body.actor.equals(player.actor))
                        return { ...body, body: { ...body.body, origin: view.origin, angles: view.angles } };
                    const presentation = presentations.find(value => value.actor.equals(body.actor) && !value.viewWeapon);
                    return presentation === undefined ? body : { ...body, body: { ...body.body, origin: presentation.origin, angles: presentation.angles } };
                }) } };
        this.published = sampled;
        this.options.session.publish(sampled);
        return sampled;
    }
    records(records: readonly Q2ServerRecord[]): void {
        this.lastRecords = records;
        const content = () => this.world.content.recipe.map.entities.content;
        const seconds = (this.current?.serverFrame ?? 0) * this.frameMilliseconds / 1000;
        for (const { event } of records) {
            if (event.kind === 'config-string') {
                this.configs.set(event.index, event.value);
                if (this.currentPlayer !== null) this.playerInfo(event.index, event.value, seconds);
            }
            else if (event.kind === 'print' && event.level === 3 && this.currentPlayer !== null) this.events.push({ kind: 'q2-player', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: this.currentPlayer?.sourceEntity ?? null, event: { kind: 'print', target: this.currentPlayer?.actor ?? null, level: 'chat', text: event.text } });
            else if (event.kind === 'inventory')
                this.inventory = event.counts;
            else if (event.kind === 'layout')
                this.layoutText = event.text;
            else if (event.kind === 'temporary-entity') {
                const decoded = q2EffectFromWire(event.value);
                if (decoded !== null)
                    this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: null, event: decoded });
            }
            else if (event.kind === 'sound') {
                const path = this.configs.get(this.layout.sounds + event.sound.index);
                if (path === undefined)
                    throw new Error(`Q2 sound ${event.sound.index} has no configstring`);
                const entity = this.current?.entities.find(entity => entity.number === event.sound.entity);
                this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: event.sound.entity, event: { kind: 'sound', actor: event.sound.entity === 0 ? null : this.actor(event.sound.entity), origin: event.sound.position ?? (entity === undefined ? zero : vector(entity.origin)), path, volume: event.sound.volume, attenuation: event.sound.attenuation, channel: event.sound.channel, reliable: false, loop: 'once' } });
            }
            else if (event.kind === 'muzzle-flash') {
                if (event.monster) {
                    const entity = this.current?.entities.find(entity => entity.number === event.entity);
                    if (entity === undefined)
                        continue;
                    const axes = anglesVectors(vector(entity.angles)), offset = muzzleOffset('classic', event.flash), origin = vector(entity.origin);
                    this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: event.entity, event: { kind: 'monster-muzzleflash', actor: this.actor(event.entity), flash: event.flash,
                            origin: { x: origin.x + axes.forward.x * offset.x + axes.right.x * offset.y, y: origin.y + axes.forward.y * offset.x + axes.right.y * offset.y, z: origin.z + axes.forward.z * offset.x + axes.right.z * offset.y + offset.z }, direction: axes.forward } });
                }
                else
                    this.events.push({ kind: 'q2-weapon', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: event.entity, event: { kind: 'muzzleflash', actor: this.actor(event.entity), flash: event.flash, silenced: event.silenced } });
            }
            else if (event.kind === 'center-print' && this.currentPlayer !== null)
                this.events.push({ kind: 'q2', sequence: this.eventSequence++, content: content(), seconds, sourceEntity: this.currentPlayer.sourceEntity, event: { kind: 'centerprint', actor: this.currentPlayer.actor, text: event.text } });
        }
    }
    drainPresentationEvents(): readonly SimulationPresentationEvent[] { return this.events.splice(0); }
    disconnected(reason: string): void { this.options.print(`${reason}\n`); this.client.disconnect(); }
    print(text: string): void { this.options.print(text); }
}
