import type { ResolvedResourceReference } from "../../contracts/content.ts";
import type { Q1AliasModel, Q2AliasModel, SpriteModel } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { parseMdl } from "./mdl.ts";
import { parseMd2 } from "./md2.ts";
import { parseSpr, parseSp2 } from "./sprite.ts";

export { parseMdl } from "./mdl.ts";
export { parseMd2, decodeMd2Commands } from "./md2.ts";
export type { Md2Command, Md2CommandVertex } from "./md2.ts";
export { parseSpr, parseSp2 } from "./sprite.ts";
export { ALIAS_NORMALS, decodeAliasNormal } from "./normals.ts";
export { sampleTimedFrame, interpolateAliasFrames, buildMdlGeometry, buildMd2Geometry, mdlSkinImage, sprFrameImage } from "./animation.ts";
export type { AliasGeometry, AliasMeshVertex } from "./animation.ts";

export type Q12Model = Q1AliasModel | Q2AliasModel | SpriteModel;
export interface Q12ModelResource { readonly source: ResolvedResourceReference; readonly model: Q12Model; }

export function parseQ12Model(data: Uint8Array, source = "<model>"): Q12Model {
  const magic = new BinaryReader(data, source).fixedByteString(4);
  switch (magic) {
    case "IDPO": return parseMdl(data, source);
    case "IDP2": return parseMd2(data, source);
    case "IDSP": return parseSpr(data, source);
    case "IDS2": return parseSp2(data, source);
    default: throw new BinaryError(source, 0, `Unknown Q1/Q2 model magic ${JSON.stringify(magic)}`);
  }
}

export function decodeQ12ModelResource(source: ResolvedResourceReference, data: Uint8Array): Q12ModelResource {
  if (source.byteLength !== data.byteLength) throw new BinaryError(source.requestedPath, 0, "Resource byte length differs from resolved content");
  return { source, model: parseQ12Model(data, source.requestedPath) };
}
