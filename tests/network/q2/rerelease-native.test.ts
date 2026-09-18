import { expect, test } from 'bun:test';
import { createRereleaseNativeMessageTranscoder } from '../../../src/app/bootstrap/simulation/network-q2-rerelease-native.ts';
import { Q2WireCodec, Q2ServerMessageReader, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';

test('native FLOAT records are decoded and encoded for KEX without losing positions or command boundaries', () => {
  const source = new Q2WireCodec({ kind: 'q2-rerelease', version: 1038 });
  const convert = createRereleaseNativeMessageTranscoder({ kind: 'q2-kex', version: 2023 });
  const target = new Q2ServerMessageReader({ kind: 'q2-kex', version: 2023 }, { maxConfigStrings: 12448, inventorySlots: 256 });
  const sound = encodeQ2ServerEvent(source, { kind: 'sound', sound: { flags: 0, index: 300, entity: 2000, channel: 1,
    position: { x: 1.9, y: -50000, z: 3.25 }, volume: 1, attenuation: 1, delaySeconds: 0 } });
  const command = encodeQ2ServerEvent(source, { kind: 'command-text', text: 'echo "native record"\n' });
  const batch = new Uint8Array(sound.length + command.length); batch.set(sound); batch.set(command, sound.length);
  const records = target.read(convert(batch));
  expect(records.length).toBe(2);
  const event = records[0]?.event;
  if (event?.kind !== 'sound') throw new Error('Sound record missing');
  expect(event.sound.position).toEqual({ x: Math.fround(1.9), y: -50000, z: 3.25 });
  expect(event.sound.index).toBe(300); expect(event.sound.entity).toBe(2000);
  expect(records[1]?.event).toEqual({ kind: 'command-text', text: 'echo "native record"\n' });
  expect(() => createRereleaseNativeMessageTranscoder({ kind: 'q2-classic', version: 34 })).toThrow('protocol1038 or KEX2023');
});
