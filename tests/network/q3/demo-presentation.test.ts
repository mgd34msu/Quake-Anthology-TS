import { expect, spyOn, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { Q3RemotePresentation } from '../../../src/app/bootstrap/network/remote-q3.ts';
import { Q3DemoPlayback } from '../../../src/app/bootstrap/network/q3-demo.ts';
import { Q3ClientConnection } from '../../../src/network/q3/client.ts';
import { DemoReader } from '../../../src/network/q3/demo.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { ClientGameState } from '../../../src/content/q3/presentation/state.ts';
import { PredictionRuntime, ClientCommandHistory } from '../../../src/content/q3/presentation/prediction.ts';
import { GameType } from '../../../src/content/q3/base/shared/definitions.ts';
import { PlayerStateRecord } from '../../../src/network/q3/state/player.ts';
import { retailSnapshot } from '../../../src/content/q3/presentation/retail-snapshot.ts';
import { CollisionCounters } from '../../../src/world/collision/q3/counters.ts';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoadedApplicationContent, applicationPreset } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { discoverInstalledContent, presetChoice, resolveLaunch } from '../../../src/content/catalog/index.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { decodeQ3World } from '../../../src/formats/q3-map/index.ts';
import { q3Fixture } from '../../formats/q3-map/fixture.ts';
import { encodeDemo } from '../../../src/network/q3/demo.ts';
import { encodeServerMessage } from '../../../src/network/q3/server-message.ts';

function initialDemo(): DemoReader {
  return new DemoReader(encodeDemo([{ kind: 'message', sequence: 1, payload: encodeServerMessage(0,
    [{ kind: 'gamestate', commandSequence: 0, clientNumber: 0, checksumFeed: 0,
      entries: [{ kind: 'configstring', index: 0, value: '\\protocol\\68\\mapname\\test\\g_gametype\\0' }] }],
    { product: 'baseq3', messageNumber: 1, reliableSequence: 0, serverCommandSequence: 0, parseEntitiesNumber: 0,
      baseline: () => null, history: () => null }) }]));
}

test('retiring the actual demo presenter during content loading cannot install a world or initialize cgame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q3-demo-cancel-'));
  let content: LoadedApplicationContent | null = null;
  const identity = createIdentityOwner('cancel actual demo load'), session = new EngineSession(identity, { kind: 'local' });
  const started = Promise.withResolvers<void>(), loaded = Promise.withResolvers<void>();
  let initialized = 0, published = 0;
  try {
    const map = q3Fixture(); await mkdir(join(root, 'baseq3/maps'), { recursive: true }); await writeFile(join(root, 'baseq3/maps/test.bsp'), map);
    const catalog = await discoverInstalledContent({ corpusRoot: root, discoverMods: false, products: [{ id: 'q3-baseq3', family: 'q3',
      edition: 'classic', campaign: 'baseq3', title: 'Demo cancellation fixture', contentDirectory: 'baseq3', baseProduct: null,
      requiredContentArchives: [], requiredPrograms: [], mapWitness: 'maps/test.bsp', unresolvedReason: null }] });
    const parsed = parseApplicationCommand(['--game', 'q3-baseq3', '--map', 'test', '--movement', 'q3', '--character', 'q3']);
    if (parsed.kind !== 'run') throw new Error('Missing fixture options');
    const preset = applicationPreset(catalog, parsed.options), recipe = await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
    const prepared = new LoadedApplicationContent(catalog, recipe, decodeQ3World(map), await openMountPlan(recipe.mounts)); content = prepared;
    const remote = new Q3RemotePresentation({ identity, session, client: session.createClient(0), nextGeneration: () => 0, content: null,
      userinfo: () => '', loadContent: async () => { started.resolve(); await loaded.promise; return prepared; },
      initialize: async () => { initialized++; }, publish: () => { published++; }, disconnected() {}, sendCommand() {}, print() {} });
    const demo = new Q3DemoPlayback({ host: remote, clock: remote.clock, reader: initialDemo() });
    const priming = demo.prime(0); await started.promise; demo.close(); loaded.resolve();
    await expect(priming).rejects.toThrow('retired');
    expect(initialized).toBe(0); expect(published).toBe(0); expect(remote.output).toBeNull();
    expect(() => remote.scene).toThrow('has not supplied a world');
  } finally { session.close(); await content?.close(); await rm(root, { recursive: true, force: true }); }
});

test('retiring the actual demo presenter during shutdown cannot clear its retained state', async () => {
  const identity = createIdentityOwner('cancel actual demo shutdown'), session = new EngineSession(identity, { kind: 'local' });
  const started = Promise.withResolvers<void>(), shutdown = Promise.withResolvers<void>();
  let generation = 0, downloadsClosed = 0, initialized = 0, published = 0;
  const remote = new Q3RemotePresentation({ identity, session, client: session.createClient(0), nextGeneration: () => generation++, content: null,
    userinfo: () => '', loadContent: async () => { throw new Error('Cancelled shutdown must not load'); },
    shutdown: async () => { started.resolve(); await shutdown.promise; }, initialize: async () => { initialized++; },
    downloads: { prepare: async () => false, publishSize: size => size, receive: async () => {}, close: () => { downloadsClosed++; } },
    publish: () => { published++; }, disconnected() {}, sendCommand() {}, print() {} });
  const demo = new Q3DemoPlayback({ host: remote, clock: remote.clock, reader: initialDemo() });
  const actor = remote.actorAt(1); remote.clock.time = 123;
  try {
    const priming = demo.prime(0); await started.promise; demo.close(); shutdown.resolve();
    await expect(priming).rejects.toThrow('retired');
    expect(remote.actorAt(1)).toBe(actor); expect(remote.clock.time).toBe(123);
    expect(downloadsClosed).toBe(0); expect(initialized).toBe(0); expect(published).toBe(0);
  } finally { demo.close(); session.close(); }
});

test('staged Q3 presentation derives demo mode from connection without retiring the published client', async () => {
  const identity = createIdentityOwner('staged demo presentation'), session = new EngineSession(identity, { kind: 'local' });
  const client = session.createClient(0), connection = client.connect('remote'), disconnects: string[] = [];
  const remote = new Q3RemotePresentation({ identity, session, client, nextGeneration: () => 0, content: null,
    userinfo: () => '', loadContent: async () => { throw new Error('No map in this fixture'); },
    sendCommand() {}, print() {}, disconnected: reason => { disconnects.push(reason); }, publish: () => { throw new Error('Unprepared world cannot publish'); } });
  const demo = new Q3DemoPlayback({ host: remote, clock: remote.clock, reader: new DemoReader(new Uint8Array()) });
  const advance = spyOn(remote.clock, 'advance');
  try {
    expect(client.connection).toBe(connection); expect(connection.isClosed).toBe(false);
    expect(remote.cgameSource.sourceMode).toBe('demo');
    await expect(remote.systemInfo('\\sv_pure\\1')).resolves.toBeUndefined();
    expect(() => remote.downloadSize(8)).toThrow('demo cannot request');
    expect(remote.samplePresentation(999)).toBeNull(); expect(advance).not.toHaveBeenCalled();
    remote.disconnected('candidate stopped'); expect(disconnects).toEqual(['candidate stopped']);
    expect(client.connection).toBe(connection); expect(connection.isClosed).toBe(false);
    const live = new Q3ClientConnection(demo.connection.identity, 'baseq3', { kind: 'network', challenge: 1, qport: 1 }, demo.connection.bindings);
    remote.attach(live); expect(remote.cgameSource.sourceMode).toBe('live');
    await expect(remote.systemInfo('\\sv_pure\\1')).rejects.toThrow('pure verification');
    remote.samplePresentation(1000); expect(advance).toHaveBeenCalledTimes(1);
  } finally { advance.mockRestore(); demo.close(); session.close(); }
});

test('recorded player origin and angles interpolate despite held physical movement and aim', async () => {
  const state = new ClientGameState('baseq3', 0, 0), commands = new ClientCommandHistory();
  const previous = new PlayerStateRecord('baseq3', 0, 0, 0), next = previous.copy();
  previous.origin = { x: 0, y: 10, z: 20 }; previous.viewangles = { x: 10, y: 20, z: 0 };
  next.origin = { x: 100, y: 30, z: 40 }; next.viewangles = { x: 30, y: 60, z: 0 };
  const snap = (serverTime: number, playerState: PlayerStateRecord<number, number, number>) => retailSnapshot({
    messageNumber: serverTime, serverTime, deltaNumber: -1, flags: 0, serverCommandNumber: 0,
    parseEntitiesNumber: 0, areaMask: new Uint8Array(32), playerState, entities: [] });
  state.snap = snap(1000, previous); state.nextSnap = snap(1100, next); state.time = 1050;
  commands.append({ serverTime: 1050, angles: { x: 90, y: 180, z: 0 }, forwardmove: 127, rightmove: 127, upmove: 127, buttons: 1, weapon: 0 });
  const unexpected = (): never => { throw new Error('Demo must not run physical prediction'); };
  const prediction = new PredictionRuntime(state, { counters: new CollisionCounters(), trace: unexpected,
    pointContents: unexpected, transformedTrace: unexpected, transformedPointContents: unexpected }, {
    commandTiming: 'q3', commands, movePlayer: unexpected, updateViewAngles: unexpected,
    settings: () => ({ gameType: GameType.GT_FFA, dmFlags: 0, demoPlayback: true, noPredict: false, synchronousClients: false,
      predictItems: true, pmoveFixed: false, pmoveMsec: 8, errorDecayInteger: 0, errorDecayValue: 0, showMiss: 0 }),
    setPmoveMsec: unexpected, transitionPlayerState: async () => unexpected(), warn: unexpected, predictItem: unexpected,
  });
  await prediction.predictPlayerState();
  expect(state.predictedPlayerState.origin).toEqual({ x: 50, y: 20, z: 30 });
  expect(state.predictedPlayerState.viewangles).toEqual({ x: 20, y: 40, z: 0 });
  state.time = 1075; await prediction.predictPlayerState();
  expect(state.predictedPlayerState.origin.x).toBe(75); expect(state.predictedPlayerState.viewangles.y).toBe(50);
});
