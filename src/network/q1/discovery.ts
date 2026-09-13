import { decodeNetQuakeControl, encodeNetQuakeControl } from "./handshake.ts";
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
