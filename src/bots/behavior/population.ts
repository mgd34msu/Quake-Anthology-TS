import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { SourceBotDirector } from "./director.ts";
import type { BotGameModeT } from "./rerelease/data/knowledge.ts";
import type { RereleaseBotBehavior, RereleaseBehaviorCheckpoint } from "./rerelease/profile.ts";
import type { BotUsercmdT, BotWorldT } from "./rerelease/world.ts";

export interface BotFrame {
  readonly timeMilliseconds: number;
  readonly elapsedMilliseconds: number;
}

export interface RereleaseBotBinding {
  readonly actor: OwnedActor;
  readonly provider: ProviderId;
  readonly behavior: RereleaseBotBehavior;
  observe(frame: BotFrame): BotWorldT;
  encode(command: BotUsercmdT, frame: BotFrame): Pick<ActorCommand, "command" | "arsenal">;
}

export interface RereleaseBotCheckpoint {
  readonly version: 1;
  readonly provider: ProviderId;
  readonly nextCommandSequence: number;
  readonly behavior: RereleaseBehaviorCheckpoint;
}

interface RereleaseBot {
  readonly binding: RereleaseBotBinding;
  sequence: number;
}

/** Behavior ownership and command collection; admitted actors remain session-owned. */
export class SharedBotPopulation {
  private readonly rerelease = new Map<ActorId, RereleaseBot>();

  constructor(private readonly isLive: (actor: ActorId) => boolean, readonly arena: SourceBotDirector | null) {}

  bindRerelease(binding: RereleaseBotBinding): void {
    if (!this.isLive(binding.actor.id)) throw new Error("Bot behavior requires an admitted live actor");
    if (this.find(binding.actor.id) !== null || this.arena?.roster().some(entry => entry.actor.id.equals(binding.actor.id))) {
      throw new Error("An actor already has bot behavior");
    }
    this.rerelease.set(binding.actor.id, { binding, sequence: 0 });
  }

  private find(actor: ActorId): RereleaseBot | null {
    for (const [id, entry] of this.rerelease) if (id.equals(actor)) return entry;
    return null;
  }
  private require(actor: ActorId): RereleaseBot {
    const entry = this.find(actor);
    if (entry === null) throw new Error("Actor has no rerelease bot behavior binding");
    return entry;
  }

  /** The session consumes these commands in its existing player-command phase. */
  frame(frame: BotFrame): readonly ActorCommand[] {
    const commands = [...(this.arena?.frame(frame.timeMilliseconds) ?? [])];
    for (const [actor, entry] of this.rerelease) {
      if (!this.isLive(actor)) { this.rerelease.delete(actor); continue; }
      if (commands.some(command => command.actor.equals(actor))) throw new Error("Two behavior profiles generated commands for the same actor");
      const world = entry.binding.observe(frame), command = entry.binding.behavior.think(world);
      commands.push({ actor, source: { kind: "bot", provider: entry.binding.provider }, sequence: entry.sequence++,
        ...entry.binding.encode(command, frame) });
    }
    return commands;
  }

  moveToPoint(actor: ActorId, point: Vec3): void { this.require(actor).binding.behavior.requestMoveToPoint(point); }
  followEntity(actor: ActorId, sourceEntity: number, origin: Vec3): void { this.require(actor).binding.behavior.requestFollowEntity(sourceEntity, origin); }
  clearGoal(actor: ActorId): void { this.require(actor).binding.behavior.clearExplicitGoal(); }
  goalStatus(actor: ActorId): number { return this.require(actor).binding.behavior.goalStatus(); }
  setGameMode(actor: ActorId, mode: BotGameModeT): void { this.require(actor).binding.behavior.brain.setGameMode(mode); }
  chat(actor: ActorId, event: string): void { this.require(actor).binding.behavior.brain.emitChat(event); }
  resetForLevel(actor: ActorId, mode: BotGameModeT): void { this.require(actor).binding.behavior.resetForLevel(mode); }
  unbind(actor: ActorId): void { const entry = this.find(actor); if (entry !== null) this.rerelease.delete(entry.binding.actor.id); }

  captureRerelease(actor: ActorId): RereleaseBotCheckpoint {
    const entry = this.require(actor);
    return { version: 1, provider: entry.binding.provider, nextCommandSequence: entry.sequence,
      behavior: entry.binding.behavior.checkpoint() };
  }
  restoreRerelease(actor: ActorId, checkpoint: RereleaseBotCheckpoint): void {
    const entry = this.require(actor);
    if (checkpoint.version !== 1 || checkpoint.provider !== entry.binding.provider || !Number.isSafeInteger(checkpoint.nextCommandSequence)
      || checkpoint.nextCommandSequence < 0) throw new Error("Bot checkpoint does not match the admitted behavior binding");
    entry.binding.behavior.restore(checkpoint.behavior);
    entry.sequence = checkpoint.nextCommandSequence;
  }
}
