import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildFeatureLedger, parseFeatureShard } from "../../tools/inventory/aggregate-features.ts";
import type { Feature } from "../../tools/inventory/aggregate-features.ts";
import { enumerateFunctions, sha256 } from "../../tools/inventory/source-census.ts";

const donorRevision = "1234567890123456789012345678901234567890";
const sourceText = "export function linked(): number { return 1; }\nexport function unassigned(): number { return 2; }\n";

function feature(family: string): Feature {
  return {
    id: `${family}.content.launch`,
    sourceFamilyIds: [`${family.toUpperCase()}F01`],
    unifiedFeatureIds: ["F01"],
    title: "Launch selected content",
    requirement: "Preserve the selected content identity through map launch.",
    sourceStatus: "partial",
    targetStatus: "required",
    products: [`${family}-base`],
    ownerTaskIds: ["W01"],
    acceptanceCaseIds: [`${family}.content.launch`],
    evidence: [{ repository: `${family}-ts`, path: "src/entry.ts", symbol: "linked", line: 1, endLine: 1, role: "implementation", observation: "Launch callback is present." }],
    workflows: [{ id: `${family}.launch`, trigger: "Select a campaign", steps: ["Resolve content", "Launch map"], observableOutcome: "The launched map retains its package identity." }],
    gaps: ["Cross-game identities require integration."],
  };
}

function shard(family: string, features: readonly Feature[] = [feature(family)]) {
  return { schemaVersion: 1, family, sourceRevision: donorRevision, features };
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, `${JSON.stringify(value)}\n`);
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quake-feature-ledger-"));
  for (const family of ["q1", "q2", "q3"]) {
    const path = join(root, "sources", family, "src/entry.ts");
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, sourceText);
    await writeJson(root, `verification/features/${family}.json`, shard(family));
  }
  await writeJson(root, "verification/source-manifest.json", {
    schemaVersion: 1,
    repositories: ["q1", "q2", "q3"].map((family) => ({
      id: `${family}-ts`,
      path: `sources/${family}`,
      revision: donorRevision,
      sourceSetSha256: sha256(family),
      files: [{ path: "src/entry.ts", kind: "runtime", sha256: sha256(sourceText), lineCount: 3, functions: enumerateFunctions(`${family}-ts`, "src/entry.ts", sourceText) }],
    })),
  });
  await writeJson(root, "verification/product-manifest.json", { products: ["q1", "q2", "q3"].map((family) => ({ id: `${family}-base` })) });
  await writeJson(root, "docs/work-packages.json", { tasks: [{ id: "W01" }], sourceFeatureIds: ["Q1F01", "Q2F01", "Q3F01"], featureCoverage: [{ id: "F01" }] });
  return root;
}

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("required feature ledger", () => {
  test("keeps missing and partial donors required, rejecting unsupported completion labels", () => {
    expect(parseFeatureShard(shard("q1"), "q1").features[0]?.targetStatus).toBe("required");
    const missing: Feature = { ...feature("q1"), sourceStatus: "missing", evidence: [] };
    expect(parseFeatureShard(shard("q1", [missing]), "q1").features[0]?.sourceStatus).toBe("missing");
    expect(() => parseFeatureShard({ ...shard("q1"), features: [{ ...feature("q1"), targetStatus: "accepted" }] }, "q1")).toThrow("must retain the required feature");
    expect(() => parseFeatureShard(shard("q1", [{ ...feature("q1"), gaps: [] }]), "q1")).toThrow("describe the donor gap");
  });

  test("links precise anchors while retaining unassigned runtime functions", async () => {
    await withFixture(async (root) => {
      const ledger = await buildFeatureLedger(root);
      expect(ledger.summary.features).toBe(3);
      expect(ledger.summary.unassignedRuntimeFunctions).toBe(3);
      expect(ledger.summary.acceptedTargetFeatures).toBe(0);
      expect(ledger.functionAccounting.repositories.map((repository) => repository.linkedRuntimeFunctions)).toEqual([1, 1, 1]);
      expect(ledger.features[0]?.evidence[0]?.sha256).toBe(sha256(sourceText));
      expect(await buildFeatureLedger(root)).toEqual(ledger);
    });
  });

  test("rejects source drift after capture", async () => {
    await withFixture(async (root) => {
      await Bun.write(join(root, "sources/q1/src/entry.ts"), `${sourceText}// changed\n`);
      await expect(buildFeatureLedger(root)).rejects.toThrow("evidence changed since source capture");
    });
  });

  test("rejects a stale symbol or line range rather than broadening its match", async () => {
    await withFixture(async (root) => {
      const current = feature("q1");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, evidence: current.evidence.map((evidence) => ({ ...evidence, symbol: "missing" })) }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("symbol missing does not match");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, evidence: current.evidence.map((evidence) => ({ ...evidence, endLine: 99 })) }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("evidence exceeds");
    });
  });

  test("rejects dropped family coverage and unknown owners or products", async () => {
    await withFixture(async (root) => {
      const current = feature("q1");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, sourceFamilyIds: ["Q2F01"] }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("source-family coverage refers to unknown Q1F01");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, ownerTaskIds: ["W404"] }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("unknown W404");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, products: ["missing-product"] }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("unknown missing-product");
    });
  });

  test("rejects mismatched source revisions and repository path traversal", async () => {
    await withFixture(async (root) => {
      await writeJson(root, "verification/features/q1.json", { ...shard("q1"), sourceRevision: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" });
      await expect(buildFeatureLedger(root)).rejects.toThrow("does not match its pinned donor source");
      const current = feature("q1");
      await writeJson(root, "verification/features/q1.json", shard("q1", [{ ...current, evidence: current.evidence.map((evidence) => ({ ...evidence, path: "../outside.ts" })) }]));
      await expect(buildFeatureLedger(root)).rejects.toThrow("Invalid repository-relative path");
    });
  });
});
