import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { Q2ProtocolIdentity } from '../../../contracts/protocol.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { WireAdmission, WireSelection } from '../../../network/common/session.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import type { EntityStateT, Q2ConnectRequest, Q2ServerMessageOptions, Q2ServerRecord, Q2ServerWriteEvent, Q2WireFrame, ServerDataParamsT, UsercmdT } from '../../../network/q2/index.ts';
import type { SimulationPresentationAccess, SimulationPresentationEvent } from '../simulation/types.ts';
import type { Q2ApplicationDownloads, Q2ApplicationClientDownloads } from './q2-downloads.ts';
import type { Q2ConnectionlessHost } from '../../../network/q2/connectionless.ts';
/** Input/render consumers never acquire authority to step a remote server. */
export type RemotePresentationAccess = Pick<SimulationPresentationAccess, 'worldText' | 'playerUi' | 'characterViews' | 'presentations' | 'registerResource' | 'playerView' | 'playerCommand'>;
export type ApplicationNetworkPhase = 'challenging' | 'connecting' | 'loading' | 'active' | 'closed' | 'rejected';
export interface ApplicationNetwork {
    readonly role: 'server' | 'client';
    readonly phase: ApplicationNetworkPhase;
    readonly wire: WireSelection;
    /** Called before the application's only authoritative simulation step. */
    poll(nowMilliseconds: number): Promise<readonly ActorCommand[]>;
    /** A remote client sends input; it does not apply input to a second server. */
    submit(commands: readonly ActorCommand[], nowMilliseconds: number): void;
    /** Called after that simulation step and after source presentation events are drained. */
    publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], nowMilliseconds: number): void;
    close(): void;
}
export interface ApplicationNetworkPlayer {
    readonly client: ClientId;
    readonly actor: ActorId;
    /** Supplied by the source entity registry, never derived from ActorId.slot. */
    readonly sourceEntity: number;
}
export type Q2ApplicationPlayer = ApplicationNetworkPlayer;
export type Q2ApplicationAdmission = {
    readonly kind: 'accepted';
    readonly player: Q2ApplicationPlayer;
} | {
    readonly kind: 'rejected';
    readonly reason: string;
};
export interface Q2ApplicationGameState {
    readonly data: ServerDataParamsT;
    readonly configStrings: ReadonlyMap<number, string>;
    readonly baselines: ReadonlyMap<number, EntityStateT>;
}
export type Q2ApplicationServerEvent = Q2ServerWriteEvent & {
    readonly reliable?: boolean;
};
export interface Q2ApplicationServerHost {
    readonly discovery?: Pick<Q2ConnectionlessHost, 'status' | 'info'>;
    readonly downloads: Q2ApplicationDownloads;
    readonly protocol: Q2ProtocolIdentity;
    readonly messageOptions: Q2ServerMessageOptions;
    readonly maxClients: number;
    /** Unified composition negotiation remains separate from this native source wire binding. */
    supportsSourceWire(): WireAdmission;
    observe(output: SimulationOutput, events: readonly SimulationPresentationEvent[]): void;
    admit(from: NetworkAddress, request: Q2ConnectRequest): Q2ApplicationAdmission;
    disconnect(player: Q2ApplicationPlayer, reason: string): void;
    /** Resolve a carried client after the application's existing travel owner admits the new actor. */
    carriedPlayer(client: ClientId): Q2ApplicationPlayer;
    gameState(player: Q2ApplicationPlayer): Q2ApplicationGameState;
    frame(player: Q2ApplicationPlayer, output: SimulationOutput): Q2WireFrame;
    events(player: Q2ApplicationPlayer, output: SimulationOutput, events: readonly SimulationPresentationEvent[]): readonly Q2ApplicationServerEvent[];
    input(player: Q2ApplicationPlayer, command: UsercmdT, sequence: number): ActorCommand;
    command(player: Q2ApplicationPlayer, name: string, arguments_: readonly string[]): void;
    userinfo(player: Q2ApplicationPlayer, value: string): void;
    print(text: string): void;
}
export interface Q2ApplicationClientHost {
    serverData?(data: Q2ApplicationGameState["data"], assertCurrent: () => void): Promise<void>;
    readonly downloads?: Q2ApplicationClientDownloads;
    readonly protocol: Q2ProtocolIdentity;
    readonly messageOptions: Q2ServerMessageOptions;
    readonly userinfo: () => string;
    /** Packet command history uses channel sequence/acknowledgement, independently of serverFrame. */
    readonly prediction?: {
        sent(sequence: number, command: UsercmdT, nowMilliseconds: number): void;
        acknowledged(sequence: number, nowMilliseconds: number): void;
    };
    /** Resolve map/model/sound references using this application's mounted content. */
    gameState(state: Q2ApplicationGameState): Promise<void>;
    /** Publish decoded state to a read-only presentation owner and EngineSession.publish. */
    frame(frame: Q2WireFrame, records: readonly Q2ServerRecord[], nowMilliseconds: number): void;
    records(records: readonly Q2ServerRecord[]): void;
    command(command: ActorCommand): UsercmdT;
    disconnected(reason: string): void;
    print(text: string): void;
}
export interface Q2ServerNetworkOptions<TAddress extends NetworkAddress> {
    readonly transport: DatagramTransport<TAddress>;
    readonly host: Q2ApplicationServerHost;
    readonly random: () => number;
    readonly timeoutMilliseconds?: number;
}
export interface Q2ClientNetworkOptions<TAddress extends NetworkAddress> {
    readonly transport: DatagramTransport<TAddress>;
    readonly remote: TAddress;
    readonly host: Q2ApplicationClientHost;
    readonly qport: number;
    readonly timeoutMilliseconds?: number;
}
