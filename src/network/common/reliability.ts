// Reliable sequencing from Quake/QW and Quake II net_chan.c. GPL-2.0-or-later.
export type ReliableBit = 0 | 1;
function flip(value: ReliableBit): ReliableBit { return value === 0 ? 1 : 0; }

export interface TogglePacket {
  readonly sequence: number;
  readonly acknowledged: number;
  readonly reliable: boolean;
  readonly reliableAcknowledged: ReliableBit;
  readonly payload: Uint8Array;
}
export type ToggleReceive =
  | { readonly kind: "accepted"; readonly dropped: number; readonly payload: Uint8Array }
  | { readonly kind: "rejected"; readonly reason: "sequence" };

/** QW/Q2's reliable bit protocol; the adapter writes its own header and qport. */
export class ToggleReliableChannel {
  private pending = new Uint8Array(0);
  private reliable = new Uint8Array(0);
  private reliableSequence: ReliableBit = 0;
  private incomingReliable: ReliableBit = 0;
  private incomingReliableAck: ReliableBit = 0;
  private incomingAck = 0;
  private lastReliable = 0;
  private incoming = 0;
  private outgoing: number;
  constructor(readonly capacity: number, firstSequence = 1) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError("Invalid reliable capacity");
    this.outgoing = firstSequence;
  }
  get incomingSequence(): number { return this.incoming; }
  get outgoingSequence(): number { return this.outgoing; }
  /** QW SV_ExecuteClientMessage aligns server replies with accepted command sequences. */
  advanceOutgoingSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < this.outgoing || sequence > 0x7fffffff) throw new RangeError("Invalid outgoing sequence advancement");
    this.outgoing = sequence;
  }
  get hasPendingReliable(): boolean { return this.pending.length > 0 || this.reliable.length > 0; }
  queue(payload: Uint8Array): void {
    if (this.pending.length + payload.length > this.capacity) throw new RangeError("Reliable message overflow");
    const joined = new Uint8Array(this.pending.length + payload.length);
    joined.set(this.pending); joined.set(payload, this.pending.length); this.pending = joined;
  }
  transmit(unreliable: Uint8Array, payloadCapacity = this.capacity): TogglePacket {
    if (!Number.isSafeInteger(payloadCapacity) || payloadCapacity < 0 || payloadCapacity > this.capacity) throw new RangeError("Invalid packet payload capacity");
    if (this.outgoing > 0x7fffffff) throw new RangeError("Channel sequence exhausted; reconnect required");
    let sendReliable = this.incomingAck > this.lastReliable && this.incomingReliableAck !== this.reliableSequence;
    if (this.reliable.length === 0 && this.pending.length > 0) {
      this.reliable = this.pending; this.pending = new Uint8Array(0); this.reliableSequence = flip(this.reliableSequence); sendReliable = true;
    }
    const reliableBytes = sendReliable ? this.reliable : new Uint8Array(0);
    if (reliableBytes.length > payloadCapacity) throw new RangeError("Reliable payload does not fit packet");
    const includeUnreliable = reliableBytes.length + unreliable.length <= payloadCapacity;
    const payload = new Uint8Array(reliableBytes.length + (includeUnreliable ? unreliable.length : 0));
    payload.set(reliableBytes);
    if (includeUnreliable) payload.set(unreliable, reliableBytes.length);
    const sequence = this.outgoing++;
    // C records the already-incremented outgoing_sequence for retransmission detection.
    if (sendReliable) this.lastReliable = this.outgoing;
    return { sequence, acknowledged: this.incoming, reliable: sendReliable, reliableAcknowledged: this.incomingReliable, payload };
  }
  receive(packet: TogglePacket): ToggleReceive {
    if (packet.sequence <= this.incoming) return { kind: "rejected", reason: "sequence" };
    const dropped = packet.sequence - this.incoming - 1;
    if (packet.reliableAcknowledged === this.reliableSequence) this.reliable = new Uint8Array(0);
    this.incoming = packet.sequence; this.incomingAck = packet.acknowledged; this.incomingReliableAck = packet.reliableAcknowledged;
    if (packet.reliable) this.incomingReliable = flip(this.incomingReliable);
    return { kind: "accepted", dropped, payload: packet.payload.slice() };
  }
}

export interface ReliableFragment { readonly sequence: number; readonly final: boolean; readonly payload: Uint8Array; }
export type ReliableFragmentReceive =
  | { readonly kind: "duplicate"; readonly acknowledge: number }
  | { readonly kind: "fragment"; readonly acknowledge: number }
  | { readonly kind: "message"; readonly acknowledge: number; readonly payload: Uint8Array };

/** NetQuake acknowledges every data packet, including duplicates, one fragment at a time. */
export class StopAndWaitChannel {
  private outgoing = 0;
  private incoming = 0;
  private sending: { readonly bytes: Uint8Array; offset: number; sentAt: number | null } | null = null;
  private readonly received: Uint8Array;
  private receivedLength = 0;
  constructor(readonly maxMessageBytes: number, readonly fragmentBytes: number, readonly retryMilliseconds = 1000) {
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0 || !Number.isSafeInteger(fragmentBytes) || fragmentBytes <= 0 || fragmentBytes > maxMessageBytes) throw new RangeError("Invalid NetQuake fragment limits");
    this.received = new Uint8Array(maxMessageBytes);
  }
  get canSend(): boolean { return this.sending === null; }
  begin(bytes: Uint8Array): void {
    if (this.sending !== null) throw new Error("Reliable message remains unacknowledged");
    if (bytes.length > this.maxMessageBytes) throw new RangeError("Reliable message exceeds capacity");
    this.sending = { bytes: bytes.slice(), offset: 0, sentAt: null };
  }
  next(now: number): ReliableFragment | null {
    const pending = this.sending;
    if (pending === null || (pending.sentAt !== null && now - pending.sentAt <= this.retryMilliseconds)) return null;
    const end = Math.min(pending.bytes.length, pending.offset + this.fragmentBytes);
    pending.sentAt = now;
    return { sequence: this.outgoing, final: end === pending.bytes.length, payload: pending.bytes.slice(pending.offset, end) };
  }
  acknowledge(sequence: number): boolean {
    const pending = this.sending;
    if (pending === null || pending.sentAt === null || sequence !== this.outgoing) return false;
    this.outgoing = (this.outgoing + 1) >>> 0;
    pending.offset += this.fragmentBytes;
    if (pending.offset >= pending.bytes.length) this.sending = null;
    else pending.sentAt = null;
    return true;
  }
  receive(fragment: ReliableFragment): ReliableFragmentReceive {
    if (fragment.sequence !== this.incoming) return { kind: "duplicate", acknowledge: fragment.sequence };
    if (this.receivedLength + fragment.payload.length > this.maxMessageBytes) throw new RangeError("Reliable receive overflow");
    this.received.set(fragment.payload, this.receivedLength); this.receivedLength += fragment.payload.length;
    this.incoming = (this.incoming + 1) >>> 0;
    if (!fragment.final) return { kind: "fragment", acknowledge: fragment.sequence };
    const payload = this.received.slice(0, this.receivedLength); this.receivedLength = 0;
    return { kind: "message", acknowledge: fragment.sequence, payload };
  }
}
