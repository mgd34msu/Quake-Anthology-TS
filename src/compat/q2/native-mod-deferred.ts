import type { GuestAddress } from "../../contracts/execution.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { DamageRequest } from "../../contracts/gameplay.ts";
import type { NativeModDeferredDamage, NativeModScalarField } from "../../contracts/native-mod-callbacks.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { GuestWrittenRange } from "../../guest/core/contracts.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import type { NativeModCombatCalls } from "./native-mod-combat.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { captureRequest } from "../../world/gameplay/authority.ts";
import { saveQ2Attack, restoreQ2Attack, type Q2AttackCheckpoint } from "../../content/q2/foundation/checkpoint.ts";
import { readQ2AttackCheckpoint } from "../../persistence/q2-foundation.ts";
import { readSavedActor } from "../../persistence/save-image.ts";
import { readVector } from "../../persistence/shared.ts";
import type { SaveReader } from "../../persistence/value.ts";
import { readClassicVector, writeClassicVector } from "./classic/records.ts";

export interface SavedNativeDeferredDamage {
  readonly target: SavedActorId;
  readonly attack: Q2AttackCheckpoint;
  readonly request: Omit<DamageRequest, "target" | "attack">;
  readonly blood: number;
  readonly knockback: number;
  readonly point: Vec3;
  readonly mod: readonly number[];
  readonly attackerSlot: number | null;
  readonly inflictorSlot: number | null;
}
export function readNativeDeferredDamage(reader: SaveReader): SavedNativeDeferredDamage {
  const request = reader.field("request"), mod = reader.field("mod").list(value => value.integer(0));
  if (mod.length !== 3 || mod.some(value => value > 255)) return reader.fail("native deferred damage requires its three-byte mod_t");
  return { target: readSavedActor(reader.field("target")), attack: readQ2AttackCheckpoint(reader.field("attack")),
    request: { amount: request.field("amount").finite(), knockback: request.field("knockback").finite(), point: readVector(request.field("point")), direction: readVector(request.field("direction")), normal: readVector(request.field("normal")), delivery: request.field("delivery").choice("direct", "radius") },
    blood: reader.field("blood").finite(), knockback: reader.field("knockback").finite(), point: readVector(reader.field("point")), mod,
    attackerSlot: reader.field("attackerSlot").nullable(value => value.integer(0)), inflictorSlot: reader.field("inflictorSlot").nullable(value => value.integer(0)) };
}

/** The original accumulator owns batching; these records retain the originating canonical attack. */
export class NativeModDeferredDamageState {
  private readonly pending = new Map<ActorId, DamageRequest>();
  private readonly processing: DamageRequest[] = [];
  constructor(readonly definition: NativeModDeferredDamage, readonly health: NativeModScalarField, readonly host: NativeModHost,
    readonly services: ModHostServices, readonly calls: NativeModCombatCalls, readonly current: () => DamageRequest | null) {}
  private at(slot: number, offset: number): GuestAddress { return this.host.memory.offset(this.host.entity(slot).address, BigInt(offset)); }
  private scalar(slot: number, field: NativeModScalarField, value?: number): number { return this.calls.scalar(this.host.entity(slot).address, field, value); }
  private pointerSlot(slot: number, offset: number): number | null {
    const address = this.host.memory.readPointer(this.at(slot, offset)); if (address === null) return null;
    const table = this.host.entities(), relative = address.byteOffset - table.base.byteOffset;
    if (relative < 0n || relative % BigInt(table.stride) !== 0n || relative / BigInt(table.stride) >= BigInt(table.count)) throw new Error("Native deferred damage pointer is outside its source table");
    return Number(relative / BigInt(table.stride));
  }
  changed(slot: number, range: GuestWrittenRange): void {
    const actor = this.calls.owner(slot); if (actor === null) return;
    const { receipt, blood } = this.definition, hits = (offset: number, bytes: number) => range.byteOffset < offset + bytes && offset < range.byteOffset + range.byteLength;
    if (hits(receipt, 1) && this.scalar(slot, blood) !== 0) {
      const request = this.current();
      if (request === null || request.target !== actor.id) throw new Error("Native deferred damage has no original attack provenance");
      this.pending.set(actor.id, captureRequest(request));
    }
    if (hits(blood.offset, blood.encoding.endsWith("64") ? 8 : blood.encoding.endsWith("16") ? 2 : blood.encoding.endsWith("8") ? 1 : 4) && this.scalar(slot, blood) === 0) this.pending.delete(actor.id);
  }
  attack(actor: ActorId): DamageRequest | null { const request = this.processing.at(-1); return request?.target === actor ? request : null; }
  process<Result>(actor: ActorId, slot: number, original: () => Result): Result {
    const pending = this.pending.get(actor), blood = this.scalar(slot, this.definition.blood);
    if (pending === undefined || blood === 0) return original();
    this.pending.delete(actor);
    const request = captureRequest({ ...pending, knockback: this.scalar(slot, this.definition.knockback), point: readClassicVector(this.host.memory, this.at(slot, this.definition.point)) });
    this.processing.push(request);
    try {
      this.services.combat.sourceReaction(request, { reaction: this.scalar(slot, this.health) <= 0 ? "death" : "pain", appliedDamage: blood });
      return original();
    } finally { this.processing.pop(); }
  }
  release(actor: ActorId): void { this.pending.delete(actor); }
  checkpoint(): readonly SavedNativeDeferredDamage[] {
    const records: SavedNativeDeferredDamage[] = [];
    for (const [actor, request] of this.pending) {
      const source = this.services.actors.sourceOf(actor); if (source === null || !this.services.actors.isLive(actor)) continue;
      const slot = source.slot, { attack, target, ...values } = request, definition = this.definition;
      records.push({ target: { slot: target.slot, generation: target.generation }, attack: saveQ2Attack(attack), request: values,
        blood: this.scalar(slot, definition.blood), knockback: this.scalar(slot, definition.knockback), point: readClassicVector(this.host.memory, this.at(slot, definition.point)),
        mod: [...this.host.memory.copy(this.at(slot, definition.mod), 3)], attackerSlot: this.pointerSlot(slot, definition.attacker), inflictorSlot: this.pointerSlot(slot, definition.inflictor) });
    }
    return records;
  }
  validateSaved(records: readonly SavedNativeDeferredDamage[]): void {
    for (const record of records) this.restoreRequest(record);
  }
  private reference(actor: SavedActorId): ActorId { return this.services.referenceSaved?.(actor) ?? this.services.actors.referenceSaved(actor, "current"); }
  private restoreRequest(record: SavedNativeDeferredDamage): DamageRequest {
    const target = this.reference(record.target), source = this.services.actors.sourceOf(target);
    if (source === null || source.provider !== this.host.memory.module.id || !this.services.actors.isLive(target)) throw new Error("Saved deferred damage target is not owned by this native mod");
    return captureRequest({ ...record.request, target, attack: restoreQ2Attack(record.attack, actor => this.reference(actor)) });
  }
  restore(records: readonly SavedNativeDeferredDamage[]): void {
    const prepared = records.map(record => ({ record, request: this.restoreRequest(record) })), definition = this.definition, { memory } = this.host;
    for (const { record } of prepared) for (const slot of [record.attackerSlot, record.inflictorSlot]) if (slot !== null && slot >= this.host.entities().count) throw new Error("Saved deferred damage pointer exceeds the restored source table");
    this.pending.clear();
    for (const { record, request } of prepared) {
      const source = this.services.actors.sourceOf(request.target); if (source === null) throw new Error("Saved deferred damage target lost its source slot");
      const slot = source.slot;
      memory.writePointer(this.at(slot, definition.attacker), record.attackerSlot === null ? null : this.host.entity(record.attackerSlot).address);
      memory.writePointer(this.at(slot, definition.inflictor), record.inflictorSlot === null ? null : this.host.entity(record.inflictorSlot).address);
      this.scalar(slot, definition.blood, record.blood); this.scalar(slot, definition.knockback, record.knockback);
      writeClassicVector(memory, this.at(slot, definition.point), record.point); memory.write(this.at(slot, definition.mod), new Uint8Array(record.mod));
      this.pending.set(request.target, request);
    }
  }
  clear(): void { this.pending.clear(); }
}
