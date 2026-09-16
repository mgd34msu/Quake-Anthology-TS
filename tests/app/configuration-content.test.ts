import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { applicationConfigurationPreset, applicationPreset, openApplicationConfigurationContent } from '../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { discoverInstalledContent, expectedProducts, presetChoice, resolveLaunch } from '../../src/content/catalog/index.ts';
import type { ProductExpectation } from '../../src/content/catalog/index.ts';
import type { LaunchChoice, ProviderReference } from '../../src/contracts/content.ts';
import { prepareLaunchMountPlan } from '../../src/content/catalog/launch.ts';
import { selectedWeaponResources } from '../../src/content/catalog/weapons.ts';
import { serverDefinitionsForRecipe, serverDefinitionsForSelection } from '../../src/settings/server/selection.ts';
import { prepareInitialConfiguration } from '../../src/app/bootstrap/configuration.ts';
import { createIdentityOwner, type ClientId } from '../../src/contracts/identity.ts';
import { EngineSession, type SessionSeat } from '../../src/world/session/index.ts';
import { ConfigStore } from '../../src/settings/config.ts';

function options(game: string) {
  const parsed = parseApplicationCommand(['--game', game, '--map', 'missing']);
  if (parsed.kind !== 'run') throw new Error('Expected launch');
  return parsed.options;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'quake-configuration-content-'));
  const products: ProductExpectation[] = ['q1-classic-id1', 'q1-quakeworld', 'q2-classic-baseq2', 'q3-baseq3'].map(id => {
    const product = expectedProducts.find(value => value.id === id); if (product === undefined) throw new Error(`Missing product ${id}`);
    return { ...product, requiredContentArchives: [], requiredPrograms: [], mapWitness: null };
  });
  const q3 = products.find(product => product.id === 'q3-baseq3'); if (q3 === undefined) throw new Error('No Q3 product');
  products.push({ ...q3, id: 'q3-testmod', campaign: 'testmod', contentDirectory: 'q3a/testmod', baseProduct: q3.id });
  for (const product of products) {
    await mkdir(join(root, product.contentDirectory), { recursive: true });
    await writeFile(join(root, product.contentDirectory, 'quake.rc'), `echo ${product.id}\n`);
    await writeFile(join(root, product.contentDirectory, 'config.cfg'), `set fixture ${product.id}\n`);
  }
  const userContentRoot = join(root, 'user'); await mkdir(join(userContentRoot, 'q3a/testmod'), { recursive: true });
  await writeFile(join(userContentRoot, 'q3a/testmod/config.cfg'), 'set fixture user-mod\n');
  const catalog = await discoverInstalledContent({ corpusRoot: root, userContentRoot, discoverMods: false, products });
  return { root, catalog };
}

test('real initial configuration retains actual two-seat owners and mixed movement before a missing BSP', async () => {
  const { root, catalog } = await fixture();
  const identity = createIdentityOwner('configuration-before-world');
  const session = new EngineSession(identity, { kind: 'local' });
  try {
    const selected = { ...options('q2-classic-baseq2'), seats: 2, movement: 'q1', userContentRoot: join(root, 'user') } satisfies ReturnType<typeof options>;
    const product = catalog.require(selected.product);
    await writeFile(join(root, product.expectation.contentDirectory, 'default.cfg'), 'bind w +forward\n');
    const preset = applicationConfigurationPreset(catalog, selected);
    const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
    const seats = new Map<ClientId, SessionSeat>();
    const prepared = await prepareInitialConfiguration(selected, content, session, identity, seats,
      new ConfigStore(join(root, 'settings')), { print() {} }, [], 1, async () => {});
    try {
      expect(prepared.prepared.commands.dialect).toBe('q2-classic');
      expect(prepared.prepared.movement.dialect).toBe('q1-netquake');
      expect(seats.size).toBe(2);
      for (const local of prepared.prepared.seats) {
        const actual = [...seats.values()].find(seat => seat.id.equals(local.id));
        if (actual === undefined) throw new Error('Prepared seat did not retain allocated session seat');
        expect(local.context.origin).toEqual({ kind: 'local-seat', seat: actual.id, client: actual.client.id });
        expect(local.input.dialect).toBe('q1-netquake');
      }
      await expect(resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) })).rejects.toThrow('Required resource is missing');
      expect(new TextDecoder().decode(await content.mounts.read('default.cfg'))).toBe('bind w +forward\n');
    } finally { await prepared.image?.close(); await prepared.scripts.close(); }
    await expect(content.mounts.read('default.cfg')).rejects.toThrow();
  } finally { session.close(); await rm(root, { recursive: true, force: true }); }
});

test('configuration opens quake.rc/config with a missing map and leaves local resource admission intact', async () => {
  const { root, catalog } = await fixture();
  try {
    const preset = applicationConfigurationPreset(catalog, options('q1-classic-id1'));
    const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
    expect(new TextDecoder().decode(await content.mounts.read('quake.rc'))).toBe('echo q1-classic-id1\n');
    expect(new TextDecoder().decode(await content.mounts.read('config.cfg'))).toBe('set fixture q1-classic-id1\n');
    expect(content.selection.source).toEqual(preset.map.entities);
    await expect(resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) })).rejects.toThrow('Required resource is missing');
    await content.close(); await expect(content.mounts.read('quake.rc')).rejects.toThrow(); await content.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('QW and custom Q3 client metadata is map independent while local authority restrictions remain', async () => {
  const { root, catalog } = await fixture();
  try {
    for (const product of ['q1-quakeworld', 'q3-testmod']) {
      const selected = { ...options('q1-classic-id1'), product, movement: 'q3', character: 'q1' } satisfies ReturnType<typeof options>;
      expect(() => applicationPreset(catalog, selected)).toThrow(product === 'q1-quakeworld' ? 'Native QuakeWorld' : 'Selected Q3 mods');
      const preset = applicationConfigurationPreset(catalog, selected);
      const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
      try {
        expect(new TextDecoder().decode(await content.mounts.read('quake.rc'))).toBe(`echo ${product}\n`);
        expect(content.selection.source.content).toBe(catalog.require(product).id);
        expect(content.selection.movement.content).toBe(catalog.require(product === 'q3-testmod' ? product : 'q3-baseq3').id);
        expect(content.selection.timing.find(value => value.provider === content.selection.movement.provider)?.clock.kind).toBe('q3');
        if (product === 'q1-quakeworld') expect(content.selection.timing.find(value => value.provider === content.selection.source.provider)?.clock.kind).toBe('q1-quakeworld');
        else expect(serverDefinitionsForSelection(content.selection).length).toBeGreaterThan(0);
      } finally { await content.close(); }
    }
    const progs = { ...options('q1-classic-id1'), quakeCProgram: 'missing-progs.dat' };
    expect(() => applicationPreset(catalog, progs)).toThrow('--progs requires');
    const preset = applicationConfigurationPreset(catalog, progs);
    const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
    await content.close();
    const remote = parseApplicationCommand(['--game', 'q3-baseq3', '--connect-q3', '127.0.0.1']);
    if (remote.kind !== 'run') throw new Error('Expected remote launch');
    const remotePreset = applicationPreset(catalog, { ...remote.options, product: 'q3-testmod' });
    expect(remotePreset.execution[0]?.kind).toBe('typescript');
    expect(remotePreset.movement).toEqual(applicationPreset(catalog, remote.options).movement);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('mixed selected launch mount order and artifact overrides match normal resolution; saved metadata stays exact', async () => {
  const { root, catalog } = await fixture();
  try {
    const preset = applicationConfigurationPreset(catalog, { ...options('q1-classic-id1'), map: 'maps/present.bsp' });
    const q3: ProviderReference = { provider: 'q3:official', content: catalog.require('q3-testmod').id };
    const q2: ProviderReference = { provider: 'q2:official', content: catalog.require('q2-classic-baseq2').id };
    const choice: LaunchChoice = { ...presetChoice(preset.id), engineBehavior: { kind: 'selected', value: q3 }, combat: { kind: 'selected', value: q2 },
      match: { kind: 'selected', value: q2 }, weapons: { kind: 'selected', value: [q2] },
      presentation: { kind: 'selected', value: { ...preset.presentation, assets: q3.content } },
      execution: { kind: 'selected', value: [{ kind: 'qvm', owner: q3, role: 'server-game', artifact: { content: q3.content, path: 'vm/qagame.qvm' }, api: { kind: 'q3-qagame', version: 8 } }] },
    };
    const prepared = await prepareLaunchMountPlan({ catalog, preset, choice });
    expect(prepared.selected.weapons[0]?.provider).toBe('q2:weapons/classic/baseq2');
    const config = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice });
    try {
      expect(config.mounts.plan).toEqual(prepared.plan);
      expect(new TextDecoder().decode(await config.mounts.read('config.cfg'))).toBe('set fixture user-mod\n');
      expect(config.selection.engineBehavior).toEqual(q3); expect(config.selection.combat).toEqual(q2);
      const requests = [{ content: preset.map.geometry.content, path: preset.map.geometry.path }, { content: q3.content, path: 'vm/qagame.qvm' },
        ...selectedWeaponResources(preset.map.entities, [q2], catalog)];
      for (const request of requests) {
        const file = join(root, catalog.require(request.content).expectation.contentDirectory, request.path);
        await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'fixture-resource');
      }
      const recipe = await resolveLaunch({ catalog, preset, choice });
      expect(config.mounts.plan).toEqual(recipe.mounts);
      expect(recipe.mounts.prefixOrders[0]?.prefix).toBe('vm/qagame.qvm');
      expect(serverDefinitionsForSelection(config.selection)).toEqual(serverDefinitionsForRecipe(recipe));
      await unlink(join(root, catalog.require(preset.map.geometry.content).expectation.contentDirectory, preset.map.geometry.path));
      const saved = await openApplicationConfigurationContent(catalog, { kind: 'recipe', recipe });
      try {
        expect(saved.selection).toEqual({ source: recipe.map.entities, engineBehavior: recipe.engineBehavior, match: recipe.match, combat: recipe.combat, movement: recipe.movement, timing: recipe.timing });
        expect(saved.mounts.plan).toEqual(recipe.mounts); await config.close();
        expect(new TextDecoder().decode(await saved.mounts.read('config.cfg'))).toBe('set fixture user-mod\n');
      } finally { await saved.close(); }
    } finally { await config.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
