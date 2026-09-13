import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { Q2RemotePresentation } from '../../../src/app/bootstrap/network/remote.ts';
import type { EntityStateT } from '../../../src/network/q2/index.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';

const launch = ['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2'];
test('Q2 remote profile is explicit and leaves protocol 34 as the default', () => {
    const classic = parseApplicationCommand([...launch, '--connect-q2', '127.0.0.1']);
    if (classic.kind !== 'run') throw new Error('No launch');
    expect(classic.options.q2Protocol).toBeUndefined();
    const enhanced = parseApplicationCommand([...launch, '--connect-q2', '127.0.0.1', '--q2-protocol', '35']);
    if (enhanced.kind !== 'run') throw new Error('No launch');
    expect(enhanced.options.q2Protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision: 1904 });
    expect(() => parseApplicationCommand([...launch, '--q2-protocol', '35'])).toThrow('--connect-q2');
    expect(() => parseApplicationCommand([...launch, '--connect-q2', '127.0.0.1', '--q2-protocol', '36'])).toThrow('34 or 35');
});

test('normal remote application joins the donor R1Q2 server over localhost UDP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quake-r1q2-remote-'));
    const reservation = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const port = reservation.address.port;
    reservation.close();
    const donorRoot = resolve(process.env['QUAKE_Q2_DONOR_ROOT'] ?? resolve('..', 'quake-2-re-ts'));
    const corpusRoot = process.env['QUAKE_Q2_CORPUS_ROOT'];
    const parsed = parseApplicationCommand([...launch, '--connect-q2', `127.0.0.1:${port}`, '--q2-protocol', '35',
        ...(corpusRoot === undefined ? [] : ['--content-root', corpusRoot]),
        '--user-content-root', join(root, 'user'), '--hidden', '--renderer', 'cpu', '--width', '320', '--height', '240']);
    if (parsed.kind !== 'run') throw new Error('No launch');
    const base = join(root, 'donor');
    await mkdir(join(base, 'baseq2'), { recursive: true });
    await symlink(join(parsed.options.corpusRoot, 'q2', 'baseq2', 'pak0.pak'), join(base, 'baseq2', 'pak0.pak'));
    const donor = Bun.spawn([process.execPath, join(donorRoot, 'src', 'main.ts'),
        '+set', 'basedir', base, '+set', 'dedicated', '1', '+set', 'public', '0',
        '+set', 'ip', '127.0.0.1', '+set', 'port', String(port), '+set', 'coop', '1', '+map', 'base1'],
        { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const stdout = new Response(donor.stdout).text(), stderr = new Response(donor.stderr).text();
    let app: RemoteApplication | null = null;
    try {
        const prints: string[] = [];
        app = await RemoteApplication.open(parsed.options, { print: text => { prints.push(text); } });
        const deadline = performance.now() + 20000;
        while (app.remote.output === null && performance.now() < deadline) {
            await app.step(20);
            await Bun.sleep(10);
            if (donor.exitCode !== null) throw new Error(`Donor exited: ${await stdout}${await stderr}`);
        }
        expect(app.networkPhase).toBe('active');
        const remote = app.remote;
        if (!(remote instanceof Q2RemotePresentation)) throw new Error('No Q2 presentation');
        expect(remote.protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision: 1904 });
        expect(remote.output).not.toBeNull();
        expect(app.localPlayers.length).toBe(1);
        const player = remote.player;
        if (player === null) throw new Error(`No player: ${prints.join('')}`);
        expect(remote.playerView(player.actor).origin.z).toBeGreaterThan(-10000);
        expect(remote.playerUi(player.actor).health).toBeGreaterThan(0);
        const before = remote.output?.snapshot.frame.frame;
        const origin = remote.playerView(player.actor).origin;
        let serverMoved = false;
        const receiveFrame = remote.frame.bind(remote);
        remote.frame = (frame, records, now) => {
            const x = frame.player.pmove.origin[0], y = frame.player.pmove.origin[1];
            if (x !== undefined && y !== undefined && Math.hypot(x / 8 - origin.x, y / 8 - origin.y) > 1) serverMoved = true;
            receiveFrame(frame, records, now);
        };
        app.window.pushEvent({ kind: "window", timestamp: 0, event: 12, data1: 0, data2: 0 });
        app.window.pushEvent({ kind: "key", timestamp: 0, down: true, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
        for (let step = 0; step < 25; step++) { await app.step(20); await Bun.sleep(10); }
        app.window.pushEvent({ kind: "key", timestamp: 0, down: false, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
        expect(remote.output?.snapshot.frame.frame).toBeGreaterThan(before ?? 0);
        const moved = remote.playerView(player.actor).origin;
        expect(Math.hypot(moved.x - origin.x, moved.y - origin.y)).toBeGreaterThan(1);
        expect(serverMoved).toBe(true);
        await expect(remote.gameState({ data: { serverState: 2, servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'invalid', r1q2Version: 1906, r1q2StrafejumpHack: true }, configStrings: new Map<number, string>(), baselines: new Map<number, EntityStateT>() })).rejects.toThrow('Unsupported R1Q2 server revision');
    } finally {
        try { await app?.close(); } finally {
            donor.kill('SIGTERM');
            await donor.exited;
            await Promise.all([stdout, stderr]);
            await rm(root, { recursive: true, force: true });
        }
    }
}, 40000);
