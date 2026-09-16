import type { ActorCommand } from "../../../src/contracts/session.ts";
import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import { knownQvmArtifacts } from "../../../src/compat/qvm/artifacts.ts";
import type { ModuleIdentity, Q3ApiIdentity } from "../../../src/contracts/execution.ts";
import { Q3RemotePresentation } from "../../../src/app/bootstrap/network/remote-q3.ts";
import { Q3ServerConnection } from "../../../src/network/q3/server.ts";
import { Q3RendererResources } from "../../../src/content/q3/presentation/resources.ts";
import { Draw2D } from "../../../src/text/draw2d.ts";
import { QvmCgame } from "../../../src/compat/qvm/cgame.ts";
import { QvmUi } from "../../../src/compat/qvm/ui.ts";
import { Q3BrowserView } from "../../../src/network/q3/browser-view.ts";
import { StartupServerBrowser } from "../../../src/app/bootstrap/server-browser.ts";
import { ConfigStore } from "../../../src/settings/config.ts";
import { Q3SceneRecorder } from "../../../src/content/q3/presentation/scene.ts";
import { UnifiedAudio } from "../../../src/audio/index.ts";
import { expect, test, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, copyFileSync, constants, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Q3ClientDownload } from '../../../src/network/q3/download.ts';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { Ipv4Address } from '../../../src/network/common/endpoint.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { Q3ClientAdmission } from '../../../src/network/q3/admission.ts';
import { encodeConnectionlessText } from '../../../src/network/q3/connectionless.ts';
import { Q3ApplicationPackages } from '../../../src/app/bootstrap/network/q3-downloads.ts';
import { q3InfoValue } from '../../../src/network/q3/admission.ts';
import { Q3ClientConnection } from '../../../src/network/q3/client.ts';
import { q3ChannelDelivery } from '../../../src/network/q3/transport.ts';
import type { Snapshot } from '../../../src/network/q3/server-message.ts';

function fixturePk3(path = 'wire-probe.cfg', repeats = 400): Uint8Array<ArrayBuffer> {
  const name = new TextEncoder().encode(path), data = new TextEncoder().encode('set wire_probe 1\n'.repeat(repeats));
  const localLength = 30 + name.length + data.length, centralLength = 46 + name.length;
  const bytes = new Uint8Array(localLength + centralLength + 22), view = new DataView(bytes.buffer), crc = Bun.hash.crc32(data);
  view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
  bytes.set(name, 30); bytes.set(data, 30 + name.length);
  view.setUint32(localLength, 0x02014b50, true); view.setUint16(localLength + 4, 20, true); view.setUint16(localLength + 6, 20, true);
  view.setUint32(localLength + 16, crc, true); view.setUint32(localLength + 20, data.length, true); view.setUint32(localLength + 24, data.length, true);
  view.setUint16(localLength + 28, name.length, true); bytes.set(name, localLength + 46);
  const end = localLength + centralLength; view.setUint32(end, 0x06054b50, true); view.setUint16(end + 8, 1, true); view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, centralLength, true); view.setUint32(end + 16, localLength, true); return bytes;
}

test('protocol68 UDP admission moves the shared Application actor and publishes source snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'q3-native-package-')), base = join(root, 'q3a/baseq3'), original = join(homedir(), 'Projects/qfiles/q3a/baseq3');
  mkdirSync(base, { recursive: true });
  for (const name of readdirSync(original)) if (name.endsWith('.pk3')) copyFileSync(join(original, name), join(base, name), constants.COPYFILE_FICLONE);
  const fixture = fixturePk3(); writeFileSync(join(base, 'wire-fixture.pk3'), fixture);
  const parsed = parseApplicationCommand(['--content-root', root, '--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--dedicated', '--mode', 'deathmatch', '--listen', '0', '--bind', '127.0.0.1']);
  if (parsed.kind !== 'run') throw new Error('Missing application options');
  const prints: string[] = [], app = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
  await app.content.mounts.resolve('wire-probe.cfg');
  app.simulation.q3Source()?.host.cvars.set('sv_allowDownload', '1', true);
  const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), address = app.networkAddress;
  if (address === null || address.kind !== 'ipv4') throw new Error('No native IPv4 listener');
  const statuses: string[] = [];
  const owner = createIdentityOwner('Q3 UDP application client'), admission = new Q3ClientAdmission(4172, text => prints.push(text)), snapshots: Snapshot[] = [];
  let client: Q3ClientConnection | null = null, now = 0, gameStates = 0;
  const connectedClient = (): Q3ClientConnection => { if (client === null) throw new Error('Client did not connect'); return client; };
  const downloaded: number[] = [], downloadErrors: string[] = [];
  let completed = false;
  const sendPacket = (): void => { const connected = connectedClient(); connected.transmit({ realTime: now, packetDup: 1, noDelta: false }, q3ChannelDelivery<Ipv4Address>(transport, () => address, connected.sourceState, () => {})); };
  const download = new Q3ClientDownload({ assertCurrent() {}, openTemporary: () => ({ writeBytes: bytes => { downloaded.push(...bytes); }, close() {} }),
    publishTemporary() {}, reliable: text => { connectedClient().reliable.add(text); }, sendPacket, progress() {}, async completed() { completed = true; connectedClient().reliable.add('donedl'); } });
  admission.begin(address);
  const read = async (): Promise<void> => {
    for (let event = transport.poll(); event !== null; event = transport.poll()) {
      if (event.kind !== 'packet' || event.from.kind !== 'ipv4') continue;
      const result = admission.receive(event.from, event.payload, now);
      if (result.kind === 'admitted') client = new Q3ClientConnection({ client: owner.client(0, 0), seat: null }, 'baseq3', { kind: 'network', challenge: result.challenge, qport: result.qport }, {
        assertCurrent() {}, print: text => { prints.push(text); }, clearActive() {}, async systemInfo() {}, async gamestate(state) {
          gameStates++;
          const packages = await Q3ApplicationPackages.open(app.content, state.checksumFeed);
          for (const path of ['vm/cgame.qvm', 'vm/ui.qvm', app.content.recipe.map.geometry.requestedPath]) {
            const reference = await app.content.mounts.resolve(path); if (reference === null) throw new Error('Missing pure reference'); packages.references.opened(reference);
          }
          const connected = connectedClient();
          expect(q3InfoValue(connected.gameState.get(1) ?? '', 'sv_pure')).toBe('1');
          expect(q3InfoValue(connected.gameState.get(1) ?? '', 'sv_paks')).toBe(packages.references.references.loadedPakChecksums());
          expect(q3InfoValue(connected.gameState.get(1) ?? '', 'sv_referencedPakNames')).not.toContain('wire-fixture');
          connected.reliable.add(packages.references.referencedPureCommand(connected.serverId));
        }, snapshot: value => { if ((value.flags & 2) === 0) snapshots.push(value); }, downloadSize: size => download.publishSize(size), download: async block => { if (block.kind === 'error') downloadErrors.push(block.message); else await download.receive(block); }, mapRestart() {}, levelShot() {}, localServerRunning: () => false,
      });
      else if (result.kind === 'connectionless' && result.packet.command === 'statusResponse') statuses.push(new TextDecoder().decode(result.packet.payload));
      else if (result.kind === 'sequenced' && client !== null) await client.receiveDatagram(result.bytes, now);
    }
  };
  const exchange = async (): Promise<void> => {
    now += 50;
    const request = admission.resend(now, '\\name\\UDP Ranger\\model\\sarge/default\\handicap\\100\\rate\\25000\\snaps\\20');
    if (request !== null && request.to.kind === 'ipv4') transport.send(request.to, request.payload);
    if (client !== null) {
      client.commands.append({ serverTime: now, angles: [0, 0, 0], forwardmove: 127, rightmove: 0, upmove: 0, buttons: 0, weapon: 2 });
      client.transmit({ realTime: now, packetDup: 1, noDelta: false }, q3ChannelDelivery<Ipv4Address>(transport, () => address, client.sourceState, () => {}));
    }
    await Bun.sleep(1); await app.step(50); await Bun.sleep(1); await read();
  };
  try {
    for (let count = 0; count < 100 && snapshots.length === 0; count++) await exchange();
    expect(gameStates).toBe(1);
    const player = app.networkClients[0];
    if (player === undefined || snapshots.length === 0) throw new Error(`No Q3 network snapshot: ${prints.join('')}`);
    expect(app.simulation.players().some(actor => actor.equals(player.actor))).toBe(true);
    transport.send(address, encodeConnectionlessText('getstatus application-check'));
    await exchange();
    expect(statuses.some(status => status.includes('\\challenge\\application-check') && status.includes('UDP Ranger'))).toBe(true);
    const before = app.simulation.bodies.read(player.actor)?.origin;
    for (let count = 0; count < 8; count++) await exchange();
    const after = app.simulation.bodies.read(player.actor)?.origin;
    expect(after).not.toEqual(before);
    expect(snapshots.at(-1)?.playerState.origin).toEqual(after);
    expect(snapshots.at(-1)?.playerState.stats.get(0)).toBe(app.simulation.q3Source()?.records.byActor(player.actor)?.client?.ps.stats.get(0));
    expect(snapshots.at(-1)?.entities.length).toBeGreaterThan(0);
    const connected = connectedClient();
    connected.reliable.add('say "wire chat"');
    for (let count = 0; count < 24; count++) await exchange();
    const commands: (readonly string[] | null)[] = [];
    for (let sequence = connected.lastExecutedServerCommand + 1; sequence <= connected.serverCommandSequence; sequence++) commands.push(await connected.getServerCommand(sequence));
    expect(commands.some(command => command?.[0] === 'chat' && command.join(' ').includes('wire chat'))).toBe(true);
    const configValue = 'network '.repeat(300);
    app.simulation.q3Source()?.host.configstrings.set(25, configValue);
    for (let count = 0; count < 5; count++) await exchange();
    for (let sequence = connected.lastExecutedServerCommand + 1; sequence <= connected.serverCommandSequence; sequence++) await connected.getServerCommand(sequence);
    expect(connected.gameState.get(25)).toBe(configValue);
    download.begin('baseq3/wire-fixture.pk3', 'baseq3/wire-fixture.pk3');
    for (let count = 0; count < 120 && !completed; count++) await exchange();
    expect(completed).toBe(true);
    expect(Uint8Array.from(downloaded)).toEqual(fixture);
    connected.reliable.add('download baseq3/pak0.pk3');
    for (let count = 0; count < 6; count++) await exchange();
    expect(downloadErrors.some(error => error.includes('Cannot autodownload id pk3'))).toBe(true);
    connected.reliable.add('download baseq3/not-mounted.pk3');
    for (let count = 0; count < 6; count++) await exchange();
    expect(downloadErrors.some(error => error.includes('not found on server'))).toBe(true);
    app.simulation.q3Source()?.host.cvars.set('sv_allowDownload', '0', true);
    connected.reliable.add('download baseq3/wire-fixture.pk3');
    for (let count = 0; count < 6; count++) await exchange();
    expect(downloadErrors.some(error => error.includes('autodownloading is disabled'))).toBe(true);
    for (let count = 0; count < 4; count++) await exchange();
    const beforeTravel = gameStates;
    await app.changeLevel('q3dm1');
    for (let count = 0; count < 30 && gameStates <= beforeTravel; count++) await exchange();
    expect(gameStates).toBeGreaterThan(beforeTravel);
    for (let count = 0; count < 5; count++) await exchange();
    expect(app.networkClients[0]?.client.equals(player.client)).toBe(true);
    expect(snapshots.at(-1)?.playerState.clientNum).toBe(connected.clientNumber);
    connected.reliable.add('cp 0 outdated'); await exchange();
    expect(app.networkClients).toHaveLength(1);
    connected.reliable.add('vdr');
    connected.reliable.add(`cp ${connected.serverId} 0 0 @ 0`); await exchange();
    await expect(connected.getServerCommand(connected.serverCommandSequence)).rejects.toThrow('Invalid .PK3 files referenced');
    expect(app.networkClients).toHaveLength(0);
    expect(app.simulation.players().some(actor => actor.equals(player.actor))).toBe(false);
  } finally { download.close(); transport.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
}, 60000);

test('production protocol68 remote adapter joins actual baseq3 and submits native movement', async () => {
  const { Q3ClientNetwork } = await import('../../../src/app/bootstrap/network/q3-client.ts');
  const { Q3RemotePresentation } = await import('../../../src/app/bootstrap/network/remote-q3.ts');
  const { EngineSession } = await import('../../../src/world/session/session.ts');
  const parsed = parseApplicationCommand(['--content-root', join(homedir(), 'Projects/qfiles'), '--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--dedicated', '--mode', 'deathmatch', '--listen', '0', '--bind', '127.0.0.1']);
  if (parsed.kind !== 'run') throw new Error('Missing application options');
  const app = await Application.open(parsed.options, { print: () => undefined });
  app.simulation.q3Source()?.host.cvars.set('sv_pure', '0', true);
  const address = app.networkAddress;
  if (address === null || address.kind !== 'ipv4') throw new Error('Missing IPv4 listener');
  const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
  const identity = createIdentityOwner('production-q3-remote'), session = new EngineSession(identity, { kind: 'local' });
  const messages: string[] = [], maps: string[] = [];
  let network: InstanceType<typeof Q3ClientNetwork> | null = null;
  const client = session.createClient(0); client.connect('remote');
  const remote = new Q3RemotePresentation({ identity, session, client, nextGeneration: slot => nextActorGeneration(session.session, slot), content: app.content,
    disconnected: () => { client.disconnect(); },
    publish: output => { session.publish(output); },
    userinfo: () => '\\name\\Production Ranger\\model\\sarge/default\\handicap\\100\\rate\\25000\\snaps\\20',
    loadContent: async world => { maps.push(world.map); return app.content; },
    sendCommand: text => { if (network === null) throw new Error('No connection'); network.command(text); }, print: text => { messages.push(text); } });
  network = new Q3ClientNetwork({ transport, remote: address, host: remote, qport: 195 });
  let now = 0;
  const exchange = async (): Promise<void> => { now += 50; await network?.poll(now); await Bun.sleep(1); await app.step(50); await Bun.sleep(1); await network?.poll(now); remote.samplePresentation(now); };
  try {
    for (let count = 0; count < 80 && network.phase !== 'active'; count++) await exchange();
    expect(network.phase).toBe('active');
    expect(maps).toEqual(['maps/q3dm1.bsp']);
    const player = remote.player, serverPlayer = app.networkClients[0];
    if (player === null || serverPlayer === undefined) throw new Error(`No remote player: ${messages.join('')}`);
    const before = app.simulation.bodies.read(serverPlayer.actor)?.origin;
    const localSource = { kind: "local-seat", seat: identity.seat(0), client: remote.client.id } satisfies ActorCommand["source"];
    const rawInput: ActorCommand = { actor: player.actor, source: localSource, sequence: 0,
      command: { kind: "q3", serverTimeMilliseconds: now, angleWords: [1234, 5678, 0], forwardMove: 0, rightMove: 0, upMove: 0, buttons: 0, weapon: 2 } };
    expect(remote.command(rawInput).angles).toEqual([1234, 5678, 0]);
    const predicted = remote.movement(localSource.seat).submit(rawInput, now);
    expect(predicted.angles).toEqual({ x: 1234, y: 5678, z: 0 });
    for (let sequence = 1; sequence <= 12; sequence++) {
      network.submit([{ actor: player.actor, source: { kind: 'remote-client', client: remote.client.id }, sequence,
        command: { kind: 'q3', serverTimeMilliseconds: now, angleWords: [0, 0, 0], forwardMove: 127, rightMove: 0, upMove: 0, buttons: 0, weapon: 2 } }], now);
      await exchange();
    }
    expect(app.simulation.bodies.read(serverPlayer.actor)?.origin).not.toEqual(before);
    const body = app.simulation.bodies.read(serverPlayer.actor); if (body === null) throw new Error("Missing server body");
    expect(remote.initialPlayer.origin).toEqual(body.origin);
    expect(remote.cgameSource.commands.currentNumber).toBeGreaterThan(12);
    expect(remote.cgameSource.current()?.number).toBeGreaterThan(0);
    const native = network.native, retained = native?.history.latest;
    if (native === null || retained === undefined || retained === null) throw new Error('No retained source snapshot');
    const receiptPing = native.snapshotPing(retained.messageNumber);
    expect(receiptPing).not.toBeNull();
    await exchange(); await exchange();
    expect(native.snapshotPing(retained.messageNumber)).toBe(receiptPing);
    expect(remote.cgameSource.snapshotPing?.(retained.messageNumber)).toBe(receiptPing);
    await expect(remote.systemInfo('\\sv_pure\\1\\fs_game\\baseq3')).rejects.toThrow('requires pure verification');
    await expect(remote.systemInfo('\\sv_pure\\0\\fs_game\\downloaded-mod')).resolves.toBeUndefined();
    await expect(remote.systemInfo('\\sv_pure\\0\\fs_game\\BASEQ3')).resolves.toBeUndefined();
    await expect(remote.systemInfo('\\sv_pure\\0\\fs_game\\../escape')).rejects.toThrow();
  } finally { network.close(); session.close(); await app.close(); }
}, 60000);

test('production protocol68 shared remote frontend draws retail q3dm1 and travels without a simulation', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const root = mkdtempSync(join(tmpdir(), 'q3-browser-wiring-'));
  const browser = await StartupServerBrowser.open(new ConfigStore(join(root, 'browser-settings')));
  const common = ['--content-root', join(homedir(), 'Projects/qfiles'), '--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
  if (selected.kind !== 'run') throw new Error('Missing server options');
  const prints: string[] = [], host = { saveDirectory: join(root, 'saves'), serverBrowser: browser, print: (text: string): undefined => { prints.push(text); return undefined; } };
  const server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-content') }, host);
  expect(server.simulation.q3Source()?.host.cvars.get('sv_pure')?.integerValue).toBe(1);
  const guestFrames = spyOn(QvmCgame.prototype, 'drawActiveFrame'), scenes = spyOn(Q3SceneRecorder.prototype, 'renderScene'), audio = spyOn(UnifiedAudio.prototype, 'play');
  const pure = spyOn(Q3ServerConnection.prototype, 'verifyPure'), shaders = spyOn(Q3RendererResources.prototype, 'registerShader'), pictures = spyOn(Draw2D.prototype, 'stretchPixels');
  const guestUiFrames = spyOn(QvmUi.prototype, 'refresh'), guestKeys = spyOn(QvmUi.prototype, 'keyEvent');
  const browserCloses = spyOn(Q3BrowserView.prototype, 'close');
  let app: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  const lifecycle: string[] = [], shutdownGate = Promise.withResolvers<void>();
  let pauseShutdown = false;
  const originalCgShutdown = QvmCgame.prototype.shutdown, originalUiShutdown = QvmUi.prototype.shutdown, originalUiInit = QvmUi.prototype.init;
  const cgShutdown = spyOn(QvmCgame.prototype, "shutdown").mockImplementation(async function(this: QvmCgame) {
    lifecycle.push(`cg-shutdown:${app?.content.recipe.map.geometry.requestedPath}`);
    if (pauseShutdown) await shutdownGate.promise;
    await originalCgShutdown.call(this);
    return undefined;
  });
  const uiShutdown = spyOn(QvmUi.prototype, "shutdown").mockImplementation(async function(this: QvmUi) {
    lifecycle.push(`ui-shutdown:${app?.content.recipe.map.geometry.requestedPath}`);
    await originalUiShutdown.call(this); return undefined;
  });
  const uiInit = spyOn(QvmUi.prototype, "init").mockImplementation(async function(this: QvmUi, connecting: boolean) {
    lifecycle.push(`ui-init:${app?.content.recipe.map.geometry.requestedPath}`);
    await originalUiInit.call(this, connecting); return undefined;
  });

  try {
    const address = server.networkAddress; if (address === null) throw new Error('No listener');
    const parsed = parseApplicationCommand([...common, '--connect-q3', `localhost:${address.port}`, '--renderer', process.env["Q3_REMOTE_RENDERER"] ?? 'cpu', '--width', '640', '--height', '480', '--hidden']);
    if (parsed.kind !== 'run') throw new Error('Missing client options');
    app = await RemoteApplication.open({ ...parsed.options, userContentRoot: join(root, 'client-content') }, host);
    const remote = app;
    for (const name of ['serverstatus', 'ping', 'globalservers']) remote.clientCommands?.commands.executeNow(name);
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await server.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let i = 0; i < 100 && remote.networkPhase !== 'active'; i++) await exchange();
    expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull();
    expect(prints.some(text => text.includes('Not connected to a server.'))).toBe(true);
    expect(prints.includes('usage: ping [server]\n')).toBe(true);
    expect(prints.includes('usage: globalservers <master# 0-1> <protocol> [keywords]\n')).toBe(true);
    expect(remote.serverBrowser).toBe(browser);
    expect(remote.clientCommands?.cvars.variableValue('cl_maxPing')).toBe(800);
    expect(remote.clientCommands?.cvars.variableValue('cl_serverStatusResendTime')).toBe(750);
    for (const name of ['localservers', 'globalservers', 'ping', 'serverstatus'])
      expect(remote.clientCommands?.commands.commandDocumentation(name)?.usage.startsWith(name)).toBe(true);
    remote.clientCommands?.commands.executeNow(`ping localhost:${address.port}`);
    remote.clientCommands?.commands.executeNow('serverstatus');
    for (let tick = 0; tick < 30 && !prints.includes('Server settings:\n'); tick++) await exchange();
    expect(prints.includes('Server settings:\n')).toBe(true);
    expect(prints.some(text => text.includes('Players:\n'))).toBe(true);
    const discovered = browser.q3Core.entry(address);
    expect(discovered?.status?.map).toBe('q3dm1');
    expect(typeof discovered?.pingMilliseconds).toBe('number');
    const player = remote.localPlayers[0], peer = server.networkClients[0];
    if (player === undefined || peer === undefined) throw new Error(`No player: ${prints.join('')}`);
    if (!(remote.remote instanceof Q3RemotePresentation)) throw new Error("Missing native Q3 presentation");
    expect(remote.remote.initialPlayer.ammo.get(1)).toBe(-1);
    if (process.env["Q3_NOAMMO_PROBE"] === "1") {
      const source = server.simulation.q3Source()?.records.byActor(peer.actor)?.client;
      if (source === undefined || source === null) throw new Error("No native source client for ammo diagnostic");
      source.ps.ammo.set(1, 0);
      await exchange();
    }
    const capture = remote.captureNextFrame();
    await exchange();
    const pixels = await capture;
    expect((await Promise.all(pure.mock.results.map(result => result.type === "return" ? result.value : null))).some(result => result?.kind === "authentic")).toBe(true);
    expect(shaders.mock.calls.some(([name]) => name === "icons/iconw_gauntlet")).toBe(true);
    const gauntletDraw = pictures.mock.calls.find(([, , picture]) => (typeof picture === "function" ? picture() : picture).name === "icons/iconw_gauntlet");
    if (process.env["Q3_REMOTE_CAPTURE"] !== undefined) {
      const draw = gauntletDraw;
      const registration = shaders.mock.results[shaders.mock.calls.findIndex(([name]) => name === "icons/iconw_gauntlet")];
      const shader = registration?.type === "return" ? await registration.value : null;
      const picture = draw === undefined ? null : (typeof draw[2] === "function" ? draw[2]() : draw[2]);
      console.log("guest gauntlet", JSON.stringify({ shader: shader?.name, rect: draw?.[0], picture: picture?.name, stages: picture?.kind === "material" ? picture.material.compiled.material.stages.map(stage => ({ color: stage.color, blend: stage.blend, map: stage.map })) : null }));
      console.log("guest selector", JSON.stringify({ ammo: remote.remote instanceof Q3RemotePresentation ? remote.remote.initialPlayer.ammo.get(1) : null,
        draws: pictures.mock.calls.filter(([rect]) => rect.x === 280 && rect.y === 380).map(([, , value]) => {
          const picture = typeof value === "function" ? value() : value;
          return { name: picture.name, stages: picture.kind === "material" ? picture.material.compiled.material.stages.map(stage => ({ color: stage.color, blend: stage.blend })) : null };
        }) }));
    }
    expect(new Set(pixels).size).toBeGreaterThan(16);
    if (process.env["Q3_REMOTE_CAPTURE"] !== undefined) {
      const { encodePng } = await import('../../../src/formats/images/png-encoder.ts');
      await Bun.write(process.env["Q3_REMOTE_CAPTURE"], encodePng(640, 480, pixels));
    }
    const before = server.simulation.bodies.read(peer.actor)?.origin;
    const aim = server.simulation.playerView(peer.actor).angles;
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: true, timeMilliseconds: performance.now() });
    for (let i = 0; i < 10; i++) await exchange();
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: false, timeMilliseconds: performance.now() });
    expect(guestFrames.mock.calls.length).toBeGreaterThan(0);
    expect(scenes.mock.calls.length).toBeGreaterThan(0);
    expect(audio.mock.calls.some(([sound]) => sound.family === 'q3')).toBe(true);
    remote.queueCommand('ui_cinematics', [], player.seat.id);
    await exchange();
    expect(guestUiFrames.mock.calls.length).toBeGreaterThan(0);
    remote.input({ seat: player.seat.id, kind: 'key', code: 27, down: true, repeat: false, timeMilliseconds: performance.now() });
    await exchange();
    expect(guestKeys.mock.calls.some(([key]) => key === 27)).toBe(true);
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    expect(server.simulation.bodies.read(peer.actor)?.origin).not.toEqual(before);
    expect(server.simulation.playerView(peer.actor).angles.y).toBeCloseTo(aim.y, 1);
    if (!('cgameSource' in remote.remote)) throw new Error('Missing Q3 remote source');
    const oldSource = remote.remote.cgameSource, oldNumber = oldSource.current()?.number;
    if (oldNumber === undefined) throw new Error('No old snapshot');
    await server.changeLevel('q3dm2');
    for (let i = 0; i < 60 && remote.content.recipe.map.geometry.requestedPath !== 'maps/q3dm2.bsp'; i++) await exchange();
    if (remote.content.recipe.map.geometry.requestedPath !== 'maps/q3dm2.bsp') throw new Error(`Travel failed ${remote.networkPhase}: ${prints.join('')}`);
    expect(remote.content.recipe.map.geometry.requestedPath).toBe('maps/q3dm2.bsp');
    expect(oldSource.snapshotPing?.(oldNumber)).toBeNull();
    expect(server.networkClients[0]?.client.equals(peer.client)).toBe(true);
    expect(remote.session.world).toBeNull();
    expect(lifecycle).toEqual(["ui-init:maps/q3dm1.bsp", "cg-shutdown:maps/q3dm1.bsp", "ui-shutdown:maps/q3dm1.bsp", "ui-init:maps/q3dm2.bsp"]);
    expect(browserCloses.mock.calls.length).toBe(0);
    for (let tick = 0; tick < 30 && remote.networkPhase !== 'active'; tick++) await exchange();
    const previousStatuses = prints.filter(text => text === 'Server settings:\n').length;
    remote.clientCommands?.commands.executeNow('serverstatus');
    for (let tick = 0; tick < 30 && prints.filter(text => text === 'Server settings:\n').length === previousStatuses; tick++) await exchange();
    expect(prints.filter(text => text === 'Server settings:\n').length).toBe(previousStatuses + 1);
    pauseShutdown = true;
    const closing = remote.close();
    expect(remote.close()).toBe(closing);
    await expect(remote.step(50)).rejects.toThrow("closed");
    expect(() => remote.input({ seat: player.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() })).toThrow("closed");
    shutdownGate.resolve();
    await closing;
    expect(browserCloses.mock.calls.length).toBe(1);
    expect(() => browser.assertOpen()).not.toThrow();
    expect(lifecycle.slice(-2)).toEqual(["cg-shutdown:maps/q3dm2.bsp", "ui-shutdown:maps/q3dm2.bsp"]);
  } finally { shutdownGate.resolve(); await app?.close(); await server.close(); await browser.close(); browserCloses.mockRestore(); cgShutdown.mockRestore(); uiShutdown.mockRestore(); uiInit.mockRestore(); guestFrames.mockRestore(); scenes.mockRestore(); audio.mockRestore(); guestUiFrames.mockRestore(); guestKeys.mockRestore(); pure.mockRestore(); shaders.mockRestore(); pictures.mockRestore(); rmSync(root, { recursive: true, force: true }); }
}, 60000);


test('native Q3 downloads a referenced user package before guest init and pure admission', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const root = mkdtempSync(join(tmpdir(), 'q3-remote-download-')), corpus = join(root, 'server'), base = join(corpus, 'q3a/baseq3');
  const original = join(homedir(), 'Projects/qfiles'), users = join(root, 'user-content');
  mkdirSync(base, { recursive: true });
  for (const name of readdirSync(join(original, 'q3a/baseq3'))) if (name.endsWith('.pk3')) copyFileSync(join(original, 'q3a/baseq3', name), join(base, name), constants.COPYFILE_FICLONE);
  const bytes = fixturePk3('wire-probe.dat'); writeFileSync(join(base, 'zzz-wire-fixture.pk3'), bytes);
  const common = ['--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--content-root', corpus, '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
  if (selected.kind !== 'run') throw new Error('Missing server options');
  const messages: string[] = [], host = { print: (text: string): undefined => { messages.push(text); return undefined; } };
  let server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-user-content') }, host);
  const opened = await server.content.mounts.open('wire-probe.dat'); if (opened === null) throw new Error('Server did not open fixture resource');
  server.simulation.q3Source()?.host.cvars.set('sv_allowDownload', '1', true);
  let client: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  const init = spyOn(QvmCgame.prototype, 'init'), pure = spyOn(Q3ServerConnection.prototype, 'verifyPure');
  try {
    const address = server.networkAddress; if (address === null) throw new Error('Missing listener');
    const selectedClient = parseApplicationCommand([...common, '--content-root', original, '--connect-q3', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden']);
    if (selectedClient.kind !== 'run') throw new Error('Missing client options');
    const disabledUsers = join(root, 'disabled-content');
    mkdirSync(join(disabledUsers, 'q3a/baseq3/settings'), { recursive: true });
    writeFileSync(join(disabledUsers, 'q3a/baseq3/settings/client.cfg'), 'seta cl_allowDownload "0"\nseta rate "10000"\n');
    client = await RemoteApplication.open({ ...selectedClient.options, userContentRoot: disabledUsers }, host);
    expect(client.clientCommands?.cvars.get('rate')?.integerValue).toBe(10000);
    for (let tick = 0; tick < 100 && !messages.some(text => text.includes('Downloads are disabled')); tick++) {
      await client.step(50); await Bun.sleep(2); await server.step(50); await Bun.sleep(2);
    }
    expect(messages.some(text => text.includes('Missing server packages: baseq3/zzz-wire-fixture.pk3'))).toBe(true);
    expect(messages.some(text => text.startsWith('Downloading '))).toBe(false);
    expect(existsSync(join(disabledUsers, 'q3a/baseq3/zzz-wire-fixture.pk3'))).toBe(false);
    await client.close(); client = null; await server.close();
    server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-user-content') }, host);
    await server.content.mounts.open('wire-probe.dat');
    server.simulation.q3Source()?.host.cvars.set('sv_allowDownload', '1', true);
    server.simulation.q3Source()?.host.cvars.set('fs_game', 'remote-asset-proof', true);
    const nextAddress = server.networkAddress; if (nextAddress === null) throw new Error('Missing restarted listener');
    init.mockClear(); pure.mockClear();
    client = await RemoteApplication.open({ ...selectedClient.options, network: { kind: "q3-client", remote: `127.0.0.1:${nextAddress.port}` }, userContentRoot: users }, host);
    const remote = client;
    expect(remote.clientCommands?.cvars.get("cl_allowDownload")?.integerValue).toBe(0);
    remote.clientCommands?.commands.executeNow("seta cl_allowDownload 1");
    expect(existsSync(join(users, 'q3a/baseq3/zzz-wire-fixture.pk3'))).toBe(false);
    let downloading = false, initializedDuringDownload = false;
    for (let tick = 0; tick < 300 && remote.networkPhase !== 'active'; tick++) {
      await remote.step(50); await Bun.sleep(2); await server.step(50); await Bun.sleep(2);
      if (remote.remote instanceof Q3RemotePresentation && remote.remote.downloading) {
        downloading = true; initializedDuringDownload ||= remote.localPlayers.length !== 0 || init.mock.calls.length !== 0;
      }
    }
    if (remote.networkPhase !== 'active') throw new Error(`Download admission failed: ${messages.join('')}`);
    expect(downloading).toBe(true);
    expect(initializedDuringDownload).toBe(false);
    expect(await Bun.file(join(users, 'q3a/baseq3/zzz-wire-fixture.pk3')).bytes()).toEqual(bytes);
    expect(init.mock.calls.length).toBe(1);
    expect(remote.content.catalog.require('q3-baseq3-mod-remote-asset-proof').expectation.contentDirectory).toBe('q3a/remote-asset-proof');
    expect((await Promise.all(pure.mock.results.map(result => result.type === 'return' ? result.value : null))).some(result => result?.kind === 'authentic')).toBe(true);
    expect(remote.session.world).toBeNull();
    const resource = await remote.content.mounts.open('wire-probe.dat');
    if (resource?.reference.provenance.kind !== 'archive') throw new Error('Downloaded resource lacks archive provenance');
    expect(resource.reference.provenance.mount.archivePath).toBe(join(users, 'q3a/baseq3/zzz-wire-fixture.pk3'));
    const plays = spyOn(UnifiedAudio.prototype, 'play');
    try {
      remote.queueCommand('soundinfo', [], null);
      remote.queueCommand('play', ['sound/weapons/machinegun/machgf1b.wav'], null);
      remote.queueCommand('soundlist', [], null);
      await remote.step(50);
      expect(plays.mock.calls.some(call => call[0].sound.name.includes('machgf1b'))).toBe(true);
      expect(messages.some(text => text.includes('machgf1b.wav'))).toBe(true);
    } finally { plays.mockRestore(); }
    await remote.close(); client = null;
    expect(await Bun.file(join(users, 'q3a/baseq3/settings/client.cfg')).text()).toContain('seta cl_allowDownload "1"');
  } finally { await client?.close(); await server.close(); init.mockRestore(); pure.mockRestore(); rmSync(root, { recursive: true, force: true }); }
}, 60000);

test('native Q3 retries an interrupted second referenced package before guest initialization', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const root = mkdtempSync(join(tmpdir(), 'q3-multiple-download-')), corpus = join(root, 'server'), base = join(corpus, 'q3a/baseq3');
  const original = join(homedir(), 'Projects/qfiles'), users = join(root, 'user-content'), destination = join(users, 'q3a/baseq3');
  mkdirSync(base, { recursive: true });
  for (const name of readdirSync(join(original, 'q3a/baseq3'))) if (name.endsWith('.pk3')) copyFileSync(join(original, 'q3a/baseq3', name), join(base, name), constants.COPYFILE_FICLONE);
  const packages = [
    { name: 'zzz-first.pk3', resource: 'first-probe.dat', bytes: fixturePk3('first-probe.dat', 4000) },
    { name: 'zzz-second.pk3', resource: 'second-probe.dat', bytes: fixturePk3('second-probe.dat', 4001) },
  ];
  for (const pack of packages) writeFileSync(join(base, pack.name), pack.bytes);
  const common = ['--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--content-root', corpus, '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
  if (selected.kind !== 'run') throw new Error('Missing server options');
  const messages: string[] = [], host = { print: (text: string): undefined => { messages.push(text); return undefined; } };
  const server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-user') }, host);
  let client: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  const init = spyOn(QvmCgame.prototype, 'init'), pure = spyOn(Q3ServerConnection.prototype, 'verifyPure');
  try {
    for (const pack of packages) { const opened = await server.content.mounts.open(pack.resource); if (opened === null) throw new Error('Missing server reference'); }
    server.simulation.q3Source()?.host.cvars.set('sv_allowDownload', '1', true);
    const address = server.networkAddress; if (address === null) throw new Error('Missing listener');
    const options = parseApplicationCommand([...common, '--content-root', original, '--connect-q3', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden']);
    if (options.kind !== 'run') throw new Error('Missing client options');
    mkdirSync(join(destination, 'settings'), { recursive: true });
    writeFileSync(join(destination, 'settings/client.cfg'), 'seta cl_allowDownload "1"\n');
    client = await RemoteApplication.open({ ...options.options, userContentRoot: users }, host);
    let published: string | undefined;
    for (let tick = 0; tick < 500; tick++) {
      await client.step(50); await Bun.sleep(2); await server.step(50); await Bun.sleep(2);
      const installed = packages.filter(pack => existsSync(join(destination, pack.name)));
      if (installed.length === 1 && readdirSync(destination).some(name => name.startsWith('.download-'))) { published = installed[0]?.name; break; }
    }
    if (published === undefined) throw new Error(`No partial second package: ${readdirSync(destination)} ${messages.join('')}`);
    expect(init.mock.calls.length).toBe(0); expect(client.localPlayers).toHaveLength(0);
    const first = packages.find(pack => pack.name === published); if (first === undefined) throw new Error('Unknown first package');
    expect(await Bun.file(join(destination, first.name)).bytes()).toEqual(first.bytes);
    await client.close(); client = null;
    expect(readdirSync(destination).filter(name => name.endsWith('.pk3'))).toEqual([first.name]);
    for (let tick = 0; tick < 5; tick++) { await server.step(50); await Bun.sleep(2); }
    client = await RemoteApplication.open({ ...options.options, userContentRoot: users }, host);
    for (let tick = 0; tick < 1200 && client.networkPhase !== 'active'; tick++) {
      await client.step(50); await Bun.sleep(2); await server.step(50); await Bun.sleep(2);
      if (packages.some(pack => !existsSync(join(destination, pack.name)))) expect(init.mock.calls.length).toBe(0);
    }
    if (client.networkPhase !== 'active') throw new Error(`Retry admission failed: ${messages.join('')}`);
    for (const pack of packages) expect(await Bun.file(join(destination, pack.name)).bytes()).toEqual(pack.bytes);
    expect(init.mock.calls.length).toBe(1);
    expect((await Promise.all(pure.mock.results.map(result => result.type === 'return' ? result.value : null))).some(result => result?.kind === 'authentic')).toBe(true);
    expect(client.session.world).toBeNull();
    expect(readdirSync(destination).filter(name => name.startsWith('.download-'))).toEqual([]);
  } finally { await client?.close(); await server.close(); init.mockRestore(); pure.mockRestore(); rmSync(root, { recursive: true, force: true }); }
}, 90000);


test('unknown mounted LRCTF clients run the production baseQ3 ABI for thirty active seconds', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const root = mkdtempSync(join(tmpdir(), 'q3-unknown-client-'));
  const common = ['--content-root', join(homedir(), 'Projects/qfiles'), '--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
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
  const frames = spyOn(QvmCgame.prototype, 'drawActiveFrame'), uiRetire = spyOn(QvmUi.prototype, 'retire'), cgRetire = spyOn(QvmCgame.prototype, 'retire');
  let browser: StartupServerBrowser | null = null, server: Application | null = null;
  let app: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  try {
    browser = await StartupServerBrowser.open(new ConfigStore(join(root, 'browser-settings')));
    const retainedBrowser = browser;
    const host = { saveDirectory: join(root, 'saves'), serverBrowser: browser, print: (text: string): undefined => { prints.push(text); return undefined; } };
    server = await Application.open({ ...selected.options, userContentRoot: join(root, 'server-content') }, host);
    const source = server.simulation.q3Source(); if (source === null) throw new Error('Missing baseQ3 server source');
    source.host.cvars.set('sv_pure', '0', true); source.host.cvars.set('fs_game', 'lrctf', true);
    const address = server.networkAddress; if (address === null) throw new Error('No listener');
    const parsed = parseApplicationCommand([...common, '--connect-q3', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '320', '--height', '240', '--hidden']);
    if (parsed.kind !== 'run') throw new Error('Missing client options');
    app = await RemoteApplication.open({ ...parsed.options, userContentRoot: join(root, 'client-content') }, host);
    const remote = app, authority = server;
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await authority.step(50); await Bun.sleep(1); };
    for (let tick = 0; tick < 100 && remote.networkPhase !== 'active'; tick++) await exchange();
    expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull();
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
    const initialPosition = authority.simulation.bodies.read(peer.actor)?.origin;
    const sourceClient = source.records.byActor(peer.actor)?.client;
    if (initialPosition === undefined || sourceClient === undefined || sourceClient === null) throw new Error('Missing authoritative player state');
    const before = { ...initialPosition }, initialAmmo = sourceClient.ps.ammo.get(2) ?? 0;
    let minimumAmmo = initialAmmo, maximumDistance = 0, ticks = 0;
    const started = performance.now(), startedFrame = remote.frameCount;
    remote.queueCommand('weapon', ['2'], player.seat.id);
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: true, timeMilliseconds: performance.now() });
    let captured = false;
    while (performance.now() - started < 30000) {
      const tickStarted = performance.now(); await exchange(); ticks++;
      expect(remote.networkPhase).toBe('active');
      const position = authority.simulation.bodies.read(peer.actor)?.origin;
      if (position !== undefined) maximumDistance = Math.max(maximumDistance, Math.hypot(position.x - before.x, position.y - before.y, position.z - before.z));
      minimumAmmo = Math.min(minimumAmmo, sourceClient.ps.ammo.get(2) ?? initialAmmo);
      if (ticks === 20) remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
      if (ticks === 60) remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: false, timeMilliseconds: performance.now() });
      const artifactDirectory = process.env['Q3_UNKNOWN_MODULE_ARTIFACTS'];
      if (!captured && ticks >= 60 && artifactDirectory !== undefined) {
        const capture = remote.captureNextFrame(); await exchange();
        const { encodePng } = await import('../../../src/formats/images/png-encoder.ts');
        mkdirSync(artifactDirectory, { recursive: true }); await Bun.write(join(artifactDirectory, 'active.png'), encodePng(320, 240, await capture)); captured = true;
      }
      const remaining = 50 - (performance.now() - tickStarted); if (remaining > 0) await Bun.sleep(remaining);
    }
    const activeMilliseconds = performance.now() - started;
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    remote.input({ seat: player.seat.id, kind: 'mouse-button', button: 1, down: false, timeMilliseconds: performance.now() });
    expect(activeMilliseconds).toBeGreaterThanOrEqual(30000); expect(maximumDistance).toBeGreaterThan(8);
    expect(initialAmmo).toBeGreaterThan(0); expect(minimumAmmo).toBeLessThan(initialAmmo);
    expect(frames.mock.calls.length).toBeGreaterThan(60);
    expect(prints.some(text => text.includes('Unbound '))).toBe(false);
    await remote.close(); app = null;
    expect(uiRetire.mock.calls.length).toBe(1); expect(cgRetire.mock.calls.length).toBe(1);
    expect(() => retainedBrowser.assertOpen()).not.toThrow();
    const artifactDirectory = process.env['Q3_UNKNOWN_MODULE_ARTIFACTS'];
    if (artifactDirectory !== undefined) {
      mkdirSync(artifactDirectory, { recursive: true });
      writeFileSync(join(artifactDirectory, 'result.json'), JSON.stringify({ scope: 'LRCTF client bytecode against baseQ3 protocol68 server, non-pure', selectedModules, modules,
        activeMilliseconds, ticks, frames: remote.frameCount - startedFrame, initialPosition: before, maximumDistance, initialAmmo, minimumAmmo,
        retired: { ui: uiRetire.mock.calls.length, cgame: cgRetire.mock.calls.length }, captured, prints }, null, 2));
    }
  } finally {
    try { await app?.close(); } finally {
      try { await server?.close(); } finally {
        try { await browser?.close(); } finally {
          uiInit.mockRestore(); cgInit.mockRestore(); frames.mockRestore(); uiRetire.mockRestore(); cgRetire.mockRestore();
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
}, 120000);
