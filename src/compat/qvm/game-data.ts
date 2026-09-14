// SV_LocateGameData, SV_GentityNum, SV_GameClientNum and SV_NumForGentity
// from id Software's code/server/sv_game.c. GPL-2.0-or-later.
// Copyright (C) 1999-2005 Id Software, Inc.
import type { QvmSharedEntity } from "./shared-entity-record.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmMemory } from "./memory.ts";
import { QVM_PLAYER_STATE_BYTES, readQvmPlayerState } from "./player-record.ts";
import { QVM_SHARED_ENTITY_BYTES, borrowQvmSharedEntity } from "./shared-entity-record.ts";

function int32(value: number): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError("Game-data indexes and strides require signed 32-bit words");
  }
}

export interface QvmGameDataState {
  readonly entitiesWord: number;
  readonly numEntities: number;
  readonly entityStride: number;
  readonly clientsWord: number;
  readonly clientStride: number;
}

/** Borrows the interpreter allocation. Relocation changes table descriptors, not existing pointers. */
export class QvmGameData {
  private entities: number | null = null;
  private entityStride = 0;
  private count = 0;
  private clients: number | null = null;
  private clientStride = 0;
  private clientCount = 64;
  private readonly entityPointers = new Map<number, QvmSharedEntity>();

  constructor(private readonly memory: QvmMemory) {}

  /** Native Q3 reserves at most MAX_CLIENTS player slots; the server may narrow it. */
  setClientCount(count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > 64) throw new RangeError("Q3 client count must be within 1..64");
    this.clientCount = count;
  }

  get numClients(): number { return this.clientCount; }
  get numEntities(): number { return this.count; }
  get entityStrideBytes(): number { return this.entityStride; }
  get clientStrideBytes(): number { return this.clientStride; }

  entityBytes(number: number): DataView { return this.view(this.entityOffset(number), this.entityStride); }
  clientBytes(number: number): DataView { return this.view(this.clientOffset(number), this.clientStride); }
  publicEntityBytes(number: number): DataView { return this.view(this.entityOffset(number), QVM_SHARED_ENTITY_BYTES); }
  publicPlayerBytes(number: number): DataView { return this.view(this.clientOffset(number), QVM_PLAYER_STATE_BYTES); }

  clear(): void { this.entities = null; this.clients = null; this.entityStride = 0; this.clientStride = 0; this.count = 0; }

  checkpoint(): QvmGameDataState {
    const word = (offset: number | null): number => offset === null ? 0 : offset === 0 ? this.memory.bytes.length : offset;
    return { entitiesWord: word(this.entities), numEntities: this.count, entityStride: this.entityStride,
      clientsWord: word(this.clients), clientStride: this.clientStride };
  }

  restore(state: QvmGameDataState): void {
    if (state.entitiesWord === 0 && state.clientsWord === 0 && state.numEntities === 0 && state.entityStride === 0 && state.clientStride === 0) {
      this.clear(); return;
    }
    this.locate(state.entitiesWord, state.numEntities, state.entityStride, state.clientsWord, state.clientStride);
  }

  locate(entitiesWord: number, numEntities: number, entityStride: number,
    clientsWord: number, clientStride: number): void {
    const entities = this.offset(entitiesWord), clients = this.offset(clientsWord);
    int32(numEntities); int32(entityStride); int32(clientStride);
    if (numEntities < 0 || numEntities > 1024) throw new RangeError("Q3 wire entity capacity is 1024 slots");
    const stride = (value: number, minimum: number): void => {
      if (value < minimum || value % 4 !== 0) throw new RangeError("Game-data stride is undersized or unaligned");
    };
    stride(entityStride, QVM_SHARED_ENTITY_BYTES);
    stride(clientStride, QVM_PLAYER_STATE_BYTES);
    if (entities === null || clients === null || entities % 4 !== 0 || clients % 4 !== 0) {
      throw new RangeError("Game-data tables require aligned nonnull pointers");
    }
    this.view(entities, numEntities * entityStride);
    this.view(clients, clientStride);
    this.entities = entities;
    this.entityStride = entityStride;
    this.count = numEntities;
    this.clients = clients;
    this.clientStride = clientStride;
  }

  private offset(word: number): number | null {
    const pointer = this.memory.pointer(word);
    return pointer === null ? null : pointer.byteOffset - this.memory.bytes.byteOffset;
  }

  private entityOffset(number: number): number {
    if (!Number.isInteger(number) || number < 0 || number >= this.count) throw new RangeError("Entity slot is outside located game data");
    return this.indexed(this.entities, this.entityStride, number);
  }

  private clientOffset(number: number): number {
    if (!Number.isInteger(number) || number < 0 || number >= this.clientCount) throw new RangeError("Client slot is outside configured game data");
    const offset = this.indexed(this.clients, this.clientStride, number);
    this.view(offset, this.clientStride);
    return offset;
  }

  private indexed(base: number | null, stride: number, number: number): number {
    if (base === null) throw new RangeError("Game-data table has a null source pointer");
    int32(number);
    const displacement = stride * number;
    int32(displacement);
    const offset = base + displacement;
    if (offset < 0 || offset > this.memory.bytes.byteLength) {
      throw new RangeError("Game-data pointer arithmetic leaves the interpreter allocation");
    }
    return offset;
  }

  private view(offset: number, size: number): DataView {
    const bytes = this.memory.bytes;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength - size) {
      throw new RangeError("Game-data record exceeds the interpreter allocation");
    }
    return new DataView(bytes.buffer, bytes.byteOffset + offset, size);
  }

  private entityAt(offset: number): QvmSharedEntity {
    const existing = this.entityPointers.get(offset);
    if (existing !== undefined) return existing;
    const entity = borrowQvmSharedEntity(this.view(offset, QVM_SHARED_ENTITY_BYTES));
    this.entityPointers.set(offset, entity);
    return entity;
  }

  entity(number: number): QvmSharedEntity {
    return this.entityAt(this.entityOffset(number));
  }

  entityFromPointer(word: number): QvmSharedEntity {
    return this.entity(this.numberFromPointer(word));
  }

  numberFromPointer(word: number): number {
    const offset = this.offset(word), base = this.entities;
    if (offset === null || base === null) throw new RangeError("Entity numbering requires nonnull source pointers");
    if (this.entityStride === 0) throw new RangeError("Entity numbering requires a nonzero source stride");
    const number = (offset - base) / this.entityStride;
    this.entityOffset(number);
    return number;
  }

  copyPlayerState(number: number): Q3PlayerState {
    return readQvmPlayerState(this.view(this.clientOffset(number), QVM_PLAYER_STATE_BYTES));
  }

  setPlayerPing(number: number, ping: number): void {
    // The server writes this field directly, without reading or copying the rest of playerState_t.
    const offset = this.clientOffset(number);
    this.view(offset + 452, 4).setInt32(0, ping, true);
  }
}
