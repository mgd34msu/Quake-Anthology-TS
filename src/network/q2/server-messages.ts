// Quake II cl_parse.c and q2proto protocol dispatch. GPL-2.0-or-later.
import type { Vec3 } from '../../contracts/math.ts';
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { inflateRawSync, constants as zlibConstants } from 'node:zlib';
import { Q2WireCodec } from './codec.ts';
import type { ServerDataReadResultT } from './codecs/codec.ts';
import type { KexDamageIndicatorT, KexHelpPathT, KexLocprintT, KexPoiT } from './codecs/kexdemo.ts';
import type { SvcFogDataT } from './fog.ts';
import { Q2FrameHistory } from './frames.ts';
import type { Q2WireFrame } from './frames.ts';
import { EntityStateT, readElement } from './state.ts';
import { checkMessageRead, MSG_ReadByte, MSG_ReadLong, MSG_ReadShort, MSG_ReadWord, MSG_ReadString } from './message.ts';
import type { SizeBuf } from './message.ts';
import { readZPacketPayload } from './codecs/zpacket.ts';
import { readGamePosition, readTempEntity } from './temp-entities.ts';
import type { Q2TempEntity } from './temp-entities.ts';
export interface Q2SoundMessage {
    readonly flags: number;
    readonly index: number;
    readonly entity: number;
    readonly channel: number;
    readonly position: Vec3 | null;
    readonly volume: number;
    readonly attenuation: number;
    readonly delaySeconds: number;
}
export type Q2ServerEvent = {
    readonly kind: 'nop' | 'disconnect' | 'reconnect' | 'level-restart';
} | {
    readonly kind: 'server-data';
    readonly data: ServerDataReadResultT;
} | {
    readonly kind: 'print';
    readonly level: number;
    readonly text: string;
} | {
    readonly kind: 'center-print' | 'command-text' | 'layout' | 'achievement';
    readonly text: string;
} | {
    readonly kind: 'config-string';
    readonly index: number;
    readonly value: string;
} | {
    readonly kind: 'baseline';
    readonly entity: EntityStateT;
} | {
    readonly kind: 'frame';
    readonly frame: Q2WireFrame;
} | {
    readonly kind: 'sound';
    readonly sound: Q2SoundMessage;
} | {
    readonly kind: 'temporary-entity';
    readonly value: Q2TempEntity;
} | {
    readonly kind: 'muzzle-flash';
    readonly entity: number;
    readonly flash: number;
    readonly monster: boolean;
    readonly silenced: boolean;
} | {
    readonly kind: 'inventory';
    readonly counts: readonly number[];
} | {
    readonly kind: 'download';
    readonly percent: number;
    readonly bytes: Uint8Array | null;
} | {
    readonly kind: 'setting';
    readonly index: number;
    readonly value: number;
} | {
    readonly kind: 'seat';
    readonly seat: number;
} | {
    readonly kind: 'damage';
    readonly indicators: readonly KexDamageIndicatorT[];
} | {
    readonly kind: 'localized-print';
    readonly value: KexLocprintT;
} | {
    readonly kind: 'fog';
    readonly value: SvcFogDataT;
} | {
    readonly kind: 'poi';
    readonly value: KexPoiT;
} | {
    readonly kind: 'help-path';
    readonly value: KexHelpPathT;
} | {
    readonly kind: 'private';
    readonly name: string;
    readonly payload: Uint8Array;
};
export interface Q2ServerRecord {
    readonly seat: number;
    readonly opcode: number;
    readonly raw: Uint8Array;
    readonly event: Q2ServerEvent;
}
export interface Q2ServerMessageOptions {
    readonly maxConfigStrings: number;
    readonly inventorySlots: number;
    readonly q2proExtendedTempEntities?: boolean;
    /** A mod knows its own payload shape. It must consume exactly its payload. */
    readonly privateOpcodes?: ReadonlySet<number>;
    readonly privateMessage?: (opcode: number, message: SizeBuf, protocol: Q2ProtocolIdentity) => Extract<Q2ServerEvent, {
        kind: 'private';
    }>;
}
export class Q2UnboundServerMessage extends Error {
    constructor(readonly opcode: number, readonly protocol: Q2ProtocolIdentity, readonly remaining: Uint8Array) { super(`Q2 service opcode ${opcode} has no binding for ${protocol.kind}`); this.name = 'Q2UnboundServerMessage'; }
}
export class Q2ServerMessageReader {
    readonly wire: Q2WireCodec;
    readonly configStrings = new Map<number, string>();
    private readonly histories = new Map<number, Q2FrameHistory>();
    private readonly baselines = new Map<number, EntityStateT>();
    private selectedSeat = 0;
    private stream: 'none' | 'config' | 'baseline' | 'gamestate-config' = 'none';
    private compressedDownload: Uint8Array = new Uint8Array(0);
    private inflatedDownloadBytes = 0;
    constructor(protocol: Q2ProtocolIdentity, readonly options: Q2ServerMessageOptions) {
        this.wire = new Q2WireCodec(protocol);
        if (!Number.isInteger(options.maxConfigStrings) || options.maxConfigStrings < 1 || options.maxConfigStrings > 65535 || !Number.isInteger(options.inventorySlots) || options.inventorySlots < 1 || options.inventorySlots > 32768)
            throw new RangeError('Invalid Q2 message layout limits');
    }
    get seat(): number { return this.selectedSeat; }
    history(seat = this.selectedSeat): Q2FrameHistory {
        const existing = this.histories.get(seat);
        if (existing !== undefined)
            return existing;
        const history = new Q2FrameHistory();
        for (const [index, base] of this.baselines)
            history.baselines.set(index, base);
        this.histories.set(seat, history);
        return history;
    }
    reset(): void { this.histories.clear(); this.baselines.clear(); this.configStrings.clear(); this.stream = 'none'; this.selectedSeat = 0; this.compressedDownload = new Uint8Array(0); this.inflatedDownloadBytes = 0; }
    read(bytes: Uint8Array): Q2ServerRecord[] { this.wire.begin(bytes); const records = this.parse(); this.wire.finish(); return records; }
    private record(opcode: number, start: number, event: Q2ServerEvent): Q2ServerRecord { checkMessageRead(this.wire.message); return { seat: this.selectedSeat, opcode, raw: this.wire.message.data.slice(start, this.wire.message.readcount), event }; }
    private config(): Q2ServerEvent | null {
        const message = this.wire.message, index = MSG_ReadWord(message);
        if (index === this.options.maxConfigStrings)
            return null;
        if (index >= this.options.maxConfigStrings)
            throw new RangeError('Q2 configstring index exceeds selected layout');
        const value = MSG_ReadString(message);
        this.configStrings.set(index, value);
        return { kind: 'config-string', index, value };
    }
    private baseline(): Q2ServerEvent | null {
        const header = this.wire.codec.readEntityBits();
        if (header.number === 0)
            return null;
        const entity = new EntityStateT();
        this.wire.codec.readDeltaEntity(new EntityStateT(), entity, header.number, header.bits);
        this.baselines.set(entity.number, entity);
        for (const history of this.histories.values())
            history.baselines.set(entity.number, entity);
        return { kind: 'baseline', entity };
    }
    private sound(): Q2SoundMessage {
        if (this.wire.protocol.kind === 'q2-kex' || this.wire.protocol.kind === 'q2-kex-demo') {
            const s = this.wire.kex.readSoundKex();
            return { flags: s.flags, index: s.index, entity: s.entity, channel: s.channel, position: s.pos === null ? null : { x: readElement(s.pos, 0), y: readElement(s.pos, 1), z: readElement(s.pos, 2) }, volume: s.volume, attenuation: s.attenuation, delaySeconds: s.timeofs };
        }
        const m = this.wire.message, flags = MSG_ReadByte(m), index = (flags & 32) !== 0 ? MSG_ReadWord(m) : MSG_ReadByte(m);
        const volume = (flags & 1) !== 0 ? MSG_ReadByte(m) / 255 : 1, attenuation = (flags & 2) !== 0 ? MSG_ReadByte(m) / 64 : 1, delaySeconds = (flags & 16) !== 0 ? MSG_ReadByte(m) / 1000 : 0;
        const channel = (flags & 8) !== 0 ? MSG_ReadWord(m) : 0;
        return { flags, index, volume, attenuation, delaySeconds, entity: channel >>> 3, channel: channel & 7, position: (flags & 4) !== 0 ? readGamePosition(m, this.wire.floatingCoordinates, this.wire.q2proExtendedV2) : null };
    }
    private download(compressed: 'none' | 'block' | 'stream'): Q2ServerEvent {
        const m = this.wire.message, length = MSG_ReadShort(m), percent = MSG_ReadByte(m);
        if (length < 0) {
            this.compressedDownload = new Uint8Array(0);
            this.inflatedDownloadBytes = 0;
            return { kind: 'download', percent, bytes: null };
        }
        const expected = compressed === 'block' ? MSG_ReadWord(m) : null;
        if (m.readcount + length > m.cursize)
            throw new Error('Truncated Q2 download block');
        const bytes = m.data.slice(m.readcount, m.readcount + length);
        m.readcount += length;
        if (compressed === 'none')
            return { kind: 'download', percent, bytes };
        if (compressed === 'block') {
            if (expected === null)
                throw new Error('Compressed download missing length');
            const inflated = new Uint8Array(inflateRawSync(bytes, { maxOutputLength: expected || 1 }));
            if (inflated.length !== expected)
                throw new Error('Q2 download length mismatch');
            return { kind: 'download', percent, bytes: inflated };
        }
        // Q2rePRO keeps a single raw deflate stream across download packets.
        const joined = new Uint8Array(this.compressedDownload.length + bytes.length);
        joined.set(this.compressedDownload);
        joined.set(bytes, this.compressedDownload.length);
        this.compressedDownload = joined;
        const inflated = new Uint8Array(inflateRawSync(joined, { finishFlush: percent === 100 ? zlibConstants.Z_FINISH : zlibConstants.Z_SYNC_FLUSH }));
        const delta = inflated.slice(this.inflatedDownloadBytes);
        this.inflatedDownloadBytes = inflated.length;
        if (percent === 100) {
            this.compressedDownload = new Uint8Array(0);
            this.inflatedDownloadBytes = 0;
        }
        return { kind: 'download', percent, bytes: delta };
    }
    private parse(): Q2ServerRecord[] {
        const records: Q2ServerRecord[] = [], m = this.wire.message;
        const kex = this.wire.protocol.kind === 'q2-kex' || this.wire.protocol.kind === 'q2-kex-demo';
        const rerelease = this.wire.protocol.kind === 'q2-rerelease' || this.wire.protocol.kind === 'q2-private-classic';
        while (m.readcount < m.cursize) {
            const start = m.readcount;
            if (this.stream !== 'none') {
                const mode = this.stream, event = mode === 'baseline' ? this.baseline() : this.config();
                if (event !== null)
                    records.push(this.record(mode === 'baseline' ? 39 : 38, start, event));
                else
                    this.stream = mode === 'gamestate-config' ? 'baseline' : 'none';
                checkMessageRead(m);
                continue;
            }
            const opcode = this.wire.opcode(MSG_ReadByte(m));
            let event: Q2ServerEvent;
            if (this.options.privateOpcodes?.has(opcode) === true) {
                const decode = this.options.privateMessage;
                if (decode === undefined)
                    throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                records.push(this.record(opcode, start, decode(opcode, m, this.wire.protocol)));
                continue;
            }
            if ((opcode === 21 && (this.wire.protocol.kind === 'q2-r1q2' || this.wire.protocol.kind === 'q2-q2pro')) || (opcode === 34 && rerelease)) {
                const payload = readZPacketPayload(m);
                records.push(...this.wire.nested(payload, () => this.parse()));
                continue;
            }
            switch (opcode) {
                case 6:
                    event = { kind: 'nop' };
                    break;
                case 7:
                    event = { kind: 'disconnect' };
                    break;
                case 8:
                    event = { kind: 'reconnect' };
                    break;
                case 10:
                    event = { kind: 'print', level: MSG_ReadByte(m), text: MSG_ReadString(m) };
                    break;
                case 11:
                    event = { kind: 'command-text', text: MSG_ReadString(m) };
                    break;
                case 15:
                    event = { kind: 'center-print', text: MSG_ReadString(m) };
                    break;
                case 4:
                    event = { kind: 'layout', text: MSG_ReadString(m) };
                    break;
                case 12: {
                    const protocol = MSG_ReadLong(m);
                    if (protocol !== this.wire.protocol.version)
                        throw new Error(`Q2 serverdata protocol ${protocol} differs from negotiated ${this.wire.protocol.version}`);
                    const data = this.wire.codec.readServerData();
                    this.wire.acceptServerRevision(data.r1q2Version);
                    this.reset();
                    event = { kind: 'server-data', data };
                    break;
                }
                case 13: {
                    const parsed = this.config();
                    if (parsed === null)
                        throw new Error('Q2 configstring terminator outside stream');
                    event = parsed;
                    break;
                }
                case 14: {
                    const parsed = this.baseline();
                    if (parsed === null)
                        throw new Error('Q2 zero spawn baseline');
                    event = parsed;
                    break;
                }
                case 20:
                    event = { kind: 'frame', frame: this.history().read(this.wire) };
                    break;
                case 9:
                    event = { kind: 'sound', sound: this.sound() };
                    break;
                case 3:
                    event = { kind: 'temporary-entity', value: readTempEntity(m, this.wire.floatingCoordinates, this.options.q2proExtendedTempEntities ?? this.wire.q2proExtended, this.wire.q2proExtendedV2) };
                    break;
                case 1:
                case 2: {
                    let entity = MSG_ReadWord(m), flash = MSG_ReadByte(m);
                    const monster = opcode === 2;
                    const silenced = !monster && (flash & 128) !== 0;
                    if (!monster)
                        flash &= 127;
                    if (monster && (rerelease || this.wire.q2proExtended)) {
                        flash |= (entity & 0xe000) >>> 5;
                        entity &= 0x1fff;
                    }
                    event = { kind: 'muzzle-flash', entity, flash, monster, silenced };
                    break;
                }
                case 5: {
                    const counts: number[] = [];
                    for (let i = 0; i < this.options.inventorySlots; i++)
                        counts.push(MSG_ReadShort(m));
                    event = { kind: 'inventory', counts };
                    break;
                }
                case 16:
                    event = this.download('none');
                    break;
                case 21:
                    if (!kex)
                        throw new Error('Unexpected Q2 splitclient');
                    this.selectedSeat = this.wire.kex.readSplitclientKex();
                    event = { kind: 'seat', seat: this.selectedSeat };
                    break;
                case 22: {
                    if (!kex) {
                        event = this.download(this.wire.protocol.kind === 'q2-q2pro' && this.wire.q2proRevision >= 1021 ? 'stream' : 'block');
                        break;
                    }
                    for (const item of this.wire.kex.readConfigblastKex()) {
                        if (item.index >= this.options.maxConfigStrings)
                            throw new Error('KEX configblast index exceeds selected layout');
                        this.configStrings.set(item.index, item.value);
                        records.push(this.record(opcode, start, { kind: 'config-string', ...item }));
                    }
                    continue;
                }
                case 23: {
                    if (!kex) {
                        this.stream = 'gamestate-config';
                        continue;
                    }
                    for (const item of this.wire.kex.readSpawnbaselineblastKex()) {
                        this.baselines.set(item.entnum, item.state);
                        for (const history of this.histories.values())
                            history.baselines.set(item.entnum, item.state);
                        records.push(this.record(opcode, start, { kind: 'baseline', entity: item.state }));
                    }
                    continue;
                }
                case 24:
                    if (kex)
                        event = { kind: 'level-restart' };
                    else
                        event = { kind: 'setting', index: MSG_ReadLong(m), value: MSG_ReadLong(m) };
                    break;
                case 25:
                    if (!kex && !rerelease) {
                        this.stream = 'config';
                        continue;
                    }
                    event = { kind: 'damage', indicators: this.wire.kex.readDamageKex() };
                    break;
                case 26:
                    if (!kex && !rerelease) {
                        this.stream = 'baseline';
                        continue;
                    }
                    event = { kind: 'localized-print', value: this.wire.kex.readLocprintKex() };
                    break;
                case 27:
                    event = { kind: 'fog', value: this.wire.rerelease.readFog() };
                    break;
                case 30:
                    event = { kind: 'poi', value: this.wire.kex.readPoiKex() };
                    break;
                case 31:
                    event = { kind: 'help-path', value: this.wire.kex.readHelpPathKex() };
                    break;
                case 32: {
                    const flash = this.wire.kex.readMuzzleflash3Kex();
                    event = { kind: 'muzzle-flash', entity: flash.entity, flash: flash.weapon, monster: true, silenced: false };
                    break;
                }
                case 33:
                    event = { kind: 'achievement', text: this.wire.kex.readAchievementKex() };
                    break;
                case 35:
                    if (!rerelease)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    event = this.download('stream');
                    break;
                case 36:
                    if (!rerelease)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    this.stream = 'gamestate-config';
                    continue;
                case 37:
                    if (!rerelease)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    event = { kind: 'setting', index: MSG_ReadLong(m), value: MSG_ReadLong(m) };
                    break;
                case 38:
                    if (!rerelease)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    this.stream = 'config';
                    continue;
                case 39:
                    if (!rerelease)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    this.stream = 'baseline';
                    continue;
                default: {
                    const read = this.options.privateMessage;
                    if (read === undefined)
                        throw new Q2UnboundServerMessage(opcode, this.wire.protocol, m.data.slice(start));
                    event = read(opcode, m, this.wire.protocol);
                }
            }
            records.push(this.record(opcode, start, event));
        }
        return records;
    }
}
