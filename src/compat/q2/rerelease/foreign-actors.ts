// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { AttackProvenance, DamageOutcome, DamageRequest, Q2NativeCause } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { canonicalCauseFromNative, nativeCauseFromCanonical } from "../../../content/q2/missionpacks/damage.ts";
import { integer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import type { SourceDamageResult } from "../../../world/gameplay/authority.ts";
import { RereleaseSourceEdict } from "./source-state.ts";
import { RereleaseSourceClient } from "./source-state.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";
import { guestInt, guestPointer, resultPointer } from "./module.ts";
import { rereleaseDamageSignature, rereleaseFreeSignature, rereleaseModLayout, rereleaseSpawnSignature } from "./native-entries.ts";
import type { RereleaseNativeEntries } from "./native-entries.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";

export interface RereleaseForeignDamageServices {
  provenance(attacker: ActorId, inflictor: ActorId, target: ActorId): Omit<AttackProvenance, "attacker" | "inflictor" | "cause">;
}
interface Projection { readonly actor: OwnedActor; readonly view: RawEntityView; readonly generation: number; releasing: boolean; syncing: boolean; }

/** Native slots are ABI projections. Existing shared actors retain their bodies, inventories and combat bindings. */
export class RereleaseForeignActors {
  readonly #actors = new Map<ActorId, Projection>();
  readonly #slots = new Map<number, Projection>();
  readonly #removeEntry: () => void;
  readonly #damageFrames: object[] = [];
  #closed = false;
  constructor(readonly host: RereleaseQ2GuestHost, readonly entries: RereleaseNativeEntries, readonly services: RereleaseForeignDamageServices) {
    const { module } = host, { callbacks, cpu } = module.options.runner.options;
    this.#removeEntry = callbacks.bindEntry(entries.damage, { id: `${module.memory.module.id}:foreign-damage`, signature: rereleaseDamageSignature,
      invoke: (_context, args) => { this.#incoming(args); return { kind: "void" }; } }, () => {
      const address = module.memory.pointer(cpu.state.registers.read("rcx", 64));
      if (address === null) return false;
      const entry = [...this.#slots.values()].find(candidate => candidate.view.address.byteOffset === address.byteOffset);
      if (entry === undefined || this.lookup(entry.view) === undefined) return false;
      const source = new RereleaseSourceEdict(entry.view, module);
      return !entry.releasing && host.options.engine.actors.isLive(entry.actor.id)
        && module.memory.readUint8(source.at("shared.inuse")) !== 0;
    });
  }
  released(actor: OwnedActor): void { const entry = this.#actors.get(actor.id); if (entry !== undefined) this.#release(entry); }
  lookup(view: RawEntityView): OwnedActor | null | undefined {
    const entry = this.#slots.get(view.slot);
    if (entry === undefined) return undefined;
    const source = new RereleaseSourceEdict(view, this.host.module);
    if (entry.generation !== source.generation() || entry.view.address.byteOffset !== view.address.byteOffset) {
      this.#slots.delete(view.slot); this.#actors.delete(entry.actor.id); return undefined;
    }
    return entry.releasing || !this.host.options.engine.actors.isLive(entry.actor.id) ? null : entry.actor;
  }
  address(actor: ActorId): GuestAddress {
    if (this.#closed) throw new Error("Foreign native projections are closed");
    const owned = this.host.options.engine.actors.resolveOwned(actor);
    if (owned === null) throw new Error("Cannot project a stale foreign actor");
    let entry = this.#actors.get(actor);
    if (entry !== undefined && new RereleaseSourceEdict(entry.view, this.host.module).generation() !== entry.generation) {
      this.#actors.delete(actor); this.#slots.delete(entry.view.slot); entry = undefined;
    }
    if (entry === undefined) {
      const address = resultPointer(this.host.module.invoke(this.entries.spawn, rereleaseSpawnSignature, []));
      if (address === null) throw new Error("Native G_Spawn returned null");
      const view = this.host.module.entities().fromPointer(address), source = new RereleaseSourceEdict(view, this.host.module);
      entry = { actor: owned, view, generation: source.generation(), releasing: false, syncing: false };
      this.#actors.set(actor, entry); this.#slots.set(view.slot, entry);
    }
    try { this.#sync(entry); }
    catch (error) { this.#release(entry); throw error; }
    return entry.view.address;
  }
  synchronize(): void { for (const entry of [...this.#actors.values()]) this.#sync(entry); }
  #sync(entry: Projection): void {
    if (entry.releasing || entry.syncing) return;
    const { engine } = this.host.options, { module } = this.host, memory = module.memory;
    const body = engine.bodies.read(entry.actor.id), combat = engine.combat.read(entry.actor.id);
    if (body === null || combat === null) throw new Error("Foreign damage projection requires existing body and combat bindings");
    const source = new RereleaseSourceEdict(entry.view, module);
    if (source.generation() !== entry.generation) {
      this.#actors.delete(entry.actor.id); this.#slots.delete(entry.view.slot); this.address(entry.actor.id); return;
    }
    entry.syncing = true;
    try {
      source.body({ address: actor => this.host.addressForActor(actor), actor: address => this.#actor(address) }).write(body);
      source.health = combat.health;
      memory.writeInt32(source.at("mass"), combat.mass); memory.writeUint8(source.at("takedamage"), combat.canTakeDamage ? 1 : 0);
      memory.writeInt32(source.at("movetype"), 0); // MOVETYPE_NONE: the shared owner alone advances the foreign body.
      memory.writeUint32(source.at("shared.svflags"), 1); // SVF_NOCLIENT: no duplicate native network presentation.
      memory.writePointer(source.at("shared.client"), null);
      memory.writePointer(source.at("classname"), this.host.core.string("foreign_actor"));
      memory.writeUint8(source.at("shared.solid"), 2);
      const linked = engine.bodies.linked(entry.actor.id);
      source.writeVector("shared.absmin", linked?.absoluteBounds.min ?? { x: body.origin.x + body.bounds.min.x, y: body.origin.y + body.bounds.min.y, z: body.origin.z + body.bounds.min.z });
      source.writeVector("shared.absmax", linked?.absoluteBounds.max ?? { x: body.origin.x + body.bounds.max.x, y: body.origin.y + body.bounds.max.y, z: body.origin.z + body.bounds.max.z });
      memory.writeUint8(source.at("shared.linked"), linked === null ? 0 : 1);
    } finally { entry.syncing = false; }
  }
  #actor(address: GuestAddress): ActorId {
    const actor = this.host.actor(this.host.module.entities().fromPointer(address));
    if (actor === null) throw new Error("Native damage references a stale edict");
    return actor.id;
  }
  #vector(address: GuestAddress): Vec3 {
    const memory = this.host.module.memory;
    return { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) };
  }
  #incoming(args: readonly GuestCallValue[]): void {
    const target = this.#actor(requiredPointer(args, 0)), inflictor = this.#actor(requiredPointer(args, 1)), attacker = this.#actor(requiredPointer(args, 2));
    const mod = args[9];
    if (mod?.kind !== "aggregate" || mod.bytes.length !== 3) throw new Error("Native damage requires the retail mod_t ABI");
    const id = mod.bytes[0]; if (id === undefined) throw new Error("Missing native damage ID");
    const native: Q2NativeCause = { edition: "rerelease", id, friendlyFire: mod.bytes[1] !== 0, noPointLoss: mod.bytes[2] !== 0 };
    const canonical = canonicalCauseFromNative(native); if (canonical === null) throw new Error("Unclassified native damage cause");
    const damageFlags = Number(integer(args, 8));
    this.host.options.engine.combat.apply({ target, amount: Number(integer(args, 6)), knockback: Number(integer(args, 7)),
      direction: this.#vector(requiredPointer(args, 3)), point: this.#vector(requiredPointer(args, 4)), normal: this.#vector(requiredPointer(args, 5)),
      delivery: (damageFlags & 1) !== 0 ? "radius" : "direct", attack: { ...this.services.provenance(attacker, inflictor, target), attacker, inflictor,
        cause: { kind: "q2", meansOfDeath: canonical, damageFlags, native } } });
    const entry = this.#actors.get(target); if (entry !== undefined && !entry.releasing) this.#sync(entry);
  }
  damageNative(request: DamageRequest): DamageOutcome {
    const { module } = this.host, { engine } = this.host.options, memory = module.memory;
    const target = engine.actors.sourceOf(request.target);
    if (target === null || target.provider !== memory.module.id) throw new Error("Native damage execution requires a native target");
    if (request.attack.cause.kind !== "q2") throw new Error("Native damage requires a classified Q2 cause");
    const cause = request.attack.cause, native = cause.native?.edition === "rerelease" ? cause.native : nativeCauseFromCanonical({ edition: "rerelease" }, cause.meansOfDeath);
    if (native === null || native.edition !== "rerelease") throw new Error("Damage cause has no native representation");
    const view = module.entities().atSlot(target.slot), source = new RereleaseSourceEdict(view, module);
    if ((memory.readUint32(source.at("shared.svflags")) & 4) !== 0) throw new Error("Native monster damage requires its deferred reaction provenance binding");
    const attacker = this.host.addressForActor(request.attack.attacker ?? engine.worldActor()), inflictor = this.host.addressForActor(request.attack.inflictor ?? engine.worldActor());
    return engine.combat.runSourceDamage(request, observer => {
      const frame = {};
      const state: { result: SourceDamageResult | null } = { result: null };
      let health = source.health, velocity = source.vector("velocity"), armor = engine.combat.read(request.target)?.armor;
      if (armor === undefined) throw new Error("Native target lacks a combat binding");
      this.#damageFrames.push(frame);
      const initialHealth = health, removeWrites: (() => void)[] = [], removeEntries: (() => void)[] = [];
      let vectors: GuestAddress | null = null;
      const stopWrites = (): void => { for (const remove of removeWrites.splice(0)) remove(); };
      const current = (): boolean => this.#damageFrames.at(-1) === frame && state.result === null;
      try {
        removeWrites.push(memory.observeWrites(source.at("health"), 4, () => {
          if (!current()) return;
          const after = source.health;
          if (after !== health) { const before = health; health = after; observer.stored({ kind: "health", before, after }); }
        }));
        removeWrites.push(memory.observeWrites(source.at("velocity"), 12, () => {
          if (!current()) return;
          const after = source.vector("velocity"), before = velocity; velocity = after;
          observer.stored({ kind: "source-velocity", before, after, movementProvider: request.attack.movementProvider });
        }));
        if (source.client !== null) {
          const client = new RereleaseSourceClient(source.client, module, retailRereleaseClientProfile);
          removeWrites.push(memory.observeWrites(client.at("pers.inventory"), retailRereleaseClientProfile.inventoryCount * 4, () => {
            if (!current()) return;
            const after = engine.combat.read(request.target)?.armor;
            if (after === undefined || armor === undefined) throw new Error("Native armor binding disappeared during damage");
            const before = armor; armor = after;
            observer.stored({ kind: "armor", before, after });
          }));
        }
        const { callbacks, cpu } = module.options.runner.options;
        for (const reaction of ["pain", "death"]) {
          const address = memory.readPointer(source.at(reaction === "pain" ? "pain.value" : "die.value"));
          if (address === null) continue;
          removeEntries.push(callbacks.observeEntry(address, () => {
            if (!current() || cpu.state.registers.read("rcx", 64) !== view.address.byteOffset) return;
            state.result = { reaction: reaction === "pain" ? "pain" : "death", appliedDamage: Number(BigInt.asIntN(32, cpu.state.registers.read("r9", 64))) };
            stopWrites(); observer.beforeReaction(state.result);
          }));
        }
        const allocatedVectors = memory.allocate({ byteLength: 36, alignment: 4n, label: "Q2 damage vectors" });
        vectors = allocatedVectors;
        [request.direction, request.point, request.normal].forEach((vector, index) => {
          const address = memory.offset(allocatedVectors, BigInt(index * 12));
          memory.writeFloat32(address, vector.x); memory.writeFloat32(memory.offset(address, 4n), vector.y); memory.writeFloat32(memory.offset(address, 8n), vector.z);
        });
        module.invoke(this.entries.damage, rereleaseDamageSignature, [guestPointer(view.address), guestPointer(inflictor), guestPointer(attacker),
          guestPointer(vectors), guestPointer(memory.offset(vectors, 12n)), guestPointer(memory.offset(vectors, 24n)), guestInt(Math.trunc(request.amount)), guestInt(Math.trunc(request.knockback)), guestInt(cause.damageFlags),
          { kind: "aggregate", layout: rereleaseModLayout, bytes: new Uint8Array([native.id, native.friendlyFire ? 1 : 0, native.noPointLoss ? 1 : 0]) }], view);
        return state.result ?? { reaction: "none", appliedDamage: initialHealth - source.health };
      } finally {
        stopWrites(); for (const remove of removeEntries) remove();
        if (vectors !== null) memory.unmap(vectors, 36); this.#damageFrames.pop(); this.host.reconcile();
      }
    });
  }
  #release(entry: Projection): void {
    if (entry.releasing) return;
    entry.releasing = true;
    try {
      if (new RereleaseSourceEdict(entry.view, this.host.module).generation() === entry.generation) this.host.module.invoke(this.entries.free, rereleaseFreeSignature, [guestPointer(entry.view.address)], entry.view);
    } finally {
      if (this.#actors.get(entry.actor.id) === entry) this.#actors.delete(entry.actor.id);
      if (this.#slots.get(entry.view.slot) === entry) this.#slots.delete(entry.view.slot);
    }
  }
  clear(): void {
    const errors: unknown[] = [];
    for (const entry of [...this.#actors.values()]) { try { this.#release(entry); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw new AggregateError(errors, "Foreign native projection cleanup failed");
  }
  close(): void {
    if (this.#closed) return; this.#closed = true;
    this.#removeEntry(); this.clear();
  }
}
