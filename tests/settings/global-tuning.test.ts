import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { defaultMouseTuning } from "../../src/input/mouse.ts";
import { ConfigStore, parseGlobalInputTuning, type SeatSettings } from "../../src/settings/config.ts";
import { bindGamepadSettings, bindMouseMotionSettings, bindPrimaryInputSettings, type SettingBinding } from "../../src/ui/settings/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput } from "../../src/input/seat.ts";

function control(bindings: readonly SettingBinding[], id: string): SettingBinding {
  const binding = bindings.find(binding => binding.id === `ui:input:${id}`);
  if (binding === undefined) throw new Error(`Missing input setting ${id}`);
  return binding;
}
function seat(overrides: Partial<SeatSettings> = {}): SeatSettings {
  return { version: 1, bindings: [], gamepad: defaultGamepadTuning, mouse: { ...defaultMouseTuning }, history: [], rumble: true, controller: { kind: "automatic" }, ...overrides };
}

test("global input tuning round-trips through the shared settings store", async () => {
  const root = await mkdtemp(join(tmpdir(), "global-tuning-store-"));
  try {
    const store = new ConfigStore(root);
    expect(await store.loadGlobalTuning("input/global-tuning.json")).toBeNull();
    await store.saveGlobalTuning("input/global-tuning.json", { version: 1, mouse: { ...defaultMouseTuning, sensitivity: 6.5 }, alwaysRun: true, rumble: false, rumbleStrength: 0.5 });
    const loaded = await store.loadGlobalTuning("input/global-tuning.json");
    expect(loaded?.mouse.sensitivity).toBe(6.5); expect(loaded?.alwaysRun).toBe(true);
    expect(loaded?.rumble).toBe(false); expect(loaded?.rumbleStrength).toBe(0.5);
    expect(() => parseGlobalInputTuning({ version: 2, mouse: defaultMouseTuning, rumble: true })).toThrow("Unsupported global input tuning");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("global tuning wins over per-product seat values and survives product switches", async () => {
  const root = await mkdtemp(join(tmpdir(), "global-tuning-products-"));
  try {
    const shared = new ConfigStore(join(root, "settings"));
    const q1 = new ConfigStore(join(root, "q1/id1")), q2 = new ConfigStore(join(root, "q2/baseq2"));
    await q1.saveSeat("input/seat-1.json", seat({ alwaysRun: true, mouse: { ...defaultMouseTuning, sensitivity: 7 } }));
    await q2.saveSeat("input/seat-1.json", seat({ mouse: { ...defaultMouseTuning, sensitivity: 9 } }));
    const preferences = new FrontendPreferences(() => "q1-netquake", shared), bindings = preferences.bindings();
    const read = (id: string): number | boolean => { const binding = control(bindings, id); if (binding.kind !== "slider" && binding.kind !== "toggle") throw new Error("Expected value"); return binding.read(); };
    await preferences.loadBaseline(q1);
    expect(read("sensitivity")).toBe(7); expect(read("always-run")).toBe(true);
    const sensitivity = control(bindings, "sensitivity"); if (sensitivity.kind !== "slider") throw new Error("Expected slider");
    sensitivity.write(4.5);
    await preferences.saveGlobal();
    await preferences.loadBaseline(q2);
    expect(read("sensitivity")).toBe(4.5); expect(read("always-run")).toBe(true);
    const reopened = new FrontendPreferences(() => "q2-classic", shared);
    await reopened.loadBaseline(q2);
    const reopenedBindings = reopened.bindings();
    const reopenedRun = control(reopenedBindings, "always-run"); if (reopenedRun.kind !== "toggle") throw new Error("Expected toggle");
    expect(reopenedRun.read()).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("input bindings declare submenu groups", () => {
  const primary = { sensitivity: 3, pitch: 0.022, yaw: 0.022, invertMouse: false, alwaysRun: false };
  const mouse = bindPrimaryInputSettings({ read: () => primary, write: () => {} });
  expect(mouse.find(binding => binding.id === "ui:input:sensitivity")?.group).toBe("Mouse");
  expect(mouse.find(binding => binding.id === "ui:input:always-run")?.group).toBe("Movement");
  const motion = bindMouseMotionSettings({ read: () => ({ acceleration: 0, filter: false, freeLook: true, lookSpring: false, lookStrafe: false }), write: () => {} });
  expect(motion.find(binding => binding.id === "ui:input:filter")?.group).toBe("Mouse");
  expect(motion.find(binding => binding.id === "ui:input:freelook")?.group).toBe("Movement");
  const identity = createIdentityOwner("global-tuning-test"), seat = identity.seat(0);
  const context = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
  const input = new SeatInput({ seat, dialect: "q3", context, commands: new CommandBuffer({ dialect: "q3", context }), uiEvent: () => true });
  const gamepad = bindGamepadSettings(input);
  expect(gamepad.length).toBeGreaterThan(10);
  expect(gamepad.every(binding => binding.group === "Gamepad")).toBe(true);
});

test("binding writes notify one coalesced immediate persist", async () => {
  const preferences = new FrontendPreferences(() => "q1-netquake");
  let calls = 0;
  preferences.onChange = () => { calls++; };
  const bindings = preferences.bindings();
  const sensitivity = control(bindings, "sensitivity"); if (sensitivity.kind !== "slider") throw new Error("Expected slider");
  sensitivity.write(4); sensitivity.write(4.5); sensitivity.write(5);
  expect(calls).toBe(0);
  await Bun.sleep(160);
  expect(calls).toBe(1);
  sensitivity.write(5.5);
  await Bun.sleep(160);
  expect(calls).toBe(2);
});
