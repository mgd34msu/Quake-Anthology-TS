import { isContentDigest } from "../contracts/content.ts";
import type { HeldWeaponDeclaration } from "../contracts/held-weapon.ts";
import { normalizeResourcePath } from "./mounts/paths.ts";
import { readModelGrip } from "./model-attachment.ts";
import { SaveReader } from "../persistence/value.ts";

export function readHeldWeaponDeclaration(reader: SaveReader): HeldWeaponDeclaration {
  const kind = reader.field("kind").choice("none", "model");
  if (kind === "none") return { kind };
  const model = reader.field("model"), part = model.field("part"), digest = model.field("digest");
  const readDigest = (value: SaveReader) => { const parsed = value.string(); if (!isContentDigest(parsed)) return value.fail("held model requires a SHA256 digest"); return parsed; };
  const subset = part.value === undefined ? undefined : { digests: part.field("digests").list(readDigest), vertices: part.field("vertices").list(value => value.integer(0)) };
  if (subset !== undefined && (subset.digests.length === 0 || subset.vertices.length === 0 || new Set(subset.vertices).size !== subset.vertices.length)) return part.fail("held model subset requires source digests and distinct vertices");
  return { kind, model: { path: normalizeResourcePath(model.field("path").string()), referenceFrame: model.field("referenceFrame").integer(0), grip: readModelGrip(model.field("grip")),
    ...(digest.value === undefined ? {} : { digest: readDigest(digest) }),
    ...(model.field("fallback").value === undefined ? {} : { fallback: normalizeResourcePath(model.field("fallback").string()) }),
    ...(subset === undefined ? {} : { part: subset }) } };
}

export function readHeldWeaponFile(bytes: Uint8Array): HeldWeaponDeclaration {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), reader = new SaveReader(value);
  reader.field("version").literal(1);
  return readHeldWeaponDeclaration(reader);
}
