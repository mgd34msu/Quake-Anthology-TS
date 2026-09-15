import type { CommandContext } from "../../contracts/common.ts";
/* LM_CTF 6.0 g_save.c native console declarations over the shared command registry. GPL-2.0-or-later. */
import type { CommandBuffer, CommandHandler } from "../../core/commands/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { Q2Lmctf } from "../../content/q2/multiplayer/lmctf/runtime.ts";
import { q2Userinfo } from "../../content/q2/base/player/index.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";

import { bindLmctfConsoleRules, LMCTF_CONSOLE_NAMES } from "../../settings/server/lmctf-cvars.ts";
export { bindLmctfConsoleRules, LMCTF_CONSOLE_NAMES };

export function q2OperatorPlayerName(player: { readonly userinfo: string; readonly name: string }): string {
  return q2Userinfo(player.userinfo).get("name") ?? player.name;
}

export interface ApplicationQ2ConsoleOptions {
  readonly simulation: () => SharedSimulation;
  readonly content: () => LoadedApplicationContent;
  readonly print: (text: string) => undefined;
  readonly execute: (name: string, args: readonly string[], source: CommandContext) => undefined;
}
export class ApplicationQ2Console {
  get cvars(): CvarRegistry {
    const cvars = this.options.simulation().q2ServerCvars();
    if (cvars === null) throw new Error("Q2 console requires the simulation's source registry");
    return cvars;
  }
  constructor(private readonly options: ApplicationQ2ConsoleOptions) {
    if (options.simulation().q2Source() === null) throw new Error("Q2 console requires a Q2 source runtime");
  }
  bind(commands: CommandBuffer): () => void {
    const options = this.options, handlers = new Map<string, CommandHandler>();
    const register = (name: string, handler: CommandHandler): void => {
      if (commands.register(name, handler)) handlers.set(name, handler);
    };
    for (const name of ["quit", "map", "say"]) register(name, invocation => options.execute(name, invocation.args, invocation.source));
    register("status", () => {
      const current = options.simulation().q2Source();
      if (current === null) return options.print("No server running.\n");
      options.print(`map              : ${current.game.options.mapName}\nnum score ping name\n`);
      for (const player of current.players.states.values()) if (player.connected)
        options.print(`${player.slot} ${player.score} ${player.ping} ${q2OperatorPlayerName(player)}\n`);
      return undefined;
    });
    register("dumpuser", invocation => {
      const target = invocation.args[0];
      if (target === undefined || invocation.args.length !== 1) return options.print("Usage: dumpuser <player name|slot>\n");
      const players = options.simulation().q2Source()?.players.states.values();
      const player = players === undefined ? undefined : [...players].find(value => value.connected &&
        (/^\d+$/.test(target) ? value.slot === Number(target) : q2OperatorPlayerName(value) === target));
      if (player === undefined) return options.print(`Player ${target} is not on the server\n`);
      options.print("userinfo\n--------\n");
      for (const [key, value] of q2Userinfo(player.userinfo)) options.print(`${key.padEnd(20)}${value}\n`);
      return undefined;
    });
    return () => { for (const [name, handler] of handlers) commands.unregister(name, handler); };
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
