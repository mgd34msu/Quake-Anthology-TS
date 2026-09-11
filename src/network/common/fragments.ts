// Quake III netchan fragment ordering. GPL-2.0-or-later.
export interface MessageFragment { readonly sequence: number; readonly offset: number; readonly bytes: Uint8Array; readonly final: boolean; }
export type FragmentResult =
  | { readonly kind: "pending"; readonly byteLength: number }
  | { readonly kind: "complete"; readonly sequence: number; readonly bytes: Uint8Array }
  | { readonly kind: "rejected"; readonly reason: "sequence" | "order" | "length" };

export class FragmentSender {
  private bytes: Uint8Array | null = null;
  private offset = 0;
  private sequence = 0;
  constructor(readonly fragmentBytes: number, readonly maxMessageBytes: number, readonly terminalEmptyFragment: boolean) {
    if (!Number.isSafeInteger(fragmentBytes) || fragmentBytes <= 0 || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < fragmentBytes) throw new RangeError("Invalid fragment sizes");
  }
  get pending(): boolean { return this.bytes !== null; }
  begin(sequence: number, bytes: Uint8Array): void {
    if (this.pending) throw new Error("Fragmented message is still pending");
    if (bytes.length > this.maxMessageBytes) throw new RangeError("Message exceeds fragment capacity");
    this.sequence = sequence; this.bytes = bytes.slice(); this.offset = 0;
  }
  next(): MessageFragment | null {
    if (this.bytes === null) return null;
    const offset = this.offset;
    const end = Math.min(this.bytes.length, offset + this.fragmentBytes);
    const bytes = this.bytes.slice(offset, end);
    this.offset = end;
    const final = end === this.bytes.length && (!this.terminalEmptyFragment || bytes.length < this.fragmentBytes);
    if (final) this.bytes = null;
    return { sequence: this.sequence, offset, bytes, final };
  }
}

export class FragmentReceiver {
  private current = -1;
  private accepted = 0;
  private length = 0;
  private readonly storage: Uint8Array;
  constructor(readonly maxMessageBytes: number) {
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0) throw new RangeError("Invalid fragment receive capacity");
    this.storage = new Uint8Array(maxMessageBytes);
  }
  receive(fragment: MessageFragment): FragmentResult {
    if (fragment.sequence <= this.accepted) return { kind: "rejected", reason: "sequence" };
    if (fragment.sequence !== this.current) { this.current = fragment.sequence; this.length = 0; }
    if (fragment.offset !== this.length) return { kind: "rejected", reason: "order" };
    if (this.length + fragment.bytes.length > this.maxMessageBytes) return { kind: "rejected", reason: "length" };
    this.storage.set(fragment.bytes, this.length); this.length += fragment.bytes.length;
    if (!fragment.final) return { kind: "pending", byteLength: this.length };
    const bytes = this.storage.slice(0, this.length); this.length = 0; this.accepted = fragment.sequence;
    return { kind: "complete", sequence: fragment.sequence, bytes };
  }
  acceptUnfragmented(sequence: number): boolean {
    if (sequence <= this.accepted) return false;
    this.accepted = sequence; return true;
  }
}
