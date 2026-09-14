import { expect, test } from "bun:test";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import type { NavigationGraph } from "../../../src/bots/navigation/types.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";

function fixture() {
  const world = navigationWorld(createSceneQueries(decodeQ3World(q3Fixture())));
  const origin = { x: 0, y: 0, z: 0 };
  const graph: NavigationGraph = {
    map: { name: "checkpoint", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) }, profile,
    asset: null, clusters: [[1]], rejected: [],
    nodes: [{ id: 1, origin, bounds: { min: origin, max: origin }, radius: 1, contents: 0, flags: 0, presence: 0,
      sourceCluster: null, source: { kind: "constructed", surface: null, leaf: null } }],
    edges: [{ id: 2, from: 1, to: 1, start: origin, end: origin, mode: "walk", travelSeconds: 1,
      sourceTravelType: 0, sourceFlags: 0, hint: null, entity: null,
      source: { kind: "constructed", surface: null, leaf: null } }],
  };
  return { world, graph, runtime: new NavigationRuntime(graph, world) };
}

test("navigation restores overrides, admissions and pending revision invalidation exactly", () => {
  const { runtime, graph, world } = fixture();
  runtime.enableArea(1, false);
  runtime.blockEdge(2, "door");
  const saved = { ...runtime.checkpoint(), admissionSeconds: [{ id: 2, seconds: 0.25 }] };
  runtime.restoreCheckpoint(decodeCheckpointValue(encodeCheckpointValue(saved)));
  expect(runtime.checkpoint()).toEqual(saved);
  const restored = new NavigationRuntime(graph, world);
  restored.restoreCheckpoint(saved);
  expect(restored.enableArea(1, true)).toBe(false);
  expect(restored.checkpoint().generation).toBe(saved.generation + 1);
  expect(restored.checkpoint().admissionSeconds).toEqual([]);
  restored.restoreCheckpoint(saved);
  world.revision = 8;
  expect(restored.checkpoint()).toEqual(saved);
  expect(restored.generation).toBe(saved.generation + 1);
  expect(restored.checkpoint().worldRevision).toBe(8);
  expect(restored.checkpoint().blocked).toEqual(saved.blocked);
});

test("navigation rejects malformed references and durations before mutating live state", () => {
  const { runtime } = fixture();
  runtime.enableArea(1, false);
  const before = runtime.checkpoint();
  const malformed: readonly unknown[] = [
    { ...before, blocked: [{ id: 999, reason: "missing" }] },
    { ...before, enabled: [{ id: 1, enabled: true }, { id: 1, enabled: false }] },
    { ...before, admissionSeconds: [{ id: 2, seconds: -1 }] },
    { ...before, admissionSeconds: [{ id: 2, seconds: Infinity }] },
    { ...before, generation: 1.5 },
    { ...before, map: { ...before.map, digest: "wrong" } },
  ];
  for (const value of malformed) {
    expect(() => runtime.restoreCheckpoint(value)).toThrow();
    expect(runtime.checkpoint()).toEqual(before);
  }
});
