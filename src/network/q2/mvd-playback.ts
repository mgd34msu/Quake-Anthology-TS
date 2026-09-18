import { mvdProfile, readMvdHeader } from './mvd-profile.ts';
import { createRereleaseContext } from './codecs/q2repro.ts';
import { readQ2ProEntity, readQ2ProEntityBits } from './codecs/q2pro-fields.ts';
// q2repro server/mvd/parse.c. Recorded state feeds the existing Q2 client receiver.
import * as mvd from './codecs/mvd.ts';
import { Q2WireCodec } from './codec.ts';
import { EntityStateT, PlayerStateT } from './state.ts';
import { U_REMOVE, U_OLDORIGIN, U_FRAME16, U_SKIN16, U_SKIN8, U_EFFECTS16, U_EFFECTS8, U_RENDERFX16, U_RENDERFX8, U_SOLID } from './constants.ts';
import { MSG_ReadByte, MSG_ReadWord, MSG_ReadString, checkMessageRead } from './message.ts';
import { Q2ServerMessageReader } from './server-messages.ts';
import type { Q2ServerRecord, Q2ServerEvent } from './server-messages.ts';
import type { ServerDataReadResultT } from './codecs/codec.ts';
import { MVD_MAX_MESSAGE } from './mvd-recording.ts';
export interface MvdVisibility {
    entities(entities: readonly EntityStateT[], player: PlayerStateT, portalBits: Uint8Array): readonly EntityStateT[];
    /** Leaf and portal bits belong to the source BSP; absent visibility must not masquerade as PVS. */
    visible(leaf: number, channel: 'pvs' | 'phs', player: PlayerStateT, portalBits: Uint8Array): boolean;
    areaBits(player: PlayerStateT, portalBits: Uint8Array): Uint8Array;
    soundAudible(origin: readonly [number, number, number], player: PlayerStateT, portalBits: Uint8Array): boolean;
    soundOrigin(entity: EntityStateT): readonly [number, number, number];
}
export class MvdPlayback {
    private profile = mvdProfile(2010, 0);
    get protocol(): ConstructorParameters<typeof Q2WireCodec>[0] { return this.profile.protocol; }
    readonly configStrings = new Map<number, string>();
    readonly players = new Map<number, PlayerStateT>();
    private entities = new Map<number, EntityStateT>();
    private readonly wire = new Q2WireCodec(this.protocol);
    private readonly rerelease = createRereleaseContext(this.wire.message);
    private embedded = new Q2ServerMessageReader(this.protocol, { maxConfigStrings: 2080, inventorySlots: 256 });
    private data: ServerDataReadResultT | null = null;
    private frameNumber = 0;
    private maxClients = 0;
    private portalBits = new Uint8Array(0);
    private selected = 0;
    private dummy = -1;
    constructor(private readonly visibility: MvdVisibility) {}
    get header(): ServerDataReadResultT | null { return this.data; }
    get selectedPlayer(): number { return this.selected; }
    selectPlayer(number: number): void {
        if (!Number.isInteger(number) || number < 0 || number >= this.maxClients || !this.players.has(number)) throw new RangeError('MVD player is not active');
        this.selected = number;
    }
    private player(): PlayerStateT { return this.players.get(this.selected) ?? new PlayerStateT(); }
    read(bytes: Uint8Array): readonly Q2ServerRecord[] { return [...this.readRecords(bytes)]; }
    *readRecords(bytes: Uint8Array): Generator<Q2ServerRecord, void, unknown> {
        if (bytes.length < 1 || bytes.length > MVD_MAX_MESSAGE) throw new RangeError('Invalid MVD message length');
        this.wire.begin(bytes);
        const message = this.wire.message, records: Q2ServerRecord[] = [];
        const emit = (opcode: number, start: number, event: Q2ServerEvent): void => {
            checkMessageRead(message); records.push({ seat: 0, opcode, raw: message.data.slice(start, message.readcount), event });
        };
        while (message.readcount < message.cursize) {
            const start = message.readcount, command = mvd.MSG_ReadMvdCmd(message);
            switch (command.op) {
                case mvd.mvd_nop: break;
                case mvd.mvd_serverdata: {
                    const header = readMvdHeader(bytes.subarray(start));
                    this.profile = header;
                    message.readcount = start + header.frameOffset;
                    this.embedded = new Q2ServerMessageReader(header.protocol, { maxConfigStrings: header.maxConfigStrings, inventorySlots: 256 });
                    if (header.protocol.kind === 'q2-q2pro') this.embedded.wire.acceptQ2ProFeatures(header.protocol.revision, header.data.wireFlags ?? 0);
                    this.configStrings.clear(); this.players.clear(); this.entities.clear(); this.frameNumber = 0;
                    for (const [index, value] of header.configStrings) this.configStrings.set(index, value);
                    this.maxClients = header.maxClients; this.dummy = header.dummy;
                    this.readFrame(this.dummy);
                    if (!this.players.has(this.selected)) this.selected = this.players.keys().next().value ?? 0;
                    this.data = { ...header.data, clientnum: this.selected };
                    emit(12, start, { kind: 'server-data', data: this.data });
                    for (const [index, value] of this.configStrings) emit(13, start, { kind: 'config-string', index, value });
                    // Full state is ready before normal receiver precache and first frame publication.
                    emit(11, start, { kind: 'command-text', text: `precache ${header.data.servercount}\n` });
                    yield* records; records.length = 0;
                    emit(20, start, { kind: 'frame', frame: this.frame() });
                    break;
                }
                case mvd.mvd_frame:
                    if (this.data === null) throw new Error('MVD frame before serverdata');
                    this.readFrame(this.dummy); emit(20, start, { kind: 'frame', frame: this.frame() }); break;
                case mvd.mvd_configstring: {
                    const index = MSG_ReadWord(message), value = MSG_ReadString(message);
                    if (index >= this.profile.maxConfigStrings) throw new Error('Invalid MVD configstring index');
                    this.configStrings.set(index, value); emit(13, start, { kind: 'config-string', index, value }); break;
                }
                case mvd.mvd_print: {
                    const level = MSG_ReadByte(message), text = MSG_ReadString(message); emit(10, start, { kind: 'print', level, text }); break;
                }
                case mvd.mvd_sound: {
                    const flags = MSG_ReadByte(message), index = flags & 32 ? MSG_ReadWord(message) : MSG_ReadByte(message);
                    const volume = flags & 1 ? MSG_ReadByte(message) / 255 : 1;
                    const attenuation = flags & 2 ? MSG_ReadByte(message) / 64 : 1;
                    const delaySeconds = flags & 16 ? MSG_ReadByte(message) / 1000 : 0;
                    const channel = MSG_ReadWord(message), entity = channel >>> 3, state = this.entities.get(entity);
                    if (entity >= this.profile.maxEntities) throw new Error('Invalid MVD sound entity');
                    if (state !== undefined) {
                        const position = this.visibility.soundOrigin(state);
                        if ((command.extrabits & 1) !== 0 || this.visibility.soundAudible(position, this.player(), this.portalBits))
                            emit(9, start, { kind: 'sound', sound: { flags: flags | 12, index, volume, attenuation, delaySeconds, entity, channel: channel & 7, position: { x: position[0], y: position[1], z: position[2] } } });
                    }
                    break;
                }
                case mvd.mvd_unicast: case mvd.mvd_unicast_r:
                case mvd.mvd_multicast_all: case mvd.mvd_multicast_all_r:
                case mvd.mvd_multicast_pvs: case mvd.mvd_multicast_pvs_r:
                case mvd.mvd_multicast_phs: case mvd.mvd_multicast_phs_r: {
                    const length = MSG_ReadByte(message) | command.extrabits << 8;
                    let visible = true;
                    if (command.op === mvd.mvd_unicast || command.op === mvd.mvd_unicast_r) {
                        const number = MSG_ReadByte(message);
                        if (number >= this.maxClients) throw new Error('Invalid MVD unicast player');
                        visible = number === this.selected;
                    } else if (command.op !== mvd.mvd_multicast_all && command.op !== mvd.mvd_multicast_all_r) {
                        const leaf = MSG_ReadWord(message), channel = command.op === mvd.mvd_multicast_pvs || command.op === mvd.mvd_multicast_pvs_r ? 'pvs' : 'phs';
                        visible = this.visibility.visible(leaf, channel, this.player(), this.portalBits);
                    }
                    const end = message.readcount + length;
                    if (end > message.cursize) throw new Error('Truncated MVD embedded message');
                    const payload = message.data.slice(message.readcount, end); message.readcount = end;
                    if (visible) records.push(...this.embedded.read(payload));
                    break;
                }
                default: throw new Error(`Unsupported MVD command ${command.op}`);
            }
            checkMessageRead(message);
        }
        this.wire.finish(); yield* records;
    }
    private readFrame(dummy: number): void {
        const message = this.wire.message, portalLength = MSG_ReadByte(message);
        if (portalLength < 0 || message.readcount + portalLength > message.cursize) throw new Error('Truncated MVD portal bits');
        this.portalBits = message.data.slice(message.readcount, message.readcount + portalLength); message.readcount += portalLength;
        for (;;) {
            const number = MSG_ReadByte(message);
            if (number === mvd.CLIENTNUM_NONE) break;
            if (number < 0 || number >= this.maxClients) throw new Error('Invalid MVD player number');
            const result = mvd.readMvdPlayer(message, this.players.get(number) ?? null, number, this.profile);
            if (result.removed) this.players.delete(number); else { result.ps.clientnum = number; this.players.set(number, result.ps); }
        }
        const next = new Map<number, EntityStateT>();
        for (const [number, previous] of this.entities) {
            const entity = new EntityStateT(); this.readEntity(previous, entity, number, 0); entity.old_origin.set(previous.renderfx & 128 ? previous.old_origin : previous.origin); next.set(number, entity);
        }
        for (;;) {
            const { number, bits } = this.profile.extended ? readQ2ProEntityBits(message) : this.wire.codec.readEntityBits(); checkMessageRead(message);
            if (number === 0) break;
            if (number < 0 || number >= this.profile.maxEntities) throw new Error('Invalid MVD entity number');
            if (bits & U_REMOVE) { next.delete(number); continue; }
            const previous = this.entities.get(number) ?? new EntityStateT(), entity = new EntityStateT();
            this.readEntity(previous, entity, number, bits);
            if (!(bits & U_OLDORIGIN)) entity.old_origin.set(previous.renderfx & 128 ? previous.old_origin : previous.origin);
            if (bits & U_FRAME16) entity.frame &= 65535;
            if ((bits & (U_SKIN8 | U_SKIN16)) === U_SKIN16) entity.skinnum &= 65535;
            if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === U_EFFECTS16) entity.effects &= 65535;
            if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === U_RENDERFX16) entity.renderfx &= 65535;
            if (!this.profile.extended && bits & U_SOLID) entity.solid &= 65535;
            next.set(number, entity);
        }
        for (const [number, player] of this.players) {
            const entity = next.get(number + 1);
            if (entity === undefined || number === dummy || player.pmove.pm_type !== 0) continue;
            for (let axis = 0; axis < 3; axis++) entity.origin[axis] = this.profile.rerelease ? player.pmove.originF[axis] ?? 0 : (player.pmove.origin[axis] ?? 0) / 8;
            const pitch = player.viewangles[0] ?? 0;
            entity.angles[0] = (pitch > 180 ? pitch - 360 : pitch) / 3; entity.angles[1] = player.viewangles[1] ?? 0; entity.angles[2] = 0;
        }
        this.entities = next;
        if (!this.players.has(this.selected)) this.selected = this.players.keys().next().value ?? 0;
        this.frameNumber++;
    }
    private readEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void {
        if (this.profile.rerelease) this.rerelease.Q2REPRO_CODEC.readDeltaEntity(from, to, number, bits);
        else if (this.profile.extended) readQ2ProEntity(this.wire.message, { revision: this.profile.fog ? 1026 : this.profile.v2 ? 1025 : 1024, flags: this.profile.v2 ? 24 : 8 }, from, to, number, bits);
        else this.wire.codec.readDeltaEntity(from, to, number, bits);
    }
    get projection(): { readonly clientnum: number; readonly frame: Extract<Q2ServerEvent, { kind: 'frame' }>['frame'] } {
        return { clientnum: this.selected, frame: this.frame() };
    }
    private frame(): Extract<Q2ServerEvent, { kind: 'frame' }>['frame'] {
        return { serverFrame: this.frameNumber, deltaFrame: -1, suppressedCount: 0, areaBits: this.visibility.areaBits(this.player(), this.portalBits), player: this.player(), entities: this.visibility.entities([...this.entities.values()].sort((a, b) => a.number - b.number), this.player(), this.portalBits) };
    }
}
