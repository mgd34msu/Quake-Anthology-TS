import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { BodyState } from "../../../src/contracts/world.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";

function state() {
  return { origin: { x: -0, y: 2, z: 3 }, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 4, y: 5, z: 6 },
    bounds: { min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 3 } }, ground: null };
}
function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("body storage"));
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const actor = actors.allocate("q1:game", "q1:player");
  return { actors, bodies, actor };
}

test("local body snapshots stay deeply immutable and isolated across writes and links", () => {
  const { actors, bodies, actor } = fixture(), ground = actors.allocate("q2:game", "q2:platform");
  const input = { ...state(), ground: ground.id };
  bodies.create(actor, input);
  const first = bodies.read(actor.id);
  if (first === null) throw Error("Body absent");
  expect(first).not.toBe(input);
  expect(bodies.read(actor.id)).toBe(first);
  for (const value of [first, first.origin, first.angles, first.velocity, first.bounds, first.bounds.min, first.bounds.max]) expect(Object.isFrozen(value)).toBe(true);
  expect(Object.is(first.origin.x, -0)).toBe(true);
  expect(first.ground).toBe(ground.id);
  input.origin.x = 99; input.bounds.min.x = -99;
  expect(first.origin.x).toBe(-0); expect(first.bounds.min.x).toBe(-1);
  bodies.link(actor, { x: 5, y: 6, z: 7 });
  const linked = bodies.linked(actor.id);
  expect(linked?.state.origin.x).toBe(5); expect(bodies.read(actor.id)).toBe(first);
  bodies.write(actor, { ...state(), origin: { x: 20, y: 0, z: 0 }, ground: ground.id });
  expect(bodies.read(actor.id)).not.toBe(first);
  expect(first.origin.x).toBe(-0); expect(bodies.linked(actor.id)).toBe(linked);
  expect(bodies.read(actor.id)?.origin.x).toBe(20);
  actors.release(actor); expect(bodies.read(actor.id)).toBeNull();
  expect(() => bodies.write(actor, state())).toThrow();
});

test("external reads and writes retain copies and callback order, including saved links", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("external body")), calls: string[] = [];
  const actor = actors.allocate("qc:game", "qc:player");
  let external: BodyState = state();
  const bodies = new SharedBodyTable(actors, {
    absoluteBounds: (owner, current) => { calls.push("bounds"); return translatedBodyBounds(owner, current); },
    onLink: () => { calls.push("onLink"); return undefined; }, onUnlink: () => { calls.push("onUnlink"); return undefined; },
  });
  bodies.bind(actor, {
    read: () => { calls.push("read"); return external; },
    write: value => { calls.push("write"); external = value; return undefined; },
    linked: () => { calls.push("linked"); return undefined; },
  });
  const first = bodies.read(actor.id), second = bodies.read(actor.id);
  expect(first).toEqual(second); expect(first).not.toBe(second); expect(first).not.toBe(external);
  const input = state(); bodies.write(actor, input);
  expect(external).not.toBe(input); expect(Object.isFrozen(external.origin)).toBe(true);
  bodies.link(actor);
  expect(calls).toEqual(["read", "read", "write", "read", "bounds", "linked", "onLink"]);
  const saved = bodies.linkState(actor.id);
  if (saved === null) throw Error("Link missing");
  calls.length = 0; bodies.restoreLinkState(actor, saved);
  expect(calls).toEqual(["linked", "onLink"]);
  expect(bodies.linkState(actor.id)).toEqual(saved);
  calls.length = 0; bodies.unlink(actor); bodies.unlink(actor);
  expect(calls).toEqual(["onUnlink"]);
});

test("collision reuses owned immutable bodies and refreshes them after writes", () => {
  const { actors, bodies, actor } = fixture(), scene = createSceneQueries(decodeQ3World(q3Fixture()));
  bodies.create(actor, state()); bodies.link(actor);
  const linked = bodies.linked(actor.id), initial = bodies.read(actor.id);
  if (linked === null || initial === null) throw Error("Body absent");
  scene.link(linked, { family: "q3", shape: { kind: "box" }, contents: 1, owner: null, role: "solid", monster: false, deadMonster: false });
  scene.bindActorState(bodies);
  const before = scene.linkedActor(actor.id);
  expect(before?.body.state).toBe(initial);
  bodies.write(actor, { ...state(), origin: { x: 20, y: 0, z: 0 } });
  const updated = bodies.read(actor.id);
  if (updated === null) throw Error("Body absent after write");
  expect(scene.linkedActor(actor.id)?.body.state).toBe(updated);
  expect(before?.body.state.origin.x).toBe(-0);
  actors.release(actor); expect(scene.linkedActor(actor.id)).toBeNull();
});

test("local attachments preserve old snapshots and share anchor release lifetime", () => {
  const { actors, bodies, actor } = fixture(), child = actors.allocate("q3:game", "q3:item");
  bodies.create(actor, state()); bodies.write(child, state());
  const previous = bodies.read(child.id);
  bodies.attach(child, { anchor: actor.id, follow: { kind: "translation", offset: { x: 1, y: 0, z: 0 } } });
  bodies.transportAttachments(createNumericOperations(Q3_BINARY32_PROFILE));
  expect(previous?.origin.x).toBe(-0); expect(bodies.read(child.id)?.origin.x).toBe(1);
  expect(bodies.linked(child.id)?.state.origin.x).toBe(1);
  expect(() => bodies.attach(actor, { anchor: child.id, follow: { kind: "center" } })).toThrow("cycle");
  actors.release(actor); expect(actors.isLive(child.id)).toBe(false); expect(bodies.read(child.id)).toBeNull();
});

test("external callback failures keep publication order and local failed copies retain the old snapshot", () => {
  const { bodies, actor } = fixture();
  bodies.create(actor, state()); const before = bodies.read(actor.id);
  const invalid = { ...state(), get origin(): BodyState["origin"] { throw Error("copy rejected"); } };
  expect(() => bodies.write(actor, invalid)).toThrow("copy rejected"); expect(bodies.read(actor.id)).toBe(before);
  expect(() => bodies.create(actor, state())).toThrow("already has");
  const external = fixture(); let writes = 0;
  external.bodies.bind(external.actor, { read: () => state(), write: () => { writes++; throw Error("external write"); }, linked: () => { throw Error("external link"); } });
  expect(() => external.bodies.write(external.actor, state())).toThrow("external write"); expect(writes).toBe(1);
  expect(() => external.bodies.link(external.actor)).toThrow("external link"); expect(external.bodies.linked(external.actor.id)?.linkCount).toBe(1);
});
