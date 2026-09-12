import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { BotArsenalKnowledge } from "../../../bots/behavior/q3/game-host.ts";
import type { WeaponState } from "../../../content/q3/base/shared/definitions.ts";
import { createQ1BotKnowledge } from "./bot-q1-knowledge.ts";
import { createQ2BotKnowledge } from "./bot-q2-knowledge.ts";
import { createQ3BotKnowledge } from "./bot-q3-knowledge.ts";
import type { SharedSimulation } from "./runtime.ts";

export interface BotArsenalBinding {
  readonly knowledge: BotArsenalKnowledge;
  readonly uncoveredWeapons: readonly string[];
  resolveWeapon(client: number, decisionSlot: number): ItemId | null;
  sourceWeapon(client: number): number;
  sourceWeaponState(client: number): WeaponState;
}

export function createBotArsenalBinding(simulation: SharedSimulation, actorForClient: (client: number) => ActorId | null): BotArsenalBinding | null {
  if (simulation.q2WeaponSource() !== null) return createQ2BotKnowledge({ simulation, actorForClient });
  if (simulation.q1WeaponSource() !== null) return createQ1BotKnowledge({ simulation, actorForClient });
  if (simulation.selectedQ3WeaponSource() !== null) return createQ3BotKnowledge({ simulation, actorForClient });
  return null;
}
