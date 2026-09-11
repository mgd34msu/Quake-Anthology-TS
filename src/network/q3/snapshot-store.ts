// sv_snapshot.c shared circular entity storage and per-client frame history.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { CommonError } from "../../core/common-error.ts";
import type { MessageWriter } from "./message.ts";
import { ServerOpcode } from "./server-message.ts";
import type { Snapshot } from "./server-message.ts";
import { writeDeltaEntity, writeDeltaPlayerState } from "./state-delta.ts";
import { EntityStateRecord } from "./state/entity.ts";
import type { EntityStateFields } from "./state/entity.ts";
import { PlayerStateRecord } from "./state/player.ts";
import type { PlayerStateFields } from "./state/player.ts";
import type { Product } from "./state/product.ts";

export class Q3SnapshotEntities {
  private readonly cells: (EntityStateRecord<number> | null)[];
  next = 0;
  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length < 1 || length > 131072) throw new RangeError("Q3 snapshot entity storage outside 1..131072");
    this.cells = Array.from({ length }, () => null);
  }
  append(entity: Readonly<EntityStateFields>): void {
    const index = this.next % this.length, existing = this.cells[index];
    if (existing === undefined) throw new RangeError("Invalid snapshot entity slot");
    const cell = existing ?? new EntityStateRecord<number>(0);
    cell.copyFrom(entity); this.cells[index] = cell; this.next++;
    if (this.next >= 0x7ffffffe) throw new CommonError("fatal", "svs.nextSnapshotEntities wrapped");
  }
  read(absolute: number): EntityStateRecord<number> {
    const cell = this.cells[absolute % this.length];
    if (cell === undefined) throw new RangeError("Invalid snapshot entity position");
    return cell === null ? new EntityStateRecord<number>(0) : cell.copy();
  }
}
export interface Q3ServerFrame {
  playerState: PlayerStateRecord<number, number, number>;
  areaMask: Uint8Array;
  firstEntity: number;
  numEntities: number;
  messageSize: number;
  messageSent: number;
  messageAcked: number;
}
export class Q3ServerSnapshotHistory {
  readonly frames: readonly Q3ServerFrame[];
  constructor(readonly entities: Q3SnapshotEntities, readonly product: Product, readonly baseline: (number: number) => EntityStateFields) {
    this.frames = Array.from({ length: 32 }, () => ({ playerState: new PlayerStateRecord<number, number, number>(product, 0, 0, 0),
      areaMask: new Uint8Array(0), firstEntity: 0, numEntities: 0, messageSize: 0, messageSent: 0, messageAcked: 0 }));
  }
  frame(sequence: number): Q3ServerFrame {
    const frame = this.frames[sequence & 31];
    if (frame === undefined) throw new RangeError("Missing source frame ring slot");
    return frame;
  }
  capture(sequence: number, player: Readonly<PlayerStateFields>, areaMask: Uint8Array, entities: readonly EntityStateFields[]): Q3ServerFrame {
    if (areaMask.length > 32 || entities.length > 256) throw new RangeError("Q3 snapshot exceeds source area/entity capacities");
    const frame = this.frame(sequence);
    frame.playerState.copyFrom(player); frame.areaMask = areaMask.slice(); frame.firstEntity = this.entities.next; frame.numEntities = 0;
    for (const entity of entities) { this.entities.append(entity); frame.numEntities++; }
    return frame;
  }
  delta(sequence: number, requested: number, active: boolean): number {
    if (requested <= 0 || !active || sequence - requested >= 29) return -1;
    const old = this.frame(requested);
    return old.firstEntity <= this.entities.next - this.entities.length ? -1 : requested;
  }
  /** Reads the physical source ring at emission time, including wrap effects. */
  write(writer: MessageWriter, sequence: number, requested: number, active: boolean, serverTime: number, flags: number): void {
    const current = this.frame(sequence), delta = this.delta(sequence, requested, active), old = delta < 0 ? null : this.frame(delta);
    writer.writeByte(ServerOpcode.Snapshot); writer.writeLong(serverTime); writer.writeByte(delta < 0 ? 0 : sequence - delta);
    writer.writeByte(flags); writer.writeByte(current.areaMask.length); writer.writeData(current.areaMask);
    writeDeltaPlayerState(writer, old?.playerState ?? null, current.playerState);
    let newIndex = 0, oldIndex = 0;
    while (newIndex < current.numEntities || (old !== null && oldIndex < old.numEntities)) {
      const next = newIndex < current.numEntities ? this.entities.read(current.firstEntity + newIndex) : null;
      const previous = old !== null && oldIndex < old.numEntities ? this.entities.read(old.firstEntity + oldIndex) : null;
      if (next !== null && previous !== null && next.number === previous.number) {
        writeDeltaEntity(writer, previous, next); newIndex++; oldIndex++;
      } else if (next !== null && (previous === null || next.number < previous.number)) {
        writeDeltaEntity(writer, this.baseline(next.number), next, true); newIndex++;
      } else if (previous !== null) { writeDeltaEntity(writer, previous, null, true); oldIndex++; }
      else throw new RangeError("Missing snapshot merge entity");
    }
    writer.writeBits(1023, 10);
  }
  copy(sequence: number, deltaNumber: number, serverTime: number, flags: number, serverCommandNumber: number): Snapshot {
    const frame = this.frame(sequence);
    return { messageNumber: sequence, deltaNumber, serverTime, flags, serverCommandNumber, parseEntitiesNumber: frame.firstEntity,
      areaMask: frame.areaMask.slice(), playerState: frame.playerState.copy(), entities: Array.from({ length: frame.numEntities }, (_, index) => this.entities.read(frame.firstEntity + index)) };
  }
}
