// Quake net_wipx.c sequencing and Q2/Q3 net_wins.c datagrams. GPL-2.0-or-later.
import type { IpxAddress } from "./endpoint.ts";
import { portNumber } from "./endpoint.ts";
import type { DatagramTransport, ReceiveEvent } from "./transport.ts";
import { UnsupportedTransportError } from "./transport.ts";
import type { DosBoxIpxNetwork } from "./ipx-dosbox.ts";

export type IpxGame = "quake1" | "quake2" | "quake3";

/** Raw AF_IPX socket payloads: host owns nonblocking I/O, broadcast and packet type. */
export type NativeIpxCapability =
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "available"; bind(options: { readonly port: number; readonly packetType: number; readonly broadcast: true }): Promise<DatagramTransport<IpxAddress>> };

export type IpxHost = { readonly kind: "native"; readonly capability: NativeIpxCapability }
  | { readonly kind: "dosbox"; readonly network: DosBoxIpxNetwork };

/** Applies only the game payload contract; the selected host retains its real IPX addresses. */
export class IpxGameTransport implements DatagramTransport<IpxAddress> {
  private sequence = 0;
  constructor(private readonly socket: DatagramTransport<IpxAddress>, readonly game: IpxGame) {}
  get maxDatagramBytes(): number { return (this.socket.maxDatagramBytes ?? 65507) - (this.game === "quake1" ? 4 : 0); }
  get address(): IpxAddress { return this.socket.address; }
  get closed(): boolean { return this.socket.closed; }
  send(to: IpxAddress, payload: Uint8Array): boolean {
    if (this.game !== "quake1") return this.socket.send(to, payload);
    const packet = new Uint8Array(payload.length + 4);
    new DataView(packet.buffer).setUint32(0, this.sequence++ >>> 0, true);
    packet.set(payload, 4);
    return this.socket.send(to, packet);
  }
  poll(): ReceiveEvent<IpxAddress> | null {
    while (true) {
      const event = this.socket.poll();
      if (this.game !== "quake1" || event?.kind !== "packet") return event;
      if (event.payload.length >= 4) return { ...event, payload: event.payload.slice(4) };
    }
  }
  subscribeReadable(listener: () => void): () => void { return this.socket.subscribeReadable(listener); }
  close(): void { this.socket.close(); }
}

export async function bindIpxTransport(host: IpxHost, game: IpxGame, port: number): Promise<DatagramTransport<IpxAddress>> {
  portNumber(port, true);
  const packetType = game === "quake1" ? 4 : 0;
  if (host.kind === "dosbox") return new IpxGameTransport(host.network.bind(port, packetType), game);
  if (host.capability.kind === "unavailable") throw new UnsupportedTransportError("ipx-native", host.capability.reason);
  return new IpxGameTransport(await host.capability.bind({ port, packetType, broadcast: true }), game);
}
