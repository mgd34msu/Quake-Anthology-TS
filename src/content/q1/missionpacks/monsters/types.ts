/* Hipnotic/Rogue QuakeC. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1CallbackHandlers } from "../../foundation/callbacks.ts";
import type { MonsterAi, MonsterFrame, MonsterSpecies } from "../../base/index.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";

export interface MissionMonsterHooks {
  readonly charmer?: () => ActorId | null;
}
export type MissionAction = (monster: MissionMonster) => undefined;
export interface PackMonsterDefinition {
  readonly spec: MonsterSpecies;
  readonly baseBehavior?: boolean;
  readonly frames: ReadonlyMap<string, MonsterFrame>;
  readonly actions: Readonly<Record<string, MissionAction>>;
  readonly callbacks?: Readonly<Record<string, Q1CallbackHandlers>>;
  readonly spawn?: MissionAction;
  readonly start?: MissionAction;
  readonly pain: (monster: MissionMonster, attacker: ActorId | null, damage: number) => undefined;
  readonly die: (monster: MissionMonster, attacker: ActorId | null) => undefined;
  readonly melee?: MissionAction;
  readonly checkAttack?: (monster: MissionMonster) => boolean;
  readonly found?: (monster: MissionMonster, target: ActorId) => undefined;
  readonly ai?: (monster: MissionMonster, mode: MonsterAi, distance: number) => undefined;
  readonly use?: (monster: MissionMonster, activator: ActorId | null) => undefined;
}
export type PackMonsterFactory = (runtime: Q1MissionPackMonsters) => readonly PackMonsterDefinition[];
export type MissionSpawn = (entity: Q1Actor) => undefined;
