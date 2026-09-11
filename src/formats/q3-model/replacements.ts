/* Replacement conventions from Ironwail and q2repro. GPL-2.0-or-later. */
import type { Md5Model, Q1AliasModel, TimedFrames } from "../../contracts/scene.ts";

export interface Md5Paths { readonly meshPath: string; readonly animPath: string; readonly scalePath: string; }

function splitPath(path: string): { readonly directory: string; readonly filename: string; readonly stem: string } {
  const slash = path.lastIndexOf("/");
  const filename = path.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  return { directory: path.slice(0, slash + 1), filename, stem: dot < 0 ? filename : filename.slice(0, dot) };
}

export function md5PathsFor(modelPath: string, family: "q1" | "q2"): Md5Paths {
  const { directory, stem } = splitPath(modelPath);
  const prefix = `${directory}${family === "q2" ? "md5/" : ""}${stem}`;
  return { meshPath: `${prefix}.md5mesh`, animPath: `${prefix}.md5anim`, scalePath: `${prefix}.md5scale` };
}

export function md5SkinPathFor(md2SkinName: string): string {
  const { directory, filename } = splitPath(md2SkinName);
  return `${directory}md5/${filename}`;
}

/** Search ranks increase toward lower priority. Unknown ranks retain source behavior. */
export function md5ReplacementAllowed(md2Rank: number | null, meshRank: number | null): boolean {
  return md2Rank === null || meshRank === null || meshRank <= md2Rank;
}

export function md2ReplacementSkinSelection(skins: readonly string[], scaleSource: string | null): Md5Model["skinSelection"] {
  return { kind: "q2-md2-replacement", skins: skins.map(md5SkinPathFor), scaleSource };
}

/** Quake rerelease animated skin groups use the mesh shader as their basename. */
export function q1Md5SkinPath(shader: string, group: number, frame: number): string {
  if (!Number.isInteger(group) || group < 0 || !Number.isInteger(frame) || frame < 0) throw new RangeError("Invalid Q1 MD5 skin group/frame");
  return `progs/${shader}_${String(group).padStart(2, "0")}_${String(frame).padStart(2, "0")}`;
}

export type ReplacementAnimationTiming = { readonly kind: "entity-frame" }
  | { readonly kind: "elapsed-time"; readonly frameRate: number };

export function q1Md5AnimationTiming(aliasFrameCount: number, model: Md5Model): ReplacementAnimationTiming {
  return aliasFrameCount === model.frames.length ? { kind: "entity-frame" } : { kind: "elapsed-time", frameRate: model.frameRate };
}

export function q1ReplacementSkinSelection(model: Md5Model, alias: Pick<Q1AliasModel, "skins" | "frames" | "flags">): Md5Model["skinSelection"] {
  const meshSkinGroups = model.meshes.map(mesh => alias.skins.map((skin, group): TimedFrames<string> => {
    if (skin.kind === "single") return { kind: "single", frame: q1Md5SkinPath(mesh.shader, group, 0) };
    return { kind: "group", frames: skin.frames.map((frame, index) => ({ intervalSeconds: frame.intervalSeconds, frame: q1Md5SkinPath(mesh.shader, group, index) })) };
  }));
  return { kind: "q1-mdl-replacement", meshSkinGroups, flags: alias.flags, timing: q1Md5AnimationTiming(alias.frames.length, model) };
}
