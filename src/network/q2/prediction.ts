// Quake II cl_pred.c and q2repro client/predict.c history and camera correction.
import type { Vec3 } from '../../contracts/math.ts';
export interface Q2PredictionSample<TState, TGround> {
    readonly state: TState;
    readonly origin: Vec3;
    readonly viewAngles: Vec3;
    readonly onGround: boolean;
    readonly ground: TGround;
    readonly stepClip: boolean;
    readonly mayStep: boolean;
}
export interface Q2PredictionHost<TState, TCommand, TGround> {
    copy(state: TState): TState;
    predict(state: TState, command: TCommand): Q2PredictionSample<TState, TGround>;
    sameGround(left: TGround, right: TGround): boolean;
}
export type Q2PredictionResult<TState, TGround> = {
    readonly kind: 'history-exhausted';
} | {
    readonly kind: 'predicted';
    readonly sample: Q2PredictionSample<TState, TGround>;
    readonly error: Vec3;
    readonly step: number;
    readonly stepTime: number;
};
export class Q2PredictionHistory<TState, TCommand, TGround> {
    private readonly commands = new Map<number, TCommand>();
    private readonly origins = new Map<number, Vec3>();
    private lastGround: TGround | null = null;
    private error: Vec3 = { x: 0, y: 0, z: 0 };
    private step = 0;
    private stepTime = 0;
    constructor(readonly host: Q2PredictionHost<TState, TCommand, TGround>, readonly profile: 'classic' | 'rerelease', readonly capacity = 64) { }
    remember(sequence: number, command: TCommand): void {
        this.commands.set(sequence, command);
        for (const key of this.commands.keys())
            if (key <= sequence - this.capacity)
                this.commands.delete(key);
        for (const key of this.origins.keys())
            if (key <= sequence - this.capacity)
                this.origins.delete(key);
    }
    acknowledge(sequence: number, origin: Vec3): Vec3 {
        const predicted = this.origins.get(sequence);
        if (predicted === undefined) {
            this.error = { x: 0, y: 0, z: 0 };
            return this.error;
        }
        const delta = { x: origin.x - predicted.x, y: origin.y - predicted.y, z: origin.z - predicted.z };
        if (Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z) > 80) {
            this.error = { x: 0, y: 0, z: 0 };
            if (this.profile === 'rerelease')
                return this.error;
        }
        else
            this.error = delta;
        this.origins.set(sequence, { ...origin });
        return this.error;
    }
    replay(baseline: Q2PredictionSample<TState, TGround>, acknowledged: number, currentSequence: number, nowMilliseconds: number, frameSeconds: number, pendingCommand?: TCommand): Q2PredictionResult<TState, TGround> {
        if (currentSequence - acknowledged >= this.capacity)
            return { kind: 'history-exhausted' };
        let sample = { ...baseline, state: this.host.copy(baseline.state) };
        const lastCommand = this.profile === 'classic' ? currentSequence - 1 : currentSequence;
        for (let sequence = acknowledged + 1; sequence <= lastCommand; sequence++) {
            const command = this.commands.get(sequence);
            if (command === undefined)
                return { kind: 'history-exhausted' };
            sample = this.host.predict(sample.state, command);
            this.origins.set(sequence, { ...sample.origin });
        }
        if (this.profile === 'rerelease' && pendingCommand !== undefined) {
            sample = this.host.predict(sample.state, pendingCommand);
            this.origins.set(currentSequence + 1, { ...sample.origin });
        }
        const previous = this.origins.get(this.profile === 'classic' ? currentSequence - 2 : pendingCommand === undefined ? currentSequence - 1 : currentSequence);
        if (previous !== undefined) {
            const delta = sample.origin.z - previous.z;
            if (this.profile === 'classic') {
                if (delta > 63 / 8 && delta < 20 && sample.onGround) {
                    this.step = delta;
                    this.stepTime = nowMilliseconds - frameSeconds * 500;
                }
            }
            else if (Math.abs(delta) > 1 && Math.abs(delta) < 20 && (baseline.onGround || sample.stepClip) && sample.onGround && sample.mayStep && (this.lastGround === null || !this.host.sameGround(this.lastGround, sample.ground))) {
                const elapsed = nowMilliseconds - this.stepTime, old = elapsed < 100 ? this.step * (100 - elapsed) / 100 : 0;
                this.step = Math.max(-32, Math.min(32, old + delta));
                this.stepTime = nowMilliseconds;
            }
        }
        this.lastGround = sample.ground;
        return { kind: 'predicted', sample, error: this.error, step: this.step, stepTime: this.stepTime };
    }
    clear(): void { this.commands.clear(); this.origins.clear(); this.lastGround = null; this.error = { x: 0, y: 0, z: 0 }; this.step = 0; this.stepTime = 0; }
}
/** Rerelease packet acknowledgements refer to command numbers through a separate history. */
export class Q2CommandPacketHistory {
    private readonly entries = new Map<number, {
        readonly commandNumber: number;
        readonly sentAt: number;
    }>();
    constructor(readonly capacity = 64) { }
    sent(packetSequence: number, commandNumber: number, sentAt: number): void {
        this.entries.set(packetSequence, { commandNumber, sentAt });
        for (const sequence of this.entries.keys())
            if (sequence <= packetSequence - this.capacity)
                this.entries.delete(sequence);
    }
    acknowledged(packetSequence: number): {
        readonly commandNumber: number;
        readonly sentAt: number;
    } | null { return this.entries.get(packetSequence) ?? null; }
    clear(): void { this.entries.clear(); }
}
