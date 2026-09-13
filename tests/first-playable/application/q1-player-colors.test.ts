import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { encodePng } from '../../../src/formats/images/png.ts';

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
