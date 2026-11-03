// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { createStartupSelection } from "../../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { holdFire } from "../../support/matrix-play.ts";

// The custom-game matrix has no refusal path: an undeclared QC mod world
// (qdoom) with QuakeWorld movement, a Quake III character, and the Quake II
// arsenal must launch and fire. The QC weapon stage is derived from the
// program's own weapons.qc/client.qc skeleton.
test("qdoom world plays with QuakeWorld movement, Q3 character and Q2 arsenal", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-qdoom-arsenal-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand([
      "--game",
      "q1-classic-qdoom",
      "--map",
      "start",
      "--movement",
      "qw",
      "--character",
      "q3",
      "--model",
      "doom",
      "--mode",
      "singleplayer",
      "--renderer",
      "cpu",
      "--hidden",
      "--width",
      "320",
      "--height",
      "240",
      "--user-content-root",
      root,
    ]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const selection = await createStartupSelection(parsed.options);
    selection.select("weapons", "q2-classic-baseq2");
    const launch = await selection.resolve();
    const application = (app = await Application.open(launch.options, { saveDirectory: join(root, "saves"), print: () => undefined }, launch.recipe));
    for (let frame = 0; frame < 12; frame++) await application.step(25);
    const local = application.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const key = (code: number): void => {
      for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() });
    };
    key(96);
    application.input({ seat: local.seat.id, kind: "text", text: "give all", timeMilliseconds: performance.now() });
    key(13);
    await application.step(25);
    await application.step(25);
    key(96);
    const ui = () => application.simulation.playerUi(local.actor);
    expect(ui().items.some(item => item.kind === "weapon" && item.id.startsWith("q2:") && item.owned)).toBe(true);
    for (let frame = 0; frame < 200 && !ui().activeWeapon?.startsWith("q2:"); frame++) await application.step(25);
    expect(ui().activeWeapon?.startsWith("q2:")).toBe(true);
    const ammo = (): number => ui().ammo?.count ?? -1;
    expect(ammo()).toBeGreaterThan(0);
    const fired = await holdFire(application, local.seat.id, ammo, () => ui().activeWeapon, 40);
    expect(fired.ammoAfter).toBeLessThan(fired.ammoBefore);
    expect(ui().health).toBeGreaterThan(0);
  } finally {
    try {
      await app?.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 180000);
