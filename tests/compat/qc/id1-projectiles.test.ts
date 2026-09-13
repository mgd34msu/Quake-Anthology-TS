import { expect, test } from 'bun:test';
import type { ItemId } from '../../../src/contracts/gameplay.ts';
import { openArchive } from '../../../src/content/archive/index.ts';
import { loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage } from '../../../src/compat/qc/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { SessionActorRegistry, SourceActorSlots, quakeEdictLifetime } from '../../../src/world/actors/index.ts';
import { Q1_DONOR_PROFILE, createNumericOperations } from '../../../src/core/numeric.ts';
import { Id1ProjectileAttacks } from '../../../src/content/q1/quakec/id1-projectiles.ts';
import type { QcBuiltin, QcHostBuiltinName } from '../../../src/compat/qc/index.ts';

for (const qw of [false, true]) test(`pinned ${qw ? 'QW' : 'NQ'} projectile attribution retains launch identity while native damage executes`, async () => {
  const archive = await openArchive('/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK');
  try {
    const entry = archive.findEntries('progs.dat').at(-1); if (entry === undefined) throw new Error('No id1 program');
    const program = loadQcProgram(qw ? new Uint8Array(await Bun.file('/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat').arrayBuffer()) : await archive.readEntry(entry));
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 4), actors = new SessionActorRegistry(createIdentityOwner(`projectiles-${qw}`));
    const slots = new SourceActorSlots(actors, { provider: 'test:qc', capacity: 8, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: qw ? 100 : 92 }),
      now: () => ({ kind: 'seconds', value: 10 }), unlink: () => undefined, exhausted: () => { throw new Error('No slots'); } });
    slots.bindExisting(0, 'test:world'); const owner = slots.bindExisting(1, 'test:player'), missile = slots.bindExisting(2, 'test:missile'), target = slots.bindExisting(3, 'test:target');
    const host = new Map<QcHostBuiltinName, QcBuiltin>([['infokey', vm => { vm.returnInt(0); return undefined; }]]);
    const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: qw ? 'quakeworld' : 'netquake', host }), serverActive: () => true });
    const observer = new Id1ProjectileAttacks({ program, entities, actors, slots }, () => vm);
    const field = (name: string) => vm.fieldOffset(name);
    vm.globals.setInt(vm.globalOffset('self'), entities.reference(1)); vm.globals.setFloat(vm.globalOffset('time'), 2);
    const launch = program.functionNamed('W_FireRocket').index, ownerBytes = new Uint8Array(4); new DataView(ownerBytes.buffer).setInt32(0, entities.reference(1), true);
    observer.compose({ functions: new Set<number>(), run: (_call, execute) => execute() }).run({ functionIndex: launch, caller: 0, statement: -1 }, () => {
      entities.at(2).setInt(field('owner'), entities.reference(1));
      observer.observeStore({ functionIndex: launch, statement: 0, reference: entities.reference(2), word: field('owner'), before: new Uint8Array(4), after: ownerBytes }); return undefined;
    });
    slots.free(owner); const replacement = slots.bindExisting(1, 'test:new-player');
    expect(replacement.id.equals(owner.id)).toBe(false);
    vm.globals.setFloat(vm.globalOffset('time'), 10); vm.globals.setInt(vm.globalOffset('self'), entities.reference(2));
    vm.globals.setInt(4, entities.reference(3)); vm.globals.setInt(7, entities.reference(2)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 20);
    const call = { call: { functionIndex: program.functionNamed('T_Damage').index, caller: program.functionNamed('T_MissileTouch').index, statement: qw ? 3256 : 3783 }, target: target.id, inflictor: missile.id, attacker: replacement.id, amount: 20 };
    const attribution = observer.resolve(call);
    expect(attribution?.weapon).toBe('q1:weapon/rocketlauncher'); expect(attribution?.launch?.owner.equals(owner.id)).toBe(true);
    expect(attribution?.launch?.emittedAt).toBe(2); expect(attribution?.time).toBe(10);
    expect(() => observer.resolve({ ...call, attacker: owner.id })).toThrow();
    entities.at(3).setFloat(field('health'), 100); entities.at(3).setFloat(field('takedamage'), 2);
    entities.at(3).setFloat(field('armorvalue'), 40); entities.at(3).setFloat(field('armortype'), 0.3);
    vm.execute(program.functionNamed('T_Damage').index, 4);
    expect(entities.at(3).float(field('health'))).toBe(86); expect(entities.at(3).float(field('armorvalue'))).toBe(34);
    slots.free(missile); const reused = slots.bindExisting(2, 'test:new-missile');
    vm.globals.setInt(4, entities.reference(3)); vm.globals.setInt(7, entities.reference(2)); vm.globals.setInt(10, entities.reference(1)); vm.globals.setFloat(13, 20);
    expect(observer.resolve({ ...call, inflictor: reused.id })).toBeNull();
    vm.globals.setInt(vm.globalOffset('self'), entities.reference(1));
    const projectiles: readonly (readonly [string, ItemId, number, number])[] = qw ? [
      ['W_FireGrenade', 'q1:weapon/grenadelauncher', 84, 580], ['W_FireSpikes', 'q1:weapon/nailgun', 158, 3900],
      ['W_FireSuperSpikes', 'q1:weapon/supernailgun', 159, 3973],
    ] : [
      ['W_FireGrenade', 'q1:weapon/grenadelauncher', 118, 1623], ['W_FireSpikes', 'q1:weapon/nailgun', 193, 4330],
      ['W_FireSuperSpikes', 'q1:weapon/supernailgun', 194, 4392],
    ];
    for (const [name, weapon, caller, statement] of projectiles) {
      const functionIndex = program.functionNamed(name).index;
      observer.compose({ functions: new Set<number>(), run: (_call, execute) => execute() }).run({ functionIndex, caller: 0, statement: -1 }, () => {
        observer.observeStore({ functionIndex: name === 'W_FireGrenade' ? functionIndex : program.functionNamed('launch_spike').index,
          statement: 0, reference: entities.reference(2), word: field('owner'), before: new Uint8Array(4), after: ownerBytes }); return undefined;
      });
      const result = observer.resolve({ ...call, inflictor: reused.id, call: { ...call.call, caller, statement } });
      expect(result?.weapon).toBe(weapon); expect(result?.launch?.owner.equals(replacement.id)).toBe(true);
    }
    const cases: readonly (readonly [string, ItemId, number, number])[] = qw ? [
      ['W_FireLightning', 'q1:weapon/lightning', 149, 3388], ['W_FireLightning', 'q1:weapon/lightning', 84, 580],
      ['W_FireLightning', 'q1:weapon/lightning', 151, 3478], ['W_FireGrenade', 'q1:weapon/grenadelauncher', 154, 3720],
    ] : [
      ['W_FireLightning', 'q1:weapon/lightning', 185, 3910], ['W_FireLightning', 'q1:weapon/lightning', 185, 3943],
      ['W_FireLightning', 'q1:weapon/lightning', 185, 3968], ['W_FireLightning', 'q1:weapon/lightning', 118, 1629],
    ];
    for (const [name, weapon, caller, site] of cases) {
      vm.globals.setInt(7, entities.reference(1));
      observer.compose({ functions: new Set<number>(), run: (_call, execute) => execute() }).run({ functionIndex: program.functionNamed(name).index, caller: 0, statement: -1 }, () => {
        const result = observer.resolve({ ...call, inflictor: replacement.id, call: { ...call.call, caller, statement: site } });
        expect(result?.weapon).toBe(weapon); expect(result?.launch).toBeNull(); return undefined;
      });
    }
    observer.compose({ functions: new Set<number>(), run: (_call, execute) => execute() }).run({
      functionIndex: program.functionNamed('W_FireLightning').index, caller: 0, statement: -1,
    }, () => {
      vm.globals.setInt(7, entities.reference(3));
      expect(observer.resolve({ ...call, inflictor: target.id, call: { ...call.call,
        caller: program.functionNamed('T_RadiusDamage').index, statement: qw ? 580 : 1629 } })).toBeNull();
      return undefined;
    });
  } finally { archive.close(); }
});
