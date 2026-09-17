import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeArchive } from '../../../src/content/archive/index.ts';
import { Q3ApplicationClientDownloads, q3DownloadPath } from '../../../src/app/bootstrap/network/q3-client-downloads.ts';
import { remoteContentSelection } from '../../../src/content/catalog/index.ts';
import { Q3ServerDownload } from '../../../src/network/q3/download.ts';
import { q3ArchiveChecksums } from '../../../src/network/q3/pure.ts';
import { MessageWriter } from '../../../src/network/q3/message.ts';
import { decodeServerMessage, ServerOpcode } from '../../../src/network/q3/server-message.ts';
import { DownloadSink } from '../../../src/network/services/downloads.ts';

function fixturePk3(): Uint8Array<ArrayBuffer> {
  const name = new TextEncoder().encode('wire-probe.cfg'), data = new TextEncoder().encode('set wire_probe 1\n'.repeat(400));
  const localLength = 30 + name.length + data.length, centralLength = 46 + name.length;
  const bytes = new Uint8Array(localLength + centralLength + 22), view = new DataView(bytes.buffer), crc = Bun.hash.crc32(data);
  view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
  bytes.set(name, 30); bytes.set(data, 30 + name.length);
  view.setUint32(localLength, 0x02014b50, true); view.setUint16(localLength + 4, 20, true); view.setUint16(localLength + 6, 20, true);
  view.setUint32(localLength + 16, crc, true); view.setUint32(localLength + 20, data.length, true); view.setUint32(localLength + 24, data.length, true);
  view.setUint16(localLength + 28, name.length, true); bytes.set(name, localLength + 46);
  const end = localLength + centralLength; view.setUint32(end, 0x06054b50, true); view.setUint16(end + 8, 1, true); view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, centralLength, true); view.setUint32(end + 16, localLength, true); return bytes;
}

function fixture(checksumDelta = 0, earlierLoaded = false, reload: () => Promise<void> = async () => {}, physicalDirectory?: string) {
  const root = mkdtempSync(join(tmpdir(), 'q3-download-sink-')), bytes = fixturePk3(), archive = decodeArchive(bytes, 'pk3');
  const checksum = q3ArchiveChecksums(archive, 0).checksum ^ checksumDelta; archive.close();
  const commands: string[] = [], events: string[] = [];
  const owner = physicalDirectory === undefined ? undefined : {
    selection: remoteContentSelection('q3-baseq3', ''), writeRoot: join(root, physicalDirectory), baseWriteRoot: join(root, physicalDirectory),
  };
  if (owner !== undefined) { mkdirSync(owner.writeRoot); writeFileSync(join(owner.writeRoot, 'custom.pk3'), 'existing package'); }
  const client = new Q3ApplicationClientDownloads(root, { assertCurrent() {}, reliable: text => { commands.push(text); },
    sendPacket: () => { events.push('packet'); }, progress() {}, async reloadPackages() { events.push('reload'); await reload(); } }, owner);
  client.begin([...(earlierLoaded ? [{ name: 'baseq3/custom', checksum: checksum ^ 1 }] : []), { name: 'baseq3/custom', checksum }], earlierLoaded ? [checksum ^ 1] : [], name => existsSync(join(root, name)));
  let position = 0;
  const server = new Q3ServerDownload({ enabled: () => true, pure: () => false, print() {}, drop(reason) { throw new Error(reason); },
    open: () => ({ size: bytes.length, read(target) { const count = Math.min(target.length, bytes.length - position); target.set(bytes.subarray(position, position + count)); position += count; return count; }, close() {} }) });
  server.begin('baseq3/custom.pk3');
  const blocks = (time: number) => {
    const writer = new MessageWriter(); writer.writeLong(0); server.write(writer, time, { rate: 1000000, maxRate: 0, snapshotMsec: 50 }); writer.writeByte(ServerOpcode.Eof);
    return decodeServerMessage(writer.toBytes(), { product: 'baseq3', messageNumber: 1, reliableSequence: 0, serverCommandSequence: 0, parseEntitiesNumber: 0, baseline: () => null, history: () => null }).operations.flatMap(operation => operation.kind === 'download' ? [operation.block] : []);
  };
  return { root, bytes, client, server, blocks, commands, events, checksum };
}

test('Q3 selected and base directory mapping preserves wire names and physical collision suffixes', async () => {
  const f = fixture(0, false, async () => {}, 'BaseQ3');
  try {
    for (const block of f.blocks(2000)) { if (block.kind === 'start') f.client.publishSize(block.fileSize); await f.client.receive(block); }
    expect(readFileSync(join(f.root, 'BaseQ3/custom.pk3'), 'utf8')).toBe('existing package');
    expect(readdirSync(join(f.root, 'BaseQ3'))).toHaveLength(2);
    expect(existsSync(join(f.root, 'baseq3'))).toBe(false);
    expect(f.commands[0]).toBe('download baseq3/custom.pk3');
    expect(f.commands.at(-1)).toBe('donedl');
    const owner = { selection: remoteContentSelection('q3-baseq3', 'mymod'), writeRoot: join(f.root, 'MyMod'), baseWriteRoot: join(f.root, 'BaseQ3') };
    expect(q3DownloadPath('MYMOD/custom.123.pk3', owner)).toBe('MyMod/custom.123.pk3');
    expect(q3DownloadPath('BASEQ3/custom.pk3', owner)).toBe('BaseQ3/custom.pk3');
    expect(q3DownloadPath('other/custom.pk3', owner)).toBe('other/custom.pk3');
    expect(() => q3DownloadPath('../custom.pk3', owner)).toThrow();
  } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('native Q3 block retry and EOF publish a checked package atomically before donedl', async () => {
  const f = fixture();
  try {
    const initial = f.blocks(2000), first = initial[0];
    if (first?.kind !== 'start') throw new Error('Expected source download start');
    f.client.publishSize(first.fileSize); await f.client.receive(first);
    expect(existsSync(join(f.root, 'baseq3/custom.pk3'))).toBe(false);
    // A source resend includes the already accepted first block; it must not append twice.
    const resend = f.blocks(3101);
    for (const block of resend) { if (block.kind === 'start') f.client.publishSize(block.fileSize); await f.client.receive(block); }
    expect(readFileSync(join(f.root, 'baseq3/custom.pk3'))).toEqual(Buffer.from(f.bytes));
    expect(f.commands.filter(text => text === 'nextdl 0')).toHaveLength(1);
    expect(f.commands.at(-1)).toBe('donedl'); expect(f.events).toEqual(['packet', 'packet', 'reload']);
    expect(readdirSync(join(f.root, 'baseq3'))).toEqual(['custom.pk3']);
    for (const text of f.commands) if (text.startsWith('nextdl ')) await f.server.acknowledge(Number(text.slice(7)), 3200);
    expect(f.server.name).toBe('');
  } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('wrong package checksum and cancellation leave no installed or temporary archive', async () => {
  for (const wrong of [false, true]) {
    const f = fixture(wrong ? 1 : 0);
    try {
      const blocks = f.blocks(2000);
      if (!wrong) {
        const first = blocks[0]; if (first?.kind !== 'start') throw new Error('Missing start');
        f.client.publishSize(first.fileSize); await f.client.receive(first); f.client.close();
      } else {
        await expect((async () => { for (const block of blocks) { if (block.kind === 'start') f.client.publishSize(block.fileSize); await f.client.receive(block); } })()).rejects.toThrow('checksum');
      }
      expect(readdirSync(join(f.root, 'baseq3'))).toEqual([]); expect(f.commands).not.toContain('donedl');
    } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('staged inspection pins the inode and excludes append/publication through cancellation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'download-inspect-')), sink = DownloadSink.create(root, 'test.pk3', { kind: 'protocol-completion', maximumBytes: 8 });
  sink.append(new Uint8Array([1, 2, 3]));
  let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  const inspect = sink.inspectStaged(async path => { await ready; expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3])); });
  try {
    expect(() => sink.append(new Uint8Array())).toThrow('inspection'); expect(() => sink.finish()).toThrow('inspection');
    sink.close(); writeFileSync(join(root, 'other'), 'unrelated'); release();
    await expect(inspect).rejects.toThrow('closed during inspection');
    expect(readdirSync(root)).toEqual(['other']);
  } finally { release(); sink.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a destination installed during transfer is never replaced', async () => {
  const f = fixture();
  try {
    const blocks = f.blocks(2000), first = blocks[0];
    if (first?.kind !== 'start') throw new Error('Missing start');
    f.client.publishSize(first.fileSize); await f.client.receive(first);
    const path = join(f.root, 'baseq3/custom.pk3'); writeFileSync(path, 'installed');
    await expect((async () => { for (const block of blocks.slice(1)) await f.client.receive(block); })()).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('installed'); expect(readdirSync(join(f.root, 'baseq3'))).toEqual(['custom.pk3']);
    expect(f.commands).not.toContain('donedl');
  } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('a loaded same-name checksum does not replace the missing reference checksum', async () => {
  const f = fixture(0, true);
  try {
    for (const block of f.blocks(2000)) { if (block.kind === 'start') f.client.publishSize(block.fileSize); await f.client.receive(block); }
    expect(readFileSync(join(f.root, 'baseq3/custom.pk3'))).toEqual(Buffer.from(f.bytes));
    expect(f.commands.at(-1)).toBe('donedl');
  } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('stock and unsolicited packages never open a destination', async () => {
  const f = fixture();
  try {
    f.client.close(); f.commands.length = 0;
    expect(f.client.begin([{ name: 'baseq3/pak0', checksum: 1 }, { name: 'missionpack/pak8', checksum: 2 }], [], () => false)).toBe(false);
    expect(f.commands).toEqual([]);
    f.client.publishSize(10); await f.client.receive({ kind: 'start', fileSize: 10, data: new Uint8Array([1]) });
    expect(f.commands).toEqual(['stopdl']); expect(readdirSync(f.root)).toEqual([]);
    f.client.begin([{ name: 'baseq3/empty', checksum: 0 }], [], () => false);
    f.client.publishSize(0);
    await expect(f.client.receive({ kind: 'start', fileSize: 0, data: new Uint8Array() })).rejects.toThrow('temporary request');
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('retiring a download epoch during package refresh cannot send donedl', async () => {
  let release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(0, false, async () => { entered(); await waiting; });
  try {
    const transfer = (async () => { for (const block of f.blocks(2000)) { if (block.kind === 'start') f.client.publishSize(block.fileSize); await f.client.receive(block); } })();
    await started; f.client.close(); release();
    await expect(transfer).rejects.toThrow('retired during filesystem refresh');
    expect(f.commands).not.toContain('donedl');
  } finally { release(); f.client.close(); f.server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('cancel preserves remaining Q3 package requests and retry uses native download without leaking staging', () => {
  const f = fixture();
  try {
    expect(f.client.progress[0]?.phase).toBe('running');
    f.client.cancel(); f.client.cancel(); expect(f.commands.at(-1)).toBe('stopdl'); expect(f.client.progress[0]?.phase).toBe('pending');
    expect(f.client.retry()).toBe(true); expect(f.commands.at(-1)).toBe('download baseq3/custom.pk3');
    expect(f.client.progress[0]?.received).toBe(0);
    f.client.close(); expect(f.client.retry()).toBe(false); expect(f.client.progress).toEqual([]);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.client.close(); f.server.close(); rmSync(f.root,{recursive:true,force:true}); }
});
