import { expect, test } from 'bun:test';
import { UnifiedChannel } from '../../../src/network/unified/channel.ts';
import type { UnifiedDelivery } from '../../../src/network/unified/channel.ts';
import { decodeUnifiedPacket, encodeUnifiedPacket } from '../../../src/network/unified/packet.ts';
const token = '0123456789abcdef0123456789abcdef';
const limits = { datagramBytes: 80, packetsPerFlush: 32, messageBytes: 4096, queuedReliableBytes: 8192, retryMilliseconds: 10 };
const bytes = (length: number, seed = 0): Uint8Array => Uint8Array.from({ length }, (_, index) => (index + seed) % 256);

test('reordered fragments, selective retries, lost final ack and ordered delivery', () => {
  const a = new UnifiedChannel(token, { ...limits, reliableWindowMessages: 1 }), b = new UnifiedChannel(token, limits);
  a.queueReliable(bytes(95)); a.queueReliable(bytes(33, 5));
  const packets = a.flush(0), first = packets[0], last = packets[2];
  if (first === undefined || last === undefined) throw new Error('Missing packets');
  expect(packets.length).toBe(3); expect(b.receive(last, 0)).toEqual([]); expect(b.receive(first, 0)).toEqual([]);
  for (const ack of b.flush(0)) a.receive(ack, 0);
  expect(a.flush(9)).toEqual([]);
  const retry = a.flush(10); expect(retry.length).toBe(1);
  expect(retry.flatMap(packet => b.receive(packet, 10))).toEqual([{ kind: 'reliable', sequence: 1, payload: bytes(95) }]);
  b.flush(10);
  const duplicate = a.flush(20); expect(duplicate.length).toBe(1);
  expect(duplicate.flatMap(packet => b.receive(packet, 20))).toEqual([]);
  for (const ack of b.flush(20)) a.receive(ack, 20);
  expect(a.acknowledgedReliableSequence).toBe(1);
  expect(a.flush(20).flatMap(packet => b.receive(packet, 20))).toEqual([{ kind: 'reliable', sequence: 2, payload: bytes(33, 5) }]);
  for (const ack of b.flush(20)) a.receive(ack, 20);
  expect(a.acknowledgedReliableSequence).toBe(2);
});

test('frames wait for reliable dependencies and ignore duplicates', () => {
  const a = new UnifiedChannel(token, limits), b = new UnifiedChannel(token, limits);
  a.queueReliable(bytes(34)); a.queueFrame(bytes(80, 9), 1);
  const packets = a.flush(0), frames = packets.filter(packet => decodeUnifiedPacket(packet)?.kind === 'frame');
  expect(frames.reverse().flatMap(packet => b.receive(packet, 0))).toEqual([]);
  expect(packets.filter(packet => decodeUnifiedPacket(packet)?.kind === 'reliable').flatMap(packet => b.receive(packet, 0))).toEqual([
    { kind: 'reliable', sequence: 1, payload: bytes(34) }, { kind: 'frame', sequence: 1, requiredReliableSequence: 1, payload: bytes(80, 9) }]);
  expect(frames.flatMap(packet => b.receive(packet, 1))).toEqual([]);
});

test('current frame completes sending and only latest replacement is retained', () => {
  const a = new UnifiedChannel(token, { ...limits, packetsPerFlush: 1 }), b = new UnifiedChannel(token, limits);
  a.queueFrame(bytes(64, 1), 0); const old = a.flush(0);
  a.queueFrame(bytes(3, 2), 0); a.queueFrame(bytes(4, 3), 0); a.flush(1);
  expect(a.flush(2).flatMap(packet => b.receive(packet, 2))).toEqual([{ kind: 'frame', sequence: 3, requiredReliableSequence: 0, payload: bytes(4, 3) }]);
  expect(old.flatMap(packet => b.receive(packet, 3))).toEqual([]);
});

test('bidirectional controls survive deterministic loss duplication and reversal alongside frames', () => {
  const a = new UnifiedChannel(token, { ...limits, packetsPerFlush: 5 }), b = new UnifiedChannel(token, { ...limits, packetsPerFlush: 5 });
  for (let index = 0; index < 6; index++) { a.queueReliable(bytes(200 + index, index)); b.queueReliable(bytes(150 + index, index + 10)); }
  const atA: UnifiedDelivery[] = [], atB: UnifiedDelivery[] = []; let count = 0;
  const deliver = (packets: readonly Uint8Array[], receiver: UnifiedChannel, output: UnifiedDelivery[], now: number): void => {
    for (const packet of [...packets].reverse()) { count++; if (count % 7 === 0) continue;
      output.push(...receiver.receive(packet, now)); if (count % 3 === 0) output.push(...receiver.receive(packet, now)); }
  };
  for (let now = 0; now < 1000; now += 10) {
    if (now < 200) { a.queueFrame(bytes(120, now), 6); b.queueFrame(bytes(120, now + 1), 6); }
    deliver(a.flush(now), b, atB, now); deliver(b.flush(now), a, atA, now);
  }
  expect(atA.filter(value => value.kind === 'reliable').map(value => value.payload)).toEqual(Array.from({ length: 6 }, (_, index) => bytes(150 + index, index + 10)));
  expect(atB.filter(value => value.kind === 'reliable').map(value => value.payload)).toEqual(Array.from({ length: 6 }, (_, index) => bytes(200 + index, index)));
  expect(a.acknowledgedReliableSequence).toBe(6); expect(b.acknowledgedReliableSequence).toBe(6);
  expect(atA.some(value => value.kind === 'frame')).toBe(true); expect(atB.some(value => value.kind === 'frame')).toBe(true);
});

test('bounds foreign tokens malformed and conflicting fragments empty messages and retry failure', () => {
  const a = new UnifiedChannel(token, { ...limits, queuedReliableMessages: 1, maximumTransmissions: 2 }), b = new UnifiedChannel(token, limits);
  expect(() => a.queueReliable(bytes(4097))).toThrow(); expect(() => a.queueFrame(bytes(1), 1)).toThrow();
  a.queueReliable(bytes(40)); expect(() => a.queueReliable(bytes(0))).toThrow();
  const first = a.flush(0)[0]; if (first === undefined) throw new Error('Missing packet');
  const decoded = decodeUnifiedPacket(first); if (decoded === null || decoded.kind === 'ack') throw new Error('Invalid packet');
  expect(b.receive(encodeUnifiedPacket({ ...decoded, token: 'f'.repeat(32) }), 0)).toEqual([]);
  expect(b.receive(first.subarray(1), 0)).toEqual([]); expect(b.receive(first, 0)).toEqual([]);
  expect(b.receive(encodeUnifiedPacket({ ...decoded, totalBytes: 41 }), 0)).toEqual([]);
  a.flush(10); expect(() => a.flush(20)).toThrow('retry limit'); expect(a.closed).toBe(true);
  const empty = new UnifiedChannel(token, limits), other = new UnifiedChannel(token, limits); empty.queueReliable(bytes(0));
  expect(empty.flush(0).flatMap(packet => other.receive(packet, 0))).toEqual([{ kind: 'reliable', sequence: 1, payload: bytes(0) }]);
  empty.close(); empty.close(); expect(() => empty.queueFrame(bytes(0), 0)).toThrow('closed');
});

test('partial reliable expiry fails closed; partial frame expiry permits newer frames', () => {
  const a = new UnifiedChannel(token, limits), b = new UnifiedChannel(token, { ...limits, assemblyMilliseconds: 20 });
  a.queueReliable(bytes(64)); const first = a.flush(0)[0]; if (first === undefined) throw new Error('Missing packet');
  b.receive(first, 0); expect(() => b.flush(20)).toThrow('assembly timed out'); expect(b.closed).toBe(true);
  const c = new UnifiedChannel(token, limits), d = new UnifiedChannel(token, { ...limits, assemblyMilliseconds: 20 });
  c.queueFrame(bytes(64), 0); const old = c.flush(0)[0]; if (old === undefined) throw new Error('Missing frame');
  d.receive(old, 0); expect(d.flush(20)).toEqual([]); c.queueFrame(bytes(2), 0);
  expect(c.flush(21).flatMap(packet => d.receive(packet, 21))).toEqual([{ kind: 'frame', sequence: 2, requiredReliableSequence: 0, payload: bytes(2) }]);
});

test('single-packet flush budget fairly advances control and frame lanes', () => {
  const a = new UnifiedChannel(token, { ...limits, packetsPerFlush: 1 });
  a.queueReliable(bytes(200)); a.queueFrame(bytes(64), 0);
  const kinds = Array.from({ length: 4 }, (_, time) => a.flush(time).map(packet => decodeUnifiedPacket(packet)?.kind)).flat();
  expect(kinds).toEqual(['reliable', 'frame', 'reliable', 'frame']);
});

test('eight controls enter one flight, reordered successors wait, cumulative ack opens next flight', () => {
  const a = new UnifiedChannel(token, limits), b = new UnifiedChannel(token, limits);
  for (let index = 0; index < 10; index++) a.queueReliable(bytes(1, index));
  a.queueFrame(bytes(1, 44), 8);
  const packets = a.flush(0), controls = packets.filter(packet => decodeUnifiedPacket(packet)?.kind === 'reliable');
  expect(controls.map(packet => decodeUnifiedPacket(packet)?.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(packets.filter(packet => decodeUnifiedPacket(packet)?.kind === 'frame').flatMap(packet => b.receive(packet, 0))).toEqual([]);
  for (const packet of controls.slice(1).reverse()) expect(b.receive(packet, 0)).toEqual([]);
  const head = controls[0]; if (head === undefined) throw new Error('Missing head');
  expect(b.receivedReliableSequence).toBe(0);
  const delivered = b.receive(head, 0);
  expect(delivered.filter(value => value.kind === 'reliable').map(value => value.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(delivered.at(-1)).toEqual({ kind: 'frame', sequence: 1, requiredReliableSequence: 8, payload: bytes(1, 44) });
  for (const packet of b.flush(0)) a.receive(packet, 0);
  expect(a.acknowledgedReliableSequence).toBe(8);
  expect(a.flush(1).flatMap(packet => b.receive(packet, 1)).map(value => value.sequence)).toEqual([9, 10]);
});

test('future fragment ACK avoids retransmission while missing earlier fragment retries', () => {
  const a = new UnifiedChannel(token, limits), b = new UnifiedChannel(token, limits);
  a.queueReliable(bytes(64)); a.queueReliable(bytes(40, 90));
  const packets = a.flush(0);
  for (const packet of packets) {
    const value = decodeUnifiedPacket(packet);
    if (value?.kind === 'reliable' && value.sequence === 1 && value.fragment === 1) continue;
    expect(b.receive(packet, 0)).toEqual([]);
  }
  for (const packet of b.flush(0)) a.receive(packet, 0);
  const retry = a.flush(10); expect(retry.length).toBe(1);
  expect(decodeUnifiedPacket(retry[0] ?? bytes(0))).toMatchObject({ kind: 'reliable', sequence: 1, fragment: 1 });
  expect(retry.flatMap(packet => b.receive(packet, 10)).map(value => value.sequence)).toEqual([1, 2]);
  b.flush(10); // Lose cumulative ACK for both controls.
  const probe = a.flush(20);
  expect(probe.map(packet => decodeUnifiedPacket(packet)?.sequence)).toEqual([1]);
  expect(probe.flatMap(packet => b.receive(packet, 20))).toEqual([]);
  for (const packet of b.flush(20)) a.receive(packet, 20);
  expect(a.acknowledgedReliableSequence).toBe(2);
});

test('receiver excludes outside-window controls and reserves bytes for missing earlier assemblies', () => {
  const sender = new UnifiedChannel(token, { ...limits, reliableWindowMessages: 4 });
  const receiver = new UnifiedChannel(token, { ...limits, reliableWindowMessages: 3, messageBytes: 64, queuedReliableBytes: 64 });
  for (let index = 0; index < 4; index++) sender.queueReliable(bytes(64, index));
  const packets = sender.flush(0);
  const later = packets.filter(packet => decodeUnifiedPacket(packet)?.sequence !== 1);
  expect(later.flatMap(packet => receiver.receive(packet, 0))).toEqual([]);
  expect(receiver.flush(0)).toEqual([]);
  expect(packets.filter(packet => decodeUnifiedPacket(packet)?.sequence === 1).flatMap(packet => receiver.receive(packet, 1)).map(value => value.sequence)).toEqual([1]);
  for (const packet of receiver.flush(1)) sender.receive(packet, 1);
  const delivered: UnifiedDelivery[] = [];
  for (let now = 10; now < 100; now += 10) {
    for (const packet of sender.flush(now)) delivered.push(...receiver.receive(packet, now));
    for (const packet of receiver.flush(now)) sender.receive(packet, now);
  }
  expect(delivered.map(value => value.sequence)).toEqual([2, 3, 4]);
  expect(sender.acknowledgedReliableSequence).toBe(4);
});
