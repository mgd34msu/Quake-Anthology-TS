import { parseNetworkAddress } from "../../network/common/endpoint.ts";
import type { IpAddress } from "../../network/common/endpoint.ts";
import { isUnknownArray } from "../../network/common/value.ts";

export interface DirectServerAddress {
  readonly remote: string;
  readonly address: IpAddress;
}
export const maximumDirectServers = 16;

export function directServerText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || /\s|[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid direct server address");
  return value;
}

export function readDirectServers(text: string): readonly DirectServerAddress[] {
  if (text.length > 65536) throw new Error("Saved direct server list is too large");
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1
    || !("servers" in value) || !isUnknownArray(value.servers) || value.servers.length > maximumDirectServers) throw new Error("Invalid direct server list");
  return value.servers.map(value => {
    if (typeof value !== "object" || value === null || !("remote" in value) || !("address" in value)) throw new Error("Invalid direct server entry");
    const remote = directServerText(value.remote), address = parseNetworkAddress(value.address);
    if (address.kind !== "ipv4" && address.kind !== "ipv6") throw new Error("Direct server requires an IP address");
    return { remote, address };
  });
}
