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
