import { expect, test } from 'bun:test';
import { QvmGameData } from '../../../src/compat/qvm/game-data.ts';
import { QvmMemory } from '../../../src/compat/qvm/memory.ts';

test('player ping borrows the located public int32 field and validates client slots', () => {
  const memory = new QvmMemory(new Uint8Array(16384)), data = new QvmGameData(memory);
  expect(() => data.playerPing(0)).toThrow();
  data.setClientCount(2);
  data.locate(64, 3, 700, 4096, 600);
  memory.bytes.fill(0xa5, 4096, 5296);
  memory.view(4096 + 600 + 452, 4).setInt32(0, -123456789, true);
  expect(data.playerPing(1)).toBe(-123456789);
  data.setPlayerPing(1, 87);
  expect(data.playerPing(1)).toBe(87);
  expect(memory.view(4096 + 600 + 448, 4).getUint32(0, true)).toBe(0xa5a5a5a5);
  expect(memory.view(4096 + 600 + 456, 4).getUint32(0, true)).toBe(0xa5a5a5a5);
  for (const slot of [-1, 0.5, 2, 64]) expect(() => data.playerPing(slot)).toThrow();
  data.setClientCount(64);
  expect(() => data.playerPing(21)).toThrow('allocation');
});

test('located guest spans reject invalid strides, indexes, pointers and wire capacity before borrowing', () => {
  const memory = new QvmMemory(new Uint8Array(16384)), data = new QvmGameData(memory);
  data.setClientCount(2);
  data.locate(64, 3, 700, 4096, 600);
  const before = data.checkpoint();
  const invalid: readonly (readonly [number, number, number, number, number])[] = [
    [64, -1, 700, 4096, 600], [64, 1025, 700, 4096, 600], [64, 3, 512, 4096, 600],
    [64, 3, 702, 4096, 600], [66, 3, 700, 4096, 600], [64, 3, 700, 4098, 600],
    [64, 3, 700, 4096, 464], [0, 3, 700, 4096, 600], [64, 3, 700, 0, 600],
    [15000, 3, 700, 4096, 600], [64, 3, 700, 16000, 600],
  ];
  for (const words of invalid) { expect(() => data.locate(...words)).toThrow(); expect(data.checkpoint()).toEqual(before); }
  for (const slot of [-1, 0.5, 3, 1023]) expect(() => data.entity(slot)).toThrow();
  for (const pointer of [0, 60, 65, 68, 64 + 3 * 700]) {
    expect(() => data.numberFromPointer(pointer)).toThrow();
    expect(() => data.entityFromPointer(pointer)).toThrow();
  }
  expect(data.numberFromPointer(764)).toBe(1);
  expect(data.entityFromPointer(764)).toBe(data.entity(1));
  // The VM masks pointer starts. The located record still must be aligned and in range.
  expect(data.numberFromPointer(16384 + 764)).toBe(1);
  for (const slot of [-1, 2, 64]) expect(() => data.copyPlayerState(slot)).toThrow();
  data.setClientCount(64);
  expect(() => data.copyPlayerState(21)).toThrow('allocation');
});

test('relocation preserves old raw aliases while fresh entity and player access follows current descriptors', () => {
  const memory = new QvmMemory(new Uint8Array(16384)), data = new QvmGameData(memory);
  const unlocated = data.checkpoint();
  data.locate(64, 2, 700, 4096, 600);
  const old = data.entity(1);
  old.r.currentOrigin = { x: 1, y: 2, z: 3 };
  data.entityBytes(1).setInt32(650, 0x12345678, true);
  data.setPlayerPing(1, 41);
  expect(data.copyPlayerState(1).pingMilliseconds).toBe(41);
  data.locate(8192, 2, 800, 12000, 700);
  expect(data.entity(1).r.currentOrigin.x).toBe(0);
  old.r.currentOrigin = { x: 7, y: 8, z: 9 };
  expect(memory.view(64 + 700 + 488, 12).getFloat32(0, true)).toBe(7);
  expect(memory.view(64 + 700 + 650, 4).getInt32(0, true)).toBe(0x12345678);
  expect(data.copyPlayerState(1).pingMilliseconds).toBe(0);
  data.restore(unlocated);
  expect(data.numEntities).toBe(0);
  expect(() => data.entity(0)).toThrow();
  expect(() => data.copyPlayerState(0)).toThrow();
});
