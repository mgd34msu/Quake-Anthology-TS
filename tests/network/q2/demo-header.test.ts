import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import type { Q2ProtocolIdentity } from '../../../src/contracts/protocol.ts';
import { openArchive } from '../../../src/content/archive/index.ts';
import { Q2WireCodec, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { ServerDataParamsT } from '../../../src/network/q2/index.ts';
import { readQ2DemoHeader, readQ2Demo, writeQ2DemoRecord, finishQ2Demo } from '../../../src/network/q2/demo.ts';
const classic: Q2ProtocolIdentity = { kind: 'q2-classic', version: 34 };
function join(parts: readonly Uint8Array[]): Uint8Array { const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes; }
function data(overrides: Partial<ServerDataParamsT> = {}): ServerDataParamsT { return { servercount: 73, attractloop: true, gamedir: 'ctf', clientnum: 2, levelname: 'recorded', serverState: 2, ...overrides }; }
function header(protocol: Q2ProtocolIdentity, overrides: Partial<ServerDataParamsT> = {}): Uint8Array { return encodeQ2ServerEvent(new Q2WireCodec(protocol), { kind: 'server-data', data: data(overrides) }); }
function demo(...blocks: Uint8Array[]): Uint8Array { return join([...blocks.map(writeQ2DemoRecord), finishQ2Demo()]); }

const protocols = [classic,
    { kind: 'q2-r1q2', version: 35, revision: 1903 }, { kind: 'q2-r1q2', version: 35, revision: 1904 }, { kind: 'q2-r1q2', version: 35, revision: 1905 },
    { kind: 'q2-q2pro', version: 36, revision: 1015 }, { kind: 'q2-q2pro', version: 36, revision: 1017 }, { kind: 'q2-q2pro', version: 36, revision: 1018 },
    { kind: 'q2-q2pro', version: 36, revision: 1019 }, { kind: 'q2-q2pro', version: 36, revision: 1020 }, { kind: 'q2-q2pro', version: 36, revision: 1021 },
    { kind: 'q2-q2pro', version: 36, revision: 1022 }, { kind: 'q2-q2pro', version: 36, revision: 1023 }, { kind: 'q2-q2pro', version: 36, revision: 1024 },
    { kind: 'q2-q2pro', version: 36, revision: 1025 }, { kind: 'q2-q2pro', version: 36, revision: 1026 },
    { kind: 'q2-rerelease', version: 1038 }, { kind: 'q2-private-classic', version: 4038 }, { kind: 'q2-kex-demo', version: 2022 }, { kind: 'q2-kex', version: 2023 },
] satisfies readonly Q2ProtocolIdentity[];
for (const protocol of protocols) test(`recorded ${JSON.stringify(protocol)} selects its real codec without changing input`, () => {
    const bytes = demo(header(protocol, { serverFps: 40, wireFlags: 7, r1q2StrafejumpHack: true, ...(protocol.kind === 'q2-r1q2' ? { r1q2Version: protocol.revision } : {}) })), before = bytes.slice();
    const decoded = readQ2DemoHeader(bytes);
    expect(decoded.protocol).toEqual(protocol); expect(decoded.recordedVersion).toBe(protocol.version);
    expect(decoded.data.gamedir).toBe('ctf'); expect(decoded.data.servercount).toBe(73); expect(decoded.data.clientnum).toBe(2);
    if (protocol.kind === 'q2-r1q2') { expect(decoded.data.r1q2Version).toBe(protocol.revision); expect(decoded.data.r1q2StrafejumpHack).toBe(true); }
    if (protocol.kind === 'q2-q2pro') { expect(decoded.data.q2proVersion).toBe(protocol.revision); expect(decoded.data.wireFlags).toBe(7); }
    if (protocol.version >= 1038) expect(decoded.data.serverFps).toBe(40);
    expect(bytes).toEqual(before); expect([...readQ2Demo(bytes)]).toHaveLength(1);
});

test('safe leading records are decoded by grammar across blocks, never searched for header bytes', () => {
    const wire = new Q2WireCodec(classic);
    const bytes = demo(join([encodeQ2ServerEvent(wire, { kind: 'nop' }), encodeQ2ServerEvent(wire, { kind: 'print', level: 0, text: '\f\x22header-looking string' })]),
        encodeQ2ServerEvent(wire, { kind: 'command-text', text: 'echo before\n' }), join([encodeQ2ServerEvent(wire, { kind: 'center-print', text: 'title' }), header(classic)]));
    expect(readQ2DemoHeader(bytes).protocol).toEqual(classic);
    expect(() => readQ2DemoHeader(demo(encodeQ2ServerEvent(wire, { kind: 'config-string', index: 33, value: 'maps/x.bsp' }), header(classic)))).toThrow('requires serverdata first');
});

test('unknown versions/revisions, absent headers and truncated data reject explicitly', () => {
    for (const version of [25, 27, 9999]) { const bytes = header(classic); new DataView(bytes.buffer).setInt32(1, version, true); expect(() => readQ2DemoHeader(demo(bytes))).toThrow('Unsupported recorded Q2 protocol'); }
    for (const revision of [0, 1902, 1906]) expect(() => readQ2DemoHeader(demo(header({ kind: 'q2-r1q2', version: 35, revision: 1905 }, { r1q2Version: revision })))).toThrow('Unsupported recorded R1Q2 revision');
    for (const revision of [0, 1014, 1016, 1027]) expect(() => readQ2DemoHeader(demo(header({ kind: 'q2-q2pro', version: 36, revision: 1026 }, { q2proVersion: revision })))).toThrow('Unsupported recorded Q2PRO revision');
    expect(() => readQ2DemoHeader(finishQ2Demo())).toThrow('no serverdata');
    for (const bytes of [new Uint8Array([1]), new Uint8Array([5, 0, 0, 0, 12]), demo(header(classic).slice(0, 7)), demo(new Uint8Array([10, 0, 65]))]) expect(() => readQ2DemoHeader(bytes)).toThrow();
});

const pak = '/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak';
test.skipIf(!existsSync(pak))('installed retail26 header retains raw version and actual world metadata', async () => {
    const archive = await openArchive(pak); try { const entry = archive.findEntries('demos/demo1.dm2')[0]; if (entry === undefined) throw new Error('demo1 absent');
        const bytes = await archive.readEntry(entry), before = bytes.slice(), decoded = readQ2DemoHeader(bytes);
        expect(decoded.recordedVersion).toBe(26); expect(decoded.protocol).toEqual(classic); expect(decoded.data.gamedir).toBe(''); expect(decoded.data.levelname).toBe('Installation'); expect(bytes).toEqual(before);
    } finally { await archive.close(); }
});
const installed = '/home/buzzkill/Projects/qfiles/q2/ctf/demos/2014-01-07-2001-lfctf1.dm2';
test.skipIf(!existsSync(installed))('installed CTF34 header selects recorded directory independent of current game', async () => {
    const decoded = readQ2DemoHeader(await Bun.file(installed).bytes()); expect(decoded.recordedVersion).toBe(34); expect(decoded.protocol).toEqual(classic); expect(decoded.data.gamedir).toBe('ctf');
});
