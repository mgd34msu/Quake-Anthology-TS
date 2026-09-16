import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { defaultBindings } from "../../src/input/bindings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import type { SeatSettings } from "../../src/settings/config.ts";
import { StartupInputProfile } from "../../src/app/bootstrap/startup-input-profile.ts";
import { baseWeaponBindingItems } from "../../src/input/weapon-bindings.ts";

function input(): SeatInput {
  const identity = createIdentityOwner("startup-profile-test"), seat = identity.seat(0);
  const context = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
  return new SeatInput({ seat, dialect: "q3", context, commands: new CommandBuffer({ dialect: "q3", context }), uiEvent: () => true });
}

test("retained frontend profile keeps the actual configured input instead of reloading disk defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "retained-startup-bindings-"));
  try {
    const settings = new ConfigStore(root), seat = input();
    seat.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "echo authored" } });
    const bindings = seat.bindings, tuning = seat.gamepad.tuning;
    const profile = StartupInputProfile.retained(settings, seat);
    expect(profile.input).toBe(seat);
    expect(seat.bindings).toEqual(bindings);
    expect(seat.gamepad.tuning).toBe(tuning);
    await profile.save();
    expect(await settings.loadSeat("input/seat-1.json")).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup binding edits persist into the existing profile and reopen after gameplay changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-bindings-"));
  try {
    const settings = new ConfigStore(root), seat = input(), profile = await StartupInputProfile.open(settings, seat, "q3");
    expect(seat.bindings).toEqual(defaultBindings());
    await profile.save();
    expect(await settings.loadSeat("input/seat-1.json")).toBeNull();
    seat.bind({ input: { kind: "key", code: 102 }, target: { kind: "command", text: "+forward" } });
    await profile.save();
    const saved = await settings.loadSeat("input/seat-1.json");
    if (saved === null) throw new Error("No saved bindings");
    expect(saved.bindings).toEqual(seat.bindings);
    await settings.saveSeat("input/seat-1.json", { ...saved, history: ["map q3dm1"], rumble: false,
      mouse: { ...saved.mouse, sensitivity: 8 }, bindings: [{ input: { kind: "key", code: 103 }, target: { kind: "command", text: "+attack" } }] });
    await profile.save();
    const reopened = await StartupInputProfile.open(settings, input(), "q3");
    expect(reopened.input.bindings).toEqual([{ input: { kind: "key", code: 103 }, target: { kind: "command", text: "+attack" } }]);
    reopened.input.unbindAll(); await reopened.save();
    expect(await settings.loadSeat("input/seat-1.json")).toMatchObject({ bindings: [], history: ["map q3dm1"], rumble: false, mouse: { sensitivity: 8 } });
    const empty = await StartupInputProfile.open(settings, input(), "q3");
    expect(empty.input.bindings).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup profiles keep product edits separate and normalize controller slots", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-products-"));
  try {
    const q1 = new ConfigStore(join(root, "q1")), q2 = new ConfigStore(join(root, "q2")), seat = input();
    const first = await StartupInputProfile.open(q1, seat, "q1-netquake");
    seat.bind({ input: { kind: "controller-button", device: 9, button: 2 }, target: { kind: "command", text: "+jump" } });
    await first.save();
    const second = await StartupInputProfile.open(q2, seat, "q2-classic");
    expect(second.input.bindings).toEqual(defaultBindings(0, "q2-classic"));
    await second.save();
    expect(await q2.loadSeat("input/seat-1.json")).toBeNull();
    const restored = await StartupInputProfile.open(q1, seat, "q1-netquake");
    expect(restored.input.binding({ kind: "controller-button", device: 0, button: 2 })).toEqual({ kind: "command", text: "+jump" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup fresh weapon bindings follow selected arsenal instead of movement", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-arsenal-"));
  try {
    const settings = new ConfigStore(root), seat = input();
    const profile = await StartupInputProfile.open(settings, seat, "q1-netquake", baseWeaponBindingItems("q2"));
    expect(seat.binding({ kind: "key", code: 49 })).toEqual({ kind: "command", text: "use q2:weapon_blaster" });
    expect(seat.binding({ kind: "key", code: 32 })).toEqual({ kind: "command", text: "+jump" });
    seat.unbindAll(); await profile.save();
    const reopened = await StartupInputProfile.open(settings, input(), "q1-netquake", baseWeaponBindingItems("q3"));
    expect(reopened.input.bindings).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("all startup input controls survive saving without a gameplay world", async () => {
  const { FrontendPreferences } = await import("../../src/app/bootstrap/frontend-preferences.ts");
  const root = await mkdtemp(join(tmpdir(), "startup-controls-"));
  try {
    const settings = new ConfigStore(root), profile = await StartupInputProfile.open(settings, input(), "q3");
    const preferences = new FrontendPreferences(() => "q3");
    await preferences.loadBaseline(settings);
    for (const minimum of [false, true]) {
      const expected = new Map<string, boolean | number>();
      for (const binding of preferences.bindings()) {
        if (binding.category !== "input") continue;
        if (binding.kind === "toggle") { binding.write(minimum ? false : !binding.read()); expected.set(binding.id, binding.read()); }
        else if (binding.kind === "slider") {
          binding.write(minimum ? binding.minimum : binding.minimum + (binding.maximum - binding.minimum) * 0.7);
          expected.set(binding.id, binding.read());
        } else throw new Error(`Unhandled startup control ${binding.id}`);
      }
      expect(expected.size).toBe(10);
      await profile.save(preferences.values);
      const fresh = new FrontendPreferences(() => "q3"); await fresh.loadBaseline(settings);
      for (const binding of fresh.bindings()) {
        const value = expected.get(binding.id); if (value === undefined) continue;
        if (binding.kind === "toggle" && typeof value === "boolean") expect(binding.read()).toBe(value);
        else if (binding.kind === "slider" && typeof value === "number") expect(binding.read()).toBeCloseTo(value, 5);
        else throw new Error(`Changed startup control ${binding.id}`);
      }
      expect(fresh.values).toEqual({});
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup control saves preserve fresh disk bindings and unrelated seat fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-merge-"));
  try {
    const settings = new ConfigStore(root), seat = input(), profile = await StartupInputProfile.open(settings, seat, "q3");
    await profile.save({ effectsVolume: 0.2, musicVolume: 0.1 });
    expect(await settings.loadSeat("input/seat-1.json")).toBeNull();
    await profile.save({ filter: true });
    const saved = await settings.loadSeat("input/seat-1.json"); if (saved === null) throw new Error("Missing startup controls");
    const latest = { ...saved, bindings: [], history: ["echo preserve"], controller: { kind: "none" },
      mouse: { ...saved.mouse, side: 3, forward: 4 }, gamepad: { ...saved.gamepad, invertPitch: true } } satisfies SeatSettings;
    await settings.saveSeat("input/seat-1.json", latest);
    await profile.save({ filter: false, alwaysRun: false, controllerVibration: false, controllerVibrationStrength: 0 });
    expect(await settings.loadSeat("input/seat-1.json")).toEqual({ ...latest, mouse: { ...latest.mouse, filter: false },
      alwaysRun: false, rumble: false, rumbleStrength: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("frontend-only console history saves through the existing seat profile and preserves gameplay fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-history-"));
  try {
    const settings = new ConfigStore(root), seat = input(), profile = StartupInputProfile.retained(settings, seat);
    await profile.save({}, ["find gamma", "help map"]);
    const initial = await settings.loadSeat("input/seat-1.json");
    if (initial === null) throw new Error("Frontend history was not saved");
    expect(initial.history).toEqual(["find gamma", "help map"]);
    const played = { ...initial, bindings: [{ input: { kind: "key", code: 103 }, target: { kind: "command", text: "+attack" } }],
      mouse: { ...initial.mouse, sensitivity: 8 }, rumble: false } satisfies SeatSettings;
    await settings.saveSeat("input/seat-1.json", played);
    await profile.save({}, ["find gamma", "help map", "echo back in menu"]);
    expect(await settings.loadSeat("input/seat-1.json")).toEqual({ ...played, history: ["find gamma", "help map", "echo back in menu"] });
    const reopened = await StartupInputProfile.open(settings, input(), "q3");
    await reopened.save();
    expect((await settings.loadSeat("input/seat-1.json"))?.history).toEqual(["find gamma", "help map", "echo back in menu"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
