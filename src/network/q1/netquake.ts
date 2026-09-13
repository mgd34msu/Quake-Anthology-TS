// NetQuake cl_parse.c/sv_main.c messages with FitzQuake and RMQ additions. GPL-2.0-or-later.
import type { Q1ProtocolIdentity, Q1ExtendedEntityState, Q1ClientData, Q1UserCommand } from '../../contracts/protocol.ts';
import type { Vec3 } from '../../contracts/math.ts';
import * as P from './constants.ts';
import { ClientdataT, ClientdataTailT, EntityUpdateT, EntityUpdateTailT, SoundHeaderT, SoundMessageT } from './codecs/codec.ts';
import type { ProtocolCodec } from './codecs/codec.ts';
import { EntityStateT, AXES } from './wire-types.ts';
import { MessageReader, SizeBuf, PacketError, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteFloat, MSG_WriteString, MSG_WriteAngle16, readMoveAngle16 } from './message.ts';
import { createNetQuakeCodec, netQuakeProfile, protocolFlags } from './profile.ts';
import type { RereleaseMessages } from './profile.ts';
export type TemporaryEntity = {
    readonly kind: 'point';
    readonly type: number;
    readonly origin: Vec3;
    readonly count: number;
} | {
    readonly kind: 'beam';
    readonly type: number;
    readonly entity: number;
    readonly start: Vec3;
    readonly end: Vec3;
} | {
    readonly kind: 'explosion-colors';
    readonly type: 12;
    readonly origin: Vec3;
    readonly colorStart: number;
    readonly colorLength: number;
};
export type NetQuakeMessage = {
    readonly kind: 'nop' | 'disconnect' | 'killed-monster' | 'found-secret' | 'intermission' | 'sell-screen' | 'bonus-flash' | 'level-completed' | 'back-to-lobby';
} | {
    readonly kind: 'print' | 'center-print' | 'stufftext' | 'finale' | 'cutscene' | 'skybox' | 'achievement' | 'botchat' | 'raw-print' | 'chat' | 'server-vars';
    readonly text: string;
} | {
    readonly kind: 'time';
    readonly seconds: number;
} | {
    readonly kind: 'version';
    readonly version: number;
} | {
    readonly kind: 'stat';
    readonly index: number;
    readonly value: number;
} | {
    readonly kind: 'set-view';
    readonly entity: number;
} | {
    readonly kind: 'set-angle';
    readonly angles: Vec3;
} | {
    readonly kind: 'server-info';
    readonly protocol: Q1ProtocolIdentity;
    readonly maxClients: number;
    readonly gameType: number;
    readonly level: string;
    readonly models: readonly string[];
    readonly sounds: readonly string[];
} | {
    readonly kind: 'light-style';
    readonly index: number;
    readonly value: string;
} | {
    readonly kind: 'name' | 'social' | 'player-info';
    readonly slot: number;
    readonly value: string;
} | {
    readonly kind: 'frags' | 'colors' | 'ping';
    readonly slot: number;
    readonly value: number;
} | {
    readonly kind: 'client-data';
    readonly data: Q1ClientData;
    readonly weaponAlpha: number;
} | {
    readonly kind: 'entity';
    readonly state: Q1ExtendedEntityState;
} | {
    readonly kind: 'baseline';
    readonly state: Q1ExtendedEntityState;
} | {
    readonly kind: 'static';
    readonly state: Q1ExtendedEntityState;
} | {
    readonly kind: 'sound' | 'static-sound';
    readonly entity: number;
    readonly channel: number;
    readonly index: number;
    readonly volume: number;
    readonly attenuation: number;
    readonly origin: Vec3;
} | {
    readonly kind: 'stop-sound';
    readonly entity: number;
    readonly channel: number;
} | {
    readonly kind: 'local-sound';
    readonly index: number;
} | {
    readonly kind: 'damage';
    readonly armor: number;
    readonly blood: number;
    readonly source: Vec3;
} | {
    readonly kind: 'particle';
    readonly origin: Vec3;
    readonly direction: Vec3;
    readonly count: number;
    readonly color: number;
} | {
    readonly kind: 'temporary-entity';
    readonly effect: TemporaryEntity;
} | {
    readonly kind: 'pause';
    readonly paused: boolean;
} | {
    readonly kind: 'signon';
    readonly stage: number;
} | {
    readonly kind: 'cd-track';
    readonly track: number;
    readonly loopTrack: number;
} | {
    readonly kind: 'fog';
    readonly density: number;
    readonly color: Vec3;
    readonly transitionSeconds: number;
} | {
    readonly kind: 'spawned-monster' | 'set-views' | 'sequence';
    readonly value: number;
} | {
    readonly kind: 'prompt-begin';
    readonly text: string;
    readonly choices: number;
} | {
    readonly kind: 'prompt-choice';
    readonly text: string;
    readonly impulse: number;
} | {
    readonly kind: 'prompt-clear';
};
function vector(read: () => number): Vec3 { return { x: read(), y: read(), z: read() }; }
export function entityState(number: number, s: EntityStateT): Q1ExtendedEntityState { return { number, origin: { x: s.origin[0], y: s.origin[1], z: s.origin[2] }, angles: { x: s.angles[0], y: s.angles[1], z: s.angles[2] }, modelIndex: s.modelindex, frame: s.frame, colorMap: s.colormap, skin: s.skin, effects: s.effects, alpha: s.alpha, scale: s.scale, lerpFinishSeconds: 0, step: false }; }
export function wireEntity(s: Q1ExtendedEntityState): EntityStateT { const out = new EntityStateT(); out.origin[0] = s.origin.x; out.origin[1] = s.origin.y; out.origin[2] = s.origin.z; out.angles[0] = s.angles.x; out.angles[1] = s.angles.y; out.angles[2] = s.angles.z; out.modelindex = s.modelIndex; out.frame = s.frame; out.colormap = s.colorMap; out.skin = s.skin; out.effects = s.effects; out.alpha = s.alpha; out.scale = s.scale; return out; }
export function readTemporaryEntity(r: MessageReader, coord: () => number, quakeworld = false): TemporaryEntity {
    const type = r.Byte();
    if (type === 5 || type === 6 || type === 9 || (!quakeworld && type === 13))
        return { kind: 'beam', type, entity: r.Short() & 65535, start: vector(coord), end: vector(coord) };
    if (type < 0 || type > (quakeworld ? 13 : 13))
        throw new PacketError(`Unknown temporary entity ${type}`, r.offset - 1);
    const count = quakeworld && (type === 2 || type === 12) ? r.Byte() : 1, origin = vector(coord);
    if (!quakeworld && type === 12)
        return { kind: 'explosion-colors', type, origin, colorStart: r.Byte(), colorLength: r.Byte() };
    return { kind: 'point', type, origin, count };
}
export class NetQuakeDecoder {
    readonly baselines = new Map<number, EntityStateT>();
    timeSeconds = 0;
    private flagsValue: number;
    get flags(): number { return this.flagsValue; }
    constructor(public protocol: Q1ProtocolIdentity = { kind: 'q1-netquake', version: 15 }, readonly rereleaseMessages: RereleaseMessages = 'known-retail', readonly standardQuake = true) { this.flagsValue = protocolFlags(protocol); }
    decode(bytes: Uint8Array): readonly NetQuakeMessage[] {
        const r = new MessageReader(bytes), messages: NetQuakeMessage[] = [];
        let codec = createNetQuakeCodec(this.protocol, r), flags = this.flagsValue;
        const coord = (): number => codec.readCoord(flags), angle = (): number => codec.readAngle(flags);
        while (r.remaining > 0) {
            const op = r.Byte();
            let message: NetQuakeMessage;
            if (op & 128) {
                message = { kind: 'entity', state: this.readEntity(r, codec, flags, op & 127) };
            }
            else
                switch (op) {
                    case 1:
                        message = { kind: 'nop' };
                        break;
                    case 2:
                        message = { kind: 'disconnect' };
                        break;
                    case 3:
                        message = { kind: 'stat', index: r.Byte(), value: r.Long() };
                        break;
                    case 4: {
                        const version = r.Long();
                        this.protocol = netQuakeProfile(version, flags);
                        codec = createNetQuakeCodec(this.protocol, r);
                        message = { kind: 'version', version };
                        break;
                    }
                    case 5:
                        message = { kind: 'set-view', entity: r.Short() & 65535 };
                        break;
                    case 6: {
                        const mask = r.Byte(), volume = mask & P.SND_VOLUME ? r.Byte() : 255, attenuation = mask & P.SND_ATTENUATION ? r.Byte() / 64 : 1, h = new SoundHeaderT();
                        codec.readSoundHeader(mask, h);
                        message = { kind: 'sound', entity: h.ent, channel: h.channel, index: h.soundNum, volume, attenuation, origin: vector(coord) };
                        break;
                    }
                    case 7:
                        this.timeSeconds = r.Float();
                        message = { kind: 'time', seconds: this.timeSeconds };
                        break;
                    case 8:
                        message = { kind: 'print', text: r.String() };
                        break;
                    case 9:
                        message = { kind: 'stufftext', text: r.String() };
                        break;
                    case 10:
                        message = { kind: 'set-angle', angles: vector(angle) };
                        break;
                    case 11: {
                        const version = r.Long(), protocol = netQuakeProfile(version, version === 999 ? r.Long() >>> 0 : 0);
                        this.protocol = protocol;
                        codec = createNetQuakeCodec(protocol, r);
                        flags = protocolFlags(protocol);
                        this.flagsValue = flags;
                        this.baselines.clear();
                        const maxClients = r.Byte(), gameType = r.Byte(), level = r.String(), models = this.readList(r, codec.maxPrecache), sounds = this.readList(r, codec.maxPrecache);
                        message = { kind: 'server-info', protocol, maxClients, gameType, level, models, sounds };
                        break;
                    }
                    case 12:
                        message = { kind: 'light-style', index: r.Byte(), value: r.String() };
                        break;
                    case 13:
                        message = { kind: 'name', slot: r.Byte(), value: r.String() };
                        break;
                    case 14:
                        message = { kind: 'frags', slot: r.Byte(), value: r.Short() };
                        break;
                    case 15:
                        message = this.readClientData(r, codec);
                        break;
                    case 16: {
                        const channel = r.Short() & 65535;
                        message = { kind: 'stop-sound', entity: channel >>> 3, channel: channel & 7 };
                        break;
                    }
                    case 17:
                        message = { kind: 'colors', slot: r.Byte(), value: r.Byte() };
                        break;
                    case 18:
                        message = { kind: 'particle', origin: vector(coord), direction: vector(() => r.Char() / 16), count: r.Byte(), color: r.Byte() };
                        break;
                    case 19:
                        message = { kind: 'damage', armor: r.Byte(), blood: r.Byte(), source: vector(coord) };
                        break;
                    case 20:
                    case 22:
                    case 42:
                    case 43: {
                        const baseline = op === 22 || op === 42, num = baseline ? r.Short() & 65535 : 0, state = new EntityStateT();
                        codec.readBaseline(state, op >= 42 ? 2 : 1, flags);
                        if (baseline)
                            this.baselines.set(num, state);
                        message = { kind: baseline ? 'baseline' : 'static', state: entityState(num, state) };
                        break;
                    }
                    case 23:
                        message = { kind: 'temporary-entity', effect: readTemporaryEntity(r, coord) };
                        break;
                    case 24:
                        message = { kind: 'pause', paused: r.Byte() !== 0 };
                        break;
                    case 25:
                        message = { kind: 'signon', stage: r.Byte() };
                        break;
                    case 26:
                        message = { kind: 'center-print', text: r.String() };
                        break;
                    case 27:
                        message = { kind: 'killed-monster' };
                        break;
                    case 28:
                        message = { kind: 'found-secret' };
                        break;
                    case 29:
                    case 44: {
                        const origin = vector(coord), index = codec.readStaticSoundIndex(op === 44 ? 2 : 1) & 65535;
                        message = { kind: 'static-sound', entity: 0, channel: 0, index, volume: r.Byte(), attenuation: r.Byte() / 64, origin };
                        break;
                    }
                    case 30:
                        message = { kind: 'intermission' };
                        break;
                    case 31:
                        message = { kind: 'finale', text: r.String() };
                        break;
                    case 32:
                        message = { kind: 'cd-track', track: r.Byte(), loopTrack: r.Byte() };
                        break;
                    case 33:
                        message = { kind: 'sell-screen' };
                        break;
                    case 34:
                        message = { kind: 'cutscene', text: r.String() };
                        break;
                    case 37:
                        message = { kind: 'skybox', text: r.String() };
                        break;
                    case 40:
                        message = { kind: 'bonus-flash' };
                        break;
                    case 41:
                        message = { kind: 'fog', density: r.Byte() / 255, color: vector(() => r.Byte() / 255), transitionSeconds: r.Short() / 100 };
                        break;
                    case 52:
                        message = { kind: 'achievement', text: r.String() };
                        break;
                    case 56: {
                        const mask = r.Byte();
                        message = { kind: 'local-sound', index: mask & P.SND_LARGESOUND ? r.Short() & 65535 : r.Byte() };
                        break;
                    }
                    default: message = this.readPrivate(r, op);
                }
            r.finish();
            messages.push(message);
        }
        return messages;
    }
    private readList(r: MessageReader, max: number): readonly string[] {
        const values: string[] = [];
        while (true) {
            const value = r.String();
            r.finish();
            if (value === '')
                return values;
            if (values.length >= max - 1)
                throw new PacketError('Precache overflow', r.offset);
            values.push(value);
        }
    }
    private readEntity(r: MessageReader, codec: ProtocolCodec, flags: number, initial: number): Q1ExtendedEntityState {
        let bits = initial;
        if (bits & P.U_MOREBITS)
            bits |= r.Byte() << 8;
        bits = codec.readEntityBits(bits);
        const number = bits & P.U_LONGENTITY ? r.Short() & 65535 : r.Byte(), b = this.baselines.get(number) ?? new EntityStateT(), s = new EntityStateT();
        s.copyFrom(b);
        if (bits & P.U_MODEL)
            s.modelindex = r.Byte();
        if (bits & P.U_FRAME)
            s.frame = r.Byte();
        if (bits & P.U_COLORMAP)
            s.colormap = r.Byte();
        if (bits & P.U_SKIN)
            s.skin = r.Byte();
        if (bits & P.U_EFFECTS)
            s.effects = r.Byte();
        const angleBits = [P.U_ANGLE1, P.U_ANGLE2, P.U_ANGLE3];
        for (const axis of AXES) {
            if (bits & (P.U_ORIGIN1 << axis))
                s.origin[axis] = codec.readCoord(flags);
            const angleBit = angleBits[axis] ?? 0;
            if (bits & angleBit)
                s.angles[axis] = codec.readAngle(flags);
        }
        const tail = new EntityUpdateTailT();
        codec.readEntityUpdateTail(bits, tail);
        if (tail.hasAlpha)
            s.alpha = tail.alpha;
        if (tail.hasScale)
            s.scale = tail.scale;
        if (tail.hasFrame2)
            s.frame |= tail.frameHigh << 8;
        if (tail.hasModel2)
            s.modelindex |= tail.modelHigh << 8;
        return { ...entityState(number, s), step: (bits & P.U_STEP) !== 0, lerpFinishSeconds: tail.hasLerpfinish ? this.timeSeconds + tail.lerpfinish : 0 };
    }
    private readClientData(r: MessageReader, codec: ProtocolCodec): Extract<NetQuakeMessage, {
        kind: 'client-data';
    }> {
        const bits = codec.readClientdataBits(), viewHeight = bits & P.SU_VIEWHEIGHT ? r.Char() : 22, idealPitch = bits & P.SU_IDEALPITCH ? r.Char() : 0, punch = [0, 0, 0], velocity = [0, 0, 0];
        for (const axis of AXES) {
            punch[axis] = bits & (P.SU_PUNCH1 << axis) ? r.Char() : 0;
            velocity[axis] = bits & (P.SU_VELOCITY1 << axis) ? r.Char() * 16 : 0;
        }
        const items = r.Long(), weaponFrame = bits & P.SU_WEAPONFRAME ? r.Byte() : 0, armor = bits & P.SU_ARMOR ? r.Byte() : 0, weaponModel = bits & P.SU_WEAPON ? r.Byte() : 0, health = r.Short(), ammo = r.Byte(), shells = r.Byte(), nails = r.Byte(), rockets = r.Byte(), cells = r.Byte(), weapon = r.Byte(), tail = new ClientdataTailT();
        codec.readClientdataTail(bits, tail);
        return { kind: 'client-data', weaponAlpha: tail.weaponalpha, data: { viewHeight, idealPitch, punchAngles: { x: punch[0] ?? 0, y: punch[1] ?? 0, z: punch[2] ?? 0 }, velocity: { x: velocity[0] ?? 0, y: velocity[1] ?? 0, z: velocity[2] ?? 0 }, items, onGround: (bits & P.SU_ONGROUND) !== 0, inWater: (bits & P.SU_INWATER) !== 0, weaponFrame: weaponFrame | (tail.weaponframeHigh << 8), armor: armor | (tail.armorHigh << 8), weaponModel: weaponModel | (tail.weaponHigh << 8), health, ammo: ammo | (tail.ammoHigh << 8), shells: shells | (tail.shellsHigh << 8), nails: nails | (tail.nailsHigh << 8), rockets: rockets | (tail.rocketsHigh << 8), cells: cells | (tail.cellsHigh << 8), activeWeapon: this.standardQuake ? weapon : 1 << weapon } };
    }
    private readPrivate(r: MessageReader, op: number): NetQuakeMessage {
        if (this.rereleaseMessages !== 'quake-1-re-ts-private')
            throw new PacketError(`Unknown or unverified retail service ${op}`, r.offset - 1);
        switch (op) {
            case 38: return { kind: 'botchat', text: r.String() };
            case 39: return { kind: 'spawned-monster', value: r.Byte() };
            case 45: return { kind: 'set-views', value: r.Byte() };
            case 46: return { kind: 'ping', slot: r.Byte(), value: r.Short() };
            case 47: return { kind: 'social', slot: r.Byte(), value: r.String() };
            case 48: return { kind: 'player-info', slot: r.Byte(), value: r.String() };
            case 49: return { kind: 'raw-print', text: r.String() };
            case 50: return { kind: 'server-vars', text: r.String() };
            case 51: return { kind: 'sequence', value: r.Long() };
            case 53: return { kind: 'chat', text: r.String() };
            case 54: return { kind: 'level-completed' };
            case 55: return { kind: 'back-to-lobby' };
            case 57: {
                const sub = r.Byte();
                if (sub === 0)
                    return { kind: 'prompt-begin', text: r.String(), choices: r.Byte() };
                if (sub === 1)
                    return { kind: 'prompt-choice', text: r.String(), impulse: r.Byte() };
                if (sub === 2)
                    return { kind: 'prompt-clear' };
                throw new PacketError(`Unknown private prompt ${sub}`, r.offset - 1);
            }
            default: throw new PacketError(`Unknown service ${op}`, r.offset - 1);
        }
    }
}
export function writeNetQuakeMove(sb: SizeBuf, command: Q1UserCommand, protocol: Q1ProtocolIdentity, flags = protocolFlags(protocol)): void {
    const codec = createNetQuakeCodec(protocol, new MessageReader(new Uint8Array(0)));
    MSG_WriteByte(sb, 3);
    MSG_WriteFloat(sb, command.acknowledgedServerTimeSeconds);
    for (const n of [command.viewAngles.x, command.viewAngles.y, command.viewAngles.z])
        if (protocol.version === 15)
            codec.writeAngle(sb, n, flags);
        else
            MSG_WriteAngle16(sb, n, flags);
    MSG_WriteShort(sb, command.forwardMove);
    MSG_WriteShort(sb, command.sideMove);
    MSG_WriteShort(sb, command.upMove);
    MSG_WriteByte(sb, command.buttons);
    MSG_WriteByte(sb, command.impulse);
}
export type NetQuakeClientMessage = {
    readonly kind: 'nop' | 'disconnect';
} | {
    readonly kind: 'string-command';
    readonly text: string;
} | {
    readonly kind: 'move';
    readonly command: Q1UserCommand;
};
export function decodeNetQuakeClient(bytes: Uint8Array, protocol: Q1ProtocolIdentity): readonly NetQuakeClientMessage[] {
    const r = new MessageReader(bytes), codec = createNetQuakeCodec(protocol, r), flags = protocolFlags(protocol), out: NetQuakeClientMessage[] = [];
    while (r.remaining) {
        switch (r.Byte()) {
            case 1:
                out.push({ kind: 'nop' });
                break;
            case 2:
                out.push({ kind: 'disconnect' });
                break;
            case 4:
                out.push({ kind: 'string-command', text: r.String() });
                break;
            case 3:
                out.push({ kind: 'move', command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: r.Float(), viewAngles: vector(() => protocol.version === 15 ? codec.readAngle(flags) : readMoveAngle16(r, flags)), forwardMove: r.Short(), sideMove: r.Short(), upMove: r.Short(), buttons: r.Byte(), impulse: r.Byte() } });
                break;
            default: throw new PacketError('Unknown client message', r.offset - 1);
        }
        r.finish();
    }
    return out;
}
export function writeNetQuakeEntity(sb: SizeBuf, profile: Q1ProtocolIdentity, state: Q1ExtendedEntityState, baseline: Q1ExtendedEntityState, serverTimeSeconds: number): void {
    const u = new EntityUpdateT(), s = wireEntity(state);
    u.origin = s.origin;
    u.angles = s.angles;
    u.modelindex = s.modelindex;
    u.frame = s.frame;
    u.colormap = s.colormap;
    u.skin = s.skin;
    u.effects = s.effects;
    u.alpha = s.alpha;
    u.scale = s.scale;
    u.movetypeStep = state.step;
    u.sendinterval = state.lerpFinishSeconds !== 0;
    u.lerpfinish = state.lerpFinishSeconds - serverTimeSeconds;
    u.baseline = wireEntity(baseline);
    createNetQuakeCodec(profile, new MessageReader(new Uint8Array(0))).writeEntityUpdate(sb, state.number, u, protocolFlags(profile));
}
export function writeNetQuakeClientData(sb: SizeBuf, profile: Q1ProtocolIdentity, data: Q1ClientData, weaponAlpha = 0, standardQuake = true): void {
    const c = new ClientdataT();
    c.viewheight = data.viewHeight;
    c.idealpitch = data.idealPitch;
    c.punchangle[0] = data.punchAngles.x;
    c.punchangle[1] = data.punchAngles.y;
    c.punchangle[2] = data.punchAngles.z;
    c.velocity[0] = data.velocity.x;
    c.velocity[1] = data.velocity.y;
    c.velocity[2] = data.velocity.z;
    c.items = data.items;
    c.onground = data.onGround;
    c.inwater = data.inWater;
    c.weaponframe = data.weaponFrame;
    c.armorvalue = data.armor;
    c.weaponmodelindex = data.weaponModel;
    c.health = data.health;
    c.currentammo = data.ammo;
    c.ammo_shells = data.shells;
    c.ammo_nails = data.nails;
    c.ammo_rockets = data.rockets;
    c.ammo_cells = data.cells;
    c.weapon = data.activeWeapon;
    c.alpha = weaponAlpha;
    c.standardQuake = standardQuake;
    createNetQuakeCodec(profile, new MessageReader(new Uint8Array(0))).writeClientdata(sb, c, protocolFlags(profile));
}
export function writeNetQuakeSound(sb: SizeBuf, profile: Q1ProtocolIdentity, message: Extract<NetQuakeMessage, {
    kind: 'sound' | 'static-sound';
}>): boolean {
    const s = new SoundMessageT();
    s.ent = message.entity;
    s.channel = message.channel;
    s.soundNum = message.index;
    s.volume = message.volume;
    s.attenuation = message.attenuation;
    s.origin[0] = message.origin.x;
    s.origin[1] = message.origin.y;
    s.origin[2] = message.origin.z;
    const codec = createNetQuakeCodec(profile, new MessageReader(new Uint8Array(0)));
    return message.kind === 'sound' ? codec.writeSound(sb, s, protocolFlags(profile)) : codec.writeStaticSound(sb, s.origin, s.soundNum, s.volume / 255, s.attenuation, protocolFlags(profile));
}
export function writeNetQuakeServerInfo(sb: SizeBuf, message: Extract<NetQuakeMessage, {
    kind: 'server-info';
}>): void {
    const codec = createNetQuakeCodec(message.protocol, new MessageReader(new Uint8Array(0)));
    MSG_WriteByte(sb, 11);
    codec.writeProtocol(sb, protocolFlags(message.protocol));
    MSG_WriteByte(sb, message.maxClients);
    MSG_WriteByte(sb, message.gameType);
    MSG_WriteString(sb, message.level);
    for (const list of [message.models, message.sounds]) {
        for (const name of list)
            MSG_WriteString(sb, name);
        MSG_WriteByte(sb, 0);
    }
}
export function writeNetQuakeTime(sb: SizeBuf, seconds: number): void { MSG_WriteByte(sb, 7); MSG_WriteFloat(sb, seconds); }
export function writeNetQuakeStat(sb: SizeBuf, index: number, value: number): void { MSG_WriteByte(sb, 3); MSG_WriteByte(sb, index); MSG_WriteLong(sb, value); }
/** Encodes decoded/source-native messages; mixed compositions still require source-wire admission. */
export function writeNetQuakeMessage(sb: SizeBuf, profile: Q1ProtocolIdentity, m: Exclude<NetQuakeMessage, {
    kind: 'entity';
}>, rereleaseMessages: RereleaseMessages = 'known-retail', standardQuake = true): void {
    const codec = createNetQuakeCodec(profile, new MessageReader(new Uint8Array(0))), flags = protocolFlags(profile), writeVec = (v: Vec3): void => {
        for (const n of [v.x, v.y, v.z])
            codec.writeCoord(sb, n, flags);
    }, text = (op: number, value: string): void => { MSG_WriteByte(sb, op); MSG_WriteString(sb, value); }, privateMessage = (): void => {
        if (rereleaseMessages !== 'quake-1-re-ts-private')
            throw new Error('Message requires identified donor-private rerelease layout');
    };
    switch (m.kind) {
        case 'nop':
            MSG_WriteByte(sb, 1);
            break;
        case 'disconnect':
            MSG_WriteByte(sb, 2);
            break;
        case 'stat':
            writeNetQuakeStat(sb, m.index, m.value);
            break;
        case 'version':
            MSG_WriteByte(sb, 4);
            MSG_WriteLong(sb, m.version);
            break;
        case 'set-view':
            MSG_WriteByte(sb, 5);
            MSG_WriteShort(sb, m.entity);
            break;
        case 'sound':
        case 'static-sound':
            if (!writeNetQuakeSound(sb, profile, m))
                throw new RangeError('Sound exceeds selected NetQuake wire');
            break;
        case 'time':
            writeNetQuakeTime(sb, m.seconds);
            break;
        case 'print':
            text(8, m.text);
            break;
        case 'stufftext':
            text(9, m.text);
            break;
        case 'set-angle':
            MSG_WriteByte(sb, 10);
            for (const n of [m.angles.x, m.angles.y, m.angles.z])
                codec.writeAngle(sb, n, flags);
            break;
        case 'server-info':
            writeNetQuakeServerInfo(sb, m);
            break;
        case 'light-style':
            MSG_WriteByte(sb, 12);
            MSG_WriteByte(sb, m.index);
            MSG_WriteString(sb, m.value);
            break;
        case 'name':
            MSG_WriteByte(sb, 13);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteString(sb, m.value);
            break;
        case 'frags':
            MSG_WriteByte(sb, 14);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteShort(sb, m.value);
            break;
        case 'client-data':
            writeNetQuakeClientData(sb, profile, m.data, m.weaponAlpha, standardQuake);
            break;
        case 'stop-sound':
            MSG_WriteByte(sb, 16);
            MSG_WriteShort(sb, m.entity * 8 + m.channel);
            break;
        case 'colors':
            MSG_WriteByte(sb, 17);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteByte(sb, m.value);
            break;
        case 'particle':
            MSG_WriteByte(sb, 18);
            writeVec(m.origin);
            for (const n of [m.direction.x, m.direction.y, m.direction.z])
                MSG_WriteByte(sb, Math.trunc(n * 16));
            MSG_WriteByte(sb, m.count);
            MSG_WriteByte(sb, m.color);
            break;
        case 'damage':
            MSG_WriteByte(sb, 19);
            MSG_WriteByte(sb, m.armor);
            MSG_WriteByte(sb, m.blood);
            writeVec(m.source);
            break;
        case 'static':
            if (!codec.writeStatic(sb, wireEntity(m.state), flags))
                throw new RangeError('Static exceeds selected wire');
            break;
        case 'baseline':
            codec.writeBaseline(sb, m.state.number, wireEntity(m.state), flags);
            break;
        case 'temporary-entity': {
            const e = m.effect;
            MSG_WriteByte(sb, 23);
            MSG_WriteByte(sb, e.type);
            if (e.kind === 'beam') {
                MSG_WriteShort(sb, e.entity);
                writeVec(e.start);
                writeVec(e.end);
            }
            else {
                writeVec(e.origin);
                if (e.kind === 'explosion-colors') {
                    MSG_WriteByte(sb, e.colorStart);
                    MSG_WriteByte(sb, e.colorLength);
                }
            }
            break;
        }
        case 'pause':
            MSG_WriteByte(sb, 24);
            MSG_WriteByte(sb, m.paused ? 1 : 0);
            break;
        case 'signon':
            MSG_WriteByte(sb, 25);
            MSG_WriteByte(sb, m.stage);
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
        case 'intermission':
            MSG_WriteByte(sb, 30);
            break;
        case 'finale':
            text(31, m.text);
            break;
        case 'cd-track':
            MSG_WriteByte(sb, 32);
            MSG_WriteByte(sb, m.track);
            MSG_WriteByte(sb, m.loopTrack);
            break;
        case 'sell-screen':
            MSG_WriteByte(sb, 33);
            break;
        case 'cutscene':
            text(34, m.text);
            break;
        case 'skybox':
            text(37, m.text);
            break;
        case 'bonus-flash':
            MSG_WriteByte(sb, 40);
            break;
        case 'fog':
            MSG_WriteByte(sb, 41);
            MSG_WriteByte(sb, m.density * 255);
            for (const n of [m.color.x, m.color.y, m.color.z])
                MSG_WriteByte(sb, n * 255);
            MSG_WriteShort(sb, m.transitionSeconds * 100);
            break;
        case 'achievement':
            text(52, m.text);
            break;
        case 'local-sound':
            MSG_WriteByte(sb, 56);
            MSG_WriteByte(sb, m.index > 255 ? P.SND_LARGESOUND : 0);
            if (m.index > 255)
                MSG_WriteShort(sb, m.index);
            else
                MSG_WriteByte(sb, m.index);
            break;
        case 'botchat':
            privateMessage();
            text(38, m.text);
            break;
        case 'spawned-monster':
            privateMessage();
            MSG_WriteByte(sb, 39);
            MSG_WriteByte(sb, m.value);
            break;
        case 'set-views':
            privateMessage();
            MSG_WriteByte(sb, 45);
            MSG_WriteByte(sb, m.value);
            break;
        case 'ping':
            privateMessage();
            MSG_WriteByte(sb, 46);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteShort(sb, m.value);
            break;
        case 'social':
        case 'player-info':
            privateMessage();
            MSG_WriteByte(sb, m.kind === 'social' ? 47 : 48);
            MSG_WriteByte(sb, m.slot);
            MSG_WriteString(sb, m.value);
            break;
        case 'raw-print':
            privateMessage();
            text(49, m.text);
            break;
        case 'server-vars':
            privateMessage();
            text(50, m.text);
            break;
        case 'sequence':
            privateMessage();
            MSG_WriteByte(sb, 51);
            MSG_WriteLong(sb, m.value);
            break;
        case 'chat':
            privateMessage();
            text(53, m.text);
            break;
        case 'level-completed':
            privateMessage();
            MSG_WriteByte(sb, 54);
            break;
        case 'back-to-lobby':
            privateMessage();
            MSG_WriteByte(sb, 55);
            break;
        case 'prompt-begin':
            privateMessage();
            MSG_WriteByte(sb, 57);
            MSG_WriteByte(sb, 0);
            MSG_WriteString(sb, m.text);
            MSG_WriteByte(sb, m.choices);
            break;
        case 'prompt-choice':
            privateMessage();
            MSG_WriteByte(sb, 57);
            MSG_WriteByte(sb, 1);
            MSG_WriteString(sb, m.text);
            MSG_WriteByte(sb, m.impulse);
            break;
        case 'prompt-clear':
            privateMessage();
            MSG_WriteByte(sb, 57);
            MSG_WriteByte(sb, 2);
            break;
        default: {
            const exhaustive: never = m;
            throw new Error(`Unreachable message ${exhaustive}`);
        }
    }
}
/** A sender belongs to one seat and resets at a map change. */
export class NetQuakeMoveSender {
    private messages = 0;
    reset(): void { this.messages = 0; }
    next(command: Q1UserCommand, protocol: Q1ProtocolIdentity, demoPlayback = false): Uint8Array | null {
        if (demoPlayback)
            return null;
        if (++this.messages <= 2)
            return null;
        const buffer = new SizeBuf(128);
        writeNetQuakeMove(buffer, command, protocol);
        return buffer.bytes();
    }
}
