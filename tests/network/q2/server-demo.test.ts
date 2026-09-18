import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeQ2ServerDemoSignon, encodeQ2ServerDemoFrame, readQ2ServerDemo } from '../../../src/network/q2/server-demo.ts';
import { writeQ2DemoRecord, readQ2DemoHeader } from '../../../src/network/q2/demo.ts';
import { EntityStateT } from '../../../src/network/q2/state.ts';
import { DemoRecording } from '../../../src/app/bootstrap/demo-recording.ts';
const signon = () => encodeQ2ServerDemoSignon({ servercount: 7, gamedir: 'baseq2', configStrings: new Map([[0, 'fixture'], [33, 'maps/base1.bsp']]) });
function frame(): Uint8Array {
    const entity = new EntityStateT(); entity.number = 2; entity.modelindex = 1; entity.origin[0] = 42; entity.old_origin[0] = 40;
    return encodeQ2ServerDemoFrame(12, [entity], [Uint8Array.of(10, 2, 111, 107, 0)]);
}
function recording(...messages: Uint8Array[]): Uint8Array { return Uint8Array.from(messages.flatMap(message => [...writeQ2DemoRecord(message)])); }
test('classic server footage preserves native entity-only frame and distinct signon', () => {
    const start = signon(), update = frame();
    expect([...start.subarray(0, 10)]).toEqual([12, 34, 0, 0, 0, 7, 0, 0, 0, 2]);
    expect([...update.subarray(0, 6)]).toEqual([20, 12, 0, 0, 0, 18]);
    const bytes = recording(start, update), records = [...readQ2ServerDemo(bytes)];
    expect(records).toHaveLength(2);
    const first = records[0], second = records[1];
    if (first?.kind !== 'signon' || second?.kind !== 'frame') throw new Error('Wrong native record shape');
    expect(first.state.configStrings.get(33)).toBe('maps/base1.bsp');
    expect(second.serverFrame).toBe(12); expect(second.entities[0]?.origin[0]).toBe(42);
    expect(second.entities[0]?.old_origin[0]).toBe(40);
    expect(second.multicasts[0]?.event).toEqual({ kind: 'print', level: 2, text: 'ok' });
    expect('player' in second).toBe(false);
    expect(() => readQ2DemoHeader(bytes)).toThrow('Native serverrecord footage');
    expect(() => [...readQ2ServerDemo(bytes.subarray(0, bytes.length - 1))]).toThrow();
    expect(() => [...readQ2ServerDemo(recording(update))]).toThrow();
});
test('serverstop writes native EOF and shared ordered storage drains admitted frames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'server-demo-'));
    try {
        const start = signon(), update = frame();
        const storage = await DemoRecording.open(root, 'server', { identity: { kind: 'q2-server', protocol: 34 }, packets: [{ kind: 'q2-server', message: start }] });
        const writing = storage.append({ kind: 'q2-server', message: update });
        await storage.stop(); await writing;
        expect(storage.path).toBe(join(root, 'demos/server.dm2'));
        const actual = await readFile(storage.path);
        expect([...actual]).toEqual([...recording(start, update)]);
        expect([...readQ2ServerDemo(actual)]).toHaveLength(2);
    } finally { await rm(root, { recursive: true, force: true }); }
});
