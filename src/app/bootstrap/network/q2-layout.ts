import type { Q2ProtocolIdentity } from '../../../contracts/protocol.ts';
export interface Q2ApplicationLayout {
    readonly models: number;
    readonly sounds: number;
    readonly images: number;
    readonly lights: number;
    readonly items: number;
    readonly playerSkins: number;
    readonly maxModels: number;
    readonly maxSounds: number;
    readonly maxImages: number;
    readonly maxConfigStrings: number;
    readonly mapChecksum: number;
    readonly maxClients: number;
    readonly airAccelerate: number;
    readonly n64Physics: number | null;
}
/** Configstring layout follows game API/limits; protocol 4038 intentionally uses the classic game layout. */
export function q2ApplicationLayout(protocol: Q2ProtocolIdentity): Q2ApplicationLayout {
    if (protocol.kind === 'q2-rerelease' || protocol.kind === 'q2-kex' || protocol.kind === 'q2-kex-demo')
        return { models: 62, sounds: 8254, images: 10302, lights: 10814, items: 11326, playerSkins: 11582, maxModels: 8192, maxSounds: 2048, maxImages: 512, maxConfigStrings: 12448, mapChecksum: 61, maxClients: 60, airAccelerate: 59, n64Physics: 12103 };
    return { models: 32, sounds: 288, images: 544, lights: 800, items: 1056, playerSkins: 1312, maxModels: 256, maxSounds: 256, maxImages: 256, maxConfigStrings: 2080, mapChecksum: 31, maxClients: 30, airAccelerate: 29, n64Physics: null };
}
