/* QW cl_main.c, cl_parse.c and cl_input.c. GPL-2.0-or-later. */
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { QwUserCommand } from '../../../contracts/protocol.ts';
import type { IpAddress } from '../../../network/common/endpoint.ts';
import { sameAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { QuakeWorldChannel } from '../../../network/q1/channels.ts';
import { QuakeWorldConnectClient, quakeWorldCommandArguments, quakeWorldInfo } from '../../../network/q1/handshake.ts';
import { QuakeWorldDecoder } from '../../../network/q1/quakeworld.ts';
import type { QuakeWorldMessage } from '../../../network/q1/quakeworld.ts';
import { writeQuakeWorldMove } from '../../../network/q1/commands.ts';
import { SizeBuf, MSG_WriteByte } from '../../../network/q1/message.ts';
import { writeClientStringCommand } from '../../../network/q1/session.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { QwApplicationClientHost, QwServerData } from './qw-types.ts';
const idle: QwUserCommand = { kind: 'q1-quakeworld', milliseconds: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
export interface QwClientNetworkOptions {
    readonly transport: DatagramTransport<IpAddress>;
    readonly remote: IpAddress;
    readonly host: QwApplicationClientHost;
    readonly qport: number;
    readonly userinfo: () => string;
    readonly timeoutMilliseconds?: number;
}
export class QwClientNetwork implements ApplicationNetwork {
    readonly role = 'client';
    readonly wire: ApplicationNetwork['wire'] = { kind: 'source', protocol: { kind: 'q1-quakeworld', version: 28 } };
    private handshake: QuakeWorldConnectClient;
    private userinfo = '';
    private skinPassPending = false;
    private begun = false;
    private readonly channel;
    private readonly decoder = new QuakeWorldDecoder();
    private state: ApplicationNetworkPhase = 'connecting';
    private connected = false;
    private lastReceived: number | null = null;
    private lastSent = -Infinity;
    private data: QwServerData | null = null;
    private models: string[] = [];
    private sounds: string[] = [];
    private downloads: { paths: readonly string[]; category: 'sound' | 'model' | 'skin'; index: number } | null = null;
    private lastDelta: number | null = null;
    private oldest = idle;
    private previous = idle;
    private readonly commands = new Map<number, QwUserCommand>();
    constructor(readonly options: QwClientNetworkOptions) {
        this.handshake = new QuakeWorldConnectClient(options.qport, '');
        this.channel = new QuakeWorldChannel('client', options.qport);
    }
    get phase(): ApplicationNetworkPhase { return this.state; }
    command(text: string): void {
        if (!this.connected) throw new Error('QuakeWorld client is not connected');
        const bytes = new SizeBuf(1450); writeClientStringCommand(bytes, text); this.channel.queueReliable(bytes.bytes());
    }
    async refreshSkins(): Promise<void> {
        this.skinPassPending = true;
        if (this.downloads !== null || this.data === null) return;
        this.skinPassPending = false;
        this.options.host.skins?.loading(true);
        this.downloads = { paths: this.options.host.skins?.names() ?? [], category: 'skin', index: 0 };
        await this.resumeDownloads();
    }
    private syncUserinfo(): void {
        const text = this.options.userinfo();
        if (/["\n\r]/.test(text)) throw new Error('Invalid QW userinfo');
        if (text === this.userinfo) return;
        if (this.connected) {
            const previous = quakeWorldInfo(this.userinfo), current = quakeWorldInfo(text);
            for (const key of new Set([...previous.keys(), ...current.keys()])) {
                const value = current.get(key) ?? '';
                if (previous.get(key) !== value) this.command(`setinfo "${key}" "${value}"`);
            }
        } else {
            const handshake = new QuakeWorldConnectClient(this.options.qport, text);
            handshake.state = this.handshake.state; this.handshake = handshake;
        }
        this.userinfo = text;
    }
    async resumeDownloads(): Promise<void> {
        const queue = this.downloads, data = this.data;
        if (queue === null || data === null) return;
        while (queue.index < queue.paths.length) {
            const path = queue.paths[queue.index++];
            if (path === undefined || path.startsWith('*')) continue;
            if (await this.options.host.downloads?.request(path, queue.category) === 'waiting') return;
        }
        this.downloads = null;
        if (queue.category === 'sound') this.command(`modellist ${data.serverCount} 0`);
        else if (queue.category === 'model') {
            const checksum = await this.options.host.gameState(data, this.models, this.sounds);
            this.command(`prespawn ${data.serverCount} 0 ${checksum | 0}`);
        } else {
            if (this.skinPassPending) { await this.refreshSkins(); return; }
            this.options.host.skins?.loading(false);
            await this.options.host.skins?.prepare();
            if (!this.begun && this.state !== 'active') { this.command(`begin ${data.serverCount}`); this.begun = true; }
        }
    }
    private async records(messages: readonly QuakeWorldMessage[], now: number): Promise<boolean> {
        for (const message of messages) {
            if (message.kind === 'server-data') {
                if (message.protocol.kind !== 'q1-quakeworld' || message.playerSlot >= 32) throw new Error('Remote QW requires native protocol 28 and a valid player slot');
                if (message.gameDirectory !== 'id1' && message.gameDirectory !== 'qw') throw new Error('This QW client supports base id1 and qw game directories');
                if (message.spectator) throw new Error('QW spectator presentation is not supported');
                this.options.host.downloads?.close();
                await this.options.host.serverData(message);
                this.data = message; this.models = []; this.sounds = []; this.skinPassPending = false; this.begun = false; this.lastDelta = null; this.commands.clear(); this.oldest = idle; this.previous = idle; this.state = 'loading'; this.downloads = null;
                this.command(`soundlist ${message.serverCount} 0`);
            } else if (message.kind === 'sound-list' || message.kind === 'model-list') {
                const data = this.data; if (data === null) throw new Error('QW list before serverdata');
                const list = message.kind === 'sound-list' ? this.sounds : this.models;
                if (message.first !== list.length) throw new Error('Non-contiguous QW precache list');
                list.push(...message.names);
                if (message.next !== 0) this.command(`${message.kind === 'sound-list' ? 'soundlist' : 'modellist'} ${data.serverCount} ${message.next}`);
                else { this.downloads = { paths: message.kind === 'sound-list' ? list.map(name => `sound/${name}`) : list, category: message.kind === 'sound-list' ? 'sound' : 'model', index: 0 }; await this.resumeDownloads(); }
            } else if (message.kind === 'download') {
                const result = await this.options.host.downloads?.receive(message.result);
                if (result === undefined) throw new Error('Unsolicited QW download');
                if (result !== 'waiting') await this.resumeDownloads();
            } else if (message.kind === 'stufftext') {
                for (const line of message.text.split('\n')) {
                    const args = quakeWorldCommandArguments(line), name = args[0];
                    if (name === 'cmd' && (args[1] === 'prespawn' || args[1] === 'spawn') && args.slice(2).every(value => /^\d+$/.test(value)) && Number(args[2]) === this.data?.serverCount) this.command(args.slice(1).join(' '));
                    else if (name === 'skins') this.skinPassPending = true;
                    else if (name === 'reconnect') { this.state = 'loading'; this.command('new'); }
                    else if (name !== undefined && name !== 'fullserverinfo') this.options.host.print(`Unhandled QW server command: ${line}\n`);
                }
            } else if (message.kind === 'packet-entities') { this.lastDelta = message.sequence; this.state = 'active'; }
            else if (message.kind === 'invalid-delta') this.lastDelta = null;
            else if (message.kind === 'disconnect') { this.state = 'closed'; this.options.host.disconnected('Server disconnected'); }
        }
        await this.options.host.receive(messages, now);
        if (this.skinPassPending && this.downloads === null) await this.refreshSkins();
        return this.state === 'closed';
    }
    async poll(now: number): Promise<readonly ActorCommand[]> {
        if (this.state === 'closed' || this.state === 'rejected') return [];
        this.lastReceived ??= now;
        this.syncUserinfo();
        if (!this.connected) { const bytes = this.handshake.next(now); if (bytes !== null) this.options.transport.send(this.options.remote, bytes); }
        for (;;) {
            const packet = this.options.transport.poll(); if (packet === null) break;
            if (packet.kind !== 'packet' || !sameAddress(packet.from, this.options.remote)) continue;
            const oob = packet.payload.length >= 4 && new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength).getInt32(0, true) === -1;
            if (!this.connected) {
                if (!oob) continue;
                this.handshake.receive(packet.payload);
                if (this.handshake.state.kind === 'rejected') { this.state = 'rejected'; this.options.host.disconnected(this.handshake.state.reason); return []; }
                if (this.handshake.state.kind === 'connected') { this.connected = true; this.state = 'loading'; this.lastReceived = now; this.transmit(new Uint8Array(0), now); this.command('new'); }
                continue;
            }
            if (oob) continue;
            const delivery = this.channel.receive(packet.payload, now); if (delivery === null) continue;
            this.lastReceived = now;
            this.options.host.prediction?.acknowledged(delivery.acknowledged, now);
            const closed = await this.records(this.decoder.decode(delivery.payload, delivery.sequence), now);
            if (closed) return [];
        }
        if (now - this.lastReceived > (this.options.timeoutMilliseconds ?? 120000)) { this.state = 'rejected'; this.options.host.disconnected('Connection timed out'); return []; }
        if (this.connected && this.channel.canPacket(now) && (this.state !== 'active' || now - this.lastSent >= 1000)) this.transmit(new Uint8Array(0), now);
        return [];
    }
    private transmit(bytes: Uint8Array, now: number): void {
        this.lastSent = now;
        this.options.transport.send(this.options.remote, this.channel.transmit(bytes, now));
    }
    submit(commands: readonly ActorCommand[], now: number): void {
        if (this.state !== 'active') return;
        if (commands.length > 1) throw new Error('A QW connection carries one player');
        for (const input of commands) {
            const command = this.options.host.command(input), sequence = this.channel.outgoingSequence;
            const bytes = new SizeBuf(256);
            this.oldest = this.commands.get(sequence - 2) ?? idle;
            this.previous = this.commands.get(sequence - 1) ?? idle;
            writeQuakeWorldMove(bytes, { kind: 'q1-quakeworld', version: 28 }, { oldest: this.oldest, previous: this.previous, current: command, lossPercent: 0 }, sequence);
            const delta = this.lastDelta !== null && sequence - this.lastDelta < 63 ? this.lastDelta : null;
            if (delta !== null) { MSG_WriteByte(bytes, 5); MSG_WriteByte(bytes, delta & 255); }
            this.decoder.recordDeltaRequest(sequence, delta);
            this.commands.set(sequence, command);
            this.options.host.prediction?.sent(sequence, command, now);
            for (const old of this.commands.keys()) if (old <= sequence - 64) this.commands.delete(old);
            this.transmit(bytes.bytes(), now);
        }
    }
    publish(_output: SimulationOutput, _events: readonly SimulationPresentationEvent[], _now: number): void { throw new Error('Remote client cannot publish authoritative state'); }
    close(): void {
        if (this.options.transport.closed) return;
        if (this.connected && this.state !== 'closed') { this.command('drop'); this.transmit(new Uint8Array(0), performance.now()); }
        this.options.host.downloads?.close(); this.state = 'closed'; this.options.transport.close();
    }
}
