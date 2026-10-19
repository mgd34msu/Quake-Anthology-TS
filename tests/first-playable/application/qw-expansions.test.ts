import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

// Every QuakeWorld edition of a mission pack must run its native dedicated
// deathmatch server on the campaign's own maps: inline brush models are
// engine-known at map load (makestatic never precached them), and MG3 maps
// carry no MG3 monster classes under qwprogs, so monster navigation must
// not gate the launch.
const launches: (readonly [string, string])[] = [
  ["q1-quakeworld", "dm3"],
  ["q1-quakeworld-hipnotic", "start"],
  ["q1-quakeworld-rogue", "start"],
  ["q1-quakeworld-dopa", "start"],
  ["q1-quakeworld-mg1", "start"],
  ["q1-quakeworld-mg3", "start"],
];

test("QuakeWorld mission-pack editions serve dedicated deathmatch on their own maps", async () => {
  for (const [game, map] of launches) {
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", game, "--map", map,
      "--dedicated", "--mode", "deathmatch", "--movement", "qw", "--character", "q1"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      for (let index = 0; index < 20; index++) await app.step(50);
      expect(app.simulation.recipe.map.entities.provider).toBe("q1:official");
      expect(app.simulation.recipe.match.provider).toBe("q1:official");
      expect(app.simulation.quakecSource()).not.toBeNull();
    } finally { await app.close(); }
  }
}, 240000);
