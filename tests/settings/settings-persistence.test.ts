// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadSeatProfile, saveSharedTuning } from "../../src/app/bootstrap/seat-profile.ts";
import { isInstallRoot } from "../../src/content/roots.ts";
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { defaultMouseTuning } from "../../src/input/mouse.ts";
import { ConfigStore, type SeatSettings } from "../../src/settings/config.ts";

const seat: SeatSettings = {
  version: 1,
  bindings: [],
  gamepad: defaultGamepadTuning,
  mouse: { ...defaultMouseTuning, sensitivity: 3 },
  history: [],
  rumble: true,
  controller: { kind: "automatic" },
};

test("the tuning shared by every game applies to a direct launch's first seat only", async () => {
  const root = await mkdtemp(join(tmpdir(), "seat-profile-"));
  try {
    const product = new ConfigStore(join(root, "settings", "product"));
    await product.saveSeat("input/seat-1.json", seat);
    await product.saveSeat("input/seat-2.json", seat);
    expect((await loadSeatProfile(product, root, 0))?.mouse.sensitivity).toBe(3);
    await saveSharedTuning(root, { ...seat, mouse: { ...seat.mouse, sensitivity: 9 }, rumble: false, alwaysRun: true });
    const first = await loadSeatProfile(product, root, 0);
    expect(first?.mouse.sensitivity).toBe(9);
    expect(first?.rumble).toBe(false);
    expect(first?.alwaysRun).toBe(true);
    expect((await loadSeatProfile(product, root, 1))?.mouse.sensitivity).toBe(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a game install is refused as the writable user-content root", async () => {
  const root = await mkdtemp(join(tmpdir(), "install-root-"));
  try {
    await mkdir(join(root, "baseq2"));
    const user = join(root, "user");
    await mkdir(join(user, "q2", "baseq2"), { recursive: true });
    expect(isInstallRoot(root, user)).toBe(true);
    expect(isInstallRoot(user, root)).toBe(false);
    expect(isInstallRoot(root, "/nonexistent")).toBe(true);
    expect(() => parseApplicationCommand(["--content-root", user, "--user-content-root", user])).toThrow("game install");
    expect(() => parseApplicationCommand(["--content-root", user, "--user-content-root", root])).toThrow("game install");
    expect(() => parseApplicationCommand(["--content-root", root, "--user-content-root", user])).not.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
