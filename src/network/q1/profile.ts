import type { Q1ProtocolIdentity, QwProtocolIdentity } from '../../contracts/protocol.ts';
import { PRFL_SUPPORTED, PRFL_INT32COORD, PRFL_SHORTANGLE } from './constants.ts';
import { createNq15Codec } from './codecs/nq15.ts';
import { makeWideCodec } from './codecs/wide.ts';
import { createQw28Codec } from './codecs/qw28.ts';
import { createQw29Codec } from './codecs/qw29.ts';
import type { ProtocolCodec, QwProtocolCodec } from './codecs/codec.ts';
import type { MessageReader } from './message.ts';
export type QuakeWorldProfile = QwProtocolIdentity;
export type RereleaseMessages = 'known-retail' | 'quake-1-re-ts-private';
export function netQuakeProfile(version: number, flags = 0): Q1ProtocolIdentity {
    switch (version) {
        case 15: return { kind: 'q1-netquake', version };
        case 666: return { kind: 'q1-fitzquake', version };
        case 999:
            if ((flags & ~PRFL_SUPPORTED) !== 0)
                throw new Error(`Unsupported RMQ flags ${flags}`);
            return { kind: 'q1-rmq', version, flags };
        default: throw new Error(`Unsupported NetQuake protocol ${version}`);
    }
}
export function quakeWorldProfile(version: number, flags = 0): QuakeWorldProfile {
    if (version === 28)
        return { kind: 'q1-quakeworld', version };
    if (version === 29 && (flags & ~PRFL_SUPPORTED) === 0)
        return { kind: 'q1-quakeworld-donor-wide', version, flags };
    throw new Error(`Unsupported QuakeWorld protocol ${version} / flags ${flags}`);
}
export function createNetQuakeCodec(profile: Q1ProtocolIdentity, reader: MessageReader): ProtocolCodec {
    switch (profile.version) {
        case 15: return createNq15Codec(reader);
        case 666: return makeWideCodec(reader, 666, 'FitzQuake', 0, false);
        case 999: return makeWideCodec(reader, 999, 'RMQ', PRFL_INT32COORD | PRFL_SHORTANGLE, true);
    }
}
export function createQuakeWorldCodec(profile: QuakeWorldProfile, reader: MessageReader): QwProtocolCodec { return profile.version === 28 ? createQw28Codec(reader) : createQw29Codec(reader); }
export function protocolFlags(profile: Q1ProtocolIdentity | QuakeWorldProfile): number { return 'flags' in profile ? profile.flags : 0; }
