import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { ActorId } from '../../../src/contracts/identity.ts';
import type { ContentId } from '../../../src/contracts/content.ts';
import { SimulationEvents } from '../../../src/app/bootstrap/simulation/events.ts';
import { Q1MapFog } from '../../../src/app/bootstrap/q1-fog.ts';
import { SessionActorRegistry, SharedBodyTable } from '../../../src/world/actors/index.ts';
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from '../../../src/persistence/value.ts';

const content: ContentId = 'q1:rerelease:mg1:retail', entities = '{"classname" "worldspawn" "fog" "0.2 0 0 1"}';
function fixture() {
  const identity = createIdentityOwner('fog-save'), actors = new SessionActorRegistry(identity);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => body.bounds, onLink: () => undefined, onUnlink: () => undefined });
  let seconds = 0;
  const events = new SimulationEvents(bodies, () => ({ kind: 'seconds', value: seconds }), () => null, actor => actor.slot,
    { content, entities, alive: actor => actors.resolveOwned(actor) !== null });
  actors.onRelease(actor => { events.retire(actor.id); return undefined; });
  const first = actors.allocate('q1:base', 'q1:player'), second = actors.allocate('q1:base', 'q1:player');
  const emit = (player: ActorId | null, time: number, density: number, duration: number, source: ContentId = content) => {
    seconds = time;
    events.emit(source, { kind: 'q1-composition', event: { kind: 'addon', event: { kind: 'fog', player, density, color: { x: 1, y: 0, z: 0 }, duration, skyFactor: 0.25 } } });
    return events.takePresentation();
  };
  return { identity, actors, events, first, second, emit };
}

test('fog save retains interrupted global/actor transitions without restarting or map activation', () => {
  const source = fixture(), seat = new Q1MapFog(entities, source.first.id, content), other = new Q1MapFog(entities, source.second.id, content);
  const global = source.emit(null, 10, 1, 4); seat.receive(global); other.receive(global);
  const targeted = source.emit(source.first.id, 12, 0, 4); seat.receive(targeted); other.receive(targeted);
  expect(seat.current(12).density).toBeCloseTo(0.6);
  expect(seat.current(13).density).toBeCloseTo(0.45);
  expect(other.current(13).density).toBeCloseTo(0.8);
  const image = decodeCheckpointValue(encodeCheckpointValue(source.events.capture()));
  const restored = fixture(), loaded = new Q1MapFog(entities, restored.first.id, content), loadedOther = new Q1MapFog(entities, restored.second.id, content);
  restored.events.restore(new SaveReader(image), saved => restored.identity.actor(saved.slot, saved.generation));
  const replay = restored.events.takePresentation(); loaded.receive(replay); loadedOther.receive(replay);
  for (const time of [12,13,14,15,16,20]) {
    expect(loaded.current(time)).toEqual(seat.current(time));
    expect(loadedOther.current(time)).toEqual(other.current(time));
  }
  expect(restored.events.take()).toHaveLength(0);
  expect(replay.filter(event => event.kind === 'q1-composition')).toHaveLength(0);
  const update = restored.emit(null, 13, 0.2, 2); loaded.receive(update); loadedOther.receive(update);
  expect(loaded.current(13).density).toBeCloseTo(0.45);
  expect(loadedOther.current(13).density).toBeCloseTo(0.8);
  expect(loaded.current(14).density).toBeCloseTo(0.325);
  expect(loadedOther.current(14).density).toBeCloseTo(0.5);
  expect(loaded.current(15).density).toBeCloseTo(loadedOther.current(15).density);
  expect(loaded.current(15).color).toEqual(loadedOther.current(15).color);
  const saved = restored.events.capture().q1Fog;
  expect(saved?.actors).toHaveLength(1);
  expect(saved?.global.context?.content).toBe(content);
  expect(saved?.actors[0]?.transition.start).toBe(13);
  expect(new Q1MapFog(entities, restored.first.id, content).current(14).density).toBe(0.2);
});

test('fog retirement, foreign content and old saves do not leak actor/world state', () => {
  const source = fixture(), seat = new Q1MapFog(entities, source.first.id, content);
  seat.receive(source.emit(source.first.id, 1, 0.9, 0));
  const original = seat.current(2);
  seat.receive(source.emit(source.first.id, 2, 0, 0, 'q1:classic:id1:retail'));
  expect(seat.current(2)).toEqual(original);
  const retained = source.events.capture();
  source.actors.release(source.first);
  expect(source.events.capture().q1Fog?.actors).toHaveLength(0);
  const replacement = source.actors.allocate('q1:base', 'q1:player');
  expect(replacement.id.slot).toBe(source.first.id.slot);
  expect(replacement.id.generation).not.toBe(source.first.id.generation);
  const fresh = new Q1MapFog(entities, replacement.id, content);
  fresh.receive(source.emit(source.first.id, 3, 1, 0));
  expect(source.events.capture().q1Fog?.actors).toHaveLength(0);
  fresh.receive(source.emit(replacement.id, 3, 1, 2));
  expect(fresh.current(3).density).toBe(0.2);
  expect(fresh.current(4).density).toBeCloseTo(0.6);
  const legacy = { sequence: retained.sequence, presentationSequence: retained.presentationSequence, styles: retained.styles, persistent: retained.persistent };
  const restored = fixture(); restored.emit(restored.first.id, 0, 1, 0);
  restored.events.restore(new SaveReader(legacy), saved => restored.identity.actor(saved.slot, saved.generation));
  const old = new Q1MapFog(entities, restored.first.id, content); old.receive(restored.events.takePresentation());
  expect(old.current(100).density).toBe(0.2);
  expect(restored.events.capture().q1Fog?.actors).toHaveLength(0);
  const fog = retained.q1Fog; if (fog === null) throw Error('Missing fog checkpoint');
  const invalid = { ...retained, q1Fog: { ...fog, global: { ...fog.global, transition: { ...fog.global.transition, duration: -1 } } } };
  expect(() => restored.events.restore(new SaveReader(invalid), saved => restored.identity.actor(saved.slot, saved.generation))).toThrow('fog value out of range');
  expect(() => restored.events.restore(new SaveReader({ ...retained, q1Fog: { ...fog, actors: [...fog.actors, ...fog.actors] } }), saved => restored.identity.actor(saved.slot, saved.generation))).toThrow('duplicate fog actor');
  expect(() => restored.events.restore(new SaveReader({ ...retained, q1Fog: { ...fog, content: 'q1:classic:id1:retail' } }), saved => restored.identity.actor(saved.slot, saved.generation))).toThrow('another map content');
});
