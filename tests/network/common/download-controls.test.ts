import { blockChecksum } from '../../../src/core/md4.ts';
import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteContent } from '../../../src/app/bootstrap/content.ts';
import { remoteContentSelection } from '../../../src/content/catalog/index.ts';
import { Q2DownloadReceiver } from '../../../src/app/bootstrap/network/q2-downloads.ts';
import { EntityStateT } from '../../../src/network/q2/state.ts';
import type { Q2ApplicationGameState } from '../../../src/app/bootstrap/network/types.ts';

test('Q2 cancellation drains the outstanding native block before retry and reports staged bytes', async () => {
  const root=await mkdtemp(join(tmpdir(),'q2-controls-'));
  const content=await openRemoteContent({corpusRoot:'/home/buzzkill/Projects/qfiles',userContentRoot:root},remoteContentSelection('q2-classic-baseq2','baseq2'),()=>{});
  const map = await content.mounts.read('maps/base1.bsp');
  const commands:string[]=[];
  const receiver=new Q2DownloadReceiver(()=>content,text=>{commands.push(text);},()=>{});
  const state:Q2ApplicationGameState={data:{servercount:1,attractloop:false,gamedir:'baseq2',clientnum:0,levelname:'controls',serverState:2},configStrings:new Map([[31,String(blockChecksum(map))],[33,'maps/base1.bsp'],[289,'t08-missing.wav']]),baselines:new Map<number,EntityStateT>()};
  try {
    expect(await receiver.prepare(state)).toBe('waiting');
    receiver.receive({kind:'download',percent:50,bytes:new Uint8Array([1,2])});
    expect(receiver.progress[0]?.received).toBe(2);
    receiver.cancel();receiver.cancel();receiver.retry();expect(await receiver.prepare(state)).toBe('canceled');
    receiver.receive({kind:'download',percent:100,bytes:new Uint8Array([9])});
    expect(await receiver.prepare(state)).toBe('waiting');
    expect(commands).toEqual(['download sound/t08-missing.wav','nextdl','download sound/t08-missing.wav']);
    receiver.receive({kind:'download',percent:100,bytes:new Uint8Array([3,4])});
    expect(await Bun.file(join(content.writeRoot,'sound/t08-missing.wav')).bytes()).toEqual(new Uint8Array([3,4]));
  }finally{receiver.close();await content.mounts.close();await rm(root,{recursive:true,force:true});}
});
