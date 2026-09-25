// Original rerelease cg_screen.cpp layout and inventory grammar. GPL-2.0-or-later.
import { Tokenizer } from "../../core/common-parse.ts";
import { gameAtoi } from "../../core/game-numeric.ts";
import { q2ApplicationLayout } from "../../app/bootstrap/network/q2-layout.ts";
import { nativeQ2HudStat, type NativeQ2HudArsenal, type NativeQ2HudFrame, type NativeQ2HudOperation } from "./q2-native.ts";

export interface NativeQ2HudTable { readonly rows: string[][]; readonly columns: number[]; }
export interface NativeQ2HudEnvironment {
  readonly table?: NativeQ2HudTable;
  readonly useFont: boolean;
  readonly fontLineHeight: number;
  measure(text: string): { readonly x: number; readonly y: number };
  localize(text: string, args?: readonly string[]): string;
}
const STAT_HEALTH_BARS = 52, STAT_ACTIVE_WEAPON = 53, CONFIG_HEALTH_BAR_NAME = 12104, CONFIG_STORY = 12105, CS_WHEEL_WEAPONS = 12350;
const white = { x: 1, y: 1, z: 1, w: 1 }, black = { x: 0, y: 0, z: 0, w: 1 };
const encoder = new TextEncoder(), decoder = new TextDecoder();
function cell(value: string): string { return decoder.decode(encoder.encode(value).subarray(0, 23)); }
function clientName(frame: NativeQ2HudFrame, slot: number): string {
  if (slot < 0 || slot >= 256) throw new RangeError("Q2 HUD client is outside clientinfo");
  return (frame.configstrings.get(q2ApplicationLayout(frame.protocol).playerSkins + slot) ?? "").split("\\")[0] ?? "";
}
function localized(frame: NativeQ2HudFrame, environment: NativeQ2HudEnvironment, text: string, args: readonly string[] = []): string {
  return environment.localize(text, args).replace(/##P([0-9]+)/gu, (_match: string, slot: string) => clientName(frame, Number(slot)));
}

export function q2RereleaseLayout(source: string, frame: NativeQ2HudFrame, width: number, height: number,
  environment: NativeQ2HudEnvironment, arsenal?: NativeQ2HudArsenal): readonly NativeQ2HudOperation[] {
  const out: NativeQ2HudOperation[] = [], parser = new Tokenizer(source, "Q2 rerelease HUD layout"), config = q2ApplicationLayout(frame.protocol);
  const conditions: boolean[] = [];
  const { rows, columns } = environment.table ?? { rows: [], columns: [] };
  let x = 0, y = 0;
  const next = (): string => parser.next()?.value ?? "", integer = (): number => gameAtoi(next());
  const enabled = (): boolean => conditions.at(-1) ?? true;
  const stat = (index: number): number => nativeQ2HudStat(frame, index, arsenal);
  const fontOffset = (environment.fontLineHeight - 8) / 2;
  const measure = (value: string, forceFont = false): number => environment.useFont || forceFont ? environment.measure(value).x : encoder.encode(value).length * 8;
  const text = (value: string, alternate = false, atX = x, atY = y, forceFont = false): void => {
    out.push({ kind: environment.useFont || forceFont ? "font-text" : "text", x: atX, y: atY - (environment.useFont || forceFont ? fontOffset : 0), text: value, alternate, ...(environment.useFont || forceFont ? {} : { shadow: true, xor: true }) });
  };
  const centered = (value: string, alternate = false, atX = x, atY = y): void => {
    for (const line of value.split("\n")) { text(line, alternate, atX + (320 - measure(line)) / 2, atY); atY += environment.useFont ? 10 : 8; }
  };
  const picture = (name: string, atX = x, atY = y): void => { if (name !== "") out.push({ kind: "picture", x: atX, y: atY, name }); };
  const field = (value: number, digits: number, alternate = false): void => {
    const count = Math.min(5, digits); if (count < 1) return;
    const valueText = String(Math.trunc(value)), length = Math.min(valueText.length, count);
    let atX = x + 2 + 16 * (count - length);
    for (const digit of valueText.slice(0, length)) { picture(`${alternate ? "anum" : "num"}_${digit === "-" ? "minus" : digit}`, atX); atX += 16; }
  };
  const configStat = (index: number): string => {
    const value = stat(index); if (value < 0 || value >= config.maxConfigStrings) throw new RangeError("Q2 HUD stat string is outside configstrings");
    return frame.configstrings.get(value) ?? "";
  };
  const count = (value: number, maximum: number): number => { if (value < 0 || value > maximum) throw new RangeError("Q2 HUD argument count exceeds source limits"); return value; };
  const flash = frame.timeMilliseconds % 1000 < 500;
  for (let token = parser.next(); token !== undefined; token = parser.next()) {
    const command = token.value, draw = enabled();
    switch (command) {
      case "if": { const index = integer(); conditions.push(draw && stat(index) !== 0); break; }
      case "ifgef": { const value = integer(); conditions.push(draw && frame.serverFrame >= value); break; }
      case "endif": { if (conditions.pop() === undefined) throw new Error("Q2 HUD endif without matching if"); break; }
      case "xl": case "xr": case "xv": { const value = integer(); if (draw) x = value + (command === "xr" ? width : command === "xv" ? Math.trunc(width / 2) - 160 : 0); break; }
      case "yt": case "yb": case "yv": { const value = integer(); if (draw) y = value + (command === "yb" ? height : command === "yv" ? Math.trunc(height / 2) - 120 : 0); break; }
      case "pic": {
        const index = integer(); if (!draw) break;
        if (index === 2 && arsenal !== undefined) { if (arsenal.ammo !== null && arsenal.ammoIcon !== null) out.push({ kind: "arsenal-picture", x, y, ...arsenal.ammoIcon }); break; }
        const value = stat(index); if (value < 0 || value >= config.maxImages) throw new RangeError("Q2 HUD image is outside configstrings");
        picture(frame.configstrings.get(config.images + value) ?? ""); break;
      }
      case "picn": { const value = next(); if (draw) picture(value); break; }
      case "num": { const digits = integer(), index = integer(); if (draw) field(stat(index), digits); break; }
      case "lives_num": { const index = integer(); if (draw) { const value = stat(index); field(Math.max(0, value - 2), 1, value <= 2 && flash); } break; }
      case "hnum": case "anum": case "rnum": {
        if (!draw) break;
        const index = command === "hnum" ? 1 : command === "anum" ? 3 : 5, value = stat(index);
        if (index !== 1 && value < 0) break;
        const weapon = stat(STAT_ACTIVE_WEAPON), warning = gameAtoi((frame.configstrings.get(CS_WHEEL_WEAPONS + weapon) ?? "").split("|")[6] ?? "0") || 5;
        const alternate = index === 1 ? value <= 0 || value <= 25 && flash : index === 3 && value <= warning && flash;
        if ((stat(15) & (index === 1 ? 1 : index === 3 ? 4 : 2)) !== 0) picture("field_3");
        field(value, 3, alternate); break;
      }
      case "stat_string": case "loc_stat_string": case "loc_stat_rstring": case "loc_stat_cstring": case "loc_stat_cstring2": {
        const index = integer(); if (!draw) break;
        const raw = configStat(index), value = command === "stat_string" ? raw : localized(frame, environment, raw);
        if (command.startsWith("loc_stat_cstring")) centered(value, command.endsWith("2"));
        else text(value, false, x - (command === "loc_stat_rstring" ? measure(value) : 0));
        break;
      }
      case "string": case "string2": case "cstring": case "cstring2": {
        const value = next(); if (draw) { if (command.startsWith("cstring")) centered(value, command.endsWith("2")); else text(value, command.endsWith("2")); } break;
      }
      case "loc_string": case "loc_string2": case "loc_rstring": case "loc_rstring2": case "loc_cstring": case "loc_cstring2": {
        const size = count(integer(), 7), base = next(), args = Array.from({ length: size }, next);
        if (!draw) break;
        const value = localized(frame, environment, base, args), alternate = command.endsWith("2");
        if (command.startsWith("loc_cstring")) centered(value, alternate); else text(value, alternate, x - (command.startsWith("loc_rstring") ? measure(value) : 0));
        break;
      }
      case "client": {
        const px = integer(), py = integer(), slot = integer(), score = integer(), ping = integer(); if (!draw) break;
        x = Math.trunc(width / 2) - 160 + px + 8; y = Math.trunc(height / 2) - 120 + py + 7;
        text(clientName(frame, slot), false, x + 32); text(String(score), !environment.useFont, x + 32, y + 10);
        out.push({ kind: "sized-picture", x: x + 96, y: y + 10, width: 9, height: 9, name: "ping" });
        text(String(ping), false, x + (environment.useFont ? 107 : 105), y + 10); break;
      }
      case "ctf": {
        const px = integer(), py = integer(), slot = integer(), score = integer(), ping = Math.min(999, integer()), icon = next(); if (!draw) break;
        x = Math.trunc(width / 2) - 160 + px; y = Math.trunc(height / 2) - 120 + py;
        text(String(score), slot === frame.playerNumber, x, y, true); x += 27;
        text(String(ping), slot === frame.playerNumber, x, y, true); x += 27;
        text(clientName(frame, slot), slot === frame.playerNumber, x, y, true);
        if (icon !== "") out.push({ kind: "picture", x, y, name: icon, anchor: "before" });
        break;
      }
      case "time_limit": {
        const end = integer(); if (!draw || end < frame.serverFrame) break;
        const seconds = Math.trunc((end - frame.serverFrame) * (frame.frameTimeMilliseconds ?? 25) / 1000);
        const value = localized(frame, environment, "$g_score_time", [`${String(Math.trunc(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`]);
        text(value, true, x - measure(value)); break;
      }
      case "dogtag": {
        const slot = integer(); if (!draw) break; clientName(frame, slot);
        const tag = (frame.configstrings.get(config.playerSkins + slot) ?? "").split("\\")[2] || "default";
        out.push({ kind: "sized-picture", x, y, width: 198, height: 32, name: `/tags/${tag}.pcx` }); break;
      }
      case "start_table": {
        const size = count(integer(), 5), headers = Array.from({ length: size }, next); if (!draw) break;
        rows.splice(0, rows.length, headers.map(value => cell(localized(frame, environment, value))));
        columns.splice(0, columns.length, ...rows[0]?.map(value => Math.trunc(measure(value, true))) ?? []); break;
      }
      case "table_row": {
        const size = count(integer(), 6), values = Array.from({ length: size }, next); if (!draw) break;
        if (rows.length >= 11) throw new RangeError("Q2 HUD table exceeds source dimensions");
        const row = Array.from({ length: Math.max(size, columns.length) }, (_, index) => cell(values[index] ?? "")); rows.push(row);
        for (const [index, value] of row.slice(0, columns.length).entries()) columns[index] = Math.max(columns[index] ?? 0, Math.trunc(measure(value, true)));
        break;
      }
      case "draw_table": {
        if (!draw) break;
        const space = Math.trunc(environment.measure(" ").x), tableWidth = columns.reduce((sum, value) => sum + value, 0) + Math.max(0, columns.length - 1) * space;
        const tableHeight = rows.length * (8 + fontOffset), left = x - Math.trunc(tableWidth / 2), top = y + 8;
        const char = (code: number, px: number, py: number): void => { out.push({ kind: "text", x: px, y: py, text: String.fromCharCode(code), alternate: false }); };
        char(18, left - 8, top - 8); char(20, left + tableWidth, top - 8); char(24, left - 8, top + tableHeight); char(26, left + tableWidth, top + tableHeight);
        for (let px = left; px < left + tableWidth; px += 8) { char(19, px, top - 8); char(25, px, top + tableHeight); }
        for (let py = top; py < top + tableHeight; py += 8) { char(21, left - 8, py); char(23, left + tableWidth, py); }
        out.push({ kind: "fill", x: left, y: top, width: tableWidth, height: tableHeight, color: black });
        let px = left;
        for (const [index, column] of columns.entries()) {
          for (const [rowIndex, row] of rows.entries()) { const value = row[index] ?? "", offset = rowIndex === 0 ? (column - measure(value, true)) / 2 : index === 0 ? 0 : column - measure(value, true); text(value, rowIndex === 0, px + offset, top + rowIndex * (8 + fontOffset), true); }
          px += column + space;
        }
        break;
      }
      case "stat_pname": { const index = integer(); if (draw) text(clientName(frame, stat(index) - 1)); break; }
      case "health_bars": {
        if (!draw) break;
        centered(localized(frame, environment, frame.configstrings.get(CONFIG_HEALTH_BAR_NAME) ?? ""), false, Math.trunc(width / 2) - 160);
        y += environment.fontLineHeight;
        const value = stat(STAT_HEALTH_BARS), barWidth = width * 0.5, left = width * 0.5 - barWidth * 0.5;
        for (let index = 0; index < 2; index++) {
          const packed = (value >>> (index * 8)) & 255; if ((packed & 128) === 0) continue;
          const fraction = (packed & 127) / 127;
          out.push({ kind: "fill", x: left, y, width: barWidth + 1, height: 5, color: black });
          if (fraction > 0) out.push({ kind: "fill", x: left, y, width: barWidth * fraction, height: 4, color: { ...white, y: 0, z: 0 } });
          if (fraction < 1) out.push({ kind: "fill", x: left + barWidth * fraction, y, width: barWidth * (1 - fraction), height: 4, color: { x: 80 / 255, y: 80 / 255, z: 80 / 255, w: 1 } });
          y += 12;
        }
        break;
      }
      case "story": {
        const raw = frame.configstrings.get(CONFIG_STORY) ?? ""; if (raw === "") break;
        const value = localized(frame, environment, raw), size = environment.measure(value);
        for (const [index, line] of value.split("\n").entries()) out.push({ kind: "font-text", x: (width - environment.measure(line).x) / 2, y: (height - size.y) / 2 + index * environment.fontLineHeight, text: line, alternate: false });
        break;
      }
    }
  }
  if (conditions.length !== 0) throw new Error("Q2 HUD if without matching endif");
  return out;
}

export function q2RereleaseInventory(frame: NativeQ2HudFrame, width: number, height: number, environment: NativeQ2HudEnvironment): readonly NativeQ2HudOperation[] {
  const out: NativeQ2HudOperation[] = [], config = q2ApplicationLayout(frame.protocol), selected = frame.stats[12] ?? 0;
  const items = frame.inventory.flatMap((count, index) => count === 0 ? [] : [index]);
  const selectedRow = frame.inventory.slice(0, Math.max(0, selected)).filter(count => count !== 0).length;
  const top = Math.max(0, Math.min(items.length - 19, selectedRow - 9)), x = Math.trunc(width / 2) - 128, y = Math.trunc(height / 2) - 108;
  out.push({ kind: "picture", x, y: y + 8, name: "inventory" });
  for (const [row, item] of items.slice(top, top + 19).entries()) {
    const name = localized(frame, environment, frame.configstrings.get(config.items + item) ?? ""), py = y + 27 + row * 8, alternate = item === selected;
    if (alternate && ((frame.timeMilliseconds * 10) & 1) !== 0) out.push({ kind: "text", x: x + 14, y: py, text: "\x0f", alternate: false });
    if (environment.useFont) {
      const count = String(frame.inventory[item] ?? 0), offset = (environment.fontLineHeight - 8) / 2;
      out.push({ kind: "font-text", x: x + 222 - environment.measure(count).x, y: py - offset, text: count, alternate },
        { kind: "font-text", x: x + 38, y: py - offset, text: name, alternate });
    } else out.push({ kind: "text", x: x + 22, y: py, text: `${String(frame.inventory[item] ?? 0).padStart(3)} ${name}`, alternate, xor: true });
  }
  return out;
}
