import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { Q3SourcePlayerEvent } from "../../app/bootstrap/simulation/q3/types.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { QvmMemory } from "./memory.ts";
import { qvmPlayerStateBytes, readSourceQvmPlayerState } from "./player-record.ts";

interface Cursor {
  external: number; externalTime: number; sequence: number; observedSequence: number;
  externalOrder: number | null; readonly predictable: Map<number, number>;
}
interface Entry { readonly cursor: Cursor; readonly actor: ActorId; readonly address: number; readonly stop: () => undefined; }
interface SavedCursor {
  readonly actor: SavedActorId; readonly external: number; readonly externalTime: number;
  readonly sequence: number; readonly observedSequence: number; readonly externalOrder: number | null;
  readonly predictable: readonly { readonly sequence: number; readonly order: number }[];
}
export interface QvmPlayerEventsCheckpoint { readonly nextOrder: number; readonly clients: readonly SavedCursor[]; }
function int32(reader: SaveReader): number {
  const value = reader.integer(-0x80000000);
  return value <= 0x7fffffff ? value : reader.fail("expected a source int32");
}
export function readQvmPlayerEvents(reader: SaveReader): QvmPlayerEventsCheckpoint | null {
  if (reader.value === undefined) return null;
  const nextOrder = reader.field("nextOrder").integer(0), actors = new Set<string>(), orders = new Set<number>();
  const order = (value: SaveReader): number => {
    const result = value.integer(0);
    if (result >= nextOrder || orders.has(result)) return value.fail("invalid player event publication order");
    orders.add(result); return result;
  };
  const clients = reader.field("clients").list(value => {
    const actor = readSavedActor(value.field("actor")), key = `${actor.slot}:${actor.generation}`;
    if (actors.has(key)) return value.fail("duplicate player event cursor"); actors.add(key);
    const sequence = int32(value.field("sequence")), observedSequence = int32(value.field("observedSequence"));
    const predictable = value.field("predictable").list(entry => ({ sequence: int32(entry.field("sequence")), order: order(entry.field("order")) }));
    if (predictable.length > 2 || new Set(predictable.map(entry => entry.sequence)).size !== predictable.length
      || predictable.some(entry => ((observedSequence - entry.sequence) | 0) < 1 || ((observedSequence - entry.sequence) | 0) > 2))
      return value.fail("invalid predictable player event cursor");
    return { actor, external: int32(value.field("external")), externalTime: int32(value.field("externalTime")), sequence, observedSequence,
      externalOrder: value.field("externalOrder").nullable(order), predictable };
  });
  return { nextOrder, clients };
}
interface Operations {
  readonly memory: QvmMemory; readonly module: ModuleIdentity; readonly abiProfile: QvmAbiProfile;
  live(actor: ActorId): boolean;
  origin(actor: ActorId): Vec3;
  time(): number;
  emit(event: Q3SourcePlayerEvent): void;
}

/** Observes source publication order without running host operations from committed-memory listeners. */
export class QvmModPlayerEvents {
  private readonly entries = new Map<ActorId, Entry>();
  private nextOrder = 0;
  constructor(private readonly operations: Operations) {}
  private ordinal(): number {
    if (!Number.isSafeInteger(this.nextOrder + 1)) throw new Error("Player event publication sequence exhausted");
    return this.nextOrder++;
  }
  track(actor: ActorId, address: number, saved?: SavedCursor): void {
    if (this.entries.has(actor)) return;
    const view = this.operations.memory.dataView(address, qvmPlayerStateBytes(this.operations.abiProfile));
    const sequence = view.getInt32(108, true);
    if (saved !== undefined && saved.observedSequence !== sequence) throw new Error("Player event cursor differs from restored source sequence");
    const cursor: Cursor = saved === undefined ? { external: view.getInt32(128, true), externalTime: view.getInt32(136, true), sequence,
      observedSequence: sequence, externalOrder: null, predictable: new Map<number, number>() } : { ...saved, predictable: new Map<number, number>(saved.predictable.map(entry => [entry.sequence, entry.order])) };
    const stop = this.operations.memory.observeWrites([{ byteOffset: address + 108, byteLength: 32 }], event => {
      const touches = (offset: number): boolean => event.ranges.some(range => range.byteOffset < address + offset + 4 && address + offset < range.byteOffset + range.after.length);
      if (touches(108)) {
        const next = view.getInt32(108, true), delta = (next - cursor.observedSequence) | 0;
        if (delta < 0) { cursor.sequence = next; cursor.predictable.clear(); }
        else if (delta > 0) {
          for (const sequence of cursor.predictable.keys()) if (((next - sequence) | 0) > 2) cursor.predictable.delete(sequence);
          for (let step = Math.min(delta, 2); step > 0; step--) cursor.predictable.set((next - step) | 0, this.ordinal());
        }
        cursor.observedSequence = next;
      }
      if (touches(128)) cursor.externalOrder = this.ordinal();
      return undefined;
    });
    this.entries.set(actor, { actor, address, stop, cursor });
  }
  publish(): void {
    const pending: { readonly order: number; readonly event: Q3SourcePlayerEvent }[] = [];
    for (const entry of this.entries.values()) {
      if (!this.operations.live(entry.actor)) continue;
      const ps = readSourceQvmPlayerState(this.operations.memory.dataView(entry.address, qvmPlayerStateBytes(this.operations.abiProfile)), this.operations.abiProfile);
      const external = ps.externalEvent !== 0 && (ps.externalEvent !== entry.cursor.external || ps.externalEventTimeMilliseconds !== entry.cursor.externalTime);
      const count = Math.min(2, Math.max(0, (ps.eventSequence - entry.cursor.sequence) | 0));
      if (external || count !== 0) {
        const origin = this.operations.origin(entry.actor), time = this.operations.time();
        const base = { kind: "player-event", actor: entry.actor, source: { module: { ...this.operations.module }, abiProfile: this.operations.abiProfile },
          playerState: ps, origin: { ...origin }, time } satisfies Omit<Q3SourcePlayerEvent, "event" | "parameter" | "sequence">;
        if (external) pending.push({ order: entry.cursor.externalOrder ?? this.ordinal(), event: { ...base, event: ps.externalEvent, parameter: ps.externalEventParameter,
          sequence: { kind: "external", time: ps.externalEventTimeMilliseconds } } });
        for (let step = count; step > 0; step--) {
          const sequence = (ps.eventSequence - step) | 0, slot = sequence & 1;
          const event = ps.events[slot] ?? 0;
          if (event !== 0) pending.push({ order: entry.cursor.predictable.get(sequence) ?? this.ordinal(), event: { ...base, event, parameter: ps.eventParameters[slot] ?? 0,
            sequence: { kind: "predictable", sequence } } });
        }
      }
      entry.cursor.external = ps.externalEvent; entry.cursor.externalTime = ps.externalEventTimeMilliseconds; entry.cursor.sequence = ps.eventSequence;
      entry.cursor.observedSequence = ps.eventSequence; entry.cursor.externalOrder = null; entry.cursor.predictable.clear();
    }
    pending.sort((left, right) => left.order - right.order);
    for (const { event } of pending) if (this.entries.has(event.actor) && this.operations.live(event.actor)) this.operations.emit(event);
  }
  discard(): void {
    for (const entry of this.entries.values()) {
      const view = this.operations.memory.dataView(entry.address, qvmPlayerStateBytes(this.operations.abiProfile));
      entry.cursor.external = view.getInt32(128, true); entry.cursor.externalTime = view.getInt32(136, true);
      entry.cursor.sequence = entry.cursor.observedSequence = view.getInt32(108, true); entry.cursor.externalOrder = null; entry.cursor.predictable.clear();
    }
  }
  checkpoint(): QvmPlayerEventsCheckpoint {
    return { nextOrder: this.nextOrder, clients: [...this.entries.values()].map(entry => ({ actor: savedActorId(entry.actor), external: entry.cursor.external, externalTime: entry.cursor.externalTime,
      sequence: entry.cursor.sequence, observedSequence: entry.cursor.observedSequence, externalOrder: entry.cursor.externalOrder,
      predictable: [...entry.cursor.predictable].map(([sequence, order]) => ({ sequence, order })) })) };
  }
  restore(saved: QvmPlayerEventsCheckpoint | null, players: readonly { readonly actor: ActorId; readonly address: number }[]): void {
    this.close(); this.nextOrder = saved?.nextOrder ?? 0;
    for (const player of players) {
      const cursor = saved?.clients.find(entry => entry.actor.slot === player.actor.slot && entry.actor.generation === player.actor.generation);
      if (saved !== null && cursor === undefined) throw new Error("Missing restored player event cursor");
      this.track(player.actor, player.address, cursor);
    }
  }
  release(actor: ActorId): void { this.entries.get(actor)?.stop(); this.entries.delete(actor); }
  close(): void { for (const entry of this.entries.values()) entry.stop(); this.entries.clear(); }
}
