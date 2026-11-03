// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

/**
 * Source modules that nothing reachable from the application entry imports. Each one is either wired into a user path or
 * deleted; the few listed in tools/unreachable-modules.json are working subsystems whose integration is still pending.
 */
export const unreachableModulesFile = "tools/unreachable-modules.json";
export const applicationEntry = "src/main.ts";

export interface PendingModule {
  readonly reason: string;
}
export type PendingModules = ReadonlyMap<string, PendingModule>;

export function loadPendingModules(root: string): PendingModules {
  const path = resolve(root, unreachableModulesFile),
    pending = new Map<string, PendingModule>();
  if (!existsSync(path)) return pending;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${unreachableModulesFile} must map project paths to a reason.`);
  for (const file of Object.keys(parsed)) {
    const reason: unknown = Reflect.get(parsed, file);
    if (typeof reason !== "string" || reason.trim().length === 0) throw new Error(`${unreachableModulesFile}: ${file} needs a nonempty reason.`);
    pending.set(file, { reason });
  }
  return pending;
}

function listSources(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) listSources(path, files);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
  return undefined;
}

const moduleUrl = /new URL\(\s*["'](\.[^"']+\.ts)["']/g;

/** Project-relative src files not reachable from the entry through static imports, re-exports, dynamic imports with literal names and `new URL("./x.ts", import.meta.url)` worker URLs. */
export function unreachableModules(root: string, entry = applicationEntry): string[] {
  const sources = listSources(resolve(root, "src")),
    start = resolve(root, entry);
  if (!existsSync(start)) return [];
  const seen = new Set<string>(),
    queue = [start];
  while (queue.length !== 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const target = resolveLocal(file, imported.fileName);
      if (target !== undefined) queue.push(target);
    }
    for (const match of text.matchAll(moduleUrl)) {
      const target = resolveLocal(file, match[1] ?? "");
      if (target !== undefined) queue.push(target);
    }
  }
  return sources
    .filter(file => !seen.has(file))
    .map(file => relative(root, file).replaceAll("\\", "/"))
    .sort();
}

export interface UnreachableDiagnostic {
  readonly file: string;
  readonly message: string;
}

/** Unlisted unreachable modules, plus list entries that are reachable again or no longer exist, so the list cannot go stale. */
export function auditUnreachable(root: string): UnreachableDiagnostic[] {
  if (!existsSync(resolve(root, applicationEntry))) return [];
  const pending = loadPendingModules(root),
    unreachable = unreachableModules(root),
    found = new Set(unreachable),
    problems: UnreachableDiagnostic[] = [];
  for (const file of unreachable) {
    if (!pending.has(file)) problems.push({ file, message: `${file} is not reachable from ${applicationEntry}; wire it into a user path or delete it.` });
  }
  for (const file of pending.keys()) {
    if (!found.has(file))
      problems.push({
        file: unreachableModulesFile,
        message: `${file} is listed as pending but is ${existsSync(resolve(root, file)) ? "reachable" : "missing"}; remove it from the list.`,
      });
  }
  return problems;
}
