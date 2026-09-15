import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { ApplicationInput } from '../../../src/app/bootstrap/input.ts';
import { ApplicationSeatUi } from '../../../src/app/bootstrap/ui.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q3RemotePresentation } from '../../../src/app/bootstrap/network/remote-q3.ts';
import { encodePng } from '../../../src/formats/images/png.ts';
import { fitUi } from '../../../src/ui/common/layout.ts';
import { StartupServerBrowser } from '../../../src/app/bootstrap/server-browser.ts';
import { ConfigStore } from '../../../src/settings/config.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { decodeConnectionless } from '../../../src/network/q3/connectionless.ts';
import { encodeQ3Status } from '../../../src/network/q3/discovery.ts';

for (const ownership of ['borrowed', 'owned']) test(`remote browser ${ownership} lifetime retains actual UDP polling`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'quake-remote-browser-'));
  const endpoint = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
  let borrowed: StartupServerBrowser | null = null, client: RemoteApplication | null = null;
  try {
    const selection = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2',
      '--connect-q2', `127.0.0.1:${endpoint.address.port}`, '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden', '--user-content-root', join(root, 'content')]);
    if (selection.kind !== 'run') throw new Error('Missing browser lifecycle launch');
    const host = { saveDirectory: join(root, 'saves'), print: (_text: string): undefined => undefined };
    if (ownership === 'borrowed') borrowed = await StartupServerBrowser.open(new ConfigStore(join(root, 'settings')));
    client = await RemoteApplication.open(selection.options, borrowed === null ? host : { ...host, serverBrowser: borrowed });
    const browser = client.serverBrowser, closed = spyOn(browser, 'close');
    try {
      if (borrowed !== null) expect(browser).toBe(borrowed);
      browser.choose('q3'); browser.address = `127.0.0.1:${endpoint.address.port}`;
      await browser.query();
      let replied = false;
      for (let attempt = 0; attempt < 30 && browser.rows()[0]?.status === null; attempt++) {
        await Bun.sleep(1);
        for (let event = endpoint.poll(); event !== null; event = endpoint.poll()) {
          if (event.kind !== 'packet') continue;
          const packet = decodeConnectionless(event.payload, 'server');
          if (packet.command !== 'getstatus') continue;
          const challenge = packet.arguments[0]; if (challenge === undefined) throw new Error('Missing browser challenge');
          endpoint.send(event.from, encodeQ3Status(`\\challenge\\${challenge}\\sv_hostname\\Borrowed browser\\mapname\\q3dm1\\sv_maxclients\\8`, []));
          replied = true;
        }
        await Bun.sleep(1); await client.step(16);
      }
      expect(replied).toBe(true); expect(browser.rows()[0]?.status?.name).toBe('Borrowed browser');
      await client.close(); client = null;
      expect(closed).toHaveBeenCalledTimes(ownership === 'owned' ? 1 : 0);
      if (borrowed !== null) { await borrowed.query(); borrowed.poll(); expect(borrowed.rows()[0]?.status?.name).toBe('Borrowed browser'); }
    } finally { closed.mockRestore(); }
  } finally {
    try { await client?.close(); } finally { try { await borrowed?.close(); } finally { endpoint.close(); await rm(root, { recursive: true, force: true }); } }
  }
}, 120000);

test('Q3 remote bindings wait for decoded player state and capture input after admission', async () => {
  const users = await mkdtemp(join(tmpdir(), 'quake-q3-binding-lifecycle-'));
  const attached: ApplicationSeatUi[] = [];
  const attachedBeforeSnapshot: boolean[] = [];
  let receivedSnapshot = false, prematureReads = 0, playerReads = 0;
  const snapshot = Q3RemotePresentation.prototype.snapshot, playerUi = Q3RemotePresentation.prototype.playerUi;
  const snapshotObserver = spyOn(Q3RemotePresentation.prototype, 'snapshot').mockImplementation(function (this: Q3RemotePresentation, ...args) {
    receivedSnapshot = true; return snapshot.apply(this, args);
  });
  const playerObserver = spyOn(Q3RemotePresentation.prototype, 'playerUi').mockImplementation(function (this: Q3RemotePresentation, actor) {
    playerReads++; if (!receivedSnapshot) prematureReads++;
    return playerUi.call(this, actor);
  });
  const attach = ApplicationInput.prototype.attachUi;
  const attachObserver = spyOn(ApplicationInput.prototype, 'attachUi').mockImplementation(function (this: ApplicationInput, seat, ui) {
    if (ui instanceof ApplicationSeatUi) { attached.push(ui); attachedBeforeSnapshot.push(!receivedSnapshot); }
    return attach.call(this, seat, ui);
  });
  let server: Application | null = null, client: RemoteApplication | null = null;
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  try {
    const common = ['--game', 'q3-baseq3', '--movement', 'q3', '--character', 'q3', '--mode', 'deathmatch', '--user-content-root', users];
    const serverLaunch = parseApplicationCommand([...common, '--map', 'q3dm1', '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
    if (serverLaunch.kind !== 'run') throw new Error('No server launch');
    server = await Application.open(serverLaunch.options, host);
    server.simulation.q3Source()?.host.cvars.set('sv_pure', '0', true);
    const address = server.networkAddress; if (address === null) throw new Error('No owned loopback endpoint');
    const launch = parseApplicationCommand([...common, '--connect-q3', `127.0.0.1:${address.port}`, '--renderer', 'cpu', '--width', '640', '--height', '480', '--hidden']);
    if (launch.kind !== 'run') throw new Error('No remote launch');
    client = await RemoteApplication.open(launch.options, host);
    expect(() => client?.content).toThrow('Remote server has not supplied a world');
    const remote = client, authority = server;
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await authority.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let index = 0; index < 100 && remote.networkPhase !== 'active'; index++) await exchange();
    expect(remote.content.recipe.map.geometry.requestedPath).toBe('maps/q3dm1.bsp');
    expect(remote.networkPhase).toBe('active'); expect(receivedSnapshot).toBe(true); expect(prematureReads).toBe(0);
    expect(attachedBeforeSnapshot).toEqual([true]);
    const ui = attached[0], local = remote.localPlayers[0];
    if (ui === undefined || local === undefined) throw new Error(`No admitted UI: ${prints.join('')}`);
    let transform = fitUi({ x: 0, y: 0, width: 640, height: 480 });
    const draw = ui.controller.draw.bind(ui.controller);
    const drawObserver = spyOn(ui.controller, 'draw').mockImplementation(context => { transform = fitUi(context.binding.safeArea); return draw(context); });
    try {
      const key = (code: number): void => { for (const down of [true, false]) remote.input({ seat: local.seat.id, kind: 'key', code, down, repeat: false, timeMilliseconds: performance.now() }); };
      const click = (x: number, y: number): void => {
        remote.input({ seat: local.seat.id, kind: 'mouse-motion', position: { x: transform.x + x * transform.scale, y: transform.y + y * transform.scale }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
        for (const down of [true, false]) remote.input({ seat: local.seat.id, kind: 'mouse-button', button: 1, down, timeMilliseconds: performance.now() });
      };
      key(27); await exchange();
      expect(ui.controller.activeMenu).toBe('menu:application:game');
      click(200, 218); await exchange();
      expect(ui.controller.activeMenu).toBe('menu:settings:root');
      click(200, 190); await exchange();
      expect(ui.controller.activeMenu).toBe('menu:settings:input:0');
      click(200, 106); await exchange();
      expect(ui.controller.activeMenu).toBe('menu:bindings:0');
      expect(playerReads).toBeGreaterThan(0);
      await Bun.write('/tmp/quake-q3-binding-lifecycle.png', encodePng(640, 480, remote.readPixels()));
      click(400, 148);
      expect(ui.controller.bindingCapture).toBe(true);
      key(107);
      expect(ui.controller.bindingCapture).toBe(false);
      expect(ui.local.input.binding({ kind: 'key', code: 107 })).toEqual({ kind: 'command', text: '+forward' });
      expect(prematureReads).toBe(0); expect(remote.networkPhase).toBe('active');
    } finally { drawObserver.mockRestore(); }
  } catch (error) {
    process.stderr.write(`Binding lifecycle operation failed: ${String(error)}\n`);
    throw error;
  } finally {
    try { try { await client?.close(); } finally { await server?.close(); } }
    finally { attachObserver.mockRestore(); snapshotObserver.mockRestore(); playerObserver.mockRestore(); await rm(users, { recursive: true, force: true }); }
  }
}, 120000);
