import { SaveReader } from "../../persistence/value.ts";
import { captureQwWireEntity, readQwWireEntity } from "./decoder-checkpoint.ts";
// QuakeWorld client/server packet entities and service messages. GPL-2.0-or-later.
import type { Vec3 } from '../../contracts/math.ts';
import type { QwPlayerState, QwUserCommand, Q1ExtendedEntityState } from '../../contracts/protocol.ts';
import { MessageReader, SizeBuf, PacketError, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteFloat, MSG_WriteString, SZ_Write } from './message.ts';
import { createQuakeWorldCodec, quakeWorldProfile, protocolFlags } from './profile.ts';
import type { QuakeWorldProfile } from './profile.ts';
import * as Q from './qw-constants.ts';
import { QwEntityWordT } from './codecs/codec.ts';
import type { QwProtocolCodec } from './codecs/codec.ts';
import { readTemporaryEntity } from './netquake.ts';
import type { TemporaryEntity } from './netquake.ts';
export interface QwMoveVariables {
    readonly gravity: number;
    readonly stopSpeed: number;
    readonly maxSpeed: number;
    readonly spectatorMaxSpeed: number;
    readonly accelerate: number;
    readonly airAccelerate: number;
    readonly waterAccelerate: number;
    readonly friction: number;
    readonly waterFriction: number;
    readonly entityGravity: number;
}
export interface QuakeWorldEntity extends Q1ExtendedEntityState {
    readonly quakeWorldFlags: number;
}
export type QuakeWorldMessage = {
    readonly kind: 'nop' | 'disconnect' | 'killed-monster' | 'found-secret' | 'sell-screen';
} | {
    readonly kind: 'stat';
    readonly index: number;
    readonly value: number;
} | {
    readonly kind: 'print';
    readonly level: number;
    readonly text: string;
} | {
    readonly kind: 'stufftext' | 'center-print' | 'finale';
    readonly text: string;
} | {
    readonly kind: 'set-angle';
    readonly angles: Vec3;
} | {
    readonly kind: 'set-view' | 'muzzle-flash';
    readonly entity: number;
} | {
    readonly kind: 'server-data';
    readonly protocol: QuakeWorldProfile;
    readonly serverCount: number;
    readonly gameDirectory: string;
    readonly playerSlot: number;
    readonly spectator: boolean;
    readonly level: string;
    readonly moveVariables: QwMoveVariables;
} | {
    readonly kind: 'light-style';
    readonly index: number;
    readonly value: string;
} | {
    readonly kind: 'frags' | 'ping' | 'enter-time' | 'packet-loss';
    readonly slot: number;
    readonly value: number;
} | {
    readonly kind: 'userinfo';
    readonly slot: number;
    readonly userId: number;
    readonly value: string;
} | {
    readonly kind: 'set-info';
    readonly slot: number;
    readonly key: string;
    readonly value: string;
} | {
    readonly kind: 'server-info';
    readonly key: string;
    readonly value: string;
} | {
    readonly kind: 'baseline' | 'static';
    readonly state: Q1ExtendedEntityState;
} | {
    readonly kind: 'sound' | 'static-sound';
    readonly entity: number;
    readonly channel: number;
    readonly index: number;
    readonly origin: Vec3;
    readonly volume: number;
    readonly attenuation: number;
} | {
    readonly kind: 'stop-sound';
    readonly entity: number;
    readonly channel: number;
} | {
    readonly kind: 'damage';
    readonly armor: number;
    readonly blood: number;
    readonly source: Vec3;
} | {
    readonly kind: 'temporary-entity';
    readonly effect: TemporaryEntity;
} | {
    readonly kind: 'pause';
    readonly paused: boolean;
} | {
    readonly kind: 'intermission';
    readonly origin: Vec3;
    readonly angles: Vec3;
} | {
    readonly kind: 'cd-track';
    readonly track: number;
} | {
    readonly kind: 'kick';
    readonly degrees: number;
} | {
    readonly kind: 'download';
    readonly result: {
        readonly kind: 'missing';
    } | {
        readonly kind: 'data';
        readonly percent: number;
        readonly bytes: Uint8Array;
    };
} | {
    readonly kind: 'player';
    readonly state: QwPlayerState;
} | {
    readonly kind: 'nails';
    readonly projectiles: readonly {
        readonly origin: Vec3;
        readonly pitch: number;
        readonly yaw: number;
    }[];
} | {
    readonly kind: 'choke-count';
    readonly count: number;
} | {
    readonly kind: 'model-list' | 'sound-list';
    readonly first: number;
    readonly names: readonly string[];
    readonly next: number;
} | {
    readonly kind: 'packet-entities';
    readonly sequence: number;
    readonly deltaSequence: number | null;
    readonly entities: readonly QuakeWorldEntity[];
} | {
    readonly kind: 'invalid-delta';
    readonly sequence: number;
    readonly requested: number;
} | {
    readonly kind: 'max-speed' | 'entity-gravity';
    readonly value: number;
};
const vec = (read: () => number): Vec3 => ({ x: read(), y: read(), z: read() });
export function qwCommand(command: Q.QwUsercmdT): QwUserCommand { return { kind: 'q1-quakeworld', milliseconds: command.msec, angles: { x: command.angles[0], y: command.angles[1], z: command.angles[2] }, forwardMove: command.forwardmove, sideMove: command.sidemove, upMove: command.upmove, buttons: command.buttons, impulse: command.impulse }; }
export function qwWireCommand(command: QwUserCommand): Q.QwUsercmdT { const s = new Q.QwUsercmdT(); s.msec = command.milliseconds; s.angles[0] = command.angles.x; s.angles[1] = command.angles.y; s.angles[2] = command.angles.z; s.forwardmove = command.forwardMove; s.sidemove = command.sideMove; s.upmove = command.upMove; s.buttons = command.buttons; s.impulse = command.impulse; return s; }
export function qwEntity(s: Q.QwEntityStateT): QuakeWorldEntity { return { quakeWorldFlags: s.flags, number: s.number, origin: { x: s.origin[0], y: s.origin[1], z: s.origin[2] }, angles: { x: s.angles[0], y: s.angles[1], z: s.angles[2] }, modelIndex: s.modelindex, frame: s.frame, colorMap: s.colormap, skin: s.skinnum, effects: s.effects, alpha: s.alpha, scale: s.scale, lerpFinishSeconds: 0, step: false }; }
export function qwWireEntity(s: Q1ExtendedEntityState, solid = false): Q.QwEntityStateT { const e = new Q.QwEntityStateT(); e.number = s.number; e.origin[0] = s.origin.x; e.origin[1] = s.origin.y; e.origin[2] = s.origin.z; e.angles[0] = s.angles.x; e.angles[1] = s.angles.y; e.angles[2] = s.angles.z; e.modelindex = s.modelIndex; e.frame = s.frame; e.colormap = s.colorMap; e.skinnum = s.skin; e.effects = s.effects; e.alpha = s.alpha; e.scale = s.scale; e.flags = solid ? Q.U_SOLID : 0; return e; }
export class QuakeWorldDecoder {
    readonly baselines = new Map<number, Q.QwEntityStateT>();
    private readonly frames = new Map<number, readonly Q.QwEntityStateT[]>();
    private readonly deltaRequests = new Map<number, number | null>();
    capture() { return { version: this.protocol.version, flags: protocolFlags(this.protocol), playerModelIndex: this.playerModelIndex,
        baselines: [...this.baselines].map(([slot, state]) => ({ slot, state: captureQwWireEntity(state) })),
        frames: [...this.frames].map(([sequence, states]) => ({ sequence, states: states.map(captureQwWireEntity) })),
        deltaRequests: [...this.deltaRequests].map(([sequence, base]) => ({ sequence, base })) }; }
    restore(value: unknown): void {
        const reader = new SaveReader(value, "quakeworld.decoder");
        this.protocol = quakeWorldProfile(reader.field("version").integer(0), reader.field("flags").integer(0));
        this.playerModelIndex = reader.field("playerModelIndex").integer(0); this.baselines.clear(); this.frames.clear(); this.deltaRequests.clear();
        for (const entry of reader.field("baselines").list(item => ({ slot: item.field("slot").integer(0), state: readQwWireEntity(item.field("state")) }))) {
            if (this.baselines.has(entry.slot)) reader.fail("duplicate baseline"); this.baselines.set(entry.slot, entry.state);
        }
        for (const entry of reader.field("frames").list(item => ({ sequence: item.field("sequence").integer(), states: item.field("states").list(readQwWireEntity) }))) {
            if (this.frames.has(entry.sequence)) reader.fail("duplicate frame"); this.frames.set(entry.sequence, entry.states);
        }
        for (const entry of reader.field("deltaRequests").list(item => ({ sequence: item.field("sequence").integer(), base: item.field("base").nullable(field => field.integer()) }))) {
            if (this.deltaRequests.has(entry.sequence)) reader.fail("duplicate delta request"); this.deltaRequests.set(entry.sequence, entry.base);
        }
    }
    recordDeltaRequest(commandSequence: number, baseSequence: number | null): void {
        this.deltaRequests.set(commandSequence, baseSequence);
        for (const sequence of this.deltaRequests.keys())
            if (sequence <= commandSequence - 64)
                this.deltaRequests.delete(sequence);
    }
    playerModelIndex = 0;
    constructor(public protocol: QuakeWorldProfile = { kind: 'q1-quakeworld', version: 28 }) { }
    decode(bytes: Uint8Array, sequence: number): readonly QuakeWorldMessage[] {
        const r = new MessageReader(bytes), messages: QuakeWorldMessage[] = [];
        let codec = createQuakeWorldCodec(this.protocol, r), flags = protocolFlags(this.protocol);
        const coord = (): number => codec.readCoord(flags), angle = (): number => codec.readAngle(flags);
        while (r.remaining) {
            const op = r.Byte();
            let m: QuakeWorldMessage;
            switch (op) {
                case 1:
                    m = { kind: 'nop' };
                    break;
                case 2:
                    m = { kind: 'disconnect' };
                    break;
                case 3:
                case 38:
                    m = { kind: 'stat', index: r.Byte(), value: op === 3 ? r.Byte() : r.Long() };
                    break;
                case 5:
                    m = { kind: 'set-view', entity: r.Short() & 65535 };
                    break;
                case 6: {
                    const word = r.Short() & 65535, volume = word & Q.SND_VOLUME ? r.Byte() : 255, attenuation = word & Q.SND_ATTENUATION ? r.Byte() / 64 : 1;
                    m = { kind: 'sound', entity: (word >>> 3) & 1023, channel: word & 7, index: codec.readSoundIndex(), origin: vec(coord), volume, attenuation };
                    break;
                }
                case 8:
                    m = { kind: 'print', level: r.Byte(), text: r.String() };
                    break;
                case 9:
                    m = { kind: 'stufftext', text: r.String() };
                    break;
                case 10:
                    m = { kind: 'set-angle', angles: vec(angle) };
                    break;
                case 11: {
                    const version = r.Long(), profile = quakeWorldProfile(version, version === 29 ? r.Long() >>> 0 : 0);
                    this.protocol = profile;
                    codec = createQuakeWorldCodec(profile, r);
                    flags = protocolFlags(profile);
                    this.baselines.clear();
                    this.frames.clear();
                    this.deltaRequests.clear();
                    const serverCount = r.Long(), gameDirectory = r.String(), slot = r.Byte(), level = r.String(), moveVariables: QwMoveVariables = { gravity: r.Float(), stopSpeed: r.Float(), maxSpeed: r.Float(), spectatorMaxSpeed: r.Float(), accelerate: r.Float(), airAccelerate: r.Float(), waterAccelerate: r.Float(), friction: r.Float(), waterFriction: r.Float(), entityGravity: r.Float() };
                    m = { kind: 'server-data', protocol: profile, serverCount, gameDirectory, playerSlot: slot & 127, spectator: (slot & 128) !== 0, level, moveVariables };
                    break;
                }
                case 12:
                    m = { kind: 'light-style', index: r.Byte(), value: r.String() };
                    break;
                case 14:
                case 36:
                case 37:
                case 53:
                    m = { kind: op === 14 ? 'frags' : op === 36 ? 'ping' : op === 37 ? 'enter-time' : 'packet-loss', slot: r.Byte(), value: op === 37 ? r.Float() : op === 53 ? r.Byte() : r.Short() };
                    break;
                case 16: {
                    const word = r.Short() & 65535;
                    m = { kind: 'stop-sound', entity: word >>> 3, channel: word & 7 };
                    break;
                }
                case 19:
                    m = { kind: 'damage', armor: r.Byte(), blood: r.Byte(), source: vec(coord) };
                    break;
                case 20:
                case 22: {
                    const s = new Q.QwEntityStateT();
                    s.number = op === 22 ? r.Short() & 65535 : 0;
                    codec.readQwBaseline(s, flags);
                    if (op === 22)
                        this.baselines.set(s.number, s);
                    m = { kind: op === 22 ? 'baseline' : 'static', state: qwEntity(s) };
                    break;
                }
                case 23:
                    m = { kind: 'temporary-entity', effect: readTemporaryEntity(r, coord, true) };
                    break;
                case 24:
                    m = { kind: 'pause', paused: r.Byte() !== 0 };
                    break;
                case 26:
                    m = { kind: 'center-print', text: r.String() };
                    break;
                case 27:
                    m = { kind: 'killed-monster' };
                    break;
                case 28:
                    m = { kind: 'found-secret' };
                    break;
                case 29:
                    m = { kind: 'static-sound', entity: 0, channel: 0, origin: vec(coord), index: codec.readSoundIndex(), volume: r.Byte(), attenuation: r.Byte() / 64 };
                    break;
                case 30:
                    m = { kind: 'intermission', origin: vec(coord), angles: vec(angle) };
                    break;
                case 31:
                    m = { kind: 'finale', text: r.String() };
                    break;
                case 32:
                    m = { kind: 'cd-track', track: r.Byte() };
                    break;
                case 33:
                    m = { kind: 'sell-screen' };
                    break;
                case 34:
                case 35:
                    m = { kind: 'kick', degrees: op === 34 ? -2 : -4 };
                    break;
                case 39:
                    m = { kind: 'muzzle-flash', entity: r.Short() & 65535 };
                    break;
                case 40:
                    m = { kind: 'userinfo', slot: r.Byte(), userId: r.Long(), value: r.String() };
                    break;
                case 41: {
                    const size = r.Short(), percent = r.Byte();
                    m = { kind: 'download', result: size === -1 ? { kind: 'missing' } : { kind: 'data', percent, bytes: r.bytes(size) } };
                    break;
                }
                case 42:
                    m = { kind: 'player', state: this.readPlayer(r, codec, flags) };
                    break;
                case 43: {
                    const count = r.Byte(), projectiles: {
                        origin: Vec3;
                        pitch: number;
                        yaw: number;
                    }[] = [];
                    for (let i = 0; i < count; i++) {
                        const b0 = r.Byte(), b1 = r.Byte(), b2 = r.Byte(), b3 = r.Byte(), b4 = r.Byte(), b5 = r.Byte();
                        projectiles.push({ origin: { x: ((b0 | ((b1 & 15) << 8)) << 1) - 4096, y: (((b1 >>> 4) | (b2 << 4)) << 1) - 4096, z: ((b3 | ((b4 & 15) << 8)) << 1) - 4096 }, pitch: Math.trunc(360 * (b4 >>> 4) / 16), yaw: Math.trunc(360 * b5 / 256) });
                    }
                    m = { kind: 'nails', projectiles };
                    break;
                }
                case 44:
                    m = { kind: 'choke-count', count: r.Byte() };
                    break;
                case 45:
                case 46: {
                    const first = codec.readPrecacheCount(), names: string[] = [];
                    while (true) {
                        const name = r.String();
                        r.finish();
                        if (name === '')
                            break;
                        if (first + names.length + 1 >= codec.maxPrecache)
                            throw new PacketError('QW precache overflow', r.offset);
                        names.push(name);
                        if (op === 45 && name === 'progs/player.mdl')
                            this.playerModelIndex = first + names.length;
                    }
                    m = { kind: op === 45 ? 'model-list' : 'sound-list', first, names, next: codec.readPrecacheCount() };
                    break;
                }
                case 47:
                case 48:
                    m = this.readEntities(r, codec, flags, sequence, op === 48);
                    break;
                case 49:
                case 50:
                    m = { kind: op === 49 ? 'max-speed' : 'entity-gravity', value: r.Float() };
                    break;
                case 51:
                    m = { kind: 'set-info', slot: r.Byte(), key: r.String(), value: r.String() };
                    break;
                case 52:
                    m = { kind: 'server-info', key: r.String(), value: r.String() };
                    break;
                default: throw new PacketError(`Unknown QuakeWorld service ${op}`, r.offset - 1);
            }
            r.finish();
            messages.push(m);
        }
        return messages;
    }
    private readPlayer(r: MessageReader, codec: QwProtocolCodec, flags: number): QwPlayerState {
        const number = r.Byte();
        if (number >= 32)
            throw new PacketError('Player slot out of range', r.offset - 1);
        const bits = r.Short() & 65535, origin = vec(() => codec.readCoord(flags)), frame = r.Byte(), milliseconds = bits & Q.PF_MSEC ? r.Byte() : 0, cmd = new Q.QwUsercmdT();
        if (bits & Q.PF_COMMAND)
            codec.readDeltaUsercmd(new Q.QwUsercmdT(), cmd);
        const velocity: Vec3 = { x: bits & Q.PF_VELOCITY1 ? r.Short() : 0, y: bits & Q.PF_VELOCITY2 ? r.Short() : 0, z: bits & Q.PF_VELOCITY3 ? r.Short() : 0 };
        return { number, flags: bits, origin, frame, milliseconds, command: qwCommand(cmd), velocity, modelIndex: bits & Q.PF_MODEL ? codec.readModelIndex() : this.playerModelIndex, skin: bits & Q.PF_SKINNUM ? r.Byte() : 0, effects: bits & Q.PF_EFFECTS ? r.Byte() : 0, weaponFrame: bits & Q.PF_WEAPONFRAME ? r.Byte() : 0 };
    }
    private readEntities(r: MessageReader, codec: QwProtocolCodec, flags: number, sequence: number, delta: boolean): QuakeWorldMessage {
        const requested = delta ? r.Byte() : null;
        let baseSequence: number | null = null;
        if (requested !== null && this.deltaRequests.has(sequence)) {
            const selected = this.deltaRequests.get(sequence);
            if (selected !== undefined && selected !== null && this.frames.has(selected) && sequence - selected < 63)
                baseSequence = selected;
        }
        else if (requested !== null) {
            for (const previous of this.frames.keys())
                if ((previous & 255) === requested && previous < sequence && (baseSequence === null || previous > baseSequence))
                    baseSequence = previous;
        }
        const old = baseSequence === null ? [] : this.frames.get(baseSequence) ?? [], states = new Map(old.map(s => [s.number, s])), invalid = delta && baseSequence === null;
        let previousNumber = 0;
        while (true) {
            const word = r.Short() & 65535;
            r.finish();
            if (word === 0)
                break;
            const h = new QwEntityWordT();
            codec.readDeltaEntityHeader(word, h);
            if (h.number <= previousNumber)
                throw new PacketError('Unsorted packet entities', r.offset);
            previousNumber = h.number;
            if (h.remove) {
                if (!delta)
                    throw new PacketError('Removal in full packet entities', r.offset);
                states.delete(h.number);
                continue;
            }
            const state = new Q.QwEntityStateT(), base = states.get(h.number) ?? this.baselines.get(h.number) ?? new Q.QwEntityStateT();
            codec.readDeltaEntity(base, state, h, flags);
            states.set(h.number, state);
            r.finish();
            if (states.size > codec.maxPacketEntities)
                throw new PacketError('Packet entities overflow', r.offset);
        }
        if (invalid)
            return { kind: 'invalid-delta', sequence, requested: requested ?? 0 };
        const values = [...states.values()].sort((a, b) => a.number - b.number);
        this.frames.set(sequence, values);
        for (const oldSequence of this.frames.keys())
            if (oldSequence <= sequence - 64)
                this.frames.delete(oldSequence);
        return { kind: 'packet-entities', sequence, deltaSequence: baseSequence, entities: values.map(qwEntity) };
    }
}
export function writeQuakeWorldEntities(sb: SizeBuf, profile: QuakeWorldProfile, states: readonly Q.QwEntityStateT[], baseline: ReadonlyMap<number, Q.QwEntityStateT>, previous: {
    readonly sequence: number;
    readonly states: readonly Q.QwEntityStateT[];
} | null): void {
    const codec = createQuakeWorldCodec(profile, new MessageReader(new Uint8Array(0))), flags = protocolFlags(profile);
    if (states.length > codec.maxPacketEntities)
        throw new RangeError('Too many QuakeWorld packet entities');
    MSG_WriteByte(sb, previous === null ? 47 : 48);
    if (previous !== null)
        MSG_WriteByte(sb, previous.sequence & 255);
    const old = new Map(previous?.states.map(s => [s.number, s]) ?? []), current = new Map(states.map(s => [s.number, s])), numbers = [...new Set([...old.keys(), ...current.keys()])].sort((a, b) => a - b);
    for (const number of numbers) {
        const state = current.get(number), prior = old.get(number);
        if (state === undefined) {
            codec.writeRemoveEntity(sb, number);
            continue;
        }
        if (!codec.writeDeltaEntity(sb, prior ?? baseline.get(number) ?? new Q.QwEntityStateT(), state, prior === undefined, flags))
            throw new RangeError(`Entity ${number} exceeds QuakeWorld profile`);
    }
    codec.writePacketEntitiesEnd(sb);
}
export function writeQuakeWorldPlayer(sb: SizeBuf, profile: QuakeWorldProfile, state: QwPlayerState): void {
    const c = createQuakeWorldCodec(profile, new MessageReader(new Uint8Array(0))), flags = protocolFlags(profile), bits = state.flags;
    MSG_WriteByte(sb, 42);
    MSG_WriteByte(sb, state.number);
    MSG_WriteShort(sb, bits);
    for (const n of [state.origin.x, state.origin.y, state.origin.z])
        c.writeCoord(sb, n, flags);
    MSG_WriteByte(sb, state.frame);
    if (bits & Q.PF_MSEC)
        MSG_WriteByte(sb, state.milliseconds);
    if (bits & Q.PF_COMMAND)
        c.writeDeltaUsercmd(sb, new Q.QwUsercmdT(), qwWireCommand(state.command));
    if (bits & Q.PF_VELOCITY1)
        MSG_WriteShort(sb, state.velocity.x);
    if (bits & Q.PF_VELOCITY2)
        MSG_WriteShort(sb, state.velocity.y);
    if (bits & Q.PF_VELOCITY3)
        MSG_WriteShort(sb, state.velocity.z);
    if (bits & Q.PF_MODEL)
        c.writeModelIndex(sb, state.modelIndex);
    if (bits & Q.PF_SKINNUM)
        MSG_WriteByte(sb, state.skin);
    if (bits & Q.PF_EFFECTS)
        MSG_WriteByte(sb, state.effects);
    if (bits & Q.PF_WEAPONFRAME)
        MSG_WriteByte(sb, state.weaponFrame);
}
export function writeQuakeWorldServerData(sb: SizeBuf, m: Extract<QuakeWorldMessage, {
    kind: 'server-data';
}>): void {
    const c = createQuakeWorldCodec(m.protocol, new MessageReader(new Uint8Array(0)));
    MSG_WriteByte(sb, 11);
    c.writeProtocol(sb, protocolFlags(m.protocol));
    MSG_WriteLong(sb, m.serverCount);
    MSG_WriteString(sb, m.gameDirectory);
    MSG_WriteByte(sb, m.playerSlot | (m.spectator ? 128 : 0));
    MSG_WriteString(sb, m.level);
    const v = m.moveVariables;
    for (const n of [v.gravity, v.stopSpeed, v.maxSpeed, v.spectatorMaxSpeed, v.accelerate, v.airAccelerate, v.waterAccelerate, v.friction, v.waterFriction, v.entityGravity])
        MSG_WriteFloat(sb, n);
}
export function writeQuakeWorldDownload(sb: SizeBuf, result: Extract<QuakeWorldMessage, {
    kind: 'download';
}>['result']): void {
    MSG_WriteByte(sb, 41);
    if (result.kind === 'missing') {
        MSG_WriteShort(sb, -1);
        MSG_WriteByte(sb, 0);
    }
    else {
        if (result.bytes.length > 768)
            throw new RangeError('QuakeWorld download block exceeds source block size');
        MSG_WriteShort(sb, result.bytes.length);
        MSG_WriteByte(sb, result.percent);
        SZ_Write(sb, result.bytes);
    }
}
export function writeQuakeWorldMessage(sb: SizeBuf, profile: QuakeWorldProfile, m: Exclude<QuakeWorldMessage, {
    kind: 'packet-entities' | 'invalid-delta';
}>): void {
    const c = createQuakeWorldCodec(profile, new MessageReader(new Uint8Array(0))), flags = protocolFlags(profile), coord = (v: Vec3): void => {
        for (const n of [v.x, v.y, v.z])
            c.writeCoord(sb, n, flags);
    }, angle = (v: Vec3): void => {
        for (const n of [v.x, v.y, v.z])
            c.writeAngle(sb, n, flags);
    }, text = (op: number, value: string): void => { MSG_WriteByte(sb, op); MSG_WriteString(sb, value); };
    switch (m.kind) {
        case 'nop':
            MSG_WriteByte(sb, 1);
            break;
        case 'disconnect':
            MSG_WriteByte(sb, 2);
            break;
        case 'stat':
            MSG_WriteByte(sb, m.value >= 0 && m.value <= 255 ? 3 : 38);
            MSG_WriteByte(sb, m.index);
            if (m.value >= 0 && m.value <= 255)
                MSG_WriteByte(sb, m.value);
            else
                MSG_WriteLong(sb, m.value);
            break;
        case 'set-view':
            MSG_WriteByte(sb, 5);
            MSG_WriteShort(sb, m.entity);
            break;
        case 'sound': {
            if (m.entity < 0 || m.entity >= 1024 || m.channel < 0 || m.channel >= 8 || m.index >= c.maxPrecache)
                throw new RangeError('Sound exceeds selected QuakeWorld wire');
            let mask = (m.entity << 3) | m.channel;
            if (m.volume !== 255)
                mask |= Q.SND_VOLUME;
            if (m.attenuation !== 1)
                mask |= Q.SND_ATTENUATION;
            MSG_WriteByte(sb, 6);
            MSG_WriteShort(sb, mask);
            if (mask & Q.SND_VOLUME)
                MSG_WriteByte(sb, m.volume);
            if (mask & Q.SND_ATTENUATION)
                MSG_WriteByte(sb, m.attenuation * 64);
            c.writeSoundIndex(sb, m.index);
            coord(m.origin);
            break;
        }
        case 'print':
            MSG_WriteByte(sb, 8);
            MSG_WriteByte(sb, m.level);
            MSG_WriteString(sb, m.text);
            break;
        case 'stufftext':
            text(9, m.text);
            break;
        case 'set-angle':
            MSG_WriteByte(sb, 10);
            angle(m.angles);
            break;
        case 'server-data':
            writeQuakeWorldServerData(sb, m);
            break;
        case 'light-style':
            MSG_WriteByte(sb, 12);
            MSG_WriteByte(sb, m.index);
            MSG_WriteString(sb, m.value);
            break;
        case 'frags':
            MSG_WriteByte(sb, 14);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteShort(sb, m.value);
            break;
        case 'stop-sound':
            MSG_WriteByte(sb, 16);
            MSG_WriteShort(sb, m.entity * 8 + m.channel);
            break;
        case 'damage':
            MSG_WriteByte(sb, 19);
            MSG_WriteByte(sb, m.armor);
            MSG_WriteByte(sb, m.blood);
            coord(m.source);
            break;
        case 'static':
        case 'baseline':
            MSG_WriteByte(sb, m.kind === 'static' ? 20 : 22);
            if (m.kind === 'baseline')
                MSG_WriteShort(sb, m.state.number);
            c.writeQwBaseline(sb, qwWireEntity(m.state), flags);
            break;
        case 'temporary-entity': {
            const e = m.effect;
            if (e.kind === 'explosion-colors')
                throw new Error('NetQuake color explosion has no QuakeWorld opcode');
            MSG_WriteByte(sb, 23);
            MSG_WriteByte(sb, e.type);
            if (e.kind === 'beam') {
                MSG_WriteShort(sb, e.entity);
                coord(e.start);
                coord(e.end);
            }
            else {
                if (e.type === 2 || e.type === 12)
                    MSG_WriteByte(sb, e.count);
                coord(e.origin);
            }
            break;
        }
        case 'pause':
            MSG_WriteByte(sb, 24);
            MSG_WriteByte(sb, m.paused ? 1 : 0);
            break;
        case 'center-print':
            text(26, m.text);
            break;
        case 'killed-monster':
            MSG_WriteByte(sb, 27);
            break;
        case 'found-secret':
            MSG_WriteByte(sb, 28);
            break;
        case 'static-sound':
            MSG_WriteByte(sb, 29);
            coord(m.origin);
            c.writeSoundIndex(sb, m.index);
            MSG_WriteByte(sb, m.volume);
            MSG_WriteByte(sb, m.attenuation * 64);
            break;
        case 'intermission':
            MSG_WriteByte(sb, 30);
            coord(m.origin);
            angle(m.angles);
            break;
        case 'finale':
            text(31, m.text);
            break;
        case 'cd-track':
            MSG_WriteByte(sb, 32);
            MSG_WriteByte(sb, m.track);
            break;
        case 'sell-screen':
            MSG_WriteByte(sb, 33);
            break;
        case 'kick':
            if (m.degrees !== -2 && m.degrees !== -4)
                throw new RangeError('QuakeWorld kick must be -2 or -4');
            MSG_WriteByte(sb, m.degrees === -2 ? 34 : 35);
            break;
        case 'ping':
            MSG_WriteByte(sb, 36);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteShort(sb, m.value);
            break;
        case 'enter-time':
            MSG_WriteByte(sb, 37);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteFloat(sb, m.value);
            break;
        case 'muzzle-flash':
            MSG_WriteByte(sb, 39);
            MSG_WriteShort(sb, m.entity);
            break;
        case 'userinfo':
            MSG_WriteByte(sb, 40);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteLong(sb, m.userId);
            MSG_WriteString(sb, m.value);
            break;
        case 'download':
            writeQuakeWorldDownload(sb, m.result);
            break;
        case 'player':
            writeQuakeWorldPlayer(sb, profile, m.state);
            break;
        case 'nails':
            if (m.projectiles.length > 255)
                throw new RangeError('Too many nail projectiles');
            MSG_WriteByte(sb, 43);
            MSG_WriteByte(sb, m.projectiles.length);
            for (const p of m.projectiles) {
                const x = Math.trunc((p.origin.x + 4096) / 2), y = Math.trunc((p.origin.y + 4096) / 2), z = Math.trunc((p.origin.z + 4096) / 2), pitch = Math.trunc(p.pitch * 16 / 360) & 15, yaw = Math.trunc(p.yaw * 256 / 360) & 255;
                for (const b of [x & 255, ((x >>> 8) & 15) | ((y & 15) << 4), (y >>> 4) & 255, z & 255, ((z >>> 8) & 15) | (pitch << 4), yaw])
                    MSG_WriteByte(sb, b);
            }
            break;
        case 'choke-count':
            MSG_WriteByte(sb, 44);
            MSG_WriteByte(sb, m.count);
            break;
        case 'model-list':
        case 'sound-list':
            MSG_WriteByte(sb, m.kind === 'model-list' ? 45 : 46);
            c.writePrecacheCount(sb, m.first);
            for (const name of m.names)
                MSG_WriteString(sb, name);
            MSG_WriteByte(sb, 0);
            c.writePrecacheCount(sb, m.next);
            break;
        case 'max-speed':
        case 'entity-gravity':
            MSG_WriteByte(sb, m.kind === 'max-speed' ? 49 : 50);
            MSG_WriteFloat(sb, m.value);
            break;
        case 'set-info':
            MSG_WriteByte(sb, 51);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteString(sb, m.key);
            MSG_WriteString(sb, m.value);
            break;
        case 'server-info':
            MSG_WriteByte(sb, 52);
            MSG_WriteString(sb, m.key);
            MSG_WriteString(sb, m.value);
            break;
        case 'packet-loss':
            MSG_WriteByte(sb, 53);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteByte(sb, m.value);
            break;
        default: {
            const exhaustive: never = m;
            throw new Error(`Unreachable message ${exhaustive}`);
        }
    }
}
