// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
const test = corpusTest("q1/id1/pak0.pak");

// SIM-003: the foreign DeathBall must collide with a Q1 world instead of
// falling through it.
test("DeathBall rests on the floor of a Q1 map", async () => {
  const parsed = parseApplicationCommand([
    "--content-root",
    testCorpusRoot(),
    "--game",
    "q1-classic-id1",
    "--map",
    "dm1",
    "--rules",
    "deathball",
    "--movement",
    "q1",
    "--character",
    "q1",
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
    const ballId = (): ActorId | null => {
      const ball = sim.diagnostics().deathball.ball();
      if (ball === null) return null;
      return sim.actors.observations().find(candidate => candidate.id === ball.id)?.id ?? null;
    };
    for (let index = 0; index < 40 && ballId() === null; index++) await app.step(50);
    const ball = ballId();
    if (ball === null) throw new Error("Ball did not spawn");
    const start = sim.bodies.read(ball);
    if (start === null) throw new Error("Ball has no body");
    for (let index = 0; index < 60; index++) await app.step(50);
    const end = sim.bodies.read(ball);
    if (end === null) throw new Error("Ball lost its body");
    expect(start.origin.z - end.origin.z).toBeLessThan(120);
    expect(end.origin.z).toBeGreaterThan(start.origin.z - 120);
  } finally {
    await app.close();
  }
}, 240000);
