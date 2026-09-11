// Ported from unix/linux_glimp.c XLateKey. GPL-2.0-or-later.
import { KeyCode } from "./key-codes.ts";
const specialKeys = new Map<number, number>([
  [57, 0], [70, 0], [71, 0], [72, KeyCode.Pause],
  [73, KeyCode.Insert], [74, KeyCode.Home], [75, KeyCode.PageUp],
  [77, KeyCode.End], [78, KeyCode.PageDown], [79, KeyCode.Right],
  [80, KeyCode.Left], [81, KeyCode.Down], [82, KeyCode.Up],
  [84, KeyCode.KeypadSlash], [85, 42], [86, KeyCode.KeypadMinus],
  [87, KeyCode.KeypadPlus], [88, KeyCode.KeypadEnter],
  [89, KeyCode.KeypadEnd], [90, KeyCode.KeypadDown], [91, KeyCode.KeypadPageDown],
  [92, KeyCode.KeypadLeft], [93, KeyCode.Keypad5], [94, KeyCode.KeypadRight],
  [95, KeyCode.KeypadHome], [96, KeyCode.KeypadUp], [97, KeyCode.KeypadPageUp],
  [98, KeyCode.KeypadInsert], [99, KeyCode.KeypadDelete], [103, 61],
  [116, KeyCode.Control], [205, KeyCode.Space],
  [224, KeyCode.Control], [225, KeyCode.Shift], [226, KeyCode.Alt], [227, KeyCode.Alt],
  [228, KeyCode.Control], [229, KeyCode.Shift], [230, KeyCode.Alt], [231, KeyCode.Alt],
]);

/** XLookupString's ASCII control conversion, before XLateKey's fallback normalization. */
function controlByte(byte: number): number {
  if ((byte >= 64 && byte < 127) || byte === 32) return byte & 31;
  if (byte === 50) return 0;
  if (byte >= 51 && byte <= 55) return byte - 24;
  if (byte === 56) return 127;
  if (byte === 47) return 31;
  return byte;
}

/** XLateKey's keysym aliases and fallback byte normalization. */
export function sdlGameKey(keycode: number, modifiers = 0): number {
  if ((keycode & 0x40000000) !== 0) {
    const code = keycode & ~0x40000000;
    if (code >= 58 && code <= 69) return KeyCode.F1 + code - 58;
    // XLateKey lists KP_Begin, but KP_5 takes the fallback byte path.
    if (code === 93 && (modifiers & 0x1000) !== 0) return (modifiers & 0xc0) !== 0 ? 29 : 53;
    return specialKeys.get(code) ?? 0;
  }
  switch (keycode) {
    case 8: return KeyCode.Backspace;
    case 127: return KeyCode.Delete;
    case 33: return 49;
    case 64: return 50;
    case 35: return 51;
    case 36: return 52;
    case 37: return 53;
    case 94: return 54;
    case 38: return 55;
    case 42: return 56;
    case 40: return 57;
    case 41: return 48;
    case 178: return 126;
    // XLookupString returns no byte for ISO_Left_Tab, which XLateKey omits.
    case 9: return (modifiers & 3) !== 0 ? 0 : KeyCode.Tab;
    case 13: return KeyCode.Enter;
    case 27: return KeyCode.Escape;
    case 32: return KeyCode.Space;
    default: {
      const byte = (modifiers & 0xc0) !== 0 ? controlByte(keycode) : keycode;
      if (byte >= 65 && byte <= 90) return byte + 32;
      if (byte >= 1 && byte <= 26) return byte + 96;
      return byte > 0 && byte <= 255 ? byte : 0;
    }
  }
}

/** Sys_XTimeToSysTime's 30 ms correction, using SDL's real age and the shared clock. */
export function sdlEventTime(timestamp: number, ticks: number, now: number, subframe: boolean): number {
  const age = (ticks - timestamp) | 0;
  return subframe && age >= 0 && age <= 30 ? (now - age) | 0 : now;
}

