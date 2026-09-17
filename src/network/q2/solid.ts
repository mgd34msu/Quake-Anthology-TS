import type { Bounds } from '../../contracts/math.ts';
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';

export type Q2SolidEncoding = 'short' | 'r1q2' | 'q2pro-v2';

export function q2SolidEncoding(protocol: Q2ProtocolIdentity, extendedGame = false): Q2SolidEncoding {
    switch (protocol.kind) {
        case 'q2-classic': return 'short';
        case 'q2-r1q2': return protocol.revision >= 1905 ? 'r1q2' : 'short';
        case 'q2-q2pro': return extendedGame ? 'q2pro-v2' : 'r1q2';
        case 'q2-rerelease':
        case 'q2-private-classic':
        case 'q2-kex':
        case 'q2-kex-demo': return 'q2pro-v2';
    }
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, Math.trunc(value)));

/** q2proto_solid.c: solid box encoding follows negotiated protocol and game API. */
export function packQ2Solid(bounds: Bounds, encoding: Q2SolidEncoding): number {
    if (encoding === 'short')
        return clamp(bounds.max.x / 8, 1, 31) | clamp(-bounds.min.z / 8, 1, 31) << 5 | clamp((bounds.max.z + 32) / 8, 1, 63) << 10;
    if (encoding === 'r1q2')
        return (clamp(bounds.max.x, 1, 255) | clamp(-bounds.min.z, 0, 255) << 8 | clamp(Math.fround(bounds.max.z + 32768), 0, 65535) << 16) >>> 0;
    return (clamp(bounds.max.x, 1, 255) | clamp(bounds.max.y, 1, 255) << 8 | clamp(-bounds.min.z, 0, 255) << 16 | clamp(Math.fround(bounds.max.z + 32), 0, 255) << 24) >>> 0;
}

export function unpackQ2Solid(solid: number, encoding: Q2SolidEncoding): Bounds {
    const x = encoding === 'short' ? (solid & 31) * 8 : solid & 255;
    const y = encoding === 'q2pro-v2' ? solid >>> 8 & 255 : x;
    const down = encoding === 'short' ? (solid >>> 5 & 31) * 8 : encoding === 'r1q2' ? solid >>> 8 & 255 : solid >>> 16 & 255;
    const up = encoding === 'short' ? (solid >>> 10 & 63) * 8 - 32 : encoding === 'r1q2' ? (solid >>> 16 & 65535) - 32768 : (solid >>> 24 & 255) - 32;
    return { min: { x: -x, y: -y, z: -down }, max: { x, y, z: up } };
}
