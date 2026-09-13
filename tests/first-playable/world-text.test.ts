import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { add3, anglesToAxis, scale3 } from "../../src/core/math.ts";
import { encodePng } from "../../src/formats/images/png.ts";

for (const backend of ["cpu", "gl"]) test.skipIf(process.env["QUAKE_WORLD_TEXT_APP"] !== "1")(`native info_world_text reaches ${backend} seats and clears with the world`, async () => {
  const command = parseApplicationCommand(["--content-root", resolve(import.meta.dir, "../../../qfiles"), "--game", "q2-rerelease-baseq2",
    "--map", "base1", "--renderer", backend, "--hidden", "--width", "320", "--height", "240", "--seats", "2", "--gamma", "1"]);
  if (command.kind !== "run") throw new Error("Expected source application");
  const app = await Application.open(command.options, { print: () => undefined });
  try {
    await app.step(25);
    const source = app.simulation.q2Source();
    if (source === null) throw new Error("Missing native Q2 source");
    const players = [...source.game.entities.values()].filter(entity => source.game.host.isPlayer(entity.actor.id));
    expect(players).toHaveLength(2);
    const entities = players.map(player => {
      const view = app.simulation.playerView(player.actor.id), origin = add3(add3(view.origin, { x: 0, y: 0, z: view.viewHeight }), scale3(anglesToAxis(view.angles)[0], 64));
      return source.game.spawn({ classname: "info_world_text", ordinal: -1, values: new Map([
        ["classname", "info_world_text"], ["message", "WORLD TEXT\nSHARED"], ["origin", `${origin.x} ${origin.y} ${origin.z}`],
        ["angle", "-3"], ["radius", "0.5"], ["spawnflags", "0"]]) });
    });
    await app.step(25);
    const first = app.simulation.worldText(), second = app.simulation.worldText();
    expect(first).toBe(second); expect(first.length).toBeGreaterThan(0);
    expect(first.some(text => text.text === "WORLD TEXT\nSHARED")).toBe(true);
    const capture = app.captureNextFrame(); await app.step(25); const visible = await capture;
    await Bun.write(`/tmp/world-text-app-${backend}.png`, encodePng(320, 240, visible));
    for (const entity of entities) source.game.remove(entity); await app.step(50);
    expect(app.simulation.worldText()).toHaveLength(0);
    const clean = app.captureNextFrame(); await app.step(25); const absent = await clean;
    expect(visible).not.toEqual(absent);
    app.simulation.close(); expect(app.simulation.worldText()).toHaveLength(0);
  } finally { await app.close(); }
}, 30000);
