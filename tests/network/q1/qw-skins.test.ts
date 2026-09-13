import { encodePcx } from '../../../src/formats/images/indexed.ts';
import { expect, test } from 'bun:test';
import { QwPlayerSkins } from '../../../src/app/bootstrap/network/qw-skins.ts';

function pcx(width: number, height: number): Uint8Array {
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) indices[y * width + x] = (x + y) % 190;
  return encodePcx({ width, height, indices }, new Uint8Array(768));
}
function fixture() {
  const files=new Map<string,Uint8Array>(), reads:string[]=[], state={noskins:0,baseskin:'base',allskins:''};
  const skins=new QwPlayerSkins({read:async path=>{reads.push(path);return files.get(path)??null;},noskins:()=>state.noskins,baseskin:()=>state.baseskin,allskins:()=>state.allskins});
  return {files,reads,state,skins};
}
test('QW indexed skins crop source stride without stretching and zero pad small images',async()=>{
  const f=fixture();f.files.set('skins/full.pcx',pcx(320,200));f.files.set('skins/small.pcx',pcx(2,2));
  const full=await f.skins.select('full');if(full===null)throw Error('missing');
  expect([full.width,full.height]).toEqual([296,194]);expect(full.pixels[296]).toBe(1);expect(full.pixels[295]).toBe(105);expect(full.pixels[193*296+295]).toBe((193+295)%190);
  const small=await f.skins.select('small');if(small===null)throw Error('missing');expect([...small.pixels.slice(0,3)]).toEqual([0,1,0]);expect([...small.pixels.slice(296,299)]).toEqual([1,2,0]);expect(small.pixels[592]).toBe(0);
  expect(full.name).toContain(':crop:0,0,296,194:stride320');expect(small.name).not.toBe(full.name);
});
test('QW selection obeys noskins overrides sanitization and cached missing fallback',async()=>{
  const f=fixture();f.files.set('skins/base.pcx',pcx(2,2));f.state.noskins=1;expect(await f.skins.select('user')).toBeNull();expect(f.reads).toEqual([]);
  f.state.noskins=2;expect(await f.skins.select('user')).not.toBeNull();expect(f.reads).toEqual(['skins/user.pcx','skins/base.pcx']);
  await f.skins.select('user');expect(f.reads).toHaveLength(2);
  f.state.allskins='abcdefghijklmnop.pcx';await f.skins.select('ignored');expect(f.reads).toContain('skins/abcdefghijklmno.pcx');
  f.state.allskins='';await f.skins.select('../unsafe');expect(f.reads.at(-1)).toBe('skins/base.pcx');
  f.skins.clear();f.files.set('skins/user.pcx',pcx(3,3));const replaced=await f.skins.select('user');expect(replaced?.pixels[2]).toBe(2);
});
test('QW malformed present skins do not fall back and failed cache clears after download',async()=>{
  const f=fixture();f.files.set('skins/base.pcx',pcx(2,2));f.files.set('skins/bad.pcx',new Uint8Array(5));
  expect(await f.skins.select('bad')).toBeNull();expect(f.reads).toEqual(['skins/bad.pcx']);
  f.files.set('skins/bad.pcx',pcx(2,2));expect(await f.skins.select('bad')).toBeNull();f.skins.clear();expect(await f.skins.select('bad')).not.toBeNull();
  f.files.set('skins/wide.pcx',pcx(321,2));expect(await f.skins.select('wide')).toBeNull();
});

test('QW odd-width PCX skips padded scanline bytes before the next source row', async () => {
  const f = fixture(); f.files.set('skins/odd.pcx', pcx(3, 2));
  const skin = await f.skins.select('odd'); if (skin === null) throw Error('Missing odd skin');
  expect([...skin.pixels.slice(0, 4)]).toEqual([0, 1, 2, 0]);
  expect([...skin.pixels.slice(296, 300)]).toEqual([1, 2, 3, 0]);
});
