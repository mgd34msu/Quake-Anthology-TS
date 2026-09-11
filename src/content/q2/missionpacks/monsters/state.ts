import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { restoreQ2Actor, saveQ2Actor } from "../../foundation/checkpoint.ts";
import type { Q2RogueHintsCheckpoint } from "./hints.ts";

/** Source monsterinfo additions shared by the Rogue summoners and their children. */
export interface RogueMonsterState {
  blocked: boolean;
  turretOrientation: number;
  healer: ActorId | null;
  badMedic1: ActorId | null;
  badMedic2: ActorId | null;
  medicTries: number;
  summonStrength: number;
  lastPlayerEnemy: ActorId | null;
  badArea: ActorId | null;
  goodGuy: boolean;
  widowQuadUntil: number;
  widowDoubleUntil: number;
  widowInvulnerableUntil: number;
}
export interface Q2MissionPackMonstersCheckpoint {
  readonly version: 1;
  readonly flyerNextMove: "none" | "run";
  readonly hints: Q2RogueHintsCheckpoint | null;
  readonly widowShotsFired: number;
  readonly widowDamageMultiplier: 1 | 2 | 4;
  readonly actors: readonly {
    readonly actor: SavedActorId;
    readonly state: Omit<RogueMonsterState, "healer" | "badMedic1" | "badMedic2" | "lastPlayerEnemy" | "badArea"> & { readonly healer: SavedActorId | null; readonly badMedic1: SavedActorId | null; readonly badMedic2: SavedActorId | null; readonly lastPlayerEnemy: SavedActorId | null; readonly badArea: SavedActorId | null };
  }[];
}
export class Q2MissionPackMonsterState {
  private readonly actors = new Map<ActorId, RogueMonsterState>();
  flyerNextMove: "none" | "run" = "none";
  widowShotsFired = 0;
  widowDamageMultiplier: 1 | 2 | 4 = 1;

  get(entity: Q2Entity): RogueMonsterState {
    let state = this.actors.get(entity.actor.id);
    if (state === undefined) {
      state = { blocked: false, turretOrientation: 0, healer: null, badMedic1: null, badMedic2: null, medicTries: 0, summonStrength: 0, lastPlayerEnemy: null, badArea: null, goodGuy: false, widowQuadUntil: 0, widowDoubleUntil: 0, widowInvulnerableUntil: 0 };
      this.actors.set(entity.actor.id, state);
    }
    return state;
  }

  capture(game: Q2GameServices): Q2MissionPackMonstersCheckpoint {
    const actors: Q2MissionPackMonstersCheckpoint["actors"][number][] = [];
    for (const [actor, state] of this.actors) {
      if (!game.host.actors.isLive(actor)) continue;
      actors.push({ actor: { slot: actor.slot, generation: actor.generation }, state: { ...state, healer: saveQ2Actor(state.healer), badMedic1: saveQ2Actor(state.badMedic1), badMedic2: saveQ2Actor(state.badMedic2), lastPlayerEnemy: saveQ2Actor(state.lastPlayerEnemy), badArea: saveQ2Actor(state.badArea) } });
    }
    return { version: 1, actors, flyerNextMove: this.flyerNextMove, hints: null, widowShotsFired: this.widowShotsFired, widowDamageMultiplier: this.widowDamageMultiplier };
  }

  restore(game: Q2GameServices, checkpoint: Q2MissionPackMonstersCheckpoint): undefined {
    this.actors.clear();
    this.flyerNextMove = checkpoint.flyerNextMove;
    this.widowShotsFired = checkpoint.widowShotsFired; this.widowDamageMultiplier = checkpoint.widowDamageMultiplier;
    for (const saved of checkpoint.actors) {
      const actor = restoreQ2Actor(game, saved.actor);
      this.actors.set(actor.id, { ...saved.state,
        healer: saved.state.healer === null ? null : game.host.actors.referenceSaved(saved.state.healer),
        badMedic1: saved.state.badMedic1 === null ? null : game.host.actors.referenceSaved(saved.state.badMedic1),
        badMedic2: saved.state.badMedic2 === null ? null : game.host.actors.referenceSaved(saved.state.badMedic2),
        lastPlayerEnemy: saved.state.lastPlayerEnemy === null ? null : game.host.actors.referenceSaved(saved.state.lastPlayerEnemy),
        badArea: saved.state.badArea === null ? null : game.host.actors.referenceSaved(saved.state.badArea),
      });
    }
    return undefined;
  }
}
