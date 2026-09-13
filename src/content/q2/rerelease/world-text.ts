import type { Vec3, Vec4 } from "../../../contracts/math.ts";
import type { WorldTextInput } from "../../../text/world.ts";

/** Q2's textured debug font uses 127 byte glyphs and eight-unit cells. */
export function q2WorldText(input: { readonly origin: Vec3; readonly angles: Vec3 | null; readonly text: string;
  readonly color: Vec4; readonly size: number; readonly depthTest: boolean }): WorldTextInput {
  let text = "";
  for (let index = 0; index < Math.min(127, input.text.length); index++) text += String.fromCharCode(input.text.charCodeAt(index) & 255);
  return { text, origin: { ...input.origin }, color: { ...input.color }, cellSize: input.size * 8,
    orientation: input.angles === null ? { kind: "billboard" } : { kind: "fixed", angles: { ...input.angles } },
    depthTest: input.depthTest, font: "classic" };
}
