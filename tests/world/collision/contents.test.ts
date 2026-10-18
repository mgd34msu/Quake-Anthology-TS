import { expect, test } from "bun:test";
import { actorContents, convertContents } from "../../../src/world/collision/contents.ts";
import type { ActorCollision } from "../../../src/world/spatial/index.ts";

const CORPSE = 0x04000000, BODY = 0x02000000;
const corpse = (family: "q1" | "q2" | "q3"): ActorCollision => ({ family, shape: { kind: "box" }, contents: CORPSE,
  owner: null, role: "solid", monster: false, deadMonster: true });

test("dead bodies never read as solid to Q1 movement, from any family", () => {
  // Q1 policy has no contents mask: -2 is solid, anything else passes.
  expect(convertContents(CORPSE, "q2", "q1")).not.toBe(-2);
  expect(convertContents(CORPSE, "q3", "q1")).not.toBe(-2);
  expect(actorContents(corpse("q2"), "q1")).toBe(-1);
  expect(actorContents(corpse("q3"), "q1")).toBe(-1);
  expect(actorContents(corpse("q1"), "q2")).toBe(CORPSE);
  expect(actorContents(corpse("q1"), "q3")).toBe(CORPSE);
});

test("live bodies and solid geometry still convert as solid to Q1", () => {
  expect(convertContents(BODY, "q2", "q1")).toBe(-2);
  expect(convertContents(BODY, "q3", "q1")).toBe(-2);
  expect(convertContents(1, "q2", "q1")).toBe(-2);
  expect(convertContents(1, "q3", "q1")).toBe(-2);
  const live = { ...corpse("q2"), contents: BODY, deadMonster: false } satisfies ActorCollision;
  expect(actorContents(live, "q1")).toBe(-2);
});
