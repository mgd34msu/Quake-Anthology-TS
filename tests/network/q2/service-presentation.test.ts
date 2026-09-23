import { createQ2Fog } from '../../../src/content/q2/rerelease/types.ts';
import { q2FogFromWire } from '../../../src/app/bootstrap/rerelease-presentation/fog.ts';
import { SvcFogDataBitsT } from '../../../src/network/q2/fog.ts';
import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { Q2ServerMessageReader, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { Q2ServerWriteEvent } from '../../../src/network/q2/index.ts';
import type { SimulationPresentationEvent } from '../../../src/app/bootstrap/simulation/types.ts';
import { translateQ2ServiceRecords, type Q2ServicePresentationHost } from '../../../src/app/bootstrap/network/q2-service-presentation.ts';
import { Q2TempType } from '../../../src/network/q2/temp-types.ts';
import { encodeUnifiedPresentationEvents, decodeUnifiedPresentationEvents } from '../../../src/app/bootstrap/network/unified-event-codec.ts';
import type { Q2WeaponEvent } from '../../../src/content/q2/foundation/weapons/types.ts';

test('decoded Q2 svc presentation shares state order and retains controls and unresolved actors', () => {
  const identity = createIdentityOwner('q2-service-presentation'), actor = identity.actor(1, 0);
  const reader = new Q2ServerMessageReader({ kind: 'q2-classic', version: 34 }, { maxConfigStrings: 2080, inventorySlots: 256 });
  const configs = new Map<number, string>(), events: SimulationPresentationEvent[] = [];
  let sequence = 9, layout = '', inventory: readonly number[] = [];
  const host: Q2ServicePresentationHost = {
    content: () => 'q2:classic:baseq2:test', seconds: 2, nextSequence: () => sequence++, player: () => ({ actor, sourceEntity: 1 }),
    actor: number => number === 1 ? actor : null, entity: () => null, soundConfigOffset: 288, imageConfigOffset: 544, fog: value => q2FogFromWire(createQ2Fog(), value), playerSkinConfigOffset: 1312,
    configString: index => configs.get(index), setConfigString: (index, value) => { configs.set(index, value); },
    setInventory: counts => { inventory = counts; }, setLayout: text => { layout = text; }, emit: event => { events.push(event); },
  };
  const inputs: readonly Q2ServerWriteEvent[] = [
    { kind: 'config-string', index: 1312, value: 'Player\\male/grunt' },
    { kind: 'print', level: 3, text: 'chat' }, { kind: 'center-print', text: 'center' },
    { kind: 'layout', text: 'xv 0 string test' }, { kind: 'inventory', counts: Array.from({ length: 256 }, (_, index) => index === 2 ? 7 : 0) },
    { kind: 'muzzle-flash', entity: 1, flash: 0, monster: false, silenced: false },
    { kind: 'muzzle-flash', entity: 2, flash: 0, monster: false, silenced: false },
    { kind: 'print', level: 2, text: 'console' }, { kind: 'command-text', text: 'echo test\n' }, { kind: 'disconnect' },
  ];
  const records = inputs.flatMap(event => reader.read(encodeQ2ServerEvent(reader.wire, event)));
  const remaining = translateQ2ServiceRecords(records, host);
  expect(configs.get(1312)).toBe('Player\\male/grunt');
  expect(layout).toBe('xv 0 string test'); expect(inventory[2]).toBe(7);
  expect(events.map(event => event.kind)).toEqual(['q2-player', 'q2-player', 'q2', 'q2-weapon', 'q2-player']);
  expect(events.map(event => event.sequence)).toEqual([9, 10, 11, 12, 13]);
  expect(remaining.map(record => record.event.kind)).toEqual(['muzzle-flash', 'command-text', 'disconnect']);
  expect(remaining[0]).toBe(records[6]);
  const clear = reader.read(encodeQ2ServerEvent(reader.wire, { kind: 'config-string', index: 1313, value: '' }));
  expect(translateQ2ServiceRecords(clear, host)).toEqual([]);
  expect(configs.get(1313)).toBe('');
  expect(events).toHaveLength(5);
});

 test('native fog deltas preserve unflagged target components and signed world heights', () => {
  const previous = createQ2Fog();
  const value = { bits: SvcFogDataBitsT.BIT_DENSITY | SvcFogDataBitsT.BIT_R | SvcFogDataBitsT.BIT_HEIGHTFOG_START_DIST,
    density: 0.25, skyfactor: 127, red: 83, green: 200, blue: 199, time: 1000,
    hf_falloff: 1, hf_density: 1, hf_start_r: 99, hf_start_g: 99, hf_start_b: 99, hf_start_dist: -123,
    hf_end_r: 99, hf_end_g: 99, hf_end_b: 99, hf_end_dist: 123 };
  const target = q2FogFromWire(previous, value);
  expect(target.fog.density).toBe(0.25); expect(target.fog.skyFactor).toBe(127 / 255);
  expect(target.fog.color).toEqual({ ...previous.fog.color, x: 83 / 255 });
  expect(target.heightFog).toEqual({ ...previous.heightFog, startDistance: -123 });
  const next = q2FogFromWire(target, { ...value, bits: SvcFogDataBitsT.BIT_G, green: 61 });
  expect(next.fog).toEqual({ ...target.fog, color: { ...target.fog.color, y: 61 / 255 } });
  expect(next.heightFog).toEqual(target.heightFog);
});

test('rerelease source wire routes keyed POI removal and directional damage without losing fields', () => {
 const identity = createIdentityOwner('rr-service'), actor = identity.actor(1, 0);
 const reader = new Q2ServerMessageReader({ kind: 'q2-rerelease', version: 1038 }, { maxConfigStrings: 16384, inventorySlots: 256 });
 const events: SimulationPresentationEvent[] = []; let sequence = 0;
 const host: Q2ServicePresentationHost = {
  content: () => 'q2:rerelease:baseq2:test', seconds: 2, nextSequence: () => sequence++, player: () => ({ actor, sourceEntity: 1 }),
  actor: () => actor, entity: () => null, soundConfigOffset: 0, imageConfigOffset: 200, playerSkinConfigOffset: 1000,
  fog: value => q2FogFromWire(createQ2Fog(), value), configString: index => index === 207 ? 'poi/objective' : undefined,
  setConfigString: () => {}, setInventory: () => {}, setLayout: () => {}, emit: value => { events.push(value); },
 };
 const poi = { key: 37, time: 1200, pos: new Float32Array([1, 2, 3]), image: 7, color: 19, flags: 3 };
 const inputs: readonly Q2ServerWriteEvent[] = [
  { kind: 'poi', value: poi }, { kind: 'poi', value: { ...poi, time: 65535 } },
  { kind: 'damage', indicators: [{ damage: 12, health: true, armor: false, shield: true, direction: new Float32Array([1, 0, 0]) }] },
 ];
 const remaining = translateQ2ServiceRecords(inputs.flatMap(event => reader.read(encodeQ2ServerEvent(reader.wire, event))), host);
 expect(remaining).toEqual([]);
 expect(events.map(value => { if (value.kind !== 'q2-rerelease') throw new Error('Expected rerelease source event'); return value.event; })).toEqual([
  { kind: 'keyed-poi', actor, key: 37, duration: 1200, position: { x: 1, y: 2, z: 3 }, image: 'poi/objective', color: 19, flags: 3 },
  { kind: 'remove-poi', actor, key: 37 },
  { kind: 'directional-damage', actor, damage: 12, health: true, armor: false, shield: true, direction: { x: 1, y: 0, z: 0 } },
 ]);
});

test('original Q2 two-point temporary effects retain endpoints without inventing an actor', () => {
 const identity = createIdentityOwner('wire-trails'), events: SimulationPresentationEvent[] = [];
 const reader = new Q2ServerMessageReader({ kind: 'q2-rerelease', version: 1038 }, { maxConfigStrings: 16384, inventorySlots: 256 });
 const start = { x: -12, y: 34, z: 56 }, end = { x: 100, y: -30, z: 8 };
 const host: Q2ServicePresentationHost = {
  content: () => 'q2:rerelease:baseq2:test', seconds: 2, nextSequence: () => events.length, player: () => null,
  actor: () => { throw new Error('Ownerless trail requested an actor'); }, entity: () => null,
  soundConfigOffset: 0, imageConfigOffset: 200, playerSkinConfigOffset: 1000,
  fog: value => q2FogFromWire(createQ2Fog(), value), configString: () => undefined,
  setConfigString: () => {}, setInventory: () => {}, setLayout: () => {}, emit: value => { events.push(value); },
 };
 const types = [Q2TempType.TE_RAILTRAIL, Q2TempType.TE_BUBBLETRAIL, Q2TempType.TE_BFG_LASER, Q2TempType.TE_BFG_ZAP];
 const records = types.flatMap(type => reader.read(encodeQ2ServerEvent(reader.wire, { kind: 'temporary-entity', value: {
  type, fields: [{ kind: 'vector', name: 'position1', value: start }, { kind: 'vector', name: 'position2', value: end }], raw: new Uint8Array(0),
 } })));
 expect(translateQ2ServiceRecords(records, host)).toEqual([]);
 const effects: readonly Extract<Q2WeaponEvent, { kind: 'beam' }>['effect'][] = ['rail', 'bubble-trail', 'bfg-laser', 'bfg-zap'];
 expect(events.map(value => { if (value.kind !== 'q2-weapon') throw new Error('Expected weapon effect'); return value.event; })).toEqual(
  effects.map(effect => ({ kind: 'beam', effect, actor: null, start, end, duration: 0.1 })));
 expect(decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents(events), {
  session: identity.session, actor: () => { throw new Error('Ownerless trail decoded an actor'); },
  client: (slot, generation) => identity.client(slot, generation), seat: slot => identity.seat(slot), resourceId: () => 'resource:trail',
 })).toEqual(events);
});
