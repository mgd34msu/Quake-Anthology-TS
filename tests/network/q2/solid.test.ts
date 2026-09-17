import { expect, test } from 'bun:test';
import { packQ2Solid, q2SolidEncoding, unpackQ2Solid } from '../../../src/network/q2/solid.ts';

test('Q2 negotiated solid packing retains native quantization and asymmetric extended bounds', () => {
    const bounds = { min: { x: -16, y: -24, z: -24 }, max: { x: 16, y: 24, z: 32 } };
    expect(packQ2Solid(bounds, 'short')).toBe(8290);
    expect(packQ2Solid(bounds, 'r1q2')).toBe(0x80201810);
    expect(packQ2Solid(bounds, 'q2pro-v2')).toBe(0x40181810);
    expect(unpackQ2Solid(0x40181810, 'q2pro-v2')).toEqual(bounds);
    expect(unpackQ2Solid(0x80201810, 'r1q2')).toEqual({ min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    expect(unpackQ2Solid(8290, 'short')).toEqual({ min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    expect(unpackQ2Solid(packQ2Solid({ min: { x: -900, y: -800, z: -300 }, max: { x: 900, y: 800, z: -100 } }, 'q2pro-v2'), 'q2pro-v2'))
        .toEqual({ min: { x: -255, y: -255, z: -255 }, max: { x: 255, y: 255, z: -32 } });
});

test('wire revision and announced Q2Pro game API select the actual native solid format', () => {
    expect(q2SolidEncoding({ kind: 'q2-classic', version: 34 })).toBe('short');
    expect(q2SolidEncoding({ kind: 'q2-r1q2', version: 35, revision: 1904 })).toBe('short');
    expect(q2SolidEncoding({ kind: 'q2-r1q2', version: 35, revision: 1905 })).toBe('r1q2');
    expect(q2SolidEncoding({ kind: 'q2-q2pro', version: 36, revision: 1026 })).toBe('r1q2');
    expect(q2SolidEncoding({ kind: 'q2-q2pro', version: 36, revision: 1026 }, true)).toBe('q2pro-v2');
    expect(q2SolidEncoding({ kind: 'q2-private-classic', version: 4038 })).toBe('q2pro-v2');
    expect(q2SolidEncoding({ kind: 'q2-rerelease', version: 1038 })).toBe('q2pro-v2');
});
