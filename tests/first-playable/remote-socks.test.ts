import { decodeConnectionless } from "../../src/network/q3/connectionless.ts";
import { encodeNetQuakeControl, quakeWorldOutOfBand } from "../../src/network/q1/handshake.ts";
import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../src/app/bootstrap/application.ts';
import { RemoteApplication } from '../../src/app/bootstrap/remote-application.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { ipAddress } from '../../src/network/common/endpoint.ts';
import { readSocksDatagram, socksDatagram } from '../../src/network/common/socks.ts';
import { UdpTransport } from '../../src/network/common/transport.ts';

async function relay(peerPort: number, stall = false) {
  const udp = createSocket('udp4');
  await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
  const address = udp.address();
  let client: { readonly port: number; readonly host: string } | null = null;
  let authenticated = 0, associations = 0, closed = 0, outbound = 0, inbound = 0;
  const sockets = new Set<Socket>();
  udp.on('message', (bytes, remote) => {
    if (remote.port === peerPort) {
      const from = ipAddress('127.0.0.1', peerPort);
      if (client === null || from.kind !== 'ipv4') return;
      inbound++; udp.send(socksDatagram(from, bytes), client.port, client.host); return;
    }
    const request = readSocksDatagram(bytes);
    if (request === null || request.from.port !== peerPort || request.from.host.join('.') !== '127.0.0.1') return;
    client = { port: remote.port, host: remote.address }; outbound++;
    udp.send(request.payload, peerPort, '127.0.0.1');
  });
  const tcp = createServer(socket => {
    sockets.add(socket); socket.on('close', () => { sockets.delete(socket); closed++; });
    socket.on('error', () => undefined);
    let pending = Buffer.alloc(0), stage = 0;
    socket.on('data', (chunk: Uint8Array) => {
      pending = Buffer.concat([pending, chunk]);
      if (stall) return;
      while (true) {
        if (stage === 0) {
          const length = pending[1]; if (length === undefined || pending.length < length + 2) return;
          if (pending[0] !== 5 || !pending.subarray(2, 2 + length).includes(2)) { socket.destroy(); return; }
          pending = pending.subarray(2 + length); socket.write(Uint8Array.of(5, 2)); stage++;
        } else if (stage === 1) {
          const userLength = pending[1]; if (userLength === undefined) return;
          const passwordLength = pending[2 + userLength]; if (passwordLength === undefined || pending.length < 3 + userLength + passwordLength) return;
          const valid = pending[0] === 1 && pending.subarray(2, 2 + userLength).toString() === 'fixture-user'
            && pending.subarray(3 + userLength, 3 + userLength + passwordLength).toString() === 'fixture-secret';
          socket.write(Uint8Array.of(1, valid ? 0 : 1));
          pending = pending.subarray(3 + userLength + passwordLength); if (!valid) return;
          authenticated++; stage++;
        } else if (stage === 2) {
          if (pending.length < 10) return;
          if (pending[0] !== 5 || pending[1] !== 3 || pending[3] !== 1) { socket.destroy(); return; }
          associations++;
          socket.write(Uint8Array.of(5, 0, 0, 1, 127, 0, 0, 1, address.port >>> 8, address.port & 255));
          pending = pending.subarray(10); stage++; return;
        } else return;
      }
    });
  });
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const control = tcp.address(); if (control === null || typeof control === 'string') throw new Error('No proxy address');
  return { port: control.port, get authenticated() { return authenticated; }, get associations() { return associations; },
    get closed() { return closed; }, get connections() { return sockets.size; }, get outbound() { return outbound; }, get inbound() { return inbound; },
    drop: () => { for (const socket of sockets) socket.destroy(); },
    close: async () => { for (const socket of sockets) socket.destroy(); udp.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); } };
}

test('saved shared SOCKS settings authenticate Q2 RemoteApplication before signon and retain relay across travel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-socks-'));
  const users = join(root, 'client'), config = join(users, 'q2/baseq2/settings/client.cfg');
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  const launch = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'coop', '--listen-q2', '0', '--bind', '127.0.0.1']);
  let server: Application | null = null, client: RemoteApplication | null = null;
  let proxy: Awaited<ReturnType<typeof relay>> | null = null;
  try {
    if (launch.kind !== 'run') throw new Error('No server selection');
    const authoritative = await Application.open({ ...launch.options, userContentRoot: join(root, 'server') }, host); server = authoritative;
    const address = authoritative.networkAddress; if (address === null) throw new Error('No peer address');
    proxy = await relay(address.port);
    await mkdir(join(users, 'q2/baseq2/settings'), { recursive: true });
    await Bun.write(config, `seta net_socksEnabled 1\nseta net_socksServer 127.0.0.1\nseta net_socksPort ${proxy.port}\nseta net_socksUsername fixture-user\nseta net_socksPassword fixture-secret\n`);
    const selected = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--mode', 'coop', '--connect-q2', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden']);
    if (selected.kind !== 'run') throw new Error('No client selection');
    client = await RemoteApplication.open({ ...selected.options, userContentRoot: users }, host);
    const remote = client;
    expect(proxy.authenticated).toBe(1); expect(proxy.associations).toBe(1); expect(proxy.outbound).toBe(0);
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(2); await authoritative.step(50); await Bun.sleep(2); await remote.step(50); };
    for (let index = 0; index < 120 && remote.localPlayers.length === 0; index++) await exchange();
    expect(remote.networkPhase).toBe('active'); expect(proxy.outbound).toBeGreaterThan(0); expect(proxy.inbound).toBeGreaterThan(0);
    expect(remote.session.world).toBeNull(); expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    const owner = remote.clientCommands; if (owner === null) throw new Error('No common client command owner');
    owner.commands.append('set net_socksEnabled 0\n'); owner.commands.execute();
    const before = proxy.outbound, window = remote.window;
    authoritative.queueCommand('map', ['base2'], null);
    for (let index = 0; index < 120 && (remote.content.recipe.map.geometry.requestedPath !== 'maps/base2.bsp' || remote.networkPhase !== 'active'); index++) await exchange();
    expect(remote.content.recipe.map.geometry.requestedPath).toBe('maps/base2.bsp'); expect(remote.window).toBe(window);
    expect(proxy.associations).toBe(1); expect(proxy.outbound).toBeGreaterThan(before);
    await remote.close(); await Bun.sleep(10);
    expect(proxy.closed).toBe(1); expect(proxy.connections).toBe(0);
    expect(await Bun.file(config).text()).toContain('seta net_socksEnabled "0"');
    expect(prints.some(text => text.includes('fixture-secret'))).toBe(false);
    const sent = proxy.outbound;
    client = await RemoteApplication.open({ ...selected.options, userContentRoot: users }, host);
    await client.step(50); await Bun.sleep(5);
    expect(proxy.associations).toBe(1); expect(proxy.outbound).toBe(sent);
    await client.close();
  } finally { await client?.close(); await server?.close(); await proxy?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test('closing during SOCKS negotiation rejects promptly and proxy loss never falls back to direct UDP', async () => {
  const peer = createSocket('udp4');
  let directPackets = 0;
  peer.on('message', () => { directPackets++; });
  let proxy: Awaited<ReturnType<typeof relay>> | null = null, active: Awaited<ReturnType<typeof relay>> | null = null;
  let transport: UdpTransport | null = null, udp: UdpTransport | null = null;
  try {
    await new Promise<void>(resolve => peer.bind(0, '127.0.0.1', resolve));
    const destination = ipAddress('127.0.0.1', peer.address().port);
    proxy = await relay(destination.port, true);
    const candidate = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }); transport = candidate;
    const pending = candidate.connectSocks({ server: '127.0.0.1', port: proxy.port, username: 'fixture-user', password: 'fixture-secret' });
    const start = performance.now(), timer = setTimeout(() => candidate.close(), 10);
    try { await expect(pending).rejects.toThrow('SOCKS'); } finally { clearTimeout(timer); }
    expect(performance.now() - start).toBeLessThan(1000);
    expect(candidate.closed).toBe(true);
    await proxy.close(); proxy = null;
    active = await relay(destination.port);
    const connected = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }); udp = connected;
    await connected.connectSocks({ server: '127.0.0.1', port: active.port, username: 'fixture-user', password: 'fixture-secret' });
    active.drop(); await Bun.sleep(10);
    expect(() => connected.send(destination, Uint8Array.of(1))).toThrow('SOCKS');
    await Bun.sleep(10);
    expect(active.outbound).toBe(0); expect(directPackets).toBe(0);
  } finally { transport?.close(); udp?.close(); await proxy?.close(); await active?.close(); peer.close(); }
});

for (const profile of [
  { name: 'NQ', game: 'q1-classic-id1', family: 'q1', connect: '--connect-q1', directory: 'q1/id1' },
  { name: 'QW', game: 'q1-classic-id1', family: 'q1', connect: '--connect-qw', directory: 'q1/qw' },
  { name: 'Q3', game: 'q3-baseq3', family: 'q3', connect: '--connect-q3', directory: 'q3a/baseq3' },
]) test(`${profile.name} RemoteApplication sends native handshake and decodes proxy reply using the same saved owner`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-socks-profile-'));
  const peer = createSocket('udp4'), packets: Uint8Array[] = [];
  let proxy: Awaited<ReturnType<typeof relay>> | null = null;
  const marker = 'controlled-proxy-reply';
  peer.on('message', (bytes, from) => {
    packets.push(bytes.slice());
    const reply = profile.name === 'NQ' ? encodeNetQuakeControl({ kind: 'reject', reason: marker })
      : quakeWorldOutOfBand(profile.name === 'QW' ? `n${marker}` : packets.length === 1 ? 'challengeResponse 42' : `print\n${marker}`);
    peer.send(reply, from.port, from.address);
  });
  let application: RemoteApplication | null = null;
  const prints: string[] = [];
  try {
    await new Promise<void>(resolve => peer.bind(0, '127.0.0.1', resolve));
    proxy = await relay(peer.address().port);
    const directory = join(root, profile.directory, 'settings'); await mkdir(directory, { recursive: true });
    await Bun.write(join(directory, 'client.cfg'), `seta net_socksEnabled 1\nseta net_socksServer 127.0.0.1\nseta net_socksPort ${proxy.port}\nseta net_socksUsername fixture-user\nseta net_socksPassword fixture-secret\n`);
    const selected = parseApplicationCommand(['--game', profile.game, '--movement', profile.family, '--character', profile.family,
      profile.connect, `127.0.0.1:${peer.address().port}`, '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden']);
    if (selected.kind !== 'run') throw new Error('No profile selection');
    application = await RemoteApplication.open({ ...selected.options, userContentRoot: root }, { print: text => { prints.push(text); return undefined; } });
    expect(proxy.authenticated).toBe(1); expect(proxy.outbound).toBe(0);
    for (let index = 0; index < 20 && !prints.some(text => text.includes(marker)); index++) { await application.step(50); await Bun.sleep(2); }
    expect(packets.length).toBeGreaterThan(profile.name === 'Q3' ? 1 : 0); expect(packets[0]?.[0]).toBe(profile.name === 'NQ' ? 128 : 255);
    expect(proxy.inbound).toBeGreaterThan(0);
    if (profile.name === 'Q3') {
      const connect = packets[1]; if (connect === undefined) throw new Error('Missing native Q3 connect');
      expect(decodeConnectionless(connect, 'server').command).toBe('connect');
    }
    expect(prints.some(text => text.includes(marker))).toBe(true);
    expect(application.session.world).toBeNull(); expect(application.clientCommands).not.toBeNull();
    await application.close(); await Bun.sleep(10);
    expect(proxy.connections).toBe(0); expect(prints.some(text => text.includes('fixture-secret'))).toBe(false);
  } finally { await application?.close(); peer.close(); await proxy?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
