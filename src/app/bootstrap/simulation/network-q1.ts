import type { ResourceId } from '../../../contracts/content.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import type { Q1ProtocolIdentity, Q1ExtendedEntityState } from '../../../contracts/protocol.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { SharedSimulation } from './runtime.ts';
import type { Q1ApplicationPlayer, Q1ApplicationServerHost, Q1ApplicationMessage } from '../network/q1-types.ts';
import type { SimulationPresentationEvent } from './types.ts';
import type { SimulationOutput } from '../../../contracts/session.ts';
import { WEAPONS } from '../../../content/q1/foundation/types.ts';
export interface Q1ApplicationServerBindingOptions {
    readonly session: EngineSession;
    readonly simulation: SharedSimulation;
    readonly content: LoadedApplicationContent;
    readonly protocol: Q1ProtocolIdentity;
    print(text: string): void;
}
export async function createQ1ApplicationServerHost(options: Q1ApplicationServerBindingOptions): Promise<Q1ApplicationServerHost> {
    const simulation = options.simulation, source = simulation.q1Source();
    if (source === null)
        throw new Error('Q1 network requires the Q1 source game');
    const game = source.game, maxClients = game.options.maxClients ?? 1, clients = new Map<number, Q1ApplicationPlayer>();
    if (!game.usesId1Precaches || game.options.edition !== 'classic' || source.composition.selection.program !== 'id1')
        throw new Error('Native ordered Q1 precaches currently require classic id1 source declarations');
    if (game.precaches.phase !== 'frozen') throw new Error('Q1 source precaches are still loading');
    if (game.precaches.models.length > 256 || game.precaches.sounds.length > 256) throw new Error('NetQuake 15 precache overflow');
    const models = new Map(game.precaches.models.slice(1).map((path, ordinal) => [path, ordinal + 1]));
    const sounds = new Map(game.precaches.sounds.slice(1).map((path, ordinal) => [path, ordinal + 1]));
    const soundResources = new Map<string, ResourceId>();
    const mounts = await options.content.forContent(simulation.recipe.map.entities.content);
    for (const path of models.keys())
        if (!path.startsWith('*') && await mounts.resolve(path) === null)
            throw new Error(`Q1 model precache resource is missing: ${path}`);
    for (const path of sounds.keys()) {
        const resource = await mounts.resolve(`sound/${path}`);
        if (resource === null) throw new Error(`Q1 sound precache resource is missing: ${path}`);
        soundResources.set(path, resource.id);
        simulation.registerResource(simulation.recipe.map.entities.content, `sound/${path}`, resource);
    }
    const index = (path: string, table: ReadonlyMap<string, number>): number => { if (path === '')
        return 0; const value = table.get(path); if (value === undefined)
        throw new Error(`Q1 resource was not precached before signon: ${path}`); return value; };
    const number = (actor: ActorId): number => { const address = simulation.actors.sourceOf(actor); if (address === null || address.provider !== simulation.recipe.map.entities.provider)
        throw new Error('Q1 actor has no source address'); return address.slot; };
    const entities = (): readonly Q1ExtendedEntityState[] => {
        const states: Q1ExtendedEntityState[] = [], presentations = new Map(simulation.presentations().filter(value => !value.viewWeapon).map(value => [value.actor, value]));
        for (const entity of game.entities.values()) {
            const body = simulation.bodies.read(entity.actor.id), presentation = presentations.get(entity.actor.id), path = presentation?.path ?? entity.model;
            if (body === null || path === '' || number(entity.actor.id) === 0)
                continue;
            states.push({ number: number(entity.actor.id), origin: body.origin, angles: body.angles, modelIndex: index(path, models), frame: presentation?.frame ?? entity.frame, colorMap: game.player(entity.actor.id) === null ? 0 : number(entity.actor.id), skin: presentation?.skin ?? entity.skin, effects: (presentation?.effects ?? entity.effects) | (muzzleFlashes.has(entity.actor.id) ? 2 : 0), alpha: 0, scale: 16, lerpFinishSeconds: 0, step: entity.movement === 'step' });
        }
        for (const actor of simulation.players()) {
            const body = simulation.bodies.read(actor), presentation = presentations.get(actor);
            if (body === null)
                continue;
            states.push({ number: number(actor), origin: body.origin, angles: body.angles, modelIndex: index(presentation?.path ?? 'progs/player.mdl', models), frame: presentation?.frame ?? 0, colorMap: number(actor), skin: presentation?.skin ?? 0, effects: (presentation?.effects ?? 0) | (muzzleFlashes.has(actor) ? 2 : 0), alpha: 0, scale: 16, lerpFinishSeconds: 0, step: false });
        }
        return states.sort((a, b) => a.number - b.number);
    };
    const muzzleFlashes = new Set<ActorId>();
    const clientData = (player: Q1ApplicationPlayer): Q1ApplicationMessage => {
        const movement = simulation.movementPlayer(player.actor), native = game.player(player.actor), ui = simulation.playerUi(player.actor);
        if (movement === null || movement.state.kind !== 'q1-netquake' || native === null)
            throw new Error('Q1 native movement/player state unavailable');
        const state = movement.state;
        let items = 0;
        const weaponBits = [4096, 1, 2, 4, 8, 16, 32, 64];
        WEAPONS.forEach((weapon, ordinal) => { if (simulation.inventory.count(player.actor, game.weaponItem(weapon)) > 0)
            items |= weaponBits[ordinal] ?? 0; });
        if (ui.armor.kind !== 'none')
            items |= ui.armor.kind === 'q1' && ui.armor.absorption >= 0.8 ? 32768 : ui.armor.kind === 'q1' && ui.armor.absorption >= 0.6 ? 16384 : 8192;
        for (const [powerup, expires] of native.powerups)
            if (expires > game.time)
                items |= powerup === 'quad' ? 4194304 : powerup === 'invulnerability' ? 1048576 : powerup === 'invisibility' ? 524288 : powerup === 'suit' ? 2097152 : 0;
        return { kind: 'client-data', weaponAlpha: 0, data: { viewHeight: movement.viewHeight, idealPitch: state.idealPitch, punchAngles: state.punchAngles, velocity: state.velocity, items, onGround: (state.flags & 512) !== 0, inWater: state.waterLevel >= 2, weaponFrame: native.weaponFrame, armor: ui.armor.kind === 'none' ? 0 : ui.armor.points, weaponModel: index(game.weaponModel(native.weapon, native), models), health: ui.health, ammo: ui.ammo?.count ?? 0, shells: simulation.inventory.count(player.actor, 'q1:ammo/shells'), nails: simulation.inventory.count(player.actor, 'q1:ammo/nails'), rockets: simulation.inventory.count(player.actor, 'q1:ammo/rockets'), cells: simulation.inventory.count(player.actor, 'q1:ammo/cells'), activeWeapon: weaponBits[WEAPONS.findIndex(weapon => weapon === native.weapon)] ?? 0 } };
    };
    interface Routed {
        readonly recipient: ActorId | null;
        readonly reliable: boolean;
        readonly message: Q1ApplicationMessage;
    }
    let routed: Routed[] = [];
    const board = new Map<number, {
        readonly name: string;
        readonly colors: number;
        readonly frags: number;
    }>();
    const ambientSignon = (): readonly Q1ApplicationMessage[] => simulation.events.capture().persistent.flatMap(record => {
        if (record.kind !== 'q1' || record.event.kind !== 'ambient')
            return [];
        return [{ kind: 'static-sound', entity: 0, channel: 0, index: index(record.event.path, sounds), volume: Math.trunc(record.event.volume * 255), attenuation: record.event.attenuation, origin: record.event.origin } satisfies Q1ApplicationMessage];
    });
    const observe = (output: SimulationOutput, events: readonly SimulationPresentationEvent[]): void => {
        routed = [];
        muzzleFlashes.clear();
        const capturedSounds = output.events.flatMap(event => event.payload.kind === 'sound' ? [event.payload] : []);
        const send = (message: Q1ApplicationMessage, reliable = false, recipient: ActorId | null = null): void => { routed.push({ message, reliable, recipient }); };
        const liveSlots = new Set<number>();
        for (const client of source.composition.clients.records.values()) {
            liveSlots.add(client.slot);
            const previous = board.get(client.slot), colors = client.shirt * 16 + client.pants;
            if (previous?.name !== client.name)
                send({ kind: 'name', slot: client.slot, value: client.name }, true);
            if (previous?.colors !== colors)
                send({ kind: 'colors', slot: client.slot, value: colors }, true);
            if (previous?.frags !== client.frags)
                send({ kind: 'frags', slot: client.slot, value: client.frags }, true);
            board.set(client.slot, { name: client.name, colors, frags: client.frags });
        }
        for (const slot of board.keys())
            if (!liveSlots.has(slot)) {
                send({ kind: 'name', slot, value: '' }, true);
                send({ kind: 'colors', slot, value: 0 }, true);
                send({ kind: 'frags', slot, value: 0 }, true);
                board.delete(slot);
            }
        for (const record of events) {
            if (record.kind === 'view-reset') {
                send({ kind: 'set-angle', angles: record.angles }, true, record.actor);
                continue;
            }
            if (record.kind !== 'q1')
                continue;
            const event = record.event;
            switch (event.kind) {
                case 'sound': {
                    if (record.content !== simulation.recipe.map.entities.content)
                        throw new Error('Native Q1 sound belongs to another content provider');
                    const sound = sounds.get(event.path);
                    if (sound === undefined) {
                        options.print(`SV_StartSound: ${event.path} not precached\n`);
                        break;
                    }
                    const channel = typeof event.channel === 'number' ? event.channel : { auto: 0, weapon: 1, voice: 2, item: 3, body: 4 }[event.channel];
                    const captureIndex = capturedSounds.findIndex(value => value.actor?.equals(event.actor) && value.channel === channel && value.resource === soundResources.get(event.path));
                    const captured = captureIndex < 0 ? undefined : capturedSounds.splice(captureIndex, 1)[0];
                    const origin = captured?.origin;
                    const sourceEntity = record.sourceEntity ?? simulation.actors.sourceOf(event.actor)?.slot;
                    if (origin === undefined || sourceEntity === undefined) {
                        options.print(`Q1 sound has no emission-time origin: ${event.path}\n`);
                        break;
                    }
                    send({ kind: 'sound', entity: sourceEntity, channel, index: sound, volume: Math.trunc(event.volume * 255), attenuation: event.attenuation, origin });
                    break;
                }
                case 'ambient': break;
                case 'message':
                    send({ kind: event.center ? 'center-print' : 'print', text: event.text }, true, event.player);
                    break;
                case 'lightstyle':
                    send({ kind: 'light-style', index: event.style, value: event.pattern }, true);
                    break;
                case 'particles': {
                    const clamp = (value: number): number => Math.max(-128, Math.min(127, Math.trunc(value * 16))) / 16;
                    send({ kind: 'particle', origin: event.origin, direction: { x: clamp(event.direction.x), y: clamp(event.direction.y), z: clamp(event.direction.z) }, count: event.count, color: event.color });
                    break;
                }
                case 'colored-explosion':
                    send({ kind: 'temporary-entity', effect: { kind: 'explosion-colors', type: 12, origin: event.origin, colorStart: event.colorStart, colorLength: event.colorLength } });
                    break;
                case 'beam':
                    send({ kind: 'temporary-entity', effect: { kind: 'beam', type: event.style === 'lightning1' ? 5 : event.style === 'lightning2' ? 6 : event.style === 'lightning3' ? 9 : 13, entity: record.sourceEntity ?? number(event.actor), start: event.start, end: event.end } });
                    break;
                case 'effect': {
                    if (event.effect === 'muzzleflash') {
                        if (event.actor !== null)
                            muzzleFlashes.add(event.actor);
                        break;
                    }
                    if (event.effect === 'pickup') {
                        if (event.actor !== null)
                            send({ kind: 'stufftext', text: 'bf\n' }, true, event.actor);
                        break;
                    }
                    if (event.effect === 'blood') {
                        send({ kind: 'particle', origin: event.origin, direction: { x: 0, y: 0, z: 0 }, count: event.amount * 2, color: 73 });
                        break;
                    }
                    if (event.effect === 'meat-spray') {
                        options.print('Q1 meat spray requires a source entity; no temporary-entity substitute emitted\n');
                        break;
                    }
                    const types = { 'gunshot': 2, 'spike': 0, 'superspike': 1, 'explosion': 3, 'teleport': 11, 'lava-splash': 10, 'tar-explosion': 4, 'wizard-spike': 7, 'knight-spike': 8 };
                    send({ kind: 'temporary-entity', effect: { kind: 'point', type: types[event.effect], origin: event.origin, count: 1 } });
                    break;
                }
                case 'teleport-player':
                    send({ kind: 'set-angle', angles: event.angles }, true, event.player);
                    break;
                case 'secret':
                    send({ kind: 'found-secret' }, true);
                    break;
                case 'monster-killed':
                    send({ kind: 'killed-monster' }, true);
                    break;
                case 'monster-total':
                    send({ kind: 'stat', index: 12, value: event.total }, true);
                    break;
                case 'intermission':
                    send({ kind: 'intermission' }, true);
                    break;
                case 'finale':
                    send({ kind: 'finale', text: event.text }, true);
                    break;
                case 'camera':
                    send({ kind: 'set-angle', angles: event.angles }, true, event.player);
                    break;
                case 'weapon':
                case 'powerup':
                case 'server-command':
                case 'achievement': break;
            }
        }
    };
    return {
        protocol: options.protocol, maxClients, mapName: game.mapName,
        supportsSourceWire: () => { const reasons: string[] = []; if (source.composition.selection.program !== 'id1')
            reasons.push('Native NetQuake application item serialization currently binds id1'); if (options.protocol.version !== 15)
            reasons.push('Q1 application network currently binds NetQuake protocol 15'); if (!simulation.recipe.movement.provider.startsWith('q1:') || !simulation.recipe.character.definition.provider.startsWith('q1:') || !simulation.recipe.inventory.provider.startsWith('q1:') || simulation.recipe.weapons.some(value => !value.provider.startsWith('q1:')))
            reasons.push('Mixed composition requires unified serialization'); return reasons.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', reasons }; },
        admit: from => {
            let slot = 0;
            for (; slot < maxClients; slot++)
                if (!clients.has(slot) && !simulation.players().some(actor => simulation.movementPlayer(actor)?.client.slot === slot))
                    break;
            if (slot === maxClients)
                return { kind: 'rejected', reason: 'Server is full' };
            const client = options.session.createClient(slot);
            client.connect(from.kind === 'loopback' ? 'loopback' : 'remote');
            let actor: ActorId | null = null;
            try {
                const admitted = simulation.admitPlayer(client.id);
                actor = admitted.actor;
                const player = { client: client.id, actor, sourceEntity: number(actor) };
                clients.set(slot, player);
                return { kind: 'accepted', player };
            }
            catch (error) {
                if (actor !== null)
                    simulation.disconnectPlayer(actor);
                options.session.closeClient(client.id);
                throw error;
            }
        },
        carriedPlayer: client => { const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client)); if (actor === undefined)
            throw new Error('Carried Q1 player has not been admitted'); const player = { client, actor, sourceEntity: number(actor) }; clients.set(client.slot, player); return player; },
        disconnect: player => { simulation.disconnectPlayer(player.actor); options.session.closeClient(player.client); clients.delete(player.client.slot); },
        gameState: player => { const states = entities(); clientData(player); return { info: { kind: 'server-info', protocol: options.protocol, maxClients, gameType: game.options.deathmatch === 0 ? 0 : 1, level: game.world?.message || game.mapName, models: [...models.keys()], sounds: [...sounds.keys()] }, baselines: new Map(states.map(state => [state.number, state])), signon: ambientSignon() }; },
        spawn: player => [{ kind: 'time', seconds: game.time }, ...Array.from({ length: 64 }, (_, index) => ({ kind: 'light-style', index, value: simulation.events.lightStyle(index) } satisfies Q1ApplicationMessage)), ...[...source.composition.clients.records.values()].flatMap(client => [{ kind: 'name', slot: client.slot, value: client.name }, { kind: 'colors', slot: client.slot, value: client.shirt * 16 + client.pants }, { kind: 'frags', slot: client.slot, value: client.frags }] satisfies Q1ApplicationMessage[]), { kind: 'stat', index: 11, value: game.totalSecrets }, { kind: 'stat', index: 12, value: game.totalMonsters }, { kind: 'stat', index: 13, value: game.foundSecrets }, { kind: 'stat', index: 14, value: game.killedMonsters }, { kind: 'set-angle', angles: simulation.playerView(player.actor).angles }, clientData(player)],
        frame: (player, _output) => { const origin = simulation.playerView(player.actor).origin, cluster = simulation.scene.leafCluster(simulation.scene.pointLeaf(origin)); return { seconds: game.time, messages: [clientData(player)], reliable: routed.filter(event => event.reliable && (event.recipient === null || event.recipient.equals(player.actor))).map(event => event.message), datagram: routed.filter(event => !event.reliable && (event.recipient === null || event.recipient.equals(player.actor))).map(event => event.message), entities: entities().filter(state => state.number === player.sourceEntity || simulation.scene.clusterVisible(cluster, simulation.scene.leafCluster(simulation.scene.pointLeaf(state.origin)), 'pvs')) }; },
        input: (player, command, sequence) => ({ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command }),
        command: (player, name, args) => { if (name === 'name') {
            const values = new Map(source.composition.clients.require(player.actor).userinfo);
            values.set('name', (args[0] ?? 'unconnected').slice(0, 15));
            source.composition.userinfo(player.actor, values);
        }
        else if (name === 'color')
            source.composition.clients.colors(player.actor, Number(args[0] ?? 0), Number(args[1] ?? args[0] ?? 0));
        else if (name === 'use' || name === 'weapnext' || name === 'weapprev')
            simulation.playerCommand(player.actor, name, args);
        else
            options.print(`Unsupported native Q1 client command: ${name}`); },
        observe,
        print: options.print
    };
}
