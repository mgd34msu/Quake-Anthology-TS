import { id1ProgramBinding } from "./id1-program.ts";
import type { ActorId } from '../../../contracts/identity.ts';
import type { ItemId } from '../../../contracts/gameplay.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { QcEntityStoreObservation, QcFunctionBoundary, QcMachine } from '../../../compat/qc/machine.ts';
import { QcProgramError } from '../../../compat/qc/program.ts';
import type { QcWorldHostOptions } from '../../../compat/qc/world-host.ts';
import type { Id1DamageCall } from './id1-damage.ts';

export interface Id1ProjectileAttack {
  readonly weapon: ItemId;
  readonly time: number;
  readonly launch: { readonly owner: ActorId; readonly emittedAt: number } | null;
  readonly trace: { readonly point: Vec3; readonly normal: Vec3 } | null;
}
interface Emission { readonly owner: ActorId; readonly emittedAt: number; readonly weapon: ItemId; }
/** Observes native QC calls; source bytecode retains damage, momentum and projectile timing. */
export class Id1ProjectileAttacks {
  private readonly emissions = new Map<ActorId, Emission>();
  private readonly firing: Emission[] = [];
  private readonly weapons = new Map<number, ItemId>();
  private readonly sites: ReadonlyMap<number, number>;
  private readonly ownerField: number;
  private readonly damageFunction: number;
  private readonly radiusFunction: number;
  private readonly lightningFunction: number;
  private readonly launchSpikeFunction: number;
  constructor(private readonly source: Pick<QcWorldHostOptions, 'program' | 'entities' | 'actors' | 'slots'>,
    private readonly machine: () => QcMachine) {
    const p = source.program, qw = p.digest === 'sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830';
    if (id1ProgramBinding(p).attribution === 'native') {
      this.damageFunction = p.functionNamed('T_Damage').index;
      this.radiusFunction = 0; this.lightningFunction = 0; this.launchSpikeFunction = 0;
      this.sites = new Map<number, number>(); this.ownerField = -1;
      return;
    }
    for (const [name, weapon] of [['W_FireRocket', 'q1:weapon/rocketlauncher'], ['W_FireGrenade', 'q1:weapon/grenadelauncher'],
      ['W_FireSpikes', 'q1:weapon/nailgun'], ['W_FireSuperSpikes', 'q1:weapon/supernailgun'], ['W_FireLightning', 'q1:weapon/lightning']] satisfies readonly (readonly [string, ItemId])[]) this.weapons.set(p.functionNamed(name).index, weapon);
    this.damageFunction = p.functionNamed('T_Damage').index;
    this.radiusFunction = p.functionNamed('T_RadiusDamage').index;
    this.lightningFunction = p.functionNamed('W_FireLightning').index;
    this.launchSpikeFunction = p.functionNamed('launch_spike').index;
    this.sites = new Map(qw ? [[3256,147],[580,84],[3900,158],[3973,159],[3388,149],[3478,151],[3720,154]]
      : [[3783,183],[1623,118],[1629,118],[4330,193],[4392,194],[3910,185],[3943,185],[3968,185]]);
    const owner = p.fieldsByName.get('owner'); if (owner === undefined) throw new QcProgramError('Missing projectile owner field'); this.ownerField = owner.offset;
  }
  private vm(): QcMachine {
    const vm = this.machine(); if (vm.program !== this.source.program || vm.entities !== this.source.entities) throw new QcProgramError('Projectile observer belongs to another VM'); return vm;
  }
  private actor(reference: number): ActorId {
    const actor = this.source.slots.at(this.source.entities.slot(reference));
    if (actor === null || !this.source.actors.isLive(actor.id)) throw new QcProgramError('Projectile references a free actor'); return actor.id;
  }
  compose(inner: QcFunctionBoundary): QcFunctionBoundary {
    return { functions: new Set([...inner.functions, ...this.weapons.keys()]), run: (call, execute) => {
      const weapon = this.weapons.get(call.functionIndex);
      if (weapon === undefined) return inner.run(call, execute);
      const vm = this.vm();
      this.firing.push({ weapon, owner: this.actor(vm.globals.int(vm.globalOffset('self'))), emittedAt: vm.globals.float(vm.globalOffset('time')) });
      try { return inner.functions.has(call.functionIndex) ? inner.run(call, execute) : execute(); } finally { this.firing.pop(); }
    } };
  }
  observeStore(store: QcEntityStoreObservation): undefined {
    if (store.word !== this.ownerField) return undefined;
    if (store.functionIndex !== this.launchSpikeFunction && (!this.weapons.has(store.functionIndex) || store.functionIndex === this.lightningFunction)) return undefined;
    const emission = this.firing.at(-1); if (emission === undefined) return undefined;
    const owner = this.actor(new DataView(store.after.buffer, store.after.byteOffset, store.after.byteLength).getInt32(0, true));
    if (!owner.equals(emission.owner)) return undefined;
    const projectile = this.actor(store.reference);
    for (const actor of this.emissions.keys()) if (!this.source.actors.isLive(actor)) this.emissions.delete(actor);
    if (!projectile.equals(owner)) this.emissions.set(projectile, emission);
    return undefined;
  }
  resolve(call: Id1DamageCall): Id1ProjectileAttack | null {
    if (call.call.functionIndex !== this.damageFunction || this.sites.get(call.call.statement) !== call.call.caller) return null;
    const vm = this.vm();
    if (!this.actor(vm.argInt(0)).equals(call.target) || !this.actor(vm.argInt(1)).equals(call.inflictor)
      || !this.actor(vm.argInt(2)).equals(call.attacker) || vm.argFloat(3) !== call.amount) throw new QcProgramError('Projectile damage arguments changed');
    const launch = this.emissions.get(call.inflictor), active = this.firing.at(-1);
    if (launch === undefined && (active === undefined || !call.inflictor.equals(active.owner))) return null;
    const emission = launch ?? active;
    if (emission === undefined) return null;
    if (launch === undefined && (active === undefined || (call.call.caller !== this.radiusFunction && !this.weapons.has(call.call.caller)
      && active.weapon !== this.weapons.get(this.lightningFunction)))) return null;
    return { weapon: emission.weapon, time: vm.globals.float(vm.globalOffset('time')),
      launch: launch === undefined ? null : { owner: launch.owner, emittedAt: launch.emittedAt },
      trace: launch === undefined && active?.weapon === this.weapons.get(this.lightningFunction) && call.call.caller !== this.radiusFunction && call.call.caller !== this.lightningFunction
        ? { point: vm.globals.vector(vm.globalOffset('trace_endpos')), normal: vm.globals.vector(vm.globalOffset('trace_plane_normal')) } : null };
  }
}
