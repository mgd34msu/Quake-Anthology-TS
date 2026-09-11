import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { GameRandom } from "../../../core/game-numeric.ts";
import type { EntityPool } from "../../../content/q3/base/game/entities.ts";
import type { GameLevel } from "../../../content/q3/base/game/level.ts";
import type { GameMemory } from "../../../content/q3/base/game/memory.ts";
import type { MissileRuntime } from "../../../content/q3/base/game/missile.ts";
import type { ConfigStringRegistry, ConfigStringStore } from "../../../content/q3/base/game/utilities.ts";
import type { ServerWorld } from "../../../content/q3/base/world.ts";
import type { ArenaRuntime } from "../../../content/q3/team-arena/arenas.ts";
import type { MatchRuntime } from "../../../content/q3/team-arena/match.ts";

export interface SourceBotEngine {
  print(text: string): void;
  getUserinfo(client: number): string;
  setUserinfo(client: number, userinfo: string): void;
  sendServerCommand(client: number, command: string): void;
  dropClient(client: number, reason: string): void;
  insertConsoleCommand(command: string): void;
  appendConsoleCommand(command: string): void;
}

/** Source AI observes the admitted shared actors through the selected game bindings. */
export interface SourceBotGame {
  readonly options: {
    readonly product: "baseq3" | "missionpack";
    readonly cvars: CvarRegistry;
    readonly configstrings: ConfigStringStore;
    readonly engine: SourceBotEngine;
  };
  readonly gameType: number;
  readonly pool: EntityPool;
  readonly world: ServerWorld;
  readonly random: GameRandom;
  readonly level: GameLevel;
  readonly memory: GameMemory;
  readonly config: ConfigStringRegistry;
  readonly missiles: Pick<MissileRuntime, "isProximityTrigger">;
  readonly match: Pick<MatchRuntime, "exitLevel">;
  readonly arenas: Pick<ArenaRuntime, "resetPodiumPlayers">;
  clientUserinfoChanged(client: number): void;
  clientConnect(client: number, firstTime: boolean, isBot: boolean): string | null;
  clientBegin(client: number): void;
}
