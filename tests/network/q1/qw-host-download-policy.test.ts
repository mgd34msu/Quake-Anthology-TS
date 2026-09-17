import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { QwClientNetwork } from '../../../src/app/bootstrap/network/qw-client.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { quakeWorldMapChecksum2 } from '../../../src/network/q1/checksum.ts';

const nativeTest = Bun.env['QUAKE_DOWNLOAD_WORKFLOW_TEST'] === '1' ? test : test.skip;

nativeTest('dedicated QW user mod advertises its directory and enforces every download category over native UDP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qw-host-download-policy-'));
  const mod = join(root, 'q1/DownloadMod');
  let application: Application | null = null, client: QwClientNetwork | null = null;
  const cases = [
    { setting: 'skins', path: 'skins/policy.pcx' },
    { setting: 'models', path: 'progs/policy.mdl' },
    { setting: 'sounds', path: 'sound/policy.wav' },
    { setting: 'maps', path: 'maps/policy.bsp' },
  ];
  const bytes = Uint8Array.from({ length: 1800 }, (_, index) => index % 251);
  try {
    await mkdir(mod, { recursive: true });
    await copyFile(join(homedir(), 'Projects/qfiles/q1/qw/qwprogs.dat'), join(mod, 'qwprogs.dat'));
    for (const entry of cases) {
      await mkdir(dirname(join(mod, entry.path)), { recursive: true });
      await writeFile(join(mod, entry.path), bytes);
    }
    const launch = parseApplicationCommand(['--game', 'q1-quakeworld-DownloadMod', '--map', 'e1m1',
      '--movement', 'q1', '--character', 'q1', '--mode', 'deathmatch', '--dedicated', '--listen', '0',
      '--bind', '127.0.0.1', '--user-content-root', root]);
    if (launch.kind !== 'run') throw new Error('Missing QW mod launch');
    const app = await Application.open(launch.options, { print() {} }); application = app;
    const source = app.simulation.quakecSource(), address = app.networkAddress;
    if (source === null || address === null) throw new Error('Missing real QW source/listener');
    expect(source.prepared.program.api.kind).toBe('q1-quakeworld');
    expect(app.options.mode).toBe('deathmatch');
    const program = await app.content.mounts.resolve('qwprogs.dat');
    expect(program?.provenance.mount.identity.content).toBe(app.content.catalog.require('q1-quakeworld-DownloadMod').id);
    const directories: string[] = [], received: number[] = [];
    let missing = false, complete = false;
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const peer = new QwClientNetwork({ transport, remote: address, qport: 28701,
      userinfo: () => '\\name\\Download policy\\rate\\10000', host: {
        serverData: async data => { directories.push(data.gameDirectory); },
        gameState: async (_data, models) => quakeWorldMapChecksum2(await app.content.mounts.read(models[0] ?? '')),
        receive: async () => undefined,
        command: input => { if (input.command.kind !== 'q1-quakeworld') throw new Error('Wrong protocol'); return input.command; },
        disconnected: reason => { throw new Error(reason); }, print() {},
        downloads: { request: async () => 'available', close() {}, receive: async result => {
          if (result.kind === 'missing') { missing = true; return 'missing'; }
          received.push(...result.bytes);
          if (result.percent < 100) { peer.command('nextdl'); return 'waiting'; }
          complete = true; return 'complete';
        } },
      } }); client = peer;
    const exchange = async (): Promise<void> => {
      await peer.poll(performance.now());
      const player = app.networkClients[0];
      if (peer.phase === 'active' && player !== undefined) peer.submit([{ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence: 1,
        command: { kind: 'q1-quakeworld', milliseconds: 20, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }], performance.now());
      await Bun.sleep(3); await app.step(20); await Bun.sleep(3);
      await peer.poll(performance.now());
    };
    for (let tick = 0; tick < 400 && peer.phase !== 'active'; tick++) await exchange();
    expect(peer.phase).toBe('active'); expect(directories).toEqual(['DownloadMod']);
    const request = async (path: string): Promise<void> => {
      received.length = 0; missing = false; complete = false;
      peer.command(`download ${path}`);
      for (let tick = 0; tick < 200 && !missing && !complete; tick++) await exchange();
      expect(missing || complete).toBe(true);
    };
    for (const entry of cases) {
      source.cvars.set(`allow_download_${entry.setting}`, '0');
      await request(entry.path); expect(missing).toBe(true); expect(received).toHaveLength(0);
      source.cvars.set(`allow_download_${entry.setting}`, '1');
      await request(entry.path); expect(complete).toBe(true); expect(new Uint8Array(received)).toEqual(bytes);
    }
    source.cvars.set('allow_download', '0');
    await request('sound/policy.wav'); expect(missing).toBe(true); expect(received).toHaveLength(0);
    source.cvars.set('allow_download', '1');
    await request('maps/e1m1.bsp'); expect(missing).toBe(true);
    await request('../escape.cfg'); expect(missing).toBe(true);
    expect(app.networkClients).toHaveLength(1);
  } finally { client?.close(); await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
