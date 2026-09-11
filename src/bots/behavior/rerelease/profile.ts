import { BotBrain } from "./brain.ts";
import type { BotBrainCheckpoint, BotBrainConfigT, BotChatEventT } from "./brain.ts";
import type { BotKnowledge, BotGameModeT } from "./data/knowledge.ts";
import type { CharacterEntry } from "./data/botdata.ts";
import type { BotVec3 } from "./math.ts";
import { Xorshift32 } from "./rng.ts";
import type { BotUsercmdT, BotWorldT } from "./world.ts";

export type RereleaseSource = "q1-rerelease" | "q2-rerelease";
export type RereleaseThinkCallback = "Bot_PreThink" | "Bot_PostThink" | "Bot_BeginFrame" | "Bot_EndFrame";
export interface RereleaseOrders {
  requestMoveToPoint(point: BotVec3): void;
  requestFollowEntity(entity: number, origin: BotVec3): void;
  clearExplicitGoal(): void;
  goalStatus(): number;
}
export interface RereleaseCallbacks {
  /** The session's clock; this behavior never advances it. */
  time(): number;
  /** Original shipped hooks are empty; selected source mods may provide these named callbacks. */
  preThink(name: "Bot_PreThink" | "Bot_BeginFrame", orders: RereleaseOrders): void;
  postThink(name: "Bot_PostThink" | "Bot_EndFrame", command: BotUsercmdT): void;
  chat(event: BotChatEventT): void;
  /** Resolves the selected arsenal, then invokes its existing weapon selection callback. */
  selectWeapon(weaponNumber: number): void;
  weaponImpulse(weaponNumber: number): number;
  humanTeammateNear(): boolean;
}
export interface RereleaseProfileOptions {
  /** Mounted source definition identity, checked when restoring behavior memory. */
  readonly definition: string;
  readonly source: RereleaseSource;
  readonly knowledge: BotKnowledge;
  readonly skill: string;
  readonly seed: number;
  readonly gameMode: BotGameModeT;
  readonly character?: CharacterEntry;
  readonly maxHealth: number;
  readonly runSpeed: number;
  readonly walkSpeed: number;
  readonly movement: NonNullable<BotBrainConfigT["movement"]>;
  readonly callbacks: RereleaseCallbacks;
}
export interface RereleaseBehaviorCheckpoint {
  readonly version: 1;
  readonly source: RereleaseSource;
  readonly definition: string;
  readonly rng: number;
  readonly brain: BotBrainCheckpoint;
  readonly pendingChats: readonly { readonly time: number; readonly event: BotChatEventT }[];
}

/** One admitted actor's behavior only. Actor allocation, inventory, and command encoding belong to the population. */
export class RereleaseBotBehavior implements RereleaseOrders {
  readonly brain: BotBrain;
  readonly random: Xorshift32;
  private pendingChats: { readonly time: number; readonly event: BotChatEventT }[] = [];
  constructor(readonly options: RereleaseProfileOptions) {
    this.random = new Xorshift32(options.seed);
    const config: BotBrainConfigT = { knowledge: options.knowledge, skill: options.skill, rng: this.random,
      gameMode: options.gameMode, maxHealth: options.maxHealth, runSpeed: options.runSpeed, walkSpeed: options.walkSpeed,
      movement: options.movement, ...(options.character === undefined ? {} : { character: options.character }),
      onChat: event => this.pendingChats.push({ time: options.callbacks.time() + event.delayMs / 1000, event: { ...event } }),
      humanTeammateNear: () => options.callbacks.humanTeammateNear(),
      ...(options.source === "q1-rerelease" ? { weaponImpulse: (number: number) => options.callbacks.weaponImpulse(number) }
        : { onWeaponSelect: (number: number) => options.callbacks.selectWeapon(number) }) };
    this.brain = new BotBrain(config);
  }
  think(world: BotWorldT): BotUsercmdT {
    const callbacks = this.options.callbacks;
    callbacks.preThink(this.options.source === "q1-rerelease" ? "Bot_PreThink" : "Bot_BeginFrame", this);
    const command = this.brain.think(world);
    callbacks.postThink(this.options.source === "q1-rerelease" ? "Bot_PostThink" : "Bot_EndFrame", command);
    const now = callbacks.time(), ready = this.pendingChats.filter(entry => entry.time <= now);
    this.pendingChats = this.pendingChats.filter(entry => entry.time > now);
    for (const entry of ready) callbacks.chat({ ...entry.event });
    return command;
  }
  requestMoveToPoint(point: BotVec3): void { this.brain.requestMoveToPoint(point); }
  requestFollowEntity(entity: number, origin: BotVec3): void { this.brain.requestFollowEntity(entity, origin); }
  clearExplicitGoal(): void { this.brain.clearExplicitGoal(); }
  goalStatus(): number { return this.brain.goalStatus(); }
  resetForLevel(mode: BotGameModeT): void { this.brain.resetForLevel(); this.brain.setGameMode(mode); this.pendingChats = []; }
  checkpoint(): RereleaseBehaviorCheckpoint {
    return { version: 1, source: this.options.source, definition: this.options.definition,
      rng: this.random.peek(), brain: this.brain.checkpoint(), pendingChats: structuredClone(this.pendingChats) };
  }
  restore(checkpoint: RereleaseBehaviorCheckpoint): void {
    if (checkpoint.version !== 1 || checkpoint.source !== this.options.source || checkpoint.definition !== this.options.definition)
      throw new Error("Rerelease behavior checkpoint belongs to another mounted source definition");
    this.brain.restore(checkpoint.brain); this.random.restore(checkpoint.rng);
    this.pendingChats = checkpoint.pendingChats.map(entry => ({ time: entry.time, event: { ...entry.event } }));
  }
}
