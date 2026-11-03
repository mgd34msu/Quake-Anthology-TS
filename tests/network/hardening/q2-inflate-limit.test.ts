import { expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { Q2ServerMessageReader } from '../../../src/network/q2/index.ts';

function block(data: Uint8Array, percent: number): Uint8Array {
  const message = new Uint8Array(4 + data.length);
  message[0] = 35; message[1] = data.length & 255; message[2] = data.length >> 8; message[3] = percent;
  message.set(data, 4);
  return message;
}

test('a Q2 compressed download stream cannot inflate past its output limit', () => {
  const reader = new Q2ServerMessageReader({ kind: 'q2-rerelease', version: 1038 }, { maxConfigStrings: 2048, inventorySlots: 256 });
  const bomb = deflateRawSync(new Uint8Array(128 * 1024 * 1024), { level: 9 });
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bomb.length; offset += 30000) chunks.push(bomb.subarray(offset, offset + 30000));
  expect(chunks.length).toBeGreaterThan(2);
  const last = chunks.length - 1;
  expect(() => chunks.forEach((chunk, index) => { reader.read(block(chunk, index === last ? 100 : 50)); })).toThrow(/larger|limit|exceeds|Cannot create/);
});
