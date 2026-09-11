import type { Vec3 } from "../../contracts/math.ts";
import type { BotGoalStatus } from "./orders.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { SourceBotDirector } from "./director.ts";

export interface BotFrame {
  readonly timeMilliseconds: number;
  readonly elapsedMilliseconds: number;
}

/** One decision controller drives all admitted bot actors through ordinary player commands. */
export class SharedBotPopulation {
  constructor(private readonly isLive: (actor: ActorId) => boolean, readonly director: SourceBotDirector) {}
  requestMoveToPoint(actor: ActorId, point: Vec3): BotGoalStatus {
    const client = this.clientFor(actor);
    return client === null ? 0 : this.director.requestMoveToPoint(client, point);
  }
  /** The target number is from the director observation view, not the actor registry slot. */
  requestFollowEntity(actor: ActorId, entity: number): BotGoalStatus {
    const client = this.clientFor(actor);
    return client === null ? 0 : this.director.requestFollowEntity(client, entity);
  }
  clearGoal(actor: ActorId): void { const client = this.clientFor(actor); if (client !== null) this.director.clearGoal(client); }
  goalStatus(actor: ActorId): BotGoalStatus { const client = this.clientFor(actor); return client === null ? 0 : this.director.goalStatus(client); }
  private clientFor(actor: ActorId): number | null {
    return this.isLive(actor) ? this.director.roster().find(entry => entry.actor.id.equals(actor))?.sourceClient ?? null : null;
  }
  frame(frame: BotFrame): readonly ActorCommand[] {
    const commands = this.director.frame(frame.timeMilliseconds), seen = new Set<ActorId>();
    for (const command of commands) {
      if (!this.isLive(command.actor)) throw new Error("Bot command targets an actor outside the shared world");
      if (seen.has(command.actor)) throw new Error("Two bot commands target the same actor in one frame");
      seen.add(command.actor);
    }
    return commands;
  }
}
