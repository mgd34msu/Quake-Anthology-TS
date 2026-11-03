import { expect, test } from "bun:test";
import { addedLongLines } from "../../tools/check-style.ts";

test("AUDIT-007 the size budget flags only added TypeScript lines over the limit", () => {
  const long = "x".repeat(161);
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts",
    "@@ -3,1 +3,3 @@", `-${long}`, "+short", `+${long}`, "+tail",
    "diff --git a/docs/b.md b/docs/b.md", "--- a/docs/b.md", "+++ b/docs/b.md", "@@ -1,0 +1,1 @@", `+${long}`,
    "diff --git a/src/c.ts b/src/c.ts", "--- a/src/c.ts", "+++ b/src/c.ts", "@@ -9 +9 @@", `+${"y".repeat(160)}`,
  ].join("\n");
  expect(addedLongLines(diff)).toEqual([{ file: "src/a.ts", line: 4, length: 161 }]);
});
