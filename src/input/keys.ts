// Ported from Quake III cl_keys.c. GPL-2.0-or-later.
import { KeyCode } from "./key-codes.ts";
import { sourceCommandText } from "../core/commands/index.ts";
const keyNames: readonly (readonly [string, number])[] = [
  ["TAB", KeyCode.Tab], ["ENTER", KeyCode.Enter], ["ESCAPE", KeyCode.Escape], ["SPACE", KeyCode.Space], ["BACKSPACE", KeyCode.Backspace],
  ["UPARROW", KeyCode.Up], ["DOWNARROW", KeyCode.Down], ["LEFTARROW", KeyCode.Left], ["RIGHTARROW", KeyCode.Right],
  ["ALT", KeyCode.Alt], ["CTRL", KeyCode.Control], ["SHIFT", KeyCode.Shift], ["COMMAND", KeyCode.Command], ["CAPSLOCK", KeyCode.CapsLock],
  ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, KeyCode.F1 + i] satisfies readonly [string, number]),
  ["INS", KeyCode.Insert], ["DEL", KeyCode.Delete], ["PGDN", KeyCode.PageDown], ["PGUP", KeyCode.PageUp], ["HOME", KeyCode.Home], ["END", KeyCode.End],
  ...Array.from({ length: 5 }, (_, i) => [`MOUSE${i + 1}`, KeyCode.Mouse1 + i] satisfies readonly [string, number]),
  ["MWHEELUP", KeyCode.MouseWheelUp], ["MWHEELDOWN", KeyCode.MouseWheelDown],
  ...Array.from({ length: 32 }, (_, i) => [`JOY${i + 1}`, KeyCode.Joy1 + i] satisfies readonly [string, number]),
  ...Array.from({ length: 16 }, (_, i) => [`AUX${i + 1}`, KeyCode.Aux1 + i] satisfies readonly [string, number]),
  ...Array.from({ length: 16 }, (_, i) => [`AUX${i + 17}`, 256 + i] satisfies readonly [string, number]),
  ["KP_HOME", KeyCode.KeypadHome], ["KP_UPARROW", KeyCode.KeypadUp], ["KP_PGUP", KeyCode.KeypadPageUp], ["KP_LEFTARROW", KeyCode.KeypadLeft],
  ["KP_5", KeyCode.Keypad5], ["KP_RIGHTARROW", KeyCode.KeypadRight], ["KP_END", KeyCode.KeypadEnd], ["KP_DOWNARROW", KeyCode.KeypadDown],
  ["KP_PGDN", KeyCode.KeypadPageDown], ["KP_ENTER", KeyCode.KeypadEnter], ["KP_INS", KeyCode.KeypadInsert], ["KP_DEL", KeyCode.KeypadDelete],
  ["KP_SLASH", KeyCode.KeypadSlash], ["KP_MINUS", KeyCode.KeypadMinus], ["KP_PLUS", KeyCode.KeypadPlus], ["KP_NUMLOCK", KeyCode.KeypadNumLock],
  ["KP_STAR", KeyCode.KeypadStar], ["KP_EQUALS", KeyCode.KeypadEquals], ["PAUSE", KeyCode.Pause], ["SEMICOLON", 59],
];
function lower(text: string): string { return text.replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32)); }
export function stringToKeynum(value: string | null): number {
  if (value === null) return -1;
  const text = sourceCommandText(value);
  if (text === "") return -1;
  if (text.length === 1) { const byte = text.charCodeAt(0); return byte < 128 ? byte : byte - 256; }
  if (text.startsWith("0x") && text.length === 4) {
    const nibble = (code: number): number => code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : 0;
    return nibble(text.charCodeAt(2)) * 16 + nibble(text.charCodeAt(3));
  }
  for (const [name, number] of keyNames) if (lower(text) === lower(name)) return number;
  return -1;
}
export function keynumToString(key: number): string {
  if (key === -1) return "<KEY NOT FOUND>";
  if (!Number.isInteger(key) || key < 0 || key > 271) return "<OUT OF RANGE>";
  if (key > 32 && key < 127 && key !== 34 && key !== 59) return String.fromCharCode(key);
  for (const [name, number] of keyNames) if (key === number) return name;
  return `0x${key.toString(16).padStart(2, "0")}`;
}
