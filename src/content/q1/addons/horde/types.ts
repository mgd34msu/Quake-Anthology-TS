import type { ActorId } from "../../../../contracts/identity.ts";

export interface Q1HordeServices {
  /** Source deadflag is distinct from shared health during death animations. */
  deadFlag(player: ActorId): number;
  noTarget(player: ActorId): boolean;
  isBot(player: ActorId): boolean;
  respawnTeammate(player: ActorId): undefined;
  addScore(player: ActorId, delta: number): undefined;
  /** Restarts the current map and applies source reset_flag to the new player travel parameters. */
  restartSession(map: string, startingServerFlags: number): undefined;
}
