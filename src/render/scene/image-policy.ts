export type ImageUsage = "skin" | "sprite" | "wall" | "picture" | "sky";
export type ImageFormat = "png" | "jpg" | "tga" | "jpeg" | "bmp" | "gif";
export interface ImagePolicy {
  readonly overrideLevel: number;
  readonly overrideUsages: readonly ImageUsage[];
  readonly formats: readonly ImageFormat[] | undefined;
}

const formats: readonly ImageFormat[] = ["png", "jpg", "tga", "jpeg", "bmp", "gif"];
// quake-2-re-ts ref_gl/gl_local.ts ImagetypeT ABI, not q2repro's six-type enum.
const usageBits: readonly (readonly [ImageUsage, number])[] = [["skin", 1], ["sprite", 2], ["wall", 4], ["picture", 8], ["sky", 16]];

/** q2repro images.c r_texture_formats_changed: named tokens, then legacy initials. */
export function parseImageFormats(value: string): readonly ImageFormat[] {
  const result: ImageFormat[] = [];
  const add = (format: ImageFormat): void => { if (!result.includes(format)) result.push(format); };
  const state = { data: value, index: 0 };
  while (state.index < value.length) {
    const start = state.index, word = parseQ2Token(state).toLowerCase();
    if (state.index === start) break;
    const exact = formats.find(format => format === word);
    if (exact !== undefined) { add(exact); continue; }
    for (const letter of word) {
      const format = formats.find(format => format[0] === letter);
      if (format !== undefined) add(format);
    }
  }
  return Object.freeze(result);
}

export function snapshotImagePolicy(policy: ImagePolicy): ImagePolicy {
  return Object.freeze({ overrideLevel: policy.overrideLevel, overrideUsages: Object.freeze([...policy.overrideUsages]), formats: policy.formats === undefined ? undefined : Object.freeze([...policy.formats]) });
}

export function imagePolicyFromControls(controls: { readonly overrideLevel: number; readonly overrideMask: number; readonly formats: string }): ImagePolicy {
  return snapshotImagePolicy({ overrideLevel: controls.overrideLevel, overrideUsages: usageBits.filter(([, bit]) => (controls.overrideMask & bit) !== 0).map(([usage]) => usage), formats: controls.formats.trim().toLowerCase() === "source" ? undefined : parseImageFormats(controls.formats) });
}

export const DEFAULT_IMAGE_POLICY: ImagePolicy = imagePolicyFromControls({ overrideLevel: 1, overrideMask: -1, formats: "png jpg tga jpeg bmp gif" });
import { parseQ2Token } from "../../core/common-parse.ts";
