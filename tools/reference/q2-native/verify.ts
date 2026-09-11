import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyFile } from "../environment.ts";
import type { FileIdentity } from "../schema.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function isArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyCaptures(): Promise<void> {
  const paths = [join(project, "verification/reference-cases/q2-native/latest.json"),
    join(project, "verification/reference-cases/q2-native/steam-classic.json")];
  const identities = new Map<string, FileIdentity>();
  const observed: string[] = [];
  const unsupported: string[] = [];
  async function visit(value: unknown): Promise<void> {
    if (isArray(value)) {
      for (const item of value) await visit(item);
    } else if (isRecord(value)) {
      const path = value["path"], size = value["size"], sha256 = value["sha256"];
      if (typeof path === "string" && typeof size === "number" && typeof sha256 === "string"
        && path.startsWith(join(project, ".artifacts") + "/")) {
        if (!Number.isSafeInteger(size) || size < 0 || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid identity: ${path}`);
        const prior = identities.get(path);
        if (prior !== undefined && prior.sha256 !== sha256) throw new Error(`Conflicting captured identities: ${path}`);
        identities.set(path, { path, size, sha256 });
        if (path.endsWith("provenance.json")) {
          const provenance: unknown = JSON.parse(await readFile(path, "utf8"));
          await visit(provenance);
        }
      }
      for (const entry of Object.values(value)) await visit(entry);
    }
  }
  for (const path of paths) {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value) || value["schemaVersion"] !== 1) throw new Error(`Invalid capture: ${path}`);
    const cases = value["cases"];
    if (isArray(cases)) {
      if (cases.length !== 4) throw new Error("Expected four q2repro native cases");
      for (const item of cases) {
        if (!isRecord(item) || typeof item["id"] !== "string" || item["observed"] !== true)
          throw new Error("Native case did not pass its live checks");
        observed.push(item["id"]);
      }
    } else if (value["observed"] === true) observed.push("steam-classic-dedicated");
    else unsupported.push(`steam-classic-dedicated: ${String(value["failure"])}`);
    await visit(value);
  }
  for (const expected of identities.values()) {
    const actual = await identifyFile(expected.path);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`Captured artifact changed: ${expected.path}`);
  }
  process.stdout.write(JSON.stringify({ checkedArtifactIdentities: identities.size, observed, unsupported,
    scope: "Verifies retained artifact bytes and recorded live checks; does not establish engine equivalence or rerun native processes." }) + "\n");
}

if (import.meta.main) await verifyCaptures();
