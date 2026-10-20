import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { callMethod, numberValue, objectValue, readBoolean, readField, readObject } from "../../support/reflect.ts";

// DeathBall (provider q2:deathball) is its own PvP mod and must play on
// foreign worlds: Q2 worlds keep the native composition module, everywhere
// else the shared runtime mirrors Rogue DeathBall over unified actors (ball
// synthesized with both goals from deathmatch spawns when the map has no
// authored dm_dball entities, balanced teams, team goal scoring).
type Simulation = import("../../../src/app/bootstrap/simulation/runtime.ts").SharedSimulation;

test("DeathBall plays on a Q3 world through the runtime match layer", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "deathball",
    "--movement", "q3", "--character", "q3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  // DeathBall is its own PvP mode: no deathmatch selection is required with it.
  expect(parsed.options.mode).toBe("deathmatch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    expect(sim.recipe.match.provider).toBe("q2:deathball");
    expect(readBoolean(sim, "foreignDeathball")).toBe(true);
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 400; index++) { await app.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const ballId = (): ActorId | null => {
      const ball: unknown = readField(sim, "deathball");
      if (ball === null) return null;
      const id: unknown = readField(objectValue(ball, "ball"), "id");
      return sim.actors.observations().find(candidate => candidate.id === id)?.id ?? null;
    };
    await stepUntil(() => ballId() !== null, "ball to spawn");
    const ball = ballId();
    if (ball === null) throw new Error("Ball did not spawn");
    expect(sim.presentations().find(model => model.actor.equals(ball))?.path).toBe("models/objects/dball/tris.md2");
    expect(sim.combat.read(ball)?.health).toBe(50000);

    const records = readObject(readObject(readObject(sim, "source"), "game"), "records");
    const score = (actor: ActorId): number => {
      const entity = objectValue(callMethod(records, "nativeByActor", actor), "native entity");
      const persistant = readObject(readObject(readObject(entity, "client"), "ps"), "persistant");
      return numberValue(callMethod(persistant, "get", PersistentIndex.PERS_SCORE), "PERS_SCORE");
    };
    const teams = readObject(sim, "deathballTeams");
    const localTeam: unknown = callMethod(teams, "get", local.actor);
    expect(localTeam).toBe(1);
    const spots = readObject(sim, "deathballSpots");
    const goals = readObject(spots, "goals");
    // Local is team 1, so scoring happens in team 2's goal.
    const goal: unknown = callMethod(goals, "get", 2);
    if (typeof goal !== "object" || goal === null) throw new Error("Missing team 2 goal");
    const body = sim.bodies.read(ball);
    if (body === null) throw new Error("Ball has no body");
    const before = score(local.actor);
    sim.bodies.write(sim.actors.resolveOwned(ball) ?? (() => { throw new Error("Ball not owned"); })(),
      { ...body, origin: { x: numberValue(readField(goal, "x"), "x"), y: numberValue(readField(goal, "y"), "y"), z: numberValue(readField(goal, "z"), "z") } });
    await stepUntil(() => score(local.actor) > before, "goal to score for team 1");
    expect(score(local.actor) - before).toBe(1);
  } finally { await app.close(); }
}, 240000);
