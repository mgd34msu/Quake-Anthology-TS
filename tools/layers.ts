// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

/** Upward layer imports (lower tier importing a higher tier) that predate the layer order and are tolerated until removed. */
export type LayerEdges = ReadonlyMap<string, ReadonlySet<string>>;

/** The layer order and the grandfathered upward imports. */
export interface LayerRules {
  readonly rank: ReadonlyMap<string, number>;
  readonly exceptions: LayerEdges;
}

export const layerEdgesFile = "tools/layer-edges.json";
export const layerOrderFile = "tools/layer-order.json";

/** The src/ directory a project-relative path belongs to, or undefined for files directly under src/ and for paths outside it. */
export function layerOf(projectPath: string): string | undefined {
  if (!projectPath.startsWith("src/")) return undefined;
  const rest = projectPath.slice("src/".length),
    slash = rest.indexOf("/");
  return slash < 0 ? undefined : rest.slice(0, slash);
}

function isLayerList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((name: unknown) => typeof name === "string");
}

/** Tiers from lowest to highest; a layer may import its own tier and any lower tier. Layers sharing a tier may import each other. */
export function loadLayerOrder(root: string): ReadonlyMap<string, number> {
  const path = resolve(root, layerOrderFile),
    rank = new Map<string, number>();
  if (!existsSync(path)) return rank;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${layerOrderFile} must be an array of tiers, lowest first.`);
  parsed.forEach((tier: unknown, index: number) => {
    if (!isLayerList(tier)) throw new Error(`${layerOrderFile}: tier ${index} must list layer names.`);
    for (const layer of tier) {
      if (rank.has(layer)) throw new Error(`${layerOrderFile}: ${layer} is in more than one tier.`);
      rank.set(layer, index);
    }
  });
  return rank;
}

export function loadLayerRules(root: string): LayerRules | undefined {
  const exceptions = loadLayerEdges(root);
  return exceptions === undefined ? undefined : { rank: loadLayerOrder(root), exceptions };
}

export function loadLayerEdges(root: string): LayerEdges | undefined {
  const path = resolve(root, layerEdgesFile);
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${layerEdgesFile} must be an object of layer to imported layers.`);
  const edges = new Map<string, Set<string>>();
  for (const layer of Object.keys(parsed)) {
    const imported: unknown = Reflect.get(parsed, layer);
    if (!isLayerList(imported)) throw new Error(`${layerEdgesFile}: ${layer} must list layer names.`);
    edges.set(layer, new Set(imported));
  }
  return edges;
}

export function layerEdgeAllowed(rules: LayerRules, from: string, to: string): boolean {
  if (from === to) return true;
  const fromRank = rules.rank.get(from),
    toRank = rules.rank.get(to);
  if (fromRank !== undefined && toRank !== undefined && toRank <= fromRank) return true;
  return rules.exceptions.get(from)?.has(to) === true;
}

/** Edges of the scan that go against the layer order (or involve an unranked layer): the exception list. */
export function upwardLayerEdges(rank: ReadonlyMap<string, number>, scanned: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const upward = new Map<string, Set<string>>();
  for (const [from, imported] of scanned) {
    for (const to of imported) {
      if (layerEdgeAllowed({ rank, exceptions: new Map<string, ReadonlySet<string>>() }, from, to)) continue;
      let list = upward.get(from);
      if (list === undefined) upward.set(from, (list = new Set()));
      list.add(to);
    }
  }
  return upward;
}

function listSources(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) listSources(path, files);
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** Layer edges created by static import and export-from declarations among src/ files. */
export function scanLayerEdges(root: string): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const file of listSources(resolve(root, "src"))) {
    const from = layerOf(relative(root, file).replaceAll("\\", "/"));
    if (from === undefined) continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022);
    for (const statement of source.statements) {
      const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
      if (specifier === undefined || !ts.isStringLiteralLike(specifier) || !specifier.text.startsWith(".")) continue;
      const to = layerOf(relative(root, resolve(dirname(file), specifier.text)).replaceAll("\\", "/"));
      if (to === undefined || to === from) continue;
      let imported = edges.get(from);
      if (imported === undefined) edges.set(from, (imported = new Set()));
      imported.add(to);
    }
  }
  return edges;
}

if (import.meta.main) {
  const root = resolve(process.cwd());
  if (process.argv[2] !== "--write" || process.argv.length !== 3) {
    process.stderr.write(`Usage: bun tools/layers.ts --write   (records the imports that go against ${layerOrderFile} as the exception list)\n`);
    process.exit(2);
  }
  const sorted = Object.fromEntries(
    [...upwardLayerEdges(loadLayerOrder(root), scanLayerEdges(root))]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([layer, imported]) => [layer, [...imported].sort()]),
  );
  writeFileSync(resolve(root, layerEdgesFile), `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(`Wrote ${layerEdgesFile}: ${Object.values(sorted).reduce((total, list) => total + list.length, 0)} edges.\n`);
}
