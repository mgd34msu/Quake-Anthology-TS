import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { CommandContext } from "../contracts/common.ts";
import type { InputAction, InputBinding, InputBindingTarget, PhysicalInput, ControllerAxis } from "../contracts/ui.ts";
import type { CommandBuffer } from "../core/commands/index.ts";
import type { CvarRegistry } from "../core/cvars/index.ts";
import type { GamepadTuning, StickCurve } from "../input/gamepad.ts";
import { validateGamepadTuning } from "../input/gamepad.ts";
import type { MouseTuning } from "../input/mouse.ts";
import type { ControllerSelection } from "../platform/controller.ts";

export interface SeatSettings {
  readonly version: 1;
  readonly bindings: readonly InputBinding[];
  readonly gamepad: GamepadTuning;
  readonly mouse: MouseTuning;
  readonly alwaysRun?: boolean;
  readonly history: readonly string[];
  readonly rumble: boolean;
  readonly rumbleStrength?: number;
  readonly controller: ControllerSelection;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> { if (!object(value)) throw new Error("Expected a settings object"); return value; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite settings number"); return value; }
function rumbleStrength(value: unknown): number { const result = value === undefined ? 1 : number(value); if (result < 0 || result > 1) throw new Error("Vibration strength must be between zero and one"); return result; }
function natural(value: unknown): number { const result = number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error("Expected a nonnegative settings integer"); return result; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Expected a settings boolean"); return value; }
function string(value: unknown): string { if (typeof value !== "string") throw new Error("Expected settings text"); return value; }
function strings(value: unknown): string[] { if (!Array.isArray(value)) throw new Error("Expected a settings list"); return value.map((item: unknown) => string(item)); }
function curve(value: unknown): StickCurve {
  const input = record(value), deadzone = number(input["deadzone"]), exponent = number(input["exponent"]);
  if (input["kind"] === "radial") return { kind: "radial", deadzone, exponent, outerThreshold: number(input["outerThreshold"]) };
  if (input["kind"] === "axial") return { kind: "axial", deadzone, exponent };
  throw new Error("Unknown stick curve");
}
function gamepad(value: unknown): GamepadTuning {
  const input = record(value), gyro = record(input["gyro"]), yawAxis = gyro["yawAxis"];
  if (yawAxis !== "y" && yawAxis !== "z") throw new Error("Unknown gyro yaw axis");
  return validateGamepadTuning({ move: curve(input["move"]), look: curve(input["look"]), swapSticks: boolean(input["swapSticks"]),
    yawDegreesPerSecond: number(input["yawDegreesPerSecond"]), pitchDegreesPerSecond: number(input["pitchDegreesPerSecond"]),
    invertPitch: boolean(input["invertPitch"]), forwardSensitivity: number(input["forwardSensitivity"]), sideSensitivity: number(input["sideSensitivity"]),
    triggerThreshold: number(input["triggerThreshold"]), gyro: { enabled: boolean(gyro["enabled"]), yawAxis,
      yawSensitivity: number(gyro["yawSensitivity"]), pitchSensitivity: number(gyro["pitchSensitivity"]) } });
}
function mouse(value: unknown): MouseTuning {
  const input = record(value);
  return { sensitivity: number(input["sensitivity"]), acceleration: number(input["acceleration"]), filter: boolean(input["filter"]),
    yaw: number(input["yaw"]), pitch: number(input["pitch"]), side: number(input["side"]), forward: number(input["forward"]),
    freeLook: boolean(input["freeLook"]), invertPitch: boolean(input["invertPitch"]) };
}
function axis(value: unknown): ControllerAxis {
  switch (value) {
    case "left-x": case "left-y": case "right-x": case "right-y": case "left-trigger": case "right-trigger": return value;
    default: throw new Error("Unknown controller axis");
  }
}
function physical(value: unknown): PhysicalInput {
  const input = record(value);
  switch (input["kind"]) {
    case "key": return { kind: "key", code: natural(input["code"]) };
    case "mouse-button": return { kind: "mouse-button", button: natural(input["button"]) };
    case "controller-button": return { kind: "controller-button", device: natural(input["device"]), button: natural(input["button"]) };
    case "controller-axis": {
      const direction = input["direction"];
      if (direction !== "positive" && direction !== "negative") throw new Error("Unknown axis direction");
      return { kind: "controller-axis", device: natural(input["device"]), axis: axis(input["axis"]), direction };
    }
    default: throw new Error("Unknown binding input");
  }
}
function action(value: unknown): InputAction {
  switch (value) {
    case "attack": case "jump": case "forward": case "back": case "move-left": case "move-right": case "move-up": case "move-down":
    case "use": case "crouch": case "walk": case "scores": case "next-weapon": case "previous-weapon": case "menu": return value;
    default: throw new Error("Unknown input action");
  }
}
function target(value: unknown): InputBindingTarget {
  const input = record(value);
  if (input["kind"] === "action") return { kind: "action", action: action(input["action"]) };
  if (input["kind"] === "command") return { kind: "command", text: string(input["text"]) };
  throw new Error("Unknown binding target");
}
function controller(value: unknown): ControllerSelection {
  const input = record(value);
  if (input["kind"] === "automatic" || input["kind"] === "none") return { kind: input["kind"] };
  const guid = string(input["guid"]);
  if (!/^[0-9a-f]{32}$/i.test(guid)) throw new Error("Controller GUID requires 32 hexadecimal digits");
  if (input["kind"] === "device") return { kind: "device", guid, ordinal: natural(input["ordinal"]) };
  if (input["kind"] === "serial") return { kind: "serial", guid, serial: string(input["serial"]) };
  throw new Error("Unknown controller selection");
}
export function parseSeatSettings(value: unknown): SeatSettings {
  const input = record(value), bindings = input["bindings"];
  if (input["version"] !== 1 || !Array.isArray(bindings)) throw new Error("Unsupported seat settings document");
  return { version: 1, bindings: bindings.map((item: unknown) => { const binding = record(item); return { input: physical(binding["input"]), target: target(binding["target"]) }; }),
    ...(input["alwaysRun"] === undefined ? {} : { alwaysRun: boolean(input["alwaysRun"]) }),
    gamepad: gamepad(input["gamepad"]), mouse: mouse(input["mouse"]), history: strings(input["history"]), rumble: boolean(input["rumble"]), rumbleStrength: rumbleStrength(input["rumbleStrength"]), controller: controller(input["controller"]) };
}
export function settingsPath(root: string, name: string): string {
  const path = resolve(root, name), child = relative(resolve(root), path);
  if (child === "" || child === ".." || child.startsWith("../") || isAbsolute(child)) throw new Error("Settings path escapes the writable directory");
  return path;
}
export async function writeAtomic(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(contents); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export class ConfigStore {
  constructor(readonly root: string) {}
  async loadGyro(name: string): Promise<GyroProfile | null> {
    const text = await this.loadText(name);
    if (text === null) return null;
    if (text.length > 8192) throw new Error("Gyro settings file is too large");
    const value: unknown = JSON.parse(text); return parseGyroProfile(value);
  }
  async saveGyro(name: string, profile: GyroProfile): Promise<void> {
    const validated = parseGyroProfile(profile);
    await this.dump(name, `${JSON.stringify(validated)}\n`);
  }
  async saveInputRouting(name: string, keyboardSeat: number | null): Promise<void> {
    if (keyboardSeat !== null) natural(keyboardSeat);
    await this.dump(name, JSON.stringify({ version: 1, keyboardSeat }) + "\n");
  }
  async loadInputRouting(name: string): Promise<{ readonly keyboardSeat: number | null } | null> {
    const text = await this.loadText(name); if (text === null) return null;
    const value: unknown = JSON.parse(text), data = record(value);
    if (data["version"] !== 1) throw new Error("Unsupported input routing document");
    return { keyboardSeat: data["keyboardSeat"] === null ? null : natural(data["keyboardSeat"]) };
  }
  async saveSeat(name: string, settings: SeatSettings): Promise<void> {
    await writeAtomic(settingsPath(this.root, name), `${JSON.stringify(settings, null, 2)}\n`);
  }
  async loadSeat(name: string): Promise<SeatSettings | null> {
    const file = Bun.file(settingsPath(this.root, name));
    if (!await file.exists()) return null;
    const value: unknown = JSON.parse(await file.text()); return parseSeatSettings(value);
  }
  async saveCvars(name: string, cvars: CvarRegistry, bindings: readonly string[] = []): Promise<void> {
    await writeAtomic(settingsPath(this.root, name), `// Generated by quake-typescript\n${[...bindings, ...cvars.archiveCommands()].join("\n")}\n`);
  }
  async execute(name: string, commands: CommandBuffer, context: CommandContext): Promise<void> {
    const text = await readFile(settingsPath(this.root, name), "utf8");
    commands.append(`${text}\n`, { session: context.session, origin: { kind: "script", name, caller: context.origin } });
  }
  async loadText(name: string): Promise<string | null> {
    const file = Bun.file(settingsPath(this.root, name));
    return await file.exists() ? file.text() : null;
  }
  async dump(name: string, contents: string): Promise<void> { await writeAtomic(settingsPath(this.root, name), contents); }
}

export type GyroProfileIdentity = { readonly kind: "seat" } | { readonly kind: "device"; readonly guid: string; readonly serial: string };
export interface GyroProfile { readonly version: 1; readonly identity: GyroProfileIdentity; readonly tuning: GamepadTuning["gyro"]; }
export function parseGyroProfile(value: unknown): GyroProfile {
  const input = record(value), identity = record(input["identity"]), tuning = record(input["tuning"]);
  if (input["version"] !== 1) throw new Error("Unsupported gyro settings version");
  let key: GyroProfileIdentity;
  if (identity["kind"] === "seat") key = { kind: "seat" };
  else if (identity["kind"] === "device") {
    const guid = string(identity["guid"]), serial = string(identity["serial"]);
    if (!/^[0-9a-f]{32}$/.test(guid) || serial.length === 0 || serial.length > 256 || serial.includes("\0")) throw new Error("Invalid gyro device identity");
    key = { kind: "device", guid, serial };
  } else throw new Error("Unknown gyro profile identity");
  const yawAxis = tuning["yawAxis"];
  if (yawAxis !== "y" && yawAxis !== "z") throw new Error("Unknown gyro yaw axis");
  const result: GamepadTuning["gyro"] = { enabled: boolean(tuning["enabled"]), yawAxis, yawSensitivity: number(tuning["yawSensitivity"]), pitchSensitivity: number(tuning["pitchSensitivity"]) };
  return { version: 1, identity: key, tuning: result };
}
