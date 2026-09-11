// Quake net_dgrm.c and QuakeWorld net_chan.c framing. GPL-2.0-or-later.
import { PacketRate } from '../common/scheduling.ts';
import { StopAndWaitChannel, ToggleReliableChannel } from '../common/reliability.ts';
import { sameAddress } from '../common/endpoint.ts';
import type { NetworkAddress } from '../common/endpoint.ts';
import type { DatagramTransport } from '../common/transport.ts';
import { PacketError } from './message.ts';
export const NETFLAG_DATA = 0x10000, NETFLAG_ACK = 0x20000, NETFLAG_EOM = 0x80000, NETFLAG_UNRELIABLE = 0x100000, NETFLAG_CTL = 0x80000000;
export type ChannelDelivery = {
    readonly kind: 'reliable' | 'unreliable';
    readonly payload: Uint8Array;
    readonly sequence: number;
    readonly dropped: number;
};
export interface ChannelReceive {
    readonly delivery: ChannelDelivery | null;
    readonly replies: readonly Uint8Array[];
}
function nqPacket(flags: number, sequence: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (payload.length > 65527)
        throw new RangeError('NetQuake datagram exceeds 16-bit header');
    const bytes = new Uint8Array(payload.length + 8), view = new DataView(bytes.buffer);
    view.setUint32(0, flags | bytes.length);
    view.setUint32(4, sequence);
    bytes.set(payload, 8);
    return bytes;
}
export class NetQuakeChannel {
    private readonly reliable: StopAndWaitChannel;
    private unreliableSend = 0;
    private unreliableReceive = 0;
    constructor(readonly maxMessageBytes = 8000, readonly fragmentBytes = 1024) { this.reliable = new StopAndWaitChannel(maxMessageBytes, fragmentBytes); }
    get canSendReliable(): boolean { return this.reliable.canSend; }
    queueReliable(payload: Uint8Array): void { this.reliable.begin(payload); }
    next(nowMilliseconds: number): Uint8Array | null { const p = this.reliable.next(nowMilliseconds); return p === null ? null : nqPacket(NETFLAG_DATA | (p.final ? NETFLAG_EOM : 0), p.sequence, p.payload); }
    unreliable(payload: Uint8Array): Uint8Array {
        if (payload.length > this.maxMessageBytes)
            throw new RangeError('NetQuake unreliable message exceeds profile');
        return nqPacket(NETFLAG_UNRELIABLE, this.unreliableSend++, payload);
    }
    receive(bytes: Uint8Array, nowMilliseconds: number): ChannelReceive {
        if (bytes.length < 8)
            throw new PacketError('Short NetQuake header', 0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), word = view.getUint32(0), flags = word & 0xffff0000, sequence = view.getUint32(4);
        if ((word & 65535) !== bytes.length)
            throw new PacketError('NetQuake length mismatch', 0);
        if (flags & NETFLAG_CTL)
            return { delivery: null, replies: [] };
        const payload = bytes.slice(8);
        if (flags & NETFLAG_UNRELIABLE) {
            if (sequence < this.unreliableReceive)
                return { delivery: null, replies: [] };
            const dropped = sequence - this.unreliableReceive;
            this.unreliableReceive = sequence + 1;
            return { delivery: { kind: 'unreliable', payload, sequence, dropped }, replies: [] };
        }
        if (flags & NETFLAG_ACK) {
            this.reliable.acknowledge(sequence);
            const next = this.next(nowMilliseconds);
            return { delivery: null, replies: next === null ? [] : [next] };
        }
        if (flags & NETFLAG_DATA) {
            const result = this.reliable.receive({ sequence, final: (flags & NETFLAG_EOM) !== 0, payload });
            return { delivery: result.kind === 'message' ? { kind: 'reliable', payload: result.payload, sequence, dropped: 0 } : null, replies: [nqPacket(NETFLAG_ACK, result.acknowledge)] };
        }
        throw new PacketError('Unknown NetQuake packet flags', 0);
    }
}
export interface QuakeWorldDelivery {
    readonly payload: Uint8Array;
    readonly sequence: number;
    readonly acknowledged: number;
    readonly dropped: number;
}
export class QuakeWorldChannel {
    private readonly reliable: ToggleReliableChannel;
    private readonly packetRate: PacketRate;
    lastReceived = 0;
    frameLatency = 0;
    frameRate = 0;
    constructor(readonly side: 'client' | 'server', readonly qport: number, readonly maxMessageBytes = 1450, public bytesPerSecond = 2500) {
        if (!Number.isInteger(qport) || qport < 0 || qport > 65535)
            throw new RangeError('Invalid qport');
        this.reliable = new ToggleReliableChannel(maxMessageBytes, 0);
        this.packetRate = new PacketRate(bytesPerSecond);
    }
    get incomingSequence(): number { return this.reliable.incomingSequence; }
    get outgoingSequence(): number { return this.reliable.outgoingSequence; }
    get hasReliable(): boolean { return this.reliable.hasPendingReliable; }
    queueReliable(bytes: Uint8Array): void { this.reliable.queue(bytes); }
    canPacket(nowMilliseconds: number): boolean { this.packetRate.bytesPerSecond = this.bytesPerSecond; return this.packetRate.canSend(nowMilliseconds); }
    transmit(unreliable: Uint8Array, nowMilliseconds: number, serverPaused = false): Uint8Array {
        const p = this.reliable.transmit(unreliable), header = this.side === 'client' ? 10 : 8, bytes = new Uint8Array(header + p.payload.length), view = new DataView(bytes.buffer);
        view.setUint32(0, p.sequence | (p.reliable ? 0x80000000 : 0), true);
        view.setUint32(4, p.acknowledged | (p.reliableAcknowledged ? 0x80000000 : 0), true);
        if (this.side === 'client')
            view.setUint16(8, this.qport, true);
        bytes.set(p.payload, header);
        this.packetRate.bytesPerSecond = this.bytesPerSecond;
        this.packetRate.sent(bytes.length, nowMilliseconds, this.side === 'server' && serverPaused);
        return bytes;
    }
    receive(bytes: Uint8Array, nowMilliseconds: number): QuakeWorldDelivery | null {
        const header = this.side === 'server' ? 10 : 8;
        if (bytes.length < header)
            throw new PacketError('Short QuakeWorld header', 0);
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (this.side === 'server' && v.getUint16(8, true) !== this.qport)
            return null;
        const word = v.getUint32(0, true), ack = v.getUint32(4, true);
        if (word === 0xffffffff)
            return null;
        const sequence = word & 0x7fffffff, acknowledged = ack & 0x7fffffff, result = this.reliable.receive({ sequence, acknowledged, reliable: (word >>> 31) !== 0, reliableAcknowledged: (ack >>> 31) === 0 ? 0 : 1, payload: bytes.subarray(header) });
        if (result.kind === 'rejected')
            return null;
        this.frameLatency = this.frameLatency * 0.99 + (this.outgoingSequence - acknowledged) * 0.01;
        this.frameRate = this.frameRate * 0.99 + (nowMilliseconds - this.lastReceived) * 0.01;
        this.lastReceived = nowMilliseconds;
        if (this.side === 'server' && sequence >= this.outgoingSequence)
            this.reliable.advanceOutgoingSequence(sequence);
        return { payload: result.payload, sequence, acknowledged, dropped: result.dropped };
    }
}
/** Endpoint matching happens before a channel consumes bytes. QW permits only port rebinding. */
export class QuakePeer<TAddress extends NetworkAddress> {
    constructor(readonly transport: DatagramTransport<TAddress>, public remote: TAddress, readonly channel: NetQuakeChannel | QuakeWorldChannel) { }
    send(bytes: Uint8Array): boolean { return this.transport.send(this.remote, bytes); }
    receive(from: TAddress, bytes: Uint8Array, nowMilliseconds: number): ChannelDelivery | QuakeWorldDelivery | null {
        if (this.channel instanceof NetQuakeChannel) {
            if (!sameAddress(from, this.remote))
                return null;
            const result = this.channel.receive(bytes, nowMilliseconds);
            for (const reply of result.replies)
                this.send(reply);
            return result.delivery;
        }
        if (!sameAddress(from, this.remote, this.channel.side === "client"))
            return null;
        const result = this.channel.receive(bytes, nowMilliseconds);
        if (result !== null)
            this.remote = from;
        return result;
    }
}
