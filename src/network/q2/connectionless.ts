// Quake II sv_main.c, q2repro server/main.c and donor cl_main.ts. GPL-2.0-or-later.
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { parseQ2Token } from '../../core/common-parse.ts';
import { ipv4Address, addressKey } from '../common/endpoint.ts';
import type { NetworkAddress, Ipv4Address } from '../common/endpoint.ts';
import type { DiscoveryWire, ServerStatus } from '../services/discovery.ts';
import { Q2ChallengeTable, q2OutOfBand, readQ2Connect, readQ2OutOfBand } from './handshake.ts';
import type { Q2ConnectRequest, Q2ConnectionlessMessage } from './handshake.ts';
import { readElement } from './state.ts';
import { stringToBytes } from './message.ts';
export interface Q2Status {
    readonly serverInfo: string;
    readonly players: readonly {
        readonly score: number;
        readonly ping: number;
        readonly name: string;
    }[];
}
export function q2StatusText(status: Q2Status, maximumBytes = 1384): string {
    let result = `${status.serverInfo}\n`;
    if (result.length >= maximumBytes)
        throw new RangeError('Q2 serverinfo exceeds status packet capacity');
    for (const player of status.players) {
        const line = `${player.score} ${player.ping} "${player.name}"\n`;
        if (result.length + line.length >= maximumBytes)
            break;
        result += line;
    }
    return result;
}
export function readQ2Status(message: Q2ConnectionlessMessage, protocol: Q2ProtocolIdentity): ServerStatus | null {
    if (message.command !== 'print')
        return null;
    const lines = message.body.split('\n'), info = lines.shift();
    if (info === undefined || !info.startsWith('\\'))
        return null;
    const fields = info.slice(1).split('\\'), rules = new Map<string, string>();
    for (let i = 0; i + 1 < fields.length; i += 2)
        rules.set(readElement(fields, i), readElement(fields, i + 1));
    const players: {
        name: string;
        score: number;
        ping: number;
    }[] = [];
    for (const line of lines) {
        const match = /^(-?\d+) (-?\d+) "(.*)"$/.exec(line);
        if (match !== null)
            players.push({ score: Number(match[1]), ping: Number(match[2]), name: match[3] ?? '' });
    }
    return { name: rules.get('hostname') ?? '', map: rules.get('mapname') ?? '', players: players.length, maxPlayers: Number(rules.get('maxclients') ?? 0), rules, playerDetails: players, wire: { kind: 'source', protocol } };
}
export function q2DiscoveryWire(protocol: Q2ProtocolIdentity, status: () => Q2Status): DiscoveryWire {
    return {
        query: kind => q2OutOfBand(kind === 'info' ? `info ${protocol.version}` : 'status'),
        // Existing donor master implementation uses this bare request, outside OOB framing.
        masterQuery: () => stringToBytes('query'),
        heartbeat: active => q2OutOfBand(active ? `heartbeat\n${q2StatusText(status())}` : 'shutdown'),
    };
}
/** Parse before text OOB decoding: IPv4 records may contain zero and newline bytes. */
export function readQ2MasterReply(bytes: Uint8Array): readonly Ipv4Address[] | null {
    let start = bytes.length >= 4 && bytes.subarray(0, 4).every(value => value === 255) ? 4 : 0;
    const prefix = bytes.subarray(start, start + 8);
    if (prefix.length !== 8 || !'servers'.split('').every((value, i) => prefix[i] === value.charCodeAt(0)) || (prefix[7] !== 32 && prefix[7] !== 10))
        return null;
    start += 8;
    if ((bytes.length - start) % 6 !== 0)
        throw new Error('Partial Q2 master address');
    const found = new Map<string, Ipv4Address>();
    for (let offset = start; offset < bytes.length; offset += 6) {
        const port = (readElement(bytes, offset + 4) << 8) | readElement(bytes, offset + 5);
        if (port === 0)
            continue;
        const address = ipv4Address([readElement(bytes, offset), readElement(bytes, offset + 1), readElement(bytes, offset + 2), readElement(bytes, offset + 3)], port);
        found.set(addressKey(address), address);
    }
    return [...found.values()];
}
export type Q2ConnectAdmission = {
    readonly kind: 'accepted';
    readonly responseArguments?: string;
} | {
    readonly kind: 'rejected';
    readonly reason: string;
};
export interface Q2ConnectionlessHost {
    readonly profile: 'classic' | 'rerelease';
    readonly protocols: readonly Q2ProtocolIdentity[];
    status(): Q2Status;
    info(): {
        readonly name: string;
        readonly map: string;
        readonly players: number;
        readonly maxPlayers: number;
    };
    /** Source session owns slots, reconnect limits, userinfo/IP binding, and Game ClientConnect. */
    connect(from: NetworkAddress, request: Q2ConnectRequest): Q2ConnectAdmission;
    reply(to: NetworkAddress, bytes: Uint8Array): void;
    rconPassword(): string;
    limitedRcon(): {
        readonly password: string;
        readonly prefixes: readonly string[];
    } | null;
    /** q2repro source rate limiter is checked before authentication and recharged after it. */
    rconRateAllowed(now: number): boolean;
    rechargeRconRate(): void;
    executeRcon(command: string, limited: boolean, output: (text: string) => void): Promise<void>;
}
export function q2InfoText(info: ReturnType<Q2ConnectionlessHost['info']>, protocols: readonly Q2ProtocolIdentity[], version: number): string | null {
    if (info.maxPlayers === 1) return null;
    return !protocols.some(protocol => protocol.version === version) ? `info\n${info.name}: wrong version\n`
        : `info\n${info.name.padStart(16)} ${info.map.padStart(8)} ${String(info.players).padStart(2)}/${String(info.maxPlayers).padStart(2)}\n`;
}
export class Q2ConnectionlessServer {
    constructor(readonly host: Q2ConnectionlessHost, readonly challenges: Q2ChallengeTable) { }
    async receive(from: NetworkAddress, bytes: Uint8Array, now: number): Promise<boolean> {
        const message = readQ2OutOfBand(bytes);
        if (message === null)
            return false;
        const reply = (text: string): void => this.host.reply(from, q2OutOfBand(text));
        switch (message.command) {
            case 'ping':
                reply('ack');
                return true;
            case 'status':
                reply(`print\n${q2StatusText(this.host.status())}`);
                return true;
            case 'info': {
                const text = q2InfoText(this.host.info(), this.host.protocols, Number(message.arguments[0]));
                if (text !== null) reply(text);
                return true;
            }
            case 'getchallenge':
                this.host.reply(from, this.challenges.reply(from, now, this.host.protocols));
                return true;
            case 'connect': {
                const request = readQ2Connect(message);
                if (!this.host.protocols.some(protocol => protocol.version === request.protocol.version)) {
                    reply('print\nUnsupported protocol.\n');
                    return true;
                }
                if (!this.challenges.validate(from, request.challenge)) {
                    reply('print\nBad challenge.\n');
                    return true;
                }
                const admission = this.host.connect(from, request);
                reply(admission.kind === 'accepted' ? `client_connect${admission.responseArguments === undefined ? '' : ` ${admission.responseArguments}`}` : `print\n${admission.reason}\n`);
                return true;
            }
            case 'rcon': {
                if (this.host.profile === 'rerelease' && !this.host.rconRateAllowed(now))
                    return true;
                const password = message.arguments[0] ?? '', full = this.host.rconPassword(), limit = this.host.limitedRcon();
                const limited = !(full.length > 0 && password === full) && this.host.profile === 'rerelease' && limit !== null && limit.password.length > 0 && password === limit.password;
                if (!(full.length > 0 && password === full) && !limited) {
                    reply('print\nBad rcon_password.\n');
                    return true;
                }
                if (this.host.profile === 'rerelease')
                    this.host.rechargeRconRate();
                const cursor = { data: message.text, index: 0 };
                parseQ2Token(cursor);
                parseQ2Token(cursor);
                const command = this.host.profile === 'classic' ? `${message.arguments.slice(1).join(' ')} ` : message.text.slice(cursor.index).trimStart();
                if (limited && limit !== null && !limit.prefixes.some(prefix => command.startsWith(prefix))) {
                    reply('print\nThis command is not permitted.\n');
                    return true;
                }
                let buffered = '';
                const flush = (): void => {
                    if (buffered.length > 0) {
                        reply(`print\n${buffered}`);
                        buffered = '';
                    }
                };
                try {
                    await this.host.executeRcon(command, limited, text => {
                        for (const character of text) {
                            if (character.charCodeAt(0) > 255)
                                throw new RangeError('Q2 rcon output requires byte characters');
                            if (buffered.length === 1383)
                                flush();
                            buffered += character;
                        }
                    });
                }
                finally {
                    flush();
                }
                return true;
            }
            default: return false;
        }
    }
}
