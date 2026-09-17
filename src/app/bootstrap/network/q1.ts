import type { ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import { addressKey } from '../../../network/common/endpoint.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { WireSelection } from '../../../network/common/session.ts';
import { NetQuakeChannel } from '../../../network/q1/channels.ts';
import { answerNetQuakeControl, quakeWorldCommandArguments } from '../../../network/q1/handshake.ts';
import { decodeNetQuakeClient, writeNetQuakeEntity, writeNetQuakeMessage } from '../../../network/q1/netquake.ts';
import { MessageReader, SizeBuf, SZ_Write } from '../../../network/q1/message.ts';
import { createNetQuakeCodec, protocolFlags } from '../../../network/q1/profile.ts';
import { entityState } from '../../../network/q1/netquake.ts';
import { EntityStateT } from '../../../network/q1/wire-types.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { Q1ApplicationGameState, Q1ApplicationMessage, Q1ApplicationPlayer, Q1ApplicationServerHost, Q1ServerNetworkOptions } from './q1-types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
interface Peer<TAddress extends NetworkAddress> {
    readonly remote: TAddress;
    player: Q1ApplicationPlayer;
    readonly channel: NetQuakeChannel;
    stage: 1 | 2 | 3 | 4;
    state: Q1ApplicationGameState;
    readonly reliable: Uint8Array[];
    lastReceived: number;
    sequence: number;
}
export class Q1ServerNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
    readonly role = 'server';
    get wire(): WireSelection { return { kind: 'source', protocol: this.host.protocol }; }
    private ended = false;
    private host: Q1ApplicationServerHost;
    private codec: ReturnType<typeof createNetQuakeCodec>;
    private readonly peers = new Map<string, Peer<TAddress>>();
    private pending: ActorCommand[] = [];
    constructor(readonly options: Q1ServerNetworkOptions<TAddress>) { this.validate(options.host); this.host = options.host; this.codec = createNetQuakeCodec(this.host.protocol, new MessageReader(new Uint8Array(0))); }
    private validate(host: Q1ApplicationServerHost): void { const support = host.supportsSourceWire(); if (support.kind === 'unsupported')
        throw new Error(support.reasons.join('; ')); }
    get address(): TAddress { return this.options.transport.address; }
    get phase(): ApplicationNetworkPhase { return this.ended ? 'closed' : 'active'; }
    get clients(): readonly Q1ApplicationPlayer[] { return [...this.peers.values()].map(peer => peer.player); }
    private bytes(messages: readonly Q1ApplicationMessage[]): Uint8Array { const buffer = new SizeBuf(this.codec.maxMsglen); for (const message of messages)
        writeNetQuakeMessage(buffer, this.host.protocol, message); return buffer.bytes(); }
    private start(peer: Peer<TAddress>): void { peer.stage = 1; peer.reliable.push(this.bytes([peer.state.info, { kind: 'set-view', entity: peer.player.sourceEntity }, { kind: 'signon', stage: 1 }])); }
    changeWorld(host: Q1ApplicationServerHost): void { this.validate(host);
        if (this.peers.size !== 0 && (host.protocol.version !== this.host.protocol.version || protocolFlags(host.protocol) !== protocolFlags(this.host.protocol))) throw new Error('Connected NetQuake peers require the same protocol across travel');
        const carried = [...this.peers.values()].map(peer => ({ peer, player: host.carriedPlayer(peer.player.client) })); this.host = host;
        this.codec = createNetQuakeCodec(host.protocol, new MessageReader(new Uint8Array(0))); this.pending = []; for (const { peer, player } of carried) {
        peer.player = player;
        peer.state = host.gameState(player);
        peer.reliable.length = 0;
        this.start(peer);
    } }
    disconnectClient(client: ClientId, reason: string): boolean { const peer = [...this.peers.values()].find(value => value.player.client.equals(client)); if (peer === undefined)
        return false; this.options.transport.send(peer.remote, peer.channel.unreliable(this.bytes([{ kind: 'disconnect' }]))); this.peers.delete(addressKey(peer.remote)); this.pending = this.pending.filter(command => !command.actor.equals(peer.player.actor)); this.host.disconnect(peer.player, reason); return true; }
    private command(peer: Peer<TAddress>, text: string): void {
        const [name, ...args] = quakeWorldCommandArguments(text);
        if (name === undefined)
            return;
        if (name === 'disconnect') {
            this.disconnectClient(peer.player.client, 'Client disconnected');
            return;
        }
        if (name === 'prespawn' && peer.stage === 1) {
            peer.reliable.push(this.bytes([...peer.state.signon, ...[...peer.state.baselines.values()].map(state => ({ kind: 'baseline', state } satisfies Q1ApplicationMessage)), { kind: 'signon', stage: 2 }]));
            peer.stage = 2;
        }
        else if (name === 'spawn' && peer.stage === 2) {
            peer.reliable.push(this.bytes([...this.host.spawn(peer.player), { kind: 'signon', stage: 3 }]));
            peer.stage = 3;
        }
        else if (name === 'begin' && peer.stage === 3)
            peer.stage = 4;
        else if (name !== 'prespawn' && name !== 'spawn' && name !== 'begin')
            this.host.command(peer.player, name, args);
    }
    async poll(now: number): Promise<readonly ActorCommand[]> {
        if (this.ended)
            return [];
        for (;;) {
            const packet = this.options.transport.poll();
            if (packet === null)
                break;
            if (packet.kind !== 'packet') {
                if (packet.kind === 'error')
                    this.host.print(packet.error.message);
                continue;
            }
            try {
                if (packet.payload.length >= 4 && new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0) >>> 16 === 0x8000) {
                    const response = answerNetQuakeControl(packet.payload, packet.from, now, {
                        serverInfo: () => ({ kind: 'server-info', address: addressKey(this.address), name: 'Quake', map: this.host.mapName, players: this.peers.size, maxPlayers: this.host.maxClients, version: 3 }),
                        playerInfo: () => null, nextRule: () => null,
                        connect: () => {
                            if (this.address.kind === 'loopback')
                                return { kind: 'rejected', reason: 'NetQuake control requires an IP port' };
                            if (this.peers.has(addressKey(packet.from)))
                                return { kind: 'accepted', port: this.address.port };
                            const admitted = this.host.admit(packet.from);
                            if (admitted.kind === 'rejected')
                                return admitted;
                            try {
                                const peer: Peer<TAddress> = { remote: packet.from, player: admitted.player, channel: new NetQuakeChannel(this.codec.maxMsglen), stage: 1, state: this.host.gameState(admitted.player), reliable: [], lastReceived: now, sequence: 0 };
                                this.start(peer);
                                this.peers.set(addressKey(packet.from), peer);
                            }
                            catch (error) {
                                this.host.disconnect(admitted.player, 'Signon failed');
                                throw error;
                            }
                            return { kind: 'accepted', port: this.address.port };
                        }
                    });
                    if (response !== null)
                        this.options.transport.send(packet.from, response);
                    continue;
                }
                const peer = this.peers.get(addressKey(packet.from));
                if (peer === undefined)
                    continue;
                const result = peer.channel.receive(packet.payload, now);
                peer.lastReceived = now;
                for (const reply of result.replies)
                    this.options.transport.send(peer.remote, reply);
                if (result.delivery !== null)
                    for (const message of decodeNetQuakeClient(result.delivery.payload, this.host.protocol)) {
                        if (!this.peers.has(addressKey(peer.remote)))
                            break;
                        if (message.kind === 'string-command')
                            this.command(peer, message.text);
                        else if (message.kind === 'disconnect')
                            this.disconnectClient(peer.player.client, 'Client disconnected');
                        else if (message.kind === 'move' && peer.stage === 4)
                            this.pending.push(this.host.input(peer.player, message.command, peer.sequence++));
                    }
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                const peer = this.peers.get(addressKey(packet.from));
                if (peer !== undefined)
                    this.disconnectClient(peer.player.client, reason);
                this.host.print(reason);
            }
        }
        for (const peer of this.peers.values()) {
            if (now - peer.lastReceived > (this.options.timeoutMilliseconds ?? 65000)) {
                this.disconnectClient(peer.player.client, 'Connection timed out');
                continue;
            }
            if (peer.channel.canSendReliable) {
                const bytes = peer.reliable.shift();
                if (bytes !== undefined)
                    peer.channel.queueReliable(bytes);
            }
            const bytes = peer.channel.next(now);
            if (bytes !== null)
                this.options.transport.send(peer.remote, bytes);
        }
        const commands = this.pending;
        this.pending = [];
        return commands;
    }
    submit(_commands: readonly ActorCommand[], _now: number): void { throw new Error('Server input must enter the application input batch'); }
    publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], now: number): void {
        if (this.ended)
            return;
        this.host.observe(output, events);
        for (const peer of this.peers.values()) {
            const frame = this.host.frame(peer.player, output);
            if (frame.reliable.length !== 0)
                peer.reliable.push(this.bytes(frame.reliable));
            if (peer.channel.canSendReliable) {
                const reliable = peer.reliable.shift();
                if (reliable !== undefined)
                    peer.channel.queueReliable(reliable);
            }
            const reliable = peer.channel.next(now);
            if (reliable !== null)
                this.options.transport.send(peer.remote, reliable);
            if (peer.stage !== 4)
                continue;
            const maxDatagram = Math.min(this.codec.maxDatagram, (this.options.transport.maxDatagramBytes ?? 65507) - 8);
            const buffer = new SizeBuf(maxDatagram);
            writeNetQuakeMessage(buffer, this.host.protocol, { kind: 'time', seconds: frame.seconds });
            for (const message of frame.messages)
                writeNetQuakeMessage(buffer, this.host.protocol, message);
            for (const state of frame.entities) {
                const encoded = new SizeBuf(128);
                writeNetQuakeEntity(encoded, this.host.protocol, state, peer.state.baselines.get(state.number) ?? entityState(state.number, new EntityStateT()), frame.seconds);
                if (buffer.cursize + encoded.cursize > maxDatagram)
                    break;
                SZ_Write(buffer, encoded.bytes());
            }
            const datagram = new SizeBuf(maxDatagram);
            for (const message of frame.datagram) {
                const encoded = this.bytes([message]);
                if (datagram.cursize + encoded.length > maxDatagram)
                    break;
                SZ_Write(datagram, encoded);
            }
            if (buffer.cursize + datagram.cursize <= maxDatagram)
                SZ_Write(buffer, datagram.bytes());
            this.options.transport.send(peer.remote, peer.channel.unreliable(buffer.bytes()));
        }
    }
    close(): void { if (this.ended)
        return; try {
        for (const player of this.clients)
            this.disconnectClient(player.client, 'Server shutdown');
    }
    finally {
        this.ended = true;
        this.options.transport.close();
    } }
}
