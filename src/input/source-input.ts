// Quake III source joystick/mouse lifecycle. GPL-2.0-or-later.
import { registerSourceInputSettings } from "./device-settings.ts";
import type { CvarRegistry } from "../core/cvars/index.ts";
import { SdlJoystick } from "../platform/sdl.ts";
import type { SdlJoystickEvent } from "../platform/sdl.ts";
import { SourceJoystickState, windowsJoystickDebug } from "./source-joystick.ts";
import type { SourceJoystickProfile } from "./source-joystick.ts";
export interface SourceInputOptions { readonly cvars: CvarRegistry; readonly print: (text: string) => undefined; }
/** Client-build input survives window replacement and starts at Sys_Init, before Netchan_Init. */
export class SourceInputState {
  readonly mouse = { available: false, active: false, resetTime: 0 };
  readonly joystickState = new SourceJoystickState();
  private closed = false;
  private joystick: SdlJoystick | null = null;
  private joystickEvents: SdlJoystickEvent[] = [];
  private joystickProfile: SourceJoystickProfile = "linux";
  get instance(): number | null { return this.joystick?.instance ?? null; }

  /** Inert construction permits the common owner to publish input before initialization prints. */
  constructor(private readonly options: SourceInputOptions) {}

  /** IN_Init registers source cvars, applies the joystick latch and discovers its actual device. */
  initialize(): void {
    this.requireOpen();
    const { cvars, print } = this.options;
    print("\n------- Input Initialization -------\n");
    registerSourceInputSettings(cvars);
    cvars.applyLatched("in_joystick"); cvars.applyLatched("in_joystickProfile");
    const profile = this.cvar("in_joystickProfile").value;
    if (profile !== "linux" && profile !== "windows") throw new Error("in_joystickProfile must be linux or windows");
    this.joystickProfile = profile;
    this.mouse.available = this.cvar("in_mouse").numericValue !== 0;

    // The source abandons the old descriptor but retains IN_JoyMove's static axis state.
    const previous = this.joystick;
    this.joystick = null;
    this.joystickEvents = [];
    previous?.close();
    if (this.cvar("in_joystick").integerValue !== 0) {
      if (this.joystickProfile === "windows") this.joystickState.clear();
      const joystick = SdlJoystick.openFirst(print, this.joystickProfile);
      this.joystick = joystick;
      print(joystick === null ? "No joystick found.\n" : `Joystick SDL instance ${joystick.instance} found\nName:    ${joystick.name}\nAxes:    ${joystick.axes}\nButtons: ${joystick.buttons}\n`);
      // Linux discards JS_EVENT_INIT; Windows samples current values in each frame.
      joystick?.pollEvents();
    } else print("Joystick is not active.\n");
    print("------------------------------------\n");
  }

  /** Sys_In_Restart_f changes availability and device selection without retiring the window. */
  restart(): void {
    this.requireOpen();
    this.mouse.available = false;
    this.initialize();
  }

  queueJoystickEvent(event: SdlJoystickEvent): void {
    this.requireOpen();
    if (this.joystick !== null && event.instance === this.joystick.instance) this.joystickEvents.push(event);
  }

  /** IN_JoyMove runs after console polling, with or without an attached SDL window. */
  joystickFrame(queueKey: (key: number, down: boolean, time: number) => undefined,
    queueMouse?: (dx: number, dy: number, time: number) => undefined): void {
    this.requireOpen();
    if (this.joystick === null) return;
    const events = [...this.joystickEvents, ...this.joystick.pollEvents(this.joystickProfile)];
    this.joystickEvents = [];
    if (this.joystickProfile === "windows" && this.cvar("in_debugjoystick").integerValue !== 0
      && !events.some(event => event.kind === "joystick-removed")) this.options.print(windowsJoystickDebug(events));
    for (const event of events) {
      if (this.joystick === null) break;
      switch (event.kind) {
        case "joystick-button":
          this.joystickState.button(event.button, event.down, queueKey, this.joystickProfile === "windows");
          break;
        case "joystick-axis":
          this.joystickState.axis(event.axis, event.value);
          break;
        case "joystick-hat":
          this.joystickState.pov(event.hat, event.value);
          break;
        case "joystick-removed":
          this.options.print("SDL joystick disconnected.\n");
          this.joystick?.close(); this.joystick = null;
          this.joystickState.removeDevice(queueKey);
          break;
      }
    }
    const threshold = this.joystick === null ? null : this.cvar("joy_threshold").numericValue;
    if (this.joystickProfile === "windows") {
      if (queueMouse === undefined) throw new Error("Windows joystick input requires a mouse event consumer");
      this.joystickState.windowsFrame(threshold, this.joystick?.axes ?? 0, this.cvar("in_joyBallScale").numericValue, queueKey, queueMouse);
    } else this.joystickState.frame(threshold, queueKey);
  }

  /** SDL focus loss releases shared keys before clearing them; source restart never calls this. */
  releaseJoystickState(time: number, queueKey: (key: number, down: boolean, time: number) => undefined): void {
    this.requireOpen();
    this.joystickState.release(time, queueKey);
  }

  private cvar(name: string) {
    const value = this.options.cvars.get(name);
    if (value === undefined) throw new Error(`Input cvar ${name} no longer exists`);
    return value;
  }

  private requireOpen(): void {
    if (this.closed) throw new Error("Source input is closed");
  }

  /** Final common disposal releases the joystick; ordinary window shutdown does not. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.mouse.available = false;
    const joystick = this.joystick;
    this.joystick = null; this.joystickEvents = [];
    this.joystickState.clear();
    joystick?.close();
  }
}
