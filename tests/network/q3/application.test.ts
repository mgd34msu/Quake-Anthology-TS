import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { Ipv4Address } from '../../../src/network/common/endpoint.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { Q3ClientAdmission } from '../../../src/network/q3/admission.ts';
import { encodeConnectionlessText } from '../../../src/network/q3/connectionless.ts';
import { Q3ClientConnection } from '../../../src/network/q3/client.ts';
import { q3ChannelDelivery } from '../../../src/network/q3/transport.ts';
import type { Snapshot } from '../../../src/network/q3/server-message.ts';

test('protocol68 UDP admission moves the shared Application actor and publishes source snapshots', async () => {
  const parsed = parseApplicationCommand(['--game', 'q3-baseq3', '--map', 'q3dm1', '--movement', 'q3', '--character', 'q3', '--dedicated', '--mode', 'deathmatch', '--listen', '0', '--bind', '127.0.0.1']);
  if (parsed.kind !== 'run') throw new Error('Missing application options');
  const prints: string[] = [], app = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
  const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), address = app.networkAddress;
  if (address === null || address.kind !== 'ipv4') throw new Error('No native IPv4 listener');
  const statuses: string[] = [];
  const owner = createIdentityOwner('Q3 UDP application client'), admission = new Q3ClientAdmission(4172, text => prints.push(text)), snapshots: Snapshot[] = [];
  let client: Q3ClientConnection | null = null, now = 0, gameStates = 0;
  const connectedClient = (): Q3ClientConnection => { if (client === null) throw new Error('Client did not connect'); return client; };
  admission.begin(address);
  const read = async (): Promise<void> => {
    for (let event = transport.poll(); event !== null; event = transport.poll()) {
      if (event.kind !== 'packet' || event.from.kind !== 'ipv4') continue;
      const result = admission.receive(event.from, event.payload, now);
      if (result.kind === 'admitted') client = new Q3ClientConnection({ client: owner.client(0, 0), seat: null }, 'baseq3', { kind: 'network', challenge: result.challenge, qport: result.qport }, {
        assertCurrent() {}, print: text => { prints.push(text); }, clearActive() {}, async systemInfo() {}, async gamestate() { gameStates++; }, snapshot: value => { snapshots.push(value); }, downloadSize: size => size, async download() {}, mapRestart() {}, levelShot() {}, localServerRunning: () => false,
      });
      else if (result.kind === 'connectionless' && result.packet.command === 'statusResponse') statuses.push(new TextDecoder().decode(result.packet.payload));
      else if (result.kind === 'sequenced' && client !== null) await client.receiveDatagram(result.bytes, now);
    }
  };
  const exchange = async (): Promise<void> => {
    now += 50;
    const request = admission.resend(now, '\\name\\UDP Ranger\\model\\sarge/default\\handicap\\100');
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
    await app.changeLevel('q3dm1');
    for (let count = 0; count < 30 && gameStates < 2; count++) await exchange();
    expect(gameStates).toBe(2);
    for (let count = 0; count < 5; count++) await exchange();
    expect(app.networkClients[0]?.client.equals(player.client)).toBe(true);
    expect(snapshots.at(-1)?.playerState.clientNum).toBe(connected.clientNumber);
    connected.reliable.add('disconnect'); await exchange();
    expect(app.networkClients).toHaveLength(0);
    expect(app.simulation.players().some(actor => actor.equals(player.actor))).toBe(false);
  } finally { transport.close(); await app.close(); }
}, 60000);
