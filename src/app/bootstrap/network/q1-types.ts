import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { Q1ProtocolIdentity, Q1ExtendedEntityState, Q1UserCommand } from '../../../contracts/protocol.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import type { WireAdmission } from '../../../network/common/session.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
export interface Q1ApplicationPlayer {
    readonly client: ClientId;
    readonly actor: ActorId;
    readonly sourceEntity: number;
}
export type Q1ApplicationMessage = Exclude<NetQuakeMessage, {
    kind: 'entity';
}>;
export interface Q1ApplicationGameState {
    readonly info: Extract<NetQuakeMessage, {
        kind: 'server-info';
    }>;
    readonly baselines: ReadonlyMap<number, Q1ExtendedEntityState>;
    readonly signon: readonly Q1ApplicationMessage[];
}
export interface Q1ApplicationServerHost {
    readonly protocol: Q1ProtocolIdentity;
    readonly maxClients: number;
    readonly mapName: string;
    supportsSourceWire(): WireAdmission;
    admit(from: NetworkAddress): {
        readonly kind: 'accepted';
        readonly player: Q1ApplicationPlayer;
    } | {
        readonly kind: 'rejected';
        readonly reason: string;
    };
    carriedPlayer(client: ClientId): Q1ApplicationPlayer;
    disconnect(player: Q1ApplicationPlayer, reason: string): void;
    gameState(player: Q1ApplicationPlayer): Q1ApplicationGameState;
    spawn(player: Q1ApplicationPlayer): readonly Q1ApplicationMessage[];
    frame(player: Q1ApplicationPlayer, output: SimulationOutput): {
        readonly seconds: number;
        readonly messages: readonly Q1ApplicationMessage[];
        readonly reliable: readonly Q1ApplicationMessage[];
        readonly datagram: readonly Q1ApplicationMessage[];
        readonly entities: readonly Q1ExtendedEntityState[];
    };
    input(player: Q1ApplicationPlayer, command: Q1UserCommand, sequence: number): ActorCommand;
    command(player: Q1ApplicationPlayer, name: string, args: readonly string[]): void;
    observe(output: SimulationOutput, events: readonly SimulationPresentationEvent[]): void;
    print(text: string): void;
}
export interface Q1ServerNetworkOptions<TAddress extends NetworkAddress> {
    readonly transport: DatagramTransport<TAddress>;
    readonly host: Q1ApplicationServerHost;
    readonly timeoutMilliseconds?: number;
}
