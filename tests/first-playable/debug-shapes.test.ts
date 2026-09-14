import { WorldSeatPresentation } from "../../src/app/bootstrap/presentation.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { add3, anglesToAxis, scale3 } from '../../src/core/math.ts';
import type { DebugShape } from '../../src/debug/shapes.ts';
import { encodePng } from '../../src/formats/images/png.ts';

for (const backend of ['cpu', 'gl']) test.skipIf(process.env['QUAKE_DEBUG_SHAPES_APP'] !== '1')(`typed rerelease debug calls reach both ${backend} seats, expire by presentation frame, and retire with the world`, async () => {
  const userRoot = await mkdtemp(join(tmpdir(), 'debug-shapes-app-'));
  const command = parseApplicationCommand(['--game', 'q2-rerelease-baseq2', '--map', 'base1', '--mode', 'coop', '--renderer', backend,
    '--hidden', '--width', '640', '--height', '480', '--seats', '2', '--gamma', '1', '--user-content-root', userRoot]);
  if (command.kind !== 'run') throw new Error('Expected Application launch');
  const app = await Application.open(command.options, { print: () => undefined });
  const widths: number[] = [], focuses: string[] = [], frame = WorldSeatPresentation.prototype.frame;
  const widthReads: number[] = [], readCvar = CvarRegistry.prototype.variableValue;
  const widthRead = spyOn(CvarRegistry.prototype, 'variableValue').mockImplementation(function (this: CvarRegistry, name: string) {
    const value = readCvar.call(this, name);
    if (name === 'gl_debug_linewidth') widthReads.push(value);
    return value;
  });
  const presented = spyOn(WorldSeatPresentation.prototype, 'frame').mockImplementation(function (this: WorldSeatPresentation, snapshot: WorldSnapshot) {
    const result = frame.call(this, snapshot);
    focuses.push(this.local.input.focus.kind);
    for (const command of result.commands) if (command.kind === 'view') for (const operation of command.view.operations) {
      if (operation.kind === 'draw') for (const batch of operation.batches) if (batch.primitive === 'lines') widths.push(batch.lineWidth);
    }
    return result;
  });
  try {
    await app.step(25);
    const source = app.simulation.q2Source(), retired = app.simulation;
    if (source === null || source.product.rerelease === null) throw new Error('Expected typed rerelease source');
    const module = source.product.rerelease.entities;
    for (const player of app.localPlayers) {
      const view = app.simulation.playerView(player.actor);
      source.players.hooks.setMovement(player.actor, { kind: 'freeze', origin: view.origin, angles: view.angles });
    }
    await app.step(25);
    const draw = (lifetime: number): void => {
      for (const player of app.localPlayers) {
        const view = app.simulation.playerView(player.actor), axis = anglesToAxis(view.angles);
        const eye = add3(view.origin, { x: 0, y: 0, z: view.viewHeight });
        const center = add3(eye, scale3(axis[0], 64));
        const location = (index: number) => add3(center, add3(scale3(axis[1], (index % 4 - 1.5) * 20), scale3(axis[2], index < 4 ? 10 : -10)));
        const shapes: DebugShape[] = [
          { kind: 'line', start: location(0), end: add3(location(0), scale3(axis[2], 8)) },
          { kind: 'point', origin: location(1), size: 10 },
          { kind: 'circle', origin: location(2), radius: 6 },
          { kind: 'bounds', min: add3(location(3), { x: -4, y: -4, z: -4 }), max: add3(location(3), { x: 4, y: 4, z: 4 }) },
          { kind: 'sphere', origin: location(4), radius: 6 },
          { kind: 'cylinder', origin: location(5), radius: 4, halfHeight: 6 },
          { kind: 'ray', origin: location(6), direction: axis[2], length: 8, size: 3 },
          { kind: 'arrow', start: location(7), end: add3(location(7), scale3(axis[2], 8)), size: 3, capColor: { x: 1, y: 0, z: 1, w: 0.8 } },
        ];
        for (const shape of shapes) module.drawDebugShape(shape, { x: 0, y: 1, z: 1, w: 0.8 }, lifetime, false);
      }
    };
    const capture = async (label: string): Promise<Uint8Array> => {
      const pending = app.captureNextFrame(); await app.step(0.001); const pixels = await pending;
      await Bun.write(`/tmp/debug-shapes-app-${backend}-${label}.png`, encodePng(640, 480, pixels));
      return pixels;
    };
    draw(0);
    const visible = await capture('visible'), sourceTime = app.simulation.timeSeconds;
    const first = app.simulation.debugLines(); expect(first.length).toBeGreaterThan(0); expect(app.simulation.debugLines()).toBe(first);
    const absent = await capture('absent');
    expect(app.simulation.timeSeconds).toBe(sourceTime); expect(app.simulation.debugLines()).toHaveLength(0);
    for (const half of [0, 1]) {
      const start = half * 640 * 240 * 4, end = start + 640 * 240 * 4;
      expect(visible.slice(start, end)).not.toEqual(absent.slice(start, end));
    }
    draw(100);
    const narrow = await capture('width2');
    const local = app.localPlayers[0]; if (local === undefined) throw new Error('No console seat');
    const key = (code: number): void => { for (const down of [true, false]) app.input({ seat: local.seat.id, kind: 'key', code, down, repeat: false, timeMilliseconds: performance.now() }); };
    key(96); app.input({ seat: local.seat.id, kind: 'text', text: 'gl_debug_linewidth 6', timeMilliseconds: performance.now() }); key(13); await app.step(0.001); key(96); await app.step(0.001);
    widths.length = 0; focuses.length = 0;
    const wide = await capture('width6'); expect(wide).not.toEqual(narrow);
    expect(widthReads).toContain(6); expect(widths).toContain(6); expect(focuses).toEqual(['game', 'game']);
    await app.changeLevel('base1');
    expect(retired.debugLines()).toHaveLength(0); expect(app.simulation.debugLines()).toHaveLength(0);
  } finally { presented.mockRestore(); widthRead.mockRestore(); await app.close(); await rm(userRoot, { recursive: true, force: true }); }
}, 60000);
