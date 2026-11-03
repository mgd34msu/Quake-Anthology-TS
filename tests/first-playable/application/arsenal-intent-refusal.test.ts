// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { ArsenalIntent } from "../../../src/contracts/gameplay.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
const test = corpusTest("q1/id1/pak0.pak");

// SIM-001: a peer chooses the provider and weapon strings of an arsenal intent;
// none of them may end the host.
test("remote arsenal intents with unknown, foreign or unowned weapons are refused without a throw", async () => {
  const parsed = parseApplicationCommand([
    "--content-root",
    testCorpusRoot(),
    "--game",
    "q1-classic-id1",
    "--map",
    "e1m1",
    "--movement",
    "q1",
    "--character",
    "q1",
    "--dedicated",
  ]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const client = app.session.createClient(0);
    client.connect("loopback");
    const player = app.simulation.admitPlayer(client.id);
    const provider = app.simulation.recipe.weapons[0]?.provider;
    if (provider === undefined) throw new Error("Missing weapon provider");
    const intents: readonly ArsenalIntent[] = [
      { provider: "x:y", weapon: "x:y", useHoldable: false },
      { provider, weapon: "q9:nope", useHoldable: false },
      { provider, weapon: "q1:weapon/lightning", useHoldable: false },
      { provider, weapon: "q1:weapon/rocketlauncher", useHoldable: true, impulse: 255 },
    ];
    let sequence = 1;
    for (const arsenal of intents) {
      await app.session.step({
        elapsedMilliseconds: 100,
        commands: [
          {
            actor: player.actor,
            source: { kind: "remote-client", client: client.id },
            sequence: sequence++,
            arsenal,
            command: {
              kind: "q1-netquake",
              acknowledgedServerTimeSeconds: 0,
              viewAngles: { x: 0, y: 0, z: 0 },
              forwardMove: 0,
              sideMove: 0,
              upMove: 0,
              buttons: 0,
              impulse: 0,
            },
          },
        ],
      });
    }
    expect(app.simulation.players()).toHaveLength(1);
  } finally {
    await app.close();
  }
}, 240000);
