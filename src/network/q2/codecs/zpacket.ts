// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import * as zlib from "node:zlib";
import { SVC_ZPACKET, ERR_DROP, ComError, SvcOpsT } from "../constants.ts";
import { type SizeBuf, MSG_ReadWord, MSG_ReadData, checkMessageRead } from "../message.ts";
export const ZPACKET_MIN_COMPRESS_SIZE = 5 + 16;
const ZPACKET_HEADER_SIZE = 5;
export function tryWrapZPacket(data: Uint8Array, len: number, maxOut: number): Uint8Array | null {
    if (len < ZPACKET_MIN_COMPRESS_SIZE)
        return null;
    if (len > 0xffff)
        return null;
    if (len > 0 && data[0] === SvcOpsT.svc_serverdata)
        return null;
    const compressed = zlib.deflateRawSync(data.subarray(0, len));
    if (compressed.length > 0xffff)
        return null;
    const total = ZPACKET_HEADER_SIZE + compressed.length;
    if (total >= len)
        return null;
    if (total > maxOut)
        return null;
    const out = new Uint8Array(total);
    out[0] = SVC_ZPACKET & 0xff;
    out[1] = compressed.length & 0xff;
    out[2] = (compressed.length >> 8) & 0xff;
    out[3] = len & 0xff;
    out[4] = (len >> 8) & 0xff;
    out.set(compressed, ZPACKET_HEADER_SIZE);
    return out;
}
export function readZPacketPayload(msg: SizeBuf): Uint8Array {
    const compressedLen = MSG_ReadWord(msg);
    const expectedLength = MSG_ReadWord(msg);
    checkMessageRead(msg);
    const compressed = new Uint8Array(compressedLen);
    MSG_ReadData(msg, compressed, compressedLen);
    checkMessageRead(msg);
    try {
        const bytes = new Uint8Array(zlib.inflateRawSync(compressed, { maxOutputLength: expectedLength || 1 }));
        if (bytes.length !== expectedLength)
            throw new Error("inflated length differs from header");
        return bytes;
    }
    catch (e) {
        throw new ComError(ERR_DROP, `zpacket: raw inflate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}
