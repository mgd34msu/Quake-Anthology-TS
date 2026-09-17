/* API 3 guest projection through the shared native Q2 server channel. GPL-2.0-or-later. */
import type { Vec3 } from '../../../contracts/math.ts';
import type { BspChild } from '../../../contracts/scene.ts';
import { Q2CvarFlag } from '../../../core/cvars/index.ts';
import { expandCommandMacros, tokenizeCommand } from '../../../core/commands/text.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { addressKey } from '../../../network/common/endpoint.ts';
import { fromQ2Entity, fromQ2Player, toQ2Command } from '../../../network/q2/adapters.ts';
import { q2Userinfo } from '../../../content/q2/base/player/index.ts';
import { createQ2ApplicationDownloads } from '../network/q2-downloads.ts';
import { q2GameCallback } from '../network/types.ts';
import type { Q2ApplicationAdmission, Q2ApplicationPlayer, Q2ApplicationServerHost } from '../network/types.ts';
import type { Q2ApplicationServerBindingOptions } from './network.ts';
import type { ClassicGuestWorld } from './classic-guest-world.ts';
import type { ClassicGuestMessage } from './classic-guest-services.ts';

export async function createClassicQ2ApplicationServerHost(options: Q2ApplicationServerBindingOptions & { readonly world: ClassicGuestWorld }): Promise<Q2ApplicationServerHost> {
    if (options.protocol.kind !== 'q2-classic' || options.content.world.kind !== 'q2-bsp') throw new Error('Classic guest server requires native Q2 geometry and protocol 34');
    const { simulation, world } = options, scene = simulation.scene, geometry = options.content.world;
    const cvars = world.services.options.cvars, maxClients = world.services.options.maxClients, numeric = world.services.options.numeric;
    const map = world.services.options.mapPath.replace(/^maps\//, '').replace(/\.bsp$/, '');
    const downloads = createQ2ApplicationDownloads(await options.content.forContent(options.content.recipe.map.entities.content), cvars, 'classic');
    cvars.register('hostname', 'noname', Q2CvarFlag.ServerInfo | Q2CvarFlag.Archive);
    for (const [name, value] of [['protocol', '34'], ['mapname', map]] satisfies readonly (readonly [string, string])[]) { cvars.register(name, value, Q2CvarFlag.ServerInfo | Q2CvarFlag.NoSet); cvars.set(name, value, true); }
    world.services.setConfigstring(31, String(blockChecksum(await options.content.mounts.read(options.content.recipe.map.geometry))));
    world.services.setConfigstring(30, String(maxClients));
    world.services.setConfigstring(29, cvars.variableString('sv_airaccelerate'));
    let messages: readonly ClassicGuestMessage[] = [];
    const players = new Map<number, Q2ApplicationPlayer>();
    const requirePlayer = (player: Q2ApplicationPlayer): void => {
        const current = players.get(player.client.slot);
        if (current === undefined || !current.client.equals(player.client) || !current.actor.equals(player.actor)) throw new Error('Q2 guest network player is retired');
    };
    const nativeState = (player: Q2ApplicationPlayer) => { requirePlayer(player); return world.playerState(player.sourceEntity); };
    const viewOrigin = (player: Q2ApplicationPlayer): Vec3 => {
        const state = nativeState(player);
        return { x: numeric.add(numeric.divide(state.movement.originEighths[0], 8), state.viewOffset.x), y: numeric.add(numeric.divide(state.movement.originEighths[1], 8), state.viewOffset.y), z: numeric.add(numeric.divide(state.movement.originEighths[2], 8), state.viewOffset.z) };
    };
    const headnodeVisible = (headnode: number, clusters: readonly number[]): boolean => {
        const pending: BspChild[] = [headnode < 0 ? { kind: 'leaf', index: -1 - headnode } : { kind: 'node', index: headnode }];
        while (pending.length !== 0) {
            const child = pending.pop(); if (child === undefined) break;
            if (child.kind === 'leaf') { if (clusters.some(cluster => scene.clusterVisible(cluster, scene.leafCluster(child.index), 'pvs'))) return true; }
            else { const node = geometry.nodes[child.index]; if (node === undefined) throw new Error('Guest visibility headnode is outside the shared BSP'); pending.push(...node.children); }
        }
        return false;
    };
    const command = (player: Q2ApplicationPlayer, text: string): void => q2GameCallback(() => {
        requirePlayer(player); const tokens = tokenizeCommand(text, 'q2-classic');
        if (tokens.argv.length !== 0) world.command(player.sourceEntity, tokens.argv, tokens.argsText);
    });
    return {
        protocol: options.protocol, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients, downloads,
        ...(options.administration === undefined ? {} : { administration: options.administration }), ...(options.masters === undefined ? {} : { masters: options.masters }),
        supportsSourceWire: () => {
            const reasons: string[] = [];
            if (!simulation.recipe.movement.provider.startsWith('q2:')) reasons.push('Guest native wire requires Q2 movement');
            if (!simulation.recipe.character.definition.provider.startsWith('q2:')) reasons.push('Guest native wire requires Q2 character state');
            return reasons.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', reasons };
        },
        discovery: {
            status: () => ({ serverInfo: cvars.infoString(Q2CvarFlag.ServerInfo), players: world.clients.map(client => ({
                score: world.playerState(client.slot).stats[14] ?? 0, ping: world.playerPing(client.slot), name: q2Userinfo(client.userinfo).get('name') ?? '',
            })) }),
            info: () => ({ name: cvars.variableString('hostname'), map, players: world.clients.length, maxPlayers: maxClients }),
        },
        admit: (from, request) => q2GameCallback<Q2ApplicationAdmission>(() => {
            let slot = 0; const occupied = new Set(world.clients.map(client => client.slot - 1));
            while (slot < maxClients && occupied.has(slot)) slot++;
            if (slot === maxClients) return { kind: 'rejected', reason: 'Server is full' };
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
        carriedPlayer: client => {
            const actor = simulation.q2NativePlayers().find(player => player.client.equals(client))?.actor;
            if (actor === undefined) throw new Error('Q2 guest carried client is not owned by this world');
            const player = { client, actor, sourceEntity: client.slot + 1 }; players.set(client.slot, player); return player;
        },
        begin: player => q2GameCallback(() => { requirePlayer(player); world.begin(player.sourceEntity); }),
        disconnect: player => q2GameCallback(() => {
            requirePlayer(player);
            const failures: unknown[] = [];
            try { if (!world.isRetired) simulation.disconnectPlayer(player.actor); } catch (error) { failures.push(error); }
            try { players.delete(player.client.slot); } catch (error) { failures.push(error); }
            try { options.session.closeClient(player.client); } catch (error) { failures.push(error); }
            if (failures.length !== 0) throw new AggregateError(failures, 'Q2 guest client cleanup failed');
        }),
        gameState: player => {
            requirePlayer(player); const configs = world.configstrings();
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
                if (info.clusters === null ? !headnodeVisible(info.headnode, clusters) : !info.clusters.some(target => clusters.some(from => scene.clusterVisible(from, target, 'pvs')))) return false;
                const dx = numeric.subtract(origin.x, state.origin.x), dy = numeric.subtract(origin.y, state.origin.y), dz = numeric.subtract(origin.z, state.origin.z);
                const distance = numeric.squareRoot(numeric.add(numeric.add(numeric.multiply(dx, dx), numeric.multiply(dy, dy)), numeric.multiply(dz, dz)));
                return state.modelIndexes[0] !== 0 || distance <= 400;
            }).map(state => { const wire = fromQ2Entity(state); if (world.entityInfo(state.number).ownerSlot === player.sourceEntity) wire.solid = 0; return wire; });
            return { serverFrame: output.snapshot.frame.frame, deltaFrame: -1, suppressedCount: 0, areaBits: scene.areaBits(area), player: fromQ2Player(nativeState(player)), entities };
        },
        observe: () => {
            const air = cvars.variableString('sv_airaccelerate');
            if (world.configstrings().get(29) !== air) world.services.setConfigstring(29, air);
            messages = world.rawMessages();
        },
        rawMessages: player => {
            requirePlayer(player);
            return messages.filter(message => {
                const audience = message.audience;
                if (audience.kind === 'unicast') return audience.slot === player.sourceEntity;
                if (audience.scope === 'all') return true;
                const entity = world.entityState(player.sourceEntity);
                const from = scene.pointLeaf(audience.origin), to = scene.pointLeaf(entity.origin);
                return scene.areasConnected(scene.leafArea(from), scene.leafArea(to)) && scene.clusterVisible(scene.leafCluster(from), scene.leafCluster(to), audience.scope);
            });
        },
        events: () => [],
        input: (player, wire) => q2GameCallback(() => { requirePlayer(player); world.think(player.sourceEntity, toQ2Command(wire)); return null; }),
        expandClientCommand: text => expandCommandMacros(text, name => cvars.variableString(name), options.print),
        command: (player, name, args) => command(player, [name, ...args].join(' ')), commandText: command,
        userinfo: (player, value) => q2GameCallback(() => { requirePlayer(player); world.userinfo(player.sourceEntity, value); }), print: options.print,
    };
}
