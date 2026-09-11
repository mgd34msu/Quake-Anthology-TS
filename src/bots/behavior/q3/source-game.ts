import type { Q3SourceRuntime } from "../../../app/bootstrap/simulation/q3/runtime.ts";
import type { SourceBotGame } from "./game-host.ts";

/** Borrow the live Q3 source services bound to shared actors and match state. */
export function q3BotGame(source: Q3SourceRuntime, insertConsoleCommand: (text: string) => void): SourceBotGame {
  return {
    options: { product: source.options.product, cvars: source.host.cvars, configstrings: source.host.configstrings,
      engine: { ...source.host.engine, insertConsoleCommand } },
    get gameType() { return source.gameType; },
    pool: source.pool, world: source.world, random: source.random, level: source.level, memory: source.memory,
    config: source.config, missiles: source.missiles, match: source.match, arenas: source.arenas,
    clientUserinfoChanged: client => source.admission.userinfoChanged(client),
    clientConnect: (client, firstTime, isBot) => source.admission.connect(client, firstTime, isBot),
    clientBegin: client => source.admission.begin(client),
  };
}
