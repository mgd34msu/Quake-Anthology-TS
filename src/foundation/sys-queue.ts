/*
 * Fixed system-intake queue, following the shared C foundation
 * (include/qa/platform_events.h, THE-864): one timestamped tagged record for
 * every physical input, admission is checked before any destructive source
 * read, payload bytes live in the queue's load-sized arena until consumed,
 * and each consumer retires its own cursor so a deferred packet cannot block
 * key releases. SDL/socket records convert at intake into these numeric
 * kinds; the four numeric fields carry the per-kind values (window, code,
 * axes, buttons) chosen by the intake adapter. Byte capacity is reclaimed
 * when the queue fully drains, where the C pages reclaim per page.
 * GPL-2.0-or-later.
 */

import { ByteArena } from "./arena.ts";

export const SYS_TIME = 0;
export const SYS_KEY = 1;
export const SYS_CHAR = 2;
export const SYS_MOUSE = 3;
export const SYS_CONTROLLER_AXIS = 4;
export const SYS_CONTROLLER_BUTTON = 5;
export const SYS_CONSOLE_LINE = 6;
export const SYS_PACKET = 7;
export const SYS_WINDOW = 8;
export const SYS_QUIT = 9;
export const SYS_DEVICE = 10;
export const SYS_INPUT_FRAME = 11;
export const SYS_USERCMD = 12;
export const SYS_CONSOLE_COMMAND = 13;
export const SYS_KIND_COUNT = 14;

export type SysEventKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type SysAdmitResult = "accepted" | "full" | "oversize";

/** One reusable intake slot. Borrowed until its own consume, reset or destroy. */
export interface SysEventSlot {
  kind: SysEventKind;
  timeNs: number;
  a: number;
  b: number;
  c: number;
  d: number;
  payloadOffset: number;
  payloadLength: number;
}

export interface SysEventCursor {
  next: number;
}

export interface SysQueueStats {
  readonly accepted: number;
  readonly consumed: number;
  readonly fullRecords: number;
  readonly fullBytes: number;
  readonly records: number;
  readonly bytes: number;
  readonly peakRecords: number;
  readonly peakBytes: number;
}

const DEFAULT_RECORDS = 1024;
const DEFAULT_BYTES = 1024 * 1024;

export class SysEventQueue {
  private readonly slots: SysEventSlot[] = [];
  private readonly mask: number;
  private readonly payload: ByteArena;
  private readonly cursors = new Set<SysEventCursor>();
  private firstId = 1;
  private nextId = 1;
  private quit = false;
  private acceptedCount = 0;
  private consumedCount = 0;
  private fullRecordCount = 0;
  private fullByteCount = 0;
  private peakRecordCount = 0;
  private peakByteCount = 0;
  private readonly oversizeByKind = new Uint32Array(SYS_KIND_COUNT);
  private readonly deferredByKind = new Uint32Array(SYS_KIND_COUNT);

  constructor(recordCapacity: number = DEFAULT_RECORDS, byteCapacity: number = DEFAULT_BYTES) {
    if (!Number.isSafeInteger(recordCapacity) || recordCapacity < 1 || (recordCapacity & (recordCapacity - 1)) !== 0) {
      throw new RangeError("System queue record capacity must be a positive power of two");
    }
    this.mask = recordCapacity - 1;
    for (let index = 0; index < recordCapacity; index++) {
      this.slots.push({ kind: 0, timeNs: 0, a: 0, b: 0, c: 0, d: 0, payloadOffset: -1, payloadLength: 0 });
    }
    this.payload = new ByteArena(byteCapacity);
    this.payload.seal();
  }

  get live(): number { return this.nextId - this.firstId; }

  stats(): SysQueueStats {
    return {
      accepted: this.acceptedCount, consumed: this.consumedCount,
      fullRecords: this.fullRecordCount, fullBytes: this.fullByteCount,
      records: this.live, bytes: this.payload.used,
      peakRecords: this.peakRecordCount, peakBytes: this.peakByteCount,
    };
  }

  oversize(kind: SysEventKind): number { return this.oversizeByKind[kind] ?? 0; }
  deferred(kind: SysEventKind): number { return this.deferredByKind[kind] ?? 0; }

  /** Admission precedes destructive source reads; a full queue loses nothing it accepted. */
  admit(kind: SysEventKind, maximumPayload: number): SysAdmitResult {
    if (maximumPayload > this.payload.capacity) {
      this.oversizeByKind[kind] = (this.oversizeByKind[kind] ?? 0) + 1;
      return "oversize";
    }
    if (this.live >= this.slots.length) {
      this.fullRecordCount++;
      this.deferredByKind[kind] = (this.deferredByKind[kind] ?? 0) + 1;
      return "full";
    }
    if (maximumPayload > this.payload.capacity - this.payload.used) {
      this.fullByteCount++;
      this.deferredByKind[kind] = (this.deferredByKind[kind] ?? 0) + 1;
      return "full";
    }
    return "accepted";
  }

  push(kind: SysEventKind, timeNs: number, a: number, b: number, c: number, d: number,
    payload: Uint8Array | null = null, tail: Uint8Array | null = null): SysAdmitResult {
    const payloadLength = (payload?.length ?? 0) + (tail?.length ?? 0);
    const admission = this.admit(kind, payloadLength);
    if (admission !== "accepted") return admission;
    let payloadOffset = -1;
    if (payloadLength > 0) {
      payloadOffset = this.payload.alloc(payloadLength, 1);
      if (payloadOffset < 0) {
        this.fullByteCount++;
        return "full";
      }
      const target = this.payload.view(payloadOffset, payloadLength);
      if (payload !== null) target.set(payload, 0);
      if (tail !== null) target.set(tail, payload?.length ?? 0);
    }
    const slot = this.slots[(this.nextId - 1) & this.mask];
    if (slot === undefined) throw new RangeError("System queue slot is outside its capacity");
    slot.kind = kind;
    slot.timeNs = timeNs;
    slot.a = a;
    slot.b = b;
    slot.c = c;
    slot.d = d;
    slot.payloadOffset = payloadOffset;
    slot.payloadLength = payloadLength;
    this.nextId++;
    this.acceptedCount++;
    if (kind === SYS_QUIT) this.quit = true;
    if (this.live > this.peakRecordCount) this.peakRecordCount = this.live;
    if (this.payload.used > this.peakByteCount) this.peakByteCount = this.payload.used;
    return "accepted";
  }

  /** Admits one frame-time record; the frontend's only frame-duration input. */
  frame(timeNs: number): SysAdmitResult {
    return this.push(SYS_TIME, timeNs, 0, 0, 0, 0);
  }

  openCursor(): SysEventCursor {
    const cursor: SysEventCursor = { next: this.firstId };
    this.cursors.add(cursor);
    return cursor;
  }

  closeCursor(cursor: SysEventCursor): void { this.cursors.delete(cursor); }

  /** Returns the cursor's next borrowed slot without consuming it. */
  read(cursor: SysEventCursor): SysEventSlot | null {
    if (!this.cursors.has(cursor)) throw new RangeError("System cursor does not belong to this queue");
    if (cursor.next < this.firstId) throw new RangeError("System cursor was overtaken by retirement");
    if (cursor.next >= this.nextId) return null;
    return this.slots[(cursor.next - 1) & this.mask] ?? null;
  }

  /** Payload bytes stay valid until this record's consume, reset or destroy. */
  payloadOf(slot: SysEventSlot): Uint8Array {
    if (slot.payloadOffset < 0) return new Uint8Array(0);
    return this.payload.view(slot.payloadOffset, slot.payloadLength);
  }

  consume(cursor: SysEventCursor): void {
    if (this.read(cursor) === null) return;
    cursor.next++;
    this.consumedCount++;
    this.retire();
  }

  pending(kind: SysEventKind): boolean {
    for (let id = this.firstId; id < this.nextId; id++) {
      if (this.slots[(id - 1) & this.mask]?.kind === kind) return true;
    }
    return false;
  }

  quitRequested(): boolean { return this.quit; }
  latchQuit(): void { this.quit = true; }

  reset(): void {
    this.firstId = 1;
    this.nextId = 1;
    this.quit = false;
    this.payload.reset();
    for (const cursor of this.cursors) cursor.next = 1;
  }

  private retire(): void {
    if (this.cursors.size === 0) return;
    let minimum = this.nextId;
    for (const cursor of this.cursors) if (cursor.next < minimum) minimum = cursor.next;
    this.firstId = Math.max(this.firstId, minimum);
    if (this.live === 0) {
      this.payload.reset();
      if (this.firstId === this.nextId && this.nextId > 1) {
        this.firstId = 1;
        this.nextId = 1;
        for (const cursor of this.cursors) cursor.next = 1;
      }
    }
  }
}
