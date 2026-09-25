import type { ContentId, ResourceId } from "../../contracts/content.ts";
import type { UiDrawCommand, UiDrawContext } from "../../contracts/ui.ts";
import type { PictureAsset } from "../../text/draw2d.ts";
import { q2NativeHudOperations, type NativeQ2HudFrame, type NativeQ2HudArsenal, type NativeQ2HudEnvironment, type NativeQ2HudOperation } from "../../ui/hud/q2-native.ts";
import type { ApplicationAssets } from "./assets.ts";

export interface NativeQ2HudRendering extends NativeQ2HudEnvironment { readonly font: ResourceId; readonly fontScale: number; }

/** Uses mounted Q2 pictures and conchars with the normal seat-clipped UiDrawCommand renderer. */
export class ApplicationQ2NativeHud {
  private readonly pictures = new Map<ResourceId, PictureAsset>();
  private readonly ids = new Map<string, ResourceId>();
  private content: ContentId | null = null;
  private revision = 0;
  private environment: NativeQ2HudRendering | undefined;
  private readonly table: import("../../ui/hud/q2-rerelease-layout.ts").NativeQ2HudTable = { rows: [], columns: [] };
  private preparedOperations: readonly NativeQ2HudOperation[] | null = null;
  clear(): void { this.table.rows.length = 0; this.table.columns.length = 0; this.preparedOperations = null; this.environment = undefined; this.revision++; this.content = null; this.ids.clear(); this.pictures.clear(); }
  picture(id: ResourceId): PictureAsset | undefined { return this.pictures.get(id); }
  async prepare(content: ContentId, assets: ApplicationAssets, frame: NativeQ2HudFrame, context: UiDrawContext, scale = 1,
    mode: "layout-overlay" | "replace-status" = "replace-status", assertCurrent: () => void = () => undefined, arsenal?: NativeQ2HudArsenal, environment?: NativeQ2HudRendering): Promise<void> {
    if (this.content !== content) { this.clear(); this.content = content; }
    const revision = this.revision;
    this.environment = environment === undefined ? undefined : { ...environment, table: this.table };
    const current = (): void => { assertCurrent(); if (revision !== this.revision) throw new Error("Native HUD media is retired"); };
    current();
    const area = context.binding.safeArea;
    const ops = q2NativeHudOperations(frame, area.width / scale, area.height / scale, undefined, mode, arsenal, this.environment);
    this.preparedOperations = this.environment === undefined ? null : ops;
    const provider = await assets.provider(content);
    current();
    const numbers = ["num", "anum"].flatMap(prefix => [...Array.from({ length: 10 }, (_, digit) => `${prefix}_${digit}`), `${prefix}_minus`]);
    const names = new Set(["conchars", "field_3", ...numbers, ...ops.flatMap(op => op.kind === "picture" || op.kind === "sized-picture" ? [op.name] : [])]);
    await Promise.all([...names].map(async name => {
      if (this.ids.has(name)) return;
      const path = name.startsWith("/") || name.startsWith("\\") ? name.slice(1) : `pics/${name}.pcx`;
      let texture = await provider.textures.load(path, { family: "q2", mipmap: false, wrap: "clamp" });
      current();
      if (texture === null && path.startsWith("players/")) texture = await provider.textures.load("players/male/grunt_i.pcx", { family: "q2", mipmap: false, wrap: "clamp" });
      current();
      const image = (texture ?? provider.textures.missing).image, id: ResourceId = `resource:q2-native-hud:${content}/${path}`;
      this.ids.set(name, id); this.pictures.set(id, { kind: "image", name: path, image });
    }));
  }
  commands(frame: NativeQ2HudFrame, context: UiDrawContext, scale = 1, binding: (command: string) => string = () => "",
    mode: "layout-overlay" | "replace-status" = "replace-status", arsenal?: NativeQ2HudArsenal): readonly UiDrawCommand[] {
    const area = context.binding.safeArea, out: UiDrawCommand[] = [{ kind: "clip", rect: area }];
    const font = this.ids.get("conchars");
    for (const op of this.preparedOperations ?? q2NativeHudOperations(frame, area.width / scale, area.height / scale, binding, mode, arsenal, this.environment)) {
      if (op.kind === "fill") {
        out.push({ kind: "fill", rect: { x: area.x + op.x * scale, y: area.y + op.y * scale, width: op.width * scale, height: op.height * scale }, color: op.color });
      } else if (op.kind === "font-text") {
        const environment = this.environment;
        if (environment === undefined) throw new Error("Native HUD font was not prepared");
        out.push({ kind: "text", origin: { x: area.x + op.x * scale, y: area.y + op.y * scale }, text: op.text, font: environment.font, scale: environment.fontScale * scale,
          color: op.alternate ? { x: 112 / 255, y: 1, z: 52 / 255, w: 1 } : { x: 1, y: 1, z: 1, w: 1 }, align: "left", shadow: true });
      } else if (op.kind === "arsenal-picture") {
        const width = 24 * Math.min(1, op.aspect), height = 24 / Math.max(1, op.aspect);
        out.push({ kind: "image", resource: op.resource,
          rect: { x: area.x + (op.x + (24 - width) / 2) * scale, y: area.y + (op.y + (24 - height) / 2) * scale, width: width * scale, height: height * scale },
          texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
      } else if (op.kind === "picture" || op.kind === "sized-picture") {
        const id = this.ids.get(op.name), picture = id === undefined ? undefined : this.pictures.get(id);
        if (id === undefined || picture?.kind !== "image") continue;
        out.push({ kind: "image", resource: id, rect: { x: area.x + (op.x - (op.kind === "picture" && op.anchor === "before" ? picture.image.width + 2 : 0)) * scale, y: area.y + op.y * scale, width: (op.kind === "sized-picture" ? op.width : picture.image.width) * scale, height: (op.kind === "sized-picture" ? op.height : picture.image.height) * scale },
          texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
      } else if (font !== undefined) {
        const bytes = op.xor === true ? new TextEncoder().encode(op.text) : null;
        for (let index = 0; index < (bytes?.length ?? op.text.length); index++) {
          const byte = bytes?.[index] ?? op.text.charCodeAt(index), alternate = op.alternate ? 128 : 0;
          const code = (op.xor === true ? byte ^ alternate : byte | alternate) & 255;
          if ((code & 127) === 32) continue;
          const column = code & 15, row = code >> 4;
          const glyph: UiDrawCommand = { kind: "image", resource: font, rect: { x: area.x + (op.x + index * 8) * scale, y: area.y + op.y * scale, width: 8 * scale, height: 8 * scale },
            texCoords: [{ x: column / 16, y: row / 16 }, { x: (column + 1) / 16, y: (row + 1) / 16 }], color: { x: 1, y: 1, z: 1, w: 1 } };
          if (op.shadow === true) out.push({ ...glyph, rect: { ...glyph.rect, x: glyph.rect.x + scale, y: glyph.rect.y + scale }, color: { x: 0, y: 0, z: 0, w: 1 } });
          out.push(glyph);
        }
      }
    }
    out.push({ kind: "clip", rect: null }); return out;
  }
}
