import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { callMethod, numberValue, objectValue, readNumber, readObject } from "../../support/reflect.ts";

// Q3 has no monsters, so horde mode runs escalating bot waves through the
// shared runtime: bots are admitted per wave via the bot catalog, retired
// through the bot transport when every wave bot has died once, and the next
// wave admits one more. Death observation reads the native PERS_KILLED
// counter (the value player_die increments); the test advances that counter
// directly, while admission, retirement and re-admission run for real --
// re-admission is what caught a leaked session client slot on wave 2.
test("Q3 horde admits, clears and escalates bot waves", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "horde",
    "--movement", "q3", "--character", "q3", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const wave = (): number => readNumber(sim, "hordeWave");
    const pendingWave = (): number => readNumber(sim, "hordePendingWave");
    const fraggedSize = (): number => readNumber(readObject(sim, "hordeFragged"), "size");
    expect(sim.recipe.match.provider).toBe("q3:horde");
    const bots = () => sim.players().filter(actor => sim.botServices.isBot(actor));
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 600; index++) { await app.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}: wave=${wave()} pending=${pendingWave()} bots=${bots().length}`);
    };
    const persistantOf = (actor: ReturnType<typeof sim.players>[number]): object => {
      const records = readObject(readObject(readObject(sim, "source"), "game"), "records");
      const entity = objectValue(callMethod(records, "nativeByActor", actor), "native entity");
      return readObject(readObject(readObject(entity, "client"), "ps"), "persistant");
    };
    const killWaveBots = (): void => {
      for (const bot of bots()) {
        const persistant = persistantOf(bot);
        callMethod(persistant, "set", PersistentIndex.PERS_KILLED,
          numberValue(callMethod(persistant, "get", PersistentIndex.PERS_KILLED), "PERS_KILLED") + 1);
      }
    };
    await stepUntil(() => wave() === 1 && bots().length >= 2 && fraggedSize() >= 2, "wave 1 to fill with 2 bots");
    killWaveBots();
    await stepUntil(() => wave() === 0 && pendingWave() === 2 && bots().length === 0, "wave 1 to clear and retire its bots");
    await stepUntil(() => wave() === 2 && bots().length >= 3 && fraggedSize() >= 3, "wave 2 to fill with 3 bots");
    killWaveBots();
    await stepUntil(() => wave() === 0 && pendingWave() === 3 && bots().length === 0, "wave 2 to clear");
    await stepUntil(() => wave() === 3 && bots().length >= 4, "wave 3 to admit 4 bots");
  } finally { await app.close(); }
}, 240000);
