import { Q2TempType } from './temp-types.ts';
import { writeQ2ProInt23 } from './codecs/q2pro-fields.ts';
// Quake II sv_send.c and rerelease game messages. GPL-2.0-or-later.
import type { Q2WireCodec } from './codec.ts';
import type { Q2ServerEvent } from './server-messages.ts';
import type { SvcFogDataT } from './fog.ts';
import { SvcFogDataBitsT } from './fog.ts';
import { createMessage, messageBytes, MSG_WriteByte, MSG_WriteDir, MSG_WriteFloat, MSG_WriteLong, MSG_WritePos, MSG_WriteShort, MSG_WriteString, SZ_Write } from './message.ts';
import type { SizeBuf } from './message.ts';
import { readElement } from './state.ts';
import type { DownloadSource } from '../services/downloads.ts';
export function writeQ2Fog(m: SizeBuf, fog: SvcFogDataT): void {
    const bits = fog.bits | ((fog.bits & 0xff00) !== 0 ? SvcFogDataBitsT.BIT_MORE_BITS : 0);
    MSG_WriteByte(m, bits);
    if (bits & SvcFogDataBitsT.BIT_MORE_BITS)
        MSG_WriteByte(m, bits >>> 8);
    if (bits & SvcFogDataBitsT.BIT_DENSITY) {
        MSG_WriteFloat(m, fog.density);
        MSG_WriteByte(m, fog.skyfactor);
    }
    if (bits & SvcFogDataBitsT.BIT_R)
        MSG_WriteByte(m, fog.red);
    if (bits & SvcFogDataBitsT.BIT_G)
        MSG_WriteByte(m, fog.green);
    if (bits & SvcFogDataBitsT.BIT_B)
        MSG_WriteByte(m, fog.blue);
    if (bits & SvcFogDataBitsT.BIT_TIME)
        MSG_WriteShort(m, fog.time);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_FALLOFF)
        MSG_WriteFloat(m, fog.hf_falloff);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_DENSITY)
        MSG_WriteFloat(m, fog.hf_density);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_R)
        MSG_WriteByte(m, fog.hf_start_r);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_G)
        MSG_WriteByte(m, fog.hf_start_g);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_B)
        MSG_WriteByte(m, fog.hf_start_b);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_DIST)
        MSG_WriteLong(m, fog.hf_start_dist);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_R)
        MSG_WriteByte(m, fog.hf_end_r);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_G)
        MSG_WriteByte(m, fog.hf_end_g);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_B)
        MSG_WriteByte(m, fog.hf_end_b);
    if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_DIST)
        MSG_WriteLong(m, fog.hf_end_dist);
}
export type Q2ServerWriteEvent = Exclude<Q2ServerEvent, {
    kind: 'frame' | 'private';
}>;
export function encodeQ2ServerEvent(wire: Q2WireCodec, event: Q2ServerWriteEvent): Uint8Array {
    const m = createMessage(), kex = wire.protocol.kind === 'q2-kex' || wire.protocol.kind === 'q2-kex-demo';
    const rerelease = wire.protocol.kind === 'q2-rerelease' || wire.protocol.kind === 'q2-private-classic';
    if (['achievement', 'fog', 'damage', 'poi', 'help-path', 'localized-print'].includes(event.kind) && !kex && !rerelease)
        throw new Error('Q2 rerelease service message cannot fit selected protocol');
    if (event.kind === 'setting' && wire.protocol.kind !== 'q2-r1q2' && wire.protocol.kind !== 'q2-q2pro' && !rerelease)
        throw new Error('Selected Q2 protocol has no server setting message');
    const floatVector = (value: Float32Array): void => {
        for (let i = 0; i < 3; i++)
            MSG_WriteFloat(m, readElement(value, i));
    };
    switch (event.kind) {
        case 'nop':
            MSG_WriteByte(m, 6);
            break;
        case 'disconnect':
            MSG_WriteByte(m, 7);
            break;
        case 'reconnect':
            MSG_WriteByte(m, 8);
            break;
        case 'level-restart':
            if (!kex)
                throw new Error('Level-restart opcode requires KEX wire');
            MSG_WriteByte(m, 24);
            break;
        case 'server-data':
            wire.codec.writeServerData(m, event.data);
            break;
        case 'print':
            MSG_WriteByte(m, 10);
            MSG_WriteByte(m, event.level);
            MSG_WriteString(m, event.text);
            break;
        case 'center-print':
            MSG_WriteByte(m, 15);
            MSG_WriteString(m, event.text);
            break;
        case 'command-text':
            MSG_WriteByte(m, 11);
            MSG_WriteString(m, event.text);
            break;
        case 'layout':
            MSG_WriteByte(m, 4);
            MSG_WriteString(m, event.text);
            break;
        case 'achievement':
            MSG_WriteByte(m, 33);
            MSG_WriteString(m, event.text);
            break;
        case 'config-string':
            MSG_WriteByte(m, 13);
            MSG_WriteShort(m, event.index);
            MSG_WriteString(m, event.value);
            break;
        case 'baseline':
            wire.codec.writeSpawnBaseline(m, event.entity);
            break;
        case 'temporary-entity': {
            const entity = event.value;
            MSG_WriteByte(m, 3);
            MSG_WriteByte(m, entity.type);
            for (const field of entity.fields) {
                if (field.kind === 'integer') {
                    if (field.name === 'time')
                        MSG_WriteLong(m, field.value);
                    else if (field.name === 'entity1' || field.name === 'entity2' || entity.type === Q2TempType.TE_Q2PRO_DAMAGE_DEALT)
                        MSG_WriteShort(m, field.value);
                    else
                        MSG_WriteByte(m, field.value);
                }
                else {
                    const value = new Float32Array([field.value.x, field.value.y, field.value.z]);
                    if (field.name === 'direction')
                        MSG_WriteDir(m, value);
                    else if (wire.q2proExtendedV2)
                        for (const component of value)
                            writeQ2ProInt23(m, Math.trunc(component * 8));
                    else if (wire.floatingCoordinates)
                        floatVector(value);
                    else
                        MSG_WritePos(m, value);
                }
            }
            break;
        }
        case 'inventory':
            MSG_WriteByte(m, 5);
            for (const count of event.counts)
                MSG_WriteShort(m, count);
            break;
        case 'download':
            MSG_WriteByte(m, 16);
            MSG_WriteShort(m, event.bytes?.length ?? -1);
            MSG_WriteByte(m, event.percent);
            if (event.bytes !== null)
                SZ_Write(m, event.bytes, event.bytes.length);
            break;
        case 'setting':
            MSG_WriteByte(m, wire.protocol.version === 1038 || wire.protocol.version === 4038 ? 37 : 24);
            MSG_WriteLong(m, event.index);
            MSG_WriteLong(m, event.value);
            break;
        case 'seat':
            if (!kex)
                throw new Error('Source seat marker requires KEX wire');
            MSG_WriteByte(m, 21);
            MSG_WriteByte(m, event.seat);
            break;
        case 'muzzle-flash': {
            let entity = event.entity, flash = event.flash;
            if (event.monster && flash > 255) {
                if (kex || wire.protocol.kind === 'q2-rerelease' || wire.protocol.kind === 'q2-private-classic') {
                    MSG_WriteByte(m, 32);
                    MSG_WriteShort(m, entity);
                    MSG_WriteShort(m, flash);
                    break;
                }
                if (wire.q2proExtended) {
                    entity |= (flash & 0x700) << 5;
                    flash &= 255;
                }
                else
                    throw new Error('Monster muzzleflash cannot fit selected Q2 protocol');
            }
            MSG_WriteByte(m, event.monster ? 2 : 1);
            MSG_WriteShort(m, entity);
            MSG_WriteByte(m, flash | (event.silenced ? 128 : 0));
            break;
        }
        case 'sound': {
            const s = event.sound;
            let flags = s.flags;
            if (!kex && s.index > 255) {
                if (!rerelease && !wire.q2proExtended)
                    throw new Error('Q2 sound index needs extended game layout');
                flags |= 32;
            }
            if (s.position !== null)
                flags |= 4;
            if (s.entity !== 0 || s.channel !== 0)
                flags |= 8;
            if (s.volume !== 1)
                flags |= 1;
            if (s.attenuation !== 1)
                flags |= 2;
            if (s.delaySeconds !== 0)
                flags |= 16;
            const channel = (s.entity << 3) | s.channel;
            if (kex && channel > 65535)
                flags |= 64;
            MSG_WriteByte(m, 9);
            MSG_WriteByte(m, flags);
            if (kex || (flags & 32) !== 0)
                MSG_WriteShort(m, s.index);
            else
                MSG_WriteByte(m, s.index);
            if (flags & 1)
                MSG_WriteByte(m, Math.trunc(s.volume * 255));
            if (flags & 2)
                MSG_WriteByte(m, Math.trunc(s.attenuation * 64));
            if (flags & 16)
                MSG_WriteByte(m, Math.trunc(s.delaySeconds * 1000));
            if (flags & 8) {
                if (kex && (flags & 64) !== 0)
                    MSG_WriteLong(m, channel);
                else
                    MSG_WriteShort(m, channel);
            }
            if (flags & 4) {
                if (s.position === null)
                    throw new Error('Positioned Q2 sound has no position');
                const pos = new Float32Array([s.position.x, s.position.y, s.position.z]);
                if (wire.q2proExtendedV2) {
                    for (const value of pos)
                        writeQ2ProInt23(m, Math.trunc(value * 8));
                }
                else if (wire.floatingCoordinates)
                    floatVector(pos);
                else
                    MSG_WritePos(m, pos);
            }
            break;
        }
        case 'fog':
            MSG_WriteByte(m, 27);
            writeQ2Fog(m, event.value);
            break;
        case 'damage':
            MSG_WriteByte(m, 25);
            MSG_WriteByte(m, event.indicators.length);
            for (const damage of event.indicators) {
                MSG_WriteByte(m, (damage.damage & 31) | (damage.health ? 32 : 0) | (damage.armor ? 64 : 0) | (damage.shield ? 128 : 0));
                MSG_WriteDir(m, damage.direction);
            }
            break;
        case 'poi': {
            const p = event.value;
            MSG_WriteByte(m, 30);
            MSG_WriteShort(m, p.key);
            MSG_WriteShort(m, p.time);
            floatVector(p.pos);
            MSG_WriteShort(m, p.image);
            MSG_WriteByte(m, p.color);
            MSG_WriteByte(m, p.flags);
            break;
        }
        case 'help-path':
            MSG_WriteByte(m, 31);
            MSG_WriteByte(m, event.value.start ? 1 : 0);
            floatVector(event.value.pos);
            MSG_WriteDir(m, event.value.dir);
            break;
        case 'localized-print':
            MSG_WriteByte(m, 26);
            MSG_WriteByte(m, event.value.flags);
            MSG_WriteString(m, event.value.base);
            MSG_WriteByte(m, event.value.args.length);
            for (const arg of event.value.args)
                MSG_WriteString(m, arg);
            break;
    }
    return messageBytes(m);
}
/** nextdl requests advance this source-owned download, independent of simulation ticks. */
export class Q2DownloadSender {
    private offset: number;
    private ended = false;
    constructor(readonly source: DownloadSource, offset = 0, readonly blockBytes = 1024) {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.byteLength || !Number.isInteger(blockBytes) || blockBytes < 1 || blockBytes > 32767)
            throw new RangeError('Invalid Q2 download range');
        this.offset = offset;
    }
    next(): Extract<Q2ServerEvent, {
        kind: 'download';
    }> | null {
        if (this.ended)
            return null;
        const bytes = this.source.read(this.offset, Math.min(this.blockBytes, this.source.byteLength - this.offset));
        this.offset += bytes.length;
        const percent = Math.floor(this.offset * 100 / (this.source.byteLength || 1));
        if (this.offset === this.source.byteLength) {
            this.ended = true;
            this.source.close();
        }
        return { kind: 'download', bytes, percent };
    }
    close(): void {
        if (!this.ended) {
            this.ended = true;
            this.source.close();
        }
    }
}
