import type { SeatId } from "../contracts/identity.ts";
import type { CommandDialect } from "../contracts/common.ts";
import type { InputBinding, PhysicalInput } from "../contracts/ui.ts";
import type { CommandBuffer, CommandInvocation } from "../core/commands/index.ts";
import { keynumToString, stringToKeynum } from "./keys.ts";
import { KeyCode } from "./key-codes.ts";
import type { SeatInput } from "./seat.ts";

export function namedPhysicalInput(name: string, device = 0): PhysicalInput | null {
  const lower = name.toLowerCase();
  const mouse = /^mouse([1-9][0-9]*)$/.exec(lower);
  if (mouse !== null) return { kind: "mouse-button", button: Number(mouse[1]) };
  const controllerButtons: ReadonlyMap<string, number> = new Map([
    ["gamepad_a_button", 0], ["gamepad_b_button", 1], ["gamepad_x_button", 2], ["gamepad_y_button", 3],
    ["gamepad_back", 4], ["gamepad_guide", 5], ["gamepad_start", 6], ["gamepad_left_stick", 7], ["gamepad_right_stick", 8],
    ["gamepad_left_shoulder", 9], ["gamepad_right_shoulder", 10], ["gamepad_dpad_up", 11], ["gamepad_dpad_down", 12],
    ["gamepad_dpad_left", 13], ["gamepad_dpad_right", 14], ["gamepad_misc", 15], ["gamepad_paddle1", 16],
    ["gamepad_paddle2", 17], ["gamepad_paddle3", 18], ["gamepad_paddle4", 19], ["gamepad_touchpad", 20],
  ]);
  const button = controllerButtons.get(lower);
  if (button !== undefined) return { kind: "controller-button", device, button };
  if (lower === "gamepad_left_trigger" || lower === "gamepad_right_trigger") return { kind: "controller-axis", device,
    axis: lower === "gamepad_left_trigger" ? "left-trigger" : "right-trigger", direction: "positive" };
  const code = stringToKeynum(name);
  return code < 0 ? null : { kind: "key", code };
}
export function defaultBindings(device = 0, dialect: CommandDialect = "q3"): readonly InputBinding[] {
  const bindings: InputBinding[] = [];
  const defaults: readonly (readonly [string, string])[] = [
    ["w", "+forward"], ["s", "+back"], ["a", "+moveleft"], ["d", "+moveright"], ["SPACE", dialect.startsWith("q1") ? "+jump" : "+moveup"],
    ["CTRL", "+movedown"], ["SHIFT", "+speed"], ["MOUSE1", "+attack"], ["TAB", "+scores"],
    ["MWHEELUP", "weapnext"], ["MWHEELDOWN", "weapprev"], ["GAMEPAD_RIGHT_TRIGGER", "+attack"],
    ["GAMEPAD_A_BUTTON", dialect.startsWith("q1") ? "+jump" : "+moveup"], ["GAMEPAD_B_BUTTON", "+movedown"], ["GAMEPAD_X_BUTTON", "+use"],
    ["GAMEPAD_LEFT_SHOULDER", "weapprev"], ["GAMEPAD_RIGHT_SHOULDER", "weapnext"], ["GAMEPAD_BACK", "+scores"],
  ];
  for (const [name, text] of defaults) {
    const input = namedPhysicalInput(name, device);
    if (input !== null) bindings.push({ input, target: { kind: "command", text } });
  }
  return bindings;
}
function quoted(value: string): string {
  if (/["\r\n\0]/.test(value)) throw new Error("Source cfg cannot represent a binding containing quotes or newlines; use the seat settings document");
  return `"${value}"`;
}
export function archivedBindings(input: SeatInput): readonly string[] {
  const commands: string[] = ["unbindall"];
  for (const binding of input.bindings) {
    if (binding.target.kind !== "command") continue;
    const name = binding.input.kind === "key" ? keynumToString(binding.input.code)
      : binding.input.kind === "mouse-button" ? `MOUSE${binding.input.button}` : null;
    if (name !== null) commands.push(`bind ${quoted(name)} ${quoted(binding.target.text)}`);
  }
  return commands;
}
export function registerBindingCommands(commands: CommandBuffer, lookup: (seat: SeatId) => SeatInput | null,
  print: (text: string) => void): () => void {
  const registered: string[] = [];
  const local = (invocation: CommandInvocation): SeatInput | null => {
    let origin = invocation.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    return origin.kind === "local-seat" ? lookup(origin.seat) : null;
  };
  const add = (name: string, handler: (invocation: CommandInvocation) => undefined): void => { if (commands.register(name, handler)) registered.push(name); };
  add("bind", invocation => {
    const seat = local(invocation), name = invocation.argv[1];
    if (seat === null || name === undefined) { print("bind <key> [command]\n"); return; }
    const pad = seat.bindings.find(binding => binding.input.kind === "controller-button" || binding.input.kind === "controller-axis");
    const device = pad?.input.kind === "controller-button" || pad?.input.kind === "controller-axis" ? pad.input.device : 0;
    const input = namedPhysicalInput(name, device);
    if (input === null) { print(`Unknown key ${name}\n`); return; }
    if (invocation.argv.length === 2) {
      const binding = seat.binding(input); print(binding?.kind === "command" ? `${name} = ${binding.text}\n` : `${name} is not bound to a command\n`); return;
    }
    seat.bind({ input, target: { kind: "command", text: invocation.argv.slice(2).join(" ") } });
  });
  add("unbind", invocation => {
    const name = invocation.argv[1], seat = local(invocation);
    if (name === undefined || seat === null) return;
    const input = namedPhysicalInput(name);
    if (input === null) return;
    if (input.kind === "controller-button" || input.kind === "controller-axis") {
      for (const binding of seat.bindings) {
        const candidate = binding.input;
        if (input.kind === "controller-button" && candidate.kind === "controller-button" && input.button === candidate.button
          || input.kind === "controller-axis" && candidate.kind === "controller-axis" && input.axis === candidate.axis && input.direction === candidate.direction) seat.unbind(candidate);
      }
    } else seat.unbind(input);
  });
  add("unbindall", invocation => { local(invocation)?.unbindAll(); });
  add("bindlist", invocation => { const seat = local(invocation); if (seat !== null) for (const binding of seat.bindings) print(`${JSON.stringify(binding)}\n`); });
  return () => { for (const name of registered) commands.unregister(name); };
}

/** VM-facing source key values stay separate from the shared physical namespace. */
export function sourceKeyNumber(key: number, family: "q1" | "q2" | "q3"): number | null {
  if (family === "q3") return key >= 0 && key <= 255 ? key : null;
  if (key < 128) return key;
  if (key >= KeyCode.Up && key <= KeyCode.Shift) return key - 4;
  if (key >= KeyCode.Insert && key <= KeyCode.End) return key + 8;
  if (key >= KeyCode.F1 && key <= KeyCode.F12) return key - 10;
  if (key === KeyCode.Pause) return 255;
  if (key >= KeyCode.Mouse1 && key <= KeyCode.Mouse3) return key - KeyCode.Mouse1 + 200;
  if (key >= KeyCode.Joy1 && key <= KeyCode.Joy4) return key - KeyCode.Joy1 + 203;
  if (key >= KeyCode.Aux1 && key <= KeyCode.Aux16) return key - KeyCode.Aux1 + 207;
  if (key >= 256 && key <= 271) return key - 256 + 223;
  if (key === KeyCode.MouseWheelUp) return family === "q2" ? 240 : 239;
  if (key === KeyCode.MouseWheelDown) return family === "q2" ? 239 : 240;
  if (family === "q2" && key >= KeyCode.KeypadHome && key <= KeyCode.KeypadPlus) return key;
  return null;
}
