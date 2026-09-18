import type { Q2ServerRecord } from "../../../network/q2/server-messages.ts";
import { readQ2Demo, readQ2DemoHeader, type Q2DemoHeader } from '../../../network/q2/demo.ts';
import { MVD_MAGIC } from '../../../network/q2/codecs/mvd.ts';
import { MVD_MAX_MESSAGE } from '../../../network/q2/mvd-recording.ts';
import { readMvdHeader, type MvdHeader } from '../../../network/q2/mvd-profile.ts';
import { MvdPlayback, type MvdVisibility } from '../../../network/q2/mvd-playback.ts';
import { Q2ClientReceiver, type Q2ClientReceiverHost } from './q2-client-receiver.ts';


function isMvd(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === MVD_MAGIC;
}
function* readMvdFile(bytes: Uint8Array): Generator<{ readonly offset: number; readonly bytes: Uint8Array }, void, unknown> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;
    while (offset < bytes.length) {
        if (offset + 2 > bytes.length) throw new Error('Truncated MVD record header');
        const start = offset, length = view.getUint16(offset, true); offset += 2;
        if (length === 0) { if (offset !== bytes.length) throw new Error('Data after MVD terminator'); return; }
        if (length > MVD_MAX_MESSAGE || offset + length > bytes.length) throw new Error('Truncated or oversized MVD packet');
        yield { offset: start, bytes: bytes.subarray(offset, offset + length) }; offset += length;
    }
    throw new Error('MVD recording lacks its terminator');
}
export type Q2PlaybackHeader = ({ readonly kind: 'dm2' } & Q2DemoHeader)
    | { readonly kind: 'mvd'; readonly protocol: MvdHeader['protocol']; readonly data: MvdHeader['data']; readonly profile: MvdHeader };
export function readQ2PlaybackHeader(bytes: Uint8Array): Q2PlaybackHeader {
    if (!isMvd(bytes)) return { kind: 'dm2', ...readQ2DemoHeader(bytes) };
    const record = readMvdFile(bytes).next();
    if (record.done) throw new Error('MVD recording has no gamestate');
    const profile = readMvdHeader(record.value.bytes);
    return { kind: 'mvd', protocol: profile.protocol, data: profile.data, profile };
}
export interface Q2MvdPresentation {
    readonly visibility: MvdVisibility;
    selectView(clientnum: number): void;
}

export type Q2DemoAdvance = { readonly kind: 'frame'; readonly timeMilliseconds: number }
    | { readonly kind: 'eof' | 'disconnected' | 'closed' };

/** Recorded server frames, not dm2 block boundaries, determine playback time. */
export class Q2DemoPlayback {
    readonly receiver: Q2ClientReceiver;
    private readonly records: ReturnType<typeof readQ2Demo>;
    private readonly mvd: MvdPlayback | null;
    private readonly headerBytes: 2 | 4;
    private terminal: 'eof' | 'disconnected' | null = null;
    private closed = false;
    private advancing = false;
    private failure: { readonly error: unknown } | null = null;
    private offset = 0;
    private recordedPlayers: readonly number[] = [];
    private selectedSeat = 0;
    constructor(private readonly bytes: Uint8Array, host: Q2ClientReceiverHost, private readonly presentation?: Q2MvdPresentation, private readonly selectRecordedView?: (clientnum: number) => void) {
        if (isMvd(bytes)) {
            if (presentation === undefined) throw new Error('MVD playback requires source BSP visibility and viewer binding');
            this.mvd = new MvdPlayback(presentation.visibility); this.records = readMvdFile(bytes); this.headerBytes = 2;
        } else { this.mvd = null; this.records = readQ2Demo(bytes); this.headerBytes = 4; }
        this.receiver = new Q2ClientReceiver({
            protocol: host.protocol, messageOptions: host.messageOptions,
            serverData: async (data, current) => {
                this.recordedPlayers = data.clientnums ?? [data.clientnum];
                if (this.selectedSeat >= this.recordedPlayers.length) this.selectedSeat = 0;
                await host.serverData?.(data, current);
            },
            gameState: state => host.gameState(state),
            frame: (frame, records, now) => {
                if (this.mvd !== null) { host.frame(frame, records, now); return; }
                const selected = this.recordedPlayers[this.selectedSeat];
                if (selected === undefined) throw new Error('Recorded viewpoint has no source player');
                const split = this.selectedSeat === 0 ? null : frame.splitPlayers?.[this.selectedSeat - 1];
                if (this.selectedSeat !== 0 && split === undefined) throw new Error('Recorded viewpoint has no player state');
                this.selectRecordedView?.(selected);
                host.frame(split == null ? frame : { ...frame, player: split.player, areaBits: split.areaBits }, this.viewRecords(records), now);
            },
            records: records => host.records(this.viewRecords(records)),
            disconnected: reason => host.disconnected(reason), print: text => host.print(text),
        }, { kind: 'demo' });
    }
    selectPlayer(clientnum: number): void {
        if (this.mvd !== null) { this.mvd.selectPlayer(clientnum); return; }
        const seat = this.recordedPlayers.indexOf(clientnum);
        if (seat < 0) throw new Error('Player has no viewpoint in this recording');
        this.selectedSeat = seat;
    }
    private viewRecords(records: readonly Q2ServerRecord[]): readonly Q2ServerRecord[] {
        if (this.mvd !== null) return records;
        return records.filter(record => {
            switch (record.event.kind) {
                case 'layout': case 'inventory': case 'center-print': case 'damage': case 'fog': case 'poi': case 'help-path': case 'localized-print':
                    return record.seat === 0 || record.seat === this.selectedSeat + 1;
                default: return true;
            }
        });
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
                    if (this.offset < this.bytes.length) this.offset += this.headerBytes;
                    // Let the final decoded frame be presented before the owner handles EOF.
                    return delivered && time !== null ? { kind: 'frame', timeMilliseconds: time } : { kind: 'eof' };
                }
                this.offset = next.value.offset + this.headerBytes + next.value.bytes.length;
                const generation = this.receiver.worldGeneration;
                if (this.mvd === null) await this.receiver.receive(next.value.bytes, 0);
                else for (const record of this.mvd.readRecords(next.value.bytes)) {
                    if (record.event.kind === 'frame') this.presentation?.selectView(this.mvd.selectedPlayer);
                    await this.receiver.receiveRecords([record], 0);
                    if (this.closed) return { kind: 'closed' };
                }
                if (time !== null && this.receiver.worldGeneration !== generation) target = null;
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
