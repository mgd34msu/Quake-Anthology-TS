import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { applicationPreset } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { discoverInstalledContent, presetChoice, resolveLaunch } from '../../../src/content/catalog/index.ts';
import { encodePng } from '../../../src/formats/images/png.ts';
import { testCorpusRoot } from '../../support/corpus.ts';

test('Q1 source colors feed each player model and survive source save restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'q1-player-colors-'));
  const selected = parseApplicationCommand(['--game','q1-rerelease-id1','--map','e1m1','--movement','q1','--character','q1','--seats','2','--renderer','cpu','--width','640','--height','480','--hidden']);
  if(selected.kind!=='run')throw Error('Missing options');
  const app=await Application.open({...selected.options,userContentRoot:root},{print:()=>undefined});
  try {
    const first=app.localPlayers[0],second=app.localPlayers[1];if(first===undefined||second===undefined)throw Error('Missing players');
    const source = app.simulation.q1Source(); if (source === null) throw Error('Missing Q1 source');
    source.composition.clients.colors(first.actor, 4, 13); source.composition.clients.colors(second.actor, 2, 8); await app.step(50);
    const colors=()=>app.localPlayers.map(player=>app.simulation.presentations().find(model=>model.actor.equals(player.actor)&&!model.viewWeapon)?.playerColors);
    expect(colors()).toEqual([{top:4,bottom:13},{top:2,bottom:8}]);
    expect(app.simulation.presentations().filter(model=>model.viewWeapon).every(model=>model.playerColors===undefined)).toBe(true);
    expect(app.simulation.presentations().filter(model=>!app.localPlayers.some(player=>player.actor.equals(model.actor))).every(model=>model.playerColors===undefined)).toBe(true);
    const save=join(root,'colors.sav');await app.saveGame(save);
    source.composition.clients.colors(first.actor, 6, 7); await app.step(50);expect(colors()[0]).toEqual({top:6,bottom:7});
    await app.loadGame(save);await app.step(50);expect(colors()).toEqual([{top:4,bottom:13},{top:2,bottom:8}]);
    const pixels=app.captureNextFrame();await app.step(1);await Bun.write('/tmp/q1-player-colors.png',encodePng(640,480,await pixels));
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
},30000);

test('foreign Q1 character in a Q3 world carries the launch shirt and pants colors', async () => {
  const parsed = parseApplicationCommand(['--content-root',testCorpusRoot(),'--game','q3-baseq3','--map','q3dm1','--movement','q1',
    '--character','q1','--mode','singleplayer','--renderer','cpu','--hidden','--width','320','--height','240']);
  if(parsed.kind!=='run')throw Error('Missing launch');
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: 'selected', value: [{ provider: 'q1:official', content: catalog.require('q1-classic-id1').id }] } } });
  const app = await Application.open({...parsed.options,characterTopColor:4,characterBottomColor:13},{print:()=>undefined},recipe);
  try {
    for(let index=0;index<12;index++)await app.step(50);
    const local=app.localPlayers[0];if(local===undefined)throw Error('Missing local player');
    const body=app.simulation.presentations().find(model=>model.actor.equals(local.actor)&&!model.viewWeapon&&model.path==='progs/player.mdl');
    expect(body).toBeDefined();
    expect(body?.playerColors).toEqual({top:4,bottom:13});
    expect(app.simulation.presentations().filter(model=>model.viewWeapon).every(model=>model.playerColors===undefined)).toBe(true);
  }finally{await app.close();}
},120000);
