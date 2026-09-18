import { SaveReader } from "../../../src/persistence/value.ts";
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


test("persistent source replay follows sequence after replacement and retired recipients never broadcast", () => {
  const identity = createIdentityOwner("persistent-replay"), actors = new SessionActorRegistry(identity);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => body.bounds, onLink: () => undefined, onUnlink: () => undefined });
  const events = new SimulationEvents(bodies, () => ({ kind: "seconds", value: 1 }), () => null, actor => actor.slot);
  const content = "q1:rerelease:id1:retail";
  events.emit(content, {kind:"music",event:{kind:"cd-track",track:1}});
  events.emit(content, {kind:"q1",event:{kind:"static-model",path:"progs/flame.mdl",frame:0,colorMap:0,skin:0,origin:{x:0,y:0,z:0},angles:{x:0,y:0,z:0}}});
  events.emit(content, {kind:"music",event:{kind:"cd-track",track:2}});
  expect(events.persistentPresentation().map(event => event.sequence)).toEqual([1,2]);
  const saved = events.capture();
  events.restore(new SaveReader(saved,"events"), value => identity.actor(value.slot,value.generation));
  expect(events.takePresentation().map(event => event.sequence)).toEqual([1,2]);
  events.message({kind:"print",level:2,text:"private"},identity.actor(1,1));
  expect(events.take()).toEqual([]);
  events.message({kind:"print",level:2,text:"world"});
  expect(events.take().map(event=>event.audience.kind)).toEqual(["world"]);
});
