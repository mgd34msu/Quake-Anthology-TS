import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { BodyTable } from "../../contracts/world.ts";
import type { GameplayAuthority } from "../../world/gameplay/authority.ts";
import type { SessionActorRegistry, SourceActorSlots } from "../../world/actors/index.ts";
import type { SaveReader } from "../../persistence/value.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";
import type { QcMachine } from "./machine.ts";
import { QcProgramError } from "./program.ts";

interface BorrowedActor { readonly actor: OwnedActor; readonly slot: number; classname: string | null; }
const vectors: readonly ["origin", "angles", "velocity", "mins", "maxs", "absmin", "absmax", "size"] = ["origin", "angles", "velocity", "mins", "maxs", "absmin", "absmax", "size"];
const privateFields: readonly ["chain", "invincible_sound"] = ["chain", "invincible_sound"];
type ProjectionField = typeof vectors[number] | typeof privateFields[number] | "health" | "takedamage" | "classname" | "solid";

/** Borrowed rows retain original entity pointers while the canonical actor owns its state and lifetime. */
export class QcBorrowedActors {
  private readonly byActor = new Map<OwnedActor, BorrowedActor>();
  private readonly bySlot = new Map<number, BorrowedActor>();
  private offsets: ReadonlyMap<ProjectionField, number> | null = null;
  private readonly fieldsByWord = new Map<number, ProjectionField>();
  constructor(private readonly host: {
    readonly actors: SessionActorRegistry;
    readonly bodies: BodyTable;
    readonly combat: GameplayAuthority;
    readonly slots: SourceActorSlots;
    machine(): QcMachine;
    classname(actor: ActorId): string;
    solid(actor: ActorId): 0 | 1 | 2 | 3 | 4;
  }) {
    host.actors.onRelease(actor => {
      const borrowed = this.byActor.get(actor);
      if (borrowed !== undefined) {
        this.byActor.delete(actor); this.bySlot.delete(borrowed.slot);
        host.slots.options.storage.clearFreed(borrowed.slot, host.slots.options.now());
      }
      return undefined;
    });
  }
  actor(slot: number): OwnedActor | null {
    const borrowed = this.bySlot.get(slot);
    if (borrowed === undefined) return null;
    this.host.actors.assertOwned(borrowed.actor);
    return borrowed.actor;
  }
  reference(actor: ActorId): number {
    const owned = this.host.actors.resolveOwned(actor);
    if (owned === null) throw new QcProgramError("Cannot borrow a retired canonical actor");
    const { slots } = this.host, source = this.host.actors.sourceOf(actor);
    if (source?.provider === slots.options.provider) throw new QcProgramError("Source actors must use their original QC row");
    const existing = this.byActor.get(owned);
    if (existing !== undefined) return this.host.machine().entities.reference(existing.slot);
    const { storage, lifetime, capacity } = slots.options, now = slots.options.now(), count = storage.count();
    let selected = count;
    for (let slot = lifetime.firstDynamicSlot; slot < count; slot++) {
      const state = storage.read(slot);
      if (state.free && (lifetime.reuse === "immediate" || lifetime.reusableAfter(state.freedAt, now))) { selected = slot; break; }
    }
    if (selected >= capacity) throw new QcProgramError("No free QC row for a borrowed actor");
    if (slots.at(selected) !== null || this.bySlot.has(selected)) throw new QcProgramError("Borrowed QC row collides with a current source actor");
    if (selected === count) storage.setCount(count + 1);
    storage.initialize(selected, owned);
    const borrowed: BorrowedActor = { actor: owned, slot: selected, classname: null };
    this.byActor.set(owned, borrowed); this.bySlot.set(selected, borrowed);
    try { this.refresh(borrowed); }
    catch (error) { this.byActor.delete(owned); this.bySlot.delete(selected); storage.clearFreed(selected, now); throw error; }
    return this.host.machine().entities.reference(selected);
  }
  access(reference: number, word: number, words: 1 | 3, kind: "read" | "write"): void {
    const vm = this.host.machine(), borrowed = this.bySlot.get(vm.entities.slot(reference));
    if (borrowed === undefined) return;
    this.host.actors.assertOwned(borrowed.actor);
    const offsets = this.fieldOffsets();
    if (kind === "write") {
      if (words === 1 && privateFields.some(name => word === offsets.get(name))) return;
      throw new QcProgramError("Original QC cannot mutate a borrowed actor outside its source owner");
    }
    const requested: ProjectionField[] = [];
    for (let current = word; current < word + words; current++) {
      const field = this.fieldsByWord.get(current);
      if (field === undefined) throw new QcProgramError(`Borrowed QC actor has no canonical field projection at ${current}`);
      if (!requested.includes(field)) requested.push(field);
    }
    this.refresh(borrowed, requested);
  }
  private fieldOffsets(): ReadonlyMap<ProjectionField, number> {
    if (this.offsets === null) {
      const vm = this.host.machine(), names: readonly ProjectionField[] = [...vectors, ...privateFields, "health", "takedamage", "classname", "solid"];
      this.offsets = new Map(names.map(name => [name, vm.fieldOffset(name)]));
      for (const [name, offset] of this.offsets) {
        const width = vectors.some(value => value === name) ? 3 : 1;
        for (let word = offset; word < offset + width; word++) this.fieldsByWord.set(word, name);
      }
    }
    return this.offsets;
  }
  private refresh(borrowed: BorrowedActor, requested: readonly ProjectionField[] = [...vectors, "health", "takedamage", "classname", "solid"]): void {
    const { actor, slot } = borrowed, vm = this.host.machine(), fields = vm.entities.at(slot), offsets = this.fieldOffsets();
    const offset = (name: ProjectionField): number => {
      const word = offsets.get(name); if (word === undefined) throw new QcProgramError("Missing qualified borrowed field"); return word;
    };
    if (requested.some(name => vectors.some(value => value === name))) {
      const body = this.host.bodies.read(actor.id);
      if (body === null) throw new QcProgramError("Borrowed QC actor has no canonical body");
      const linked = requested.includes("absmin") || requested.includes("absmax") ? this.host.bodies.linked(actor.id)?.absoluteBounds : undefined;
      for (const name of requested) {
        const value = name === "origin" ? body.origin : name === "angles" ? body.angles : name === "velocity" ? body.velocity
          : name === "mins" ? body.bounds.min : name === "maxs" ? body.bounds.max
          : name === "absmin" ? linked?.min ?? { x: body.origin.x + body.bounds.min.x, y: body.origin.y + body.bounds.min.y, z: body.origin.z + body.bounds.min.z }
          : name === "absmax" ? linked?.max ?? { x: body.origin.x + body.bounds.max.x, y: body.origin.y + body.bounds.max.y, z: body.origin.z + body.bounds.max.z }
          : name === "size" ? { x: body.bounds.max.x - body.bounds.min.x, y: body.bounds.max.y - body.bounds.min.y, z: body.bounds.max.z - body.bounds.min.z } : null;
        if (value === null) continue;
        if (![value.x, value.y, value.z].every(value => Number.isFinite(Math.fround(value)))) throw new QcProgramError("Borrowed actor geometry exceeds QC binary32 range");
        fields.setVector(offset(name), value);
      }
    }
    if (requested.includes("health") || requested.includes("takedamage")) {
      const combat = this.host.combat.read(actor.id);
      if (requested.includes("health")) {
        const health = combat?.health ?? 0;
        if (!Number.isFinite(Math.fround(health))) throw new QcProgramError("Borrowed actor health exceeds QC binary32 range");
        fields.setFloat(offset("health"), health);
      }
      if (requested.includes("takedamage")) fields.setFloat(offset("takedamage"), combat?.canTakeDamage === true ? 1 : 0);
    }
    if (requested.includes("classname")) {
      const classname = this.host.classname(actor.id);
      if (classname !== borrowed.classname) {
        fields.setInt(offset("classname"), vm.strings.setEngine(`borrowed-classname:${slot}`, classname, Math.max(128, classname.length + 1)));
        borrowed.classname = classname;
      }
    }
    if (requested.includes("solid")) fields.setFloat(offset("solid"), this.host.solid(actor.id));
  }
  checkpoint() { return [...this.byActor.values()].map(row => ({ actor: savedActorId(row.actor.id), slot: row.slot })); }
  restore(reader: SaveReader): void {
    this.byActor.clear(); this.bySlot.clear();
    if (reader.value === undefined) return;
    for (const entry of reader.list(value => value)) {
      const actor = this.host.actors.resolveSaved(readSavedActor(entry.field("actor"))), slot = entry.field("slot").integer(this.host.slots.options.lifetime.firstDynamicSlot);
      if (actor === null || slot >= this.host.slots.options.storage.count() || this.host.slots.at(slot) !== null || this.host.slots.options.storage.read(slot).free
        || this.byActor.has(actor) || this.bySlot.has(slot) || this.host.actors.sourceOf(actor.id)?.provider === this.host.slots.options.provider)
        return entry.fail("invalid borrowed QC actor mapping");
      const row: BorrowedActor = { actor, slot, classname: null }; this.byActor.set(actor, row); this.bySlot.set(slot, row);
    }
  }
}
