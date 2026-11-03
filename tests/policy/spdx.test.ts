// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { hasSpdx, spdxLine, withSpdx } from "../../tools/check-spdx.ts";

test("withSpdx puts the identifier first, after a shebang, and is idempotent", () => {
  expect(withSpdx("export const a = 1;\n")).toBe(`${spdxLine}\nexport const a = 1;\n`);
  expect(withSpdx("#!/usr/bin/env bun\nrun();\n")).toBe(`#!/usr/bin/env bun\n${spdxLine}\nrun();\n`);
  const once = withSpdx("x;\n");
  expect(withSpdx(once)).toBe(once);
  expect(hasSpdx(once)).toBe(true);
  expect(hasSpdx("x;\n")).toBe(false);
});
