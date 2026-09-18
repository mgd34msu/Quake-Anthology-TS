import { q3ProductMapCommands, type Q3ProductPolicy } from "../../core/q3-product-policy.ts";

export interface Q3MapLaunch {
  readonly gameType: number;
  readonly killBots: boolean;
  readonly singlePlayer: boolean;
  readonly maxClients?: 8;
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
}
/** SV_Map_f: spdevmap follows the single-player branch, which disables cheats. */
export function q3MapLaunch(policy: Q3ProductPolicy, command: string, currentGameType: number): Q3MapLaunch {
  if (!q3ProductMapCommands(policy).includes(command)) throw new Error(`Unknown Q3 map command: ${command}`);
  const singlePlayer = command.startsWith("sp"), gameType = singlePlayer ? 2 : currentGameType === 2 ? 0 : currentGameType;
  return { gameType, singlePlayer, killBots: singlePlayer || command === "devmap", ...(singlePlayer ? { maxClients: 8 } : {}),
    cvars: [{ name: "g_gametype", value: String(gameType) }, { name: "sv_cheats", value: command === "devmap" ? "1" : "0" },
      ...(singlePlayer ? [{ name: "g_doWarmup", value: "0" }, { name: "sv_maxclients", value: "8" }] : [])] };
}

export function applyQ3MapLaunch(cvars: import("../../core/cvars/index.ts").CvarRegistry, launch: Q3MapLaunch, phase: "all" | "spawn" | "finish" = "all"): void {
  if (phase !== "finish") cvars.applyLatched();
  for (const setting of launch.cvars) {
    if (phase === "spawn" && setting.name === "sv_cheats" || phase === "finish" && setting.name !== "sv_cheats") continue;
    cvars.set(setting.name, setting.value, true);
  }
}
