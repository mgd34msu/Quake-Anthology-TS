import type { ServerSettingCollection } from "./types.ts";

/** Quake menu.c GameOptions teamplay choices; Rogue adds its source objective modes. */
export function q1MatchSettings(program: "standard" | "rogue" | "ctf"): ServerSettingCollection {
  if (program === "ctf") return { id: "q1:match", definitions: [] };
  const labels = ["Off", "No friendly fire", "Friendly fire", ...(program === "rogue" ? ["Tag", "Capture the flag", "One flag CTF", "Three team CTF"] : [])];
  return { id: "q1:match", definitions: [{ id: "server:q1.teamplay", kind: "choice", label: "Quake teamplay",
    description: "Select source team rules for the next map. Rogue objective entities are initialized when the map starts.",
    target: { kind: "value", name: "teamplay" }, defaultValue: "0", applyAt: "next-map",
    choices: labels.map((label, value) => ({ id: String(value), label })) }] };
}
