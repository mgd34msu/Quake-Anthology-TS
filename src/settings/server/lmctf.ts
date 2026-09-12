import { createLmctfRules, LMCTF_RUNES } from "../../content/q2/multiplayer/lmctf/types.ts";
import { serverLimit, serverToggle } from "./common.ts";
import type { ServerSettingCollection } from "./types.ts";

export function lmctfLimitSettings(): ServerSettingCollection {
  const defaults = createLmctfRules();
  return { id: "q2:lmctf-limits", definitions: [
    serverLimit("server:time-limit", "timelimit", "Match time (minutes)", defaults.timeLimitMinutes, "Duration used when the next LMCTF match starts. Does not reset an active countdown.", "next-match"),
    serverLimit("server:frag-limit", "fraglimit", "Frag limit", defaults.fragLimit, "Start the final countdown when a player reaches this score. Zero disables the limit."),
  ] };
}
export function lmctfRuneSettings(): ServerSettingCollection {
  const defaults = createLmctfRules();
  return { id: "q2:lmctf-runes", definitions: LMCTF_RUNES.map(rune => serverToggle(`server:lmctf.rune.${rune.kind}`,
    { kind: "bit", name: "runes", mask: rune.bit, inverted: false }, rune.name, (defaults.runes & rune.bit) !== 0,
    `Spawn the ${rune.name} on the next map.`, "next-map")) };
}
export function lmctfWeaponSettings(): ServerSettingCollection {
  return { id: "q2:lmctf-weapons", definitions: [serverToggle("server:lmctf.fast-switch", { kind: "value", name: "fastswitch" },
    "Fast weapon switching", createLmctfRules().fastSwitch, "Use the selected LMCTF weapon owner's fast switch behavior.")] };
}
