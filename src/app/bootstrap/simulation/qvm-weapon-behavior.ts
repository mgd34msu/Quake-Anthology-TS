import { parseQ1Entities, q1EntityValue } from '../../../formats/q1-map/entities.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import type { BodyState } from '../../../contracts/world.ts';
import type { QvmCheckpoint } from '../../../contracts/execution.ts';
import type { SavedActorId } from '../../../contracts/session.ts';
import type { WeaponBehaviorSource, WeaponBehaviorInstance, WeaponBehaviorLaunch, WeaponTrajectoryUpdate, WeaponBehaviorDefinition } from '../../../contracts/weapon-behavior.ts';
import { sameWeaponBehavior } from '../../../contracts/weapon-behavior.ts';
import { QvmGame } from '../../../compat/qvm/game.ts';
import { QvmOpcode } from '../../../compat/qvm/image.ts';
import type { QvmModuleOptions } from '../../../compat/qvm/module.ts';
import type { QvmWeaponProfile } from '../../../compat/qvm/weapon-behavior-profile.ts';
import { validateQvmWeaponProfile } from '../../../compat/qvm/weapon-behavior-profile.ts';
import type { QvmHostCall, QvmHostResult } from '../../../compat/qvm/syscalls.ts';
import { rejectQvmSyscall } from '../../../compat/qvm/syscalls.ts';
import { QvmGameImport } from '../../../compat/qvm/abi.ts';
import { qvmCommonSyscall, type QvmCommonServices } from '../../../compat/qvm/common-syscalls.ts';
import { qvmServerGameSyscall, type QvmServerGameServices } from '../../../compat/qvm/server-game-syscalls.ts';
import { QvmFiles, qvmFileSyscall } from '../../../compat/qvm/file-syscalls.ts';
import { CvarRegistry } from '../../../core/cvars/index.ts';
import type { CommandContext } from '../../../contracts/common.ts';
import { CommonParseCursor, CommonParseState } from '../../../core/common-parse.ts';
import { Q3_BINARY32_PROFILE } from '../../../core/numeric.ts';
import type { MountedContent } from '../../../content/mounts/index.ts';
import type { SharedSceneQueries } from '../../../world/collision/index.ts';
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from '../../../persistence/value.ts';
import { readGuest } from '../../../persistence/execution.ts';
import { readVector } from '../../../persistence/shared.ts';
import { readSavedActor } from '../../../persistence/save-image.ts';
import { readWeaponBehaviorDefinition } from '../../../world/gameplay/weapon-behaviors.ts';

export type QvmWeaponTarget = { readonly actor: ActorId; readonly body: BodyState; readonly health: number } & ({ readonly kind: 'actor' } | { readonly kind: 'player'; readonly userinfo: string; readonly team: 'free' | 'red' | 'blue' | 'spectator' });
export interface QvmWeaponBehaviorOptions {
  readonly artifact: QvmModuleOptions['artifact'];
  readonly profile: QvmWeaponProfile;
  readonly mounts: MountedContent;
  readonly scene: SharedSceneQueries;
  readonly context: CommandContext;
  readonly seed: number;
  readonly entityText: string;
  readonly mode: 'singleplayer' | 'coop' | 'deathmatch';
  readonly teamMode: boolean;
  readonly realTime: Extract<QvmCommonServices, { role: 'qagame' }>['realTime'];
  targets(): readonly QvmWeaponTarget[];
  print(text: string): void;
  assertCurrent(): void;
}
interface Binding { readonly actor: ActorId; readonly pointer: number; readonly kind: 'target' | 'client' | 'projectile'; }
export interface QvmWeaponBehaviorCheckpoint {
  readonly version: 1;
  readonly definition: WeaponBehaviorDefinition;
  readonly module: QvmCheckpoint;
  readonly profileDigest: string;
  readonly activated: readonly SavedActorId[];
  readonly bindings: readonly { readonly actor: SavedActorId; readonly pointer: number; readonly kind: Binding['kind'] }[];
  readonly retired: readonly { readonly actor: SavedActorId; readonly trajectory: WeaponTrajectoryUpdate }[];
}
/** Executes source callbacks, never a second game frame or selected projectile impact. */
export class QvmWeaponBehaviorSource implements WeaponBehaviorSource {
  readonly definition: WeaponBehaviorDefinition;
  private readonly profile: QvmWeaponProfile;
  private readonly game: QvmGame;
  private readonly cvars: CvarRegistry;
  private readonly files: QvmFiles;
  private readonly configstrings = new Map<number, string>();
  private readonly bindings = new Map<ActorId, Binding>();
  private readonly retired = new Map<ActorId, WeaponTrajectoryUpdate>();
  private readonly instances = new Set<ActorId>();
  private readonly activated = new Set<ActorId>();
  private readonly userinfo = new Map<number, string>();
  private readonly cursor: CommonParseCursor;
  private readonly parser = new CommonParseState();
  private readonly services: QvmServerGameServices;
  private time = 0;
  private ready = false;
  private closed = false;
  private busy = false;
  private generation = 0;
  private constructor(private readonly options: QvmWeaponBehaviorOptions) {
    this.profile = validateQvmWeaponProfile(options.profile, options.artifact); this.definition = this.profile.definition;
    this.cursor = new CommonParseCursor(qvmWeaponInitializationEntities(options.entityText));
    this.cvars = new CvarRegistry({ dialect: 'q3', context: options.context, print: options.print });
    for (const [name, value] of [['g_log', ''], ['cm_noCurves', '0'], ['cm_playerCurveClip', '1'], ['bot_enable', '0'], ['sv_maxclients', '64'], ['dedicated', '1'], ['g_gametype', options.teamMode ? '3' : '0']]) {
      if (name !== undefined && value !== undefined) this.cvars.register(name, value, 0);
    }
    this.files = new QvmFiles({ mounts: options.mounts, writable: null, print: options.print, assertCurrent: () => this.current() });
    this.game = new QvmGame({ artifact: options.artifact, host: call => this.host(call), hostState: {
      checkpoint: () => ({ state: { module: this.definition.module, format: 'q3:weapon-host', bytes: encodeCheckpointValue({
        version: 1, mode: options.mode, teamMode: options.teamMode, time: this.time, data: this.game.data.checkpoint(), cvars: this.cvars.captureSaveState(),
        configstrings: [...this.configstrings].map(([index, value]) => ({ index, value })), files: this.files.captureCheckpoint(),
        entityText: this.cursor.source, userinfo: [...this.userinfo].map(([slot, value]) => ({ slot, value })), cursor: this.cursor.offset, parser: this.parser.captureSaveState(),
      }) }, random: [], callbacks: [] }),
      restore: checkpoint => {
        if (checkpoint.state.format !== 'q3:weapon-host' || checkpoint.random.length !== 0 || checkpoint.callbacks.length !== 0) throw new Error('Invalid QVM weapon host checkpoint');
        const reader = new SaveReader(decodeCheckpointValue(checkpoint.state.bytes), 'qvm.weapon.host'); reader.field('version').literal(1);
        reader.field('entityText').literal(this.cursor.source); reader.field('mode').literal(options.mode); reader.field('teamMode').literal(options.teamMode); this.time = reader.field('time').number();
        if (!Number.isFinite(this.time) || this.time < 0) throw reader.fail('invalid source time');
        const data = reader.field('data'); this.game.data.restore({ entitiesWord: data.field('entitiesWord').integer(), numEntities: data.field('numEntities').integer(0), entityStride: data.field('entityStride').integer(0), clientsWord: data.field('clientsWord').integer(), clientStride: data.field('clientStride').integer(0) });
        this.cvars.restoreSaveState(reader.field('cvars').value); this.configstrings.clear(); this.userinfo.clear();
        for (const entry of reader.field('userinfo').list(cell => ({ slot: cell.field('slot').integer(0), value: cell.field('value').string() }))) { if (entry.slot >= 64 || this.userinfo.has(entry.slot)) throw new Error('Invalid component client userinfo'); this.userinfo.set(entry.slot, entry.value); }
        for (const row of reader.field('configstrings').list(cell => ({ index: cell.field('index').integer(0), value: cell.field('value').string() }))) {
          if (row.index >= 1024 || this.configstrings.has(row.index)) throw new Error('Invalid saved component configstring'); this.configstrings.set(row.index, row.value);
        }
        this.cursor.offset = reader.field('cursor').nullable(cell => cell.integer(0)); this.parser.restoreSaveState(reader.field('parser').value);
        this.files.restoreCheckpoint(reader.field('files').value); return undefined;
      },
    } });
    this.game.data.setClientCount(64);
    const forbidden = (operation: string): never => { throw new Error(`QVM trajectory component cannot ${operation}`); };
    this.services = { data: this.game.data, cvars: this.cvars, maxClients: 64,
      configstrings: { get: index => this.configstrings.get(index) ?? '', set: (index, value) => { this.configstrings.set(index, value); } },
      getUserinfo: slot => this.userinfo.get(slot) ?? '', setUserinfo: (slot, value) => { this.userinfo.set(slot, value); },
      getUserCommand: () => ({ serverTime: Math.round(this.time * 1000), angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }),
      dropClient: () => forbidden('drop a primary client'), sendServerCommand: () => undefined,
      entityToken: () => ({ token: this.parser.parse(this.cursor), ended: this.cursor.offset === null }),
      spatial: {
        trace: input => {
          const trace = options.scene.trace({ start: input.start, end: input.end, shape: input.shape, target: { kind: 'world' },
            numeric: Q3_BINARY32_PROFILE, passActor: this.actorForSlot(input.passEntityNum), policy: { kind: 'q3', contentsMask: input.mask, curves: this.cvars.variableValue('cm_noCurves') === 0, playerCurveClip: this.cvars.variableValue('cm_playerCurveClip') !== 0 } });
          if (trace.kind !== 'q3') throw new Error('QVM weapon trace lost its source policy');
          return { fraction: trace.fraction, end: trace.end, allSolid: trace.allSolid, startSolid: trace.startSolid, contents: trace.contents, surfaceFlags: trace.surfaceFlags, plane: trace.sourcePlane,
            entityNum: trace.hit.kind === 'actor' ? this.slot(this.mirror(trace.hit.actor)) : trace.fraction === 1 ? 1023 : 1022 };
        },
        pointContents: (point, pass) => {
          const sample = options.scene.pointContents({ point, target: { kind: 'world' }, passActor: this.actorForSlot(pass), numeric: Q3_BINARY32_PROFILE,
            policy: { kind: 'q3', contentsMask: -1, curves: true, playerCurveClip: true } });
          if (sample.kind !== 'q3') throw new Error('QVM weapon contents lost its source policy'); return sample.contents;
        },
        areaEntities: (bounds, maximum) => { const actors = options.scene.queryActors(bounds); return (maximum < 0 ? actors : actors.slice(0, maximum)).map(actor => this.slot(this.mirror(actor.body.actor))); },
        entityContact: () => forbidden('perform undeclared brush contact'), setBrushModel: () => forbidden('bind a primary brush'), adjustAreaPortalState: () => forbidden('change world portals'),
        inPvs: (first, second, ignore) => {
          const a = options.scene.pointLeaf(first), b = options.scene.pointLeaf(second);
          return options.scene.clusterVisible(options.scene.leafCluster(a), options.scene.leafCluster(b), 'pvs') && (ignore || options.scene.areasConnected(options.scene.leafArea(a), options.scene.leafArea(b)));
        },
        areasConnected: (first, second) => options.scene.areasConnected(first, second),
        link: slot => {
          const r = this.game.data.entity(slot).r; r.linked = true;
          r.absmin = { x: r.currentOrigin.x + r.mins.x - 1, y: r.currentOrigin.y + r.mins.y - 1, z: r.currentOrigin.z + r.mins.z - 1 };
          r.absmax = { x: r.currentOrigin.x + r.maxs.x + 1, y: r.currentOrigin.y + r.maxs.y + 1, z: r.currentOrigin.z + r.maxs.z + 1 };
        }, unlink: slot => { this.game.data.entity(slot).r.linked = false; },
      },
    };
  }
  static async create(options: QvmWeaponBehaviorOptions): Promise<QvmWeaponBehaviorSource> {
    const source = new QvmWeaponBehaviorSource(options);
    try { await source.game.initializeAsync(0, options.seed); source.validateLayout(); source.ready = true; return source; }
    catch (error) { try { source.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'QVM weapon initialization and cleanup failed'); } throw error; }
  }
  private current(): void { this.options.assertCurrent(); if (this.closed) throw new Error('QVM weapon source is closed'); }
  private validateLayout(): void { if (this.game.data.entityStrideBytes !== this.profile.entityStride) throw new Error('QVM weapon private layout differs from located source data'); }
  private host(call: QvmHostCall): QvmHostResult {
    this.current();
    const rejectCommand = (): never => { throw new Error('QVM weapon callback cannot execute server commands'); };
    const result = qvmCommonSyscall(call, { role: 'qagame', cvars: this.cvars, print: this.options.print, milliseconds: () => Math.round(this.time * 1000), arguments: () => [], realTime: this.options.realTime,
      commands: { executeNow: rejectCommand, append: rejectCommand, insert: rejectCommand } }) ?? qvmFileSyscall(call, this.files) ?? qvmServerGameSyscall(call, this.services);
    if (result !== null) return result;
    if (call.kind === 'engine' && call.role === 'qagame' && (call.code === QvmGameImport.BOTLIB_SETUP || call.code === QvmGameImport.BOTLIB_AAS_INITIALIZED)) return 0;
    return rejectQvmSyscall(call);
  }
  private operation<T>(run: () => T): T {
    this.current(); if (!this.ready || this.busy) throw new Error('QVM weapon source is unready or already executing');
    this.busy = true; try { return run(); } finally { this.busy = false; }
  }
  private setTime(time: number): void {
    const milliseconds = Math.round(time * 1000);
    if (!Number.isFinite(time) || time < this.time || milliseconds > 0x7fffffff) throw new Error('Invalid QVM weapon source time');
    this.time = time; this.game.module.memory.view(this.profile.levelTime, 4).setInt32(0, milliseconds, true);
  }
  private slot(pointer: number): number {
    const slot = this.game.data.numberFromPointer(pointer);
    if (pointer <= 0 || this.game.data.entityBytes(slot).byteOffset - this.game.module.memory.bytes.byteOffset !== pointer) throw new Error('Noncanonical QVM entity pointer');
    return slot;
  }
  private live(pointer: number): boolean { return this.game.data.entityBytes(this.slot(pointer)).getInt32(this.profile.fields.inuse, true) !== 0; }
  private project(pointer: number, body: BodyState): void {
    const entity = this.game.data.entityFromPointer(pointer); entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles; entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
    entity.s.origin = body.origin; entity.s.angles = body.angles; entity.s.pos = { ...entity.s.pos, base: body.origin, delta: body.velocity, time: Math.round(this.time * 1000) };
  }
  private trajectory(pointer: number): WeaponTrajectoryUpdate { const entity = this.game.data.entityFromPointer(pointer); return { origin: entity.r.currentOrigin, velocity: entity.s.pos.delta, angles: entity.r.currentAngles }; }
  private actorForSlot(slot: number): ActorId | null { for (const binding of this.bindings.values()) if (this.slot(binding.pointer) === slot) return binding.actor; return null; }
  private mirror(actor: ActorId): number {
    const target = this.options.targets().find(value => value.actor === actor); if (target === undefined) throw new Error('QVM weapon query refers to an unavailable shared actor');
    let binding = this.bindings.get(actor);
    if (binding === undefined) {
      if (target.kind === 'player') {
        let slot = 0; while (slot < 64 && this.userinfo.has(slot)) slot++;
        if (slot === 64) throw new Error('QVM weapon source exhausted its admitted client capacity');
        const record = this.game.data.entityBytes(slot), pointer = record.byteOffset - this.game.module.memory.bytes.byteOffset;
        if (pointer === 0) throw new Error('QVM client entity cannot use a null pointer');
        binding = { actor, pointer, kind: 'client' }; this.bindings.set(actor, binding); this.userinfo.set(slot, target.userinfo);
        try {
          const denial = this.game.clientConnect(slot, true, false); if (denial !== null) throw new Error(`QVM weapon source rejected client: ${denial}`);
          this.game.clientBegin(slot);
        } catch (error) { this.bindings.delete(actor); this.userinfo.delete(slot); throw error; }
      } else {
        const pointer = this.game.module.call([], this.profile.allocate); this.slot(pointer);
        if (!this.live(pointer) || [...this.bindings.values()].some(entry => entry.pointer === pointer)) throw new Error('QVM source allocated an occupied or inactive entity');
        binding = { actor, pointer, kind: 'target' }; this.bindings.set(actor, binding);
      }
    }
    if (target.kind === 'player') {
      if (binding.kind !== 'client') throw new Error('QVM mirrored actor changed client ownership');
      const slot = this.slot(binding.pointer);
      if (this.userinfo.get(slot) !== target.userinfo) { this.userinfo.set(slot, target.userinfo); this.game.clientUserinfoChanged(slot); }
      const teamNumbers = { free: 0, red: 1, blue: 2, spectator: 3 };
      const desiredTeam = teamNumbers[target.team];
      if (target.team !== 'spectator' && (this.options.teamMode ? target.team === 'free' : target.team !== 'free')) throw new Error('QVM player team differs from selected source team mode');
      // PERS_TEAM is public playerState.persistant[3] in both supported source ABIs.
      if (this.game.data.publicPlayerBytes(slot).getInt32(260, true) !== desiredTeam) this.game.clientCommand(slot, ['team', target.team]);
      const ps = this.game.data.publicPlayerBytes(slot);
      if (ps.getInt32(260, true) !== desiredTeam) throw new Error(`QVM source did not admit the requested ${target.team} team`);
      for (const [offset, vector] of [[20, target.body.origin], [152, target.body.angles]] satisfies readonly (readonly [number, BodyState['origin']])[]) {
        ps.setFloat32(offset, vector.x, true); ps.setFloat32(offset + 4, vector.y, true); ps.setFloat32(offset + 8, vector.z, true);
      }
      ps.setInt32(184, Math.trunc(target.health), true);
    }
    this.project(binding.pointer, target.body); this.game.data.entityBytes(this.slot(binding.pointer)).setInt32(this.profile.fields.health, Math.trunc(target.health), true); return binding.pointer;
  }
  private refreshTargets(exclude?: ActorId): void {
    const targets = this.options.targets(), actors = new Set(targets.map(target => target.actor));
    for (const binding of [...this.bindings.values()]) if (binding.kind !== 'projectile' && !actors.has(binding.actor)) this.release(binding.actor);
    for (const target of targets) if (target.actor !== exclude && this.bindings.get(target.actor)?.kind !== 'projectile') this.mirror(target.actor);
  }
  attach(launch: WeaponBehaviorLaunch): WeaponBehaviorInstance {
    return this.operation(() => {
      this.setTime(launch.timeSeconds); this.refreshTargets(launch.projectile.id);
      if (launch.role !== this.definition.role || this.bindings.has(launch.projectile.id)) throw new Error('QVM weapon launch role or ownership differs');
      const shooter = this.mirror(launch.shooter), entity = this.game.data.entityFromPointer(shooter);
      if (this.definition.activate !== null && !this.activated.has(launch.shooter)) {
        if (this.definition.activate.kind !== 'qvm') throw new Error('Invalid QVM activation identity'); this.game.module.call([shooter], this.definition.activate.instructionIndex); this.activated.add(launch.shooter);
      }
      const length = Math.hypot(launch.body.velocity.x, launch.body.velocity.y, launch.body.velocity.z);
      if (!(length > 0)) throw new Error('QVM source firing requires a projectile direction');
      const direction = { x: launch.body.velocity.x / length, y: launch.body.velocity.y / length, z: launch.body.velocity.z / length };
      entity.r.currentOrigin = launch.body.origin; entity.s.pos = { ...entity.s.pos, delta: direction };
      const startOffset = (this.options.artifact.abiProfile ?? 'q3-modern') === 'q3-modern' ? 488 : 476;
      if (this.definition.fire.kind !== 'qvm') throw new Error('Invalid QVM fire identity');
      const pointer = this.game.module.call([shooter, shooter + startOffset, shooter + 36], this.definition.fire.instructionIndex);
      this.slot(pointer);
      if (!this.live(pointer) || this.game.data.entityFromPointer(pointer).s.eType !== 3 || [...this.bindings.values()].some(binding => binding.pointer === pointer)) throw new Error('QVM fire did not return a new owned missile');
      this.bindings.set(launch.projectile.id, { actor: launch.projectile.id, pointer, kind: 'projectile' }); return this.instance(launch.projectile.id);
    });
  }
  private instance(actor: ActorId): WeaponBehaviorInstance {
    if (this.instances.has(actor)) throw new Error('QVM projectile already has an instance');
    const binding = this.bindings.get(actor), initial = this.retired.get(actor) ?? (binding === undefined ? null : this.trajectory(binding.pointer));
    if (initial === null || binding !== undefined && binding.kind !== 'projectile') throw new Error('No retained QVM trajectory projectile');
    this.instances.add(actor); const generation = this.generation; let closed = false;
    return { definition: this.definition, initial, step: (body, time) => this.operation(() => {
      if (closed || generation !== this.generation) throw new Error('QVM trajectory instance is closed'); this.setTime(time); this.refreshTargets();
      const current = this.bindings.get(actor); if (current === undefined) return null;
      const retire = (): null => { this.retired.set(actor, { origin: body.origin, velocity: body.velocity, angles: body.angles }); this.bindings.delete(actor); return null; };
      if (!this.live(current.pointer)) return retire(); this.project(current.pointer, body);
      const fields = this.game.data.entityBytes(this.slot(current.pointer)), next = fields.getInt32(this.profile.fields.nextthink, true);
      if (next <= 0 || next > Math.round(time * 1000)) return null;
      const entry = fields.getInt32(this.profile.fields.think, true);
      if (entry <= 0 || this.options.artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error('Invalid source projectile think callback');
      fields.setInt32(this.profile.fields.nextthink, 0, true); this.game.module.call([current.pointer], entry);
      if (!this.live(current.pointer)) return retire();
      if (this.game.data.entityFromPointer(current.pointer).s.eType !== 3) { this.game.module.call([current.pointer], this.profile.free); return retire(); }
      return this.trajectory(current.pointer);
    }), close: () => { if (closed) return; closed = true; if (generation !== this.generation) return; this.instances.delete(actor); this.release(actor); } };
  }
  resume(actor: ActorId): WeaponBehaviorInstance { this.current(); return this.instance(actor); }
  private release(actor: ActorId): void {
    this.retired.delete(actor); this.activated.delete(actor); const binding = this.bindings.get(actor); if (binding === undefined) return; this.bindings.delete(actor);
    if (binding.kind === 'client') { const slot = this.slot(binding.pointer); try { this.game.clientDisconnect(slot); } finally { this.userinfo.delete(slot); } }
    else if (this.live(binding.pointer)) this.game.module.call([binding.pointer], this.profile.free);
  }
  checkpoint(): QvmWeaponBehaviorCheckpoint {
    this.current(); if (this.busy || !this.ready) throw new Error('QVM weapon checkpoint requires an idle initialized source');
    this.operation(() => this.refreshTargets());
    return { version: 1, definition: this.definition, module: this.game.module.checkpoint(), profileDigest: this.profileDigest(), activated: [...this.activated].map(actor => ({ slot: actor.slot, generation: actor.generation })), bindings: [...this.bindings.values()].map(binding => ({ ...binding, actor: { slot: binding.actor.slot, generation: binding.actor.generation } })),
      retired: [...this.retired].map(([actor, trajectory]) => ({ actor: { slot: actor.slot, generation: actor.generation }, trajectory })) };
  }
  private profileDigest(): string { return new Bun.CryptoHasher('sha256').update(encodeCheckpointValue(this.profile)).digest('hex'); }
  restore(checkpoint: QvmWeaponBehaviorCheckpoint, resolveActor: (saved: SavedActorId) => ActorId): void {
    this.operation(() => {
      const staged = QvmWeaponBehaviorSource.restore(this.options, checkpoint, resolveActor);
      try {
        const previous = this.game.module.checkpoint();
        try { this.game.module.restore(checkpoint.module); }
        catch (error) {
          try { this.game.module.restore(previous); }
          catch (rollback) { throw new AggregateError([error, rollback], 'QVM weapon restore and rollback failed'); }
          throw error;
        }
        this.bindings.clear(); for (const [actor, binding] of staged.bindings) this.bindings.set(actor, binding);
        this.retired.clear(); for (const [actor, trajectory] of staged.retired) this.retired.set(actor, trajectory);
        this.activated.clear(); for (const actor of staged.activated) this.activated.add(actor);
        this.instances.clear(); this.generation++;
      } finally { staged.close(); }
    });
  }
  static restore(options: QvmWeaponBehaviorOptions, checkpoint: QvmWeaponBehaviorCheckpoint, resolveActor: (saved: SavedActorId) => ActorId): QvmWeaponBehaviorSource {
    const source = new QvmWeaponBehaviorSource(options);
    try {
      if (checkpoint.version !== 1 || !sameWeaponBehavior(source.definition, checkpoint.definition) || checkpoint.profileDigest !== source.profileDigest()) throw new Error('Saved QVM weapon profile differs from the selected artifact declaration');
      source.game.module.restore(checkpoint.module); source.validateLayout();
      const pointers = new Set<number>(), actors = new Set<ActorId>();
      for (const saved of checkpoint.bindings) {
        const actor = resolveActor(saved.actor); source.slot(saved.pointer);
        if (actors.has(actor) || pointers.has(saved.pointer) || !source.live(saved.pointer)) throw new Error('Invalid saved QVM weapon actor binding');
        if ((saved.kind === 'client') !== source.userinfo.has(source.slot(saved.pointer))) throw new Error('Saved QVM client ownership differs');
        actors.add(actor); pointers.add(saved.pointer); source.bindings.set(actor, { actor, pointer: saved.pointer, kind: saved.kind });
      }
      if ([...source.bindings.values()].filter(binding => binding.kind === 'client').length !== source.userinfo.size) throw new Error('Unbound saved QVM client');
      for (const saved of checkpoint.retired) {
        const actor = resolveActor(saved.actor); if (actors.has(actor)) throw new Error('Duplicate saved QVM weapon actor');
        actors.add(actor); source.retired.set(actor, saved.trajectory);
      }
      for (const saved of checkpoint.activated) { const actor = resolveActor(saved); if (!source.bindings.has(actor) || source.activated.has(actor)) throw new Error('Invalid saved weapon activation'); source.activated.add(actor); }
      source.ready = true; return source;
    } catch (error) { try { source.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'QVM weapon restore and cleanup failed'); } throw error; }
  }
  close(): void {
    if (this.closed) return; this.closed = true; this.instances.clear(); this.bindings.clear(); this.retired.clear(); this.activated.clear(); this.userinfo.clear();
    try { this.files.closeAll(); } finally { this.game.retire(); }
  }
}

export function readQvmWeaponBehaviorCheckpoint(reader: SaveReader, expected: WeaponBehaviorDefinition): QvmWeaponBehaviorCheckpoint {
  const module = readGuest(reader.field('module')); if (module.kind !== 'qvm') throw reader.field('module').fail('expected QVM checkpoint');
  const profileDigest = reader.field('profileDigest').string(); if (!/^[0-9a-f]{64}$/.test(profileDigest)) throw reader.field('profileDigest').fail('invalid profile digest');
  return { version: reader.field('version').literal(1), definition: readWeaponBehaviorDefinition(reader.field('definition'), expected), module, profileDigest, activated: reader.field('activated').list(readSavedActor),
    bindings: reader.field('bindings').list(row => ({ actor: readSavedActor(row.field('actor')), pointer: row.field('pointer').integer(1), kind: row.field('kind').choice('target', 'client', 'projectile') })),
    retired: reader.field('retired').list(row => ({ actor: readSavedActor(row.field('actor')), trajectory: { origin: readVector(row.field('trajectory').field('origin')), velocity: readVector(row.field('trajectory').field('velocity')), angles: readVector(row.field('trajectory').field('angles')) } })) };
}

/** Only source initialization and client spawn points are needed by a trajectory component. */
export function qvmWeaponInitializationEntities(text: string): string {
  const classes = new Set(['worldspawn', 'info_player_start', 'info_player_deathmatch', 'info_player_intermission', 'team_CTF_redplayer', 'team_CTF_blueplayer', 'team_CTF_redspawn', 'team_CTF_bluespawn']);
  const entities = parseQ1Entities(text).filter(entity => classes.has(q1EntityValue(entity, 'classname') ?? ''));
  if (entities.filter(entity => q1EntityValue(entity, 'classname') === 'worldspawn').length !== 1) throw new Error('QVM component requires one authored worldspawn');
  const quote = (value: string): string => { if (value.includes('"') || value.includes('\0')) throw new Error('Unquotable QVM spawn field'); return '"' + value + '"'; };
  return entities.map(entity => '{\n' + entity.properties.map(field => quote(field.key) + ' ' + quote(field.value)).join('\n') + '\n}\n').join('');
}
