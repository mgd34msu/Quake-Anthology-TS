import type { CommandBuffer } from "../../core/commands/index.ts";
import type { CvarRegistry, CvarArchiveEntry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import type { SeatInput } from "../../input/seat.ts";
import type { InputRouter } from "../../input/router.ts";
import { SourceInputState } from "../../input/source-input.ts";
import { SourceMidiInput, type MidiInputBoundary } from "../../input/midi.ts";
import { inputDeviceCvarNames, registerInputDeviceCvars } from "../../input/device-settings.ts";
import { loadCvarArchive } from "./cvar-archives.ts";
import { consoleConfigRoot } from "./config-scripts.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";

export function inputDeviceStore(userContentRoot: string | undefined): ConfigStore { return new ConfigStore(consoleConfigRoot(userContentRoot)); }

export function loadInputDeviceSettings(store: ConfigStore): Promise<readonly CvarArchiveEntry[]> {
  return loadCvarArchive(store, ["input", "devices"], "q3");
}

/** One device owner follows the published input router; prepared worlds never open a second device. */
export class InputDevices {
  private readonly midi: SourceMidiInput;
  private readonly joystick: SourceInputState;
  private router: InputRouter | null = null;
  private midiSeat: SeatInput | null = null;
  private joystickSeat: SeatInput | null = null;
  private signature = "";
  private retryAt = 0;
  private closed = false;
  constructor(private readonly cvars: CvarRegistry, private readonly store: ConfigStore,
    private readonly print: (text: string) => void, midiBoundary?: MidiInputBoundary) {
    registerInputDeviceCvars(cvars);
    const options = { cvars, print: (text: string): undefined => { print(text); return undefined; } };
    this.midi = new SourceMidiInput(options, midiBoundary);
    this.joystick = new SourceInputState(options);
  }
  private selection(): string {
    return ["in_midi", "in_mididevice", "in_midichannel", "in_midiseat", "in_joystick", "in_joystickProfile", "in_joystickSeat"]
      .map(name => this.cvars.variableString(name)).join("/");
  }
  private target(name: string): SeatInput | null {
    const index = this.cvars.variableValue(name) - 1;
    return this.router?.inputs.find(input => input.seat.index === index) ?? null;
  }
  private key(input: SeatInput | null, key: number, down: boolean, time: number): undefined {
    input?.input({ kind: "key", seat: input.seat, code: key, down, repeat: false, timeMilliseconds: time });
    return undefined;
  }
  activate(router: InputRouter): void {
    if (this.closed) throw new Error("Input device owner is closed");
    this.release(performance.now()); this.router?.setSourceJoystick(null); this.router = router;
    this.midiSeat = this.target("in_midiseat"); this.joystickSeat = this.target("in_joystickSeat");
    if (this.signature === "") this.restart();
    router.setSourceJoystick(this.joystick.instance, this.joystickSeat?.seat ?? null);
  }
  release(time: number, commands?: Pick<CommandBuffer, "append">): void {
    if (commands !== undefined) {
      this.midiSeat?.release(time, commands);
      if (this.joystickSeat !== this.midiSeat) this.joystickSeat?.release(time, commands);
    }
    this.midi.release(time, (key, down, timestamp) => commands === undefined ? this.key(this.midiSeat, key, down, timestamp) : undefined);
    this.joystick.releaseJoystickState(time, (key, down, timestamp) => commands === undefined ? this.key(this.joystickSeat, key, down, timestamp) : undefined);
  }
  restart(): void {
    if (this.closed) throw new Error("Input device owner is closed");
    this.release(performance.now());
    this.midiSeat = this.target("in_midiseat"); this.joystickSeat = this.target("in_joystickSeat");
    this.midi.restart(); this.joystick.restart();
    this.signature = this.selection(); this.router?.setSourceJoystick(this.joystick.instance, this.joystickSeat?.seat ?? null);
  }
  frame(now: number): void {
    if (this.closed || this.router === null) return;
    if (this.selection() !== this.signature) this.restart();
    if (now >= this.retryAt) {
      this.retryAt = now + 1000;
      if (this.cvars.variableValue("in_midi") !== 0 && !this.midi.connected) this.midi.restart();
      if (this.cvars.variableValue("in_joystick") !== 0 && this.joystick.instance === null) this.joystick.restart();
      this.router.setSourceJoystick(this.joystick.instance, this.joystickSeat?.seat ?? null);
    }
    if (!this.router.inputs.some(input => input.focused)) this.release(now);
    this.midi.frame((key, down, time) => this.key(this.midiSeat, key, down, time), now);
    this.joystick.joystickFrame((key, down) => this.key(this.joystickSeat, key, down, now), (x, y) => {
      const input = this.joystickSeat;
      if (input?.focus.kind === "game") input.input({ kind: "mouse-motion", seat: input.seat, position: { x: 0, y: 0 }, delta: { x, y }, timeMilliseconds: now });
      return undefined;
    });
    this.router.setSourceJoystick(this.joystick.instance, this.joystickSeat?.seat ?? null);
  }
  info(): void { this.midi.info(); }
  async save(): Promise<void> {
    const entries = this.cvars.archiveEntries().filter(entry => inputDeviceCvarNames.includes(entry.name));
    await this.store.dump("cvars/input/devices.json", `${JSON.stringify({ version: 1, dialect: "q3", entries })}\n`);
  }
  bindings(): readonly SettingBinding[] {
    const toggle = (name: string, label: string): SettingBinding => ({ id: `ui:input:${name}`, label, category: "input", kind: "toggle", enabled: () => true,
      read: () => this.cvars.variableValue(name) !== 0, write: value => this.cvars.set(name, value ? "1" : "0", true) });
    const seat = (name: string, label: string): SettingBinding => ({ id: `ui:input:${name}`, label, category: "input", kind: "choice", enabled: () => true,
      read: () => this.cvars.variableString(name), write: value => this.cvars.set(name, value),
      choices: () => (this.router?.inputs ?? []).map(input => ({ id: String(input.seat.index + 1), label: `Player ${input.seat.index + 1}` })) });
    return [toggle("in_midi", "MIDI input"), seat("in_midiseat", "MIDI player"),
      { id: "ui:input:midi-device", label: "MIDI device", category: "input", kind: "choice", enabled: () => true,
        read: () => this.cvars.variableString("in_mididevice"), write: value => this.cvars.set("in_mididevice", value),
        choices: () => { try { return this.midi.availableDevices().map((device, index) => ({ id: String(index), label: device.name })); }
          catch (error) { this.print(`MIDI devices unavailable: ${String(error)}\n`); return []; } } },
      { id: "ui:input:midi-channel", label: "MIDI channel", category: "input", kind: "slider", enabled: () => true, minimum: 1, maximum: 16, step: 1,
        read: () => this.cvars.variableValue("in_midichannel"), write: value => this.cvars.set("in_midichannel", String(value)) },
      toggle("in_joystick", "Source joystick input"), seat("in_joystickSeat", "Joystick player"),
      { id: "ui:input:joystick-profile", label: "Joystick profile", category: "input", kind: "choice", enabled: () => true,
        read: () => this.cvars.variableString("in_joystickProfile"), write: value => this.cvars.set("in_joystickProfile", value, true),
        choices: () => [{ id: "linux", label: "Linux axes" }, { id: "windows", label: "Windows POV and ball" }] },
      { id: "ui:input:joystick-threshold", label: "Joystick axis threshold", category: "input", kind: "slider", enabled: () => true, minimum: 0.01, maximum: 1, step: 0.01,
        read: () => this.cvars.variableValue("joy_threshold"), write: value => this.cvars.set("joy_threshold", String(value)) },
    ];
  }
  close(): void {
    if (this.closed) return;
    this.release(performance.now()); this.router?.setSourceJoystick(null);
    this.closed = true; this.router = null; this.midi.close(); this.joystick.close();
  }
}
