import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { archivedBindings, namedPhysicalInput, physicalInputName, registerBindingCommands, registerWheelCommands } from "../../src/input/bindings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { sharedBindingActions } from "../../src/ui/settings/action-catalog.ts";
import { bindingMatchesAction, physicalInputLabel } from "../../src/ui/settings/bindings.ts";
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
    output.length = 0; submit("bind mouse2"); expect(output).toEqual(["MOUSE2 = Unbound\n"]);
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

test("rerelease stock controller aliases share physical bindings and display names", () => {
  const owner = createIdentityOwner("rerelease-stock-bindings"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-rerelease", context });
  const input = new SeatInput({ seat, dialect: "q2-rerelease", context, commands, uiEvent: () => false });
  const unregister = registerBindingCommands(commands, () => input, text => { output.push(text); });
  const defaults = [
    ["left_trigger", "+moveup"], ["right_trigger", "+attack"], ["x_button", "cmd help"],
    ["a_button", "+moveup"], ["b_button", "+movedown"], ["left_stick", "+movedown"],
    ["right_stick", "centerview"], ["right_shoulder", "+wheel"], ["left_shoulder", "+wheel2"],
    ["DPAD_LEFT", "cl_weapprev"], ["DPAD_RIGHT", "cl_weapnext"], ["DPAD_UP", "wave 4"],
  ] satisfies readonly (readonly [string, string])[];
  try {
    for (const [alias, text] of defaults) {
      const physical = namedPhysicalInput(alias), canonical = `GAMEPAD_${alias}`;
      expect(physical).not.toBeNull();
      if (physical === null) throw new Error(`Unknown stock key ${alias}`);
      expect(namedPhysicalInput(canonical)).toEqual(physical);
      commands.append(`bind ${alias} "${text}"\nbind ${canonical}\n`, context); commands.execute();
      expect(input.binding(physical)).toEqual({ kind: "command", text });
      expect(output.pop()).toBe(`${physicalInputLabel(physical)} = ${text}\n`);
      commands.append(`unbind ${canonical}\nbind ${canonical} "${text}"\nunbind ${alias}\n`, context); commands.execute();
      expect(input.binding(physical)).toBeNull();
    }
    expect(output).toEqual([]);
  } finally { unregister(); }
});

test("stock wheel aliases use the production wheel registry for held press and release", () => {
  const owner = createIdentityOwner("rerelease-wheel-aliases"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q2-rerelease", context });
  const input = new SeatInput({ seat, dialect: "q2-rerelease", context, commands, uiEvent: () => false });
  const calls: { seat: typeof seat; mode: "weapons" | "powerups"; down: boolean }[] = [];
  const actions = sharedBindingActions("q2-rerelease", [], { chat: false, scoreCommand: null, offhandGrapple: false, offhandGrenades: false });
  const unregisterWheel = registerWheelCommands(commands, (seat, mode, down) => { calls.push({ seat, mode, down }); });
  const unregisterBindings = registerBindingCommands(commands, () => input, () => undefined);
  try {
    for (const [name, mode] of [["wheel", "weapons"], ["weaponwheel", "weapons"], ["wheel2", "powerups"], ["powerupwheel", "powerups"]] satisfies readonly (readonly [string, "weapons" | "powerups"])[]) {
      const action = actions.find(action => action.id === (mode === "weapons" ? "weapon-wheel" : "powerup-wheel"));
      if (action === undefined) throw new Error(`Missing wheel row ${mode}`);
      expect(bindingMatchesAction({ kind: "command", text: `+${name}` }, action)).toBe(true);
      expect(bindingMatchesAction({ kind: "command", text: `-${name}` }, action)).toBe(false);
      expect(bindingMatchesAction({ kind: "command", text: `+${name}; echo custom` }, action)).toBe(false);
      commands.append(`bind right_shoulder +${name}\n`, context); commands.execute();
      input.input({ kind: "controller-button", seat, device: 0, button: 10, down: true, timeMilliseconds: 1 }); commands.execute();
      input.input({ kind: "controller-button", seat, device: 0, button: 10, down: false, timeMilliseconds: 2 }); commands.execute();
      expect(calls.splice(0)).toEqual([{ seat, mode, down: true }, { seat, mode, down: false }]);
      expect(input.binding({ kind: "controller-button", device: 0, button: 10 })).toEqual({ kind: "command", text: `+${name}` });
    }
  } finally { unregisterWheel(); unregisterBindings(); }
  for (const name of ["wheel", "wheel2", "weaponwheel", "powerupwheel"]) {
    expect(commands.exists(`+${name}`)).toBe(false); expect(commands.exists(`-${name}`)).toBe(false);
  }
});
