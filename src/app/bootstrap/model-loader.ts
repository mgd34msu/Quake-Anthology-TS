/* Q1 replacement selection follows quake-1-re-ts ref_gl/gl_md5.ts and
 * ref_soft/r_md5.ts. GPL-2.0-or-later. */
import type { GameFamily, ResolvedResourceReference } from "../../contracts/content.ts";
import type { DecodedModel, Md5Model, Q1AliasModel, Q2AliasModel } from "../../contracts/scene.ts";
import type { MountedContent, OpenedResource } from "../../content/mounts/index.ts";
import { BinaryError } from "../../core/binary/index.ts";
import { decodeQpic } from "../../formats/images/index.ts";
import { parseQ12Model } from "../../formats/q12-model/index.ts";
import { parseMd3 } from "../../formats/q3-model/md3.ts";
import { createMd5Model, parseMd5Anim, parseMd5Mesh } from "../../formats/q3-model/md5.ts";
import { md5PathsFor, md5ReplacementAllowed, q1ReplacementSkinSelection, md2ReplacementSkinSelection } from "../../formats/q3-model/replacements.ts";
import { toSceneMd3 } from "../../formats/q3-model/scene.ts";
import { ModelTextError } from "../../formats/q3-model/text.ts";
import type { SceneTextureLoader } from "../../render/scene/textures.ts";

export interface ApplicationModelProvider {
  readonly family: GameFamily;
  readonly mounts: Pick<MountedContent, "open">;
  readonly textures: Pick<SceneTextureLoader, "load">;
}

export interface LoadedApplicationModel {
  readonly resource: ResolvedResourceReference;
  readonly model: DecodedModel;
}

function rank(resource: ResolvedResourceReference): number | null {
  return resource.resolution.kind === "link" ? null : resource.resolution.rank;
}

async function q1Replacement(provider: ApplicationModelProvider, asset: OpenedResource,
  alias: Q1AliasModel): Promise<LoadedApplicationModel | null> {
  const paths = md5PathsFor(asset.reference.requestedPath, "q1");
  const mesh = await provider.mounts.open(paths.meshPath);
  if (mesh === null || !md5ReplacementAllowed(rank(asset.reference), rank(mesh.reference))) return null;
  const animation = await provider.mounts.open(paths.animPath);
  if (animation === null) return null;
  let model: Md5Model;
  try {
    const decoder = new TextDecoder();
    const decoded = createMd5Model(parseMd5Mesh(decoder.decode(mesh.bytes), paths.meshPath),
      parseMd5Anim(decoder.decode(animation.bytes), paths.animPath));
    model = { ...decoded, skinSelection: q1ReplacementSkinSelection(decoded, alias) };
  } catch (error) {
    // Broken retail pairs, including mg3's ogre_rocket, keep their MDL.
    if (error instanceof ModelTextError || error instanceof RangeError) return null;
    throw error;
  }
  if (model.skinSelection.kind !== "q1-mdl-replacement") throw new Error("Q1 replacement lost its alias skin selection");
  const skins = new Set(model.skinSelection.meshSkinGroups.flatMap(groups => groups.flatMap(group =>
    group.kind === "single" ? [group.frame] : group.frames.map(frame => frame.frame))));
  for (const name of skins) {
    // Both donor renderers require the indexed sidecar before attaching a pair.
    const skin = await provider.mounts.open(`${name}.lmp`);
    if (skin === null) return null;
    try { decodeQpic(skin.bytes, `${name}.lmp`); }
    catch (error) { if (error instanceof BinaryError) return null; throw error; }
    await provider.textures.load(name, { family: "q1" });
  }
  return { resource: mesh.reference, model };
}

async function q2Replacement(provider: ApplicationModelProvider, asset: OpenedResource,
  alias: Q2AliasModel): Promise<LoadedApplicationModel | null> {
  const paths = md5PathsFor(asset.reference.requestedPath, "q2");
  const mesh = await provider.mounts.open(paths.meshPath);
  if (mesh === null || !md5ReplacementAllowed(rank(asset.reference), rank(mesh.reference))) return null;
  const animation = await provider.mounts.open(paths.animPath);
  if (animation === null) return null;
  const scale = await provider.mounts.open(paths.scalePath), decoder = new TextDecoder();
  try {
    const parsed = parseMd5Anim(decoder.decode(animation.bytes), paths.animPath,
      scale === null ? null : { source: paths.scalePath, text: decoder.decode(scale.bytes) });
    const diagnostics = [...parsed.diagnostics];
    if (parsed.frames.length < alias.frames.length) diagnostics.push(`${paths.animPath} has fewer frames than ${asset.reference.requestedPath} (${parsed.frames.length} < ${alias.frames.length})`);
    const model = createMd5Model(parseMd5Mesh(decoder.decode(mesh.bytes), paths.meshPath), parsed,
      md2ReplacementSkinSelection(alias, scale === null ? null : paths.scalePath, diagnostics));
    return { resource: mesh.reference, model };
  } catch (error) {
    if (error instanceof ModelTextError || error instanceof RangeError) return null;
    throw error;
  }
}

/** Decode the requested alias first: its source flags, skins and frames remain authoritative. */
export async function loadApplicationModel(provider: ApplicationModelProvider, asset: OpenedResource,
  options: { readonly enhancedModels?: boolean } = {}): Promise<LoadedApplicationModel> {
  const path = asset.reference.requestedPath;
  const model = path.toLowerCase().endsWith(".md3") ? toSceneMd3(parseMd3(asset.bytes, path)) : parseQ12Model(asset.bytes, path);
  if (provider.family === "q1" && model.kind === "q1-mdl" && options.enhancedModels !== false) {
    const replacement = await q1Replacement(provider, asset, model);
    if (replacement !== null) return replacement;
  }
  if (provider.family === "q2" && model.kind === "q2-md2" && options.enhancedModels !== false) {
    const replacement = await q2Replacement(provider, asset, model);
    if (replacement !== null) return replacement;
  }
  return { resource: asset.reference, model };
}
