import type { GuestAddress, GuestCallResult, GuestCallValue } from "../../contracts/execution.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { NativeModAddress, NativeModDeclaration, NativeModEntry, NativeModScalar, NativeModSourceActors } from "../../contracts/native-mod-callbacks.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { readClassicVector, writeClassicVector } from "./classic/records.ts";
import { RereleasePublicEdict } from "./rerelease/public-state.ts";

export interface SavedNativeActors {
  readonly nextFrame: number;
  readonly frame: number;
  readonly actors: readonly { readonly actor: SavedActorId; readonly slot: number; readonly linked: boolean }[];
}
interface SourceCalls {
  resolve(address: NativeModAddress): GuestAddress;
  scalar(address: GuestAddress, value: number, encoding: NativeModScalar): void;
  invoke(entry: GuestAddress, values: readonly Extract<GuestCallValue, { readonly kind: "pointer" }>[], returns: NativeModScalar | "void"): GuestCallResult;
  address(actor: ActorId): GuestAddress;
  actorAt(slot: number): ActorId | null;
  beginFrame(): void;
  endFrame(): void;
}

/** Source edicts retain their private words, function pointers, allocator and update loop. */
export class NativeModActors {
  private readonly slots = new Map<number, OwnedActor>();
  private readonly actorSlots = new Map<ActorId, number>();
  private readonly removals: (() => void)[] = [];
  private readonly pending = new Set<number>();
  private readonly unsubscribe: () => undefined;
  private suspended = false;
  private closing = false;
  private frame = 0;
  private nextFrame: number;
  private tickTime: number | null = null;
  constructor(readonly definition: NativeModSourceActors, readonly declaration: NativeModDeclaration, readonly host: NativeModHost,
    readonly services: ModHostServices, readonly instance: ProviderId, readonly calls: SourceCalls) {
    this.nextFrame = this.now() + definition.frameSeconds;
    this.unsubscribe = services.actors.onRelease(actor => {
      const slot = this.actorSlots.get(actor.id); if (slot !== undefined) { this.pending.add(slot); host.presentation.release(actor.id); }
      return undefined;
    });
    try {
      this.intercept(definition.allocate, "allocate", [], "pointer", (args, proceed) => {
        if (!this.suspended) for (const slot of [...this.slots.keys()]) if (!host.active(slot)) this.retire(slot);
        const result = proceed(args);
        if (!this.suspended && result.kind === "pointer" && result.value !== null) this.adopt(this.slot(result.value));
        return result;
      });
      this.intercept(definition.release, "release", ["pointer"], "void", (args, proceed) => {
        const value = args[0], slot = value?.kind === "pointer" && value.value !== null ? this.slot(value.value) : null;
        const result = proceed(args);
        if (!this.suspended && slot !== null && !host.active(slot)) this.retire(slot);
        return result;
      });
    } catch (error) { this.unsubscribe(); for (const remove of this.removals.reverse()) remove(); throw error; }
  }
  get advancing(): boolean { return this.tickTime !== null; }
  private now(): number { const time = this.services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; }
  private entry(entry: NativeModEntry): GuestAddress { return entry.kind === "export" ? this.host.entry(entry.name) : this.host.memory.offset(this.host.imageBase, BigInt(entry.rva)); }
  private intercept(entry: NativeModEntry, name: "allocate" | "release", parameters: readonly "pointer"[], returns: "pointer" | "void",
    execute: (args: readonly GuestCallValue[], proceed: (args: readonly GuestCallValue[]) => GuestCallResult) => GuestCallResult): void {
    const address = this.entry(entry), { callbacks, cpu } = this.host.entries, frames: { stack: bigint | null }[] = [];
    const stack = () => cpu.state.registers.read("rsp", this.host.memory.pointerBytes === 4 ? 32 : 64);
    const signature = { abi: this.declaration.target.abi, parameters: parameters.map(storage => ({ kind: "scalar", storage } satisfies import("../../contracts/execution.ts").GuestValueLayout)),
      result: returns === "void" ? "void" : { kind: "scalar", storage: returns }, variadic: false } satisfies import("../../guest/core/contracts.ts").GuestCallSignature;
    this.removals.push(callbacks.observeEntry(address, () => { const frame = frames.at(-1); if (frame !== undefined && frame.stack === null) frame.stack = stack(); }));
    this.removals.push(callbacks.bindEntry(address, { id: `${this.instance}:source-${name}`, signature,
      invoke: (_context, args) => execute(args, values => { const frame = { stack: null }; frames.push(frame);
        try { return this.host.invoke(address, signature, values); } finally { frames.pop(); } }) }, () => frames.at(-1)?.stack !== stack()));
  }
  private reserved(slot: number): boolean {
    const record = this.declaration.actorRecords.find(record => record.id === this.declaration.entityRecord);
    return slot === 0 || record !== undefined && slot >= record.firstSlot && slot < record.firstSlot + record.capacity;
  }
  private slot(address: GuestAddress): number {
    const table = this.host.entities(), difference = address.byteOffset - table.base.byteOffset;
    if (difference < 0n || difference % BigInt(table.stride) !== 0n || difference / BigInt(table.stride) >= BigInt(table.count)) throw new Error("Native actor pointer is outside its source table");
    return Number(difference / BigInt(table.stride));
  }
  private at(slot: number, offset: number): GuestAddress { return this.host.memory.offset(this.host.entity(slot).address, BigInt(offset)); }
  actorAt(slot: number): OwnedActor | null { const actor = this.slots.get(slot); return actor !== undefined && this.services.actors.isLive(actor.id) ? actor : null; }
  slotOf(actor: ActorId): number | null { return this.actorSlots.get(actor) ?? null; }
  entries(): readonly { readonly actor: ActorId; readonly slot: number }[] { return [...this.slots].filter(([, actor]) => this.services.actors.isLive(actor.id)).map(([slot, actor]) => ({ actor: actor.id, slot })); }
  private adopt(slot: number): OwnedActor | null {
    if (this.reserved(slot) || !this.host.active(slot)) return null;
    const prior = this.slots.get(slot); if (prior !== undefined) return prior;
    const actor = this.services.actors.allocateAtSource(this.instance, slot, "native:mod-actor"); this.slots.set(slot, actor); this.actorSlots.set(actor.id, slot);
    try { this.bind(slot, actor); } catch (error) { this.retire(slot); throw error; }
    return actor;
  }
  private bind(slot: number, actor: OwnedActor): void {
    const { memory } = this.host, fields = this.definition.fields;
    const view = () => this.host.entity(slot), rerelease = () => new RereleasePublicEdict(memory, view());
    const vector = (name: string, offset: number) => this.declaration.target.api.kind === "q2-classic-game" ? readClassicVector(memory, this.at(slot, offset)) : rerelease().vector(name);
    const write = (name: string, offset: number, value: import("../../contracts/math.ts").Vec3) => {
      if (this.declaration.target.api.kind === "q2-classic-game") writeClassicVector(memory, this.at(slot, offset), value); else rerelease().setVector(name, value);
    };
    this.services.bodies.rebind(actor, { read: () => {
      const ground = memory.readPointer(this.at(slot, fields.ground));
      return { origin: vector("s.origin", 4), angles: vector("s.angles", 16), bounds: { min: vector("mins", 188), max: vector("maxs", 200) },
        velocity: readClassicVector(memory, this.at(slot, fields.velocity)), ground: ground === null ? null : this.calls.actorAt(this.slot(ground)) };
    }, write: state => {
      write("s.origin", 4, state.origin); write("s.angles", 16, state.angles); write("mins", 188, state.bounds.min); write("maxs", 200, state.bounds.max);
      writeClassicVector(memory, this.at(slot, fields.velocity), state.velocity); memory.writePointer(this.at(slot, fields.ground), state.ground === null ? null : this.calls.address(state.ground)); return undefined;
    } });
    this.services.callbacks?.bind(actor, { think: null, touch: null, pain: null, die: null,
      use: fields.use === null ? null : (_self, other, activator) => {
        if (fields.use === null) return undefined;
        const target = memory.readPointer(this.at(slot, fields.use)); if (target === null) return undefined;
        this.calls.invoke(target, [actor.id, other, activator].map(value => ({ kind: "pointer", value: value === null ? null : this.calls.address(value) })), "void"); return undefined;
      } });
  }
  synchronizeClock(): void {
    if (this.suspended) return;
    const time = this.tickTime ?? this.now();
    for (const field of this.definition.clock) {
      const value = field.input === "frame" ? this.frame : time * (field.units === "milliseconds" ? 1000 : 1);
      this.calls.scalar(this.calls.resolve(field.address), field.input === "time" && field.units === "milliseconds" && field.encoding !== "float32" && field.encoding !== "float64" ? Math.round(value) : value, field.encoding);
    }
  }
  validate(): void {
    const { stride } = this.host.entities(), fields = this.definition.fields;
    for (const [offset, size] of [[fields.velocity, 12], [fields.ground, this.host.memory.pointerBytes], [fields.think, this.host.memory.pointerBytes], [fields.use ?? 0, this.host.memory.pointerBytes], [fields.nextthink.offset, fields.nextthink.encoding.endsWith("64") ? 8 : fields.nextthink.encoding.endsWith("16") ? 2 : fields.nextthink.encoding.endsWith("8") ? 1 : 4]]) {
      if (offset === undefined || size === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset + size > stride) throw new Error("Native owned-actor field exceeds the source stride");
    }
    this.host.memory.check(this.entry(this.definition.update.entry), 1, "execute");
    this.synchronizeClock();
  }
  drainReleases(): void {
    if (this.suspended) return;
    for (const slot of [...this.pending]) {
      if (this.host.active(slot)) this.calls.invoke(this.entry(this.definition.release), [{ kind: "pointer", value: this.host.entity(slot).address }], "void");
      if (!this.closing && this.host.active(slot)) throw new Error("Native source refused to release its owned actor");
      this.retire(slot);
    }
  }
  private retire(slot: number): void {
    const actor = this.slots.get(slot); this.slots.delete(slot); this.pending.delete(slot);
    if (actor === undefined) return;
    this.actorSlots.delete(actor.id);
    this.host.presentation.release(actor.id); if (this.services.actors.isLive(actor.id)) this.services.actors.release(actor);
  }
  advance(frame: FrameContext): void {
    if (this.suspended || this.closing) return;
    const now = frame.time.kind === "seconds" ? frame.time.value : frame.time.value / 1000;
    this.drainReleases();
    while (this.nextFrame <= now + 1e-9) {
      this.tickTime = this.nextFrame; this.nextFrame += this.definition.frameSeconds; this.frame++;
      try {
        this.synchronizeClock();
        this.calls.beginFrame();
        for (let slot = 0; slot < this.host.entities().count; slot++) {
          const actor = this.slots.get(slot); if (actor === undefined) continue;
          if (!this.services.actors.isLive(actor.id) || !this.host.active(slot)) { this.retire(slot); continue; }
          this.calls.invoke(this.entry(this.definition.update.entry), [{ kind: "pointer", value: this.host.entity(slot).address }], this.definition.update.returns);
        }
        this.calls.endFrame();
      } finally { this.tickTime = null; }
    }
  }
  suspend(value: boolean): void { this.suspended = value; }
  checkpoint(): SavedNativeActors { return { frame: this.frame, nextFrame: this.nextFrame, actors: this.entries().map(({ actor, slot }) => ({ actor: { slot: actor.slot, generation: actor.generation }, slot, linked: this.services.bodies.linked(actor) !== null })) }; }
  validateSaved(saved: SavedNativeActors): readonly { readonly actor: OwnedActor; readonly slot: number; readonly linked: boolean }[] {
    return saved.actors.map(entry => {
      const id = this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"), actor = this.services.actors.resolveOwned(id);
      if (actor === null || actor.owner !== this.instance || this.reserved(entry.slot) || this.services.actors.sourceOf(id)?.slot !== entry.slot) throw new Error(`Saved native owned actor ${entry.actor.slot}/${entry.actor.generation} does not belong to ${this.instance}/${entry.slot}: ${actor?.owner ?? "expired"}/${this.services.actors.sourceOf(id)?.slot ?? "unbound"}`);
      return { ...entry, actor };
    });
  }
  restore(saved: SavedNativeActors, actors: ReturnType<NativeModActors["validateSaved"]>): void {
    for (const entry of actors) if (entry.slot >= this.host.entities().count || !this.host.active(entry.slot)) throw new Error("Original native save lost an owned source actor");
    this.slots.clear(); this.actorSlots.clear(); this.pending.clear(); this.frame = saved.frame; this.nextFrame = saved.nextFrame;
    for (const entry of actors) { this.slots.set(entry.slot, entry.actor); this.actorSlots.set(entry.actor.id, entry.slot); }
    for (const entry of actors) { this.bind(entry.slot, entry.actor); if (entry.linked) this.services.bodies.link(entry.actor); }
  }
  close(): void {
    if (this.closing) return; this.closing = true;
    try { for (const slot of this.slots.keys()) this.pending.add(slot); this.drainReleases(); }
    finally { this.unsubscribe(); for (const slot of [...this.slots.keys()]) this.retire(slot); for (const remove of this.removals.reverse()) remove(); }
  }
}
