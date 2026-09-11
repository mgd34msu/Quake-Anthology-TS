import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import type { Q2MissionPack } from "../types.ts";
import type { Q2MissionPackEntityHooks } from "./types.ts";
import { Q2XatrixEntities } from "./xatrix.ts";
import { Q2RogueEntities } from "./rogue.ts";
import type { Q2RogueEntitiesCheckpoint } from "./rogue.ts";
import { Q2RogueMovers } from "./movers.ts";

export class Q2MissionPackEntities implements Q2SpawnModule {
  private readonly source: Q2XatrixEntities | Q2RogueEntities;
  readonly movers: Q2RogueMovers | null;
  constructor(readonly pack: Q2MissionPack, hooks: Q2MissionPackEntityHooks) {
    this.source = pack === "xatrix" ? new Q2XatrixEntities(hooks) : new Q2RogueEntities(hooks);
    this.movers = pack === "rogue" ? new Q2RogueMovers(hooks) : null;
  }
  get callbacks() {
    const source = this.source.callbacks, movers = this.movers?.callbacks;
    return { think: { ...source.think, ...movers?.think }, use: { ...source.use, ...movers?.use }, touch: { ...source.touch, ...movers?.touch }, die: { ...source.die, ...movers?.die }, blocked: { ...source.blocked, ...movers?.blocked } };
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean { return this.source.spawn(entity, game) || this.movers?.spawn(entity, game) === true; }
  capture(): Q2RogueEntitiesCheckpoint { return this.source instanceof Q2RogueEntities ? this.source.capture() : { steamId: 0 }; }
  restore(state: Q2RogueEntitiesCheckpoint): undefined { return this.source instanceof Q2RogueEntities ? this.source.restore(state) : undefined; }
}

export type { Q2MissionPackEntityHooks, Q2MissionPackEntityEvent } from "./types.ts";
export type { Q2RogueEntitiesCheckpoint } from "./rogue.ts";
