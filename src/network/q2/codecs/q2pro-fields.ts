// q2proto_proto_q2pro.c and q2proto_internal_io.h. GPL-2.0-or-later.
import { MSG_ReadByte, MSG_ReadChar, MSG_ReadShort, MSG_ReadWord, MSG_ReadLong, MSG_ReadAngle, MSG_ReadAngle16, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteAngle, MSG_WriteAngle16 } from '../message.ts';
import type { SizeBuf } from '../message.ts';
import { EntityStateT, readElement } from '../state.ts';
import type { Q2ProPlayerFog } from '../state.ts';
export interface Q2ProFeatures {
    revision: number;
    flags: number;
}
export function q2proExtensions(features: Q2ProFeatures): boolean { return features.revision >= 1024 && (features.flags & 8) !== 0 || features.revision >= 1025 && (features.flags & 16) !== 0; }
export function q2proExtensionsV2(features: Q2ProFeatures): boolean { return features.revision >= 1025 && (features.flags & 16) !== 0; }
/** Integers are eighths of a world unit. A zero tag represents a signed delta. */
export function readQ2ProInt23(message: SizeBuf, previous = 0): number {
    const word = MSG_ReadShort(message);
    return (word & 1) !== 0 ? ((word & 65535) | (MSG_ReadChar(message) << 16)) >> 1 : previous + (word >> 1);
}
export function writeQ2ProInt23(message: SizeBuf, current: number, previous = 0): void {
    if (!Number.isInteger(current) || current < -4194304 || current > 4194303)
        throw new RangeError('Q2PRO coordinate exceeds signed 23-bit range');
    const delta = current - previous;
    if (delta >= -16384 && delta < 16384)
        MSG_WriteShort(message, delta << 1);
    else {
        const value = (current << 1) | 1;
        MSG_WriteShort(message, value);
        MSG_WriteByte(message, value >>> 16);
    }
}
export function readQ2ProVar64(message: SizeBuf): bigint {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
        const byte = MSG_ReadByte(message);
        if (byte < 0 || (shift === 63n && byte > 1))
            throw new Error('Invalid Q2PRO variable uint64');
        result |= BigInt(byte & 127) << shift;
        if ((byte & 128) === 0)
            return result;
    }
    throw new Error('Unterminated Q2PRO variable uint64');
}
export function writeQ2ProVar64(message: SizeBuf, value: bigint): void {
    if (value < 0n || value > 0xffffffffffffffffn)
        throw new RangeError('Q2PRO variable uint64 outside range');
    do {
        const byte = Number(value & 127n);
        value >>= 7n;
        MSG_WriteByte(message, byte | (value !== 0n ? 128 : 0));
    } while (value !== 0n);
}
export function readQ2ProFog(message: SizeBuf, from: Q2ProPlayerFog): Q2ProPlayerFog {
    const bits = MSG_ReadByte(message), to = { ...from };
    const color = (): readonly [
        number,
        number,
        number
    ] => [MSG_ReadByte(message), MSG_ReadByte(message), MSG_ReadByte(message)];
    if (bits & 1)
        to.color = color();
    if (bits & 2) {
        to.density = MSG_ReadWord(message);
        to.skyFactor = MSG_ReadWord(message);
    }
    if (bits & 4)
        to.heightDensity = MSG_ReadWord(message);
    if (bits & 8)
        to.heightFalloff = MSG_ReadWord(message);
    if (bits & 16)
        to.heightStartColor = color();
    if (bits & 32)
        to.heightEndColor = color();
    if (bits & 64)
        to.heightStartDistance = readQ2ProInt23(message);
    if (bits & 128)
        to.heightEndDistance = readQ2ProInt23(message);
    return to;
}
export function q2proFogBits(from: Q2ProPlayerFog, to: Q2ProPlayerFog): number {
    const differs = (a: readonly number[], b: readonly number[]): boolean => a.some((v, i) => v !== b[i]);
    return (differs(from.color, to.color) ? 1 : 0) | (from.density !== to.density || from.skyFactor !== to.skyFactor ? 2 : 0)
        | (from.heightDensity !== to.heightDensity ? 4 : 0) | (from.heightFalloff !== to.heightFalloff ? 8 : 0)
        | (differs(from.heightStartColor, to.heightStartColor) ? 16 : 0) | (differs(from.heightEndColor, to.heightEndColor) ? 32 : 0)
        | (from.heightStartDistance !== to.heightStartDistance ? 64 : 0) | (from.heightEndDistance !== to.heightEndDistance ? 128 : 0);
}
export function writeQ2ProFog(message: SizeBuf, bits: number, fog: Q2ProPlayerFog): void {
    MSG_WriteByte(message, bits);
    const color = (values: readonly number[]): void => {
        for (const value of values)
            MSG_WriteByte(message, value);
    };
    if (bits & 1)
        color(fog.color);
    if (bits & 2) {
        MSG_WriteShort(message, fog.density);
        MSG_WriteShort(message, fog.skyFactor);
    }
    if (bits & 4)
        MSG_WriteShort(message, fog.heightDensity);
    if (bits & 8)
        MSG_WriteShort(message, fog.heightFalloff);
    if (bits & 16)
        color(fog.heightStartColor);
    if (bits & 32)
        color(fog.heightEndColor);
    if (bits & 64)
        writeQ2ProInt23(message, fog.heightStartDistance);
    if (bits & 128)
        writeQ2ProInt23(message, fog.heightEndDistance);
}
const originBits = [1n, 2n, 512n], angleBits = [1024n, 4n, 8n], modelBits = [2048n, 1048576n, 2097152n, 4194304n];
const number16 = 256n, angle16 = 8192n, model16 = 268435456n, moreFx8 = 536870912n, alpha = 1073741824n, scale = 4294967296n, moreFx16 = 8589934592n;
function width(value: number, byte: bigint, word: bigint): bigint { return (value >>> 0) < 256 ? byte : (value >>> 0) < 65536 ? word : byte | word; }
function writeWidth(message: SizeBuf, bits: bigint, value: number, byte: bigint, word: bigint): void {
    if ((bits & (byte | word)) === (byte | word))
        MSG_WriteLong(message, value);
    else if (bits & byte)
        MSG_WriteByte(message, value);
    else if (bits & word)
        MSG_WriteShort(message, value);
}
function readWidth(message: SizeBuf, bits: bigint, previous: number, byte: bigint, word: bigint): number {
    if ((bits & (byte | word)) === (byte | word))
        return MSG_ReadLong(message) >>> 0;
    if (bits & byte)
        return MSG_ReadByte(message);
    if (bits & word)
        return MSG_ReadWord(message);
    return previous;
}
export function readQ2ProEntityBits(message: SizeBuf): {
    number: number;
    bits: number;
} {
    let bits = BigInt(MSG_ReadByte(message));
    for (let i = 1; i <= 4; i++)
        if (bits & (1n << BigInt(i * 8 - 1)))
            bits |= BigInt(MSG_ReadByte(message)) << BigInt(i * 8);
    return { number: bits & number16 ? MSG_ReadWord(message) : MSG_ReadByte(message), bits: Number(bits) };
}
export function writeQ2ProEntity(message: SizeBuf, features: Q2ProFeatures, from: EntityStateT, to: EntityStateT, force: boolean, newEntity: boolean): void {
    if (to.number < 1 || to.number > 8191)
        throw new RangeError('Q2PRO entity number outside source range');
    const extended = q2proExtensions(features), v2 = q2proExtensionsV2(features);
    let bits = 0n;
    for (let i = 0; i < 3; i++) {
        if (readElement(from.origin, i) !== readElement(to.origin, i))
            bits |= readElement(originBits, i);
        if (readElement(from.angles, i) !== readElement(to.angles, i))
            bits |= readElement(angleBits, i);
    }
    if ((bits & (1024n | 4n | 8n)) !== 0n && features.revision >= 1018)
        bits |= angle16;
    const oldModels = [from.modelindex, from.modelindex2, from.modelindex3, from.modelindex4], models = [to.modelindex, to.modelindex2, to.modelindex3, to.modelindex4];
    for (let i = 0; i < 4; i++)
        if (readElement(oldModels, i) !== readElement(models, i)) {
            bits |= readElement(modelBits, i);
            if (readElement(models, i) > 255)
                bits |= model16;
        }
    if (from.frame !== to.frame)
        bits |= to.frame < 256 ? 16n : 131072n;
    if (from.skinnum !== to.skinnum)
        bits |= width(to.skinnum, 65536n, 33554432n);
    if (from.effects !== to.effects)
        bits |= width(to.effects, 16384n, 524288n);
    if (from.renderfx !== to.renderfx)
        bits |= width(to.renderfx, 4096n, 262144n);
    if (from.morefx !== to.morefx)
        bits |= width(to.morefx, moreFx8, moreFx16);
    if (from.alpha !== to.alpha)
        bits |= alpha;
    if (from.scale !== to.scale)
        bits |= scale;
    if (!extended && (bits & (model16 | moreFx8 | moreFx16 | alpha | scale)))
        throw new Error('Q2PRO entity needs negotiated game extensions');
    if (from.solid !== to.solid)
        bits |= 134217728n;
    if (to.event !== 0)
        bits |= 32n;
    const volumeChanged = from.loop_volume !== to.loop_volume, attenuationChanged = from.loop_attenuation !== to.loop_attenuation;
    if (from.sound !== to.sound || volumeChanged || attenuationChanged)
        bits |= 67108864n;
    if (!extended && (to.sound > 255 || volumeChanged || attenuationChanged))
        throw new Error('Q2PRO looping sound needs negotiated game extensions');
    if (newEntity || ((to.renderfx & 128) !== 0 && (features.revision < 1017 || from.old_origin.some((value, i) => value !== to.old_origin[i]))))
        bits |= 16777216n;
    if (bits === 0n && !force)
        return;
    if (to.number >= 256)
        bits |= number16;
    for (let i = 4; i >= 1; i--)
        if (bits >> BigInt(i * 8))
            bits |= 1n << BigInt(i * 8 - 1);
    MSG_WriteByte(message, Number(bits & 255n));
    for (let i = 1; i <= 4; i++)
        if (bits & (1n << BigInt(i * 8 - 1)))
            MSG_WriteByte(message, Number((bits >> BigInt(i * 8)) & 255n));
    if (bits & number16)
        MSG_WriteShort(message, to.number);
    else
        MSG_WriteByte(message, to.number);
    for (let i = 0; i < 4; i++)
        if (bits & readElement(modelBits, i)) {
            if (bits & model16)
                MSG_WriteShort(message, readElement(models, i));
            else
                MSG_WriteByte(message, readElement(models, i));
        }
    if (bits & 16n)
        MSG_WriteByte(message, to.frame);
    else if (bits & 131072n)
        MSG_WriteShort(message, to.frame);
    writeWidth(message, bits, to.skinnum, 65536n, 33554432n);
    writeWidth(message, bits, to.effects, 16384n, 524288n);
    writeWidth(message, bits, to.renderfx, 4096n, 262144n);
    for (let i = 0; i < 3; i++)
        if (bits & readElement(originBits, i)) {
            const current = Math.trunc(readElement(to.origin, i) * 8);
            if (v2)
                writeQ2ProInt23(message, current, Math.trunc(readElement(from.origin, i) * 8));
            else
                MSG_WriteShort(message, current);
        }
    for (let i = 0; i < 3; i++)
        if (bits & readElement(angleBits, i)) {
            if (bits & angle16)
                MSG_WriteAngle16(message, readElement(to.angles, i));
            else
                MSG_WriteAngle(message, readElement(to.angles, i));
        }
    if (bits & 16777216n)
        for (const value of to.old_origin) {
            if (v2)
                writeQ2ProInt23(message, Math.trunc(value * 8));
            else
                MSG_WriteShort(message, Math.trunc(value * 8));
        }
    if (bits & 67108864n) {
        if (extended) {
            MSG_WriteShort(message, to.sound | (volumeChanged ? 16384 : 0) | (attenuationChanged ? 32768 : 0));
            if (volumeChanged)
                MSG_WriteByte(message, Math.trunc(to.loop_volume * 255));
            if (attenuationChanged)
                MSG_WriteByte(message, to.loop_attenuation === -1 ? 192 : Math.trunc(to.loop_attenuation * 64));
        }
        else
            MSG_WriteByte(message, to.sound);
    }
    if (bits & 32n)
        MSG_WriteByte(message, to.event);
    if (bits & 134217728n)
        MSG_WriteLong(message, to.solid);
    writeWidth(message, bits, to.morefx, moreFx8, moreFx16);
    if (bits & alpha)
        MSG_WriteByte(message, to.alpha === 0 ? 0 : Math.max(1, Math.min(255, Math.trunc(to.alpha * 255))));
    if (bits & scale)
        MSG_WriteByte(message, to.scale === 0 ? 0 : Math.max(1, Math.min(255, Math.trunc(to.scale * 16))));
}
export function readQ2ProEntity(message: SizeBuf, features: Q2ProFeatures, from: EntityStateT, to: EntityStateT, number: number, bitNumber: number): void {
    const bits = BigInt(bitNumber), extended = q2proExtensions(features), v2 = q2proExtensionsV2(features);
    // Arrays remain per-state; scalar copying includes extensions from unchanged deltas.
    const origin = to.origin, angles = to.angles, oldOrigin = to.old_origin;
    Object.assign(to, from);
    to.origin = origin;
    to.angles = angles;
    to.old_origin = oldOrigin;
    to.origin.set(from.origin);
    to.angles.set(from.angles);
    to.old_origin.set(from.origin);
    to.number = number;
    to.event = 0;
    const model = (): number => extended && (bits & model16) !== 0n ? MSG_ReadWord(message) : MSG_ReadByte(message);
    if (bits & 2048n)
        to.modelindex = model();
    if (bits & 1048576n)
        to.modelindex2 = model();
    if (bits & 2097152n)
        to.modelindex3 = model();
    if (bits & 4194304n)
        to.modelindex4 = model();
    if (bits & 16n)
        to.frame = MSG_ReadByte(message);
    else if (bits & 131072n)
        to.frame = MSG_ReadWord(message);
    to.skinnum = readWidth(message, bits, to.skinnum, 65536n, 33554432n);
    to.effects = readWidth(message, bits, to.effects, 16384n, 524288n);
    to.renderfx = readWidth(message, bits, to.renderfx, 4096n, 262144n);
    for (let i = 0; i < 3; i++)
        if (bits & readElement(originBits, i))
            to.origin[i] = (v2 ? readQ2ProInt23(message, Math.trunc(readElement(from.origin, i) * 8)) : MSG_ReadShort(message)) / 8;
    for (let i = 0; i < 3; i++)
        if (bits & readElement(angleBits, i))
            to.angles[i] = bits & angle16 ? MSG_ReadAngle16(message) : MSG_ReadAngle(message);
    if (bits & 16777216n)
        for (let i = 0; i < 3; i++)
            to.old_origin[i] = (v2 ? readQ2ProInt23(message) : MSG_ReadShort(message)) / 8;
    if (bits & 67108864n) {
        if (extended) {
            const sound = MSG_ReadWord(message);
            to.sound = sound & 16383;
            if (sound & 16384)
                to.loop_volume = MSG_ReadByte(message) / 255;
            if (sound & 32768) {
                const value = MSG_ReadByte(message);
                to.loop_attenuation = value === 192 ? -1 : value / 64;
            }
        }
        else
            to.sound = MSG_ReadByte(message);
    }
    if (bits & 32n)
        to.event = MSG_ReadByte(message);
    if (bits & 134217728n)
        to.solid = MSG_ReadLong(message) >>> 0;
    to.morefx = readWidth(message, bits, to.morefx, moreFx8, moreFx16);
    if (bits & alpha)
        to.alpha = MSG_ReadByte(message) / 255;
    if (bits & scale)
        to.scale = MSG_ReadByte(message) / 16;
}
