import { CvarFlag, Q2CvarFlag, type CvarRegistry } from "../core/cvars/index.ts";

const midiDefaults = [
  ["in_midi", "0"], ["in_midiport", "1"], ["in_midichannel", "1"], ["in_mididevice", "0"], ["in_midiseat", "1"],
] satisfies readonly (readonly [string, string])[];
const joystickDefaults = [
  ["in_mouse", "1", CvarFlag.Archive], ["in_dgamouse", "1", CvarFlag.Archive], ["in_subframe", "1", CvarFlag.Archive],
  ["in_nograb", "0", CvarFlag.None], ["in_joystick", "0", CvarFlag.Archive | CvarFlag.Latch],
  ["in_debugjoystick", "0", CvarFlag.Temporary], ["joy_threshold", "0.15", CvarFlag.Archive],
  ["in_joystickProfile", process.platform === "win32" ? "windows" : "linux", CvarFlag.Archive | CvarFlag.Latch],
  ["in_joyBallScale", "0.02", CvarFlag.Archive], ["in_joystickSeat", "1", CvarFlag.Archive],
] satisfies readonly (readonly [string, string, CvarFlag])[];
export const inputDeviceCvarNames = [...midiDefaults.map(([name]) => name), ...joystickDefaults.map(([name]) => name)];
export function registerMidiSettings(cvars: CvarRegistry): void {
  for (const [name, value] of midiDefaults)
    if (cvars.find(name) === undefined || cvars.isConsoleCreated(name)) cvars.register(name, value, CvarFlag.Archive);
}
export function registerSourceInputSettings(cvars: CvarRegistry): void {
  for (const [name, value, flags] of joystickDefaults) {
    const sourceFlags = cvars.dialect === "q2-classic" || cvars.dialect === "q2-rerelease"
      ? ((flags & CvarFlag.Archive) !== 0 ? Q2CvarFlag.Archive : 0) | ((flags & CvarFlag.Latch) !== 0 ? Q2CvarFlag.Latch : 0)
      : cvars.dialect === "q3" ? flags : flags & CvarFlag.Archive;
    if (cvars.find(name) === undefined || cvars.isConsoleCreated(name)) cvars.register(name, value, sourceFlags);
  }
}
export function registerInputDeviceCvars(cvars: CvarRegistry): void { registerMidiSettings(cvars); registerSourceInputSettings(cvars); }
