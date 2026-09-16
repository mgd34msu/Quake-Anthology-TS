import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { openArchive } from '../../../src/content/archive/index.ts';
import type { Q2ProtocolIdentity } from '../../../src/contracts/protocol.ts';
import { Q2WireCodec, Q2ServerMessageReader, PlayerStateT, EntityStateT, encodeQ2ServerEvent, encodeQ2Frame } from '../../../src/network/q2/index.ts';
import type { Q2WireFrame } from '../../../src/network/q2/index.ts';
import { readQ2Demo, writeQ2DemoRecord, finishQ2Demo } from '../../../src/network/q2/demo.ts';
const protocol: Q2ProtocolIdentity = { kind: 'q2-classic', version: 34 };
const wire = new Q2WireCodec(protocol);
function reader(mode: 'network'|'demo' = 'demo', selected: Q2ProtocolIdentity = protocol) { return new Q2ServerMessageReader(selected, { readMode: mode, maxConfigStrings: 2080, inventorySlots: 256 }); }
function serverdata(version: number): Uint8Array {
  const bytes = encodeQ2ServerEvent(wire, { kind: 'server-data', data: { servercount: 1, attractloop: true, gamedir: 'baseq2', clientnum: 0, levelname: 'demo', serverState: 0 } });
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(1, version, true); return bytes;
}
function frame(number: number): Q2WireFrame {
  const player = new PlayerStateT(); player.stats[2] = 100; player.fov = 90;
  const entity = new EntityStateT(); entity.number = 7; entity.modelindex = 1; entity.origin[0] = number * 8;
  return { serverFrame: number, deltaFrame: number - 1, suppressedCount: 5, areaBits: new Uint8Array([13, 24]), player, entities: [entity] };
}
function packet(next: Q2WireFrame, old: Q2WireFrame|null, legacy: boolean): Uint8Array {
  const bytes = encodeQ2Frame(wire, next, old, new Map<number, EntityStateT>(), 4);
  return Uint8Array.from([...bytes.slice(0, 9), ...(legacy ? [] : bytes.slice(9, 10)), ...bytes.slice(10), 6]);
}
test('old demo26 is opt-in and never a negotiated live protocol', () => {
  expect(() => reader('network').read(serverdata(26))).toThrow('differs from negotiated');
  for (const selected of [{ kind: 'q2-r1q2', version: 35, revision: 1905 }, { kind: 'q2-q2pro', version: 36, revision: 1019 }, { kind: 'q2-rerelease', version: 1038 }] satisfies readonly Q2ProtocolIdentity[])
    expect(() => reader('demo', selected).read(serverdata(26))).toThrow('differs from negotiated');
  expect(() => reader().read(serverdata(25))).toThrow('differs from negotiated');
  expect(reader().read(serverdata(26))[0]?.event.kind).toBe('server-data');
});
test('legacy full/delta frames omit suppress byte and preserve trailing message alignment', () => {
  const first = frame(1), second = frame(2), r = reader();
  const demo = Uint8Array.from([...writeQ2DemoRecord(serverdata(26)), ...writeQ2DemoRecord(packet(first, null, true)), ...writeQ2DemoRecord(packet(second, first, true)), ...finishQ2Demo()]);
  const frames: Q2WireFrame[] = [];
  for (const block of readQ2Demo(demo)) {
    const events = r.read(block.bytes);
    for (const record of events) if (record.event.kind === 'frame') frames.push(record.event.frame);
    if (events[0]?.event.kind === 'frame') expect(events.at(-1)?.event.kind).toBe('nop');
  }
  expect(frames).toHaveLength(2);
  expect(frames[1]?.suppressedCount).toBe(0); expect(frames[1]?.areaBits).toEqual(new Uint8Array([13,24]));
  expect(frames[1]?.player.stats[2]).toBe(100); expect(frames[1]?.entities[0]?.origin[0]).toBe(16);
  r.read(serverdata(34));
  let current = r.read(packet(first,null,false))[0]?.event;
  expect(current?.kind === 'frame' ? current.frame.suppressedCount : -1).toBe(5);
  r.read(serverdata(26)); r.reset();
  current = r.read(packet(first,null,false))[0]?.event;
  expect(current?.kind === 'frame' ? current.frame.suppressedCount : -1).toBe(5);
});
test('failed serverdata does not switch read layout and malformed legacy frames still fail', () => {
  const r = reader();
  expect(() => r.read(serverdata(26).slice(0,7))).toThrow();
  const event = r.read(packet(frame(1),null,false))[0]?.event;
  expect(event?.kind === 'frame' ? event.frame.suppressedCount : -1).toBe(5);
  r.read(serverdata(26)); expect(() => r.read(packet(frame(1),null,true).slice(0,10))).toThrow();
});
test.skipIf(!existsSync('/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak'))('installed retail demo1 protocol26 decodes through actual dm2 EOF', async () => {
  const archive = await openArchive('/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak');
  try {
    const entry = archive.findEntries('demos/demo1.dm2')[0]; if (entry === undefined) throw new Error('Retail demo1 missing');
    const bytes = await archive.readEntry(entry), r = reader(); let frames = 0, configs = 0, packets = 0, first = -1, last = -1;
    for (const block of readQ2Demo(bytes)) { packets++; for (const record of r.read(block.bytes)) {
      if (record.event.kind === 'config-string') configs++;
      if (record.event.kind === 'frame') { if (first < 0) first = record.event.frame.serverFrame; last = record.event.frame.serverFrame; frames++; }
    } }
    expect(frames).toBeGreaterThan(100); expect(configs).toBeGreaterThan(0); expect(last).toBeGreaterThan(first);
    expect(r.configStrings.get(33)).toMatch(/^maps\/.*\.bsp$/);
    console.log(JSON.stringify({ packets, frames, configs, first, last, map: r.configStrings.get(33), bytes: bytes.length }));
  } finally { await archive.close(); }
});
