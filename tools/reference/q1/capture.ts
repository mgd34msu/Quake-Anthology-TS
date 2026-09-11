import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { identifyFile } from "../environment.ts";
import { hashBytes, hashJson, isObject } from "../../verify/hash.ts";
import { q1Cases } from "./cases.ts";
import { runQ1Oracle } from "./oracle.ts";
import { q1OracleLimits, q1SourcePins } from "./sources.ts";
import type { SourcePin } from "./sources.ts";

export async function verifySourcePin(sourceRoot: string, pin: SourcePin) {
  const path = resolve(sourceRoot, pin.path);
  const identity = await identifyFile(path);
  if (identity.sha256 !== pin.sha256) throw new Error(`Source hash mismatch for ${pin.id}: expected ${pin.sha256}, observed ${identity.sha256}`);
  const bytes = await readFile(path);
  if (hashBytes(bytes) !== pin.sha256) throw new Error(`Source changed during capture: ${pin.id}`);
  const lines = bytes.toString("utf8").split("\n");
  const excerpts = pin.excerpts.map(excerpt => {
    if (!Number.isInteger(excerpt.firstLine) || !Number.isInteger(excerpt.lastLine)
      || excerpt.firstLine < 1 || excerpt.lastLine < excerpt.firstLine || excerpt.lastLine > lines.length) {
      throw new Error(`Invalid source excerpt bounds: ${pin.id}`);
    }
    const code = lines.slice(excerpt.firstLine - 1, excerpt.lastLine).join("\n");
    return { ...excerpt, code, sha256: hashBytes(code) };
  });
  return { id: pin.id, relativePath: pin.path, identity, excerpts };
}

export async function captureQ1(sourceRoot: string) {
  const sources = await Promise.all(q1SourcePins.map(pin => verifySourcePin(sourceRoot, pin)));
  const sourceIds = new Set(sources.map(source => source.id));
  const caseIds = new Set<string>();
  const cases = q1Cases.map(item => {
    if (caseIds.has(item.id)) throw new Error(`Duplicate Q1 case ${item.id}`);
    caseIds.add(item.id);
    for (const id of item.sources) if (!sourceIds.has(id)) throw new Error(`Unknown source ${id} for ${item.id}`);
    const observed = runQ1Oracle(item.input);
    if (!isDeepStrictEqual(observed, item.expected)) throw new Error(`Source-derived Q1 oracle disagrees with hand-derived case ${item.id}`);
    return { ...item, observed, passed: true, inputSha256: hashJson(item.input), expectedSha256: hashJson(item.expected) };
  });
  const captureProgram = await Promise.all([
    "tools/reference/q1/capture.ts", "tools/reference/q1/oracle.ts", "tools/reference/q1/cases.ts", "tools/reference/q1/sources.ts",
    "tools/reference/environment.ts", "tools/reference/schema.ts", "tools/verify/hash.ts", "package.json", "bun.lock", "tsconfig.json",
  ].map(path => identifyFile(resolve(import.meta.dir, "../../..", path))));
  return {
    schemaVersion: 1,
    game: "q1",
    oracle: { kind: "source-derived", measuredOriginalExecution: false,
      method: "Independently transcribed original-source equations evaluated in TypeScript, compared with fixed hand-derived expected steps." },
    capturedAt: new Date().toISOString(),
    command: [process.execPath, "run", "tools/reference/q1/capture.ts", resolve(sourceRoot)],
    runtime: await identifyFile(process.execPath),
    bunVersion: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    environment: { LANG: process.env["LANG"] ?? null, LC_ALL: process.env["LC_ALL"] ?? null, TZ: process.env["TZ"] ?? null },
    arithmetic: { floatStorage: "IEEE-754 binary32 round-to-nearest ties-to-even", hostClock: "IEEE-754 binary64",
      integerConversion: "signed int32 truncation within representable range", randomSeed: null, clockSchedule: "explicit per-case inputs" },
    captureProgram,
    sources,
    cases,
    caseCount: cases.length,
    limits: q1OracleLimits,
  };
}

export function verifyCapturedCases(value: unknown): void {
  if (!isObject(value) || value["schemaVersion"] !== 1 || value["game"] !== "q1") throw new Error("Invalid Q1 capture header");
  const oracle = value["oracle"];
  if (!isObject(oracle) || oracle["kind"] !== "source-derived" || oracle["measuredOriginalExecution"] !== false) {
    throw new Error("Q1 capture must identify source-derived, unmeasured evidence");
  }
  const expectedCases = q1Cases.map(item => ({ ...item, observed: runQ1Oracle(item.input), passed: true,
    inputSha256: hashJson(item.input), expectedSha256: hashJson(item.expected) }));
  if (value["caseCount"] !== expectedCases.length || !isDeepStrictEqual(value["cases"], expectedCases)) {
    throw new Error("Stored Q1 cases differ from the pinned source-derived expectations");
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    const positional = check ? args.slice(1) : args;
    if (positional.length > 1 || positional.some(arg => arg.startsWith("--"))) {
      throw new Error("Usage: bun run tools/reference/q1/capture.ts [--check] [qsrc-root]");
    }
    const sourceRoot = resolve(positional[0] ?? resolve(import.meta.dir, "../../../../qsrc"));
    const record = await captureQ1(sourceRoot);
    const output = resolve(import.meta.dir, "../../../verification/reference-cases/q1/source-derived.json");
    if (check) {
      const stored: unknown = JSON.parse(await readFile(output, "utf8"));
      verifyCapturedCases(stored);
    } else {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify({ path: output, cases: record.caseCount, oracle: record.oracle.kind, mode: check ? "check" : "capture" })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
