// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/index.ts";
import { ClassicQ2Cvars, ClassicQ2Edicts, readClassicString } from "../../../../src/compat/q2/classic/index.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("API 3 raw records"));
  const memory = new SparseGuestMemory({ pointerBytes: 4, module: { id: "test:raw-q2", artifactPath: "authored", revision: "1", digest: createContentDigest("44".repeat(32)) } });
  const exports = memory.allocate({ byteLength: 80 }), base = memory.allocate({ byteLength: 320 * 3 });
  memory.writeInt32(exports, 3); memory.writePointer(memory.offset(exports, 64n), base);
  memory.writeInt32(memory.offset(exports, 68n), 320); memory.writeInt32(memory.offset(exports, 72n), 3); memory.writeInt32(memory.offset(exports, 76n), 3);
  const edicts = new ClassicQ2Edicts(memory, exports, actors, "test:native", () => undefined);
  return { actors, memory, exports, base, edicts };
}
test("raw edicts preserve source stride and private bytes while actor generations follow observed frees", () => {
  const { memory, actors, edicts } = fixture(), record = edicts.at(2);
  record.bytes.setInt32(88, 1, true); record.bytes.setUint32(316, 0xcafebabe, true);
  const actor = edicts.observe(record.address); if (actor === null) throw new Error("Missing actor");
  expect(edicts.pointer(actor.id)).toEqual(record.address);
  expect(memory.readUint32(memory.offset(record.address, 316n))).toBe(0xcafebabe);
  record.bytes.setInt32(88, 0, true); edicts.reconcile();
  expect(actors.isLive(actor.id)).toBe(false); expect(record.currentActor()).toBeNull();
  record.bytes.setInt32(88, 1, true); edicts.reconcile();
  expect(record.currentActor()?.generation).toBeGreaterThan(actor.id.generation);
  expect(() => edicts.fromPointer(memory.offset(record.address, 4n))).toThrow("start of an API 3 edict");
  expect(() => edicts.at(3)).toThrow("num_edicts");
});
test("raw edict descriptor rejects truncated public prefixes and count overflow", () => {
  const { memory, exports, edicts } = fixture();
  memory.writeInt32(memory.offset(exports, 68n), 256);
  expect(() => edicts.descriptor()).toThrow("Invalid source API 3 edict descriptor");
  memory.writeInt32(memory.offset(exports, 68n), 320); memory.writeInt32(memory.offset(exports, 72n), 4);
  expect(() => edicts.descriptor()).toThrow("Invalid source API 3 edict descriptor");
});
test("current primary records resolve without allocating and reject retired input lifetimes", () => {
  const { actors, edicts, memory, exports } = fixture(), record = edicts.at(1);
  expect(edicts.current(record)).toBeNull(); expect(actors.observations()).toHaveLength(0);
  const actor = edicts.retainClient(1);
  expect(edicts.current(record)).toBe(actor);
  edicts.retireInputClient(1); expect(edicts.current(record)).toBeNull();
  edicts.finishInputRetirement(1); expect(edicts.current(record)).toBe(actor);
  const replacement = memory.allocate({ byteLength: 320 * 3 });
  memory.writePointer(memory.offset(exports, 64n), replacement);
  expect(edicts.current(record)).toBeNull(); expect(actors.observations()).toHaveLength(1);
});
test("cvar_t pointer stays stable and reflects existing registry values, latch and source list", () => {
  const { memory, actors } = fixture();
  const registry = new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
  registry.register("gravity", "800", 16); registry.register("deathmatch", "1", 0);
  const cvars = new ClassicQ2Cvars(memory, registry), gravity = cvars.pointer("gravity"), deathmatch = cvars.pointer("deathmatch");
  if (gravity === null || deathmatch === null) throw new Error("Missing guest cvar");
  expect(memory.readPointer(memory.offset(deathmatch, 24n))).toEqual(gravity);
  expect(memory.readFloat32(memory.offset(gravity, 20n))).toBe(800);
  registry.setServerActive(true); registry.set("gravity", "200"); cvars.refresh();
  expect(readClassicString(memory, memory.readPointer(memory.offset(gravity, 8n)))).toBe("200");
  expect(memory.readFloat32(memory.offset(gravity, 20n))).toBe(800);
  registry.set("gravity", "400", true); cvars.refresh();
  expect(cvars.pointer("gravity")).toEqual(gravity); expect(memory.readFloat32(memory.offset(gravity, 20n))).toBe(400);
  expect(memory.readPointer(memory.offset(gravity, 8n))).toBeNull();
});

test("connected source client retains one actor before ClientBegin without setting inuse", () => {
  const { actors, edicts } = fixture(), record = edicts.at(1);
  const actor = edicts.retainClient(1);
  expect(record.bytes.getInt32(88, true)).toBe(0); expect(record.currentActor()).toEqual(actor.id);
  edicts.reconcile(); expect(record.currentActor()).toEqual(actor.id);
  record.bytes.setInt32(88, 1, true); edicts.reconcile(); expect(record.currentActor()).toEqual(actor.id);
  record.bytes.setInt32(88, 0, true); edicts.reconcile(); expect(actors.isLive(actor.id)).toBe(true);
  edicts.releaseClient(1); expect(record.currentActor()).toBeNull(); expect(actors.isLive(actor.id)).toBe(false);
});
