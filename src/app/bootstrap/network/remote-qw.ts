/* QW decoded protocol state shares the Q1 scene/session presentation. GPL-2.0-or-later. */
import type { IndexedModelSkin } from '../../../contracts/scene.ts';
import { QwPlayerSkins } from './qw-skins.ts';
import type { QwSkinOptions } from './qw-skins.ts';
import { nativeAtoi } from '../../../core/numeric.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import { QuakeWorldPrediction } from '../simulation/prediction/qw-source-state.ts';
import type { MovementPredictionSnapshot, MovementPredictionResult } from '../simulation/prediction/types.ts';
import { movementProfile } from '../simulation/players.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { Q1ExtendedEntityState, QwUserCommand, QwPlayerState } from '../../../contracts/protocol.ts';
import type { QuakeWorldMessage, QwMoveVariables } from '../../../network/q1/quakeworld.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';
import { quakeWorldInfo } from '../../../network/q1/handshake.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { Q1RemotePresentation } from './remote-q1.ts';
import type { Q1RemotePresentationOptions, Q1RemoteWorld } from './remote-q1.ts';
import type { QwApplicationClientHost, QwApplicationDownloads, QwServerData } from './qw-types.ts';
export interface QwRemotePresentationOptions extends Q1RemotePresentationOptions {
    readonly downloads?: QwApplicationDownloads;
    readonly skinOptions: QwSkinOptions;
    prepareServerData(data: QwServerData): Promise<void>;
    mapChecksum(world: Q1RemoteWorld, gameDirectory: string): Promise<number>;
}
export function quakeWorldMapChecksum2(bytes: Uint8Array): number {
    if (bytes.length < 124) throw new Error('Short Quake BSP header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getInt32(0, true) !== 29) throw new Error('QW requires BSP version 29');
    let checksum = 0;
    for (let lump = 0; lump < 15; lump++) {
        const start = view.getInt32(4 + lump * 8, true), length = view.getInt32(8 + lump * 8, true);
        if (start < 0 || length < 0 || start + length > bytes.length) throw new Error('Invalid Quake BSP lump');
        if (lump === 0 || lump === 4 || lump === 5 || lump === 10) continue;
        checksum ^= blockChecksum(bytes.subarray(start, start + length));
    }
    return checksum | 0;
}
const zero = { x: 0, y: 0, z: 0 };
function playerEntity(state: QwPlayerState): Q1ExtendedEntityState {
    return { number: state.number + 1, origin: state.origin, angles: { x: -state.command.angles.x / 3, y: state.command.angles.y, z: 0 }, modelIndex: state.modelIndex, frame: state.frame, colorMap: state.number + 1, skin: state.skin, effects: state.effects, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: true };
}
export class QwRemotePresentation implements QwApplicationClientHost {
    readonly shared: Q1RemotePresentation;
    readonly downloads?: QwApplicationDownloads;
    private data: QwServerData | null = null;
    private content: LoadedApplicationContent;
    private predictor: QuakeWorldPrediction | null = null;
    private predicted: MovementPredictionResult | null = null;
    private acknowledgedSequence = 0;
    readonly prediction = {
        sent: (sequence: number, command: QwUserCommand, now: number): void => { this.predictor?.sent(sequence, command, now); this.predicted = this.predictor?.replay() ?? null; },
        acknowledged: (sequence: number, now: number): void => { this.acknowledgedSequence = sequence; this.predictor?.acknowledged(sequence, now); },
    };
    private stats = new Map<number, number>();
    private readonly userinfos = new Map<number, Map<string, string>>();
    private readonly selectedSkins = new Map<number, IndexedModelSkin>();
    private readonly playerSkins: QwPlayerSkins;
    private skinLoading = false;
    private skinSignature = '';
    private skinPolicySignature = '';
    private skinRevision = 0;
    readonly skins = {
        names: (): readonly string[] => this.options.skinOptions.noskins() !== 0 ? [] : [...new Set([...this.userinfos.values()].filter(info => (info.get('name') ?? '') !== '').map(info => `skins/${this.playerSkins.name(info.get('skin') ?? '')}.pcx`))],
        loading: (value: boolean): void => { this.skinLoading = value; this.selectedSkins.clear(); if (!value) { this.playerSkins.clear(); this.skinSignature = ''; } },
        prepare: (): Promise<void> => this.prepareSkins(),
    };
    async prepareSkins(): Promise<void> {
        if (this.skinLoading) return;
        const policy = this.options.skinOptions, policySignature = [policy.noskins(), policy.baseskin(), policy.allskins()].join('\0'), signature = `${policySignature}\0${this.skinRevision}`;
        if (signature === this.skinSignature) return;
        if (policySignature !== this.skinPolicySignature) { this.playerSkins.clear(); this.skinPolicySignature = policySignature; }
        this.selectedSkins.clear();
        for (const [slot, info] of this.userinfos) {
            if ((info.get('name') ?? '') === '') continue;
            const skin = await this.playerSkins.select(info.get('skin') ?? '');
            if (skin !== null) this.selectedSkins.set(slot, skin);
        }
        this.skinSignature = signature;
    }
    private scoreboardInfo(slot: number, info: Map<string, string>, messages: NetQuakeMessage[]): void {
        if (!Number.isInteger(slot) || slot < 0 || slot >= 32) throw new Error('Invalid QW userinfo slot');
        const color = (key: string): number => { const value = nativeAtoi(info.get(key) ?? '0'); return value < 0 || value > 13 ? 13 : value; };
        this.userinfos.set(slot, info); this.skinRevision++;
        messages.push({ kind: 'name', slot, value: (info.get('name') ?? '').slice(0, 15) }, { kind: 'colors', slot, value: color('topcolor') * 16 + color('bottomcolor') });
    }
    private ownPlayer: QwPlayerState | null = null;
    private records: readonly QuakeWorldMessage[] = [];
    private entities: readonly Q1ExtendedEntityState[] = [];
    private modelNames: readonly string[] = [];
    private soundCount = 0;
    private readonly availableSounds = new Set<number>();
    private readonly linked: ActorId[] = [];
    private kick = 0;
    private intermission: Extract<QuakeWorldMessage, { kind: 'intermission' }> | null = null;
    private variables: QwMoveVariables | null = null;
    constructor(readonly options: QwRemotePresentationOptions) { this.playerSkins = new QwPlayerSkins(options.skinOptions); this.content = options.content; this.shared = new Q1RemotePresentation({ ...options, loadContent: async world => { this.content = await options.loadContent(world); return this.content; } }); if (options.downloads !== undefined) this.downloads = options.downloads; }
    get moveVariables(): QwMoveVariables | null { return this.variables; }
    get client() { return this.shared.client; }
    get player() { return this.shared.player; }
    get output() { return this.shared.output; }
    get scene() { return this.shared.scene; }
    get sourceRecords() { return this.records; }
    get scoreboard() { return this.shared.scoreboard; }
    async serverData(data: QwServerData): Promise<void> { await this.options.prepareServerData(data); }
    async gameState(data: QwServerData, models: readonly string[], sounds: readonly string[]): Promise<number> {
        this.playerSkins.clear(); this.userinfos.clear(); this.selectedSkins.clear(); this.skinSignature = ''; this.skinLoading = false; this.skinRevision++; this.predictor = null; this.predicted = null; this.modelNames = models; this.linked.length = 0; this.data = data; this.variables = data.moveVariables; this.stats.clear(); this.ownPlayer = null; this.entities = []; this.kick = 0; this.intermission = null;
        const map = models[0]; if (map === undefined) throw new Error('QW has no world model');
        await this.shared.receive([{ kind: 'server-info', protocol: { kind: 'q1-netquake', version: 15 }, maxClients: 32, gameType: 1, level: data.level, models, sounds }, { kind: 'set-view', entity: data.playerSlot + 1 }], 0);
        this.soundCount = sounds.length; this.availableSounds.clear();
        for (const [index, sound] of sounds.entries()) if (await this.content.mounts.resolve(`sound/${sound}`) !== null) this.availableSounds.add(index + 1);
        return this.options.mapChecksum({ map, models, sounds }, data.gameDirectory);
    }
    async receive(messages: readonly QuakeWorldMessage[], now: number): Promise<void> {
        this.records = messages;
        if (this.data === null) return;
        const translated: NetQuakeMessage[] = [], players: QwPlayerState[] = [], nails: Q1ExtendedEntityState[] = [];
        let frame = false;
        for (const message of messages) {
            switch (message.kind) {
                case 'player': players.push(message.state); if (message.state.number === this.data.playerSlot) this.ownPlayer = message.state; break;
                case 'packet-entities': this.entities = message.entities; frame = true; break;
                case 'invalid-delta': break;
                case 'nails': {
                    const modelIndex = this.modelNames.indexOf('progs/spike.mdl') + 1;
                    if (modelIndex !== 0) message.projectiles.forEach((nail, index) => nails.push({ number: 131072 + index, origin: nail.origin, angles: { x: nail.pitch, y: nail.yaw, z: 0 }, modelIndex, frame: 0, colorMap: 0, skin: 0, effects: 0, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: true }));
                    break;
                }
                case 'stat': this.stats.set(message.index, message.value); break;
                case 'kick': this.kick = message.degrees; break;
                case 'max-speed': if (this.variables !== null) this.variables = { ...this.variables, maxSpeed: message.value }; break;
                case 'entity-gravity': if (this.variables !== null) this.variables = { ...this.variables, entityGravity: message.value }; break;
                case 'userinfo': this.scoreboardInfo(message.slot, new Map(quakeWorldInfo(message.value)), translated); break;
                case 'set-info': {
                    const info = new Map(this.userinfos.get(message.slot)); info.set(message.key, message.value);
                    this.scoreboardInfo(message.slot, info, translated); break;
                }
                case 'print': translated.push({ kind: 'print', text: message.text }); break;
                case 'intermission': this.intermission = message; translated.push({ kind: 'set-angle', angles: message.angles }, { kind: 'intermission' }); break;
                case 'cd-track': translated.push({ kind: 'cd-track', track: message.track, loopTrack: message.track }); break;
                case 'sound': case 'static-sound':
                    if (message.index < 1 || message.index > this.soundCount) throw new Error('Invalid QW sound index');
                    if (this.availableSounds.has(message.index)) translated.push(message);
                    break;
                case 'set-view': translated.push({ kind: 'set-view', entity: message.entity }); break;
                case 'frags': translated.push({ kind: 'frags', slot: message.slot, value: message.value }); break;
                case 'baseline': translated.push({ kind: 'baseline', state: message.state }); break;
                case 'static': translated.push({ kind: 'static', state: message.state }); break;
                case 'set-angle': case 'light-style': case 'stop-sound': case 'damage': case 'temporary-entity': case 'pause': case 'center-print': case 'finale': translated.push(message); break;
                default: break;
            }
        }
        const own = this.ownPlayer;
        if (frame && own !== null) {
            const stat = (index: number): number => this.stats.get(index) ?? 0;
            translated.unshift({ kind: 'time', seconds: now / 1000 });
            for (const entity of this.entities) translated.push({ kind: 'entity', state: { ...entity, step: true } });
            for (const nail of nails) translated.push({ kind: 'entity', state: nail });
            for (const player of players) translated.push({ kind: 'entity', state: playerEntity(player) });
            translated.push({ kind: 'client-data', weaponAlpha: 0, data: { viewHeight: (own.flags & 1024) !== 0 ? 8 : (own.flags & 512) !== 0 ? -16 : 22, idealPitch: 0, punchAngles: { ...zero, x: this.kick }, velocity: own.velocity, items: stat(15), onGround: false, inWater: false, weaponFrame: own.weaponFrame, armor: stat(4), weaponModel: stat(2), health: stat(0), ammo: stat(3), shells: stat(6), nails: stat(7), rockets: stat(8), cells: stat(9), activeWeapon: stat(10) } });
            this.kick = 0;
        }
        await this.shared.receive(translated, now);
        await this.prepareSkins();
        if (frame) this.linkSolids(players, nails);
        if (players.some(player => player.number === this.data?.playerSlot)) this.receivePrediction(now);
    }
    private receivePrediction(now: number): void {
        const own = this.ownPlayer, player = this.player, variables = this.variables, data = this.data;
        if (own === null || player === null || variables === null || data === null || this.shared.output === null) return;
        const recipe = this.content.recipe, view = this.shared.playerView(player.actor), ui = this.shared.playerUi(player.actor);
        const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
        const base: MovementPredictionSnapshot = { sequence: this.acknowledgedSequence, commandTimeMilliseconds: now,
            state: { kind: 'q1-quakeworld', origin: own.origin, velocity: own.velocity, angles: view.angles, oldButtons: 0, waterJumpTimeSeconds: 0, dead: ui.health <= 0, spectator: 0, ground: { kind: 'none' } },
            viewAngles: view.angles, viewHeight: view.viewHeight, viewOffset: { x: 0, y: 0, z: view.viewHeight }, bounds,
            environment: { health: ui.health, flight: false, haste: false, invulnerable: false, gravityMultiplier: variables.entityGravity },
            arsenal: { provider: recipe.inventory.provider, activeWeapon: ui.activeWeapon, ammo: ui.inventory,
                state: { kind: 'q1', frame: own.weaponFrame, attackFinishedSeconds: 0, sourceWeapon: this.stats.get(10) ?? 0 } },
            animation: { provider: recipe.character.definition.provider, state: { kind: 'q1', frame: own.frame, nextFrameSeconds: 0 } }, contact: null, q3Arsenal: null };
        if (this.predictor === null) this.predictor = new QuakeWorldPrediction({ actor: this.options.identity.ownedActor(player.actor, recipe.map.entities.provider),
            seat: this.options.identity.seat(this.client.id.slot), recipe, profile: movementProfile(recipe), standingBounds: bounds, standingViewHeight: 22,
            scene: this.scene, isBrush: hit => hit.kind === 'world' || hit.kind === 'actor' && this.scene.spatial.get(hit.actor)?.collision.shape.kind === 'model' }, base, variables);
        this.predictor.receive(base, own, variables, { health: ui.health, spectator: 0 });
        this.predicted = this.predictor.replay();
    }
    private linkSolids(players: readonly QwPlayerState[], nails: readonly Q1ExtendedEntityState[]): void {
        for (const actor of this.linked) this.scene.unlink(actor);
        this.linked.length = 0;
        const output = this.shared.output;
        if (output === null) return;
        const states = new Map([...this.entities, ...nails, ...players.map(playerEntity)].map(state => [state.number, state]));
        [...states.values()].forEach((state, index) => {
            const body = output.snapshot.bodies[index];
            if (body === undefined || state.number === (this.data?.playerSlot ?? -1) + 1) return;
            const player = players.find(player => player.number + 1 === state.number);
            const path = this.modelNames[state.modelIndex - 1];
            const model = path?.startsWith('*') ? Number(path.slice(1)) : null;
            if (player === undefined && (model === null || !Number.isInteger(model))) return;
            if (player !== undefined && (player.flags & 512) !== 0) return;
            const bounds = model === null ? body.body.bounds : this.scene.modelBounds(model), origin = state.origin;
            this.scene.link({ actor: body.actor, state: { ...body.body, origin, angles: zero, bounds }, linkCount: output.snapshot.frame.frame,
                absoluteBounds: { min: { x: origin.x + bounds.min.x - 1, y: origin.y + bounds.min.y - 1, z: origin.z + bounds.min.z - 1 }, max: { x: origin.x + bounds.max.x + 1, y: origin.y + bounds.max.y + 1, z: origin.z + bounds.max.z + 1 } } },
                { family: 'q1', shape: model === null ? { kind: 'box' } : { kind: 'model', model }, contents: -2, owner: null, role: 'solid', monster: player !== undefined, deadMonster: false });
            this.linked.push(body.actor);
        });
    }
    command(input: ActorCommand): QwUserCommand {
        if (input.command.kind !== 'q1-quakeworld') throw new Error('QW requires QuakeWorld input');
        const command = input.command;
        const selected = this.shared.command({ ...input, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: 0, viewAngles: command.angles, forwardMove: command.forwardMove, sideMove: command.sideMove, upMove: command.upMove, buttons: command.buttons, impulse: command.impulse } });
        return { ...command, impulse: selected.impulse };
    }
    isPlayer(...args: Parameters<Q1RemotePresentation['isPlayer']>) { return this.shared.isPlayer(...args); }
    worldText() { return this.shared.worldText(); }
    playerUi(...args: Parameters<Q1RemotePresentation['playerUi']>) { return this.shared.playerUi(...args); }
    playerView(...args: Parameters<Q1RemotePresentation['playerView']>) {
        const view = this.shared.playerView(...args);
        if (this.intermission !== null) return { ...view, origin: this.intermission.origin, angles: this.intermission.angles, viewHeight: 0, kickAngles: zero };
        const predicted = this.predicted;
        const origin = predicted !== null && predicted.status !== 'history-exhausted' && predicted.player.state.kind === 'q1-quakeworld' ? predicted.player.state.origin : view.origin;
        return { ...view, origin, angles: this.ownPlayer !== null && (this.ownPlayer.flags & 512) !== 0 ? { ...view.angles, z: 80 } : view.angles };
    }
    playerCommand(...args: Parameters<Q1RemotePresentation['playerCommand']>) { return this.shared.playerCommand(...args); }
    characterViews() { return this.shared.characterViews(); }
    presentations() {
        const models = this.shared.presentations().map(model => {
            const slot = this.shared.playerSlot(model.actor), skin = slot === null ? undefined : this.selectedSkins.get(slot);
            return !this.skinLoading && model.path === 'progs/player.mdl' && skin !== undefined ? { ...model, indexedSkin: skin } : model;
        }), player = this.player;
        if (this.intermission !== null) return models.filter(model => !model.viewWeapon);
        if (player === null) return models;
        const view = this.playerView(player.actor);
        return models.map(model => model.viewWeapon ? { ...model, origin: { ...view.origin, z: view.origin.z + view.viewHeight }, angles: view.angles } : model);
    }
    registerResource(...args: Parameters<Q1RemotePresentation['registerResource']>) { return this.shared.registerResource(...args); }
    samplePresentation(...args: Parameters<Q1RemotePresentation['samplePresentation']>): SimulationOutput | null {
        const output = this.shared.samplePresentation(...args), player = this.player;
        if (output === null || player === null) return output;
        const view = this.playerView(player.actor);
        const sampled = { ...output, snapshot: { ...output.snapshot, bodies: output.snapshot.bodies.map(body => body.actor.equals(player.actor) ? { ...body, body: { ...body.body, origin: view.origin, angles: view.angles } } : body) } };
        this.options.session.publish({ ...sampled, events: [] });
        return sampled;
    }
    drainPresentationEvents() { return this.shared.drainPresentationEvents(); }
    disconnected(reason: string): void { this.shared.disconnected(reason); }
    print(text: string): void { this.options.print(text); }
}
