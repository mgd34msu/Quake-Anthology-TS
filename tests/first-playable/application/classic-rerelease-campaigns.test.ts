import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
import { holdFire, holdForward } from "../../support/matrix-play.ts";
const test = corpusTest("q1/id1/pak0.pak", "q2/baseq2/pak0.pak", "q3a/baseq3/pak0.pk3");

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
      const origin = (): { readonly x: number; readonly y: number } => app.simulation.bodies.read(local.actor)?.origin ?? { x: Number.NaN, y: Number.NaN };
      expect(await holdForward(app, local.seat.id, origin, 20, 119)).toBeGreaterThan(32);
      app.queueCommand("weapon", ["2"], local.seat.id);
      for (let index = 0; index < 20; index++) await app.step(50);
      const shells = (): number => app.simulation.inventory.count(local.actor, "q1:ammo/shells");
      const fired = await holdFire(app, local.seat.id, shells, () => app.simulation.playerUi(local.actor).activeWeapon, 20);
      expect(fired.ammoBefore).toBeGreaterThan(0);
      expect(fired.ammoAfter).toBeLessThan(fired.ammoBefore);
      const source = app.simulation.diagnostics().source();
      expect(source.kind).toBe("q1");
      expect(source.q1?.program).toBe(program);
      expect(source.q1?.edition).toBe("classic");
      expect(app.simulation.recipe.engineBehavior.content).toContain(":classic:");
    } finally { await app.close(); }
  }, 120000);
}
