import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadQcProgram, QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage } from '../../../src/compat/qc/index.ts';
import type { QcBuiltin, QcHostBuiltinName } from '../../../src/compat/qc/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { SessionActorRegistry, SourceActorSlots, quakeEdictLifetime } from '../../../src/world/actors/index.ts';
import { Q1_DONOR_PROFILE, createNumericOperations } from '../../../src/core/numeric.ts';
import type { Id1PhysicsCallback } from '../../../src/content/q1/quakec/id1-environment.ts';
import { Id1Environment } from '../../../src/content/q1/quakec/id1-environment.ts';

test('native QW teledeath executes both invulnerability reversals with exact victim provenance', () => {
  const program = loadQcProgram(readFileSync('/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat'));
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 4);
  const actors = new SessionActorRegistry(createIdentityOwner('qw-map-damage'));
  const slots = new SourceActorSlots(actors, { provider: 'test:qc', capacity: 8, lifetime: quakeEdictLifetime(1),
    storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 100 }),
    now: () => ({ kind: 'seconds', value: 10 }), unlink: () => undefined, exhausted: () => { throw new Error('No slots'); } });
  slots.bindExisting(0, 'test:world');
  const owner = slots.bindExisting(1, 'test:player'), trigger = slots.bindExisting(2, 'test:trigger'), other = slots.bindExisting(3, 'test:player');
  const host = new Map<QcHostBuiltinName, QcBuiltin>([['infokey', vm => { vm.returnInt(0); return undefined; }], ['remove', () => { slots.free(trigger); return undefined; }]]);
  const observed: { readonly target: number; readonly cause: string; readonly statement: number }[] = [];
  let callback: Id1PhysicsCallback = { kind: 'touch', actor: trigger.id, other: other.id, functionIndex: program.functionNamed('tdeath_touch').index };
  const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
    builtins: createQcBuiltins({ kind: 'quakeworld', host }), serverActive: () => true,
    observeCall: call => {
      if (call.functionIndex !== program.functionNamed('T_Damage').index) return undefined;
      const target = slots.at(entities.slot(vm.argInt(0)));
      if (target === null) throw new Error('No damage target');
      const result = observer.resolve({ call, target: target.id, inflictor: trigger.id, attacker: trigger.id, amount: vm.argFloat(3) }, callback);
      if (result?.cause.kind !== 'q1') throw new Error('Missing native cause');
      observed.push({ target: entities.slot(vm.argInt(0)), cause: result.cause.deathType, statement: call.statement });
      return undefined;
    } });
  const observer = new Id1Environment({ program, entities, actors, slots }, () => vm);
  const field = (name: string): number => vm.fieldOffset(name);
  for (const [ownerInvincible, otherInvincible, expected] of [
    [false, false, [9836]], [false, true, [9828]], [true, true, [9808, 9817, 9836]],
  ] satisfies readonly (readonly [boolean, boolean, readonly number[]])[]) {
    observed.length = 0;
    vm.globals.setInt(vm.globalOffset('self'), entities.reference(2));
    vm.globals.setInt(vm.globalOffset('other'), entities.reference(3));
    vm.globals.setFloat(vm.globalOffset('time'), 10);
    entities.at(2).setInt(field('owner'), entities.reference(1));
    entities.at(2).setInt(field('classname'), vm.strings.allocate('teledeath'));
    for (const slot of [1, 3]) {
      entities.at(slot).setInt(field('classname'), vm.strings.allocate('player'));
      entities.at(slot).setFloat(field('health'), 200000);
      entities.at(slot).setFloat(field('takedamage'), 2);
      entities.at(slot).setInt(field('th_pain'), program.functionNamed('SUB_Null').index);
      entities.at(slot).setFloat(field('invincible_finished'), (slot === 1 ? ownerInvincible : otherInvincible) ? 20 : 0);
    }
    vm.execute(callback.functionIndex);
    expect(observed.map(value => value.statement)).toEqual(expected);
    expect(observed.map(value => value.target)).toEqual(otherInvincible ? ownerInvincible ? [3, 1, 3] : [1] : [3]);
    expect(observed.map(value => value.cause)).toEqual(expected.map(() => otherInvincible ? ownerInvincible ? 'teledeath3' : 'teledeath2' : 'teledeath'));
    expect(entities.at(1).float(field('health'))).toBe(otherInvincible ? 150000 : 200000);
    expect(entities.at(3).float(field('health'))).toBe(otherInvincible ? ownerInvincible ? 100000 : 200000 : 150000);
  }
  callback = { ...callback, functionIndex: program.functionNamed('fire_touch').index };
  observed.length = 0;
  vm.globals.setInt(vm.globalOffset('self'), entities.reference(2));
  entities.at(2).setInt(field('classname'), vm.strings.allocate('fireball'));
  entities.at(3).setFloat(field('health'), 100);
  entities.at(3).setInt(field('deathtype'), vm.strings.allocate(''));
  vm.execute(callback.functionIndex);
  expect(observed).toEqual([{ target: 3, cause: '', statement: 10926 }]);
  expect(entities.at(3).float(field('health'))).toBe(80);
  expect(actors.isLive(trigger.id)).toBe(false);
  expect(owner.id.equals(other.id)).toBe(false);
});
