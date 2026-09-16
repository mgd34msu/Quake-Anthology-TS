// Quake II dm2 record framing. Gameplay time remains in decoded server messages.
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { Q2WireCodec } from './codec.ts';
import type { ServerDataReadResultT } from './codecs/codec.ts';
import { createVanillaContext } from './codecs/vanilla.ts';
import { createMessage, loadMessage, checkMessageRead, MSG_ReadByte, MSG_ReadWord, MSG_ReadLong, MSG_ReadString } from './message.ts';
import type { SizeBuf } from './message.ts';
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

export interface Q2DemoHeader {
    readonly recordedVersion: number;
    readonly protocol: Q2ProtocolIdentity;
    readonly data: ServerDataReadResultT;
}

function recordedProtocol(version: number, message: SizeBuf): Q2ProtocolIdentity {
    switch (version) {
        case 26:
        case 34: return { kind: 'q2-classic', version: 34 };
        case 35:
        case 36: {
            const body = message.readcount;
            // These enhanced protocols extend the existing classic serverdata prefix.
            createVanillaContext(message).VANILLA_CODEC.readServerData();
            if (version === 35) MSG_ReadByte(message);
            const revision = MSG_ReadWord(message);
            checkMessageRead(message);
            message.readcount = body;
            if (version === 35) {
                if (revision === 1903 || revision === 1904 || revision === 1905) return { kind: 'q2-r1q2', version: 35, revision };
                throw new Error(`Unsupported recorded R1Q2 revision ${revision}`);
            }
            switch (revision) {
                case 1015: case 1017: case 1018: case 1019: case 1020: case 1021:
                case 1022: case 1023: case 1024: case 1025: case 1026:
                    return { kind: 'q2-q2pro', version: 36, revision };
                default: throw new Error(`Unsupported recorded Q2PRO revision ${revision}`);
            }
        }
        case 1038: return { kind: 'q2-rerelease', version: 1038 };
        case 4038: return { kind: 'q2-private-classic', version: 4038 };
        case 2022: return { kind: 'q2-kex-demo', version: 2022 };
        case 2023: return { kind: 'q2-kex', version: 2023 };
        default: throw new Error(`Unsupported recorded Q2 protocol ${version}`);
    }
}

/** Decode the recorded preamble without consuming or changing the replay input. */
export function readQ2DemoHeader(bytes: Uint8Array): Q2DemoHeader {
    for (const record of readQ2Demo(bytes)) {
        const message = createMessage(record.bytes.length);
        loadMessage(message, record.bytes);
        while (message.readcount < message.cursize) {
            const opcode = MSG_ReadByte(message);
            switch (opcode) {
                case 6: break;
                case 10: MSG_ReadByte(message); MSG_ReadString(message); break;
                case 11:
                case 15: MSG_ReadString(message); break;
                case 12: {
                    const recordedVersion = MSG_ReadLong(message);
                    checkMessageRead(message);
                    const body = message.readcount, protocol = recordedProtocol(recordedVersion, message);
                    const wire = new Q2WireCodec(protocol);
                    wire.begin(record.bytes);
                    wire.message.readcount = body;
                    const data = wire.codec.readServerData();
                    wire.finish();
                    return { recordedVersion, protocol, data };
                }
                default: throw new Error(`Q2 demo preamble opcode ${opcode} requires serverdata first`);
            }
            checkMessageRead(message);
        }
    }
    throw new Error('Q2 demo has no serverdata');
}
