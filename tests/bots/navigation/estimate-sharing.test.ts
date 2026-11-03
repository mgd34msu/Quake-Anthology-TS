// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { NavigationEstimates } from "../../../src/bots/navigation/estimates.ts";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import type { NavigationGraph } from "../../../src/bots/navigation/types.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";

function chainGraph(): NavigationGraph {
  const origin = { x: 0, y: 0, z: 24.125 };
  return {
    map: { name: "sharing", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) },
    profile,
    asset: null,
    clusters: [[1, 2, 3]],
    rejected: [],
    nodes: [1, 2, 3].map(id => ({
      id,
      origin,
      bounds: { min: origin, max: origin },
      radius: 1,
      contents: 0,
      flags: 0,
      presence: 0,
      sourceCluster: null,
      source: { kind: "constructed", surface: null, leaf: null },
    })),
    edges: [
      { id: 0, from: 1, to: 2 },
      { id: 1, from: 2, to: 3 },
    ].map(({ id, from, to }) => ({
      id,
      from,
      to,
      start: origin,
      end: origin,
      mode: "walk",
      travelSeconds: 1,
      sourceTravelType: 0,
      sourceFlags: 0,
      hint: null,
      entity: null,
      source: { kind: "constructed", surface: null, leaf: null },
    })),
  };
}
const ask = { startNode: 1, goalNode: 3, origin: null, travelFlags: 2 };

test("estimators over one graph share tails under one scope and keep them apart under another", () => {
  const graph = chainGraph();
  let checks = 0;
  const allowed = (): boolean => {
    checks++;
    return true;
  };
  const first = new NavigationEstimates(graph, allowed, () => "same"),
    second = new NavigationEstimates({ ...graph }, allowed, () => "same");
  expect(first.estimate(ask).kind).toBe("estimate");
  const afterFirst = checks;
  expect(afterFirst).toBeGreaterThan(0);
  expect(second.estimate(ask)).toEqual(first.estimate(ask));
  expect(checks).toBe(afterFirst);
  const other = new NavigationEstimates(graph, allowed, () => "other");
  other.estimate(ask);
  expect(checks).toBeGreaterThan(afterFirst);
});

test("runtimes with identical profiles share estimates; a blocked edge affects only the runtime that blocked it", () => {
  const bytes = q3Fixture(),
    world = navigationWorld(createSceneQueries(decodeQ3World(bytes)));
  const graph = chainGraph();
  const a = new NavigationRuntime({ ...graph, profile: { ...profile } }, world),
    b = new NavigationRuntime({ ...graph, profile: { ...profile } }, world);
  expect(a.estimate(ask).kind).toBe("estimate");
  expect(b.estimate(ask).kind).toBe("estimate");
  a.blockEdge(1, "closed");
  expect(a.estimate(ask)).toEqual({ kind: "unreachable" });
  expect(b.estimate(ask).kind).toBe("estimate");
  a.blockEdge(1, null);
  expect(a.estimate(ask).kind).toBe("estimate");
  const swimless = new NavigationRuntime(
    { ...graph, profile: { ...profile, capabilities: new Set<typeof profile.capabilities extends ReadonlySet<infer M> ? M : never>(["jump"]) } },
    world,
  );
  expect(swimless.estimate(ask)).toEqual({ kind: "unreachable" });
  expect(b.estimate(ask).kind).toBe("estimate");
});
