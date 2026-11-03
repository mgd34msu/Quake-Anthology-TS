// SPDX-License-Identifier: GPL-2.0-or-later
/* Pieces of the native Q2 guest server host that do not depend on the game edition (API 3 or API 2023). */
import type { Vec3 } from '../../../contracts/math.ts';
import type { BspChild } from '../../../contracts/scene.ts';
import { Q2CvarFlag } from '../../../core/cvars/index.ts';
import type { CvarRegistry } from '../../../core/cvars/index.ts';
import { tokenizeCommand } from '../../../core/commands/text.ts';
import { q2Userinfo } from '../../../content/q2/base/player/index.ts';
import { q2GameCallback } from '../network/types.ts';
import type { Q2ApplicationPlayer, Q2ApplicationServerHost } from '../network/types.ts';
import type { Q2ApplicationServerBindingOptions } from './network.ts';
import type { SharedSceneQueries } from '../../../world/collision/index.ts';

/** The world surface both native Q2 guest worlds expose to their server host. */
export interface Q2GuestWorldSurface {
    readonly clients: readonly { readonly slot: number; readonly userinfo: string }[];
    readonly isRetired: boolean;
    playerState(slot: number): { readonly stats: ArrayLike<number> };
    playerPing(slot: number): number;
    entityState(slot: number): { readonly origin: Vec3 };
    command(slot: number, argv: readonly string[], argsText: string): void;
    begin(slot: number): void;
    userinfo(slot: number, value: string): void;
}
export type Q2GuestAudience = { readonly kind: 'unicast'; readonly slot: number } | { readonly kind: 'multicast'; readonly origin: Vec3; readonly scope: 'all' | 'phs' | 'pvs' };

export interface Q2GuestHostCoreOptions {
    readonly options: Q2ApplicationServerBindingOptions;
    readonly world: Q2GuestWorldSurface;
    readonly cvars: CvarRegistry;
    readonly scene: SharedSceneQueries;
    readonly geometry: { readonly nodes: readonly { readonly children: readonly [BspChild, BspChild] | readonly BspChild[] }[] };
    readonly maxClients: number;
    readonly map: string;
    readonly dialect: 'q2-classic' | 'q2-rerelease';
}

/** Player table, visibility and message-audience rules, slot allocation and the lifecycle calls common to both guest editions. */
export function createQ2GuestHostCore(core: Q2GuestHostCoreOptions) {
    const { options, world, cvars, scene, geometry, maxClients, map } = core;
    const { simulation } = options;
    const players = new Map<number, Q2ApplicationPlayer>();
    const requirePlayer = (player: Q2ApplicationPlayer): void => {
        const current = players.get(player.client.slot);
        if (current === undefined || !current.client.equals(player.client) || !current.actor.equals(player.actor)) throw new Error('Q2 guest network player is retired');
    };
    const headnodeVisible = (headnode: number, clusters: readonly number[], kind: 'pvs' | 'phs'): boolean => {
        const pending: BspChild[] = [headnode < 0 ? { kind: 'leaf', index: -1 - headnode } : { kind: 'node', index: headnode }];
        while (pending.length !== 0) {
            const child = pending.pop(); if (child === undefined) break;
            if (child.kind === 'leaf') { if (clusters.some(cluster => scene.clusterVisible(cluster, scene.leafCluster(child.index), kind))) return true; }
            else { const node = geometry.nodes[child.index]; if (node === undefined) throw new Error('Guest visibility headnode is outside the shared BSP'); pending.push(...node.children); }
        }
        return false;
    };
    const command = (player: Q2ApplicationPlayer, text: string): void => q2GameCallback(() => {
        requirePlayer(player); const tokens = tokenizeCommand(text, core.dialect);
        if (tokens.argv.length !== 0) world.command(player.sourceEntity, tokens.argv, tokens.argsText);
    });
    /** Whether a guest message reaches this player: unicast by slot, multicast by area connection and the PVS/PHS rule. */
    const audienceIncludes = (player: Q2ApplicationPlayer, audience: Q2GuestAudience): boolean => {
        requirePlayer(player);
        if (audience.kind === 'unicast') return audience.slot === player.sourceEntity;
        if (audience.scope === 'all') return true;
        const entity = world.entityState(player.sourceEntity);
        const from = scene.pointLeaf(audience.origin), to = scene.pointLeaf(entity.origin);
        return scene.areasConnected(scene.leafArea(from), scene.leafArea(to)) && scene.clusterVisible(scene.leafCluster(from), scene.leafCluster(to), audience.scope);
    };
    const freeSlot = (): number | null => {
        const occupied = new Set(world.clients.map(client => client.slot - 1));
        let slot = 0; while (slot < maxClients && occupied.has(slot)) slot++;
        return slot === maxClients ? null : slot;
    };
    const registerServerVariables = (protocol: string): void => {
        cvars.register('hostname', 'noname', Q2CvarFlag.ServerInfo | Q2CvarFlag.Archive);
        for (const [name, value] of [['protocol', protocol], ['mapname', map]] satisfies readonly (readonly [string, string])[]) { cvars.register(name, value, Q2CvarFlag.ServerInfo | Q2CvarFlag.NoSet); cvars.set(name, value, true); }
    };
    /** Disconnect runs every cleanup step and reports all failures together; `extra` is an edition-specific step. */
    const disconnect = (player: Q2ApplicationPlayer, extra?: () => void): void => q2GameCallback(() => {
        requirePlayer(player);
        const failures: unknown[] = [];
        try { if (!world.isRetired) simulation.disconnectPlayer(player.actor); } catch (error) { failures.push(error); }
        if (extra !== undefined) try { extra(); } catch (error) { failures.push(error); }
        try { players.delete(player.client.slot); } catch (error) { failures.push(error); }
        try { options.session.closeClient(player.client); } catch (error) { failures.push(error); }
        if (failures.length !== 0) throw new AggregateError(failures, 'Q2 guest client cleanup failed');
    });
    const shared: Pick<Q2ApplicationServerHost, 'supportsSourceWire' | 'discovery' | 'carriedPlayer' | 'begin' | 'userinfo' | 'command' | 'commandText'> = {
        supportsSourceWire: () => {
            const reasons: string[] = [];
            if (options.content.world.kind !== 'q2-bsp') reasons.push('Original Quake II peers require Quake II BSP geometry; use local or unified presentation for foreign maps');
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
        carriedPlayer: client => {
            const actor = simulation.q2NativePlayers().find(player => player.client.equals(client))?.actor;
            if (actor === undefined) throw new Error('Q2 guest carried client is not owned by this world');
            const player = { client, actor, sourceEntity: client.slot + 1 }; players.set(client.slot, player); return player;
        },
        begin: player => q2GameCallback(() => { requirePlayer(player); world.begin(player.sourceEntity); simulation.notifyClientEvent('admitted', player.actor); }),
        userinfo: (player, value) => q2GameCallback(() => { requirePlayer(player); world.userinfo(player.sourceEntity, value); simulation.notifyClientEvent('userinfo', player.actor); }),
        command: (player, name, args) => command(player, [name, ...args].join(' ')),
        commandText: command,
    };
    return { players, requirePlayer, headnodeVisible, audienceIncludes, freeSlot, registerServerVariables, disconnect, shared };
}
