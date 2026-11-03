import { expect, test } from "bun:test";
import manifest from "../../package.json" with { type: "json" };
import { version } from "../../src/version.ts";

test("DOCS-010 src/version.ts matches package.json, so --version cannot report a stale release", () => {
  expect(version).toBe(manifest.version);
});
