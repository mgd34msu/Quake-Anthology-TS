import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SimulationEvent } from "../../src/contracts/session.ts";
import { Q3Random } from "../../src/core/numeric.ts";
import { EngineSession, ProviderRuntimeState, ResourceScope, SourceClock, eventTargetsSeat } from "../../src/world/session/index.ts";

test("resources close once in reverse acquisition order, including after an error", () => {
  const closed: string[] = [];
  const scope = new ResourceScope("smoke resources");
  scope.defer(() => { closed.push("first"); return undefined; });
  scope.defer(() => { closed.push("second"); throw new Error("close failure"); });
  scope.defer(() => { closed.push("third"); scope.close(); return undefined; });
  expect(() => scope.close()).toThrow(AggregateError);
  scope.close();
  expect(closed).toEqual(["third", "second", "first"]);
  expect(() => scope.defer(() => undefined)).toThrow("closed");
});

test("connection, client world, seat and session have independent lifetimes", () => {
  const session = new EngineSession(createIdentityOwner("local lifetime"), { kind: "local" });
  const first = session.createClient(0);
  const second = session.createClient(1);
  const seat = session.createSeat(0, first);
  const secondSeat = session.createSeat(1, second);
  const connection = first.connect("loopback");
  const closed: string[] = [];
  connection.defer(() => { closed.push("connection"); return undefined; });
  first.worldResources.defer(() => { closed.push("world"); return undefined; });
  seat.resources.defer(() => { closed.push("seat"); return undefined; });
  first.clearWorld();
  expect(closed).toEqual(["world"]);
  expect(connection.isClosed).toBe(false);
  first.close();
  expect(closed).toEqual(["world", "seat", "connection"]);
  expect(seat.isClosed).toBe(true);
  expect(secondSeat.isClosed).toBe(false);
  const replacement = session.createClient(0);
  expect(first.id.equals(replacement.id)).toBe(false);
  session.closeClient(first.id);
  expect(replacement.isClosed).toBe(false);
  session.resources.defer(() => session.close());
  session.close();
  session.close();
  expect(secondSeat.isClosed).toBe(true);
  expect(replacement.isClosed).toBe(true);
});

test("headless sessions reject seats and session identities do not alias", () => {
  const first = new EngineSession(createIdentityOwner("same name"), { kind: "headless" });
  const second = new EngineSession(createIdentityOwner("same name"), { kind: "local" });
  const client = first.createClient(0);
  expect(() => first.createSeat(0, client)).toThrow("Headless");
  expect(() => second.createSeat(0, client)).toThrow("not owned");
  first.close();
  second.close();
});

test("events target only their client or seat and world events reach both views", () => {
  const identity = createIdentityOwner("event routing");
  const firstSeat = identity.seat(0);
  const secondSeat = identity.seat(1);
  const firstClient = identity.client(0, 0);
  const secondClient = identity.client(1, 0);
  const event: SimulationEvent = { sequence: 0, time: { kind: "milliseconds", value: 100 },
    audience: { kind: "client", client: secondClient },
    payload: { kind: "sound", resource: "resource:smoke", actor: null,
      origin: { x: 0, y: 0, z: 0 }, channel: 0, volume: 1, attenuation: 1 } };
  expect(eventTargetsSeat(event, firstSeat, firstClient)).toBe(false);
  expect(eventTargetsSeat(event, secondSeat, secondClient)).toBe(true);
  expect(eventTargetsSeat({ ...event, audience: { kind: "seat", seat: firstSeat } }, secondSeat, secondClient)).toBe(false);
  expect(eventTargetsSeat({ ...event, audience: { kind: "world" } }, firstSeat, firstClient)).toBe(true);
});

test("provider clocks preserve units and snapshots do not consume random draws", () => {
  const state = new ProviderRuntimeState();
  const clock = new SourceClock({ kind: "seconds", value: 1 });
  const random = new Q3Random(7);
  state.register("q1:game", clock, random);
  const oldFrame = clock.frame;
  expect(clock.advance({ kind: "seconds", value: 0.05 }).time.value).toBe(1.05);
  expect(oldFrame.time.value).toBe(1);
  expect(() => clock.advance({ kind: "milliseconds", value: 50 })).toThrow("unit conversion");
  const before = random.checkpoint();
  expect(state.checkpoint().random[0]?.state).toEqual(before);
  expect(random.checkpoint()).toEqual(before);
  random.nextInteger();
  expect(random.checkpoint().draws).toBe(before.draws + 1);
  expect(() => state.register("q3:game", new SourceClock({ kind: "milliseconds", value: 0 }), random)).toThrow("distinct");
  state.close();
  expect(() => state.clock("q1:game")).toThrow("closed");
});
