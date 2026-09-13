import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, copyFileSync, constants, writeFileSync } from 'node:fs';
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

function fixturePk3(): Uint8Array<ArrayBuffer> {
  const name = new TextEncoder().encode('wire-probe.cfg'), data = new TextEncoder().encode('set wire_probe 1\n'.repeat(400));
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
  const remote = new Q3RemotePresentation({ identity, session, content: app.content,
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
    await expect(remote.systemInfo('\\sv_pure\\1\\fs_game\\baseq3')).rejects.toThrow('requires pure verification');
  } finally { network.close(); session.close(); await app.close(); }
}, 60000);

test('production protocol68 shared remote frontend draws retail q3dm1 and travels without a simulation', async () => {
  const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
  const { addressKey } = await import('../../../src/network/common/endpoint.ts');
  const common = ['--content-root', join(homedir(), 'Projects/qfiles'), '--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch'];
  const selected = parseApplicationCommand([...common, '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
  if (selected.kind !== 'run') throw new Error('Missing server options');
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  const server = await Application.open(selected.options, host);
  server.simulation.q3Source()?.host.cvars.set('sv_pure', '0', true);
  let app: Awaited<ReturnType<typeof RemoteApplication.open>> | null = null;
  try {
    const address = server.networkAddress; if (address === null) throw new Error('No listener');
    const parsed = parseApplicationCommand([...common, '--connect-q3', addressKey(address), '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden']);
    if (parsed.kind !== 'run') throw new Error('Missing client options');
    app = await RemoteApplication.open(parsed.options, host);
    const remote = app;
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await server.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let i = 0; i < 100 && remote.localPlayers.length === 0; i++) await exchange();
    expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull();
    const player = remote.localPlayers[0], peer = server.networkClients[0];
    if (player === undefined || peer === undefined) throw new Error(`No player: ${prints.join('')}`);
    expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    const before = server.simulation.bodies.read(peer.actor)?.origin;
    const aim = server.simulation.playerView(peer.actor).angles;
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    for (let i = 0; i < 10; i++) await exchange();
    remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    expect(server.simulation.bodies.read(peer.actor)?.origin).not.toEqual(before);
    expect(server.simulation.playerView(peer.actor).angles.y).toBeCloseTo(aim.y, 1);
    await server.changeLevel('q3dm2');
    for (let i = 0; i < 60 && remote.content.recipe.map.geometry.requestedPath !== 'maps/q3dm2.bsp'; i++) await exchange();
    if (remote.content.recipe.map.geometry.requestedPath !== 'maps/q3dm2.bsp') throw new Error(`Travel failed ${remote.networkPhase}: ${prints.join('')}`);
    expect(remote.content.recipe.map.geometry.requestedPath).toBe('maps/q3dm2.bsp');
    expect(server.networkClients[0]?.client.equals(peer.client)).toBe(true);
    expect(remote.session.world).toBeNull();
  } finally { await app?.close(); await server.close(); }
}, 60000);
