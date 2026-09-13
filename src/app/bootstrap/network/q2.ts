import type { ClientId } from "../../../contracts/identity.ts";
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { WireSelection } from '../../../network/common/session.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import { addressKey, sameAddress } from '../../../network/common/endpoint.ts';
import { parseQ2Token } from '../../../core/common-parse.ts';
import { Q2Channel, Q2ChallengeTable, Q2ClientHandshake, Q2CommandReplay, Q2ServerMessageReader, Q2WireCodec, UsercmdT, encodeQ2ClientControl, encodeQ2Frame, encodeQ2Move, encodeQ2ServerEvent, q2OutOfBand, readQ2ClientMessages, readQ2Connect, readQ2OutOfBand } from '../../../network/q2/index.ts';
import type { Q2ChannelReceive, Q2ServerRecord, Q2ServerWriteEvent, Q2WireFrame, ServerDataParamsT } from '../../../network/q2/index.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase, Q2ApplicationGameState, Q2ApplicationPlayer, Q2ApplicationServerHost, Q2ClientNetworkOptions, Q2ServerNetworkOptions } from './types.ts';
import { Q2PeerDownload } from './q2-downloads.ts';
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
function joinPackets(packets: readonly Uint8Array[]): Uint8Array {
    const bytes = new Uint8Array(packets.reduce((length, packet) => length + packet.length, 0));
    let offset = 0;
    for (const packet of packets) {
        bytes.set(packet, offset);
        offset += packet.length;
    }
    return bytes;
}
interface ServerPeer<TAddress extends NetworkAddress> {
    readonly download: Q2PeerDownload;
    downloadFailure: string | null;
    remote: TAddress;
    player: Q2ApplicationPlayer;
    readonly channel: Q2Channel;
    readonly wire: Q2WireCodec;
    replay: Q2CommandReplay;
    readonly frames: Map<number, Q2WireFrame>;
    gameState: Q2ApplicationGameState | null;
    active: boolean;
    sequence: number;
    lastReceived: number;
    datagram: Uint8Array[];
    userinfo: string;
}
/** Native packet work surrounds the application's simulation step; it owns no game clock. */
export class Q2ServerNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
    readonly role = 'server';
    readonly wire: WireSelection;
    private ended = false;
    private readonly peers = new Map<string, ServerPeer<TAddress>>();
    private readonly challenges: Q2ChallengeTable;
    private pending: ActorCommand[] = [];
    private host: Q2ApplicationServerHost;
    private serverGeneration = 1;
    constructor(readonly options: Q2ServerNetworkOptions<TAddress>) {
        this.host = options.host;
        const supported = options.host.supportsSourceWire();
        if (supported.kind === 'unsupported')
            throw new Error(`Native Q2 wire is unavailable: ${supported.reasons.join('; ')}`);
        if (options.host.protocol.kind === 'q2-kex' || options.host.protocol.kind === 'q2-kex-demo')
            throw new Error('KEX native live transport is unbound');
        this.wire = { kind: 'source', protocol: options.host.protocol };
        this.challenges = new Q2ChallengeTable(options.random);
    }
    get phase(): ApplicationNetworkPhase { return this.ended ? 'closed' : 'active'; }
    get clients(): readonly Q2ApplicationPlayer[] { return [...this.peers.values()].map(peer => peer.player); }
    changeWorld(host: Q2ApplicationServerHost): void {
        const support = host.supportsSourceWire();
        if (support.kind === 'unsupported')
            throw new Error(`Native Q2 map transition is unavailable: ${support.reasons.join('; ')}`);
        if (host.protocol.kind !== this.host.protocol.kind || host.protocol.version !== this.host.protocol.version)
            throw new Error('Native Q2 map transition cannot change protocol');
        const players = [...this.peers.values()].map(peer => ({ peer, player: host.carriedPlayer(peer.player.client) }));
        this.host = host;
        this.serverGeneration++;
        this.pending = [];
        for (const { peer, player } of players) {
            this.closeDownload(peer);
            peer.player = player;
            this.host.userinfo(player, peer.userinfo);
            peer.active = false;
            peer.frames.clear();
            peer.gameState = null;
            peer.replay = new Q2CommandReplay();
            peer.datagram = [];
            this.stuff(peer, 'changing\n');
            this.reliable(peer, { kind: 'reconnect' });
        }
    }
    private reply(remote: TAddress, text: string): void { this.options.transport.send(remote, q2OutOfBand(text)); }
    disconnectClient(client: ClientId, reason: string): boolean {
        const peer = [...this.peers.values()].find(peer => peer.player.client.equals(client));
        if (peer === undefined) return false;
        try {
            this.reliable(peer, { kind: 'disconnect' });
            peer.channel.send(this.options.transport, peer.remote, new Uint8Array(0), performance.now());
        } finally { this.drop(peer, reason); }
        return true;
    }
    private drop(peer: ServerPeer<TAddress>, reason: string): void {
        this.closeDownload(peer);
        this.peers.delete(addressKey(peer.remote));
        this.pending = this.pending.filter(command => command.source.kind !== 'remote-client' || !command.source.client.equals(peer.player.client));
        this.host.disconnect(peer.player, reason);
    }
    private connectionless(remote: TAddress, bytes: Uint8Array, now: number): boolean {
        const message = readQ2OutOfBand(bytes);
        if (message === null)
            return false;
        switch (message.command) {
            case 'getchallenge':
                this.options.transport.send(remote, this.challenges.reply(remote, now, [this.host.protocol]));
                break;
            case 'ping':
                this.reply(remote, 'ack');
                break;
            case 'connect': {
                const request = readQ2Connect(message);
                if (request.protocol.version !== this.host.protocol.version) {
                    this.reply(remote, 'print\nUnsupported protocol.\n');
                    break;
                }
                if (!this.challenges.validate(remote, request.challenge)) {
                    this.reply(remote, 'print\nBad challenge.\n');
                    break;
                }
                const existing = this.peers.get(addressKey(remote));
                if (existing !== undefined) {
                    this.reply(remote, 'client_connect');
                    break;
                }
                if (this.peers.size >= this.host.maxClients) {
                    this.reply(remote, 'print\nServer is full.\n');
                    break;
                }
                const admitted = this.host.admit(remote, request);
                if (admitted.kind === 'rejected') {
                    this.reply(remote, `print\n${admitted.reason}\n`);
                    break;
                }
                const protocol = request.protocol;
                const peer: ServerPeer<TAddress> = { remote, player: admitted.player, download: new Q2PeerDownload(), downloadFailure: null,
                    channel: new Q2Channel({ side: 'server', protocol, channel: request.channel, qport: request.qport, payloadBytes: request.payloadBytes, compress: request.compression }),
                    wire: new Q2WireCodec(protocol), replay: new Q2CommandReplay(), frames: new Map<number, Q2WireFrame>(), gameState: null, active: false, sequence: 0, lastReceived: now, datagram: [], userinfo: request.userinfo };
                this.peers.set(addressKey(remote), peer);
                this.reply(remote, 'client_connect');
                break;
            }
            default: return true;
        }
        return true;
    }
    private reliable(peer: ServerPeer<TAddress>, event: Q2ServerWriteEvent): void { peer.channel.queueReliable(encodeQ2ServerEvent(peer.wire, event)); }
    private stuff(peer: ServerPeer<TAddress>, text: string): void { this.reliable(peer, { kind: 'command-text', text }); }
    private closeDownload(peer: ServerPeer<TAddress>): void { peer.download.close(); peer.downloadFailure = null; }
    private beginDownload(peer: ServerPeer<TAddress>, name: string, offset: string | undefined): void {
        const generation = this.serverGeneration;
        const pending = peer.download.begin(this.host.downloads, name, offset), revision = peer.download.revision;
        const current = (): boolean => !this.ended && this.serverGeneration === generation && peer.download.revision === revision
            && this.peers.get(addressKey(peer.remote)) === peer;
        const failed = (error: unknown): void => { if (current()) peer.downloadFailure = error instanceof Error ? error.message : String(error); };
        // File completion can queue bounded wire bytes; only poll may drop an admitted player.
        void pending.then(event => {
            if (event === null || !current()) return;
            try { this.reliable(peer, event); } catch (error) { failed(error); }
        }, failed);
    }
    private newClient(peer: ServerPeer<TAddress>): void {
        this.closeDownload(peer);
        peer.active = false;
        peer.frames.clear();
        peer.replay = new Q2CommandReplay();
        peer.datagram = [];
        const original = this.host.gameState(peer.player), state = { ...original, data: { ...original.data, servercount: this.serverGeneration } };
        peer.gameState = state;
        this.reliable(peer, { kind: 'server-data', data: state.data });
        this.stuff(peer, `cmd configstrings ${state.data.servercount} 0\n`);
    }
    private signonPage(peer: ServerPeer<TAddress>, kind: 'configstrings' | 'baselines', start: number): void {
        const state = peer.gameState;
        if (state === null)
            throw new Error('Q2 signon has no game state');
        if (start < 0)
            throw new Error('Q2 signon index is negative');
        const entries = kind === 'configstrings'
            ? [...state.configStrings].filter(([index]) => index >= start).sort(([a], [b]) => a - b).map(([index, value]) => ({ index, bytes: encodeQ2ServerEvent(peer.wire, { kind: 'config-string', index, value }) }))
            : [...state.baselines].filter(([index]) => index >= start).sort(([a], [b]) => a - b).map(([index, entity]) => ({ index, bytes: encodeQ2ServerEvent(peer.wire, { kind: 'baseline', entity }) }));
        let length = 0, next: number | null = null;
        for (const entry of entries) {
            if (length + entry.bytes.length > peer.channel.capacity - 96) {
                next = entry.index;
                break;
            }
            peer.channel.queueReliable(entry.bytes);
            length += entry.bytes.length;
        }
        if (next !== null && length === 0)
            throw new Error('Q2 signon record exceeds negotiated reliable message capacity');
        if (next !== null)
            this.stuff(peer, `cmd ${kind} ${state.data.servercount} ${next}\n`);
        else if (kind === 'configstrings')
            this.stuff(peer, `cmd baselines ${state.data.servercount} 0\n`);
        else
            this.stuff(peer, `precache ${state.data.servercount}\n`);
    }
    private clientCommand(peer: ServerPeer<TAddress>, text: string): void {
        const words = tokens(text), name = words[0];
        if (name === undefined)
            return;
        if (name === 'disconnect') {
            this.drop(peer, 'Client disconnected');
            return;
        }
        if (name === 'new') {
            this.newClient(peer);
            return;
        }
        if (name === 'download') {
            this.beginDownload(peer, words[1] ?? '', words[2]);
            return;
        }
        if (name === 'nextdl') {
            const event = peer.download.next();
            if (event !== null) this.reliable(peer, event);
            return;
        }
        if (name === 'configstrings' || name === 'baselines' || name === 'begin') {
            const state = peer.gameState;
            if (state === null || integer(words[1]) !== state.data.servercount) {
                this.newClient(peer);
                return;
            }
            if (name === 'begin') {
                peer.active = true;
                return;
            }
            this.signonPage(peer, name, integer(words[2]));
            return;
        }
        if (peer.active)
            this.host.command(peer.player, name, words.slice(1));
    }
    private process(peer: ServerPeer<TAddress>, result: Extract<Q2ChannelReceive, {
        kind: 'message';
    }>): void {
        const records = readQ2ClientMessages(peer.wire, result.bytes, result.sequence);
        for (const { event } of records) {
            switch (event.kind) {
                case 'move':
                case 'batch-move':
                    if (peer.active)
                        peer.replay.execute(event, result.dropped, command => this.pending.push(this.host.input(peer.player, command, peer.sequence++)));
                    break;
                case 'command':
                    this.clientCommand(peer, event.text);
                    if (this.peers.get(addressKey(peer.remote)) !== peer) return;
                    break;
                case 'userinfo':
                    this.host.userinfo(peer.player, event.text);
                    peer.userinfo = event.text;
                    break;
                case 'userinfo-delta':
                    this.host.command(peer.player, 'userinfo_delta', [event.delta.name, event.delta.value]);
                    break;
                case 'setting':
                    this.host.command(peer.player, 'set_setting', [String(event.setting.index), String(event.setting.value)]);
                    break;
                case 'nop': break;
            }
        }
    }
    async poll(nowMilliseconds: number): Promise<readonly ActorCommand[]> {
        if (this.ended)
            return [];
        for (const peer of this.peers.values()) if (peer.downloadFailure !== null) this.drop(peer, peer.downloadFailure);
        for (;;) {
            const packet = this.options.transport.poll();
            if (packet === null)
                break;
            if (packet.kind !== 'packet') {
                if (packet.kind === 'error')
                    this.host.print(`${packet.error.message}\n`);
                continue;
            }
            let peer = this.peers.get(addressKey(packet.from));
            try {
                if (this.connectionless(packet.from, packet.payload, nowMilliseconds))
                    continue;
                if (peer === undefined)
                    peer = [...this.peers.values()].find(candidate => sameAddress(candidate.remote, packet.from, false)
                        && packet.payload.length >= 10 && (candidate.channel.options.protocol.version === 34
                        ? new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint16(8, true) === candidate.channel.options.qport
                        : packet.payload[8] === (candidate.channel.options.qport & 255)));
                if (peer === undefined)
                    continue;
                const result = peer.channel.receive(packet.payload, nowMilliseconds);
                if (result.kind !== 'rejected')
                    peer.lastReceived = nowMilliseconds;
                if (result.kind === 'message') {
                    if (!sameAddress(peer.remote, packet.from)) {
                        this.peers.delete(addressKey(peer.remote));
                        peer.remote = packet.from;
                        this.peers.set(addressKey(peer.remote), peer);
                    }
                    this.process(peer, result);
                }
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                if (peer !== undefined)
                    this.drop(peer, reason);
                else
                    this.reply(packet.from, `print\n${reason}\n`);
            }
        }
        for (const peer of this.peers.values()) {
            if (nowMilliseconds - peer.lastReceived > (this.options.timeoutMilliseconds ?? 125000)) {
                this.drop(peer, 'Connection timed out');
                continue;
            }
            if (!peer.active && peer.channel.shouldUpdate(nowMilliseconds))
                peer.channel.send(this.options.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
        }
        const commands = this.pending;
        this.pending = [];
        return commands;
    }
    submit(_commands: readonly ActorCommand[], _nowMilliseconds: number): void { throw new Error('Q2 server commands must enter the authoritative application input batch'); }
    publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], nowMilliseconds: number): void {
        if (this.ended)
            return;
        this.host.observe(output, events);
        for (const peer of this.peers.values()) {
            if (!peer.active)
                continue;
            const frame = this.host.frame(peer.player, output);
            for (const event of this.host.events(peer.player, output, events)) {
                const reliable = event.reliable ?? (event.kind !== 'sound' && event.kind !== 'muzzle-flash' && event.kind !== 'temporary-entity');
                const bytes = encodeQ2ServerEvent(peer.wire, event);
                if (reliable)
                    peer.channel.queueReliable(bytes);
                else
                    peer.datagram.push(bytes);
            }
            if (peer.channel.fragmentPending) {
                peer.channel.send(this.options.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
                continue;
            }
            if (peer.frames.has(frame.serverFrame)) {
                if (peer.channel.shouldUpdate(nowMilliseconds))
                    peer.channel.send(this.options.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
                continue;
            }
            const old = peer.replay.lastFrame < 0 ? null : peer.frames.get(peer.replay.lastFrame) ?? null;
            const baseline = peer.gameState?.baselines;
            if (baseline === undefined)
                throw new Error('Active Q2 client has no baselines');
            const frameBytes = encodeQ2Frame(peer.wire, frame, old, baseline, this.host.maxClients);
            const datagram = joinPackets([frameBytes, ...peer.datagram]);
            peer.datagram = [];
            peer.channel.send(this.options.transport, peer.remote, datagram, nowMilliseconds);
            peer.frames.set(frame.serverFrame, structuredClone(frame));
            while (peer.frames.size > 16) {
                const oldest = peer.frames.keys().next();
                if (oldest.done)
                    break;
                peer.frames.delete(oldest.value);
            }
        }
    }
    close(): void {
        if (this.ended)
            return;
        this.ended = true;
        for (const peer of this.peers.values()) this.closeDownload(peer);
        for (const peer of this.peers.values()) {
            try {
                this.reliable(peer, { kind: 'disconnect' });
                peer.channel.send(this.options.transport, peer.remote, new Uint8Array(0), performance.now());
            }
            finally {
                this.host.disconnect(peer.player, 'Server shutdown');
            }
        }
        this.peers.clear();
        this.pending = [];
        this.options.transport.close();
    }
}
export class Q2ClientNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
    readonly role = 'client';
    readonly wire: WireSelection;
    readonly reader: Q2ServerMessageReader;
    private readonly handshake: Q2ClientHandshake;
    private channel: Q2Channel | null = null;
    private state: ApplicationNetworkPhase = 'challenging';
    private serverData: ServerDataParamsT | null = null;
    private lastFrame = -1;
    private lastReceived: number | null = null;
    private previous: UsercmdT = new UsercmdT();
    private oldest: UsercmdT = new UsercmdT();
    private pendingCommands: UsercmdT[] = [];
    private pendingGameState: Q2ApplicationGameState | null = null;
    constructor(readonly options: Q2ClientNetworkOptions<TAddress>) {
        this.wire = { kind: 'source', protocol: options.host.protocol };
        this.reader = new Q2ServerMessageReader(options.host.protocol, options.host.messageOptions);
        this.handshake = new Q2ClientHandshake(options.remote, [options.host.protocol], options.qport, options.host.userinfo);
    }
    get phase(): ApplicationNetworkPhase { return this.state; }
    get acknowledgedFrame(): number { return this.lastFrame; }
    command(text: string): void { const channel = this.channel; if (channel === null)
        throw new Error('Q2 client is not connected'); channel.queueReliable(encodeQ2ClientControl({ kind: 'command', text })); }
    private cancelLoading(): void {
        this.pendingGameState = null;
        this.options.host.downloads?.close();
    }
    private async prepareGameState(): Promise<void> {
        const state = this.pendingGameState;
        if (state === null) return;
        const preparation = await this.options.host.downloads?.prepare(state) ?? 'ready';
        if (this.pendingGameState !== state || preparation !== 'ready') return;
        await this.options.host.gameState(state);
        if (this.pendingGameState !== state) return;
        this.pendingGameState = null;
        this.command(`begin ${state.data.servercount}`);
        this.state = 'active';
    }
    private async serverCommands(text: string): Promise<void> {
        for (const line of text.split(/\n|;/)) {
            const words = tokens(line), name = words[0];
            if (name === 'cmd' && (words[1] === 'configstrings' || words[1] === 'baselines'))
                this.command(words.slice(1).join(' '));
            else if (name === 'precache') {
                const data = this.serverData;
                if (data === null || integer(words[1]) !== data.servercount)
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
                this.options.host.print(`Server command requires application binding: ${line}\n`);
        }
    }
    private async serverRecords(records: readonly Q2ServerRecord[], now: number): Promise<void> {
        for (const record of records) {
            switch (record.event.kind) {
                case 'server-data':
                    this.cancelLoading();
                    this.serverData = record.event.data;
                    this.lastFrame = -1;
                    this.previous = new UsercmdT();
                    this.oldest = new UsercmdT();
                    this.pendingCommands = [];
                    this.state = 'loading';
                    break;
                case 'command-text':
                    await this.serverCommands(record.event.text);
                    break;
                case 'frame':
                    this.lastFrame = record.event.frame.valid === false ? -1 : record.event.frame.serverFrame;
                    if (record.event.frame.valid !== false)
                        this.options.host.frame(record.event.frame, records, now);
                    break;
                case 'disconnect':
                    this.cancelLoading();
                    this.state = 'closed';
                    this.options.host.disconnected('Server disconnected');
                    break;
                case 'reconnect':
                    this.cancelLoading();
                    this.lastFrame = -1;
                    this.state = 'loading';
                    this.command('new');
                    break;
                case 'print':
                    this.options.host.print(record.event.text);
                    break;
                case 'download':
                    if (this.options.host.downloads?.receive(record.event) === 'complete') await this.prepareGameState();
                    break;
                default: break;
            }
        }
        this.options.host.records(records);
    }
    async poll(nowMilliseconds: number): Promise<readonly ActorCommand[]> {
        if (this.state === 'closed' || this.state === 'rejected')
            return [];
        if (this.channel === null) {
            const packet = this.handshake.poll(nowMilliseconds);
            if (packet !== null)
                this.options.transport.send(this.options.remote, packet);
        }
        for (;;) {
            const packet = this.options.transport.poll();
            if (packet === null)
                break;
            if (packet.kind !== 'packet') {
                if (packet.kind === 'error')
                    this.options.host.print(`${packet.error.message}\n`);
                continue;
            }
            if (!sameAddress(packet.from, this.options.remote))
                continue;
            this.lastReceived = nowMilliseconds;
            const oob = readQ2OutOfBand(packet.payload);
            if (oob !== null) {
                if (oob.command === 'print')
                    this.options.host.print(oob.body);
                this.handshake.receive(packet.from, oob);
                if (this.handshake.state.kind === 'connecting')
                    this.state = 'connecting';
                if (this.handshake.state.kind === 'rejected') {
                    this.state = 'rejected';
                    this.options.host.disconnected(this.handshake.state.reason);
                }
                if (this.handshake.state.kind === 'connected' && this.channel === null) {
                    const request = this.handshake.state.request;
                    this.channel = new Q2Channel({ side: 'client', protocol: request.protocol, channel: request.channel, qport: request.qport, payloadBytes: request.payloadBytes });
                    this.state = 'loading';
                    this.command('new');
                }
            }
            else if (this.channel !== null) {
                const result = this.channel.receive(packet.payload, nowMilliseconds);
                if (result.kind === 'message') {
                    this.options.host.prediction?.acknowledged(result.acknowledged, nowMilliseconds);
                    await this.serverRecords(this.reader.read(result.bytes), nowMilliseconds);
                }
            }
        }
        if (this.lastReceived !== null && nowMilliseconds - this.lastReceived > (this.options.timeoutMilliseconds ?? 120000)) {
            this.cancelLoading();
            this.state = 'rejected';
            this.options.host.disconnected('Connection timed out');
        }
        const channel = this.channel;
        if (channel !== null && this.phase !== 'closed' && this.phase !== 'rejected') {
            for (const command of this.pendingCommands) {
                const sequence = channel.outgoingSequence;
                const bytes = encodeQ2Move(this.reader.wire, sequence, this.lastFrame, [this.oldest, this.previous, command]);
                channel.send(this.options.transport, this.options.remote, bytes, nowMilliseconds);
                this.options.host.prediction?.sent(sequence, command, nowMilliseconds);
                this.oldest = this.previous;
                this.previous = command;
            }
            this.pendingCommands = [];
            if (channel.shouldUpdate(nowMilliseconds))
                channel.send(this.options.transport, this.options.remote, new Uint8Array(0), nowMilliseconds);
        }
        return [];
    }
    submit(commands: readonly ActorCommand[], _nowMilliseconds: number): void {
        if (this.state !== 'active')
            return;
        if (commands.length > 1)
            throw new Error('A native Q2 connection carries one player; use independent connections for local seats');
        for (const command of commands)
            this.pendingCommands.push(this.options.host.command(command));
    }
    publish(_output: SimulationOutput, _events: readonly SimulationPresentationEvent[], _nowMilliseconds: number): void { throw new Error('Remote Q2 client cannot publish authoritative server state'); }
    close(): void {
        this.cancelLoading();
        if (this.options.transport.closed)
            return;
        if (this.channel !== null && this.state !== 'closed') {
            this.command('disconnect');
            this.channel.send(this.options.transport, this.options.remote, new Uint8Array(0), performance.now());
        }
        this.state = 'closed';
        this.pendingCommands = [];
        this.options.transport.close();
    }
}
