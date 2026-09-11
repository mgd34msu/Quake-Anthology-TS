import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { q2Cases } from "../../../verification/reference-cases/q2/cases.ts";
import { identifyFile } from "../environment.ts";
import { evaluate } from "./oracle.ts";
import { loadVerifiedSources, sourceText } from "./sources.ts";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function captureQ2() {
  const sources = await loadVerifiedSources(projectRoot);
  const cases = q2Cases.map(reference => {
    for (const location of reference.sources) {
      const lineCount = sourceText(sources.text, location.source).split("\n").length;
      if (location.firstLine < 1 || location.lastLine < location.firstLine || location.lastLine > lineCount) {
        throw new Error(`Invalid original-source span: ${reference.id}/${location.source}`);
      }
    }
    const actual = evaluate(reference.input, sources.text);
    return { ...reference, oracleKind: "source-derived", rng: { draws: 0, owner: null }, actual, passed: isDeepStrictEqual(actual, reference.expected) };
  });
  const modelPaths = [
    "tools/reference/q2/capture.ts", "tools/reference/q2/oracle.ts", "tools/reference/q2/sources.ts",
    "verification/reference-cases/q2/cases.ts", "tools/reference/q2/oracle.test.ts",
    "tools/reference/environment.ts", "tools/reference/schema.ts", "verification/schema/contracts.ts", "tsconfig.json",
  ];
  const modelIdentities = await Promise.all(modelPaths.map(path => identifyFile(resolve(projectRoot, path))));
  return {
    schemaVersion: 1,
    id: "q2-initial-source-derived-contracts",
    oracleKind: "source-derived",
    capturedAt: new Date().toISOString(),
    captureCommand: ["bun", "run", "tools/reference/q2/capture.ts"],
    checkCommand: ["bun", "run", "tools/reference/q2/capture.ts", "--check"],
    cwd: projectRoot,
    runtime: { bunVersion: Bun.version, platform: process.platform, architecture: process.arch, executable: await identifyFile(process.execPath) },
    originalSources: sources.identities,
    modelIdentities,
    auditContext: await identifyFile(resolve(projectRoot, "docs/research/q2-interoperability.md")),
    numericContract: "Explicit binary32 stores/products for selected classic expressions; binary64 unsuffixed FRAMETIME evaluation; exact bounded integer RR milliseconds. Native compiler excess-precision behavior is not measured.",
    nativeEngineExecution: { status: "NOT_RUN", reason: "No original Q2 engine or DLL executable was invoked. These are independent source-derived TypeScript evaluations." },
    limits: [
      "The checks compare a bounded independent equation/control-flow transcription to reviewed literal expectations and pinned original source. They do not prove a complete TS port or original binary equivalent.",
      "Save cases project FIELD_AUTO declarations from original source. They do not run a save codec, reference relocation, file I/O lifecycle, or fresh-process restore.",
      "Pickup feedback is represented by an ordered semantic marker; individual image/sound network bytes are not captured.",
      "Frame actor mutations are authored test actions. Allocator reuse, arbitrary nested damage, physics, and mixed-family scheduling require further cases.",
      "Native command predicates establish classic upmove and rerelease button meanings only. LegacyKEX conversion magnitudes, both-buttons precedence, 4038 wire encoding, and LMCTF prediction agreement remain project adapter obligations without independent original authority here.",
      "Q64 cases cover the original configuration block and input predicates, not movement trajectories or server/client runtime agreement.",
      "Retail assets, render/audio outputs, network packets, performance, and gameplay sessions were not exercised.",
    ],
    assertionCount: cases.length,
    passed: cases.every(reference => reference.passed),
    cases,
  };
}

if (import.meta.main) {
  try {
    if (process.argv.slice(2).some(argument => argument !== "--check")) throw new Error("Usage: bun run tools/reference/q2/capture.ts [--check]");
    const capture = await captureQ2();
    if (!process.argv.includes("--check")) {
      await Bun.write(resolve(projectRoot, "verification/reference-cases/q2/capture.json"), `${JSON.stringify(capture, null, 2)}\n`);
    }
    const failed = capture.cases.filter(reference => !reference.passed).map(reference => reference.id);
    process.stdout.write(`${JSON.stringify({ id: capture.id, oracleKind: capture.oracleKind, cases: capture.assertionCount, passed: capture.passed, failed, nativeEngineExecution: capture.nativeEngineExecution })}\n`);
    process.exitCode = capture.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Q2 source reference capture failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
