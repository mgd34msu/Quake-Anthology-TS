import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NumericProfile } from '../../../src/contracts/numeric.ts';
import type { DecodedWorld, TracePolicy } from '../../../src/contracts/scene.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { CollisionMapSettings } from '../../../src/world/collision/q3/settings.ts';
import { q3Fixture } from '../../formats/q3-map/fixture.ts';
import { openArchive } from '../../../src/content/archive/index.ts';
import { parseEntities } from '../../../src/core/common-parse.ts';
import { readQ1Bsp } from '../../../src/formats/q1-map/index.ts';
import { decodeQ2Map } from '../../../src/formats/q2-map/index.ts';
import { decodeQ3World } from '../../../src/formats/q3-map/index.ts';
import { createSceneQueries } from '../../../src/world/collision/index.ts';
import { Q2Collision } from '../../../src/world/collision/q2.ts';
import { createSourceQ3Collision } from '../../../src/world/collision/q3/index.ts';
import { generatePatchCollide, tracePatch } from '../../../src/world/collision/q3/patch.ts';

const numeric: NumericProfile = { id: 'test:f32', arithmetic: { kind: 'binary32', round: 'each-operation' }, scalarStorage: 'binary32', floatToInt: 'checked-c-truncation', integerOverflow: 'wrap32' };
const policies: readonly TracePolicy[] = [{ kind: 'q1', move: 'normal', hull: null }, { kind: 'q2', contentsMask: 0x02010003, leafContents: 'merged' }, { kind: 'q3', contentsMask: 0x02010001, curves: true, playerCurveClip: true }];
const root = process.env['QUAKE_DATA_PATH'] ?? resolve(import.meta.dir, '../../../../qfiles');
test('canonical cm_noAreas bypasses shared Q3 topology without changing portal history', () => {
 const decoded = decodeQ3World(q3Fixture()), leaf = decoded.leaves[0];
 if (leaf === undefined) throw new Error('Q3 fixture has no leaf');
 const geometry = { ...decoded, leaves: [{ ...leaf, area: 0 }, { ...leaf, area: 1 }] };
 const identity = createIdentityOwner('common area settings');
 const cvars = new CvarRegistry({ dialect: 'q3', context: { session: identity.session, origin: { kind: 'server-console' } }, cheatsAllowed: () => true });
 const settings = new CollisionMapSettings(cvars), scene = createSceneQueries(geometry);
 scene.bindCollisionSettings(settings);
 const world = scene.nativeQ3ClipModels()?.world;
 if (world === undefined) throw new Error('No shared Q3 topology');
 const closed = world.capturePortalCheckpoint();
 expect(scene.areasConnected(0, 1)).toBe(false);
 expect(scene.areaBits(0)).toEqual(Uint8Array.of(1));
 cvars.set('cm_noAreas', '1');
 expect(scene.areasConnected(0, 1)).toBe(true);
 expect(scene.areaBits(0)).toEqual(Uint8Array.of(255));
 const bits = new Uint8Array(1);
 expect(world.writeAreaBits(bits, 0)).toBe(1);
 expect(bits).toEqual(Uint8Array.of(255));
 expect(world.capturePortalCheckpoint()).toEqual(closed);
 scene.adjustAreaPortalState(0, 1, true);
 scene.adjustAreaPortalState(0, 1, true);
 const opened = world.capturePortalCheckpoint();
 expect(opened.portals).toEqual([0, 2, 2, 0]);
 cvars.set('cm_noAreas', '0');
 expect(scene.areasConnected(0, 1)).toBe(true);
 scene.adjustAreaPortalState(0, 1, false);
 expect(scene.areasConnected(0, 1)).toBe(true);
 scene.adjustAreaPortalState(0, 1, false);
 expect(scene.areasConnected(0, 1)).toBe(false);

 const restored = createSceneQueries(geometry), restoredWorld = restored.nativeQ3ClipModels()?.world;
 if (restoredWorld === undefined) throw new Error('No restored topology');
 restoredWorld.restorePortalCheckpoint(opened);
 restored.bindCollisionSettings(settings);
 expect(restoredWorld.capturePortalCheckpoint()).toEqual(opened);
 for (const connected of [true, false]) {
   restored.adjustAreaPortalState(0, 1, false);
   expect(restored.areasConnected(0, 1)).toBe(connected);
 }
 const restoredClosed = restoredWorld.capturePortalCheckpoint();
 cvars.set('cm_noAreas', '1');
 expect(restored.areasConnected(0, 1)).toBe(true);
 expect(restoredWorld.capturePortalCheckpoint()).toEqual(restoredClosed);
 cvars.set('cm_noAreas', '0');
 expect(restored.areasConnected(0, 1)).toBe(false);
 expect(restoredWorld.capturePortalCheckpoint()).toEqual(restoredClosed);
});
const fixtures: readonly { path: string; map: string; read(bytes: Uint8Array): DecodedWorld }[] = [
 { path: 'q1/rerelease/id1/pak0.pak', map: 'maps/start.bsp', read: readQ1Bsp },
 { path: 'q2/baseq2/pak0.pak', map: 'maps/base1.bsp', read: decodeQ2Map },
 { path: 'q2/rerelease/baseq2/pak0.pak', map: 'maps/base1.bsp', read: decodeQ2Map },
 { path: 'q3a/baseq3/pak0.pk3', map: 'maps/q3dm1.bsp', read: decodeQ3World },
];
for (const fixture of fixtures) {
 const archivePath = resolve(root, fixture.path);
 test.skipIf(!existsSync(archivePath))(`${fixture.path} ${fixture.map} traces through all gameplay policies`, async () => {
  const archive = await openArchive(archivePath);
  try {
   const entry = archive.findEntries(fixture.map)[0];
   if (entry === undefined) throw new Error(`Missing ${fixture.map}`);
   const bytes = await archive.readEntry(entry), world = fixture.read(bytes), scene = createSceneQueries(world);
   const spawn = parseEntities(world.entities).find(entity => entity.get('classname') === 'info_player_start' || entity.get('classname') === 'info_player_deathmatch');
   const coordinates = spawn?.get('origin')?.trim().split(/\s+/).map(Number);
   if (coordinates === undefined || coordinates[0] === undefined || coordinates[1] === undefined || coordinates[2] === undefined) throw new Error('Retail map has no player origin');
   const start = { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
   const end = { ...start, z: start.z - 512 };
   for (const policy of policies) {
    const result = scene.trace({ start, end, shape: { kind: 'point' }, target: { kind: 'world' }, policy, numeric, passActor: null });
    const zero = { x: 0, y: 0, z: 0 };
    expect(scene.trace({ start, end, shape: { kind: 'box', bounds: { min: zero, max: zero } }, target: { kind: 'world' }, policy, numeric, passActor: null })).toEqual(result);
    expect(result.kind).toBe(policy.kind);
    expect(result.fraction).toBeGreaterThanOrEqual(0);
    expect(result.fraction).toBeLessThan(1);
    expect(result.startSolid).toBe(false);
    expect(result.contact.kind).toBe('plane');
    const contents = scene.pointContents({ point: start, target: { kind: 'world' }, policy, numeric, passActor: null });
    expect(contents.kind).toBe(policy.kind);
    const box = scene.trace({ start: { ...start, z: start.z + 16 }, end,
     shape: { kind: 'box', bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } },
     target: { kind: 'world' }, policy, numeric, passActor: null });
    expect(box.fraction).toBeLessThan(1);
    expect(box.startSolid).toBe(false);
   }
   const leaf = scene.pointLeaf(start), cluster = scene.leafCluster(leaf);
   expect(scene.clusterVisible(cluster, cluster, 'pvs')).toBe(true);
   expect(scene.boxLeaves({ min: start, max: start }, 1024).leaves).toContain(leaf);
   if (world.kind === 'q3-bsp') {
    const source = createSourceQ3Collision(bytes, fixture.map);
    const policy = policies[2]; if (policy === undefined) throw new Error('Missing Q3 policy');
    const query = { start, end, shape: { kind: 'point' }, target: { kind: 'world' }, policy, numeric, passActor: null } satisfies Parameters<typeof scene.trace>[0];
    expect(source.trace(query)).toEqual(scene.trace(query));
    const surface = world.surfaces[0];
    if (surface?.kind !== 'patch') throw new Error('Expected the first q3dm1 patch');
    const patch = generatePatchCollide(surface.width, surface.height,
     world.vertices.slice(surface.vertices.first, surface.vertices.first + surface.vertices.count).map(vertex => vertex.position));
    const native = tracePatch(patch, { x: Math.fround(511.400024), y: 1437, z: Math.fround(227.800003) },
     { x: Math.fround(1023.40002), y: 1437, z: Math.fround(227.800003) },
     { kind: 'capsule', extents: { x: 2, y: 2, z: 4 }, radius: 2, offset: { x: 0, y: 0, z: 2 } });
    expect(native?.fraction).toBeCloseTo(0.497021437, 6);
    expect(native?.plane).toEqual({ normal: { x: -1, y: 0, z: 0 }, distance: -766 });
    const acrossLava = { ...query, start: { x: 666, y: 401, z: -55 }, end: { x: 666, y: 401, z: -63 },
     policy: { kind: 'q1', move: 'normal', hull: null } } satisfies Parameters<typeof scene.trace>[0];
    expect(scene.pointContents({ ...acrossLava, point: acrossLava.start })).toEqual({ kind: 'q1', contents: -1 });
    expect(scene.pointContents({ ...acrossLava, point: acrossLava.end })).toEqual({ kind: 'q1', contents: -1 });
    const lavaTrace = scene.trace(acrossLava);
    if (lavaTrace.kind !== 'q1') throw new Error('Expected Q1 trace flags');
    expect(lavaTrace.fraction).toBe(1);
    expect([lavaTrace.inOpen, lavaTrace.inWater]).toEqual([true, true]);
    expect(source.traceMedia(acrossLava, 0.05)).toEqual({ inOpen: true, inWater: false });
    const withinLava = scene.trace({ ...acrossLava, start: { x: 666, y: 401, z: -57 }, end: { x: 666, y: 401, z: -60 } });
    if (withinLava.kind !== 'q1') throw new Error('Expected Q1 trace flags');
    expect([withinLava.inOpen, withinLava.inWater]).toEqual([false, true]);
   }
   if (world.kind === 'q2-bsp') {
    const raw = new Q2Collision(world);
    const policy = policies[1]; if (policy === undefined) throw new Error('Missing Q2 policy');
    const floor = scene.trace({ start, end, shape: { kind: 'point' }, target: { kind: 'world' }, policy, numeric, passActor: null });
    const inside = { ...floor.end, z: floor.end.z - 1 };
    const input = { start: inside, end: { ...inside, x: inside.x + 0.1 }, shape: { kind: 'point' }, target: { kind: 'world' }, numeric, passActor: null } satisfies Omit<Parameters<typeof raw.trace>[0], 'policy'>;
    const classic = raw.trace({ ...input, policy: { kind: 'q2', contentsMask: 1, leafContents: 'stored' } });
    const rerelease = raw.trace({ ...input, policy: { kind: 'q2', contentsMask: 1, leafContents: 'merged' } });
    expect(classic.allSolid).toBe(true); expect(classic.fraction).toBe(1);
    expect(rerelease.allSolid).toBe(true); expect(rerelease.fraction).toBe(0); expect(rerelease.contents & 1).toBe(1);
    const waterEntry = archive.findEntries('maps/base3.bsp')[0];
    if (waterEntry === undefined) throw new Error('Missing base3 water fixture');
    const waterScene = createSceneQueries(decodeQ2Map(await archive.readEntry(waterEntry)));
    const waterQuery = { start: { x: 76, y: 1168, z: -891 }, end: { x: 76, y: 1168, z: -1153 },
     shape: { kind: 'point' }, target: { kind: 'world' }, numeric, passActor: null,
     policy: { kind: 'q1', move: 'normal', hull: null } } satisfies Parameters<typeof scene.trace>[0];
    expect(waterScene.pointContents({ ...waterQuery, point: { x: 76, y: 1168, z: -1022 } })).toEqual({ kind: 'q1', contents: -3 });
    const waterTrace = waterScene.trace(waterQuery);
    if (waterTrace.kind !== 'q1') throw new Error('Expected Q1 trace flags');
    expect(waterTrace.fraction).toBeLessThan(1);
    expect([waterTrace.inOpen, waterTrace.inWater]).toEqual([true, true]);
   }
   const owner = createIdentityOwner('collision-smoke'), actor = owner.actor(1, 0);
   const origin = { ...start, z: start.z + 32 };
   scene.link({ actor, state: { origin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, ground: null }, absoluteBounds: { min: { x: origin.x - 9, y: origin.y - 9, z: origin.z - 9 }, max: { x: origin.x + 9, y: origin.y + 9, z: origin.z + 9 } }, linkCount: 1 }, { family: 'q3', shape: { kind: 'box' }, contents: 0x02000000, owner: null, role: 'solid', monster: true, deadMonster: false });
   const policy = policies[2]; if (policy === undefined) throw new Error('Missing policy');
   const input = { start, end: { ...start, z: start.z + 48 }, shape: { kind: 'point' }, target: { kind: 'world' }, policy, numeric } satisfies Omit<Parameters<typeof scene.trace>[0], 'passActor'>;
   expect(scene.trace({ ...input, passActor: null }).hit.kind).toBe('actor');
   expect(scene.traceExcluding({ ...input, passActor: null }, [owner.actor(1, 0)]).hit.kind).not.toBe('actor');
   expect(scene.trace({ ...input, passActor: null }).hit.kind).toBe('actor');
   expect(scene.trace({ ...input, passActor: actor }).hit.kind).not.toBe('actor');
   const linked = scene.spatial.get(actor);
   if (linked === null) throw new Error('Missing linked actor');
   const liveState = { ...linked.body.state, origin: { ...origin }, angles: { ...linked.body.state.angles },
    bounds: { min: { ...linked.body.state.bounds.min }, max: { ...linked.body.state.bounds.max } } };
   let active = true;
   scene.bindActorState(() => active ? liveState : null);
   const observed = scene.queryActors({ min: origin, max: origin })[0];
   const contentsQuery = { point: origin, target: { kind: 'world' }, policy, numeric, passActor: null } satisfies Parameters<typeof scene.pointContents>[0];
   const beforeContents = scene.pointContents(contentsQuery);
   if (beforeContents.kind !== 'q3') throw new Error('Expected Q3 contents');
   expect(beforeContents.contents & 0x02000000).toBe(0x02000000);
   liveState.origin.x += 32; liveState.angles.z = 90; liveState.bounds.min.x = -7;
   const current = scene.queryActors({ min: origin, max: origin })[0];
   expect(current?.body.state).toEqual(liveState);
   expect(current?.body.absoluteBounds).toEqual(linked.body.absoluteBounds);
   expect(current?.body.linkCount).toBe(1);
   expect(observed?.body.state.origin).toEqual(origin);
   expect(observed?.body.state.angles.z).toBe(0);
   expect(observed?.body.state.bounds.min.x).toBe(-8);
   expect(scene.trace({ ...input, passActor: null }).hit.kind).not.toBe('actor');
   const afterContents = scene.pointContents(contentsQuery);
   if (afterContents.kind !== 'q3') throw new Error('Expected Q3 contents');
   expect(afterContents.contents & 0x02000000).toBe(0);
   active = false;
   expect(scene.queryActors({ min: origin, max: origin })).toHaveLength(0);
   scene.unlink(actor); expect(scene.queryActors({ min: start, max: origin })).toHaveLength(0);
  } finally { archive.close(); }
 }, 20000);
}


test('declared rerelease corpses receive point traces without blocking foreign bodies', () => {
 const scene = createSceneQueries(decodeQ3World(q3Fixture()));
 const actor = createIdentityOwner('corpse policy').actor(1, 0);
 const origin = { x: 120, y: 0, z: 100 }, zero = { x: 0, y: 0, z: 0 };
 const bounds = { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } };
 const body = { actor, state: { origin, angles: zero, velocity: zero, bounds, ground: null },
  absoluteBounds: { min: { x: 111, y: -9, z: 91 }, max: { x: 129, y: 9, z: 109 } }, linkCount: 1 };
 const collision = { family: 'q1', shape: { kind: 'box' }, contents: -2, owner: null, role: 'solid', monster: false, deadMonster: false } satisfies Parameters<typeof scene.link>[1];
 scene.link(body, { ...collision, q1Corpse: true });
 for (const policy of policies) {
  const input = { start: { x: 100, y: 0, z: 100 }, end: { x: 140, y: 0, z: 100 },
   target: { kind: 'world' }, policy, numeric, passActor: null } satisfies Omit<Parameters<typeof scene.trace>[0], 'shape'>;
  expect(scene.trace({ ...input, shape: { kind: 'point' } }).hit.kind).toBe('actor');
  expect(scene.trace({ ...input, shape: { kind: 'box', bounds: { min: zero, max: zero } } }).hit.kind).toBe('actor');
  expect(scene.trace({ ...input, shape: { kind: 'box', bounds } }).hit.kind).toBe('none');
  expect(scene.trace({ ...input, shape: { kind: 'capsule', bounds } }).hit.kind).toBe('none');
 }
 scene.link(body, collision);
 expect(scene.trace({ start: { x: 100, y: 0, z: 100 }, end: { x: 140, y: 0, z: 100 },
  target: { kind: 'world' }, policy: { kind: 'q1', move: 'normal', hull: null }, numeric, passActor: null, shape: { kind: 'box', bounds } }).hit.kind).toBe('actor');
});
