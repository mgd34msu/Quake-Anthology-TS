import { expect, test } from "bun:test";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import type { NavigationEdge, NavigationEntityState, NavigationGraph, NavigationProfile, NavigationWorld } from "../../../src/bots/navigation/types.ts";
import { navigationTrainRide } from "../../../src/bots/navigation/train.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";
function fixture(rejectFirst = false) {
  const bytes = q3Fixture(), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), plane = data.getInt32(24, true);
  data.setFloat32(plane, 0, true); data.setFloat32(plane + 8, 1, true); data.setFloat32(plane + 12, 0, true);
  const sourceWorld = navigationWorld(createSceneQueries(decodeQ3World(bytes)));
  let checks = 0, dangerous = false;
  const world: NavigationWorld = { ...sourceWorld, hazard: bounds => { checks++; return dangerous || sourceWorld.hazard(bounds); } };
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
  return { graph, world, runtime: new NavigationRuntime(graph, world), origin, checks: () => checks, danger: () => { dangerous = true; } };
}
test("train route follows source stops while boarding and exit use selected movement and live ground ownership", () => {
  const f = fixture(), actor = createIdentityOwner("train-test").actor(3, 1);
  const selected: NavigationProfile = { ...profile, capabilities: new Set([...profile.capabilities, "mover"]) };
  const start = f.origin, end = { ...start, x: 256 }, staging = { ...start, x: -48 };
  let x = 128, running = true, blocked = false, admissions = 0;
  const state = (): NavigationEntityState => ({ actor, enabled: true, locked: blocked,
    bounds: { min: { x: x - 32, y: -32, z: -16 }, max: { x: x + 32, y: 32, z: 0 } }, velocity: { x: 100, y: 0, z: 0 }, destination: { x: 256, y: 0, z: 0 },
    train: { origin: { x, y: 0, z: 0 }, running, stops: [
      { id: 1, origin: { x: 0, y: 0, z: 0 }, next: 2, wait: 1, teleport: false },
      { id: 2, origin: { x: 256, y: 0, z: 0 }, next: 1, wait: 1, teleport: false },
    ] } });
  const edge: NavigationEdge = { id: 0, from: 1, to: 2, start, end, mode: "mover", travelSeconds: 3, sourceTravelType: 7, sourceFlags: 3,
    hint: { funnel: staging, start, end, ladderPlane: null }, entity: { model: 1, bounds: state().bounds, raw: [] }, source: { kind: "nav3", node: 1, link: 0 } };
  const world: NavigationWorld = { ...f.world, entity: state, admit: (request, profile) => { admissions++; return f.world.admit(request, profile); } };
  const runtime = new NavigationRuntime({ ...f.graph, profile: selected, edges: [edge],
    nodes: f.graph.nodes.map(node => ({ ...node, origin: node.id === 2 ? end : start })) }, world);
  expect(navigationTrainRide(state(), edge, selected)?.boarding.id).toBe(1);
  expect(navigationTrainRide(state(), edge, profile)).toBeNull();
  const planned = runtime.route({ start: staging, goal: end, startNode: 1, goalNode: 2 });
  expect(planned.kind).toBe("route");
  if (planned.kind !== "route") throw new Error(planned.reason);
  expect(planned.route.edges).toEqual([edge]);
  expect(runtime.trainStep(edge, staging, null)).toEqual({ kind: "wait" }); expect(admissions).toBe(0);
  expect(runtime.trainStep(edge, { ...start, x: 128 }, actor)).toEqual({ kind: "ride" });
  x = 0;
  expect(runtime.trainStep(edge, staging, null)).toEqual({ kind: "move", stage: "approach", target: start }); expect(admissions).toBe(1);
  x = 256; running = false;
  expect(runtime.trainStep(edge, end, actor)).toEqual({ kind: "move", stage: "exit", target: end }); expect(admissions).toBe(2);
  expect(runtime.trainStep(edge, staging, null)).toEqual({ kind: "unavailable" });
  expect(runtime.route({ start: staging, goal: end, startNode: 1, goalNode: 2 }).kind).toBe("unreachable");
  blocked = true;
  expect(runtime.trainStep(edge, end, actor)).toEqual({ kind: "unavailable" });
  blocked = false; f.danger();
  expect(runtime.trainStep(edge, end, actor)).toEqual({ kind: "unavailable" }); expect(admissions).toBe(2);
});
test("route shares node collision admission across incoming edges only within its query", () => {
  const f = fixture(), query = { start: f.origin, goal: f.origin, startNode: 1, goalNode: 3 };
  const first = f.runtime.route(query);
  expect(first.kind).toBe("route"); expect(f.checks()).toBe(3);
  const checkpoint = f.runtime.checkpoint();
  expect(f.runtime.route(query)).toEqual(first); expect(f.checks()).toBe(6);
  expect(f.runtime.checkpoint()).toEqual(checkpoint);
  f.danger(); expect(f.runtime.route(query).kind).toBe("unreachable");
});
test("new query rechecks disabled areas and edge filters", () => {
  const f = fixture(), query = { start: f.origin, goal: f.origin, startNode: 1, goalNode: 3 };
  expect(f.runtime.route(query).kind).toBe("route");
  expect(f.runtime.route({ ...query, disabledAreas: new Set([2]) }).kind).toBe("unreachable");
  expect(f.runtime.route({ ...query, edgeFilter: edge => edge.id !== 11 }).kind).toBe("unreachable");
  expect(f.runtime.route(query).kind).toBe("route");
});

test("rejected traversal retries retain node eligibility and publish only admitted edges", () => {
 const f=fixture(true),result=f.runtime.route({start:f.origin,goal:f.origin,startNode:1,goalNode:3});
 expect(result.kind).toBe("route");
 if(result.kind!=="route")throw Error(result.reason);
 expect(result.route.edges.map(edge=>edge.id)).toEqual([1,11]);
 expect(f.checks()).toBe(3);
 expect(f.runtime.checkpoint().admissionSeconds.some(edge=>edge.id===0)).toBe(false);
});

for (const source of ["nav2", "nav3"] satisfies readonly ("nav2" | "nav3")[]) test(`${source} elevator waiting eligibility is distinct from grounded eligibility and refreshed next query`, () => {
 const f=fixture(), top={x:0,y:0,z:224.125}, bottom=f.origin;
 let phase: "top" | "bottom" = "top";
 const actor=createIdentityOwner("elevator-test").actor(1,1);
 const binding={model:1,bounds:{min:bottom,max:top},raw:[]};
 const graph: NavigationGraph={...f.graph, profile:{...profile,capabilities:new Set([...profile.capabilities,"mover"])},
  nodes:f.graph.nodes.map(node=>({...node,origin:node.id===1?bottom:top,flags:node.id===2?64:0,source:{kind:source,node:node.id,link:null}})),
  edges:[
   {id:0,from:1,to:2,start:bottom,end:top,mode:"walk",travelSeconds:1,sourceTravelType:0,sourceFlags:3,hint:null,entity:null,source:{kind:source,node:1,link:0}},
   {id:1,from:2,to:3,start:bottom,end:top,mode:"mover",travelSeconds:1,sourceTravelType:6,sourceFlags:3,hint:null,entity:binding,source:{kind:source,node:2,link:1}},
  ]};
 const world:NavigationWorld={...f.world,entity:()=>({actor,enabled:true,locked:false,bounds:binding.bounds,velocity:{x:0,y:0,z:0},destination:null,elevator:{origin:phase==="top"?top:bottom,bottom,top,phase}})};
 const runtime=new NavigationRuntime(graph,world),query={start:bottom,goal:top,startNode:1,goalNode:3};
 expect(runtime.route(query).kind).toBe("route");
 phase="bottom";
 expect(runtime.route(query).kind).toBe("unreachable");
 phase="top";
 expect(runtime.route(query).kind).toBe("route");
});
