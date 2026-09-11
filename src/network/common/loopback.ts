// Multiple connection pairs preserve the rereleases' local split-screen clients.
import type { LoopbackAddress } from "./endpoint.ts";
import { PacketQueue, UNIFIED_DATAGRAM_LIMITS } from "./transport.ts";
import type { DatagramLimits, DatagramTransport, ReceiveEvent } from "./transport.ts";

export class LoopbackHub {
  private readonly endpoints = new Map<string, LoopbackTransport>();
  constructor(readonly limits: DatagramLimits = UNIFIED_DATAGRAM_LIMITS, readonly now: () => number = () => performance.now()) {}
  bind(id: string): LoopbackTransport {
    if (id.length === 0 || this.endpoints.has(id)) throw new Error("Loopback endpoint must have a unique nonempty name");
    const address: LoopbackAddress = Object.freeze({ kind: "loopback", id });
    const queue = new PacketQueue<LoopbackAddress>(this.limits, this.now);
    const transport = new LoopbackTransport(address, queue, (to, bytes) => {
      const peer = this.endpoints.get(to.id);
      if (peer === undefined) return false;
      peer.receive(address, bytes); return true;
    }, () => { this.endpoints.delete(id); });
    this.endpoints.set(id, transport); return transport;
  }
  close(): void { for (const endpoint of [...this.endpoints.values()]) endpoint.close(); }
}

export class LoopbackTransport implements DatagramTransport<LoopbackAddress> {
  private ended = false;
  constructor(readonly address: LoopbackAddress, private readonly queue: PacketQueue<LoopbackAddress>,
    private readonly deliver: (to: LoopbackAddress, payload: Uint8Array) => boolean, private readonly release: () => void) {}
  get closed(): boolean { return this.ended; }
  private opened(): void { if (this.ended) throw new Error("Loopback transport is closed"); }
  receive(from: LoopbackAddress, bytes: Uint8Array): void { this.opened(); this.queue.accept(from, bytes); }
  send(to: LoopbackAddress, payload: Uint8Array): boolean {
    this.opened();
    if (payload.length > this.queue.limits.maxBytes) throw new RangeError("Loopback message exceeds selected limit");
    return this.deliver(to, payload);
  }
  poll(): ReceiveEvent<LoopbackAddress> | null { this.opened(); return this.queue.poll(); }
  subscribeReadable(listener: () => void): () => void { this.opened(); return this.queue.subscribe(listener); }
  close(): void { if (!this.ended) { this.ended = true; this.release(); this.queue.close(); } }
}
