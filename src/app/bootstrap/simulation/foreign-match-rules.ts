// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../contracts/identity.ts";
import { DeathballRules } from "./foreign-deathball-rules.ts";
import { HordeRules } from "./foreign-horde-rules.ts";
import { FlagMatchRules } from "./foreign-lmctf-rules.ts";
import { ForeignMatchSpawns, type ForeignMatchHost, type ForeignMatchStrategy } from "./foreign-match-host.ts";
import { TagRules } from "./foreign-tag-rules.ts";

/**
 * The runtime match rules for worlds whose own source does not run the selected match provider
 * (Tag, LMCTF and flag CTF, DeathBall, and Q3 Horde). Each is a strategy with one contract: it
 * reports whether it is active, ticks once per settled frame, releases per-actor state when the
 * actor is released, and says whether it blocks saved games and same-map source restart.
 */
export class ForeignMatchRules {
  readonly tag: TagRules;
  readonly flags: FlagMatchRules;
  readonly deathball: DeathballRules;
  readonly horde: HordeRules;
  readonly #strategies: readonly ForeignMatchStrategy[];

  constructor(host: ForeignMatchHost) {
    const spawns = new ForeignMatchSpawns(host);
    this.horde = new HordeRules(host);
    this.tag = new TagRules(host, spawns);
    this.flags = new FlagMatchRules(host, spawns);
    this.deathball = new DeathballRules(host, spawns);
    this.#strategies = [this.horde, this.tag, this.flags, this.deathball];
  }

  tick(): void {
    for (const strategy of this.#strategies) strategy.tick();
  }

  release(actor: ActorId): void {
    for (const strategy of this.#strategies) strategy.release(actor);
  }

  /** True when a running mode holds state a saved game or source restart cannot carry. */
  blocksCheckpoint(): boolean {
    return this.#strategies.some(strategy => strategy.blocksCheckpoint());
  }

  registerCombat(): void {
    this.tag.registerCombat();
    this.flags.registerCombat();
    this.deathball.registerCombat();
  }
}
