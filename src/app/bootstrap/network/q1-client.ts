/* NetQuake net_dgrm.c and cl_main.c client progression. GPL-2.0-or-later. */
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { Q1UserCommand } from '../../../contracts/protocol.ts';
import type { IpAddress } from '../../../network/common/endpoint.ts';
import { sameAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { NetQuakeChannel } from '../../../network/q1/channels.ts';
import { WIDE_MAX_MSGLEN } from '../../../network/q1/codecs/wide.ts';
import { NetQuakeConnectClient } from '../../../network/q1/handshake.ts';
import { NetQuakeDecoder, writeNetQuakeMove } from '../../../network/q1/netquake.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';
import { SizeBuf } from '../../../network/q1/message.ts';
import { NetQuakeSignon, writeClientStringCommand } from '../../../network/q1/session.ts';
import type { NetQuakeSeatIdentity } from '../../../network/q1/session.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { DemoRecordingSeed, DemoRecordingSink } from '../demo-recording.ts';
import { NetQuakeRecordingState } from '../../../network/q1/recording.ts';
export interface Q1ApplicationClientHost {
    receive(messages: readonly NetQuakeMessage[], nowMilliseconds: number): Promise<void>;
    command(command: ActorCommand): Q1UserCommand;
    disconnected(reason: string): void;
}
export interface Q1ClientNetworkOptions {
    readonly transport: DatagramTransport<IpAddress>;
    readonly remote: IpAddress;
    readonly host: Q1ApplicationClientHost;
    readonly seat: NetQuakeSeatIdentity;
    readonly timeoutMilliseconds?: number;
}
export class Q1ClientNetwork implements ApplicationNetwork {
    private readonly recordingState = new NetQuakeRecordingState();
    private recordingSink: DemoRecordingSink | null = null;
    private viewAngles: Vec3 = { x: 0, y: 0, z: 0 };
    readonly recording = {
        seed: (): DemoRecordingSeed => {
            if (this.state !== 'active') throw new Error('Recording requires an active NetQuake connection');
            return { identity: { kind: 'q1', protocol: this.decoder.protocol.version, track: -1 },
                packets: this.recordingState.seed(this.decoder.protocol).map(message => ({ kind: 'q1', message, viewAngles: this.viewAngles })) };
        },
        attach: (sink: DemoRecordingSink): (() => void) => {
            if (this.recordingSink !== null || this.state !== 'active') throw new Error('NetQuake recording cannot attach');
            this.recordingSink = sink;
            return () => { if (this.recordingSink === sink) this.recordingSink = null; };
        },
    };
    readonly role = 'client';
    get wire(): ApplicationNetwork['wire'] { return { kind: 'source', protocol: this.decoder.protocol }; }
    private readonly handshake = new NetQuakeConnectClient();
    private readonly channel = new NetQuakeChannel(WIDE_MAX_MSGLEN);
    private readonly decoder = new NetQuakeDecoder();
    private readonly signon: NetQuakeSignon;
    private state: ApplicationNetworkPhase = 'connecting';
    private peer: IpAddress | null = null;
    private lastReceived = 0;
    private movementMessages = 0;
    private readonly reliable: Uint8Array[] = [];
    constructor(readonly options: Q1ClientNetworkOptions) {
        if (options.seat.extensionFlags !== null)
            throw new Error('Native NetQuake does not negotiate private extensions');
        this.signon = new NetQuakeSignon(options.seat);
    }
    get phase(): ApplicationNetworkPhase { return this.state; }
    get serverAddress(): IpAddress | null { return this.peer; }
    command(text: string): void {
        if (this.peer === null)
            throw new Error('NetQuake client is not connected');
        const bytes = new SizeBuf(8000);
        writeClientStringCommand(bytes, text);
        this.reliable.push(bytes.bytes());
    }
    private reject(reason: string): void { this.state = 'rejected'; this.options.host.disconnected(reason); }
    async poll(now: number): Promise<readonly ActorCommand[]> {
        if (this.state === 'closed' || this.state === 'rejected')
            return [];
        if (this.peer === null) {
            const request = this.handshake.next(now);
            if (request !== null)
                this.options.transport.send(this.options.remote, request);
            if (this.handshake.state.kind === 'rejected') {
                this.reject(this.handshake.state.reason);
                return [];
            }
        }
        for (;;) {
            const packet = this.options.transport.poll();
            if (packet === null)
                break;
            if (packet.kind !== 'packet')
                continue;
            if (!sameAddress(packet.from, this.peer ?? this.options.remote))
                continue;
            if (this.peer === null) {
                this.handshake.receive(packet.payload);
                if (this.handshake.state.kind === 'rejected') {
                    this.reject(this.handshake.state.reason);
                    break;
                }
                if (this.handshake.state.kind === 'connected') {
                    this.peer = { ...this.options.remote, port: this.handshake.state.port };
                    this.state = 'loading';
                    this.lastReceived = now;
                }
                continue;
            }
            const received = this.channel.receive(packet.payload, now);
            this.lastReceived = now;
            for (const reply of received.replies)
                this.options.transport.send(this.peer, reply);
            if (received.delivery === null)
                continue;
            const messages = this.decoder.decode(received.delivery.payload);
            this.recordingState.observe(messages);
            for (const message of messages) {
                if (message.kind === 'server-info') {
                    if (message.maxClients < 1 || message.maxClients > 16)
                        throw new Error('Native NetQuake requires 1–16 scoreboard slots');
                    this.signon.stage = 0;
                    this.movementMessages = 0;
                    this.state = 'loading';
                }
            }
            await this.options.host.receive(messages, now);
            for (const message of messages) if (message.kind === 'set-angle') this.viewAngles = message.angles;
            await this.recordingSink?.append({ kind: 'q1', message: received.delivery.payload, viewAngles: this.viewAngles });
            for (const message of messages) {
                if (message.kind === 'signon') {
                    const response = this.signon.receive(message.stage);
                    if (response.length > 0)
                        this.reliable.push(response);
                }
                if (message.kind === 'entity')
                    this.signon.firstEntity();
                if (message.kind === 'disconnect') {
                    this.state = 'closed';
                    this.options.host.disconnected('Server disconnected');
                    return [];
                }
            }
            if (this.signon.active)
                this.state = 'active';
        }
        if (this.peer !== null) {
            if (now - this.lastReceived > (this.options.timeoutMilliseconds ?? 120000)) {
                this.reject('Connection timed out');
                return [];
            }
            if (this.channel.canSendReliable) {
                const bytes = this.reliable.shift();
                if (bytes !== undefined)
                    this.channel.queueReliable(bytes);
            }
            const packet = this.channel.next(now);
            if (packet !== null)
                this.options.transport.send(this.peer, packet);
        }
        return [];
    }
    submit(commands: readonly ActorCommand[], _now: number): void {
        if (this.state !== 'active' || this.peer === null)
            return;
        if (commands.length > 1)
            throw new Error('A native NetQuake connection carries one player');
        for (const command of commands) {
            const bytes = new SizeBuf(128);
            const move = this.options.host.command(command);
            this.viewAngles = move.viewAngles;
            if (++this.movementMessages <= 2)
                continue;
            writeNetQuakeMove(bytes, { ...move, acknowledgedServerTimeSeconds: this.decoder.timeSeconds }, this.decoder.protocol, this.decoder.flags);
            this.options.transport.send(this.peer, this.channel.unreliable(bytes.bytes()));
        }
    }
    publish(_output: SimulationOutput, _events: readonly SimulationPresentationEvent[], _now: number): void { throw new Error('Remote client cannot publish authoritative state'); }
    close(): void {
        if (this.options.transport.closed)
            return;
        if (this.peer !== null && this.state !== 'closed')
            this.options.transport.send(this.peer, this.channel.unreliable(Uint8Array.of(2)));
        this.state = 'closed';
        this.options.transport.close();
    }
}
