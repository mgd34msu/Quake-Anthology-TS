import { RemoteWorldContent } from './remote-world.ts';
import type { WorldText } from "../../../text/world.ts";
/* WinQuake cl_parse.c and cl_main.c decoded presentation. GPL-2.0-or-later. */
import type { ActorId, IdentityOwner } from '../../../contracts/identity.ts';
import type { ContentId, ResolvedResourceReference } from '../../../contracts/content.ts';
import type { ItemId } from '../../../contracts/gameplay.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { ActorCommand, SimulationOutput, SimulationEvent } from '../../../contracts/session.ts';
import type { Q1ClientData, Q1ExtendedEntityState, Q1UserCommand } from '../../../contracts/protocol.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';
import { ENTALPHA_DECODE, ENTSCALE_DECODE } from '../../../network/q1/constants.ts';
import type { EngineSession, SessionClient } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { PlayerUi, PlayerView, SimulationPresentation, SimulationPresentationEvent } from '../simulation/types.ts';
import type { Q1Event, Q1SoundChannel } from '../../../content/q1/foundation/types.ts';
import type { Q1ApplicationClientHost } from './q1-client.ts';
import type { RemotePresentationAccess } from './types.ts';
export interface Q1RemoteWorld {
    readonly map: string;
    readonly models: readonly string[];
    readonly sounds: readonly string[];
}
export interface Q1RemotePresentationOptions {
    presentationTime?(): number;
    readonly identity: IdentityOwner;
    readonly session: EngineSession;
    readonly client: SessionClient;
    nextGeneration(slot: number): number;
    readonly content: LoadedApplicationContent | null;
    loadContent(world: Q1RemoteWorld, assertCurrent?: () => void): Promise<LoadedApplicationContent>;
    sendCommand(text: string): void;
    print(text: string): void;
    publish(output: SimulationOutput): void;
    disconnected(reason: string): void;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const weapons = [
    { bit: 4096, name: 'axe', ammo: null }, { bit: 1, name: 'shotgun', ammo: 'shells' },
    { bit: 2, name: 'supershotgun', ammo: 'shells' }, { bit: 4, name: 'nailgun', ammo: 'nails' },
    { bit: 8, name: 'supernailgun', ammo: 'nails' }, { bit: 16, name: 'grenadelauncher', ammo: 'rockets' },
    { bit: 32, name: 'rocketlauncher', ammo: 'rockets' }, { bit: 64, name: 'lightning', ammo: 'cells' },
];
function soundChannel(value: number): Q1SoundChannel {
    const channels: readonly Q1SoundChannel[] = ['auto', 'weapon', 'voice', 'item', 'body', 5, 6, 7];
    const channel = channels[value];
    if (channel === undefined) throw new Error('Invalid NetQuake sound channel');
    return channel;
}
function lerp(a: Vec3, b: Vec3, f: number): Vec3 { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }; }
function angles(a: Vec3, b: Vec3, f: number): Vec3 {
    const axis = (a: number, b: number): number => a + (((b - a + 540) % 360) - 180) * f;
    return { x: axis(a.x, b.x), y: axis(a.y, b.y), z: axis(a.z, b.z) };
}
export class Q1RemotePresentation implements Q1ApplicationClientHost, RemotePresentationAccess {
    readonly client;
    private readonly world: RemoteWorldContent;
    private ordinal = 0;
    private sequence = 0;
    private frameNumber = 0;
    private pendingImpulse = 0;
    private seconds = 0;
    private previousSeconds = 0;
    private receivedAt = 0;
    private fraction = 1;
    private maxClients = 0;
    private viewEntity = 0;
    private viewAngles = zero;
    private demoSeconds: number | null = null;
    private demoAngles: { readonly previous: Vec3; readonly current: Vec3 } | null = null;
    private data: Q1ClientData | null = null;
    private weaponAlpha = 0;
    private readonly actors = new Map<number, ActorId>();
    private current = new Map<number, Q1ExtendedEntityState>();
    private previous = new Map<number, Q1ExtendedEntityState>();
    private readonly statics: Q1ExtendedEntityState[] = [];
    private models: readonly string[] = [];
    private sounds: readonly string[] = [];
    private readonly resources = new Map<string, ResolvedResourceReference>();
    private readonly styles = new Map<number, string>();
    private readonly events: SimulationPresentationEvent[] = [];
    private readonly soundsPending: SimulationEvent[] = [];
    private published: SimulationOutput | null = null;
    readonly scoreboard = new Map<number, {
        readonly name: string;
        readonly colors: number;
        readonly frags: number;
    }>();
    private records: readonly NetQuakeMessage[] = [];
    constructor(readonly options: Q1RemotePresentationOptions) {
        this.world = new RemoteWorldContent(options.content);

        this.client = options.client;
    }
    get scene() { return this.world.scene; }
    get output(): SimulationOutput | null { return this.published; }
    get sourceRecords(): readonly NetQuakeMessage[] { return this.records; }
    get player() { return this.viewEntity === 0 ? null : { client: this.client.id, actor: this.actor(this.viewEntity), sourceEntity: this.viewEntity }; }
    private actor(number: number): ActorId {
        const found = this.actors.get(number);
        if (found !== undefined)
            return found;
        if (this.ordinal >= 65536) throw new RangeError('Remote actor registry is full');
        const slot = this.ordinal++;
        const value = this.options.identity.actor(slot, this.options.nextGeneration(slot));
        this.actors.set(number, value);
        return value;
    }
    playerSlot(actor: ActorId): number | null { for (let i = 1; i <= this.maxClients; i++)
        if (this.actors.get(i)?.equals(actor))
            return i - 1; return null; }
    isPlayer(actor: ActorId): boolean { return this.playerSlot(actor) !== null; }
    private emit(event: Q1Event, sourceEntity: number | null = null): void {
        this.events.push({ kind: 'q1', event, content: this.world.content.recipe.map.entities.content, seconds: this.seconds, sequence: this.sequence++, sourceEntity });
    }
    async receive(messages: readonly NetQuakeMessage[], now: number, assertCurrent?: () => void): Promise<void> {
        assertCurrent?.();
        this.records = messages;
        for (const message of messages) {
            switch (message.kind) {
                case 'server-info': {
                    const map = message.models[0];
                    if (map === undefined || !map.startsWith('maps/') || !map.endsWith('.bsp'))
                        throw new Error('NetQuake server has no world model');
                    const loaded = await this.options.loadContent({ map, models: message.models, sounds: message.sounds }, assertCurrent);
                    assertCurrent?.();
                    this.world.content = loaded;
                    this.actors.clear();
                    this.ordinal = 0;
                    this.current.clear();
                    this.previous.clear();
                    this.statics.length = 0;
                    this.styles.clear();
                    this.scoreboard.clear();
                    this.events.length = 0;
                    this.soundsPending.length = 0;
                    this.models = message.models;
                    this.sounds = message.sounds;
                    this.maxClients = message.maxClients;
                    this.viewEntity = 0;
                this.pendingImpulse = 0;
                    this.viewAngles = zero;
                    this.demoAngles = null;
                    this.demoSeconds = null;
                    this.data = null;
                    this.weaponAlpha = 0;
                    this.published = null;
                    this.seconds = 0;
                    this.previousSeconds = 0;

                    break;
                }
                case 'time':
                    this.previousSeconds = this.seconds;
                    this.seconds = message.seconds;
                    this.previous = this.current;
                    this.current = new Map<number, Q1ExtendedEntityState>();
                    this.receivedAt = this.options.presentationTime?.() ?? now;
                    this.fraction = 1;
                    this.frameNumber++;
                    break;
                case 'entity':
                    this.current.set(message.state.number, message.state);
                    break;
                case 'static':
                    this.statics.push(message.state);
                    break;
                case 'set-view':
                    this.viewEntity = message.entity;
                    break;
                case 'set-angle':
                    this.viewAngles = message.angles;
                    if (this.player !== null)
                        this.events.push({ kind: 'view-reset', reason: 'source', actor: this.player.actor, angles: message.angles, sequence: this.sequence++, seconds: this.seconds, content: this.world.content.recipe.map.entities.content });
                    break;
                case 'client-data':
                    this.data = message.data;
                    this.weaponAlpha = message.weaponAlpha;
                    break;
                case 'light-style':
                    this.styles.set(message.index, message.value);
                    break;
                case 'cd-track':
                    this.events.push({ kind: 'music', event: { kind: 'cd-track', track: message.track },
                        content: this.world.content.recipe.map.entities.content, seconds: this.seconds, sequence: this.sequence++ });
                    break;
                case 'name':
                case 'colors':
                case 'frags': {
                    const old = this.scoreboard.get(message.slot) ?? { name: '', colors: 0, frags: 0 };
                    if (typeof message.value === 'string')
                        this.scoreboard.set(message.slot, { ...old, name: message.value });
                    else
                        this.scoreboard.set(message.slot, message.kind === 'colors' ? { ...old, colors: message.value } : { ...old, frags: message.value });
                    break;
                }
                case 'print':
                    this.options.print(message.text);
                    break;
                case 'center-print':
                    if (this.player !== null)
                        this.emit({ kind: 'message', player: this.player.actor, text: message.text, center: true });
                    break;
                case 'sound':
                case 'static-sound': {
                    const path = this.sounds[message.index - 1];
                    if (path === undefined)
                        throw new Error(`Unknown NetQuake sound index ${message.index}`);
                    if (message.kind === 'static-sound')
                        this.emit({ kind: 'ambient', path, origin: message.origin, volume: message.volume / 255, attenuation: message.attenuation });
                    else {
                        this.emit({ kind: 'sound', actor: this.actor(message.entity), path, channel: soundChannel(message.channel), origin: message.origin, volume: message.volume / 255, attenuation: message.attenuation }, message.entity);
                        const resource = this.resources.get(`sound/${path}`);
                        if (resource === undefined)
                            throw new Error(`Unresolved NetQuake sound ${path}`);
                        this.soundsPending.push({ sequence: this.sequence++, time: { kind: 'seconds', value: this.seconds }, audience: { kind: 'client', client: this.client.id }, payload: { kind: 'sound', resource: resource.id, actor: message.entity === 0 ? null : this.actor(message.entity), origin: message.origin, channel: message.channel, volume: message.volume / 255, attenuation: message.attenuation } });
                    }
                    break;
                }
                case 'stop-sound':
                    this.emit({ kind: 'stop-sound', actor: this.actor(message.entity), channel: message.channel }, message.entity);
                    break;
                case 'particle':
                    this.emit({ kind: 'particles', origin: message.origin, direction: message.direction, color: message.color, count: message.count });
                    break;
                case 'temporary-entity': {
                    const effect = message.effect;
                    if (effect.kind === 'explosion-colors')
                        this.emit({ kind: 'colored-explosion', origin: effect.origin, colorStart: effect.colorStart, colorLength: effect.colorLength });
                    else if (effect.kind === 'beam')
                        this.emit({ kind: 'beam', style: effect.type === 5 ? 'lightning1' : effect.type === 6 ? 'lightning2' : effect.type === 9 ? 'lightning3' : 'grapple', actor: this.actor(effect.entity), start: effect.start, end: effect.end });
                    else {
                        const kind = effect.type === 0 ? 'spike' : effect.type === 1 ? 'superspike' : effect.type === 2 ? 'gunshot' : effect.type === 3 ? 'explosion' : effect.type === 4 ? 'tar-explosion' : effect.type === 7 ? 'wizard-spike' : effect.type === 8 ? 'knight-spike' : effect.type === 10 ? 'lava-splash' : effect.type === 11 ? 'teleport' : null;
                        if (kind === null)
                            throw new Error(`Unsupported NetQuake temporary entity ${effect.type}`);
                        this.emit({ kind: 'effect', effect: kind, actor: null, origin: effect.origin, amount: effect.count });
                    }
                    break;
                }
                case 'stufftext':
                    for (const line of message.text.split('\n'))
                        if (line.trim() === 'reconnect') {
                            this.published = null;
                        }
                        else if (line.trim() !== '')
                            this.options.print(`Unhandled server command: ${line}\n`);
                    break;
                default: break;
            }
        }
        this.publish();
    }
    private sampled(state: Q1ExtendedEntityState): Q1ExtendedEntityState {
        const old = this.previous.get(state.number);
        if (state.step || old === undefined || Math.max(Math.abs(state.origin.x - old.origin.x), Math.abs(state.origin.y - old.origin.y), Math.abs(state.origin.z - old.origin.z)) > 100)
            return state;
        return { ...state, origin: lerp(old.origin, state.origin, this.fraction), angles: angles(old.angles, state.angles, this.fraction) };
    }
    worldText(): readonly WorldText[] { return []; }

    playerView(actor: ActorId): PlayerView {
        const player = this.player, data = this.data;
        if (player === null || !player.actor.equals(actor) || data === null)
            throw new Error('Remote Q1 player has no clientdata');
        const entity = this.current.get(this.viewEntity);
        return { origin: entity === undefined ? zero : this.sampled(entity).origin, angles: this.viewAngles, viewHeight: data.viewHeight, kickAngles: data.punchAngles };
    }
    playerUi(actor: ActorId): PlayerUi {
        this.playerView(actor);
        const data = this.data;
        if (data === null)
            throw new Error('No Q1 clientdata');
        const weapon = weapons.find(value => value.bit === data.activeWeapon || value.name === 'axe' && data.activeWeapon === 0 && this.models[data.weaponModel - 1] === 'progs/v_axe.mdl'), source = this.world.content.recipe.weapons[0];
        const counts = new Map([['shells', data.shells], ['nails', data.nails], ['rockets', data.rockets], ['cells', data.cells]]);
        const item: ItemId | null = weapon === undefined ? null : `q1:weapon/${weapon.name}`;
        const ammo = weapon?.ammo;
        return { powerups: [], health: data.health, armor: data.armor === 0 ? { kind: 'none' } : { kind: 'q1', points: data.armor, absorption: (data.items & 32768) !== 0 ? 0.8 : (data.items & 16384) !== 0 ? 0.6 : 0.3, item: 'q1:armor' }, activeWeapon: item,
            ammo: ammo === undefined || ammo === null ? null : { item: `q1:ammo/${ammo}`, count: data.ammo }, arsenalWarning: 'none',
            weaponStatus: weapon === undefined || source === undefined || item === null ? null : { source, item, label: weapon.name, ammo: ammo === null || ammo === undefined ? { kind: 'unmetered' } : { kind: 'finite', item: `q1:ammo/${ammo}`, count: data.ammo, hasAmmoToStart: data.ammo > 0, low: false } },
            inventory: [...counts].map(([name, count]) => ({ item: `q1:ammo/${name}`, count, capacity: count })),
            items: weapons.map((value, sourceOrdinal) => ({ id: `q1:weapon/${value.name}`, label: value.name, kind: 'weapon', sourceOrdinal: sourceOrdinal + 1, owned: (data.items & value.bit) !== 0, hasAmmo: value.ammo === null || (counts.get(value.ammo) ?? 0) > 0, count: value.ammo === null ? null : counts.get(value.ammo) ?? 0, warningCount: 0 })) };
    }
    characterViews(): ReturnType<RemotePresentationAccess['characterViews']> { return []; }
    presentations(): readonly SimulationPresentation[] {
        const result: SimulationPresentation[] = [];
        const append = (state: Q1ExtendedEntityState, number: number): void => {
            const path = this.models[state.modelIndex - 1];
            if (state.modelIndex === 0)
                return;
            if (path === undefined)
                throw new Error(`Unknown NetQuake model ${state.modelIndex}`);
            const colors = state.colorMap > 0 && state.colorMap <= this.maxClients ? this.scoreboard.get(state.colorMap - 1)?.colors : undefined;
            result.push({ actor: this.actor(number), content: this.world.content.recipe.map.entities.content, family: 'q1', path, frame: state.frame, oldFrame: state.frame, skin: state.skin, effects: state.effects, renderFlags: 0, origin: state.origin, angles: state.angles, alpha: ENTALPHA_DECODE(state.alpha), scale: ENTSCALE_DECODE(state.scale), visible: number !== this.viewEntity, viewWeapon: false,
                ...(colors === undefined ? {} : { playerColors: { top: Math.min(colors >> 4 & 15, 13), bottom: Math.min(colors & 15, 13) } }) });
        };
        for (const state of this.current.values())
            append(this.sampled(state), state.number);
        this.statics.forEach((state, index) => append(state, 65536 + index));
        const player = this.player, data = this.data;
        if (player !== null && data !== null && data.weaponModel !== 0) {
            const path = this.models[data.weaponModel - 1];
            if (path === undefined)
                throw new Error('Unknown Q1 weapon model');
            const view = this.playerView(player.actor);
            result.push({ actor: player.actor, content: this.world.content.recipe.map.entities.content, family: 'q1', path, frame: data.weaponFrame, oldFrame: data.weaponFrame, skin: 0, effects: 0, renderFlags: 0, origin: { ...view.origin, z: view.origin.z + view.viewHeight }, angles: view.angles, alpha: ENTALPHA_DECODE(this.weaponAlpha), scale: 1, visible: data.health > 0 && (data.items & 524288) === 0, viewWeapon: true });
        }
        return result;
    }
    registerResource(_content: ContentId, path: string, resource: ResolvedResourceReference): undefined { this.resources.set(path, resource); return undefined; }
    command(command: ActorCommand): Q1UserCommand {
        if (command.command.kind !== 'q1-netquake')
            throw new Error('Native Q1 requires NetQuake input');
        this.playerView(command.actor);
        this.viewAngles = command.command.viewAngles;
        const requested = command.arsenal?.weapon;
        if (requested !== undefined && requested !== null && requested !== this.playerUi(command.actor).activeWeapon) this.selectWeapon(command.actor, requested);
        const impulse = command.command.impulse || this.pendingImpulse;
        this.pendingImpulse = 0;
        return { ...command.command, impulse };
    }
    private selectWeapon(actor: ActorId, requested: string): void {
        const selected = this.playerUi(actor).items.find(item => item.owned && (item.id === requested || item.label === requested));
        if (selected === undefined) throw new Error(`Native Q1 weapon is not owned: ${requested}`);
        this.pendingImpulse = selected.sourceOrdinal;
    }
    playerCommand(actor: ActorId, name: string, args: readonly string[]): undefined {
        this.playerView(actor);
        if ([name, ...args].some(value => /["\n\r;]/.test(value)))
            throw new Error('Invalid native command delimiter');
        if (name === 'use') { this.selectWeapon(actor, args.join('').toLowerCase().replaceAll(' ', '')); return undefined; }
        if (name === 'weapnext' || name === 'weapprev') {
            const ui = this.playerUi(actor), owned = ui.items.filter(item => item.owned && item.hasAmmo);
            const current = owned.findIndex(item => item.id === ui.activeWeapon);
            const next = owned[(current + (name === 'weapnext' ? 1 : owned.length - 1)) % owned.length];
            if (next !== undefined) this.pendingImpulse = next.sourceOrdinal;
            return undefined;
        }
        this.options.sendCommand([name, ...args.map(value => `"${value}"`)].join(' '));
        return undefined;
    }
    private publish(): void {
        const player = this.player, data = this.data;
        if (player === null || data === null || !this.current.has(this.viewEntity))
            return;
        const recipe = this.world.content.recipe, time = this.previousSeconds + (this.seconds - this.previousSeconds) * this.fraction;
        const bodies = [...this.current.values()].map(state => ({ actor: this.actor(state.number), body: { origin: this.sampled(state).origin, angles: this.sampled(state).angles, velocity: state.number === this.viewEntity ? data.velocity : zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null } }));
        this.published = { snapshot: { session: this.options.session.session, frame: { frame: this.frameNumber, time: { kind: 'seconds', value: time }, elapsed: { kind: 'seconds', value: Math.max(0, this.seconds - this.previousSeconds) }, phase: 'frame-exit' }, actors: bodies.map(body => ({ id: body.actor, owner: recipe.map.entities.provider, definition: 'q1:remote-entity' })), bodies, inventories: [{ actor: player.actor, entries: this.playerUi(player.actor).inventory }], configurations: [{ actor: player.actor, movement: recipe.movement, character: recipe.character, weapons: recipe.weapons, inventory: recipe.inventory }], scene: { session: this.options.session.session, time: { kind: 'seconds', value: time }, world: { resource: recipe.map.geometry, geometry: this.world.content.world }, entities: [], lights: [], particles: [], lightStyles: [...this.styles].map(([style, pattern]) => ({ kind: 'q1', style, value: pattern.length === 0 ? 256 : (pattern.charCodeAt(Math.floor(time * 10) % pattern.length) - 97) * 22 })), areaBits: null } }, events: [...this.soundsPending] };
        this.options.publish({ ...this.published, events: [] });
    }
    samplePresentation(now: number): SimulationOutput | null {
        if (this.demoSeconds !== null) return this.sampleDemo(this.demoSeconds);
        now = this.options.presentationTime?.() ?? now;
        if (this.seconds - this.previousSeconds > 0.1) this.previousSeconds = this.seconds - 0.1;
        const duration = Math.max(0, this.seconds - this.previousSeconds);
        this.fraction = duration === 0 ? 1 : Math.max(0, Math.min(1, (now - this.receivedAt) / (duration * 1000)));
        this.publish();
        return this.published;
    }
    get recordedSeconds(): number { return this.seconds; }
    setDemoViewAngles(current: Vec3, interpolate: boolean): void {
        this.demoAngles = { previous: interpolate ? this.demoAngles?.current ?? current : current, current };
    }
    sampleDemo(seconds: number): SimulationOutput | null {
        this.demoSeconds = seconds;
        if (this.seconds - this.previousSeconds > 0.1) this.previousSeconds = this.seconds - 0.1;
        const duration = this.seconds - this.previousSeconds;
        this.fraction = duration <= 0 ? 1 : Math.max(0, Math.min(1, (seconds - this.previousSeconds) / duration));
        if (this.demoAngles !== null) this.viewAngles = angles(this.demoAngles.previous, this.demoAngles.current, this.fraction);
        this.publish();
        return this.published;
    }
    drainPresentationEvents(): readonly SimulationPresentationEvent[] {
        if (this.published === null) return [];
        this.options.publish({ ...this.published, events: [...this.soundsPending] });
        this.soundsPending.length = 0;
        return this.events.splice(0);
    }
    disconnected(reason: string): void { this.options.disconnected(reason); }
}
