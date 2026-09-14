import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import type { QvmServerTraceQuery } from '../../src/compat/qvm/server-game-syscalls.ts';
import { QvmGameData } from '../../src/compat/qvm/game-data.ts';
import { QvmMemory } from '../../src/compat/qvm/memory.ts';
import { Q3GuestRecords } from '../../src/app/bootstrap/simulation/q3/guest-records.ts';
import { Q3GuestSpatial } from '../../src/app/bootstrap/simulation/q3/guest-spatial.ts';
import { SharedPhysics } from '../../src/app/bootstrap/simulation/physics.ts';
import { ActorCallbackTable, SessionActorRegistry } from '../../src/world/actors/index.ts';
import { createSceneQueries } from '../../src/world/collision/index.ts';
import { createBoxModel, createCapsuleModel } from '../../src/world/collision/q3/model.ts';
import { Q3_BINARY32_PROFILE } from '../../src/core/numeric.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';
import { parseEntities } from '../../src/core/common-parse.ts';
import { openArchive } from '../../src/content/archive/index.ts';
import { decodeQ3World } from '../../src/formats/q3-map/index.ts';
import { add3, sub3, radiusFromBounds } from '../../src/core/math.ts';

const path = resolve(process.env['QUAKE_DATA_PATH'] ?? resolve(import.meta.dir, '../../../qfiles'), 'q3a/baseq3/pak0.pk3');

test.skipIf(!existsSync(path))('guest records borrow located memory across shared links, owner changes, brush and capsule contacts', async () => {
  const archive = await openArchive(path);
  try {
    const entry = archive.findEntries('maps/q3dm7.bsp')[0];
    if (entry === undefined) throw new Error('Missing q3dm7');
    const world = decodeQ3World(await archive.readEntry(entry)), scene = createSceneQueries(world);
    const identities = createIdentityOwner('guest-records'), actors = new SessionActorRegistry(identities);
    const callbacks = new ActorCallbackTable(actors);
    const physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q3_BINARY32_PROFILE,
      sourceOrder: (a, b) => a.slot - b.slot, worldActor: () => null, onBlocked: () => { throw new Error('No guest physics traversal'); } });
    const memory = new QvmMemory(new Uint8Array(131072)), data = new QvmGameData(memory);
    data.setClientCount(2); data.locate(64, 16, 700, 40000, 600);
    const records = new Q3GuestRecords(data, { actors, bodies: physics.bodies, scene, provider: 'q3:guest',
      collision: (actor, collision) => physics.setCollision(actor, collision) });
    const cvars = new CvarRegistry({ dialect: 'q3', context: { session: identities.session, origin: { kind: 'server-console' } } });
    const spatial = new Q3GuestSpatial(records, scene, cvars);
    const position = parseEntities(world.entities).find(entity => entity.get('classname') === 'info_player_deathmatch')?.get('origin')?.trim().split(/\s+/).map(Number);
    if (position?.[0] === undefined || position[1] === undefined || position[2] === undefined) throw new Error('No player spawn');
    const origin = { x: position[0], y: position[1], z: position[2] + 24 };
    const zero = { x: 0, y: 0, z: 0 }, bounds = { min: { x: -4, y: -4, z: -4 }, max: { x: 4, y: 4, z: 4 } };
    for (let slot = 0; slot < 16; slot++) {
      const entity = records.entity(slot);
      entity.s.number = slot; entity.s.groundEntityNum = 1023; entity.r.ownerNum = 1023;
      entity.r.currentOrigin = origin; entity.s.origin = origin;
      entity.r.mins = bounds.min; entity.r.maxs = bounds.max;
    }
    const target = records.entity(4), actor = records.actor(4);
    target.r.contents = 1; target.r.linkcount = 40;
    spatial.link(4);
    expect(target.r.linked).toBe(true); expect(target.r.linkcount).toBe(41);
    expect(target.s.solid).toBe((36 << 16) | (4 << 8) | 4);
    expect(physics.bodies.linked(actor.id)?.absoluteBounds).toEqual({ min: target.r.absmin, max: target.r.absmax });
    expect(spatial.visibility(4)?.clusters.length).toBeGreaterThan(0);
    expect(spatial.areaEntities({ min: origin, max: origin }, 16)).toContain(4);
    expect(spatial.areaEntities({ min: origin, max: origin }, 2048)).toEqual([4]);
    expect(spatial.areaEntities({ min: origin, max: origin }, -1)).toEqual([4]);
    expect(spatial.areaEntities({ min: origin, max: origin }, 0)).toEqual([]);
    expect(() => spatial.areaEntities({ min: origin, max: origin }, 0x80000000)).toThrow('signed 32-bit');
    expect(() => spatial.areaEntities({ min: origin, max: origin }, -0x80000001)).toThrow('signed 32-bit');
    const query: QvmServerTraceQuery = { start: { ...origin, x: origin.x - 12 }, end: { ...origin, x: origin.x + 12 }, shape: { kind: 'point' }, passEntityNum: 1023, mask: 1 | 0x2000000 };
    expect(spatial.trace({ ...query, mask: 1 }).entityNum).toBe(1023);
    const hit = spatial.trace(query);
    expect(hit.entityNum).toBe(4); expect(hit.fraction).toBeLessThan(1); expect(hit.contents).toBe(0x2000000);
    const expected = createBoxModel(bounds).transformedTraceSource({ ...query, shape: { kind: 'point' }, mask: 0x2000000 }, origin, zero);
    expect(hit.plane).toEqual(expected.plane); expect(hit.fraction).toBe(expected.fraction);
    // A guest contents write is observable without another link trap.
    target.r.contents = 0;
    expect(spatial.trace(query).entityNum).toBe(1023);
    target.r.contents = 1;
    // Native excludes siblings of an unlinked pass entity but still hits the owner itself.
    records.entity(3).r.ownerNum = 2;
    target.r.ownerNum = 2;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(1023);
    target.r.ownerNum = 3;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(1023);
    target.r.ownerNum = 1023;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(4);
    records.entity(3).r.ownerNum = 1023;
    target.r.ownerNum = -1;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(1023);
    target.r.ownerNum = 1023;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(4);
    records.entity(3).r.ownerNum = 4;
    expect(spatial.trace({ ...query, passEntityNum: 3 }).entityNum).toBe(4);
    spatial.unlink(4);
    expect(records.actor(4)).toBe(actor); expect(target.r.linked).toBe(false);
    expect(spatial.areaEntities({ min: origin, max: origin }, 16)).not.toContain(4);
    expect(spatial.entityContact({ min: origin, max: origin }, 4, false)).toBe(true);
    target.r.model = { kind: 'capsule' };
    target.r.mins = { x: -4, y: -4, z: -12 }; target.r.maxs = { x: 4, y: 4, z: 12 };
    const capsuleBounds = { min: target.r.mins, max: target.r.maxs };
    const contactBounds = { min: sub3(origin, { x: 1, y: 1, z: 1 }), max: add3(origin, { x: 1, y: 1, z: 1 }) };
    const capsule = createCapsuleModel(capsuleBounds).transformedTraceSource({ start: zero, end: zero, mask: -1,
      shape: { kind: 'capsule', mins: contactBounds.min, maxs: contactBounds.max } }, origin, zero);
    expect(spatial.entityContact(contactBounds, 4, true)).toBe(capsule.startSolid || capsule.allSolid);
    // CM_TestCapsuleInCapsule's source upper/lower comparisons miss this central sphere.
    expect(spatial.entityContact(contactBounds, 4, true)).toBe(false);
    const endcap = { min: { ...contactBounds.min, z: contactBounds.min.z + 8 }, max: { ...contactBounds.max, z: contactBounds.max.z + 8 } };
    expect(spatial.entityContact(endcap, 4, true)).toBe(true);
    spatial.link(4); expect(records.actor(4)).toBe(actor); expect(target.r.linkcount).toBe(42);
    // Point contents uses the source entity-state transform, not the link transform.
    target.s.origin = { ...origin, x: origin.x + 100 };
    expect(spatial.pointContents(origin, 1023) & 0x2000000).toBe(0);
    target.s.origin = origin;
    expect(spatial.pointContents(origin, 1023) & 0x2000000).toBe(0x2000000);
    expect(spatial.pointContents(origin, 4) & 0x2000000).toBe(0);
    expect(world.models.length).toBeGreaterThan(1);
    const brush = records.entity(5); brush.r.currentAngles = { x: 0, y: 45, z: 0 };
    spatial.setBrushModel(5, '*1');
    expect(brush.r.model).toEqual({ kind: 'inline', index: 1 }); expect(brush.s.solid).toBe(0xffffff);
    const radius = radiusFromBounds({ min: brush.r.mins, max: brush.r.maxs }), extent = { x: radius, y: radius, z: radius };
    expect(brush.r.absmin).toEqual(sub3(sub3(origin, extent), { x: 1, y: 1, z: 1 }));
    expect(physics.bodies.linked(records.actor(5).id)?.absoluteBounds).toEqual({ min: brush.r.absmin, max: brush.r.absmax });
    spatial.unlink(5);
    const brushContact = scene.geometryTrace({ start: zero, end: zero, shape: { kind: 'box', bounds: contactBounds },
      target: { kind: 'model', model: 1, origin, angles: brush.r.currentAngles }, numeric: Q3_BINARY32_PROFILE, passActor: null,
      policy: { kind: 'q3', contentsMask: -1, curves: true, playerCurveClip: true } });
    expect(spatial.entityContact(contactBounds, 5, false)).toBe(brushContact.startSolid || brushContact.allSolid);
    // A later locate keeps the shared actor identity but reads the newly located prefix.
    memory.bytes.copyWithin(65536, 64, 64 + 16 * 700);
    data.locate(65536, 16, 700, 80000, 600);
    records.entity(4).r.currentOrigin = { ...origin, x: origin.x + 2 };
    expect(physics.bodies.read(actor.id)?.origin).toEqual(records.entity(4).r.currentOrigin);
    expect(target.r.currentOrigin).toEqual(origin); expect(records.actor(4)).toBe(actor);
    const client = records.actor(0); records.releaseClient(0);
    expect(actors.isLive(client.id)).toBe(false); expect(records.actor(0).id.equals(client.id)).toBe(false);
    records.close(); expect(actors.observations()).toHaveLength(0);
    expect(() => records.entity(0)).toThrow('retired');
  } finally { await archive.close(); }
});
