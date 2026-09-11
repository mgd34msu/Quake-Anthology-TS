// Client signon and server signon/download progression from Quake/QW. GPL-2.0-or-later.
import type { DownloadSource } from '../services/downloads.ts';
import { downloadPath } from '../services/downloads.ts';
import { MessageReader, SizeBuf, MSG_WriteByte, MSG_WriteString, SZ_Write } from './message.ts';
import type { QuakeWorldProfile } from './profile.ts';
import { createQuakeWorldCodec } from './profile.ts';
import { quakeWorldCommandArguments } from './handshake.ts';
import type { QuakeWorldMessage } from './quakeworld.ts';
import { writeQuakeWorldServerData, writeQuakeWorldDownload } from './quakeworld.ts';
export function writeClientStringCommand(s: SizeBuf, text: string): void { MSG_WriteByte(s, 4); MSG_WriteString(s, text); }
function stuff(s: SizeBuf, text: string): void { MSG_WriteByte(s, 9); MSG_WriteString(s, text); }
export interface NetQuakeSeatIdentity {
    readonly name: string;
    readonly color: number;
    readonly spawnParameters: string;
    readonly extensionFlags: number | null;
}
export class NetQuakeSignon {
    stage = 0;
    constructor(readonly seat: NetQuakeSeatIdentity) { }
    receive(stage: number): Uint8Array {
        if (stage <= this.stage || stage > 4)
            throw new Error(`Invalid signon stage ${stage} after ${this.stage}`);
        this.stage = stage;
        const s = new SizeBuf(8000);
        switch (stage) {
            case 1:
                writeClientStringCommand(s, 'prespawn');
                break;
            case 2:
                writeClientStringCommand(s, `name "${this.seat.name}"\n`);
                writeClientStringCommand(s, `color ${this.seat.color >> 4} ${this.seat.color & 15}\n`);
                if (this.seat.extensionFlags !== null)
                    writeClientStringCommand(s, `ex_flags ${this.seat.extensionFlags}\n`);
                writeClientStringCommand(s, `spawn ${this.seat.spawnParameters}`);
                break;
            case 3:
                writeClientStringCommand(s, 'begin');
                break;
        }
        return s.bytes();
    }
    firstEntity(): void {
        if (this.stage === 3)
            this.stage = 4;
    }
    get active(): boolean { return this.stage === 4; }
}
export interface QuakeWorldSignonHost {
    serverData(): Extract<QuakeWorldMessage, {
        kind: 'server-data';
    }>;
    models(): readonly string[];
    sounds(): readonly string[];
    signonBuffers(): readonly Uint8Array[];
    acceptsMapChecksum(checksum: number): boolean;
    /** Returns engine-produced scoreboard/lightstyles/stats, after real actor initialization. */
    spawn(startClient: number): readonly Uint8Array[];
    begin(): void;
    disconnect(reason: string): void;
    /** The caller applies corpus/mount permissions and opens the source through shared storage. */
    openDownload(path: string): DownloadSource | null;
}
export class QuakeWorldSignonServer {
    private phase: 'connected' | 'spawned' = 'connected';
    private download: DownloadSource | null = null;
    private downloadOffset = 0;
    constructor(readonly host: QuakeWorldSignonHost, readonly donorWide: boolean) { }
    private fresh(): readonly Uint8Array[] {
        const data = this.host.serverData();
        if (data.protocol.version === 29 && !this.donorWide) {
            this.host.disconnect('Client does not support donor QuakeWorld protocol 29');
            return [];
        }
        this.phase = 'connected';
        const sb = new SizeBuf(1450);
        writeQuakeWorldServerData(sb, data);
        return [sb.bytes()];
    }
    command(text: string): {
        readonly kind: 'handled';
        readonly messages: readonly Uint8Array[];
    } | {
        readonly kind: 'game-command';
        readonly text: string;
    } {
        const args = quakeWorldCommandArguments(text), op = args[0], data = this.host.serverData();
        if (op === 'new')
            return { kind: 'handled', messages: this.phase === 'spawned' ? [] : this.fresh() };
        if (op === 'download') {
            this.download?.close();
            this.download = null;
            const path = args[1] ?? '';
            try {
                downloadPath(path);
                this.download = this.host.openDownload(path);
            }
            catch {
                this.download = null;
            }
            this.downloadOffset = 0;
            return { kind: 'handled', messages: [this.nextDownload()] };
        }
        if (op === 'nextdl')
            return { kind: 'handled', messages: this.download === null ? [] : [this.nextDownload()] };
        if (op !== 'soundlist' && op !== 'modellist' && op !== 'prespawn' && op !== 'spawn' && op !== 'begin')
            return { kind: 'game-command', text };
        if (this.phase === 'spawned')
            return { kind: 'handled', messages: [] };
        if (Number.parseInt(args[1] ?? '', 10) !== data.serverCount)
            return { kind: 'handled', messages: this.fresh() };
        const s = new SizeBuf(1450), c = createQuakeWorldCodec(data.protocol, new MessageReader(new Uint8Array(0))), start = Number.parseInt(args[2] ?? '0', 10);
        if (op === 'soundlist' || op === 'modellist') {
            const names = op === 'soundlist' ? this.host.sounds() : this.host.models();
            if (!Number.isInteger(start) || start < 0 || start >= c.maxPrecache || start > names.length)
                return { kind: 'handled', messages: this.fresh() };
            MSG_WriteByte(s, op === 'soundlist' ? 46 : 45);
            c.writePrecacheCount(s, start);
            let next = start;
            while (next < names.length && s.cursize < 725) {
                const name = names[next];
                if (name === undefined)
                    break;
                if (next + 1 >= c.maxPrecache)
                    throw new RangeError('Selected QW profile cannot represent precache');
                MSG_WriteString(s, name);
                next++;
            }
            MSG_WriteByte(s, 0);
            c.writePrecacheCount(s, next < names.length ? next : 0);
            return { kind: 'handled', messages: [s.bytes()] };
        }
        if (op === 'prespawn') {
            const buffers = this.host.signonBuffers(), index = Number.isInteger(start) && start >= 0 && start < buffers.length ? start : 0;
            if (index === 0 && !this.host.acceptsMapChecksum(Number.parseInt(args[3] ?? '0', 10) >>> 0)) {
                this.host.disconnect('Map model file does not match');
                return { kind: 'handled', messages: [] };
            }
            const bytes = buffers[index];
            if (bytes !== undefined)
                SZ_Write(s, bytes);
            stuff(s, index + 1 >= buffers.length ? `cmd spawn ${data.serverCount} 0\n` : `cmd prespawn ${data.serverCount} ${index + 1}\n`);
            return { kind: 'handled', messages: [s.bytes()] };
        }
        if (op === 'spawn') {
            if (!Number.isInteger(start) || start < 0 || start > 32)
                return { kind: 'handled', messages: this.fresh() };
            const messages = this.host.spawn(start);
            stuff(s, `skins\n`);
            return { kind: 'handled', messages: [...messages, s.bytes()] };
        }
        this.host.begin();
        this.phase = 'spawned';
        return { kind: 'handled', messages: [] };
    }
    private nextDownload(): Uint8Array {
        const s = new SizeBuf(1450), source = this.download;
        if (source === null)
            writeQuakeWorldDownload(s, { kind: 'missing' });
        else {
            const bytes = source.read(this.downloadOffset, 768);
            this.downloadOffset += bytes.length;
            writeQuakeWorldDownload(s, { kind: 'data', bytes, percent: Math.trunc(this.downloadOffset * 100 / (source.byteLength || 1)) });
            if (this.downloadOffset === source.byteLength) {
                source.close();
                this.download = null;
            }
        }
        return s.bytes();
    }
    close(): void { this.download?.close(); this.download = null; }
}
export class QuakeWorldPrecacheClient {
    serverCount = 0;
    readonly models: string[] = [];
    readonly sounds: string[] = [];
    receive(message: QuakeWorldMessage): readonly string[] {
        switch (message.kind) {
            case 'server-data':
                this.serverCount = message.serverCount;
                this.models.length = 0;
                this.sounds.length = 0;
                return [`soundlist ${this.serverCount} 0`];
            case 'sound-list':
            case 'model-list': {
                const target = message.kind === 'sound-list' ? this.sounds : this.models;
                if (message.first > target.length)
                    throw new Error('Precache list skipped entries');
                target.splice(message.first, target.length - message.first, ...message.names);
                if (message.next !== 0)
                    return [`${message.kind === 'sound-list' ? 'soundlist' : 'modellist'} ${this.serverCount} ${message.next}`];
                return [];
            }
            default: return [];
        }
    }
    soundsReady(): string { return `modellist ${this.serverCount} 0`; }
    modelsReady(checksum: number): string { return `prespawn ${this.serverCount} 0 ${checksum >>> 0}`; }
    skinsReady(): string { return `begin ${this.serverCount}`; }
}
export function chooseQuakeWorldProtocol(mode: 28 | 29 | 'auto', needsWide: boolean): QuakeWorldProfile { return mode === 29 || (mode === 'auto' && needsWide) ? { kind: 'q1-quakeworld-donor-wide', version: 29, flags: 130 } : { kind: 'q1-quakeworld', version: 28 }; }
