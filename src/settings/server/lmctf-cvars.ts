import { Q2CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { LmctfRules } from "../../content/q2/multiplayer/lmctf/types.ts";
type NumericRule = "ctfFlags" | "refFlags" | "runes" | "skinSet" | "disabledWeapons" | "timeLimitMinutes" | "fragLimit" | "countdownSeconds";
type BooleanRule = "flagInit" | "fastSwitch" | "autoLock";
type StringRule = "refPassword" | "rconPassword";
interface Definition<Key> { readonly name: string; readonly value: string; readonly flags: number; readonly key: Key; }
const numeric: readonly Definition<NumericRule>[] = [
  { name: "ctfflags", value: "0", flags: Q2CvarFlag.ServerInfo, key: "ctfFlags" },
  { name: "refset", value: "0", flags: Q2CvarFlag.ServerInfo, key: "refFlags" },
  { name: "runes", value: "15", flags: Q2CvarFlag.ServerInfo, key: "runes" },
  { name: "skinset", value: "0", flags: Q2CvarFlag.ServerInfo, key: "skinSet" },
  { name: "disabled_weps", value: "0", flags: 0, key: "disabledWeapons" },
  { name: "timelimit", value: "0", flags: Q2CvarFlag.ServerInfo, key: "timeLimitMinutes" },
  { name: "fraglimit", value: "0", flags: Q2CvarFlag.ServerInfo, key: "fragLimit" },
  { name: "countdown_time", value: "15", flags: 0, key: "countdownSeconds" },
];
const boolean: readonly Definition<BooleanRule>[] = [
  { name: "flag_init", value: "0", flags: 0, key: "flagInit" },
  { name: "fastswitch", value: "0", flags: 0, key: "fastSwitch" },
  { name: "autolock", value: "0", flags: 0, key: "autoLock" },
];
const strings: readonly Definition<StringRule>[] = [
  { name: "refpassword", value: "", flags: 0, key: "refPassword" },
  { name: "rcon_password", value: "", flags: 0, key: "rconPassword" },
];
export const LMCTF_CONSOLE_NAMES: readonly string[] = [...numeric, ...boolean, ...strings].map(definition => definition.name).concat("maplist_file");

/** Source assignments and console writes use the same registry value. */
export function bindLmctfConsoleRules(cvars: CvarRegistry, rules: LmctfRules): void {
  const registerValue = (definition: Definition<string>, initial: string): void => {
    const present = cvars.find(definition.name) !== undefined;
    cvars.register(definition.name, definition.value, definition.flags);
    if (!present && initial !== definition.value) cvars.set(definition.name, initial);
  };
  for (const definition of numeric) {
    registerValue(definition, String(rules[definition.key]));
    Object.defineProperty(rules, definition.key, { enumerable: true, configurable: true,
      get: () => cvars.variableValue(definition.name), set: (value: number) => { cvars.set(definition.name, String(value)); } });
  }
  for (const definition of boolean) {
    registerValue(definition, rules[definition.key] ? "1" : "0");
    Object.defineProperty(rules, definition.key, { enumerable: true, configurable: true,
      get: () => (definition.key === "autoLock" ? Math.trunc(cvars.variableValue(definition.name)) : cvars.variableValue(definition.name)) !== 0, set: (value: boolean) => { cvars.set(definition.name, value ? "1" : "0"); } });
  }
  for (const definition of strings) {
    registerValue(definition, rules[definition.key]);
    Object.defineProperty(rules, definition.key, { enumerable: true, configurable: true,
      get: () => cvars.variableString(definition.name), set: (value: string) => { cvars.set(definition.name, value); } });
  }
  cvars.register("maplist_file", "maplist.txt", 0);
}

