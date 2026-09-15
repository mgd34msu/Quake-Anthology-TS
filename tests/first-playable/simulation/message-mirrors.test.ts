import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SimulationEvents } from "../../../src/app/bootstrap/simulation/events.ts";
import { SessionActorRegistry, SharedBodyTable } from "../../../src/world/actors/index.ts";

test("source message mirrors carry their exact presentation identity without tagging unrelated identical text", () => {
  const identity = createIdentityOwner("message-mirrors"), actors = new SessionActorRegistry(identity);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => body.bounds, onLink: () => undefined, onUnlink: () => undefined });
  const first = identity.actor(0, 0), second = identity.actor(1, 0);
  const events = new SimulationEvents(bodies, () => ({ kind: "seconds", value: 1 }), actor => identity.client(actor.slot, 0), actor => actor.slot);
  events.message({ kind: "print", level: 2, text: "$unknown_mod" });
  events.emit("q2:rerelease:baseq2:retail", { kind: "q2", event: { kind: "lightstyle", style: 0, pattern: "m" } });
  events.emit("q2:rerelease:baseq2:retail", { kind: "q2", event: { kind: "help", slot: 1, text: "$unknown_mod" } });
  events.emit("q2:rerelease:baseq2:retail", { kind: "q2", event: { kind: "centerprint", actor: first, text: "$unknown_mod" } });
  events.emit("q2:rerelease:baseq2:retail", { kind: "q2", event: { kind: "centerprint", actor: second, text: "$unknown_mod" } });
  events.emit("q1:rerelease:id1:retail", { kind: "q1", event: { kind: "message", player: first, center: false, text: "$unknown_mod" } });
  events.message({ kind: "print", level: 2, text: "$unknown_mod" });
  const output = events.take(), source = events.takePresentation();
  expect(output).toHaveLength(6);
  expect(source).toHaveLength(5);
  expect(output.map(event => event.payload.kind === "message" ? event.payload.sourcePresentationSequence : null)).toEqual([undefined, 1, 2, 3, 4, undefined]);
  expect(output[2]?.audience).toEqual({ kind: "client", client: identity.client(0, 0) });
  expect(output[3]?.audience).toEqual({ kind: "client", client: identity.client(1, 0) });
  expect(output.every(event => event.payload.kind === "message" && "text" in event.payload.event && event.payload.event.text === "$unknown_mod")).toBe(true);
  expect(output[0]?.payload).toEqual({ kind: "message", event: { kind: "print", level: 2, text: "$unknown_mod" } });
});
