import { expect, test } from 'bun:test';
import type { Q2ProtocolIdentity } from '../../src/contracts/protocol.ts';
import { Q2ClientReceiver, type Q2ClientReceiverHost } from '../../src/app/bootstrap/network/q2-client-receiver.ts';
import { Q2WireCodec, Q2ServerMessageReader, EntityStateT, PlayerStateT, encodeQ2Frame, encodeQ2ServerEvent } from '../../src/network/q2/index.ts';
import type { Q2WireFrame } from '../../src/network/q2/index.ts';

const protocols: readonly Q2ProtocolIdentity[] = [{ kind: 'q2-classic', version: 34 }, { kind: 'q2-rerelease', version: 1038 }];
for (const protocol of protocols) test(`recording ${protocol.kind} seeds a full current snapshot from a live delta`, async () => {
  const wire = new Q2WireCodec(protocol), received: Q2WireFrame[] = [];
  const host: Q2ClientReceiverHost = { protocol, messageOptions: { maxConfigStrings: 65535, inventorySlots: 256 },
    gameState: async () => {}, frame: frame => { received.push(frame); }, records: () => {}, disconnected: () => {}, print: () => {} };
  const source = new Q2ClientReceiver(host, { kind: 'network', command: () => {}, resetCommands: () => {}, closed: () => false });
  expect(() => source.seed()).toThrow('active');
  await source.receive(encodeQ2ServerEvent(wire, { kind: 'server-data', data: { servercount: 42, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'base1', serverState: 2, serverFps: 40 } }), 0);
  await source.receive(encodeQ2ServerEvent(wire, { kind: 'config-string', index: 33, value: 'maps/base1.bsp' }), 0);
  const baseline = new EntityStateT(); baseline.number = 7; baseline.modelindex = 2;
  await source.receive(encodeQ2ServerEvent(wire, { kind: 'baseline', entity: baseline }), 0);
  await source.receive(encodeQ2ServerEvent(wire, { kind: 'command-text', text: 'precache 42\n' }), 0);
  const entity = new EntityStateT(); entity.number = 7; entity.modelindex = 2; entity.origin[0] = 24;
  const first: Q2WireFrame = { serverFrame: 100, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array([3]), player: new PlayerStateT(), entities: [entity] };
  await source.receive(encodeQ2Frame(wire, first, null, new Map([[7, baseline]]), 1), 1);
  const next: Q2WireFrame = { ...first, serverFrame: 101, deltaFrame: 100 };
  await source.receive(encodeQ2Frame(wire, next, first, new Map([[7, baseline]]), 1), 2);
  const seed = source.seed(); expect(seed.identity).toEqual({ kind: 'q2', protocol });
  source.requestFullFrame(); expect(source.acknowledgedFrame).toBe(-1);
  const playback = new Q2ClientReceiver(host, { kind: 'demo' });
  received.length = 0;
  for (const packet of seed.packets) { if (packet.kind !== 'q2') throw new Error('Wrong packet family'); await playback.receive(packet.message, 0); }
  expect(playback.phase).toBe('active'); expect(received).toHaveLength(1);
  expect(received[0]?.serverFrame).toBe(101); expect(received[0]?.deltaFrame).toBe(-1); expect(received[0]?.entities[0]?.origin[0]).toBe(24);
  expect(playback.reader.configStrings.get(33)).toBe('maps/base1.bsp');
  expect(source.reader.configStrings.get(33)).toBe('maps/base1.bsp');
  const direct = new Q2ClientReceiver(host, { kind: 'demo' }), parser = new Q2ServerMessageReader(protocol, host.messageOptions);
  for (const packet of seed.packets) { if (packet.kind !== 'q2') throw new Error('Wrong packet family'); await direct.receiveRecords(parser.read(packet.message), 0); }
  expect(direct.seed()).toEqual(playback.seed());
  expect(direct.reader.history().latest()?.serverFrame).toBe(101);
  direct.close();
  source.close(); playback.close();
});
