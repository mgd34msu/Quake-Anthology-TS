import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { defaultMouseTuning } from "../../src/input/mouse.ts";
import { defaultBindings } from "../../src/input/bindings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import type { SeatSettings } from "../../src/settings/config.ts";
import { ConsoleField, completeCommand } from "../../src/console/field.ts";
import { FrameCapture } from "../../src/capture/index.ts";
import { decodePng } from "../../src/formats/images/png.ts";
import { SoftwareRenderer } from "../../src/render/cpu/rasterizer.ts";

test("seat controls and archived cvars survive actual config files", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-settings-"));
  try {
    const store = new ConfigStore(root), owner = createIdentityOwner("config");
    const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(1), client: owner.client(1, 0) } };
    const cvars = new CvarRegistry({ dialect: "q3", context }), commands = new CommandBuffer({ dialect: "q3", context, cvars });
    cvars.register("sensitivity", "3", CvarFlag.Archive); cvars.set("sensitivity", "4.5");
    const settings: SeatSettings = { version: 1, bindings: defaultBindings(17), gamepad: defaultGamepadTuning,
      mouse: defaultMouseTuning, history: ["map q3dm1"], rumble: true, controller: { kind: "automatic" } };
    await store.saveSeat("seat-2.json", settings); expect(await store.loadSeat("seat-2.json")).toEqual(settings);
    await store.saveCvars("config.cfg", cvars); cvars.set("sensitivity", "1");
    await store.execute("config.cfg", commands, context); commands.execute();
    expect(cvars.variableString("sensitivity")).toBe("4.5");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("Unicode editing and completion keep remaining arguments", () => {
  const field = new ConsoleField(); field.insert("hé🙂");
  field.key(127, false, false, () => null); expect(field.text).toBe("hé");
  expect(completeCommand("vid_r", ["vid_restart", "vid_ref"]).text).toBe("vid_re");
  expect(completeCommand("/map q3dm1", ["map"]).text).toBe("/map q3dm1");
});
test("capture writes PNG bytes from the actual CPU renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-capture-"));
  try {
    const owner = createIdentityOwner("capture");
    const renderer = new SoftwareRenderer(2, 1, { identity: Symbol("renderer"), session: owner.session, generation: 0 });
    renderer.beginView({ viewport: { x: 0, y: 0, width: 1, height: 1 }, clipPlane: null, clear: { depth: 1, color: { x: 1, y: 0, z: 0, w: 1 }, stencil: false } });
    renderer.beginView({ viewport: { x: 1, y: 0, width: 1, height: 1 }, clipPlane: null, clear: { depth: 1, color: { x: 0, y: 1, z: 0, w: 1 }, stencil: false } });
    const frame = renderer.readRgba(), capture = new FrameCapture(root, renderer);
    const first = await capture.screenshot(), second = await capture.screenshot();
    expect(first.path.endsWith("shot0000.png")).toBe(true); expect(second.path.endsWith("shot0001.png")).toBe(true);
    const decoded = decodePng(new Uint8Array(await Bun.file(first.path).arrayBuffer()));
    expect(decoded.pixels).toEqual(frame.pixels);
    const levelshot = await capture.levelshot("maps/q3dm1.bsp"); expect(levelshot.width).toBe(128); expect(levelshot.height).toBe(128);
    renderer.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("common vibration strength uses the existing frontend preference binding", async () => {
  const { FrontendPreferences } = await import("../../src/app/bootstrap/frontend-preferences.ts");
  const preferences = new FrontendPreferences(() => "q1-netquake");
  const strength = preferences.bindings().find(binding => binding.id === "ui:input:controller-vibration-strength");
  if (strength === undefined || strength.kind !== "slider") throw new Error("Missing common strength slider");
  expect(strength.read()).toBe(1);
  strength.write(0.35);
  expect(preferences.values.controllerVibrationStrength).toBe(0.35);
  const restored = preferences.bindings().find(binding => binding.id === strength.id);
  if (restored === undefined || restored.kind !== "slider") throw new Error("Missing restored strength slider");
  expect(restored.read()).toBe(0.35);
});

test("gyro tuning profiles persist by seat and serial without calibration bias", async () => {
  const { parseGyroProfile } = await import("../../src/settings/config.ts");
  const root = await mkdtemp(join(tmpdir(), "quake-gyro-"));
  try {
    const store = new ConfigStore(root);
    const profile = { version: 1, identity: { kind: "device", guid: "a".repeat(32), serial: "pad-A" }, tuning: { ...defaultGamepadTuning.gyro, enabled: true, yawSensitivity: 2.5 } } satisfies import("../../src/settings/config.ts").GyroProfile;
    await store.saveGyro("controllers/seat-1/pad-A.json", profile);
    expect(await store.loadGyro("controllers/seat-1/pad-A.json")).toEqual(profile);
    expect(await store.loadGyro("controllers/seat-2/pad-A.json")).toBeNull();
    expect(await store.loadGyro("controllers/seat-1/pad-B.json")).toBeNull();
    expect(JSON.stringify(await store.loadGyro("controllers/seat-1/pad-A.json"))).not.toContain("bias");
    expect(() => parseGyroProfile({ ...profile, identity: { ...profile.identity, serial: "" } })).toThrow("identity");
    expect(() => parseGyroProfile({ ...profile, tuning: { ...profile.tuning, yawSensitivity: Infinity } })).toThrow("finite");
  } finally { await rm(root, { recursive: true, force: true }); }
});
