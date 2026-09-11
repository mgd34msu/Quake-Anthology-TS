import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { GameRandom } from "../../../core/game-numeric.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { GameMemory } from "../../../content/q3/base/game/memory.ts";
import type { ConfigStringStore } from "../../../content/q3/base/game/utilities.ts";
import type { ServerTraceQuery, ServerTraceResult } from "../../../content/q3/base/world.ts";
import type { EntityState } from "../../../content/q3/base/shared/entity-state.ts";
import type { PlayerState } from "../../../content/q3/base/shared/player-state.ts";
import type { BotState } from "./ai-state.ts";
import type { BotLibrary } from "./library.ts";
import type { WeaponInfo } from "../library/weapons.ts";

export interface SourceBotEngine {
  print(text: string): void;
  getUserinfo(client: number): string;
  setUserinfo(client: number, userinfo: string): void;
  sendServerCommand(client: number, command: string): void;
  dropClient(client: number, reason: string): void;
  insertConsoleCommand(command: string): void;
  appendConsoleCommand(command: string): void;
}

/** Detached decision input. The player-state cell belongs to the brain, never to gameplay. */
export interface BotObservedPlayer {
  readonly state: PlayerState;
  readonly connected: boolean;
  readonly team: number;
  readonly name: string;
  readonly lastHurtClient: number;
  readonly lastHurtMod: number;
}
export interface BotObservedEntity {
  readonly generation: number;
  readonly present: boolean;
  readonly linked: boolean;
  readonly hidden: boolean;
  readonly bot: boolean;
  readonly state: EntityState;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly bounds: Bounds;
  readonly contents: number;
  readonly inlineModel: number | null;
  readonly classname: string | null;
  readonly eventTime: number;
  readonly activatorFrame: number | null;
  readonly proximityTrigger: boolean;
  readonly player: BotObservedPlayer | null;
}

/** The selected arsenal supplies inventory and ballistics to the same decision controller. */
export interface BotWeaponKnowledge {
  readonly info: WeaponInfo;
  readonly maximumRange: number | null;
  readonly melee: boolean;
  readonly personalityRole: number | null;
}
export interface BotArsenalData {
  updateInventory(state: BotState): void;
  candidates(library: BotLibrary, handle: number): readonly BotWeaponKnowledge[];
}
export interface BotWeaponTactics {
  readonly melee: boolean;
  readonly maximumRange: number | null;
  readonly aimAccuracy: number | null;
  readonly aimSkill: number | null;
  readonly weakness: number;
  readonly predictOccludedSplash: boolean;
}
export interface BotArsenalKnowledge {
  chooseWeapon(library: BotLibrary, state: BotState): number;
  tactics(weapon: number): BotWeaponTactics;
  aggression(state: BotState): number;
  updateInventory(state: BotState): void;
  weaponInfo(library: BotLibrary, handle: number, weapon: number): WeaponInfo | undefined;
}

export interface SourceBotGame {
  readonly options: {
    readonly product: "baseq3" | "missionpack";
    readonly cvars: CvarRegistry;
    readonly configstrings: ConfigStringStore;
    readonly engine: SourceBotEngine;
  };
  readonly gameType: number;
  readonly maxClients: number;
  readonly entityCount: number;
  readonly world: {
    trace(query: ServerTraceQuery): ServerTraceResult;
    pointContents(point: Vec3, passEntity: number): number;
  };
  readonly random: Pick<GameRandom, "random" | "crandom">;
  readonly clock: { readonly time: number; readonly startTime: number; readonly intermissionTime: number };
  readonly memory: GameMemory;
  readonly knowledge: BotArsenalKnowledge;
  entity(number: number): BotObservedEntity;
  modelIndex(name: string): number;
  chooseTeam(client: number): number;
  activateBot(client: number): void;
  exitLevel(): void;
  resetPodiumPlayers(): void;
  clientUserinfoChanged(client: number): void;
  clientConnect(client: number, firstTime: boolean, isBot: boolean): string | null;
  clientBegin(client: number): void;
}
