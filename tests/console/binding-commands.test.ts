import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { archivedBindings, namedPhysicalInput, physicalInputName, registerBindingCommands } from "../../src/input/bindings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { physicalInputLabel } from "../../src/ui/settings/bindings.ts";
import { InputRouter } from "../../src/input/router.ts";

const dialects: readonly CommandDialect[] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];
for (const dialect of dialects) test(`${dialect}: console binding queries, raw mouse IDs and cfg roundtrip agree`, () => {
  const owner = createIdentityOwner(`bind-${dialect}`), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const output: string[] = [], chats: string[] = [], calls: (readonly string[])[] = [];
  const cvars = new CvarRegistry({ dialect, context });
  const commands = new CommandBuffer({ dialect, context, cvars, print: text => { output.push(text); } });
  commands.register("record", call => { calls.push(call.argv); });
  let console: SeatConsole;
  const input = new SeatInput({ seat, dialect, context, commands, uiEvent: (event, focus) => console.input(event, focus) });
  console = new SeatConsole({ seat, dialect, context, commands, cvars, now: () => 1, connected: () => true,
    clipboard: () => null, focus: focus => input.setFocus(focus, 1), chat: text => { chats.push(text); } });
  const unregister = registerBindingCommands(commands, () => input, text => { output.push(text); });
  const router = new InputRouter({ seats: [{ input, controller: { kind: "none" } }], keyboardSeat: seat,
    controllers: null, now: () => 1, ticks: () => 1, subframe: false, unhandled: () => undefined });
  const submit = (text: string): void => {
    if (input.focus.kind !== "console") console.open();
    router.handlePlatform({ kind: "text", timestamp: 1, text });
    router.handlePlatform({ kind: "key", timestamp: 1, scancode: 40, keycode: 13, modifiers: 0, down: true, repeat: false });
    router.handlePlatform({ kind: "key", timestamp: 1, scancode: 40, keycode: 13, modifiers: 0, down: false, repeat: false });
    commands.execute();
  };
  try {
    console.open();
    submit('bind mouse2 "record right; record second"');
    expect(input.binding({ kind: "mouse-button", button: 3 })).toEqual({ kind: "command", text: "record right; record second" });
    for (const prefix of ["", "/", "\\"]) {
      output.length = 0; submit(`${prefix}bind mouse2`);
      expect(output).toEqual(["MOUSE2 = record right; record second\n"]);
    }
    submit('bind w "record keyboard"'); output.length = 0; submit("bind w");
    expect(output).toEqual(["w = record keyboard\n"]);
    submit('bind mouse3 "record middle"'); submit('bind mouse4 "record x1"'); submit('bind mouse5 "record x2"');
    submit('bind mwheelup "record wheel"'); submit('bind SEMICOLON "record semicolon"');
    const archive = archivedBindings(input);
    expect(archive).toContain('bind "MOUSE2" "record right; record second"');
    input.unbindAll(); commands.append(`${archive.join("\n")}\n`, context); commands.execute();
    output.length = 0; submit("bindlist");
    expect(output).toContain("MOUSE2 = record right; record second\n");
    expect(output).toContain("MOUSE3 = record middle\n");
    console.close();
    for (const button of [3, 2, 4, 5]) {
      router.handlePlatform({ kind: "mouse-button", timestamp: 1, down: true, button, clicks: 1, x: 0, y: 0 });
      router.handlePlatform({ kind: "mouse-button", timestamp: 2, down: false, button, clicks: 1, x: 0, y: 0 });
      commands.execute();
    }
    router.handlePlatform({ kind: "mouse-wheel", timestamp: 3, x: 0, y: 1, preciseX: 0, preciseY: 1, flipped: false }); commands.execute();
    expect(calls).toEqual([["record", "right"], ["record", "second"], ["record", "middle"], ["record", "x1"], ["record", "x2"], ["record", "wheel"]]);
    submit("unbind mouse2"); expect(input.binding({ kind: "mouse-button", button: 3 })).toBeNull();
    output.length = 0; submit("bind mouse2"); expect(output).toEqual(["MOUSE2 is not bound to a command\n"]);
    input.bind({ input: { kind: "mouse-button", button: 3 }, target: { kind: "action", action: "jump" } });
    output.length = 0; submit("bind mouse2"); expect(output).toEqual(["MOUSE2 = jump\n"]);
    expect(chats).toEqual([]);
  } finally { router.close(); unregister(); }
});

test("physical mouse names preserve SDL settings IDs and Quake button order", () => {
  for (const [raw, name] of [[1, "MOUSE1"], [3, "MOUSE2"], [2, "MOUSE3"], [4, "MOUSE4"], [5, "MOUSE5"]] satisfies readonly (readonly [number, string])[]) {
    expect(physicalInputName({ kind: "mouse-button", button: raw })).toBe(name);
    expect(namedPhysicalInput(name)).toEqual({ kind: "mouse-button", button: raw });
  }
});

test("controller labels name buttons and stick directions without changing physical IDs", () => {
  for (const [command, button, label] of [
    ["GAMEPAD_A_BUTTON", 0, "A"], ["GAMEPAD_B_BUTTON", 1, "B"], ["GAMEPAD_X_BUTTON", 2, "X"], ["GAMEPAD_Y_BUTTON", 3, "Y"],
    ["GAMEPAD_LEFT_SHOULDER", 9, "Left shoulder"], ["GAMEPAD_RIGHT_SHOULDER", 10, "Right shoulder"],
    ["GAMEPAD_LEFT_STICK", 7, "Left stick press"], ["GAMEPAD_DPAD_UP", 11, "D-pad up"],
    ["GAMEPAD_PADDLE1", 16, "Paddle 1"], ["GAMEPAD_TOUCHPAD", 20, "Touchpad"],
  ] satisfies readonly (readonly [string, number, string])[]) {
    const input = { kind: "controller-button", device: 1, button } satisfies Parameters<typeof physicalInputName>[0];
    expect(namedPhysicalInput(command, 1)).toEqual(input);
    expect(physicalInputName(input)).toBe(`Pad 2 ${label}`);
    expect(physicalInputLabel(input)).toBe(`Pad 2 ${label}`);
  }
  for (const [axis, direction, label] of [
    ["left-x", "positive", "Left stick right"], ["left-x", "negative", "Left stick left"],
    ["left-y", "positive", "Left stick down"], ["left-y", "negative", "Left stick up"],
    ["right-x", "positive", "Right stick right"], ["right-y", "negative", "Right stick up"],
    ["left-trigger", "positive", "Left trigger"], ["right-trigger", "positive", "Right trigger"],
  ] satisfies readonly (readonly ["left-x" | "left-y" | "right-x" | "right-y" | "left-trigger" | "right-trigger", "positive" | "negative", string])[]) {
    expect(physicalInputLabel({ kind: "controller-axis", device: 0, axis, direction })).toBe(`Pad 1 ${label}`);
  }
});
