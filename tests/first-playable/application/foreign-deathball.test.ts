import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
const test = corpusTest("q3a/baseq3/pak0.pk3");

// DeathBall (provider q2:deathball) is its own PvP mod and must play on
// foreign worlds: Q2 worlds keep the native composition module, everywhere
// else the shared runtime mirrors Rogue DeathBall over unified actors (ball
// synthesized with both goals from deathmatch spawns when the map has no
// authored dm_dball entities, balanced teams, team goal scoring).

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
    expect(sim.diagnostics().modes.deathball).toBe(true);
    const stepUntil = async (condition: () => boolean, label: string): Promise<void> => {
      for (let index = 0; index < 400; index++) { await app.step(50); if (condition()) return; }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const ballId = (): ActorId | null => {
      const ball = sim.diagnostics().deathball.ball();
      if (ball === null) return null;
      return sim.actors.observations().find(candidate => candidate.id === ball.id)?.id ?? null;
    };
    await stepUntil(() => ballId() !== null, "ball to spawn");
    const ball = ballId();
    if (ball === null) throw new Error("Ball did not spawn");
    expect(sim.presentations().find(model => model.actor.equals(ball))?.path).toBe("models/objects/dball/tris.md2");
    expect(sim.combat.read(ball)?.health).toBe(50000);

    const score = (actor: ActorId): number => {
      const persistant = sim.q3Source()?.records.nativeByActor(actor)?.client?.ps.persistant;
      if (persistant === undefined) throw new Error("Missing native Q3 client score");
      return persistant.get(PersistentIndex.PERS_SCORE);
    };
    expect(sim.diagnostics().deathball.team(local.actor)).toBe(1);
    // Local is team 1, so scoring happens in team 2's goal.
    const goal = sim.diagnostics().deathball.goal(2);
    if (goal === undefined) throw new Error("Missing team 2 goal");
    const body = sim.bodies.read(ball);
    if (body === null) throw new Error("Ball has no body");
    const before = score(local.actor);
    sim.bodies.write(sim.actors.resolveOwned(ball) ?? (() => { throw new Error("Ball not owned"); })(),
      { ...body, origin: { x: goal.x, y: goal.y, z: goal.z } });
    await stepUntil(() => score(local.actor) > before, "goal to score for team 1");
    expect(score(local.actor) - before).toBe(1);
  } finally { await app.close(); }
}, 240000);

// SIM-002: actors with no Q3 record (the ball, character gibs) must still think and move on a Q3 world.
test("DeathBall moves under velocity on a Q3 world", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "deathball",
    "--movement", "q3", "--character", "q3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const find = (): ActorId | null => {
      const ball = sim.diagnostics().deathball.ball();
      if (ball === null) return null;
      return sim.actors.observations().find(candidate => candidate.id === ball.id)?.id ?? null;
    };
    for (let index = 0; index < 400 && find() === null; index++) await app.step(50);
    const ball = find();
    if (ball === null) throw new Error("Ball did not spawn");
    const owned = sim.actors.resolveOwned(ball);
    const start = sim.bodies.read(ball);
    if (owned === null || start === null) throw new Error("Ball has no body");
    for (let index = 0; index < 20; index++) await app.step(50);
    const settled = sim.bodies.read(ball);
    if (settled === null) throw new Error("Ball lost its body");
    sim.bodies.write(owned, { ...settled, velocity: { x: 300, y: 0, z: 200 } });
    await app.step(100);
    const moved = sim.bodies.read(ball);
    if (moved === null) throw new Error("Ball lost its body");
    expect(Math.hypot(moved.origin.x - settled.origin.x, moved.origin.y - settled.origin.y, moved.origin.z - settled.origin.z)).toBeGreaterThan(5);
  } finally { await app.close(); }
}, 240000);

// SIM-004, SIM-005, SIM-007, SIM-019: runtime DeathBall state is not saved, is replaced on restart, and forgets departed players.
test("DeathBall refuses saves, asks for world replacement on restart and drops departed players", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3",
    "--map", "q3dm1", "--rules", "deathball",
    "--movement", "q3", "--character", "q3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const sim = app.simulation;
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let index = 0; index < 200 && sim.players().length < 2; index++) { sim.botServices.tryAddBot(); await app.step(50); }
    const bot = sim.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot");
    for (let index = 0; index < 20; index++) await app.step(50);
    expect(sim.diagnostics().deathball.team(bot) !== undefined).toBe(true);
    expect(() => sim.checkpoint()).toThrow("match state");
    expect(sim.sourceRestartPlan().kind).toBe("replace-world");
    const owned = sim.actors.resolveOwned(bot);
    if (owned === null) throw new Error("Bot actor missing");
    sim.actors.release(owned);
    expect(sim.diagnostics().deathball.team(bot) !== undefined).toBe(false);
  } finally { await app.close(); }
}, 240000);
