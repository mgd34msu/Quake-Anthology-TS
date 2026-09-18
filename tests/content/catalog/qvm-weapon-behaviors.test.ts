import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BinaryWriter} from '../../../src/core/binary/index.ts';
import {QvmOpcode} from '../../../src/compat/qvm/image.ts';
import {createMountIdentity,createContentDigest} from '../../../src/contracts/content.ts';
import {openMountPlan} from '../../../src/content/mounts/index.ts';
import {discoverQvmWeaponBehaviors,loadQvmWeaponBehavior} from '../../../src/content/catalog/qvm-weapon-behaviors.ts';
import {parseWeaponBehaviorTool} from '../../../src/app/bootstrap/weapon-behavior-tool-options.ts';
import {sameQvmWeaponLayout} from '../../../src/contracts/weapon-behavior.ts';

test('mounted QVM declarations bind exact bytecode entries and layouts without inferred behavior',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qvm-declaration-'));
  try {
    const code=new BinaryWriter(60);
    for(let i=0;i<4;i++){code.u8(QvmOpcode.OP_ENTER);code.i32(8);code.u8(QvmOpcode.OP_CONST);code.i32(0);code.u8(QvmOpcode.OP_LEAVE);code.i32(8);}
    const instructions=code.finish(),writer=new BinaryWriter(96);
    for(const value of [0x12721444,12,32,instructions.length,32+instructions.length,4,0,4092])writer.i32(value);
    writer.bytes(instructions);writer.i32(0);const bytes=writer.finish();
    const digest=createContentDigest(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
    const declaration={version:1,artifactDigest:digest,artifactPath:'vm/qagame.qvm',abiProfile:'q3-modern',id:'authored-layout',title:'ABI test only',role:'rocket',aspect:'trajectory',
      fireFunction:9,activationFunction:null,entityStride:544,levelTime:4,allocateFunction:3,freeFunction:6,fields:{inuse:516,nextthink:520,think:524,health:528},fireAbi:'entity-pointer-start-direction'};
    await mkdir(join(root,'vm'));await writeFile(join(root,'vm/qagame.qvm'),bytes);
    await writeFile(join(root,'qvm-weapon-behaviors.json'),JSON.stringify({version:1,profiles:[declaration]}));
    const mount={kind:'loose',rootPath:root,identity:createMountIdentity('mount:qvm:author','q3:classic:author:test',0)} satisfies import('../../../src/contracts/content.ts').ContentMount;
    using mounts=await openMountPlan({id:'mount-plan:qvm:author',mounts:[mount],defaultOrder:[mount.identity.id],prefixOrders:[]});
    const entries=await discoverQvmWeaponBehaviors(mounts,'weapon-behavior:author');
    expect(entries).toHaveLength(1);const entry=entries?.[0];if(entry === undefined)throw new Error('Missing declaration');
    expect(entry.profile.definition.fire).toEqual({kind:'qvm',module:entry.artifact.module,instructionIndex:9});
    expect(sameQvmWeaponLayout(entry.profile,{...entry.profile,fields:{...entry.profile.fields,think:532}})).toBe(false);
    expect(sameQvmWeaponLayout(entry.profile,entry.profile)).toBe(true);
    await expect(loadQvmWeaponBehavior(mounts,'weapon-behavior:author',{...declaration,artifactDigest:'sha256:'+'0'.repeat(64)})).rejects.toThrow();
    await expect(loadQvmWeaponBehavior(mounts,'weapon-behavior:author',{...declaration,fireFunction:10})).rejects.toThrow('function entry');
    await expect(loadQvmWeaponBehavior(mounts,'weapon-behavior:author',{...declaration,fields:{...declaration.fields,health:524}})).rejects.toThrow('overlapping');
    expect(parseWeaponBehaviorTool(['declare-qvm','q3-author','--profile','author-profile.json'])).toMatchObject({action:'declare-qvm',profile:'author-profile.json'});
    expect(()=>parseWeaponBehaviorTool(['declare-qvm','q3-author','--profile','author-profile.json','--fire','9'])).toThrow();
  } finally {await rm(root,{recursive:true,force:true});}
});
