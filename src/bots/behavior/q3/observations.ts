import { SaveReader } from "../../../persistence/value.ts";
/* Source aas_entityinfo_t observations; actor ownership stays in the shared registry. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
export interface BotEntityUpdate {
  readonly generation?: number;
  readonly type: number;
  readonly flags: number;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly oldOrigin: Vec3;
  readonly mins: Vec3;
  readonly maxs: Vec3;
  readonly groundEntity: number;
  readonly solid: number;
  readonly modelIndex: number;
  readonly modelIndex2: number;
  readonly frame: number;
  readonly event: number;
  readonly eventParameter: number;
  readonly powerups: number;
  readonly weapon: number;
  readonly legsAnimation: number;
  readonly torsoAnimation: number;
}

export interface AasEntityInfo extends BotEntityUpdate {
  readonly valid: boolean;
  readonly number: number;
  readonly lastVisibleOrigin: Vec3;
  readonly lastUpdateTime: number;
  readonly updateInterval: number;
}

function emptyInfo(number: number): AasEntityInfo {
  const zero = { x: 0, y: 0, z: 0 };
  return { valid: false, number, type: 0, flags: 0, origin: zero, angles: zero, oldOrigin: zero,
    mins: zero, maxs: zero, lastVisibleOrigin: zero, lastUpdateTime: 0, updateInterval: 0,
    groundEntity: 0, solid: 0, modelIndex: 0, modelIndex2: 0, frame: 0, event: 0,
    eventParameter: 0, powerups: 0, weapon: 0, legsAnimation: 0, torsoAnimation: 0 };
}

function vector(source: Vec3): Vec3 {
  return { x: Math.fround(source.x), y: Math.fround(source.y), z: Math.fround(source.z) };
}

/** Detached sensory history; linking, collision, and authoritative actors remain shared. */
export class BotEntityObservations {
  private readonly records: AasEntityInfo[];
  constructor(readonly capacity: number) { this.records = Array.from({ length: capacity }, (_, number) => emptyInfo(number)); }
  captureSaveState() { return this.records.map((_, index) => { const value = this.info(index); return { ...value, generation: value.generation ?? null }; }); }
  restoreSaveState(value: unknown, remapObservation: (number: number, generation: number) => { readonly number: number; readonly generation: number }): void {
    const reader = new SaveReader(value, "bot.observations");
    const records = reader.list((cell): AasEntityInfo => {
      const number = cell.field("number").integer(0), generation = cell.field("generation").nullable(entry => entry.integer(0));
      const identity = generation === null ? { number } : remapObservation(number, generation);
      const vector = (entry: SaveReader): Vec3 => ({ x: entry.field("x").number(), y: entry.field("y").number(), z: entry.field("z").number() });
      return { ...identity, valid: cell.field("valid").boolean(),
        type: cell.field("type").number(),
        flags: cell.field("flags").number(),
        groundEntity: cell.field("groundEntity").number(),
        solid: cell.field("solid").number(),
        modelIndex: cell.field("modelIndex").number(),
        modelIndex2: cell.field("modelIndex2").number(),
        frame: cell.field("frame").number(),
        event: cell.field("event").number(),
        eventParameter: cell.field("eventParameter").number(),
        powerups: cell.field("powerups").number(),
        weapon: cell.field("weapon").number(),
        legsAnimation: cell.field("legsAnimation").number(),
        torsoAnimation: cell.field("torsoAnimation").number(),
        lastUpdateTime: cell.field("lastUpdateTime").number(),
        updateInterval: cell.field("updateInterval").number(),
        origin: vector(cell.field("origin")),
        angles: vector(cell.field("angles")),
        oldOrigin: vector(cell.field("oldOrigin")),
        mins: vector(cell.field("mins")),
        maxs: vector(cell.field("maxs")),
        lastVisibleOrigin: vector(cell.field("lastVisibleOrigin")),
      };
    });
    if (records.length !== this.capacity) reader.fail("incorrect observation extent");
    const slots = new Set<number>();
    for (const record of records) { if (record.number >= this.capacity || slots.has(record.number)) reader.fail("invalid remapped observation slot"); slots.add(record.number); }
    for (const record of records) this.records[record.number] = record;
  }
  invalidate(): void {
    for (const [index, value] of this.records.entries()) this.records[index] = { ...value, valid: false };
  }
  update(number: number, source: BotEntityUpdate | null, time: number): void {
    let previous = this.records[number];
    if (previous === undefined) throw new RangeError(`Bot observation ${number} exceeds source capacity ${this.capacity}`);
    if (source === null) return;
    if (previous.generation !== source.generation) previous = emptyInfo(number);
    this.records[number] = { ...source, number, valid: true,
      origin: vector(source.origin), angles: vector(source.angles), oldOrigin: vector(source.oldOrigin),
      mins: vector(source.mins), maxs: vector(source.maxs), lastVisibleOrigin: previous.origin,
      lastUpdateTime: Math.fround(time), updateInterval: Math.fround(Math.fround(time) - previous.lastUpdateTime) };
  }
  info(number: number): AasEntityInfo {
    const state = this.records[number];
    if (state === undefined) return emptyInfo(number);
    return { ...state, origin: { ...state.origin }, angles: { ...state.angles }, oldOrigin: { ...state.oldOrigin },
      mins: { ...state.mins }, maxs: { ...state.maxs }, lastVisibleOrigin: { ...state.lastVisibleOrigin } };
  }
  nextEntity(after: number): number {
    for (let number = after + 1; number < this.capacity; number++) if (this.records[number]?.valid) return number;
    return 0;
  }
}

