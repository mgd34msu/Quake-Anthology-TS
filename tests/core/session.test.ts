import { CommandBuffer } from "../../src/core/commands/index.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { InputRouter } from "../../src/input/router.ts";
import { expect, spyOn, test } from "bun:test";
import type { ExecutableRecipe } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { InputBatch, SeatPresentation, Simulation, SimulationEvent, SimulationOutput } from "../../src/contracts/session.ts";
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

function stepFixture(mode: "headless" | "local" = "headless") {
  const identity = createIdentityOwner("session stepping");
  const session = new EngineSession(identity, { kind: mode });
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

test("detached local world retirement preserves the connecting client and later remote presentation", () => {
  const { session, simulation, input, output } = stepFixture("local");
  const client = session.createClient(2), seat = session.createSeat(1, client);
  const connection = client.connect("remote");
  const closed: string[] = [];
  const presentation = (): SeatPresentation => ({
    state: { seat: seat.id, client: client.id, actor: { kind: "spectator" },
      get ui(): SeatPresentation["state"]["ui"] { throw new Error("Retirement does not read UI state"); },
      get presentation(): SeatPresentation["state"]["presentation"] { throw new Error("Retirement does not read the renderer binding"); } },
    receive: () => undefined,
    frame: () => { throw new Error("Retirement does not construct a frame"); },
    render: () => undefined,
  });
  const world = session.attachWorld(simulation({ close: () => { closed.push("simulation"); throw new Error("old world cleanup"); } }));
  seat.attachPresentation(presentation(), () => { closed.push("presentation"); return undefined; });
  const oldResources = client.worldResources;
  oldResources.defer(() => { closed.push("client world"); return undefined; });
  session.step(input);
  const retired = session.detachWorld();
  expect(session.world).toBeNull();
  expect(session.snapshot).toBeNull();
  expect(seat.presentation).toBeNull();
  expect(client.worldResources).not.toBe(oldResources);
  expect(world.isClosed).toBe(false);
  expect(oldResources.isClosed).toBe(false);
  expect(closed).toEqual([]);
  const remote = presentation();
  const currentResources = client.worldResources;
  const currentPresentation = seat.attachPresentation(remote, () => undefined);
  session.publish(output);
  expect(() => retired.close()).toThrow(AggregateError);
  retired.close();
  expect(closed).toEqual(["simulation", "presentation", "client world"]);
  expect(world.isClosed).toBe(true);
  expect(oldResources.isClosed).toBe(true);
  expect(client.worldResources).toBe(currentResources);
  expect(currentResources.isClosed).toBe(false);
  expect(currentPresentation.isClosed).toBe(false);
  expect(seat.presentation).toBe(remote);
  expect(session.snapshot).toBe(output.snapshot);
  expect(client.connection).toBe(connection);
  expect(connection.isClosed).toBe(false);
  session.close();
  expect(currentResources.isClosed).toBe(true);
  expect(currentPresentation.isClosed).toBe(true);
  expect(connection.isClosed).toBe(true);
});


test("prepared clients remain unpublished and discarded identities are never reused", () => {
  const { session, simulation, input, output } = stepFixture("local");
  const world = session.attachWorld(simulation());
  const prepared = session.prepareClient(1);
  const connection = prepared.connect("loopback");
  expect(() => session.createSeat(0, prepared)).toThrow("not owned");
  session.closeClient(prepared.id);
  expect(prepared.isClosed).toBe(false);
  expect(session.world).toBe(world);
  expect(session.step(input)).toBe(output);
  prepared.close();
  expect(connection.isClosed).toBe(true);
  const current = session.createClient(1);
  expect(current.id.equals(prepared.id)).toBe(false);
  expect(current.id.generation).toBeGreaterThan(prepared.id.generation);
  session.closeClient(prepared.id);
  expect(current.isClosed).toBe(false);
  session.close();
});

test("prepared bot clients publish with the world and removed clients retire afterward", () => {
  const { session, simulation } = stepFixture("local");
  session.attachWorld(simulation());
  const human = session.createClient(0), connection = human.connect("loopback");
  const seat = session.createSeat(0, human);
  const oldBot = session.createClient(2);
  const nextBot = session.prepareClient(1);
  nextBot.connect("loopback");
  let candidateResourceCloses = 0;
  nextBot.worldResources.defer(() => { candidateResourceCloses++; return undefined; });
  const next = simulation();
  const replacement = session.replaceWorld(next, [], { added: [nextBot], removed: [oldBot] });
  expect(session.world?.simulation).toBe(next);
  expect(oldBot.isClosed).toBe(false);
  expect(human.connection).toBe(connection);
  expect(seat.client).toBe(human);
  expect(candidateResourceCloses).toBe(0);
  expect(session.createSeat(1, nextBot).client).toBe(nextBot);
  replacement.retired.close();
  expect(oldBot.isClosed).toBe(true);
  expect(nextBot.isClosed).toBe(false);
  expect(candidateResourceCloses).toBe(0);
  session.close();
  expect(candidateResourceCloses).toBe(1);
});

test("invalid client publication leaves world and local seats untouched", () => {
  const { session, simulation, input, output } = stepFixture("local");
  const world = session.attachWorld(simulation());
  const human = session.createClient(0), seat = session.createSeat(0, human);
  const first = session.prepareClient(1), second = session.prepareClient(1);
  expect(() => session.replaceWorld(simulation(), [], { added: [first, second], removed: [] })).toThrow("Duplicate prepared client slot");
  expect(() => session.replaceWorld(simulation(), [], { added: [first], removed: [human] })).toThrow("local seat");
  const occupied = session.createClient(1);
  expect(() => session.replaceWorld(simulation(), [], { added: [first], removed: [] })).toThrow("occupied");
  expect(session.world).toBe(world);
  expect(human.isClosed).toBe(false);
  expect(occupied.isClosed).toBe(false);
  expect(first.isClosed).toBe(false);
  expect(second.isClosed).toBe(false);
  expect(seat.client).toBe(human);
  expect(session.step(input)).toBe(output);
  first.close(); second.close();
  session.close();
});

test("session shutdown owns unpublished prepared-client cleanup", () => {
  const { session } = stepFixture();
  const prepared = session.prepareClient(3);
  let closes = 0;
  prepared.resources.defer(() => { closes++; return undefined; });
  session.close();
  expect(prepared.isClosed).toBe(true);
  expect(closes).toBe(1);
  prepared.close();
  expect(closes).toBe(1);
});


test("failed world preflight leaves shared keys capture and profile untouched", () => {
  const fixture = stepFixture("local"), foreign = stepFixture();
  const world = fixture.session.attachWorld(fixture.simulation()), client = fixture.session.createClient(0), seat = fixture.session.createSeat(0, client);
  const context: CommandContext = { session: fixture.session.session, origin: { kind: "local-seat", seat: seat.id, client: client.id } };
  const commands = new CommandBuffer({ dialect: "q2-classic", context });
  const input = new SeatInput({ seat: seat.id, dialect: "q2-classic", context, commands, uiEvent: () => false });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "action", action: "forward" } });
  let relative = false, closed = false;
  const router = new InputRouter({ seats: [{ input, controller: { kind: "none" } }], keyboardSeat: seat.id, controllers: null, now: () => 0, ticks: () => 0, subframe: false, unhandled: () => {} });
  router.attachWindow({ beginInput: () => ({ get closed() { return closed; }, close: () => { closed = true; }, setRelativeMouse: value => { relative = value; } }),
    logicalSize: { width: 320, height: 240 }, drawableSize: { width: 320, height: 240 }, pollEvents: () => [] });
  input.input({ kind: "key", seat: seat.id, code: 119, down: true, repeat: false, timeMilliseconds: 0 });
  const resources = client.worldResources;
  expect(() => fixture.session.validateWorldReplacement(foreign.simulation())).toThrow("another session");
  expect(input.hasHeldInput).toBe(true); expect(input.button("forward").active).toBe(true); expect(relative).toBe(true); expect(closed).toBe(false);
  expect(input.dialect).toBe("q2-classic"); expect(commands.dialect).toBe("q2-classic"); expect(fixture.session.world).toBe(world); expect(client.worldResources).toBe(resources);
  fixture.session.validateWorldReplacement(fixture.simulation()); expect(fixture.session.world).toBe(world); expect(client.worldResources).toBe(resources);
  router.close(); fixture.session.close(); foreign.session.close();
});

test("a staged local player replaces an occupied bot slot only when the next world publishes", () => {
  const { session, simulation } = stepFixture("local");
  const oldWorld = session.attachWorld(simulation());
  const first = session.createClient(0), firstSeat = session.createSeat(0, first), connection = first.connect("loopback");
  const bot = session.createClient(1), botConnection = bot.connect("loopback");
  const player = session.prepareClient(1, bot), seat = session.prepareSeat(1, player);
  expect(session.clientAt(1)).toBe(bot);
  expect(player.id.generation).toBeGreaterThan(bot.id.generation);
  expect(() => session.replaceWorld(simulation(), [], { added: [player], removed: [] }, { added: [seat], removed: [] })).toThrow("incumbent");
  expect(session.world).toBe(oldWorld); expect(firstSeat.isClosed).toBe(false); expect(botConnection.isClosed).toBe(false);
  const next = session.replaceWorld(simulation(), [], { added: [player], removed: [bot] }, { added: [seat], removed: [] });
  expect(session.clientAt(1)).toBe(player); expect(session.clientAt(0)).toBe(first);
  expect(first.connection).toBe(connection); expect(seat.client).toBe(player);
  expect(() => session.createSeat(1, player)).toThrow("occupied");
  expect(bot.isClosed).toBe(false); expect(oldWorld.isClosed).toBe(false);
  next.retired.close();
  expect(bot.isClosed).toBe(true); expect(botConnection.isClosed).toBe(true); expect(oldWorld.isClosed).toBe(true);
  expect(seat.isClosed).toBe(false); expect(firstSeat.isClosed).toBe(false);
  const replacementBot = session.prepareClient(1, player);
  const shrink = session.replaceWorld(simulation(), [], { added: [replacementBot], removed: [player] }, { added: [], removed: [seat] });
  expect(seat.isClosed).toBe(false); expect(session.clientAt(1)).toBe(replacementBot);
  shrink.retired.close(); expect(seat.isClosed).toBe(true); expect(player.isClosed).toBe(true);
  expect(replacementBot.isClosed).toBe(false); expect(firstSeat.isClosed).toBe(false);
  session.close(); expect(replacementBot.isClosed).toBe(true);
});

test("client and seat replacement validates both captured owners before changing either", () => {
  const { session, simulation } = stepFixture("local");
  const world = session.attachWorld(simulation()), oldClient = session.createClient(0), oldSeat = session.createSeat(0, oldClient);
  const oldResources = oldClient.worldResources;
  const client = session.prepareClient(0, oldClient), seat = session.prepareSeat(0, client, oldSeat);
  expect(() => session.replaceWorld(simulation(), [], { added: [client], removed: [oldClient] })).toThrow("local seat");
  expect(() => session.replaceWorld(simulation(), [], { added: [client], removed: [oldClient] }, { added: [seat], removed: [] })).toThrow("local seat");
  expect(session.world).toBe(world); expect(oldClient.worldResources).toBe(oldResources); expect(oldSeat.isClosed).toBe(false);
  const next = session.replaceWorld(simulation(), [], { added: [client], removed: [oldClient] }, { added: [seat], removed: [oldSeat] });
  expect(session.clientAt(0)).toBe(client); expect(oldSeat.isClosed).toBe(false);
  next.retired.close(); expect(oldSeat.isClosed).toBe(true); expect(oldClient.isClosed).toBe(true);
  expect(seat.isClosed).toBe(false); expect(client.isClosed).toBe(false);
  session.closeClient(oldClient.id); expect(client.isClosed).toBe(false);
  session.close(); expect(seat.isClosed).toBe(true);
});

test("discarded seats on retained clients leave their live connection and presentation resources alone", () => {
  const { session, simulation } = stepFixture("local");
  const world = session.attachWorld(simulation()), client = session.createClient(0), oldSeat = session.createSeat(0, client);
  const connection = client.connect("loopback"), resources = client.worldResources;
  const candidate = session.prepareSeat(0, client, oldSeat);
  expect(() => session.replaceWorld(simulation(), [], { added: [], removed: [] }, { added: [candidate], removed: [] })).toThrow("incumbent");
  candidate.close();
  expect(session.world).toBe(world); expect(client.connection).toBe(connection); expect(client.worldResources).toBe(resources);
  expect(oldSeat.isClosed).toBe(false); expect(connection.isClosed).toBe(false);
  const nextSeat = session.prepareSeat(1, client);
  const next = session.replaceWorld(simulation(), [], { added: [], removed: [] }, { added: [nextSeat], removed: [] });
  next.retired.close(); expect(nextSeat.isClosed).toBe(false); expect(oldSeat.isClosed).toBe(false);
  const unselected = session.prepareSeat(2, client);
  session.close(); expect(unselected.isClosed).toBe(true); expect(nextSeat.isClosed).toBe(true);
});

test("stale and duplicate staged owners cannot replace a newer published client or seat", () => {
  const { session, simulation } = stepFixture("local");
  const world = session.attachWorld(simulation()), oldClient = session.createClient(0), oldSeat = session.createSeat(0, oldClient);
  const candidate = session.prepareClient(0, oldClient), seat = session.prepareSeat(0, candidate, oldSeat);
  session.closeClient(oldClient.id);
  const current = session.createClient(0), currentSeat = session.createSeat(0, current);
  expect(() => session.prepareClient(0, oldClient)).toThrow("current slot owner");
  expect(() => session.prepareSeat(0, candidate, oldSeat)).toThrow("current index owner");
  expect(() => session.replaceWorld(simulation(), [], { added: [candidate], removed: [current] }, { added: [seat], removed: [currentSeat] })).toThrow("incumbent");
  expect(session.world).toBe(world); expect(session.clientAt(0)).toBe(current); expect(currentSeat.isClosed).toBe(false);
  const duplicate = session.prepareSeat(1, current);
  expect(() => session.replaceWorld(simulation(), [], { added: [], removed: [] }, { added: [duplicate, duplicate], removed: [] })).toThrow("Duplicate prepared seat");
  expect(() => session.replaceWorld(simulation(), [], { added: [], removed: [] }, { added: [], removed: [currentSeat, currentSeat] })).toThrow("Duplicate retired seat");
  session.close(); expect(candidate.isClosed).toBe(true); expect(seat.isClosed).toBe(true); expect(duplicate.isClosed).toBe(true);
});

test("connection publication defers old-channel cleanup without clearing active world resources", () => {
  const { session, simulation } = stepFixture("local");
  const world = session.attachWorld(simulation()), client = session.createClient(0), seat = session.createSeat(0, client);
  const resources = client.worldResources, old = client.connect("loopback");
  const activeResources = client.worldResources;
  let retired = 0, activeClosed = 0;
  old.defer(() => { retired++; throw new Error("old channel cleanup"); });
  activeResources.defer(() => { activeClosed++; return undefined; });
  const next = client.replaceConnection("remote");
  expect(next.retired).toBe(old); expect(client.connection).toBe(next.connection);
  expect(next.connection.kind).toBe("remote"); expect(old.isClosed).toBe(false);
  expect(client.worldResources).toBe(activeResources); expect(session.world).toBe(world);
  expect(seat.isClosed).toBe(false); expect(activeClosed).toBe(0); expect(retired).toBe(0);
  expect(resources.isClosed).toBe(true);
  expect(() => next.retired?.close()).toThrow(AggregateError);
  expect(retired).toBe(1); expect(client.connection).toBe(next.connection); expect(activeClosed).toBe(0);
  const fresh = client.connect("demo");
  expect(next.connection.isClosed).toBe(true); expect(fresh.kind).toBe("demo"); expect(activeClosed).toBe(1);
  session.close(); expect(fresh.isClosed).toBe(true); expect(retired).toBe(1);
});

test("retiring the first client preserves survivor controls and device routes without inheriting queued commands", () => {
  const session = new EngineSession(createIdentityOwner("retired-first-local"), { kind: "local" });
  const first = session.createClient(0), second = session.createClient(1);
  const firstSeat = session.createSeat(0, first), secondSeat = session.createSeat(1, second);
  const local = (seat: typeof firstSeat): CommandContext => ({ session: session.session,
    origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } });
  const firstContext = local(firstSeat), secondContext = local(secondSeat), calls: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: firstContext });
  commands.register("mark", command => { calls.push(command.args[0] ?? ""); return undefined; });
  const inputs = [firstSeat, secondSeat].map(seat => {
    const input = new SeatInput({ seat: seat.id, dialect: "q3", context: local(seat), commands, uiEvent: () => false });
    input.bind({ input: { kind: "key", code: 119 }, target: { kind: "action", action: "forward" } });
    input.bind({ input: { kind: "controller-button", device: 22, button: 0 }, target: { kind: "action", action: "attack" } });
    return input;
  });
  const removed = inputs[0], retained = inputs[1]; if (removed === undefined || retained === undefined) throw new Error("Missing inputs");
  const router = new InputRouter({ seats: inputs.map(input => ({ input, controller: { kind: "automatic" } })), keyboardSeat: firstSeat.id,
    controllers: null, now: () => 10, ticks: () => 10, subframe: false, unhandled: () => {} });
  const release = spyOn(removed, "release");
  try {
    router.handleController({ kind: "assignment", timestamp: 1, slot: 1, previous: null, instance: 22 });
    for (const input of inputs) input.input({ kind: "key", seat: input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 2 });
    router.handleController({ kind: "button", timestamp: 2, slot: 1, instance: 22, button: 0, down: true });
    commands.append("wait;mark retired\n", firstContext); commands.execute();
    commands.append("mark survivor\n", secondContext);
    router.retainSeats([secondSeat.id], secondSeat.id); commands.discardClient(first.id); session.closeClient(first.id);
    commands.execute();
    expect(calls).toEqual(["survivor"]); expect(release).toHaveBeenCalledTimes(1);
    expect(firstSeat.isClosed).toBe(true); expect(secondSeat.isClosed).toBe(false);
    expect(removed.button("forward").active).toBe(false); expect(retained.button("forward").active).toBe(true);
    expect(retained.button("attack").active).toBe(true); expect(router.keyboardSeat()).toEqual(secondSeat.id);
    expect(router.controllerFor(secondSeat.id)).toBe(22);
    router.handleController({ kind: "button", timestamp: 3, slot: 1, instance: 22, button: 0, down: false });
    expect(retained.button("attack").active).toBe(false);
    router.handleController({ kind: "assignment", timestamp: 4, slot: 0, previous: null, instance: 33 });
    expect(router.controllerFor(secondSeat.id)).toBe(22);
    const replacement = session.createClient(0);
    expect(() => commands.append("mark stale\n", firstContext)).toThrow("disconnected");
    commands.append("mark replacement\n", { session: session.session, origin: { kind: "remote-client", client: replacement.id } });
    commands.execute(); expect(calls).toEqual(["survivor", "replacement"]);
  } finally { release.mockRestore(); router.close(); session.close(); }
});
