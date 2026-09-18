// Quake II sv_ents.c / cl_ents.c packet entity merge. GPL-2.0-or-later.
import { EntityStateT, PlayerStateT } from './state.ts';
import type { ProtocolCodec, FrameWriteParamsT } from './codecs/codec.ts';
import { U_REMOVE } from './constants.ts';
import { checkMessageRead, createMessage, messageBytes, MSG_ReadByte, MSG_ReadData, MSG_WriteByte, MSG_WriteLong, SZ_Write } from './message.ts';
import type { Q2WireCodec } from './codec.ts';
export interface Q2WireFrame {
    readonly valid?: boolean;
    readonly serverFrame: number;
    readonly deltaFrame: number;
    readonly suppressedCount: number;
    readonly areaBits: Uint8Array;
    readonly player: PlayerStateT;
    readonly splitPlayers?: readonly { readonly areaBits: Uint8Array; readonly player: PlayerStateT }[];
    readonly entities: readonly EntityStateT[];
}
function ordered(entities: readonly EntityStateT[]): void {
    let previous = 0;
    for (const entity of entities) {
        if (entity.number <= previous || entity.number > 65535)
            throw new RangeError('Q2 frame entity numbers must be unique and sorted');
        previous = entity.number;
    }
}
export function writePacketEntities(codec: ProtocolCodec, message: Parameters<ProtocolCodec['writeDeltaEntity']>[0], old: readonly EntityStateT[], current: readonly EntityStateT[], baselines: ReadonlyMap<number, EntityStateT>, maxClients: number): void {
    ordered(old);
    ordered(current);
    codec.writePacketEntitiesBegin(message);
    let before = 0, after = 0;
    while (before < old.length || after < current.length) {
        const from = old[before], to = current[after], oldNumber = from?.number ?? Infinity, newNumber = to?.number ?? Infinity;
        if (from !== undefined && to !== undefined && oldNumber === newNumber) {
            codec.writeDeltaEntity(message, from, to, false, to.number <= maxClients);
            before++;
            after++;
        }
        else if (to !== undefined && newNumber < oldNumber) {
            codec.writeDeltaEntity(message, baselines.get(to.number) ?? new EntityStateT(), to, true, true);
            after++;
        }
        else if (from !== undefined) {
            codec.writeEntityRemove(message, from.number);
            before++;
        }
        else
            throw new Error('Invalid Q2 packet entity merge');
    }
    codec.writePacketEntitiesEnd(message);
}
export function encodeQ2Frame(wire: Q2WireCodec, frame: Q2WireFrame, old: Q2WireFrame | null, baselines: ReadonlyMap<number, EntityStateT>, maxClients: number): Uint8Array {
    const message = createMessage();
    if ((wire.protocol.kind === 'q2-kex' || wire.protocol.kind === 'q2-kex-demo') && frame.splitPlayers !== undefined) {
        MSG_WriteByte(message, 20); MSG_WriteLong(message, frame.serverFrame); MSG_WriteLong(message, old?.serverFrame ?? -1); MSG_WriteByte(message, frame.suppressedCount);
        const players = [{ areaBits: frame.areaBits, player: frame.player }, ...frame.splitPlayers];
        for (let index = 0; index < players.length; index++) {
            const state = players[index]; if (state === undefined) throw new Error('Missing KEX split frame');
            const previous = index === 0 ? old?.player : old?.splitPlayers?.[index - 1]?.player;
            MSG_WriteByte(message, state.areaBits.length); SZ_Write(message, state.areaBits, state.areaBits.length);
            MSG_WriteByte(message, 17); wire.codec.writePlayerStateDelta(message, previous ?? new PlayerStateT(), state.player);
        }
        writePacketEntities(wire.codec, message, old?.entities ?? [], frame.entities, baselines, maxClients); return messageBytes(message);
    }
    const params: FrameWriteParamsT = { framenum: frame.serverFrame, lastframe: old?.serverFrame ?? -1, surpressCount: frame.suppressedCount, areabits: frame.areaBits, areabytes: frame.areaBits.length, psFrom: old?.player ?? null, psTo: frame.player };
    wire.codec.writeFrame(message, params, m => writePacketEntities(wire.codec, m, old?.entities ?? [], frame.entities, baselines, maxClients));
    return messageBytes(message);
}
export class Q2FrameHistory {
    private readonly frames = new Map<number, Q2WireFrame>();
    readonly baselines = new Map<number, EntityStateT>();
    constructor(readonly capacity = 16) {
        if (!Number.isInteger(capacity) || capacity < 1)
            throw new RangeError('Invalid Q2 frame history');
    }
    get(number: number): Q2WireFrame | null { return this.frames.get(number) ?? null; }
    latest(): Q2WireFrame | null {
        let latest: Q2WireFrame | null = null;
        for (const frame of this.frames.values()) if (frame.valid !== false && (latest === null || frame.serverFrame > latest.serverFrame)) latest = frame;
        return latest;
    }
    clear(): void { this.frames.clear(); this.baselines.clear(); }
    accept(frame: Q2WireFrame): void {
        this.frames.set(frame.serverFrame, frame);
        while (this.frames.size > this.capacity) {
            const oldest = this.frames.keys().next();
            if (oldest.done) break;
            this.frames.delete(oldest.value);
        }
    }
    read(wire: Q2WireCodec, readSuppressByte = true): Q2WireFrame {
        const areaBits = new Uint8Array(255);
        const header = wire.codec.readFrameHeader(areaBits, readSuppressByte);
        const old = header.deltaframe > 0 ? this.frames.get(header.deltaframe) : undefined;
        const valid = header.deltaframe <= 0 || (old !== undefined && old.valid !== false);
        const player = new PlayerStateT();
        wire.codec.readFramePlayerstate(old?.player ?? new PlayerStateT(), player);
        const splitPlayers: { areaBits: Uint8Array; player: PlayerStateT }[] = [];
        if (wire.protocol.kind === 'q2-kex' || wire.protocol.kind === 'q2-kex-demo') for (let index = 1; index < wire.kex.splitPlayerCount(); index++) {
            const length = MSG_ReadByte(wire.message), area = new Uint8Array(length), next = new PlayerStateT();
            MSG_ReadData(wire.message, area, length);
            wire.codec.readFramePlayerstate(old?.splitPlayers?.[index - 1]?.player ?? new PlayerStateT(), next);
            splitPlayers.push({ areaBits: area, player: next });
        }
        wire.codec.readPacketEntitiesBegin();
        const entities: EntityStateT[] = [], previous = old?.entities ?? [];
        let cursor = 0, lastNumber = 0;
        const unchanged = (from: EntityStateT): void => { const entity = new EntityStateT(); wire.codec.readDeltaEntity(from, entity, from.number, 0); entities.push(entity); };
        for (;;) {
            const headerEntity = wire.codec.readEntityBits();
            checkMessageRead(wire.message);
            if (headerEntity.number === 0)
                break;
            if (headerEntity.number <= lastNumber)
                throw new Error('Unordered Q2 entity delta');
            lastNumber = headerEntity.number;
            for (;;) {
                const from = previous[cursor];
                if (from === undefined || from.number >= headerEntity.number)
                    break;
                unchanged(from);
                cursor++;
            }
            const from = previous[cursor];
            if ((headerEntity.bits & U_REMOVE) !== 0) {
                if (from?.number !== headerEntity.number) {
                    if (valid)
                        throw new Error('Q2 entity removal has no delta source');
                }
                else
                    cursor++;
                continue;
            }
            const matched = from?.number === headerEntity.number;
            const baseline = matched ? from : this.baselines.get(headerEntity.number) ?? new EntityStateT();
            if (baseline === undefined)
                throw new Error('Missing Q2 entity baseline');
            const entity = new EntityStateT();
            wire.codec.readDeltaEntity(baseline, entity, headerEntity.number, headerEntity.bits);
            entities.push(entity);
            if (matched)
                cursor++;
        }
        for (; cursor < previous.length; cursor++) {
            const from = previous[cursor];
            if (from !== undefined)
                unchanged(from);
        }
        checkMessageRead(wire.message);
        const frame: Q2WireFrame = { valid, serverFrame: header.serverframe, deltaFrame: header.deltaframe, suppressedCount: header.surpressCount, areaBits: areaBits.slice(0, header.areabytes), player, ...(splitPlayers.length === 0 ? {} : { splitPlayers }), entities };
        this.accept(frame);
        return frame;
    }
}
