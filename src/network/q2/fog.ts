// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
export const SvcFogDataBitsT = {
    BIT_DENSITY: (1 << 0),
    BIT_R: (1 << 1),
    BIT_G: (1 << 2),
    BIT_B: (1 << 3),
    BIT_TIME: (1 << 4),
    BIT_HEIGHTFOG_FALLOFF: (1 << 5),
    BIT_HEIGHTFOG_DENSITY: (1 << 6),
    BIT_MORE_BITS: (1 << 7),
    BIT_HEIGHTFOG_START_R: (1 << 8),
    BIT_HEIGHTFOG_START_G: (1 << 9),
    BIT_HEIGHTFOG_START_B: (1 << 10),
    BIT_HEIGHTFOG_START_DIST: (1 << 11),
    BIT_HEIGHTFOG_END_R: (1 << 12),
    BIT_HEIGHTFOG_END_G: (1 << 13),
    BIT_HEIGHTFOG_END_B: (1 << 14),
    BIT_HEIGHTFOG_END_DIST: (1 << 15),
};
export type SvcFogDataBitsT = number;
export interface SvcFogDataT {
    bits: SvcFogDataBitsT;
    density: number;
    skyfactor: number;
    red: number;
    green: number;
    blue: number;
    time: number;
    hf_falloff: number;
    hf_density: number;
    hf_start_r: number;
    hf_start_g: number;
    hf_start_b: number;
    hf_start_dist: number;
    hf_end_r: number;
    hf_end_g: number;
    hf_end_b: number;
    hf_end_dist: number;
}
