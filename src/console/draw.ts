import type { Vec4 } from "../contracts/math.ts";
import type { Draw2D, PictureAsset } from "../text/draw2d.ts";
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
  readonly nowMilliseconds: number;
  readonly background: PictureAsset | null;
  readonly selectedEntry?: ConsoleDiscoveryEntry | undefined;
}
export function drawConsole(options: ConsoleDrawOptions): void {
  const { draw, text, scale } = options;
  if (!draw.commands.seat.equals(text.seat)) throw new Error("Console text belongs to another viewport seat");
  if (options.background !== null) draw.drawPic({ x: 0, y: 0, width: draw.width, height: options.height }, options.background);
  const lineHeight = 8 * scale, fieldLines = options.field === null ? 0 : 1;
  const availableWidth = Math.max(1, draw.width - 16 * scale);
  const measure = (value: string): number => text.layout({ text: value, scale, color: white, lineHeight }).width;
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
  const totalRows = Math.max(0, Math.floor(options.height / lineHeight));
  if (totalRows < fieldLines) return;
  const helpLines = help.slice(0, Math.min(3, Math.max(0, totalRows - fieldLines)));
  const rowCount = Math.min(options.rows.length, Math.max(0, totalRows - fieldLines - helpLines.length));
  let y = options.height - lineHeight * (rowCount + fieldLines + helpLines.length);
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
      const layout = text.draw(draw, { text: run, scale, color: colors[first.color] ?? white, alternate: first.alternate, lineHeight }, { x, y });
      x += layout.width;
    }
    y += lineHeight;
  }
  const field = options.field;
  if (field !== null) {
    const characters = [...field.text], cursorWidth = measure(field.overstrike ? "_" : "|");
    let scroll = Math.min(field.scroll, field.cursor);
    while (scroll < field.cursor && measure(`]${characters.slice(scroll, field.cursor).join("")}`) + cursorWidth > availableWidth) scroll++;
    const visible = fit(characters.slice(scroll).join(""), Math.max(0, availableWidth - measure("]") - cursorWidth), false);
    text.draw(draw, { text: `]${visible}`, scale, color: white, lineHeight }, { x: 8 * scale, y });
    if ((Math.trunc(options.nowMilliseconds / 256) & 1) === 0) {
      const prefix = `]${characters.slice(scroll, field.cursor).join("")}`;
      const width = text.layout({ text: prefix, scale, color: white, lineHeight }).width;
      text.draw(draw, { text: field.overstrike ? "_" : "|", scale, color: white, lineHeight }, { x: 8 * scale + width, y });
    }
    y += lineHeight;
    for (const line of helpLines) {
      text.draw(draw, { text: fit(line, availableWidth, true), scale, color: { x: 0.65, y: 0.85, z: 1, w: 1 }, lineHeight }, { x: 8 * scale, y });
      y += lineHeight;
    }
  }
}
