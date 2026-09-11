// Quake II dm2 record framing. Gameplay time remains in decoded server messages.
import type { Q2ServerMessageReader, Q2ServerRecord } from './server-messages.ts';
export interface Q2DemoRecord {
    readonly offset: number;
    readonly bytes: Uint8Array;
}
export function* readQ2Demo(bytes: Uint8Array): Generator<Q2DemoRecord, void, unknown> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
        if (offset + 4 > bytes.length)
            throw new Error('Truncated Q2 demo record header');
        const start = offset, length = view.getInt32(offset, true);
        offset += 4;
        if (length === -1)
            return;
        if (length < 0 || offset + length > bytes.length)
            throw new Error('Truncated Q2 demo packet');
        yield { offset: start, bytes: bytes.slice(offset, offset + length) };
        offset += length;
    }
}
export function writeQ2DemoRecord(bytes: Uint8Array): Uint8Array {
    const result = new Uint8Array(bytes.length + 4);
    new DataView(result.buffer).setInt32(0, bytes.length, true);
    result.set(bytes, 4);
    return result;
}
export function finishQ2Demo(): Uint8Array { return new Uint8Array([255, 255, 255, 255]); }
export function* playQ2Demo(bytes: Uint8Array, reader: Q2ServerMessageReader): Generator<readonly Q2ServerRecord[], void, unknown> {
    for (const record of readQ2Demo(bytes))
        yield reader.read(record.bytes);
}
