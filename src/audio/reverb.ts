// Instance-owned adaptation of quake-2-re-ts/client/snd_reverb_dsp.ts.
// Freeverb delay tunings are public domain; this DSP is not OpenAL EAX output parity.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { EfxReverbParamsT } from "./reverb-presets.ts";
function read(samples: Float64Array, index: number): number {
    const value = samples[index];
    if (value === undefined)
        throw new RangeError("Audio delay/sample index outside allocation");
    return value;
}
class Comb {
    readonly buffer: Float64Array;
    index = 0;
    store = 0;
    feedback = 0;
    damping = 0;
    constructor(length: number) { this.buffer = new Float64Array(Math.max(1, length)); }
    process(input: number): number {
        const output = read(this.buffer, this.index);
        this.store = output * (1 - this.damping) + this.store * this.damping;
        this.buffer[this.index] = input + this.store * this.feedback;
        this.index = (this.index + 1) % this.buffer.length;
        return output;
    }
    reset(): void { this.buffer.fill(0); this.store = 0; this.index = 0; }
}
class Allpass {
    readonly buffer: Float64Array;
    index = 0;
    feedback = 0.5;
    constructor(length: number) { this.buffer = new Float64Array(Math.max(1, length)); }
    process(input: number): number {
        const old = read(this.buffer, this.index);
        this.buffer[this.index] = input + old * this.feedback;
        this.index = (this.index + 1) % this.buffer.length;
        return old - input;
    }
    reset(): void { this.buffer.fill(0); this.index = 0; }
}
class Network {
    readonly combs: readonly Comb[];
    readonly allpasses: readonly Allpass[];
    constructor(rate: number, spread: number) {
        this.combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => new Comb(Math.round((n + spread) * rate / 44100)));
        this.allpasses = [556, 441, 341, 225].map(n => new Allpass(Math.round((n + spread) * rate / 44100)));
    }
    process(input: number): number {
        let output = 0;
        for (const comb of this.combs)
            output += comb.process(input);
        for (const filter of this.allpasses)
            output = filter.process(output);
        return output;
    }
    configure(p: EfxReverbParamsT, rate: number): void {
        const damping = Math.min(0.99, Math.max(0, 1 - p.decayHFRatio) + (p.decayHFLimit ? 0.05 : 0));
        for (const comb of this.combs) {
            comb.feedback = Math.min(0.98, Math.pow(10, -3 * comb.buffer.length / (Math.max(0.001, p.decayTime) * rate)));
            comb.damping = damping;
        }
        const diffusion = Math.min(1, Math.max(0, p.diffusion * 0.7 + p.density * 0.3));
        for (const filter of this.allpasses)
            filter.feedback = 0.6 * diffusion;
    }
    reset(): void { for (const f of this.combs)
        f.reset(); for (const f of this.allpasses)
        f.reset(); }
}
/** A listener owns its delay lines, including when several seats share one device. */
export class StereoReverb {
    private readonly left: Network;
    private readonly right: Network;
    private readonly delayL: Float64Array;
    private readonly delayR: Float64Array;
    private position = 0;
    private shelfL = 0;
    private shelfR = 0;
    constructor(readonly sampleRate: number) {
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
            throw new RangeError("Invalid reverb sample rate");
        this.left = new Network(sampleRate, 0);
        this.right = new Network(sampleRate, 23);
        this.delayL = new Float64Array(Math.ceil(sampleRate * 0.3) + 1);
        this.delayR = new Float64Array(this.delayL.length);
    }
    process(samples: Float64Array, params: EfxReverbParamsT): void {
        if (samples.length % 2 !== 0)
            throw new RangeError("Reverb requires stereo frames");
        this.left.configure(params, this.sampleRate);
        this.right.configure(params, this.sampleRate);
        const delay = Math.min(this.delayL.length - 1, Math.max(0, Math.round(params.lateReverbDelay * this.sampleRate)));
        const shelf = 1 - Math.exp(-2 * Math.PI * Math.min(this.sampleRate * 0.45, Math.max(20, params.hfReference)) / this.sampleRate);
        const wetGain = Math.min(4, Math.max(0, params.gain * (params.lateReverbGain + 0.25 * params.reflectionsGain))) * 0.12;
        for (let i = 0; i < samples.length; i += 2) {
            const dryL = read(samples, i), dryR = read(samples, i + 1);
            this.delayL[this.position] = dryL;
            this.delayR[this.position] = dryR;
            const index = (this.position - delay + this.delayL.length) % this.delayL.length;
            let wetL = this.left.process(read(this.delayL, index) * 0.015), wetR = this.right.process(read(this.delayR, index) * 0.015);
            this.position = (this.position + 1) % this.delayL.length;
            this.shelfL += shelf * (wetL - this.shelfL);
            this.shelfR += shelf * (wetR - this.shelfR);
            wetL = this.shelfL + params.gainHF * (wetL - this.shelfL);
            wetR = this.shelfR + params.gainHF * (wetR - this.shelfR);
            samples[i] = dryL + wetL * wetGain;
            samples[i + 1] = dryR + wetR * wetGain;
        }
    }
    reset(): void { this.left.reset(); this.right.reset(); this.delayL.fill(0); this.delayR.fill(0); this.position = 0; this.shelfL = 0; this.shelfR = 0; }
}
/** q2repro dma.c high-shelf coefficients, applied per seat before device summation. */
export class UnderwaterFilter {
    private left = { z1: 0, z2: 0 };
    private right = { z1: 0, z2: 0 };
    constructor(readonly sampleRate: number) { }
    process(samples: Float64Array, highFrequencyGain = 0.25): void {
        const gain = Math.min(1, Math.max(0.001, highFrequencyGain));
        const w = 2 * Math.PI * Math.min(5000, this.sampleRate * 0.45) / this.sampleRate;
        const c = Math.cos(w), alpha = Math.sin(w) / 2 * Math.SQRT2, k = 2 * Math.sqrt(gain) * alpha;
        const a0 = gain + 1 - (gain - 1) * c + k;
        const b0 = gain * (gain + 1 + (gain - 1) * c + k) / a0, b1 = -2 * gain * (gain - 1 + (gain + 1) * c) / a0, b2 = gain * (gain + 1 + (gain - 1) * c - k) / a0;
        const a1 = 2 * (gain - 1 - (gain + 1) * c) / a0, a2 = (gain + 1 - (gain - 1) * c - k) / a0;
        for (let i = 0; i < samples.length; i++) {
            const state = i % 2 === 0 ? this.left : this.right;
            const input = read(samples, i), output = input * b0 + state.z1;
            state.z1 = input * b1 - output * a1 + state.z2;
            state.z2 = input * b2 - output * a2;
            samples[i] = output;
        }
    }
    reset(): void { this.left = { z1: 0, z2: 0 }; this.right = { z1: 0, z2: 0 }; }
}
