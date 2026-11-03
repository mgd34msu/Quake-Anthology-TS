import { expect, test } from "bun:test";
import { mutate, runMutations, seededRandom } from "./mutation.ts";

test("mutants are reproducible from the seed and differ from the source", () => {
  const source = Uint8Array.from({ length: 64 }, (_, index) => index);
  const first = mutate(source, seededRandom(5)), second = mutate(source, seededRandom(5));
  expect([...first]).toEqual([...second]);
  expect(source[0]).toBe(0);
  let changed = 0;
  const random = seededRandom(9);
  for (let index = 0; index < 50; index++) if ([...mutate(source, random)].join() !== [...source].join()) changed++;
  expect(changed).toBeGreaterThan(40);
});

test("the harness reports untyped failures and passes typed ones", () => {
  const source = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  expect(runMutations(1, 100, source, bytes => { if (bytes.length !== source.length) throw new RangeError("typed"); }).foreign).toEqual([]);
  expect(runMutations(1, 100, source, bytes => { if (bytes.length !== source.length) throw new TypeError("internal"); }).foreign.length).toBeGreaterThan(0);
  expect(runMutations(1, 100, source, bytes => { if (bytes.length !== source.length) throw "text"; }).foreign.length).toBeGreaterThan(0);
});
