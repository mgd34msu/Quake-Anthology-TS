import { expect, test } from "bun:test";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { openApplicationTransport, parseIpxRemote, resolveApplicationAddress } from "../../src/app/bootstrap/network/transport.ts";
import type { ApplicationTransportCapabilities, ApplicationUdpSocket } from "../../src/app/bootstrap/network/transport.ts";
import { ipxAddress, ipv4Address } from "../../src/network/common/endpoint.ts";
import type { IpAddress, IpxAddress, NetworkAddress } from "../../src/network/common/endpoint.ts";
import { decodeIpxPacket } from "../../src/network/common/ipx.ts";
import { PacketQueue } from "../../src/network/common/transport.ts";
import type { DatagramTransport, ReceiveEvent } from "../../src/network/common/transport.ts";

class MemorySocket<TAddress extends NetworkAddress> implements DatagramTransport<TAddress> {
  readonly queue = new PacketQueue<TAddress>({ maxBytes: 65507, queuePackets: 256 }, () => 1);
  readonly sent: { readonly to: TAddress; readonly payload: Uint8Array }[] = [];
  closed = false;
  constructor(readonly address: TAddress) {}
  send(to: TAddress, payload: Uint8Array): boolean { this.sent.push({ to, payload: payload.slice() }); return true; }
  poll(): ReceiveEvent<TAddress> | null { return this.queue.poll(); }
  subscribeReadable(listener: () => void): () => void { return this.queue.subscribe(listener); }
  close(): void { if (this.closed) return; this.closed = true; this.queue.close(); }
}
class MemoryUdp extends MemorySocket<IpAddress> implements ApplicationUdpSocket {
  socks = 0;
  registration = false;
  async connectSocks(): Promise<void> { this.socks++; }
  override send(to: IpAddress, payload: Uint8Array): boolean {
    super.send(to, payload);
    if (this.registration && this.sent.length === 1) this.queue.accept(to,
      Uint8Array.from([255, 255, 0, 30, 0, 0, 0, 0, 0, 0, 127, 0, 0, 1, 160, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 213, 0, 2]));
    return true;
  }
}
const limits = { maxBytes: 4096, queuePackets: 256 };
const proxy = { server: "localhost", port: 1080, username: "", password: "" };

test("application parser keeps explicit IPX backend separate from source protocol", () => {
  const selected = parseApplicationCommand(["--connect-q2", "00000000:001122334455:27910", "--ipx-dosbox", "127.0.0.1:213", "--q2-protocol", "36"]);
  if (selected.kind !== "run") throw new Error("Expected remote launch");
  expect(selected.options.networkTransport).toEqual({ kind: "ipx-dosbox", relay: "127.0.0.1:213" });
  expect(selected.options.network).toEqual({ kind: "q2-client", remote: "00000000:001122334455:27910" });
  expect(selected.options.q2Protocol).toEqual({ kind: "q2-q2pro", version: 36, revision: 1026 });
  const native = parseApplicationCommand(["--ipx-native", "--listen", "26000", "--game", "q1-classic-id1"]);
  if (native.kind !== "run") throw new Error("Expected native listener");
  expect(native.options.networkTransport).toEqual({ kind: "ipx-native" });
  expect(() => parseApplicationCommand(["--ipx-native", "--ipx-dosbox", "localhost", "--listen", "26000"])).toThrow("one IPX");
  expect(() => parseApplicationCommand(["--ipx-native"])).toThrow("requires --listen");
  expect(() => parseApplicationCommand(["--ipx-native", "--connect-qw", "00000000:001122334455:27500"])).toThrow("QuakeWorld");
});

test("source IPX addresses preserve network/node/socket and never resolve as UDP", async () => {
  const expected = ipxAddress(0x12345678, [0, 17, 34, 51, 68, 255], 26000);
  expect(parseIpxRemote("12345678:0011223344ff", 26000)).toEqual(expected);
  expect(await resolveApplicationAddress("ipx:12345678:0011223344FF:26000", 27960, { kind: "ipx-native" }, "q3")).toEqual(expected);
  for (const invalid of ["localhost:27960", "0000:001122334455", "00000000:001122334455:0", "00000000:001122334455:65536", "00000000:0011223344zz:1"])
    expect(() => parseIpxRemote(invalid, 26000)).toThrow();
  await expect(resolveApplicationAddress("12345678:0011223344ff", 27500, { kind: "ipx-native" }, "qw")).rejects.toThrow("QuakeWorld");
});

test("application DOSBox transport sends source payloads and owns the relay through close", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[]) {
    const udp = new MemoryUdp(ipv4Address([127, 0, 0, 1], 40961)); udp.registration = true;
    const capabilities: ApplicationTransportCapabilities = { nativeIpx: { kind: "unavailable", reason: "test host" }, bindUdp: async options => {
      expect(options.port).toBe(0); expect(options.limits?.maxBytes).toBe(1424); return udp;
    } };
    const transport = await openApplicationTransport({ selection: { kind: "ipx-dosbox", relay: "127.0.0.1:213" }, family, host: "0.0.0.0", port: 26000, limits }, capabilities);
    const remote = parseIpxRemote("00000000:7f000001a002:26000", 26000);
    transport.send(remote, Uint8Array.of(1, 2));
    const sent = udp.sent.at(-1);
    if (sent === undefined) throw new Error("Missing IPX packet");
    expect(sent.to).toEqual(ipv4Address([127, 0, 0, 1], 213));
    expect(decodeIpxPacket(sent.payload)?.payload).toEqual(family === "q1" ? Uint8Array.of(0, 0, 0, 0, 1, 2) : Uint8Array.of(1, 2));
    await expect(transport.connectSocks(proxy)).rejects.toThrow("SOCKS");
    expect(() => transport.udpSocket()).toThrow("requires a UDP");
    expect(() => transport.send(ipv4Address([127, 0, 0, 1], 26000), new Uint8Array())).toThrow("IPX destination");
    transport.close(); transport.close(); expect(udp.closed).toBe(true);
  }
});

test("application UDP keeps SOCKS and native IPX never falls back to UDP", async () => {
  const udp = new MemoryUdp(ipv4Address([127, 0, 0, 1], 27000));
  let binds = 0;
  const capabilities: ApplicationTransportCapabilities = { nativeIpx: { kind: "unavailable", reason: "no AF_IPX" }, bindUdp: async () => { binds++; return udp; } };
  await expect(openApplicationTransport({ selection: { kind: "ipx-native" }, family: "q2", host: "0.0.0.0", port: 27910, limits }, capabilities)).rejects.toThrow("no AF_IPX");
  expect(binds).toBe(0);
  const transport = await openApplicationTransport({ selection: { kind: "udp" }, family: "q2", host: "0.0.0.0", port: 27910, limits }, capabilities);
  await transport.connectSocks(proxy); expect(udp.socks).toBe(1);
  expect(transport.udpSocket()).toBe(udp);
  expect(() => transport.send(parseIpxRemote("00000000:001122334455", 27910), new Uint8Array())).toThrow("explicitly selected");
  transport.close(); expect(udp.closed).toBe(true);
});

test("application cancellation closes a socket allocated while cancellation arrived", async () => {
  const controller = new AbortController(), udp = new MemoryUdp(ipv4Address([127, 0, 0, 1], 27000));
  const capabilities: ApplicationTransportCapabilities = { nativeIpx: { kind: "unavailable", reason: "no AF_IPX" }, bindUdp: async () => { controller.abort(); return udp; } };
  await expect(openApplicationTransport({ selection: { kind: "udp" }, family: "q1", host: "0.0.0.0", port: 26000, limits, signal: controller.signal }, capabilities)).rejects.toThrow();
  expect(udp.closed).toBe(true);
});


test("native NetQuake client preserves IPX identity when the accept changes its socket", async () => {
  const { Q1ClientNetwork } = await import("../../src/app/bootstrap/network/q1-client.ts");
  const { encodeNetQuakeControl, decodeNetQuakeControl } = await import("../../src/network/q1/handshake.ts");
  const remote = parseIpxRemote("12345678.001122334455:26000", 26000);
  const socket = new MemorySocket<IpAddress | IpxAddress>(ipxAddress(0x12345678, [0, 1, 2, 3, 4, 5], 16386));
  const client = new Q1ClientNetwork({ transport: socket, remote,
    seat: { name: "IPX fixture", color: 0, spawnParameters: "", extensionFlags: null },
    host: { receive: async () => {}, command: () => { throw new Error("No movement before signon"); }, disconnected: () => {} } });
  try {
    await client.poll(0);
    const request = socket.sent[0]; if (request === undefined) throw new Error("Missing native connect");
    expect(request.to).toEqual(remote);
    expect(decodeNetQuakeControl(request.payload)).toEqual({ kind: "connect-request", game: "QUAKE", version: 3 });
    socket.queue.accept(remote, encodeNetQuakeControl({ kind: "accept", port: 26001 }));
    await client.poll(1);
    expect(client.serverAddress).toEqual({ ...remote, port: 26001 });
    expect(client.phase).toBe("loading");
    client.command("prespawn"); await client.poll(2);
    expect(socket.sent.at(-1)?.to).toEqual({ ...remote, port: 26001 });
  } finally { client.close(); }
  expect(socket.closed).toBe(true);
});
