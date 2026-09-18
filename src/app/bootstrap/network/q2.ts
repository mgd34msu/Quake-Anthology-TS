import { q2KexSeatUserinfo, q2KexClientUserinfo } from '../../../network/q2/handshake.ts';
import { KexLanTransport } from '../../../network/q2/kex/lan.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { encodeQ2ServerDemoSignon, encodeQ2ServerDemoFrame } from '../../../network/q2/server-demo.ts';
import { MvdEncoder } from '../../../network/q2/mvd-encoding.ts';
import type { MvdCapture } from '../../../network/q2/mvd-encoding.ts';
import { MvdBroadcast } from '../../../network/q2/mvd-broadcast.ts';
import type { DemoRecordingSeed } from '../demo-recording.ts';
import { Q2GameCallbackError } from './types.ts';
import type { DemoRecordingSink } from '../demo-recording.ts';
import { Q2ClientReceiver } from './q2-client-receiver.ts';
import type { ClientId } from "../../../contracts/identity.ts";
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { WireSelection } from '../../../network/common/session.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import { addressKey, sameAddress } from '../../../network/common/endpoint.ts';
import { tokenizeCommand } from '../../../core/commands/text.ts';
import { Q2Channel, Q2ChallengeTable, Q2ClientHandshake, Q2CommandReplay, Q2WireCodec, UsercmdT, encodeQ2ClientControl, encodeQ2Frame, encodeQ2Move, encodeQ2ServerEvent, q2OutOfBand, readQ2ClientMessages, readQ2Connect, readQ2OutOfBand } from '../../../network/q2/index.ts';
import type { Q2ChannelReceive, Q2ServerWriteEvent, Q2WireFrame } from '../../../network/q2/index.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase, Q2ApplicationGameState, Q2ApplicationPlayer, Q2ApplicationServerHost, Q2ClientNetworkOptions, Q2ServerNetworkOptions } from './types.ts';
import { Q2PeerDownload } from './q2-downloads.ts';
import { MasterHeartbeat } from '../../../network/services/discovery.ts';
import { q2InfoText, q2StatusText, q2DiscoveryWire, handleQ2Rcon } from '../../../network/q2/connectionless.ts';
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
interface ServerSplit { player: Q2ApplicationPlayer; replay: Q2CommandReplay; sequence: number; }
interface ServerPeer<TAddress extends NetworkAddress> {
    readonly download: Q2PeerDownload;
    downloadFailure: string | null;
    remote: TAddress;
    player: Q2ApplicationPlayer;
    readonly splits: ServerSplit[];
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
    private mvdFrame: { readonly output: SimulationOutput; readonly events: readonly SimulationPresentationEvent[] } | null = null;
    private mvdSeed: MvdCapture | null = null;
    private mvdTick: number | null = null;
    private mvdMessages: MvdCapture['messages'][number][] = [];
    private mvdOwner: { readonly sink: DemoRecordingSink; readonly encoder: MvdEncoder; writes: Promise<void> } | null = null;
    private mvdBroadcast: MvdBroadcast | null = null;
    private serverDemoSeed: MvdCapture | null = null;
    private serverDemoOwner: { readonly sink: DemoRecordingSink; readonly generation: number; configs: ReadonlyMap<number, string>; writes: Promise<void> } | null = null;
    readonly serverRecording = {
        seed: (): DemoRecordingSeed => {
            const capture = this.captureMvd();
            if (capture.revision !== 2010) throw new Error('serverrecord requires classic Quake II; use mvdrecord for other source revisions');
            if (this.serverDemoOwner !== null) throw new Error('Already doing a serverrecord');
            this.serverDemoSeed = capture;
            return { identity: { kind: 'q2-server', protocol: 34 }, packets: [{ kind: 'q2-server', message: encodeQ2ServerDemoSignon(capture) }] };
        },
        attach: (sink: DemoRecordingSink): (() => void) => {
            const seed = this.serverDemoSeed;
            if (this.ended || seed === null || this.serverDemoOwner !== null || seed.servercount !== this.serverGeneration) throw new Error('Server recording requires a current unused seed');
            const owner = { sink, generation: seed.servercount, configs: seed.configStrings, writes: Promise.resolve() };
            this.serverDemoSeed = null; this.serverDemoOwner = owner;
            return () => { if (this.serverDemoOwner === owner) this.serverDemoOwner = null; };
        },
    };
    readonly mvdRecording = {
        seed: (): DemoRecordingSeed => {
            const capture = this.captureMvd(), revision = capture.revision;
            if (revision !== 2009 && revision !== 2010 && revision !== 2011 && revision !== 2012 && revision !== 2013 && revision !== 3038) throw new Error('Unsupported MVD recording revision');
            const packets = new MvdEncoder().capture({ ...capture, messages: [] }).map(message => ({ kind: 'mvd', message } satisfies Parameters<DemoRecordingSink['append']>[0]));
            this.mvdSeed = capture;
            return { identity: { kind: 'mvd', revision }, packets };
        },
        attach: (sink: DemoRecordingSink): (() => void) => {
            if (this.ended || this.mvdOwner !== null || this.mvdSeed === null) throw new Error('MVD recording requires an unused server seed');
            const encoder = new MvdEncoder(); encoder.capture({ ...this.mvdSeed, messages: [] }); this.mvdSeed = null;
            const owner = { sink, encoder, writes: Promise.resolve() }; this.mvdOwner = owner;
            if (this.mvdBroadcast === null) { this.mvdTick = this.mvdTime(); this.mvdMessages = []; }
            return () => { if (this.mvdOwner === owner) this.mvdOwner = null; };
        },
    };
    private mvdTime(): number {
        const time = this.mvdFrame?.output.snapshot.frame.time;
        if (time === undefined) throw new Error('MVD capture has no source clock');
        return Math.floor((time.kind === 'seconds' ? time.value * 10 : time.value / 100) + 1e-7);
    }
    private captureMvd(): MvdCapture {
        if (this.ended || this.mvdFrame === null || this.host.mvdCapture === undefined) throw new Error('MVD recording requires an active authoritative Q2 capture source');
        return this.host.mvdCapture(this.mvdFrame.output, this.mvdFrame.events, this.serverGeneration);
    }
    private async configureMvd(): Promise<void> {
        const settings = this.host.mvdSettings?.();
        if (settings?.enabled !== true) { const old = this.mvdBroadcast; this.mvdBroadcast = null; await old?.close(); return; }
        if (this.mvdBroadcast !== null) return;
        const address = this.options.transport.address;
        if (address.kind !== 'ipv4' && address.kind !== 'ipv6') throw new Error('GTV broadcast requires an IP server transport');
        if (this.host.mvdCapture === undefined) throw new Error('GTV broadcast requires an authoritative Q2 capture source');
        const broadcast = new MvdBroadcast({ maxViewers: settings.maxViewers, authorize: hello => hello.password === (this.host.mvdSettings?.().password ?? '') });
        try {
            await broadcast.listen(address.kind === 'ipv4' ? address.host.join('.') : address.host, address.port);
            if (this.ended) { await broadcast.close(); return; }
            this.mvdBroadcast = broadcast;
        } catch (error) { await broadcast.close(); throw error; }
    }
    readonly role = 'server';
    readonly wire: WireSelection;
    private acceptConnection(remote: TAddress): void {
        const url = this.options.host.downloads?.httpServer?.() ?? null;
        this.reply(remote, `client_connect${this.host.protocol.kind === 'q2-kex' ? ' 2023' : ''}${url === null ? '' : ` dlserver=${url.href}`}`);
    }
    private readonly transport: DatagramTransport<TAddress>;
    private readonly lan: KexLanTransport<TAddress> | null;
    private readonly masterHeartbeat: MasterHeartbeat;
    private ended = false;
    private readonly peers = new Map<string, ServerPeer<TAddress>>();
    private readonly challenges: Q2ChallengeTable;
    private pending: ActorCommand[] = [];
    private host: Q2ApplicationServerHost;
    private serverGeneration = 1;
    constructor(readonly options: Q2ServerNetworkOptions<TAddress>) {
        this.lan = options.host.protocol.kind === 'q2-kex' ? new KexLanTransport(options.transport, { role: 'host', localPlayers: 0, maxPlayers: options.host.maxClients, name: 'Quake II' }) : null;
        this.transport = this.lan ?? options.transport;
        this.masterHeartbeat = new MasterHeartbeat(q2DiscoveryWire(options.host.protocol, () => { const discovery = this.host.discovery; if (discovery === undefined) throw new Error('Q2 master publication requires source status'); return discovery.status(); }), this.transport);
        this.host = options.host;
        const supported = options.host.supportsSourceWire();
        if (supported.kind === 'unsupported')
            throw new Error(`Native Q2 wire is unavailable: ${supported.reasons.join('; ')}`);
        if (options.host.protocol.kind === 'q2-kex-demo')
            throw new Error('KEX native live transport is unbound');
        this.wire = { kind: 'source', protocol: options.host.protocol };
        this.challenges = new Q2ChallengeTable(options.random);
    }
    get phase(): ApplicationNetworkPhase { return this.ended ? 'closed' : 'active'; }
    get clients(): readonly Q2ApplicationPlayer[] { return [...this.peers.values()].flatMap(peer => [peer.player, ...peer.splits.map(split => split.player)]); }
    changeWorld(host: Q2ApplicationServerHost): void {
        const support = host.supportsSourceWire();
        if (support.kind === 'unsupported')
            throw new Error(`Native Q2 map transition is unavailable: ${support.reasons.join('; ')}`);
        if (host.protocol.kind !== this.host.protocol.kind || host.protocol.version !== this.host.protocol.version)
            throw new Error('Native Q2 map transition cannot change protocol');
        if (this.serverDemoOwner !== null) throw new Error('Finish serverrecord with serverstop before changing maps');
        this.serverDemoSeed = null;
        const players = [...this.peers.values()].map(peer => ({ peer, player: host.carriedPlayer(peer.player.client) }));
        this.host = host;
        this.mvdFrame = null; this.mvdSeed = null; this.mvdTick = null; this.mvdMessages = [];
        this.serverGeneration++;
        this.pending = [];
        for (const { peer, player } of players) {
            this.closeDownload(peer);
            peer.player = player;
            for (const split of peer.splits) { split.player = host.carriedPlayer(split.player.client); split.replay = new Q2CommandReplay(); }
            this.host.userinfo(player, peer.wire.protocol.kind === 'q2-kex' ? q2KexSeatUserinfo(peer.userinfo, 0) : peer.userinfo);
            for (let seat = 0; seat < peer.splits.length; seat++) { const split = peer.splits[seat]; if (split !== undefined) this.host.userinfo(split.player, q2KexSeatUserinfo(peer.userinfo, seat + 1)); }
            peer.active = false;
            peer.frames.clear();
            peer.gameState = null;
            peer.replay = new Q2CommandReplay();
            peer.datagram = [];
            this.stuff(peer, 'changing\n');
            this.reliable(peer, { kind: 'reconnect' });
        }
    }
    private reply(remote: TAddress, text: string): void { this.transport.send(remote, q2OutOfBand(text, this.host.protocol.kind === 'q2-kex')); }
    heartbeat(nowMilliseconds: number): void { if (!this.ended) this.masterHeartbeat.send(this.host.masters?.() ?? [], nowMilliseconds, true, true); }
    disconnectClient(client: ClientId, reason: string): boolean {
        const peer = [...this.peers.values()].find(peer => peer.player.client.equals(client) || peer.splits.some(split => split.player.client.equals(client)));
        if (peer === undefined) return false;
        try {
            this.reliable(peer, { kind: 'print', level: 2, text: `${reason}\n` });
            this.reliable(peer, { kind: 'disconnect' });
            peer.channel.send(this.transport, peer.remote, new Uint8Array(0), performance.now());
        } finally { this.drop(peer, reason); }
        return true;
    }
    private drop(peer: ServerPeer<TAddress>, reason: string): void {
        this.closeDownload(peer);
        this.peers.delete(addressKey(peer.remote));
        this.pending = this.pending.filter(command => command.source.kind !== 'remote-client' || ![peer.player, ...peer.splits.map(split => split.player)].some(player => command.source.kind === 'remote-client' && command.source.client.equals(player.client)));
        for (const player of [peer.player, ...peer.splits.map(split => split.player)]) this.host.disconnect(player, reason);
    }
    private async connectionless(remote: TAddress, bytes: Uint8Array, now: number): Promise<boolean> {
        const message = readQ2OutOfBand(bytes, this.host.protocol.kind === 'q2-kex');
        if (message === null)
            return false;
        switch (message.command) {
            case 'rcon': {
                const administration = this.host.administration;
                if (administration !== undefined) await handleQ2Rcon({ ...administration, reply: (_to, payload) => { this.transport.send(remote, payload); } }, remote, message, now);
                return true;
            }
            case 'status':
                if (this.host.discovery !== undefined) this.reply(remote, `print\n${q2StatusText(this.host.discovery.status())}`);
                break;
            case 'info': {
                const discovery = this.host.discovery;
                if (discovery !== undefined) {
                    const text = q2InfoText(discovery.info(), [this.host.protocol], Number(message.arguments[0]));
                    if (text !== null) this.reply(remote, text);
                }
                break;
            }
            case 'getchallenge':
                this.transport.send(remote, this.challenges.reply(remote, now, [this.host.protocol]));
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
                if (!(request.protocol.kind === 'q2-kex' ? this.lan?.admitted(remote) === true : this.challenges.validate(remote, request.challenge))) {
                    this.reply(remote, 'print\nBad challenge.\n');
                    break;
                }
                const existing = this.peers.get(addressKey(remote));
                if (existing !== undefined) {
                    this.acceptConnection(remote);
                    break;
                }
                if (this.clients.length + (request.socialIds?.length ?? 1) > this.host.maxClients) {
                    this.reply(remote, 'print\nServer is full.\n');
                    break;
                }
                const admitted = this.host.admit(remote, { ...request, splitSeat: 0, ...(request.socialIds === undefined ? {} : { socialIds: request.socialIds.slice(0, 1) }) });
                if (admitted.kind === 'rejected') {
                    this.reply(remote, `print\n${admitted.reason}\n`);
                    break;
                }
                const splits: ServerSplit[] = [];
                let failure: string | null = null;
                for (let seat = 1; seat < (request.socialIds?.length ?? 1); seat++) {
                    const additional = this.host.admit(remote, { ...request, splitSeat: seat, socialIds: request.socialIds?.slice(seat, seat + 1) ?? [] });
                    if (additional.kind === 'rejected') { failure = additional.reason; break; }
                    splits.push({ player: additional.player, replay: new Q2CommandReplay(), sequence: 0 });
                }
                if (failure !== null) { for (const player of [admitted.player, ...splits.map(split => split.player)]) this.host.disconnect(player, failure); this.reply(remote, `print\n${failure}\n`); break; }
                const configured = this.host.protocol, offered = request.protocol;
                const protocol = configured.kind === 'q2-r1q2' && offered.kind === 'q2-r1q2' && configured.revision < offered.revision ? configured
                    : configured.kind === 'q2-q2pro' && offered.kind === 'q2-q2pro' && configured.revision < offered.revision ? configured : offered;
                const peer: ServerPeer<TAddress> = { remote, player: admitted.player, splits, download: new Q2PeerDownload(), downloadFailure: null,
                    channel: new Q2Channel({ maxDatagramBytes: this.transport.maxDatagramBytes ?? 65507, side: 'server', protocol, channel: request.channel, qport: request.qport, payloadBytes: request.payloadBytes, compress: request.compression }),
                    wire: new Q2WireCodec(protocol), replay: new Q2CommandReplay(), frames: new Map<number, Q2WireFrame>(), gameState: null, active: false, sequence: 0, lastReceived: now, datagram: [], userinfo: request.userinfo };
                this.peers.set(addressKey(remote), peer);
                this.acceptConnection(remote);
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
        for (const split of peer.splits) split.replay = new Q2CommandReplay();
        peer.datagram = [];
        const original = this.host.gameState(peer.player, peer.wire.protocol), state = { ...original, data: { ...original.data, servercount: this.serverGeneration, ...(peer.splits.length === 0 ? {} : { clientnums: [peer.player, ...peer.splits.map(split => split.player)].map(player => player.sourceEntity - 1) }) } };
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
    private clientCommand(peer: ServerPeer<TAddress>, text: string, player = peer.player): void {
        if (this.host.expandClientCommand !== undefined) {
            const expanded = this.host.expandClientCommand(text); if (expanded === undefined) return; text = expanded;
        }
        const words = tokenizeCommand(text, 'q2-classic').argv, name = words[0];
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
                if (!peer.active) for (const admitted of [peer.player, ...peer.splits.map(split => split.player)]) this.host.begin?.(admitted);
                peer.active = true;
                return;
            }
            this.signonPage(peer, name, integer(words[2]));
            return;
        }
        if (peer.active) {
            if (this.host.commandText !== undefined) this.host.commandText(player, text);
            else this.host.command(player, name, words.slice(1));
        }
    }
    private process(peer: ServerPeer<TAddress>, result: Extract<Q2ChannelReceive, {
        kind: 'message';
    }>): void {
        const records = readQ2ClientMessages(peer.wire, result.bytes, result.sequence, peer.splits.length + 1);
        for (const { event, seat = 0 } of records) {
            const owner = seat === 0 ? peer : peer.splits[seat - 1];
            if (owner === undefined) throw new Error('Missing admitted Q2 split owner');
            switch (event.kind) {
                case 'move':
                case 'batch-move':
                    if (peer.active)
                        owner.replay.execute(event, result.dropped, command => { const input = this.host.input(owner.player, command, owner.sequence++); if (input !== null) this.pending.push(input); });
                    break;
                case 'command':
                    this.clientCommand(peer, event.text, owner.player);
                    if (this.peers.get(addressKey(peer.remote)) !== peer) return;
                    break;
                case 'userinfo':
                    this.host.userinfo(peer.player, peer.wire.protocol.kind === 'q2-kex' ? q2KexSeatUserinfo(event.text, 0) : event.text);
                    for (let seat = 0; seat < peer.splits.length; seat++) { const split = peer.splits[seat]; if (split !== undefined) this.host.userinfo(split.player, q2KexSeatUserinfo(event.text, seat + 1)); }
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
        this.lan?.tick(nowMilliseconds);
        if (this.ended)
            return [];
        await this.configureMvd();
        const masters = this.host.masters?.() ?? [];
        if (masters.length > 0) this.masterHeartbeat.send(masters, nowMilliseconds, true);
        for (const peer of this.peers.values()) if (peer.downloadFailure !== null) this.drop(peer, peer.downloadFailure);
        for (;;) {
            const packet = this.transport.poll();
            if (packet === null)
                break;
            if (packet.kind !== 'packet') {
                if (packet.kind === 'error')
                    this.host.print(`${packet.error.message}\n`);
                continue;
            }
            if (this.host.rejects?.(packet.from)) continue;
            let peer = this.peers.get(addressKey(packet.from));
            try {
                if (await this.connectionless(packet.from, packet.payload, nowMilliseconds))
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
                if (error instanceof Q2GameCallbackError) throw error;
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
                peer.channel.send(this.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
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
        this.mvdFrame = { output, events };
        const mvdOwner = this.mvdOwner, serverOwner = this.serverDemoOwner;
        const current = mvdOwner !== null || this.mvdBroadcast !== null || serverOwner !== null ? this.captureMvd() : null;
        if (serverOwner !== null && current !== null) {
            const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 });
            const multicasts = current.messages.filter(message => message.recipient.kind !== 'player' && [1, 2, 3, 9].includes(message.bytes[0] ?? -1)).map(message => message.bytes);
            for (const [index, value] of current.configStrings) if (serverOwner.configs.get(index) !== value) multicasts.push(encodeQ2ServerEvent(wire, { kind: 'config-string', index, value }));
            serverOwner.configs = current.configStrings;
            const write = serverOwner.sink.append({ kind: 'q2-server', message: encodeQ2ServerDemoFrame(output.snapshot.frame.frame, current.entities, multicasts) });
            serverOwner.writes = Promise.all([serverOwner.writes, write]).then(() => {}).catch((error: unknown) => {
                if (this.serverDemoOwner === serverOwner) this.serverDemoOwner = null;
                this.host.print(`Server recording failed: ${error instanceof Error ? error.message : String(error)}\n`);
            });
        }
        if ((mvdOwner !== null || this.mvdBroadcast !== null) && current !== null) {
            const tick = this.mvdTime();
            this.mvdMessages.push(...current.messages);
            // Native SV_MvdEndFrame publishes only SV_FRAMESYNC, the fixed 10 Hz MVD clock.
            if (tick !== this.mvdTick) {
                this.mvdTick = tick;
                const capture = { ...current, messages: this.mvdMessages }; this.mvdMessages = [];
                this.mvdBroadcast?.observe(capture);
                if (mvdOwner !== null) {
                    const packets = mvdOwner.encoder.capture(capture);
                    // Admit immediately: the shared sink owns ordering, including a stop in this turn.
                    const writes = packets.map(message => mvdOwner.sink.append({ kind: 'mvd', message }));
                    mvdOwner.writes = Promise.all([mvdOwner.writes, ...writes]).then(() => {}).catch((error: unknown) => {
                        if (this.mvdOwner === mvdOwner) this.mvdOwner = null;
                        this.host.print(`MVD recording failed: ${error instanceof Error ? error.message : String(error)}\n`);
                    });
                }
            }
        } else { this.mvdTick = null; this.mvdMessages = []; }

        for (const peer of this.peers.values()) {
            for (const message of this.host.rawMessages?.(peer.player) ?? []) {
                if (message.reliable) peer.channel.queueReliable(message.bytes);
                else if (peer.active) peer.datagram.push(message.bytes);
            }
            for (let index = 0; index < peer.splits.length; index++) {
                const split = peer.splits[index]; if (split === undefined) continue;
                const prefix = new Uint8Array([21, index + 2]);
                for (const message of this.host.rawMessages?.(split.player) ?? []) {
                    const bytes = joinPackets([prefix, message.bytes, new Uint8Array([21, 1])]);
                    if (message.reliable) peer.channel.queueReliable(bytes); else if (peer.active) peer.datagram.push(bytes);
                }
                if (peer.active) for (const event of this.host.events(split.player, output, events)) {
                    const bytes = joinPackets([prefix, encodeQ2ServerEvent(peer.wire, event), new Uint8Array([21, 1])]);
                    if (event.reliable ?? (event.kind !== 'sound' && event.kind !== 'muzzle-flash' && event.kind !== 'temporary-entity')) peer.channel.queueReliable(bytes); else peer.datagram.push(bytes);
                }
            }
            if (!peer.active)
                continue;
            const primary = this.host.frame(peer.player, output, peer.wire.protocol);
            const splitFrames = peer.splits.map(split => this.host.frame(split.player, output, peer.wire.protocol));
            const entities = new Map(primary.entities.map(entity => [entity.number, entity]));
            for (const additional of splitFrames) for (const entity of additional.entities) entities.set(entity.number, entity);
            const frame = splitFrames.length === 0 ? primary : { ...primary, splitPlayers: splitFrames.map(additional => ({ areaBits: additional.areaBits, player: additional.player })), entities: [...entities.values()].sort((a, b) => a.number - b.number) };
            for (const event of this.host.events(peer.player, output, events)) {
                const reliable = event.reliable ?? (event.kind !== 'sound' && event.kind !== 'muzzle-flash' && event.kind !== 'temporary-entity');
                const bytes = encodeQ2ServerEvent(peer.wire, event);
                if (reliable)
                    peer.channel.queueReliable(bytes);
                else
                    peer.datagram.push(bytes);
            }
            if (peer.channel.fragmentPending) {
                peer.channel.send(this.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
                continue;
            }
            if (peer.frames.has(frame.serverFrame)) {
                if (peer.channel.shouldUpdate(nowMilliseconds))
                    peer.channel.send(this.transport, peer.remote, new Uint8Array(0), nowMilliseconds);
                continue;
            }
            const old = peer.replay.lastFrame < 0 ? null : peer.frames.get(peer.replay.lastFrame) ?? null;
            const baseline = peer.gameState?.baselines;
            if (baseline === undefined)
                throw new Error('Active Q2 client has no baselines');
            const frameBytes = encodeQ2Frame(peer.wire, frame, old, baseline, this.host.maxClients);
            const datagram = joinPackets([frameBytes, ...peer.datagram]);
            peer.datagram = [];
            peer.channel.send(this.transport, peer.remote, datagram, nowMilliseconds);
            peer.frames.set(frame.serverFrame, structuredClone(frame));
            while (peer.frames.size > 16) {
                const oldest = peer.frames.keys().next();
                if (oldest.done)
                    break;
                peer.frames.delete(oldest.value);
            }
        }
    }
    async close(): Promise<void> {
        if (this.ended) return;
        this.ended = true;
        const owner = this.mvdOwner, broadcast = this.mvdBroadcast, serverOwner = this.serverDemoOwner;
        this.serverDemoOwner = null; this.serverDemoSeed = null;
        this.mvdOwner = null; this.mvdBroadcast = null; this.mvdSeed = null; this.mvdFrame = null; this.mvdTick = null; this.mvdMessages = [];
        const failures: unknown[] = [];
        const cleanup = (operation: () => void): void => { try { operation(); } catch (error) { failures.push(error); } };
        cleanup(() => this.masterHeartbeat.send(this.host.masters?.() ?? [], performance.now(), false, true));
        for (const peer of this.peers.values()) {
            cleanup(() => this.closeDownload(peer));
            cleanup(() => {
                this.reliable(peer, { kind: 'disconnect' });
                peer.channel.send(this.transport, peer.remote, new Uint8Array(0), performance.now());
            });
            for (const player of [peer.player, ...peer.splits.map(split => split.player)]) cleanup(() => this.host.disconnect(player, 'Server shutdown'));
        }
        this.peers.clear();
        this.pending = [];
        cleanup(() => this.transport.close());
        const results = await Promise.allSettled([owner?.writes, serverOwner?.writes, Promise.resolve().then(() => broadcast?.close())]);
        for (const result of results) if (result.status === 'rejected') { const reason: unknown = result.reason; failures.push(reason); }
        if (failures.length !== 0) throw new AggregateError(failures, 'Q2 server shutdown failed');
    }
}
export class Q2ClientNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
    private recordingOwner: { readonly sink: DemoRecordingSink; waitingFullFrame: boolean } | null = null;
    readonly recording = {
        seed: () => this.receiver.seed(),
        attach: (sink: DemoRecordingSink): (() => void) => {
            if (this.recordingOwner !== null) throw new Error('Q2 connection is already recording');
            if (this.phase !== 'active') throw new Error('Recording requires an active Q2 connection');
            const owner = { sink, waitingFullFrame: true }; this.recordingOwner = owner;
            this.receiver.requestFullFrame();
            return () => { if (this.recordingOwner === owner) this.recordingOwner = null; };
        },
    };
    readonly role = 'client';
    readonly wire: WireSelection;
    private readonly receiver: Q2ClientReceiver;
    get reader(): Q2ClientReceiver["reader"] { return this.receiver.reader; }
    private readonly transport: DatagramTransport<TAddress>;
    private readonly lan: KexLanTransport<TAddress> | null;
    private readonly handshake: Q2ClientHandshake;
    private channel: Q2Channel | null = null;
    private state: ApplicationNetworkPhase = 'challenging';
    private lastReceived: number | null = null;
    private previous: UsercmdT = new UsercmdT();
    private oldest: UsercmdT = new UsercmdT();
    private pendingCommands: UsercmdT[] = [];
    constructor(readonly options: Q2ClientNetworkOptions<TAddress>) {
        this.lan = options.host.protocol.kind === 'q2-kex' ? new KexLanTransport(options.transport, { role: 'client', server: options.remote, localPlayers: 1 }) : null;
        this.transport = this.lan ?? options.transport;
        this.wire = { kind: 'source', protocol: options.host.protocol };
        this.receiver = new Q2ClientReceiver(options.host, { kind: 'network',
            ...(options.host.downloads === undefined ? {} : { downloads: options.host.downloads }),
            closed: () => options.transport.closed, command: text => this.command(text), resetCommands: () => {
                this.previous = new UsercmdT(); this.oldest = new UsercmdT(); this.pendingCommands = [];
            } });
        this.handshake = new Q2ClientHandshake(options.remote, [options.host.protocol], options.qport, options.host.userinfo, Math.min(1390, (options.transport.maxDatagramBytes ?? 65507) - 12), 3000, options.host.socialId);
    }
    get phase(): ApplicationNetworkPhase { return this.channel === null || this.state === 'closed' || this.state === 'rejected' ? this.state : this.receiver.phase; }
    get acknowledgedFrame(): number { return this.receiver.acknowledgedFrame; }
    command(text: string): void { const channel = this.channel; if (channel === null)
        throw new Error('Q2 client is not connected'); channel.queueReliable(encodeQ2ClientControl({ kind: 'command', text }, this.options.host.protocol.kind === 'q2-kex')); }
    userinfo(text: string): void {
        this.channel?.queueReliable(encodeQ2ClientControl({ kind: 'userinfo', text: this.options.host.protocol.kind === 'q2-kex' ? q2KexClientUserinfo(text) : text }, this.options.host.protocol.kind === 'q2-kex'));
    }
    async poll(nowMilliseconds: number): Promise<readonly ActorCommand[]> {
        this.lan?.tick(nowMilliseconds);
        if (this.phase === 'closed' || this.phase === 'rejected')
            return [];
        if (this.channel === null && (this.lan === null || this.lan.ready)) {
            const packet = this.handshake.poll(nowMilliseconds);
            if (packet !== null)
                this.transport.send(this.options.remote, packet);
        }
        for (;;) {
            const packet = this.transport.poll();
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
            const oob = readQ2OutOfBand(packet.payload, this.options.host.protocol.kind === 'q2-kex');
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
                    this.options.host.downloads?.setHttpServer(this.handshake.state.downloadServer);
                    this.channel = new Q2Channel({ maxDatagramBytes: this.transport.maxDatagramBytes ?? 65507, side: 'client', protocol: request.protocol, channel: request.channel, qport: request.qport, payloadBytes: request.payloadBytes });
                    this.state = 'loading';
                    this.command('new');
                }
            }
            else if (this.channel !== null) {
                const result = this.channel.receive(packet.payload, nowMilliseconds);
                if (result.kind === 'message') {
                    this.options.host.prediction?.acknowledged(result.acknowledged, nowMilliseconds);
                    const records = await this.receiver.receive(result.bytes, nowMilliseconds);
                    const owner = this.recordingOwner;
                    if (owner !== null) {
                        const messages: Uint8Array[] = [];
                        for (const record of records) {
                            if (record.event.kind === 'server-data') owner.waitingFullFrame = true;
                            if (record.event.kind === 'frame') {
                                if (record.event.frame.valid === false) continue;
                                if (owner.waitingFullFrame && record.event.frame.deltaFrame > 0) continue;
                                owner.waitingFullFrame = false;
                            }
                            messages.push(record.raw);
                        }
                        if (owner.waitingFullFrame) this.receiver.requestFullFrame();
                        if (messages.length > 0) await owner.sink.append({ kind: 'q2', message: joinPackets(messages) });
                    }
                }
            }
        }
        if (this.lastReceived !== null && nowMilliseconds - this.lastReceived > (this.options.timeoutMilliseconds ?? 120000)) {
            this.receiver.close();
            this.state = 'rejected';
            this.options.host.disconnected('Connection timed out');
        }
        await this.receiver.prepareGameState();
        this.sendPending(nowMilliseconds);
        return [];
    }
    private sendPending(nowMilliseconds: number): void {
        const channel = this.channel;
        if (channel !== null && this.phase !== 'closed' && this.phase !== 'rejected') {
            for (const command of this.pendingCommands) {
                const sequence = channel.outgoingSequence;
                const bytes = encodeQ2Move(this.reader.wire, sequence, this.receiver.acknowledgedFrame, [this.oldest, this.previous, command]);
                channel.send(this.transport, this.options.remote, bytes, nowMilliseconds);
                this.options.host.prediction?.sent(sequence, command, nowMilliseconds);
                this.oldest = this.previous;
                this.previous = command;
            }
            this.pendingCommands = [];
            if (channel.shouldUpdate(nowMilliseconds))
                channel.send(this.transport, this.options.remote, new Uint8Array(0), nowMilliseconds);
        }
    }
    submit(commands: readonly ActorCommand[], _nowMilliseconds: number): void {
        if (this.phase !== 'active')
            return;
        if (commands.length > 1)
            throw new Error('A native Q2 connection carries one player; use independent connections for local seats');
        for (const command of commands)
            this.pendingCommands.push(this.options.host.command(command));
    }
    publish(_output: SimulationOutput, _events: readonly SimulationPresentationEvent[], _nowMilliseconds: number): void { throw new Error('Remote Q2 client cannot publish authoritative server state'); }
    close(): void {
        this.recordingOwner = null;
        const phase = this.phase;
        this.receiver.close();
        if (this.transport.closed)
            return;
        if (this.channel !== null && phase !== 'closed') {
            this.command('disconnect');
            this.channel.send(this.transport, this.options.remote, new Uint8Array(0), performance.now());
        }
        this.state = 'closed';
        this.pendingCommands = [];
        this.transport.close();
    }
}
