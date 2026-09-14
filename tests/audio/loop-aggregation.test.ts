import { expect, test } from 'bun:test';
import { openArchive } from '../../src/content/archive/index.ts';
import { decodeWav } from '../../src/audio/wav.ts';
import { AudioMixer } from '../../src/audio/mixer.ts';
import type { PcmSound } from '../../src/audio/wav.ts';
import type { Axis, Vec3 } from '../../src/contracts/math.ts';
const axis: Axis=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
const origin={x:0,y:0,z:0},right={x:0,y:-10,z:0};
function mixer(sounds:readonly PcmSound[],family:'q1'|'q2'='q2'){
 const result=new AudioMixer(44100,()=>1000);result.setEffectsVolume(0.1);result.setListener(1,origin,axis);
 result.setSourceLoopSounds(sounds.map((sound,index)=>({family,entity:index+2,sound,origin:right,volume:1,attenuation:1})));
 result.setListener(1,origin,axis);return result;
}
test('retail identical Q2 loops cap combined per-ear gain before painting PCM',async()=>{
 const archive=await openArchive('/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak');
 try{const entry=archive.entries.find(e=>e.path==='sound/world/flyby1.wav');if(entry===undefined)throw Error('Missing retail WAV');const sound=decodeWav(await archive.readEntry(entry),entry.path);
 const one=mixer([sound]).mix(4096),two=mixer([sound,sound]).mix(4096);expect(one.some(sample=>sample!==0)).toBe(true);expect(two).toEqual(one);
 }finally{archive.close();}
});
const tone:PcmSound={samples:Int16Array.from({length:64},(_,index)=>500+index*10),sampleRate:44100,channels:1,frameCount:64,loopStart:null};
test('synchronized loop gain follows current listener and retains global phase',()=>{
 const actual=mixer([tone,tone]),single=mixer([tone]);expect(actual.mix(73)).toEqual(single.mix(73));
 actual.setSourceLoopSounds([2,3].map(entity=>({family:"q2",entity,sound:tone,origin:right,volume:1,attenuation:1})));
 const moved:Vec3={x:0,y:-20,z:0};actual.setListener(1,moved,axis);single.setListener(1,moved,axis);
 const after=actual.mix(73);expect(after).toEqual(single.mix(73));expect(after[0]).toBeGreaterThan(0);expect(after[1]).toBe(0);
 actual.setListener(1,{x:0,y:1000,z:0},axis);expect([...actual.mix(8)]).toEqual(new Array<number>(16).fill(0));
});
test('different PCM and Q1 entity loops remain independently mixed',()=>{
 const other:PcmSound={...tone,samples:new Int16Array(64).fill(2000)};
 const distinct=mixer([tone,other]).mix(1),same=mixer([tone,tone]).mix(1);
 expect(distinct[1]).toBeGreaterThan(same[1]??0);
 const q1single=mixer([tone],'q1').mix(1),q1double=mixer([tone,tone],'q1').mix(1);
 expect(q1double[1]).toBeGreaterThan(q1single[1]??0);
});
