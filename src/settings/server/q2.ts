import { createQ2PlayerRules } from "../../content/q2/base/player/types.ts";
import { createQ2CtfRules } from "../../content/q2/multiplayer/ctf/types.ts";
import { serverFriendlyFire, serverLimit, serverToggle } from "./common.ts";
import type { ServerSettingCollection } from "./types.ts";

export function q2LimitSettings(): ServerSettingCollection {
  const defaults = createQ2PlayerRules();
  return { id: "q2:limits", definitions: [
    serverLimit("server:time-limit", "timelimit", "Time limit (minutes)", defaults.timeLimitMinutes, "End the level after this many minutes. Zero disables the limit.", "live", false),
    serverLimit("server:frag-limit", "fraglimit", "Frag limit", defaults.fragLimit, "End the level when a player reaches this score. Zero disables the limit."),
  ] };
}
export function q2CtfCaptureSettings(): ServerSettingCollection {
  return { id: "q2:ctf-captures", definitions: [serverLimit("server:capture-limit", "capturelimit", "Capture limit", createQ2CtfRules().captureLimit, "End the level when a team reaches this capture count. Zero disables the limit.")] };
}
export function q2CombatSettings(): ServerSettingCollection {
  return { id: "q2:combat", definitions: [serverFriendlyFire({ kind: "bit", name: "dmflags", mask: 256, inverted: true }, true)] };
}
/** These bits are read while the selected Q2 item owner spawns map entities. */
export function q2SpawnSettings(): ServerSettingCollection {
  return { id: "q2:item-spawn", definitions: [
    serverToggle("server:q2.no-health", { kind: "bit", name: "dmflags", mask: 1, inverted: false }, "Exclude health items", false, "Remove health pickups when the next map is spawned.", "next-map"),
    serverToggle("server:q2.no-powerups", { kind: "bit", name: "dmflags", mask: 2, inverted: false }, "Exclude powerups", false, "Remove powerup pickups when the next map is spawned.", "next-map"),
    serverToggle("server:q2.no-armor", { kind: "bit", name: "dmflags", mask: 2048, inverted: false }, "Exclude armor items", false, "Remove armor pickups when the next map is spawned.", "next-map"),
  ] };
}
