import { ApplicationRereleasePresentation } from '../../../src/app/bootstrap/rerelease-presentation.ts';
import type { ProviderSceneAssets } from '../../../src/app/bootstrap/assets.ts';
import { SceneImageRegistry } from '../../../src/render/scene/resources.ts';
import { SceneTextureLoader } from '../../../src/render/scene/textures.ts';
import { SceneShaderRegistry } from '../../../src/render/scene/shaders.ts';
import { SceneMaterialRegistrations } from '../../../src/render/scene/material-registrations.ts';
import { DEFAULT_MODEL_REPLACEMENT_POLICY } from '../../../src/render/scene/models/replacements.ts';
import { classicQ1Messages, classicQ1Text, q1EntityString } from '../../../src/content/q1/foundation/text.ts';
import { backpackMessage } from '../../../src/content/q1/base/projectiles.ts';
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { createMountIdentity } from '../../../src/contracts/content.ts';
import type { ContentId, ContentMount } from '../../../src/contracts/content.ts';
import { InstalledCatalog, expectedProducts } from '../../../src/content/catalog/index.ts';
import type { CatalogProduct } from '../../../src/content/catalog/index.ts';
import { digestFile, openMountPlan } from '../../../src/content/mounts/index.ts';
import { Q1MessageLocalization } from '../../../src/app/bootstrap/q1-localization.ts';

const source: ContentId = 'q1:rerelease:id1:retail';
const classic: ContentId = 'q1:classic:id1:retail';
const world: ContentId = 'q2:classic:baseq2:retail';
function product(id: ContentId, expected: string): CatalogProduct {
  const expectation = expectedProducts.find(product => product.id === expected);
  if (expectation === undefined) throw new Error('Missing product expectation');
  return { id, expectation, availability: { kind: 'installed' }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [] };
}

test('Q1 source catalog uses selected language, source mod tiers and format arguments independently of Q2 map content', async () => {
  const identity = createIdentityOwner('source-localization');
  const root = await mkdtemp(join(tmpdir(), 'q1-source-localization-'));
  const catalog = new InstalledCatalog('', [product(source, 'q1-rerelease-id1'), product(classic, 'q1-classic-id1'), product(world, 'q2-classic-baseq2')], [], 0);
  const archive: ContentMount = { kind: 'archive', identity: createMountIdentity('mount:test:q1-loc', source, 0), format: 'pak',
    archivePath: resolve('../qfiles/q1/rerelease/id1/pak0.pak'), archiveDigest: await digestFile(resolve('../qfiles/q1/rerelease/id1/pak0.pak')) };
  const mod: ContentMount = { kind: 'loose', identity: createMountIdentity('mount:test:q1-loc-mod', source, 0), rootPath: root };
  try {
    await mkdir(join(root, 'localization'));
    await writeFile(join(root, 'localization/loc_french_mod.txt'), 'test_source="Source française : {0}"\n');
    using mounts = await openMountPlan({ id: 'mount-plan:test:q1-source-loc', mounts: [mod, archive], defaultOrder: [mod.identity.id, archive.identity.id], prefixOrders: [] });
    let language = 'english'; const opened: ContentId[] = [];
    const messages = new Q1MessageLocalization(identity.seat(0), { content: { catalog, forContent: async content => { opened.push(content); expect(content).toBe(source); return mounts; } } }, () => language);
    expect(await messages.resolve(source, '$qc_backpack_shells', [5])).toBe('5 shells');
    expect(await messages.resolve(source, '$qc_entered', ['Player'])).toBe('Player entered the game\n');
    for (const [key, args] of [
      ['$qc_item_health', [25]], ['$qc_got_item', ['$qc_shotgun']], ['$qc_horde_streak_generic', [14]],
      ['$qc_horde_streak_ended', [8]], ['$qc_enemy_killed_bonus', [2]],
      ['$mg3_qc_upgrade_success', ['$mg3_qc_upgrade_health', 150]], ['$mg3_qc_upgrade_fail', ['$mg3_qc_upgrade_health']],
    ] satisfies readonly (readonly [string, readonly (string | number)[]])[]) {
      const message = await messages.resolve(source, key, args); expect(message).not.toContain('$'); expect(message).not.toContain('{');
    }
    expect(await messages.resolve(source, '$unknown_mod_key', [])).toBe('$unknown_mod_key');
    const backpack = backpackMessage({ weapon: 'shotgun', shells: 5, nails: 10, rockets: 2, cells: 3 }, 'rerelease', true);
    const englishPickup = await messages.resolve(source, backpack.text, [], backpack.parts);
    expect(englishPickup).toBe('You got Shotgun, 5 shells, 10 nails, 2 rockets, 3 cells');
    const classicPickup = backpackMessage({ weapon: 'shotgun', shells: 5, nails: 10, rockets: 2, cells: 3 }, 'classic', true);
    expect(classicPickup).toEqual({ text: 'You get the Shotgun, 5 shells, 10 nails, 2 rockets, 3 cells', parts: [] });
    expect(backpackMessage({ weapon: 'shotgun', shells: 5, nails: 0, rockets: 0, cells: 0 }, 'classic', false).text).toBe('You get 5 shells');
    language = 'french';
    const frenchPickup = await messages.resolve(source, backpack.text, [], backpack.parts);
    expect(frenchPickup).toStartWith('Obtenu : '); expect(frenchPickup).not.toContain('$'); expect(frenchPickup).not.toBe(englishPickup);
    for (const amount of ['5', '10', '2', '3']) expect(frenchPickup).toContain(amount);

    expect(await messages.resolve(source, '$test_source', ['$qc_shotgun'])).toContain('Source française : ');
    expect(await messages.resolve(source, '$test_source', ['$unknown_mod_key'])).toBe('Source française : $unknown_mod_key');
    expect(await messages.resolve(source, '$qc_backpack_got', [])).toBe('Obtenu : ');
    language = 'german'; expect(await messages.resolve(source, '$qc_backpack_got', [])).toBe('Du hast ');
    language = 'unavailable'; expect(await messages.resolve(source, '$qc_backpack_shells', [5])).toBe('5 shells');
    const count = opened.length;
    expect(await messages.resolve(classic, 'You get 5 shells', [])).toBe('You get 5 shells');
    expect(await messages.resolve(world, 'Quake II source message', [])).toBe('Quake II source message');
    expect(opened).toHaveLength(count);
    const images = new SceneImageRegistry({ identity: Symbol('q1-language'), session: identity.session, generation: 0 });
    const textures = new SceneTextureLoader(images, { read: async () => null });
    try {
      const provider: ProviderSceneAssets = { family: 'q1', mounts, palette: null, textures,
        shaders: new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider(source)), modelPolicy: DEFAULT_MODEL_REPLACEMENT_POLICY };
      const languages = new ApplicationRereleasePresentation({ provider: async () => provider }, [{ seat: identity.seat(0), actor: identity.actor(0, 0) }]);
      const errors: unknown[] = [], binding = await languages.languageBinding(identity.seat(0), source, error => errors.push(error));
      if (binding?.kind !== 'choice') throw new Error('Q1 language choice missing');
      expect(binding.choices().some(choice => choice.id === 'french')).toBe(true);
      binding.write('french');
      for (let attempt = 0; attempt < 100 && languages.selectedLanguage(identity.seat(0)) !== 'french'; attempt++) await Bun.sleep(1);
      expect(languages.selectedLanguage(identity.seat(0))).toBe('french'); expect(errors).toEqual([]);
      const selectedMessages = new Q1MessageLocalization(identity.seat(0), { content: { catalog, forContent: async () => mounts } }, () => languages.selectedLanguage(identity.seat(0)));
      expect(await selectedMessages.resolve(source, '$qc_backpack_got', [])).toBe('Obtenu : ');
    } finally { textures.close(); images.close(); }

  } finally { await rm(root, { recursive: true, force: true }); }
});

test('classic engine notices cover secrets, counters, every key hint and Rogue source messages without rerelease assets', () => {
  for (const [key, value] of classicQ1Messages) {
    expect(classicQ1Text(key, ['Ranger'])).not.toContain('$qc_');
    expect(value.length).toBeGreaterThan(0);
  }
  expect(classicQ1Text('$qc_found_secret')).toBe('You found a secret area!');
  expect(classicQ1Text('$qc_need_gold_runekey')).toBe('You need the gold runekey');
  expect(classicQ1Text('$qc_enemy_killed_bonus', [2])).toBe('Enemy flag carrier killed: 2 bonus frags\n');
  expect(classicQ1Text('$qc_has_token', ['Ranger'])).toBe('Ranger has the tag token!\n');
  expect(classicQ1Text('$mod_unknown')).toBe('$mod_unknown');
  expect(q1EntityString('first\\nsecond')).toBe('first\nsecond');
  expect(q1EntityString('first\\tsecond')).toBe('first\\second');
  expect(q1EntityString('first\\\\nsecond')).toBe('first\\nsecond');
});

test('classic source resolution needs no rerelease product and respects source-only mod localization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q1-classic-localization-'));
  try {
    await mkdir(join(root, 'localization'));
    await writeFile(join(root, 'localization/loc_french_mod.txt'), 'qc_found_secret="Secret du mod"');
    const mount: ContentMount = { kind: 'loose', identity: createMountIdentity('mount:test:classic-loc', classic, 0), rootPath: root };
    using mounts = await openMountPlan({ id: 'mount-plan:test:classic-loc', mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
    const catalog = new InstalledCatalog('', [product(classic, 'q1-classic-id1')], [], 0);
    let language = 'english';
    const messages = new Q1MessageLocalization(createIdentityOwner('classic-no-rerelease').seat(0), { content: { catalog, forContent: async id => { expect(id).toBe(classic); return mounts; } } }, () => language);
    expect(await messages.resolve(classic, '$qc_found_secret', [])).toBe('You found a secret area!');
    expect(await messages.resolve(classic, '$qc_three_more', [])).toBe('Only 3 more to go...');
    expect(await messages.resolve(classic, '$qc_need_silver_keycard', [])).toBe('You need the silver keycard');
    language = 'french'; expect(await messages.resolve(classic, '$qc_found_secret', [])).toBe('Secret du mod');
    expect(await messages.resolve(classic, '$qc_three_more', [])).toBe('Only 3 more to go...');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('provided classic start map message newlines decode at the entity-provider boundary', async () => {
  const { openArchive } = await import('../../../src/content/archive/index.ts');
  const { readQ1Bsp } = await import('../../../src/formats/q1-map/index.ts');
  const archive = await openArchive(resolve('../qfiles/q1/id1/PAK0.PAK'));
  try {
    const entry = archive.findEntries('maps/start.bsp')[0]; if (entry === undefined) throw new Error('Missing supplied start map');
    const map = readQ1Bsp(await archive.readEntry(entry), { source: 'maps/start.bsp' });
    const messages = map.entityList.flatMap(entity => entity.properties.filter(property => property.key === 'message').map(property => property.value));
    const multiline = messages.filter(message => message.includes('\\n'));
    expect(multiline.length).toBeGreaterThan(0);
    for (const raw of multiline) { expect(q1EntityString(raw)).toContain('\n'); expect(q1EntityString(raw)).not.toContain('\\n'); }
  } finally { archive.close(); }
});
