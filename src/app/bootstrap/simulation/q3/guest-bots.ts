import { SaveReader } from '../../../../persistence/value.ts';
import type { ApplicationBotNavigation } from '../navigation.ts';
import { BotLibrary, type SourceBotLibraryOptions } from '../../../../bots/behavior/q3/library.ts';
import { SourceBotNavigation } from '../../../../bots/behavior/q3/navigation.ts';
import { AasBspEntities } from '../../../../bots/behavior/library/bsp-entities.ts';
import type { GoalWorld } from '../../../../bots/behavior/library/goals.ts';
import { qvmBotLibrarySyscall, type QvmBotLibraryServices } from '../../../../compat/qvm/bot-library-syscalls.ts';
import { qvmBotNavigationSyscall, qvmBotMovementPrediction } from '../../../../compat/qvm/bot-navigation-syscalls.ts';
import { readQvmBotEntityState, type AasEntityInfo } from '../../../../compat/qvm/bot-navigation-records.ts';
import type { QvmHostCall, QvmHostResult } from '../../../../compat/qvm/syscalls.ts';
import type { Q3GuestSpatial } from './guest-spatial.ts';
import type { Q3GuestRecords } from './guest-records.ts';

export interface Q3GuestBotOptions {
  readonly library: SourceBotLibraryOptions;
  readonly selected: ApplicationBotNavigation;
  readonly records: Q3GuestRecords;
  readonly spatial: Q3GuestSpatial;
  readonly entities: string;
  readonly mapName: string;
  readonly clients: Pick<QvmBotLibraryServices, 'allocateClient' | 'freeClient' | 'snapshotEntity' | 'consoleMessage' | 'userCommand'>;
}

/** Botlib belongs to the engine; game bot decisions remain inside qagame. */
export class Q3GuestBots {
  readonly library: BotLibrary;
  readonly navigation: SourceBotNavigation;
  readonly bspEntities: AasBspEntities;
  private readonly observations = new Map<number, AasEntityInfo>();
  private initialized = false;
  private loaded = false;
  private readonly services: QvmBotLibraryServices;
  constructor(readonly options: Q3GuestBotOptions) {
    this.library = new BotLibrary(options.library);
    this.bspEntities = new AasBspEntities(options.library.print, this.library.memory);
    const { library } = this, { records, spatial } = options;
    this.navigation = new SourceBotNavigation({ ...options.selected, actions: library.actions, moveStates: library.moveStates,
      random: options.library.random, time: () => library.time(),
      pointContents: point => spatial.pointContents(point, -1),
      trace: (start, end, bounds, passEntityNum, mask) => {
        const trace = spatial.trace({ start, end, passEntityNum, mask, shape: bounds === null ? { kind: 'point' } : { kind: 'box', bounds } });
        return { fraction: trace.fraction, end: trace.end, entityNum: trace.entityNum, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
          solidity: trace.allSolid ? 'all-solid' : trace.startSolid ? 'start-solid' : 'clear',
          contact: trace.fraction === 1 ? { kind: 'none' } : { kind: 'plane', plane: trace.plane } };
      },
      entityModelIndex: number => this.observations.get(number)?.modelIndex ?? 0,
      entityType: number => this.observations.get(number)?.type ?? 0,
      entityWeapon: number => this.observations.get(number)?.weapon ?? 0,
      nextEntity: after => this.nextEntity(after),
      modelInfo: model => {
        for (const [number, info] of this.observations) {
          if (!info.valid || info.modelIndex !== model) continue;
          const entity = records.entity(number);
          if (entity.r.model.kind !== 'inline') continue;
          const classname = this.modelClassname(model);
          return { entity: number, origin: info.origin, bounds: { min: info.mins, max: info.maxs },
            kind: classname === 'func_plat' ? 'elevator' : classname === 'func_bobbing' ? 'bobbing'
              : classname === 'func_door' ? 'door' : classname === 'func_train' ? 'train' : 'static' };
        }
        return null;
      },
    });
    this.services = { ...options.clients, library,
      setup: () => { const result = library.setup(); this.initialized = result === 0; return result; },
      shutdown: () => { this.initialized = false; this.loaded = false; return library.shutdown(); },
      loadMap: name => {
        if (name !== options.mapName) throw new Error(`Bot map ${name} does not match active guest world ${options.mapName}`);
        this.bspEntities.load(options.entities); this.observations.clear();
        const result = library.loadMap(this.goalWorld()); this.loaded = result === 0; return result;
      },
      updateEntity: (number, call, pointer) => {
        if (pointer === 0) { this.observations.delete(number); return 0; }
        const state = readQvmBotEntityState(call.guest.view(pointer, 112)), previous = this.observations.get(number), time = library.time();
        this.observations.set(number, { ...state, number, valid: true, lastVisibleOrigin: previous?.origin ?? state.origin,
          lastUpdateTime: time, updateInterval: time - (previous?.lastUpdateTime ?? time) }); return 0;
      },
    };
  }
  private nextEntity(after: number): number {
    let next = 0;
    for (const [number, info] of this.observations) if (info.valid && number > after && (next === 0 || number < next)) next = number;
    return next;
  }
  private bspValue(entity: number, key: string): string {
    const bytes = new Uint8Array(1024); if (!this.bspEntities.value(entity, key, bytes)) return '';
    const end = bytes.indexOf(0); return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  }
  private modelClassname(model: number): string {
    for (let entity = this.bspEntities.nextEntity(0); entity !== 0; entity = this.bspEntities.nextEntity(entity)) {
      if (this.bspValue(entity, 'model') === `*${model}`) return this.bspValue(entity, 'classname');
    }
    return '';
  }
  private goalWorld(): GoalWorld {
    const navigation = this.navigation;
    return { bspEntities: this.bspEntities, navigation, pointArea: point => navigation.pointArea(point), host: {
      trace: navigation.host.trace, pointContents: navigation.host.pointContents, nextEntity: after => this.nextEntity(after),
      entityInfo: number => { const info = this.observations.get(number); if (info === undefined) throw new Error(`Bot entity ${number} is not observed`); return info; },
    } };
  }
  syscall(call: QvmHostCall): QvmHostResult | null {
    return qvmBotLibrarySyscall(call, this.services) ?? qvmBotNavigationSyscall(call, {
      library: this.library, navigation: this.navigation, bspEntities: this.bspEntities,
      time: () => this.library.time(), initialized: () => this.initialized && this.loaded && this.navigation.ready,
      entityInfo: number => this.observations.get(number) ?? null,
      predictClientMovement: query => qvmBotMovementPrediction(this.navigation, query, actor => this.options.records.requireSlot(actor)),
    });
  }
  checkpoint() {
    const assets = this.options.library.files.provenance?.();
    if (assets === undefined) throw new Error('Guest bot persistence requires mounted asset provenance');
    const memory = this.library.memory.checkpoint();
    return { version: 1, assets, initialized: this.initialized, loaded: this.loaded, memory: memory.image,
      library: this.library.captureSaveState(memory), bsp: this.bspEntities.checkpoint(memory),
      navigation: this.options.selected.checkpoint(), observations: [...this.observations.values()] };
  }
  restore(value: unknown): void {
    const reader = new SaveReader(value, 'q3.guest.bots'); reader.field('version').literal(1);
    const assets = this.options.library.files.provenance?.();
    if (assets === undefined || reader.field('assets').string() !== assets) throw new Error('Guest bot assets differ from saved source');
    this.options.selected.restoreCheckpoint(reader.field('navigation').value);
    const memory = this.library.memory.restore(reader.field('memory').value);
    this.bspEntities.restore(reader.field('bsp').value, memory);
    const library = reader.field('library');
    const goalWorld = library.field('goals').field('hasWorld').boolean() ? this.goalWorld() : null;
    this.library.restoreSaveState(library.value, memory, goalWorld, saved => {
      const actor = this.options.records.host.actors.resolveSaved(saved); if (actor === null) throw new Error('Saved guest bot actor is absent'); return actor.id;
    }, (client, id) => this.options.selected.forClient(client).graph.edges.find(edge => edge.id === id) ?? null);
    const vector = (cell: SaveReader) => ({ x: cell.field('x').number(), y: cell.field('y').number(), z: cell.field('z').number() });
    for (const info of reader.field('observations').list((cell): AasEntityInfo => ({
      number: cell.field('number').integer(0), valid: cell.field('valid').boolean(), type: cell.field('type').integer(), flags: cell.field('flags').integer(),
      origin: vector(cell.field('origin')), oldOrigin: vector(cell.field('oldOrigin')), angles: vector(cell.field('angles')),
      mins: vector(cell.field('mins')), maxs: vector(cell.field('maxs')), lastVisibleOrigin: vector(cell.field('lastVisibleOrigin')),
      lastUpdateTime: cell.field('lastUpdateTime').number(), updateInterval: cell.field('updateInterval').number(),
      groundEntity: cell.field('groundEntity').integer(), solid: cell.field('solid').integer(), modelIndex: cell.field('modelIndex').integer(), modelIndex2: cell.field('modelIndex2').integer(),
      frame: cell.field('frame').integer(), event: cell.field('event').integer(), eventParameter: cell.field('eventParameter').integer(), powerups: cell.field('powerups').integer(),
      weapon: cell.field('weapon').integer(), legsAnimation: cell.field('legsAnimation').integer(), torsoAnimation: cell.field('torsoAnimation').integer(),
    }))) {
      if (this.observations.has(info.number)) throw new Error('Duplicate guest bot observation');
      this.observations.set(info.number, info);
    }
    this.initialized = reader.field('initialized').boolean(); this.loaded = reader.field('loaded').boolean();
  }
  close(): void { this.services.shutdown(); }
}
