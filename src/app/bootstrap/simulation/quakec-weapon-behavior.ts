import { qcWeaponBehaviorCapabilityError } from "../../../compat/qc/weapon-behavior-profile.ts";
import { SaveReader } from '../../../persistence/value.ts';
import { readRandom } from '../../../persistence/shared.ts';
import { readSavedActor } from '../../../persistence/save-image.ts';
import { readWeaponBehaviorDefinition } from '../../../world/gameplay/weapon-behaviors.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import type { Bounds, Vec3 } from '../../../contracts/math.ts';
import type { SavedActorId } from '../../../contracts/session.ts';
import { sameWeaponBehavior } from '../../../contracts/weapon-behavior.ts';
import type { RandomSource, RandomState } from '../../../contracts/numeric.ts';
import type { BodyState } from '../../../contracts/world.ts';
import type { SceneQueries } from '../../../contracts/scene.ts';
import type { WeaponBehaviorDefinition, WeaponBehaviorInstance, WeaponBehaviorLaunch, WeaponBehaviorSource } from '../../../contracts/weapon-behavior.ts';
import { createNumericOperations, Q1_DONOR_PROFILE } from '../../../core/numeric.ts';
import { QcMachine, type QcBuiltin, type QcMachineSnapshot } from '../../../compat/qc/machine.ts';
import { QcEntityMemory } from '../../../compat/qc/memory.ts';
import { classicQcEntityLayout } from '../../../compat/qc/profile.ts';
import { createQcBuiltins, type QcHostBuiltinName } from '../../../compat/qc/builtins.ts';
import type { QcProgram } from '../../../compat/qc/program.ts';

export interface QcWeaponBehaviorTarget {
  readonly actor: ActorId;
  readonly body: BodyState;
  readonly health: number;
  readonly classname: string;
  readonly name: string;
  readonly solid: boolean;
}
export interface QcWeaponBehaviorOptions {
  readonly definition: WeaponBehaviorDefinition;
  readonly program: QcProgram;
  readonly random: RandomSource;
  readonly scene: Pick<SceneQueries, 'trace' | 'pointContents'>;
  readonly mode: 'singleplayer' | 'coop' | 'deathmatch';
  targets(): readonly QcWeaponBehaviorTarget[];
  aim(shooter: ActorId, speed: number): Vec3;
  model(path: string): { readonly index: number; readonly bounds: Bounds } | null;
  print(recipient: ActorId | null, text: string): void;
}

export interface QuakeCWeaponBehaviorCheckpoint {
  readonly version: 1;
  readonly definition: WeaponBehaviorDefinition;
  readonly mode: QcWeaponBehaviorOptions['mode'];
  readonly sourceTime: number;
  readonly random: RandomState;
  readonly machine: QcMachineSnapshot;
  readonly free: readonly number[];
  readonly retired: readonly number[];
  readonly bindings: readonly { readonly slot: number; readonly actor: SavedActorId; readonly kind: 'target' | 'projectile' }[];
}

/** Executes donor bytecode. Only its projectile trajectory crosses into the selected launcher's actor. */
export class QuakeCWeaponBehaviorSource implements WeaponBehaviorSource {
  readonly definition: WeaponBehaviorDefinition;
  private readonly machine: QcMachine;
  private readonly entities: QcEntityMemory;
  private readonly slots = new Map<ActorId, number>();
  private readonly actors = new Map<number, ActorId>();
  private readonly free = new Set<number>();
  private readonly projectiles = new Set<number>();
  private readonly retired = new Set<number>();
  private readonly bound = new Set<number>();
  private sourceTime = 0;
  private random: RandomSource;
  private spawned: number[] | null = null;
  private launching: WeaponBehaviorLaunch | null = null;
  constructor(private readonly options: QcWeaponBehaviorOptions) {
    const capability = qcWeaponBehaviorCapabilityError(options.program);
    if (capability !== null) throw new Error(capability);
    this.definition = options.definition; this.random = options.random;
    if (options.definition.module.digest !== options.program.digest || options.definition.fire.kind !== 'quakec'
      || options.definition.activate !== null && options.definition.activate.kind !== 'quakec') throw new Error('Weapon behavior requires its exact declared QuakeC artifact');
    for (const callback of [this.definition.fire, this.definition.activate]) {
      if (callback === null) continue;
      if (callback.kind !== 'quakec') throw new Error('Behavior callback is not QuakeC');
      const module = callback.module, expected = this.definition.module;
      if (module.id !== expected.id || module.digest !== expected.digest || module.revision !== expected.revision || module.artifactPath !== expected.artifactPath
        || callback.kind !== 'quakec' || callback.functionIndex <= 0 || options.program.functions[callback.functionIndex]?.firstStatement === undefined
        || (options.program.functions[callback.functionIndex]?.firstStatement ?? -1) < 0
        || options.program.functions[callback.functionIndex]?.parameterSizes.length !== 0) throw new Error('Behavior callback identity differs from its source module');
    }
    this.entities = new QcEntityMemory(classicQcEntityLayout(options.program), 8192);
    const host = this.builtins();
    this.machine = new QcMachine({ program: options.program, entities: this.entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      builtins: createQcBuiltins({ kind: options.program.api.kind === 'q1-quakeworld' ? 'quakeworld' : 'netquake', random: { nextInteger: () => this.random.nextInteger(), nextUnit: () => this.random.nextUnit(), checkpoint: () => this.random.checkpoint() },
        host, isFreeEntity: slot => this.free.has(slot) }), serverActive: () => true });
    this.global('deathmatch', options.mode === 'deathmatch' ? 1 : 0); this.global('coop', options.mode === 'coop' ? 1 : 0);
  }
  private field(name: string): number {
    const field = this.options.program.fieldsByName.get(name); if (field === undefined) throw new Error(`Behavior source lacks entity field ${name}`); return field.offset;
  }
  private global(name: string, value: number): void {
    const field = this.options.program.globalsByName.get(name); if (field !== undefined) this.machine.globals.setFloat(field.offset, value);
  }
  private allocate(): number {
    const available = this.free.values().next();
    if (!available.done) { this.free.delete(available.value); this.entities.at(available.value).bytes.fill(0); return available.value; }
    const slot = this.entities.count; this.entities.setCount(slot + 1); return slot;
  }
  private reference(actor: ActorId): number {
    for (const slot of this.projectiles) if (this.actors.get(slot) === actor) return this.entities.reference(slot);
    let slot = this.slots.get(actor);
    if (slot === undefined) { slot = this.allocate(); this.slots.set(actor, slot); this.actors.set(slot, actor); }
    return this.entities.reference(slot);
  }
  private projectBody(slot: number, body: BodyState): void {
    const fields = this.entities.at(slot);
    fields.setVector(this.field('origin'), body.origin); fields.setVector(this.field('velocity'), body.velocity); fields.setVector(this.field('angles'), body.angles);
    fields.setVector(this.field('mins'), body.bounds.min); fields.setVector(this.field('maxs'), body.bounds.max);
  }
  private refreshTargets(excluded: ActorId | null = null): void {
    const live = new Set<ActorId>();
    for (const target of this.options.targets()) {
      if (target.actor === excluded) continue;
      live.add(target.actor); const slot = this.entities.slot(this.reference(target.actor)), fields = this.entities.at(slot);
      if (this.projectiles.has(slot)) continue;
      this.projectBody(slot, target.body); fields.setFloat(this.field('health'), target.health); fields.setFloat(this.field('solid'), target.solid ? 2 : 0);
      fields.setInt(this.field('classname'), this.machine.strings.allocate(target.classname)); fields.setInt(this.field('netname'), this.machine.strings.allocate(target.name));
    }
    for (const [actor, slot] of this.slots) if (!live.has(actor)) { this.entities.at(slot).setFloat(this.field('health'), 0); this.entities.at(slot).setFloat(this.field('solid'), 0); }
  }
  private invoke(functionIndex: number, slot: number, time: number): void {
    const vm = this.machine, self = vm.globalOffset('self'), other = vm.globalOffset('other'), priorSelf = vm.globals.int(self), priorOther = vm.globals.int(other);
    vm.globals.setInt(self, this.entities.reference(slot)); vm.globals.setInt(other, 0); this.global('time', time);
    try { vm.execute(functionIndex); } finally { vm.globals.setInt(self, priorSelf); vm.globals.setInt(other, priorOther); }
  }
  attach(launch: WeaponBehaviorLaunch): WeaponBehaviorInstance | null {
    if (launch.role !== this.definition.role) throw new Error('Source behavior projectile role differs');
    if (this.launching !== null) throw new Error('Weapon behavior launch is already active');
    this.sourceTime = launch.timeSeconds;
    this.refreshTargets(launch.projectile.id); const shooter = this.entities.slot(this.reference(launch.shooter));
    const source = this.entities.at(shooter); source.setVector(this.field('v_angle'), source.vector(this.field('angles')));
    const fire = this.definition.fire, activate = this.definition.activate;
    if (fire.kind !== 'quakec' || activate !== null && activate.kind !== 'quakec') throw new Error('Behavior callback is not QuakeC');
    this.launching = launch; const spawned: number[] = []; this.spawned = spawned;
    try {
      if (activate !== null) this.invoke(activate.functionIndex, shooter, launch.timeSeconds);
      this.invoke(fire.functionIndex, shooter, launch.timeSeconds);
    } catch (error: unknown) {
      for (const slot of spawned) { this.retired.delete(slot); this.free.add(slot); }
      throw error;
    } finally { this.launching = null; this.spawned = null; }
    if (spawned.length === 0) return null; // The source activation or weapon gate declined the shot.
    if (spawned.length !== 1) { for (const slot of spawned) { this.retired.delete(slot); this.free.add(slot); } throw new Error('Behavior source produced multiple actors; a declared multi-projectile composition is required'); }
    const slot = spawned[0]; if (slot === undefined) throw new Error('Behavior projectile was not captured');
    this.actors.set(slot, launch.projectile.id); this.projectiles.add(slot);
    return this.instance(slot);
  }
  resume(projectile: ActorId): WeaponBehaviorInstance {
    for (const slot of this.projectiles) if (this.actors.get(slot) === projectile) return this.instance(slot);
    throw new Error('Saved projectile has no restored QuakeC behavior');
  }
  private instance(slot: number): WeaponBehaviorInstance {
    if (this.bound.has(slot)) throw new Error('QuakeC projectile behavior already has an attachment');
    this.bound.add(slot);
    let closed = false;
    const initial = this.entities.at(slot);
    return { definition: this.definition, initial: { origin: initial.vector(this.field('origin')), velocity: initial.vector(this.field('velocity')), angles: initial.vector(this.field('angles')) },
      step: (body, time) => {
        if (closed || this.retired.has(slot)) return null;
        this.sourceTime = time;
        this.refreshTargets(); this.projectBody(slot, body);
        const fields = this.entities.at(slot), next = fields.float(this.field('nextthink'));
        if (next <= 0 || next > time) return null;
        const callback = fields.int(this.field('think')); if (callback === 0) return null;
        fields.setFloat(this.field('nextthink'), 0); this.invoke(callback, slot, time);
        if (this.retired.has(slot)) return null;
        return { origin: fields.vector(this.field('origin')), velocity: fields.vector(this.field('velocity')), angles: fields.vector(this.field('angles')) };
      },
      close: () => { if (!closed) { closed = true; this.bound.delete(slot); this.retired.delete(slot); this.free.add(slot); this.actors.delete(slot); this.projectiles.delete(slot); } },
    };
  }
  checkpoint(): QuakeCWeaponBehaviorCheckpoint {
    if (this.launching !== null) throw new Error('Cannot save during a weapon behavior launch');
    return { version: 1, definition: this.definition, mode: this.options.mode, sourceTime: this.sourceTime, random: this.random.checkpoint(), machine: this.machine.snapshot(), free: [...this.free], retired: [...this.retired],
      bindings: [...this.actors].map(([slot, actor]) => ({ slot, actor: { slot: actor.slot, generation: actor.generation }, kind: this.projectiles.has(slot) ? 'projectile' : 'target' })) };
  }
  restore(checkpoint: QuakeCWeaponBehaviorCheckpoint, actorReference: (saved: SavedActorId) => ActorId, random: RandomSource): void {
    if (checkpoint.version !== 1 || !sameWeaponBehavior(checkpoint.definition, this.definition) || checkpoint.mode !== this.options.mode
      || !Number.isFinite(checkpoint.sourceTime) || this.actors.size !== 0 || this.launching !== null) throw new Error('Incompatible QuakeC weapon behavior checkpoint');
    if (JSON.stringify(random.checkpoint()) !== JSON.stringify(checkpoint.random)) throw new Error('Weapon behavior random source was not restored');
    const count = checkpoint.machine.entityCount, occupied = new Set<number>(), free = new Set<number>();
    const validSlot = (slot: number): boolean => Number.isSafeInteger(slot) && slot > 0 && slot < count;
    for (const slot of checkpoint.free) { if (!validSlot(slot) || free.has(slot)) throw new Error('Invalid saved behavior free slot'); free.add(slot); }
    const references = new Set<ActorId>();
    const bindings = checkpoint.bindings.map(binding => {
      if (!validSlot(binding.slot) || occupied.has(binding.slot) || free.has(binding.slot)) throw new Error('Invalid saved behavior entity slot');
      occupied.add(binding.slot); const actor = actorReference(binding.actor);
      if (references.has(actor)) throw new Error('Duplicate saved behavior actor reference'); references.add(actor);
      return { ...binding, actor };
    });
    if (occupied.size + free.size !== count - 1) throw new Error('Saved behavior entity ownership is incomplete');
    const retired = new Set<number>();
    for (const slot of checkpoint.retired) {
      if (retired.has(slot) || !bindings.some(binding => binding.slot === slot && binding.kind === 'projectile')) throw new Error('Invalid retired behavior slot');
      retired.add(slot);
    }
    this.machine.restore(checkpoint.machine); this.random = random; this.sourceTime = checkpoint.sourceTime;
    for (const slot of free) this.free.add(slot);
    for (const slot of retired) this.retired.add(slot);
    for (const binding of bindings) {
      this.actors.set(binding.slot, binding.actor);
      if (binding.kind === 'projectile') this.projectiles.add(binding.slot); else this.slots.set(binding.actor, binding.slot);
    }
  }
  private builtins(): ReadonlyMap<QcHostBuiltinName, QcBuiltin> {
    const host = new Map<QcHostBuiltinName, QcBuiltin>();
    host.set('spawn', vm => { if (this.spawned === null) return vm.fail('Trajectory callback spawned an undeclared additional actor'); const slot = this.allocate(); this.spawned.push(slot); vm.returnInt(this.entities.reference(slot)); });
    host.set('remove', vm => { const slot = this.entities.slot(vm.argInt(0)); if (!this.projectiles.has(slot) && !this.spawned?.includes(slot)) return vm.fail('Trajectory behavior cannot remove another owner’s actor'); this.retired.add(slot); });
    host.set('setorigin', vm => { this.entities.fromReference(vm.argInt(0)).setVector(this.field('origin'), vm.argVector(1)); });
    host.set('setsize', vm => { const fields = this.entities.fromReference(vm.argInt(0)); fields.setVector(this.field('mins'), vm.argVector(1)); fields.setVector(this.field('maxs'), vm.argVector(2)); });
    host.set('setmodel', vm => {
      const model = this.options.model(vm.argString(1)); if (model === null) return vm.fail(`No source model: ${vm.argString(1)}`);
      const fields = this.entities.fromReference(vm.argInt(0)); fields.setInt(this.field('model'), vm.argInt(1)); fields.setFloat(this.field('modelindex'), model.index);
      fields.setVector(this.field('mins'), model.bounds.min); fields.setVector(this.field('maxs'), model.bounds.max);
    });
    // Presentation belongs to the selected launcher, so captured donor sound does not publish a second weapon sound.
    host.set('sound', () => undefined);
    host.set('sprint', vm => { this.options.print(this.actors.get(this.entities.slot(vm.argInt(0))) ?? null, vm.varString(1)); });
    host.set('bprint', vm => { this.options.print(null, vm.varString(0)); });
    host.set('dprint', vm => { this.options.print(null, vm.varString(0)); });
    host.set('aim', vm => { const actor = this.actors.get(this.entities.slot(vm.argInt(0))); if (actor === undefined) return vm.fail('Behavior aim has no shared shooter'); vm.returnVector(this.options.aim(actor, vm.argFloat(1))); });
    host.set('pointcontents', vm => {
      const sample = this.options.scene.pointContents({ point: vm.argVector(0), target: { kind: 'world' }, policy: { kind: 'q1', move: 'normal', hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
      if (sample.kind !== 'q1') return vm.fail('Behavior contents lost source dialect'); vm.returnFloat(sample.contents);
    });
    host.set('traceline', vm => {
      const mode = Math.trunc(vm.argFloat(2)), actor = this.actors.get(this.entities.slot(vm.argInt(3))) ?? this.launching?.projectile.id ?? null;
      const trace = this.options.scene.trace({ start: vm.argVector(0), end: vm.argVector(1), shape: { kind: 'point' }, target: { kind: 'world' },
        policy: { kind: 'q1', move: mode === 1 ? 'no-monsters' : mode === 2 ? 'missile' : 'normal', hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor });
      if (trace.kind !== 'q1') return vm.fail('Behavior trace lost source dialect');
      for (const [name, value] of [['trace_fraction', trace.fraction], ['trace_allsolid', Number(trace.allSolid)], ['trace_startsolid', Number(trace.startSolid)], ['trace_inwater', Number(trace.inWater)], ['trace_inopen', Number(trace.inOpen)], ['trace_plane_dist', trace.sourcePlane.distance]] satisfies readonly (readonly [string, number])[]) this.global(name, value);
      vm.globals.setVector(vm.globalOffset('trace_endpos'), trace.end); vm.globals.setVector(vm.globalOffset('trace_plane_normal'), trace.sourcePlane.normal);
      vm.globals.setInt(vm.globalOffset('trace_ent'), trace.hit.kind === 'actor' ? this.reference(trace.hit.actor) : 0);
    });
    host.set('findradius', vm => {
      const center = vm.argVector(0), radius = vm.argFloat(1), n = vm.numeric; let chain = 0;
      for (let slot = 1; slot < this.entities.count; slot++) {
        if (this.free.has(slot) || this.retired.has(slot)) continue; const fields = this.entities.at(slot); if (fields.float(this.field('solid')) === 0) continue;
        const origin = fields.vector(this.field('origin')), min = fields.vector(this.field('mins')), max = fields.vector(this.field('maxs'));
        const distance = (c: number, o: number, a: number, b: number) => n.subtract(c, n.add(o, n.multiply(n.add(a, b), 0.5)));
        const x = distance(center.x, origin.x, min.x, max.x), y = distance(center.y, origin.y, min.y, max.y), z = distance(center.z, origin.z, min.z, max.z);
        if (n.squareRoot(n.add(n.add(n.multiply(x, x), n.multiply(y, y)), n.multiply(z, z))) > radius) continue;
        fields.setInt(this.field('chain'), chain); chain = this.entities.reference(slot);
      }
      vm.returnInt(chain);
    });
    return host;
  }
}

export function readQuakeCWeaponBehaviorCheckpoint(reader: SaveReader, expected: WeaponBehaviorDefinition): QuakeCWeaponBehaviorCheckpoint {
  const machine = reader.field('machine');
  return { version: reader.field('version').literal(1), definition: readWeaponBehaviorDefinition(reader.field('definition'), expected),
    mode: reader.field('mode').choice('singleplayer', 'coop', 'deathmatch'), sourceTime: reader.field('sourceTime').finite(), random: readRandom(reader.field('random')),
    machine: { globals: machine.field('globals').bytes(), entities: machine.field('entities').bytes(), entityCount: machine.field('entityCount').integer(1),
      strings: machine.field('strings').bytes(), statement: machine.field('statement').integer(), functionIndex: machine.field('functionIndex').literal(0),
      argumentCount: machine.field('argumentCount').integer(0), profiling: machine.field('profiling').list(value => value.integer(0)), traceEnabled: machine.field('traceEnabled').boolean() },
    free: reader.field('free').list(value => value.integer(1)), retired: reader.field('retired').list(value => value.integer(1)),
    bindings: reader.field('bindings').list(entry => ({ slot: entry.field('slot').integer(1), actor: readSavedActor(entry.field('actor')), kind: entry.field('kind').choice('target', 'projectile') })) };
}
