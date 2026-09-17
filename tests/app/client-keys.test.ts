import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationKeys } from '../../src/app/bootstrap/keys.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { discoverInstalledContent, expectedProducts } from '../../src/content/catalog/index.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';
import { createIdentityOwner } from '../../src/contracts/identity.ts';

test('prepared key profile reads actual home/base roots without replacing published authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quake-client-keys-'));
  try {
    const expected = expectedProducts.find(product => product.id === 'q3-baseq3');
    if (expected === undefined) throw new Error('Missing base Q3 product');
    const base = { ...expected, requiredContentArchives: [], requiredPrograms: [], mapWitness: null };
    const mod = { ...base, id: 'q3-testmod', campaign: 'testmod', contentDirectory: 'q3a/testmod', baseProduct: base.id };
    for (const product of [base, mod]) await mkdir(join(root, product.contentDirectory), { recursive: true });
    await writeFile(join(root, base.contentDirectory, 'q3key'), '2'.repeat(16));
    await writeFile(join(root, mod.contentDirectory, 'q3key'), '3'.repeat(16));
    const user = join(root, 'user'); await mkdir(join(user, mod.contentDirectory), { recursive: true });
    await writeFile(join(user, mod.contentDirectory, 'q3key'), '7'.repeat(16));
    const catalog = await discoverInstalledContent({ corpusRoot: root, userContentRoot: user, discoverMods: false, products: [base, mod] });
    const launch = parseApplicationCommand(['--game', base.id, '--map', 'missing']);
    if (launch.kind !== 'run') throw new Error('Expected options');
    const cvars = new CvarRegistry({ dialect: 'q3', context: { session: createIdentityOwner('keys').session, origin: { kind: 'local-console' } } });
    const keys = new ApplicationKeys(() => {}), options = { ...launch.options, userContentRoot: user };
    const original = await keys.prepare(options, catalog, cvars);
    if (original === null) throw new Error('Missing base descriptor');
    keys.publish(original, cvars);
    const pending = await keys.prepare({ ...options, product: mod.id }, catalog, cvars);
    if (pending === null) throw new Error('Missing mod descriptor');
    const bytes = new Uint8Array(33); keys.active.readAuthorization(bytes);
    expect(String.fromCharCode(...bytes.subarray(0, 16))).toBe('2'.repeat(16));
    expect(keys.active).toBe(original);
    pending.readUi(1, pending.gameDirectory, bytes);
    expect(String.fromCharCode(...bytes.subarray(0, 16))).toBe('7'.repeat(16));
    await pending.writeUi(1, pending.gameDirectory, new TextEncoder().encode('A'.repeat(16)));
    expect((await readFile(join(user, mod.contentDirectory, 'q3key'), 'utf8')).slice(0, 16)).toBe('A'.repeat(16));
    expect(keys.active).toBe(original);
    keys.publish(pending, cvars); expect(keys.active.demoRestricted).toBe(true);
    keys.active.readAuthorization(bytes);
    expect(String.fromCharCode(...bytes.subarray(16, 32))).toBe('A'.repeat(16));
  } finally { await rm(root, { recursive: true, force: true }); }
});
