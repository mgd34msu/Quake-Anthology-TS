// QuakeWorld cl_pred.c command replay and presentation interpolation. GPL-2.0-or-later.
import type { QwMovementInput, QwMovementResult, MovementServices } from '../../contracts/movement.ts';
import type { Vec3 } from '../../contracts/math.ts';
import type { QwUserCommand } from '../../contracts/protocol.ts';
import { moveQuakeWorld } from '../../movement/q1/quakeworld.ts';
import { splitQuakeWorldCommand } from './commands.ts';
export interface QuakeWorldPredictionFrame {
    readonly sequence: number;
    readonly sentAtSeconds: number;
    readonly command: QwUserCommand;
}
export type QuakeWorldPrediction = {
    readonly kind: 'unavailable';
    readonly reason: 'history-overrun' | 'missing-command' | 'actor-removed' | 'no-pending-command';
} | {
    readonly kind: 'predicted';
    readonly result: Extract<QwMovementResult, {
        status: 'active';
    }>;
    readonly origin: Vec3;
    readonly velocity: Vec3;
    readonly sequence: number;
};
export class QuakeWorldPredictionHistory {
    private readonly frames = new Map<number, QuakeWorldPredictionFrame>();
    latencySeconds = 0;
    record(frame: QuakeWorldPredictionFrame): void {
        this.frames.set(frame.sequence, { ...frame, command: { ...frame.command, angles: { ...frame.command.angles } } });
        for (const sequence of this.frames.keys())
            if (sequence <= frame.sequence - 64)
                this.frames.delete(sequence);
    }
    acknowledged(sequence: number, receivedAtSeconds: number): void {
        const frame = this.frames.get(sequence);
        if (frame === undefined)
            return;
        const latency = receivedAtSeconds - frame.sentAtSeconds;
        if (latency < 0 || latency > 1)
            return;
        this.latencySeconds = latency < this.latencySeconds ? latency : this.latencySeconds + 0.001;
    }
    bundle(sequence: number, lossPercent: number): {
        readonly oldest: QwUserCommand;
        readonly previous: QwUserCommand;
        readonly current: QwUserCommand;
        readonly lossPercent: number;
    } {
        const current = this.frames.get(sequence), previous = this.frames.get(sequence - 1), oldest = this.frames.get(sequence - 2);
        if (current === undefined || previous === undefined || oldest === undefined)
            throw new Error('Three recorded commands are required');
        return { oldest: oldest.command, previous: previous.command, current: current.command, lossPercent };
    }
    predict(input: QwMovementInput, acknowledgedSequence: number, outgoingSequence: number, realtimeSeconds: number, pushLatencyMilliseconds: number, services: MovementServices): QuakeWorldPrediction {
        if (outgoingSequence - acknowledgedSequence >= 63)
            return { kind: 'unavailable', reason: 'history-overrun' };
        const target = Math.min(realtimeSeconds, realtimeSeconds - this.latencySeconds - Math.min(0, pushLatencyMilliseconds) / 1000);
        let previousTime = this.frames.get(acknowledgedSequence)?.sentAtSeconds ?? target, previousOrigin = input.state.origin, previousVelocity = input.state.velocity, current = input, last: Extract<QwMovementResult, {
            status: 'active';
        }> | null = null, lastSequence = acknowledgedSequence;
        for (let sequence = acknowledgedSequence + 1; sequence < outgoingSequence; sequence++) {
            const frame = this.frames.get(sequence);
            if (frame === undefined)
                return { kind: 'unavailable', reason: 'missing-command' };
            let removed = false;
            const commands: QwUserCommand[] = [];
            splitQuakeWorldCommand(frame.command, command => commands.push(command));
            for (const command of commands) {
                const result = moveQuakeWorld({ ...current, command, commandSequence: sequence, execution: 'prediction', frame: { ...current.frame, elapsed: { kind: 'milliseconds', value: command.milliseconds } } }, services);
                if (result.status === 'actor-removed') {
                    removed = true;
                    break;
                }
                last = result;
                current = { ...current, state: result.state, arsenal: result.arsenal, animation: result.animation };
            }
            if (removed)
                return { kind: 'unavailable', reason: 'actor-removed' };
            lastSequence = sequence;
            if (frame.sentAtSeconds >= target) {
                const result = last;
                if (result === null)
                    return { kind: 'unavailable', reason: 'no-pending-command' };
                const f = frame.sentAtSeconds === previousTime ? 0 : Math.max(0, Math.min(1, (target - previousTime) / (frame.sentAtSeconds - previousTime))), next = result.state, teleport = Math.abs(previousOrigin.x - next.origin.x) > 128 || Math.abs(previousOrigin.y - next.origin.y) > 128 || Math.abs(previousOrigin.z - next.origin.z) > 128;
                return { kind: 'predicted', result, origin: teleport ? next.origin : lerp(previousOrigin, next.origin, f), velocity: teleport ? next.velocity : lerp(previousVelocity, next.velocity, f), sequence };
            }
            previousTime = frame.sentAtSeconds;
            previousOrigin = current.state.origin;
            previousVelocity = current.state.velocity;
        }
        if (last === null)
            return { kind: 'unavailable', reason: 'no-pending-command' };
        return { kind: 'predicted', result: last, origin: current.state.origin, velocity: current.state.velocity, sequence: lastSequence };
    }
}
function lerp(a: Vec3, b: Vec3, f: number): Vec3 { return { x: Math.fround(a.x + f * (b.x - a.x)), y: Math.fround(a.y + f * (b.y - a.y)), z: Math.fround(a.z + f * (b.z - a.z)) }; }
