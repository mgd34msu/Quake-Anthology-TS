import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./source-census.ts";

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function array(value: unknown): value is unknown[] { return Array.isArray(value); }
function string(value: unknown): string { if (typeof value !== "string") throw new Error("Expected string"); return value; }
async function json(path: string): Promise<unknown> { const value: unknown = JSON.parse(await Bun.file(path).text()); return value; }

async function main(): Promise<void> {
  let input = "/tmp";
  let output = "/tmp/quake-integration-combined";
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    if (key === "--input") input = resolve(value);
    else if (key === "--out") output = resolve(value);
    else throw new Error(`Unknown option ${key}`);
  }
  const features = new Map<string, { id: string; declarationIds: Set<string>; inventories: Set<string>; feature: unknown }>();
  const runs: { game: string; summary: unknown; artifacts: { path: string; sha256: string }[] }[] = [];
  let revision: string | null = null;
  for (const game of ["q1", "q2", "q3"]) {
    const directory = resolve(input, `quake-integration-${game}`);
    const summary = await json(resolve(directory, "summary.json"));
    if (!object(summary)) throw new Error("Invalid summary");
    const currentRevision = string(summary["unifiedRevision"]);
    if (revision !== null && revision !== currentRevision) throw new Error("Unified snapshots differ");
    revision = currentRevision;
    const joined = await json(resolve(directory, "feature-join.json"));
    if (!object(joined) || !array(joined["inventories"])) throw new Error("Invalid feature join");
    const seen = new Set<string>();
    for (const inventory of joined["inventories"]) {
      if (!object(inventory) || !array(inventory["joins"]) || !object(inventory["inventory"]) || !array(inventory["inventory"]["features"])) throw new Error("Invalid inventory");
      const rawFeatures = new Map<string, unknown>();
      for (const feature of inventory["inventory"]["features"]) {
        if (!object(feature)) throw new Error("Invalid feature");
        rawFeatures.set(string(feature["id"]), feature);
      }
      for (const join of inventory["joins"]) {
        if (!object(join) || !array(join["declarationIds"])) throw new Error("Invalid join");
        const id = string(join["id"]);
        if (seen.has(id)) throw new Error(`Duplicate feature ${id} in ${game}`);
        seen.add(id);
        const raw = rawFeatures.get(id);
        if (raw === undefined) throw new Error(`Missing raw feature ${id}`);
        const feature = features.get(id) ?? { id, declarationIds: new Set<string>(), inventories: new Set<string>(), feature: raw };
        if (JSON.stringify(feature.feature) !== JSON.stringify(raw)) throw new Error(`Feature bytes disagree: ${id}`);
        for (const declarationId of join["declarationIds"]) feature.declarationIds.add(string(declarationId));
        feature.inventories.add(string(inventory["path"]));
        features.set(id, feature);
      }
    }
    if (seen.size !== 477) throw new Error(`${game} did not retain all 477 existing feature IDs`);
    const artifacts: { path: string; sha256: string }[] = [];
    for (const name of ["inventory.json", "candidates.json", "summary.json", "feature-join.json", "anchor-inventory.json", "historical-completion.json"]) {
      const path = resolve(directory, name);
      artifacts.push({ path, sha256: sha256(new Uint8Array(await Bun.file(path).arrayBuffer())) });
    }
    runs.push({ game, summary, artifacts });
  }
  if (revision === null) throw new Error("No snapshots");
  const root = resolve(import.meta.dir, "../..");
  const comparisonDocs = ["q1", "q2", "q3"].map(game => {
    const path = `docs/comparison-${game}.md`;
    const result = Bun.spawnSync(["git", "-C", root, "show", `${revision}:${path}`], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`Missing pinned comparison ${path}`);
    return { path, revision, sha256: sha256(result.stdout) };
  });
  await mkdir(output, { recursive: true });
  const result = { schemaVersion: 1, unifiedRevision: revision,
    limits: ["Candidate groups remain complete in the referenced hashed artifacts.", "Historical verdicts remain separate in historical-completion.json; no completion totals are changed.", "Declaration joins are lexical source-line overlaps, not behavior verdicts.", "Comparison documents are pinned source context, not newly verified claims."],
    comparisonDocs, runs, features: [...features.values()].map(feature => ({ ...feature, declarationIds: [...feature.declarationIds], inventories: [...feature.inventories] })) };
  await Bun.write(resolve(output, "combined.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Merged ${runs.length} runs and ${features.size} feature IDs into ${output}/combined.json\n`);
}
if (import.meta.main) await main();
