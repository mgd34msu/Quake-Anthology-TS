import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { corpusTest, testCorpusRoot } from "../../support/corpus.ts";

// DOCS3-007: retail M_CheckDodge passes a BoxEdicts filter that calls the
// monster's dodge function, which links entities. The host must allow that
// instead of throwing "Q2 BoxEdicts filter cannot modify world links".
const dodgers = ["models/monsters/soldier/tris.md2", "models/monsters/soldierh/tris.md2", "models/monsters/infantry/tris.md2", "models/monsters/gunner/tris.md2"];

corpusTest("q2/baseq2/pak0.pak", "q2/rerelease/baseq2/game_x64.dll")("native rerelease soldiers and infantry fight a firing player without a BoxEdicts link fault", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-rerelease-dodge-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q2-rerelease-baseq2", "--map", "base2", "--q2-game", "game_x64.dll",
      "--movement", "q2", "--character", "q2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    if (app.simulation.q2Native() === null) throw new Error("Native source was not admitted");
    for (let i = 0; i < 20; i++) await app.step(50);
    const targets = app.simulation.presentations().filter(p => dodgers.includes(p.path));
    expect(targets.length).toBeGreaterThan(0);
    let fought = 0;
    for (const monster of targets.slice(0, 3)) {
      const radians = monster.angles.y * Math.PI / 180;
      app.simulation.diagnostics().movePlayer(local.actor, { kind: "teleport", angles: { x: 0, y: (monster.angles.y + 180) % 360, z: 0 },
        origin: { x: monster.origin.x + 120 * Math.cos(radians), y: monster.origin.y + 120 * Math.sin(radians), z: monster.origin.z + 10 },
        velocity: { x: 0, y: 0, z: 0 }, commandAngles: { x: 0, y: 0, z: 0 }, holdMilliseconds: 0, spectator: false });
      app.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
      try { for (let i = 0; i < 60; i++) await app.step(50); }
      finally { app.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() }); }
      fought++;
      if (app.simulation.playerUi(local.actor).health <= 0) break;
    }
    expect(fought).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 600_000);
