import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { QwClientNetwork } from '../../../src/app/bootstrap/network/qw-client.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { quakeWorldMapChecksum2 } from '../../../src/network/q1/checksum.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import { SourceChatFlood } from '../../../src/network/services/admin.ts';

test('native QW chat window preserves strict threshold, lock, zero timestamp and paused rules', () => {
    const flood = new SourceChatFlood(4, 4, 10);
    for (let index = 0; index < 4; index++) expect(flood.check(1)).toEqual({ kind: 'allowed' });
    expect(flood.check(5)).toEqual({ kind: 'allowed' });
    for (let index = 0; index < 3; index++) expect(flood.check(5)).toEqual({ kind: 'allowed' });
    expect(flood.check(5)).toEqual({ kind: 'flood', seconds: 10 });
    expect(flood.check(5.5)).toEqual({ kind: 'locked', seconds: 9 });
    expect(flood.check(6, true)).toEqual({ kind: 'allowed' });
    expect(flood.check(15)).toEqual({ kind: 'allowed' });
    const zero = new SourceChatFlood(4, 4, 10);
    for (let index = 0; index < 5; index++) expect(zero.check(0)).toEqual({ kind: 'allowed' });
});

test('actual QW host routes native chat, message filters, pings and source ClientKill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-host-commands-'));
    let application: Application | null = null;
    const clients: QwClientNetwork[] = [], received: QuakeWorldMessage[][] = [[], [], []], disconnected: string[] = [], hostPrints: string[] = [];
    let pending = true;
    try {
        const launch = parseApplicationCommand(['--game', 'q1-quakeworld', '--map', 'dm2', '--movement', 'q1', '--character', 'q1', '--dedicated', '--listen', '0', '--bind', '127.0.0.1', '--user-content-root', root]);
        if (launch.kind !== 'run') throw new Error('Missing host options');
        const app = await Application.open(launch.options, { print: text => { hostPrints.push(text); } }); application = app;
        const address = app.networkAddress; if (address === null) throw new Error('Missing QW listener');
        for (let index = 0; index < 3; index++) {
            const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
            clients.push(new QwClientNetwork({ transport, remote: address, qport: 28100 + index,
                userinfo: () => `\\name\\Peer${index}\\team\\${index === 1 ? 'blue' : 'red'}\\rate\\10000`, host: {
                    serverData: async () => undefined,
                    gameState: async (_data, models) => quakeWorldMapChecksum2(await app.content.mounts.read(models[0] ?? '')),
                    receive: async messages => { received[index]?.push(...messages); },
                    command: input => { if (input.command.kind !== 'q1-quakeworld') throw new Error('Wrong family'); return input.command; },
                    disconnected: reason => { disconnected.push(reason); }, print: () => undefined,
                    downloads: { request: async () => index === 2 && pending ? 'waiting' : 'available', receive: async () => 'complete', close: () => undefined }
                } }));
        }
        const exchange = async (): Promise<void> => {
            for (const client of clients) await client.poll(performance.now());
            for (const [index, client] of clients.entries()) { const player = app.networkClients.find(player => player.sourceEntity === index + 1); if (player !== undefined && client.phase === "active") client.submit([{ actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence: 1, command: { kind: "q1-quakeworld", milliseconds: 20, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }], performance.now()); }
            await Bun.sleep(8); await app.step(20); await Bun.sleep(8);
            for (const client of clients) await client.poll(performance.now());
        };
        const drain = async (): Promise<void> => { for (let tick = 0; tick < 8; tick++) await exchange(); };
        for (let tick = 0; tick < 300 && clients.slice(0, 2).some(client => client.phase !== 'active'); tick++) await exchange();
        expect(clients.map(client => client.phase)).toEqual(['active', 'active', 'loading']);
        const first = clients[0], second = clients[1], third = clients[2];
        if (first === undefined || second === undefined || third === undefined) throw new Error('Missing clients');
        const hasPrint = (index: number, text: string): boolean => received[index]?.some(message => message.kind === 'print' && message.text === text) ?? false;
        third.command('kill'); await drain();
        expect(hasPrint(2, "Can't suicide -- allready dead!\n")).toBe(true); expect(app.simulation.players()).toHaveLength(2);
        first.command('"say" "hello  world"'); await drain();
        expect(hasPrint(0, 'Peer0: hello  world\n')).toBe(true); expect(hasPrint(1, 'Peer0: hello  world\n')).toBe(true); expect(hasPrint(2, 'Peer0: hello  world\n')).toBe(false);
        pending = false; third.command("new");
        for (let tick = 0; tick < 200 && third.phase !== 'active'; tick++) await exchange();
        expect(third.phase).toBe('active');
        first.command('say_team red-only'); await drain();
        expect(hasPrint(0, '(Peer0): red-only\n')).toBe(true); expect(hasPrint(1, '(Peer0): red-only\n')).toBe(false); expect(hasPrint(2, '(Peer0): red-only\n')).toBe(true);
        second.command('setinfo team red'); second.command('msg 4'); await drain();
        first.command('say_team filtered'); await drain();
        expect(hasPrint(2, '(Peer0): filtered\n')).toBe(true); expect(hasPrint(1, '(Peer0): filtered\n')).toBe(false);
        second.command('msg 3'); second.command('msg'); await drain();
        expect(hasPrint(1, 'Msg level set to 3\n')).toBe(false); expect(hasPrint(1, 'Current msg level is 3\n')).toBe(false);
        first.command('say_team joined'); await drain(); expect(hasPrint(1, '(Peer0): joined\n')).toBe(true);
        first.command('say blocked'); await drain(); expect(hasPrint(0, "FloodProt: You can't talk for 10 seconds.\n")).toBe(true); expect(hasPrint(1, 'Peer0: blocked\n')).toBe(false);
        first.command('say still-blocked'); await drain(); expect(received[0]?.some(message => message.kind === 'print' && message.text.startsWith("You can't talk for "))).toBe(true);
        second.command('msg 2'); second.command('msg'); await drain(); expect(hasPrint(1, 'Current msg level is 2\n')).toBe(true);
        first.command('pings'); await drain();
        for (let slot = 0; slot < 3; slot++) {
            expect(received[0]?.some(message => message.kind === 'ping' && message.slot === slot && message.value > 0 && message.value < 9999)).toBe(true);
            expect(received[0]?.some(message => message.kind === 'packet-loss' && message.slot === slot && message.value === 0)).toBe(true);
        }
        expect(received[1]?.some(message => message.kind === 'ping')).toBe(false);
        const source = app.simulation.quakecSource(), player = app.networkClients[0];
        if (source === null || player === undefined) throw new Error('Missing native source player');
        const field = (name: string): number => { const definition = source.prepared.program.fieldsByName.get(name); if (definition === undefined) throw new Error(`Missing field ${name}`); return definition.offset; };
        const words = source.entities.at(player.sourceEntity), frags = words.float(field('frags'));
        expect(words.float(field('health'))).toBeGreaterThan(0);
        third.command('msg 3'); await drain(); const beforeKill = received[0]?.length ?? 0; first.command('kill'); first.command('setinfo name Renamed'); await drain();
        expect(received[0]?.slice(beforeKill).some(message => message.kind === 'print' && message.text === 'Peer0')).toBe(true);
        expect(received[0]?.slice(beforeKill).some(message => message.kind === 'print' && message.text === 'Renamed')).toBe(false);
        expect(words.float(field('health'))).toBe(100); expect(words.float(field('frags'))).toBe(frags - 2);
        expect(received[1]?.some(message => message.kind === 'print' && message.text.includes('suicides'))).toBe(false);
        expect(received[0]?.some(message => message.kind === 'print' && message.text.includes('suicides'))).toBe(true);
        expect(received[2]?.some(message => message.kind === 'print' && message.text.includes('suicides'))).toBe(false);
        words.setFloat(field('health'), 0); first.command('kill'); await drain(); expect(hasPrint(0, "Can't suicide -- allready dead!\n")).toBe(true); expect(words.float(field('frags'))).toBe(frags - 2);
        words.setFloat(field('health'), 100); const beforeRenamedKill = received[0]?.length ?? 0;
        first.command('setinfo name BeforeKill'); first.command('kill'); await drain();
        expect(received[0]?.slice(beforeRenamedKill).some(message => message.kind === 'print' && message.text === 'BeforeKill')).toBe(true);
        expect(words.float(field('frags'))).toBe(frags - 4);
        const beforeKillChat = received[0]?.length ?? 0;
        second.command('kill'); second.command('say after-kill'); await drain();
        const killChat = received[0]?.slice(beforeKillChat).filter(message => message.kind === 'print').map(message => message.text) ?? [];
        expect(killChat.indexOf(' suicides\n')).toBeGreaterThanOrEqual(0);
        expect(killChat.indexOf('Peer1: after-kill\n')).toBeGreaterThan(killChat.indexOf(' suicides\n'));
        const beforeChatKill = received[0]?.length ?? 0;
        second.command('say before-kill'); second.command('kill'); await drain();
        const chatKill = received[0]?.slice(beforeChatKill).filter(message => message.kind === 'print').map(message => message.text) ?? [];
        expect(chatKill.indexOf('Peer1: before-kill\n')).toBeGreaterThanOrEqual(0);
        expect(chatKill.indexOf(' suicides\n')).toBeGreaterThan(chatKill.indexOf('Peer1: before-kill\n'));
        second.command('msg 0'); await drain(); const beforeFilter = received[1]?.length ?? 0;
        second.command('kill'); second.command('msg 4'); await drain();
        expect(received[1]?.slice(beforeFilter).some(message => message.kind === 'print' && message.text === ' suicides\n')).toBe(true);
        const beforeSuppressed = received[1]?.length ?? 0;
        second.command('kill'); second.command('msg 0'); await drain();
        expect(received[1]?.slice(beforeSuppressed).some(message => message.kind === 'print' && message.text === ' suicides\n')).toBe(false);
        third.command('msg 0'); await drain();
        // Native QC fills one recipient's queue; direct chat must retain its sender and later recipients.
        const beforeOverflow = received.map(records => records.length), vm = source.machine;
        const fillReliable = (sourceEntity: number): void => {
            for (let index = 0; index < 5; index++) {
                vm.globals.setInt(4, source.entities.reference(sourceEntity)); vm.globals.setFloat(7, 2);
                vm.globals.setInt(10, vm.strings.allocate('x'.repeat(1400)));
                vm.execute(source.prepared.program.functionNamed('sprint').index, 3);
            }
        };
        fillReliable(player.sourceEntity);
        const chat = 'recipient overflow ' + 'z'.repeat(100);
        second.command(`say "${chat}"`); await drain();
        expect(app.networkClients).toHaveLength(2); expect(second.phase).toBe('active'); expect(third.phase).toBe('active');
        for (const index of [1, 2]) expect(received[index]?.slice(beforeOverflow[index] ?? 0).some(message => message.kind === 'print' && message.text === `Peer1: ${chat}\n`)).toBe(true);
        const secondPlayer = app.networkClients.find(candidate => candidate.sourceEntity === 2);
        if (secondPlayer === undefined) throw new Error('Chat disconnected its healthy sender');
        // Now overflow the sender during source-message preflush; its queued action must be skipped.
        fillReliable(secondPlayer.sourceEntity);
        const broadcast = 'healthy broadcast ' + 'y'.repeat(1380);
        for (const text of [broadcast, 'after sender overflow\n']) {
            vm.globals.setFloat(4, 2); vm.globals.setInt(7, vm.strings.allocate(text));
            vm.execute(source.prepared.program.functionNamed('bprint').index, 2);
        }
        second.command('kill'); await drain();
        expect(app.networkClients).toHaveLength(1);
        expect(disconnected).toContain('Server disconnected');
        expect(hostPrints.some(reason => reason.includes('reliable back buffers overflow'))).toBe(true);
        for (const index of [2]) {
            const messages = received[index]?.slice(beforeOverflow[index] ?? 0) ?? [];
            expect(messages.some(message => message.kind === 'print' && message.text === broadcast)).toBe(true);
            expect(messages.some(message => message.kind === 'print' && message.text === 'after sender overflow\n')).toBe(true);
            expect(messages.some(message => message.kind === 'print' && message.text === ' suicides\n')).toBe(false);
        }
    } finally { for (const client of clients) client.close(); await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 15000);
