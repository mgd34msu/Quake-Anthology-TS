import type { Q2ApplicationClientDownloads } from './q2-downloads.ts';
import { parseQ2Token } from '../../../core/common-parse.ts';
import { Q2ServerMessageReader } from '../../../network/q2/index.ts';
import type { Q2ServerRecord, ServerDataParamsT } from '../../../network/q2/index.ts';
import type { Q2ApplicationClientHost, Q2ApplicationGameState } from './types.ts';
export type Q2ClientReceiverHost = Pick<Q2ApplicationClientHost, 'protocol' | 'messageOptions' | 'serverData' | 'gameState' | 'frame' | 'records' | 'disconnected' | 'print'>;
export type Q2ClientReceiverSource = { readonly kind: 'demo' } | {
    readonly kind: 'network';
    readonly downloads?: Q2ApplicationClientDownloads;
    command(text: string): void;
    resetCommands(): void;
    closed(): boolean;
};
function tokens(text: string): readonly string[] {
    const cursor = { data: text, index: 0 }, result: string[] = [];
    while (cursor.index < text.length) {
        const before = cursor.index, value = parseQ2Token(cursor);
        if (cursor.index === before)
            break;
        result.push(value);
    }
    return result;
}
function integer(text: string | undefined): number {
    if (text === undefined || !/^-?\d+$/.test(text))
        throw new Error('Invalid Q2 signon number');
    const result = Number(text);
    if (!Number.isSafeInteger(result))
        throw new Error('Q2 signon number outside range');
    return result;
}
export class Q2ClientReceiver {
    readonly reader: Q2ServerMessageReader;
    private state: 'loading' | 'active' | 'closed' = 'loading';
    private serverData: ServerDataParamsT | null = null;
    private lastFrame = -1;
    private recordedTime: number | null = null;
    private demoDisconnected = false;
    private pendingGameState: Q2ApplicationGameState | null = null;
    constructor(private readonly host: Q2ClientReceiverHost, private readonly source: Q2ClientReceiverSource) {
        this.reader = new Q2ServerMessageReader(host.protocol, { ...host.messageOptions, readMode: source.kind === 'demo' ? 'demo' : 'network' });
    }
    get phase(): 'loading' | 'active' | 'closed' { return this.state; }
    get acknowledgedFrame(): number { return this.lastFrame; }
    get worldGeneration(): number { return this.loadingGeneration; }
    get recordedTimeMilliseconds(): number | null { return this.recordedTime; }
    get disconnectedDemo(): boolean { return this.demoDisconnected; }
    async receive(bytes: Uint8Array, nowMilliseconds: number): Promise<void> {
        if (this.state === 'closed') return;
        await this.serverRecords(this.reader.read(bytes), nowMilliseconds);
    }
    close(): void { this.cancelLoading(); this.state = 'closed'; }
    private loadingGeneration = 0;
    private cancelLoading(): void {
        this.loadingGeneration++;
        this.pendingGameState = null;
        if (this.source.kind === 'network') this.source.downloads?.close();
    }
    private assertCurrent(generation: number): void {
        if (generation !== this.loadingGeneration || this.state === 'closed' || this.source.kind === 'network' && this.source.closed())
            throw new Error('Q2 server directory selection was retired');
    }
    async prepareGameState(): Promise<void> {
        const state = this.pendingGameState;
        if (state === null) return;
        const generation = this.loadingGeneration;
        const preparation = this.source.kind === 'network' ? await this.source.downloads?.prepare(state) ?? 'ready' : 'ready';
        this.assertCurrent(generation);
        if (this.pendingGameState !== state || preparation !== 'ready') return;
        await this.host.gameState(state);
        this.assertCurrent(generation);
        if (this.pendingGameState !== state) return;
        this.pendingGameState = null;
        if (this.source.kind === 'network') this.source.command(`begin ${state.data.servercount}`);
        this.state = 'active';
    }
    private async serverCommands(text: string): Promise<void> {
        for (const line of text.split(/\n|;/)) {
            const words = tokens(line), name = words[0];
            if (name === 'cmd' && (words[1] === 'configstrings' || words[1] === 'baselines'))
                { if (this.source.kind === 'network') this.source.command(words.slice(1).join(' ')); }
            else if (name === 'precache') {
                const data = this.serverData;
                if (data === null || (this.source.kind === 'network' || words[1] !== undefined) && integer(words[1]) !== data.servercount)
                    throw new Error('Q2 precache refers to another server generation');
                this.cancelLoading();
                this.pendingGameState = { data, configStrings: new Map(this.reader.configStrings), baselines: new Map(this.reader.history().baselines) };
                await this.prepareGameState();
            }
            else if (name === 'changing') {
                this.cancelLoading();
                this.lastFrame = -1;
                this.state = 'loading';
            }
            else if (name !== undefined && name !== '')
                this.host.print(`Server command requires application binding: ${line}\n`);
        }
    }
    private async serverRecords(records: readonly Q2ServerRecord[], now: number): Promise<void> {
        for (const record of records) {
            switch (record.event.kind) {
                case 'server-data': {
                    this.cancelLoading();
                    const generation = this.loadingGeneration;
                    const assertCurrent = (): void => this.assertCurrent(generation);
                    await this.host.serverData?.(record.event.data, assertCurrent);
                    assertCurrent();
                    this.serverData = record.event.data;
                    this.lastFrame = -1;
                    this.recordedTime = null;
                    if (this.source.kind === 'network') this.source.resetCommands();
                    this.state = 'loading';
                    break;
                }
                case 'command-text':
                    await this.serverCommands(record.event.text);
                    if (this.state === 'closed') return;
                    break;
                case 'frame':
                    this.lastFrame = record.event.frame.valid === false ? -1 : record.event.frame.serverFrame;
                    if (record.event.frame.valid !== false) {
                        this.recordedTime = record.event.frame.serverFrame * (1000 / (this.serverData?.serverFps ?? 10));
                        this.host.frame(record.event.frame, records, this.source.kind === 'demo' ? this.recordedTime : now);
                    }
                    break;
                case 'disconnect':
                    this.cancelLoading();
                    this.state = 'closed';
                    if (this.source.kind === 'demo') {
                        this.demoDisconnected = true;
                        this.host.records(records.slice(0, records.indexOf(record) + 1));
                        return;
                    }
                    this.host.disconnected('Server disconnected');
                    break;
                case 'reconnect':
                    this.cancelLoading();
                    this.lastFrame = -1;
                    this.state = 'loading';
                    if (this.source.kind === 'network') this.source.command('new');
                    break;
                case 'print':
                    this.host.print(record.event.text);
                    break;
                case 'download':
                    if (this.source.kind === 'network' && this.source.downloads?.receive(record.event) === 'complete') await this.prepareGameState();
                    break;
                default: break;
            }
        }
        this.host.records(records);
    }
}
