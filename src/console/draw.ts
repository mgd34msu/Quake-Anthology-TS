import type { Vec4 } from "../contracts/math.ts";
import type { Draw2D, PictureAsset } from "../text/draw2d.ts";
import type { SeatTextPresentation } from "../text/layout.ts";
import type { ConsoleRow } from "./buffer.ts";
import type { ConsoleField } from "./field.ts";

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
}
export function drawConsole(options: ConsoleDrawOptions): void {
  const { draw, text, scale } = options;
  if (!draw.commands.seat.equals(text.seat)) throw new Error("Console text belongs to another viewport seat");
  if (options.background !== null) draw.drawPic({ x: 0, y: 0, width: draw.width, height: options.height }, options.background);
  const lineHeight = 8 * scale, fieldLines = options.field === null ? 0 : 1;
  let y = options.height - lineHeight * (options.rows.length + fieldLines);
  for (const row of options.rows) {
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
    const visible = [...field.text].slice(field.scroll, field.scroll + field.widthInChars).join("");
    text.draw(draw, { text: `]${visible}`, scale, color: white, lineHeight }, { x: 8 * scale, y });
    if ((Math.trunc(options.nowMilliseconds / 256) & 1) === 0) {
      const prefix = `]${[...field.text].slice(field.scroll, field.cursor).join("")}`;
      const width = text.layout({ text: prefix, scale, color: white, lineHeight }).width;
      text.draw(draw, { text: field.overstrike ? "_" : "|", scale, color: white, lineHeight }, { x: 8 * scale + width, y });
    }
  }
}
