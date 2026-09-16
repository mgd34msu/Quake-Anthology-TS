import { readQ2Demo } from '../../../network/q2/demo.ts';
import { Q2ClientReceiver, type Q2ClientReceiverHost } from './q2-client-receiver.ts';

export type Q2DemoAdvance = { readonly kind: 'frame'; readonly timeMilliseconds: number }
    | { readonly kind: 'eof' | 'disconnected' | 'closed' };

/** Recorded server frames, not dm2 block boundaries, determine playback time. */
export class Q2DemoPlayback {
    readonly receiver: Q2ClientReceiver;
    private readonly records: ReturnType<typeof readQ2Demo>;
    private terminal: 'eof' | 'disconnected' | null = null;
    private closed = false;
    private advancing = false;
    private failure: { readonly error: unknown } | null = null;
    private offset = 0;
    constructor(private readonly bytes: Uint8Array, host: Q2ClientReceiverHost) {
        this.records = readQ2Demo(bytes);
        this.receiver = new Q2ClientReceiver(host, { kind: 'demo' });
    }
    get recordedTimeMilliseconds(): number | null { return this.receiver.recordedTimeMilliseconds; }
    get consumedBytes(): number { return this.offset; }
    advance(targetMilliseconds: number): Promise<Q2DemoAdvance> {
        if (!Number.isFinite(targetMilliseconds) || targetMilliseconds < 0) throw new RangeError('Invalid Q2 demo presentation time');
        return this.readUntil(targetMilliseconds);
    }
    nextFrame(): Promise<Q2DemoAdvance> { return this.readUntil(null); }
    private async readUntil(target: number | null): Promise<Q2DemoAdvance> {
        if (this.closed) return { kind: 'closed' };
        if (this.failure !== null) throw this.failure.error;
        if (this.terminal !== null) return { kind: this.terminal };
        if (this.advancing) throw new Error('Q2 demo advance already in progress');
        this.advancing = true;
        let delivered = false;
        try {
            for (;;) {
                const time = this.recordedTimeMilliseconds;
                if (time !== null && (target === null ? delivered : time > target)) return { kind: 'frame', timeMilliseconds: time };
                const next = this.records.next();
                if (next.done) {
                    this.terminal = 'eof';
                    // A completed reader before physical EOF consumed the -1 header.
                    if (this.offset < this.bytes.length) this.offset += 4;
                    // Let the final decoded frame be presented before the owner handles EOF.
                    return delivered && time !== null ? { kind: 'frame', timeMilliseconds: time } : { kind: 'eof' };
                }
                this.offset = next.value.offset + 4 + next.value.bytes.length;
                await this.receiver.receive(next.value.bytes, 0);
                if (this.closed) return { kind: 'closed' };
                if (this.recordedTimeMilliseconds !== time && this.recordedTimeMilliseconds !== null) delivered = true;
                if (this.receiver.disconnectedDemo) {
                    this.terminal = 'disconnected';
                    const finalTime = this.recordedTimeMilliseconds;
                    return delivered && finalTime !== null ? { kind: 'frame', timeMilliseconds: finalTime } : { kind: 'disconnected' };
                }
                if (this.receiver.phase === 'closed') return { kind: 'closed' };
            }
        } catch (error) { this.failure = { error }; throw error; }
        finally { this.advancing = false; }
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.receiver.close();
        this.records.return();
    }
}
