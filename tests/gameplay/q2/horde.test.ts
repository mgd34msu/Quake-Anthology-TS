import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { Q2Entity, type Q2SpawnFields } from "../../../src/content/q2/foundation/host.ts";
import { Q2Horde, type Q2HordeGame } from "../../../src/content/q2/multiplayer/horde.ts";

test("Q2 horde spawns waves at authored points and advances when cleared", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-horde"));
  const health = new Map<ActorId, number>();
  const entities: Q2Entity[] = [];
  const origins = new Map<ActorId, Vec3>();
  const scheduled: { entity: Q2Entity; delay: number }[] = [];
  const make = (classname: string, origin: Vec3 = { x: 0, y: 0, z: 0 }): Q2Entity => {
    const actor: OwnedActor = actors.allocate("q2:horde-test", `q2:${classname}`);
    const entity = new Q2Entity(actor, { classname, ordinal: entities.length, values: new Map() });
    entities.push(entity); health.set(actor.id, 100); origins.set(actor.id, origin);
    return entity;
  };
  const resolveSaved = (savedId: { slot: number; generation: number }): ActorId | null => {
    for (const entity of entities) if (entity.actor.id.slot === savedId.slot && entity.actor.id.generation === savedId.generation) return entity.actor.id;
    return null;
  };
  const game: Q2HordeGame = {
    entities: { values: () => entities.values() },
    host: {
      actors: { resolveSaved: () => null, referenceSaved: resolveSaved },
      combat: { read: id => ({ health: health.get(id) ?? 0 }) },
      trace: () => ({ startSolid: false, hit: { kind: "world" } }),
      emit: () => undefined,
    },
    solid: () => undefined,
    schedule: (entity, delay) => { scheduled.push({ entity, delay }); return undefined; },
    body: entity => ({ origin: origins.get(entity.actor.id) ?? { x: 0, y: 0, z: 0 } }),
    spawn: (fields: Q2SpawnFields) => make(fields.classname),
  };

  const horde = new Q2Horde();
  const player = make("player");
  const manager = make("horde_manager");
  const point = make("info_monster_start", { x: 64, y: 0, z: 0 });
  expect(horde.spawn(manager, game)).toBe(true);
  expect(horde.spawn(point, game)).toBe(true);
  expect(horde.spawn(player, game)).toBe(false);
  expect(scheduled).toEqual([{ entity: manager, delay: 1 }]);

  const think = horde.callbacks.think["q2:horde/manager"];
  const tick = (): void => { think(manager, game); };
  tick(); tick();
  expect(horde.wave).toBe(1);
  const spawned = entities.filter(entity => entity.classname.startsWith("monster_"));
  expect(spawned).toHaveLength(6);

  // Clearing the wave and ticking through the intermission advances it.
  for (const monster of spawned) health.set(monster.actor.id, 0);
  tick();
  for (let index = 0; index < 12; index++) tick();
  expect(horde.wave).toBe(2);
  tick();
  expect(entities.filter(entity => entity.classname.startsWith("monster_")).length).toBeGreaterThan(spawned.length);

  // Checkpoint round-trips wave state.
  const saved = horde.capture();
  const restored = new Q2Horde();
  restored.restore(game, saved);
  expect(restored.wave).toBe(saved.wave);
  expect(restored.manager?.classname).toBe("horde_manager");
});
