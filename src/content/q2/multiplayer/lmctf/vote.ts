/* LM_CTF 6.0 g_vote.c: implemented skip-level election. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { SaveReader } from "../../../../persistence/value.ts";
import type { Q2GameServices } from "../../foundation/host.ts";
import { lmctfName, lmctfPlayer, lmctfPrint, type LmctfContext } from "./types.ts";

export class LmctfVote {
  startedAt: number | null = null;
  constructor(readonly context: LmctfContext) {}
  private players(game: Q2GameServices) {
    return [...this.context.states].filter(([actor]) => this.context.hooks.player(actor)?.connected === true && game.entity(actor)?.classname === "player");
  }
  menu(actor: ActorId): undefined {
    const ballot = lmctfPlayer(this.context, actor).extraFlags;
    return this.context.hooks.emit({ kind: "menu", actor, title: "LMCTF Vote Menu", entries: this.startedAt === null
      ? [{ label: "Skip to next map", command: "lmctf-vote skip" }, { label: "Vote:     Idle", command: null }]
      : [{ label: "Vote YES", command: "voteyes" }, { label: "Vote NO", command: "voteno" }, { label: "Vote:     Started", command: null },
        { label: (ballot & 64) !== 0 ? "You have voted YES" : (ballot & 128) !== 0 ? "You have voted NO" : "You have not voted", command: null }] });
  }
  start(actor: ActorId, game: Q2GameServices): undefined {
    const players = this.players(game);
    for (const [, player] of players) player.extraFlags &= ~192;
    if (players.length < 4) lmctfPrint(game, "You need at least four players on the server to initiate a vote\n", actor);
    else if (this.startedAt !== null) lmctfPrint(game, "Vote has already been started\n", actor);
    else {
      this.startedAt = game.host.now(); lmctfPlayer(this.context, actor).extraFlags |= 64;
      lmctfPrint(game, `${lmctfName(this.context, actor)} started vote to skip level.\n`);
      const entity = game.entity(actor); if (entity !== null) game.sound(entity, "misc/secret.wav", 3, 1, 0);
    }
    return this.menu(actor);
  }
  ballot(actor: ActorId, game: Q2GameServices, yes: boolean): undefined {
    if (this.startedAt === null) return lmctfPrint(game, "A vote has not been initiated.\n", actor);
    const player = lmctfPlayer(this.context, actor); player.extraFlags = (player.extraFlags & ~192) | (yes ? 64 : 128);
    lmctfPrint(game, `You have voted ${yes ? "YES" : "NO"}\n`, actor); return this.menu(actor);
  }
  frame(game: Q2GameServices): undefined {
    if (this.startedAt === null || game.host.now() <= this.startedAt + 30) return undefined;
    this.startedAt = null; lmctfPrint(game, "Vote session has ended\n");
    let yes = 0, no = 0, abstained = 0;
    for (const [, player] of this.players(game)) { if ((player.extraFlags & 64) !== 0) yes++; else if ((player.extraFlags & 128) !== 0) no++; else abstained++; }
    lmctfPrint(game, `VOTE RESULT: YES:${yes}  NO:${no}  Abstained:${abstained}\n`);
    const total = yes + no;
    if (total < 2) return lmctfPrint(game, "Vote Fails: you need at least 2 ballots cast!\n");
    let percentage = Math.trunc(yes * 100 / total);
    if (yes * 100 % total > (total >> 1)) percentage++;
    if (percentage < 75) return lmctfPrint(game, `Vote Fails with ${100 - percentage} percent majority\n`);
    lmctfPrint(game, `Vote to skip level Passes with ${percentage} percent majority\n`);
    return this.context.hooks.endLevel(game, null);
  }
  capture() { return { startedAt: this.startedAt }; }
  restore(reader: SaveReader): undefined { this.startedAt = reader.field("startedAt").nullable(value => value.finite()); return undefined; }
}
