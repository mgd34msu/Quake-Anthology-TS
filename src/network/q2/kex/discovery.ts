import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';
import { hostname, networkInterfaces } from 'node:os';
import { ipAddress } from '../../common/endpoint.ts';
import type { IpAddress } from '../../common/endpoint.ts';
import type { ServerStatus } from '../../services/discovery.ts';
import { KexReader, KexWriter, writeKexPacket } from './packet.ts';
const service = '_game._udp.local';
const instance = 'Quake II._game._udp.local';
const multicast = '224.0.0.251';
export function kexDiscoveryQuery(): Uint8Array {
    return writeKexPacket({ flags: 0, sequence: 0, reliable: 0, kind: 129, payload: new KexWriter().string('CRANTIME').string('QuakeII').finish() });
}
export function readKexDiscovery(bytes: Uint8Array): ServerStatus {
    const reader = new KexReader(bytes), name = reader.string(), players = reader.integer(), maximum = reader.integer();
    if (players > 255n || maximum > 255n || players > maximum || name.length > 1024) throw new Error('Invalid KEX lobby status');
    const rules = new Map<string, string>();
    while (reader.remaining !== 0) { const key = reader.string(), value = reader.string(); if (rules.size >= 256) throw new Error('KEX lobby has too many attributes'); rules.set(key, value); }
    return { name, players: Number(players), maxPlayers: Number(maximum), map: rules.get('map') ?? '', rules, playerDetails: [], wire: { kind: 'source', protocol: { kind: 'q2-kex', version: 2023 } } };
}
function domain(value: string): number[] {
    const bytes: number[] = [];
    for (const label of value.split('.')) {
        const encoded = new TextEncoder().encode(label); if (encoded.length < 1 || encoded.length > 63) throw new Error('Invalid mDNS label');
        bytes.push(encoded.length, ...encoded);
    }
    bytes.push(0); return bytes;
}
function short(value: number): number[] { return [value >>> 8 & 255, value & 255]; }
function record(name: string, type: number, data: readonly number[], ttl: number): number[] {
    return [...domain(name), ...short(type), ...short(type === 12 ? 1 : 0x8001), 0, 0, ...short(ttl), ...short(data.length), ...data];
}
interface DnsRecord { readonly name: string; readonly type: number; readonly start: number; readonly length: number; }
class DnsReader {
    position = 12;
    private readonly view: DataView;
    constructor(readonly bytes: Uint8Array) { if (bytes.length < 12 || bytes.length > 9000) throw new Error('Invalid mDNS packet'); this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
    word(): number { const value = this.view.getUint16(this.position); this.position += 2; return value; }
    name(offset = this.position, advance = true): string {
        const labels: string[] = [], seen = new Set<number>(); let end: number | null = null;
        for (;;) {
            if (seen.has(offset) || seen.size >= 128) throw new Error('Invalid mDNS compression'); seen.add(offset);
            const size = this.bytes[offset++]; if (size === undefined) throw new Error('Truncated mDNS name');
            if (size === 0) { if (advance) this.position = end ?? offset; return labels.join('.'); }
            if ((size & 192) === 192) {
                const low = this.bytes[offset++]; if (low === undefined) throw new Error('Truncated mDNS pointer');
                end ??= offset; offset = ((size & 63) << 8) | low; continue;
            }
            if (size > 63 || offset + size > this.bytes.length) throw new Error('Invalid mDNS label');
            labels.push(new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(offset, offset + size))); offset += size;
        }
    }
    read(): { readonly question: boolean; readonly records: readonly DnsRecord[] } {
        const questions = this.view.getUint16(4), count = this.view.getUint16(6) + this.view.getUint16(8) + this.view.getUint16(10);
        if (questions + count > 256) throw new Error('Too many mDNS records');
        let question = false;
        for (let index = 0; index < questions; index++) { const name = this.name(), type = this.word(); this.word(); if (name.toLowerCase() === service && (type === 12 || type === 255)) question = true; }
        const records: DnsRecord[] = [];
        for (let index = 0; index < count; index++) {
            const name = this.name(), type = this.word(); this.word(); this.position += 4;
            const length = this.word(), start = this.position; this.position += length;
            if (this.position > this.bytes.length) throw new Error('Truncated mDNS record'); records.push({ name, type, start, length });
        }
        return { question, records };
    }
}
/** Retail LAN advertises DNS-SD, then queries its own unframed lobby status at the resolved endpoint. */
export class KexMdns {
    private closed = false;
    private readonly endpoints = new Map<string, { target: string; port: number }>();
    private readonly addresses = new Map<string, IpAddress>();
    private constructor(private readonly socket: Socket, private readonly advertisedPort: number | null, private readonly found: (address: IpAddress) => void, private readonly failed: (error: Error) => void) {}
    static async open(options: { readonly advertisedPort?: number; readonly found: (address: IpAddress) => void; readonly failed: (error: Error) => void }): Promise<KexMdns> {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        const owner = new KexMdns(socket, options.advertisedPort ?? null, options.found, options.failed);
        socket.on('message', bytes => { try { owner.receive(bytes); } catch { /* Unrelated or malformed multicast traffic. */ } });
        socket.on('error', error => options.failed(error));
        try {
            await new Promise<void>((resolve, reject) => {
                const fail = (error: Error): void => { socket.off('listening', ready); reject(error); };
                const ready = (): void => { socket.off('error', fail); resolve(); };
                socket.once('error', fail); socket.once('listening', ready); socket.bind(5353);
            });
            socket.addMembership(multicast); socket.setMulticastTTL(255); socket.setMulticastLoopback(true);
            if (owner.advertisedPort !== null) owner.announce(120);
            return owner;
        } catch (error) { owner.close(); throw error; }
    }
    query(): void {
        if (this.closed) return;
        const bytes = new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...domain(service), 0, 12, 0, 1]);
        this.socket.send(bytes, 5353, multicast, error => { if (error !== null) this.failed(error); });
    }
    close(): void { if (this.closed) return; if (this.advertisedPort !== null) this.announce(0); this.closed = true; this.socket.close(); }
    private announce(ttl: number): void {
        if (this.advertisedPort === null || this.closed) return;
        const target = `${hostname().replace(/[^A-Za-z0-9-]/g, '-').slice(0, 63)}.local`;
        const records = [record(service, 12, domain(instance), ttl), record(instance, 33, [0, 0, 0, 0, ...short(this.advertisedPort), ...domain(target)], ttl), record(instance, 16, [0], ttl)];
        for (const interfaces of Object.values(networkInterfaces())) for (const address of interfaces ?? []) {
            if (address.family !== 'IPv4' || address.internal) continue;
            const parsed = ipAddress(address.address, this.advertisedPort); if (parsed.kind === 'ipv4') records.push(record(target, 1, parsed.host, ttl));
        }
        const bytes = new Uint8Array([0, 0, 0x84, 0, 0, 0, ...short(records.length), 0, 0, 0, 0, ...records.flat()]);
        this.socket.send(bytes, 5353, multicast, error => { if (error !== null) this.failed(error); });
    }
    private receive(bytes: Uint8Array): void {
        const reader = new DnsReader(bytes), message = reader.read();
        if (message.question) this.announce(120);
        for (const entry of message.records) {
            if (entry.type === 33 && entry.name.toLowerCase().endsWith(`.${service}`) && entry.length >= 7) {
                const port = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(entry.start + 4), target = reader.name(entry.start + 6, false).toLowerCase();
                if (port !== 0 && this.endpoints.size < 256) this.endpoints.set(entry.name, { target, port });
            } else if (entry.type === 1 && entry.length === 4 && this.addresses.size < 256) this.addresses.set(entry.name.toLowerCase(), ipAddress([...bytes.subarray(entry.start, entry.start + 4)].join('.'), 5069));
            else if (entry.type === 28 && entry.length === 16 && this.addresses.size < 256) {
                const view = new DataView(bytes.buffer, bytes.byteOffset + entry.start, 16), parts: string[] = [];
                for (let index = 0; index < 8; index++) parts.push(view.getUint16(index * 2).toString(16));
                this.addresses.set(entry.name.toLowerCase(), ipAddress(parts.join(':'), 5069));
            }
        }
        for (const endpoint of this.endpoints.values()) { const address = this.addresses.get(endpoint.target); if (address !== undefined) this.found({ ...address, port: endpoint.port }); }
    }
}
