import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peFixture } from '../../guest/pe/fixture.ts';
import { createMountIdentity, createContentDigest } from '../../../src/contracts/content.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { discoverNativeWeaponBehaviors, loadNativeWeaponBehavior } from '../../../src/content/catalog/native-weapon-behaviors.ts';
import { q2EaksWeaponDeclaration } from '../../../src/compat/q2/rerelease/q2eaks-weapon-profile.ts';
import { readNativeWeaponDeclaration } from '../../../src/compat/q2/rerelease/native-weapon-declaration.ts';
import { parseWeaponBehaviorTool } from '../../../src/app/bootstrap/weapon-behavior-tool-options.ts';

test('mounted native declarations admit unknown artifact identities, preserve authored profiles and reject image mismatches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-declaration-'));
  try {
    const bytes = peFixture(8), digest = createContentDigest(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
    const original = q2EaksWeaponDeclaration('mods/authored.dll'), entry = { rva: 0x1020, registration: null };
    const declaration = readNativeWeaponDeclaration({ ...original, artifactDigest: digest, id: 'author:grenade', title: 'Authored grenade', role: 'grenade',
      time: { ...original.time, rva: 0x3080 }, activateRva: 0x1020, fireRva: 0x1020,
      equippedWeapon: { ...original.equippedWeapon, expected: entry }, projectileTouch: entry,
      allocate: { ...original.allocate, entry }, free: { ...original.free, entry },
      equip: { ...original.equip, calls: [entry] }, launch: { ...original.launch, calls: [entry] } });
    await mkdir(join(root, 'mods')); await writeFile(join(root, declaration.artifactPath), bytes);
    const mount = { kind: 'loose', rootPath: root, identity: createMountIdentity('mount:native:author', 'q2:rerelease:author:test', 0) } satisfies import('../../../src/contracts/content.ts').ContentMount;
    const plan = { id: 'mount-plan:native:author', mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] } satisfies import('../../../src/contracts/content.ts').ResolvedMountPlan;
    using mounts = await openMountPlan(plan);
    expect(await discoverNativeWeaponBehaviors(mounts, 'weapon-behavior:author')).toBeNull();
    const loaded = await loadNativeWeaponBehavior(mounts, 'weapon-behavior:author', declaration);
    expect(loaded.definition.id).toBe('author:grenade'); expect(loaded.definition.role).toBe('grenade');
    expect(loaded.resource.digest).toBe(digest); expect(loaded.declaration).toEqual(declaration);
    expect(loaded.definition.fire).toMatchObject({ kind: 'native-artifact', imageOffset: 0x1020n });
    await expect(loadNativeWeaponBehavior(mounts, 'weapon-behavior:author', { ...declaration, artifactDigest: 'sha256:' + '0'.repeat(64) })).rejects.toThrow('artifact identity');
    await expect(loadNativeWeaponBehavior(mounts, 'weapon-behavior:author', { ...declaration, time: { ...declaration.time, rva: 0x1020 } })).rejects.toThrow('write range');
    await expect(loadNativeWeaponBehavior(mounts, 'weapon-behavior:author', { ...declaration, free: { ...declaration.free, entry: { ...entry, rva: 0x3080 } } })).rejects.toThrow('execute range');
    const document = join(root, 'native-weapon-behaviors.json');
    await writeFile(document, JSON.stringify({ version: 1, profiles: [declaration] }));
    using declaredMounts = await openMountPlan(plan);
    expect((await discoverNativeWeaponBehaviors(declaredMounts, 'weapon-behavior:author'))?.map(value => value.definition.id)).toEqual(['author:grenade']);
    await writeFile(document, JSON.stringify({ version: 1, profiles: [declaration, declaration] }));
    using duplicateMounts = await openMountPlan(plan);
    await expect(discoverNativeWeaponBehaviors(duplicateMounts, 'weapon-behavior:author')).rejects.toThrow('Duplicate native');
    await writeFile(document, JSON.stringify({ version: 1, profiles: [] }));
    using emptyMounts = await openMountPlan(plan);
    expect(await discoverNativeWeaponBehaviors(emptyMounts, 'weapon-behavior:author')).toEqual([]);
    expect(parseWeaponBehaviorTool(['declare-native', 'q2-author', '--profile', 'author.json'])).toMatchObject({ action: 'declare-native', profile: 'author.json' });
    expect(() => parseWeaponBehaviorTool(['declare-native', 'q2-author', '--profile', 'author.json', '--fire', '123'])).toThrow('takes identity');
    expect(() => parseWeaponBehaviorTool(['declare-native', 'q2-author'])).toThrow('requires --profile');
    expect(() => parseWeaponBehaviorTool(['inspect', 'q2-author', '--profile', 'author.json'])).toThrow('--profile requires');
  } finally { await rm(root, { recursive: true, force: true }); }
});
