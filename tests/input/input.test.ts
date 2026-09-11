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

describe("seat input", () => {
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
