import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, isUnknownArray } from "../../network/common/value.ts";
import { createContentDigest, type ContentDigest } from "../../contracts/content.ts";
import { containedFileParts } from "../../platform/files/contained.ts";

export const quaddictedCatalogUrl = "https://www.quaddicted.com/api/v1/?q=%2Btags%3A%22game%3Dquake%22%20%2Btags%3A%22game_mode%3Dsingleplayer%22&fl=sha256,tags,urls,bytes,install";
export interface AddonPackage {
  readonly digest: ContentDigest;
  readonly sha256: string;
  readonly title: string;
  readonly filename: string;
  readonly group: string;
  readonly bytes: number;
  readonly url: URL;
  readonly tags: readonly string[];
  readonly starts: readonly string[];
  readonly gameDirectory: string;
  readonly mappings: readonly { readonly from: string; readonly to: string | null }[];
  readonly unavailable: string | null;
}
function strings(value: unknown): readonly string[] {
  if (!isUnknownArray(value) || !value.every((item): item is string => typeof item === "string")) throw new Error("Invalid Quaddicted string list");
  return value;
}
export function addonTags(tags: readonly string[], name: string): readonly string[] { return tags.filter(tag => tag.startsWith(`${name}=`)).map(tag => tag.slice(name.length + 1)); }
function pathPrefix(value: string): string {
  const path = value.replace(/^\{base\}\/?/, "").replace(/^\//, "").replace(/\/$/, "");
  if (path !== "") containedFileParts(path);
  return path === "" ? "" : path + (value.endsWith("/") ? "/" : "");
}
/** Quaddicted API v1: installation paths are relative to a virtual Quake base. */
export function parseAddonCatalog(value: unknown): readonly AddonPackage[] {
  if (!isUnknownArray(value)) throw new Error("Invalid Quaddicted catalog");
  const result: AddonPackage[] = [];
  for (const row of value) {
    if (!isRecord(row)) throw new Error("Invalid Quaddicted package");
    const tags = strings(row["tags"]), filename = addonTags(tags, "filename")[0];
    if (!tags.includes("game=quake") || !tags.includes("game_mode=singleplayer") || filename === undefined || !filename.endsWith(".zip")) continue;
    const sha256 = row["sha256"], bytes = row["bytes"];
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`Invalid Quaddicted package identity: ${filename}`);
    const url = strings(row["urls"] ?? []).map(url => new URL(url)).find(url => url.protocol === "https:" && url.hostname === "www.quaddicted.com" && url.pathname.startsWith(`/files/by-sha256/${sha256.slice(0, 2)}/${sha256}/`) && url.username === "" && url.password === "");
    if (url === undefined) continue;
    let unavailable: string | null = null;
    const commandline = addonTags(tags, "commandline").join(" ");
    const gameDirectory = /(?:^|\s)-game\s+([a-zA-Z0-9._+-]+)(?:\s|$)/.exec(commandline)?.[1] ?? "id1";
    if (/(?:^|\s)-(?:hipnotic|rogue|quoth)(?:\s|$)/.test(commandline)) unavailable = "Requires a source gameplay option not yet supported by this installer";
    const mappings: { from: string; to: string | null }[] = [], install = row["install"];
    try {
      if (!isRecord(install)) throw new Error("No authored installation metadata");
      const mapping = install["extractmapping"];
      if (isRecord(mapping)) for (const [from, to] of Object.entries(mapping)) {
        if (to !== null && typeof to !== "string") throw new Error("Unsupported extraction mapping");
        mappings.push({ from: pathPrefix(from), to: to === null ? null : pathPrefix(to) });
      }
      else if (typeof install["extract"] === "string") mappings.push({ from: "", to: pathPrefix(install["extract"]) });
      else throw new Error("No authored extraction mapping");
    } catch (error) { unavailable = error instanceof Error ? error.message : String(error); }
    result.push({ digest: createContentDigest(sha256), sha256, title: addonTags(tags, "title")[0] ?? filename,
      filename, group: addonTags(tags, "release_group")[0] ?? filename.replace(/\.zip$/, ""), bytes, url, tags,
      starts: addonTags(tags, "startmap").filter(path => /^[a-zA-Z0-9_+./-]+$/.test(path) && !path.includes("..")), gameDirectory, mappings, unavailable });
  }
  return result;
}
export function addonInstallPath(package_: AddonPackage, member: string): string | null {
  containedFileParts(member);
  const mapping = [...package_.mappings].sort((a, b) => b.from.length - a.from.length).find(mapping => (mapping.from === "" || mapping.from.endsWith("/") ? member.startsWith(mapping.from) : member === mapping.from));
  if (mapping === undefined || mapping.to === null) return null;
  const path = mapping.to + member.slice(mapping.from.length);
  containedFileParts(path);
  const first = path.split("/")[0];
  return first !== undefined && (["maps", "progs", "gfx", "sound", "music", "env", "textures"].includes(first) || !path.includes("/")) ? `id1/${path}` : path;
}
export function resolveAddonPackages(catalog: readonly AddonPackage[], selected: AddonPackage): readonly AddonPackage[] {
  const result: AddonPackage[] = [], visiting = new Set<string>();
  const visit = (item: AddonPackage): void => {
    if (result.some(existing => existing.sha256 === item.sha256)) return;
    if (visiting.has(item.sha256)) throw new Error(`Cyclic add-on dependency: ${item.title}`);
    if (item.unavailable !== null) throw new Error(`${item.title}: ${item.unavailable}`);
    visiting.add(item.sha256);
    const dependencies = addonTags(item.tags, "dependency");
    const expressions = addonTags(item.tags, "depends");
    if (expressions.length > 0 && dependencies.length === 0) {
      for (const expression of expressions) {
        const matches = [...expression.matchAll(/'([a-zA-Z0-9_.+-]+)(>=|<=|=|>|<)([a-zA-Z0-9_.+-]+)'/g)];
        if (matches.length === 0) throw new Error(`Unsupported dependency requirement: ${expression}`);
        for (const match of matches) {
          const name = match[1], operator = match[2], version = match[3];
          if (name === undefined || version === undefined) throw new Error("Invalid dependency requirement");
          const dependency = catalog.find(candidate => addonTags(candidate.tags, "provides").some(provided => {
            const pair = /^'?([^=']+)=([^']+)'?$/.exec(provided);
            if (pair?.[1] !== name || pair[2] === undefined) return false;
            const compared = pair[2].localeCompare(version, "en", { numeric: true });
            return operator === "=" ? compared === 0 : operator === ">=" ? compared >= 0 : operator === "<=" ? compared <= 0 : operator === ">" ? compared > 0 : compared < 0;
          }));
          if (dependency === undefined) throw new Error(`Missing dependency: ${expression}`);
          visit(dependency);
        }
      }
    }
    for (const name of dependencies) {
      const dependency = catalog.find(candidate => candidate.filename === `${name}.zip` || candidate.filename === name || candidate.sha256 === name);
      if (dependency === undefined) throw new Error(`Missing dependency: ${name}`);
      visit(dependency);
    }
    visiting.delete(item.sha256); result.push(item);
  };
  visit(selected); return result;
}

export async function managedAddonHidden(root: string, directory: string): Promise<boolean> {
  if (!/^qd_[a-f0-9]{20}_[a-f0-9]{20}$/.test(directory.split("/").at(-1) ?? "")) return false;
  containedFileParts(directory);
  try { await access(join(root, ".addons", "removed", directory)); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

export async function managedAddonTitle(root: string, contentDirectory: string): Promise<string | null> {
  if (!/^qd_[a-f0-9]{20}_[a-f0-9]{20}$/.test(contentDirectory.split("/").at(-1) ?? "")) return null;
  const value: unknown = JSON.parse(await readFile(join(root, contentDirectory, ".quaddicted.json"), "utf8"));
  return isRecord(value) && typeof value["title"] === "string" ? value["title"] : null;
}
