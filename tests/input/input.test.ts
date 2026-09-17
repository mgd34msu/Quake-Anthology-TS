import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput, registerInputCommands } from "../../src/input/seat.ts";
import { InputButton } from "../../src/input/buttons.ts";
import { applyStickCurve, GamepadInput, defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { InputRouter } from "../../src/input/router.ts";
import { SourceMidiDecoder } from "../../src/input/source-midi.ts";
import { parseBnvib, SeatHaptics } from "../../src/input/haptics.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { sourceKeyNumber } from "../../src/input/bindings.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { bindInputSettings } from "../../src/ui/settings/index.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import type { UserCommandFrame } from "../../src/input/user-command.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { Q3GameSettings } from "../../src/content/q3/base/settings.ts";
import { ClientConfiguration } from "../../src/content/q3/presentation/config.ts";
import { ClientGameState, ClientGameStaticState } from "../../src/content/q3/presentation/state.ts";
import { SeatConsole } from "../../src/console/session.ts";

test('persistent seat UI bindings release held keys and ignore retired older cleanup', () => {
  const identity = createIdentityOwner('persistent-ui'), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: 'local-seat', seat, client: identity.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: 'q2-classic', context }), calls: string[] = [];
  const input = new SeatInput({ seat, dialect: 'q2-classic', context, commands, uiEvent: () => { calls.push('menu'); return false; } });
  registerInputCommands(commands, () => input);
  input.bind({ input: { kind: 'key', code: 119 }, target: { kind: 'command', text: '+forward' } });
  input.setFocus({ kind: 'menu', menu: 'menu:startup:main', control: null }, 0);
  let now = 10;
  const old = input.bindUiEvent(() => { calls.push('old'); return false; }, () => now);
  input.setFocus({ kind: 'game' }, now);
  input.input({ kind: 'key', seat, code: 119, down: true, repeat: false, timeMilliseconds: now }); commands.execute();
  expect(input.button('forward').active).toBe(true);
  now = 20;
  const current = input.bindUiEvent(() => { calls.push('current'); return false; }, () => now);
  commands.execute();
  expect(input.button('forward').active).toBe(false);
  input.setFocus({ kind: 'console' }, now);
  input.input({ kind: 'key', seat, code: 119, down: true, repeat: false, timeMilliseconds: now });
  old();
  expect(input.focus).toEqual({ kind: 'console' });
  expect(input.isDown({ kind: 'key', code: 119 })).toBe(true);
  input.input({ kind: 'key', seat, code: 119, down: false, repeat: false, timeMilliseconds: 21 });
  expect(calls).toEqual(['old', 'current', 'current']);
  current();
  expect(input.focus).toEqual({ kind: 'menu', menu: 'menu:startup:main', control: null });
  expect(input.isDown({ kind: 'key', code: 119 })).toBe(false);
  input.input({ kind: 'key', seat, code: 119, down: true, repeat: false, timeMilliseconds: 22 });
  expect(calls.at(-1)).toBe('menu');
});

test('staged and retired routers do not release shared live seat state', () => {
  const identity = createIdentityOwner('shared-router-seat'), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: 'local-seat', seat, client: identity.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: 'q2-classic', context });
  const input = new SeatInput({ seat, dialect: 'q2-classic', context, commands, uiEvent: () => false });
  input.bind({ input: { kind: 'key', code: 119 }, target: { kind: 'action', action: 'forward' } });
  const make = (deferPlatform: boolean) => new InputRouter({ seats: [{ input, controller: { kind: 'none' } }], keyboardSeat: seat,
    controllers: null, deferPlatform, now: () => 20, ticks: () => 20, subframe: false, unhandled: () => {} });
  const active = make(false);
  let closed = false, relative = false, closes = 0;
  const lease = { get closed() { return closed; }, setRelativeMouse(value: boolean) { relative = value; }, close() { closed = true; relative = false; closes++; } };
  active.attachWindow({ beginInput: () => lease, logicalSize: { width: 640, height: 480 }, drawableSize: { width: 640, height: 480 }, pollEvents: () => [] });
  expect(relative).toBe(true);
  input.input({ kind: 'key', seat, code: 119, down: true, repeat: false, timeMilliseconds: 10 });
  const discarded = make(true); discarded.restart(); discarded.close();
  expect(input.isDown({ kind: 'key', code: 119 })).toBe(true);
  expect(input.button('forward').active).toBe(true);
  expect(relative).toBe(true); expect(closes).toBe(0);
  const next = make(true); next.restart(); active.transferWindowTo(next); active.close();
  expect(input.isDown({ kind: 'key', code: 119 })).toBe(true);
  expect(input.button('forward').active).toBe(true);
  expect(relative).toBe(true); expect(closes).toBe(0);
  input.setFocus({ kind: "console" }, 21); next.updateCapture();
  expect(relative).toBe(false);
  input.setFocus({ kind: "game" }, 22); next.updateCapture();
  expect(relative).toBe(true);
  next.close();
  expect(closes).toBe(1); expect(lease.closed).toBe(true); expect(relative).toBe(false);
  expect(input.isDown({ kind: 'key', code: 119 })).toBe(false);
  expect(input.button('forward').active).toBe(false);
});

test("binding scripts preserve quoted semicolons and held-button release commands", () => {
  const owner = createIdentityOwner("quoted-binding"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const calls: { argv: readonly string[]; source: CommandContext }[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context });
  commands.register("record", invocation => { calls.push({ argv: invocation.argv, source: invocation.source }); });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  const unregister = registerInputCommands(commands, () => input);
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: 'record "before;a";+forward;record "after;b"' } });
  input.input({ kind: "key", seat, timeMilliseconds: 10, code: 119, down: true, repeat: false }); commands.execute();
  expect(calls.map(call => call.argv)).toEqual([["record", "before;a"], ["record", "after;b"]]);
  expect(input.button("forward").active).toBe(true);
  input.input({ kind: "key", seat, timeMilliseconds: 20, code: 119, down: false, repeat: false }); commands.execute();
  expect(calls.map(call => call.argv)).toEqual([["record", "before;a"], ["record", "after;b"], ["record", "after;b"]]);
  expect(input.button("forward").active).toBe(false);
  for (const call of calls) expect(call.source).toEqual({ session: owner.session, origin: { kind: "script", name: "key-binding", caller: context.origin } });
  unregister();
});

test("binding separators match direct command-buffer dialect parsing", () => {
  const dialects: readonly CommandDialect[] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];
  for (const dialect of dialects) for (const script of ['record "a;b";record tail', 'record first\nrecord second', 'record first\rrecord second', 'record "before\nafter";record tail']) {
    const owner = createIdentityOwner(`binding-separator-${dialect}`), seat = owner.seat(0);
    const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
    const expected: (readonly string[])[] = [], actual: (readonly string[])[] = [];
    const direct = new CommandBuffer({ dialect, context }), bound = new CommandBuffer({ dialect, context });
    direct.register("record", invocation => { expected.push(invocation.argv); });
    bound.register("record", invocation => { actual.push(invocation.argv); });
    direct.append(`${script}\n`, context); direct.execute();
    const input = new SeatInput({ seat, dialect, context, commands: bound, uiEvent: () => false });
    input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: script } });
    input.input({ kind: "key", seat, timeMilliseconds: 10, code: 119, down: true, repeat: false }); bound.execute();
    expect(actual).toEqual(expected);
  }
});

test("gyro calibration rejects motion and discontinuous timestamps without learning gameplay", () => {
  const input = new GamepadInput({ ...defaultGamepadTuning, gyro: { ...defaultGamepadTuning.gyro, enabled: true } });
  const still = { x: 0.01, y: -0.02, z: 0.005 };
  input.beginGyroCalibration();
  for (let index = 0; index < 100; index++) input.gyro(still, 0);
  expect(input.gyroCalibration).toEqual({ kind: "calibrating", samples: 1, progress: 0 });
  input.gyro(still, 500);
  expect(input.gyroCalibration).toEqual({ kind: "calibrating", samples: 1, progress: 0 });
  input.gyro(still, 400);
  expect(input.gyroCalibration).toEqual({ kind: "calibrating", samples: 1, progress: 0 });
  input.gyro({ x: 1, y: 0, z: 0 }, 410);
  expect(input.gyroCalibration).toEqual({ kind: "calibrating", samples: 0, progress: 0 });
  for (let index = 0; index < 200; index++) input.gyro({ x: index % 2 === 0 ? -0.03 : 0.03, y: 0, z: 0 }, 1000 + index * 20);
  expect(input.gyroCalibration.kind).toBe("calibrating");
  expect(input.sample(100).lookDegrees).toEqual({ x: 0, y: 0 });
  for (let index = 0; index <= 100; index++) input.gyro(still, 6000 + index * 20);
  expect(input.gyroCalibration.kind).toBe("ready");
  input.clear();
  expect(input.sample(100).lookDegrees).toEqual({ x: 0, y: 0 });
  input.gyro(still, 8020);
  expect(input.sample(100).lookDegrees.x).toBeCloseTo(0, 10);
  expect(input.sample(100).lookDegrees.y).toBeCloseTo(0, 10);
  for (let index = 0; index < 200; index++) input.gyro({ x: 0.11, y: 0.18, z: 0.305 }, 8040 + index * 20);
  expect(input.sample(100).lookDegrees.x).toBeCloseTo(-0.2 * 180 / Math.PI * 0.1);
  expect(input.sample(100).lookDegrees.y).toBeCloseTo(-0.1 * 180 / Math.PI * 0.1);
  input.tuning = { ...input.tuning, invertPitch: true, gyro: { ...input.tuning.gyro, yawAxis: "z" } };
  expect(input.sample(100).lookDegrees.x).toBeCloseTo(-0.3 * 180 / Math.PI * 0.1);
  expect(input.sample(100).lookDegrees.y).toBeCloseTo(0.1 * 180 / Math.PI * 0.1);
  input.beginGyroCalibration(); input.gyro(still, 13000); input.clear();
  expect(input.gyroCalibration.kind).toBe("ready");
  input.resetGyroCalibration();
  expect(input.gyroCalibration.kind).toBe("idle");
});

test("gyro router calibrates focused menus per device and feeds every command dialect", () => {
  const owner = createIdentityOwner("gyro-router"), seat = owner.seat(0), otherSeat = owner.seat(1);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const frames: readonly UserCommandFrame[] = [
    { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1 },
    { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true },
    { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame: 10, attackAllowed: true },
    { kind: "q3", serverTimeMilliseconds: 110, weapon: 2, sensitivity: 1 },
  ];
  for (const frame of frames) {
    const commands = new CommandBuffer({ dialect: frame.kind, context });
    const input = new SeatInput({ seat, dialect: frame.kind, context, commands, uiEvent: () => false });
    const other = new SeatInput({ seat: otherSeat, dialect: frame.kind,
      context: { session: owner.session, origin: { kind: "local-seat", seat: otherSeat, client: owner.client(1, 0) } }, commands, uiEvent: () => false });
    const sensorOperations: { readonly instance: number; readonly enabled: boolean }[] = [];
    const router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }, { input: other, controller: { kind: "automatic" } }],
      keyboardSeat: seat, now: () => 10000, ticks: () => 10000, subframe: false, unhandled: () => {}, controllers: {
        setAssignments: () => {}, assignments: [7, 8], pollEvents: () => [], snapshot: () => null,
        setSensorEnabled: (instance, _sensor, enabled) => { sensorOperations.push({ instance, enabled }); return { kind: "accepted" }; },
      } });
    try {
      router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 7 });
      router.handleController({ kind: "assignment", timestamp: 0, slot: 1, previous: null, instance: 8 });
      input.setFocus({ kind: "menu", menu: "menu:settings:gyro", control: null }, 0);
      expect(router.beginGyroCalibration(seat).kind).toBe("accepted");
      expect(input.gamepad.tuning.gyro.enabled).toBe(false);
      const sample = (instance: number, time: number, y = -0.02): void => router.handleController({ kind: "sensor", timestamp: 10,
        instance, slot: instance === 7 ? 0 : 1, sensor: "gyro", x: 0.01, y, z: 0.005, timestampUs: BigInt(time * 1000) });
      for (let index = 0; index <= 100; index++) sample(8, 1000 + index * 20);
      expect(router.gyroCalibration(seat)).toEqual({ kind: "calibrating", samples: 0, progress: 0 });
      for (let index = 0; index <= 100; index++) sample(7, 1000 + index * 20);
      expect(router.gyroCalibration(seat).kind).toBe("ready");
      expect(router.gyroCalibration(otherSeat).kind).toBe("idle");
      expect(sensorOperations).toEqual([{ instance: 7, enabled: true }, { instance: 7, enabled: false }]);
      expect(input.sample(3100, 100).gamepadLookDegrees).toEqual({ x: 0, y: 0 });
      router.setGyroEnabled(seat, true); input.setFocus({ kind: "game" }, 3100);
      sample(7, 3120);
      const builder = new InputCommandBuilder(frame.kind);
      builder.build(input.sample(3200, 100), frame);
      expect(builder.viewAngles.x).toBeCloseTo(0, 5); expect(builder.viewAngles.y).toBeCloseTo(0, 5);
      sample(7, 3220, 0.18);
      builder.build(input.sample(3300, 100), frame);
      expect(builder.viewAngles.y).toBeCloseTo(0.2 * 180 / Math.PI * 0.1, 2);
      router.setGyroEnabled(seat, false);
      expect(router.beginGyroCalibration(seat).kind).toBe("accepted");
      router.handlePlatform({ kind: "window", timestamp: 0, event: 13, data1: 0, data2: 0 });
      expect(input.sample(3400, 100).gamepadLookDegrees).toEqual({ x: 0, y: 0 });
      expect(router.gyroCalibration(seat).kind).toBe("ready");
      expect(sensorOperations.at(-1)).toEqual({ instance: 7, enabled: false });
      expect(input.gamepad.tuning.gyro.enabled).toBe(false);
      router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 7, instance: 9 });
      expect(router.gyroCalibration(seat).kind).toBe("idle");
      router.handleController({ kind: "disconnected", timestamp: 0, slot: 0, instance: 9 });
      expect(router.beginGyroCalibration(seat).kind).toBe("disconnected");
    } finally { router.close(); }
  }
});

describe("seat input", () => {
  test("human console reaches real Q3 server settings and only the invoking cgame seat across wait and travel", async () => {
    const identity = createIdentityOwner("console-routing");
    const context = (index: number): CommandContext => ({ session: identity.session,
      origin: { kind: "local-seat", seat: identity.seat(index), client: identity.client(index, 0) } });
    const serverContext: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    function server() {
      const cvars = new CvarRegistry({ dialect: "q3", context: serverContext });
      const settings = new Q3GameSettings({ cvars, sendServerCommand: () => {}, remapTeams: () => {} }, "baseq3");
      settings.register("console-smoke");
      return { cvars, settings, sharedNames: settings.definitions.map(definition => definition.name) };
    }
    let authority = server(); authority.cvars.set("sv_cheats", "1", true);
    function client(index: number) {
      const cvars = new CvarRegistry({ dialect: "q3", context: context(index), cheatsAllowed: () => authority.cvars.variableValue("sv_cheats") !== 0 });
      const configuration = new ClientConfiguration("baseq3", { cvars, state: new ClientGameState("baseq3", index, 0),
        staticState: new ClientGameStaticState("baseq3"), clients: { newClientInfo: async () => {} }, configString: () => "" });
      configuration.registerCvars();
      return { cvars, configuration };
    }
    const first = client(0), second = client(1), fallback = new CvarRegistry({ dialect: "q3", context: serverContext });
    const movement = new CvarRegistry({ dialect: "q1-netquake", context: serverContext }); movement.register("m_yaw", "0.022");
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q3", server: () => authority,
      movement: () => movement, seat: seat => seat.equals(identity.seat(0)) ? first.cvars : seat.equals(identity.seat(1)) ? second.cvars : null });
    const commands = new CommandBuffer({ dialect: "q3", context: context(0), cvarRouting: routing });
    const console = new SeatConsole({ seat: identity.seat(0), dialect: "q3", context: context(0), commands, cvars: fallback,
      now: () => 0, connected: () => true, clipboard: () => null, focus: () => {}, chat: () => {} });
    console.field.setText("/set g_speed 600; set cg_fov 100; wait; set cg_fov 110"); console.submit();
    commands.append("set cg_fov 120; set local_note second; set m_yaw 0.03; set sv_cheats 0; set cg_gunX 5\n", context(1));
    commands.execute(); expect(second.cvars.variableValue("cg_fov")).toBe(90);
    commands.execute(); authority.settings.update();
    await first.configuration.updateCvars(); await second.configuration.updateCvars();
    expect(authority.settings.number("g_speed")).toBe(600);
    expect(first.configuration.readVmCvar("cg_fov").numericValue).toBe(110);
    expect(second.configuration.readVmCvar("cg_fov").numericValue).toBe(120);
    expect(second.cvars.variableString("local_note")).toBe("second");
    expect(first.cvars.find("local_note")).toBeUndefined();
    expect(fallback.snapshots()).toHaveLength(0);
    expect(movement.variableValue("m_yaw")).toBe(Math.fround(0.03));
    expect(second.cvars.variableValue("cg_gunX")).toBe(0);
    expect(commands.cvarSnapshots(context(0)).filter(variable => variable.name === "g_synchronousClients")).toHaveLength(1);
    expect(routing.owner("g_synchronousClients", context(0))).toBe(authority.cvars);
    commands.append("wait; set g_speed 700\n", context(0)); commands.execute();
    const previous = authority; authority = server(); commands.execute(); authority.settings.update();
    expect(authority.settings.number("g_speed")).toBe(700); expect(previous.cvars.variableValue("g_speed")).toBe(600);
    expect(() => routing.owner("g_speed", { session: identity.session, origin: { kind: "remote-client", client: identity.client(3, 0) } })).toThrow("explicit client owner");
    routing.close(); expect(() => commands.findCvar("cg_fov", context(0))).toThrow("closed");
  });
  test("shared command buffer retains seat origins through wait, focus loss and key release", () => {
    const owner = createIdentityOwner("input-smoke"), first = owner.seat(0), second = owner.seat(1);
    const context = (seat: typeof first): CommandContext => ({ session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(seat.index, 0) } });
    const commands = new CommandBuffer({ dialect: "q3", context: context(first) });
    const seats = [first, second].map(seat => new SeatInput({ seat, dialect: "q3", context: context(seat), commands, uiEvent: () => false }));
    const a = seats[0], b = seats[1];
    if (a === undefined || b === undefined) throw new Error("Missing input seats");
    const unregister = registerInputCommands(commands, id => seats.find(input => input.seat.equals(id)) ?? null);
    for (const input of seats) input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+forward" } });
    a.input({ kind: "key", seat: first, timeMilliseconds: 10, code: 119, down: true, repeat: false });
    commands.execute();
    expect(a.button("forward").active).toBe(true); expect(b.button("forward").active).toBe(false);
    commands.append("wait; +forward 88 20\n", context(second)); commands.execute(); commands.execute();
    expect(b.button("forward").active).toBe(true);
    a.setFocus({ kind: "console" }, 30); commands.execute();
    expect(a.button("forward").active).toBe(false); expect(b.button("forward").active).toBe(true);
    commands.append("-forward 88 40\n", context(second)); commands.execute();
    expect(b.button("forward").active).toBe(false);
    const alien = createIdentityOwner("other");
    expect(() => commands.append("echo bad", { session: alien.session, origin: { kind: "local-console" } })).toThrow("another session");
    unregister();
  });
  test("Q1 impulse fractions and radial/axial curves retain their different behavior", () => {
    const button = new InputButton(); button.down("space", 10); button.up("space", 20);
    expect(button.sample("q1", 30, 20)).toBe(0.25);
    expect(applyStickCurve({ x: 0.6, y: 0.8 }, { kind: "radial", deadzone: 0, outerThreshold: 0, exponent: 2 })).toEqual({ x: 0.6, y: 0.8 });
    expect(applyStickCurve({ x: 0.1, y: 0.8 }, { kind: "axial", deadzone: 0.2, exponent: 1 }).x).toBe(0);
    expect(sourceKeyNumber(KeyCode.MouseWheelUp, "q1")).toBe(239);
    expect(sourceKeyNumber(KeyCode.MouseWheelUp, "q2")).toBe(240);
    expect(sourceKeyNumber(KeyCode.Insert, "q1")).toBe(147);
  });
  test("MIDI running status retains the source velocity-zero release and press", () => {
    const events: [number, boolean][] = [];
    new SourceMidiDecoder().feed(new Uint8Array([0x90, 60, 127, 0xf8, 61, 0]), 1, 10, (key, down) => { events.push([key, down]); });
    expect(events).toEqual([[KeyCode.Aux1, true], [KeyCode.Aux1 + 1, false], [KeyCode.Aux1 + 1, true]]);
  });
  test("input samples produce source command speeds and jump fields", () => {
    const owner = createIdentityOwner("usercmd"), seat = owner.seat(0);
    const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
    const frames: readonly UserCommandFrame[] = [
      { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1 },
      { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true },
      { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame: 10, attackAllowed: true },
      { kind: "q3", serverTimeMilliseconds: 110, weapon: 2, sensitivity: 1 },
    ];
    for (const frame of frames) {
      const commands = new CommandBuffer({ dialect: frame.kind, context });
      const input = new SeatInput({ seat, dialect: frame.kind, context, commands, uiEvent: () => false });
      input.commandButton("forward", "w", true, 10); input.commandButton("jump", "space", true, 10); input.commandButton("attack", "mouse", true, 10);
      const command = new InputCommandBuilder(frame.kind).build(input.sample(110, 100), frame);
      expect(command.forwardMove).toBe(frame.kind === "q1-netquake" ? 100 : frame.kind === "q3" ? 127 : 400);
      if (command.kind === "q1-netquake") { expect(command.buttons).toBe(3); expect(command.upMove).toBe(0); }
      if (command.kind === "q2-rerelease") expect(command.buttons).toBe(9);
      if (command.kind === "q3") expect(command.upMove).toBe(127);
    }
  });
});

const retail = "/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak";
test.skipIf(!await Bun.file(retail).exists())("reads actual rerelease tactile assets", async () => {
  const archive = await openArchive(retail);
  try {
    const entry = archive.findEntries("tactile/weapons/hyprbf1a.bnvib")[0];
    if (entry === undefined) throw new Error("Retail tactile cue missing");
    const pattern = parseBnvib(await archive.readEntry(entry));
    expect(pattern.sampleRateHz).toBe(200); expect(pattern.samples.length).toBe(20); expect(pattern.loop).toBeNull();
  } finally { await archive.close(); }
});

test.skipIf(!await Bun.file(retail).exists())("seat tactile requests retain supported ordering and cancel across lifecycle and device changes", async () => {
  const archive = await openArchive(retail);
  try {
    const entry = archive.findEntries("tactile/weapons/hyprbf1a.bnvib")[0];
    if (entry === undefined) throw new Error("Retail tactile cue missing");
    const bytes = await archive.readEntry(entry), identity = createIdentityOwner("haptic-order");
    const requests: { readonly content: string; readonly path: string; readonly resolve: (bytes: Uint8Array | null) => void }[] = [];
    const output: { readonly device: number; readonly low: number; readonly high: number }[] = [];
    let device: number | null = 7;
    const haptics = new SeatHaptics({ seat: identity.seat(0), controller: () => device, now: () => 0,
      controllers: { rumble: (device, low, high) => { output.push({ device, low, high }); return { kind: "accepted" }; } },
      load: request => new Promise(resolve => { requests.push({ ...request, resolve }); }) });
    const resolve = (index: number, value: Uint8Array | null): void => {
      const request = requests[index]; if (request === undefined) throw new Error("No pending tactile load"); request.resolve(value);
    };
    try {
      const older = haptics.sound("q2:rerelease:baseq2:installed", "sound/weapons/hyprbf1a.wav");
      const missing = haptics.sound("q2:rerelease:baseq2:installed", "sound/misc/no-pattern.wav");
      resolve(1, null); await missing; resolve(0, bytes); await older;
      expect(haptics.scheduler.active).toBe(true);
      expect(requests[0]?.path).toBe("tactile/weapons/hyprbf1a.bnvib");
      const first = haptics.sound("q2:classic:baseq2:installed", "weapons/hyprbf1a.wav");
      const newer = haptics.sound("q2:rerelease:baseq2:installed", "weapons/new.wav");
      resolve(3, bytes); await newer;
      const count = output.length; resolve(2, bytes); await first; expect(output.length).toBe(count);
      expect(requests[2]?.content).toBe("q2:classic:baseq2:installed");
      for (const cancel of [() => haptics.setEnabled(false), () => haptics.setActive(false), () => haptics.invalidateAssets()]) {
        haptics.setEnabled(true); haptics.setActive(true);
        const pending = haptics.sound("q2:rerelease:baseq2:installed", `weapons/pending${requests.length}.wav`);
        cancel(); resolve(requests.length - 1, bytes); await pending;
        expect(haptics.scheduler.active).toBe(false);
      }
      haptics.setEnabled(true); haptics.setActive(true);
      const pending = haptics.sound("q2:rerelease:baseq2:installed", "weapons/reassign.wav");
      device = 8; haptics.update(); resolve(requests.length - 1, bytes); await pending;
      expect(haptics.scheduler.active).toBe(false);
      expect(output.some(value => value.device === 8 && (value.low > 0 || value.high > 0))).toBe(false);
      const closing = haptics.sound("q2:rerelease:baseq2:installed", "weapons/closing.wav");
      haptics.close(); resolve(requests.length - 1, bytes); await closing;
      expect(haptics.scheduler.active).toBe(false);
    } finally { haptics.close(); }
  } finally { await archive.close(); }
});

test("seat vibration strength scales both motors without restarting the authored envelope", async () => {
  const { BnvibScheduler } = await import("../../src/input/haptics.ts");
  const outputs: { low: number; high: number }[] = [];
  const scheduler = new BnvibScheduler({ setMotors(low, high) { outputs.push({ low, high }); return { kind: "accepted" }; } });
  const pattern = { sampleRateHz: 10, loop: null, samples: [
    { ampLow: 255, ampHigh: 128, freqLow: 0, freqHigh: 0 },
    { ampLow: 64, ampHigh: 255, freqLow: 0, freqHigh: 0 }] };
  scheduler.play(pattern, 0);
  expect(outputs.at(-1)).toEqual({ low: 1, high: 128 / 255 });
  scheduler.setStrength(0.5, 25);
  expect(outputs.at(-1)).toEqual({ low: 0.5, high: 128 / 255 * 0.5 });
  scheduler.update(100);
  expect(outputs.at(-1)).toEqual({ low: 64 / 255 * 0.5, high: 0.5 });
  scheduler.setStrength(0, 110);
  expect(outputs.at(-1)).toEqual({ low: 0, high: 0 });
  scheduler.setStrength(1, 120);
  expect(outputs.at(-1)).toEqual({ low: 64 / 255, high: 1 });
  scheduler.stop(); scheduler.setStrength(0.5, 130);
  expect(outputs.at(-1)).toEqual({ low: 0, high: 0 });
  expect(() => scheduler.setStrength(NaN, 140)).toThrow();
});


test("Always run menu changes emitted commands and inverts the speed modifier for every source", () => {
  const owner = createIdentityOwner("always-run"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const frames: readonly UserCommandFrame[] = [
    { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1 }, { kind: "q1-quakeworld" },
    { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true },
    { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame: 10, attackAllowed: true },
    { kind: "q3", serverTimeMilliseconds: 110, weapon: 2, sensitivity: 1 },
  ];
  for (const frame of frames) for (const alwaysRun of [false, true]) for (const modifier of [false, true]) {
    const commands = new CommandBuffer({ dialect: frame.kind, context });
    const input = new SeatInput({ seat, dialect: frame.kind, context, commands, uiEvent: () => false });
    const builder = new InputCommandBuilder(frame.kind);
    expect(builder.tuning.alwaysRun).toBe(!frame.kind.startsWith("q1"));
    const toggle = bindInputSettings(input, builder).find(binding => binding.id === "ui:input:always-run");
    if (toggle?.kind !== "toggle") throw new Error("Missing Always run toggle");
    toggle.write(alwaysRun);
    input.commandButton("forward", "w", true, 10);
    input.commandButton("walk", "shift", modifier, 10);
    input.sample(110, 100);
    const sample = input.sample(210, 100), command = builder.build(sample, frame);
    const running = alwaysRun !== modifier, maximum = frame.kind === "q3" ? running ? 127 : 64 : running ? 400 : 200;
    expect(command.forwardMove).toBe(maximum);
    if (command.kind === "q3") expect(command.buttons & 16).toBe(running ? 0 : 16);
    const analog = builder.build({ ...sample, buttons: sample.buttons.filter(button => button.action === "walk"), gamepadMove: { x: 0, y: 0.25 } }, frame);
    expect(analog.forwardMove).toBe(frame.kind === "q2-rerelease" ? maximum * 0.25 : Math.trunc(maximum * 0.25));
  }
});

test("detached world input preserves controller assignments and performs no sensor operations before publication", () => {
  const owner = createIdentityOwner("detached-router"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const operations: string[] = [];
  const controllers: ConstructorParameters<typeof InputRouter>[0]["controllers"] = {
    assignments: [7], setAssignments: () => { operations.push("assign"); }, pollEvents: () => [], snapshot: () => null,
    setSensorEnabled: () => { operations.push("sensor"); return { kind: "accepted" }; },
  };
  const make = (deferPlatform: boolean): InputRouter => {
    const commands = new CommandBuffer({ dialect: "q2-classic", context });
    const input = new SeatInput({ seat, dialect: "q2-classic", context, commands, uiEvent: () => false });
    const router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }], keyboardSeat: seat,
      controllers, deferPlatform, now: () => 1, ticks: () => 1, subframe: false, unhandled: () => {} });
    router.restart(); return router;
  };
  const previous = make(false);
  operations.length = 0;
  const discarded = make(true);
  expect(discarded.setGyroEnabled(seat, true).kind).toBe("disconnected");
  discarded.close();
  expect(operations).toEqual([]);
  const next = make(true);
  expect(next.controllerFor(seat)).toBe(7);
  previous.transferWindowTo(next);
  previous.close();
  expect(operations).toEqual([]);
  expect(next.setGyroEnabled(seat, true).kind).toBe("accepted");
  expect(operations).toEqual(["sensor"]);
  next.close();
  operations.length = 0;
  const first = make(true);
  expect(operations).toEqual([]);
  let leaseClosed = false;
  first.attachWindow({ beginInput: () => ({ get closed() { return leaseClosed; }, setRelativeMouse: () => {}, close: () => { leaseClosed = true; } }),
    logicalSize: { width: 640, height: 480 }, drawableSize: { width: 640, height: 480 }, pollEvents: () => [] });
  expect(operations).toEqual(["assign"]);
  expect(first.setGyroEnabled(seat, true).kind).toBe("accepted");
  expect(operations).toEqual(["assign", "sensor"]);
  first.close();
  expect(leaseClosed).toBe(true);
});


test("persistent input profile releases old bindings before adopting native movement sampling", async () => {
  const owner = createIdentityOwner("input-profile"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q2-classic", context });
  const input = new SeatInput({ seat, dialect: "q2-classic", context, commands, uiEvent: () => false });
  registerInputCommands(commands, () => input);
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+forward" } });
  input.input({ kind: "key", seat, code: 119, down: true, repeat: false, timeMilliseconds: 10 }); await commands.advanceProgramFrame();
  expect(() => input.setProfile("q3")).toThrow("released keys"); expect(input.dialect).toBe("q2-classic");
  input.release(20); expect(commands.programComplete).toBe(false); await commands.advanceProgramFrame();
  commands.setProfile("q3", undefined); input.setProfile("q3");
  const fresh = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  for (const current of [input, fresh]) { current.bind({ input: { kind: "key", code: 119 }, target: { kind: "action", action: "forward" } }); current.input({ kind: "key", seat, code: 119, down: true, repeat: false, timeMilliseconds: 30 }); }
  expect(input.sample(40, 10)).toEqual(fresh.sample(40, 10)); expect(input.seat).toBe(seat);
});

test("controller menu preview follows physical axes without issuing gameplay movement", () => {
  const identity = createIdentityOwner("controller-preview"), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q3", context });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => true });
  input.setFocus({ kind: "menu", menu: "menu:settings:input:0", control: null }, 0);
  input.input({ kind: "controller-axis", seat, device: 0, axis: "left-x", value: 0.8, timeMilliseconds: 10 });
  expect(input.gamepad.preview().move.raw.x).toBe(0.8);
  expect(input.gamepad.preview().move.curved.x).toBeGreaterThan(0);
  expect(input.gamepad.sample(16).move).toEqual({ x: 0, y: -0 });
  input.input({ kind: "focus", seat, focused: false, timeMilliseconds: 20 });
  expect(input.gamepad.preview().move.raw).toEqual({ x: 0, y: 0 });
});

test("controller tuning exposes both complete curves and applies preview to the saved tuning", async () => {
  const { bindGamepadSettings } = await import("../../src/ui/settings/index.ts");
  const identity = createIdentityOwner("controller-tuning"), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const input = new SeatInput({ seat, dialect: "q3", context, commands: new CommandBuffer({ dialect: "q3", context }), uiEvent: () => true });
  const controls = bindGamepadSettings(input);
  for (const stick of ["move", "look"] satisfies readonly ("move" | "look")[]) {
    const outer = controls.find(control => control.id === `ui:input:${stick}-outer`);
    const shape = controls.find(control => control.id === `ui:input:${stick}-curve-type`);
    if (outer?.kind !== "slider" || shape?.kind !== "choice") throw Error("Missing complete curve controls");
    outer.write(0.1); expect(input.gamepad.tuning[stick]).toMatchObject({ kind: "radial", outerThreshold: 0.1 });
    shape.write("axial"); expect(outer.enabled()).toBe(false);
    shape.write("radial"); expect(outer.enabled()).toBe(true);
  }
  const curve = controls.find(control => control.id === "ui:input:move-curve");
  if (curve?.kind !== "slider") throw Error("Missing movement exponent");
  curve.write(1); expect(input.gamepad.tuning.move.exponent).toBe(1);
  input.gamepad.previewAxis("left-x", 0.8);
  const preview = controls.find(control => control.id === "ui:input:move-preview-x");
  if (preview?.kind !== "slider") throw Error("Missing live preview");
  expect(preview.enabled()).toBe(false); expect(preview.read()).toBeCloseTo(applyStickCurve({ x: 0.8, y: 0 }, input.gamepad.tuning.move).x);
});

test('Main controller controls resolve the newly published seat instead of retaining its predecessor', async () => {
 const { bindGamepadSettings } = await import('../../src/ui/settings/index.ts');
 const identity = createIdentityOwner('menu-pad-replacement');
 const make = (index: number) => {
  const seat = identity.seat(index), context = { session: identity.session, origin: { kind: 'local-seat', seat, client: identity.client(0, index) } } satisfies CommandContext;
  return new SeatInput({ seat, dialect: 'q3', context, commands: new CommandBuffer({ dialect: 'q3', context }), uiEvent: () => false });
 };
 const old = make(0), next = make(1); let current = old;
 const setting = bindGamepadSettings(() => current).find(binding => binding.id === 'ui:input:move-deadzone');
 if (setting?.kind !== 'slider') throw new Error('Missing move deadzone');
 current = next; setting.write(.3);
 expect(next.gamepad.tuning.move.deadzone).toBe(.3); expect(old.gamepad.tuning.move.deadzone).toBe(defaultGamepadTuning.move.deadzone);
 expect(setting.read()).toBe(.3);
});

test('routing settings change actual keyboard owner and retain explicit disconnected controller choices', async () => {
 const { bindInputRoutingSettings } = await import('../../src/ui/settings/input-routing.ts');
 const identity = createIdentityOwner('menu-routing');
 const inputs = [0, 1].map(index => { const seat = identity.seat(index), context = { session: identity.session, origin: { kind: 'local-seat', seat, client: identity.client(0,index) } } satisfies CommandContext;
  return new SeatInput({ seat, dialect: 'q3', context, commands: new CommandBuffer({ dialect: 'q3', context }), uiEvent: () => false }); });
 const first=inputs[0], second=inputs[1]; if(first===undefined||second===undefined)throw new Error('Missing seats');
 const router=new InputRouter({ seats:inputs.map(input=>({input,controller:{kind:'none'}})), keyboardSeat:first.seat, controllers:null, deferPlatform:false, now:()=>10,ticks:()=>10,subframe:false,unhandled:()=>{} });
 const controls=bindInputRoutingSettings(()=>router,()=>[]);
 const keyboard=controls.find(c=>c.id==='ui:input:keyboard-player'); if(keyboard?.kind!=='choice')throw new Error('Missing keyboard choice');
 first.bind({input:{kind:'key',code:119},target:{kind:'action',action:'forward'}});
 first.input({kind:'key',seat:first.seat,code:119,down:true,repeat:false,timeMilliseconds:1}); expect(first.button('forward').active).toBe(true);
 keyboard.write('1'); expect(router.keyboardSeat()).toBe(second.seat); expect(first.button('forward').active).toBe(false);
 router.setControllerSelection(first.seat,{kind:'serial',guid:'fixture',serial:'retained'});
 const controller=controls.find(c=>c.id==='ui:input:controller-device'); if(controller?.kind!=='choice')throw new Error('Missing controller choice');
 expect(controller.choices().find(c=>c.id===controller.read())?.label).toBe('Saved controller (disconnected)');
 controller.write('none'); expect(router.controllerSelection(first.seat)).toEqual({kind:'none'});
 router.handleController({ kind: 'assignment', timestamp: 10, slot: 0, previous: null, instance: 7 });
 router.setSourceJoystick(7, second.seat); expect(router.controllerFor(first.seat)).toBeNull(); expect(router.controllerFor(second.seat)).toBe(7);
 router.setSourceJoystick(null); expect(router.controllerFor(first.seat)).toBe(7); expect(router.controllerFor(second.seat)).toBeNull(); router.close();
});
