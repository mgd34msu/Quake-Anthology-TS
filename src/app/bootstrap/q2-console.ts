/* LM_CTF 6.0 g_save.c native console declarations over the shared command registry. GPL-2.0-or-later. */
import { CommandBuffer } from "../../core/commands/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { Q2Lmctf } from "../../content/q2/multiplayer/lmctf/runtime.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";

import { bindLmctfConsoleRules, LMCTF_CONSOLE_NAMES } from "../../settings/server/lmctf-cvars.ts";
export { bindLmctfConsoleRules, LMCTF_CONSOLE_NAMES };

export interface ApplicationQ2ConsoleOptions {
  readonly simulation: () => SharedSimulation;
  readonly content: () => LoadedApplicationContent;
  readonly print: (text: string) => undefined;
  readonly execute: (name: string, args: readonly string[]) => undefined;
}
export class ApplicationQ2Console {
  get cvars(): CvarRegistry {
    const cvars = this.options.simulation().q2ServerCvars();
    if (cvars === null) throw new Error("Q2 console requires the simulation's source registry");
    return cvars;
  }
  readonly commands: CommandBuffer;
  constructor(private readonly options: ApplicationQ2ConsoleOptions) {
    const simulation = options.simulation(), source = simulation.q2Source();
    if (source === null) throw new Error("Q2 console requires a Q2 source runtime");
    const dialect = source.product.configuration.edition === "rerelease" ? "q2-rerelease" : "q2-classic";
    const context = { session: simulation.session, origin: { kind: "server-console" } } satisfies import("../../contracts/common.ts").CommandContext;
    const owner = this;
    this.commands = new CommandBuffer({ dialect, context, get cvars() { return owner.cvars; }, print: options.print });
    for (const name of ["quit", "map", "say"]) this.commands.register(name, invocation => options.execute(name, invocation.args));
  }
  get sharedNames(): readonly string[] { return ["dmflags", "timelimit", "fraglimit", "capturelimit", ...(this.options.simulation().q2Source()?.product.match.source instanceof Q2Lmctf ? LMCTF_CONSOLE_NAMES : [])]; }
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
