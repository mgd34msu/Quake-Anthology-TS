import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { QwUserCommand } from '../../../contracts/protocol.ts';
import type { SimulationOutput } from '../../../contracts/session.ts';
import type { IpAddress } from '../../../network/common/endpoint.ts';
import type { WireAdmission } from '../../../network/common/session.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import type { DownloadSource } from '../../../network/services/downloads.ts';
import type { QuakeWorldConnectRequest } from '../../../network/q1/handshake.ts';
import type { QuakeWorldEntity, QuakeWorldMessage } from '../../../network/q1/quakeworld.ts';
import type { QuakeWorldSignonHost } from '../../../network/q1/session.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';

export type QwServerMessage = Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>;
export interface QwApplicationPlayer {
    readonly client: ClientId;
    readonly actor: ActorId;
    readonly slot: number;
}
export interface QwApplicationServerHost {
    readonly maxClients: number;
    readonly paused: boolean;
    supportsSourceWire(): WireAdmission;
    admit(request: QuakeWorldConnectRequest): { readonly kind: 'accepted'; readonly player: QwApplicationPlayer } | { readonly kind: 'rejected'; readonly reason: string };
    carriedPlayer(client: ClientId): QwApplicationPlayer;
    clientInfo(player: QwApplicationPlayer): ReadonlyMap<string, string>;
    commandPhase(player: QwApplicationPlayer, action: () => void, emit: (recipient: QwApplicationPlayer, message: QwServerMessage) => void): void;
    disconnect(player: QwApplicationPlayer, reason: string): void;
    signon(player: QwApplicationPlayer): QuakeWorldSignonHost;
    prepareDownload?(player: QwApplicationPlayer, path: string): Promise<DownloadSource | null>;
    baselines(player: QwApplicationPlayer): readonly QuakeWorldEntity[];
    frame(player: QwApplicationPlayer, output: SimulationOutput): {
        readonly entities: readonly QuakeWorldEntity[];
        readonly messages: readonly QwServerMessage[];
        readonly reliable: readonly QwServerMessage[];
    };
    /** Queue one recovered packet group for the application's existing authoritative step. */
    commandGroup(player: QwApplicationPlayer, commands: readonly QwUserCommand[], sequence: number): void;
    command(player: QwApplicationPlayer, name: string, arguments_: readonly string[]): void;
    observe(output: SimulationOutput, events: readonly SimulationPresentationEvent[]): void;
    print(text: string): void;
}
export interface QwServerNetworkOptions {
    readonly transport: DatagramTransport<IpAddress>;
    readonly host: QwApplicationServerHost;
    readonly random: () => number;
    readonly timeoutMilliseconds?: number;
}
