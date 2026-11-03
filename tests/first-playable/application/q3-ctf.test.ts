import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { GameType, Team } from "../../../src/content/q3/base/shared/definitions.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
const test = corpusTest("q3a/baseq3/pak0.pk3");

// Capture the Flag rules on a Quake III product select the native GT_CTF
// gametype (provider q3:ctf): the launch seeds g_gametype and team
// auto-join so the local player and admitted bots land on balanced teams
// with both authored flags in play instead of the source spectator step.
test("CTF rules run native GT_CTF with teamed players on a Q3 world", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3ctf1", "--rules", "ctf",
    "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const game = sim.q3Source();
    if (game === null) throw new Error("Missing Q3 source game");
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(sim.recipe.match.provider).toBe("q3:ctf");
    expect(game.gameType).toBe(GameType.GT_CTF);
    const teamOf = (actor: ReturnType<typeof sim.players>[number]): number => {
      const client = game.records.nativeByActor(actor)?.client;
      return client === undefined || client === null ? -1 : client.sess.sessionTeam;
    };
    for (let index = 0; index < 40; index++) await app.step(50);
    expect([Team.TEAM_RED, Team.TEAM_BLUE]).toContain(teamOf(local.actor));
    const flagPaths = new Set(sim.presentations().map(model => model.path));
    expect(flagPaths.has("models/flags/r_flag.md3")).toBe(true);
    expect(flagPaths.has("models/flags/b_flag.md3")).toBe(true);
    for (let index = 0; index < 300 && sim.players().length < 5; index++) { sim.botServices.tryAddBot(); await app.step(50); }
    expect(sim.players().length).toBeGreaterThanOrEqual(5);
    for (let index = 0; index < 100; index++) await app.step(50);
    const teams = new Set(sim.players().map(actor => teamOf(actor)));
    expect(teams.has(Team.TEAM_RED)).toBe(true);
    expect(teams.has(Team.TEAM_BLUE)).toBe(true);
    expect(teams.has(Team.TEAM_SPECTATOR)).toBe(false);
    // Scores are live bot results, so only their presence as numbers is stable here.
    expect(Number.isFinite(game.level.teamScores.get(Team.TEAM_RED))).toBe(true);
    expect(Number.isFinite(game.level.teamScores.get(Team.TEAM_BLUE))).toBe(true);
  } finally { await app.close(); }
}, 240000);
