import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { QwClientNetwork } from '../../../src/app/bootstrap/network/qw-client.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { quakeWorldMapChecksum2 } from '../../../src/network/q1/checksum.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import type { ActorCommand } from '../../../src/contracts/session.ts';
import type { QwUserCommand } from '../../../src/contracts/protocol.ts';
import type { DamageOutcome } from '../../../src/contracts/gameplay.ts';
import { userProductDirectory } from '../../../src/content/user-data.ts';

test('native QuakeWorld Application hosts real source players, movement, weapons and mounted downloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-native-host-'));
    let application: Application | null = null;
    const clients: QwClientNetwork[] = [], prints: string[] = [], records: QuakeWorldMessage[][] = [[], []], damage: DamageOutcome[] = [];
    const downloads: number[] = [];
    let holdPending = true;
    try {
        const skins = join(userProductDirectory(root, 'q1/qw'), 'skins'); await mkdir(skins, { recursive: true });
        const skin = Uint8Array.from({ length: 1800 }, (_, index) => index % 253); await writeFile(join(skins, 'host-fixture.pcx'), skin);
        const launch = parseApplicationCommand(['--game', 'q1-quakeworld', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--dedicated', '--listen', '0', '--bind', '127.0.0.1', '--user-content-root', root]);
        if (launch.kind !== 'run') throw new Error('Missing native host options');
        const app = await Application.open(launch.options, { print: text => { prints.push(text); } }); application = app;
        const address = app.networkAddress, source = app.simulation.quakecSource(); if (address === null || source === null) throw new Error('Missing native QW host');
        expect(app.options.mode).toBe('deathmatch'); expect(app.simulation.options.maxClients).toBe(8); expect(source.reservedClientSlots).toBe(32);
        expect(source.prepared.program.api.kind).toBe('q1-quakeworld'); expect(app.simulation.q1Source()).toBeNull();
        for (let index = 0; index < 3; index++) {
            const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
            const client = new QwClientNetwork({ transport, remote: address, qport: 28000 + index, userinfo: () => `\\name\\Native ${index}\\rate\\10000`, host: {
                serverData: async data => { expect(data.protocol).toEqual({ kind: 'q1-quakeworld', version: 28 }); },
                gameState: async (_data, models) => quakeWorldMapChecksum2(await app.content.mounts.read(models[0] ?? '')),
                receive: async messages => { records[index]?.push(...messages); },
                command: input => { if (input.command.kind !== 'q1-quakeworld') throw new Error('Wrong command family'); return input.command; },
                disconnected: reason => { prints.push(reason); }, print: text => { prints.push(text); },
                downloads: { request: async () => index === 2 && holdPending ? 'waiting' : 'available', close: () => undefined, receive: async result => {
                    if (result.kind === 'missing') return 'missing'; downloads.push(...result.bytes);
                    if (result.percent < 100) { client.command('nextdl'); return 'waiting'; } return 'complete';
                } }
            } }); clients.push(client);
        }
        const exchange = async (): Promise<void> => {
            for (const client of clients) await client.poll(performance.now());
            await Bun.sleep(5); const output = await app.step(50);
            for (const event of output.events) if (event.payload.kind === 'damage') damage.push(event.payload.outcome);
            await Bun.sleep(5); for (const client of clients) await client.poll(performance.now());
        };
        for (let tick = 0; tick < 350 && clients.slice(0, 2).some(client => client.phase !== 'active'); tick++) await exchange();
        expect(clients.map(client => client.phase)).toEqual(['active', 'active', 'loading']); expect(app.simulation.players()).toHaveLength(2);
        expect(app.networkClients).toHaveLength(3);
        const first = app.networkClients[0], second = app.networkClients[1], firstClient = clients[0];
        if (first === undefined || second === undefined || firstClient === undefined) throw new Error('Native peers did not begin');
        const input = (command: QwUserCommand): ActorCommand => ({ actor: first.actor, source: { kind: 'remote-client', client: first.client }, sequence: 1, command });
        const command: QwUserCommand = { kind: 'q1-quakeworld', milliseconds: 40, angles: { x: 0, y: 90, z: 0 }, forwardMove: 320, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
        const origin = app.simulation.bodies.read(first.actor)?.origin; firstClient.submit([input(command)], performance.now()); await exchange();
        expect(app.simulation.bodies.read(first.actor)?.origin).not.toEqual(origin);
        const field = (name: string): number => { const value = source.prepared.program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing source field ${name}`); return value.offset; };
        const shooter = source.entities.at(first.sourceEntity), victim = source.entities.at(second.sourceEntity);
        const shooterActor = app.simulation.actors.resolveOwned(first.actor), victimActor = app.simulation.actors.resolveOwned(second.actor);
        if (shooterActor === null || victimActor === null) throw new Error('Missing shared source actors');
        // Same known source fixture positions as the independent source execution witness; input remains native UDP.
        shooter.setVector(field('origin'), { x: 480, y: -352, z: 88 }); shooter.setVector(field('velocity'), { x: 0, y: 0, z: 0 });
        victim.setVector(field('origin'), { x: 480, y: -240, z: 88 }); victim.setVector(field('velocity'), { x: 0, y: 0, z: 0 });
        victim.setFloat(field('health'), 250); victim.setFloat(field('armorvalue'), 0); victim.setFloat(field('armortype'), 0);
        app.simulation.bodies.link(shooterActor); app.simulation.bodies.link(victimActor);
        const shells = shooter.float(field('ammo_shells'));
        firstClient.submit([input({ ...command, forwardMove: 0, buttons: 1 })], performance.now()); await exchange();
        expect(shooter.float(field('ammo_shells'))).toBe(shells - 1); expect(victim.float(field('health'))).toBeLessThan(250);
        expect(damage.some(outcome => outcome.kind === 'committed' && outcome.decision.request.attack.weapon === 'q1:weapon/shotgun')).toBe(true);
        for (let tick = 0; tick < 15; tick++) await exchange();
        app.simulation.inventory.give(shooterActor, 'q1:weapon/rocketlauncher', 1); app.simulation.inventory.give(shooterActor, 'q1:ammo/rockets', 10);
        firstClient.submit([input({ ...command, forwardMove: 0, impulse: 7 })], performance.now()); await exchange(); expect(shooter.float(field('weapon'))).toBe(32);
        firstClient.submit([input({ ...command, forwardMove: 0, buttons: 1 })], performance.now()); await exchange();
        expect(shooter.float(field('ammo_rockets'))).toBe(9);
        const rocket = app.simulation.actors.observations().find(actor => source.classname(actor.id) === 'rocket'); expect(rocket).toBeDefined();
        for (let tick = 0; tick < 20; tick++) await exchange();
        expect(damage.some(outcome => outcome.kind === 'committed' && outcome.decision.request.attack.weapon === 'q1:weapon/rocketlauncher')).toBe(true);
        if (rocket !== undefined) expect(source.sourceSlot(rocket.id)).toBeNull();
        expect(records[0]?.some(record => record.kind === 'stat' && record.index === 8 && record.value === 9)).toBe(true);
        firstClient.command('download skins/host-fixture.pcx');
        for (let tick = 0; tick < 200 && downloads.length < skin.length; tick++) await exchange(); expect(new Uint8Array(downloads)).toEqual(skin);
        firstClient.command('download maps/e1m1.bsp');
        for (let tick = 0; tick < 100 && !records[0]?.some(record => record.kind === 'download' && record.result.kind === 'missing'); tick++) await exchange();
        expect(records[0]?.some(record => record.kind === 'download' && record.result.kind === 'missing')).toBe(true);
        const oldPlayers = app.networkClients, firstRecordCount = records[0]?.length ?? 0;
        holdPending = false; await app.changeLevel('dm2');
        expect(app.networkAddress).toEqual(address); expect(app.simulation.players()).toHaveLength(0);
        expect(app.networkClients.map(player => player.client)).toEqual(oldPlayers.map(player => player.client));
        expect(app.networkClients.every(player => oldPlayers.every(old => !old.actor.equals(player.actor)))).toBe(true);
        for (let tick = 0; tick < 350 && (app.simulation.players().length !== 3 || clients.some(client => client.phase !== "active")); tick++) await exchange();
        expect(app.simulation.players()).toHaveLength(3); expect(clients.map(client => client.phase)).toEqual(['active', 'active', 'active']);
        const nextFirst = app.networkClients[0]; if (nextFirst === undefined) throw new Error('Travel lost the client');
        expect(app.simulation.inventory.count(nextFirst.actor, 'q1:weapon/rocketlauncher')).toBe(1);
        expect(app.simulation.inventory.count(nextFirst.actor, 'q1:ammo/rockets')).toBe(9);
        expect(records[0]?.slice(firstRecordCount).some(record => record.kind === 'server-data' && record.serverCount === 2)).toBe(true);
        expect(records[0]?.slice(firstRecordCount).some(record => record.kind === 'userinfo' && record.slot === 0 && record.value.includes('Native 0'))).toBe(true);
        for (const client of clients) client.close(); await Bun.sleep(5); await app.step(50); expect(app.networkClients).toHaveLength(0);
        expect(prints.filter(text => /overflow|Missing QW|Stale QW|exceeds|Invalid|Error/.test(text))).toEqual([]);
    } finally { for (const client of clients) client.close(); await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 15000);
