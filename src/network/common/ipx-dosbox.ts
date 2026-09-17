// DOSBox IPXNET registration/routing from ipx.cpp and ipxserver.cpp. GPL-2.0-or-later.
import { ipxAddress, portNumber, sameAddress } from "./endpoint.ts";
import type { IpAddress, IpxAddress, Ipv4Address } from "./endpoint.ts";
import { decodeIpxPacket, encodeIpxPacket } from "./ipx.ts";
import type { IpxPacket } from "./ipx.ts";
import { PacketQueue } from "./transport.ts";
import type { DatagramTransport, ReceiveEvent } from "./transport.ts";

const DOSBOX_PACKET_BYTES = 1424;
const CONTROL = ipxAddress(0, [0, 0, 0, 0, 0, 0], 2);
function broadcast(address: IpxAddress): boolean { return address.node.every(byte => byte === 255); }

/** One DOSBox-assigned node, with the DOS IPX driver's separate application sockets. */
export class DosBoxIpxNetwork {
  private readonly sockets = new Map<number, DosBoxIpxSocket>();
  private readonly unsubscribe: () => void;
  private ended = false;
  private constructor(private readonly udp: DatagramTransport<IpAddress>, readonly server: Ipv4Address,
    readonly address: IpxAddress, private readonly now: () => number) {
    this.unsubscribe = udp.subscribeReadable(() => { this.receive(); });
  }

  /** Takes ownership of the UDP socket, including on cancellation or registration failure. */
  static async connect(udp: DatagramTransport<IpAddress>, server: Ipv4Address,
    options: { readonly signal?: AbortSignal; readonly timeoutMilliseconds?: number; readonly now?: () => number } = {}): Promise<DosBoxIpxNetwork> {
    try {
      if (udp.address.kind !== "ipv4") throw new Error("DOSBox IPX requires an IPv4 UDP socket");
      const timeout = options.timeoutMilliseconds ?? 5000;
      if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Invalid DOSBox registration timeout");
      options.signal?.throwIfAborted();
      const address = await new Promise<IpxAddress>((resolve, reject) => {
        let done = false;
        const finish = (result: IpxAddress | Error): void => {
          if (done) return;
          done = true; clearTimeout(timer); unsubscribe(); options.signal?.removeEventListener("abort", abort);
          if (result instanceof Error) reject(result); else resolve(result);
        };
        const abort = (): void => { finish(new Error("DOSBox IPX registration aborted")); };
        const read = (): void => {
          if (udp.closed) { finish(new Error("DOSBox IPX registration socket closed")); return; }
          while (!done) {
            const event = udp.poll();
            if (event === null) return;
            if (event.kind === "error") { finish(event.error); return; }
            if (event.kind !== "packet" || !sameAddress(event.from, server)) continue;
            const packet = decodeIpxPacket(event.payload);
            if (packet === null || packet.payload.length !== 0 || packet.from.port !== 2 || packet.to.port !== 2
              || packet.from.network !== 1 || packet.to.node.every(byte => byte === 0) || broadcast(packet.to)) continue;
            finish(packet.to);
          }
        };
        const timer = setTimeout(() => { finish(new Error("DOSBox IPX registration timed out")); }, timeout);
        const unsubscribe = udp.subscribeReadable(read);
        options.signal?.addEventListener("abort", abort, { once: true });
        try {
          const packet = encodeIpxPacket({ from: CONTROL, to: CONTROL, hops: 0, packetType: 0, payload: new Uint8Array() });
          if (!udp.send(server, packet)) finish(new Error("DOSBox IPX registration send failed"));
          else read();
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
      return new DosBoxIpxNetwork(udp, server, address, options.now ?? (() => performance.now()));
    } catch (error) { udp.close(); throw error; }
  }

  get closed(): boolean { return this.ended; }
  bind(requestedPort: number, packetType: number): DatagramTransport<IpxAddress> {
    if (this.ended) throw new Error("DOSBox IPX network is closed");
    portNumber(requestedPort, true);
    if (!Number.isInteger(packetType) || packetType < 0 || packetType > 255) throw new RangeError("Invalid IPX packet type");
    if (this.sockets.size >= 150) throw new Error("DOSBox IPX socket table is full");
    let port = requestedPort;
    if (port === 0) {
      port = 0x4002;
      while (this.sockets.has(port) && port < 0x7fff) port++;
    }
    if (port === 2 || this.sockets.has(port)) throw new Error("IPX socket is already bound or reserved");
    const socket = new DosBoxIpxSocket(ipxAddress(this.address.network, this.address.node, port), this,
      packetType, this.now, () => { this.sockets.delete(port); });
    this.sockets.set(port, socket);
    this.receive();
    return socket;
  }

  send(packet: IpxPacket): boolean {
    if (this.ended) throw new Error("DOSBox IPX network is closed");
    if (packet.payload.length + 30 > DOSBOX_PACKET_BYTES) {
      this.sockets.get(packet.from.port)?.error(new RangeError("Packet exceeds DOSBox IPX capacity (1394 payload bytes)"));
      return false;
    }
    const local = sameAddress(packet.to, this.address, false), bytes = encodeIpxPacket(packet);
    const sent = local || this.udp.send(this.server, bytes);
    if (local || broadcast(packet.to)) this.deliver(packet);
    return sent;
  }

  receive(): void {
    if (this.ended) return;
    if (this.udp.closed) { this.close(); return; }
    while (!this.ended) {
      const event = this.udp.poll();
      if (event === null) return;
      if (event.kind === "error") { for (const socket of this.sockets.values()) socket.error(event.error); continue; }
      if (event.kind !== "packet" || !sameAddress(event.from, this.server) || event.payload.length > DOSBOX_PACKET_BYTES) continue;
      const packet = decodeIpxPacket(event.payload);
      if (packet !== null) this.deliver(packet);
    }
  }

  private deliver(packet: IpxPacket): void {
    const local = sameAddress(packet.to, this.address, false);
    if (!local && !(broadcast(packet.to) && (packet.to.network === 0 || packet.to.network === this.address.network))) return;
    if (packet.to.port === 2) {
      if (broadcast(packet.to) && packet.from.port === 2 && packet.payload.length === 0)
        this.udp.send(this.server, encodeIpxPacket({ from: this.address, to: packet.from, hops: 0, packetType: 0, payload: new Uint8Array() }));
      return;
    }
    this.sockets.get(packet.to.port)?.accept(packet);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true; this.unsubscribe();
    try { for (const socket of [...this.sockets.values()]) socket.close(); }
    finally { this.udp.close(); }
  }
}

class DosBoxIpxSocket implements DatagramTransport<IpxAddress> {
  readonly maxDatagramBytes = DOSBOX_PACKET_BYTES - 30;
  private ended = false;
  private readonly queue: PacketQueue<IpxAddress>;
  constructor(readonly address: IpxAddress, private readonly network: DosBoxIpxNetwork, private readonly packetType: number,
    now: () => number, private readonly release: () => void) {
    this.queue = new PacketQueue({ maxBytes: DOSBOX_PACKET_BYTES - 30, queuePackets: 256 }, now);
  }
  get closed(): boolean { return this.ended; }
  private opened(): void { if (this.ended) throw new Error("DOSBox IPX socket is closed"); }
  accept(packet: IpxPacket): void { this.queue.accept(packet.from, packet.payload); }
  error(error: Error): void { this.queue.push({ kind: "error", error }); }
  send(to: IpxAddress, payload: Uint8Array): boolean {
    this.opened();
    return this.network.send({ from: this.address, to, packetType: this.packetType, hops: 0, payload });
  }
  poll(): ReceiveEvent<IpxAddress> | null { this.opened(); this.network.receive(); return this.queue.poll(); }
  subscribeReadable(listener: () => void): () => void { this.opened(); return this.queue.subscribe(listener); }
  close(): void { if (this.ended) return; this.ended = true; this.release(); this.queue.close(); }
}
