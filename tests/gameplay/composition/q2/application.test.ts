import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../../src/app/bootstrap/options.ts";

test("retail rerelease composition runs and restores the actual shared application", async () => {
  const selection = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--movement", "q1", "--character", "q3", "--dedicated", "--mode", "coop"]);
  if (selection.kind !== "run") throw new Error("No Q2 rerelease launch");
  const application = await Application.open(selection.options, { print: () => undefined });
  const temporary = await mkdtemp(join(tmpdir(), "q2-composition-"));
  try {
    const client = application.session.createClient(0);
    client.connect("loopback");
    const admitted = application.simulation.admitPlayer(client.id);
    for (let frame = 0; frame < 8; frame++) await application.step(25);
    const source = application.simulation.q2Source();
    if (source === null || source.product.rerelease === null) throw new Error("No actual rerelease source composition");
    expect(source.product.rerelease.players.extra(admitted.actor).seat).toBe(0);
    expect(application.simulation.movementPlayer(admitted.actor)?.state.kind).toBe("q1-netquake");
    expect(source.players.states.size).toBe(1);
    const before = application.simulation.bodies.read(admitted.actor)?.origin;
    await application.saveGame(join(temporary, "retail.qsave"));
    await application.loadGame(join(temporary, "retail.qsave"));
    const restored = application.simulation.players()[0];
    if (restored === undefined) throw new Error("No restored application player");
    expect(restored.equals(admitted.actor)).toBe(false);
    expect(application.simulation.bodies.read(restored)?.origin).toEqual(before);
    await application.step(25);
    expect(application.simulation.q2Source()?.players.states.size).toBe(1);
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
