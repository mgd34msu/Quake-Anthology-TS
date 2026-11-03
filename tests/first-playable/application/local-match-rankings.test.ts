// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { Application, type ApplicationHost } from "../../../src/app/bootstrap/application.ts";
import { ApplicationMatchRankings, matchResultOf } from "../../../src/app/bootstrap/match-results.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayerProgressStore } from "../../../src/app/bootstrap/player-progress.ts";
import { callMethod, objectValue, readObject, readString } from "../../support/reflect.ts";
const corpus = (...files: string[]) => corpusTest(...files);
const test = corpus("q3a/baseq3/pak0.pk3"),
  q1Test = corpus("q1/id1/pak0.pak"),
  q2Test = corpus("q2/baseq2/pak0.pak"),
  nativeTest = corpus("q2/baseq2/pak0.pak", "q2/baseq2/gamex86.dll");

function host(rankings: ApplicationMatchRankings, printed: string[]): ApplicationHost {
  return {
    print: text => {
      printed.push(text);
    },
    localRankings: rankings,
    lobby: { complete: async () => undefined, returnToLobby: async () => undefined, account: { id: "account:00000000000000000000000000000001", name: "Host" } },
  };
}

test("a Q3 match end ranks the local account through the match-result ring", async () => {
  const parsed = parseApplicationCommand([
    "--content-root",
    testCorpusRoot(),
    "--game",
    "q3-baseq3",
    "--map",
    "q3dm1",
    "--movement",
    "q3",
    "--character",
    "q3",
    "--mode",
    "deathmatch",
    "--renderer",
    "cpu",
    "--hidden",
    "--width",
    "320",
    "--height",
    "240",
  ]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const rankings = new ApplicationMatchRankings(),
    printed: string[] = [];
  const app = await Application.open(parsed.options, host(rankings, printed));
  try {
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Missing Q3 source");
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    for (let index = 0; index < 10; index++) await app.step(50);
    expect(printed.some(line => line.startsWith("Local standings"))).toBe(false);
    for (let index = 0; index < 300 && app.simulation.players().length < 2; index++) {
      app.simulation.botServices.tryAddBot();
      await app.step(50);
    }
    expect(app.simulation.players().length).toBeGreaterThanOrEqual(2);
    source.host.cvars.set("fraglimit", "1", true);
    source.pool.clientAt(app.simulation.playerClient(local.actor)?.slot ?? -1).ps.persistant.set(PersistentIndex.PERS_SCORE, 5);
    for (let index = 0; index < 200 && source.level.intermissionTime === 0; index++) await app.step(50);
    expect(source.level.intermissionTime).not.toBe(0);
    for (let index = 0; index < 5; index++) await app.step(50);
    expect(printed.filter(line => line.startsWith("Local standings"))).toHaveLength(1);
    const standings = rankings.standings(app.simulation.recipe.match.provider);
    expect(standings).toHaveLength(1);
    expect(standings[0]).toMatchObject({ matches: 1, wins: 1 });
  } finally {
    await app.close();
  }
}, 240000);

q1Test(
  "a Q1 match end ranks the local account through the match-result ring and the standings persist",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "match-rankings-"));
    const parsed = parseApplicationCommand([
      "--content-root",
      testCorpusRoot(),
      "--game",
      "q1-classic-id1",
      "--map",
      "dm1",
      "--movement",
      "q1",
      "--character",
      "q1",
      "--mode",
      "deathmatch",
      "--renderer",
      "cpu",
      "--hidden",
      "--width",
      "320",
      "--height",
      "240",
      "--user-content-root",
      root,
    ]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const rankings = new ApplicationMatchRankings(),
      printed: string[] = [];
    const app = await Application.open(parsed.options, host(rankings, printed));
    try {
      const local = app.localPlayers[0];
      if (local === undefined) throw new Error("Missing local player");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(printed.some(line => line.startsWith("Local standings"))).toBe(false);
      callMethod(readObject(readObject(app.simulation, "source"), "cvars"), "set", "fraglimit", "3", true);
      const player = objectValue(callMethod(readObject(app.simulation, "sourceMatch"), "player", local.actor), "match player");
      callMethod(player, "setScore", 4);
      for (let index = 0; index < 200 && !printed.some(line => line.startsWith("Local standings")); index++) await app.step(50);
      expect(printed.filter(line => line.startsWith("Local standings"))).toHaveLength(1);
      const standings = rankings.standings(app.simulation.recipe.match.provider);
      expect(standings).toHaveLength(1);
      expect(standings[0]).toMatchObject({ matches: 1, wins: 1, score: 4 });
      expect(matchResultOf(app.simulation, "probe")?.players[0]?.identity).toEqual(expect.any(String));
      const restarted = new ApplicationMatchRankings();
      await restarted.attach(await PlayerProgressStore.open(join(readString(readObject(app, "inputConfig"), "root"), "player-progress.json")));
      expect(restarted.standings(app.simulation.recipe.match.provider)).toMatchObject([{ matches: 1, wins: 1, score: 4 }]);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);

q2Test(
  "a Q2 match end ranks the local account through the match-result ring",
  async () => {
    const parsed = parseApplicationCommand([
      "--content-root",
      testCorpusRoot(),
      "--game",
      "q2-classic-baseq2",
      "--map",
      "q2dm1",
      "--movement",
      "q2",
      "--character",
      "q2",
      "--mode",
      "deathmatch",
      "--renderer",
      "cpu",
      "--hidden",
      "--width",
      "320",
      "--height",
      "240",
    ]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const rankings = new ApplicationMatchRankings(),
      printed: string[] = [];
    const app = await Application.open(parsed.options, host(rankings, printed));
    try {
      const local = app.localPlayers[0];
      if (local === undefined) throw new Error("Missing local player");
      const source = app.simulation.q2Source();
      if (source === null) throw new Error("Missing Q2 source");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(printed.some(line => line.startsWith("Local standings"))).toBe(false);
      Reflect.set(readObject(readObject(source, "players"), "rules"), "fragLimit", 3);
      const player = objectValue(callMethod(readObject(app.simulation, "sourceMatch"), "player", local.actor), "match player");
      callMethod(player, "setScore", 4);
      for (let index = 0; index < 200 && !printed.some(line => line.startsWith("Local standings")); index++) await app.step(50);
      expect(printed.filter(line => line.startsWith("Local standings"))).toHaveLength(1);
      const standings = rankings.standings(app.simulation.recipe.match.provider);
      expect(standings[0]).toMatchObject({ matches: 1, wins: 1, score: 4 });
    } finally {
      await app.close();
    }
  },
  240000,
);

nativeTest(
  "a native Q2 DLL map transition produces the match result with public frag stats",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "native-rankings-"));
    const parsed = parseApplicationCommand([
      "--content-root",
      testCorpusRoot(),
      "--game",
      "q2-classic-baseq2",
      "--map",
      "q2dm1",
      "--q2-game",
      "gamex86.dll",
      "--movement",
      "q2",
      "--character",
      "q2",
      "--mode",
      "deathmatch",
      "--renderer",
      "cpu",
      "--hidden",
      "--width",
      "320",
      "--height",
      "240",
      "--user-content-root",
      root,
    ]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      const native = app.simulation.q2Native();
      if (native === null) throw new Error("Native source was not admitted");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(matchResultOf(app.simulation, "probe")).toBeNull();
      const result = matchResultOf(app.simulation, "probe", { kind: "game-module-map-transition", module: native.module });
      expect(result).toMatchObject({ family: "q2", players: [{ score: 0, won: true, identity: expect.any(String) }] });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);

const rereleaseTest = corpus("q2/rerelease/baseq2/pak0.pak", "q2/rerelease/baseq2/game_x64.dll");

function nativeRun(edition: "classic" | "rerelease", root: string): string[] {
  const game =
    edition === "classic" ? ["--game", "q2-classic-baseq2", "--q2-game", "gamex86.dll"] : ["--game", "q2-rerelease-baseq2", "--q2-game", "game_x64.dll"];
  return [
    "--content-root",
    testCorpusRoot(),
    ...game,
    "--map",
    "q2dm1",
    "--movement",
    "q2",
    "--character",
    "q2",
    "--mode",
    "deathmatch",
    "--renderer",
    "cpu",
    "--hidden",
    "--width",
    "320",
    "--height",
    "240",
    "--user-content-root",
    root,
  ];
}

nativeTest(
  "a classic native Q2 DLL deathmatch reaches its own timelimit intermission and ranks the local account",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "native-dll-match-"));
    const parsed = parseApplicationCommand(nativeRun("classic", root));
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const rankings = new ApplicationMatchRankings(),
      printed: string[] = [];
    const app = await Application.open(parsed.options, host(rankings, printed));
    try {
      expect(app.simulation.q2Native()?.edition).toBe("classic");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(printed.some(line => line.startsWith("Local standings"))).toBe(false);
      const cvars = app.simulation.q2ServerCvars();
      if (cvars === null) throw new Error("Missing Q2 server cvars");
      cvars.set("timelimit", "0.05", true);
      const seat = app.localPlayers[0]?.seat.id;
      if (seat === undefined) throw new Error("Missing local seat");
      for (let index = 0; index < 1200 && !printed.some(line => line.startsWith("Local standings")); index++) {
        await app.step(50);
        // The DLL leaves its intermission only on a button press after its own delay.
        if (printed.includes("Timelimit hit.\n") && index % 20 === 0)
          app.input({ kind: "mouse-button", seat, timeMilliseconds: performance.now(), button: 1, down: index % 40 === 0 });
      }
      expect(printed.filter(line => line.startsWith("Local standings"))).toHaveLength(1);
      const standings = rankings.standings(app.simulation.recipe.match.provider);
      expect(standings).toHaveLength(1);
      expect(standings[0]).toMatchObject({ matches: 1, wins: 1 });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);

rereleaseTest(
  "a rerelease native Q2 DLL deathmatch reaches its own timelimit intermission and ranks the local account",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "native-dll-match-"));
    const parsed = parseApplicationCommand(nativeRun("rerelease", root));
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const rankings = new ApplicationMatchRankings(),
      printed: string[] = [];
    const app = await Application.open(parsed.options, host(rankings, printed));
    try {
      expect(app.simulation.q2Native()?.edition).toBe("rerelease");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(printed.some(line => line.startsWith("Local standings"))).toBe(false);
      const cvars = app.simulation.q2ServerCvars();
      if (cvars === null) throw new Error("Missing Q2 server cvars");
      cvars.set("timelimit", "0.05", true);
      const seat = app.localPlayers[0]?.seat.id;
      if (seat === undefined) throw new Error("Missing local seat");
      for (let index = 0; index < 1200 && !printed.some(line => line.startsWith("Local standings")); index++) {
        await app.step(50);
        // The DLL leaves its intermission only on a button press after its own delay.
        if (printed.includes("Timelimit hit.\n") && index % 20 === 0)
          app.input({ kind: "mouse-button", seat, timeMilliseconds: performance.now(), button: 1, down: index % 40 === 0 });
      }
      expect(printed.filter(line => line.startsWith("Local standings"))).toHaveLength(1);
      const standings = rankings.standings(app.simulation.recipe.match.provider);
      expect(standings).toHaveLength(1);
      expect(standings[0]).toMatchObject({ matches: 1, wins: 1 });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);
