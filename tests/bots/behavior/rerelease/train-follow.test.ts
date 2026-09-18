import { expect, test } from "bun:test";
import { followPath, newPathState, setPath, BotPathStatus } from "../../../../src/bots/behavior/rerelease/path-follow.ts";
import { NavLinkType, type BotTransportStep, type NavGraphLinkT } from "../../../../src/bots/behavior/rerelease/nav.ts";
import { BotMovementSettings } from "../../../../src/bots/behavior/rerelease/data/botdata.ts";
import { Xorshift32 } from "../../../../src/bots/behavior/rerelease/rng.ts";

test("train follower waits, retains the live ride near arrival, exits, and times out a blocked ride", () => {
  const start = { x: 0, y: 0, z: 24 }, end = { ...start, x: 256 }, staging = { ...start, x: -48 };
  const link: NavGraphLinkT = { from: 1, to: 2, type: NavLinkType.Train, traversal: { funnel: staging, start, end }, entityBounds: null };
  const state = newPathState(), movement = new BotMovementSettings(), random = new Xorshift32(5);
  setPath(state, { nodes: [1, 2], points: [start, end, { ...end, x: 320 }], links: [link, null, null], cost: 3, generation: 1, mapDigest: "train" }, staging, 0);
  let step: BotTransportStep = { kind: "wait" };
  const frame = (x: number, now: number) => followPath(state, { origin: { ...start, x }, pitch: 0, yaw: 0, onGround: true,
    now, stuckTime: 2, transport: () => step }, movement, random);
  expect(frame(-48, 0)).toMatchObject({ status: BotPathStatus.Moving, forwardmove: 0, riding: false });
  step = { kind: "ride" };
  expect(frame(0, 0.5)).toMatchObject({ status: BotPathStatus.Moving, forwardmove: 0, riding: true });
  expect(state.index).toBe(1);
  expect(frame(240, 2)).toMatchObject({ status: BotPathStatus.Moving, forwardmove: 0, riding: true });
  expect(state.index).toBe(1);
  expect(frame(240, 7).status).toBe(BotPathStatus.Stuck);
  step = { kind: "move", stage: "exit", target: end };
  expect(frame(256, 7.1).forwardmove).toBeGreaterThan(0);
  expect(state.index).toBe(2);
});
