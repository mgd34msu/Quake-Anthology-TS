// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { corpusTest, testCorpusRoot } from "../../support/corpus.ts";

// Q3 has no monsters, so horde mode runs escalating bot waves through the
// shared runtime: bots are admitted per wave via the bot catalog, retired
// through the bot transport when every wave bot has died once, and the next
// wave admits one more. Death observation reads the native PERS_KILLED
// counter (the value player_die increments); the test advances that counter
// directly, while admission, retirement and re-admission run for real --
// re-admission is what caught a leaked session client slot on wave 2.
corpusTest("q3a/baseq3/pak0.pk3")(
  "Q3 horde admits, clears and escalates bot waves",
  async () => {
    const parsed = parseApplicationCommand([
      "--content-root",
      testCorpusRoot(),
      "--game",
      "q3-baseq3",
      "--map",
      "q3dm1",
      "--rules",
      "horde",
      "--movement",
      "q3",
      "--character",
      "q3",
      "--mode",
      "singleplayer",
      "--renderer",
      "cpu",
      "--hidden",
      "--width",
      "320",
      "--height",
      "240",
    ]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      const sim = app.simulation;
      const wave = (): number => sim.diagnostics().horde.wave();
      const pendingWave = (): number => sim.diagnostics().horde.pendingWave();
      const fraggedSize = (): number => sim.diagnostics().horde.fraggedCount();
      expect(sim.recipe.match.provider).toBe("q3:horde");
      const bots = () => sim.players().filter(actor => sim.botServices.isBot(actor));
      const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
        for (let index = 0; index < 600; index++) {
          await app.step(50);
          if (condition()) return;
        }
        throw new Error(`Timed out waiting for ${label}: wave=${wave()} pending=${pendingWave()} bots=${bots().length}`);
      };
      const killWaveBots = (): void => {
        for (const bot of bots()) {
          const persistant = sim.q3Source()?.records.nativeByActor(bot)?.client?.ps.persistant;
          if (persistant === undefined) throw new Error("Missing native Q3 client");
          persistant.set(PersistentIndex.PERS_KILLED, persistant.get(PersistentIndex.PERS_KILLED) + 1);
        }
      };
      await stepUntil(() => wave() === 1 && bots().length >= 2 && fraggedSize() >= 2, "wave 1 to fill with 2 bots");
      killWaveBots();
      await stepUntil(() => wave() === 0 && pendingWave() === 2 && bots().length === 0, "wave 1 to clear and retire its bots");
      await stepUntil(() => wave() === 2 && bots().length >= 3 && fraggedSize() >= 3, "wave 2 to fill with 3 bots");
      killWaveBots();
      await stepUntil(() => wave() === 0 && pendingWave() === 3 && bots().length === 0, "wave 2 to clear");
      await stepUntil(() => wave() === 3 && bots().length >= 4, "wave 3 to admit 4 bots");
    } finally {
      await app.close();
    }
  },
  240000,
);
