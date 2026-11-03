// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { nativeMoveSlices } from "../../src/app/bootstrap/simulation/native-commands.ts";
import { overlapPlane, pmoveTouchList, reportedGroundPlane } from "../../src/app/bootstrap/simulation/native-pmove-contacts.ts";
import { NATIVE_PMOVE_DISPOSITION } from "../../src/compat/q2/native-input.ts";
import { pmoveLayout } from "../../src/compat/q2/rerelease/layouts.ts";
import type { ClockProfile } from "../../src/contracts/time.ts";

const owner = createIdentityOwner("native-pmove-contacts");
const up = { normal: { x: 0, y: 0, z: 1 }, distance: 24 };
const wall = { normal: { x: -1, y: 0, z: 0 }, distance: -100 };

describe("native Pmove slicing", () => {
  const netquake: ClockProfile = { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null };
  const fixedNetquake: ClockProfile = { ...netquake, fixedFrameSeconds: 0.04 };
  const quakeWorld: ClockProfile = { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 };
  const quake3: ClockProfile = { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 };

  test("a command within the provider maximum is one slice", () => {
    expect(nativeMoveSlices(netquake, 100)).toEqual({ slices: [100], carry: 0 });
    expect(nativeMoveSlices(quake3, 100)).toEqual({ slices: [100], carry: 0 });
  });
  test("a maximum-step provider gets whole maxima plus a shorter last step", () => {
    expect(nativeMoveSlices(quakeWorld, 100)).toEqual({ slices: [50, 50], carry: 0 });
    expect(nativeMoveSlices(quakeWorld, 120)).toEqual({ slices: [50, 50, 20], carry: 0 });
  });
  test("a fixed-step provider gets k quanta and the remainder carries to the next command", () => {
    const first = nativeMoveSlices(fixedNetquake, 100);
    expect(first.slices).toEqual([40, 40]);
    expect(first.carry).toBeCloseTo(20, 9);
    const second = nativeMoveSlices(fixedNetquake, 100, first.carry);
    expect(second.slices).toEqual([40, 40, 40]);
    expect(second.carry).toBeCloseTo(0, 9);
  });
  test("slices plus carry always conserve the guest interval", () => {
    let carry = 0,
      total = 0,
      quoted = 0;
    for (const milliseconds of [100, 33, 100, 75, 100, 12]) {
      const result = nativeMoveSlices(fixedNetquake, milliseconds, carry);
      total += milliseconds;
      quoted += result.slices.reduce((sum, value) => sum + value, 0);
      carry = result.carry;
    }
    expect(quoted + carry).toBeCloseTo(total, 9);
  });
});

describe("native Pmove contacts", () => {
  test("touches keep the plane the provider reported, in report order, without repeats", () => {
    const a = owner.actor(3, 0),
      b = owner.actor(5, 0);
    const slots = new Map([
      [a, 3],
      [b, 5],
    ]);
    const touches = pmoveTouchList(
      [
        { actor: b, plane: wall },
        { actor: null, plane: up },
        { actor: a, plane: up },
        { actor: b, plane: up },
      ],
      [],
      actor => slots.get(actor),
    );
    expect(touches).toEqual([
      { slot: 5, plane: wall },
      { slot: 3, plane: up },
    ]);
  });
  test("solids the sweep did not name follow with overlap-derived planes, and slotless actors are dropped", () => {
    const named = owner.actor(2, 0),
      door = owner.actor(7, 0),
      loose = owner.actor(9, 0);
    const slots = new Map([
      [named, 2],
      [door, 7],
    ]);
    const derived = { normal: { x: 1, y: 0, z: 0 }, distance: 4 };
    const touches = pmoveTouchList(
      [{ actor: named, plane: wall }],
      [
        { actor: named, plane: up },
        { actor: door, plane: derived },
        { actor: loose, plane: up },
      ],
      actor => slots.get(actor),
    );
    expect(touches).toEqual([
      { slot: 2, plane: wall },
      { slot: 7, plane: derived },
    ]);
  });
  test("the ground plane is the latest standable contact, never a wall", () => {
    expect(
      reportedGroundPlane([
        { actor: null, plane: up },
        { actor: null, plane: wall },
      ]),
    ).toBe(up);
    expect(reportedGroundPlane([{ actor: null, plane: wall }])).toBeNull();
    expect(reportedGroundPlane([])).toBeNull();
  });
  test("overlap planes face the axis of least penetration", () => {
    const bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
    const door = { min: { x: 100, y: -64, z: 0 }, max: { x: 108, y: 64, z: 128 } };
    expect(overlapPlane({ x: 85, y: 0, z: 30 }, bounds, door).normal).toEqual({ x: -1, y: 0, z: 0 });
    const floor = { min: { x: -64, y: -64, z: -8 }, max: { x: 64, y: 64, z: 0 } };
    expect(overlapPlane({ x: 0, y: 0, z: 24.5 }, bounds, floor).normal).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe("native Pmove field disposition", () => {
  test("every rerelease pmove_t field the guest reads has a stated disposition", () => {
    const groups = new Map<string, string>([
      ["s.origin", "origin"],
      ["s.velocity", "velocity"],
      ["s.pm_flags", "pm_flags_ducked_grounded"],
      ["s.pm_time", "pm_time"],
      ["s.delta_angles", "delta_angles"],
      ["s.viewheight", "viewheight"],
      ["touch.num", "touch_list"],
      ["viewangles", "viewangles"],
      ["mins", "mins_maxs"],
      ["maxs", "mins_maxs"],
      ["groundentity", "groundentity"],
      ["groundplane.normal", "groundplane"],
      ["watertype", "watertype_waterlevel"],
      ["waterlevel", "watertype_waterlevel"],
      ["viewoffset", "viewoffset"],
      ["screen_blend", "screen_blend"],
      ["rdflags", "rdflags"],
      ["jump_sound", "jump_sound"],
      ["step_clip", "step_clip"],
      ["impact_delta", "impact_delta"],
    ]);
    const names = new Set(pmoveLayout.fields.map(field => field.name));
    for (const [field, key] of groups) {
      expect(names.has(field)).toBe(true);
      expect(NATIVE_PMOVE_DISPOSITION[key]?.rerelease).toBeDefined();
    }
    // Fields no foreign movement models stay as the guest left them rather than being invented.
    for (const key of ["pm_time", "delta_angles", "step_clip", "impact_delta", "screen_blend", "rdflags", "jump_sound"])
      expect(NATIVE_PMOVE_DISPOSITION[key]?.rerelease).toBe("guest");
    expect(NATIVE_PMOVE_DISPOSITION["groundplane"]).toEqual({ classic: "absent", rerelease: "provider" });
  });
});
