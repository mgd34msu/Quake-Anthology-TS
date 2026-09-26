import { expect, test } from "bun:test";
import { ResourceNameIndex } from "../../src/core/resource-name-index.ts";

test("resource names preserve first-hole, duplicate and reserved-slot lookup order", () => {
  const index = new ResourceNameIndex(7, [2]), values = new Array<string>(7).fill("");
  const names = ["", "model/a", "model/b", "model/c", "missing"];
  const source = (name: string): number | null => {
    if (name === "") return 0;
    for (let slot = 1; slot < values.length; slot++) if (slot !== 2 && (values[slot] === name || values[slot] === "")) return slot;
    return null;
  };
  let seed = 17;
  for (let step = 0; step < 100; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const slot = 1 + seed % 6, name = names[(seed >>> 8) % 4];
    if (name === undefined) throw Error("Missing fixture name");
    values[slot] = name; index.set(slot, name);
    for (const candidate of names) expect(index.find(candidate)).toBe(source(candidate));
  }
  index.clear(); expect(index.find("model/a")).toBe(1);
  for (let slot = 1; slot < values.length; slot++) index.set(slot, "full");
  expect(index.find("full")).toBe(1); expect(index.find("missing")).toBeNull();
  index.set(1, ""); expect(index.find("full")).toBe(1);
  index.set(1, "other"); expect(index.find("full")).toBe(3);
});
