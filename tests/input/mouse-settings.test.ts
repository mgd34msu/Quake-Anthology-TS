import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { MouseInput, defaultMouseTuning } from "../../src/input/mouse.ts";
import { MouseSettings } from "../../src/input/mouse-settings.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import type { UserCommandFrame } from "../../src/input/user-command.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { bindInputSettings } from "../../src/ui/settings/index.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { registerDiscoveryCommands } from "../../src/console/discovery.ts";

function fixture(dialect: CommandDialect) {
  const identity = createIdentityOwner(`mouse-${dialect}`);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
  const otherContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(1), client: identity.client(1, 0) } };
  const cvars = new CvarRegistry({ dialect, context }), otherCvars = new CvarRegistry({ dialect, context: otherContext });
  const mouse = new MouseInput(new MouseSettings(cvars)), otherMouse = new MouseInput(new MouseSettings(otherCvars));
  const output: string[] = [];
  const commands = new CommandBuffer({ dialect, context, cvars, print: text => output.push(text),
    cvarRouting: new ApplicationConsoleRouting({ fallback: new CvarRegistry({ dialect, context: { session: identity.session, origin: { kind: "local-console" } } }),
      sourceDialect: () => dialect, server: () => null, seat: id => id.equals(identity.seat(0)) ? cvars : otherCvars }) });
  const input = new SeatInput({ seat: identity.seat(0), dialect, context, commands, uiEvent: () => false });
  const builder = new InputCommandBuilder(dialect, mouse);
  registerDiscoveryCommands(commands, text => output.push(text));
  return { context, otherContext, cvars, otherCvars, mouse, otherMouse, output, commands, input, builder };
}

const frames: readonly UserCommandFrame[] = [
  { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1 }, { kind: "q1-quakeworld" },
  { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true },
  { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame: 10, attackAllowed: true },
  { kind: "q3", serverTimeMilliseconds: 100, weapon: 1, sensitivity: 1 },
];

for (const frame of frames) test(`${frame.kind} mouse console and menus change the same seat and next command`, () => {
  const f = fixture(frame.kind);
  expect(f.cvars.find("sensitivity")?.resetValue).toBe("3");
  expect(f.cvars.find("m_side")?.resetValue).toBe("0.8");
  expect(f.cvars.find("m_forward")?.resetValue).toBe("1");
  f.commands.append("sensitivity 30\nm_yaw 0.5\nm_pitch -0.25\ncl_mouseAccel 0\n", f.context); f.commands.execute();
  const bindings = bindInputSettings(f.input, f.builder);
  const sensitivity = bindings.find(binding => binding.id === "ui:input:sensitivity");
  const invert = bindings.find(binding => binding.id === "ui:input:invert-mouse");
  if (sensitivity?.kind !== "slider" || invert?.kind !== "toggle") throw new Error("Missing mouse menu controls");
  expect(sensitivity.read()).toBe(30); expect(invert.read()).toBe(true);
  const sample = { ...f.input.sample(100, 100), mouse: { x: 1, y: 1 } };
  f.builder.build(sample, frame);
  expect(f.builder.viewAngles.x).toBeCloseTo(-7.5);
  expect(f.builder.viewAngles.y).toBeCloseTo(-15);
  sensitivity.write(4.5); invert.write(false);
  expect(f.cvars.variableString("sensitivity")).toBe("4.5"); expect(f.cvars.variableValue("m_pitch")).toBe(0.25);
  f.commands.append("sensitivity 9\n", { session: f.context.session, origin: { kind: "script", name: "seat.cfg", caller: f.otherContext.origin } }); f.commands.execute();
  expect(f.otherMouse.tuning.sensitivity).toBe(9); expect(f.mouse.tuning.sensitivity).toBe(4.5);
  f.commands.append("find mouse\nhelp sensitivity\n", f.context); f.commands.execute();
  expect(f.output.join("")).toContain("Mouse sensitivity");
  expect(f.output.join("")).toContain("4.5");
  expect(f.output.join("")).toContain("3");
  f.cvars.resetConsole("sensitivity");
  expect(sensitivity.read()).toBe(3);
});

test("seat JSON restores the same mouse owner and reopened menu", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-mouse-settings-"));
  try {
    const f = fixture("q3"), store = new ConfigStore(root);
    f.mouse.tuning = { ...defaultMouseTuning, sensitivity: 7.5, pitch: -0.125, invertPitch: true, acceleration: 0.5, freeLook: false, filter: true };
    const saved = f.mouse.tuning;
    await store.saveSeat("input/seat-1.json", { version: 1, bindings: [], gamepad: defaultGamepadTuning, mouse: saved,
      history: [], rumble: true, controller: { kind: "automatic" } });
    const reopened = fixture("q3"), profile = await store.loadSeat("input/seat-1.json");
    if (profile === null) throw new Error("Missing saved mouse profile");
    reopened.mouse.tuning = profile.mouse;
    expect(reopened.mouse.tuning).toEqual(saved);
    const sensitivity = bindInputSettings(reopened.input, reopened.builder).find(binding => binding.id === "ui:input:sensitivity");
    if (sensitivity?.kind !== "slider") throw new Error("Missing reopened sensitivity");
    expect(sensitivity.read()).toBe(7.5);
    expect(reopened.cvars.variableValue("m_pitch")).toBe(0.125);
    expect(reopened.otherMouse.tuning.sensitivity).toBe(3);
    expect(await store.loadSeat("input/seat-2.json")).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mouse console acceleration, smoothing and movement scales reach the sampler", () => {
  const f = fixture("q3");
  f.commands.append("sensitivity 2\ncl_mouseAccel 1\nm_yaw 1\nm_pitch 1\nm_filter 1\nfreelook 1\n", f.context); f.commands.execute();
  expect(f.mouse.sample({ x: 6, y: 8 }, 5, false, false)).toEqual({ yaw: -9, pitch: 12, side: 0, forward: 0 });
  f.commands.append("m_filter 0\ncl_mouseAccel 0\nfreelook 0\nm_forward 2\nm_side 3\n", f.context); f.commands.execute();
  expect(f.mouse.sample({ x: 2, y: 4 }, 5, false, false)).toEqual({ yaw: -4, pitch: 0, side: 0, forward: -16 });
  expect(f.mouse.sample({ x: 2, y: 4 }, 5, true, false)).toEqual({ yaw: 0, pitch: 0, side: 12, forward: -16 });
  f.cvars.set("m_filter", "0.5"); expect(f.mouse.tuning.filter).toBe(false);
  const q1 = fixture("q1-netquake"); q1.cvars.set("m_filter", "0.5"); expect(q1.mouse.tuning.filter).toBe(true);
});

test("zero axis coefficients preserve inversion through menu changes and profiles", () => {
  for (const frame of frames) {
    const f = fixture(frame.kind);
    f.mouse.tuning = { ...f.mouse.tuning, yaw: -0, pitch: 0, invertPitch: true };
    expect(f.cvars.variableString("m_pitch")).toBe("-0");
    expect(f.cvars.variableString("m_yaw")).toBe("-0");
    expect(f.mouse.tuning.invertPitch).toBe(true);
    expect(Object.is(f.mouse.tuning.yaw, -0)).toBe(true);
    f.mouse.tuning = { ...f.mouse.tuning, sensitivity: 5 };
    expect(f.mouse.tuning.invertPitch).toBe(true);
    f.mouse.tuning = { ...f.mouse.tuning, pitch: 0.022 };
    expect(f.cvars.variableValue("m_pitch")).toBeLessThan(0);
  }
});

test("separate input routing preserves late source cvars and rejects wrong seats or server collisions", () => {
  const f = fixture("q3");
  const fallback = new CvarRegistry({ dialect: "q3", context: f.context });
  let attached: CvarRegistry | null = null;
  const server = new CvarRegistry({ dialect: "q3", context: { session: f.context.session, origin: { kind: "server-console" } } });
  const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q3", server: () => ({ cvars: server, sharedNames: [] }),
    seat: () => attached, input: id => id === null || f.cvars.context.origin.kind === "local-seat" && id.equals(f.cvars.context.origin.seat) ? f.cvars : f.otherCvars });
  expect(routing.owner("sensitivity", f.context)).toBe(f.cvars);
  attached = new CvarRegistry({ dialect: "q3", context: f.context }); attached.register("cg_fov", "110");
  expect(routing.owner("cg_fov", f.context)).toBe(attached);
  expect(routing.visible(f.context)).toContain(attached); expect(routing.visible(f.context)).toContain(f.cvars);
  server.register("sensitivity", "20");
  expect(() => routing.owner("sensitivity", f.context)).toThrow("conflicting server and input");
  const wrong = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q3", server: () => null, seat: () => null, input: () => f.otherCvars });
  expect(() => wrong.owner("sensitivity", f.context)).toThrow("another seat");
});
