/* API 3 guest projection through the shared native Q2 server channel. GPL-2.0-or-later. */
import type { Vec3 } from '../../../contracts/math.ts';
import { expandCommandMacros } from '../../../core/commands/text.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { addressKey } from '../../../network/common/endpoint.ts';
import { fromQ2Entity, fromQ2Player, toQ2Command } from '../../../network/q2/adapters.ts';
import { q2Userinfo } from '../../../content/q2/base/player/index.ts';
import { createQ2ApplicationDownloads } from '../network/q2-downloads.ts';
import { q2GameCallback } from '../network/types.ts';
import type { Q2ApplicationAdmission, Q2ApplicationPlayer, Q2ApplicationServerHost } from '../network/types.ts';
import type { Q2ApplicationServerBindingOptions } from './network.ts';
import { createQ2GuestHostCore } from './network-q2-guest-core.ts';
import type { ClassicGuestWorld } from './classic-guest-world.ts';
import type { ClassicGuestMessage } from './classic-guest-services.ts';

export async function createClassicQ2ApplicationServerHost(options: Q2ApplicationServerBindingOptions & { readonly world: ClassicGuestWorld }): Promise<Q2ApplicationServerHost> {
    if (options.protocol.kind !== 'q2-classic') throw new Error('Classic guest server requires protocol 34');
    const { simulation, world } = options, scene = simulation.scene, geometry = options.content.world;
    const cvars = world.services.options.cvars, maxClients = world.services.options.maxClients, numeric = world.services.options.numeric;
    const map = world.services.options.mapPath.replace(/^maps\//, '').replace(/\.bsp$/, '');
    const downloads = createQ2ApplicationDownloads(await options.content.forContent(options.content.recipe.map.entities.content), cvars, 'classic');
    const core = createQ2GuestHostCore({ options, world, cvars, scene, geometry, maxClients, map, dialect: 'q2-classic' });
    const { players, requirePlayer } = core;
    core.registerServerVariables('34');
    world.services.setConfigstring(31, String(blockChecksum(await options.content.mounts.read(options.content.recipe.map.geometry))));
    world.services.setConfigstring(30, String(maxClients));
    world.services.setConfigstring(29, cvars.variableString('sv_airaccelerate'));
    let messages: readonly ClassicGuestMessage[] = [], localMessages: readonly ClassicGuestMessage[] = [];
    const progressedMessages: ClassicGuestMessage[] = [];
    const localRecipients = new Set<Q2ApplicationPlayer["client"]>();
    const nativeState = (player: Q2ApplicationPlayer) => { requirePlayer(player); return world.playerState(player.sourceEntity); };
    const viewOrigin = (player: Q2ApplicationPlayer): Vec3 => {
        const state = nativeState(player);
        return { x: numeric.add(numeric.divide(state.movement.originEighths[0], 8), state.viewOffset.x), y: numeric.add(numeric.divide(state.movement.originEighths[1], 8), state.viewOffset.y), z: numeric.add(numeric.divide(state.movement.originEighths[2], 8), state.viewOffset.z) };
    };
    const playerMessages = (player: Q2ApplicationPlayer, incoming: readonly ClassicGuestMessage[]) => {
        requirePlayer(player);
        return incoming.filter(message => core.audienceIncludes(player, message.audience));
    };
    return {
        ...(options.rejects === undefined ? {} : { rejects: options.rejects }),
        protocol: options.protocol, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients, downloads,
        ...(options.administration === undefined ? {} : { administration: options.administration }), ...(options.masters === undefined ? {} : { masters: options.masters }),
        ...core.shared,
        admit: (from, request) => q2GameCallback<Q2ApplicationAdmission>(() => {
            const slot = core.freeSlot();
            if (slot === null) return { kind: 'rejected', reason: 'Server is full' };
            const client = options.session.createClient(slot); client.connect('remote');
            const info = new Map(q2Userinfo(request.userinfo)); info.set('ip', addressKey(from));
            let connected = false;
            try {
                const result = world.connect(slot + 1, [...info].map(([key, value]) => `\\${key}\\${value}`).join(''));
                if (!result.allowed) { options.session.closeClient(client.id); return { kind: 'rejected', reason: q2Userinfo(result.userinfo).get('rejmsg') ?? 'Connection refused' }; }
                connected = true;
                const actor = simulation.registerQ2NativeClient(client.id), player = { client: client.id, actor: actor.id, sourceEntity: slot + 1 };
                players.set(slot, player); return { kind: 'accepted', player };
            } catch (error) {
                try { if (connected) world.disconnect(slot + 1); }
                catch (cleanup) { throw new AggregateError([error, cleanup], 'Q2 guest connect cleanup failed'); }
                finally { options.session.closeClient(client.id); }
                throw error;
            }
        }),
        disconnect: player => core.disconnect(player),
        gameState: player => {
            requirePlayer(player); const configs = new Map(world.configstrings());
            return { data: { servercount: 1, attractloop: false, gamedir: options.content.catalog.product(simulation.recipe.map.entities.content).expectation.contentDirectory.split('/').at(-1) ?? 'baseq2', clientnum: player.sourceEntity - 1, levelname: configs.get(0) ?? map, serverState: 2, serverFps: 10 }, configStrings: configs,
                baselines: new Map(world.entityStates().filter(state => state.modelIndexes.some(index => index !== 0) || state.sound !== 0 || state.effects !== 0).map(state => [state.number, fromQ2Entity(state)])) };
        },
        frame: (player, output) => {
            const origin = viewOrigin(player), leaf = scene.pointLeaf(origin), area = scene.leafArea(leaf), cluster = scene.leafCluster(leaf);
            const clusters = [...new Set(scene.boxLeaves({ min: { x: numeric.subtract(origin.x, 8), y: numeric.subtract(origin.y, 8), z: numeric.subtract(origin.z, 8) }, max: { x: numeric.add(origin.x, 8), y: numeric.add(origin.y, 8), z: numeric.add(origin.z, 8) } }, 64).leaves.map(index => scene.leafCluster(index)))];
            const entities = world.entityStates().filter(state => {
                if (!state.modelIndexes.some(index => index !== 0) && state.effects === 0 && state.sound === 0 && state.event === 0) return false;
                if (state.number === player.sourceEntity) return true;
                const info = world.entityInfo(state.number);
                if (!scene.areasConnected(area, info.areas[0]) && (info.areas[1] === 0 || !scene.areasConnected(area, info.areas[1]))) return false;
                if ((state.renderEffects & 128) !== 0) return scene.clusterVisible(cluster, info.firstCluster, 'phs');
                if (info.clusters === null ? !core.headnodeVisible(info.headnode, clusters, 'pvs') : !info.clusters.some(target => clusters.some(from => scene.clusterVisible(from, target, 'pvs')))) return false;
                const dx = numeric.subtract(origin.x, state.origin.x), dy = numeric.subtract(origin.y, state.origin.y), dz = numeric.subtract(origin.z, state.origin.z);
                const distance = numeric.squareRoot(numeric.add(numeric.add(numeric.multiply(dx, dx), numeric.multiply(dy, dy)), numeric.multiply(dz, dz)));
                return state.modelIndexes[0] !== 0 || distance <= 400;
            }).map(state => { const wire = fromQ2Entity(state); if (world.entityInfo(state.number).ownerSlot === player.sourceEntity) wire.solid = 0; return wire; });
            return { serverFrame: output.snapshot.frame.frame, deltaFrame: -1, suppressedCount: 0, areaBits: scene.areaBits(area), player: fromQ2Player(nativeState(player)), entities };
        },
        observe: () => {
            const air = cvars.variableString('sv_airaccelerate');
            if (world.configstrings().get(29) !== air) world.services.setConfigstring(29, air);
            localRecipients.clear(); localMessages = world.rawMessages();
            messages = [...progressedMessages, ...localMessages]; progressedMessages.length = 0;
        },
        observeProgress: () => { localRecipients.clear(); localMessages = world.rawMessages(); progressedMessages.push(...localMessages); },
        localMessages: player => {
            requirePlayer(player);
            if (localRecipients.has(player.client)) return [];
            localRecipients.add(player.client); return playerMessages(player, localMessages);
        },
        rawMessages: player => playerMessages(player, messages),
        events: () => [],
        input: (player, wire, sequence) => q2GameCallback(() => { requirePlayer(player); const command = toQ2Command(wire);
            simulation.observeClientCommand({ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command });
            world.think(player.sourceEntity, command); return null; }),
        expandClientCommand: text => expandCommandMacros(text, name => cvars.variableString(name), options.print),
        print: options.print,
    };
}
