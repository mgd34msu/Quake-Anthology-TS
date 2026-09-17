import { decodeNetQuakeControl, encodeNetQuakeControl, quakeWorldOutOfBand, readQuakeWorldOutOfBand } from "./handshake.ts";
import type { DiscoveryWire, ServerStatus } from "../services/discovery.ts";

export function netQuakeDiscoveryWire(): DiscoveryWire {
  return { query: () => encodeNetQuakeControl({ kind: "server-info-request", game: "QUAKE", version: 3 }),
    masterQuery: () => { throw new Error("NetQuake master discovery is not configured"); },
    heartbeat: () => { throw new Error("NetQuake master registration is not configured"); } };
}
export function readNetQuakeDiscovery(bytes: Uint8Array): ServerStatus {
  const message = decodeNetQuakeControl(bytes);
  if (message.kind !== "server-info" || message.version !== 3) throw new Error("Not a compatible NetQuake discovery response");
  return { name: message.name, map: message.map, players: message.players, maxPlayers: message.maxPlayers,
    rules: new Map<string, string>(), playerDetails: [], wire: { kind: "source", protocol: { kind: "q1-netquake", version: 15 } } };
}

export function quakeWorldDiscoveryWire(): DiscoveryWire {
  return { query: () => quakeWorldOutOfBand("status\n"),
    masterQuery: () => { throw new Error("Use an HTTP QuakeWorld master list"); },
    heartbeat: () => { throw new Error("QuakeWorld heartbeat requires its source sequence and active client count"); } };
}

/** QW sv_main.ts SVC_Status: userid frags minutes ping name skin top bottom. */
export function readQuakeWorldDiscovery(bytes: Uint8Array): ServerStatus {
  const text = readQuakeWorldOutOfBand(bytes);
  if (!text.startsWith("n\\")) throw new Error("Not a QuakeWorld status reply");
  const [info, ...lines] = text.slice(1).replace(/\0$/, "").split("\n"), fields = (info ?? "").slice(1).split("\\");
  const rules = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) { const key = fields[i], value = fields[i + 1]; if (key !== undefined && value !== undefined) rules.set(key, value); }
  const playerDetails = lines.flatMap(line => {
    const match = /^\d+ (-?\d+) \d+ (-?\d+) "([^"]*)" "[^"]*" \d+ \d+\s*$/.exec(line);
    return match === null ? [] : [{ score: Number(match[1]), ping: Number(match[2]), name: match[3] ?? "" }];
  });
  return { name: rules.get("hostname") ?? "", map: rules.get("map") ?? "", players: playerDetails.length,
    maxPlayers: Number(rules.get("maxclients") ?? "32"), rules, playerDetails,
    wire: { kind: "source", protocol: { kind: "q1-quakeworld", version: 28 } } };
}
