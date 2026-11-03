/**
 * Size budget for new code. 13,686 existing src lines exceed 160 characters, so the budget applies only to
 * lines a change adds: `bun tools/check-style.ts <base-ref>` fails when the diff against the base adds a longer line.
 */
export const maxLineLength = 160;

export interface LongLine {
  readonly file: string;
  readonly line: number;
  readonly length: number;
}

export function addedLongLines(diff: string, limit = maxLineLength): LongLine[] {
  const found: LongLine[] = [];
  let file = "", line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) { file = text.startsWith("+++ b/") ? text.slice("+++ b/".length) : ""; continue; }
    const hunk = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) { line = Number(hunk[1]); continue; }
    if (text.startsWith("+")) {
      if (file.endsWith(".ts") && text.length - 1 > limit) found.push({ file, line, length: text.length - 1 });
      line += 1;
    }
  }
  return found;
}

if (import.meta.main) {
  const base = process.argv[2];
  if (base === undefined || process.argv.length !== 3) {
    process.stderr.write("Usage: bun tools/check-style.ts <base-ref>\n");
    process.exit(2);
  }
  const child = Bun.spawn(["git", "diff", "--unified=0", "--no-color", `${base}...HEAD`, "--", "src", "tools", "tests"], { stdout: "pipe", stderr: "inherit" });
  const [code, diff] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (code !== 0) process.exit(code);
  const long = addedLongLines(diff);
  for (const item of long) process.stderr.write(`${item.file}:${item.line} line is ${item.length} characters; the limit for added lines is ${maxLineLength}.\n`);
  process.exitCode = long.length === 0 ? 0 : 1;
}
