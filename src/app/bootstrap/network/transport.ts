import { bunNativeIpxCapability } from "../../../platform/ipx.ts";
import { ipxAddress, resolveAddress } from "../../../network/common/endpoint.ts";
import type { IpAddress, IpxAddress } from "../../../network/common/endpoint.ts";
import { DosBoxIpxNetwork } from "../../../network/common/ipx-dosbox.ts";
import { bindIpxTransport } from "../../../network/common/ipx-host.ts";
import type { NativeIpxCapability } from "../../../network/common/ipx-host.ts";
import { UdpTransport } from "../../../network/common/transport.ts";
import type { DatagramLimits, DatagramTransport, ReceiveEvent, UdpBindOptions } from "../../../network/common/transport.ts";
import type { SocksOptions } from "../../../network/common/socks.ts";

export type ApplicationNetworkTransport = { readonly kind: "udp" } | { readonly kind: "ipx-dosbox"; readonly relay: string } | { readonly kind: "ipx-native" };
export type ApplicationNetworkAddress = IpAddress | IpxAddress;
export type ApplicationNetworkFamily = "q1" | "qw" | "q2" | "q3";
export interface ApplicationUdpSocket extends DatagramTransport<IpAddress> { connectSocks(options: SocksOptions): Promise<void>; }
export interface ApplicationTransportCapabilities {
  readonly nativeIpx: NativeIpxCapability;
  bindUdp(options: UdpBindOptions): Promise<ApplicationUdpSocket>;
}
export const bunApplicationTransports: ApplicationTransportCapabilities = {
  nativeIpx: bunNativeIpxCapability(),
  bindUdp: options => UdpTransport.bind(options),
};

function checkFamily(selection: ApplicationNetworkTransport, family: ApplicationNetworkFamily): void {
  if (selection.kind !== "udp" && family === "qw") throw new Error("QuakeWorld uses UDP; IPX is not a QuakeWorld transport");
}

export function parseIpxRemote(text: string, defaultPort: number): IpxAddress {
  const match = /^(?:ipx:)?([0-9a-fA-F]{8})[.:]([0-9a-fA-F]{12})(?::([0-9]+))?$/.exec(text);
  const network = match?.[1], node = match?.[2], port = match?.[3];
  if (network === undefined || node === undefined) throw new Error("IPX address must be NETWORK.NODE[:SOCKET] with 8 and 12 hexadecimal digits");
  const byte = (offset: number): number => Number.parseInt(node.slice(offset, offset + 2), 16);
  return ipxAddress(Number.parseInt(network, 16), [byte(0), byte(2), byte(4), byte(6), byte(8), byte(10)],
    port === undefined ? defaultPort : Number(port));
}

export async function resolveApplicationAddress(text: string, defaultPort: number, selection: ApplicationNetworkTransport,
  family: ApplicationNetworkFamily): Promise<ApplicationNetworkAddress> {
  checkFamily(selection, family);
  return selection.kind === "udp" ? resolveAddress(text, defaultPort, family === "q3" ? 4 : 0) : parseIpxRemote(text, defaultPort);
}

type SocketOwner = { readonly kind: "udp"; readonly socket: ApplicationUdpSocket }
  | { readonly kind: "ipx"; readonly socket: DatagramTransport<IpxAddress>; readonly closeNetwork: () => void };

/** Both Application owners close the same object, including its DOSBox relay registration. */
export class ApplicationTransport implements DatagramTransport<ApplicationNetworkAddress> {
  constructor(private readonly owner: SocketOwner) {}
  get maxDatagramBytes(): number { return this.owner.socket.maxDatagramBytes ?? 65507; }
  get address(): ApplicationNetworkAddress { return this.owner.socket.address; }
  get closed(): boolean { return this.owner.socket.closed; }
  udpSocket(): ApplicationUdpSocket {
    if (this.owner.kind !== "udp") throw new Error("The selected source requires a UDP transport");
    return this.owner.socket;
  }
  send(to: ApplicationNetworkAddress, payload: Uint8Array): boolean {
    if (this.owner.kind === "ipx") {
      if (to.kind !== "ipx") throw new Error("An IPX transport requires an IPX destination");
      return this.owner.socket.send(to, payload);
    }
    if (to.kind === "ipx") throw new Error("An IPX destination requires an explicitly selected IPX transport");
    return this.owner.socket.send(to, payload);
  }
  poll(): ReceiveEvent<ApplicationNetworkAddress> | null { return this.owner.socket.poll(); }
  subscribeReadable(listener: () => void): () => void { return this.owner.socket.subscribeReadable(listener); }
  async connectSocks(options: SocksOptions): Promise<void> {
    if (this.owner.kind !== "udp") throw new Error("SOCKS proxying is not available for the selected IPX transport");
    await this.owner.socket.connectSocks(options);
  }
  close(): void {
    if (this.owner.kind === "udp") { this.owner.socket.close(); return; }
    try { this.owner.socket.close(); } finally { this.owner.closeNetwork(); }
  }
}

export async function openApplicationTransport(options: {
  readonly selection: ApplicationNetworkTransport; readonly family: ApplicationNetworkFamily; readonly host: string;
  readonly port: number; readonly limits: DatagramLimits; readonly signal?: AbortSignal;
}, capabilities: ApplicationTransportCapabilities = bunApplicationTransports): Promise<ApplicationTransport> {
  const selection = options.selection;
  checkFamily(selection, options.family);
  options.signal?.throwIfAborted();
  if (selection.kind === "udp") {
    const socket = await capabilities.bindUdp({ host: options.host, port: options.port, limits: options.limits });
    try { options.signal?.throwIfAborted(); return new ApplicationTransport({ kind: "udp", socket }); }
    catch (error) { socket.close(); throw error; }
  }
  const game = options.family === "q1" ? "quake1" : options.family === "q2" ? "quake2" : "quake3";
  if (selection.kind === "ipx-native") {
    const socket = await bindIpxTransport({ kind: "native", capability: capabilities.nativeIpx }, game, options.port);
    try { options.signal?.throwIfAborted(); return new ApplicationTransport({ kind: "ipx", socket, closeNetwork: () => {} }); }
    catch (error) { socket.close(); throw error; }
  }
  const relay = await resolveAddress(selection.relay, 213, 4);
  if (relay.kind !== "ipv4") throw new Error("DOSBox IPX relay must resolve to IPv4");
  options.signal?.throwIfAborted();
  const udp = await capabilities.bindUdp({ host: options.host, port: 0, limits: { maxBytes: 1424, queuePackets: options.limits.queuePackets } });
  const network = await DosBoxIpxNetwork.connect(udp, relay, options.signal === undefined ? {} : { signal: options.signal });
  try {
    options.signal?.throwIfAborted();
    const socket = await bindIpxTransport({ kind: "dosbox", network }, game, options.port);
    options.signal?.throwIfAborted();
    return new ApplicationTransport({ kind: "ipx", socket, closeNetwork: () => { network.close(); } });
  } catch (error) { network.close(); throw error; }
}
