import { describe, expect, test } from "bun:test";
import {
  BoundedQueue, ByteArena, CleanupStack, FixedPool, IdIndex, StampSet, STRING_NONE, StringTable,
  NAME_MONSTER, NAME_Q1_AMMO, NAME_TEAM_RED_ALIAS, NAME_TEAM_RED_EXACT,
  float32Bits, float32FromBits, loadF32LE, loadI32LE, loadU32LE, storeF32LE, storeU32LE,
  INVALID_ACTOR_KEY, actorKeyGeneration, actorKeyOf, actorKeySlot, packActorKey,
  boundsOverlap, boundsSet, createBoundsStore, createVec3Store,
  vec3AngleVectors, vec3Cross, vec3Dot, vec3MA, vec3Normalize, vec3Set,
} from "../../src/foundation/index.ts";
import {
  add3, add3Into, angleVectors, angleVectorsInto, anglesToAxis, anglesToAxisInto,
  cross3, cross3Into, dot3, lerp3, lerp3Into, lookAtMat4, mutableVec3,
  normalize3, normalize3Into, normalize3OrZero, normalize3OrZeroInto,
  perpendicularVector, perpendicularVectorInto, planeFromPoints,
  projectPointOnPlane, projectPointOnPlaneInto, radiusFromBounds,
  rotatePointAroundVector, rotatePointAroundVectorInto, scale3, scale3Into,
  sub3, sub3Into, vec3,
} from "../../src/core/math.ts";
import { bitsToFloat32, float32ToBits } from "../../src/core/numeric.ts";

function samples(count: number): number[] {
  const out: number[] = [];
  let seed = 22222;
  for (let index = 0; index < count; index++) {
    seed = (Math.imul(seed, 69069) + 1) | 0;
    out.push(((seed & 0xffff) / 0x10000 - 0.5) * 2000);
  }
  return out;
}

describe("foundation binary", () => {
  test("scratch reinterpretation matches the allocating conversions", () => {
    const values = [0, -0, 1, -1, 0.5, -273.15, 1e-40, 3.4028235e38, Infinity, -Infinity, ...samples(64)];
    for (const value of values) {
      expect(float32Bits(value)).toBe(float32ToBits(value));
      expect(float32FromBits(float32Bits(value))).toBe(bitsToFloat32(float32ToBits(value)));
    }
    expect(float32Bits(NaN) >>> 0).toBe(float32ToBits(NaN) >>> 0);
  });

  test("little-endian loads and stores use caller bytes only", () => {
    const bytes = new Uint8Array(8);
    storeU32LE(bytes, 0, 0xdeadbeef);
    storeF32LE(bytes, 4, 1.5);
    expect(loadU32LE(bytes, 0)).toBe(0xdeadbeef);
    expect(loadI32LE(bytes, 0)).toBe(0xdeadbeef | 0);
    expect(loadF32LE(bytes, 4)).toBe(1.5);
    expect(() => loadU32LE(bytes, 6)).toThrow(RangeError);
  });
});

describe("foundation stamp set", () => {
  test("begin is an O(1) clear and mark reports first visits", () => {
    const stamps = new StampSet(4);
    expect(stamps.mark(2)).toBe(true);
    expect(stamps.mark(2)).toBe(false);
    expect(stamps.test(2)).toBe(true);
    expect(stamps.test(1)).toBe(false);
    stamps.begin();
    expect(stamps.test(2)).toBe(false);
    expect(stamps.mark(2)).toBe(true);
    const saved = stamps.value(2);
    stamps.begin();
    stamps.restoreMark(2, saved);
    expect(stamps.test(2)).toBe(false);
  });
});

describe("foundation strings", () => {
  test("interned identities are stable integers classified at admission", () => {
    const strings = new StringTable();
    const monster = strings.intern("monster_demon1");
    expect(strings.intern("monster_demon1")).toBe(monster);
    expect(strings.find("absent")).toBe(STRING_NONE);
    expect(strings.text(monster)).toBe("monster_demon1");
    expect(strings.nameFlags(monster) & NAME_MONSTER).toBe(NAME_MONSTER);
    expect(strings.nameFlags(strings.intern("q1:ammo/shells")) & NAME_Q1_AMMO).toBe(NAME_Q1_AMMO);
    const red = strings.intern("red");
    expect(strings.nameFlags(red) & (NAME_TEAM_RED_ALIAS | NAME_TEAM_RED_EXACT)).toBe(NAME_TEAM_RED_ALIAS | NAME_TEAM_RED_EXACT);
    const bound = strings.bindNames(["alpha", "beta", "alpha"]);
    expect(bound[0]).toBe(bound[2]);
    expect(bound[0]).not.toBe(bound[1]);
    expect(strings.count).toBe(5);
  });
});

describe("foundation arena and pool", () => {
  test("arena bumps with alignment, counts exhaustion and reuses on reset", () => {
    const arena = new ByteArena(16);
    expect(arena.alloc(3, 1)).toBe(0);
    expect(arena.alloc(4, 4)).toBe(4);
    expect(arena.alloc(100, 1)).toBe(-1);
    expect(arena.overflowCount).toBe(1);
    const offset = arena.allocCopy(new Uint8Array([7, 8]), 1);
    expect(Array.from(arena.view(offset, 2))).toEqual([7, 8]);
    arena.reset();
    expect(arena.used).toBe(0);
    expect(arena.alloc(16, 1)).toBe(0);
  });

  test("pool leases are O(1) slots that never allocate after construction", () => {
    const pool = new FixedPool(2, (slot) => ({ slot, value: 0 }));
    const first = pool.takeSlot();
    const second = pool.takeSlot();
    expect(pool.takeSlot()).toBe(-1);
    expect(pool.overflowCount).toBe(1);
    expect(pool.at(first).slot).toBe(first);
    pool.release(first);
    expect(() => pool.release(first)).toThrow(RangeError);
    expect(pool.takeSlot()).toBe(first);
    expect(pool.peak).toBe(2);
    pool.reset();
    expect(pool.active).toBe(0);
    expect(pool.isLeased(second)).toBe(false);
  });
});

describe("foundation bounded queue", () => {
  test("drop-oldest retention, removal and slot replacement preserve order", () => {
    const queue = new BoundedQueue<number>(4);
    for (const value of [1, 2, 3, 4, 5]) queue.push(value);
    expect(queue.toArray()).toEqual([2, 3, 4, 5]);
    expect(queue.dropped).toBe(1);
    expect(queue.peekOldest()).toBe(2);
    expect(queue.peekNewest()).toBe(5);
    expect(queue.shift()).toBe(2);
    expect(queue.removeFirst(value => value === 4)).toBe(true);
    expect(queue.toArray()).toEqual([3, 5]);
    queue.push(6);
    queue.push(7);
    queue.retain(value => value % 2 === 1);
    expect(queue.toArray()).toEqual([3, 5, 7]);
    expect(queue.findIndex(value => value === 5)).toBe(1);
    queue.setAt(0, 30);
    queue.setAt(queue.length, 9);
    expect(queue.toArray()).toEqual([30, 5, 7, 9]);
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.shift()).toBeUndefined();
    const small = new BoundedQueue<number>(3);
    for (const value of [1, 2, 3, 4]) small.push(value);
    expect(small.toArray()).toEqual([2, 3, 4]);
    expect(() => new BoundedQueue(0)).toThrow(RangeError);
  });
});

describe("foundation cleanup stack", () => {
  test("runs snapshot entries in order and in reverse, deferring late additions", () => {
    const stack = new CleanupStack();
    const order: string[] = [];
    stack.add(() => { order.push("a"); }, () => { order.push("b"); stack.add(() => { order.push("late"); }); });
    stack.runAll();
    expect(order).toEqual(["a", "b"]);
    expect(stack.length).toBe(1);
    stack.runReverse();
    expect(order).toEqual(["a", "b", "late"]);
    stack.push(() => { order.push("x"); }, () => { order.push("y"); });
    stack.runReverse();
    expect(order).toEqual(["a", "b", "late", "y", "x"]);
    expect(stack.length).toBe(0);
  });
});

describe("foundation handles and id index", () => {
  test("packed actor keys round-trip within safe ranges", () => {
    const key = packActorKey(495, 7);
    expect(actorKeySlot(key)).toBe(495);
    expect(actorKeyGeneration(key)).toBe(7);
    expect(actorKeyOf({ slot: 1, generation: 0 })).toBe(1);
    expect(actorKeySlot(INVALID_ACTOR_KEY)).toBe(-1);
    expect(() => packActorKey(2 ** 20, 0)).toThrow(RangeError);
  });

  test("id index resolves duplicates in reverse admission order", () => {
    const index = new IdIndex();
    index.reserve(3);
    index.insert(10, 1, 100);
    index.insert(10, 1, 101);
    index.insert(10, 2, 102);
    expect(() => index.insert(1, 1, 1)).toThrow(RangeError);
    expect(index.find(10, 1)).toBe(101);
    expect(index.find(10, 3)).toBe(-1);
    const cursor = index.begin(10, 1);
    expect([index.next(cursor), index.next(cursor), index.next(cursor)]).toEqual([101, 100, -1]);
    expect(index.removeValue(10, 1, 101)).toBe(true);
    expect(index.find(10, 1)).toBe(100);
    expect(index.remove(10, 1)).toBe(true);
    expect(index.find(10, 2)).toBe(102);
  });

  test("id index keeps reverse admission order across growth", () => {
    const index = new IdIndex();
    const put = (a: number, b: number, value: number): void => { index.reserve(1); index.insert(a, b, value); };
    put(10, 1, 100);
    put(10, 1, 101);
    for (let offset = 0; offset < 500; offset++) put(1000 + offset, 1, 2000 + offset);
    put(10, 1, 102);
    expect(index.find(10, 1)).toBe(102);
    const cursor = index.begin(10, 1);
    expect([index.next(cursor), index.next(cursor), index.next(cursor), index.next(cursor)]).toEqual([102, 101, 100, -1]);
  });
});

describe("foundation vector store", () => {
  test("store math matches object math exactly on sampled values", () => {
    const values = samples(3 * 40);
    const store = createVec3Store(8);
    for (let index = 0; index < 40; index++) {
      const ax = values[index * 3] ?? 0;
      const ay = values[index * 3 + 1] ?? 0;
      const az = values[index * 3 + 2] ?? 0;
      const bx = values[(index * 3 + 7) % values.length] ?? 0;
      const by = values[(index * 3 + 8) % values.length] ?? 0;
      const bz = values[(index * 3 + 9) % values.length] ?? 0;
      const a = vec3(ax, ay, az);
      const b = vec3(bx, by, bz);
      vec3Set(store, 0, ax, ay, az);
      vec3Set(store, 1, bx, by, bz);
      expect(vec3Dot(store, 0, 1)).toBe(dot3(a, b));
      vec3Cross(store, 2, 0, 1);
      const crossed = cross3(a, b);
      expect([store[6], store[7], store[8]]).toEqual([crossed.x, crossed.y, crossed.z]);
      vec3MA(store, 3, 0, 0.25, 1);
      expect([store[9], store[10], store[11]]).toEqual([
        Math.fround(a.x + Math.fround(0.25) * b.x),
        Math.fround(a.y + Math.fround(0.25) * b.y),
        Math.fround(a.z + Math.fround(0.25) * b.z),
      ]);
      vec3Normalize(store, 4, 0);
      const normalized = normalize3(a);
      expect([store[12], store[13], store[14]]).toEqual([normalized.x, normalized.y, normalized.z]);
    }
  });

  test("store angle vectors and bounds match the object forms", () => {
    const store = createVec3Store(8);
    vec3Set(store, 0, 15, 40, -70);
    vec3AngleVectors(store, 1, 2, 3, 0);
    const expected = angleVectors(vec3(15, 40, -70));
    expect([store[3], store[4], store[5]]).toEqual([expected.forward.x, expected.forward.y, expected.forward.z]);
    expect([store[6], store[7], store[8]]).toEqual([expected.right.x, expected.right.y, expected.right.z]);
    expect([store[9], store[10], store[11]]).toEqual([expected.up.x, expected.up.y, expected.up.z]);
    const bounds = createBoundsStore(2);
    boundsSet(bounds, 0, 0, 0, 0, 10, 10, 10);
    boundsSet(bounds, 1, 10, 20, 0, 30, 30, 30);
    expect(boundsOverlap(bounds, 0, 1)).toBe(false);
    boundsSet(bounds, 1, 10, 5, 0, 30, 30, 30);
    expect(boundsOverlap(bounds, 0, 1)).toBe(true);
    vec3Set(store, 0, -0, 0, 0);
    vec3Normalize(store, 1, 0);
    expect(float32Bits(store[3] ?? 0)).toBe(0x80000000);
  });
});

function xyz(value: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number; z: number } {
  return { x: value.x, y: value.y, z: value.z };
}

describe("out-parameter math", () => {
  test("Into forms match allocating forms on sampled and degenerate inputs", () => {
    const values = samples(3 * 24);
    const inputs = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(-0, 0, 0)];
    for (let index = 0; index < 24; index++) {
      inputs.push(vec3(values[index * 3] ?? 0, values[index * 3 + 1] ?? 0, values[index * 3 + 2] ?? 0));
    }
    const out = mutableVec3();
    const second = mutableVec3();
    const third = mutableVec3();
    for (const a of inputs) {
      for (const b of [inputs[1] ?? a, inputs[3] ?? a, inputs[inputs.length - 1] ?? a]) {
        add3Into(out, a, b);
        expect(xyz(out)).toEqual(add3(a, b));
        sub3Into(out, a, b);
        expect(xyz(out)).toEqual(sub3(a, b));
        scale3Into(out, a, 1.75);
        expect(xyz(out)).toEqual(scale3(a, 1.75));
        cross3Into(out, a, b);
        expect(xyz(out)).toEqual(cross3(a, b));
        lerp3Into(out, a, b, 0.3);
        expect(xyz(out)).toEqual(lerp3(a, b, 0.3));
        projectPointOnPlaneInto(out, a, vec3(0.3, 0.5, 0.8));
        expect(xyz(out)).toEqual(projectPointOnPlane(a, vec3(0.3, 0.5, 0.8)));
      }
      expect(normalize3Into(out, a)).toBeGreaterThanOrEqual(0);
      expect(xyz(out)).toEqual(normalize3(a));
      normalize3OrZeroInto(out, a);
      expect(xyz(out)).toEqual(normalize3OrZero(a));
      angleVectorsInto(out, second, third, a);
      const angles = angleVectors(a);
      expect(xyz(out)).toEqual(angles.forward);
      expect(xyz(second)).toEqual(angles.right);
      expect(xyz(third)).toEqual(angles.up);
      anglesToAxisInto(out, second, third, a);
      const axis = anglesToAxis(a);
      expect([xyz(out), xyz(second), xyz(third)]).toEqual([axis[0], axis[1], axis[2]]);
      const unit = normalize3OrZero(vec3(a.x === 0 && a.y === 0 && a.z === 0 ? 1 : a.x, a.y, a.z));
      perpendicularVectorInto(out, unit);
      expect(xyz(out)).toEqual(perpendicularVector(unit));
      rotatePointAroundVectorInto(out, unit, vec3(3, -2, 5), 37);
      expect(xyz(out)).toEqual(rotatePointAroundVector(unit, vec3(3, -2, 5), 37));
    }
    expect(lookAtMat4(vec3(1, 2, 3), vec3(4, 5, 6), vec3(0, 0, 1))).toHaveLength(16);
    expect(planeFromPoints(vec3(0, 0, 0), vec3(0, 1, 0), vec3(1, 0, 0)))
      .toEqual({ normal: vec3(0, 0, 1), distance: 0 });
    expect(planeFromPoints(vec3(1, 1, 1), vec3(1, 1, 1), vec3(1, 1, 1))).toBeNull();
    expect(radiusFromBounds({ min: vec3(-3, -4, 0), max: vec3(0, 0, 0) })).toBe(5);
    // Aliased output snapshots its inputs first.
    const aliased = mutableVec3(1, 2, 3);
    cross3Into(aliased, aliased, vec3(4, 5, 6));
    expect(xyz(aliased)).toEqual(cross3(vec3(1, 2, 3), vec3(4, 5, 6)));
  });
});
