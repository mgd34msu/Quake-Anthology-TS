// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { filterEntityText } from "../../src/app/bootstrap/simulation/guest-monsters.ts";

// GAPSIM-016: Quake's entity parser has no backslash escape, so a value ending in one still closes.
test("entity spans close a quoted value that ends in a backslash", () => {
  const text = '{\n"classname" "worldspawn"\n"message" "C:\\maps\\"\n}\n{\n"classname" "item_health"\n}\n{\n"classname" "monster_army"\n}\n';
  const kept = filterEntityText(text, new Set([2]));
  expect(kept).toContain('"message" "C:\\maps\\"');
  expect(kept).toContain("monster_army");
  expect(kept).not.toContain("item_health");
});
