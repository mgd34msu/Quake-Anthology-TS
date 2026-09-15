import { SaveReader } from "../../../persistence/value.ts";
import { captureModuleCvar, readModuleCvar } from "./game/save-module-values.ts";
/* Source g_main.c registration defaults and source cvar update points. GPL-2.0-or-later. */
import { CvarFlag } from "../../../core/cvars/index.ts";
import type { CvarRegistry, CvarSnapshot } from "../../../core/cvars/index.ts";
import type { Product } from "./shared/definitions.ts";
import { gameFormat } from "./game/format.ts";

export interface CvarDefinition {
  readonly name: string;
  readonly value: string;
  readonly flags: number;
  readonly track: boolean;
  readonly teamShader: boolean;
}
const A = CvarFlag.Archive, S = CvarFlag.ServerInfo, U = CvarFlag.UserInfo;
const L = CvarFlag.Latch, R = CvarFlag.ReadOnly, N = CvarFlag.NoRestart, Y = CvarFlag.SystemInfo;
function cvar(name: string, value: string, flags = 0, track = false, teamShader = false): CvarDefinition {
  return { name, value, flags, track, teamShader };
}
const commonCvars = [
  cvar("sv_cheats", ""), cvar("g_restarted", "0", R), cvar("g_gametype", "0", S | U | L),
  cvar("sv_maxclients", "8", S | L | A), cvar("g_maxGameClients", "0", S | L | A),
  cvar("dmflags", "0", S | A, true), cvar("fraglimit", "20", S | A | N, true),
  cvar("timelimit", "0", S | A | N, true), cvar("capturelimit", "8", S | A | N, true),
  cvar("g_synchronousClients", "0", Y), cvar("g_friendlyFire", "0", A, true),
  cvar("g_teamAutoJoin", "0", A), cvar("g_teamForceBalance", "0", A),
  cvar("g_warmup", "20", A, true), cvar("g_doWarmup", "0", 0, true), cvar("g_log", "games.log", A),
  cvar("g_logSync", "0", A), cvar("g_password", "", U), cvar("g_banIPs", "", A),
  cvar("g_filterBan", "1", A), cvar("g_needpass", "0", S | R), cvar("dedicated", "0"),
  cvar("g_speed", "320", 0, true), cvar("g_gravity", "800", 0, true), cvar("g_knockback", "1000", 0, true),
  cvar("g_quadfactor", "3", 0, true), cvar("g_weaponrespawn", "5", 0, true),
  cvar("g_weaponTeamRespawn", "30", 0, true), cvar("g_forcerespawn", "20", 0, true),
  cvar("g_inactivity", "0", 0, true), cvar("g_debugMove", "0"), cvar("g_debugDamage", "0"),
  cvar("g_debugAlloc", "0"), cvar("g_motd", ""), cvar("com_blood", "1"),
  cvar("g_podiumDist", "80"), cvar("g_podiumDrop", "70"), cvar("g_allowVote", "1", A), cvar("g_listEntity", "0"),
];
const missionpackCvars = [
  cvar("g_obeliskHealth", "2500"), cvar("g_obeliskRegenPeriod", "1"), cvar("g_obeliskRegenAmount", "15"),
  cvar("g_obeliskRespawnDelay", "10", S), cvar("g_cubeTimeout", "30"),
  cvar("g_redteam", "Stroggs", A | S | U, true, true), cvar("g_blueteam", "Pagans", A | S | U, true, true),
  cvar("ui_singlePlayerActive", ""), cvar("g_enableDust", "0", S, true), cvar("g_enableBreath", "0", S, true),
  cvar("g_proxMineTimeout", "20000"),
];
const finalCvars = [cvar("g_smoothClients", "1"), cvar("pmove_fixed", "0", Y), cvar("pmove_msec", "8", Y), cvar("g_rankings", "0")];


export function q3GameCvarDefinitions(product: Product): readonly CvarDefinition[] {
  return [...commonCvars, ...(product === "missionpack" ? missionpackCvars : []), ...finalCvars];
}
export interface Q3SettingsHost {
  readonly cvars: CvarRegistry;
  sendServerCommand(client: number, command: string): void;
  remapTeams(): void;
}
/** Copies values at the source G_UpdateCvars point, independent of changes to the shared cvars. */
export class Q3GameSettings {
  captureSaveState() { return [...this.snapshots.values()].map(captureModuleCvar); }
  restoreSaveState(value: unknown): void {
    const reader = new SaveReader(value, "q3.settings"), snapshots = reader.list(readModuleCvar);
    const names = new Set(snapshots.map(snapshot => snapshot.name));
    if (snapshots.length !== this.definitions.length || names.size !== snapshots.length || snapshots.some(snapshot => !this.definitions.some(definition => definition.name === snapshot.name))) reader.fail("invalid settings snapshot names");
    this.snapshots.clear(); for (const snapshot of snapshots) this.snapshots.set(snapshot.name, snapshot);
  }

  private readonly snapshots = new Map<string, CvarSnapshot>();
  readonly definitions: readonly CvarDefinition[];
  constructor(readonly host: Q3SettingsHost, readonly product: Product) { this.definitions = q3GameCvarDefinitions(product); }
  register(buildDate: string): void {
    for (const definition of this.definitions) {
      if (definition.name === "g_restarted") { this.host.cvars.register("gamename", "baseq3", S | R); this.host.cvars.register("gamedate", buildDate, R); }
      const current = this.host.cvars.register(definition.name, definition.value, definition.flags);
      if (current === undefined) throw new Error("Could not register Q3 game cvar " + definition.name);
      this.snapshots.set(definition.name, current);
    }
  }
  snapshot(name: string): CvarSnapshot { const value = this.snapshots.get(name); if (value === undefined) throw new Error("Unregistered Q3 game cvar " + name); return value; }
  integer(name: string): number { return this.snapshot(name).integerValue; }
  number(name: string): number { return Math.fround(this.snapshot(name).numericValue); }
  string(name: string): string { return this.snapshot(name).value; }
  update(): void {
    let remapped = false;
    for (const definition of this.definitions) {
      const previous = this.snapshot(definition.name), current = this.host.cvars.get(definition.name);
      if (current === undefined) throw new Error("Game cvar disappeared: " + definition.name);
      this.snapshots.set(definition.name, current);
      if (previous.modificationCount === current.modificationCount) continue;
      if (definition.track) this.host.sendServerCommand(-1, gameFormat('print "Server: %s changed to %s\n"', [definition.name, current.value]));
      if (definition.teamShader) remapped = true;
    }
    if (remapped) this.host.remapTeams();
  }
}
