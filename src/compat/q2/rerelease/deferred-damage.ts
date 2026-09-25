// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { AttackProvenance, DamageRequest } from "../../../contracts/gameplay.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { saveQ2Attack, restoreQ2Attack } from "../../../content/q2/foundation/checkpoint.ts";
import type { Q2AttackCheckpoint } from "../../../content/q2/foundation/checkpoint.ts";
import { canonicalCauseFromNative } from "../../../content/q2/missionpacks/damage.ts";
import { captureRequest } from "../../../world/gameplay/authority.ts";
import { X86AbiAdapter } from "../../../guest/abi/adapter.ts";
import { integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { rereleaseAbi } from "./api.ts";
import { nativeCombatSignature, readNativeCombatField, readNativeCombatArguments } from "../native-combat-call.ts";
import { RereleaseSourceEdict } from "./source-state.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";
import type { RereleaseForeignDamageServices } from "./foreign-actors.ts";

export type RereleaseSavedActor = { readonly kind: "native"; readonly slot: number; readonly generation: number }
  | { readonly kind: "shared"; readonly actor: SavedActorId };
export interface RereleaseDeferredDamageSave {
  readonly target: RereleaseSavedActor;
  readonly attack: Q2AttackCheckpoint;
  readonly references: readonly { readonly actor: SavedActorId; readonly reference: RereleaseSavedActor }[];
  readonly request: Omit<DamageRequest, "target" | "attack">;
  readonly blood: number; readonly knockback: number; readonly point: Vec3; readonly mod: readonly number[];
  // Native pointers follow edict slots even after free/reuse; attack references above retain the originating lifetime.
  readonly attackerSlot: number; readonly inflictorSlot: number;
}
interface Tracked {
  readonly actor: OwnedActor; readonly view: RawEntityView; readonly generation: number;
  readonly remove: (() => void)[]; pending: DamageRequest | null;
}

/** Observes the DLL's accumulator and callback boundary; the DLL retains all monster logic and stores. */
export class RereleaseDeferredDamage {
  readonly #tracked = new Map<ActorId, Tracked>();
  readonly #calls: { readonly stack: bigint; readonly request: DamageRequest }[] = [];
  readonly #removeEntry: () => void;
  readonly #removePain: () => void;
  constructor(readonly host: RereleaseQ2GuestHost, readonly services: RereleaseForeignDamageServices,
    readonly currentRequest: (actor: ActorId) => DamageRequest | null, readonly intercepted: () => boolean) {
    const { callbacks, cpu } = host.module.options.runner.options, adapter = new X86AbiAdapter(rereleaseAbi);
    const entries = host.options.nativeEntries; if (entries === undefined) throw new Error("Missing declared native entries");
    const calls = host.module.requireWorldProfile().calls;
    const damageSignature = nativeCombatSignature(calls.damage, "damage", rereleaseAbi), processSignature = nativeCombatSignature(calls.processPain, "deferred-reaction", rereleaseAbi);
    this.#removeEntry = callbacks.observeEntry(entries.damage, () => {
      if (intercepted()) return;
      const args = readNativeCombatArguments(calls.damage, "damage", adapter.arguments(cpu, damageSignature), 8), stack = cpu.state.registers.read("rsp", 64);
      while (this.#calls.length > 0 && (this.#calls.at(-1)?.stack ?? 0n) <= stack) this.#calls.pop();
      const view = host.module.entities().fromPointer(requiredPointer(args, 0));
      const source = new RereleaseSourceEdict(view, host.module);
      if ((host.module.memory.readUint32(source.at("shared.svflags")) & 4) === 0) return;
      const actor = host.actor(view); if (actor === null) return;
      this.track(view);
      const request = currentRequest(actor.id) ?? this.#nativeRequest(actor.id, args);
      this.#calls.push({ stack, request: captureRequest(request) });
    });
    this.#removePain = callbacks.observeEntry(entries.processPain, () => {
      const address = pointer([readNativeCombatField(cpu, calls.processPain, processSignature, "target")], 0);
      if (address === null) return;
      const view = host.module.entities().fromPointer(address), actor = host.actor(view);
      const entry = actor === null ? undefined : this.#tracked.get(actor.id);
      if (entry === undefined || !this.#valid(entry) || entry.pending === null) return;
      const memory = host.module.memory, blood = memory.readInt32(this.#at(view, this.host.module.requireWorldProfile().monster.blood));
      if (blood === 0) return;
      const pending = entry.pending; entry.pending = null;
      host.options.engine.combat.sourceReaction({ ...pending, knockback: memory.readInt32(this.#at(view, this.host.module.requireWorldProfile().monster.knockback)), point: this.#point(view) },
        { reaction: new RereleaseSourceEdict(view, host.module).health <= 0 ? "death" : "pain", appliedDamage: blood });
    });
  }
  #at(view: RawEntityView, offset: number): GuestAddress { return this.host.module.memory.offset(view.address, BigInt(offset)); }
  #valid(entry: Tracked): boolean {
    const source = new RereleaseSourceEdict(entry.view, this.host.module);
    return this.host.options.engine.actors.isLive(entry.actor.id) && source.generation() === entry.generation
      && this.host.module.memory.readUint8(source.at("shared.inuse")) !== 0;
  }
  track(view: RawEntityView): void {
    const source = new RereleaseSourceEdict(view, this.host.module);
    if ((this.host.module.memory.readUint32(source.at("shared.svflags")) & 4) === 0) return;
    const actor = this.host.actor(view); if (actor === null || this.#tracked.has(actor.id)) return;
    const entry: Tracked = { actor, view, generation: source.generation(), remove: [], pending: null };
    this.#tracked.set(actor.id, entry);
    const { memory } = this.host.module;
    entry.remove.push(memory.observeWrites(this.#at(view, this.host.module.requireWorldProfile().monster.mod + 2), 1, () => {
      if (!this.#valid(entry)) { this.release(actor); return; }
      const stack = this.host.module.options.runner.options.cpu.state.registers.read("rsp", 64);
      const call = [...this.#calls].reverse().find(value => value.stack >= stack && value.request.target === actor.id);
      if (call === undefined) throw new Error("Native monster accumulation has no damage call provenance");
      entry.pending = call.request;
    }));
    entry.remove.push(memory.observeWrites(this.#at(view, this.host.module.requireWorldProfile().monster.blood), 4, () => {
      if (memory.readInt32(this.#at(view, this.host.module.requireWorldProfile().monster.blood)) === 0) entry.pending = null;
    }));
  }
  #point(view: RawEntityView): Vec3 {
    const memory = this.host.module.memory;
    return { x: memory.readFloat32(this.#at(view, this.host.module.requireWorldProfile().monster.point)), y: memory.readFloat32(this.#at(view, this.host.module.requireWorldProfile().monster.point + 4)), z: memory.readFloat32(this.#at(view, this.host.module.requireWorldProfile().monster.point + 8)) };
  }
  #pointerSlot(view: RawEntityView, offset: number): number {
    const address = this.host.module.memory.readPointer(this.#at(view, offset));
    if (address === null) throw new Error("Native monster accumulation has a null edict pointer");
    return this.host.module.entities().fromPointer(address).slot;
  }
  #nativeRequest(target: ActorId, args: readonly GuestCallValue[]): DamageRequest {
    const memory = this.host.module.memory, mod = args[9];
    if (mod?.kind !== "aggregate" || mod.bytes.length !== 3) throw new Error("Invalid native monster mod_t");
    const id = mod.bytes[0]; if (id === undefined) throw new Error("Missing native monster MOD");
    const native = { edition: "rerelease", id, friendlyFire: mod.bytes[1] !== 0, noPointLoss: mod.bytes[2] !== 0 } satisfies Extract<AttackProvenance["cause"], { kind: "q2" }>["native"];
    const cause = canonicalCauseFromNative(native); if (cause === null) throw new Error("Unclassified native monster damage cause");
    const actor = (index: number): ActorId => {
      const found = this.host.actor(this.host.module.entities().fromPointer(requiredPointer(args, index)));
      if (found === null) throw new Error("Native damage references a stale actor");
      return found.id;
    };
    const vector = (index: number): Vec3 => {
      const address = requiredPointer(args, index);
      return { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) };
    };
    const attacker = actor(2), inflictor = actor(1), damageFlags = Number(integer(args, 8));
    return { target, amount: Number(integer(args, 6)), knockback: Number(integer(args, 7)), point: vector(4), direction: vector(3), normal: vector(5),
      delivery: (damageFlags & 1) !== 0 ? "radius" : "direct",
      attack: { ...this.services.provenance(attacker, inflictor, target), attacker, inflictor, cause: { kind: "q2", meansOfDeath: cause, native, damageFlags } } };
  }
  release(actor: OwnedActor): void {
    const entry = this.#tracked.get(actor.id); if (entry === undefined) return;
    this.#tracked.delete(actor.id); for (const remove of entry.remove) remove();
  }
  clear(): void { for (const entry of [...this.#tracked.values()]) this.release(entry.actor); this.#calls.length = 0; }
  close(): void { this.#removePain(); this.#removeEntry(); this.clear(); this.#calls.length = 0; }
  saveActor(actor: ActorId): RereleaseSavedActor {
    const source = this.host.options.engine.actors.sourceOf(actor);
    if (source?.provider === this.host.module.memory.module.id) {
      const view = this.host.module.entities().atSlot(source.slot);
      const current = this.host.actor(view);
      if (current?.id.equals(actor)) return { kind: "native", slot: source.slot, generation: new RereleaseSourceEdict(view, this.host.module).generation() };
    }
    return { kind: "shared", actor: { slot: actor.slot, generation: actor.generation } };
  }
  restoreActor(saved: RereleaseSavedActor, domain: "checkpoint" | "current" = "current"): ActorId {
    if (saved.kind === "shared") return this.host.options.engine.actors.referenceSaved(saved.actor, domain);
    const view = this.host.module.entities().atSlot(saved.slot), source = new RereleaseSourceEdict(view, this.host.module);
    if (source.generation() !== saved.generation) throw new Error("Saved native damage actor generation changed");
    const actor = this.host.actor(view); if (actor === null) throw new Error("Saved native damage actor is not live");
    return actor.id;
  }
  save(): readonly RereleaseDeferredDamageSave[] {
    const memory = this.host.module.memory, saved: RereleaseDeferredDamageSave[] = [];
    for (const entry of this.#tracked.values()) {
      const request = entry.pending; if (request === null || !this.#valid(entry)) continue;
      const { attack, target, ...values } = request;
      const references: { actor: SavedActorId; reference: RereleaseSavedActor }[] = [];
      for (const actor of [attack.attacker, attack.inflictor, attack.originatingProjectile]) {
        if (actor != null) references.push({ actor: { slot: actor.slot, generation: actor.generation }, reference: this.saveActor(actor) });
      }
      saved.push({ target: this.saveActor(target), attack: saveQ2Attack(attack), references, request: values,
        blood: memory.readInt32(this.#at(entry.view, this.host.module.requireWorldProfile().monster.blood)), knockback: memory.readInt32(this.#at(entry.view, this.host.module.requireWorldProfile().monster.knockback)), point: this.#point(entry.view),
        mod: [...memory.copy(this.#at(entry.view, this.host.module.requireWorldProfile().monster.mod), 3)], attackerSlot: this.#pointerSlot(entry.view, this.host.module.requireWorldProfile().monster.attacker), inflictorSlot: this.#pointerSlot(entry.view, this.host.module.requireWorldProfile().monster.inflictor) });
    }
    return saved;
  }
  restore(saved: readonly RereleaseDeferredDamageSave[], domain: "checkpoint" | "current" = "current"): void {
    const memory = this.host.module.memory;
    for (const state of saved) {
      const target = this.restoreActor(state.target, domain), source = this.host.options.engine.actors.sourceOf(target);
      if (source === null) throw new Error("Saved monster has no native source slot");
      const view = this.host.module.entities().atSlot(source.slot);
      memory.writePointer(this.#at(view, this.host.module.requireWorldProfile().monster.attacker), this.host.module.entities().atSlot(state.attackerSlot).address);
      memory.writePointer(this.#at(view, this.host.module.requireWorldProfile().monster.inflictor), this.host.module.entities().atSlot(state.inflictorSlot).address);
      memory.writeInt32(this.#at(view, this.host.module.requireWorldProfile().monster.blood), state.blood); memory.writeInt32(this.#at(view, this.host.module.requireWorldProfile().monster.knockback), state.knockback);
      [state.point.x, state.point.y, state.point.z].forEach((value, index) => memory.writeFloat32(this.#at(view, this.host.module.requireWorldProfile().monster.point + index * 4), value));
      if (state.mod.length !== 3) throw new Error("Invalid saved native monster mod_t");
      memory.write(this.#at(view, this.host.module.requireWorldProfile().monster.mod), new Uint8Array(state.mod));
      this.track(view); const entry = this.#tracked.get(target); if (entry === undefined) throw new Error("Saved pending damage target is not a monster");
      const attack = restoreQ2Attack(state.attack, actor => {
        const reference = state.references.find(value => value.actor.slot === actor.slot && value.actor.generation === actor.generation);
        if (reference === undefined) throw new Error("Missing saved native damage reference");
        return this.restoreActor(reference.reference, domain);
      });
      entry.pending = captureRequest({ ...state.request, target, attack });
    }
  }
}
