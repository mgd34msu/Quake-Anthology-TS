import { expect, test } from 'bun:test';
import { encodeQ2ServerDemoFrame, encodeQ2ServerDemoSignon, readQ2ServerDemo } from '../../../src/network/q2/server-demo.ts';
import { writeQ2DemoRecord } from '../../../src/network/q2/demo.ts';
import { EntityStateT } from '../../../src/network/q2/state.ts';
import { gamestate, playback } from '../../support/mvd-fixtures.ts';
import { runMutations } from '../../support/mutation.ts';

test('seeded mutants of an MVD gamestate either play back or fail with a typed error', () => {
    const valid = gamestate();
    expect(playback().read(valid).length).toBeGreaterThan(0);
    for (const seed of [41, 42, 43]) {
        const report = runMutations(seed, 800, valid, bytes => playback().read(bytes));
        expect(report.foreign).toEqual([]);
        expect(report.rejected).toBeGreaterThan(0);
    }
});

test('seeded mutants of native server footage either replay or fail with a typed error', () => {
    const entity = new EntityStateT(); entity.number = 2; entity.modelindex = 1; entity.origin[0] = 42;
    const records = [encodeQ2ServerDemoSignon({ servercount: 7, gamedir: 'baseq2', configStrings: new Map([[0, 'fixture'], [33, 'maps/base1.bsp']]) }), encodeQ2ServerDemoFrame(12, [entity], [Uint8Array.of(10, 2, 111, 107, 0)])];
    const valid = Uint8Array.from(records.flatMap(message => [...writeQ2DemoRecord(message)]));
    expect([...readQ2ServerDemo(valid)]).toHaveLength(2);
    for (const seed of [51, 52]) {
        const report = runMutations(seed, 800, valid, bytes => [...readQ2ServerDemo(bytes)]);
        expect(report.foreign).toEqual([]);
        expect(report.rejected).toBeGreaterThan(0);
    }
});
