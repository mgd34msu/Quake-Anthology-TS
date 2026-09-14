import { expect, test } from 'bun:test';
import { debugShapeLines } from '../../src/debug/shapes.ts';
import { WorldDebugLineStore } from '../../src/debug/world.ts';
import { RereleaseDebugShapeImports, rereleaseDebugLifetime } from '../../src/compat/q2/rerelease/debug-shapes.ts';
import type { RereleaseDebugShapesEvent } from '../../src/compat/q2/rerelease/debug-shapes.ts';
import { SparseGuestMemory } from '../../src/guest/core/index.ts';
import { createContentDigest } from '../../src/contracts/content.ts';
import { prepareDebugShapes } from '../../src/render/scene/debug-shapes.ts';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { anglesToAxis } from '../../src/core/math.ts';
import { perspectiveProjection } from '../../src/render/scene/view.ts';
import { SceneImageRegistry, rgbaImage } from '../../src/render/scene/resources.ts';
import { SoftwareRenderer } from '../../src/render/cpu/rasterizer.ts';
const origin = { x: 32, y: 0, z: 0 }, color = { x: 1, y: 0, z: 0, w: 0.5 };

test('source topology: point world size, cylinder half-height, bounded circle and sphere subdivisions', () => {
  const point = debugShapeLines({ kind: 'point', origin, size: 8 }, color, true);
  expect(point).toHaveLength(3); expect(point[0]?.start.x).toBe(28); expect(point[0]?.end.x).toBe(36);
  const cylinder = debugShapeLines({ kind: 'cylinder', origin, halfHeight: 3, radius: 8 }, color, true);
  expect(cylinder).toHaveLength(18); expect(cylinder[2]?.start.z).toBe(-3); expect(cylinder[2]?.end.z).toBe(3);
  expect(debugShapeLines({ kind: 'bounds', min: origin, max: { x: 40, y: 8, z: 8 } }, color, true)).toHaveLength(12);
  expect(debugShapeLines({ kind: 'circle', origin, radius: 10000 }, color, true)).toHaveLength(16);
  expect(debugShapeLines({ kind: 'sphere', origin, radius: 0 }, color, true)).toHaveLength(84);
  expect(debugShapeLines({ kind: 'sphere', origin, radius: 10000 }, color, true)).toHaveLength(608);
});
test('ray scales raw direction; arrow retains separate cap color and short-arrow source endpoint', () => {
  const ray = debugShapeLines({ kind: 'ray', origin, direction: { x: 2, y: 0, z: 0 }, length: 10, size: 2 }, color, false);
  expect(ray).toHaveLength(4); expect(ray[1]?.end.x).toBe(52);
  const capColor = { x: 0, y: 1, z: 0, w: 1 };
  const arrow = debugShapeLines({ kind: 'arrow', start: origin, end: { x: 42, y: 0, z: 0 }, size: 2, capColor }, color, true);
  expect(arrow[0]?.color).toEqual(color); expect(arrow.slice(1).every(line => line.color === capColor)).toBe(true);
  const short = debugShapeLines({ kind: 'arrow', start: origin, end: { x: 33, y: 0, z: 0 }, size: 2, capColor }, color, true);
  expect(short).toHaveLength(3); expect(short[0]?.start.x).toBe(33); expect(short[0]?.end.x).toBe(34);
});
test('unsigned source lifetime, immutable world ownership, both seats, expiry, capacity and teardown', () => {
  expect(rereleaseDebugLifetime(-1)).toBe(4294966296); expect(rereleaseDebugLifetime(0.0001)).toBe(0);
  const store = new WorldDebugLineStore(3), mutable = { x: 32, y: 0, z: 0 };
  const line = { start: mutable, end: origin, color, depthTest: false };
  store.submit([line], 1000, 25); mutable.x = 0;
  expect(store.snapshot(1000, 1)[0]?.start.x).toBe(32);
  expect(store.snapshot(1024, 2)).toHaveLength(1); expect(store.snapshot(1025, 3)).toHaveLength(0);
  store.submit([line], 1100, 0); expect(store.snapshot(1100, 4)).toHaveLength(1); expect(store.snapshot(1100, 4)).toHaveLength(1); expect(store.snapshot(1100, 5)).toHaveLength(0);
  store.submit([line, line, line, line], 1200, 100); expect(store.snapshot(1200, 6)).toHaveLength(3);
  store.clear(); expect(store.snapshot(1200, 6)).toHaveLength(0);
});
test('native uint32 clocks and deadlines wrap, and deadline zero lasts one presentation frame', () => {
  const store = new WorldDebugLineStore(), line = { start: origin, end: origin, color, depthTest: false };
  store.submit([line], 2000, rereleaseDebugLifetime(-1));
  expect(store.snapshot(2000, 1)).toHaveLength(0);
  store.submit([line], 0xfffffff0, 32);
  expect(store.snapshot(0xfffffff0, 2)).toHaveLength(0);
  store.submit([line], 0x100000000 + 100, 25);
  expect(store.snapshot(0x100000000 + 124, 3)).toHaveLength(1);
  expect(store.snapshot(0x100000000 + 125, 4)).toHaveLength(0);
  store.submit([line], 0xfffffff0, 16);
  expect(store.snapshot(0xfffffff0, 5)).toHaveLength(1);
  expect(store.snapshot(0xfffffff0, 5)).toHaveLength(1);
  expect(store.snapshot(0xfffffff0, 6)).toHaveLength(0);
});
test('guest decoder copies pointer geometry and RGBA bytes into common lines', () => {
  const memory = new SparseGuestMemory({ module: { id: 'test:debug', artifactPath: 'debug-fixture', revision: '1', digest: createContentDigest('12'.repeat(32)) }, pointerBytes: 8 });
  const vector = memory.allocate({ byteLength: 12, alignment: 4n, label: 'origin' });
  memory.writeFloat32(vector, 32);
  const rgba = memory.allocate({ byteLength: 4, alignment: 1n, label: 'color' }); memory.write(rgba, new Uint8Array([255, 128, 0, 64]));
  const events: RereleaseDebugShapesEvent[] = [], imports = new RereleaseDebugShapeImports(memory, event => events.push(event));
  expect(imports.invoke({ api: 'game', name: 'Draw_Point', context: { module: memory.module, callback: { kind: 'typescript', provider: 'test:debug', callback: 'test:entry' }, self: null, other: null, parent: null }, arguments: [{ kind: 'pointer', value: vector }, { kind: 'float32', value: 8 }, { kind: 'pointer', value: rgba }, { kind: 'float32', value: 0.025 }, { kind: 'uint32', value: 1 }] })).toEqual({ kind: 'void' });
  memory.writeFloat32(vector, 0);
  expect(events[0]?.lifetimeMilliseconds).toBe(25); expect(events[0]?.lines).toHaveLength(3);
  expect(events[0]?.lines[0]?.start.x).toBe(28); expect(events[0]?.lines[0]?.color).toEqual({ x: 1, y: 128 / 255, z: 0, w: 64 / 255 });
});
test('shared CPU line batches blend alpha, honor depth test, preserve depth and width', () => {
  const owner = { identity: Symbol('debug'), session: createIdentityOwner('debug').session, generation: 0 };
  const images = new SceneImageRegistry(owner), white = images.register('white', rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255,255,255,255]) }), { wrap: 'clamp', filter: 'nearest' });
  const camera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }), projection: perspectiveProjection(90,90,1024), viewport: { x: 0, y: 0, width: 64, height: 64 }, clip: { kind: 'none' } } satisfies Parameters<typeof prepareDebugShapes>[1];
  const renderer = new SoftwareRenderer(64,64,owner); for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
  const draw = (depth: number, depthTest: boolean): Uint8Array => {
    renderer.beginView({ viewport: camera.viewport, clipPlane: null, clear: { depth, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
    const lines = debugShapeLines({ kind: 'line', start: { x: 32, y: -8, z: 0 }, end: { x: 32, y: 8, z: 0 } }, color, depthTest);
    const batches = prepareDebugShapes(lines,camera,white); expect(batches[0]?.state.depthWrite).toBe(false);
    for (const batch of batches) { expect(batch.primitive).toBe('lines'); if (batch.primitive === 'lines') expect(batch.lineWidth).toBe(2); renderer.draw(batch); }
    return renderer.pixels.slice();
  };
  expect(draw(0,true).some((value,index) => index % 4 === 0 && value > 0)).toBe(false);
  expect(draw(0,false).some((value,index) => index % 4 === 0 && value >= 127 && value <= 128)).toBe(true);
  expect(draw(1,true).some((value,index) => index % 4 === 0 && value > 0)).toBe(true);
});
