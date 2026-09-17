import { expect, test } from 'bun:test';
import { LocalDemoRecording } from '../../src/app/bootstrap/demo-local-recording.ts';
import type { Q3ApplicationServerHost } from '../../src/app/bootstrap/network/q3-types.ts';
import type { SimulationOutput } from '../../src/contracts/session.ts';
import type { DemoRecordingPacket } from '../../src/app/bootstrap/demo-recording.ts';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { DemoReader } from '../../src/network/q3/demo.ts';
import { Q3ClientConnection } from '../../src/network/q3/client.ts';
import { PlayerStateRecord } from '../../src/network/q3/state/player.ts';
import type { Snapshot } from '../../src/network/q3/server-message.ts';

function unused(): never { throw new Error('Recording must not admit, prepare or send network traffic'); }

test('local Q3 recording uses the actual source clock and carried slot across map reseeding', async () => {
  const identity = createIdentityOwner('local recording'), player = { client: identity.client(2, 0), actor: identity.actor(2, 0), sourceEntity: 2 };
  let world = {}, sourceTime = 14500, map = 'mpteam1';
  const state = new PlayerStateRecord('missionpack', 0, 0, 0); state.clientNum = 2;
  const host: Q3ApplicationServerHost = { product: 'missionpack', maxClients: 6, prepare: unused, pure: unused, downloadsEnabled: unused, openDownload: unused, rate: unused,
    supportsSourceWire: () => ({ kind: 'supported' }), time: () => sourceTime, occupiedSlots: () => [2], admit: unused, carriedPlayer: () => player, disconnect: unused,
    gameState: () => ({ kind: 'gamestate', commandSequence: 0, entries: [{ kind: 'configstring', index: 0, value: `\\mapname\\${map}` }], clientNumber: 2, checksumFeed: 42 }),
    snapshot: () => ({ player: state, areaMask: new Uint8Array(32), entities: [] }), input: unused, command: unused, userinfo: unused, status: unused, print: unused };
  const output: SimulationOutput = { snapshot: { session: identity.session, frame: { frame: 1, time: { kind: 'milliseconds', value: 1 }, elapsed: { kind: 'milliseconds', value: 1 }, phase: 'frame-exit' },
    actors: [], bodies: [], inventories: [], configurations: [], scene: { session: identity.session, time: { kind: 'milliseconds', value: 1 }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } }, events: [] };
  const recording = new LocalDemoRecording(() => ({ kind: 'q3', world, host, player, serverId: 12, snapshotServerBit: 4 }));
  const packets: DemoRecordingPacket[] = [...recording.seed().packets];
  const detach = recording.attach({ append: async packet => { packets.push(packet); } });
  await recording.publish(output, []);
  sourceTime = 15000; world = {}; map = 'mpteam2';
  await recording.publish(output, []);
  detach(); detach(); await recording.publish(output, []); expect(packets).toHaveLength(4);
  const snapshots: Snapshot[] = [], maps: string[] = [];
  const client = new Q3ClientConnection({ client: player.client, seat: identity.seat(2) }, 'missionpack', { kind: 'demo', reader: new DemoReader(new Uint8Array()) },
    { assertCurrent() {}, print() {}, clearActive() {}, systemInfo: async () => {}, gamestate: async gamestate => { const entry = gamestate.entries[0]; if (entry?.kind === 'configstring') maps.push(entry.value); },
      snapshot: snapshot => { snapshots.push(snapshot); }, downloadSize: size => size, download: async () => {}, mapRestart() {}, levelShot() {}, localServerRunning: () => false });
  for (const packet of packets) { if (packet.kind !== 'q3') throw new Error('Wrong source wire'); await client.receiveMessage(packet.sequence, packet.message, 0); }
  expect(maps).toEqual(['\\mapname\\mpteam1', '\\mapname\\mpteam2']);
  expect(snapshots.map(snapshot => snapshot.serverTime)).toEqual([14500, 15000]);
  expect(snapshots.map(snapshot => snapshot.playerState.clientNum)).toEqual([2, 2]);
  expect(snapshots.map(snapshot => snapshot.flags)).toEqual([4, 4]);
});
