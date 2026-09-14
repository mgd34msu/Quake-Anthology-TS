// CL_GlobalServers_f, CL_ServersResponsePacket and SVC_Info/Status. GPL-2.0-or-later.
import { tokenizeCommand } from "../../core/commands/text.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import type { Ipv4Address } from "../common/endpoint.ts";
import type { DiscoveryWire, ServerStatus } from "../services/discovery.ts";
import { Q3_PROTOCOL } from "./adapters.ts";
import { q3InfoValue } from "./admission.ts";
import { decodeConnectionless, encodeConnectionlessText } from "./connectionless.ts";

export function q3DiscoveryWire(keywords: readonly string[] = [], protocol = 68): DiscoveryWire {
  if (!Number.isSafeInteger(protocol) || protocol <= 0 || protocol > 0x7fffffff) throw new RangeError("Invalid Q3 master protocol");
  for (const keyword of keywords) if (/\s|\0/.test(keyword)) throw new RangeError("Q3 master keywords must be source words");
  return {
    query: (kind, challenge) => encodeConnectionlessText(`${kind === "info" ? "getinfo" : "getstatus"} ${challenge}`),
    masterQuery: () => encodeConnectionlessText(`getservers ${protocol}${keywords.length === 0 ? "" : ` ${keywords.join(" ")}`}`),
    heartbeat: () => encodeConnectionlessText("heartbeat QuakeArena-1\n"),
  };
}
export function decodeQ3MasterResponse(bytes: Uint8Array): readonly Ipv4Address[] {
  return decodeQ3MasterPacket(bytes).addresses;
}
export function decodeQ3MasterPacket(bytes: Uint8Array): { readonly addresses: readonly Ipv4Address[]; readonly complete: boolean } {
  const prefix = new TextEncoder().encode("getserversResponse");
  if (bytes.length < prefix.length + 4 || ![0, 1, 2, 3].every(index => bytes[index] === 255)
    || !prefix.every((byte, index) => bytes[index + 4] === byte)) throw new RangeError("Not a Q3 master response");
  const result: Ipv4Address[] = [];
  let cursor = 4 + prefix.length;
  while (cursor < bytes.length && bytes[cursor] !== 92) cursor++;
  while (cursor < bytes.length && bytes[cursor] === 92) {
    cursor++;
    if (bytes[cursor] === 69 && bytes[cursor + 1] === 79 && bytes[cursor + 2] === 84) return { addresses: result, complete: true };
    if (result.length >= 256) break;
    const a = bytes[cursor], b = bytes[cursor + 1], c = bytes[cursor + 2], d = bytes[cursor + 3], high = bytes[cursor + 4], low = bytes[cursor + 5];
    if (a === undefined || b === undefined || c === undefined || d === undefined || high === undefined || low === undefined) break;
    cursor += 6;
    if (bytes[cursor] !== 92) break;
    result.push({ kind: "ipv4", host: [a, b, c, d], port: (high << 8) | low });
  }
  return { addresses: result, complete: false };
}
function payloadText(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) { if (byte === 0) break; text += String.fromCharCode(byte === 37 || byte > 127 ? 46 : byte); }
  return text;
}
export function decodeQ3ServerStatus(bytes: Uint8Array): { readonly challenge: string; readonly status: ServerStatus } {
  const packet = decodeConnectionless(bytes, "client"), command = packet.command.toLowerCase();
  if (command !== "inforesponse" && command !== "statusresponse") throw new RangeError("Not a Q3 server browser response");
  const lines = payloadText(packet.payload).split("\n"), info = lines[0] ?? "", rules = new Map<string, string>();
  const fields = info.split("\\");
  for (let index = info.startsWith("\\") ? 1 : 0; index + 1 < fields.length; index += 2) {
    const key = fields[index], value = fields[index + 1];
    if (key !== undefined && value !== undefined) rules.set(key, value);
  }
  if (command === "inforesponse" && nativeAtoi(q3InfoValue(info, "protocol")) !== 68) throw new RangeError("Server uses another Q3 wire version");
  const playerDetails: { name: string; score: number; ping: number }[] = [];
  if (command === "statusresponse") for (const line of lines.slice(1)) {
    if (line === "") continue;
    const argv = tokenizeCommand(line, "q3").argv;
    if (argv.length >= 3) playerDetails.push({ name: argv[2] ?? "", score: nativeAtoi(argv[0] ?? ""), ping: nativeAtoi(argv[1] ?? "") });
  }
  return { challenge: q3InfoValue(info, "challenge"), status: { name: q3InfoValue(info, "hostname") || q3InfoValue(info, "sv_hostname"),
    map: q3InfoValue(info, "mapname"), players: command === "statusresponse" ? playerDetails.length : nativeAtoi(q3InfoValue(info, "clients")),
    maxPlayers: nativeAtoi(q3InfoValue(info, "sv_maxclients")), rules, playerDetails, wire: { kind: "source", protocol: Q3_PROTOCOL } } };
}
export function encodeQ3Status(info: string, players: readonly { readonly score: number; readonly ping: number; readonly name: string }[]): Uint8Array {
  let rows = "";
  for (const player of players) {
    const row = `${player.score} ${player.ping} "${player.name}"\n`.slice(0, 1023);
    if (rows.length + row.length >= 16384) break;
    rows += row;
  }
  return encodeConnectionlessText(`statusResponse\n${info}\n${rows}`);
}
export function encodeQ3Info(info: string): Uint8Array { return encodeConnectionlessText(`infoResponse\n${info}`); }
