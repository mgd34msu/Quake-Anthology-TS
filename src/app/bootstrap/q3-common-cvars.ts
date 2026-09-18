import { Q3_PROTOCOL } from "../../network/q3/adapters.ts";
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { collisionMapCvarDefinitions } from "../../world/collision/q3/settings.ts";

export function q3ServerCvarDefinitions(settings: { readonly maxClients: number; readonly mapName: string }) {
  const common = [
    ['protocol', String(Q3_PROTOCOL.version), CvarFlag.ServerInfo | CvarFlag.ReadOnly],
    ['sv_pure', '1', CvarFlag.SystemInfo], ['sv_allowDownload', '0', CvarFlag.ServerInfo],
    ['sv_maxRate', '0', CvarFlag.ServerInfo], ['sv_fps', '20', CvarFlag.None], ['sv_serverid', '0', CvarFlag.SystemInfo | CvarFlag.ReadOnly],
    ['sv_paks', '', CvarFlag.SystemInfo | CvarFlag.ReadOnly], ['sv_pakNames', '', CvarFlag.SystemInfo | CvarFlag.ReadOnly],
    ['sv_referencedPaks', '', CvarFlag.SystemInfo | CvarFlag.ReadOnly], ['sv_referencedPakNames', '', CvarFlag.SystemInfo | CvarFlag.ReadOnly],
    ['sv_maxclients', String(settings.maxClients), CvarFlag.ServerInfo | CvarFlag.Latch],
    ['mapname', settings.mapName, CvarFlag.ServerInfo | CvarFlag.ReadOnly],
    ['sv_mapname', '', CvarFlag.ServerInfo | CvarFlag.ReadOnly],
    ['sv_privateClients', '0', CvarFlag.ServerInfo], ['sv_privatePassword', '', CvarFlag.Temporary],
    ['sv_reconnectlimit', '3', CvarFlag.None], ['sv_minPing', '0', CvarFlag.Archive | CvarFlag.ServerInfo],
    ['sv_maxPing', '0', CvarFlag.Archive | CvarFlag.ServerInfo], ['sv_floodProtect', '1', CvarFlag.Archive | CvarFlag.ServerInfo],
    ['sv_strictAuth', '1', CvarFlag.Archive], ['bot_enable', '1', CvarFlag.None],
  ] satisfies readonly (readonly [string, string, number])[];
  return [...common.map(([name, value, flags]) => ({ name, value, flags })), ...collisionMapCvarDefinitions];
}

export const q3ServerCvarNames: readonly string[] = q3ServerCvarDefinitions({ maxClients: 0, mapName: "" }).map(definition => definition.name);

export function registerQ3ServerCvars(cvars: CvarRegistry, settings: { readonly maxClients: number; readonly mapName: string }): void {
  for (const definition of q3ServerCvarDefinitions(settings)) cvars.register(definition.name, definition.value, definition.flags);
}
