import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { createStartupSelection } from "../../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

// Stock baseq3 qagame has no qualified primary weapon/combat interface, so a
// foreign arsenal runs it as a black box: the guest's own weapons stay
// silent while the selected (Quake) weapon is active. No combination is
// refused.
test("stock Q3 guest plays with the Quake arsenal as a black box", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-q3-blackbox-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--mode", "deathmatch",
      "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const selection = await createStartupSelection(parsed.options);
    selection.select("weapons", "q1-classic-id1");
    const launch = await selection.resolve();
    const application = app = await Application.open(launch.options, { saveDirectory: join(root, "saves"), print: () => undefined }, launch.recipe);
    for (let frame = 0; frame < 40; frame++) await application.step(25);
    const local = application.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const ui = () => application.simulation.playerUi(local.actor);
    for (let frame = 0; frame < 400 && ui().activeWeapon === null; frame++) await application.step(25);
    expect(ui().activeWeapon?.startsWith("q1:")).toBe(true);
    expect(ui().items.some(item => item.kind === "weapon" && item.id.startsWith("q1:") && item.owned)).toBe(true);
    const shells = () => ui().ammo?.count ?? -1;
    const before = shells();
    application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    for (let frame = 0; frame < 60; frame++) await application.step(25);
    application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    await application.step(25);
    if (ui().activeWeapon !== "q1:weapon/axe") expect(shells()).toBeLessThan(before);
    expect(ui().health).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 180000);
