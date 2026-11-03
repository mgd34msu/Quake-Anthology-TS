import { recipeFixture } from "../../support/save-fixtures.ts";
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExecutableRecipe, ResolvedResourceReference, LooseMount } from '../../../src/contracts/content.ts';
import { createContentDigest, createResourceId } from '../../../src/contracts/content.ts';
import { InstalledCatalog, expectedProducts } from '../../../src/content/catalog/index.ts';
import { createUnifiedComposition, readUnifiedComposition, encodeUnifiedComposition, decodeUnifiedComposition, resolveUnifiedComposition, unifiedResourceId } from '../../../src/app/bootstrap/network/unified-content.ts';
const recipe = (): ExecutableRecipe => recipeFixture();

test('composition omits machine paths and generations while preserving selected semantics', () => {
  const original = recipe(), source = original.map.geometry, mount: LooseMount = { kind: 'loose', identity: { ...source.provenance.mount.identity, id: 'mount:other:machine', generation: 94 }, rootPath: '/different/client/root' };
  const raw = { ...source, provenance: { kind: 'loose', memberPath: source.requestedPath, mount } } satisfies Omit<ResolvedResourceReference, 'id'>;
  const resource = { ...raw, id: createResourceId(raw) };
  const relocated: ExecutableRecipe = { ...original, map: { ...original.map, geometry: resource }, resources: [resource],
    mounts: { ...original.mounts, mounts: [mount], defaultOrder: [mount.identity.id] } };
  const identity = createUnifiedComposition(original);
  expect(createUnifiedComposition(relocated)).toEqual(identity);
  expect(decodeUnifiedComposition(encodeUnifiedComposition(identity))).toEqual(identity);
  const encoded = new TextDecoder().decode(encodeUnifiedComposition(identity));
  expect(encoded.includes('/fixture')).toBe(false); expect(encoded.includes('/different')).toBe(false);
  expect(createUnifiedComposition({ ...original, inventory: { ...original.inventory, provider: 'q1:other' } }).digest).not.toBe(identity.digest);
  expect(unifiedResourceId(source)).toBe(unifiedResourceId(resource));
  expect(unifiedResourceId({ content: mount.identity.content, path: source.requestedPath, digest: source.digest, byteLength: source.byteLength })).toBe(unifiedResourceId(source));
});

test('malformed identities and noncanonical server mount paths reject before local resolution', () => {
  const identity = createUnifiedComposition(recipe());
  expect(() => readUnifiedComposition({ ...identity, digest: createContentDigest('f'.repeat(64)) })).toThrow("unified.composition: noncanonical or mismatched unified composition");
  expect(() => readUnifiedComposition({ ...identity, composition: { ...identity.composition, recipe: recipe() } })).toThrow('noncanonical');
  expect(() => readUnifiedComposition({ ...identity, composition: { ...identity.composition, snapshotSchema: 'other:snapshot' } })).toThrow("unified.composition.composition.snapshotSchema: expected qts:snapshot-v10");
  expect(() => readUnifiedComposition({ ...identity, composition: { ...identity.composition, snapshotSchema: 'qts:snapshot-v6' } })).toThrow("unified.composition.composition.snapshotSchema: expected qts:snapshot-v10");
  expect(() => unifiedResourceId({ content: recipe().map.geometryContent, path: '../escape', digest: createContentDigest('0'.repeat(64)), byteLength: 1 })).toThrow("Invalid relative resource path: ../escape");
});

test('local catalog reconstruction verifies actual bytes without using remote paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-content-'));
  try {
    const original = recipe(), expectation = expectedProducts.find(product => product.id === 'q1-classic-id1');
    if (expectation === undefined) throw new Error('Missing fixture expectation');
    const data = new Uint8Array([1, 2, 3, 4]); await mkdir(join(root, 'maps')); await writeFile(join(root, 'maps/start.bsp'), data);
    const raw = { ...original.map.geometry, digest: createContentDigest(createHash('sha256').update(data).digest('hex')), byteLength: data.length };
    const geometry = { ...raw, id: createResourceId(raw) };
    const offered = createUnifiedComposition({ ...original, map: { ...original.map, geometry }, resources: [geometry] });
    const catalog = new InstalledCatalog(root, [{ id: original.map.geometryContent, expectation, availability: { kind: 'installed' }, archives: [], looseRoot: root, userContent: null, maps: [], diagnostics: [] }], [], 77);
    const local = await resolveUnifiedComposition(offered, catalog);
    expect(local.map.geometry.provenance.mount).toMatchObject({ kind: 'loose', rootPath: root, identity: { generation: 77 } });
    expect(createUnifiedComposition(local)).toEqual(offered);
    await writeFile(join(root, 'maps/start.bsp'), new Uint8Array([4, 3, 2, 1]));
    await expect(resolveUnifiedComposition(offered, catalog)).rejects.toThrow('Resource bytes changed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sidecar presence absence and byte identities participate in admission', () => {
  const source = recipe(), content = source.map.geometryContent;
  const missing = createUnifiedComposition(source, [{ content, path: 'maps/start.ent', resource: null }]);
  const present = createUnifiedComposition(source, [{ content, path: 'maps/start.ent', resource: { content, path: 'maps/start.ent', digest: createContentDigest('1'.repeat(64)), byteLength: 10 } }]);
  expect(present.digest).not.toBe(missing.digest);
  expect(decodeUnifiedComposition(encodeUnifiedComposition(present))).toEqual(present);
  expect(decodeUnifiedComposition(encodeUnifiedComposition(missing))).toEqual(missing);
  expect(() => createUnifiedComposition(source, [...missing.composition.sidecars, ...missing.composition.sidecars])).toThrow('Repeated');
  expect(unifiedResourceId(source.map.geometry)).toMatch(/^resource:unified:[0-9a-f]{64}$/);
});
