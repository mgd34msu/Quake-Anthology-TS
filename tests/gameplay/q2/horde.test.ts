import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { Q2Horde } from "../../../src/content/q2/multiplayer/horde.ts";
import { callFunction, callMethod, readField } from "../../support/reflect.ts";

interface FakeEntity {
  readonly classname: string;
  readonly actor: OwnedActor;
  readonly ordinal: number;
  readonly origin: { x: number; y: number; z: number };
}

test("Q2 horde spawns waves at authored points and advances when cleared", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-horde"));
  const health = new Map<ActorId, number>();
  const entities: FakeEntity[] = [];
  const scheduled: { entity: FakeEntity; think: unknown }[] = [];
  const make = (classname: string, origin = { x: 0, y: 0, z: 0 }): FakeEntity => {
    const actor = actors.allocate("q2:horde-test", `q2:${classname}`);
    const entity: FakeEntity = { classname, actor, ordinal: entities.length, origin };
    entities.push(entity); health.set(actor.id, 100);
    return entity;
  };
  const game = {
    entities: { values: () => entities.values() },
    host: { combat: { read: (id: ActorId) => ({ health: health.get(id) ?? 0 }) } },
    solid: () => undefined,
    schedule: (entity: FakeEntity, _delay: number, think: unknown) => { scheduled.push({ entity, think }); return undefined; },
    body: (entity: FakeEntity) => ({ origin: entity.origin }),
    spawn: (fields: { classname: string }) => make(fields.classname),
  };

  const horde = new Q2Horde();
  const player = make("player");
  const manager = make("horde_manager");
  const point = make("info_monster_start", { x: 64, y: 0, z: 0 });
  expect(callMethod(horde, "spawn", manager, game)).toBe(true);
  expect(callMethod(horde, "spawn", point, game)).toBe(true);
  expect(callMethod(horde, "spawn", player, game)).toBe(false);

  const think: unknown = readField(horde.callbacks.think, "q2:horde/manager");
  const tick = (): void => { callFunction(think, undefined, manager, game); };
  tick(); tick();
  expect(horde.wave).toBe(1);
  const spawned = entities.filter(entity => entity.classname.startsWith("monster_"));
  expect(spawned.length).toBeGreaterThan(0);
  expect(spawned.length).toBeLessThanOrEqual(12);

  // Clearing the wave and ticking through the intermission advances it.
  for (const monster of spawned) health.set(monster.actor.id, 0);
  tick();
  for (let index = 0; index < 12; index++) tick();
  expect(horde.wave).toBeGreaterThanOrEqual(2);
  tick();
  expect(entities.filter(entity => entity.classname.startsWith("monster_")).length).toBeGreaterThan(spawned.length);

  // Checkpoint round-trips wave state.
  const saved = horde.capture();
  const restored = new Q2Horde();
  const restoreGame = { ...game, host: { ...game.host, actors: { resolveSaved: () => null, referenceSaved: (savedId: { slot: number; generation: number }) => {
    for (const entity of entities) if (entity.actor.id.slot === savedId.slot && entity.actor.id.generation === savedId.generation) return entity.actor.id;
    return null;
  } } } };
  callMethod(restored, "restore", restoreGame, saved);
  expect(restored.wave).toBe(saved.wave);
  expect(restored.manager?.classname).toBe("horde_manager");
});
