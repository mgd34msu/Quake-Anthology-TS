// Quake II sv_main.c, cl_main.c and q2proto connect dialects. GPL-2.0-or-later.
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { parseQ2Token } from '../../core/common-parse.ts';
import { addressKey, sameAddress } from '../common/endpoint.ts';
import type { NetworkAddress } from '../common/endpoint.ts';
import { q2CodecSupport } from './codec.ts';
import { stringToBytes } from './message.ts';
export interface Q2ConnectionlessMessage {
    readonly command: string;
    readonly arguments: readonly string[];
    readonly text: string;
    readonly body: string;
}
export function q2OutOfBand(text: string): Uint8Array {
    const data = stringToBytes(text), packet = new Uint8Array(data.length + 4);
    packet.fill(255, 0, 4);
    packet.set(data, 4);
    return packet;
}
export function readQ2OutOfBand(bytes: Uint8Array): Q2ConnectionlessMessage | null {
    if (bytes.length < 4 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true) !== -1)
        return null;
    let text = '';
    for (const byte of bytes.subarray(4)) {
        if (byte === 0)
            break;
        text += String.fromCharCode(byte);
    }
    const newline = text.indexOf('\n'), line = newline === -1 ? text : text.slice(0, newline), cursor = { data: line, index: 0 };
    const command = parseQ2Token(cursor), args: string[] = [];
    while (cursor.index < line.length) {
        const before = cursor.index, value = parseQ2Token(cursor);
        if (cursor.index === before)
            break;
        args.push(value);
    }
    return { command, arguments: args, text, body: newline === -1 ? '' : text.slice(newline + 1) };
}
function decimal(value: string | undefined, fallback?: number): number {
    if (value === undefined && fallback !== undefined)
        return fallback;
    if (value === undefined || !/^[-+]?\d+$/.test(value))
        throw new Error('Invalid Q2 connection integer');
    const result = Number(value);
    if (!Number.isSafeInteger(result))
        throw new Error('Q2 connection integer outside range');
    return result;
}
export function q2Protocol(version: number, minor = 0): Q2ProtocolIdentity {
    switch (version) {
        case 34: return { kind: 'q2-classic', version: 34 };
        case 35: {
            const revision = minor <= 1903 ? 1903 : minor === 1904 ? 1904 : 1905;
            return { kind: 'q2-r1q2', version: 35, revision };
        }
        case 36: {
            const revision = minor <= 1016 ? 1015 : minor === 1017 ? 1017 : minor === 1018 ? 1018 : minor === 1019 ? 1019 : minor === 1020 ? 1020 : minor === 1021 ? 1021 : minor === 1022 ? 1022 : minor === 1023 ? 1023 : minor === 1024 ? 1024 : minor === 1025 ? 1025 : 1026;
            return { kind: 'q2-q2pro', version: 36, revision };
        }
        case 1038: return { kind: 'q2-rerelease', version: 1038 };
        case 4038: return { kind: 'q2-private-classic', version: 4038 };
        case 2022: return { kind: 'q2-kex-demo', version: 2022 };
        case 2023: return { kind: 'q2-kex', version: 2023 };
        default: throw new Error(`Unsupported Q2 wire version ${version}`);
    }
}
export interface Q2ConnectRequest {
    readonly protocol: Q2ProtocolIdentity;
    readonly qport: number;
    readonly challenge: number;
    readonly userinfo: string;
    readonly payloadBytes: number;
    readonly channel: 'old' | 'new';
    readonly compression: boolean;
}
export function writeQ2Connect(request: Q2ConnectRequest): Uint8Array {
    if (/["\r\n\0]/.test(request.userinfo))
        throw new Error('Invalid Q2 connect userinfo');
    const p = request.protocol;
    let tail = '';
    switch (p.kind) {
        case 'q2-classic': break;
        case 'q2-r1q2':
            tail = ` ${request.payloadBytes} ${p.revision}`;
            break;
        case 'q2-q2pro':
            tail = ` ${request.payloadBytes} ${request.channel === 'new' ? 1 : 0} ${request.compression ? 1 : 0} ${p.revision}`;
            break;
        case 'q2-rerelease':
        case 'q2-private-classic':
            tail = ` ${request.payloadBytes} ${request.compression ? 1 : 0}`;
            break;
        case 'q2-kex':
        case 'q2-kex-demo': throw new Error('KEX native transport connect dialect is not established by the available engine source');
    }
    const qport = p.kind === 'q2-classic' ? request.qport & 65535 : request.qport & 255;
    return q2OutOfBand(`connect ${p.version} ${qport} ${request.challenge} "${request.userinfo}"${tail}\n`);
}
export function readQ2Connect(message: Q2ConnectionlessMessage): Q2ConnectRequest {
    if (message.command !== 'connect')
        throw new Error('Not a Q2 connection request');
    const args = message.arguments, version = decimal(args[0]), qport = decimal(args[1]), challenge = decimal(args[2]), userinfo = args[3];
    if (userinfo === undefined || /["\r\n\0]/.test(userinfo))
        throw new Error('Missing or invalid Q2 userinfo');
    const payloadBytes = version === 34 ? 1390 : Math.min(4086, Math.max(512, decimal(args[4], 1390)));
    const minor = version === 35 ? decimal(args[5], 1903) : version === 36 ? decimal(args[7], 1015) : 0;
    const protocol = q2Protocol(version, minor);
    let channel: 'old' | 'new' = 'old', compression = false;
    if (version === 36) {
        channel = decimal(args[5], 1) === 1 ? 'new' : 'old';
        compression = decimal(args[6], 0) !== 0;
    }
    else if (version === 1038 || version === 4038) {
        channel = 'new';
        compression = decimal(args[5], 0) !== 0;
    }
    else if (version === 35)
        compression = true;
    else if (version !== 34)
        throw new Error('KEX native connect is unbound');
    return { protocol, qport: version === 34 ? qport & 65535 : qport & 255, challenge, userinfo, payloadBytes, channel, compression };
}
export interface Q2Challenge {
    readonly challenge: number;
    readonly versions: readonly number[];
}
export function readQ2Challenge(message: Q2ConnectionlessMessage): Q2Challenge {
    if (message.command !== 'challenge')
        throw new Error('Not a Q2 challenge');
    const challenge = decimal(message.arguments[0]), offer = message.arguments.find(value => value.startsWith('p='));
    return { challenge, versions: offer === undefined ? [34] : offer.slice(2).split(',').map(value => decimal(value)) };
}
export type Q2ClientHandshakeState = {
    readonly kind: 'challenging';
    readonly lastSent: number | null;
} | {
    readonly kind: 'connecting';
    readonly request: Q2ConnectRequest;
    readonly lastSent: number | null;
} | {
    readonly kind: 'connected';
    readonly request: Q2ConnectRequest;
} | {
    readonly kind: 'rejected';
    readonly reason: string;
};
export class Q2ClientHandshake {
    state: Q2ClientHandshakeState = { kind: 'challenging', lastSent: null };
    constructor(readonly remote: NetworkAddress, readonly preferences: readonly Q2ProtocolIdentity[], readonly qport: number, readonly userinfo: () => string, readonly payloadBytes = 1390, readonly retryMilliseconds = 3000) {
        if (preferences.length === 0)
            throw new Error('Q2 handshake needs an explicit protocol preference');
    }
    poll(now: number): Uint8Array | null {
        if (this.state.kind === 'connected' || this.state.kind === 'rejected')
            return null;
        if (this.state.lastSent !== null && now - this.state.lastSent < this.retryMilliseconds)
            return null;
        if (this.state.kind === 'challenging') {
            this.state = { kind: 'challenging', lastSent: now };
            return q2OutOfBand('getchallenge\n');
        }
        const request = { ...this.state.request, userinfo: this.userinfo() };
        this.state = { kind: 'connecting', request, lastSent: now };
        return writeQ2Connect(request);
    }
    receive(from: NetworkAddress, message: Q2ConnectionlessMessage): boolean {
        if (!sameAddress(from, this.remote))
            return false;
        if (message.command === 'challenge' && this.state.kind !== 'connected') {
            const challenge = readQ2Challenge(message), protocol = this.preferences.find(p => challenge.versions.includes(p.version));
            if (protocol === undefined) {
                this.state = { kind: 'rejected', reason: 'No compatible advertised Quake II protocol' };
                return true;
            }
            if (protocol.kind === 'q2-kex' || protocol.kind === 'q2-kex-demo') {
                this.state = { kind: 'rejected', reason: 'KEX native live transport connect is unbound' };
                return true;
            }
            const support = q2CodecSupport(protocol);
            if (support.kind === 'unbound' || !support.encode) {
                this.state = { kind: 'rejected', reason: support.kind === 'unbound' ? support.reason : 'Selected Q2 wire has no native connect encoder' };
                return true;
            }
            const request: Q2ConnectRequest = { protocol, qport: protocol.version === 34 ? this.qport & 65535 : this.qport & 255, challenge: challenge.challenge, userinfo: this.userinfo(), payloadBytes: this.payloadBytes, channel: protocol.version === 34 || protocol.version === 35 ? 'old' : 'new', compression: protocol.version !== 34 };
            this.state = { kind: 'connecting', request, lastSent: null };
            return true;
        }
        if (message.command === 'client_connect' && this.state.kind === 'connecting') {
            this.state = { kind: 'connected', request: this.state.request };
            return true;
        }
        return false;
    }
}
export class Q2ChallengeTable {
    private readonly entries = new Map<string, {
        readonly value: number;
        readonly time: number;
    }>();
    constructor(readonly random: () => number, readonly capacity = 1024) { }
    issue(from: NetworkAddress, now: number): number {
        const key = addressKey(from, false), found = this.entries.get(key);
        if (found !== undefined)
            return found.value;
        if (this.entries.size >= this.capacity) {
            let oldest: string | null = null, time = Infinity;
            for (const [name, entry] of this.entries)
                if (entry.time < time) {
                    oldest = name;
                    time = entry.time;
                }
            if (oldest !== null)
                this.entries.delete(oldest);
        }
        const value = this.random() & 0x7fff;
        this.entries.set(key, { value, time: now });
        return value;
    }
    validate(from: NetworkAddress, challenge: number): boolean { return from.kind === 'loopback' || this.entries.get(addressKey(from, false))?.value === challenge; }
    reply(from: NetworkAddress, now: number, protocols: readonly Q2ProtocolIdentity[]): Uint8Array { return q2OutOfBand(`challenge ${this.issue(from, now)} p=${[...new Set(protocols.map(p => p.version))].join(',')}`); }
}
