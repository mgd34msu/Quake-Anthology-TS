// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import type { EntityStateT, PlayerStateT, UsercmdT } from "../state.ts";
import type { ClcBatchMoveFrameT } from "./clc_batch_move.ts";
export interface ServerDataParamsT {
    serverFps?: number;
    wireFlags?: number;
    protocolRevision?: number;
    servercount: number;
    attractloop: boolean;
    gamedir: string;
    clientnum: number;
    levelname: string;
    serverState: number;
    r1q2Version?: number;
    r1q2StrafejumpHack?: boolean;
    q2proVersion?: number;
    q2proStrafejumpHack?: boolean;
    q2proQwMode?: boolean;
    q2proWaterjumpHack?: boolean;
}
export interface FrameWriteParamsT {
    framenum: number;
    lastframe: number;
    surpressCount: number;
    areabits: Uint8Array;
    areabytes: number;
    psFrom: PlayerStateT | null;
    psTo: PlayerStateT;
}
export interface FrameHeaderT {
    areabytes: number;
    serverframe: number;
    deltaframe: number;
    surpressCount: number;
}
export interface ServerDataReadResultT {
    serverFps?: number;
    wireFlags?: number;
    protocolRevision?: number;
    servercount: number;
    attractloop: boolean;
    gamedir: string;
    clientnum: number;
    levelname: string;
    serverState: number;
    r1q2Version?: number;
    r1q2StrafejumpHack?: boolean;
    q2proVersion?: number;
    q2proStrafejumpHack?: boolean;
    q2proQwMode?: boolean;
    q2proWaterjumpHack?: boolean;
}
export interface ClcBatchMoveT {
    lastframe: number;
    numDups: number;
    frames: ClcBatchMoveFrameT[];
}
export interface ClcUserinfoDeltaT {
    name: string;
    value: string;
}
export interface ClcClientSettingT {
    index: number;
    value: number;
}
export interface ProtocolCodec {
    readonly name: string;
    writeServerData(msg: SizeBuf, params: ServerDataParamsT): void;
    writeDeltaEntity(msg: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newentity: boolean): void;
    writeEntityRemove(msg: SizeBuf, oldnum: number): void;
    writePacketEntitiesEnd(msg: SizeBuf): void;
    writeSpawnBaseline(msg: SizeBuf, base: EntityStateT): void;
    writePlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void;
    writePacketEntitiesBegin(msg: SizeBuf): void;
    writeFrame(msg: SizeBuf, params: FrameWriteParamsT, writeEntities: (msg: SizeBuf) => void): void;
    writeDeltaUsercmd?(msg: SizeBuf, from: UsercmdT, cmd: UsercmdT): void;
    readDeltaUsercmd?(msg: SizeBuf, from: UsercmdT, move: UsercmdT): void;
    readServerData(): ServerDataReadResultT;
    readEntityBits(): {
        number: number;
        bits: number;
    };
    readDeltaEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void;
    readPlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void;
    readFrameHeader(areabits: Uint8Array, readSuppressByte: boolean): FrameHeaderT;
    readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void;
    readPacketEntitiesBegin(): void;
    readBatchMove?(msg: SizeBuf, nodelta: boolean, opcodeExtra: number): ClcBatchMoveT;
    writeBatchMove?(msg: SizeBuf, lastframe: number | null, frames: ClcBatchMoveFrameT[]): void;
    readUserinfoDelta?(msg: SizeBuf): ClcUserinfoDeltaT;
    readClientSetting?(msg: SizeBuf): ClcClientSettingT;
    clcMoveHasChecksum?: boolean;
}
