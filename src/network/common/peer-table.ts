// SPDX-License-Identifier: GPL-2.0-or-later
import { IdIndex } from "../../foundation/id-index.ts";
import type { NetworkAddress } from "./endpoint.ts";

const KIND_IPV4 = 1,
  KIND_IPV6 = 2,
  KIND_LOOPBACK = 3,
  KIND_IPX = 4;

function textHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

/**
 * Fixed-capacity peer slots keyed by network address without its port. Slot numbers index caller-owned typed
 * arrays, so per-peer state needs no string keys, maps or per-lookup allocation. Exhaustion is explicit (-1).
 */
export class PeerTable {
  private readonly index = new IdIndex();
  private readonly kinds: Uint8Array;
  private readonly first: Uint32Array;
  private readonly second: Uint32Array;
  private readonly third: Uint32Array;
  private readonly names: (string | null)[];
  private readonly free: Int32Array;
  private readonly used: Uint8Array;
  private freeCount: number;
  /** Admission order of each live slot; the lowest value is the oldest peer. */
  readonly born: Float64Array;
  private sequence = 0;

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Peer table capacity must be a positive safe integer");
    this.index.reserve(capacity);
    this.kinds = new Uint8Array(capacity);
    this.first = new Uint32Array(capacity);
    this.second = new Uint32Array(capacity);
    this.third = new Uint32Array(capacity);
    this.names = new Array<string | null>(capacity).fill(null);
    this.free = new Int32Array(capacity);
    this.used = new Uint8Array(capacity);
    this.born = new Float64Array(capacity);
    for (let slot = 0; slot < capacity; slot++) this.free[slot] = capacity - 1 - slot;
    this.freeCount = capacity;
  }

  get count(): number {
    return this.capacity - this.freeCount;
  }
  live(slot: number): boolean {
    return this.used[slot] === 1;
  }

  private static kindOf(address: NetworkAddress): number {
    switch (address.kind) {
      case "ipv4":
        return KIND_IPV4;
      case "ipv6":
        return KIND_IPV6;
      case "loopback":
        return KIND_LOOPBACK;
      case "ipx":
        return KIND_IPX;
    }
  }
  private static firstWord(address: NetworkAddress): number {
    switch (address.kind) {
      case "ipv4":
        return ((address.host[0] << 24) | (address.host[1] << 16) | (address.host[2] << 8) | address.host[3]) >>> 0;
      case "ipv6":
        return textHash(address.host);
      case "loopback":
        return textHash(address.id);
      case "ipx":
        return address.network >>> 0;
    }
  }
  private static secondWord(address: NetworkAddress): number {
    return address.kind === "ipx" ? ((address.node[0] << 24) | (address.node[1] << 16) | (address.node[2] << 8) | address.node[3]) >>> 0 : 0;
  }
  private static thirdWord(address: NetworkAddress): number {
    return address.kind === "ipx" ? (address.node[4] << 8) | address.node[5] : 0;
  }
  private static nameOf(address: NetworkAddress): string | null {
    return address.kind === "ipv6" ? address.host : address.kind === "loopback" ? address.id : null;
  }
  private matches(slot: number, address: NetworkAddress): boolean {
    return (
      this.kinds[slot] === PeerTable.kindOf(address) &&
      this.first[slot] === PeerTable.firstWord(address) &&
      this.second[slot] === PeerTable.secondWord(address) &&
      this.third[slot] === PeerTable.thirdWord(address) &&
      this.names[slot] === PeerTable.nameOf(address)
    );
  }

  /** Returns the slot holding this address, or -1. */
  find(address: NetworkAddress): number {
    const kind = PeerTable.kindOf(address),
      cursor = this.index.begin(PeerTable.firstWord(address), kind);
    for (let slot = this.index.next(cursor); slot >= 0; slot = this.index.next(cursor)) if (this.matches(slot, address)) return slot;
    return -1;
  }

  /** Returns the existing slot or admits the address into a free one; -1 when the table is full. */
  claim(address: NetworkAddress): number {
    const known = this.find(address);
    if (known >= 0 || this.freeCount === 0) return known;
    const slot = this.free[--this.freeCount] ?? -1;
    if (slot < 0) return -1;
    this.kinds[slot] = PeerTable.kindOf(address);
    this.first[slot] = PeerTable.firstWord(address);
    this.second[slot] = PeerTable.secondWord(address);
    this.third[slot] = PeerTable.thirdWord(address);
    this.names[slot] = PeerTable.nameOf(address);
    this.used[slot] = 1;
    this.born[slot] = this.sequence++;
    this.index.insert(this.first[slot] ?? 0, this.kinds[slot] ?? 0, slot);
    return slot;
  }

  /** Slot of the longest-resident peer, or -1 when empty. */
  oldest(): number {
    let best = -1;
    for (let slot = 0; slot < this.capacity; slot++) if (this.used[slot] === 1 && (best < 0 || (this.born[slot] ?? 0) < (this.born[best] ?? 0))) best = slot;
    return best;
  }

  release(slot: number): void {
    if (this.used[slot] !== 1) return;
    this.index.removeValue(this.first[slot] ?? 0, this.kinds[slot] ?? 0, slot);
    this.free[this.freeCount++] = slot;
    this.used[slot] = 0;
    this.names[slot] = null;
  }

  /** Frees every live slot for which keep returns false in one index rebuild. Returns the number freed. */
  retain(keep: (slot: number) => boolean): number {
    let removed = 0;
    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.used[slot] !== 1 || keep(slot)) continue;
      this.used[slot] = 0;
      this.names[slot] = null;
      this.free[this.freeCount++] = slot;
      removed++;
    }
    if (removed > 0) this.index.retain((_key, _discriminator, value) => this.used[value] === 1);
    return removed;
  }

  clear(): void {
    this.retain(() => false);
  }
}
