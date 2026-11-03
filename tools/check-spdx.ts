import { Glob } from "bun";
import { join, resolve } from "node:path";

export const spdxLine = "// SPDX-License-Identifier: GPL-2.0-or-later";
const roots = ["src", "tests", "tools"];

/** Returns the source text with the SPDX identifier as its first line (after a shebang), unchanged when already present. */
export function withSpdx(text: string): string {
  if (hasSpdx(text)) return text;
  if (text.startsWith("#!")) {
    const end = text.indexOf("\n");
    return end < 0 ? `${text}\n${spdxLine}\n` : `${text.slice(0, end + 1)}${spdxLine}\n${text.slice(end + 1)}`;
  }
  return `${spdxLine}\n${text}`;
}

export function hasSpdx(text: string): boolean {
  const lines = text.split("\n", 3);
  const first = lines[0]?.startsWith("#!") === true ? lines[1] : lines[0];
  return first === spdxLine;
}

export async function missingSpdx(directory: string): Promise<string[]> {
  const missing: string[] = [];
  for (const root of roots) {
    for await (const file of new Glob(`${root}/**/*.ts`).scan({ cwd: directory })) {
      if (file.includes("node_modules/")) continue;
      if (!hasSpdx(await Bun.file(join(directory, file)).text())) missing.push(file);
    }
  }
  return missing.sort();
}

if (import.meta.main) {
  const directory = resolve(process.argv.find(argument => !argument.startsWith("-") && argument !== process.argv[0] && argument !== process.argv[1]) ?? ".");
  const missing = await missingSpdx(directory);
  if (process.argv.includes("--write")) {
    for (const file of missing) await Bun.write(join(directory, file), withSpdx(await Bun.file(join(directory, file)).text()));
    console.log(`Added the SPDX identifier to ${missing.length} files.`);
  } else if (missing.length > 0) {
    console.error(`${missing.length} files lack \`${spdxLine}\` as their first line (run bun tools/check-spdx.ts --write):`);
    for (const file of missing.slice(0, 50)) console.error(`  ${file}`);
    process.exit(1);
  } else console.log("Every source file carries the SPDX identifier.");
}
