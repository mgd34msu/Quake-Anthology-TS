import { expect, test } from "bun:test";
import { constructNavigation, NavigationRuntime } from "../../../src/bots/navigation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";

test("constructed map topology survives moved actors while live admission still rejects their collision", () => {
  const bytes = q3Fixture(), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const plane = data.getInt32(24, true), vertices = data.getInt32(88, true);
  data.setFloat32(plane, 0, true); data.setFloat32(plane + 8, 1, true); data.setFloat32(plane + 12, 0, true);
  for (const [index, point] of [{ x: -16, y: -16, z: 0 }, { x: 16, y: -16, z: 0 }, { x: 0, y: 16, z: 0 }].entries()) {
    data.setFloat32(vertices + index * 44, point.x, true); data.setFloat32(vertices + index * 44 + 4, point.y, true); data.setFloat32(vertices + index * 44 + 8, point.z, true);
  }
  const geometry = decodeQ3World(bytes), scene = createSceneQueries(geometry), world = navigationWorld(scene);
  const map = { name: "static-topology", format: geometry.kind, digest: createContentDigest("0".repeat(64)) };
  const graph = constructNavigation({ geometry, map, world, profile, spacing: 8, linkDistance: 24 });
  expect(graph.nodes.length).toBeGreaterThan(1);
  const first = graph.nodes[0], second = graph.nodes[1];
  if (first === undefined || second === undefined) throw new Error("Floor topology missing");
  const actor = createIdentityOwner("construction-blocker").actor(1, 1), zero = { x: 0, y: 0, z: 0 };
  const bounds = { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 64 } };
  scene.link({ actor, state: { origin: zero, angles: zero, velocity: zero, bounds, ground: null }, absoluteBounds: bounds, linkCount: 1 },
    { family: "q3", shape: { kind: "box" }, contents: 0x02000000, owner: null, role: "solid", monster: false, deadMonster: false });
  expect(constructNavigation({ geometry, map, world, profile, spacing: 8, linkDistance: 24 })).toEqual(graph);
  const runtime = new NavigationRuntime(graph, world), query = { start: first.origin, goal: second.origin, startNode: first.id, goalNode: second.id };
  expect(runtime.route(query).kind).toBe("unreachable");
  scene.unlink(actor);
  expect(runtime.route(query).kind).toBe("route");
});
