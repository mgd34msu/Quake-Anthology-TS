// Reverb preset data ported from quake-2-re-ts/src/client/snd_environments.ts.
// SPDX-License-Identifier: GPL-2.0-or-later
export type EfxReverbParamsT = {
    density: number;
    diffusion: number;
    gain: number;
    gainHF: number;
    gainLF: number;
    decayTime: number;
    decayHFRatio: number;
    decayLFRatio: number;
    reflectionsGain: number;
    reflectionsDelay: number;
    lateReverbGain: number;
    lateReverbDelay: number;
    echoTime: number;
    echoDepth: number;
    modulationTime: number;
    modulationDepth: number;
    airAbsorptionGainHF: number;
    hfReference: number;
    lfReference: number;
    roomRolloffFactor: number;
    decayHFLimit: boolean;
};
// al.c:107-134's s_reverb_names, in the SAME order as s_reverb_parameters
// (index == preset id read from the JSON "preset" string and used as
// s_reverb_current_preset/new_preset throughout al.c).
export const REVERB_PRESET_NAMES: readonly string[] = [
    "generic",
    "padded_cell",
    "room",
    "bathroom",
    "living_room",
    "stone_room",
    "auditorium",
    "concert_hall",
    "cave",
    "arena",
    "hangar",
    "carpeted_hallway",
    "hallway",
    "stone_corridor",
    "alley",
    "forest",
    "city",
    "mountains",
    "quarry",
    "plain",
    "parking_lot",
    "sewer_pipe",
    "underwater",
    "drugged",
    "dizzy",
    "psychotic",
];
// al.c's fallback preset when a JSON "preset" name doesn't match any entry
// in s_reverb_names (al.c:390-395: "missing sound environment preset" ->
// index 19, "plain") and the preset AL_UpdateReverb forces when the floor
// probe finds no ground within range (al.c:292: `new_preset = 19;`).
export const REVERB_PRESET_PLAIN = 19;
// Values transcribed programmatically (not by hand) from
// /usr/include/AL/efx-presets.h's EFX_REVERB_PRESET_* macros, in
// REVERB_PRESET_NAMES order, to avoid transcription error across 26 * 21
// fields.
export const REVERB_PRESETS: readonly EfxReverbParamsT[] = [
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.8913, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.83, decayLFRatio: 1.0,
        reflectionsGain: 0.05, reflectionsDelay: 0.007,
        lateReverbGain: 1.2589, lateReverbDelay: 0.011,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.1715, diffusion: 1.0, gain: 0.3162, gainHF: 0.001, gainLF: 1.0,
        decayTime: 0.17, decayHFRatio: 0.1, decayLFRatio: 1.0,
        reflectionsGain: 0.25, reflectionsDelay: 0.001,
        lateReverbGain: 1.2691, lateReverbDelay: 0.002,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.4287, diffusion: 1.0, gain: 0.3162, gainHF: 0.5929, gainLF: 1.0,
        decayTime: 0.4, decayHFRatio: 0.83, decayLFRatio: 1.0,
        reflectionsGain: 0.1503, reflectionsDelay: 0.002,
        lateReverbGain: 1.0629, lateReverbDelay: 0.003,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.1715, diffusion: 1.0, gain: 0.3162, gainHF: 0.2512, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.54, decayLFRatio: 1.0,
        reflectionsGain: 0.6531, reflectionsDelay: 0.007,
        lateReverbGain: 3.2734, lateReverbDelay: 0.011,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.9766, diffusion: 1.0, gain: 0.3162, gainHF: 0.001, gainLF: 1.0,
        decayTime: 0.5, decayHFRatio: 0.1, decayLFRatio: 1.0,
        reflectionsGain: 0.2051, reflectionsDelay: 0.003,
        lateReverbGain: 0.2805, lateReverbDelay: 0.004,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.7079, gainLF: 1.0,
        decayTime: 2.31, decayHFRatio: 0.64, decayLFRatio: 1.0,
        reflectionsGain: 0.4411, reflectionsDelay: 0.012,
        lateReverbGain: 1.1003, lateReverbDelay: 0.017,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.5781, gainLF: 1.0,
        decayTime: 4.32, decayHFRatio: 0.59, decayLFRatio: 1.0,
        reflectionsGain: 0.4032, reflectionsDelay: 0.02,
        lateReverbGain: 0.717, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.5623, gainLF: 1.0,
        decayTime: 3.92, decayHFRatio: 0.7, decayLFRatio: 1.0,
        reflectionsGain: 0.2427, reflectionsDelay: 0.02,
        lateReverbGain: 0.9977, lateReverbDelay: 0.029,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 1.0, gainLF: 1.0,
        decayTime: 2.91, decayHFRatio: 1.3, decayLFRatio: 1.0,
        reflectionsGain: 0.5, reflectionsDelay: 0.015,
        lateReverbGain: 0.7063, lateReverbDelay: 0.022,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.4477, gainLF: 1.0,
        decayTime: 7.24, decayHFRatio: 0.33, decayLFRatio: 1.0,
        reflectionsGain: 0.2612, reflectionsDelay: 0.02,
        lateReverbGain: 1.0186, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.3162, gainLF: 1.0,
        decayTime: 10.05, decayHFRatio: 0.23, decayLFRatio: 1.0,
        reflectionsGain: 0.5, reflectionsDelay: 0.02,
        lateReverbGain: 1.256, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.4287, diffusion: 1.0, gain: 0.3162, gainHF: 0.01, gainLF: 1.0,
        decayTime: 0.3, decayHFRatio: 0.1, decayLFRatio: 1.0,
        reflectionsGain: 0.1215, reflectionsDelay: 0.002,
        lateReverbGain: 0.1531, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.3645, diffusion: 1.0, gain: 0.3162, gainHF: 0.7079, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.59, decayLFRatio: 1.0,
        reflectionsGain: 0.2458, reflectionsDelay: 0.007,
        lateReverbGain: 1.6615, lateReverbDelay: 0.011,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.7612, gainLF: 1.0,
        decayTime: 2.7, decayHFRatio: 0.79, decayLFRatio: 1.0,
        reflectionsGain: 0.2472, reflectionsDelay: 0.013,
        lateReverbGain: 1.5758, lateReverbDelay: 0.02,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 0.3, gain: 0.3162, gainHF: 0.7328, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.86, decayLFRatio: 1.0,
        reflectionsGain: 0.25, reflectionsDelay: 0.007,
        lateReverbGain: 0.9954, lateReverbDelay: 0.011,
        echoTime: 0.125, echoDepth: 0.95, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 0.3, gain: 0.3162, gainHF: 0.0224, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.54, decayLFRatio: 1.0,
        reflectionsGain: 0.0525, reflectionsDelay: 0.162,
        lateReverbGain: 0.7682, lateReverbDelay: 0.088,
        echoTime: 0.125, echoDepth: 1.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 0.5, gain: 0.3162, gainHF: 0.3981, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.67, decayLFRatio: 1.0,
        reflectionsGain: 0.073, reflectionsDelay: 0.007,
        lateReverbGain: 0.1427, lateReverbDelay: 0.011,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 0.27, gain: 0.3162, gainHF: 0.0562, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.21, decayLFRatio: 1.0,
        reflectionsGain: 0.0407, reflectionsDelay: 0.3,
        lateReverbGain: 0.1919, lateReverbDelay: 0.1,
        echoTime: 0.25, echoDepth: 1.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 0.3162, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.83, decayLFRatio: 1.0,
        reflectionsGain: 0.0, reflectionsDelay: 0.061,
        lateReverbGain: 1.7783, lateReverbDelay: 0.025,
        echoTime: 0.125, echoDepth: 0.7, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 0.21, gain: 0.3162, gainHF: 0.1, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.5, decayLFRatio: 1.0,
        reflectionsGain: 0.0585, reflectionsDelay: 0.179,
        lateReverbGain: 0.1089, lateReverbDelay: 0.1,
        echoTime: 0.25, echoDepth: 1.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 1.0, diffusion: 1.0, gain: 0.3162, gainHF: 1.0, gainLF: 1.0,
        decayTime: 1.65, decayHFRatio: 1.5, decayLFRatio: 1.0,
        reflectionsGain: 0.2082, reflectionsDelay: 0.008,
        lateReverbGain: 0.2652, lateReverbDelay: 0.012,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
    {
        density: 0.3071, diffusion: 0.8, gain: 0.3162, gainHF: 0.3162, gainLF: 1.0,
        decayTime: 2.81, decayHFRatio: 0.14, decayLFRatio: 1.0,
        reflectionsGain: 1.6387, reflectionsDelay: 0.014,
        lateReverbGain: 3.2471, lateReverbDelay: 0.021,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 0.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.3645, diffusion: 1.0, gain: 0.3162, gainHF: 0.01, gainLF: 1.0,
        decayTime: 1.49, decayHFRatio: 0.1, decayLFRatio: 1.0,
        reflectionsGain: 0.5963, reflectionsDelay: 0.007,
        lateReverbGain: 7.0795, lateReverbDelay: 0.011,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 1.18, modulationDepth: 0.348,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: true,
    },
    {
        density: 0.4287, diffusion: 0.5, gain: 0.3162, gainHF: 1.0, gainLF: 1.0,
        decayTime: 8.39, decayHFRatio: 1.39, decayLFRatio: 1.0,
        reflectionsGain: 0.876, reflectionsDelay: 0.002,
        lateReverbGain: 3.1081, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 0.25, modulationDepth: 1.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
    {
        density: 0.3645, diffusion: 0.6, gain: 0.3162, gainHF: 0.631, gainLF: 1.0,
        decayTime: 17.23, decayHFRatio: 0.56, decayLFRatio: 1.0,
        reflectionsGain: 0.1392, reflectionsDelay: 0.02,
        lateReverbGain: 0.4937, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 1.0, modulationTime: 0.81, modulationDepth: 0.31,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
    {
        density: 0.0625, diffusion: 0.5, gain: 0.3162, gainHF: 0.8404, gainLF: 1.0,
        decayTime: 7.56, decayHFRatio: 0.91, decayLFRatio: 1.0,
        reflectionsGain: 0.4864, reflectionsDelay: 0.02,
        lateReverbGain: 2.4378, lateReverbDelay: 0.03,
        echoTime: 0.25, echoDepth: 0.0, modulationTime: 4.0, modulationDepth: 1.0,
        airAbsorptionGainHF: 0.9943, hfReference: 5000.0, lfReference: 250.0,
        roomRolloffFactor: 0.0, decayHFLimit: false,
    },
];
