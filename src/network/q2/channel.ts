// Quake II net_chan.c and q2repro common/net/chan.c. GPL-2.0-or-later.
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import type { NetworkAddress } from '../common/endpoint.ts';
import type { DatagramTransport } from '../common/transport.ts';
import { createMessage, loadMessage, messageBytes, MSG_ReadByte, MSG_ReadLong, MSG_ReadWord, MSG_WriteByte, MSG_WriteLong, MSG_WriteShort, SZ_Write } from './message.ts';
import { tryWrapZPacket } from './codecs/zpacket.ts';
export interface Q2ChannelOptions {
    readonly side: 'client' | 'server';
    readonly protocol: Q2ProtocolIdentity;
    readonly channel: 'old' | 'new';
    readonly qport: number;
    /** Writable payload limit negotiated by q2pro; excludes the 10-byte reserve. */
    readonly payloadBytes?: number;
    readonly messageBytes?: number;
    readonly maxDatagramBytes?: number;
    readonly compress?: boolean;
    /** Original id and q2pro record the resend sequence on opposite sides of increment. */
    readonly sequenceRecording?: 'id' | 'q2pro';
}
export type Q2ChannelReceive = {
    readonly kind: 'message';
    readonly sequence: number;
    readonly acknowledged: number;
    readonly dropped: number;
    readonly bytes: Uint8Array;
} | {
    readonly kind: 'fragment';
    readonly sequence: number;
    readonly receivedBytes: number;
} | {
    readonly kind: 'rejected';
    readonly reason: 'short' | 'sequence' | 'fragment-order' | 'fragment-size' | 'qport';
};
export class Q2Channel {
    private incoming = 0;
    private outgoing = 1;
    private incomingAck = 0;
    private incomingReliable = 0;
    private incomingReliableAck = 0;
    private ackPending = false;
    private reliableBit = 0;
    private lastReliable = 0;
    private queued = new Uint8Array(0);
    private reliable: Uint8Array = new Uint8Array(0);
    private sending: {
        readonly bytes: Uint8Array;
        readonly reliable: boolean;
        offset: number;
    } | null = null;
    private readonly receiving: Uint8Array;
    private receiveSequence = 0;
    private receiveLength = 0;
    readonly payloadBytes: number;
    readonly capacity: number;
    lastSentMilliseconds = 0;
    lastReceivedMilliseconds = 0;
    constructor(readonly options: Q2ChannelOptions) {
        const datagramBytes = options.maxDatagramBytes ?? 65507;
        if (!Number.isInteger(datagramBytes) || datagramBytes < 524 || datagramBytes > 65507) throw new RangeError("Invalid Q2 transport datagram limit");
        this.payloadBytes = Math.min(options.payloadBytes ?? 1390, datagramBytes - 12);
        const capacity = options.messageBytes ?? (options.channel === 'new' ? 32768 : (options.sequenceRecording ?? (options.protocol.version === 34 ? 'id' : 'q2pro')) === 'id' ? 1384 : this.payloadBytes);
        this.capacity = options.channel === 'new' ? capacity : Math.min(capacity, datagramBytes - 10);
        if (!Number.isInteger(this.payloadBytes) || this.payloadBytes < 512 || this.payloadBytes > 4086 || !Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 32768)
            throw new RangeError('Invalid Q2 channel limits');
        if (!Number.isInteger(options.qport) || options.qport < 0 || options.qport > 65535)
            throw new RangeError('Invalid Q2 qport');
        this.receiving = new Uint8Array(32768);
    }
    get incomingSequence(): number { return this.incoming; }
    get incomingAcknowledged(): number { return this.incomingAck; }
    get outgoingSequence(): number { return this.outgoing; }
    get fragmentPending(): boolean { return this.sending !== null; }
    get reliablePending(): boolean { return this.queued.length > 0 || this.reliable.length > 0; }
    get acknowledgementPending(): boolean { return this.ackPending; }
    shouldUpdate(nowMilliseconds: number): boolean { return this.queued.length > 0 || this.ackPending || this.sending !== null || nowMilliseconds - this.lastSentMilliseconds > 1000; }
    get canReliable(): boolean { return this.reliable.length === 0; }
    queueReliable(bytes: Uint8Array): void {
        if (this.queued.length + bytes.length > this.capacity)
            throw new RangeError('Q2 reliable message overflow');
        const joined = new Uint8Array(this.queued.length + bytes.length);
        joined.set(this.queued);
        joined.set(bytes, this.queued.length);
        this.queued = joined;
    }
    private qportBytes(): number { return this.options.channel === 'old' && this.options.protocol.version < 35 ? 2 : this.options.qport === 0 ? 0 : 1; }
    private header(reliable: boolean, fragmented: boolean) {
        const classicId = this.options.channel === 'old' && (this.options.sequenceRecording ?? (this.options.protocol.version === 34 ? 'id' : 'q2pro')) === 'id';
        const message = createMessage(Math.min(classicId ? 1400 : 4096, this.options.maxDatagramBytes ?? 4096));
        const mask = this.options.channel === 'old' ? 0x7fffffff : 0x3fffffff;
        MSG_WriteLong(message, (this.outgoing & mask) | (reliable ? 0x80000000 : 0) | (fragmented ? 0x40000000 : 0));
        MSG_WriteLong(message, (this.incoming & mask) | (this.incomingReliable ? 0x80000000 : 0));
        if (this.options.side === 'client') {
            if (this.qportBytes() === 2)
                MSG_WriteShort(message, this.options.qport);
            else if (this.qportBytes() === 1)
                MSG_WriteByte(message, this.options.qport);
        }
        return message;
    }
    nextFragment(nowMilliseconds: number): Uint8Array | null {
        const pending = this.sending;
        if (pending === null)
            return null;
        const packet = this.header(pending.reliable, true);
        const writable = Math.min(this.payloadBytes, packet.maxsize - packet.cursize - 2);
        const end = Math.min(pending.offset + writable, pending.bytes.length);
        const more = end < pending.bytes.length;
        MSG_WriteShort(packet, pending.offset | (more ? 0x8000 : 0));
        SZ_Write(packet, pending.bytes.subarray(pending.offset, end), end - pending.offset);
        pending.offset = end;
        if (!more) {
            this.sending = null;
            this.outgoing++;
            this.lastSentMilliseconds = nowMilliseconds;
        }
        return messageBytes(packet);
    }
    transmit(unreliable: Uint8Array, nowMilliseconds: number): Uint8Array {
        const next = this.nextFragment(nowMilliseconds);
        if (next !== null)
            return next;
        let sendReliable = this.incomingAck > this.lastReliable && this.incomingReliableAck !== this.reliableBit;
        if (this.reliable.length === 0 && this.queued.length > 0) {
            const compressed = this.options.side === 'server' && this.options.compress === true ? tryWrapZPacket(this.queued, this.queued.length, this.capacity) : null;
            if (compressed !== null && (this.options.protocol.kind === 'q2-rerelease' || this.options.protocol.kind === 'q2-private-classic'))
                compressed[0] = 34;
            this.reliable = compressed ?? this.queued;
            this.queued = new Uint8Array(0);
            this.reliableBit ^= 1;
            sendReliable = true;
        }
        const reliable = sendReliable ? this.reliable : new Uint8Array(0);
        if (this.options.channel === 'new' && reliable.length + unreliable.length > this.payloadBytes) {
            const include = reliable.length + unreliable.length <= this.receiving.length;
            const bytes = new Uint8Array(reliable.length + (include ? unreliable.length : 0));
            bytes.set(reliable);
            if (include)
                bytes.set(unreliable, reliable.length);
            this.sending = { bytes, reliable: sendReliable, offset: 0 };
            if (sendReliable)
                this.lastReliable = this.outgoing;
            const fragment = this.nextFragment(nowMilliseconds);
            if (fragment === null)
                throw new Error('Q2 fragment disappeared');
            return fragment;
        }
        const packet = this.header(sendReliable, false);
        SZ_Write(packet, reliable, reliable.length);
        if (packet.maxsize - packet.cursize >= unreliable.length)
            SZ_Write(packet, unreliable, unreliable.length);
        if (sendReliable)
            this.lastReliable = this.outgoing + ((this.options.sequenceRecording ?? (this.options.protocol.version === 34 ? 'id' : 'q2pro')) === 'id' ? 1 : 0);
        this.outgoing++;
        this.ackPending = false;
        this.lastSentMilliseconds = nowMilliseconds;
        return messageBytes(packet);
    }
    receive(bytes: Uint8Array, nowMilliseconds: number): Q2ChannelReceive {
        const packet = createMessage(0);
        loadMessage(packet, bytes);
        const sequenceWord = MSG_ReadLong(packet), ackWord = MSG_ReadLong(packet);
        if (this.options.side === 'server') {
            const width = this.qportBytes();
            const qport = width === 2 ? MSG_ReadWord(packet) : width === 1 ? MSG_ReadByte(packet) : 0;
            const expected = width === 2 ? this.options.qport : this.options.qport & 255;
            if (packet.readcount > packet.cursize)
                return { kind: 'rejected', reason: 'short' };
            if (qport !== expected)
                return { kind: 'rejected', reason: 'qport' };
        }
        const mask = this.options.channel === 'old' ? 0x7fffffff : 0x3fffffff;
        const sequence = sequenceWord & mask, acknowledged = ackWord & mask;
        const reliable = sequenceWord >>> 31, reliableAck = ackWord >>> 31;
        const fragmented = this.options.channel === 'new' && (sequenceWord & 0x40000000) !== 0;
        const fragmentWord = fragmented ? MSG_ReadWord(packet) : 0;
        if (packet.readcount > packet.cursize)
            return { kind: 'rejected', reason: 'short' };
        if (sequence <= this.incoming)
            return { kind: 'rejected', reason: 'sequence' };
        this.incomingReliableAck = reliableAck;
        if (reliableAck === this.reliableBit)
            this.reliable = new Uint8Array(0);
        let payload = bytes.slice(packet.readcount);
        if (fragmented) {
            if (sequence !== this.receiveSequence) {
                this.receiveSequence = sequence;
                this.receiveLength = 0;
            }
            const offset = fragmentWord & 0x7fff;
            if (offset !== this.receiveLength)
                return { kind: 'rejected', reason: 'fragment-order' };
            if (this.receiveLength + payload.length > this.receiving.length)
                return { kind: 'rejected', reason: 'fragment-size' };
            this.receiving.set(payload, this.receiveLength);
            this.receiveLength += payload.length;
            if ((fragmentWord & 0x8000) !== 0)
                return { kind: 'fragment', sequence, receivedBytes: this.receiveLength };
            payload = this.receiving.slice(0, this.receiveLength);
            this.receiveLength = 0;
        }
        const dropped = sequence - this.incoming - 1;
        this.incoming = sequence;
        this.incomingAck = acknowledged;
        if (reliable) {
            this.ackPending = true;
            this.incomingReliable ^= 1;
        }
        this.lastReceivedMilliseconds = nowMilliseconds;
        return { kind: 'message', sequence, acknowledged, dropped, bytes: payload };
    }
    send<TAddress extends NetworkAddress>(transport: DatagramTransport<TAddress>, to: TAddress, unreliable: Uint8Array, nowMilliseconds: number): boolean {
        return transport.send(to, this.transmit(unreliable, nowMilliseconds));
    }
}
