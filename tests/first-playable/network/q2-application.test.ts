import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q2ClientNetwork, Q2RemotePresentation } from '../../../src/app/bootstrap/network/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
test('native Q2 UDP signon admits and moves the actual Application player', async () => {
    const parsed = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'coop', '--listen-q2', '0', '--bind', '127.0.0.1']);
    if (parsed.kind !== 'run')
        throw new Error('No application launch');
    const prints: string[] = [], server = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
    let content = await loadApplicationContent(parsed.options);
    const identity = createIdentityOwner('Q2 UDP remote application'), session = new EngineSession(identity, { kind: 'headless' });
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const address = server.networkAddress;
    if (address === null)
        throw new Error('Server did not bind UDP');
    let client: Q2ClientNetwork<typeof address> | null = null;
    const remote = new Q2RemotePresentation({ identity, session, content, protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\Network Player\\skin\\male/grunt', print: text => { prints.push(text); }, sendCommand: text => { if (client === null)
            throw new Error('Client transport unavailable'); client.command(text); }, loadContent: async (state) => {
            const map = state.configStrings.get(33);
            if (map === undefined)
                throw new Error('Server has no world model');
            if (map !== content.recipe.map.geometry.requestedPath) {
                const previous = content;
                content = await loadApplicationContent({ ...parsed.options, map });
                await previous.close();
            }
            return content;
        } });
    client = new Q2ClientNetwork({ transport, remote: address, host: remote, qport: 4218 });
    let now = 0;
    const exchange = async (milliseconds = 100): Promise<void> => {
        now += milliseconds;
        await client?.poll(now);
        await Bun.sleep(1);
        await server.step(milliseconds);
        await Bun.sleep(1);
        await client?.poll(now);
    };
    try {
        for (let count = 0; count < 80 && remote.output === null; count++)
            await exchange();
        expect(client.phase).toBe('active');
        expect(remote.output).not.toBeNull();
        expect(session.world).toBeNull();
        const player = remote.player, admitted = server.networkClients[0];
        if (player === null || admitted === undefined)
            throw new Error(`No actual network player: ${prints.join('')}`);
        expect(server.simulation.players().some(actor => actor.equals(admitted.actor))).toBe(true);
        expect(admitted.actor.equals(player.actor)).toBe(false);
        const before = server.simulation.bodies.read(admitted.actor)?.origin;
        if (before === undefined)
            throw new Error('Admitted source actor has no body');
        for (let sequence = 0; sequence < 6; sequence++) {
            client.submit([{ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command: { kind: 'q2-classic', milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 128 } }], now);
            await exchange();
        }
        const after = server.simulation.bodies.read(admitted.actor)?.origin;
        if (after === undefined)
            throw new Error('Source actor lost its body');
        expect(after).not.toEqual(before);
        expect(remote.playerView(player.actor).origin).toEqual(after);
        expect(remote.playerUi(player.actor).health).toBe(server.simulation.playerUi(admitted.actor).health);
        client.command('say actual-source-chat');
        await exchange(10);
        await exchange(10);
        expect(prints.some(text => text.includes('Network Player: actual-source-chat'))).toBe(true);
        server.queueCommand('map', ['base2'], null);
        for (let count = 0; count < 80 && (content.recipe.map.geometry.requestedPath !== 'maps/base2.bsp' || remote.output === null || remote.player?.actor.equals(player.actor)); count++)
            await exchange();
        expect(content.recipe.map.geometry.requestedPath).toBe('maps/base2.bsp');
        expect(remote.output).not.toBeNull();
        expect(server.networkClients[0]?.client.equals(admitted.client)).toBe(true);
        expect(remote.player?.client.equals(player.client)).toBe(true);
        expect(remote.player?.actor.equals(player.actor)).toBe(false);
        client.close();
        await Bun.sleep(1);
        await server.step(100);
        expect(server.networkClients).toHaveLength(0);
        expect(server.simulation.players()).toHaveLength(0);
    }
    finally {
        client.close();
        await server.close();
        session.close();
        await content.close();
    }
}, 30000);
