import { consoleGlyphMetrics } from "./metrics.ts";
import { clipPicture } from "../render/commands/frame.ts";
import type { Vec4 } from "../contracts/math.ts";
import { Draw2D, type PictureAsset } from "../text/draw2d.ts";
import type { SeatTextPresentation } from "../text/layout.ts";
import type { ConsoleRow } from "./buffer.ts";
import type { ConsoleField } from "./field.ts";
import type { ConsoleDiscoveryEntry } from "./discovery.ts";

const colors: readonly Vec4[] = [{ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0, w: 1 },
  { x: 0, y: 1, z: 0, w: 1 }, { x: 1, y: 1, z: 0, w: 1 }, { x: 0, y: 0, z: 1, w: 1 },
  { x: 0, y: 1, z: 1, w: 1 }, { x: 1, y: 0, z: 1, w: 1 }, { x: 1, y: 1, z: 1, w: 1 }];
const white: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
export interface ConsoleDrawOptions {
  readonly draw: Draw2D;
  readonly text: SeatTextPresentation;
  readonly rows: readonly ConsoleRow[];
  readonly field: ConsoleField | null;
  readonly height: number;
  readonly scale: number;
  readonly cellWidth?: number;
  readonly nowMilliseconds: number;
  readonly background: PictureAsset | null;
  readonly selectedEntry?: ConsoleDiscoveryEntry | undefined;
}
export function drawConsole(options: ConsoleDrawOptions): void {
  const { text, scale } = options;
  const sink = options.draw.commands;
  const bounds = { x: 0, y: 0, width: options.draw.width, height: Math.min(options.height, options.draw.height) };
  const draw = new Draw2D({ seat: sink.seat, target: sink.target, setColor: color => sink.setColor(color),
    stretchPixels: (rect, uv, picture) => {
      const clipped = clipPicture(rect, { s1: uv.s, t1: uv.t, s2: uv.s2, t2: uv.t2 }, bounds);
      if (clipped !== null) sink.stretchPixels(clipped.rect, { s: clipped.uv.s1, t: clipped.uv.t1, s2: clipped.uv.s2, t2: clipped.uv.t2 }, picture);
    } }, options.draw.space);
  if (!draw.commands.seat.equals(text.seat)) throw new Error("Console text belongs to another viewport seat");
  if (options.background !== null) draw.drawPic({ x: 0, y: 0, width: draw.width, height: options.height }, options.background);
  const lineHeight = 8 * scale, fieldLines = options.field === null ? 0 : 1;
  const availableWidth = Math.max(1, draw.width - 16 * scale);
  const cellWidth = options.cellWidth ?? lineHeight;
  const measure = (value: string): number => [...value].length * cellWidth;
  const drawCells = (value: string, x: number, y: number, color: Vec4, alternate = false): void => {
    for (const character of value) {
      const glyph = consoleGlyphMetrics(text.font, character, lineHeight, cellWidth);
      const width = text.layout({ text: character, scale, color, alternate, lineHeight: glyph.lineHeight }).width;
      text.draw(draw, { text: character, scale, color, alternate, lineHeight: glyph.lineHeight }, { x: x + (cellWidth - width) / 2, y: y - glyph.top });
      x += cellWidth;
    }
  };
  const fit = (value: string, maximum: number, ellipsis: boolean): string => {
    const characters = [...value.replace(/[\r\n\t]/g, " ")];
    if (measure(characters.join("")) <= maximum) return characters.join("");
    const suffix = ellipsis && measure("...") <= maximum ? "..." : "";
    let low = 0, high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (measure(characters.slice(0, middle).join("") + suffix) <= maximum) low = middle;
      else high = middle - 1;
    }
    return characters.slice(0, low).join("") + suffix;
  };
  const entry = options.selectedEntry, help: string[] = [];
  if (options.field !== null && entry !== undefined) {
    help.push(entry.usage === undefined ? entry.name : `Usage: ${entry.usage}`);
    if (entry.summary !== undefined) help.push(entry.summary);
    if (entry.kind === "cvar") help.push(`Current: ${JSON.stringify(entry.value)}`);
    else if (entry.kind === "alias") help.push(`Expands to: ${entry.value}`);
  }
  const bottom = Math.max(0, Math.min(options.height, draw.height) - 2 * scale);
  const totalRows = Math.max(0, Math.floor(bottom / lineHeight));
  if (totalRows < fieldLines) return;
  const helpLines = help.slice(0, Math.min(3, Math.max(0, totalRows - fieldLines)));
  const rowCount = Math.min(options.rows.length, Math.max(0, totalRows - fieldLines - helpLines.length));
  let y = bottom - lineHeight * (rowCount + fieldLines + helpLines.length);
  for (const row of options.rows.slice(options.rows.length - rowCount)) {
    let x = 8 * scale;
    for (let index = 0; index < row.cells.length;) {
      const first = row.cells[index];
      if (first === undefined) break;
      let run = first.character; index++;
      while (index < row.cells.length) {
        const cell = row.cells[index];
        if (cell === undefined || cell.color !== first.color || cell.alternate !== first.alternate) break;
        run += cell.character; index++;
      }
      drawCells(run, x, y, colors[first.color] ?? white, first.alternate);
      x += measure(run);
    }
    y += lineHeight;
  }
  const field = options.field;
  if (field !== null) {
    const characters = [...field.text], cursorWidth = measure(field.overstrike ? "_" : "|");
    let scroll = Math.min(field.scroll, field.cursor);
    while (scroll < field.cursor && measure(`]${characters.slice(scroll, field.cursor).join("")}`) + cursorWidth > availableWidth) scroll++;
    const visible = fit(characters.slice(scroll).join(""), Math.max(0, availableWidth - measure("]") - cursorWidth), false);
    drawCells(`]${visible}`, 8 * scale, y, white);
    if ((Math.trunc(options.nowMilliseconds / 256) & 1) === 0) {
      const prefix = `]${characters.slice(scroll, field.cursor).join("")}`;
      const width = measure(prefix);
      drawCells(field.overstrike ? "_" : "|", 8 * scale + width, y, white);
    }
    y += lineHeight;
    for (const line of helpLines) {
      drawCells(fit(line, availableWidth, true), 8 * scale, y, { x: 0.65, y: 0.85, z: 1, w: 1 });
      y += lineHeight;
    }
  }
}
