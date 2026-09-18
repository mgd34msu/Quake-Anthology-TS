// Quake II sv_ccmds.c SV_ServerRecord_f / sv_ents.c SV_RecordDemoMessage.
import { Q2WireCodec } from './codec.ts';
import { EntityStateT } from './state.ts';
import { createMessage, messageBytes, MSG_WriteByte, MSG_WriteLong, MSG_WriteShort, MSG_WriteString, SZ_Write, MSG_ReadByte, MSG_ReadLong, MSG_ReadShort, MSG_ReadString, checkMessageRead } from './message.ts';
import { readQ2Demo } from './demo.ts';
import { Q2ServerMessageReader } from './server-messages.ts';
import type { Q2ServerRecord } from './server-messages.ts';
import { U_REMOVE } from './constants.ts';

export interface Q2ServerDemoState {
    readonly servercount: number;
    readonly gamedir: string;
    readonly configStrings: ReadonlyMap<number, string>;
}
export type Q2ServerDemoRecord =
    | { readonly kind: 'signon'; readonly state: Q2ServerDemoState }
    | { readonly kind: 'frame'; readonly serverFrame: number; readonly entities: readonly EntityStateT[]; readonly multicasts: readonly Q2ServerRecord[] };

export function encodeQ2ServerDemoSignon(state: Q2ServerDemoState): Uint8Array {
    const message = createMessage(32768);
    MSG_WriteByte(message, 12); MSG_WriteLong(message, 34); MSG_WriteLong(message, state.servercount);
    MSG_WriteByte(message, 2); MSG_WriteString(message, state.gamedir); MSG_WriteShort(message, -1);
    MSG_WriteString(message, state.configStrings.get(0) ?? '');
    for (const [index, value] of [...state.configStrings].sort(([a], [b]) => a - b)) {
        if (!Number.isInteger(index) || index < 0 || index >= 2080) throw new RangeError('Classic server demo configstring outside range');
        if (value === '') continue;
        MSG_WriteByte(message, 13); MSG_WriteShort(message, index); MSG_WriteString(message, value);
    }
    return messageBytes(message);
}
export function encodeQ2ServerDemoFrame(serverFrame: number, entities: readonly EntityStateT[], multicasts: readonly Uint8Array[]): Uint8Array {
    if (!Number.isInteger(serverFrame) || serverFrame < 0 || serverFrame > 0x7fffffff) throw new RangeError('Invalid server demo frame');
    const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 }), message = createMessage(32768), zero = new EntityStateT();
    MSG_WriteByte(message, 20); MSG_WriteLong(message, serverFrame); wire.codec.writePacketEntitiesBegin(message);
    let previous = 0;
    for (const entity of entities) {
        if (entity.number <= previous || entity.number >= 1024) throw new RangeError('Classic server demo entities must be ordered and unique');
        previous = entity.number;
        if (entity.modelindex || entity.effects || entity.sound || entity.event) wire.codec.writeDeltaEntity(message, zero, entity, false, true);
    }
    wire.codec.writePacketEntitiesEnd(message);
    for (const bytes of multicasts) SZ_Write(message, bytes, bytes.length);
    return messageBytes(message);
}

/** Native server demos are entity footage, not playerstate DM2. No camera/player is invented. */
export function* readQ2ServerDemo(bytes: Uint8Array): Generator<Q2ServerDemoRecord, void, unknown> {
    const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 }), multicast = new Q2ServerMessageReader(wire.protocol, { maxConfigStrings: 2080, inventorySlots: 256 });
    let signon = false;
    for (const record of readQ2Demo(bytes)) {
        wire.begin(record.bytes);
        const message = wire.message, opcode = MSG_ReadByte(message);
        if (opcode === 12) {
            if (MSG_ReadLong(message) !== 34) throw new Error('Server demo requires classic protocol34');
            const servercount = MSG_ReadLong(message);
            if (MSG_ReadByte(message) !== 2) throw new Error('Not a native server demo');
            const gamedir = MSG_ReadString(message);
            if (MSG_ReadShort(message) !== -1) throw new Error('Server demo cannot contain a player view');
            MSG_ReadString(message);
            const configStrings = new Map<number, string>();
            while (message.readcount < message.cursize) {
                if (MSG_ReadByte(message) !== 13) throw new Error('Invalid server demo signon opcode');
                const index = MSG_ReadShort(message);
                if (index < 0 || index >= 2080) throw new Error('Invalid server demo configstring');
                configStrings.set(index, MSG_ReadString(message)); checkMessageRead(message);
            }
            wire.finish(); signon = true;
            yield { kind: 'signon', state: { servercount, gamedir, configStrings } };
        } else if (opcode === 20 && signon) {
            const serverFrame = MSG_ReadLong(message), entities: EntityStateT[] = [];
            if (serverFrame < 0) throw new Error('Invalid server demo frame');
            wire.codec.readPacketEntitiesBegin();
            let previous = 0;
            for (;;) {
                const header = wire.codec.readEntityBits(); checkMessageRead(message);
                if (header.number === 0) break;
                if (header.number <= previous || header.number >= 1024 || (header.bits & U_REMOVE) !== 0) throw new Error('Invalid full server demo entity');
                previous = header.number;
                const entity = new EntityStateT(); wire.codec.readDeltaEntity(new EntityStateT(), entity, header.number, header.bits);
                checkMessageRead(message); entities.push(entity);
            }
            const multicasts = multicast.read(record.bytes.subarray(message.readcount));
            yield { kind: 'frame', serverFrame, entities, multicasts };
        } else throw new Error('Server demo requires signon followed by entity frames');
    }
    if (!signon) throw new Error('Server demo has no signon');
}
