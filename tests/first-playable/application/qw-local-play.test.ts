import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { holdFire } from "../../support/matrix-play.ts";

// QuakeWorld programs play in a local graphical session like every other
// source -- no dedicated-server topology is required to play them.
test("QuakeWorld plays locally without dedicated operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-qw-local-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q1-quakeworld", "--map", "dm3", "--mode", "deathmatch",
      "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const application = app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    for (let frame = 0; frame < 40; frame++) await application.step(25);
    const local = application.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const ui = () => application.simulation.playerUi(local.actor);
    for (let frame = 0; frame < 400 && ui().health <= 0; frame++) await application.step(25);
    expect(ui().health).toBeGreaterThan(0);
    const shells = (): number => application.simulation.inventory.count(local.actor, "q1:ammo/shells");
    const fired = await holdFire(application, local.seat.id, shells, () => ui().activeWeapon, 60);
    expect(fired.ammoBefore).toBeGreaterThan(0);
    expect(fired.ammoAfter).toBeLessThan(fired.ammoBefore);
    expect(ui().health).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 180000);
