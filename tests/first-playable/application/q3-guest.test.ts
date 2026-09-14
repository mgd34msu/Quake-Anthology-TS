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
