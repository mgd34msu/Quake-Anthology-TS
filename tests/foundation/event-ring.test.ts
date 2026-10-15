import { describe, expect, test } from "bun:test";
import {
  EventRing, SysEventQueue, SYS_KEY, SYS_PACKET, SYS_QUIT, SYS_TIME,
} from "../../src/foundation/index.ts";

describe("foundation event ring", () => {
  test("admission is ordered, bounded and never overwrites", () => {
    const ring = new EventRing<string>(4);
    expect(ring.append("a")).toBe(1);
    expect(ring.append("b")).toBe(2);
    expect(ring.append("c")).toBe(3);
    expect(ring.append("d")).toBe(4);
    expect(ring.append("e")).toBe(0);
    expect(ring.blocked).toBe(1);
    expect(ring.at(1)).toBe("a");
    expect(ring.at(5)).toBeNull();
    expect(ring.stats()).toMatchObject({ capacity: 4, live: 4, accepted: 4, blocked: 1 });
  });

  test("independent cursors retire only their common prefix", () => {
    const ring = new EventRing<number>(8);
    const slow = ring.openCursor();
    const fast = ring.openCursor();
    for (const value of [10, 20, 30]) ring.append(value);
    expect(ring.read(fast)).toBe(10);
    expect(ring.read(fast)).toBe(20);
    ring.retire();
    expect(ring.first).toBe(1);
    expect(ring.read(slow)).toBe(10);
    ring.retire();
    expect(ring.first).toBe(2);
    expect(ring.at(1)).toBeNull();
    const seen: number[] = [];
    expect(ring.drain(slow, (record) => { seen.push(record); })).toBe(2);
    expect(seen).toEqual([20, 30]);
    expect(ring.take(fast)).toEqual([30]);
    ring.retire();
    expect(ring.live).toBe(0);
    expect(ring.append(40)).toBe(4);
    ring.closeCursor(slow);
    ring.closeCursor(fast);
  });

  test("visitors defer records appended during the same drain", () => {
    const ring = new EventRing<number>(8);
    const cursor = ring.openCursor();
    ring.append(1);
    const seen: number[] = [];
    ring.drain(cursor, (record) => {
      seen.push(record);
      ring.append(2);
    });
    expect(seen).toEqual([1]);
    expect(ring.read(cursor)).toBe(2);
  });

  test("leases pin records beyond lookup retirement without copying", () => {
    const ring = new EventRing<{ readonly value: number }>(4);
    const cursor = ring.openCursor();
    const record = { value: 7 };
    const id = ring.append(record);
    ring.append({ value: 8 });
    expect(ring.retain(id)).toBe(true);
    expect(ring.take(cursor)).toHaveLength(2);
    ring.retire();
    expect(ring.at(id)).toBeNull();
    expect(ring.leasedRecord(id)).toBe(record);
    const retained: number[] = [];
    ring.visitRetained((leased) => { retained.push(leased.value); });
    expect(retained).toEqual([7]);
    expect(ring.releaseLease(id)).toBe(true);
    expect(ring.leasedRecord(id)).toBeNull();
    expect(ring.retain(999)).toBe(false);
  });

  test("batches admit all-or-nothing and reset rewinds cold state", () => {
    const ring = new EventRing<number>(4);
    const cursor = ring.openCursor();
    expect(ring.appendAll([1, 2, 3])).toBe(1);
    expect(ring.appendAll([4, 5])).toBe(0);
    expect(ring.live).toBe(3);
    expect(ring.appendAll([4])).toBe(4);
    ring.reset();
    expect(ring.live).toBe(0);
    expect(ring.pending(cursor)).toBe(0);
    expect(ring.append(9)).toBe(1);
    expect(ring.read(cursor)).toBe(9);
  });

  test("admit, prepend, someLive and drainAll preserve admission order", () => {
    const ring = new EventRing<number>(8);
    const cursor = ring.openCursor();
    ring.admitAll([3, 4]);
    expect(ring.someLive(value => value === 4)).toBe(true);
    expect(ring.someLive(value => value === 9)).toBe(false);
    ring.prepend([1, 2]);
    expect(ring.take(cursor)).toEqual([1, 2, 3, 4]);
    ring.retire();
    ring.admit(5);
    expect(() => ring.admitAll([6, 7, 8, 9, 10, 11, 12, 13])).toThrow(RangeError);
    expect(ring.drainAll()).toEqual([5]);
    expect(ring.live).toBe(0);
    ring.admit(6);
    expect(() => ring.read(cursor)).toThrow(RangeError);
    ring.closeCursor(cursor);
    const small = new EventRing<number>(2);
    small.admit(1);
    small.admit(2);
    expect(() => small.admit(3)).toThrow(RangeError);
  });

  test("an overtaken cursor fails loudly instead of skipping silently", () => {
    const ring = new EventRing<number>(4);
    const cursor = ring.openCursor();
    ring.append(1);
    ring.retireBefore(2);
    expect(() => ring.read(cursor)).toThrow(RangeError);
  });
});

describe("foundation system queue", () => {
  test("admission, payload custody and per-cursor retirement follow intake order", () => {
    const queue = new SysEventQueue(4, 64);
    const keys = queue.openCursor();
    const packets = queue.openCursor();
    expect(queue.admit(SYS_PACKET, 65)).toBe("oversize");
    expect(queue.oversize(SYS_PACKET)).toBe(1);
    expect(queue.frame(1_000_000)).toBe("accepted");
    expect(queue.push(SYS_PACKET, 2_000_000, 1, 2, 3, 4, new Uint8Array([9, 8, 7]))).toBe("accepted");
    expect(queue.push(SYS_KEY, 3_000_000, 32, 0, 1, 0)).toBe("accepted");
    const time = queue.read(keys);
    expect(time?.kind).toBe(SYS_TIME);
    queue.consume(keys);
    const packetForKeys = queue.read(keys);
    expect(packetForKeys?.kind).toBe(SYS_PACKET);
    queue.consume(keys);
    const key = queue.read(keys);
    expect(key?.kind).toBe(SYS_KEY);
    expect(key?.a).toBe(32);
    queue.consume(keys);
    const timeForPackets = queue.read(packets);
    expect(timeForPackets?.kind).toBe(SYS_TIME);
    queue.consume(packets);
    const packet = queue.read(packets);
    expect(packet === null ? [] : Array.from(queue.payloadOf(packet))).toEqual([9, 8, 7]);
    queue.consume(packets);
    queue.consume(packets);
    expect(queue.stats()).toMatchObject({ accepted: 3, consumed: 6, records: 0, bytes: 0 });
  });

  test("quit latches while records remain and full preserves accepted events", () => {
    const queue = new SysEventQueue(2, 16);
    const cursor = queue.openCursor();
    expect(queue.push(SYS_QUIT, 0, 0, 0, 0, 0)).toBe("accepted");
    expect(queue.quitRequested()).toBe(true);
    expect(queue.push(SYS_KEY, 0, 1, 0, 0, 0)).toBe("accepted");
    expect(queue.push(SYS_KEY, 0, 2, 0, 0, 0)).toBe("full");
    expect(queue.stats().fullRecords).toBe(1);
    expect(queue.read(cursor)?.kind).toBe(SYS_QUIT);
    queue.reset();
    expect(queue.quitRequested()).toBe(false);
    expect(queue.live).toBe(0);
  });
});
