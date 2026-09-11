// Quake net_dgrm.c and QuakeWorld sv_main.c connectionless negotiation. GPL-2.0-or-later.
import { parseQ1Token } from '../../core/common-parse.ts';
import { addressKey } from '../common/endpoint.ts';
import type { NetworkAddress } from '../common/endpoint.ts';
import { MessageReader, SizeBuf, PacketError, MSG_WriteByte, MSG_WriteLong, MSG_WriteString } from './message.ts';
import { NETFLAG_CTL } from './channels.ts';
export type NetQuakeControl = {
    readonly kind: 'connect-request' | 'server-info-request';
    readonly game: string;
    readonly version: number;
} | {
    readonly kind: 'player-info-request';
    readonly player: number;
} | {
    readonly kind: 'rule-info-request';
    readonly previous: string;
} | {
    readonly kind: 'accept';
    readonly port: number;
} | {
    readonly kind: 'reject';
    readonly reason: string;
} | {
    readonly kind: 'server-info';
    readonly address: string;
    readonly name: string;
    readonly map: string;
    readonly players: number;
    readonly maxPlayers: number;
    readonly version: number;
} | {
    readonly kind: 'player-info';
    readonly player: number;
    readonly name: string;
    readonly colors: number;
    readonly frags: number;
    readonly seconds: number;
    readonly address: string;
} | {
    readonly kind: 'rule-info';
    readonly rule: {
        readonly name: string;
        readonly value: string;
    } | null;
};
export function encodeNetQuakeControl(message: NetQuakeControl): Uint8Array {
    const s = new SizeBuf(65535);
    MSG_WriteLong(s, 0);
    switch (message.kind) {
        case 'connect-request':
        case 'server-info-request':
            MSG_WriteByte(s, message.kind === 'connect-request' ? 1 : 2);
            MSG_WriteString(s, message.game);
            MSG_WriteByte(s, message.version);
            break;
        case 'player-info-request':
            MSG_WriteByte(s, 3);
            MSG_WriteByte(s, message.player);
            break;
        case 'rule-info-request':
            MSG_WriteByte(s, 4);
            MSG_WriteString(s, message.previous);
            break;
        case 'accept':
            MSG_WriteByte(s, 0x81);
            MSG_WriteLong(s, message.port);
            break;
        case 'reject':
            MSG_WriteByte(s, 0x82);
            MSG_WriteString(s, message.reason);
            break;
        case 'server-info':
            MSG_WriteByte(s, 0x83);
            MSG_WriteString(s, message.address);
            MSG_WriteString(s, message.name);
            MSG_WriteString(s, message.map);
            MSG_WriteByte(s, message.players);
            MSG_WriteByte(s, message.maxPlayers);
            MSG_WriteByte(s, message.version);
            break;
        case 'player-info':
            MSG_WriteByte(s, 0x84);
            MSG_WriteByte(s, message.player);
            MSG_WriteString(s, message.name);
            MSG_WriteLong(s, message.colors);
            MSG_WriteLong(s, message.frags);
            MSG_WriteLong(s, message.seconds);
            MSG_WriteString(s, message.address);
            break;
        case 'rule-info':
            MSG_WriteByte(s, 0x85);
            if (message.rule !== null) {
                MSG_WriteString(s, message.rule.name);
                MSG_WriteString(s, message.rule.value);
            }
            break;
    }
    new DataView(s.data.buffer).setUint32(0, NETFLAG_CTL | s.cursize);
    return s.bytes();
}
export function decodeNetQuakeControl(bytes: Uint8Array): NetQuakeControl {
    if (bytes.length < 5)
        throw new PacketError('Short control header', 0);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if ((header & 65535) !== bytes.length || (header >>> 16) !== 0x8000)
        throw new PacketError('Invalid control header', 0);
    const r = new MessageReader(bytes.subarray(4)), op = r.Byte();
    let m: NetQuakeControl;
    switch (op) {
        case 1:
        case 2:
            m = { kind: op === 1 ? 'connect-request' : 'server-info-request', game: r.String(), version: r.Byte() };
            break;
        case 3:
            m = { kind: 'player-info-request', player: r.Byte() };
            break;
        case 4:
            m = { kind: 'rule-info-request', previous: r.String() };
            break;
        case 0x81:
            m = { kind: 'accept', port: r.Long() };
            break;
        case 0x82:
            m = { kind: 'reject', reason: r.String() };
            break;
        case 0x83:
            m = { kind: 'server-info', address: r.String(), name: r.String(), map: r.String(), players: r.Byte(), maxPlayers: r.Byte(), version: r.Byte() };
            break;
        case 0x84:
            m = { kind: 'player-info', player: r.Byte(), name: r.String(), colors: r.Long(), frags: r.Long(), seconds: r.Long(), address: r.String() };
            break;
        case 0x85:
            m = { kind: 'rule-info', rule: r.remaining ? { name: r.String(), value: r.String() } : null };
            break;
        default: throw new PacketError(`Unknown control command ${op}`, 4);
    }
    r.finish();
    return m;
}
export interface NetQuakeConnectionHost {
    serverInfo(): Extract<NetQuakeControl, {
        kind: 'server-info';
    }>;
    playerInfo(index: number): Extract<NetQuakeControl, {
        kind: 'player-info';
    }> | null;
    nextRule(previous: string): {
        readonly name: string;
        readonly value: string;
    } | null;
    connect(from: NetworkAddress, nowMilliseconds: number): {
        readonly kind: 'accepted';
        readonly port: number;
    } | {
        readonly kind: 'rejected';
        readonly reason: string;
    } | {
        readonly kind: 'retry';
    };
}
export function answerNetQuakeControl(bytes: Uint8Array, from: NetworkAddress, nowMilliseconds: number, host: NetQuakeConnectionHost): Uint8Array | null {
    const message = decodeNetQuakeControl(bytes);
    switch (message.kind) {
        case 'server-info-request': return message.game === 'QUAKE' ? encodeNetQuakeControl(host.serverInfo()) : null;
        case 'player-info-request': {
            const result = host.playerInfo(message.player);
            return result === null ? null : encodeNetQuakeControl(result);
        }
        case 'rule-info-request': return encodeNetQuakeControl({ kind: 'rule-info', rule: host.nextRule(message.previous) });
        case 'connect-request': {
            if (message.game !== 'QUAKE')
                return null;
            if (message.version !== 3)
                return encodeNetQuakeControl({ kind: 'reject', reason: 'Incompatible version.\n' });
            const result = host.connect(from, nowMilliseconds);
            return result.kind === 'retry' ? null : encodeNetQuakeControl(result.kind === 'accepted' ? { kind: 'accept', port: result.port } : { kind: 'reject', reason: result.reason });
        }
        default: return null;
    }
}
export function quakeWorldOutOfBand(text: string, nul = false): Uint8Array {
    const bytes = new Uint8Array(text.length + 4 + (nul ? 1 : 0));
    bytes.fill(255, 0, 4);
    for (let i = 0; i < text.length; i++)
        bytes[i + 4] = text.charCodeAt(i) & 255;
    return bytes;
}
export function readQuakeWorldOutOfBand(bytes: Uint8Array): string {
    if (bytes.length < 4 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true) !== -1)
        throw new PacketError('Not an out-of-band packet', 0);
    let s = '';
    for (const b of bytes.subarray(4)) {
        if (b === 0)
            break;
        s += String.fromCharCode(b);
    }
    return s;
}
export function quakeWorldCommandArguments(text: string): readonly string[] {
    const state = { data: text, index: 0 }, args: string[] = [];
    while (true) {
        const token = parseQ1Token(state, 'quakeworld');
        if (token === null)
            return args;
        args.push(token);
    }
}
export function quakeWorldInfo(text: string): ReadonlyMap<string, string> {
    const out = new Map<string, string>(), parts = text.split('\\'), offset = parts[0] === '' ? 1 : 0;
    for (let i = offset; i + 1 < parts.length; i += 2) {
        const key = parts[i], value = parts[i + 1];
        if (key !== undefined && value !== undefined)
            out.set(key, value);
    }
    return out;
}
function infoString(values: ReadonlyMap<string, string>): string {
    let s = '';
    for (const [key, value] of values)
        s += `\\${key}\\${value}`;
    return s;
}
export class QuakeWorldChallenges {
    private readonly records = new Map<string, {
        readonly challenge: number;
        readonly issued: number;
    }>();
    constructor(readonly random: () => number, readonly capacity = 1024) { }
    issue(address: NetworkAddress, nowMilliseconds: number): number {
        const key = addressKey(address, false), existing = this.records.get(key);
        if (existing !== undefined)
            return existing.challenge;
        if (this.records.size >= this.capacity) {
            let oldestKey = '', time = Infinity;
            for (const [entry, record] of this.records)
                if (record.issued < time) {
                    oldestKey = entry;
                    time = record.issued;
                }
            this.records.delete(oldestKey);
        }
        const challenge = ((this.random() & 32767) << 16) ^ (this.random() & 32767);
        this.records.set(key, { challenge, issued: Math.trunc(nowMilliseconds / 1000) });
        return challenge;
    }
    validate(address: NetworkAddress, challenge: number): boolean { return this.records.get(addressKey(address, false))?.challenge === challenge; }
}
export interface QuakeWorldConnectRequest {
    readonly from: NetworkAddress;
    readonly qport: number;
    readonly challenge: number;
    readonly userinfo: string;
    readonly spectator: boolean;
    readonly donorWide: boolean;
}
export interface QuakeWorldConnectionHost {
    readonly password: string;
    readonly spectatorPassword: string;
    readonly rconPassword: string;
    readonly highCharacters: boolean;
    blocked(from: NetworkAddress): boolean;
    connect(request: QuakeWorldConnectRequest, nowMilliseconds: number): {
        readonly kind: 'accepted';
    } | {
        readonly kind: 'rejected';
        readonly reason: string;
    } | {
        readonly kind: 'duplicate';
    };
    status(): string;
    log(sequence: number): string | null;
    executeAdmin(command: string, write: (text: string) => void): void;
}
export class QuakeWorldConnectionlessServer {
    constructor(readonly host: QuakeWorldConnectionHost, readonly challenges: QuakeWorldChallenges) { }
    receive(bytes: Uint8Array, from: NetworkAddress, nowMilliseconds: number): readonly Uint8Array[] {
        if (this.host.blocked(from))
            return [quakeWorldOutOfBand('n\nbanned.\n')];
        const text = readQuakeWorldOutOfBand(bytes), args = quakeWorldCommandArguments(text.split('\n', 1)[0] ?? ''), command = args[0];
        if (command === 'ping' || text === 'k')
            return [quakeWorldOutOfBand('l')];
        if (command === 'getchallenge')
            return [quakeWorldOutOfBand(`c${this.challenges.issue(from, nowMilliseconds)}`)];
        if (command === 'status')
            return [quakeWorldOutOfBand(`n${this.host.status()}`)];
        if (command === 'log') {
            const reply = this.host.log(Number.parseInt(args[1] ?? '-1', 10));
            return [quakeWorldOutOfBand(reply === null ? 'm' : reply)];
        }
        if (command === 'rcon') {
            if (this.host.rconPassword === '' || args[1] !== this.host.rconPassword)
                return [quakeWorldOutOfBand('nBad rcon_password.\n')];
            const replies: Uint8Array[] = [];
            let output = '';
            const flush = (): void => {
                if (output !== '') {
                    replies.push(quakeWorldOutOfBand(`n${output}`));
                    output = '';
                }
            };
            this.host.executeAdmin(args.slice(2).map(arg => `${arg} `).join(''), part => {
                for (const ch of part) {
                    output += ch;
                    if (output.length >= 7995)
                        flush();
                }
            });
            flush();
            return replies;
        }
        if (command !== 'connect')
            return [];
        if (args[1] !== '28')
            return [quakeWorldOutOfBand('n\nServer uses QuakeWorld protocol 28.\n')];
        const qport = Number.parseInt(args[2] ?? '', 10), challenge = Number.parseInt(args[3] ?? '', 10);
        if (!Number.isInteger(qport) || qport < 0 || qport > 65535 || !this.challenges.validate(from, challenge))
            return [quakeWorldOutOfBand('n\nBad challenge.\n')];
        const info = new Map(quakeWorldInfo((args[4] ?? '').slice(0, 1022))), spectatorKey = info.get('spectator') ?? '', spectator = spectatorKey !== '' && spectatorKey !== '0', password = spectator ? this.host.spectatorPassword : this.host.password, supplied = spectator ? spectatorKey : info.get('password') ?? '';
        if (password !== '' && password.toLowerCase() !== 'none' && password !== supplied)
            return [quakeWorldOutOfBand(spectator ? 'n\nrequires a spectator password\n\n' : 'n\nserver requires a password\n\n')];
        info.delete(spectator ? 'spectator' : 'password');
        if (spectator)
            info.set('*spectator', '1');
        const donorWide = info.get('*wide') === '1';
        let userinfo = infoString(info);
        if (!this.host.highCharacters)
            userinfo = [...userinfo].filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) <= 127).join('');
        userinfo = userinfo.slice(0, 195);
        const result = this.host.connect({ from, qport, challenge, userinfo, spectator, donorWide }, nowMilliseconds);
        return result.kind === 'duplicate' ? [] : result.kind === 'accepted' ? [quakeWorldOutOfBand('j')] : [quakeWorldOutOfBand(`n${result.reason}`)];
    }
}
export type QuakeWorldConnectState = {
    readonly kind: 'challenge';
    readonly sentAt: number;
} | {
    readonly kind: 'connect';
    readonly challenge: number;
    readonly sentAt: number;
} | {
    readonly kind: 'connected';
} | {
    readonly kind: 'rejected';
    readonly reason: string;
};
export class QuakeWorldConnectClient {
    state: QuakeWorldConnectState = { kind: 'challenge', sentAt: -Infinity };
    constructor(readonly qport: number, readonly userinfo: string) { }
    next(nowMilliseconds: number): Uint8Array | null {
        const state = this.state;
        if (state.kind === 'connected' || state.kind === 'rejected' || nowMilliseconds - state.sentAt < 5000)
            return null;
        this.state = { ...state, sentAt: nowMilliseconds };
        return quakeWorldOutOfBand(state.kind === 'challenge' ? 'getchallenge\n' : `connect 28 ${this.qport} ${state.challenge} "${this.userinfo}"\n`);
    }
    receive(bytes: Uint8Array): void {
        const text = readQuakeWorldOutOfBand(bytes);
        if (text.startsWith('c')) {
            const challenge = Number.parseInt(text.slice(1), 10);
            if (Number.isInteger(challenge))
                this.state = { kind: 'connect', challenge, sentAt: -Infinity };
        }
        else if (text === 'j')
            this.state = { kind: 'connected' };
        else if (text.startsWith('n'))
            this.state = { kind: 'rejected', reason: text.slice(1) };
    }
}
export function quakeWorldHeartbeat(sequence: number, activeClients: number): Uint8Array { return quakeWorldOutOfBand(`a\n${sequence}\n${activeClients}\n`); }
export function quakeWorldShutdown(): Uint8Array { return quakeWorldOutOfBand('C\n'); }
export type NetQuakeConnectState = {
    readonly kind: 'waiting';
    readonly attempts: number;
    readonly sentAt: number;
} | {
    readonly kind: 'connected';
    readonly port: number;
} | {
    readonly kind: 'rejected';
    readonly reason: string;
};
export class NetQuakeConnectClient {
    state: NetQuakeConnectState = { kind: 'waiting', attempts: 0, sentAt: -Infinity };
    next(nowMilliseconds: number): Uint8Array | null {
        const state = this.state;
        if (state.kind !== 'waiting' || nowMilliseconds - state.sentAt < 2500)
            return null;
        if (state.attempts === 3) {
            this.state = { kind: 'rejected', reason: 'No response' };
            return null;
        }
        this.state = { kind: 'waiting', attempts: state.attempts + 1, sentAt: nowMilliseconds };
        return encodeNetQuakeControl({ kind: 'connect-request', game: 'QUAKE', version: 3 });
    }
    receive(bytes: Uint8Array): void {
        const message = decodeNetQuakeControl(bytes);
        if (message.kind === 'reject')
            this.state = { kind: 'rejected', reason: message.reason };
        else if (message.kind === 'accept') {
            if (message.port < 1 || message.port > 65535)
                throw new PacketError('Invalid accepted port', 5);
            this.state = { kind: 'connected', port: message.port };
        }
    }
}
export class QuakeWorldMasterHeartbeat {
    private previousMilliseconds = -Infinity;
    private sequence = 0;
    next(nowMilliseconds: number, activeClients: number, force = false): Uint8Array | null {
        if (!force && nowMilliseconds - this.previousMilliseconds < 300000)
            return null;
        this.previousMilliseconds = nowMilliseconds;
        return quakeWorldHeartbeat(++this.sequence, activeClients);
    }
}
