import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";
import { subscribeModClientInput } from "../../../src/world/session/mod-client-input.ts";
import type { ModClientServices } from "../../../src/world/session/mod-clients.ts";

function fixture() {
  const owner = createIdentityOwner("component-input"), actor = owner.actor(1, 0), client = owner.client(0, 0);
  let live = true;
  const applications = new ModClientApplications(() => live);
  const services: ModClientServices = { maximum: 1, clients: () => live ? [{ actor, client }] : [],
    actor: current => live && current.equals(client) ? actor : null,
    forActor: current => live && current.equals(actor) ? client : null,
    userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
    subscribe: () => () => undefined, subscribeApplication: listener => applications.subscribe(listener) };
  const input = { identity: { actor, client }, scope: "client-command", command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0,
    viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    angleSpace: "absolute", absoluteAim: { x: 0, y: 0, z: 0 }, accepted: null,
    frame: { frame: 1, phase: "client-command", time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.02 } },
  } satisfies Parameters<ModClientApplications["begin"]>[0];
  return { services, applications, input, remove: () => { live = false; applications.release(actor); } };
}

test("authored input preserves nested contexts and skips terminal calls after removal", () => {
  const f = fixture(), calls: string[] = [];
  let current = 0;
  const stop = subscribeModClientInput(f.services, [
    { scope: "client-command", phase: "before", calls: ["enter"] },
    { scope: "client-command", phase: "after", calls: ["finish", "late"] },
  ], {
    open: application => {
      const previous = current; current = application.invocation;
      return () => { calls.push(`close:${current}`); current = previous; };
    },
    invoke: (call, application) => {
      expect(current).toBe(application.invocation);
      calls.push(`${call}:${current}`);
      if (call === "enter" && current === 1) {
        const nested = f.applications.begin(f.input); f.applications.finish(nested);
        expect(current).toBe(1);
      }
      if (call === "finish" && current === 1) f.remove();
    },
  });
  f.applications.finish(f.applications.begin(f.input));
  expect(calls).toEqual(["enter:1", "enter:2", "finish:2", "late:2", "close:2", "finish:1", "close:1"]);
  expect(current).toBe(0); expect(f.applications.checkpoint()).toBe(2);
  stop();
});

test("after-only input opens once and retains callback and cleanup failures", () => {
  const f = fixture(), original = new Error("source failed"), cleanup = new Error("cleanup failed");
  let opened = 0, invoked = 0, closed = 0;
  const stop = subscribeModClientInput(f.services, [{ scope: "client-command", phase: "after", calls: ["finish"] }], {
    open: () => { opened++; return () => { closed++; throw cleanup; }; },
    invoke: () => { invoked++; throw original; },
  });
  const application = f.applications.begin(f.input);
  expect(opened).toBe(1); expect(invoked).toBe(0);
  try { f.applications.finish(application); throw new Error("Expected failure"); }
  catch (error) {
    if (!(error instanceof AggregateError)) throw error;
    const failures: unknown = error.errors;
    expect(failures).toEqual([original, cleanup]);
  }
  expect(closed).toBe(1); expect(f.applications.checkpoint()).toBe(1);
  stop();
});

test("removal during input opening closes the returned context without executing source", () => {
  const f = fixture(); let closed = 0;
  const stop = subscribeModClientInput(f.services, [{ scope: "client-command", phase: "before", calls: ["enter"] }], {
    open: () => { f.remove(); return () => { closed++; }; },
    invoke: () => { throw new Error("Retired source called"); },
  });
  f.applications.finish(f.applications.begin(f.input));
  expect(closed).toBe(1); expect(f.applications.checkpoint()).toBe(1);
  stop();
});

for (const retireAt of ["open", "after"]) test(`nested ${retireAt} removal unwinds inner input before the retired parent`, () => {
  const f = fixture(), closed: number[] = []; let current = 0;
  const stop = subscribeModClientInput(f.services, [
    { scope: "client-command", phase: "before", calls: ["nest"] },
    { scope: "client-command", phase: "after", calls: ["finish"] },
  ], {
    open: application => {
      const previous = current; current = application.invocation;
      if (current === 2 && retireAt === "open") f.remove();
      return () => { closed.push(current); current = previous; };
    },
    invoke: (call, application) => {
      if (call === "nest" && application.invocation === 1) f.applications.finish(f.applications.begin(f.input));
      if (call === "finish" && application.invocation === 2 && retireAt === "after") f.remove();
    },
  });
  f.applications.finish(f.applications.begin(f.input));
  expect(closed).toEqual([2, 1]); expect(current).toBe(0); expect(f.applications.checkpoint()).toBe(2);
  stop();
});

test("before outputs compose without changing retained receipt or unrelated command fields", () => {
  const f = fixture();
  const command = { kind: "q3", serverTimeMilliseconds: 120, angleWords: [12, 13, 14], buttons: 129, weapon: 7,
    forwardMove: 99, rightMove: -31, upMove: 127 } satisfies import("../../../src/contracts/protocol.ts").UserCommand;
  const arsenal = { provider: "q1:weapons", weapon: null, impulse: 9, useHoldable: false } satisfies import("../../../src/contracts/gameplay.ts").ArsenalIntent;
  const receipt = { input: { actor: f.input.identity.actor, sequence: 4, source: { kind: "remote-client", client: f.input.identity.client }, command, arsenal },
    time: { kind: "seconds", value: 1 } } satisfies import("../../../src/world/session/mod-clients.ts").ModClientCommand;
  let first: import("../../../src/world/session/mod-clients.ts").ModClientApplication | undefined;
  f.applications.subscribe(event => {
    if (event.phase === "before") { first = event.application; event.output({ kind: "consume", inputs: ["jump", "attack", "impulse"] }); }
    return undefined;
  });
  f.applications.subscribe(event => {
    if (event.phase === "before") {
      expect(event.application === first).toBe(true);
      expect(event.application.command).toEqual({ ...command, upMove: 0, buttons: 128 });
      expect(event.application.controls?.impulse).toBe(0); expect(event.application.arsenal?.impulse).toBe(0);
      event.output({ kind: "set", input: "forward-move", value: 0.5 });
    }
    return undefined;
  });
  const app = f.applications.begin({ ...f.input, command, arsenal, accepted: receipt });
  expect(app?.command).toEqual({ ...command, upMove: 0, buttons: 128, forwardMove: 63 });
  expect(app?.accepted?.input.command).toBe(command); expect(command.upMove).toBe(127);
  expect(app?.accepted?.input.arsenal?.impulse).toBe(9);
  f.applications.finish(app);
});

test("aim output encodes against current source delta and output capability expires", () => {
  const f = fixture(); let delta = 0;
  let retained: ((value: import("../../../src/contracts/mod-callbacks.ts").ModClientInputOutput) => undefined) | undefined;
  f.applications.subscribe(event => {
    if (event.phase === "before") { delta = 400; retained = event.output; event.output({ kind: "set", input: "view-angles", value: { x: 0, y: 90, z: 0 } }); }
    return undefined;
  });
  const input = { ...f.input, command: { kind: "q3", serverTimeMilliseconds: 120, angleWords: [0, 0, 0], buttons: 0, weapon: 7, forwardMove: 0, rightMove: 0, upMove: 0 } } satisfies Parameters<ModClientApplications["begin"]>[0];
  const app = f.applications.begin(input, (aim, current) => {
    if (current.kind !== "q3") throw new Error("Wrong command");
    return { ...current, angleWords: [0, Math.trunc(aim.y * 65536 / 360) - delta, 0] };
  });
  expect(app?.command).toMatchObject({ angleWords: [0, 15984, 0], weapon: 7 });
  expect(() => retained?.({ kind: "consume", inputs: ["attack"] })).toThrow("outside its live before callback");
  f.applications.finish(app);
  expect(() => retained?.({ kind: "consume", inputs: ["attack"] })).toThrow("outside its live before callback");
});

test("nested output cannot change suspended parent even if the source catches rejection", () => {
  const f = fixture();
  let outer: ((value: import("../../../src/contracts/mod-callbacks.ts").ModClientInputOutput) => undefined) | undefined;
  f.applications.subscribe(event => {
    if (event.phase !== "before") return undefined;
    if (event.application.parentInvocation === null) {
      outer = event.output;
      const nested = f.applications.begin(f.input); f.applications.finish(nested);
    } else { try { outer?.({ kind: "set", input: "attack", value: 1 }); } catch {} }
    return undefined;
  });
  expect(() => f.applications.begin(f.input)).toThrow("outside its live before callback");
  expect(f.applications.checkpoint()).toBe(2);
});


test("finite output must remain representable in the destination movement ABI", () => {
  const f = fixture();
  f.applications.subscribe(event => {
    if (event.phase === "before") event.output({ kind: "set", input: "forward-move", value: 1e38 });
    return undefined;
  });
  const command = { kind: "q2-rerelease", milliseconds: 33, angles: { x: 0, y: 0, z: 0 }, forwardMove: 20, sideMove: 0, buttons: 0, serverFrame: 19 } satisfies import("../../../src/contracts/protocol.ts").UserCommand;
  expect(() => f.applications.begin({ ...f.input, command })).toThrow("exceeds destination command ABI");
  expect(command.forwardMove).toBe(20); expect(f.applications.checkpoint()).toBe(1);
});
