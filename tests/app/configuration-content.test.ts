import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { applicationDiscoversMods, applicationConfigurationPreset, applicationPreset, openApplicationConfigurationContent, remoteConfigurationContent } from '../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { prepareQ3ApplicationProduct } from '../../src/app/bootstrap/q3-product.ts';
import { discoverInstalledContent, expectedProducts, presetChoice, resolveLaunch } from '../../src/content/catalog/index.ts';
import type { ProductExpectation } from '../../src/content/catalog/index.ts';
import type { GameFamily, LaunchChoice, ProviderReference } from '../../src/contracts/content.ts';
import { prepareLaunchMountPlan } from '../../src/content/catalog/launch.ts';
import { selectedWeaponResources } from '../../src/content/catalog/weapons.ts';
import { serverDefinitionsForRecipe, serverDefinitionsForSelection } from '../../src/settings/server/selection.ts';
import { prepareInitialConfiguration, prepareProfileConfiguration } from '../../src/app/bootstrap/configuration.ts';
import { ApplicationConsoleRouting } from '../../src/app/bootstrap/console.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';
import { SeatInput } from '../../src/input/seat.ts';
import { createIdentityOwner, type ClientId } from '../../src/contracts/identity.ts';
import { EngineSession, type SessionSeat } from '../../src/world/session/index.ts';
import { ConfigStore } from '../../src/settings/config.ts';
import { PreparedStartup } from '../../src/app/bootstrap/prepared-startup.ts';
import { ConsoleScriptFiles } from '../../src/app/bootstrap/config-scripts.ts';
import { MouseSettings } from '../../src/input/mouse-settings.ts';
import { defaultGamepadTuning } from '../../src/input/gamepad.ts';

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
  products.push({ ...q3, id: 'q3-testmod', campaign: 'testmod', contentDirectory: 'q3a/testmod', baseProduct: q3.id, requiredPrograms: ['vm/qagame.qvm'] });
  for (const product of products) {
    await mkdir(join(root, product.contentDirectory), { recursive: true });
    await writeFile(join(root, product.contentDirectory, 'quake.rc'), `echo ${product.id}\n`);
    await writeFile(join(root, product.contentDirectory, 'config.cfg'), `set fixture ${product.id}\n`);
  }
  await mkdir(join(root, 'q3a/testmod/vm'), { recursive: true });
  await writeFile(join(root, 'q3a/testmod/vm/qagame.qvm'), 'fixture-program');
  // Valid donor retail identification makes this synthetic Q3 installation retail.
  await writeFile(join(root, 'q3a/baseq3/productid.txt'), Buffer.from('VGhpcyBmaWxlIGlzIGNvcHlyaWdodCAxOTk5IElkIFNvZnR3YXJlLCBhbmQgbWF5IG5vdCBiZSBkdXBsaWNhdGVkIGV4Y2VwdCBkdXJpbmcgYSBsaWNlbnNlZCBpbnN0YWxsYXRpb24gb2YgdGhlIGZ1bGwgY29tbWVyY2lhbCB2ZXJzaW9uIG9mIFF1YWtlIDM6QXJlbmE=', 'base64'));
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

test('profile scripts stage rules bindings and aliases before map admission without consuming the old program', async () => {
  const { root, catalog } = await fixture();
  const identity = createIdentityOwner('staged-profile-configuration'), session = new EngineSession(identity, { kind: 'local' });
  const settings = new ConfigStore(join(root, 'settings'));
  try {
    const initialOptions = { ...options('q2-classic-baseq2'), userContentRoot: join(root, 'user') };
    const initialPreset = applicationConfigurationPreset(catalog, initialOptions);
    const initialContent = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset: initialPreset, choice: presetChoice(initialPreset.id) });
    const actualSeats = new Map<ClientId, SessionSeat>();
    const initial = await prepareInitialConfiguration(initialOptions, initialContent, session, identity, actualSeats, settings, { print() {} }, [], 1, async () => {});
    try {
      const selected = { ...options('q1-classic-id1'), userContentRoot: join(root, 'user') };
      const product = catalog.require(selected.product), directory = join(root, product.expectation.contentDirectory);
      await writeFile(join(directory, 'quake.rc'), 'exec default.cfg\nexec config.cfg\nexec autoexec.cfg\n');
      await writeFile(join(directory, 'default.cfg'), 'bind w +forward\n');
      await writeFile(join(directory, 'config.cfg'), 'sensitivity 8\n');
      await writeFile(join(directory, 'autoexec.cfg'), 'skill 1\nwait\nsensitivity 9\nbind mouse2 +jump\nalias profile_alias "echo selected"\nmap e1m1\nexec continuation.cfg\n');
      await writeFile(join(directory, 'continuation.cfg'), 'wait\nskill 3\nmap e1m2\necho profile-finished\n');
      const preset = applicationConfigurationPreset(catalog, selected);
      const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
      const original = initial.prepared.seats[0], actual = [...actualSeats.values()][0];
      if (original === undefined || actual === undefined || initial.image === null) throw new Error('Initial client owners missing');
      const shared = new CvarRegistry({ dialect: initial.image.cvars.dialect, context: initial.image.cvars.context });
      shared.restoreSaveState(initial.image.cvars.captureWorldTransferState());
      const oldBindings = original.input.bindings, oldMouse = original.mouse.read();
      initial.prepared.commands.append('echo original-tail\n', original.context);
      const addedClient = session.prepareClient(1), addedSeat = session.prepareSeat(1, addedClient);
      const addedInput = new SeatInput({ seat: addedSeat.id, dialect: 'q1-netquake', commands: initial.prepared.commands,
        context: { session: session.session, origin: { kind: 'local-seat', seat: addedSeat.id, client: addedClient.id } }, uiEvent: () => false });
      let loadingFrames = 0;
      const profile = await prepareProfileConfiguration({ prepared: initial.prepared, seats: [{ seat: actual, input: original.input },
        { seat: addedSeat, input: addedInput, selectedBindings: [{ input: { kind: 'key', code: 70 }, target: { kind: 'command', text: 'flashlight' } }] }],
        options: selected, content, settings, shared, host: { print() {} }, sourceArchive: [], defaultCapacity: 1,
        nextFrame: async () => { loadingFrames++; } });
      try {
        expect(profile.options.skill).toBe(1);
        expect(profile.seats[0]?.mouse.read().sensitivity).toBe(9);
        expect(profile.program.input(actual.id)?.binding({ kind: 'mouse-button', button: 3 })).toEqual({ kind: 'command', text: '+jump' });
        expect(profile.program.input(addedSeat.id)?.binding({ kind: 'key', code: 70 })).toBeNull();
        expect(addedInput.bindings).toEqual([]);
        profile.applyBindingDefaults(actual.id, [{ input: { kind: 'mouse-button', button: 3 }, target: { kind: 'command', text: '+attack' } },
          { input: { kind: 'key', code: 55 }, target: { kind: 'command', text: 'weapon 7' } }]);
        expect(profile.program.input(actual.id)?.binding({ kind: 'mouse-button', button: 3 })).toEqual({ kind: 'command', text: '+jump' });
        expect(profile.program.input(actual.id)?.binding({ kind: 'key', code: 55 })).toEqual({ kind: 'command', text: 'weapon 7' });
        const choices = profile.bindingChoices.find(choices => choices.id.equals(actual.id));
        expect(choices?.overriddenKeys).toContain('mouse:3');
        expect(choices?.allBindingsChosen).toBe(false);
        expect(choices?.selectedBindings.some(binding => binding.input.kind === 'key' && binding.input.code === 55)).toBe(true);
        expect(original.overriddenKeys.has('mouse:3')).toBe(false);
        expect(profile.program.commands.aliasValue('profile_alias')).toContain('selected');
        expect(profile.requests.map(request => [request.name, request.arguments_])).toEqual([['map', ['e1m1']]]);
        expect(loadingFrames).toBeGreaterThan(0);
        expect(profile.program.commands.pendingText).toContain('exec continuation.cfg');
        expect(profile.program.commands.pendingText).toContain('echo original-tail\n');
        expect(initial.prepared.commands.pendingText).toBe('echo original-tail\n');
        expect(initial.prepared.commands.aliasValue('profile_alias')).toBeUndefined();
        expect(original.input.bindings).toEqual(oldBindings);
        expect(original.mouse.read()).toEqual(oldMouse);
        expect(session.clientAt(actual.client.id.slot)).toBe(actual.client);
        await expect(resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) })).rejects.toThrow('Required resource is missing');
        const prepared = initial.prepared;
        let currentSource = new CvarRegistry({ dialect: profile.source.dialect, context: profile.source.context });
        currentSource.restoreSaveState(profile.source.captureWorldTransferState());
        const adoptedRouting = new ApplicationConsoleRouting({ fallback: profile.fallback, sourceDialect: () => currentSource.dialect,
          server: () => ({ cvars: currentSource, sharedNames: currentSource.snapshots().map(variable => variable.name) }),
          seat: id => prepared.seats.find(seat => seat.id.equals(id))?.cvars ?? null,
          input: id => prepared.seats.find(seat => id === null || seat.id.equals(id))?.mouse.cvars ?? null,
          movement: () => prepared.movement, shared: () => initial.image?.cvars ?? null });
        const seen: [string, number][] = [['e1m1', currentSource.variableValue('skill')]];
        const forward = (name: string, args: readonly string[]): undefined => {
          if (name === 'map') seen.push([args[0] ?? '', currentSource.variableValue('skill')]);
          return undefined;
        };
        const output: string[] = [], release = prepared.bindOutput(text => { output.push(text); });
        try {
          profile.program.publish();
          prepared.publishSeats(profile.seats);
          prepared.adopt(adoptedRouting, forward, { source: currentSource, movement: profile.movement,
            fallback: profile.fallback, scripts: profile.scripts, read: profile.read });
          profile.publishContinuation(prepared);
          expect(prepared.pending).toBe(true);
          prepared.commands.append('echo newly-typed\n', original.context);
          for (let frame = 0; frame < 20 && seen.length < 2; frame++) await prepared.advanceFrame();
          expect(seen).toEqual([['e1m1', 1], ['e1m2', 3]]);
          expect(profile.source.variableValue('skill')).toBe(1);
          expect(output.join('')).not.toContain('profile-finished');
          const nextSource = new CvarRegistry({ dialect: currentSource.dialect, context: currentSource.context });
          nextSource.restoreSaveState(currentSource.captureWorldTransferState()); currentSource = nextSource;
          prepared.adopt(adoptedRouting, forward, { source: currentSource, movement: profile.movement,
            fallback: profile.fallback, scripts: profile.scripts, read: profile.read });
          for (let frame = 0; frame < 20 && prepared.pending; frame++) await prepared.advanceFrame();
          expect(prepared.pending).toBe(false);
          expect(addedInput.binding({ kind: 'key', code: 70 })).toEqual({ kind: 'command', text: 'flashlight' });
          expect(output.join('')).toContain('profile-finished');
          expect(output.join('')).not.toContain('original-tail');
          await prepared.commands.advanceProgramFrame();
          expect(output.filter(text => /profile-finished|original-tail|newly-typed/.test(text)).map(text => text.trim())).toEqual([
            'profile-finished', 'original-tail', 'newly-typed',
          ]);
        } finally { release(); adoptedRouting.close(); }

      } finally { profile.routing.close(); await profile.scripts.close(); }
    } finally { await initial.image?.close(); await initial.scripts.close(); }
  } finally { session.close(); await rm(root, { recursive: true, force: true }); }
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
      expect(applicationDiscoversMods({ ...options('q1-classic-id1'), movement: 'q1', character: 'q1' }, { ...recipe, execution: [] })).toBe(true);
      expect(applicationDiscoversMods({ ...options('q1-classic-id1'), network: { kind: 'q3-client', remote: '127.0.0.1:27960' } }, recipe)).toBe(false);
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


test('remote profile uses its actual client registry and stages configuration before signon without loading a map', async () => {
  const { root, catalog } = await fixture();
  const identity = createIdentityOwner('remote-profile-before-signon'), session = new EngineSession(identity, { kind: 'local' });
  const settings = new ConfigStore(join(root, 'settings'));
  try {
    const initialOptions = { ...options('q2-classic-baseq2'), userContentRoot: join(root, 'user') };
    const preset = applicationConfigurationPreset(catalog, initialOptions);
    const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
    const actualSeats = new Map<ClientId, SessionSeat>();
    const initial = await prepareInitialConfiguration(initialOptions, content, session, identity, actualSeats, settings, { print() {} }, [], 1, async () => {});
    try {
      const original = initial.prepared.seats[0], actual = [...actualSeats.values()][0], image = initial.image;
      if (original === undefined || actual === undefined || image === null) throw new Error('Initial owners missing');
      const selected = { ...options('q3-baseq3'), userContentRoot: join(root, 'user') };
      const directory = join(root, catalog.require(selected.product).expectation.contentDirectory);
      await writeFile(join(directory, 'default.cfg'), 'bind w +forward\n');
      await writeFile(join(directory, 'q3config.cfg'), 'set name config-name\n');
      await writeFile(join(directory, 'autoexec.cfg'), 'wait\nset name autoexec-name\nbind mouse2 +jump\nconnect example.invalid\nset name after-connect\n');
      const nextPreset = applicationConfigurationPreset(catalog, selected);
      const product = await prepareQ3ApplicationProduct(catalog, selected.product, selected);
      if (product.q3Product === null) throw new Error('Missing selected Q3 policy');
      const mounted = await openApplicationConfigurationContent(product.catalog, { kind: 'launch', preset: nextPreset, choice: presetChoice(nextPreset.id) }, product.q3Product);
      const client = new CvarRegistry({ dialect: 'q3', context: original.context });
      client.register('name', 'Player');
      const images = image.prepareClientSettings();
      const oldBindings = original.input.bindings, oldSource = initial.prepared.source;
      initial.prepared.commands.append('echo retained-tail\n', original.context);
      const profile = await prepareProfileConfiguration({ prepared: initial.prepared,
        clientSource: { inputState: "retained", cvars: client, archive: 'set name archived-name\n', route: routing => routing },
        seats: [{ seat: actual, input: original.input }], options: selected, content: remoteConfigurationContent(selected, { ...mounted, q3Product: product.q3Product }),
        settings, shared: images.settings.cvars, host: { print() {} }, sourceArchive: [], defaultCapacity: 1, nextFrame: async () => {} });
      try {
        expect(profile.source).toBe(client);
        expect(profile.seats[0]?.cvars).toBe(client);
        expect(client.variableString('name')).toBe('archived-name');
        expect(client.find('sv_maxclients')).toBeUndefined();
        expect(profile.requests).toEqual([]);
        expect(initial.prepared.source).toBe(oldSource);
        expect(initial.prepared.commands.pendingText).toBe('echo retained-tail\n');
        expect(original.input.bindings).toEqual(oldBindings);
        expect(profile.program.commands.pendingText).toContain('connect example.invalid');
        profile.program.validatePublication(); images.validatePublication();
        images.publish(); profile.program.publish();
        initial.prepared.publishSeats(profile.seats, [actual.id]);
        const requests: string[] = [];
        const forward = (name: string): undefined => { requests.push(name); return undefined; };
        initial.prepared.adopt(profile.routing, forward, profile);
        profile.forwardCommands(request => { requests.push(request.name); });
        profile.publishContinuation(initial.prepared);
        expect(initial.prepared.seats[0]?.input).toBe(original.input);
        expect(client.variableString('name')).toBe('archived-name');
        await initial.prepared.advanceFrame();
        expect(requests).toEqual(['connect']);
        expect(client.variableString('name')).toBe('autoexec-name');
        for (let frame = 0; frame < 10 && initial.prepared.pending; frame++) await initial.prepared.advanceFrame();
        expect(client.variableString('name')).toBe('after-connect');
        expect(initial.prepared.pending).toBe(false);
        await expect(resolveLaunch({ catalog, preset: nextPreset, choice: presetChoice(nextPreset.id) })).rejects.toThrow('Required resource is missing');
      } finally { profile.routing.close(); await profile.scripts.close(); await images.settings.close(); }
    } finally { await initial.image?.close(); await initial.scripts.close(); }
  } finally { session.close(); await rm(root, { recursive: true, force: true }); }
});


test('fresh owned remote seed retains selected defaults and saved input settings on the actual seat', async () => {
  const { root, catalog } = await fixture();
  try {
    const selected = { ...options('q3-baseq3'), userContentRoot: join(root, 'user') };
    const directory = join(root, catalog.require(selected.product).expectation.contentDirectory);
    await writeFile(join(directory, 'default.cfg'), 'bind w +forward\n');
    await writeFile(join(directory, 'q3config.cfg'), 'sensitivity 8\nbind x +jump\n');
    await writeFile(join(directory, 'autoexec.cfg'), '');
    for (const saved of [false, true]) {
      const identity = createIdentityOwner(`fresh-remote-${saved}`), session = new EngineSession(identity, { kind: 'local' });
      const actual = session.createSeat(0, session.createClient(0));
      const context = { session: session.session, origin: { kind: 'local-seat', seat: actual.id, client: actual.client.id } } satisfies import('../../src/contracts/common.ts').CommandContext;
      const sourceContext = { session: session.session, origin: { kind: 'local-console' } } satisfies import('../../src/contracts/common.ts').CommandContext;
      const settings = new ConfigStore(join(root, `fresh-settings-${saved}`));
      const scripts = new ConsoleScriptFiles({ consoleRoot: join(root, 'console'), settings, mounted: undefined });
      const mouse = new MouseSettings(new CvarRegistry({ dialect: 'q3', context }));
      if (saved) await settings.saveSeat('input/seat-1.json', { version: 1, bindings: [{ input: { kind: 'key', code: 101 }, target: { kind: 'command', text: '+use' } }],
        gamepad: defaultGamepadTuning, mouse: { ...mouse.read(), sensitivity: 11 }, history: [], rumble: false, controller: { kind: 'none' } });
      const seed = new CvarRegistry({ dialect: 'q3', context: sourceContext });
      const prepared = new PreparedStartup(seed, seed, scripts, { dialect: 'q3', movementDialect: 'q3',
        seats: [{ id: actual.id, context, cvars: new CvarRegistry({ dialect: 'q3', context }), mouse, profile: null, archive: [], mouseArchive: [] }],
        shared: null, sharedNames: [], print() {}, forward: () => undefined });
      const input = prepared.seats[0]?.input;
      if (input === undefined) throw new Error('Owned seed did not allocate its input');
      const preset = applicationConfigurationPreset(catalog, selected);
      const content = await openApplicationConfigurationContent(catalog, { kind: 'launch', preset, choice: presetChoice(preset.id) });
      const client = new CvarRegistry({ dialect: 'q3', context });
      try {
        const profile = await prepareProfileConfiguration({ prepared, clientSource: { inputState: 'fresh', cvars: client, archive: null, route: routing => routing },
          seats: [{ seat: actual, input }], options: selected, content, settings, shared: new CvarRegistry({ dialect: 'q3', context: sourceContext }),
          host: { print() {} }, sourceArchive: [], defaultCapacity: 1, nextFrame: async () => {} });
        try {
          expect(profile.seats[0]?.mouse.read().sensitivity).toBe(saved ? 11 : 8);
          expect(profile.program.input(actual.id)?.binding({ kind: 'key', code: saved ? 101 : 120 })).toEqual({ kind: 'command', text: saved ? '+use' : '+jump' });
          if (!saved) expect(profile.program.input(actual.id)?.binding({ kind: 'mouse-button', button: 1 })).not.toBeNull();
          expect(profile.bindingChoices[0]?.allBindingsChosen).toBe(saved);
          expect(profile.bindingChoices[0]?.overriddenKeys).not.toContain('mouse:1');
          expect(input.bindings).toEqual([]);
          profile.program.publish(); prepared.publishSeats(profile.seats, [actual.id]);
          prepared.adopt(profile.routing, () => undefined, profile); profile.publishContinuation(prepared);
          expect(prepared.seats[0]?.input).toBe(input);
          expect(session.clientAt(actual.client.id.slot)).toBe(actual.client);
          expect(input.binding({ kind: 'key', code: saved ? 101 : 120 })).toEqual({ kind: 'command', text: saved ? '+use' : '+jump' });
        } finally { profile.routing.close(); await profile.scripts.close(); }
      } finally { await content.close(); await scripts.close(); session.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('configuration and world discovery follow selected products rather than movement or character', () => {
  const movements: readonly GameFamily[] = ['q1', 'q2', 'q3'];
  for (const product of ['q1-classic-custom-source', 'q2-classic-custom-source', 'q3-custom-source', 'q1:classic:custom-source:installed']) {
    for (const movement of movements) {
      const selected = { ...options(product), movement };
      expect(applicationDiscoversMods(selected)).toBe(true);
      expect(applicationDiscoversMods({ ...selected, network: { kind: 'q3-client', remote: '127.0.0.1:27960' } })).toBe(false);
    }
  }
  expect(applicationDiscoversMods({ ...options('q3-baseq3'), movement: 'q1', character: 'q2' })).toBe(true);
  expect(applicationDiscoversMods({ ...options('q1-classic-id1'), movement: 'q3', character: 'q3' })).toBe(false);
  expect(applicationDiscoversMods({ ...options('q1-classic-id1'), dedicated: true, network: { kind: 'native-server', host: '127.0.0.1', port: 26000 } })).toBe(true);
});
