import { basename } from "node:path";
import type { ActorId } from '../../../contracts/identity.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { QwUserCommand, QwPlayerState } from '../../../contracts/protocol.ts';
import type { QuakeWorldEntity } from '../../../network/q1/quakeworld.ts';
import type { QcMessageDestination } from '../../../compat/qc/presentation-host.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { SharedSimulation } from './runtime.ts';
import type { QwApplicationPlayer, QwApplicationServerHost, QwServerMessage } from '../network/qw-server-types.ts';
import { quakeWorldInfo } from '../../../network/q1/handshake.ts';
import { quakeWorldMapChecksum2 } from '../../../network/q1/checksum.ts';
import { writeQuakeWorldMessage } from '../../../network/q1/quakeworld.ts';
import { PF_MSEC, PF_COMMAND, PF_MODEL, PF_VELOCITY1, PF_VELOCITY2, PF_VELOCITY3, PF_EFFECTS, PF_SKINNUM, PF_DEAD, PF_GIB, PF_WEAPONFRAME } from '../../../network/q1/qw-constants.ts';
import { SizeBuf, SZ_Write } from '../../../network/q1/message.ts';
import { downloadPath } from '../../../network/services/downloads.ts';
import { canDownloadResource } from '../../../content/mounts/index.ts';

export interface QwApplicationServerBindingOptions {
    readonly session: EngineSession;
    readonly simulation: SharedSimulation;
    readonly content: LoadedApplicationContent;
    readonly serverCount: number;
    readonly administration?: QwApplicationServerHost['administration'];
    readonly masters?: QwApplicationServerHost['masters'];
    print(text: string): void;
}
const idle: QwUserCommand = { kind: 'q1-quakeworld', milliseconds: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
interface ClientState {
    readonly player: QwApplicationPlayer;
    readonly role: 'player' | 'spectator';
    info: Map<string, string>;
    begun: boolean;
    command: QwUserCommand;
    commandTime: number;
    readonly stats: Map<number, number>;
    frags: number;
}
export async function createQwApplicationServerHost(options: QwApplicationServerBindingOptions): Promise<QwApplicationServerHost> {
    const { simulation, content } = options, game = simulation.quakecSource();
    if (game === null || game.kind !== 'quakeworld' || content.world.kind !== 'q1-bsp')
        throw new Error('Native QW wire requires its admitted QuakeWorld source and 32 reserved players');
    const world = content.world, models = game.precacheNames('model'), sounds = game.precacheNames('sound');
    if (models.length >= 256 || sounds.length >= 256) throw new Error('Native QW precaches exceed 8-bit indices');
    const checksum = quakeWorldMapChecksum2(await content.mounts.read(simulation.recipe.map.geometry.requestedPath));
    for (const name of ['allow_download', 'allow_download_skins', 'allow_download_models', 'allow_download_sounds', 'allow_download_maps']) if (game.cvars.get(name) === undefined) game.cvars.register(name, '1', 0);
    const clients = new Map<number, ClientState>(), modelIndex = new Map(models.map((name, index) => [name, index + 1]));
    const field = (name: string): number => { const value = game.prepared.program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing QW source field ${name}`); return value.offset; };
    const slot = (actor: ActorId): number => { const value = game.sourceSlot(actor); if (value === null) throw new Error('QW actor has no live source slot'); return value; };
    const scalar = (actor: ActorId, name: string): number => game.entities.at(slot(actor)).float(field(name));
    const vector = (actor: ActorId, name: string): Vec3 => game.entities.at(slot(actor)).vector(field(name));
    const text = (actor: ActorId, name: string): string => game.machine.strings.get(game.entities.at(slot(actor)).int(field(name)));
    const global = (name: string): number => game.machine.globals.float(game.machine.globalOffset(name));
    const state = (actor: ActorId): QuakeWorldEntity => ({ number: slot(actor), modelIndex: Math.trunc(scalar(actor, 'modelindex')), frame: Math.trunc(scalar(actor, 'frame')),
        colorMap: Math.trunc(scalar(actor, 'colormap')), skin: Math.trunc(scalar(actor, 'skin')), effects: Math.trunc(scalar(actor, 'effects')),
        origin: vector(actor, 'origin'), angles: vector(actor, 'angles'), alpha: 0, scale: 16, step: false, lerpFinishSeconds: 0, quakeWorldFlags: 0 });
    const sourceActors = () => simulation.actors.ownedBy(simulation.recipe.map.entities.provider).filter(actor => slot(actor.id) > 32 && scalar(actor.id, 'modelindex') !== 0 && text(actor.id, 'model') !== '');
    const baselines = sourceActors().map(actor => ({ ...state(actor.id), effects: 0 }));
    const playerModel = modelIndex.get('progs/player.mdl') ?? 0;
    for (let index = 1; index <= 32; index++) baselines.push({ number: index, modelIndex: playerModel, frame: 0, colorMap: index, skin: 0, effects: 0,
        origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 }, alpha: 0, scale: 16, step: false, lerpFinishSeconds: 0, quakeWorldFlags: 0 });
    const encode = (records: readonly QwServerMessage[]): readonly Uint8Array[] => {
        const result: Uint8Array[] = []; let buffer = new SizeBuf(1400);
        for (const message of records) {
            const one = new SizeBuf(1400); writeQuakeWorldMessage(one, { kind: 'q1-quakeworld', version: 28 }, message);
            if (buffer.cursize + one.cursize > 1400) { result.push(buffer.bytes()); buffer = new SizeBuf(1400); }
            SZ_Write(buffer, one.bytes());
        }
        if (buffer.cursize !== 0) result.push(buffer.bytes()); return result;
    };
    const persistent: QwServerMessage[] = content.preparedQuakeC === null ? [] : game.signonMessages().flatMap(entry => entry.message.kind === 'packet-entities' || entry.message.kind === 'invalid-delta' ? [] : [entry.message]);
    for (const record of simulation.events.capture().persistent) if (record.kind === 'q1') {
        const event = record.event;
        if (event.kind === 'ambient') persistent.push({ kind: 'static-sound', entity: 0, channel: 0, index: sounds.indexOf(event.path) + 1,
            volume: Math.trunc(event.volume * 255), attenuation: event.attenuation, origin: event.origin });
        else if (event.kind === 'static-model') persistent.push({ kind: 'static', state: { number: 0, modelIndex: modelIndex.get(event.path) ?? 0,
            frame: event.frame, colorMap: event.colorMap, skin: event.skin, effects: 0, origin: event.origin, angles: event.angles, alpha: 0, scale: 16, step: false, lerpFinishSeconds: 0 } });
    }
    const signon = encode([...baselines.map(value => ({ kind: 'baseline', state: value } satisfies QwServerMessage)), ...persistent]);
    let routed: { readonly message: QwServerMessage; readonly destination: QcMessageDestination }[] = [];
    const queued: { readonly message: QwServerMessage; readonly destination: QcMessageDestination }[] = [];
    const styles = Array.from({ length: 64 }, (_, index) => simulation.events.lightStyle(index));
    const infoText = (info: ReadonlyMap<string, string>): string => [...info].map(([key, value]) => `\\${key}\\${value}`).join('');
    const requireClient = (player: QwApplicationPlayer): ClientState => { const client = clients.get(player.slot); if (client === undefined || !client.player.client.equals(player.client)) throw new Error('Stale QW client'); return client; };
    const eye = (actor: ActorId): Vec3 => { const origin = vector(actor, 'origin'), offset = vector(actor, 'view_ofs'); return { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z }; };
    const visible = (viewer: ActorId, target: ActorId): boolean => {
        if (viewer.equals(target)) return true;
        const origin = eye(viewer), linked = simulation.bodies.linked(target); if (linked === null) return false;
        const from = simulation.scene.boxLeaves({ min: { x: origin.x - 8, y: origin.y - 8, z: origin.z - 8 }, max: { x: origin.x + 8, y: origin.y + 8, z: origin.z + 8 } }, world.leaves.length);
        // SV_FindTouchedLeafs uses the source link envelope and retains at most MAX_ENT_LEAFS (16).
        const to = simulation.scene.boxLeaves(linked.absoluteBounds, 16);
        return from.leaves.some(first => to.leaves.some(second => simulation.scene.clusterVisible(simulation.scene.leafCluster(first), simulation.scene.leafCluster(second), 'pvs')));
    };
    const receives = (player: QwApplicationPlayer, destination: QcMessageDestination): boolean => {
        if (destination.kind === 'client') return player.actor.equals(destination.actor);
        if (destination.kind === 'signon') return false;
        if (destination.kind === 'broadcast' || destination.visibility === 'all') return true;
        const point = vector(player.actor, 'origin'), delta = { x: point.x - destination.origin.x, y: point.y - destination.origin.y, z: point.z - destination.origin.z };
        if (destination.visibility === 'phs' && delta.x * delta.x + delta.y * delta.y + delta.z * delta.z <= 1024 * 1024) return true;
        return simulation.scene.clusterVisible(simulation.scene.leafCluster(simulation.scene.pointLeaf(destination.origin)),
            simulation.scene.leafCluster(simulation.scene.pointLeaf(point)), destination.visibility);
    };
    const playerState = (client: ClientState, owner: QwApplicationPlayer): QwPlayerState => {
        const actor = client.player.actor, entity = state(actor), velocity = vector(actor, 'velocity');
        let flags = PF_MSEC | PF_COMMAND;
        if (entity.modelIndex !== playerModel) flags |= PF_MODEL;
        if (velocity.x !== 0) flags |= PF_VELOCITY1; if (velocity.y !== 0) flags |= PF_VELOCITY2; if (velocity.z !== 0) flags |= PF_VELOCITY3;
        if (entity.effects !== 0) flags |= PF_EFFECTS; if (entity.skin !== 0) flags |= PF_SKINNUM;
        const dead = scalar(actor, 'health') <= 0; if (dead) flags |= PF_DEAD; if (vector(actor, 'mins').z !== -24) flags |= PF_GIB;
        const weaponFrame = Math.trunc(scalar(actor, 'weaponframe'));
        if (owner.client.equals(client.player.client)) { flags &= ~(PF_MSEC | PF_COMMAND); if (weaponFrame !== 0) flags |= PF_WEAPONFRAME; }
        return { number: client.player.slot, flags, origin: entity.origin, frame: entity.frame, velocity, modelIndex: entity.modelIndex, skin: entity.skin, effects: entity.effects, weaponFrame,
            milliseconds: Math.min(255, Math.max(0, Math.trunc(1000 * (game.timeSeconds - client.commandTime)))),
            command: { ...client.command, buttons: 0, impulse: 0, angles: dead ? { x: 0, y: entity.angles.y, z: client.command.angles.z } : client.command.angles } };
    };
    const stats = (actor: ActorId): ReadonlyMap<number, number> => new Map<number, number>([
        [0, scalar(actor, 'health')], [2, modelIndex.get(text(actor, 'weaponmodel')) ?? 0], [3, scalar(actor, 'currentammo')], [4, scalar(actor, 'armorvalue')],
        [5, scalar(actor, 'weaponframe')], [6, scalar(actor, 'ammo_shells')], [7, scalar(actor, 'ammo_nails')], [8, scalar(actor, 'ammo_rockets')], [9, scalar(actor, 'ammo_cells')],
        [10, scalar(actor, 'weapon')], [11, global('total_secrets')], [12, global('total_monsters')], [13, global('found_secrets')], [14, global('killed_monsters')],
        [15, Math.trunc(scalar(actor, 'items')) | Math.trunc(global('serverflags')) << 28]
    ]);
    const spawnMessages = (player: QwApplicationPlayer, start: number): readonly Uint8Array[] => encode([
        { kind: "pause", paused: simulation.q1Paused },
                ...[...clients.values()].filter(client => client.player.slot >= start).map(client => ({ kind: 'userinfo', slot: client.player.slot, userId: client.player.client.generation * 32 + client.player.slot + 1, value: infoText(client.info) } satisfies QwServerMessage)),
                ...styles.map((value, index) => ({ kind: 'light-style', index, value } satisfies QwServerMessage)),
                ...[...stats(player.actor)].map(([index, value]) => ({ kind: 'stat', index, value: Math.trunc(value) } satisfies QwServerMessage))
            ]);
    let previousPause = simulation.q1Paused;
    return {
        ...(options.administration === undefined ? {} : { administration: options.administration }),
        ...(options.masters === undefined ? {} : { masters: options.masters }),
        authentication: { get password() { return game.cvars.variableString('password'); }, get spectatorPassword() { return game.cvars.variableString('spectator_password'); }, get highCharacters() { return game.cvars.variableValue('sv_highchars') !== 0; } },
        maxClients: 32, get paused() { return simulation.q1Paused; }, supportsSourceWire: () => ({ kind: 'supported' }),
        clientInfo: player => requireClient(player).info,
        commandPhase: (player, action, emit) => simulation.queueQuakeWorldAction(player.client, () => {
            if (!clients.get(player.slot)?.player.actor.equals(player.actor)) return;
            const flush = (): void => {
                game.messages.flush();
                const pending = queued.splice(0);
                for (const batch of game.drainMessages()) for (const entry of batch.entries)
                    if (entry.message.kind !== 'packet-entities' && entry.message.kind !== 'invalid-delta') pending.push({ message: entry.message, destination: batch.destination });
                for (const entry of pending) {
                    if (entry.destination.kind === 'signon' || !entry.destination.reliable) { queued.push(entry); continue; }
                    for (const client of clients.values()) if ((client.begun || entry.destination.kind === 'client') && receives(client.player, entry.destination)) emit(client.player, entry.message);
                }
            };
            flush(); action(); flush();
        }),
        admit: request => {
            const role = request.spectator ? 'spectator' : 'player';
            const limit = request.spectator ? Math.max(0, Math.min(32, Math.trunc(game.cvars.variableValue('maxspectators')))) : simulation.options.maxClients;
            if ([...clients.values()].filter(client => client.role === role).length >= limit) return { kind: 'rejected', reason: 'Server is full' };
            let index = 0; while (clients.has(index) && index < 32) index++;
            if (index === 32) return { kind: 'rejected', reason: 'Server is full' };
            const client = options.session.createClient(index); client.connect('remote');
            try {
                const info = new Map(quakeWorldInfo(request.userinfo));
                info.delete('*spectator');
                if (role === 'spectator') info.set('*spectator', '1');
                game.setClientRole(client.id, role); game.setClientInfo(client.id, info);
                const actor = game.reservedClient(client.id), player = { client: client.id, actor: actor.id, slot: index };
                clients.set(index, { player, role, info, begun: false, command: idle, commandTime: game.timeSeconds, stats: new Map<number, number>(), frags: 0 });
                queued.push({ message: { kind: 'userinfo', slot: index, userId: client.id.generation * 32 + index + 1, value: infoText(info) }, destination: { kind: 'broadcast', reliable: true } });
                return { kind: 'accepted', player };
            } catch (error) { options.session.closeClient(client.id); throw error; }
        },
        recordingPlayer: client => {
            const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
            if (actor === undefined || !game.isActiveClient(actor)) throw new Error('QW recording requires an active source player');
            const existing = clients.get(client.slot);
            if (existing !== undefined) {
                if (!existing.player.client.equals(client) || !existing.player.actor.equals(actor)) throw new Error('QW recording client slot belongs to another source player');
                return existing.player;
            }
            const player = { client, actor, slot: client.slot };
            clients.set(client.slot, { player, role: game.isSpectatorClient(actor) ? 'spectator' : 'player', info: new Map(game.clientInfo(client)), begun: true,
                command: idle, commandTime: game.timeSeconds, stats: new Map<number, number>(), frags: scalar(actor, 'frags') });
            return player;
        },
        recordingSignon: player => { requireClient(player); return spawnMessages(player, 0); },
        carriedPlayer: client => {
            const actor = game.reservedClient(client), player = { client, actor: actor.id, slot: client.slot };
            const carry = simulation.options.travel?.source;
            const info = new Map<string, string>(carry?.kind === 'quakeworld' ? carry.clients.find(entry => entry.client.equals(client))?.userInfo ?? [] : []);
            clients.set(client.slot, { player, role: game.isSpectatorClient(actor.id) ? 'spectator' : 'player', info, begun: false, command: idle, commandTime: game.timeSeconds, stats: new Map<number, number>(), frags: 0 }); return player;
        },
        disconnect: (player, reason) => {
            const actor = simulation.actors.resolveOwned(player.actor);
            if (actor !== null && !game.isActiveClient(actor.id)) game.disconnectClient(actor); else simulation.disconnectPlayer(player.actor);
            options.session.closeClient(player.client); clients.delete(player.slot);
            queued.push({ message: { kind: 'userinfo', slot: player.slot, userId: 0, value: '' }, destination: { kind: 'broadcast', reliable: true } }); options.print(reason); },
        baselines: () => baselines,
        prepareDownload: async (_player, requestedPath) => {
            const path = requestedPath.toLowerCase();
            if (path.includes('..') || path.startsWith('.') || !path.includes('/') || game.cvars.variableValue('allow_download') === 0) return null;
            try { downloadPath(path); } catch { return null; }
            for (const [prefix, setting] of [['skins/', 'skins'], ['progs/', 'models'], ['sound/', 'sounds'], ['maps/', 'maps']])
                if (prefix !== undefined && path.startsWith(prefix) && game.cvars.variableValue(`allow_download_${setting}`) === 0) return null;
            const asset = await content.mounts.open(path);
            if (asset === null || asset.bytes.length > 0x7fffffff || !canDownloadResource(asset.reference)
                || path.startsWith('maps/') && asset.reference.provenance.kind === 'archive') return null;
            let bytes: Uint8Array | null = asset.bytes;
            return { byteLength: asset.bytes.length, read: (offset, maximum) => {
                if (bytes === null) throw new Error('QW mounted download is closed');
                return bytes.slice(offset, offset + maximum);
            }, close: () => { bytes = null; } };
        },
        signon: player => ({
            serverData: () => ({ kind: 'server-data', protocol: { kind: 'q1-quakeworld', version: 28 }, serverCount: options.serverCount, gameDirectory: basename(content.catalog.product(simulation.recipe.map.entities.content).expectation.contentDirectory), playerSlot: player.slot,
                spectator: requireClient(player).role === 'spectator', level: game.machine.strings.get(game.entities.at(0).int(field('message'))),
                moveVariables: { gravity: game.cvars.variableValue('sv_gravity'), stopSpeed: game.cvars.variableValue('sv_stopspeed'), maxSpeed: game.cvars.variableValue('sv_maxspeed'),
                    spectatorMaxSpeed: game.cvars.variableValue('sv_spectatormaxspeed'), accelerate: game.cvars.variableValue('sv_accelerate'), airAccelerate: game.cvars.variableValue('sv_airaccelerate'),
                    waterAccelerate: game.cvars.variableValue('sv_wateraccelerate'), friction: game.cvars.variableValue('sv_friction'), waterFriction: game.cvars.variableValue('sv_waterfriction'), entityGravity: 1 } }),
            models: () => models, sounds: () => sounds, signonBuffers: () => signon, acceptsMapChecksum: value => value === (checksum >>> 0),
            spawn: start => { game.prepareClientSpawn(player.client); return spawnMessages(player, start); },
            begin: () => { const client = requireClient(player); const admitted = simulation.admitPlayer(player.client);
                if (!admitted.actor.equals(player.actor)) throw new Error('QW begin changed the reserved actor'); client.begun = true; },
            disconnect: reason => { options.print(reason); }, openDownload: () => null
        }),
        commandGroup: (player, commands, sequence) => { const client = requireClient(player); simulation.queueQuakeWorldCommands(player.client, commands, sequence);
            client.command = commands.at(-1) ?? idle; client.commandTime = game.timeSeconds; },
        command: (player, name, args) => {
            if (name === 'pause') {
                const previous = simulation.q1Paused, text = simulation.toggleQ1Pause(player.actor);
                queued.push({ message: { kind: 'print', level: 2, text }, destination: previous === simulation.q1Paused
                    ? { kind: 'client', actor: player.actor, reliable: true } : { kind: 'broadcast', reliable: true } });
            } else if (name === 'kill') {
                if (!game.clientKill(player.actor)) queued.push({ message: { kind: 'print', level: 2, text: "Can't suicide -- allready dead!\n" }, destination: { kind: 'client', actor: player.actor, reliable: true } });
            } else if (name === 'setinfo' && args.length === 2) {
                const key = args[0], value = args[1]; if (key === undefined || value === undefined || key.startsWith('*') || /[\\"\n\r]/.test(key + value)) return;
                const client = requireClient(player); if (value === '') client.info.delete(key); else client.info.set(key, value);
                game.setClientInfo(player.client, client.info); simulation.notifyClientEvent("userinfo", player.actor);
                queued.push({ message: { kind: 'set-info', slot: player.slot, key, value }, destination: { kind: 'broadcast', reliable: true } });
            } else options.print(`Unhandled QW client command: ${name}`);
        },
        observe: (_output, events) => {
            routed = queued.splice(0);
            if (previousPause !== simulation.q1Paused) { previousPause = simulation.q1Paused; routed.push({ message: { kind: "pause", paused: previousPause }, destination: { kind: "broadcast", reliable: true } }); }
            for (const batch of game.drainMessages()) for (const entry of batch.entries) {
                if (entry.message.kind !== 'packet-entities' && entry.message.kind !== 'invalid-delta') routed.push({ message: entry.message, destination: batch.destination });
            }
            for (const event of events) if (event.kind === 'view-reset') routed.push({ message: { kind: 'set-angle', angles: event.angles }, destination: { kind: 'client', actor: event.actor, reliable: true } });
            for (let index = 0; index < 64; index++) { const value = simulation.events.lightStyle(index); if (value !== styles[index]) {
                styles[index] = value; routed.push({ message: { kind: 'light-style', index, value }, destination: { kind: 'broadcast', reliable: true } });
            } }
            for (const client of clients.values()) if (client.begun) { const frags = scalar(client.player.actor, 'frags'); if (frags !== client.frags) {
                client.frags = frags; routed.push({ message: { kind: 'frags', slot: client.player.slot, value: Math.trunc(frags) }, destination: { kind: 'broadcast', reliable: true } });
            } }
        },
        frame: player => {
            const client = requireClient(player), messages: QwServerMessage[] = [], reliable: QwServerMessage[] = [];
            for (const entry of routed) if (receives(player, entry.destination)) (entry.destination.kind !== 'signon' && entry.destination.reliable ? reliable : messages).push(entry.message);
            for (const [index, raw] of stats(player.actor)) { const value = Math.trunc(raw); if (client.stats.get(index) !== value) { client.stats.set(index, value); reliable.push({ kind: 'stat', index, value }); } }
            for (const other of clients.values()) if (other.begun && (other.role === 'player' || other.player.actor.equals(player.actor)) && visible(player.actor, other.player.actor)) messages.push({ kind: 'player', state: playerState(other, player) });
            const entities: QuakeWorldEntity[] = [], nails: { readonly origin: Vec3; readonly pitch: number; readonly yaw: number }[] = [];
            for (const actor of sourceActors()) if (visible(player.actor, actor.id)) {
                const entity = state(actor.id);
                if (entity.modelIndex === modelIndex.get('progs/spike.mdl') || entity.modelIndex === modelIndex.get('progs/s_spike.mdl')) {
                    if (nails.length < 32) nails.push({ origin: entity.origin, pitch: entity.angles.x, yaw: entity.angles.y });
                } else if (entities.length < 64) entities.push(entity);
            }
            if (nails.length !== 0) messages.push({ kind: 'nails', projectiles: nails });
            return { messages, reliable, entities };
        },
        print: options.print
    };
}
