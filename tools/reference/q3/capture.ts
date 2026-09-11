import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyFile } from "../environment.ts";
import { evaluateScenarios } from "./scenarios.ts";
import { sourcePins } from "./sources.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceRoot = resolve(projectRoot, "../qsrc/quake-iii-arena");

export async function captureQ3Reference(command: readonly string[]): Promise<{
  schemaVersion: 1;
  oracleKind: "source-derived";
  engineFamily: "q3";
  command: readonly string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sources: Awaited<ReturnType<typeof identifyFile>>[];
  runtime: { executable: Awaited<ReturnType<typeof identifyFile>>; bunVersion: string; platform: string; architecture: string };
  captureProgram: Awaited<ReturnType<typeof identifyFile>>[];
  fixtureFiles: Awaited<ReturnType<typeof identifyFile>>[];
  environment: { LC_ALL: string };
  rng: { kind: "unused" };
  clock: { kind: "synthetic-input"; schedule: string };
  network: { kind: "not-executed" };
  content: { kind: "not-required" };
  originalExecutable: { kind: "not-run"; reason: string };
  numericProfile: string;
  tolerances: readonly { metric: string; absolute: number; relative: number }[];
  status: "PASS" | "FAIL";
  assertionCount: number;
  scenarios: ReturnType<typeof evaluateScenarios>;
  limits: readonly string[];
}> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const sources = await Promise.all(sourcePins.map(async (pin) => {
    const identity = await identifyFile(join(sourceRoot, pin.path));
    if (identity.sha256 !== pin.sha256) throw new Error(`Original source hash mismatch: ${pin.path}; review the source and expectations before changing this pin`);
    return identity;
  }));
  const [runtimeExecutable, captureProgram, fixtureFiles] = await Promise.all([
    identifyFile(process.execPath),
    Promise.all([
      "tools/reference/q3/capture.ts", "tools/reference/q3/semantics.ts", "tools/reference/q3/sources.ts",
      "tools/reference/environment.ts", "tools/reference/schema.ts", "tsconfig.json", "bun.lock",
    ].map((path) => identifyFile(join(projectRoot, path)))),
    Promise.all(["tools/reference/q3/scenarios.ts"].map((path) => identifyFile(join(projectRoot, path)))),
  ]);
  const scenarios = evaluateScenarios();
  const assertions = scenarios.flatMap((scenario) => scenario.assertions);
  return {
    schemaVersion: 1, oracleKind: "source-derived", engineFamily: "q3", command, cwd: projectRoot,
    startedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - started,
    sources, runtime: { executable: runtimeExecutable, bunVersion: Bun.version, platform: process.platform, architecture: process.arch },
    captureProgram, fixtureFiles, environment: { LC_ALL: process.env["LC_ALL"] ?? "inherited-unset" },
    rng: { kind: "unused" }, clock: { kind: "synthetic-input", schedule: "Exact integer times and call sequence appear in each scenario input; the fixture file is SHA-256 identified." },
    network: { kind: "not-executed" }, content: { kind: "not-required" },
    originalExecutable: { kind: "not-run", reason: "This runner evaluates bounded transcriptions of pinned original source operations. It does not invoke a native, retail, donor, or QVM executable." },
    numericProfile: "binary32-per-float-operation; binary64-double-literal-promotion; round-to-nearest-ties-to-even; int-conversion-toward-zero; bounded-int32-inputs",
    tolerances: [{ metric: "source-derived-values-and-event-order", absolute: 0, relative: 0 }],
    status: assertions.every((assertion) => assertion.passed) ? "PASS" : "FAIL", assertionCount: assertions.length, scenarios,
    limits: [
      "PASS establishes agreement between the source-derived evaluator and separately written literal expectations, not parity of the TypeScript engine or a measured original executable.",
      "The evaluator imports no code from the Quake III TypeScript donor. Expected values come from the listed original C operations, fixed arithmetic examples, and explicit fixture assumptions.",
      "This bounded set omits complete movement/collision, active game entities, actual QVM instructions, server sockets, rendering, audio, campaigns, and performance.",
      "C compiler floating-point behavior can differ with excess precision, reassociation, or a different runtime profile. These records pin an explicit numeric profile rather than inferring all native builds behave identically.",
      "ClientConnect import results and string offset are synthetic fixture inputs. Observable calls and immediate return ordering are source-derived, not packet captures or measured retail traces.",
    ],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) throw new Error("Usage: bun tools/reference/q3/capture.ts [--check]");
  const capture = await captureQ3Reference([process.execPath, "tools/reference/q3/capture.ts", ...args]);
  if (args.length === 0) {
    const directory = join(projectRoot, "verification/reference-cases/q3");
    await mkdir(directory, { recursive: true });
    await Bun.write(join(directory, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ oracleKind: capture.oracleKind, status: capture.status, scenarios: capture.scenarios.length, assertions: capture.assertionCount })}\n`);
  if (capture.status !== "PASS") {
    for (const scenario of capture.scenarios) {
      for (const assertion of scenario.assertions) {
        if (!assertion.passed) process.stderr.write(`${scenario.id}/${assertion.id}: expected ${JSON.stringify(assertion.expected)}; actual ${JSON.stringify(assertion.actual)}\n`);
      }
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
