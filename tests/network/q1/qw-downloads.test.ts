import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QwDownloadReceiver } from '../../../src/app/bootstrap/network/qw-downloads.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qw-download-')), gameRoot = join(root, 'game'), skinRoot = join(root, 'qw');
  mkdirSync(gameRoot); mkdirSync(skinRoot);
  const commands: string[] = [], prints: string[] = [];
  const policy = { noskins: 0, recording: false, playback: false };
  const receiver = new QwDownloadReceiver({ gameRoot, skinRoot, exists: async (path, category) => Bun.file(join(category === 'skin' ? skinRoot : gameRoot, path)).exists(),
    sendCommand: text => { commands.push(text); }, print: text => { prints.push(text); }, noskins: () => policy.noskins,
    demoRecording: () => policy.recording, demoPlayback: () => policy.playback, maximumBytes: 10 });
  return { root, gameRoot, skinRoot, commands, prints, policy, receiver, close() { receiver.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('QW native percentage blocks publish contained game assets and shared skins before progression', async () => {
  const f = fixture();
  try {
    for (const entry of [{path:'sound/a.wav',category:'sound'}, {path:'maps/a.bsp',category:'model'}, {path:'progs/a.mdl',category:'model'}, {path:'skins/a.pcx',category:'skin'}] satisfies readonly {path:string;category:'sound'|'model'|'skin'}[]) {
      expect(await f.receiver.request(entry.path,entry.category)).toBe('waiting');
      expect(f.commands.at(-1)).toBe(`download ${entry.path}`);
      expect(await f.receiver.receive({kind:'data',percent:50,bytes:new Uint8Array([1,2])})).toBe('waiting');
      expect(f.commands.at(-1)).toBe('nextdl');
      const destination=join(entry.category==='skin'?f.skinRoot:f.gameRoot,entry.path);
      expect(await Bun.file(destination).exists()).toBe(false);
      expect(await f.receiver.receive({kind:'data',percent:100,bytes:new Uint8Array([3])})).toBe('complete');
      expect(await Bun.file(destination).bytes()).toEqual(new Uint8Array([1,2,3]));
      expect(await f.receiver.request(entry.path,entry.category)).toBe('available');
    }
  } finally { f.close(); }
});

test('QW noskins and demo restrictions avoid new transfers but retain installed files', async () => {
  const f=fixture();try {
    for(const value of [1,2]) { f.policy.noskins=value; expect(await f.receiver.request('skins/new.pcx','skin')).toBe('skipped'); }
    mkdirSync(join(f.skinRoot,'skins'),{recursive:true});writeFileSync(join(f.skinRoot,'skins/old.pcx'),new Uint8Array([1]));
    expect(await f.receiver.request('skins/old.pcx','skin')).toBe('available');
    f.policy.recording=true;expect(await f.receiver.request('maps/a.bsp','model')).toBe('skipped');
    f.policy.recording=false;f.policy.playback=true;expect(await f.receiver.request('sound/a.wav','sound')).toBe('skipped');
    expect(await f.receiver.receive({kind:'data',percent:100,bytes:new Uint8Array([1])})).toBe('waiting');expect(f.commands).toEqual([]);
  } finally {f.close();}
});

test('QW denial cancellation invalid paths and publication conflicts retain contained state', async () => {
  const f=fixture();try {
    for(const path of ['../maps/a.bsp','/maps/a.bsp','maps/a.bsp;quit','skins/a.pcx'])await expect(f.receiver.request(path,'model')).rejects.toThrow();
    expect(await f.receiver.request('maps/a.bsp','model')).toBe('waiting');
    expect(await f.receiver.receive({kind:'missing'})).toBe('missing');
    await f.receiver.request('maps/a.bsp','model');await f.receiver.receive({kind:'data',percent:20,bytes:new Uint8Array([1])});f.receiver.close();
    expect(readdirSync(join(f.gameRoot,'maps'))).toEqual([]);
    await f.receiver.request('maps/a.bsp','model');await f.receiver.receive({kind:'data',percent:20,bytes:new Uint8Array([1])});
    writeFileSync(join(f.gameRoot,'maps/a.bsp'),new Uint8Array([9]));
    expect(await f.receiver.receive({kind:'data',percent:100,bytes:new Uint8Array([2])})).toBe('missing');
    expect(await Bun.file(join(f.gameRoot,'maps/a.bsp')).bytes()).toEqual(new Uint8Array([9]));expect(readdirSync(join(f.gameRoot,'maps'))).toEqual(['a.bsp']);
    await f.receiver.request('maps/b.bsp','model');expect(await f.receiver.receive({kind:'data',percent:100,bytes:new Uint8Array(11)})).toBe('missing');
    await f.receiver.request('maps/c.bsp','model');await expect(f.receiver.receive({kind:'data',percent:101,bytes:new Uint8Array([1])})).rejects.toThrow();
    expect(readdirSync(join(f.gameRoot,'maps'))).toEqual(['a.bsp']);
  } finally {f.close();}
});
