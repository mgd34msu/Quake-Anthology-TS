import type { QuakeWorldDemoRecord } from '../../../network/q1/demos.ts';
import { NetQuakeDemoReader, QuakeWorldDemoReader } from '../../../network/q1/demos.ts';
import { NetQuakeDecoder } from '../../../network/q1/netquake.ts';
import { QuakeWorldDecoder } from '../../../network/q1/quakeworld.ts';
import { Q1RemotePresentation } from './remote-q1.ts';
import { QwRemotePresentation } from './remote-qw.ts';
import type { QwServerData } from './qw-types.ts';

/** elapsedSeconds is the current rendered frame's elapsed playback time, after pause/timescale. */
export interface Q1DemoFrame { readonly elapsedSeconds: number; readonly frame: number; readonly timedemo: boolean; }
export type Q1DemoEnd = 'eof' | 'recorded-disconnect' | 'closed';
export type Q1DemoProgress = { readonly recordedSeconds: number; readonly recordsRead: number } &
    ({ readonly phase: 'loading' | 'active' } | { readonly phase: 'ended'; readonly reason: Q1DemoEnd });

class RetiredDemoOperation extends Error {}
class DemoOperation {
    private busy = false;
    private ended: Q1DemoEnd | null = null;
    private frame = -1;
    close(): void { this.ended = 'closed'; }
    get reason(): Q1DemoEnd | null { return this.ended; }
    finish(reason: Q1DemoEnd): void { this.ended ??= reason; }
    assertCurrent = (): void => { if (this.ended === 'closed') throw new RetiredDemoOperation('Demo closed during advancement'); };
    async run(frame: Q1DemoFrame, work: () => Promise<void>): Promise<void> {
        if (this.busy) throw new Error('Demo advancement is already in progress');
        if (!Number.isSafeInteger(frame.frame) || frame.frame < 0 || !Number.isFinite(frame.elapsedSeconds) || frame.elapsedSeconds < 0)
            throw new RangeError('Invalid demo frame clock');
        if (this.ended !== null || this.frame === frame.frame) return;
        if (frame.frame < this.frame) throw new RangeError('Demo frame number moved backwards');
        this.busy = true; this.frame = frame.frame;
        try { await work(); }
        catch (error) { if (!(error instanceof RetiredDemoOperation)) throw error; }
        finally { this.busy = false; }
    }
}

/** Native .dem packets enter the same receiver as live NetQuake, without a channel or server. */
export class NetQuakeDemoInput {
    private readonly decoder = new NetQuakeDecoder();
    private readonly operation = new DemoOperation();
    private signon = 0;
    private clock = 0;
    private primed = false;
    constructor(readonly reader: NetQuakeDemoReader, readonly remote: Q1RemotePresentation) {}
    close(): void { this.operation.close(); }
    private get ready(): boolean { return this.signon === 4 && this.remote.player !== null && this.remote.output !== null; }
    async advance(frame: Q1DemoFrame): Promise<Q1DemoProgress> {
        let records = 0;
        await this.operation.run(frame, async () => {
            if (this.primed) this.clock += frame.elapsedSeconds;
            do {
                if (this.ready && !frame.timedemo && this.clock <= this.remote.recordedSeconds) break;
                const record = this.reader.next();
                if (record === null) { this.operation.finish('eof'); break; }
                records++;
                const messages = this.decoder.decode(record.message).map(message => message.kind === 'cd-track' && this.reader.forcedTrack !== -1
                    ? { ...message, track: this.reader.forcedTrack & 255 } : message);
                for (const message of messages) if (message.kind === 'server-info') { this.signon = 0; this.primed = false; this.clock = 0; }
                await this.remote.receive(messages, this.clock * 1000, this.operation.assertCurrent);
                this.operation.assertCurrent();
                this.remote.setDemoViewAngles(record.viewAngles, true);
                for (const message of messages) {
                    if (message.kind === 'signon') {
                        if (message.stage <= this.signon || message.stage > 4) throw new Error(`Invalid demo signon stage ${message.stage} after ${this.signon}`);
                        this.signon = message.stage;
                    } else if (message.kind === 'entity' && this.signon === 3) this.signon = 4;
                    else if (message.kind === 'disconnect') this.operation.finish('recorded-disconnect');
                }
                if (!this.primed && this.ready) { this.clock = this.remote.recordedSeconds; this.primed = true; break; }
                if (this.ready && frame.timedemo) { this.clock = this.remote.recordedSeconds; break; }
            } while (this.operation.reason === null);
            this.operation.assertCurrent();
            this.remote.sampleDemo(this.clock);
        });
        const progress = { recordedSeconds: this.clock, recordsRead: records }, reason = this.operation.reason;
        return reason === null ? { ...progress, phase: this.ready ? 'active' : 'loading' } : { ...progress, phase: 'ended', reason };
    }
}

/** QWD uses timestamp groups and recorded netchannel headers, including command prediction history. */
export class QuakeWorldDemoInput {
    private readonly decoder = new QuakeWorldDecoder();
    private readonly operation = new DemoOperation();
    private pending: QuakeWorldDemoRecord | null;
    private data: QwServerData | null = null;
    private models: string[] = [];
    private sounds: string[] = [];
    private modelListComplete = false;
    private soundListComplete = false;
    private worldReady = false;
    private incoming = -1;
    private outgoing = 0;
    private acknowledged = -1;
    private clock: number;
    private readonly commands = new Map<number, Extract<QuakeWorldDemoRecord, { kind: 'command' }>>();
    constructor(readonly reader: QuakeWorldDemoReader, readonly remote: QwRemotePresentation) {
        this.pending = reader.next(); this.clock = this.pending?.seconds ?? 0;
    }
    close(): void { this.operation.close(); }
    private get ready(): boolean { return this.worldReady && this.remote.output !== null && this.remote.player !== null; }
    async advance(frame: Q1DemoFrame): Promise<Q1DemoProgress> {
        let records = 0;
        await this.operation.run(frame, async () => {
            this.clock += this.ready && !frame.timedemo ? frame.elapsedSeconds : 0;
            const group = this.pending?.seconds ?? this.clock;
            while (this.pending !== null && this.operation.reason === null) {
                const record = this.pending;
                if (!frame.timedemo && this.ready && this.clock + 1 < record.seconds) this.clock = record.seconds - 1;
                if (frame.timedemo ? record.seconds > group : this.ready && record.seconds > this.clock) break;
                if (frame.timedemo || !this.ready) this.clock = record.seconds;
                records++;
                if (record.kind === 'sequences') {
                    this.outgoing = record.outgoing; this.incoming = record.incoming;
                } else if (record.kind === 'command') {
                    this.remote.shared.setDemoViewAngles(record.viewAngles, false);
                    this.commands.set(this.outgoing++, record);
                    while (this.commands.size > 64) { const first = this.commands.keys().next(); if (!first.done) this.commands.delete(first.value); }
                    this.replayCommands();
                } else await this.packet(record);
                this.operation.assertCurrent();
                this.pending = this.operation.reason === null ? this.reader.next() : null;
            }
            if (this.pending === null) this.operation.finish('eof');
            this.remote.shared.sampleDemo(this.clock);
            this.remote.samplePresentation(this.clock * 1000);
        });
        const progress = { recordedSeconds: this.clock, recordsRead: records }, reason = this.operation.reason;
        return reason === null ? { ...progress, phase: this.ready ? 'active' : 'loading' } : { ...progress, phase: 'ended', reason };
    }
    private replayCommands(): void {
        if (!this.ready) return;
        for (const [sequence, record] of this.commands) {
            if (sequence <= this.acknowledged) this.commands.delete(sequence);
            else this.remote.prediction.sent(sequence, record.command, record.seconds * 1000);
        }
    }
    private async packet(record: Extract<QuakeWorldDemoRecord, { kind: 'packet' }>): Promise<void> {
        if (record.message.length < 8) throw new Error('Truncated QWD netchannel header');
        const header = new DataView(record.message.buffer, record.message.byteOffset, record.message.byteLength);
        if (header.getInt32(0, true) === -1) return;
        const sequence = header.getUint32(0, true) & 0x7fffffff, acknowledged = header.getUint32(4, true) & 0x7fffffff;
        if (sequence <= this.incoming) return;
        this.incoming = sequence; this.acknowledged = acknowledged;
        this.remote.prediction.acknowledged(acknowledged, record.seconds * 1000);
        const messages = this.decoder.decode(record.message.subarray(8), sequence);
        for (const message of messages) {
            if (message.kind === 'server-data') {
                if (message.playerSlot >= 32 || message.spectator) throw new Error('QWD requires an admitted native player');
                this.data = message; this.models = []; this.sounds = []; this.modelListComplete = false; this.soundListComplete = false; this.worldReady = false; this.commands.clear();
                await this.remote.serverData(message); this.operation.assertCurrent();
            } else if (message.kind === 'model-list' || message.kind === 'sound-list') {
                if (this.data === null) throw new Error('QWD precache before serverdata');
                const list = message.kind === 'model-list' ? this.models : this.sounds;
                if (message.first !== list.length) throw new Error('Non-contiguous QWD precache list');
                list.push(...message.names);
                if (message.next === 0) {
                    if (message.kind === 'model-list') this.modelListComplete = true;
                    else this.soundListComplete = true;
                }
                if (!this.worldReady && this.modelListComplete && this.soundListComplete) {
                    await this.remote.gameState(this.data, this.models, this.sounds, this.operation.assertCurrent);
                    this.operation.assertCurrent(); this.worldReady = true;
                }
            }
        }
        await this.remote.receive(messages, record.seconds * 1000, this.operation.assertCurrent);
        this.operation.assertCurrent(); this.replayCommands();
        if (messages.some(message => message.kind === 'disconnect')) this.operation.finish('recorded-disconnect');
    }
}
