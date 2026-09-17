import { physicalInputKey } from "./binding-store.ts";
export { physicalInputKey } from "./binding-store.ts";
// Per-seat binding and CL_KeyState flow derived from Quake I/II/III cl_input.c.
// Copyright (C) id Software. GPL-2.0-or-later.
import type { CommandContext, CommandDialect } from "../contracts/common.ts";
import type { SeatId } from "../contracts/identity.ts";
import type { Vec2, Vec3 } from "../contracts/math.ts";
import type { InputAction, InputBinding, InputBindingTarget, PhysicalInput, SeatInputEvent, SeatInputFocus } from "../contracts/ui.ts";
import type { CommandBuffer, CommandInvocation } from "../core/commands/index.ts";
import { commandSeparatorOffset, sourceCommandText } from "../core/commands/text.ts";
import { InputButton } from "./buttons.ts";
import { GamepadInput } from "./gamepad.ts";
import type { GamepadTuning } from "./gamepad.ts";
import { quakeMouseButton } from "./mouse-buttons.ts";
import { KeyCode } from "./key-codes.ts";
import { parseImpulse } from "./impulse.ts";

export type SourceAction = InputAction | "turn-left" | "turn-right" | "look-up" | "look-down" | "strafe" | "mlook" | "klook" | "holster" | `button${number}`;
const actionCommands: ReadonlyMap<string, SourceAction> = new Map([
  ["attack", "attack"], ["jump", "jump"], ["forward", "forward"], ["back", "back"],
  ["moveleft", "move-left"], ["moveright", "move-right"], ["moveup", "move-up"], ["movedown", "move-down"],
  ["use", "use"], ["crouch", "crouch"], ["speed", "walk"], ["scores", "scores"], ["showscores", "scores"],
  ["left", "turn-left"], ["right", "turn-right"], ["lookup", "look-up"], ["lookdown", "look-down"], ["strafe", "strafe"], ["mlook", "mlook"],
  ["klook", "klook"], ["holster", "holster"],
  ...Array.from({ length: 15 }, (_, index): [string, SourceAction] => [`button${index}`, `button${index}`]),
]);
function commandKey(input: PhysicalInput): number {
  switch (input.kind) {
    case "key": return input.code;
    case "mouse-button": return KeyCode.Mouse1 + quakeMouseButton(input.button) - 1;
    case "controller-button": return 65536 + input.device * 64 + input.button;
    case "controller-axis": return 65536 + input.device * 64 + 32 + ["left-x", "left-y", "right-x", "right-y", "left-trigger", "right-trigger"].indexOf(input.axis) * 2 + Number(input.direction === "positive");
  }
}
export interface ButtonSample { readonly action: SourceAction; readonly fraction: number; readonly active: boolean; readonly pressed: boolean; }
export interface SeatInputSample {
  readonly seat: SeatId;
  readonly nowMilliseconds: number;
  readonly frameMilliseconds: number;
  readonly focus: SeatInputFocus;
  readonly buttons: readonly ButtonSample[];
  readonly mouse: Vec2;
  readonly gamepadMove: Vec2;
  readonly gamepadLookDegrees: Vec2;
  readonly impulse: number;
  readonly anyKeyDown: number;
}
export interface SeatInputOptions {
  readonly seat: SeatId;
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly commands: CommandBuffer;
  readonly uiEvent: (event: SeatInputEvent, focus: SeatInputFocus) => boolean;
  readonly gamepad?: GamepadTuning;
}
interface UiBinding { readonly callback: SeatInputOptions["uiEvent"]; readonly previous: UiBinding | null; focus: SeatInputFocus; active: boolean; }
interface HeldBinding { readonly input: PhysicalInput; readonly target: InputBindingTarget | null; }

export class SeatInput {
  private currentDialect: CommandDialect;
  get dialect(): CommandDialect { return this.currentDialect; }
  readonly seat: SeatId;
  readonly gamepad: GamepadInput;
  private currentFocus: SeatInputFocus = { kind: "game" };
  private windowFocused = true;
  private readonly bindingTable = new Map<string, InputBinding>();
  private readonly held = new Map<string, HeldBinding>();
  private readonly buttons = new Map<SourceAction, InputButton>();
  private mouse: Vec2 = { x: 0, y: 0 };
  private pendingImpulse = 0;
  private uiBinding: UiBinding;

  constructor(private readonly options: SeatInputOptions) {
    this.currentDialect = options.dialect;
    this.seat = options.seat;
    this.uiBinding = { callback: options.uiEvent, previous: null, focus: this.currentFocus, active: true };
    if (options.context.session !== options.seat.session || options.context.origin.kind !== "local-seat"
      || !options.context.origin.seat.equals(options.seat)) throw new Error("Input command context must belong to its local seat");
    this.gamepad = new GamepadInput(options.gamepad);
  }
  get focus(): SeatInputFocus { return this.currentFocus; }
  get focused(): boolean { return this.windowFocused; }
  get bindings(): readonly InputBinding[] { return [...this.bindingTable.values()]; }
  isDown(input: PhysicalInput): boolean { return this.held.has(physicalInputKey(input)); }
  bind(binding: InputBinding): void { this.bindingTable.set(physicalInputKey(binding.input), binding); }
  unbind(input: PhysicalInput): void { this.bindingTable.delete(physicalInputKey(input)); }
  unbindAll(): void { this.bindingTable.clear(); }
  binding(input: PhysicalInput): InputBindingTarget | null { return this.bindingTable.get(physicalInputKey(input))?.target ?? null; }
  remapControllerBindings(device: number): void {
    const bindings = [...this.bindingTable.values()];
    for (const binding of bindings) if (binding.input.kind === "controller-button" || binding.input.kind === "controller-axis") {
      this.unbind(binding.input); this.bind({ input: { ...binding.input, device }, target: binding.target });
    }
  }
  setFocus(focus: SeatInputFocus, nowMilliseconds: number): void {
    this.release(nowMilliseconds);
    this.currentFocus = focus;
  }
  bindUiEvent(callback: SeatInputOptions["uiEvent"], now: () => number): () => void {
    const previous = this.uiBinding;
    previous.focus = this.currentFocus;
    this.release(now());
    const binding: UiBinding = { callback, previous, focus: this.currentFocus, active: true };
    this.uiBinding = binding;
    return () => {
      if (!binding.active) return;
      binding.active = false;
      if (this.uiBinding !== binding) return;
      this.release(now());
      let restored = previous;
      while (!restored.active && restored.previous !== null) restored = restored.previous;
      this.uiBinding = restored;
      this.currentFocus = restored.focus;
    };
  }
  get hasHeldInput(): boolean { return this.held.size !== 0 || [...this.buttons.values()].some(button => button.active); }
  setProfile(dialect: CommandDialect): void {
    if (this.currentDialect === dialect) return;
    if (this.hasHeldInput) throw new Error("Input profile requires released keys");
    this.currentDialect = dialect;
  }
  setImpulse(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("Input impulse must fit a byte");
    this.pendingImpulse = value;
  }
  button(action: SourceAction): InputButton {
    const existing = this.buttons.get(action);
    if (existing !== undefined) return existing;
    const result = new InputButton(); this.buttons.set(action, result); return result;
  }
  commandButton(action: SourceAction, key: string, down: boolean, timeMilliseconds: number): void {
    const button = this.button(action);
    if (down) button.down(key, timeMilliseconds); else button.up(key, timeMilliseconds);
  }
  private runBinding(binding: HeldBinding, down: boolean, now: number, commands: Pick<CommandBuffer, "append"> = this.options.commands): void {
    const target = binding.target;
    if (target === null) return;
    if (target.kind === "action") {
      this.commandButton(target.action, physicalInputKey(binding.input), down, now); return;
    }
    const key = commandKey(binding.input);
    const source: CommandContext = { session: this.options.context.session, origin: { kind: "script", name: "key-binding", caller: this.options.context.origin } };
    let hadButton = false;
    let remaining = sourceCommandText(target.text);
    while (remaining.length > 0) {
      const offset = commandSeparatorOffset(remaining, this.currentDialect);
      const segment = remaining.slice(0, offset).trim();
      remaining = remaining.slice(offset + 1);
      if (segment.length === 0) continue;
      if (segment.startsWith("+")) {
        commands.append(`${down ? "+" : "-"}${segment.slice(1)} ${key} ${Math.trunc(now)}\n`, source);
        hadButton = true;
      } else if (down || hadButton) commands.append(`${segment}\n`, source);
    }
  }
  private digital(input: PhysicalInput, down: boolean, time: number, consumed = false): void {
    const key = physicalInputKey(input), previous = this.held.get(key);
    if (down) {
      if (previous !== undefined) return;
      const held = { input, target: !consumed && this.currentFocus.kind === "game" && this.windowFocused ? this.binding(input) : null };
      this.held.set(key, held); this.runBinding(held, true, time);
    } else if (previous !== undefined) {
      this.runBinding(previous, false, time); this.held.delete(key);
    }
  }
  input(event: SeatInputEvent): boolean {
    if (!event.seat.equals(this.seat)) throw new Error("Input event delivered to the wrong seat");
    if (!Number.isFinite(event.timeMilliseconds) || event.timeMilliseconds < 0) throw new RangeError("Invalid input event timestamp");
    const time = event.timeMilliseconds;
    if (event.kind === "focus") {
      this.windowFocused = event.focused;
      if (!event.focused) this.release(time);
      return this.uiBinding.callback(event, this.currentFocus);
    }
    if (!this.windowFocused) return false;
    const consumed = this.uiBinding.callback(event, this.currentFocus);
    switch (event.kind) {
      case "key": this.digital({ kind: "key", code: event.code }, event.down, time, consumed); break;
      case "mouse-button": this.digital({ kind: "mouse-button", button: event.button }, event.down, time, consumed); break;
      case "controller-button": this.digital({ kind: "controller-button", device: event.device, button: event.button }, event.down, time, consumed); break;
      case "controller-axis": {
        this.gamepad.previewAxis(event.axis, event.value);
        if (!consumed && this.currentFocus.kind === "game") this.gamepad.axis(event.axis, event.value);
        for (const direction of ["negative", "positive"] satisfies readonly ("negative" | "positive")[]) {
          const value = direction === "positive" ? event.value : -event.value;
          this.digital({ kind: "controller-axis", device: event.device, axis: event.axis, direction }, value > this.gamepad.tuning.triggerThreshold, time, consumed);
        }
        break;
      }
      case "mouse-motion":
        if (!consumed && this.currentFocus.kind === "game") this.mouse = { x: this.mouse.x + event.delta.x, y: this.mouse.y + event.delta.y };
        break;
      case "mouse-wheel": {
        const code = event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown;
        for (let count = 0; count < Math.abs(event.delta.y); count++) {
          this.digital({ kind: "key", code }, true, time, consumed); this.digital({ kind: "key", code }, false, time);
        }
        break;
      }
      case "text": break;
    }
    return consumed || this.currentFocus.kind === "game";
  }
  gyro(sample: Vec3, timeMilliseconds: number): void {
    if (this.windowFocused) this.gamepad.gyro(sample, timeMilliseconds, this.currentFocus.kind === "game");
  }
  releaseDevice(device: number, time: number): void {
    for (const [key, held] of this.held) if ((held.input.kind === "controller-axis" || held.input.kind === "controller-button") && held.input.device === device) {
      this.runBinding(held, false, time); this.held.delete(key);
    }
    this.gamepad.clear(); this.gamepad.resetGyroCalibration();
  }
  release(time: number, commands: Pick<CommandBuffer, "append"> = this.options.commands): void {
    for (const held of this.held.values()) this.runBinding(held, false, time, commands);
    this.held.clear();
    for (const button of this.buttons.values()) button.release(time);
    this.gamepad.clear(); this.mouse = { x: 0, y: 0 }; this.pendingImpulse = 0;
  }
  sample(nowMilliseconds: number, frameMilliseconds: number): SeatInputSample {
    if (!Number.isFinite(nowMilliseconds) || !Number.isFinite(frameMilliseconds) || frameMilliseconds <= 0) throw new RangeError("Input sample requires a positive frame duration");
    const timing = this.currentDialect.startsWith("q1") ? "q1" : this.currentDialect === "q3" ? "q3" : "q2";
    const buttons = [...this.buttons].map(([action, button]) => {
      const pressed = button.pressed, active = button.active;
      return { action, pressed, active, fraction: button.sample(timing, nowMilliseconds, frameMilliseconds) };
    });
    const gamepad = this.gamepad.sample(frameMilliseconds), mouse = this.mouse, impulse = this.pendingImpulse;
    this.mouse = { x: 0, y: 0 }; this.pendingImpulse = 0;
    return { seat: this.seat, nowMilliseconds, frameMilliseconds, focus: this.currentFocus, buttons, mouse,
      gamepadMove: gamepad.move, gamepadLookDegrees: gamepad.lookDegrees, impulse, anyKeyDown: this.held.size };
  }
}

export function registerInputCommands(commands: CommandBuffer, lookup: (seat: SeatId) => SeatInput | null,
  clientScores?: (command: CommandInvocation) => boolean): () => void {
  const names: string[] = [];
  for (const [name, action] of actionCommands) for (const down of [true, false]) {
    const commandName = `${down ? "+" : "-"}${name}`;
    if (commands.register(commandName, invocation => {
      if (name === "scores" && clientScores?.(invocation)) return;
      let origin = invocation.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      if (origin.kind !== "local-seat") return;
      const seat = lookup(origin.seat);
      if (seat === null) return;
      const time = Number(invocation.argv[2] ?? 0), key = invocation.argv[1] ?? "console";
      if (!Number.isFinite(time)) throw new RangeError("Invalid button command timestamp");
      if (!down && invocation.argv[1] === undefined) seat.button(action).release(time);
      else seat.commandButton(action, key, down, time);
    })) names.push(commandName);
  }
  if (commands.register("impulse", invocation => {
    let origin = invocation.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    if (origin.kind === "local-seat") lookup(origin.seat)?.setImpulse(parseImpulse(invocation.argv[1] ?? "", invocation.dialect));
  })) names.push("impulse");
  return () => { for (const name of names) commands.unregister(name); };
}
