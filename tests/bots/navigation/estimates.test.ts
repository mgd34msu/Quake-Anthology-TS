import { expect, test } from "bun:test";
import { NavigationEstimates } from "../../../src/bots/navigation/estimates.ts";
import { aasEstimateAreaTime } from "../../../src/bots/navigation/estimate-aas.ts";
import type { NavigationEstimateQuery, NavigationGraph } from "../../../src/bots/navigation/types.ts";
import { aasEstimateFixture, estimateGraph } from "./estimate-fixture.ts";

const ZERO = { x: 0, y: 0, z: 0 }, FLAGS = 0x011c0fbe;
function query(startNode: number, goalNode: number, origin: NavigationEstimateQuery["origin"] = null): NavigationEstimateQuery {
  return { startNode, goalNode, origin, travelFlags: FLAGS };
}
const chain = () => estimateGraph(aasEstimateFixture(
  [{ cluster: 1 }, { cluster: -1 }, { cluster: 2 }, { cluster: -2 }, { cluster: 3 }, { cluster: 3 }],
  [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }],
  [{ area: 2, front: 1, back: 2 }, { area: 4, front: 2, back: 3 }],
));

test("AAS estimate retains donor portal, null-origin and successful-zero results", () => {
  const estimates = new NavigationEstimates(chain(), () => true);
  for (const [from, to, time] of [[1, 2, 11], [2, 3, 11], [2, 5, 35], [2, 6, 0], [1, 3, 24], [1, 5, 47]] satisfies readonly (readonly [number, number, number])[]) {
    expect(estimates.estimate(query(from, to))).toEqual({ kind: "estimate", travelTime: time, firstEdge: null });
  }
  expect(estimates.estimate(query(1, 6))).toEqual({ kind: "unreachable" });
  const whole = estimates.estimate(query(1, 5, ZERO));
  expect(whole.kind).toBe("estimate");
  if (whole.kind === "estimate") { expect(whole.travelTime).toBe(48); expect(whole.firstEdge?.id).toBe(1); }
  expect(estimates.estimate(query(1, 1))).toEqual({ kind: "estimate", travelTime: 1, firstEdge: null });
  expect(estimates.estimate(query(0, 0))).toEqual({ kind: "unreachable" });
});

test("AAS source uint16 cache time differs from final same-cluster int time", () => {
  const graph = estimateGraph(aasEstimateFixture([{}, {}], [{ from: 1, to: 2, time: 65534 }]));
  const estimates = new NavigationEstimates(graph, () => true);
  expect(estimates.estimate(query(1, 2))).toEqual({ kind: "estimate", travelTime: 65535, firstEdge: null });
  const result = estimates.estimate(query(1, 2, ZERO));
  expect(result.kind === "estimate" ? result.travelTime : 0).toBe(65536);
});

test("AAS entry-to-exit crossing cost and reverse order determine the first reach", () => {
  const graph = estimateGraph(aasEstimateFixture([{}, {}, {}, {}], [
    { from: 1, to: 2, end: { x: 300, y: 0, z: 0 } }, { from: 1, to: 3 },
    { from: 2, to: 4 }, { from: 3, to: 4 },
  ]));
  const estimates = new NavigationEstimates(graph, () => true), result = estimates.estimate(query(1, 4, ZERO));
  expect(result.kind).toBe("estimate");
  if (result.kind === "estimate") { expect(result.travelTime).toBe(23); expect(result.firstEdge?.id).toBe(2); }
  const settings = graph.asset?.kind === "aas" ? graph.asset.settings[1] : undefined;
  if (settings === undefined) throw new Error("Missing source setting");
  expect(aasEstimateAreaTime(settings, ZERO, { x: 300, y: 400, z: 0 })).toBe(165);
  expect(aasEstimateAreaTime({ ...settings, flags: 4 }, ZERO, { x: 300, y: 400, z: 0 })).toBe(500);
  expect(aasEstimateAreaTime({ ...settings, presence: 4 }, ZERO, { x: 300, y: 400, z: 0 })).toBe(650);
});

test("metadata cache reuses costs and explicit topology invalidation removes stale eligibility", () => {
  let allowed = true, checks = 0;
  const graph = chain(), estimates = new NavigationEstimates(graph, () => { checks++; return allowed; });
  expect(estimates.estimate(query(1, 5)).kind).toBe("estimate");
  const initialChecks = checks;
  for (let index = 0; index < 500; index++) expect(estimates.estimate(query(1, 5)).kind).toBe("estimate");
  expect(checks).toBe(initialChecks);
  allowed = false; estimates.invalidate();
  expect(estimates.estimate(query(1, 5))).toEqual({ kind: "unreachable" });
});

test("AAS flags preserve start-goal DONOTENTER exception without contaminating other goals", () => {
  const graph = estimateGraph(aasEstimateFixture([{}, { contents: 256 }, {}], [{ from: 1, to: 2 }, { from: 2, to: 3 }]));
  const estimates = new NavigationEstimates(graph, () => true);
  expect(estimates.estimate(query(1, 3))).toEqual({ kind: "unreachable" });
  expect(estimates.estimate(query(1, 2))).toEqual({ kind: "estimate", travelTime: 11, firstEdge: null });
  expect(estimates.estimate({ ...query(1, 3), travelFlags: FLAGS | 0x00800000 })).toEqual({ kind: "estimate", travelTime: 22, firstEdge: null });
  expect(estimates.estimate({ ...query(1, 2), travelFlags: 0 })).toEqual({ kind: "unreachable" });
});

test("generic directed graph estimates consume metadata without world or movement services", () => {
  const source = chain(), graph: NavigationGraph = { ...source, asset: null, edges: source.edges.map(edge => ({ ...edge,
    travelSeconds: edge.id === 1 ? 2 : 0.25, source: { kind: "constructed", surface: null, leaf: null } })) };
  const estimates = new NavigationEstimates(graph, edge => edge.mode === "walk");
  expect(estimates.estimate(query(1, 5))).toEqual({ kind: "estimate", travelTime: 275, firstEdge: null });
  expect(estimates.estimate(query(5, 1))).toEqual({ kind: "unreachable" });
  const result = estimates.estimate(query(1, 5, ZERO));
  if (result.kind !== "estimate") throw new Error("Missing generic estimate");
  expect(result.firstEdge?.id).toBe(1); expect(result.travelTime).toBe(275);
});


test("source equal-cost FIFO order and first-128 outgoing limit remain stable", () => {
  const tied = new NavigationEstimates(estimateGraph(aasEstimateFixture([{}, {}, {}, {}], [
    { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 },
  ])), () => true);
  const result = tied.estimate(query(1, 4, ZERO));
  expect(result.kind === "estimate" ? result.firstEdge?.id : 0).toBe(2);
  const graph = estimateGraph(aasEstimateFixture([{}, {}, {}], [
    ...Array.from({ length: 128 }, () => ({ from: 1, to: 2 })), { from: 1, to: 3 },
  ]));
  const limited = new NavigationEstimates(graph, () => true);
  expect(limited.estimate(query(1, 2)).kind).toBe("estimate");
  expect(limited.estimate(query(1, 3))).toEqual({ kind: "unreachable" });
});

test("source query validation keeps invalid areas before numeric validation", () => {
  const estimates = new NavigationEstimates(chain(), () => true);
  expect(estimates.estimate({ ...query(0, 0), travelFlags: NaN })).toEqual({ kind: "unreachable" });
  expect(() => estimates.estimate({ ...query(1, 1), travelFlags: NaN })).toThrow("32-bit mask");
  expect(() => estimates.estimate(query(1, 1, { x: Infinity, y: 0, z: 0 }))).toThrow("finite float32");
});
