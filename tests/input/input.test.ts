import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput, registerInputCommands } from "../../src/input/seat.ts";
import { InputButton } from "../../src/input/buttons.ts";
import { applyStickCurve } from "../../src/input/gamepad.ts";
import { SourceMidiDecoder } from "../../src/input/source-midi.ts";
import { parseBnvib } from "../../src/input/haptics.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { sourceKeyNumber } from "../../src/input/bindings.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import type { UserCommandFrame } from "../../src/input/user-command.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { Q3GameSettings } from "../../src/content/q3/base/settings.ts";
import { ClientConfiguration } from "../../src/content/q3/presentation/config.ts";
import { ClientGameState, ClientGameStaticState } from "../../src/content/q3/presentation/state.ts";
import { SeatConsole } from "../../src/console/session.ts";

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
