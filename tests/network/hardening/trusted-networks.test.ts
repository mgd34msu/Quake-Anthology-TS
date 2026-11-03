// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createClientDownloadPermission } from "../../../src/app/bootstrap/network/client-download-policy.ts";
import { isPrivateNetworkAddress } from "../../../src/network/common/endpoint.ts";
import type { NetworkAddress } from "../../../src/network/common/endpoint.ts";
import type { DatagramTransport, ReceiveEvent } from "../../../src/network/common/transport.ts";
import { KexLanTransport } from "../../../src/network/q2/kex/lan.ts";
import { KexWriter, writeKexPacket } from "../../../src/network/q2/kex/packet.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const publicPeer: NetworkAddress = { kind: "ipv4", host: [203, 0, 113, 9], port: 4000 };
const lanPeer: NetworkAddress = { kind: "ipv4", host: [192, 168, 1, 5], port: 4000 };

class ScriptedTransport implements DatagramTransport<NetworkAddress> {
  readonly address: NetworkAddress = { kind: "loopback", id: "host" };
  readonly closed = false;
  readonly sent: NetworkAddress[] = [];
  private readonly incoming: ReceiveEvent<NetworkAddress>[] = [];
  private listener: () => void = () => {};
  send(to: NetworkAddress): boolean {
    this.sent.push(to);
    return true;
  }
  poll(): ReceiveEvent<NetworkAddress> | null {
    return this.incoming.shift() ?? null;
  }
  subscribeReadable(listener: () => void): () => void {
    this.listener = listener;
    return () => {};
  }
  close(): void {}
  deliver(from: NetworkAddress, payload: Uint8Array): void {
    this.incoming.push({ kind: "packet", from, payload, receivedAt: performance.now() });
    this.listener();
  }
}

test("private-address classification covers loopback, RFC 1918, link-local, unique-local and public hosts", () => {
  expect(isPrivateNetworkAddress(lanPeer)).toBe(true);
  expect(isPrivateNetworkAddress({ kind: "loopback", id: "a" })).toBe(true);
  expect(isPrivateNetworkAddress({ kind: "ipv6", host: "fe80::1", port: 1 })).toBe(true);
  expect(isPrivateNetworkAddress({ kind: "ipv6", host: "2001:db8::1", port: 1 })).toBe(false);
  expect(isPrivateNetworkAddress(publicPeer)).toBe(false);
});

for (const trusted of [false, true])
  test(`KEX LAN host ${trusted ? "ignores" : "answers"} lobby queries from a public address with --lan-only ${trusted ? "on" : "off"}`, () => {
    const transport = new ScriptedTransport();
    const lan = new KexLanTransport(transport, {
      role: "host",
      localPlayers: 0,
      maxPlayers: 8,
      name: "Quake II",
      ...(trusted ? { trustedNetworksOnly: true } : {}),
    });
    const query = writeKexPacket({ flags: 0, sequence: 0, reliable: 0, kind: 129, payload: new KexWriter().string("CRANTIME").string("QuakeII").finish() });
    transport.deliver(publicPeer, query);
    expect(transport.sent.length).toBe(trusted ? 0 : 1);
    transport.deliver(lanPeer, query);
    expect(transport.sent.length).toBe(trusted ? 1 : 2);
    lan.close();
  });

test("--lan-only reaches the application options", () => {
  const command = parseApplicationCommand(["--listen", "27500", "--lan-only"]);
  expect(command.kind === "run" && command.options.trustedNetworksOnly).toBe(true);
});

test("cl_http_package_downloads gates only HTTP package transfers and defaults on", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: createIdentityOwner("packages").session, origin: { kind: "local-console" } } });
  const permission = createClientDownloadPermission(cvars, "q2");
  expect(permission({ transport: "http", category: "package" })).toBe(true);
  cvars.set("cl_http_package_downloads", "0");
  expect(permission({ transport: "http", category: "package" })).toBe(false);
  expect(permission({ transport: "http", category: "map" })).toBe(true);
  expect(permission({ transport: "native", category: "package" })).toBe(true);
});
