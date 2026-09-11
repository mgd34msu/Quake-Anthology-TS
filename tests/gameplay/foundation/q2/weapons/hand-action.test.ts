import { expect, test } from "bun:test";
import { calculateHandThrow } from "../../../../../src/content/q2/foundation/weapons/hand-grenade.ts";
import type { HandProjectileSpec, HandThrowInput } from "../../../../../src/content/q2/foundation/weapons/hand-grenade.ts";
import { stepHandAction } from "../../../../../src/content/q2/foundation/weapons/hand-action.ts";
import type { HandAction, HandActionHost, HandActionInput } from "../../../../../src/content/q2/foundation/weapons/hand-action.ts";

const throwInput: HandActionInput["throw"] = {
  angles: { x: 0, y: 0, z: 0 }, damageMultiplier: 1, gravity: 800,
  project: (_angles, offset) => ({ start: offset, direction: { x: 1, y: 0, z: 0 } }),
};

function fixture(edition: HandActionInput["edition"]) {
  let state: HandAction = { kind: "idle" }, ammo = 1, committed = 0;
  const emitted: HandProjectileSpec[] = [], sounds: string[] = [];
  const host: HandActionHost = {
    reserve: () => { if (ammo === 0) return false; ammo--; return true; },
    consume: () => { committed++; return undefined; }, refund: () => { ammo++; return undefined; },
    emit: spec => { emitted.push(spec); return undefined; }, sound: event => { sounds.push(event); return undefined; },
  };
  return {
    step(now: number, update: Partial<HandActionInput> = {}) {
      state = stepHandAction(state, { now, edition, pressed: false, held: true, released: false,
        lifecycle: "alive", enabled: true, haste: false, quadFire: false, throw: throwInput, ...update }, host);
      return state;
    },
    state: () => state, ammo: () => ammo, committed: () => committed, emitted, sounds,
  };
}

test("throw calculation preserves classic uncapped speed and rerelease aim, speed cap, and death speed", () => {
  const base: HandThrowInput = { ...throwInput, edition: "classic", alive: true, now: 5, fuseDeadline: 4.8, held: true };
  const classic = calculateHandThrow(base);
  expect(classic.speed).toBe(826);
  expect(classic.start).toEqual({ x: 8, y: 8, z: -8 });
  expect(classic.radius).toBe(165);
  let pitch = 0;
  const rerelease = calculateHandThrow({ ...base, edition: "rerelease", damageMultiplier: 8,
    angles: { x: -90, y: 0, z: 0 }, project: (angles, offset) => { pitch = angles.x; return throwInput.project(angles, offset); } });
  expect(pitch).toBe(-62.5);
  expect(rerelease.speed).toBe(800);
  expect(rerelease.start).toEqual({ x: 2, y: 0, z: -14 });
  expect(rerelease.damage).toBe(1000);
  expect(rerelease.radius).toBe(165);
  expect(calculateHandThrow({ ...base, edition: "rerelease", alive: false }).speed).toBe(400);
});

for (const edition of ["classic", "rerelease"] satisfies readonly HandActionInput["edition"][]) {
  test(`${edition} tap reserves shared ammo, plays preparation, and emits once at the source throw time`, () => {
    const f = fixture(edition);
    f.step(0, { pressed: true });
    expect(f.ammo()).toBe(0);
    expect(f.committed()).toBe(0);
    f.step(0.05, { held: false, released: true });
    const throwFrame = edition === "classic" ? 12 : 10;
    for (let frame = 1; frame < throwFrame; frame++) f.step(frame / 10, { held: false });
    expect(f.emitted).toHaveLength(0);
    f.step(throwFrame / 10, { held: false });
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.fuse).toBeCloseTo(edition === "classic" ? 3.1 : 3.2);
    expect(f.emitted[0]?.held).toBe(false);
    expect(f.sounds).toEqual(["cock", "cook-start", "cook-stop"]);
    expect(f.committed()).toBe(1);
    f.step(5, { held: false });
    f.step(6, { pressed: true });
    expect(f.emitted).toHaveLength(1);
    expect(f.state().kind).toBe("idle");
  });

  test(`${edition} overcook requires release and death resolves a live grenade only once`, () => {
    const f = fixture(edition);
    f.step(0, { pressed: true });
    for (let frame = 1; frame <= 11; frame++) f.step(frame / 10);
    const cooking = f.state();
    expect(cooking.kind).toBe("cooking");
    if (cooking.kind !== "cooking") throw new Error("expected cooking");
    f.step(cooking.expiresAt);
    expect(f.emitted[0]?.held).toBe(true);
    f.step(cooking.expiresAt + 2);
    expect(f.state().kind).toBe("disarmed");
    f.step(cooking.expiresAt + 3, { lifecycle: "dead" });
    expect(f.emitted).toHaveLength(1);
    f.step(cooking.expiresAt + 4, { held: false });
    expect(f.state().kind).toBe("idle");

    const dying = fixture(edition);
    dying.step(0, { pressed: true });
    for (let frame = 1; frame <= 11; frame++) dying.step(frame / 10);
    dying.step(2, { lifecycle: "dead", throw: { ...throwInput, damageMultiplier: 4 } });
    dying.step(2.1, { lifecycle: "dead" });
    expect(dying.emitted).toHaveLength(1);
    expect(dying.committed()).toBe(1);
    expect(dying.emitted[0]?.damage).toBe(500);
    expect(dying.emitted[0]?.held).toBe(edition === "rerelease");
    expect(dying.emitted[0]?.fuse).toBeCloseTo(edition === "classic" ? 0 : 2.2);
    if (edition === "rerelease") expect(dying.emitted[0]?.speed).toBe(400);
  });
}

test("rerelease haste and quadfire accelerate preparation and recovery, never the fuse", () => {
  const f = fixture("rerelease"), tempo = { haste: true, quadFire: true };
  f.step(0, { ...tempo, pressed: true });
  for (let frame = 1; frame <= 10; frame++) f.step(frame * 0.025, tempo);
  const cooking = f.state();
  expect(cooking.kind).toBe("cooking");
  if (cooking.kind !== "cooking") throw new Error("expected cooking");
  expect(cooking.expiresAt).toBe(3.45);
  f.step(0.3, { ...tempo, held: false, released: true });
  expect(f.state()).toEqual({ kind: "recovering", readyAt: 0.55, requireRelease: false });
  expect(f.emitted[0]?.fuse).toBeCloseTo(3.15);
});

test("death during preparation refunds admission and requires a released input before rearming", () => {
  const f = fixture("classic");
  f.step(0, { pressed: true });
  f.step(0.1, { lifecycle: "dead" });
  expect(f.ammo()).toBe(1);
  expect(f.emitted).toHaveLength(0);
  expect(f.step(1, { pressed: true }).kind).toBe("disarmed");
  expect(f.step(1.1, { held: false }).kind).toBe("idle");
});

test("disable and pre-removal release a primed rerelease grenade with ordinary attribution", () => {
  for (const transition of [{ enabled: false }, { lifecycle: "removing" }] satisfies readonly Partial<HandActionInput>[]) {
    const f = fixture("rerelease");
    f.step(0, { pressed: true });
    for (let frame = 1; frame <= 10; frame++) f.step(frame / 10);
    f.step(2, transition);
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.held).toBe(false);
    expect(f.emitted[0]?.fuse).toBeCloseTo(2.2);
    expect(f.emitted[0]?.speed).toBe(506);
    expect(f.committed()).toBe(1);
    expect(f.ammo()).toBe(0);
    f.step(2.1, { lifecycle: "removed" });
    expect(f.emitted).toHaveLength(1);
    expect(f.committed()).toBe(1);
  }
});

test("already removed cleanup discards reservations without touching missing actor services", () => {
  let committed = 0;
  const absentActor = (): never => { throw new Error("removed actor service accessed"); };
  const host: HandActionHost = { reserve: absentActor, consume: () => { committed++; return undefined; },
    refund: absentActor, emit: absentActor, sound: absentActor };
  const input: HandActionInput = { now: 2, edition: "classic", pressed: false, held: true, released: false,
    lifecycle: "removed", enabled: true, haste: false, quadFire: false, throw: { ...throwInput, project: absentActor } };
  const reservedStates: readonly HandAction[] = [
    { kind: "preparing", frame: 5, nextAt: 0.5, releaseQueued: false },
    { kind: "cooking", expiresAt: 4.3 },
    { kind: "releasing", expiresAt: 4.3, throwAt: 2.1 },
  ];
  for (const state of reservedStates) {
    const removed = stepHandAction(state, input, host);
    expect(removed.kind).toBe("disarmed");
    stepHandAction(removed, input, host);
  }
  expect(committed).toBe(3);
});

test("pre-removal cancels and refunds unprimed preparation while the actor still exists", () => {
  const f = fixture("classic");
  f.step(0, { pressed: true });
  f.step(0.1, { lifecycle: "removing" });
  expect(f.ammo()).toBe(1);
  expect(f.committed()).toBe(0);
  expect(f.emitted).toHaveLength(0);
  f.step(0.2, { lifecycle: "removed" });
  expect(f.ammo()).toBe(1);
  expect(f.committed()).toBe(0);
});

test("preparation and fuse deadlines stay fixed across 100, 25, 30 and 16 millisecond world steps", () => {
  const policies = [
    { edition: "classic", haste: false, quadFire: false, cookAt: 1.1 },
    { edition: "rerelease", haste: false, quadFire: false, cookAt: 1 },
    { edition: "rerelease", haste: true, quadFire: true, cookAt: 0.25 },
  ] satisfies readonly { edition: HandActionInput["edition"]; haste: boolean; quadFire: boolean; cookAt: number }[];
  for (const policy of policies) for (const worldMilliseconds of [100, 25, 30, 16]) {
    const f = fixture(policy.edition), boundary = Math.ceil(policy.cookAt * 1000 / worldMilliseconds);
    f.step(0, { ...policy, pressed: true });
    for (let turn = 1; turn <= boundary; turn++) f.step(turn * worldMilliseconds / 1000, policy);
    const cooking = f.state();
    expect(cooking.kind).toBe("cooking");
    if (cooking.kind !== "cooking") throw new Error("Expected cooking on first world boundary after hold frame");
    expect(cooking.expiresAt).toBeCloseTo(policy.cookAt + 3.2, 10);
    expect(f.sounds).toEqual(["cock", "cook-start"]);
    expect(f.emitted).toHaveLength(0);
    const expiryBoundary = Math.ceil(cooking.expiresAt * 1000 / worldMilliseconds) * worldMilliseconds / 1000;
    f.step(expiryBoundary, policy);
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.held).toBe(true);
    expect(f.emitted[0]?.fuse).toBeCloseTo(cooking.expiresAt - expiryBoundary, 10);
    expect(f.committed()).toBe(1);
  }
});

test("queued taps use logical throw deadlines and the current emission pose on uneven world steps", () => {
  for (const edition of ["classic", "rerelease"] satisfies readonly HandActionInput["edition"][]) {
    for (const worldMilliseconds of [100, 25, 30, 16]) {
      const f = fixture(edition), throwAt = edition === "classic" ? 1.2 : 1;
      const boundary = Math.ceil(throwAt * 1000 / worldMilliseconds);
      f.step(0, { pressed: true });
      for (let turn = 1; turn < boundary; turn++) f.step(turn * worldMilliseconds / 1000, { held: false, released: turn === 1 });
      expect(f.emitted).toHaveLength(0);
      const now = boundary * worldMilliseconds / 1000;
      f.step(now, { held: false, throw: { ...throwInput, project: () => ({ start: { x: now, y: 7, z: 9 }, direction: { x: 1, y: 0, z: 0 } }) } });
      expect(f.emitted).toHaveLength(1);
      expect(f.emitted[0]?.start).toEqual({ x: now, y: 7, z: 9 });
      expect(f.emitted[0]?.fuse).toBeCloseTo((edition === "classic" ? 4.3 : 4.2) - now, 10);
      expect(f.emitted[0]?.held).toBe(false);
      expect(f.sounds).toEqual(["cock", "cook-start", "cook-stop"]);
    }
  }
});

test("coarse preparation catches up once, distinguishing a queued tap from a newly observed release", () => {
  for (const queued of [true, false]) {
    const f = fixture("classic");
    f.step(0, { pressed: true });
    if (queued) f.step(0.05, { held: false, released: true });
    f.step(1.5, { held: false, released: true });
    if (!queued) {
      expect(f.emitted).toHaveLength(0);
      expect(f.state()).toEqual({ kind: "releasing", expiresAt: 1.1 + 3.2, throwAt: 1.6 });
      f.step(1.6, { held: false });
    }
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.fuse).toBeCloseTo(4.3 - (queued ? 1.5 : 1.6));
    expect(f.committed()).toBe(1);
    expect(f.ammo()).toBe(0);
    expect(f.sounds).toEqual(["cock", "cook-start", "cook-stop"]);
  }
  for (const queued of [true, false]) {
    const f = fixture("classic");
    f.step(0, { pressed: true });
    if (queued) f.step(0.05, { held: false, released: true });
    f.step(5, { held: !queued });
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.held).toBe(!queued);
    expect(f.emitted[0]?.fuse).toBeCloseTo(-0.7);
    expect(f.committed()).toBe(1);
    expect(f.sounds).toEqual(["cock", "cook-start", "cook-stop"]);
    f.step(5);
    expect(f.emitted).toHaveLength(1);
  }
});

test("a restored preparation deadline catches up without resetting its fuse or reserving ammunition again", () => {
  const saved: HandAction = { kind: "preparing", frame: 5, nextAt: 0.5, releaseQueued: true };
  const emitted: HandProjectileSpec[] = [], sounds: string[] = [];
  let consumed = 0;
  const restored = structuredClone(saved);
  const result = stepHandAction(restored, { now: 1.25, edition: "classic", pressed: false, held: false, released: false,
    lifecycle: "alive", enabled: true, haste: false, quadFire: false, throw: throwInput }, {
    reserve: () => { throw new Error("Restore repeated ammunition admission"); },
    consume: () => { consumed++; return undefined; }, refund: () => { throw new Error("Restore canceled a valid grenade"); },
    sound: event => { sounds.push(event); return undefined; }, emit: spec => { emitted.push(spec); return undefined; },
  });
  expect(result).toEqual({ kind: "recovering", readyAt: 2.25, requireRelease: false });
  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.fuse).toBeCloseTo(3.05);
  expect(consumed).toBe(1);
  expect(sounds).toEqual(["cock", "cook-start", "cook-stop"]);
});
