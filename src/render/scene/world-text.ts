import type { DrawBatch, RenderVertex, SceneCamera } from "../../contracts/render.ts";
import { add3, anglesToAxis, scale3 } from "../../core/math.ts";
import type { WorldText } from "../../text/world.ts";
import { glyphUv, resolveTextGlyph } from "../../text/atlas.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { createViewProjector } from "./view.ts";

/** Shared triangles retain the world's depth buffer and render after fog. */
export function prepareWorldText(texts: readonly WorldText[], camera: SceneCamera,
  fontFor: (text: WorldText) => TextFontSelection): readonly DrawBatch[] {
  const project = createViewProjector(camera), batches: DrawBatch[] = [];
  for (const text of texts) {
    const selected = fontFor(text), font: TextFontSelection = text.font === "classic"
      ? { kind: "classic", classic: selected.classic, unicode: null } : selected;
    const axis = text.orientation.kind === "billboard" ? camera.axis : anglesToAxis(text.orientation.angles);
    const right = scale3(axis[1], -text.cellSize), down = scale3(axis[2], -text.cellSize);
    for (const [row, line] of text.text.split("\n").entries()) {
      const characters = [...line];
      for (const [column, character] of characters.entries()) {
        const code = character.codePointAt(0);
        if (code === undefined) continue;
        const glyph = resolveTextGlyph(font, code);
        if (!glyph.visible) continue;
        const uv = glyphUv(glyph), vertices: RenderVertex[] = [];
        const point = (x: number, y: number) => project(add3(text.origin, add3(scale3(right, column - characters.length * 0.5 + x), scale3(down, row + y))));
        vertices.push({ position: point(0, 0), texCoord: { x: uv.s, y: uv.t }, color: text.color },
          { position: point(1, 0), texCoord: { x: uv.s2, y: uv.t }, color: text.color },
          { position: point(1, 1), texCoord: { x: uv.s2, y: uv.t2 }, color: text.color },
          { position: point(0, 1), texCoord: { x: uv.s, y: uv.t2 }, color: text.color });
        batches.push({ lighting: { kind: "vertex" }, texturing: "single", primitive: "triangles", vertices, indices: [0, 1, 2, 0, 2, 3],
          texture: { kind: "bind-image", image: glyph.atlas.picture.image }, state: {
            blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: text.depthTest ? "less-equal" : "always",
            depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } });
      }
    }
  }
  return batches;
}
