import { RereleaseQ2GuestHost } from "../../../../src/compat/q2/rerelease/host.ts";
import { expect, test } from 'bun:test';
import { available, nativeFixture } from './native.test.ts';
import type { GuestCallValue } from '../../../../src/contracts/execution.ts';
import type { RereleaseDebugShapesEvent } from '../../../../src/compat/q2/rerelease/debug-shapes.ts';
import { gameImports, gameImportLayout } from '../../../../src/compat/q2/rerelease/api.ts';
import type { GameImportName } from '../../../../src/compat/q2/rerelease/api.ts';
import { fieldOffset } from '../../../../src/compat/q2/rerelease/layouts.ts';
import { guestBool, guestPointer } from '../../../../src/compat/q2/rerelease/module.ts';
import { WorldDebugLineStore } from '../../../../src/debug/world.ts';

test.skipIf(!available || process.env['QUAKE_DEBUG_SHAPES_NATIVE'] !== '1')('initialized native guest debug imports reach the shared line owner through Microsoft x64 ABI', async () => {
  const events: RereleaseDebugShapesEvent[] = [], store = new WorldDebugLineStore();
  const { source, host, guest, memory } = await nativeFixture(undefined, false, () => [], undefined, event => { events.push(event); store.submit(event.lines, 1000, event.lifetimeMilliseconds); });
  try {
    host.preInit(); source.init();
    const start = memory.allocate({ byteLength: 12, alignment: 4n, label: 'debug start' }), end = memory.allocate({ byteLength: 12, alignment: 4n, label: 'debug end' });
    memory.writeFloat32(start, 32); memory.writeFloat32(end, 48);
    const color = memory.allocate({ byteLength: 4, alignment: 1n, label: 'debug RGBA' }), cap = memory.allocate({ byteLength: 4, alignment: 1n, label: 'debug cap RGBA' });
    memory.write(color, new Uint8Array([255, 128, 0, 64])); memory.write(cap, new Uint8Array([0, 64, 255, 128]));
    const f = (value: number): GuestCallValue => ({ kind: 'float32', value });
    const calls: readonly { readonly name: GameImportName; readonly args: readonly GuestCallValue[]; readonly count: number }[] = [
      { name: 'Draw_Line', args: [guestPointer(start), guestPointer(end), guestPointer(color), f(0.025), guestBool(true)], count: 1 },
      { name: 'Draw_Point', args: [guestPointer(start), f(8), guestPointer(color), f(0.025), guestBool(false)], count: 3 },
      { name: 'Draw_Circle', args: [guestPointer(start), f(8), guestPointer(color), f(0.025), guestBool(true)], count: 6 },
      { name: 'Draw_Bounds', args: [guestPointer(start), guestPointer(end), guestPointer(color), f(0.025), guestBool(false)], count: 12 },
      { name: 'Draw_Sphere', args: [guestPointer(start), f(8), guestPointer(color), f(0.025), guestBool(true)], count: 84 },
      { name: 'Draw_Cylinder', args: [guestPointer(start), f(3), f(8), guestPointer(color), f(0.025), guestBool(false)], count: 18 },
      { name: 'Draw_Ray', args: [guestPointer(start), guestPointer(end), f(2), f(3), guestPointer(color), f(0.025), guestBool(true)], count: 4 },
      { name: 'Draw_Arrow', args: [guestPointer(start), guestPointer(end), f(3), guestPointer(color), guestPointer(cap), f(0.025), guestBool(false)], count: 4 },
    ];
    for (const [index, call] of calls.entries()) {
      const address = memory.readPointer(memory.offset(guest.gameImportAddress, BigInt(fieldOffset(gameImportLayout, call.name)))), entry = gameImports.find(entry => entry.name === call.name);
      if (address === null || entry === undefined) throw new Error(`Missing native import ${call.name}`);
      expect(guest.invoke(address, entry.signature, call.args)).toEqual({ kind: 'void' });
      expect(events[index]?.lines).toHaveLength(call.count); expect(events[index]?.lifetimeMilliseconds).toBe(25);
      expect(events[index]?.lines[0]?.depthTest).toBe(index % 2 === 0);
    }
    expect(events[0]?.lines[0]?.color).toEqual({ x: 1, y: 128 / 255, z: 0, w: 64 / 255 });
    expect(events[7]?.lines[1]?.color).toEqual({ x: 0, y: 64 / 255, z: 1, w: 128 / 255 });
    expect(events[6]?.lines[1]?.end.x).toBe(128);
    memory.writeFloat32(start, 0);
    expect(store.snapshot(1000, 1)[0]?.start.x).toBe(32);
    expect(store.snapshot(1024, 2)).toHaveLength(132); expect(store.snapshot(1025, 3)).toHaveLength(0);
  } finally { source.close(); }
}, 60000);

test.skipIf(!available || process.env['QUAKE_DEBUG_SHAPES_NATIVE'] !== '1')('initialized headless native guest accepts ten drawing imports while missing graphical bindings remain errors', async () => {
  const { source, host, guest, memory, releaseListeners } = await nativeFixture(undefined, false, () => [], undefined, undefined, 'headless');
  try {
    host.preInit(); source.init();
    const drawing = gameImports.filter(entry => entry.name.startsWith('Draw_'));
    expect(drawing).toHaveLength(10);
    for (const entry of drawing) {
      const address = memory.readPointer(memory.offset(guest.gameImportAddress, BigInt(fieldOffset(gameImportLayout, entry.name))));
      if (address === null) throw new Error(`Missing native import ${entry.name}`);
      const args: GuestCallValue[] = entry.signature.parameters.map(parameter => {
        if (parameter.kind !== 'scalar') throw new Error('Drawing import unexpectedly uses an aggregate');
        if (parameter.storage === 'pointer') return guestPointer(null);
        if (parameter.storage === 'float32') return { kind: 'float32', value: Number.NaN };
        if (parameter.storage === 'uint8') return guestBool(false);
        throw new Error('Unexpected drawing scalar');
      });
      expect(guest.invoke(address, entry.signature, args)).toEqual({ kind: 'void' });
    }
    const mappings = memory.mappings(), listeners = releaseListeners.active;
    expect(() => new RereleaseQ2GuestHost({ ...host.options, debugShapes: () => undefined })).toThrow('cannot bind renderer callbacks');
    expect(() => new RereleaseQ2GuestHost({ ...host.options, worldText: () => undefined })).toThrow('cannot bind renderer callbacks');
    expect(memory.mappings()).toEqual(mappings); expect(releaseListeners.active).toBe(listeners);
    const graphicalFixture = await nativeFixture(), graphical = graphicalFixture.host;
    try {
      graphical.preInit(); graphicalFixture.source.init();
      for (const name of ['Draw_Line', 'Draw_StaticWorldText']) {
        const entry = gameImports.find(entry => entry.name === name);
        if (entry === undefined) throw new Error('Missing graphical import definition');
        const address = graphicalFixture.memory.readPointer(graphicalFixture.memory.offset(graphical.module.gameImportAddress, BigInt(fieldOffset(gameImportLayout, name))));
        if (address === null) throw new Error('Missing graphical import address');
        const args: GuestCallValue[] = entry.signature.parameters.map(parameter => {
          if (parameter.kind === 'scalar' && parameter.storage === 'pointer') return guestPointer(null);
          if (parameter.kind === 'scalar' && parameter.storage === 'float32') return { kind: 'float32', value: 0 };
          return guestBool(false);
        });
        expect(() => graphical.module.invoke(address, entry.signature, args)).toThrow('Missing Q2 rerelease game import');
      }
    } finally { graphicalFixture.source.close(); }
  } finally { source.close(); }
}, 60000);
