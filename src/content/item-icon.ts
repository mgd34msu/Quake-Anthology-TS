import type { ContentId } from "../contracts/content.ts";
import type { SourceItemIconDeclaration } from "../contracts/source-items.ts";
import type { WeaponHudIcon } from "../contracts/ui.ts";
import type { SaveReader } from "../persistence/value.ts";
import { normalizeResourcePath } from "./mounts/paths.ts";

export function readItemIconDeclaration(reader: SaveReader): SourceItemIconDeclaration {
  const kind = reader.field("kind").choice("image", "wad-picture", "shader");
  if (kind === "shader") return { kind, name: normalizeResourcePath(reader.field("name").string()) };
  const path = normalizeResourcePath(reader.field("path").string());
  if (kind === "image") return { kind, path };
  const lump = reader.field("lump").string();
  if (lump.length === 0 || lump.length > 16 || lump.includes("\0")) return reader.fail("Item icon requires a valid WAD lump name");
  return { kind, path, lump };
}

export function resolveItemIcon(icon: SourceItemIconDeclaration, content: ContentId): WeaponHudIcon {
  if (icon.kind === "shader") return { kind: icon.kind, content, name: icon.name };
  const resource = { content, path: icon.path };
  return icon.kind === "image" ? { kind: icon.kind, resource } : { kind: icon.kind, resource, lump: icon.lump };
}

export function readSourceItemIcon(reader: SaveReader, content: ContentId): WeaponHudIcon {
  const kind = reader.field("kind").choice("image", "wad-picture", "shader");
  const resource = kind === "shader" ? reader : reader.field("resource");
  if (resource.field("content").string() !== content) return reader.fail("Item icon belongs to another content source");
  if (kind === "shader") return { kind, content, name: normalizeResourcePath(reader.field("name").string()) };
  const path = normalizeResourcePath(resource.field("path").string());
  if (kind === "image") return { kind, resource: { content, path } };
  const lump = reader.field("lump").string();
  if (lump.length === 0 || lump.length > 16 || lump.includes("\0")) return reader.fail("Item icon requires a valid WAD lump name");
  return { kind, resource: { content, path }, lump };
}
