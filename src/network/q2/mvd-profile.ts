import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { createMessage, loadMessage, checkMessageRead, MSG_ReadByte, MSG_ReadLong, MSG_ReadWord, MSG_ReadShort, MSG_ReadString } from './message.ts';
import type { ServerDataReadResultT } from './codecs/codec.ts';
export interface MvdProfile {
    readonly revision: number; readonly flags: number; readonly protocol: Q2ProtocolIdentity;
    readonly rerelease: boolean; readonly extended: boolean; readonly v2: boolean; readonly fog: boolean;
    readonly maxConfigStrings: number; readonly maxClientsIndex: number; readonly maxEntities: number;
}
export function mvdProfile(revision: number, flags: number): MvdProfile {
    if (!(revision >= 2009 && revision <= 2013 || revision === 3038)) throw new Error(`Unsupported MVD revision ${revision}`);
    const rerelease = revision === 3038, extended = rerelease || revision >= 2011 && (flags & 4) !== 0, v2 = !rerelease && revision >= 2012 && (flags & 8) !== 0;
    if (v2 && !extended) throw new Error('MVD extended-v2 requires extended limits');
    const protocol: Q2ProtocolIdentity = rerelease ? { kind: 'q2-rerelease', version: 1038 } : extended ? { kind: 'q2-q2pro', version: 36, revision: revision === 2013 ? 1026 : v2 ? 1025 : 1024 } : { kind: 'q2-classic', version: 34 };
    return { revision, flags, protocol, rerelease, extended, v2, fog: v2 && revision >= 2013, maxConfigStrings: rerelease ? 12448 : extended ? 13630 : 2080, maxClientsIndex: extended ? 60 : 30, maxEntities: extended ? 8192 : 1024 };
}
export interface MvdHeader extends MvdProfile {
    readonly data: ServerDataReadResultT; readonly configStrings: ReadonlyMap<number, string>; readonly frameOffset: number; readonly dummy: number; readonly maxClients: number;
}
export function readMvdHeader(bytes: Uint8Array): MvdHeader {
    const message = createMessage(bytes.length); loadMessage(message, bytes);
    const command = MSG_ReadByte(message);
    if ((command & 31) !== 4 || MSG_ReadLong(message) !== 37) throw new Error('MVD gamestate header expected');
    const revision = MSG_ReadWord(message);
    // Native emit_gamestate keeps3038 flags in opcode, unlike2012/2013.
    const flags = revision >= 2012 && revision !== 3038 ? MSG_ReadWord(message) : command >>> 5;
    const profile = mvdProfile(revision, flags), servercount = MSG_ReadLong(message), gamedir = MSG_ReadString(message), dummy = MSG_ReadShort(message);
    const configStrings = new Map<number, string>();
    for (;;) {
        const index = MSG_ReadWord(message); checkMessageRead(message);
        if (index === profile.maxConfigStrings) break;
        if (index >= profile.maxConfigStrings) throw new Error('Invalid MVD configstring index');
        configStrings.set(index, MSG_ReadString(message));
    }
    const maxClients = Number(configStrings.get(profile.maxClientsIndex));
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 256 || dummy < -1 || dummy >= maxClients) throw new Error('Invalid MVD player limits');
    checkMessageRead(message);
    const data: ServerDataReadResultT = { servercount, gamedir, clientnum: 0, levelname: configStrings.get(0) ?? '', attractloop: true, serverState: 2, serverFps: 10, ...(profile.protocol.kind === 'q2-q2pro' ? { q2proVersion: profile.protocol.revision, wireFlags: profile.v2 ? 24 : 8 } : {}) };
    return { ...profile, data, configStrings, frameOffset: message.readcount, dummy, maxClients };
}
