// Native QW sv_main, sv_user and sv_send; transport only. GPL-2.0-or-later.
import type { ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { QwUserCommand } from '../../../contracts/protocol.ts';
import type { DownloadSource } from '../../../network/services/downloads.ts';
import type { IpAddress } from '../../../network/common/endpoint.ts';
import { nativeAtoi } from '../../../core/numeric.ts';
import { sameAddress } from '../../../network/common/endpoint.ts';
import { QuakeWorldChannel } from '../../../network/q1/channels.ts';
import { decodeQuakeWorldClient, QuakeWorldCommandReplay } from '../../../network/q1/commands.ts';
import { QuakeWorldChallenges, QuakeWorldConnectionlessServer, quakeWorldCommandArguments, quakeWorldInfo } from '../../../network/q1/handshake.ts';
import { SizeBuf } from '../../../network/q1/message.ts';
import { qwWireEntity, writeQuakeWorldEntities, writeQuakeWorldMessage } from '../../../network/q1/quakeworld.ts';
import { QuakeWorldSignonServer } from '../../../network/q1/session.ts';
import type { QwEntityStateT } from '../../../network/q1/qw-constants.ts';
import { U_SOLID } from '../../../network/q1/qw-constants.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { QwApplicationPlayer, QwApplicationServerHost, QwServerMessage, QwServerNetworkOptions } from './qw-server-types.ts';

const protocol = { kind: 'q1-quakeworld', version: 28 } satisfies Extract<ApplicationNetwork['wire'], { kind: 'source' }>['protocol'];
interface Frame { readonly sequence: number; readonly states: readonly QwEntityStateT[]; }
interface Peer {
    remote: IpAddress;
    player: QwApplicationPlayer;
    readonly channel: QuakeWorldChannel;
    signon: QuakeWorldSignonServer;
    replay: QuakeWorldCommandReplay;
    baselines: ReadonlyMap<number, QwEntityStateT>;
    readonly reliable: Uint8Array[];
    reliableLength: number;
    readonly frames: Map<number, Frame>;
    active: boolean;
    reply: boolean;
    delta: number | null;
    choked: number;
    lastReceived: number;
}
export class QwServerNetwork implements ApplicationNetwork {
    readonly role = 'server';
    readonly wire: ApplicationNetwork['wire'] = { kind: 'source', protocol };
    private host: QwApplicationServerHost;
    private readonly peers: Peer[] = [];
    private readonly connectionless: QuakeWorldConnectionlessServer;
    private ended = false;
    constructor(readonly options: QwServerNetworkOptions) {
        this.validate(options.host); this.host = options.host;
        this.connectionless = new QuakeWorldConnectionlessServer({
            password: '', spectatorPassword: '', rconPassword: '', highCharacters: false,
            blocked: () => false, status: () => '\\hostname\\QuakeWorld\n', log: () => null, executeAdmin: () => undefined,
            connect: (request, now) => {
                if (request.spectator) return { kind: 'rejected', reason: 'This host admits native players only' };
                if (request.from.kind !== 'ipv4' && request.from.kind !== 'ipv6') return { kind: 'rejected', reason: 'QW requires an IP endpoint' };
                const existing = this.peers.find(peer => sameAddress(peer.remote, request.from, false) && peer.channel.qport === request.qport);
                if (existing !== undefined) {
                    if (!existing.active) return { kind: 'duplicate' };
                    this.remove(existing, 'Reconnecting');
                }
                if (this.peers.length >= this.host.maxClients) return { kind: 'rejected', reason: 'Server is full' };
                const admitted = this.host.admit(request);
                if (admitted.kind === 'rejected') return admitted;
                try {
                    const binding = this.bind(admitted.player);
                    const rate = quakeWorldInfo(request.userinfo).get('rate');
                    const peer: Peer = { remote: request.from, player: admitted.player, channel: new QuakeWorldChannel('server', request.qport, 1450, rate ? this.rate(rate) : 2500),
                        signon: binding.signon, baselines: binding.baselines, replay: new QuakeWorldCommandReplay(), reliable: [], frames: new Map<number, Frame>(),
                        reliableLength: 0, active: false, reply: false, delta: null, choked: 0, lastReceived: now };
                    this.peers.push(peer);
                } catch (error) { this.host.disconnect(admitted.player, 'Signon failed'); throw error; }
                return { kind: 'accepted' };
            }
        }, new QuakeWorldChallenges(options.random));
    }
    get address(): IpAddress { return this.options.transport.address; }
    get phase(): ApplicationNetworkPhase { return this.ended ? 'closed' : 'active'; }
    get clients(): readonly QwApplicationPlayer[] { return this.peers.map(peer => peer.player); }
    private rate(value: string): number { return Math.max(500, Math.min(10000, nativeAtoi(value))); }
    private validate(host: QwApplicationServerHost): void {
        const support = host.supportsSourceWire();
        if (support.kind === 'unsupported') throw new Error(support.reasons.join('; '));
        if (!Number.isInteger(host.maxClients) || host.maxClients < 1 || host.maxClients > 32) throw new Error('Native QW admits at most 32 players');
    }
    private bind(player: QwApplicationPlayer, host = this.host): { signon: QuakeWorldSignonServer; baselines: ReadonlyMap<number, QwEntityStateT> } {
        const source = host.signon(player), data = source.serverData();
        if (data.protocol.kind !== 'q1-quakeworld' || data.protocol.version !== 28 || data.spectator || data.playerSlot !== player.slot
            || player.slot < 0 || player.slot >= host.maxClients) throw new Error('Source signon does not describe an admitted native QW player');
        const signon = new QuakeWorldSignonServer({
            serverData: () => source.serverData(), models: () => source.models(), sounds: () => source.sounds(), signonBuffers: () => source.signonBuffers(),
            acceptsMapChecksum: checksum => source.acceptsMapChecksum(checksum), spawn: start => source.spawn(start), openDownload: path => source.openDownload(path),
            begin: () => { source.begin(); const peer = this.peers.find(value => value.player.client.equals(player.client)); if (peer !== undefined) peer.active = true; },
            disconnect: reason => { this.disconnectClient(player.client, reason); }
        }, false);
        return { signon, baselines: new Map(host.baselines(player).map(state => [state.number, qwWireEntity(state, (state.quakeWorldFlags & U_SOLID) !== 0)])) };
    }
    private bytes(messages: readonly QwServerMessage[]): Uint8Array {
        const buffer = new SizeBuf(1450);
        for (const message of messages) writeQuakeWorldMessage(buffer, protocol, message);
        return buffer.bytes();
    }
    private enqueue(peer: Peer, bytes: Uint8Array): void {
        if (bytes.length === 0) return;
        if (bytes.length > 1450) throw new Error('QW reliable block exceeds native message size');
        const last = peer.reliable[peer.reliable.length - 1];
        if (last !== undefined && last.length + bytes.length <= 1450) {
            const combined = new Uint8Array(last.length + bytes.length); combined.set(last); combined.set(bytes, last.length);
            peer.reliable[peer.reliable.length - 1] = combined;
        } else {
            if (peer.reliable.length >= 5) throw new Error('QW reliable back buffers overflow');
            peer.reliable.push(bytes.slice());
        }
    }
    private remove(peer: Peer, reason: string): void {
        const index = this.peers.indexOf(peer); if (index < 0) return;
        this.peers.splice(index, 1); peer.signon.close(); this.host.disconnect(peer.player, reason);
    }
    disconnectClient(client: ClientId, reason: string): boolean {
        const peer = this.peers.find(value => value.player.client.equals(client)); if (peer === undefined) return false;
        this.options.transport.send(peer.remote, peer.channel.transmit(this.bytes([{ kind: 'disconnect' }]), peer.lastReceived, true));
        this.remove(peer, reason); return true;
    }
    changeWorld(host: QwApplicationServerHost): void {
        this.validate(host);
        const carried = this.peers.map(peer => {
            const player = host.carriedPlayer(peer.player.client);
            return { peer, player, binding: this.bind(player, host) };
        });
        this.host = host;
        for (const { peer, player, binding } of carried) {
            peer.signon.close(); peer.player = player;
            peer.signon = binding.signon; peer.baselines = binding.baselines;
            peer.active = false; peer.delta = null; peer.choked = 0; peer.frames.clear(); peer.reliable.length = 0; peer.replay = new QuakeWorldCommandReplay();
            this.enqueue(peer, this.bytes([{ kind: 'stufftext', text: 'changing\nreconnect\n' }]));
        }
    }
    async poll(now: number): Promise<readonly ActorCommand[]> {
        if (this.ended) return [];
        for (;;) {
            const packet = this.options.transport.poll(); if (packet === null) break;
            if (packet.kind !== 'packet') { if (packet.kind === 'error') this.host.print(packet.error.message); continue; }
            let owner: Peer | undefined;
            try {
                if (packet.payload.length >= 4 && new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0, true) === 0xffffffff) {
                    for (const reply of this.connectionless.receive(packet.payload, packet.from, now)) this.options.transport.send(packet.from, reply);
                    continue;
                }
                if (packet.payload.length < 10) continue;
                const qport = new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint16(8, true);
                owner = this.peers.find(peer => peer.channel.qport === qport && sameAddress(peer.remote, packet.from, false));
                if (owner === undefined) continue;
                const canReply = new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0, true) % 0x80000000 >= owner.channel.outgoingSequence;
                const delivery = owner.channel.receive(packet.payload, now); if (delivery === null) continue;
                owner.remote = packet.from; owner.lastReceived = now; owner.reply = canReply; owner.delta = null;
                for (const message of decodeQuakeWorldClient(delivery.payload, protocol, delivery.sequence)) {
                    if (!this.peers.includes(owner)) break;
                    if (message.kind === 'delta') owner.delta = message.sequence;
                    else if (message.kind === 'move' && owner.active) {
                        const commands: QwUserCommand[] = [];
                        owner.replay.run(message.bundle, delivery.dropped, this.host.paused, command => commands.push(command));
                        if (commands.length !== 0) this.host.commandGroup(owner.player, commands, delivery.sequence);
                    } else if (message.kind === 'string-command') {
                        const [name, ...args] = quakeWorldCommandArguments(message.text);
                        if (name === 'drop' || name === 'disconnect') { this.disconnectClient(owner.player.client, 'Client disconnected'); continue; }
                        if (name === 'rate') {
                            if (args.length === 1) owner.channel.bytesPerSecond = this.rate(args[0] ?? '');
                            this.enqueue(owner, this.bytes([{ kind: 'print', level: 2, text: `${args.length === 1 ? 'Net rate set to' : 'Current rate is'} ${owner.channel.bytesPerSecond}\n` }]));
                            continue;
                        }
                        if (name === 'setinfo' && args.length === 2 && args[0] === 'rate' && args[1] !== '') owner.channel.bytesPerSecond = this.rate(args[1] ?? '');
                        let prepared: DownloadSource | null | undefined;
                        if (name === 'download' && this.host.prepareDownload !== undefined) {
                            const acceptedHost = this.host, acceptedSignon = owner.signon, acceptedPlayer = owner.player;
                            try { prepared = await acceptedHost.prepareDownload?.(acceptedPlayer, args[0] ?? ''); }
                            catch (error) { prepared = null; this.host.print(error instanceof Error ? error.message : String(error)); }
                            if (this.ended || !this.peers.includes(owner) || this.host !== acceptedHost || owner.signon !== acceptedSignon || owner.player !== acceptedPlayer) {
                                prepared?.close(); continue;
                            }
                        }
                        const result = owner.signon.command(message.text, prepared);
                        if (result.kind === 'handled') for (const bytes of result.messages) this.enqueue(owner, bytes);
                        else if (name !== undefined) this.host.command(owner.player, name, args);
                    }
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error); this.host.print(reason);
                if (owner !== undefined) this.disconnectClient(owner.player.client, reason);
            }
        }
        for (const peer of [...this.peers]) {
            if (now - peer.lastReceived > (this.options.timeoutMilliseconds ?? 65000)) this.disconnectClient(peer.player.client, 'Client timed out');
            else if (!peer.active) this.send(peer, null, now);
        }
        return [];
    }
    private send(peer: Peer, frame: ReturnType<QwApplicationServerHost['frame']> | null, now: number): void {
        if (!peer.reply) return;
        peer.reply = false;
        if (!this.host.paused && !peer.channel.canPacket(now)) { peer.choked++; return; }
        if (!peer.channel.hasReliable) { const bytes = peer.reliable.shift(); if (bytes !== undefined) { peer.channel.queueReliable(bytes); peer.reliableLength = bytes.length; } }
        const buffer = new SizeBuf(1450, true), sequence = peer.channel.outgoingSequence;
        let sent: Frame | null = null;
        if (frame !== null) {
            try {
                if (peer.choked !== 0) { writeQuakeWorldMessage(buffer, protocol, { kind: 'choke-count', count: peer.choked }); peer.choked = 0; }
                for (const message of frame.messages) writeQuakeWorldMessage(buffer, protocol, message);
                const states = frame.entities.map(state => qwWireEntity(state, (state.quakeWorldFlags & U_SOLID) !== 0));
                const previous = peer.delta === null ? null : [...peer.frames.values()].find(value => (value.sequence & 255) === peer.delta && sequence - value.sequence < 64) ?? null;
                writeQuakeWorldEntities(buffer, protocol, states, peer.baselines, previous);
                if (buffer.overflowed) throw new Error('QW frame datagram overflow');
                sent = { sequence, states };
            } catch (error) { this.host.print(error instanceof Error ? error.message : String(error)); buffer.clear(); }
        }
        const packet = peer.channel.transmit(buffer.bytes(), now, this.host.paused);
        this.options.transport.send(peer.remote, packet);
        const reliableBytes = ((packet[3] ?? 0) & 128) !== 0 ? peer.reliableLength : 0;
        if (sent !== null && packet.length === 8 + reliableBytes + buffer.cursize) {
            peer.frames.set(sequence, sent); for (const key of peer.frames.keys()) if (sequence - key >= 64) peer.frames.delete(key);
        }
    }
    submit(_commands: readonly ActorCommand[], _now: number): void { }
    publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], now: number): void {
        if (this.ended) return; this.host.observe(output, events);
        for (const peer of [...this.peers]) if (peer.active) {
            try {
                const frame = this.host.frame(peer.player, output);
                for (const message of frame.reliable) this.enqueue(peer, this.bytes([message]));
                this.send(peer, frame, now);
            } catch (error) { this.disconnectClient(peer.player.client, error instanceof Error ? error.message : String(error)); }
        }
    }
    close(): void {
        if (this.ended) return;
        for (const peer of [...this.peers]) this.disconnectClient(peer.player.client, 'Server shutdown');
        this.ended = true; this.options.transport.close();
    }
}
