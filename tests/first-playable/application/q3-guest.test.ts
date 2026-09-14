import { readSaveImage } from "../../../src/persistence/save-image.ts";
import { Q3PresentationAudio } from "../../../src/content/q3/presentation/audio.ts";
import { ApplicationAudio } from "../../../src/app/bootstrap/audio.ts";
import { Q3ServerConnection } from '../../../src/network/q3/server.ts';
import type { ClientMessageReader } from '../../../src/network/q3/client-message.ts';
import { QvmGame } from '../../../src/compat/qvm/game.ts';
import { WorldSeatPresentation } from '../../../src/app/bootstrap/presentation.ts';
import { q3InfoValue } from '../../../src/network/q3/admission.ts';
import { CommandBuffer } from '../../../src/core/commands/index.ts';
import { userProductDirectory } from '../../../src/content/user-data.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { QvmUi } from '../../../src/compat/qvm/ui.ts';
import { QvmCgame } from '../../../src/compat/qvm/cgame.ts';
import { knownQvmArtifacts } from '../../../src/compat/qvm/artifacts.ts';
import type { ModuleIdentity, Q3ApiIdentity } from '../../../src/contracts/execution.ts';
import { StartupServerBrowser } from '../../../src/app/bootstrap/server-browser.ts';
import { StartupSaves } from '../../../src/app/bootstrap/startup-saves.ts';
import { ConfigStore } from '../../../src/settings/config.ts';
import { expect, test, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';

function options(root: string) {
  const parsed = parseApplicationCommand(['--game', 'q3-classic-lrctf', '--map', 'q3ctf1', '--movement', 'q3', '--character', 'q3',
    '--dedicated', '--mode', 'deathmatch', '--listen', '0', '--bind', '127.0.0.1', '--user-content-root', root]);
  if (parsed.kind !== 'run') throw new Error('Missing selected Q3 launch');
  return parsed.options;
}

test('selected LRCTF application executes actual qagame on the shared scene and retires the VM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q3-guest-application-')), printed: string[] = [];
  const directory = userProductDirectory(root, 'q3a/lrctf');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'sv_mapconfig.cfg'), 'set guest_probe 1\nexec guest_nested.cfg\nset guest_probe 3\n');
  writeFileSync(join(directory, 'guest_nested.cfg'), 'set guest_nested_marker 1\nset guest_probe 2\n');
  const inserted = spyOn(CommandBuffer.prototype, 'insert');
  try {
    const app = await Application.open(options(root), { print: text => { printed.push(text); } });
    const guest = app.simulation.q3Guest();
    if (guest === null) throw new Error('Selected qagame did not construct its runtime');
    try {
      expect(app.simulation.q3Source()).toBeNull();
      expect(guest.state.cvars.variableValue('guest_probe')).toBe(3);
      const nested = inserted.mock.calls.find(([text]) => text.includes('guest_nested_marker'))?.[1];
      expect(nested?.origin).toEqual({ kind: 'script', name: 'guest_nested.cfg',
        caller: { kind: 'script', name: 'sv_mapconfig.cfg', caller: { kind: 'server-console' } } });
      expect(() => app.simulation.close()).toThrow('shutdown must be awaited');
      expect(app.content.preparedQ3Game?.resource.requestedPath).toBe('vm/qagame.qvm');
      expect(guest.state.cvars.variableString('fs_game')).toBe('lrctf');
      expect(guest.state.cvars.variableValue('sv_fps')).toBe(20);
      expect(guest.state.cvars.variableValue('g_gametype')).toBe(4);
      expect(guest.state.cvars.variableValue('bot_enable')).toBe(0);
      expect(guest.records.host.scene).toBe(app.simulation.scene);
      expect(guest.records.host.bodies).toBe(app.simulation.bodies);
      expect(guest.game.data.numEntities).toBeGreaterThan(64);
      const output = await app.step(50);
      expect(output.snapshot.frame.time).toEqual({ kind: 'milliseconds', value: 50 });
      expect(output.snapshot.bodies.length).toBeGreaterThan(0);
      expect(app.simulation.players()).toHaveLength(0);
      expect(() => app.simulation.step({ elapsedMilliseconds: 50, commands: [] })).toThrow('awaited');
      await expect(app.loadGame(join(root, 'missing.sav'))).rejects.toThrow('hosting a network game');
      await expect(app.saveGame(join(root, 'missing.sav'))).rejects.toThrow('hosting a network game');
      app.queueCommand('addbot', [], null); app.queueCommand('map_restart', [], null);
      await app.step(50);
      expect(printed.some(text => text.includes('Q3 guest command addbot is unsupported'))).toBe(true);
      expect(printed.some(text => text.includes('Q3 guest command map_restart is unsupported'))).toBe(true);
      expect(guest.state.cvars.variableValue('bot_enable')).toBe(0);
    } finally { await app.close(); }
    expect(() => guest.records.entity(0)).toThrow('retired');
  } finally { inserted.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test('actual LRCTF server and UI/cgame sustain thirty wall seconds with guest movement and firing', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const root = await mkdtemp(join(tmpdir(), 'q3-guest-client-'));
  const common = ['--map', 'q3ctf1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--game', 'q3-classic-lrctf', '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
  if (selected.kind !== 'run') throw new Error('Missing server options');
  const prints: string[] = [], modules: { role: 'ui' | 'cgame'; module: ModuleIdentity; api: Q3ApiIdentity }[] = [];
  const originalUiInit = QvmUi.prototype.init, originalCgInit = QvmCgame.prototype.init;
  const uiInit = spyOn(QvmUi.prototype, 'init').mockImplementation(async function(this: QvmUi, connecting: boolean) {
    await originalUiInit.call(this, connecting);
    modules.push({ role: 'ui', module: this.module.profile.module, api: this.api }); return undefined;
  });
  const cgInit = spyOn(QvmCgame.prototype, 'init').mockImplementation(async function(this: QvmCgame, message: number, command: number, client: number) {
    await originalCgInit.call(this, message, command, client);
    modules.push({ role: 'cgame', module: this.module.profile.module, api: this.api }); return undefined;
  });
  let nextReliableTime = 0, lastReliableCommand = '';
  const executeMessage = Q3ServerConnection.prototype.executeMessage;
  const wireCommands = spyOn(Q3ServerConnection.prototype, 'executeMessage').mockImplementation(async function(this: Q3ServerConnection, reader: ClientMessageReader) {
    await executeMessage.call(this, reader); nextReliableTime = this.nextReliableTime; lastReliableCommand = this.lastClientCommandString;
  });
  const guestCommands = spyOn(QvmGame.prototype, 'clientCommandAsync');
  const frames = spyOn(QvmCgame.prototype, 'drawActiveFrame'), uiRetire = spyOn(QvmUi.prototype, 'retire'), cgRetire = spyOn(QvmCgame.prototype, 'retire');
  let browser: StartupServerBrowser | null = null, server: Application | null = null;
  let movementDiagnostics: unknown = null;
  let app: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  try {
    browser = await StartupServerBrowser.open(new ConfigStore(join(root, 'browser-settings')));
    const retainedBrowser = browser;
    const host = { saveDirectory: join(root, 'saves'), serverBrowser: browser, print: (text: string): undefined => { prints.push(text); return undefined; } };
    server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-content') }, host);
    const source = server.simulation.q3Guest(); if (source === null) throw new Error('Missing actual LRCTF qagame');
    expect(server.simulation.q3Source()).toBeNull(); expect(source.state.cvars.variableString('fs_game')).toBe('lrctf');
    expect(source.state.cvars.variableValue('sv_pure')).toBe(1);
    const address = server.networkAddress; if (address === null) throw new Error('No listener');
    const parsed = parseApplicationCommand([...common, '--game', 'q3-baseq3', '--connect-q3', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '320', '--height', '240', '--hidden']);
    if (parsed.kind !== 'run') throw new Error('Missing client options');
    app = await RemoteApplication.open({ ...parsed.options, userContentRoot: join(root, 'client-content') }, host);
    const remote = app, authority = server;
    const exchange = async (): Promise<void> => {
      await remote.step(50); await Bun.sleep(1); await authority.step(50); await Bun.sleep(1);
      const unbound = prints.find(text => text.includes('Unbound ')); if (unbound !== undefined) throw new Error(unbound);
    };
    for (let tick = 0; tick < 100 && remote.networkPhase !== 'active'; tick++) await exchange();
    if (remote.networkPhase !== 'active') throw new Error(`LRCTF client did not activate: ${prints.join('')}`);
    expect(remote.session.world).toBeNull();
    expect(modules.map(module => module.role)).toEqual(['ui', 'cgame']);
    expect(modules.find(module => module.role === 'ui')?.api).toEqual({ kind: 'q3-ui', version: 6 });
    const selectedModules: { role: string; digest: string; archive: string; revision: string }[] = [];
    for (const module of modules) {
      expect(knownQvmArtifacts.some(known => known.digest === module.module.digest)).toBe(false);
      const opened = await remote.content.mounts.open(`vm/${module.role}.qvm`);
      if (opened === null || opened.reference.provenance.kind !== 'archive') throw new Error('Selected LRCTF module is not mounted archive bytecode');
      expect(opened.reference.digest).toBe(module.module.digest);
      expect(opened.reference.provenance.mount.archivePath.endsWith('/lrctf/pak02.pk3')).toBe(true);
      selectedModules.push({ role: module.role, digest: opened.reference.digest, archive: opened.reference.provenance.mount.archivePath, revision: module.module.revision });
    }
    const player = remote.localPlayers[0], peer = authority.networkClients[0];
    if (player === undefined || peer === undefined) throw new Error('No active LRCTF client');
    const userinfo = source.state.getUserinfo(peer.sourceEntity) ?? '';
    for (const name of ['model', 'headmodel', 'team_model', 'team_headmodel']) expect(q3InfoValue(userinfo, name)).toBe('sarge/default');
    for (const [name, value] of [['color1', '4'], ['color2', '5'], ['sex', 'male'], ['cl_anonymous', '0'], ['cg_predictItems', '1'], ['teamtask', '0']] satisfies readonly (readonly [string, string])[])
      expect(q3InfoValue(userinfo, name)).toBe(value);
    const presentation = player.seat.presentation;
    if (!(presentation instanceof WorldSeatPresentation) || presentation.q3Client === null) throw new Error('No active Q3 cgame presentation');
    const wireState = () => presentation.q3Client?.source.getGameState() ?? [];
    expect(q3InfoValue(wireState()[1] ?? '', 'fs_game')).toBe('lrctf');
    expect(q3InfoValue(wireState()[1] ?? '', 'sv_pure')).toBe('1');
    source.state.cvars.set('sv_maxRate', '12000');
    for (let tick = 0; tick < 10 && q3InfoValue(wireState()[0] ?? '', 'sv_maxRate') !== '12000'; tick++) await exchange();
    expect(q3InfoValue(wireState()[0] ?? '', 'sv_maxRate')).toBe('12000');
    for (let tick = 0; tick < 40 && authority.simulation.timeSeconds * 1000 < nextReliableTime; tick++) await exchange();
    const joinReady = { time: authority.simulation.timeSeconds * 1000, nextReliableTime, lastReliableCommand };
    expect(joinReady.time).toBeGreaterThanOrEqual(joinReady.nextReliableTime);
    remote.queueCommand('team', ['red'], player.seat.id);
    for (let tick = 0; tick < 30 && source.records.player(peer.sourceEntity).persistent[3] !== 1; tick++) await exchange();
    expect(guestCommands.mock.calls.filter(([, args]) => args[0] === 'team' && args[1] === 'red')).toHaveLength(1);
    expect(source.records.player(peer.sourceEntity).persistent[3]).toBe(1);
    await exchange();
    if (presentation.q3Client.capturesInput) {
      for (const down of [true, false]) remote.input({ seat: player.seat.id, kind: 'key', code: 27, down, repeat: false, timeMilliseconds: performance.now() });
      await exchange();
    }
    expect(presentation.q3Client.capturesInput).toBe(false);
    const inputReadyTime = authority.simulation.timeSeconds * 1000;
    const initialPosition = source.records.player(peer.sourceEntity).origin;
    const before = { ...initialPosition }, initialAmmo = source.records.player(peer.sourceEntity).ammo[2] ?? 0;
    let minimumAmmo = initialAmmo, maximumDistance = 0, ticks = 0;
    expect(source.state.cvars.variableValue('sv_pure')).toBe(1);
    const started = performance.now(), startedFrame = remote.frameCount, startedSimulation = authority.simulation.timeSeconds * 1000;
    const sample = () => ({ time: authority.simulation.timeSeconds * 1000,
      command: source.state.getUserCommand(peer.sourceEntity), player: source.records.player(peer.sourceEntity), capturesInput: presentation.q3Client?.capturesInput });
    const samples = [sample()]; movementDiagnostics = samples;
    remote.queueCommand('weapon', ['2'], player.seat.id);
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: true, timeMilliseconds: performance.now() });
    let captured = false;
    while (performance.now() - started < 30000) {
      const tickStarted = performance.now(); await exchange(); ticks++;
      if (ticks <= 5) samples.push(sample());
      if (ticks === 5 && process.env['Q3_GUEST_DIAGNOSTIC'] === '1') throw new Error('Requested five-turn movement diagnostic');
      expect(remote.networkPhase).toBe('active');
      const position = source.records.player(peer.sourceEntity).origin;
      if (position !== undefined) maximumDistance = Math.max(maximumDistance, Math.hypot(position.x - before.x, position.y - before.y, position.z - before.z));
      minimumAmmo = Math.min(minimumAmmo, source.records.player(peer.sourceEntity).ammo[2] ?? initialAmmo);
      if (ticks === 20) remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
      if (ticks === 60) remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: false, timeMilliseconds: performance.now() });
      const artifactDirectory = process.env['Q3_GUEST_ARTIFACTS'];
      if (!captured && ticks >= 60 && artifactDirectory !== undefined) {
        const capture = remote.captureNextFrame(); await exchange();
        const { encodePng } = await import('../../../src/formats/images/png-encoder.ts');
        mkdirSync(artifactDirectory, { recursive: true }); await Bun.write(join(artifactDirectory, 'active.png'), encodePng(320, 240, await capture)); captured = true;
      }
      const remaining = 50 - (performance.now() - tickStarted); if (remaining > 0) await Bun.sleep(remaining);
    }
    const activeMilliseconds = performance.now() - started, simulatedMilliseconds = authority.simulation.timeSeconds * 1000 - startedSimulation;
    const finalPosition = source.records.player(peer.sourceEntity).origin, finalAmmo = source.records.player(peer.sourceEntity).ammo[2];
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: false, timeMilliseconds: performance.now() });
    expect(activeMilliseconds).toBeGreaterThanOrEqual(30000); expect(maximumDistance).toBeGreaterThan(8);
    expect(initialAmmo).toBeGreaterThan(0); expect(minimumAmmo).toBeLessThan(initialAmmo);
    expect(frames.mock.calls.length).toBeGreaterThan(60);
    expect(prints.some(text => text.includes('Unbound '))).toBe(false);
    await remote.close(); app = null;
    for (let tick = 0; tick < 5 && authority.networkClients.length !== 0; tick++) { await Bun.sleep(1); await authority.step(50); }
    expect(authority.networkClients).toHaveLength(0); expect(source.players()).toHaveLength(0);
    expect(uiRetire.mock.calls.length).toBe(1); expect(cgRetire.mock.calls.length).toBe(1);
    await authority.close(); server = null;
    expect(source.isRetired).toBe(true);
    expect(() => retainedBrowser.assertOpen()).not.toThrow();
    const artifactDirectory = process.env['Q3_GUEST_ARTIFACTS'];
    if (artifactDirectory !== undefined) {
      mkdirSync(artifactDirectory, { recursive: true });
      writeFileSync(join(artifactDirectory, 'result.json'), JSON.stringify({ scope: 'Actual LRCTF qagame and UI/cgame on native protocol68, pure enabled', selectedModules, modules,
        qagame: authority.content.preparedQ3Game?.resource, userinfo, joinReady, inputReadyTime, guestCommands: guestCommands.mock.calls, fsGame: source.state.cvars.variableString('fs_game'), simulatedMilliseconds,
        activeMilliseconds, ticks, frames: remote.frameCount - startedFrame, initialPosition: before, finalPosition, maximumDistance, initialAmmo, minimumAmmo, finalAmmo,
        retired: { ui: uiRetire.mock.calls.length, cgame: cgRetire.mock.calls.length, qagame: source.isRetired }, captured, prints }, null, 2));
    }
  } catch (error) {
    const artifactDirectory = process.env['Q3_GUEST_ARTIFACTS'];
    if (artifactDirectory !== undefined) {
      mkdirSync(artifactDirectory, { recursive: true });
      const guest = server?.simulation.q3Guest();
      writeFileSync(join(artifactDirectory, 'failure.json'), JSON.stringify({ error: String(error), movementDiagnostics, prints, guestCommands: guestCommands.mock.calls,
        userinfo: guest?.state.getUserinfo(0), configs: Array.from({ length: 4 }, (_, index) => guest?.state.configstrings.get(544 + index)) }, null, 2));
    }
    throw error;
  } finally {
    try { await app?.close(); } finally {
      try { await server?.close(); } finally {
        try { await browser?.close(); } finally {
          uiInit.mockRestore(); cgInit.mockRestore(); guestCommands.mockRestore(); wireCommands.mockRestore(); frames.mockRestore(); uiRetire.mockRestore(); cgRetire.mockRestore();
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }
}, 120000);


test('dedicated offline LRCTF Application restores guest bytes and human identities without replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q3-guest-save-'));
  const launch = { ...options(root), network: { kind: 'offline' } } satisfies Parameters<typeof Application.open>[0];
  const clock = spyOn(performance, 'now').mockReturnValue(1000);
  async function open() {
    const app = await Application.open(launch, { print: () => undefined });
    try {
      const guest = app.simulation.q3Guest();
      if (guest === null) throw new Error('Missing guest');
      const client = app.session.createClient(0);
      const admitted = await guest.connect(client.id, '\\name\\Saved Player\\model\\sarge\\ip\\localhost');
      if (admitted.kind !== 'accepted') throw new Error(admitted.reason);
      await guest.begin(admitted.player, { serverTime: 0, angles: [0, 0, 0], forwardmove: 0, rightmove: 0, upmove: 0, buttons: 0, weapon: 2 });
      await guest.command(admitted.player, ['team', 'red']);
      return { app, client };
    } catch (error) { await app.close(); throw error; }
  }
  async function frames(app: Application, first: number, count: number) {
    const guest = app.simulation.q3Guest();
    if (guest === null) throw new Error('Missing guest');
    const player = guest.players()[0];
    if (player === undefined) throw new Error('Missing guest human');
    const trace: { readonly memory: string; readonly server: ReturnType<typeof guest.state.captureSaveState> }[] = [];
    for (let frame = first; frame < first + count; frame++) {
      await guest.think(player, { serverTime: (frame + 1) * 50, angles: [0, 0, 0], forwardmove: 127, rightmove: frame % 2 ? 32 : 0, upmove: 0, buttons: 1, weapon: 2 });
      await app.step(50);
      trace.push({ memory: new Bun.CryptoHasher('sha256').update(guest.checkpoint().data).digest('hex'), server: structuredClone(guest.state.captureSaveState()) });
    }
    return trace;
  }
  let active: Awaited<ReturnType<typeof open>> | null = null;
  try {
    active = await open();
    await frames(active.app, 0, 12);
    const path = join(root, 'guest.sav');
    await active.app.saveGame(path);
    const continuous = await frames(active.app, 12, 12);
    await active.app.close(); active = null;
    active = await open();
    const { app, client } = active, previous = app.simulation;
    const shutdown = spyOn(QvmGame.prototype, 'shutdownAsync');
    const publication = spyOn(app.session, 'replaceWorld').mockImplementationOnce(() => { throw new Error('injected guest publication failure'); });
    try {
      await expect(app.loadGame(path)).rejects.toThrow('injected guest publication failure');
      expect(shutdown).not.toHaveBeenCalled();
    } finally { publication.mockRestore(); shutdown.mockRestore(); }
    expect(app.simulation).toBe(previous);
    expect(client.isClosed).toBe(false);
    expect(await frames(app, 0, 1)).toHaveLength(1);
    const initialize = spyOn(QvmGame.prototype, 'initializeAsync');
    const connect = spyOn(QvmGame.prototype, 'clientConnectAsync');
    const begin = spyOn(QvmGame.prototype, 'clientBeginAsync');
    try {
      await app.loadGame(path);
      expect(initialize).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
    } finally { initialize.mockRestore(); connect.mockRestore(); begin.mockRestore(); }
    expect(app.simulation.clientIdentities()).toEqual([client.id]);
    const restoredPlayer = app.simulation.q3Guest()?.players()[0];
    if (restoredPlayer === undefined) throw new Error('Missing restored guest player');
    expect(app.simulation.movementPlayer(restoredPlayer.actor)).toBeNull();
    expect(await frames(app, 12, 12)).toEqual(continuous);
  } finally { await active?.app.close(); clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 120000);

test('local LRCTF QVM seats render separate ABI viewports and isolate movement and firing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q3-local-guest-'));
  const parsed = parseApplicationCommand(['--game', 'q3-classic-lrctf', '--map', 'q3ctf1', '--movement', 'q3', '--character', 'q3',
    '--mode', 'deathmatch', '--seats', '2', '--renderer', 'cpu', '--hidden', '--width', '320', '--height', '240', '--user-content-root', root]);
  if (parsed.kind !== 'run') throw new Error('Missing local QVM launch');
  const presentations = new Map<number, WorldSeatPresentation>(), render = WorldSeatPresentation.prototype.frame;
  const frame = spyOn(WorldSeatPresentation.prototype, 'frame').mockImplementation(function(this: WorldSeatPresentation, snapshot) {
    presentations.set(this.local.player.seat.id.index, this); return render.call(this, snapshot);
  });
  const cgInit = spyOn(QvmCgame.prototype, 'init'), uiInit = spyOn(QvmUi.prototype, 'init');
  const audioCommand = spyOn(ApplicationAudio.prototype, 'command');
  const originalSound = Q3PresentationAudio.prototype.startSound;
  const worldSounds: { readonly fixedOrigin: boolean; readonly channel: number }[] = [];
  const sounds = spyOn(Q3PresentationAudio.prototype, 'startSound').mockImplementation(function(this: Q3PresentationAudio, origin, entity, channel, sound) {
    if (entity === 1022) worldSounds.push({ fixedOrigin: origin !== null, channel });
    return originalSound.call(this, origin, entity, channel, sound);
  });
  let app: Application | null = null;
  try {
    app = await Application.open(parsed.options, { print: () => undefined });
    expect(cgInit).toHaveBeenCalledTimes(2); expect(uiInit).toHaveBeenCalledTimes(2);
    const guest = app.simulation.q3Guest(); if (guest === null) throw new Error('Missing local guest authority');
    const first = app.localPlayers[0], second = app.localPlayers[1];
    if (first === undefined || second === undefined) throw new Error('Missing local seats');
    expect(guest.players().map(player => player.client)).toEqual([first.seat.client.id, second.seat.client.id]);
    app.queueCommand('team', ['red'], first.seat.id); app.queueCommand('team', ['blue'], second.seat.id);
    for (let index = 0; index < 4; index++) await app.step(50);
    for (const local of [first, second]) if (presentations.get(local.seat.id.index)?.q3Client?.capturesInput) {
      for (const down of [true, false]) app.input({ kind: 'key', seat: local.seat.id, code: 27, down, repeat: false, timeMilliseconds: performance.now() });
    }
    await app.step(50);
    const firstView = presentations.get(0), secondView = presentations.get(1);
    if (firstView?.q3Client === null || firstView === undefined || secondView?.q3Client === null || secondView === undefined) throw new Error('Missing QVM presentations');
    expect(firstView.q3Client.options.kind).toBe('qvm'); expect(secondView.q3Client.options.kind).toBe('qvm');
    for (const role of ['cgame', 'ui']) {
      const module = await firstView.q3Client.media.provider.mounts.open(`vm/${role}.qvm`);
      if (module === null || module.reference.provenance.kind !== 'archive') throw new Error('Missing mounted local guest module');
      expect(module.reference.provenance.mount.archivePath.endsWith('/lrctf/pak02.pk3')).toBe(true);
    }
    expect(firstView.q3Client.capturesInput).toBe(false); expect(secondView.q3Client.capturesInput).toBe(false);
    firstView.q3Client.cvars.set('name', 'Local Red'); secondView.q3Client.cvars.set('name', 'Local Blue');
    for (const name of ['model', 'headmodel', 'team_model', 'team_headmodel']) secondView.q3Client.cvars.set(name, 'visor/default');
    await app.step(50);
    const firstUserinfo = guest.state.getUserinfo(0), secondUserinfo = guest.state.getUserinfo(1);
    if (firstUserinfo === undefined || secondUserinfo === undefined) throw new Error('Missing local guest userinfo');
    expect(q3InfoValue(firstUserinfo, 'name')).toBe('Local Red');
    expect(q3InfoValue(secondUserinfo, 'name')).toBe('Local Blue');
    expect(q3InfoValue(firstUserinfo, 'headmodel')).toBe('sarge/default');
    expect(q3InfoValue(secondUserinfo, 'headmodel')).toBe('visor/default');
    app.queueCommand('soundinfo', [], first.seat.id); await app.step(50);
    expect(audioCommand.mock.calls.some(([command]) => command.name === 'soundinfo' && command.seat === first.seat.id)).toBe(true);
    const forwarded = spyOn(guest, 'command'), applicationAudioCount = audioCommand.mock.calls.length;
    try {
      firstView.q3Client.options.commands.reliable('soundinfo'); await app.step(50);
      expect(forwarded.mock.calls.some(([, argv]) => argv[0] === 'soundinfo')).toBe(true);
      expect(audioCommand.mock.calls).toHaveLength(applicationAudioCount);
    } finally { forwarded.mockRestore(); }
    expect(firstView.camera()).toEqual(firstView.q3Client.camera()); expect(secondView.camera()).toEqual(secondView.q3Client.camera());
    expect(firstView.camera().viewport).toEqual(firstView.viewport); expect(secondView.camera().viewport).toEqual(secondView.viewport);
    for (const down of [true, false]) app.input({ kind: 'key', seat: second.seat.id, code: 27, down, repeat: false, timeMilliseconds: performance.now() });
    await app.step(50);
    expect(secondView.ui.pauseMenuOpen).toBe(true); expect(firstView.ui.pauseMenuOpen).toBe(false);
    for (const down of [true, false]) app.input({ kind: 'key', seat: second.seat.id, code: 27, down, repeat: false, timeMilliseconds: performance.now() });
    await app.step(50); expect(secondView.ui.pauseMenuOpen).toBe(false);
    const before = { ...guest.records.player(0).origin }, ammo = guest.records.player(0).ammo[2] ?? 0;
    app.input({ kind: 'key', seat: first.seat.id, code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    app.input({ kind: 'mouse-button', seat: first.seat.id, button: 1, down: true, timeMilliseconds: performance.now() });
    for (let index = 0; index < 12; index++) await app.step(50);
    expect(guest.state.getUserCommand(0)?.forwardmove).toBe(127); expect(guest.state.getUserCommand(1)?.forwardmove).toBe(0);
    expect((guest.state.getUserCommand(0)?.buttons ?? 0) & 1).toBe(1); expect((guest.state.getUserCommand(1)?.buttons ?? 0) & 1).toBe(0);
    expect(guest.records.player(0).origin).not.toEqual(before); expect(guest.records.player(0).ammo[2]).toBeLessThan(ammo);
    expect(guest.records.player(0).persistent[3]).toBe(1); expect(guest.records.player(1).persistent[3]).toBe(2);
    expect(worldSounds.some(sound => sound.fixedOrigin && sound.channel === 0)).toBe(true);
    expect(firstView.q3Client.source.actorAt(1022)).toBe(secondView.q3Client.source.actorAt(1022));
    expect(firstView.q3Client.source.actorAt(1022).session).not.toBe(first.seat.client.id.session);
    const capture = app.captureNextFrame(); await app.step(50); const pixels = await capture;
    expect(pixels.length).toBe(320 * 240 * 4);
    expect(new Set(pixels).size).toBeGreaterThan(32);
    const artifactDirectory = process.env['QVM_LOCAL_ARTIFACT_DIR'];
    if (artifactDirectory !== undefined) {
      const { encodePng } = await import('../../../src/formats/images/png-encoder.ts');
      mkdirSync(artifactDirectory, { recursive: true });
      await Bun.write(join(artifactDirectory, 'two-seats.png'), encodePng(320, 240, pixels));
      await Bun.write(join(artifactDirectory, 'seat-0.png'), encodePng(320, 120, pixels.slice(0, 320 * 120 * 4)));
      await Bun.write(join(artifactDirectory, 'seat-1.png'), encodePng(320, 120, pixels.slice(320 * 120 * 4)));
      writeFileSync(join(artifactDirectory, 'result.json'), JSON.stringify({ simulatedMilliseconds: app.simulation.timeSeconds * 1000, heldInputMilliseconds: 650,
        first: { before, after: guest.records.player(0).origin, initialAmmo: ammo, finalAmmo: guest.records.player(0).ammo[2], command: guest.state.getUserCommand(0), userinfo: guest.state.getUserinfo(0), viewport: firstView.viewport },
        second: { command: guest.state.getUserCommand(1), userinfo: guest.state.getUserinfo(1), viewport: secondView.viewport }, worldSounds }, null, 2));
    }
    app.input({ kind: 'key', seat: first.seat.id, code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    app.input({ kind: 'mouse-button', seat: first.seat.id, button: 1, down: false, timeMilliseconds: performance.now() });
    let now = 100000;
    const clock = spyOn(performance, 'now').mockImplementation(() => now);
    try {
      await app.step(50);
      const path = join(root, 'local.sav');
      const saved = new Bun.CryptoHasher('sha256').update(guest.checkpoint().data).digest('hex'), savedServer = structuredClone(guest.state.captureSaveState());
      await app.saveGame(path);
      if (artifactDirectory !== undefined) await Bun.write(join(artifactDirectory, 'two-human-qvm.sav'), Bun.file(path));
      const saves = new StartupSaves(app.content.catalog, root);
      await saves.refresh();
      const row = saves.list.rows.find(row => row.id === 'local.sav');
      if (row === undefined) throw new Error('Missing saved local QVM menu row');
      expect(row.unavailable).toBeNull(); expect(saves.path(row.id)).toBe(path);
      async function suffix(application: Application) {
        const source = application.simulation.q3Guest(); if (source === null) throw new Error('Missing suffix guest');
        const seats = application.localPlayers;
        const moving = seats[0], idle = seats[1]; if (moving === undefined || idle === undefined) throw new Error('Missing suffix seats');
        now = 100000;
        const trace: { readonly memory: string; readonly server: ReturnType<typeof source.state.captureSaveState> }[] = [];
        for (let index = 0; index < 6; index++) {
          now += 50;
          if (index === 0 || index === 4) application.input({ kind: 'key', seat: moving.seat.id, code: 119,
            down: index === 0, repeat: false, timeMilliseconds: now });
          await application.step(50);
          trace.push({ memory: new Bun.CryptoHasher('sha256').update(source.checkpoint().data).digest('hex'),
            server: structuredClone(source.state.captureSaveState()) });
        }
        expect(source.state.getUserCommand(idle.seat.client.id.slot)?.forwardmove).toBe(0);
        return trace;
      }
      const continuous = await suffix(app);
      await app.close(); app = null;
      expect(() => firstView.q3Client?.source.current()).toThrow('retired');
      expect(() => secondView.q3Client?.source.current()).toThrow('retired');
      app = await Application.open(parsed.options, { print: () => undefined });
      for (const player of app.localPlayers) app.queueCommand('team', [player.seat.id.index === 0 ? 'red' : 'blue'], player.seat.id);
      for (let index = 0; index < 4; index++) { now += 50; await app.step(50); }
      for (const player of app.localPlayers) {
        const presentation = player.seat.presentation;
        if (presentation instanceof WorldSeatPresentation && presentation.q3Client?.capturesInput)
          for (const down of [true, false]) app.input({ kind: 'key', seat: player.seat.id, code: 27, down, repeat: false, timeMilliseconds: now });
      }
      now += 50; await app.step(50);
      const previous = app.simulation, previousPlayers = [...app.localPlayers], previousWindow = app.window;
      const previousPresentations = previousPlayers.map(player => {
        const presentation = player.seat.presentation;
        if (!(presentation instanceof WorldSeatPresentation) || presentation.q3Client === null) throw new Error('Missing previous guest presentation');
        return presentation;
      });
      for (const presentation of previousPresentations) expect(presentation.q3Client?.capturesInput).toBe(false);
      const previousGuest = previous.q3Guest(); if (previousGuest === null) throw new Error('Missing previous guest');
      const previousBytes = new Bun.CryptoHasher('sha256').update(previousGuest.checkpoint().data).digest('hex');
      const initialize = spyOn(QvmGame.prototype, 'initializeAsync'), connect = spyOn(QvmGame.prototype, 'clientConnectAsync');
      const begin = spyOn(QvmGame.prototype, 'clientBeginAsync'), userinfo = spyOn(QvmGame.prototype, 'clientUserinfoChangedAsync');
      try {
        const uiModules: QvmUi[] = [], originalUi = QvmUi.prototype.init;
        const failure = spyOn(QvmUi.prototype, 'init').mockImplementation(async function(this: QvmUi, connecting) {
          uiModules.push(this);
          if (uiModules.length === 2) throw new Error('injected restore UI preparation failure');
          return originalUi.call(this, connecting);
        });
        try { await expect(app.loadGame(path)).rejects.toThrow('injected restore UI preparation failure'); }
        finally { failure.mockRestore(); }
        expect(app.simulation).toBe(previous); expect(app.window).toBe(previousWindow);
        expect(new Bun.CryptoHasher('sha256').update(previousGuest.checkpoint().data).digest('hex')).toBe(previousBytes);
        expect(app.localPlayers.map(player => player.seat.client)).toEqual(previousPlayers.map(player => player.seat.client));
        for (const presentation of previousPresentations) expect(() => presentation.q3Client?.source.current()).not.toThrow();
        for (const module of uiModules) await expect(module.keyEvent(27, true)).rejects.toThrow('retired');
        const preserved = previousPlayers[0]; if (preserved === undefined) throw new Error('Missing retained seat');
        expect(previousPresentations[0]?.q3Client?.capturesInput).toBe(false);
        app.input({ kind: 'key', seat: preserved.seat.id, code: 119, down: true, repeat: false, timeMilliseconds: now });
        now += 50;
        await app.step(50);
        expect(previous.q3Guest()?.state.getUserCommand(preserved.seat.client.id.slot)?.forwardmove).toBe(127);
        app.input({ kind: 'key', seat: preserved.seat.id, code: 119, down: false, repeat: false, timeMilliseconds: now });
        userinfo.mockClear();
        await app.loadGame(path);
        expect(initialize).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
        expect(userinfo).not.toHaveBeenCalled();
        const restored = app.simulation.q3Guest(); if (restored === null) throw new Error('Missing restored guest');
        expect(new Bun.CryptoHasher('sha256').update(restored.checkpoint().data).digest('hex')).toBe(saved);
        expect(restored.state.captureSaveState()).toEqual(savedServer);
        expect(app.localPlayers.map(player => player.seat.client)).toEqual(previousPlayers.map(player => player.seat.client));
        for (const player of app.localPlayers) expect(restored.player(player.seat.client.id)?.actor).toBe(player.actor);
        for (const presentation of previousPresentations) expect(() => presentation.q3Client?.source.current()).toThrow('retired');
        expect(await suffix(app)).toEqual(continuous);
        expect(userinfo).not.toHaveBeenCalled();
      } finally { initialize.mockRestore(); connect.mockRestore(); begin.mockRestore(); userinfo.mockRestore(); }
      await app.close(); app = null;
      const native = parseApplicationCommand(['--game', 'q3-baseq3', '--map', 'q3dm1', '--seats', '2', '--bot-skill', '3',
        '--renderer', 'cpu', '--hidden', '--width', '320', '--height', '240', '--user-content-root', root]);
      if (native.kind !== 'run') throw new Error('Missing native launch');
      app = await Application.open(native.options, { print: () => undefined, saveDirectory: join(root, 'native-saves') });
      await app.step(50);
      expect(app.simulation.q3Source()).not.toBeNull(); expect(app.simulation.q3Guest()).toBeNull();
      const nativeWorld = app.simulation, nativeClients = app.localPlayers.map(player => player.seat.client);
      for (const player of app.localPlayers) {
        const presentation = player.seat.presentation;
        if (!(presentation instanceof WorldSeatPresentation)) throw new Error('Missing native presentation');
        expect(presentation.local.builder.tuning.alwaysRun).toBe(false);
      }
      const browsers: StartupServerBrowser[] = [], openBrowser = StartupServerBrowser.open;
      const browserOpen = spyOn(StartupServerBrowser, 'open').mockImplementation(async config => {
        const browser = await openBrowser(config); browsers.push(browser); return browser;
      });
      const nativeInitialize = spyOn(QvmGame.prototype, 'initializeAsync'), nativeConnect = spyOn(QvmGame.prototype, 'clientConnectAsync');
      const nativeBegin = spyOn(QvmGame.prototype, 'clientBeginAsync'), nativeUserinfo = spyOn(QvmGame.prototype, 'clientUserinfoChangedAsync');
      try {
        let preparedUis = 0;
        const originalUi = QvmUi.prototype.init;
        const failure = spyOn(QvmUi.prototype, 'init').mockImplementation(async function(this: QvmUi, connecting) {
          if (++preparedUis === 2) throw new Error('injected native-to-guest UI failure');
          return originalUi.call(this, connecting);
        });
        try { await expect(app.loadGame(saves.path(row.id))).rejects.toThrow('injected native-to-guest UI failure'); }
        finally { failure.mockRestore(); }
        expect(app.simulation).toBe(nativeWorld); expect(browsers).toHaveLength(1);
        expect(() => browsers[0]?.assertOpen()).toThrow('closed');
        expect(app.localPlayers.map(player => player.seat.client)).toEqual(nativeClients);
        await app.step(50);
        await app.loadGame(saves.path(row.id));
        expect(browsers).toHaveLength(2); expect(() => browsers[1]?.assertOpen()).not.toThrow();
        expect(app.localPlayers.map(player => player.seat.client)).toEqual(nativeClients);
        const restored = app.simulation.q3Guest(); if (restored === null) throw new Error('Native entry did not restore QVM');
        expect(app.options.mode).toBe('deathmatch'); expect(app.options.botSkill).toBeUndefined();
        expect(new Bun.CryptoHasher('sha256').update(restored.checkpoint().data).digest('hex')).toBe(saved);
        expect(restored.state.captureSaveState()).toEqual(savedServer);
        for (const player of app.localPlayers) {
          const presentation = player.seat.presentation;
          if (!(presentation instanceof WorldSeatPresentation)) throw new Error('Missing restored presentation');
          expect(presentation.local.builder.tuning.alwaysRun).toBe(false);
        }
        const beforeWalking = { ...restored.records.player(0).origin }, walking = await suffix(app);
        const command = walking[1]?.server.commands.find(command => command.slot === 0)?.value;
        expect(command?.forwardmove).toBe(64); expect((command?.buttons ?? 0) & 16).toBe(16);
        expect(restored.records.player(0).origin).not.toEqual(beforeWalking);
        expect(nativeInitialize).not.toHaveBeenCalled(); expect(nativeConnect).not.toHaveBeenCalled();
        expect(nativeBegin).not.toHaveBeenCalled(); expect(nativeUserinfo).not.toHaveBeenCalled();
        await app.close(); app = null;
        expect(() => browsers[1]?.assertOpen()).toThrow('closed');
      } finally { browserOpen.mockRestore(); nativeInitialize.mockRestore(); nativeConnect.mockRestore(); nativeBegin.mockRestore(); nativeUserinfo.mockRestore(); }
      const initialImage = await readSaveImage(path);
      const initialInitialize = spyOn(QvmGame.prototype, 'initializeAsync'), initialConnect = spyOn(QvmGame.prototype, 'clientConnectAsync');
      const initialBegin = spyOn(QvmGame.prototype, 'clientBeginAsync'), initialUserinfo = spyOn(QvmGame.prototype, 'clientUserinfoChangedAsync');
      const initialShutdown = spyOn(QvmGame.prototype, 'shutdownAsync');
      try {
        const initialUis: QvmUi[] = [], originalInitialUi = QvmUi.prototype.init;
        const failure = spyOn(QvmUi.prototype, 'init').mockImplementation(async function(this: QvmUi, connecting) {
          initialUis.push(this);
          if (initialUis.length === 2) throw new Error('injected initial restore UI failure');
          return originalInitialUi.call(this, connecting);
        });
        try { await expect(Application.open(native.options, { print: () => undefined }, undefined, undefined, initialImage)).rejects.toThrow('injected initial restore UI failure'); }
        finally { failure.mockRestore(); }
        expect(initialShutdown).not.toHaveBeenCalled();
        for (const module of initialUis) await expect(module.keyEvent(27, true)).rejects.toThrow('retired');
        app = await Application.open(native.options, { print: () => undefined }, undefined, undefined, initialImage);
        const restored = app.simulation.q3Guest(); if (restored === null) throw new Error('Missing initially restored guest');
        expect(new Bun.CryptoHasher('sha256').update(restored.checkpoint().data).digest('hex')).toBe(saved);
        expect(restored.state.captureSaveState()).toEqual(savedServer);
        expect(app.localPlayers).toHaveLength(2);
        for (const player of app.localPlayers) expect(restored.player(player.seat.client.id)?.actor).toBe(player.actor);
        expect(initialInitialize).not.toHaveBeenCalled(); expect(initialConnect).not.toHaveBeenCalled();
        expect(initialBegin).not.toHaveBeenCalled(); expect(initialUserinfo).not.toHaveBeenCalled();
        await suffix(app);
        expect(restored.state.getUserCommand(0)?.forwardmove).toBe(0);
        expect(initialInitialize).not.toHaveBeenCalled(); expect(initialConnect).not.toHaveBeenCalled(); expect(initialBegin).not.toHaveBeenCalled();
        await app.close(); app = null;
      } finally { initialInitialize.mockRestore(); initialConnect.mockRestore(); initialBegin.mockRestore(); initialUserinfo.mockRestore(); initialShutdown.mockRestore(); }

    } finally { clock.mockRestore(); }
    expect(() => firstView.q3Client?.source.current()).toThrow('retired');
    expect(() => secondView.q3Client?.source.current()).toThrow('retired');
  } finally {
    await app?.close(); frame.mockRestore(); cgInit.mockRestore(); uiInit.mockRestore(); audioCommand.mockRestore(); sounds.mockRestore(); await rm(root, { recursive: true, force: true });
  }
}, 180000);

test('failed second local guest client preparation retires both guest module owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q3-local-guest-failure-'));
  const parsed = parseApplicationCommand(['--game', 'q3-classic-lrctf', '--map', 'q3ctf1', '--movement', 'q3', '--character', 'q3',
    '--mode', 'deathmatch', '--seats', '2', '--renderer', 'cpu', '--hidden', '--width', '320', '--height', '240', '--user-content-root', root]);
  if (parsed.kind !== 'run') throw new Error('Missing local QVM launch');
  const modules: QvmUi[] = [], original = QvmUi.prototype.init;
  const initialize = spyOn(QvmUi.prototype, 'init').mockImplementation(async function(this: QvmUi, connecting) {
    modules.push(this);
    if (modules.length === 2) throw new Error('injected second guest UI failure');
    return original.call(this, connecting);
  });
  try {
    await expect(Application.open(parsed.options, { print: () => undefined })).rejects.toThrow('injected second guest UI failure');
    expect(modules).toHaveLength(2);
    for (const module of modules) await expect(module.keyEvent(27, true)).rejects.toThrow('retired');
  } finally { initialize.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 120000);
