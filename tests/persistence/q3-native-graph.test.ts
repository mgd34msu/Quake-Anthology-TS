import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../src/world/gameplay/index.ts";
import { Q3EntityRecords } from "../../src/content/q3/base/records.ts";
import { EntityPool } from "../../src/content/q3/base/game/entities.ts";
import { captureQ3Graph, prepareQ3Graph, restoreQ3Graph } from "../../src/content/q3/base/game/save-state.ts";
import { readQ3Graph } from "../../src/content/q3/base/game/save-reader.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../src/persistence/value.ts";
import { savedActorId } from "../../src/persistence/save-image.ts";

function fixture(actors = new SessionActorRegistry(createIdentityOwner("q3-core-save"))) {
  const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  let schedules = 0, fired = 0;
  const records = new Q3EntityRecords({ actors, bodies, combat, inventory, callbacks, foreign: () => null, isPlayer: () => false,
    damageCall: () => null, schedule: () => { schedules++; return undefined; }, runThink: () => undefined }, "q3:base", "baseq3");
  const pool = new EntityPool({ records, product: "baseq3", maxClients: 1, mapStartTime: 0, time: () => 5000, print: () => {}, link: () => {}, unlink: () => {} });
  const think = pool.callbacks.think.register("test:think", self => { fired++; self.count++; });
  return { actors, callbacks, bodies, combat, inventory, records, pool, think, schedules: () => schedules, fired: () => fired };
}

test("Q3 graph survives plain bytes with fresh identities, source bindings, free-slot reuse and callback identity", () => {
  const source = fixture(), player = source.pool.activateClient(0), item = source.pool.spawn();
  item.think = source.think; item.nextthink = 8000; item.enemy = player; player.client = source.pool.clientAt(0);
  player.bindClientName(source.pool.clientAt(0)); source.pool.clientAt(0).pers.netname = "saved name";
  source.pool.clientAt(0).ps.stats.set(7, 531); source.pool.clientAt(0).ps.ammo.set(0, -19);
  source.pool.clientAt(0).hook = item; player.health = 83; player.r.currentOrigin = { x: 12, y: 34, z: 56 };
  const dead = source.pool.spawn(); source.pool.free(dead); item.chain = dead;
  item.r.absmin = { x: -22, y: -23, z: -24 };
  const stale = source.actors.allocate("q1:base", "q1:entity"); source.actors.release(stale);
  item.activation = source.records.damageInflictor(stale.id);
  const data = readQ3Graph(decodeCheckpointValue(encodeCheckpointValue(captureQ3Graph(source.records, source.pool))));
  const actors = SessionActorRegistry.restore(createIdentityOwner("q3-restored"), source.actors.checkpoint(), source.actors.sourceCheckpoint());
  const target = fixture(actors);
  prepareQ3Graph(target.records, data, actors);
  for (const owned of source.actors.observations()) {
    const restored = actors.resolveSaved(savedActorId(owned.id)); if (restored === null) throw new Error("missing actor");
    const body = source.bodies.read(owned.id), combat = source.combat.read(owned.id);
    if (body !== null) target.bodies.create(restored, body);
    if (combat !== null) target.combat.create(restored, combat);
    if (source.inventory.has(owned.id)) target.inventory.create(restored, source.inventory.entries(owned.id));
  }
  restoreQ3Graph(target.records, target.pool, data, actors);
  const restoredItem = target.pool.at(item.slot), restoredPlayer = target.pool.at(0);
  expect(restoredItem).not.toBe(item); expect(restoredItem.enemy).toBe(restoredPlayer); expect(restoredPlayer.actor.id.equals(player.actor.id)).toBe(false);
  expect(restoredItem.think).toBe(target.think); expect(restoredItem.nextthink).toBe(8000); expect(target.schedules()).toBe(0);
  expect(restoredItem.chain).toBe(target.pool.at(dead.slot)); expect(restoredItem.chain?.freetime).toBe(5000);
  expect(target.pool.spawn().slot).toBe(dead.slot + 1);
  expect(restoredPlayer.health).toBe(83); expect(restoredPlayer.r.currentOrigin).toEqual({ x: 12, y: 34, z: 56 });
  expect(target.pool.clientAt(0).ps.stats.get(7)).toBe(531); expect(target.pool.clientAt(0).ps.ammo.get(0)).toBe(-19);
  expect(target.pool.clientAt(0).hook).toBe(restoredItem); expect(restoredPlayer.classname).toBe("saved name");
  target.pool.clientAt(0).pers.netname = "new name"; expect(restoredPlayer.classname).toBe("new name");
  expect(restoredItem.r.absmin).toEqual({ x: -22, y: -23, z: -24 });
  if (restoredItem.activation === null || !("kind" in restoredItem.activation)) throw new Error("missing history participant");
  expect(actors.isLive(restoredItem.activation.actor)).toBe(false);
  target.callbacks.think(restoredItem.actor, { frame: 80, time: { kind: "milliseconds", value: 8000 }, elapsed: { kind: "milliseconds", value: 100 }, phase: "entity-physics" });
  expect(target.fired()).toBe(1); expect(source.fired()).toBe(0); expect(restoredItem.count).toBe(1);
});

test("Q3 graph rejects unknown live callbacks and broken restored callback identities", () => {
  const source = fixture(), entity = source.pool.spawn(); entity.think = () => {};
  expect(() => captureQ3Graph(source.records, source.pool)).toThrow("Unregistered");
  entity.think = source.think;
  const state = captureQ3Graph(source.records, source.pool), target = fixture();
  expect(() => target.pool.callbacks.think.resolve("not:registered")).toThrow("Unknown");
  expect(state.entities[entity.slot]?.think).toBe("test:think");
});

test("Q3 hydration retains borrowed callback ownership", () => {
  const source = fixture(), foreign = source.actors.allocate("q1:base", "q1:entity");
  source.records.attach(100, foreign, false);
  const state = captureQ3Graph(source.records, source.pool);
  const actors = SessionActorRegistry.restore(createIdentityOwner("q3-borrowed-restore"), source.actors.checkpoint(), source.actors.sourceCheckpoint());
  const target = fixture(actors), actor = actors.resolveSaved(savedActorId(foreign.id));
  if (actor === null) throw new Error("missing borrowed actor");
  let foreignThinks = 0;
  target.callbacks.bind(actor, { think: () => { foreignThinks++; return undefined; }, touch: null, use: null, pain: null, die: null });
  prepareQ3Graph(target.records, state, actors);
  restoreQ3Graph(target.records, target.pool, state, actors);
  target.callbacks.think(actor, { frame: 1, time: { kind: "milliseconds", value: 100 }, elapsed: { kind: "milliseconds", value: 100 }, phase: "entity-physics" });
  expect(foreignThinks).toBe(1);
  expect(target.pool.at(100).actor).toBe(actor);
  expect(target.schedules()).toBe(0);
});
