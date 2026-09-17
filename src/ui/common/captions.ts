import type { ResourceId } from "../../contracts/content.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiDrawCommand } from "../../contracts/ui.ts";
import type { ActiveCaption } from "../../text/captions.ts";

/** Captions use the same text command renderer as menus and HUD, within a caller-owned safe region. */
export function captionCommands(captions: readonly ActiveCaption[], area: Rect, font: ResourceId, scale: number,
  measure: (text: string, scale: number) => number, capInk: { readonly top: number; readonly height: number } = { top: 0, height: 8 }): readonly UiDrawCommand[] {
  if (captions.length === 0 || area.width < 16 || area.height < 12) return [];
  const padding = 4, width = area.width - padding * 2, lineHeight = Math.ceil(capInk.height * scale) + 4;
  if (lineHeight + padding * 2 > area.height) return [];
  const lines: string[] = [];
  for (const caption of captions) {
    const text = `${caption.localizedSpeaker === null ? "" : `${caption.localizedSpeaker}: `}${caption.localizedText}`;
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/u)) {
        if (measure(line + word, scale) <= width) { line += word; continue; }
        if (line.trim() !== "") { lines.push(line.trimEnd()); line = ""; }
        for (const character of word.trimStart()) {
          if (line !== "" && measure(line + character, scale) > width) { lines.push(line); line = ""; }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
  }
  const visible = lines.slice(-Math.max(1, Math.floor((area.height - padding * 2) / lineHeight)));
  const height = visible.length * lineHeight + padding * 2, y = area.y + area.height - height;
  const commands: UiDrawCommand[] = [{ kind: "fill", rect: { x: area.x, y, width: area.width, height }, color: { x: 0, y: 0, z: 0, w: 0.92 } }];
  for (const [index, line] of visible.entries()) commands.push({ kind: "text", text: line, font, scale, origin: { x: area.x + area.width / 2, y: y + padding + index * lineHeight - capInk.top * scale }, align: "center", color: { x: 1, y: 1, z: 1, w: 1 }, shadow: true });
  return commands;
}
