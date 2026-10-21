import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

// Q3 mod guests take the full custom matrix: foreign movement and character
// in singleplayer, with local-seat commands translated to the guest dialect.
test("LRCTF plays singleplayer with Quake movement and a Quake II character", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-lrctf-mixed-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q3-classic-lrctf", "--map", "q3dm1", "--movement", "q1", "--character", "q2",
      "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const application = app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    for (let frame = 0; frame < 40; frame++) await application.step(25);
    const local = application.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const ui = () => application.simulation.playerUi(local.actor);
    for (let frame = 0; frame < 400 && ui().health <= 0; frame++) await application.step(25);
    expect(ui().health).toBeGreaterThan(0);
    application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    for (let frame = 0; frame < 20; frame++) await application.step(25);
    application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    await application.step(25);
    expect(ui().health).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 180000);
