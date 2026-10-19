import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { readObject, readString } from "../../support/reflect.ts";

// Unified matrix: rerelease-authored Q1 campaigns must load and play as true
// classic-edition products (classic engine behaviour and physics), with the
// campaign's own source program, BSP dialect, entities, monsters and HUD.
const classicCampaigns: readonly (readonly [string, string])[] = [["q1-classic-dopa", "dopa"], ["q1-classic-mg1", "mg1"], ["q1-classic-mg3", "mg3"]];
for (const [product, program] of classicCampaigns) {
  test(`${product} plays rerelease campaign content under classic Quake`, async () => {
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", product, "--map", "start",
      "--movement", "q1", "--character", "q1", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      for (let index = 0; index < 20; index++) await app.step(50);
      const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
      expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
      const source = readObject(app.simulation, "source");
      expect(readString(source, "kind")).toBe("q1");
      expect(readString(readObject(readObject(source, "composition"), "selection"), "program")).toBe(program);
      expect(readString(readObject(readObject(source, "game"), "options"), "edition")).toBe("classic");
      expect(app.simulation.recipe.engineBehavior.content).toContain(":classic:");
    } finally { await app.close(); }
  }, 120000);
}
