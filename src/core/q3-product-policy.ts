/* PRE_RELEASE_DEMO/PRE_RELEASE_TADEMO from id Software files.c, sv_ccmds.c and ui_main.c.
 * Copyright (C) 1999-2005 Id Software. GPL-2.0-or-later. */
import { CvarFlag, type CvarRegistry } from "./cvars/index.ts";

export type Q3ProductPolicy =
  | { readonly kind: "retail" }
  | { readonly kind: "prerelease-demo"; readonly teamArenaUi: "retail" | "demo" }
  | { readonly kind: "prerelease-ta-demo" };

export function q3ProductPolicy(prereleaseDemo: boolean, prereleaseTeamArenaDemo: boolean): Q3ProductPolicy {
  return prereleaseDemo ? { kind: "prerelease-demo", teamArenaUi: prereleaseTeamArenaDemo ? "demo" : "retail" }
    : prereleaseTeamArenaDemo ? { kind: "prerelease-ta-demo" } : { kind: "retail" };
}

/** Call after startup +set values have been applied, before mounting content. */
export function registerQ3ProductPolicy(cvars: CvarRegistry): Q3ProductPolicy {
  const demo = (cvars.register("com_prereleaseDemo", "0", CvarFlag.Init)?.integerValue ?? 0) !== 0;
  const teamArena = (cvars.register("com_prereleaseTeamArenaDemo", "0", CvarFlag.Init)?.integerValue ?? 0) !== 0;
  return q3ProductPolicy(demo, teamArena);
}

export function q3PrereleaseDemo(policy: Q3ProductPolicy): boolean { return policy.kind === "prerelease-demo"; }
export function q3TeamArenaDemo(policy: Q3ProductPolicy): boolean {
  return policy.kind === "prerelease-ta-demo" || (policy.kind === "prerelease-demo" && policy.teamArenaUi === "demo");
}

export type Q3MountRestriction = { readonly kind: "none" }
  | { readonly kind: "demo"; readonly directory: "demota"; readonly pakChecksum: 437558517 };
export function q3MountRestriction(policy: Q3ProductPolicy, fsRestrict: boolean): Q3MountRestriction {
  return fsRestrict || q3PrereleaseDemo(policy) ? { kind: "demo", directory: "demota", pakChecksum: 437558517 } : { kind: "none" };
}

export function q3ProductMapCommands(policy: Q3ProductPolicy): readonly string[] {
  return q3PrereleaseDemo(policy) ? ["map"] : ["map", "devmap", "spmap", "spdevmap"];
}

export function q3TeamArenaCatalogPolicy(policy: Q3ProductPolicy): {
  readonly gameInfo: "gameinfo.txt" | "demogameinfo.txt";
  readonly teamInfo: "teaminfo.txt" | "demoteaminfo.txt";
  readonly additionalTeams: boolean;
  readonly additionalArenas: boolean;
} {
  const demo = q3TeamArenaDemo(policy);
  return { gameInfo: demo ? "demogameinfo.txt" : "gameinfo.txt", teamInfo: demo ? "demoteaminfo.txt" : "teaminfo.txt",
    additionalTeams: !demo, additionalArenas: !demo };
}
