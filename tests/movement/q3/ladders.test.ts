// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { TraceResult } from "../../../src/contracts/scene.ts";
import { movePlayer, Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS } from "../../../src/movement/q3/index.ts";
import type { Q3Motion, Q3MotionOptions } from "../../../src/movement/q3/index.ts";

const SURF_LADDER = 8;
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const freePlane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };

/** A ladder wall one unit ahead: only the flat unit-length probe hits; every other sweep is free air. */
function run(ladders: boolean | undefined) {
  const owner = createIdentityOwner("q3-ladders");
  const state: Q3Motion = { commandTime: 0, pmType: 0, bobCycle: 0, pmFlags: 0, pmTime: 0, origin: { x: 0, y: 0, z: 500 }, velocity: zero,
    gravity: 800, speed: 320, deltaAngles: zero, ground: { kind: "none" }, movementDir: 0, grapplePoint: zero, eFlags: 0, viewangles: zero,
    viewheight: 26, pmoveFramecount: 0, eventSequence: 0, actor: owner.actor(1, 1), health: 100, flight: false, invulnerable: false, product: "baseq3" };
  let probes = 0;
  const options: Q3MotionOptions = {
    trace: (start, end): TraceResult => {
      const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
      const probe = dz === 0 && Math.abs(Math.hypot(dx, dy) - 1) < 1e-6;
      if (probe) probes++;
      const plane = { normal: { x: -1, y: 0, z: 0 }, distance: 0, type: 3, signbits: 0 };
      return probe
        ? { kind: "q3", fraction: 0.5, end: start, allSolid: false, startSolid: false, contact: { kind: "plane", plane }, sourcePlane: plane,
          hit: { kind: "world", model: 0 }, contents: 1, surfaceFlags: SURF_LADDER }
        : { kind: "q3", fraction: 1, end, allSolid: false, startSolid: false, contact: { kind: "none" }, sourcePlane: freePlane,
          hit: { kind: "none" }, contents: 0, surfaceFlags: 0 };
    },
    pointContents: () => 0, standingBounds: Q3_SOURCE_STANDING_BOUNDS, postures: Q3_SOURCE_POSTURES, traceMask: 1, fixedMsec: null, noFootsteps: false,
    ...(ladders === undefined ? {} : { ladders }),
    beginStep: () => undefined, event: () => undefined, animation: () => undefined, weapon: () => undefined, torso: () => undefined,
    firing: () => false, contact: () => undefined,
  };
  movePlayer(state, { serverTime: 100, angles: zero, buttons: 0, weapon: 2, forwardmove: 127, rightmove: 0, upmove: 127 }, options);
  return { probes, velocityZ: state.velocity.z };
}

test("stock Q3 movement ignores SURF_LADDER and spends no ladder probe", () => {
  for (const option of [undefined, false]) {
    const result = run(option);
    expect(result.probes).toBe(0);
    expect(result.velocityZ).toBeLessThan(0);
  }
});

test("the ladders option climbs SURF_LADDER surfaces with the Quake II ladder model", () => {
  const result = run(true);
  expect(result.probes).toBeGreaterThan(0);
  expect(result.velocityZ).toBeGreaterThan(0);
});

test("a dead player standing up applies the posture hull even when the new hull overlaps solid, as id does", () => {
  const owner = createIdentityOwner("q3-expand");
  const state: Q3Motion = { commandTime: 0, pmType: 0, bobCycle: 0, pmFlags: 0, pmTime: 0, origin: { x: 0, y: 0, z: 500 }, velocity: zero,
    gravity: 800, speed: 320, deltaAngles: zero, ground: { kind: "none" }, movementDir: 0, grapplePoint: zero, eFlags: 0, viewangles: zero,
    viewheight: 26, pmoveFramecount: 0, eventSequence: 0, actor: owner.actor(1, 1), health: 100, flight: false, invulnerable: false, product: "baseq3" };
  const solid = Q3_SOURCE_STANDING_BOUNDS;
  const options: Q3MotionOptions = {
    trace: (_start, end, bounds): TraceResult => ({ kind: "q3", fraction: 1, end, allSolid: bounds.max.z === solid.max.z, startSolid: false,
      contact: { kind: "none" }, sourcePlane: freePlane, hit: { kind: "none" }, contents: 0, surfaceFlags: 0 }),
    pointContents: () => 0, standingBounds: solid, currentBounds: Q3_SOURCE_POSTURES.dead.bounds, postures: Q3_SOURCE_POSTURES, traceMask: 1,
    fixedMsec: null, noFootsteps: false, beginStep: () => undefined, event: () => undefined, animation: () => undefined,
    weapon: () => undefined, torso: () => undefined, firing: () => false, contact: () => undefined,
  };
  const result = movePlayer(state, { serverTime: 8, angles: zero, buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 }, options);
  expect(result.bounds).toEqual(solid);
});
