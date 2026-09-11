import type { Q2PlayerState } from "../base/player/types.ts";

const generic: ReadonlyMap<number, string> = new Map([[23, "suicide"], [22, "falling"], [20, "crush"], [17, "water"], [18, "slime"], [19, "lava"],
  [25, "explosive"], [26, "explosive"], [28, "exit"], [30, "laser"], [33, "blaster"], [27, "hurt"], [29, "hurt"], [31, "hurt"], [38, "gekk"], [36, "gekk"]]);
const self: ReadonlyMap<number, string> = new Map([[24, "held_grenade"], [16, "grenade_splash"], [7, "grenade_splash"], [9, "rocket_splash"], [13, "bfg_blast"], [39, "trap"], [53, "dopple_explode"]]);
const kill: ReadonlyMap<number, string> = new Map([[1, "blaster"], [2, "shotgun"], [3, "sshotgun"], [4, "machinegun"], [5, "chaingun"], [6, "grenade"], [7, "grenade_splash"],
  [8, "rocket"], [9, "rocket_splash"], [10, "hyperblaster"], [11, "railgun"], [12, "bfg_laser"], [13, "bfg_blast"], [14, "bfg_effect"], [15, "handgrenade"],
  [16, "handgrenade_splash"], [24, "held_grenade"], [21, "telefrag"], [57, "telefrag"], [34, "ripper"], [35, "phalanx"], [39, "trap"], [40, "chainfist"],
  [41, "disintegrator"], [42, "etf_rifle"], [44, "heatbeam"], [45, "tesla"], [46, "prox"], [47, "nuke"], [48, "vengeance_sphere"], [49, "hunter_sphere"],
  [50, "defender_sphere"], [51, "tracker"], [53, "dopple_explode"], [54, "dopple_vengeance"], [55, "dopple_hunter"], [56, "grapple"]]);

export function q2RereleaseObituary(victim: Q2PlayerState, attacker: Q2PlayerState | null, cause: number, mode: "singleplayer" | "coop" | "deathmatch", noPointLoss: boolean,
  score: (recipient: Q2PlayerState, change: number) => undefined = (recipient, change) => { recipient.score += change; return undefined; }): { readonly text: string; readonly args: readonly string[] } {
  const means = cause & ~0x8000000, friendly = (cause & 0x8000000) !== 0 || mode === "coop" && attacker !== null;
  const source = attacker === victim ? `$g_mod_self_${self.get(means) ?? "default"}` : generic.has(means) ? `$g_mod_generic_${generic.get(means) ?? "died"}` : null;
  if (source !== null) { if (mode === "deathmatch" && !noPointLoss) score(victim, -1); return { text: source, args: [victim.name] }; }
  if (attacker !== null) {
    if (mode === "deathmatch") { if (!friendly) score(attacker, 1); else if (!noPointLoss) score(attacker, -1); }
    else if (mode !== "coop") score(victim, -1);
    return { text: `$g_mod_kill_${kill.get(means) ?? "generic"}`, args: [victim.name, attacker.name] };
  }
  if (mode === "deathmatch" && !noPointLoss) score(victim, -1);
  return { text: "$g_mod_generic_died", args: [victim.name] };
}
