import { KexMdns } from './discovery.ts';
import { addressKey, sameAddress } from '../../common/endpoint.ts';
import type { NetworkAddress } from '../../common/endpoint.ts';
import { PacketQueue } from '../../common/transport.ts';
import type { DatagramTransport, ReceiveEvent } from '../../common/transport.ts';
import { KexChannel } from './channel.ts';
import { KexReader, KexWriter, kexText, readKexText, writeKexPacket } from './packet.ts';
export const KEX_LAN_PORT = 5069;
export type KexLanOptions<TAddress extends NetworkAddress> =
    | { readonly role: 'host'; readonly maxPlayers: number; readonly localPlayers: number; readonly name: string }
    | { readonly role: 'client'; readonly server: TAddress; readonly localPlayers: number };
interface Peer<TAddress extends NetworkAddress> { readonly address: TAddress; readonly channel: KexChannel; readonly players: bigint[]; }
export interface KexLobbyPlayer { readonly id: bigint; readonly attributes: ReadonlyMap<string, string>; }
/** Owns the retail LAN lobby and presents only admitted game datagrams to Q2. */
export class KexLanTransport<TAddress extends NetworkAddress> implements DatagramTransport<TAddress> {
    readonly maxDatagramBytes = 65535;
    private readonly queue: PacketQueue<TAddress>;
    private readonly peers = new Map<string, Peer<TAddress>>();
    private readonly players: { id: bigint; attributes: Map<string, string> }[] = [];
    private readonly attributes = new Map<string, string>();
    private nextId = 1n;
    private clock = 0;
    private retryAt = -Infinity;
    private joined = false;
    private ended = false;
    private readonly unsubscribe: () => void;
    private discovery: KexMdns | null = null;
    constructor(private readonly transport: DatagramTransport<TAddress>, readonly options: KexLanOptions<TAddress>) {
        if (transport.address.kind === 'ipx') throw new Error('KEX LAN requires an IP transport');
        if (!Number.isInteger(options.localPlayers) || options.localPlayers < 0 || options.localPlayers > 8 || options.role === 'client' && options.localPlayers === 0) throw new Error('Invalid KEX local player count');
        if (options.role === 'host' && (!Number.isInteger(options.maxPlayers) || options.maxPlayers < options.localPlayers || options.maxPlayers > 255)) throw new Error('Invalid KEX player capacity');
        this.queue = new PacketQueue({ maxBytes: this.maxDatagramBytes, queuePackets: 256 }, () => this.clock);
        if (options.role === 'host') {
            for (let index = 0; index < options.localPlayers; index++) this.players.push({ id: this.nextId++, attributes: new Map<string, string>() });
            this.attributes.set('ingame', '1'); this.joined = true;
        } else this.peer(options.server);
        this.unsubscribe = transport.subscribeReadable(() => this.drain());
        if (options.role === 'host' && (this.address.kind === 'ipv4' || this.address.kind === 'ipv6')) {
            const failed = (error: Error): void => { if (!this.ended) this.queue.push({ kind: 'error', error }); };
            void KexMdns.open({ advertisedPort: this.address.port, found: () => {}, failed }).then(owner => {
                if (this.ended) owner.close(); else this.discovery = owner;
            }, failed);
        }
    }
    get address(): TAddress { return this.transport.address; }
    get closed(): boolean { return this.ended; }
    get ready(): boolean { return this.joined && this.attributes.get('ingame') === '1'; }
    get lobbyPlayers(): readonly KexLobbyPlayer[] { return this.players; }
    admitted(address: TAddress): boolean { return this.options.role === 'host' ? (this.peers.get(addressKey(address))?.players.length ?? 0) > 0 : this.joined && sameAddress(address, this.options.server); }
    tick(now: number): void {
        this.clock = now; this.drain();
        if (this.options.role === 'client' && !this.joined && now - this.retryAt >= 500) {
            this.retryAt = now;
            const payload = new KexWriter().string('CRANTIME').string('QuakeII').byte(this.options.localPlayers).finish();
            this.transport.send(this.options.server, writeKexPacket({ flags: 0, sequence: 0, reliable: 0, kind: 128, payload }));
        }
        for (const peer of [...this.peers.values()]) {
            try { peer.channel.tick(now); }
            catch (error) { this.remove(peer); this.queue.push({ kind: 'error', error: error instanceof Error ? error : new Error(String(error)) }); }
        }
    }
    send(to: TAddress, payload: Uint8Array): boolean {
        if (this.closed) throw new Error('KEX transport is closed');
        if (!this.admitted(to)) return false;
        const reliable = payload.length >= 8 && new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true) === 0x80000000 && new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(4, true) === 0x80000000;
        return this.peer(to).channel.send(0, payload, reliable ? 3 : 2, this.clock);
    }
    poll(): ReceiveEvent<TAddress> | null { this.drain(); return this.queue.poll(); }
    subscribeReadable(listener: () => void): () => void { return this.queue.subscribe(listener); }
    close(): void {
        if (this.ended) return;
        for (const peer of this.peers.values()) peer.channel.send(254, new KexWriter().string('Disconnected').finish(), 0, this.clock);
        this.ended = true; this.discovery?.close(); this.discovery = null; this.unsubscribe(); this.peers.clear(); this.queue.close(); this.transport.close();
    }
    setAttribute(key: string, value: string): void {
        if (this.options.role !== 'host' || key.length === 0 || /[\\\0]/.test(key + value)) throw new Error('Invalid KEX host attribute');
        if (value.length === 0) this.attributes.delete(key); else this.attributes.set(key, value);
        for (const peer of this.peers.values()) if (peer.players.length !== 0) peer.channel.send(255, kexText(`${key}\\${value}`), 3, this.clock);
    }
    private peer(address: TAddress): Peer<TAddress> {
        const key = addressKey(address), present = this.peers.get(key); if (present !== undefined) return present;
        const peer: Peer<TAddress> = { address, channel: new KexChannel(bytes => this.transport.send(address, bytes)), players: [] };
        this.peers.set(key, peer); return peer;
    }
    private drain(): void {
        if (this.ended) return;
        for (let event = this.transport.poll(); event !== null; event = this.transport.poll()) {
            if (event.kind !== 'packet') { this.queue.push(event); continue; }
            try {
                if (this.options.role === 'client' && !sameAddress(event.from, this.options.server)) continue;
                // Unknown endpoints may only enter through an unsequenced lobby query/join.
                let peer = this.peers.get(addressKey(event.from));
                if (peer === undefined) {
                    if (event.payload.length < 3 || (event.payload[1] ?? 0) % 16 !== 0 || (event.payload[2] !== 128 && event.payload[2] !== 129)) continue;
                    if (this.peers.size >= 256) continue;
                    peer = this.peer(event.from);
                }
                const message = peer.channel.receive(event.payload, this.clock);
                if (message !== null) this.message(peer, message.kind, message.payload);
            } catch { /* Malformed network input does not enter the Q2 message stream. */ }
        }
    }
    private message(peer: Peer<TAddress>, kind: number, bytes: Uint8Array): void {
        if (kind < 127) { if (this.admitted(peer.address)) this.queue.accept(peer.address, bytes); return; }
        if (kind === 128) { this.join(peer, bytes); return; }
        if (kind === 129) {
            if (bytes.length === 0) return;
            if (this.options.role !== 'host') return;
            const reader = new KexReader(bytes); if (reader.string() !== 'CRANTIME' || reader.string() !== 'QuakeII') return; reader.end();
            const response = new KexWriter().string(this.options.name).integer(BigInt(this.players.length)).integer(BigInt(this.options.maxPlayers));
            for (const [key, value] of this.attributes) if (value !== '' && !key.startsWith('_')) response.string(key).string(value);
            this.transport.send(peer.address, response.finish()); return;
        }
        if (kind === 254) { const reader = new KexReader(bytes), reason = reader.string(); reader.end(); this.remove(peer); this.queue.push({ kind: 'error', error: new Error(`KEX LAN disconnected: ${reason}`) }); return; }
        if (!this.admitted(peer.address)) return;
        if (kind === 255 && this.options.role === 'client') {
            const text = readKexText(bytes), separator = text.indexOf('\\');
            if (separator <= 0) throw new Error('Invalid KEX lobby attribute');
            const key = text.slice(0, separator), value = text.slice(separator + 1);
            if (value === '') this.attributes.delete(key); else this.attributes.set(key, value); return;
        }
        if (kind === 253) this.playerMessage(peer, bytes);
    }
    private join(peer: Peer<TAddress>, bytes: Uint8Array): void {
        const reader = new KexReader(bytes);
        if (reader.string() !== 'CRANTIME') return;
        if (this.options.role === 'host') {
            if (reader.string() !== 'QuakeII') return;
            const count = reader.byte(); reader.end();
            if (count < 1 || count > 8 || peer.players.length === 0 && this.players.length + count > this.options.maxPlayers) return;
            if (peer.players.length === 0) {
                const added = new KexWriter().byte(1).integer(BigInt(count));
                for (let index = 0; index < count; index++) { const id = this.nextId++; peer.players.push(id); this.players.push({ id, attributes: new Map<string, string>() }); added.integer(id); }
                for (const existing of this.peers.values()) if (existing !== peer && existing.players.length !== 0) existing.channel.send(253, added.finish(), 3, this.clock);
            }
            const first = this.players.findIndex(player => player.id === peer.players[0]);
            const response = new KexWriter().string('CRANTIME').integer(BigInt(first));
            for (const player of this.players) response.integer(player.id);
            peer.channel.send(128, response.finish(), 0, this.clock);
            for (const [key, value] of this.attributes) peer.channel.send(255, kexText(`${key}\\${value}`), 3, this.clock);
            return;
        }
        if (this.joined) return;
        const first = reader.integer();
        if (first > 255n) throw new Error('Invalid KEX local player index');
        const count = Number(first) + this.options.localPlayers;
        const players: { id: bigint; attributes: Map<string, string> }[] = [];
        for (let index = 0; index < count; index++) players.push({ id: reader.integer(), attributes: new Map<string, string>() });
        reader.end(); this.players.splice(0, this.players.length, ...players); this.joined = true;
    }
    private playerMessage(peer: Peer<TAddress>, bytes: Uint8Array): void {
        const reader = new KexReader(bytes), operation = reader.byte();
        if (this.options.role === 'host') {
            const id = peer.players[operation], index = this.players.findIndex(player => player.id === id);
            if (id === undefined || index < 0) return;
            const attribute = reader.string(); reader.end(); this.playerAttribute(index, attribute);
            const output = new KexWriter().byte(0).integer(BigInt(index)).string(attribute).finish();
            for (const target of this.peers.values()) if (target.players.length !== 0) target.channel.send(253, output, 3, this.clock);
            return;
        }
        const index = reader.integer();
        if (index > 255n) throw new Error('Invalid KEX player index');
        if (operation === 0) this.playerAttribute(Number(index), reader.string());
        else if (operation === 1) { if (this.players.length + Number(index) > 255) throw new Error('KEX player roster exceeds capacity'); for (let count = 0; count < Number(index); count++) this.players.push({ id: reader.integer(), attributes: new Map<string, string>() }); }
        else if (operation === 2) this.players.splice(Number(index), 1);
        else throw new Error('Invalid KEX player operation');
        reader.end();
    }
    private playerAttribute(index: number, text: string): void {
        const player = this.players[index], separator = text.indexOf('\\');
        if (player === undefined || separator <= 0 || kexText(text).length >= 128) throw new Error('Invalid KEX player attribute');
        const key = text.slice(0, separator), value = text.slice(separator + 1);
        if (value !== '') player.attributes.set(key, value); else if (key !== 'name') player.attributes.delete(key);
    }
    private remove(peer: Peer<TAddress>): void {
        this.peers.delete(addressKey(peer.address));
        if (this.options.role === 'client') { this.joined = false; this.attributes.clear(); this.players.length = 0; return; }
        for (const id of peer.players) {
            const index = this.players.findIndex(player => player.id === id); if (index < 0) continue;
            this.players.splice(index, 1);
            const bytes = new KexWriter().byte(2).integer(BigInt(index)).finish();
            for (const target of this.peers.values()) if (target.players.length !== 0) target.channel.send(253, bytes, 3, this.clock);
        }
    }
}
