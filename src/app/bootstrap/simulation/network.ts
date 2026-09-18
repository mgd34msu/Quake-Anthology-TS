import { Q2WireCodec, encodeQ2ServerEvent } from '../../../network/q2/index.ts';
import type { MvdCapture, MvdEmission, MvdRecipient } from '../../../network/q2/mvd-encoding.ts';
import { expandCommandMacros } from '../../../core/commands/text.ts';
import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { ActorCommand } from '../../../contracts/session.ts';
import type { Q2ProtocolIdentity } from '../../../contracts/protocol.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { Q2CvarFlag } from '../../../core/cvars/index.ts';
import { addressKey } from '../../../network/common/endpoint.ts';
import { q2Userinfo } from '../../../content/q2/base/player/index.ts';
import { Q2_BASE_WEAPONS } from '../../../content/q2/foundation/weapons/index.ts';
import { packQ2Solid, q2SolidEncoding } from '../../../network/q2/solid.ts';
import { EntityStateT, PlayerStateT, toQ2Command, toQ2RereleaseCommand } from '../../../network/q2/index.ts';
import type { Q2ServerWriteEvent, Q2WireFrame, UsercmdT } from '../../../network/q2/index.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { Q2ApplicationPlayer, Q2ApplicationServerHost, Q2ApplicationServerEvent } from '../network/types.ts';
import { q2ApplicationLayout } from '../network/q2-layout.ts';
import { q2EffectToWire } from '../network/q2-effects.ts';
import { createQ2ApplicationDownloads } from '../network/q2-downloads.ts';
import type { SharedSimulation } from './runtime.ts';
export interface Q2ApplicationServerBindingOptions {
    readonly session: EngineSession;
    readonly rejects?: (address: import("../../../network/common/endpoint.ts").NetworkAddress) => boolean;
    readonly simulation: SharedSimulation;
    readonly content: LoadedApplicationContent;
    readonly protocol: Q2ProtocolIdentity;
    readonly administration?: Q2ApplicationServerHost['administration'];
    readonly masters?: Q2ApplicationServerHost['masters'];
    readonly playerIdentity?: (client: ClientId, identity: { readonly seat: number; readonly socialId: string } | null) => void;
    print(text: string): void;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function vector(target: Float32Array, value: Vec3): void { target.set([value.x, value.y, value.z]); }
/** This adapter reads shared actor/body/combat state and source player fields on every frame. */
export async function createQ2ApplicationServerHost(options: Q2ApplicationServerBindingOptions): Promise<Q2ApplicationServerHost> {
    const simulation = options.simulation, source = simulation.q2Source();
    if (source === null)
        throw new Error('Q2 server network host requires the Q2 source game provider');
    const cvars = simulation.q2ServerCvars();
    if (cvars === null) throw new Error('Q2 server network host requires the source cvar registry');
    cvars.register('sv_mvd_enable', '0', Q2CvarFlag.Latch);
    cvars.register('sv_mvd_maxclients', '8', Q2CvarFlag.Latch);
    cvars.register('sv_mvd_password', '', Q2CvarFlag.Private);
    cvars.register('hostname', 'noname', Q2CvarFlag.ServerInfo | Q2CvarFlag.Archive);
    for (const [name, value] of [['protocol', String(options.protocol.version)], ['mapname', source.game.options.mapName], ['maxclients', String(source.game.options.maxClients)]] satisfies readonly (readonly [string, string])[]) {
        cvars.register(name, value, Q2CvarFlag.ServerInfo | (name === 'maxclients' ? Q2CvarFlag.Latch : Q2CvarFlag.NoSet));
        cvars.set(name, value, true);
    }
    const downloads = createQ2ApplicationDownloads(await options.content.forContent(options.content.recipe.map.entities.content), cvars, source.game.options.edition);
    const layout = q2ApplicationLayout(options.protocol), models = new Map<string, number>(), sounds = new Map<string, number>(), images = new Map<string, number>();
    const configs = new Map<number, string>(), clients = new Map<number, Q2ApplicationPlayer>();
    const entityEvents = new Map<ActorId, number>();
    let eventFrame = -1;
    const sourceNumber = (actor: ActorId): number => { const address = simulation.actors.sourceOf(actor); if (address === null || address.provider !== simulation.recipe.map.entities.provider)
        throw new Error('Actor has no Q2 source entity address'); return address.slot; };
    const index = (path: string, table: Map<string, number>, base: number, maximum: number): number => { if (path === '')
        return 0; const existing = table.get(path); if (existing !== undefined)
        return existing; const value = table.size + 1; if (value >= maximum)
        throw new Error('Native Q2 resource table is full'); table.set(path, value); configs.set(base + value, path); return value; };
    const model = (path: string): number => index(path, models, layout.models, layout.maxModels), sound = (path: string): number => index(path, sounds, layout.sounds, layout.maxSounds), image = (path: string): number => index(path, images, layout.images, layout.maxImages);
    const checksum = blockChecksum(await options.content.mounts.read(options.content.recipe.map.geometry));
    const world = [...source.game.entities.values()].find(entity => entity.classname === 'worldspawn');
    configs.set(0, world?.message || source.game.options.mapName);
    configs.set(2, world?.spawn.values.get('sky') ?? 'unit1_');
    configs.set(3, world?.spawn.values.get('skyaxis') ?? '0 0 0');
    configs.set(4, world?.spawn.values.get('skyrotate') ?? '0');
    configs.set(layout.mapChecksum, String(checksum));
    configs.set(layout.maxClients, String(source.game.options.maxClients));
    const updateMovementConfigs = (): void => {
        const movement = simulation.q2MovementConfig();
        if (movement === null) throw new Error('Q2 host lost source movement configuration');
        configs.set(layout.airAccelerate, String(movement.airAccelerate));
        if (layout.n64Physics !== null) configs.set(layout.n64Physics, movement.n64Physics ? '1' : '0');
    };
    updateMovementConfigs();
    model(options.content.recipe.map.geometry.requestedPath);
    for (const entity of source.game.entities.values()) {
        for (const path of [entity.model, entity.model2, entity.model3, entity.model4])
            model(path);
        if (entity.sound !== '')
            sound(entity.sound);
    }
    for (const weapon of Q2_BASE_WEAPONS) {
        model(weapon.viewModel);
        model(weapon.worldModel);
    }
    image('i_health');
    source.items.list().forEach((item, ordinal) => configs.set(layout.items + ordinal + 1, item.name));
    const inventoryOrdinal = (item: string): number => source.items.list().findIndex(definition => definition.id === item) + 1;
    const entityStates = (protocol: Q2ProtocolIdentity): readonly EntityStateT[] => {
        const presentations = new Map(simulation.presentations().filter(presentation => !presentation.viewWeapon).map(presentation => [presentation.actor, presentation]));
        const result: EntityStateT[] = [];
        for (const entity of source.game.entities.values()) {
            const number = sourceNumber(entity.actor.id), body = simulation.bodies.read(entity.actor.id);
            if (number === 0 || body === null || !entity.visible || (entity.serverFlags & 1) !== 0)
                continue;
            const presentation = presentations.get(entity.actor.id), wire = new EntityStateT();
            wire.number = number;
            vector(wire.origin, body.origin);
            vector(wire.old_origin, presentation?.previousOrigin ?? body.origin);
            vector(wire.angles, body.angles);
            wire.modelindex = model(presentation?.path ?? entity.model);
            wire.modelindex2 = model(entity.model2);
            wire.modelindex3 = model(entity.model3);
            wire.modelindex4 = model(entity.model4);
            wire.frame = presentation?.frame ?? entity.frame;
            const flare = entity.flare;
            if (flare !== null) {
                wire.modelindex = 1;
                wire.modelindex2 = flare.fadeStart;
                wire.modelindex3 = flare.fadeEnd;
                wire.frame = (entity.renderFlags & 256) !== 0 ? image(flare.image) : 0;
            }
            wire.skinnum = presentation?.skin ?? entity.skin;
            wire.effects = presentation?.effects ?? entity.effects;
            wire.renderfx = presentation?.renderFlags ?? entity.renderFlags;
            wire.event = entityEvents.get(entity.actor.id) ?? 0;
            const nativePlayer = source.players.states.get(entity.actor.id);
            if (nativePlayer !== undefined) {
                wire.modelindex = 255;
                wire.skinnum = nativePlayer.slot;
                const weapon = source.weapons.states.get(entity.actor.id)?.weapon;
                if (weapon !== undefined && weapon !== null) {
                    wire.modelindex2 = 255;
                    wire.skinnum |= source.weapons.definition(weapon).playerModel << 8;
                }
            }
            wire.sound = sound(entity.sound);
            wire.loop_volume = entity.classname === 'target_speaker' && (entity.spawnflags & 3) !== 0 ? 1 : entity.volume;
            wire.loop_attenuation = entity.attenuation;
            wire.scale = entity.scale === 1 ? 0 : entity.scale;
            if (entity.solid === 'brush')
                wire.solid = 31;
            else if (entity.solid === 'box')
                wire.solid = packQ2Solid(body.bounds, q2SolidEncoding(protocol));
            if (wire.modelindex !== 0 || wire.sound !== 0 || wire.effects !== 0 || wire.event !== 0)
                result.push(wire);
        }
        return result.sort((a, b) => a.number - b.number);
    };
    const visibleEntities = (player: Q2ApplicationPlayer, states: readonly EntityStateT[], origin: Vec3): readonly EntityStateT[] => {
        const scene = simulation.scene, leaf = scene.pointLeaf(origin), area = scene.leafArea(leaf), cluster = scene.leafCluster(leaf);
        const fat = scene.boxLeaves({ min: { x: origin.x - 8, y: origin.y - 8, z: origin.z - 8 }, max: { x: origin.x + 8, y: origin.y + 8, z: origin.z + 8 } }, 64);
        const clusters = [...new Set(fat.leaves.map(index => scene.leafCluster(index)))];
        const byNumber = new Map([...source.game.entities.values()].map(entity => [sourceNumber(entity.actor.id), entity]));
        return states.filter(state => {
            const entity = byNumber.get(state.number);
            if (entity === undefined)
                return false;
            if (entity.owner?.equals(player.actor))
                state.solid = 0;
            if (state.number === player.sourceEntity)
                return true;
            // Rerelease speaker ATTN_LOOP_NONE carries source SVF_NOCULL semantics.
            if (source.game.options.edition === 'rerelease' && entity.classname === 'target_speaker' && (entity.spawnflags & 3) !== 0 && entity.attenuation === -1)
                return true;
            const body = simulation.bodies.read(entity.actor.id);
            if (body === null)
                return false;
            const bounds = simulation.bodies.linked(entity.actor.id)?.absoluteBounds ?? { min: { x: body.origin.x + body.bounds.min.x - 1, y: body.origin.y + body.bounds.min.y - 1, z: body.origin.z + body.bounds.min.z - 1 }, max: { x: body.origin.x + body.bounds.max.x + 1, y: body.origin.y + body.bounds.max.y + 1, z: body.origin.z + body.bounds.max.z + 1 } };
            const leaves = scene.boxLeaves(bounds, options.content.world.kind === 'q2-bsp' ? options.content.world.leaves.length : 65536).leaves;
            if (!leaves.some(index => scene.areasConnected(area, scene.leafArea(index))))
                return false;
            if ((state.renderfx & 128) !== 0) {
                const first = leaves[0];
                return first !== undefined && scene.clusterVisible(cluster, scene.leafCluster(first), 'phs');
            }
            if (!leaves.some(index => clusters.some(from => scene.clusterVisible(from, scene.leafCluster(index), 'pvs'))))
                return false;
            return state.modelindex !== 0 || Math.hypot(origin.x - body.origin.x, origin.y - body.origin.y, origin.z - body.origin.z) <= 400;
        });
    };
    const playerState = (player: Pick<Q2ApplicationPlayer, 'actor'>): PlayerStateT => {
        const movement = simulation.movementPlayer(player.actor), view = simulation.q2PlayerView(player.actor);
        if (movement === null)
            throw new Error('Network player has no movement state');
        const state = new PlayerStateT(), native = movement.state;
        if (native.kind === 'q2-classic') {
            state.pmove.pm_type = native.type;
            state.pmove.origin.set(native.originEighths);
            state.pmove.velocity.set(native.velocityEighths);
            state.pmove.originF.set(native.originEighths.map(value => value / 8));
            state.pmove.velocityF.set(native.velocityEighths.map(value => value / 8));
            state.pmove.delta_angles.set(native.deltaAngleShorts);
            state.pmove.pm_flags = native.flags;
            state.pmove.pm_time = native.timeEightMilliseconds;
            state.pmove.gravity = native.gravity;
        }
        else if (native.kind === 'q2-rerelease') {
            state.pmove.pm_type = native.type;
            vector(state.pmove.originF, native.origin);
            vector(state.pmove.velocityF, native.velocity);
            vector(state.pmove.delta_anglesF, native.deltaAngles);
            state.pmove.deltaAngleEncoding = 'float';
            state.pmove.delta_angles.set([native.deltaAngles.x, native.deltaAngles.y, native.deltaAngles.z].map(angle => Math.trunc(angle * 65536 / 360) & 65535));
            state.pmove.pm_flags = native.flags;
            state.pmove.pm_time = native.timeMilliseconds;
            state.pmove.gravity = native.gravity;
            state.pmove.viewheight = native.viewHeight;
        }
        else
            throw new Error('Native Q2 playerstate requires a Q2 movement provider');
        vector(state.viewangles, view?.angles ?? movement.viewAngles);
        vector(state.viewoffset, view?.offset ?? { x: 0, y: 0, z: movement.viewHeight });
        vector(state.kick_angles, view?.kickAngles ?? zero);
        vector(state.gunangles, view?.gunAngles ?? zero);
        vector(state.gunoffset, view?.gunOffset ?? zero);
        if (view !== null)
            state.blend.set([view.blend.x, view.blend.y, view.blend.z, view.blend.w]);
        state.fov = view?.fov ?? 90;
        state.rdflags = view?.underwater ? 1 : 0;
        const weapon = source.weapons.states.get(player.actor);
        if (weapon !== undefined) {
            state.gunindex = weapon.weapon === null ? 0 : model(source.weapons.definition(weapon.weapon).viewModel);
            state.gunframe = weapon.frame;
            state.gunrate = weapon.gunRate;
        }
        const ui = simulation.playerUi(player.actor);
        state.stats[0] = image('i_health');
        state.stats[1] = view?.health ?? ui.health;
        state.stats[3] = view?.ammo ?? ui.ammo?.count ?? 0;
        state.stats[5] = view?.armor ?? (ui.armor.kind === 'none' ? 0 : ui.armor.points);
        state.stats[9] = view?.timer?.seconds ?? 0;
        state.stats[13] = view?.layouts ?? 0;
        state.stats[14] = view?.score ?? 0;
        state.stats[16] = view?.selectedItem === null || view === null ? 0 : inventoryOrdinal(view.selectedItem);
        state.stats[17] = view?.spectator ? 1 : 0;
        return state;
    };
    const captureMvd = (_output: Parameters<Q2ApplicationServerHost['observe']>[0], events: Parameters<Q2ApplicationServerHost['observe']>[1], servercount: number): MvdCapture => {
        updateMovementConfigs();
        const rerelease = source.game.options.edition === 'rerelease';
        const protocol: Q2ProtocolIdentity = rerelease ? { kind: 'q2-rerelease', version: 1038 } : { kind: 'q2-classic', version: 34 };
        const wire = new Q2WireCodec(protocol), players = new Map<number, PlayerStateT>(), messages: MvdEmission[] = [];
        for (const [actor, state] of source.players.states) {
            if (!state.connected || simulation.movementPlayer(actor) === null) continue;
            const number = sourceNumber(actor) - 1;
            players.set(number, playerState({ actor }));
        }
        const entities = entityStates(protocol), geometry = simulation.scene.geometry;
        if (geometry.kind !== 'q2-bsp') throw new Error('MVD source capture requires Quake II portal topology');
        const maxPortal = geometry.areaPortals.reduce((maximum, value) => Math.max(maximum, value.portal), -1);
        const portalBits = new Uint8Array(Math.ceil((maxPortal + 1) / 8));
        for (const portal of simulation.scene.q2PortalState()) portalBits[portal >>> 3] = (portalBits[portal >>> 3] ?? 0) | 1 << (portal & 7);
        const target = (actor: ActorId | null): MvdRecipient => actor === null ? { kind: 'all' } : { kind: 'player', number: sourceNumber(actor) - 1 };
        const emit = (event: Q2ServerWriteEvent, recipient: MvdRecipient, reliable: boolean): void => { messages.push({ bytes: encodeQ2ServerEvent(wire, event), recipient, reliable }); };
        for (const item of events) {
            if (item.kind === 'q2-player') {
                const event = item.event;
                if (event.kind === 'print') emit({ kind: 'print', level: event.level === 'chat' ? 3 : event.level === 'high' ? 2 : event.level === 'medium' ? 1 : 0, text: event.text }, target(event.target), true);
                else if (event.kind === 'stufftext') emit({ kind: 'command-text', text: event.text }, target(event.actor), true);
                else if (event.kind === 'inventory') {
                    const counts = new Array<number>(256).fill(0);
                    for (const entry of event.entries) { const ordinal = inventoryOrdinal(entry.item); if (ordinal > 0 && ordinal < 256) counts[ordinal] = entry.count; }
                    emit({ kind: 'inventory', counts }, target(event.actor), true);
                }
            } else if (item.kind === 'q2') {
                const event = item.event;
                if (event.kind === 'print') emit({ kind: 'print', level: event.level === 'chat' ? 3 : event.level === 'high' ? 2 : event.level === 'medium' ? 1 : 0, text: event.text }, target(event.actor), true);
                else if (event.kind === 'centerprint') emit({ kind: 'center-print', text: event.text }, target(event.actor), true);
                else if (event.kind === 'effect') {
                    const value = q2EffectToWire(event);
                    // Presentation effects currently retain no native multicast scope; preserve existing server routing.
                    if (value !== null) emit({ kind: 'temporary-entity', value }, { kind: 'all' }, false);
                } else if (event.kind === 'sound' && event.loop === 'once') {
                    const recipient: MvdRecipient = event.attenuation === 0 || (event.channel & 8) !== 0 ? { kind: 'all' } : { kind: 'phs', leaf: simulation.scene.pointLeaf(event.origin) };
                    emit({ kind: 'sound', sound: { flags: 0, index: sound(event.path), entity: event.actor === null ? 0 : item.sourceEntity ?? sourceNumber(event.actor), channel: event.channel & 7, position: event.origin, volume: event.volume, attenuation: event.attenuation, delaySeconds: 0 } }, recipient, event.reliable || (event.channel & 16) !== 0);
                } else if (event.kind === 'monster-muzzleflash') {
                    const entity = item.sourceEntity ?? sourceNumber(event.actor), body = simulation.bodies.read(event.actor);
                    if (body !== null) emit({ kind: 'muzzle-flash', entity, flash: event.flash, monster: true, silenced: false }, { kind: 'pvs', leaf: simulation.scene.pointLeaf(body.origin) }, false);
                }
            } else if (item.kind === 'q2-weapon' && item.event.kind === 'muzzleflash') {
                const event = item.event, body = simulation.bodies.read(event.actor);
                if (body !== null) emit({ kind: 'muzzle-flash', entity: item.sourceEntity ?? sourceNumber(event.actor), flash: event.flash, monster: false, silenced: event.silenced }, { kind: 'pvs', leaf: simulation.scene.pointLeaf(body.origin) }, false);
            }
        }
        return { revision: rerelease ? 3038 : 2010, flags: 0, servercount, gamedir: options.content.catalog.product(simulation.recipe.map.entities.content).expectation.contentDirectory.split('/').at(-1) ?? 'baseq2', dummy: -1, configStrings: new Map(configs), portalBits, players, entities, messages };
    };
    const knownConfigs = new Map<number, Map<number, string>>();
    return {
        downloads,
        ...(options.rejects === undefined ? {} : { rejects: options.rejects }),
        mvdCapture: captureMvd,
        mvdSettings: () => ({ enabled: cvars.variableValue('sv_mvd_enable') !== 0, maxViewers: Math.max(1, Math.min(256, Math.trunc(cvars.variableValue('sv_mvd_maxclients')))), password: cvars.variableString('sv_mvd_password') }),
        ...(options.administration === undefined ? {} : { administration: options.administration }),
        ...(options.masters === undefined ? {} : { masters: options.masters }),
        discovery: {
            status: () => ({ serverInfo: cvars.infoString(Q2CvarFlag.ServerInfo), players: [...source.players.states.values()]
                .filter(player => player.connected).map(player => ({ name: player.name, score: player.score, ping: player.ping })) }),
            info: () => ({ name: cvars.variableString('hostname'), map: source.game.options.mapName,
                players: [...source.players.states.values()].filter(player => player.connected).length, maxPlayers: source.game.options.maxClients }),
        },
        protocol: options.protocol, messageOptions: { maxConfigStrings: layout.maxConfigStrings, inventorySlots: 256 }, maxClients: source.game.options.maxClients,
        observe: (output, events) => {
            if (eventFrame !== output.snapshot.frame.frame) {
                entityEvents.clear();
                eventFrame = output.snapshot.frame.frame;
            }
            for (const { kind, event } of events.filter(item => item.kind === 'q2' || item.kind === 'q2-player')) {
                if (kind === 'q2') {
                    if (event.kind === 'lightstyle')
                        configs.set(layout.lights + event.style, event.pattern);
                    else if (event.kind === 'entity-event')
                        entityEvents.set(event.actor, event.event);
                    else if (event.kind === 'sound')
                        sound(event.path);
                    else if (event.kind === 'model')
                        for (const path of [event.path, ...event.attachedModels])
                            model(path);
                }
                else if (event.kind === 'userinfo')
                    configs.set(layout.playerSkins + event.slot, `${event.name}\\${event.skin}`);
            }
        },
        supportsSourceWire: () => {
            const reasons: string[] = [];
            if (!simulation.recipe.movement.provider.startsWith('q2:'))
                reasons.push('Selected movement requires unified peer serialization');
            if (!simulation.recipe.character.definition.provider.startsWith('q2:'))
                reasons.push('Selected character requires unified peer serialization');
            if (options.protocol.kind === 'q2-kex-demo')
                reasons.push('KEX native live transport is not bound');
            if (source.game.options.edition === 'classic' && (options.protocol.kind === 'q2-rerelease' || options.protocol.kind === 'q2-kex' || options.protocol.kind === 'q2-kex-demo') || source.game.options.edition === 'rerelease' && options.protocol.kind !== 'q2-rerelease' && options.protocol.kind !== 'q2-kex')
                reasons.push('Selected application game API and native message layout differ');
            return reasons.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', reasons };
        },
        admit: (from, request) => {
            const pairs = new Map(q2Userinfo(request.userinfo));
            if (request.protocol.kind === 'q2-kex') {
                const suffix = `_${request.splitSeat ?? 0}`;
                for (const [key, value] of [...pairs]) if (key.endsWith(suffix)) pairs.set(key.slice(0, -suffix.length), value);
            }
            pairs.set('ip', addressKey(from));
            const userinfo = [...pairs].map(([key, value]) => `\\${key}\\${value}`).join('');
            const socialId = request.socialIds?.[0] ?? '';
            if (socialId !== '' && options.playerIdentity === undefined) return { kind: 'rejected', reason: 'Server has no rerelease social identity owner' };
            const allowed = source.players.connect(source.game, userinfo);
            if (!allowed.allowed)
                return { kind: 'rejected', reason: allowed.reason };
            let slot = 0;
            for (; slot < source.game.options.maxClients; slot++)
                if (!clients.has(slot) && !simulation.players().some(actor => simulation.movementPlayer(actor)?.client.slot === slot))
                    break;
            if (slot === source.game.options.maxClients)
                return { kind: 'rejected', reason: 'Server is full' };
            const client = options.session.createClient(slot);
            client.connect(from.kind === 'loopback' ? 'loopback' : 'remote');
            options.playerIdentity?.(client.id, { seat: request.splitSeat ?? 0, socialId });
            let admittedActor: ActorId | null = null;
            try {
                const admitted = simulation.admitPlayer(client.id), entity = source.game.entity(admitted.actor);
                admittedActor = admitted.actor;
                if (entity === null)
                    throw new Error('Admitted Q2 player has no source entity');
                source.players.userinfoChanged(entity, source.game, allowed.userinfo);
                const player = { client: client.id, actor: admitted.actor, sourceEntity: sourceNumber(admitted.actor) };
                clients.set(slot, player);
                return { kind: 'accepted', player };
            }
            catch (error) {
                if (admittedActor !== null) simulation.disconnectPlayer(admittedActor);
                options.playerIdentity?.(client.id, null);
                options.session.closeClient(client.id);
                throw error;
            }
        },
        disconnect: (player, _reason) => { simulation.disconnectPlayer(player.actor); options.playerIdentity?.(player.client, null); options.session.closeClient(player.client); clients.delete(player.client.slot); knownConfigs.delete(player.client.slot); },
        carriedPlayer: client => { const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client)); if (actor === undefined)
            throw new Error('Application has not admitted carried Q2 network client'); const player = { client, actor, sourceEntity: sourceNumber(actor) }; clients.set(client.slot, player); return player; },
        gameState: (player, protocol = options.protocol) => {
            updateMovementConfigs();
            const entities = entityStates(protocol);
            for (const state of source.players.states.values())
                configs.set(layout.playerSkins + state.slot, `${state.name}\\${state.skin}`);
            knownConfigs.set(player.client.slot, new Map(configs));
            return { data: { servercount: 1, attractloop: false, gamedir: options.content.catalog.product(simulation.recipe.map.entities.content).expectation.contentDirectory.split('/').at(-1) ?? 'baseq2', clientnum: player.sourceEntity - 1, levelname: configs.get(0) ?? '', serverState: 2, ...(protocol.kind === 'q2-r1q2' ? { r1q2Version: protocol.revision, r1q2StrafejumpHack: false } : protocol.kind === 'q2-q2pro' ? { q2proVersion: protocol.revision, wireFlags: 0 } : {}), serverFps: source.game.options.edition === 'rerelease' ? 40 : 10 }, configStrings: new Map(configs), baselines: new Map(entities.map(entity => [entity.number, entity])) };
        },
        frame: (player, output, protocol = options.protocol): Q2WireFrame => { const body = simulation.bodies.read(player.actor); if (body === null)
            throw new Error('Network player body disappeared'); const state = playerState(player), origin = { x: body.origin.x + (state.viewoffset[0] ?? 0), y: body.origin.y + (state.viewoffset[1] ?? 0), z: body.origin.z + (state.viewoffset[2] ?? 0) }; return { serverFrame: output.snapshot.frame.frame, deltaFrame: -1, suppressedCount: 0, areaBits: simulation.scene.areaBits(simulation.scene.leafArea(simulation.scene.pointLeaf(origin))), player: state, entities: visibleEntities(player, entityStates(protocol), origin) }; },
        events: (player, _output, events) => {
            updateMovementConfigs();
            const messages: Q2ApplicationServerEvent[] = [];
            const targets = (actor: ActorId | null): boolean => actor === null || actor.equals(player.actor);
            for (const item of events) {
                if (item.kind === 'q2-player') {
                    const event = item.event;
                    if (event.kind === 'print' && targets(event.target))
                        messages.push({ kind: 'print', level: event.level === 'chat' ? 3 : event.level === 'high' ? 2 : event.level === 'medium' ? 1 : 0, text: event.text });
                    else if (event.kind === 'stufftext' && targets(event.actor))
                        messages.push({ kind: 'command-text', text: event.text });
                    else if (event.kind === 'userinfo')
                        configs.set(layout.playerSkins + event.slot, `${event.name}\\${event.skin}`);
                    else if (event.kind === 'inventory' && targets(event.actor)) {
                        const counts = new Array<number>(256).fill(0);
                        for (const entry of event.entries) {
                            const ordinal = inventoryOrdinal(entry.item);
                            if (ordinal > 0 && ordinal < 256)
                                counts[ordinal] = entry.count;
                        }
                        messages.push({ kind: 'inventory', counts });
                    }
                }
                else if (item.kind === 'q2') {
                    const event = item.event;
                    if (event.kind === 'print' && targets(event.actor))
                        messages.push({ kind: 'print', level: event.level === 'chat' ? 3 : event.level === 'high' ? 2 : event.level === 'medium' ? 1 : 0, text: event.text });
                    else if (event.kind === 'centerprint' && targets(event.actor))
                        messages.push({ kind: 'center-print', text: event.text });
                    else if (event.kind === 'lightstyle')
                        configs.set(layout.lights + event.style, event.pattern);
                    else if (event.kind === 'effect') {
                        const value = q2EffectToWire(event);
                        if (value !== null)
                            messages.push({ kind: 'temporary-entity', value });
                    }
                    else if (event.kind === 'sound' && event.loop === 'once')
                        messages.push({ kind: 'sound', reliable: event.reliable, sound: { flags: 0, index: sound(event.path), entity: event.actor === null ? 0 : item.sourceEntity ?? sourceNumber(event.actor), channel: event.channel, position: event.origin, volume: event.volume, attenuation: event.attenuation, delaySeconds: 0 } });
                    else if (event.kind === 'monster-muzzleflash')
                        messages.push({ kind: 'muzzle-flash', entity: item.sourceEntity ?? sourceNumber(event.actor), flash: event.flash, monster: true, silenced: false });
                }
                else if (item.kind === 'q2-weapon' && item.event.kind === 'muzzleflash')
                    messages.push({ kind: 'muzzle-flash', entity: item.sourceEntity ?? sourceNumber(item.event.actor), flash: item.event.flash, monster: false, silenced: item.event.silenced });
            }
            const known = knownConfigs.get(player.client.slot);
            if (known === undefined)
                throw new Error('Q2 client has no configstring history');
            const updates: Q2ServerWriteEvent[] = [];
            for (const [index, value] of configs)
                if (known.get(index) !== value) {
                    updates.push({ kind: 'config-string', index, value });
                    known.set(index, value);
                }
            return [...updates, ...messages];
        },
        input: (player, command: UsercmdT, sequence): ActorCommand => ({ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command: source.game.options.edition === 'classic' ? toQ2Command(command) : toQ2RereleaseCommand(command, options.protocol.kind === 'q2-kex' ? command.serverFrame : sequence) }),
        expandClientCommand: text => expandCommandMacros(text, name => cvars.variableString(name), options.print),
        command: (player, name, args) => { const entity = source.game.entity(player.actor); if (entity === null)
            throw new Error('Q2 command has no source player'); source.players.clientCommand(entity, source.game, name, args); },
        userinfo: (player, value) => { const entity = source.game.entity(player.actor); if (entity === null)
            throw new Error('Q2 userinfo has no source entity'); source.players.userinfoChanged(entity, source.game, value); }, print: options.print,
    };
}
