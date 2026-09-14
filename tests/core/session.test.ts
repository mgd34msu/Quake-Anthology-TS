import { expect, spyOn, test } from "bun:test";
import type { ExecutableRecipe } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { InputBatch, Simulation, SimulationEvent, SimulationOutput } from "../../src/contracts/session.ts";
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

function stepFixture() {
  const identity = createIdentityOwner("session stepping");
  const session = new EngineSession(identity, { kind: "headless" });
  const clock = new SourceClock({ kind: "milliseconds", value: 50 });
  const output: SimulationOutput = { snapshot: { session: identity.session, frame: clock.frame,
    actors: [], bodies: [], inventories: [], configurations: [],
    scene: { session: identity.session, time: clock.frame.time, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } }, events: [] };
  const input: InputBatch = { elapsedMilliseconds: 50, commands: [] };
  const simulation = (hooks: Partial<Pick<Simulation, "step" | "stepAsync" | "close">> = {}): Simulation => ({ session: identity.session,
    get recipe(): ExecutableRecipe { throw new Error("Session stepping does not read the recipe"); },
    step: () => output,
    checkpoint: () => { throw new Error("Session stepping does not create a checkpoint"); },
    close: () => undefined, ...hooks });
  return { session, simulation, output, input };
}

test("async simulation hooks finish before one session publication", async () => {
  const { session, simulation, output, input } = stepFixture();
  const deferred = Promise.withResolvers<SimulationOutput>();
  const received: InputBatch[] = [];
  session.attachWorld(simulation({ step: () => { throw new Error("Unexpected synchronous step"); },
    stepAsync: batch => { received.push(batch); return deferred.promise; } }));
  const published = spyOn(session, "publish");
  try {
    const pending = session.stepAsync(input);
    expect(received).toEqual([input]);
    expect(session.snapshot).toBeNull();
    expect(published).not.toHaveBeenCalled();
    deferred.resolve(output);
    expect(await pending).toBe(output);
    expect(session.snapshot).toBe(output.snapshot);
    expect(published).toHaveBeenCalledTimes(1);
  } finally { published.mockRestore(); session.close(); }
});

test("async session steps fall back to the synchronous source hook", async () => {
  const { session, simulation, output, input } = stepFixture();
  let calls = 0;
  session.attachWorld(simulation({ step: batch => { expect(batch).toBe(input); calls++; return output; } }));
  try {
    expect(await session.stepAsync(input)).toBe(output);
    expect(session.step(input)).toBe(output);
    expect(calls).toBe(2);
    expect(session.snapshot).toBe(output.snapshot);
  } finally { session.close(); }
});

test("suspended async steps block both step methods and world replacement", async () => {
  const { session, simulation, output, input } = stepFixture();
  const deferred = Promise.withResolvers<SimulationOutput>();
  session.attachWorld(simulation({ stepAsync: () => deferred.promise }));
  try {
    const pending = session.stepAsync(input);
    expect(() => session.step(input)).toThrow("already running");
    await expect(session.stepAsync(input)).rejects.toThrow("already running");
    expect(() => session.attachWorld(simulation())).toThrow("Cannot replace a world");
    deferred.resolve(output);
    expect(await pending).toBe(output);
    expect(session.step(input)).toBe(output);
  } finally { session.close(); }
});

test("synchronous steps share their reentry guard with async steps", async () => {
  const { session, simulation, output, input } = stepFixture();
  const rejected = Promise.withResolvers<SimulationOutput>();
  session.attachWorld(simulation({ step: () => {
    expect(() => session.step(input)).toThrow("already running");
    rejected.resolve(session.stepAsync(input));
    return output;
  } }));
  try {
    expect(session.step(input)).toBe(output);
    await expect(rejected.promise).rejects.toThrow("already running");
  } finally { session.close(); }
});

test("rejected async steps release the guard without publishing", async () => {
  const { session, simulation, output, input } = stepFixture();
  const deferred = Promise.withResolvers<SimulationOutput>();
  session.attachWorld(simulation({ stepAsync: () => deferred.promise }));
  try {
    const pending = session.stepAsync(input);
    deferred.reject(new Error("guest read failed"));
    await expect(pending).rejects.toThrow("guest read failed");
    expect(session.snapshot).toBeNull();
    expect(session.step(input)).toBe(output);
  } finally { session.close(); }
});

for (const retirement of ["session", "world", "world-lifetime"]) {
  test(`${retirement} retirement prevents a suspended async step publishing`, async () => {
    const { session, simulation, output, input } = stepFixture();
    const deferred = Promise.withResolvers<SimulationOutput>();
    let closed = 0;
    const world = session.attachWorld(simulation({ stepAsync: () => deferred.promise, close: () => { closed++; return undefined; } }));
    const published = spyOn(session, "publish");
    try {
      const pending = session.stepAsync(input);
      if (retirement === "session") session.close();
      else if (retirement === "world") session.closeWorld();
      else world.close();
      deferred.resolve(output);
      await expect(pending).rejects.toThrow("Simulation closed during its step");
      expect(closed).toBe(1);
      expect(session.snapshot).toBeNull();
      expect(published).not.toHaveBeenCalled();
      if (retirement !== "session") {
        session.attachWorld(simulation());
        expect(await session.stepAsync(input)).toBe(output);
      }
    } finally { published.mockRestore(); session.close(); }
  });
}

test("world replacement publishes before fallible retirement and retains client identity", () => {
  const { session, simulation, input, output } = stepFixture();
  const client = session.createClient(0);
  const connection = client.connect("loopback");
  session.attachWorld(simulation({ close: () => { throw new Error("old world cleanup"); } }));
  const oldResources = client.worldResources;
  const next = simulation();
  const replacement = session.replaceWorld(next);
  expect(session.world?.simulation).toBe(next);
  expect(client.connection).toBe(connection);
  expect(client.worldResources).not.toBe(oldResources);
  expect(oldResources.isClosed).toBe(false);
  expect(() => replacement.retired.close()).toThrow("Retired world shutdown failed");
  expect(oldResources.isClosed).toBe(true);
  expect(connection.isClosed).toBe(false);
  expect(session.step(input)).toBe(output);
  session.close();
});

test("invalid replacement leaves the published world and its resources usable", () => {
  const { session, simulation, input, output } = stepFixture();
  const old = session.attachWorld(simulation());
  const client = session.createClient(0);
  const resources = client.worldResources;
  session.step(input);
  const foreign = stepFixture();
  expect(() => session.replaceWorld(foreign.simulation())).toThrow("another session");
  expect(session.world).toBe(old);
  expect(session.snapshot).toBe(output.snapshot);
  expect(client.worldResources).toBe(resources);
  expect(old.isClosed).toBe(false);
  expect(session.step(input)).toBe(output);
  foreign.session.close();
  session.close();
});
