import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CompositionDomain } from "../../verification/schema/contracts.ts";
import { parseDomain } from "../../verification/schema/parse.ts";
import { compositionSize, generateComposition } from "./product.ts";

export async function writeCompositionManifest(domain: CompositionDomain, output: string, maximumCases: bigint): Promise<{ readonly cases: bigint; readonly output: string }> {
  const cases = compositionSize(domain);
  if (cases > maximumCases) throw new Error(`Declared product has ${cases} cases, exceeding explicit generation limit ${maximumCases}; no rows were omitted or emitted`);
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), ".composition-"));
  try {
    const path = join(temporary, "manifest.json");
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`{"schemaVersion":1,"id":${JSON.stringify(domain.id)},"cases":[\n`);
      let first = true;
      for (const item of generateComposition(domain)) {
        await handle.writeFile(`${first ? "" : ",\n"}${JSON.stringify(item)}`);
        first = false;
      }
      await handle.writeFile("\n]}\n");
      await handle.sync();
    } finally { await handle.close(); }
    await rename(path, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { cases, output: destination };
}

async function main(args: readonly string[]): Promise<void> {
  let domainPath: string | null = null;
  let output: string | null = null;
  let maximumCases = 100_000n;
  let countOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--count") { countOnly = true; continue; }
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}`);
    if (argument === "--domain") domainPath = value;
    else if (argument === "--output") output = value;
    else if (argument === "--max-cases" && /^\d+$/.test(value)) maximumCases = BigInt(value);
    else throw new Error(`Unknown generation argument ${argument}`);
    index += 1;
  }
  if (domainPath === null || !countOnly && output === null) throw new Error("Usage: bun tools/verify/generate.ts --domain domain.json [--count | --output manifest.json] [--max-cases N]");
  const raw: unknown = JSON.parse(await readFile(domainPath, "utf8"));
  const domain = parseDomain(raw);
  if (countOnly) process.stdout.write(`${JSON.stringify({ domain: domain.id, expectedCases: String(compositionSize(domain)), generated: false })}\n`);
  else if (output !== null) {
    const result = await writeCompositionManifest(domain, output, maximumCases);
    process.stdout.write(`${JSON.stringify({ domain: domain.id, expectedCases: String(result.cases), output: result.output, gameplayExecuted: false })}\n`);
  }
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
