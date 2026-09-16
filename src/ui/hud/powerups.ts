import type { ActivePowerupTimer } from "../../contracts/gameplay.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiDrawCommand } from "../../contracts/ui.ts";
import type { UiSkin } from "../common/skin.ts";

export function drawPowerupTimers(timers: readonly ActivePowerupTimer[], area: Rect, bottom: number, skin: UiSkin, requestedScale: number,
  measureText: ((text: string, scale: number) => number) | undefined, localize: (text: string) => string): readonly UiDrawCommand[] {
  const active = timers.filter(timer => timer.remainingSeconds > 0);
  if (active.length === 0) return [];
  const capHeight = skin.capInk?.height ?? 8;
  const availableHeight = Math.max(0, bottom - area.y - 8);
  const rows = Math.min(active.length, Math.max(1, Math.floor(availableHeight / 12)));
  const columns = Math.ceil(active.length / rows);
  const scale = Math.min(Math.max(8 / capHeight, requestedScale), Math.max(1, availableHeight / rows - 4) / capHeight);
  const rowHeight = capHeight * scale + 4;
  const width = Math.min(200, area.width / Math.max(2, columns) - 8);
  const commands: UiDrawCommand[] = [];
  for (const [index, timer] of active.entries()) {
    const column = Math.floor(index / rows), row = index % rows;
    const x = area.x + area.width - (column + 1) * (width + 8) + 4;
    const y = bottom - (rows - row) * rowHeight;
    const value = `${Math.ceil(timer.remainingSeconds)}s`, label = Array.from(localize(timer.label));
    const measure = (text: string): number => measureText?.(text, scale) ?? text.length * 8 * scale;
    while (label.length > 0 && measure(`${label.join("")} ${value}`) > width - 8) label.pop();
    commands.push({ kind: "fill", rect: { x, y, width, height: rowHeight }, color: skin.colors.panel },
      { kind: "text", origin: { x: x + width - 4, y: y + 2 - (skin.capInk?.top ?? 0) * scale },
        text: `${label.join("")} ${value}`.trimStart(), font: skin.font, scale, color: skin.colors.text, align: "right", shadow: true });
  }
  return commands;
}
