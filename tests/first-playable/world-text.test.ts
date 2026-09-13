import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { add3, anglesToAxis, scale3 } from "../../src/core/math.ts";
import { encodePng } from "../../src/formats/images/png.ts";

for (const backend of ["cpu", "gl"]) test.skipIf(process.env["QUAKE_WORLD_TEXT_APP"] !== "1")(`native info_world_text reaches ${backend} seats and clears with the world`, async () => {
  const userRoot = await mkdtemp(join(tmpdir(), "world-text-app-"));
  try {
    const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2",
      "--map", "base1", "--renderer", backend, "--hidden", "--width", "320", "--height", "240", "--seats", "2", "--gamma", "1", "--user-content-root", userRoot]);
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
      expect(first.every(text => text.distanceCullFactor === 0.004)).toBe(true);
      const capture = app.captureNextFrame(); await app.step(25); const visible = await capture;
      await Bun.write(`/tmp/world-text-app-${backend}.png`, encodePng(320, 240, visible));
      const reload = spyOn(ApplicationAssets.prototype, "prepareImageRefresh");
      try {
        const local = app.localPlayers[0]; if (local === undefined) throw new Error("No console seat");
        const key = (code: number): void => { for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
        const command = async (value: string): Promise<Uint8Array> => {
          key(96); app.input({ seat: local.seat.id, kind: "text", text: 'gl_debug_distfrac ' + value, timeMilliseconds: performance.now() }); key(13);
          await app.step(1); key(96); await app.step(1);
          const capture = app.captureNextFrame(); await app.step(1); return capture;
        };
        const culled = await command("1"), restored = await command("0");
        expect(culled).not.toEqual(restored);
        for (const half of [0, 1]) {
          const start = half * 320 * 120 * 4, end = start + 320 * 120 * 4;
          expect(culled.slice(start, end)).not.toEqual(restored.slice(start, end));
        }
        expect(app.simulation.worldText().every(text => text.distanceCullFactor === 0.004)).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        expect(await Bun.file(join(userRoot, "settings/images.cfg")).exists()).toBe(false);
        await Bun.write('/tmp/world-text-live-' + backend + '-culled.png', encodePng(320, 240, culled));
        await Bun.write('/tmp/world-text-live-' + backend + '-visible.png', encodePng(320, 240, restored));
      } finally { reload.mockRestore(); }
      for (const entity of entities) source.game.remove(entity); await app.step(50);
      expect(app.simulation.worldText()).toHaveLength(0);
      const clean = app.captureNextFrame(); await app.step(25); const absent = await clean;
      expect(visible).not.toEqual(absent);
      app.simulation.close(); expect(app.simulation.worldText()).toHaveLength(0);
    } finally { await app.close(); }
  } finally { await rm(userRoot, { recursive: true, force: true }); }
}, 30000);
