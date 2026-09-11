/* LM_CTF 6.0 g_tourney.c. GPL-2.0-or-later. */
import type { SaveReader } from "../../../../persistence/value.ts";
import type { Q2GameServices } from "../../foundation/host.ts";
import { lmctfPrint, type LmctfContext } from "./types.ts";

export class LmctfMatch {
  phase: "none" | "countdown" | "inplay" | "over" = "none";
  remaining = 0;
  nextThink = 0;
  paused = false;
  teamsLocked = false;
  constructor(readonly context: LmctfContext) {}
  canScore(): boolean { return this.phase !== "countdown" && this.phase !== "over"; }
  start(game: Q2GameServices): undefined {
    this.phase = "countdown"; this.remaining = Math.trunc(this.context.rules.countdownSeconds); this.nextThink = game.host.now() + 1;
    if (this.context.rules.autoLock) this.teamsLocked = true;
    return undefined;
  }
  stop(): undefined { this.phase = "none"; if (this.context.rules.autoLock) this.teamsLocked = false; return undefined; }
  frame(game: Q2GameServices): undefined {
    if (this.phase === "none" || game.host.now() < this.nextThink) return undefined;
    this.nextThink = game.host.now() + 1;
    if (this.paused) return undefined;
    if (this.phase === "countdown") {
      if ([60, 30, 15, 10].includes(this.remaining)) lmctfPrint(game, `${this.remaining} seconds until match begins.\n`);
      if (this.remaining <= 0) {
        for (const [actor, state] of this.context.states) {
          const player = this.context.hooks.player(actor), entity = game.entity(actor);
          if (player === null || player.spectator || entity === null) continue;
          game.damage(actor, entity, actor, 100000, 0, { x: 0, y: 0, z: 0 }, game.body(entity).origin, { x: 0, y: 0, z: 0 }, 23, 32);
          state.statistics.clear(); player.score = 0; state.spawnState = 0;
        }
        this.phase = "inplay"; this.remaining = Math.trunc(this.context.rules.timeLimitMinutes) * 60;
        lmctfPrint(game, `${this.remaining / 60} minutes until match ends.\n`);
      }
    } else if (this.phase === "inplay") {
      if (this.remaining > 10 && this.context.rules.fragLimit !== 0 && [...this.context.states.values()].some(state => (state.statistics.get("score") ?? 0) >= this.context.rules.fragLimit)) this.remaining = 10;
      if (this.remaining <= 0) {
        let red = 0, blue = 0;
        for (const state of this.context.states.values()) { if (state.team === 1) red += state.statistics.get("score") ?? 0; else if (state.team === 2) blue += state.statistics.get("score") ?? 0; }
        lmctfPrint(game, red > blue ? `Red: ${red} beats blue: ${blue}!\n` : blue > red ? `Blue: ${blue} beats red: ${red}!\n` : `Tie game at ${red}!\n`);
        this.phase = "over"; this.remaining = 300; this.teamsLocked = false; return undefined;
      }
    } else if (this.remaining <= 0) this.phase = "none";
    this.remaining--; return undefined;
  }
  capture() { return { phase: this.phase, remaining: this.remaining, nextThink: this.nextThink, paused: this.paused, teamsLocked: this.teamsLocked }; }
  restore(reader: SaveReader): undefined {
    this.phase = reader.field("phase").choice("none", "countdown", "inplay", "over"); this.remaining = reader.field("remaining").integer();
    this.nextThink = reader.field("nextThink").finite(); this.paused = reader.field("paused").boolean(); this.teamsLocked = reader.field("teamsLocked").boolean(); return undefined;
  }
}
