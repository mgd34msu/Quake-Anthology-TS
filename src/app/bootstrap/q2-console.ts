/* LM_CTF 6.0 g_save.c native console declarations over the shared command registry. GPL-2.0-or-later. */
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarRegistry, Q2CvarFlag } from "../../core/cvars/index.ts";
import { Q2Lmctf } from "../../content/q2/multiplayer/lmctf/runtime.ts";
import type { LmctfRules } from "../../content/q2/multiplayer/lmctf/types.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";

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

export interface ApplicationQ2ConsoleOptions {
  readonly simulation: () => SharedSimulation;
  readonly content: () => LoadedApplicationContent;
  readonly print: (text: string) => undefined;
  readonly execute: (name: string, args: readonly string[]) => undefined;
}
export class ApplicationQ2Console {
  readonly cvars: CvarRegistry;
  readonly commands: CommandBuffer;
  constructor(private readonly options: ApplicationQ2ConsoleOptions) {
    const simulation = options.simulation(), source = simulation.q2Source();
    if (source === null) throw new Error("Q2 console requires a Q2 source runtime");
    const dialect = source.product.configuration.edition === "rerelease" ? "q2-rerelease" : "q2-classic";
    const context = { session: simulation.session, origin: { kind: "server-console" } } satisfies import("../../contracts/common.ts").CommandContext;
    this.cvars = new CvarRegistry({ dialect, context, print: options.print });
    this.commands = new CommandBuffer({ dialect, context, cvars: this.cvars, print: options.print });
    for (const name of ["quit", "map", "say"]) this.commands.register(name, invocation => options.execute(name, invocation.args));
  }
  get sharedNames(): readonly string[] { return this.options.simulation().q2Source()?.product.match.source instanceof Q2Lmctf ? LMCTF_CONSOLE_NAMES : []; }
  initialize(): Promise<void> { return this.bindCurrent(); }
  async bindCurrent(): Promise<void> {
    const mode = this.options.simulation().q2Source()?.product.match.source;
    if (!(mode instanceof Q2Lmctf)) return;
    bindLmctfConsoleRules(this.cvars, mode.rules);
    const content = this.options.content(), mounts = await content.forContent(content.recipe.match.content);
    const file = await mounts.open(this.cvars.variableString("maplist_file")) ?? await mounts.open("maplist.txt");
    if (file !== null) mode.rules.mapList = new TextDecoder().decode(file.bytes).split(/\r?\n/).flatMap(line => {
      const name = line.trim().split(/\s+/)[0]; return name === undefined || name === "" ? [] : [name.toLowerCase()];
    });
  }
}
