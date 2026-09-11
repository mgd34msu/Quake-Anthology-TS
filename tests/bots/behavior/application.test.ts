import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const retail = test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")));

async function open(mode: "singleplayer" | "deathmatch"): Promise<Application> {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
    "--movement", "q3", "--character", "q3", "--mode", mode, "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected dedicated arena launch");
  return Application.open(launch.options, { print: () => undefined });
}

retail("production bots move and fire in the shared session and retain multiplayer clients through travel", async () => {
  const application = await open("deathmatch");
  try {
    expect(application.simulation.players()).toHaveLength(0);
    application.queueCommand("addbot", ["ranger", "3"], null);
    application.queueCommand("addbot", ["sarge", "3"], null);
    await application.step(50);
    const initial = application.simulation.players().map(actor => ({ actor, origin: application.simulation.playerView(actor).origin }));
    expect(initial).toHaveLength(2);
    let attackFrames = 0;
    for (let frame = 0; frame < 160; frame++) {
      await application.step(50);
      for (const actor of application.simulation.players()) {
        const player = application.simulation.movementPlayer(actor);
        if (player !== null && (player.buttons & 1) !== 0) attackFrames++;
      }
    }
    expect(initial.some(({ actor, origin }) => {
      const current = application.simulation.playerView(actor).origin;
      return Math.hypot(current.x - origin.x, current.y - origin.y, current.z - origin.z) > 8;
    })).toBe(true);
    expect(attackFrames).toBeGreaterThan(0);
    expect(application.simulation.players().some(actor => application.simulation.movementPlayer(actor)?.arsenal.ammo
      .some(ammo => ammo.item === "q3:ammo/machinegun" && ammo.count > 0 && ammo.count < 100))).toBe(true);
    const clients = application.botClients.map(bot => bot.client.id);
    application.queueCommand("map_restart", ["0"], null);
    await application.step(50); await application.step(50);
    expect(clients.every(id => application.botClients.some(bot => bot.client.id.equals(id)))).toBe(true);
    await application.changeLevel("q3dm2"); await application.step(50);
    expect(clients.every(id => application.botClients.some(bot => bot.client.id.equals(id)))).toBe(true);
    application.queueCommand("kick", ["allbots"], null);
    await application.step(50); await application.step(50);
    expect(application.botClients).toHaveLength(0);
    expect(application.simulation.players()).toHaveLength(0);
  } finally { await application.close(); }
}, 120000);

retail("singleplayer restart retains bot clients while a new arena replaces its authored roster", async () => {
  const application = await open("singleplayer");
  try {
    for (let frame = 0; frame < 43; frame++) await application.step(50);
    const original = application.botClients[0];
    if (original === undefined) throw new Error("Arena did not create its authored Ranger");
    expect(application.botClients).toHaveLength(1);
    application.queueCommand("map_restart", ["0"], null);
    await application.step(50); await application.step(50);
    expect(application.botClients[0]?.client.id.equals(original.client.id)).toBe(true);
    await application.changeLevel("q3dm2");
    for (let frame = 0; frame < 43; frame++) await application.step(50);
    expect(original.client.isClosed).toBe(true);
    expect(application.botClients.some(bot => bot.client.id.equals(original.client.id))).toBe(false);
    expect(application.botClients).toHaveLength(1);
    const source = application.simulation.q3Source();
    if (source === null) throw new Error("Arena lost source game");
    expect(application.botClients.map(bot => source.pool.clientAt(bot.client.id.slot).pers.netname)).toEqual(["Ranger"]);
  } finally { await application.close(); }
}, 120000);
