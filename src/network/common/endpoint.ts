// SPDX-License-Identifier: GPL-2.0-or-later
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isUnknownArray } from "./value.ts";

export type Ipv4Host = readonly [number, number, number, number];
export interface Ipv4Address { readonly kind: "ipv4"; readonly host: Ipv4Host; readonly port: number; }
export interface Ipv6Address { readonly kind: "ipv6"; readonly host: string; readonly port: number; }
export interface LoopbackAddress { readonly kind: "loopback"; readonly id: string; }
export interface IpxAddress { readonly kind: "ipx"; readonly network: number; readonly node: readonly [number, number, number, number, number, number]; readonly port: number; }
export type IpAddress = Ipv4Address | Ipv6Address;
export type NetworkAddress = IpAddress | LoopbackAddress | IpxAddress;

export function portNumber(port: number, allowZero = false): number {
  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) throw new RangeError("Invalid network port");
  return port;
}

export function ipv4Address(host: Ipv4Host, port: number, allowZero = false): Ipv4Address {
  if (host.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError("Invalid IPv4 octet");
  const copy: Ipv4Host = [host[0], host[1], host[2], host[3]];
  return Object.freeze({ kind: "ipv4", host: Object.freeze(copy), port: portNumber(port, allowZero) });
}

export function ipAddress(host: string, port: number, allowZero = false): IpAddress {
  const family = isIP(host);
  if (family === 6) {
    // URL canonicalizes equivalent compressed IPv6 spellings. Preserve interface scope.
    const [literal, scope] = host.split("%");
    if (literal === undefined) throw new RangeError("Invalid IPv6 host");
    const normalized = new URL(`http://[${literal}]/`).hostname.slice(1, -1);
    return Object.freeze({ kind: "ipv6", host: scope === undefined ? normalized : `${normalized}%${scope}`, port: portNumber(port, allowZero) });
  }
  if (family !== 4) throw new RangeError(`Expected an IP literal: ${host}`);
  const [a, b, c, d] = host.split(".").map(Number);
  if (a === undefined || b === undefined || c === undefined || d === undefined) throw new RangeError("Invalid IPv4 address");
  return ipv4Address([a, b, c, d], port, allowZero);
}

export function ipxAddress(network: number, node: IpxAddress["node"], port: number): IpxAddress {
  if (!Number.isInteger(network) || network < 0 || network > 0xffffffff || node.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError("Invalid IPX address");
  const copy: IpxAddress["node"] = [node[0], node[1], node[2], node[3], node[4], node[5]];
  return Object.freeze({ kind: "ipx", network, node: Object.freeze(copy), port: portNumber(port) });
}

export function addressHost(address: IpAddress): string { return address.kind === "ipv4" ? address.host.join(".") : address.host; }
export function addressKey(address: NetworkAddress, includePort = true): string {
  switch (address.kind) {
    case "loopback": return `loopback:${address.id}`;
    case "ipv4": return `${address.host.join(".")}${includePort ? `:${address.port}` : ""}`;
    case "ipv6": return `[${address.host}]${includePort ? `:${address.port}` : ""}`;
    case "ipx": return `ipx:${address.network.toString(16).padStart(8, "0")}:${address.node.map(value => value.toString(16).padStart(2, "0")).join("")}${includePort ? `:${address.port}` : ""}`;
  }
}
export function sameAddress(left: NetworkAddress, right: NetworkAddress, includePort = true): boolean {
  return left.kind === right.kind && addressKey(left, includePort) === addressKey(right, includePort);
}

/** Boundary for saved favorites and configured service endpoints. */
export function parseNetworkAddress(value: unknown): NetworkAddress {
  if (typeof value !== "object" || value === null || !("kind" in value)) throw new RangeError("Invalid network address record");
  if (value.kind === "loopback" && "id" in value && typeof value.id === "string" && value.id.length > 0) return Object.freeze({ kind: "loopback", id: value.id });
  if (!("port" in value) || typeof value.port !== "number") throw new RangeError("Network address has no port");
  if (value.kind === "ipv6" && "host" in value && typeof value.host === "string") {
    const address = ipAddress(value.host, value.port);
    if (address.kind !== "ipv6") throw new RangeError("IPv6 record contains another address family");
    return address;
  }
  if (value.kind === "ipv4" && "host" in value && isUnknownArray(value.host)) {
    const bytes: readonly unknown[] = value.host;
    const [a, b, c, d] = bytes;
    if (bytes.length === 4 && typeof a === "number" && typeof b === "number" && typeof c === "number" && typeof d === "number") return ipv4Address([a, b, c, d], value.port);
  }
  if (value.kind === "ipx" && "node" in value && isUnknownArray(value.node) && "network" in value && typeof value.network === "number") {
    const bytes: readonly unknown[] = value.node;
    const [a, b, c, d, e, f] = bytes;
    if (bytes.length === 6 && typeof a === "number" && typeof b === "number" && typeof c === "number" && typeof d === "number" && typeof e === "number" && typeof f === "number") return ipxAddress(value.network, [a, b, c, d, e, f], value.port);
  }
  throw new RangeError("Invalid network address fields");
}

export async function resolveAddress(text: string, defaultPort: number, family: 0 | 4 | 6 = 0): Promise<IpAddress> {
  let host = text, port = defaultPort;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) throw new RangeError("Unclosed IPv6 address");
    host = text.slice(1, end);
    const suffix = text.slice(end + 1);
    if (suffix.length > 0) {
      if (!/^:\d+$/.test(suffix)) throw new RangeError("Invalid address port");
      port = Number(suffix.slice(1));
    }
  } else if (text.indexOf(":") === text.lastIndexOf(":") && text.includes(":")) {
    const separator = text.lastIndexOf(":");
    host = text.slice(0, separator);
    const suffix = text.slice(separator + 1);
    if (!/^\d+$/.test(suffix)) throw new RangeError("Invalid address port");
    port = Number(suffix);
  }
  portNumber(port);
  if (isIP(host) !== 0) {
    const result = ipAddress(host, port);
    if (family !== 0 && (result.kind === "ipv4" ? 4 : 6) !== family) throw new RangeError("Address family does not match selection");
    return result;
  }
  const resolved = await lookup(host, { family });
  return ipAddress(resolved.address, port);
}
