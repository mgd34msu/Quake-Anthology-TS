import { expect, spyOn, test } from 'bun:test';
import { resolve } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { ApplicationInput } from '../../../src/app/bootstrap/input.ts';
import { WorldSeatPresentation } from '../../../src/app/bootstrap/presentation.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { encodePng } from '../../../src/formats/images/png.ts';
const output = process.env["FRAME_TIME_PROOF"] ?? import.meta.dir;
test('actual local Q3 doubled time, camera freeze and resume', async () => {
  const prints: string[] = [], samples: object[] = [], forward: number[] = [], opened = performance.now();
  const parsed = parseApplicationCommand(['--game','q3-baseq3','--map','q3dm1','--movement','q3','--character','q3','--mode','deathmatch','--renderer','gl','--width','320','--height','240','--hidden','--user-content-root',resolve(output,'local-content')]);
  if (parsed.kind !== 'run') throw new Error('Missing local options');
  let app: Application | null = null, completed = false, frames = 0;
  const original = ApplicationInput.prototype.build;
  const build = spyOn(ApplicationInput.prototype, 'build').mockImplementation(function(this: ApplicationInput, source, elapsed, frame, wall) {
    const result = original.call(this, source, elapsed, frame, wall);
    for (const value of result) if (value.command.kind === "q3") forward.push(value.command.forwardMove);
    samples.push({ wallNow: performance.now(), source, wall, elapsed, commands: result.map(value => value.command) });
    return result;
  });
  try {
    app = await Application.open(parsed.options,{ print: text => { prints.push(text); } });
    const application = app, local = app.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error('Missing actual local console');
    const ui = local.seat.presentation.local;
    const source = app.simulation.q3Source(); if (source === null) throw new Error('Expected native Q3 source');
    source.host.cvars.set('sv_cheats','1',true);
    let previous = performance.now();
    const step = async () => { await Bun.sleep(20); const now = performance.now(), elapsed = now - previous; previous = now; await application.step(elapsed); frames++; };
    const run = async (count: number) => { for (let i=0;i<count;i++) await step(); };
    const consoleCommand = async (text: string) => { ui.console.field.setText(text); ui.console.submit(); await run(2); };
    const key = (code: number, down: boolean) => application.input({ seat: local.seat.id, kind:'key', code, down, repeat:false, timeMilliseconds:performance.now() });
    await run(3); await consoleCommand('timescale 2'); expect(source.host.cvars.variableValue('timescale')).toBe(2);
    const before = app.simulation.timeSeconds, position = app.simulation.playerView(local.actor).origin, started = performance.now();
    key(119,true); await run(16); key(119,false);
    expect(app.simulation.timeSeconds-before).toBeGreaterThan((performance.now()-started)/1000*1.5);
    expect(app.simulation.playerView(local.actor).origin).not.toEqual(position);
    expect(forward.some(value => value >= 100)).toBe(true);
    await consoleCommand('com_cameraMode 1'); await consoleCommand('timescale 0');
    const frozen = app.simulation.timeSeconds;
    application.input({ seat:local.seat.id, kind:'mouse-motion', position:{x:0,y:0}, delta:{x:5,y:2},timeMilliseconds:performance.now() });
    await run(10); expect(app.simulation.timeSeconds).toBe(frozen);
    const capture = app.captureNextFrame(); await step(); await Bun.write(resolve(output,'local-frozen.png'),encodePng(320,240,await capture));
    await consoleCommand('timescale 1'); await consoleCommand('com_cameraMode 0'); await run(10);
    expect(app.simulation.timeSeconds).toBeGreaterThan(frozen); completed=true;
  } finally { await app?.close(); build.mockRestore(); await Bun.write(resolve(output,'local.json'),JSON.stringify({completed,frames,wallMilliseconds:performance.now()-opened,samples,prints},null,2)); }
},120000);
