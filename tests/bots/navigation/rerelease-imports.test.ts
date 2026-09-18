import { expect, test } from "bun:test";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { guestPointer } from "../../../src/compat/q2/rerelease/module.ts";
import { RereleaseNavigationImports } from "../../../src/compat/q2/rerelease/navigation.ts";
import { rereleasePathToGoal, type RereleasePathRequest } from "../../../src/bots/navigation/rerelease-path.ts";
import { NavigationRuntime } from "../../../src/bots/navigation/runtime.ts";
import type { NavigationGraph } from "../../../src/bots/navigation/types.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { navigationWorld, profile } from "./prediction.ts";
function fixture() {
  const bytes = q3Fixture(), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), plane = data.getInt32(24, true);
  data.setFloat32(plane, 0, true); data.setFloat32(plane + 8, 1, true); data.setFloat32(plane + 12, 0, true);
  const scene = createSceneQueries(decodeQ3World(bytes)), world = navigationWorld(scene);
  const points = [0, 100, 200].map(x => ({ x, y: 0, z: 24.125 }));
  const graph: NavigationGraph = { map: { name: "native-advisory", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) }, profile,
    asset: null, clusters: [[0, 1, 2]], rejected: [],
    nodes: points.map((origin, id) => ({ id, origin, bounds: { min: origin, max: origin }, radius: 16, contents: 0, flags: 0, presence: 0,
      sourceCluster: null, source: { kind: "constructed", surface: null, leaf: null } })),
    edges: [0, 1].map(id => { const start = points[id], end = points[id + 1]; if (start === undefined || end === undefined) throw new Error("fixture");
      return { id, from: id, to: id + 1, start, end, mode: "walk", travelSeconds: 1, sourceTravelType: 0, sourceFlags: 0, hint: null, entity: null,
        source: { kind: "constructed", surface: null, leaf: null } }; }),
  };
  const start = points[0], goal = points[2]; if (start === undefined || goal === undefined) throw new Error("fixture");
  const request: RereleasePathRequest = { start, goal, flags: 2, moveDistance: 0, ignoreNodeFlags: false, minHeight: 0, maxHeight: 0, radius: 0, dropHeight: 0, jumpHeight: 0 };
  return { runtime: new NavigationRuntime(graph, world), scene, world, request };
}
test("native monster advisory traverses shared graph without player admission, rechecks blocked links", () => {
  const f = fixture(), result = rereleasePathToGoal(f.runtime, f.request);
  expect(result.code).toBe(4); expect(result.first.x).toBe(100); expect(result.second.x).toBe(200);
  expect(result.distanceSquared).toBe(40000); expect(f.world.commands).toBe(0);
  f.runtime.blockEdge(1, "door closed"); expect(rereleasePathToGoal(f.runtime, f.request).code).toBe(11);
  f.runtime.blockEdge(1, null); expect(rereleasePathToGoal(f.runtime, f.request).code).toBe(4);
  expect(rereleasePathToGoal(null, f.request).code).toBe(8);
  expect(rereleasePathToGoal(f.runtime, { ...f.request, flags: 4 }).code).toBe(12);
  expect(rereleasePathToGoal(f.runtime, { ...f.request, goal: f.request.start }).code).toBe(0);
});
test("API2023 writes exact PathInfo and bounded points; bot orders resolve actual actor identities", () => {
  const f = fixture(), memory = new SparseGuestMemory({ pointerBytes: 8, module: { id: "fixture:native-nav", artifactPath: "fixture", revision: "1", digest: createContentDigest("1".repeat(64)) } });
  const input = memory.allocate({ byteLength: 80 }), output = memory.allocate({ byteLength: 48 }), points = memory.allocate({ byteLength: 24 });
  memory.write(output, new Uint8Array(48).fill(0x55)); memory.write(points, new Uint8Array(24).fill(0x66));
  memory.writeFloat32(memory.offset(input, 8n), f.request.start.z); memory.writeFloat32(memory.offset(input, 12n), 200); memory.writeFloat32(memory.offset(input, 20n), f.request.goal.z);
  memory.writeUint32(memory.offset(input, 24n), 2); memory.writePointer(memory.offset(input, 64n), points); memory.writeInt64(memory.offset(input, 72n), 1n);
  const owner = createIdentityOwner("navigation-import"), actor = owner.actor(1, 1), target = owner.actor(2, 1), orders: string[] = [];
  const adapter = new RereleaseNavigationImports(memory, { runtime: () => f.runtime,
    moveToPoint: (subject, point, tolerance) => { expect(subject).toBe(actor); orders.push(`${point.x}:${tolerance}`); return 1; },
    followActor: (subject, followed) => { expect(subject).toBe(actor); expect(followed).toBe(target); orders.push("follow"); return 2; } },
    address => address.byteOffset === input.byteOffset ? actor : target);
  expect(adapter.invoke("GetPathToGoal", [guestPointer(input), guestPointer(output)])).toEqual({ kind: "uint32", value: 1 });
  expect(memory.readInt32(output)).toBe(1); expect(memory.readFloat32(memory.offset(output, 4n))).toBe(40000);
  expect(memory.readFloat32(points)).toBe(0); expect(memory.readUint8(memory.offset(points, 12n))).toBe(0x66);
  expect(memory.readInt32(memory.offset(output, 36n))).toBe(4); expect(memory.readUint8(memory.offset(output, 40n))).toBe(0x55);
  expect(adapter.invoke("Bot_MoveToPoint", [guestPointer(input), guestPointer(points), { kind: "float32", value: 8 }])).toEqual({ kind: "int32", value: 1 });
  expect(adapter.invoke("Bot_FollowActor", [guestPointer(input), guestPointer(points)])).toEqual({ kind: "int32", value: 2 });
  expect(orders).toEqual(["0:8", "follow"]);
  memory.writeInt64(memory.offset(input, 72n), -1n);
  expect(() => adapter.invoke("GetPathToGoal", [guestPointer(input), guestPointer(output)])).toThrow("point buffer");
});

test("raw objective paths retain full distance without movement output and reject inaccessible destinations", () => {
  const f = fixture(), raw = rereleasePathToGoal(f.runtime, { ...f.request, ignoreNodeFlags: true });
  expect(raw.code).toBe(3); expect(raw.distanceSquared).toBe(40000);
  expect(raw.first).toEqual({ x: 0, y: 0, z: 0 }); expect(raw.points.map(point => point.x)).toEqual([0, 100, 200]);
  expect(rereleasePathToGoal(f.runtime, { ...f.request, start: { x: -2000, y: 0, z: 24.125 } }).code).toBe(9);
  expect(rereleasePathToGoal(f.runtime, { ...f.request, goal: { x: 2000, y: 0, z: 24.125 } }).code).toBe(10);
  f.runtime.enableArea(1, false); expect(rereleasePathToGoal(f.runtime, f.request).code).toBe(11);
  expect(f.world.commands).toBe(0);
});

test("anonymous source advisory does not collide with the requesting actor at its start", () => {
  const f = fixture(), actor = createIdentityOwner("requesting-monster").actor(1, 1), origin = f.request.start;
  const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
  const absoluteBounds = { min: { x: origin.x - 16, y: origin.y - 16, z: origin.z - 24 }, max: { x: origin.x + 16, y: origin.y + 16, z: origin.z + 32 } };
  const zero = { x: 0, y: 0, z: 0 };
  f.scene.link({ actor, state: { origin, angles: zero, velocity: zero, bounds, ground: null }, absoluteBounds, linkCount: 1 },
    { family: "q3", shape: { kind: "box" }, contents: 0x02000000, owner: null, role: "solid", monster: true, deadMonster: false });
  expect(rereleasePathToGoal(f.runtime, f.request).code).toBe(4);
  f.scene.link({ actor, state: { origin, angles: zero, velocity: zero, bounds, ground: null }, absoluteBounds, linkCount: 2 },
    { family: "q3", shape: { kind: "box" }, contents: 1, owner: null, role: "solid", monster: false, deadMonster: false });
  expect(rereleasePathToGoal(f.runtime, f.request).code).toBe(9);
});
