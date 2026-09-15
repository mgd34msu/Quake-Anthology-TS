import { aasEstimateFixture, estimateGraph } from "./estimate-fixture.ts";
import { Q3_SOURCE_POSTURES } from "../../../src/movement/q3/index.ts";
import { SourceBotNavigation } from "../../../src/bots/behavior/q3/navigation.ts";
import { BotActionBuffer } from "../../../src/bots/behavior/library/actions.ts";
import { BotMoveStateStore } from "../../../src/bots/behavior/q3/movement-state.ts";
import { RouteStopEvent } from "../../../src/bots/behavior/q3/navigation-types.ts";
import { expect, test } from "bun:test";
import { TravelGraph } from "../../../src/bots/behavior/q3/travel/routing.ts";
import { BotMoveState } from "../../../src/bots/behavior/q3/movement-state.ts";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import type { NavigationGraph, NavigationWorld } from "../../../src/bots/navigation/types.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";
function fixture(rejectFirst = false) {
  const bytes = q3Fixture(), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), plane = data.getInt32(24, true);
  data.setFloat32(plane, 0, true); data.setFloat32(plane + 8, 1, true); data.setFloat32(plane + 12, 0, true);
  const sourceWorld = navigationWorld(createSceneQueries(decodeQ3World(bytes)));
  let checks = 0, dangerous = false, predictions = 0, revision = 0;
  const world: NavigationWorld = { ...sourceWorld, get revision() { return revision; }, beginRoute: selected => { predictions++; return sourceWorld.beginRoute(selected); }, hazard: bounds => { checks++; return dangerous || sourceWorld.hazard(bounds); } };
  const origin = { x: 0, y: 0, z: 24.125 };
  const graph: NavigationGraph = {
    map: { name: "admission", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) }, profile,
    asset: null, clusters: [[1, 2, 3]], rejected: [],
    nodes: [1, 2, 3].map(id => ({ id, origin, bounds: { min: origin, max: origin }, radius: 1, contents: 0, flags: 0, presence: 0,
      sourceCluster: null, source: { kind: "constructed", surface: null, leaf: null } })),
    edges: Array.from({ length: 12 }, (_, id) => ({ id, from: id === 11 ? 2 : 1, to: id === 11 ? 3 : 2, start: origin, end: rejectFirst && id === 0 ? { ...origin, z: -100 } : origin, mode: "walk",
      travelSeconds: 1, sourceTravelType: 0, sourceFlags: 0, hint: null, entity: null,
      source: { kind: "constructed", surface: null, leaf: null } })),
  };
  return { graph, world, runtime: new NavigationRuntime(graph, world), origin, predictions: () => predictions, advance: () => { revision++; }, checks: () => checks, danger: () => { dangerous = true; } };
}

test("bulk estimates never run movement or live occupancy checks; topology changes invalidate", () => {
 const f=fixture(),query={startNode:1,goalNode:3,origin:f.origin,travelFlags:2};
 const first=f.runtime.estimate(query); expect(first.kind).toBe("estimate");
 for(let i=0;i<100;i++)expect(f.runtime.estimate(query)).toEqual(first);
 expect(f.predictions()).toBe(0); expect(f.checks()).toBe(0);
 f.advance(); expect(f.runtime.generation).toBe(1); expect(f.runtime.estimate(query)).toEqual(first);
 f.runtime.enableArea(2,false); expect(f.runtime.estimate(query).kind).toBe("unreachable");
 f.runtime.enableArea(2,true); expect(f.runtime.estimate(query)).toEqual(first);
 expect(f.runtime.estimate({...query,travelFlags:0}).kind).toBe("unreachable");
 expect(f.runtime.estimate({...query,startNode:3,origin:null})).toEqual({kind:"estimate",travelTime:1,firstEdge:null});
});
test("selected outgoing traversal rejects actual movement failure and retries ranked reachabilities", () => {
 const f=fixture(true),state=new BotMoveState();state.area=2;state.origin=f.origin;
 const graph=new TravelGraph(f.runtime),goal={origin:f.origin,area:4,mins:f.origin,maxs:f.origin,entity:0,number:0,flags:0,itemInfo:0};
 expect(graph.select(state,goal,2).reachability).toBe(2);
 expect(f.predictions()).toBeGreaterThan(0);
 f.danger();
 expect(f.runtime.estimate({startNode:1,goalNode:3,origin:f.origin,travelFlags:2}).kind).toBe("estimate");
 expect(graph.select(state,goal,2).reachability).toBe(0);
});

function sourceNavigation(runtime: NavigationRuntime) {
  const unavailable = (): never => { throw new Error("Route estimates must not invoke actor services"); };
  return new SourceBotNavigation({ runtime, forClient: () => runtime,
    moveStates: new BotMoveStateStore({ time: () => 0, print: unavailable, libVar: unavailable }),
    actions: new BotActionBuffer(null, { clientCommand: unavailable }), random: { nextInt: unavailable },
    crouchedBounds: Q3_SOURCE_POSTURES.crouched.bounds, time: () => 0, pointContents: unavailable, entityModelIndex: unavailable,
    trace: unavailable, predictClientMovement: unavailable, modelInfo: unavailable, nextEntity: unavailable,
    entityType: unavailable, entityWeapon: unavailable, travelWeapon: unavailable });
}

test("source route prediction follows donor limits, stop ordering, and approach costs", () => {
  const f = fixture(), navigation = sourceNavigation(f.runtime);
  const query = { area: 2, origin: f.origin, goalArea: 4, travelFlags: 2, maximumAreas: 0, maximumTime: 0,
    stopEvent: 0, stopContents: 0, stopTravelFlags: 0, stopArea: 0 };
  const completed = navigation.predictRoute(query);
  expect(completed).toEqual({ succeeded: true, stopEvent: 0, endArea: 4, endPosition: f.origin, endTravelFlags: 2, time: 202, endContents: 0 });
  expect(navigation.predictRoute({ ...query, maximumAreas: 1 })).toEqual({ ...completed, succeeded: false, endArea: 3, time: 101 });
  expect(navigation.predictRoute({ ...query, maximumTime: 101 })).toEqual(completed);
  expect(navigation.predictRoute({ ...query, maximumTime: 100 })).toEqual({ ...completed, succeeded: false, endArea: 3, time: 101 });
  expect(navigation.predictRoute({ ...query, stopEvent: RouteStopEvent.ENTER_AREA, stopArea: 3 })).toEqual({ ...completed,
    stopEvent: RouteStopEvent.ENTER_AREA, endArea: 3, endTravelFlags: 0, time: 0 });
  expect(navigation.predictRoute({ ...query, stopEvent: RouteStopEvent.USE_TRAVEL_TYPE, stopTravelFlags: 2 })).toEqual({ ...completed,
    stopEvent: RouteStopEvent.USE_TRAVEL_TYPE, endArea: 2, time: 0 });
  expect(navigation.predictRoute({ ...query, stopEvent: RouteStopEvent.USE_TRAVEL_TYPE, stopTravelFlags: 0x80000 })).toEqual({ ...completed,
    stopEvent: RouteStopEvent.USE_TRAVEL_TYPE, endArea: 3, endTravelFlags: 0x80000, time: 101 });
  expect(navigation.predictRoute({ ...query, origin: { ...f.origin, x: 10 } })).toEqual({ ...completed, time: 226 });
  expect(navigation.predictRoute({ ...query, area: 4 })).toEqual({ ...completed, time: 0, endTravelFlags: 0 });
  f.runtime.enableArea(2, false);
  expect(navigation.predictRoute(query)).toEqual({ ...completed, succeeded: false, stopEvent: RouteStopEvent.NO_ROUTE, time: 0, endTravelFlags: 0 });
  expect(f.predictions()).toBe(0);
});

test("AAS successful-zero portal tail returns the donor partial NO_ROUTE result", () => {
  const f = fixture(), zero = { x: 0, y: 0, z: 0 };
  const graph = estimateGraph(aasEstimateFixture(
    [{ cluster: 1 }, { cluster: -1 }, { cluster: 2 }, { cluster: -2 }, { cluster: 3 }, { cluster: 3 }],
    [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }],
    [{ area: 2, front: 1, back: 2 }, { area: 4, front: 2, back: 3 }],
  ));
  const runtime = new NavigationRuntime(graph, f.world), navigation = sourceNavigation(runtime);
  const query = { area: 2, origin: zero, goalArea: 6, travelFlags: 0x011c0fbe, maximumAreas: 0, maximumTime: 0,
    stopEvent: 0, stopContents: 0, stopTravelFlags: 0, stopArea: 0 };
  expect(navigation.route(query)).toEqual({ kind: "found", travelTime: 0, nextReachability: 2 });
  expect(navigation.predictRoute(query)).toEqual({ succeeded: false, stopEvent: RouteStopEvent.NO_ROUTE,
    endArea: 3, endPosition: zero, endTravelFlags: 2, time: 11, endContents: 0 });
  expect(f.predictions()).toBe(0);
});
