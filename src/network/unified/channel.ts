import { decodeUnifiedPacket, encodeUnifiedPacket, unifiedToken, UNIFIED_PACKET_HEADER_BYTES, UNIFIED_SEQUENCE_MAX } from './packet.ts';
import type { UnifiedPacket } from './packet.ts';

export interface UnifiedChannelLimits {
  readonly datagramBytes: number;
  readonly messageBytes: number;
  readonly queuedReliableBytes: number;
  readonly queuedReliableMessages: number;
  readonly reliableWindowMessages: number;
  readonly fragments: number;
  readonly packetsPerFlush: number;
  readonly retryMilliseconds: number;
  readonly maximumTransmissions: number;
  readonly assemblyMilliseconds: number;
}
const defaults: UnifiedChannelLimits = { datagramBytes: 1200, messageBytes: 4 * 1024 * 1024, queuedReliableBytes: 8 * 1024 * 1024,
  queuedReliableMessages: 256, reliableWindowMessages: 8, fragments: 8192, packetsPerFlush: 32, retryMilliseconds: 250, maximumTransmissions: 40, assemblyMilliseconds: 30000 };

export type UnifiedDelivery =
  | { readonly kind: 'reliable'; readonly sequence: number; readonly payload: Uint8Array }
  | { readonly kind: 'frame'; readonly sequence: number; readonly requiredReliableSequence: number; readonly payload: Uint8Array };
type DataPacket = Exclude<UnifiedPacket, { readonly kind: 'ack' }>;
interface Outgoing {
  readonly sequence: number;
  readonly payload: Uint8Array;
  readonly required: number;
  readonly fragments: number;
  readonly sent: Map<number, { readonly at: number; readonly attempts: number }>;
  readonly acknowledged: Set<number>;
  next: number;
}
interface Assembly {
  readonly sequence: number;
  readonly required: number;
  readonly fragmentBytes: number;
  readonly fragments: number;
  readonly payload: Uint8Array;
  readonly received: Set<number>;
  readonly started: number;
}

/** One established peer. Control uses a bounded ordered window; snapshots never block control. */
export class UnifiedChannel {
  readonly token: string;
  readonly limits: UnifiedChannelLimits;
  private ended = false;
  private lane = 0;
  private nextReliable = 1;
  private nextFrame = 1;
  private reliableReceived = 0;
  private reliableAcknowledged = 0;
  private frameReceived = 0;
  private newestFrame = 0;
  private queuedBytes = 0;
  private readonly reliable: Outgoing[] = [];
  private reliableCursor = 0;
  private receivedBytes = 0;
  private frame: Outgoing | null = null;
  private pendingFrame: Outgoing | null = null;
  private readonly reliableAssemblies = new Map<number, Assembly>();
  private frameAssembly: Assembly | null = null;
  private waitingFrame: Extract<UnifiedDelivery, { readonly kind: 'frame' }> | null = null;
  private readonly acknowledgments = new Map<string, { readonly sequence: number; readonly fragment: number }>();
  constructor(token: string, limits: Partial<UnifiedChannelLimits> = {}) {
    this.token = unifiedToken(token); this.limits = { ...defaults, ...limits };
    const values = [this.limits.datagramBytes, this.limits.messageBytes, this.limits.queuedReliableBytes, this.limits.queuedReliableMessages, this.limits.reliableWindowMessages,
      this.limits.fragments, this.limits.packetsPerFlush, this.limits.retryMilliseconds, this.limits.maximumTransmissions, this.limits.assemblyMilliseconds];
    for (const value of values) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid unified channel limit');
    if (this.limits.datagramBytes <= UNIFIED_PACKET_HEADER_BYTES || this.limits.datagramBytes > 65507 || this.limits.messageBytes > UNIFIED_SEQUENCE_MAX
      || this.limits.fragments > 65535 || this.limits.reliableWindowMessages > 64 || this.limits.queuedReliableBytes < this.limits.messageBytes) throw new RangeError('Invalid unified channel capacity');
  }
  get receivedReliableSequence(): number { return this.reliableReceived; }
  get acknowledgedReliableSequence(): number { return this.reliableAcknowledged; }
  get closed(): boolean { return this.ended; }
  private get windowMessages(): number { return Math.min(this.limits.reliableWindowMessages, this.limits.queuedReliableMessages); }
  private open(): void { if (this.ended) throw new Error('Unified channel is closed'); }
  private time(now: number): void { if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid unified channel time'); }
  private outgoing(payload: Uint8Array, sequence: number, required: number): Outgoing {
    const fragments = Math.max(1, Math.ceil(payload.length / (this.limits.datagramBytes - UNIFIED_PACKET_HEADER_BYTES)));
    if (payload.length > this.limits.messageBytes || fragments > this.limits.fragments) throw new RangeError('Unified message exceeds channel capacity');
    if (sequence > UNIFIED_SEQUENCE_MAX) throw new RangeError('Unified sequence exhausted; reconnect required');
    return { sequence, payload: payload.slice(), required, fragments, sent: new Map<number, { readonly at: number; readonly attempts: number }>(), acknowledged: new Set<number>(), next: 0 };
  }
  queueReliable(payload: Uint8Array): number {
    this.open();
    if (this.reliable.length >= this.limits.queuedReliableMessages || this.queuedBytes + payload.length > this.limits.queuedReliableBytes) throw new RangeError('Unified reliable queue overflow');
    const message = this.outgoing(payload, this.nextReliable, 0);
    this.nextReliable++; this.queuedBytes += payload.length; this.reliable.push(message); return message.sequence;
  }
  queueFrame(payload: Uint8Array, requiredReliableSequence: number): void {
    this.open();
    if (!Number.isInteger(requiredReliableSequence) || requiredReliableSequence < 0 || requiredReliableSequence >= this.nextReliable) throw new RangeError('Frame depends on an unqueued reliable message');
    const frame = this.outgoing(payload, this.nextFrame, requiredReliableSequence); this.nextFrame++;
    if (this.frame === null) this.frame = frame; else this.pendingFrame = frame;
  }
  private expire(now: number): void {
    for (const assembly of this.reliableAssemblies.values()) {
      if (now - assembly.started >= this.limits.assemblyMilliseconds) {
        this.close(); throw new Error('Unified reliable assembly timed out');
      }
    }
    if (this.frameAssembly !== null && now - this.frameAssembly.started >= this.limits.assemblyMilliseconds) this.frameAssembly = null;
  }
  private acknowledge(sequence: number, fragment: number): void {
    // A single cumulative ACK suffices for every already delivered duplicate.
    const key = sequence <= this.reliableReceived ? 'delivered' : `${sequence}:${fragment}`;
    this.acknowledgments.set(key, { sequence, fragment });
  }
  private acceptAcknowledgment(packet: UnifiedPacket): void {
    const end = this.reliable.findIndex(message => message.sequence === packet.acknowledgedReliable);
    if (end >= 0 && end < this.windowMessages && this.reliable.slice(0, end + 1).every(message => message.next === message.fragments)) {
      for (const message of this.reliable.splice(0, end + 1)) this.queuedBytes -= message.payload.length;
      this.reliableAcknowledged = packet.acknowledgedReliable;
    }
    if (packet.kind === 'ack') {
      const message = this.reliable.slice(0, this.windowMessages).find(message => message.sequence === packet.sequence);
      if (message?.sent.has(packet.fragment)) message.acknowledged.add(packet.fragment);
    }
  }
  private assembly(packet: DataPacket, now: number): Assembly {
    return { sequence: packet.sequence, required: packet.requiredReliableSequence, fragmentBytes: packet.fragmentBytes, fragments: packet.fragments,
      payload: new Uint8Array(packet.totalBytes), received: new Set(), started: now };
  }
  private append(assembly: Assembly, packet: DataPacket): boolean {
    if (assembly.required !== packet.requiredReliableSequence || assembly.payload.length !== packet.totalBytes || assembly.fragmentBytes !== packet.fragmentBytes || assembly.fragments !== packet.fragments) return false;
    if (!assembly.received.has(packet.fragment)) {
      assembly.payload.set(packet.payload, packet.fragment * packet.fragmentBytes); assembly.received.add(packet.fragment);
    }
    return true;
  }
  private releaseFrame(delivered: UnifiedDelivery[]): void {
    const frame = this.waitingFrame;
    if (frame === null || frame.requiredReliableSequence > this.reliableReceived) return;
    this.waitingFrame = null;
    if (frame.sequence <= this.frameReceived) return;
    this.frameReceived = frame.sequence; delivered.push(frame);
  }
  receive(datagram: Uint8Array, now: number): readonly UnifiedDelivery[] {
    this.open(); this.time(now); this.expire(now);
    if (datagram.length > this.limits.datagramBytes) return [];
    const packet = decodeUnifiedPacket(datagram);
    if (packet === null || packet.token !== this.token) return [];
    if (packet.kind !== 'ack' && (packet.totalBytes > this.limits.messageBytes || packet.fragments > this.limits.fragments)) return [];
    this.acceptAcknowledgment(packet);
    const delivered: UnifiedDelivery[] = [];
    if (packet.kind === 'ack') return delivered;
    if (packet.kind === 'reliable') {
      if (packet.sequence <= this.reliableReceived) { this.acknowledge(packet.sequence, packet.fragment); return delivered; }
      if (packet.sequence > this.reliableReceived + this.windowMessages) return delivered;
      let assembly = this.reliableAssemblies.get(packet.sequence);
      if (assembly === undefined) {
        // Future assemblies cannot occupy the space needed to close the first gap.
        let reserve = 0;
        for (let sequence = this.reliableReceived + 1; sequence < packet.sequence; sequence++) {
          if (!this.reliableAssemblies.has(sequence)) { reserve = this.limits.messageBytes; break; }
        }
        if (this.receivedBytes + packet.totalBytes + reserve > this.limits.queuedReliableBytes) return delivered;
        assembly = this.assembly(packet, now); this.reliableAssemblies.set(packet.sequence, assembly); this.receivedBytes += packet.totalBytes;
      }
      if (!this.append(assembly, packet)) return delivered;
      this.acknowledge(packet.sequence, packet.fragment);
      for (;;) {
        const ready = this.reliableAssemblies.get(this.reliableReceived + 1);
        if (ready === undefined || ready.received.size !== ready.fragments) break;
        this.reliableReceived = ready.sequence; this.reliableAssemblies.delete(ready.sequence); this.receivedBytes -= ready.payload.length;
        delivered.push({ kind: 'reliable', sequence: ready.sequence, payload: ready.payload });
      }
      if (delivered.length !== 0) {
        for (const [key, ack] of this.acknowledgments) if (ack.sequence <= this.reliableReceived) this.acknowledgments.delete(key);
        this.acknowledge(packet.sequence, packet.fragment); this.releaseFrame(delivered);
      }
    } else {
      if (packet.sequence <= this.frameReceived || packet.sequence < this.newestFrame) return delivered;
      if (packet.sequence > this.newestFrame) { this.newestFrame = packet.sequence; this.frameAssembly = null; }
      if (this.waitingFrame?.sequence === packet.sequence) return delivered;
      const assembly = this.frameAssembly ?? this.assembly(packet, now); this.frameAssembly = assembly;
      if (!this.append(assembly, packet)) return delivered;
      if (assembly.received.size === assembly.fragments) {
        this.frameAssembly = null; this.waitingFrame = { kind: 'frame', sequence: packet.sequence, requiredReliableSequence: assembly.required, payload: assembly.payload };
        this.releaseFrame(delivered);
      }
    }
    return delivered;
  }
  private packet(message: Outgoing, kind: 'reliable' | 'frame', fragment: number): Uint8Array {
    const fragmentBytes = this.limits.datagramBytes - UNIFIED_PACKET_HEADER_BYTES;
    return encodeUnifiedPacket({ kind, token: this.token, sequence: message.sequence, acknowledgedReliable: this.reliableReceived,
      requiredReliableSequence: message.required, totalBytes: message.payload.length, fragmentBytes, fragment, fragments: message.fragments,
      payload: message.payload.subarray(fragment * fragmentBytes, (fragment + 1) * fragmentBytes) });
  }
  private sendReliable(now: number): Uint8Array | null {
    const count = Math.min(this.reliable.length, this.windowMessages);
    for (let checked = 0; checked < count; checked++) {
      const index = this.reliableCursor % count; this.reliableCursor = (index + 1) % count;
      const message = this.reliable[index]; if (message === undefined) continue;
      let fragment = message.next;
      if (fragment === message.fragments) {
        let retry: number | null = null;
        for (const [candidate, sent] of message.sent) {
          if (!message.acknowledged.has(candidate) && now - sent.at >= this.limits.retryMilliseconds) { retry = candidate; break; }
        }
        if (retry !== null) fragment = retry;
        else if (index === 0 && message.acknowledged.size === message.fragments) {
          // Probe only the head for a lost cumulative ACK; buffered successors wait.
          fragment = message.fragments - 1;
          const sent = message.sent.get(fragment); if (sent === undefined || now - sent.at < this.limits.retryMilliseconds) continue;
        } else continue;
      } else message.next++;
      const attempts = (message.sent.get(fragment)?.attempts ?? 0) + 1;
      if (attempts > this.limits.maximumTransmissions) { this.close(); throw new Error('Unified reliable retry limit exceeded'); }
      message.sent.set(fragment, { at: now, attempts }); return this.packet(message, 'reliable', fragment);
    }
    return null;
  }
  private sendFrame(): Uint8Array | null {
    const message = this.frame; if (message === null) return null;
    const packet = this.packet(message, 'frame', message.next++);
    if (message.next === message.fragments) { this.frame = this.pendingFrame; this.pendingFrame = null; }
    return packet;
  }
  private sendAck(): Uint8Array | null {
    const first = this.acknowledgments.entries().next(); if (first.done) return null;
    const [key, ack] = first.value; this.acknowledgments.delete(key);
    return encodeUnifiedPacket({ kind: 'ack', token: this.token, acknowledgedReliable: this.reliableReceived, ...ack });
  }
  flush(now: number): readonly Uint8Array[] {
    this.open(); this.time(now); this.expire(now);
    const packets: Uint8Array[] = [];
    while (packets.length < this.limits.packetsPerFlush) {
      let progress = false;
      for (let turn = 0; turn < 3; turn++) {
        if (packets.length === this.limits.packetsPerFlush) break;
        const lane = this.lane; this.lane = (this.lane + 1) % 3;
        const packet = lane === 0 ? this.sendAck() : lane === 1 ? this.sendReliable(now) : this.sendFrame();
        if (packet !== null) { packets.push(packet); progress = true; }
      }
      if (!progress) break;
    }
    return packets;
  }
  close(): void {
    this.ended = true; this.reliable.length = 0; this.queuedBytes = 0; this.frame = null; this.pendingFrame = null;
    this.reliableAssemblies.clear(); this.receivedBytes = 0; this.frameAssembly = null; this.waitingFrame = null; this.acknowledgments.clear();
  }
}
