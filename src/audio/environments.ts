// Selection adapted from q2repro al.c through quake-2-re-ts snd_environments.ts.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../contracts/math.ts";
import { REVERB_PRESET_NAMES, REVERB_PRESETS, REVERB_PRESET_PLAIN } from "./reverb-presets.ts";
import type { EfxReverbParamsT } from "./reverb-presets.ts";
export interface ReverbMaterial {
    readonly materials: readonly string[] | null;
    readonly presetIndex: number;
}
export interface ReverbEnvironment {
    readonly dimension: number;
    readonly reverbs: readonly ReverbMaterial[];
}
export interface AudioTrace {
    readonly fraction: number;
    readonly end: Vec3;
    readonly material: string | null;
    readonly sky: boolean;
}
export type AudioTraceQuery = (start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3) => AudioTrace;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function array(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
export function parseEnvironments(text: string, warn: (message: string) => void = () => undefined): readonly ReverbEnvironment[] {
    const root: unknown = JSON.parse(text);
    if (!record(root) || !array(root["environments"]))
        throw new Error("Sound environments require an environments array");
    return root["environments"].map(value => {
        if (!record(value))
            throw new Error("Sound environment must be an object");
        const dimension = value["dimension"] ?? 0;
        if (typeof dimension !== "number" || !Number.isFinite(dimension))
            throw new Error("Invalid sound environment dimension");
        const entries = value["reverbs"] ?? [];
        if (!array(entries))
            throw new Error("Sound environment reverbs must be an array");
        const reverbs = entries.map(entry => {
            if (!record(entry))
                throw new Error("Sound reverb must be an object");
            const names = entry["materials"];
            let materials: readonly string[] | null = null;
            if (names !== undefined) {
                if (typeof names === "string") {
                    if (!names.startsWith("*"))
                        throw new Error("Sound reverb wildcard must begin with *");
                }
                else if (array(names)) {
                    materials = names.map(name => { if (typeof name !== "string")
                        throw new Error("Sound material must be text"); return name; });
                }
                else
                    throw new Error("Sound reverb materials must be an array or wildcard");
            }
            const name = entry["preset"];
            let presetIndex = 0;
            if (name !== undefined) {
                if (typeof name !== "string")
                    throw new Error("Sound reverb preset must be text");
                presetIndex = REVERB_PRESET_NAMES.indexOf(name);
                if (presetIndex === -1) {
                    warn(`Missing sound environment preset ${name}`);
                    presetIndex = REVERB_PRESET_PLAIN;
                }
            }
            return { materials, presetIndex };
        });
        return { dimension, reverbs };
    });
}
export function reverbPreset(index: number): EfxReverbParamsT {
    const preset = REVERB_PRESETS[index];
    if (preset === undefined)
        throw new RangeError(`Unknown reverb preset ${index}`);
    return { ...preset };
}
const probes: readonly Vec3[] = [
    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 },
    { x: 0.707106769, y: 0, z: 0.707106769 }, { x: 0.353553385, y: 0.612372458, z: 0.707106769 },
    { x: -0.353553444, y: 0.612372458, z: 0.707106769 }, { x: -0.707106769, y: -6.18172393e-8, z: 0.707106769 },
    { x: -0.353553325, y: -0.612372518, z: 0.707106769 }, { x: 0.353553355, y: -0.612372458, z: 0.707106769 },
    { x: 1, y: 0, z: -4.37113883e-8 }, { x: 0.49999997, y: 0.866025448, z: -4.37113883e-8 },
    { x: -0.50000006, y: 0.866025388, z: -4.37113883e-8 }, { x: -1, y: -8.74227766e-8, z: -4.37113883e-8 },
    { x: -0.499999911, y: -0.866025448, z: -4.37113883e-8 }, { x: 0.499999911, y: -0.866025448, z: -4.37113883e-8 },
];
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function interpolate(a: EfxReverbParamsT, b: EfxReverbParamsT, f: number): EfxReverbParamsT {
    return {
        density: a.density + f * (b.density - a.density), diffusion: a.diffusion + f * (b.diffusion - a.diffusion),
        gain: a.gain + f * (b.gain - a.gain), gainHF: a.gainHF + f * (b.gainHF - a.gainHF), gainLF: a.gainLF + f * (b.gainLF - a.gainLF),
        decayTime: a.decayTime + f * (b.decayTime - a.decayTime), decayHFRatio: a.decayHFRatio + f * (b.decayHFRatio - a.decayHFRatio), decayLFRatio: a.decayLFRatio + f * (b.decayLFRatio - a.decayLFRatio),
        reflectionsGain: a.reflectionsGain + f * (b.reflectionsGain - a.reflectionsGain), reflectionsDelay: a.reflectionsDelay + f * (b.reflectionsDelay - a.reflectionsDelay),
        lateReverbGain: a.lateReverbGain + f * (b.lateReverbGain - a.lateReverbGain), lateReverbDelay: a.lateReverbDelay + f * (b.lateReverbDelay - a.lateReverbDelay),
        echoTime: a.echoTime + f * (b.echoTime - a.echoTime), echoDepth: a.echoDepth + f * (b.echoDepth - a.echoDepth),
        modulationTime: a.modulationTime + f * (b.modulationTime - a.modulationTime), modulationDepth: a.modulationDepth + f * (b.modulationDepth - a.modulationDepth),
        airAbsorptionGainHF: a.airAbsorptionGainHF + f * (b.airAbsorptionGainHF - a.airAbsorptionGainHF),
        hfReference: a.hfReference + f * (b.hfReference - a.hfReference), lfReference: a.lfReference + f * (b.lfReference - a.lfReference),
        roomRolloffFactor: a.roomRolloffFactor + f * (b.roomRolloffFactor - a.roomRolloffFactor), decayHFLimit: f >= 0.5 ? b.decayHFLimit : a.decayHFLimit,
    };
}
/** One selector per listener. Queries use the repaired downward floor sweep. */
export class EnvironmentReverb {
    private environmentIndex: number;
    private probeIndex = 0;
    private probeTime = 0;
    private readonly results: Vec3[] = probes.map(() => zero);
    private currentPreset = REVERB_PRESET_PLAIN;
    private active = reverbPreset(REVERB_PRESET_PLAIN);
    private from = this.active;
    private to = this.active;
    private lerpStart = 0;
    private lerpEnd = 0;
    enabled = true;
    lerpSeconds = 3;
    constructor(readonly environments: readonly ReverbEnvironment[], private readonly trace: AudioTraceQuery) {
        this.environmentIndex = Math.max(0, environments.length - 1);
    }
    get params(): EfxReverbParamsT | null { return this.enabled && this.environments.length > 0 ? this.active : null; }
    get presetIndex(): number { return this.currentPreset; }
    update(origin: Vec3, milliseconds: number): void {
        if (!Number.isFinite(milliseconds))
            throw new RangeError("Reverb time must be finite");
        if (this.environments.length === 0)
            return;
        if (milliseconds >= this.probeTime) {
            this.probeTime = milliseconds + 13;
            const direction = probes[this.probeIndex];
            if (direction === undefined)
                throw new Error("Reverb probe index outside fixed directions");
            const end = { x: origin.x + 8192 * direction.x, y: origin.y + 8192 * direction.y, z: origin.z + 8192 * direction.z };
            const hit = this.trace(origin, end, zero, zero);
            this.results[this.probeIndex] = { x: hit.end.x - origin.x, y: hit.end.y - origin.y, z: hit.end.z - origin.z + (this.probeIndex === 1 && hit.sky ? 4096 : 0) };
            const xs = this.results.map(p => p.x), ys = this.results.map(p => p.y), zs = this.results.map(p => p.z);
            const average = (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) + Math.max(...zs) - Math.min(...zs)) / 3;
            let index = this.environmentIndex;
            while (index < this.environments.length - 1 && average > (this.environments[index]?.dimension ?? Infinity))
                index++;
            if (index === this.environmentIndex)
                while (index > 0 && average < (this.environments[index - 1]?.dimension ?? -Infinity))
                    index--;
            this.environmentIndex = index;
            this.probeIndex = (this.probeIndex + 1) % probes.length;
        }
        const start = { x: origin.x, y: origin.y, z: origin.z + 1 };
        const floor = this.trace(start, { ...start, z: start.z - 256 }, { x: -16, y: -16, z: 0 }, { x: 16, y: 16, z: 0 });
        let selected = this.currentPreset;
        if (floor.fraction >= 1 || floor.material === null)
            selected = REVERB_PRESET_PLAIN;
        else {
            const environment = this.environments[this.environmentIndex];
            if (environment === undefined)
                throw new Error("Reverb environment disappeared");
            const material = floor.material.toLowerCase();
            for (const entry of environment.reverbs)
                if (entry.materials === null || entry.materials.some(name => name.toLowerCase() === material)) {
                    selected = entry.presetIndex;
                    break;
                }
        }
        if (selected !== this.currentPreset) {
            this.currentPreset = selected;
            this.from = this.active;
            this.to = reverbPreset(selected);
            this.lerpStart = milliseconds;
            this.lerpEnd = milliseconds + Math.max(0, this.lerpSeconds) * 1000;
        }
        if (milliseconds >= this.lerpEnd)
            this.active = this.to;
        else {
            const t = (milliseconds - this.lerpStart) / (this.lerpEnd - this.lerpStart);
            const f = Math.min(1, Math.max(0, 1 - Math.pow(1 - t, 3)));
            this.active = interpolate(this.from, this.to, f);
        }
    }
}
