import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { WorldSeatPresentation } from '../../../src/app/bootstrap/presentation.ts';
import { encodePng } from '../../../src/formats/images/png.ts';

for (const { edition, character } of [{ edition: 'classic', character: 'q1' }, { edition: 'rerelease', character: 'q1' }, { edition: 'rerelease', character: 'q3' }]) test(`Q1 ${edition} ${character} actual entry localizes source notice before console and HUD`, async () => {
  const users = await mkdtemp(join(tmpdir(), 'q1-localization-'));
  const parsed = parseApplicationCommand(['--game', `q1-${edition}-id1`, '--map', 'e1m1', '--movement', 'q1', '--character', character, '--renderer', 'cpu', '--width', '640', '--height', '480', '--hidden']);
  if (parsed.kind !== 'run') throw new Error('Missing options');
  const app = await Application.open({...parsed.options,userContentRoot:users},{print:()=>undefined});
  try {
    const output = await app.step(50);
    if (edition === 'rerelease') expect(output.events.some(event => event.payload.kind === 'message' && 'text' in event.payload.event && event.payload.event.text === '$qc_entered')).toBe(true);
    const player = app.localPlayers[0];
    if (player === undefined || !(player.seat.presentation instanceof WorldSeatPresentation)) throw new Error('Missing seat presentation');
    const presentation = player.seat.presentation, text = presentation.local.console.buffer.dump();
    expect(text.toLowerCase()).not.toContain('$qc_entered');
    expect(text.toLowerCase()).toContain('entered the game');
    const notices = presentation.ui.messages.active(50);
    expect(JSON.stringify(notices).toLowerCase()).not.toContain('$qc_entered');
    expect(JSON.stringify(notices).toLowerCase()).toContain('entered the game');
    if (edition === 'rerelease' && character === 'q1') {
      const provider = await presentation.assets.provider(app.content.recipe.map.entities.content);
      const catalog = await provider.mounts.open('localization/loc_english.txt');
      if (catalog === null) throw new Error('Missing installed localization');
      expect(new TextDecoder().decode(catalog.bytes).toLowerCase()).toContain('qc_entered');
      const pending = app.captureNextFrame(); await app.step(1);
      await Bun.write('/tmp/q1-localized-entry.png', encodePng(640, 480, await pending));
    }
  } finally {await app.close();await rm(users,{recursive:true,force:true});}
},30000);
