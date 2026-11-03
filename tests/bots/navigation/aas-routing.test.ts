// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { BotMoveState } from "../../../src/bots/behavior/q3/movement-state.ts";
import { TravelFlags } from "../../../src/bots/behavior/q3/navigation-types.ts";
import { TravelGraph } from "../../../src/bots/behavior/q3/travel/routing.ts";
import { parseAas } from "../../../src/bots/navigation/aas.ts";
import { writeAas } from "../../../src/bots/navigation/index.ts";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { aasEstimateFixture, estimateGraph } from "./estimate-fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";

type Capability = typeof profile.capabilities extends ReadonlySet<infer M> ? M : never;
const grantedCapabilities: readonly Capability[] = ["teleport", "jump-pad", "mover"];
const granted = { ...profile, capabilities: new Set<Capability>([...profile.capabilities, ...grantedCapabilities]) };
const world = () => navigationWorld(createSceneQueries(decodeQ3World(q3Fixture())));
const far = { x: 0, y: 0, z: 400 };

test("AAS routes use teleports, jump pads and falls of any height as the source travel flags allow", () => {
  // Areas 1 -> 2 is a 400 unit fall (type 7), 2 -> 3 a teleporter (10), 3 -> 4 a jump pad (18).
  const bytes = aasEstimateFixture(
    [{}, {}, {}, {}],
    [
      { from: 1, to: 2, type: 7, start: far, end: { x: 0, y: 0, z: 0 } },
      { from: 2, to: 3, type: 10 },
      { from: 3, to: 4, type: 18 },
    ],
  );
  const withModes = new NavigationRuntime({ ...estimateGraph(bytes), profile: granted }, world());
  const without = new NavigationRuntime(estimateGraph(bytes), world());
  const query = { startNode: 1, goalNode: 4, origin: null, travelFlags: TravelFlags.DEFAULT };
  expect(withModes.estimate(query).kind).toBe("estimate");
  expect(without.estimate(query).kind).toBe("unreachable");
  const fall = withModes.graph.edges.find(edge => edge.mode === "drop");
  if (fall === undefined) throw new Error("Missing fall reachability");
  expect(fall.start.z - fall.end.z).toBeGreaterThan(profile.maximumDrop);
  expect(withModes.edgeSelectable(fall, TravelFlags.DEFAULT)).toBe(true);
  expect(without.edgeSelectable(fall, TravelFlags.DEFAULT)).toBe(true);
});

test("a bot standing in a disabled AAS area can leave it, and equal areas cost one", () => {
  const bytes = aasEstimateFixture([{}, {}], [{ from: 1, to: 2 }]);
  const runtime = new NavigationRuntime(estimateGraph(bytes), world());
  const query = { startNode: 1, goalNode: 2, origin: null, travelFlags: TravelFlags.DEFAULT };
  runtime.enableArea(1, false);
  expect(runtime.estimate(query).kind).toBe("estimate");
  runtime.enableArea(1, true);
  runtime.enableArea(2, false);
  expect(runtime.estimate(query).kind).toBe("unreachable");
  expect(runtime.estimate({ ...query, startNode: 0, goalNode: 0 })).toEqual({ kind: "estimate", travelTime: 1, firstEdge: null });
});

test("selection takes the stored reachability without simulating the movement", () => {
  // A walk reachability whose geometry the detached movement cannot cross: the old simulation gate refused every mover and pad like this.
  const bytes = aasEstimateFixture([{}, {}], [{ from: 1, to: 2, type: 11, start: { x: 0, y: 0, z: 0 }, end: { x: 4000, y: 4000, z: 4000 } }]);
  const runtime = new NavigationRuntime({ ...estimateGraph(bytes), profile: granted }, world());
  const state = new BotMoveState();
  state.area = 1;
  state.origin = { x: 0, y: 0, z: 0 };
  const goal = { origin: { x: 0, y: 0, z: 0 }, area: 2, mins: { x: 0, y: 0, z: 0 }, maxs: { x: 0, y: 0, z: 0 }, entity: 0, number: 0, flags: 0, itemInfo: 0 };
  const edge = runtime.graph.edges[0];
  if (edge === undefined) throw new Error("Missing reachability");
  expect(runtime.admitEdge(edge, state.origin).admitted).toBe(false);
  expect(new TravelGraph(runtime).select(state, goal, TravelFlags.DEFAULT).reachability).toBe(edge.id);
});

test("a malformed AAS is rejected at the parser instead of failing later", () => {
  const base = parseAas(aasEstimateFixture([{}, {}], [{ from: 1, to: 2 }]));
  const node: (typeof base.nodes)[number] = { plane: 0, children: [0, 0] };
  // writeAas parses what it writes, so a rejected asset cannot be serialized at all.
  const reject = (change: (asset: typeof base) => typeof base, message: string): void => {
    expect(() => writeAas(change(structuredClone(base)))).toThrow(message);
  };
  expect(() => writeAas(structuredClone(base))).not.toThrow();
  // Both children of the root name node 2: a DAG that makes area queries exponential in its depth.
  reject(asset => ({ ...asset, nodes: [node, { plane: 0, children: [2, 2] }, node] }), "more than one parent");
  reject(asset => ({ ...asset, nodes: [node, { plane: 0, children: [1, 0] }] }), "more than one parent");
  reject(asset => ({ ...asset, nodes: [node] }), "BSP root");
  // Two areas sharing one reachability range would multiply edges quadratically.
  reject(
    asset => ({ ...asset, settings: asset.settings.map((setting, index) => (index === 2 ? { ...setting, firstReach: 1, reachCount: 1 } : setting)) }),
    "overlap",
  );
  reject(asset => ({ ...asset, settings: asset.settings.map((setting, index) => (index === 1 ? { ...setting, cluster: 999 } : setting)) }), "cluster");
});
