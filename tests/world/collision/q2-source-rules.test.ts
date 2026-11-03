// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { corpusFile } from "../../support/corpus.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import type { DecodedWorld, TracePolicy, TraceResult } from "../../../src/contracts/scene.ts";
import type { TraceQuery } from "../../../src/contracts/scene-trace.ts";
import { parseEntities } from "../../../src/core/common-parse.ts";
import { Q2_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import type { SpatialActor } from "../../../src/world/spatial/index.ts";
import { traceActorBody } from "../../../src/world/collision/body.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q2Collision } from "../../../src/world/collision/q2.ts";

const pak = corpusFile("q2/baseq2/pak0.pak");
const identity = createIdentityOwner("q2 source rules");
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const DEADMONSTER = 0x04000000,
  MONSTER = 0x02000000;
const box = (half: number): Bounds => ({ min: { x: -half, y: -half, z: -half }, max: { x: half, y: half, z: half } });
const policy = (contentsMask: number, leafContents: "stored" | "merged" = "merged"): TracePolicy => ({ kind: "q2", contentsMask, leafContents });

async function load(map: string): Promise<DecodedWorld> {
  const archive = await openArchive(pak);
  try {
    const entry = archive.findEntries(map)[0];
    if (entry === undefined) throw new Error(`Missing ${map}`);
    return decodeQ2Map(await archive.readEntry(entry));
  } finally {
    await archive.close();
  }
}

function spawnOf(world: DecodedWorld): Vec3 {
  const spawn = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
  const [x, y, z] = spawn?.get("origin")?.trim().split(/\s+/).map(Number) ?? [];
  if (x === undefined || y === undefined || z === undefined) throw new Error("Map has no player start");
  return { x, y, z };
}

test.skipIf(!existsSync(pak))("a Q2 point trace only meets a corpse when its mask carries DEADMONSTER", async () => {
  const world = await load("maps/base1.bsp"),
    scene = createSceneQueries(world),
    origin = spawnOf(world);
  const actor = identity.actor(9, 0),
    center = { ...origin, z: origin.z + 20 },
    bounds = box(4);
  scene.link(
    {
      actor,
      state: { origin: center, angles: zero, velocity: zero, bounds, ground: null },
      absoluteBounds: { min: { x: center.x - 4, y: center.y - 4, z: center.z - 4 }, max: { x: center.x + 4, y: center.y + 4, z: center.z + 4 } },
      linkCount: 1,
    },
    { family: "q2", shape: { kind: "box" }, contents: DEADMONSTER, owner: null, role: "solid", monster: false, deadMonster: true },
  );
  const through = (mask: number): TraceResult =>
    scene.trace({
      start: { ...origin, z: origin.z + 8 },
      end: { ...origin, z: origin.z + 30 },
      shape: { kind: "point" },
      target: { kind: "world" },
      policy: policy(mask),
      numeric: Q2_DONOR_PROFILE,
      passActor: null,
    });
  expect(through(MONSTER | 1).hit.kind).toBe("none");
  expect(through(MONSTER | 1).fraction).toBe(1);
  expect(through(DEADMONSTER | 1).hit.kind).toBe("actor");
  // A corpse from another family still takes point shots, so foreign corpses can be gibbed.
  scene.link(
    {
      actor,
      state: { origin: center, angles: zero, velocity: zero, bounds, ground: null },
      absoluteBounds: { min: { x: center.x - 4, y: center.y - 4, z: center.z - 4 }, max: { x: center.x + 4, y: center.y + 4, z: center.z + 4 } },
      linkCount: 2,
    },
    { family: "q1", shape: { kind: "box" }, contents: DEADMONSTER, owner: null, role: "solid", monster: false, deadMonster: true },
  );
  expect(through(MONSTER | 1).hit.kind).toBe("actor");
});

test.skipIf(!existsSync(pak))("a box actor reports the null surface and replaces a world result when the trace starts inside it", async () => {
  const world = await load("maps/base1.bsp"),
    scene = createSceneQueries(world),
    origin = spawnOf(world);
  const actor = identity.actor(9, 0),
    center = { ...origin, z: origin.z + 20 };
  scene.link(
    {
      actor,
      state: { origin: center, angles: zero, velocity: zero, bounds: box(4), ground: null },
      absoluteBounds: { min: { x: center.x - 4, y: center.y - 4, z: center.z - 4 }, max: { x: center.x + 4, y: center.y + 4, z: center.z + 4 } },
      linkCount: 1,
    },
    { family: "q2", shape: { kind: "box" }, contents: MONSTER, owner: null, role: "solid", monster: true, deadMonster: false },
  );
  const hit = scene.trace({
    start: { ...origin, z: origin.z + 8 },
    end: { ...origin, z: origin.z + 30 },
    shape: { kind: "point" },
    target: { kind: "world" },
    policy: policy(MONSTER | 1),
    numeric: Q2_DONOR_PROFILE,
    passActor: null,
  });
  if (hit.kind !== "q2") throw new Error("Expected a Q2 trace");
  expect(hit.hit.kind).toBe("actor");
  expect(hit.surface).toEqual({ name: "", flags: 0, value: 0, material: "" });
  const inside = scene.trace({
    start: center,
    end: { ...center, z: center.z + 6 },
    shape: { kind: "point" },
    target: { kind: "world" },
    policy: policy(MONSTER | 1),
    numeric: Q2_DONOR_PROFILE,
    passActor: null,
  });
  expect(inside.startSolid).toBe(true);
  expect(inside.hit.kind).toBe("actor");
});

test.skipIf(!existsSync(pak))("a trace that misses everything still carries the null surface", async () => {
  const world = await load("maps/base1.bsp"),
    scene = createSceneQueries(world),
    origin = spawnOf(world);
  const miss = scene.trace({
    start: { ...origin, z: origin.z + 8 },
    end: { ...origin, z: origin.z + 12 },
    shape: { kind: "point" },
    target: { kind: "world" },
    policy: policy(1),
    numeric: Q2_DONOR_PROFILE,
    passActor: null,
  });
  if (miss.kind !== "q2") throw new Error("Expected a Q2 trace");
  expect(miss.fraction).toBe(1);
  expect(miss.surface).not.toBeNull();
});

test("stored leaf contents keep the raw enter fraction, merged contents clamp it to zero", () => {
  const actor: SpatialActor = {
    body: {
      actor: identity.actor(2, 0),
      state: { origin: zero, angles: zero, velocity: zero, bounds: box(64), ground: null },
      absoluteBounds: box(64),
      linkCount: 1,
    },
    collision: { family: "q2", shape: { kind: "box" }, contents: MONSTER, owner: null, role: "solid", monster: true, deadMonster: false },
  };
  // Starting a hair outside the face and drifting in by less than the epsilon: cmodel.c's raw fraction is below -1, which is no hit.
  const query = (leafContents: "stored" | "merged"): TraceQuery => ({
    start: { x: 64.0166, y: 0, z: 0 },
    end: { x: 64.0094, y: 0, z: 0 },
    shape: { kind: "point" },
    target: { kind: "world" },
    policy: policy(MONSTER, leafContents),
    numeric: Q2_DONOR_PROFILE,
    passActor: null,
  });
  expect(traceActorBody(query("stored"), actor).fraction).toBe(1);
  expect(traceActorBody(query("merged"), actor).fraction).toBe(0);
});

test.skipIf(!existsSync(pak))("toggling a func_areaportal whose number has no lump entry is legal, but a number past the count is a map error", async () => {
  const world = await load("maps/train.bsp");
  if (world.kind !== "q2-bsp") throw new Error("Expected a Q2 world");
  const collision = new Q2Collision(world);
  const listed = new Set(world.areaPortals.map(entry => entry.portal));
  let missing: number | undefined;
  for (let portal = 0; portal <= world.areaPortals.length && missing === undefined; portal++) if (!listed.has(portal)) missing = portal;
  expect(missing).toBeDefined();
  if (missing === undefined) return;
  collision.setAreaPortalState(missing, true);
  expect(collision.portalState()).toContain(missing);
  collision.setAreaPortalState(missing, false);
  expect(collision.portalState()).not.toContain(missing);
  expect(() => collision.setAreaPortalState(world.areaPortals.length + 1, true)).toThrow(RangeError);
});
