import { addressKey, parseNetworkAddress } from "../../network/common/endpoint.ts";
import type { NetworkAddress } from "../../network/common/endpoint.ts";
import type { BrowserEntry, DiscoverySource, ServerStatus } from "../../network/services/discovery.ts";
import type { Q3BrowserCacheView } from "../../network/q3/browser-view.ts";
import { Q3_PROTOCOL } from "../../network/q3/adapters.ts";
import { isUnknownArray } from "../../network/common/value.ts";

export interface Q3BrowserCache { readonly entries: readonly BrowserEntry[]; readonly view: Q3BrowserCacheView | null; }
const maximumBytes = 8 << 20;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid browser cache object");
  return value;
}
function array(value: unknown): readonly unknown[] {
  if (!isUnknownArray(value)) throw new Error("Invalid browser cache array");
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid browser cache integer");
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new Error("Invalid browser cache text");
  return value;
}
function address(value: unknown): NetworkAddress {
  const result = parseNetworkAddress(value);
  if (result.kind !== "ipv4" || result.port === 0) throw new Error("Browser cache requires an IPv4 endpoint");
  return result;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid browser cache time");
  return value;
}
function status(value: unknown): ServerStatus | null {
  if (value === null) return null;
  const source = record(value), rules = new Map<string, string>();
  if (source["protocol"] !== 68) throw new Error("Browser cache status requires Q3 protocol 68");
  const pairs = array(source["rules"]);
  if (pairs.length > 1024) throw new Error("Too many browser cache rules");
  for (const pair of pairs) { const fields = array(pair); if (fields.length !== 2) throw new Error("Invalid browser cache rule"); rules.set(text(fields[0], 1024), text(fields[1], 8192)); }
  const players = array(source["playerDetails"]);
  if (players.length > 1024) throw new Error("Too many browser cache players");
  return { name: text(source["name"], 1024), map: text(source["map"], 1024), players: integer(source["players"], 0, 1024), maxPlayers: integer(source["maxPlayers"], 0, 1024), rules,
    playerDetails: players.map(value => { const player = record(value); return { name: text(player["name"], 1024), score: integer(player["score"], -0x80000000, 0x7fffffff), ping: integer(player["ping"], -0x80000000, 0x7fffffff) }; }),
    wire: { kind: "source", protocol: Q3_PROTOCOL } };
}
export function readQ3BrowserCache(serialized: string): Q3BrowserCache {
  if (serialized.length > maximumBytes) throw new Error("Browser cache is too large");
  const parsed: unknown = JSON.parse(serialized), root = record(parsed);
  if (root["version"] !== 1 || root["protocol"] !== "q3") throw new Error("Unsupported browser cache version or protocol");
  const values = array(root["entries"]);
  if (values.length > 16384) throw new Error("Too many browser cache entries");
  const byAddress = new Map<string, BrowserEntry>();
  const entries = values.map(value => {
    const entry = record(value), endpoint = address(entry["address"]), key = addressKey(endpoint);
    if (byAddress.has(key)) throw new Error("Duplicate browser cache endpoint");
    const sources: DiscoverySource[] = array(entry["sources"]).map(value => {
      if (value !== "master" && value !== "secondary-master" && value !== "favorite") throw new Error("Invalid cached browser source");
      return value;
    });
    if (sources.length === 0 || new Set(sources).size !== sources.length) throw new Error("Invalid cached browser memberships");
    const parsed = { address: endpoint, sources, status: status(entry["status"]), pingMilliseconds: entry["pingMilliseconds"] === null ? null : finite(entry["pingMilliseconds"]), updatedAt: finite(entry["updatedAt"]) };
    byAddress.set(key, parsed);
    return parsed;
  });
  const viewValue = root["view"];
  if (entries.filter(entry => entry.sources.includes("master")).length > 8192
    || entries.filter(entry => entry.sources.includes("secondary-master")).length > 128) throw new Error("Too many cached master entries");
  if (viewValue === null) return { entries, view: null };
  const lists = array(record(viewValue)["lists"]), seen = new Set<number>();
  if (lists.length !== 3) throw new Error("Browser cache requires three UI lists");
  const view: Q3BrowserCacheView = { lists: lists.map(value => {
    const list = record(value), source = list["source"];
    if (source !== 1 && source !== 2 && source !== 3 || seen.has(source)) throw new Error("Invalid browser cache list source"); seen.add(source);
    const rows = array(list["rows"]);
    if (rows.length > (source === 2 ? 4096 : 128)) throw new Error("Too many browser cache UI rows");
    const rowKeys = new Set<string>(), membership = source === 1 ? "secondary-master" : source === 2 ? "master" : "favorite";
    return { source, rows: rows.map(value => {
      const row = record(value), name = text(row["name"], 31);
      if ([...name].some(character => character.charCodeAt(0) > 255)) throw new Error("Browser cache UI name must contain source bytes");
      const endpoint = address(row["address"]);
      const key = addressKey(endpoint);
      if (rowKeys.has(key) || byAddress.get(key)?.sources.includes(membership) !== true)
        throw new Error("Browser cache UI row has duplicate or mismatched membership");
      rowKeys.add(key);
      return { address: endpoint, name, visible: integer(row["visible"], -0x80000000, 0x7fffffff), ping: integer(row["ping"], -0x80000000, 0x7fffffff) };
    }) };
  }) };
  return { entries, view };
}
export function writeQ3BrowserCache(entries: readonly BrowserEntry[], view: Q3BrowserCacheView | null): string {
  const serialized = JSON.stringify({ version: 1, protocol: "q3", entries: entries.flatMap(entry => {
    const sources = entry.sources.filter(source => source === "master" || source === "secondary-master" || source === "favorite");
    if (sources.length === 0) return [];
    return [{ ...entry, sources, status: entry.status === null ? null : { ...entry.status, wire: undefined, protocol: 68, rules: [...entry.status.rules] } }];
  }), view });
  readQ3BrowserCache(serialized);
  return serialized;
}
