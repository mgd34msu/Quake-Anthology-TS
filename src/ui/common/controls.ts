import type { Rect } from "../../contracts/render.ts";
import type { UiControl } from "../../contracts/ui.ts";

/** A plain activating button; menus wrap this with their own id prefix and row geometry. */
export function buttonControl(id: UiControl["id"], label: string, rect: Rect, activate: () => unknown, enabled = true): UiControl {
  return { id, kind: "button", label, rect, enabled, visible: true, activate: () => { activate(); return undefined; } };
}

/** Greedy word wrap at `width` characters; a word longer than the width is split rather than overflowing. */
export function wrapWords(text: string, width: number): readonly string[] {
  const lines: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    for (let rest = word; ; rest = rest.slice(width)) {
      const piece = rest.slice(0, width), last = rest.length <= width;
      if (line !== "" && line.length + 1 + piece.length > width) { lines.push(line); line = ""; }
      line += `${line === "" ? "" : " "}${piece}`;
      if (last) break;
      lines.push(line); line = "";
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
