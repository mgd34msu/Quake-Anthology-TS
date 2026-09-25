// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ArmorState, AttackProvenance, DamageOutcome, DamageRequest, Q2NativeCause, ProtectionChannel } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import { canonicalCauseFromNative } from "../../../content/q2/missionpacks/damage.ts";
import { integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import type { SourceDamageResult, SourceArmorStage } from "../../../world/gameplay/authority.ts";
import { isDeepStrictEqual } from "node:util";
import { RereleaseSourceEdict } from "./source-state.ts";
import { RereleaseSourceClient } from "./source-state.ts";
import type { RereleaseWorldLocation } from "./world-profile.ts";
import { guestInt, guestPointer, resultPointer } from "./module.ts";
import { rereleaseFreeSignature, rereleaseModLayout, rereleaseSpawnSignature } from "./native-entries.ts";
import type { RereleaseNativeEntries } from "./native-entries.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";
import { RereleaseDeferredDamage } from "./deferred-damage.ts";
import { RemovedNativeDamage, q2NativeArmorFlags, q2NativeDamageArguments } from "../native-damage.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../../guest/abi/runner.ts";
import type { GuestCallSignature } from "../../../guest/core/contracts.ts";
import { rereleaseAbi } from "./api.ts";
import { nativeCombatSignature, readNativeCombatField, readNativeCombatArguments, lowerNativeCombatArguments } from "../native-combat-call.ts";

export interface RereleaseForeignDamageServices {
  provenance(attacker: ActorId, inflictor: ActorId, target: ActorId): Omit<AttackProvenance, "attacker" | "inflictor" | "cause">;
}
interface DamageFrame { readonly request: DamageRequest; entered: boolean; stack: bigint | null; observing: boolean; }
interface Projection { readonly actor: OwnedActor; readonly view: RawEntityView; readonly generation: number; releasing: boolean; syncing: boolean; }
export interface RereleaseProjectionSave { readonly slot: number; readonly actor: SavedActorId; }

/** Native slots are ABI projections. Existing shared actors retain their bodies, inventories and combat bindings. */
export class RereleaseForeignActors {
  readonly #actors = new Map<ActorId, Projection>();
  readonly #slots = new Map<number, Projection>();
  readonly #damageSignature: GuestCallSignature;
  readonly #powerSignature: GuestCallSignature;
  readonly #image: GuestAddress;
  readonly #removeEntry: () => void;
  readonly #removeContinuation: () => void;
  readonly #damageFrames: DamageFrame[] = [];
  readonly #inventoryPublications: { readonly frame: DamageFrame | undefined; readonly actor: ActorId; readonly committed: () => boolean }[] = [];
  readonly #armorBindings = new Map<OwnedActor, { readonly stages: Partial<Record<ProtectionChannel, Parameters<SourceArmorStage["bind"]>[0]>>; readonly armor: () => ArmorState }>();
  readonly #armorHooks: (() => void)[] = [];
  #powerBypass: bigint | "pending" | null = null;
  readonly deferred: RereleaseDeferredDamage;
  #restoring: { readonly actors: ReadonlyMap<number, SavedActorId>; readonly domain: "checkpoint" | "current" } | null = null;
  #closed = false;
  constructor(readonly host: RereleaseQ2GuestHost, readonly entries: RereleaseNativeEntries, readonly services: RereleaseForeignDamageServices) {
    const { module } = host, { callbacks, cpu } = module.options.runner.options, profile = module.requireWorldProfile();
    this.#damageSignature = nativeCombatSignature(profile.calls.damage, "damage", rereleaseAbi);
    this.#powerSignature = nativeCombatSignature(profile.calls.powerArmor, "power-armor", rereleaseAbi);
    this.#image = module.memory.offset(entries.damage, -BigInt(profile.entries.damage));
    this.#removeContinuation = callbacks.observeEntry(entries.damage, () => {
      const frame = this.#damageFrames.at(-1);
      if (frame === undefined || frame.stack !== null) return;
      frame.stack = cpu.state.registers.read("rsp", 64);
    });
    this.deferred = new RereleaseDeferredDamage(host, services, actor => {
      const frame = this.#damageFrames.at(-1);
      if (frame === undefined || frame.entered || frame.request.target !== actor) return null;
      frame.entered = true; return frame.request;
    }, () => this.#interceptNativeDamage());
    this.#removeEntry = callbacks.bindEntry(entries.damage, { id: `${module.memory.module.id}:foreign-damage`, signature: this.#damageSignature,
      invoke: (_context, args) => { this.#incoming(args); return { kind: "void" }; } }, () => {
      const address = pointer([readNativeCombatField(cpu, module.requireWorldProfile().calls.damage, this.#damageSignature, "target")], 0);
      if (address === null) return false;
      const entry = [...this.#slots.values()].find(candidate => candidate.view.address.byteOffset === address.byteOffset);
      if (entry === undefined || this.lookup(entry.view) === undefined) return this.#interceptNativeDamage();
      const source = new RereleaseSourceEdict(entry.view, module);
      return !entry.releasing && host.options.engine.actors.isLive(entry.actor.id)
        && module.memory.readUint8(source.at("shared.inuse")) !== 0;
    });
  }
  withInventoryPublication<T>(actor: ActorId, committed: () => boolean, operation: () => T): T {
    this.#inventoryPublications.push({ frame: this.#damageFrames.at(-1), actor, committed });
    try { return operation(); } finally { this.#inventoryPublications.pop(); }
  }
  #publishesInventory(frame: DamageFrame): boolean {
    if (this.#damageFrames.at(-1) !== frame) return true;
    for (let index = this.#inventoryPublications.length - 1; index >= 0; index--) {
      const scope = this.#inventoryPublications[index];
      if (scope?.frame === frame && scope.actor.equals(frame.request.target)) return scope.committed();
    }
    return true;
  }
  observingDamage(actor: ActorId): boolean {
    const frame = this.#damageFrames.at(-1);
    return frame?.observing === true && frame.request.target.equals(actor);
  }
  #interceptNativeDamage(): boolean {
    const { module } = this.host, { engine } = this.host.options;
    const cpu = module.options.runner.options.cpu;
    if (this.#damageFrames.at(-1)?.stack === cpu.state.registers.read("rsp", 64)) return false;
    const address = pointer([readNativeCombatField(cpu, module.requireWorldProfile().calls.damage, this.#damageSignature, "target")], 0);
    if (address === null) return false;
    const view = module.entities().fromPointer(address);
    if (this.#slots.has(view.slot)) return false;
    const actor = this.host.actor(view);
    return actor !== null && (engine.combat.damageOperation.active || this.#armorBindings.has(actor));
  }
  armorStage(view: RawEntityView, armor: () => ArmorState, channel: ProtectionChannel): SourceArmorStage {
    return { bind: intercept => {
      const actor = this.host.actor(view);
      if (actor === null) throw new Error("Native armor stage has no live actor");
      const binding = this.#armorBindings.get(actor) ?? { stages: {}, armor };
      if (binding.stages[channel] !== undefined) throw new Error("Native armor stage already has an owner");
      binding.stages[channel] = intercept; this.#armorBindings.set(actor, binding);
      try { if (this.#armorHooks.length === 0) this.#installArmorHooks(); }
      catch (error) { delete binding.stages[channel]; if (binding.stages.regular === undefined && binding.stages.powered === undefined) this.#armorBindings.delete(actor); for (const remove of this.#armorHooks.splice(0)) remove(); throw error; }
      return () => {
        if (binding.stages[channel] === intercept) delete binding.stages[channel];
        if (binding.stages.regular === undefined && binding.stages.powered === undefined) this.#armorBindings.delete(actor);
        if (this.#armorBindings.size === 0) for (const remove of this.#armorHooks.splice(0)) remove();
        return undefined;
      };
    } };
  }
  #installArmorHooks(): void {
    const { module } = this.host, { callbacks, cpu } = module.options.runner.options, memory = module.memory;
    const stack = () => cpu.state.registers.read("rsp", 64);
    this.#armorHooks.push(callbacks.observeEntry(this.entries.powerArmor, () => { if (this.#powerBypass === "pending") this.#powerBypass = stack(); }));
    this.#armorHooks.push(callbacks.bindEntry(this.entries.powerArmor, {
      id: `${memory.module.id}:powered-armor`, signature: this.#powerSignature,
      invoke: (_context, sourceArgs) => {
        const args = readNativeCombatArguments(module.requireWorldProfile().calls.powerArmor, "power-armor", sourceArgs, 8);
        const view = module.entities().fromPointer(requiredPointer(args, 0)), actor = this.host.actor(view), frame = this.#damageFrames.at(-1);
        const intercept = actor === null ? undefined : this.#armorBindings.get(actor)?.stages.powered;
        if (actor === null || intercept === undefined || frame === undefined || !frame.request.target.equals(actor.id))
          throw new Error("Native power stage has no active source damage request");
        const original = (): number => {
          const previous = this.#powerBypass; this.#powerBypass = "pending";
          try {
            const result = module.invoke(this.entries.powerArmor, this.#powerSignature, sourceArgs, view);
            if (result.kind !== "int32") throw new Error("Native power stage returned a non-integer result"); return result.value;
          } finally { this.#powerBypass = previous; }
        };
        const saved = intercept({ request: frame.request, amount: Number(integer(args, 3)),
          geometry: { direction: frame.request.direction, point: this.#vector(requiredPointer(args, 1)), normal: this.#vector(requiredPointer(args, 2)) },
          flags: q2NativeArmorFlags(Number(integer(args, 4))) }, original);
        if (!this.host.options.engine.actors.isLive(actor.id)) throw new RemovedNativeDamage(frame.request);
        return guestInt(Math.trunc(saved));
      },
    }, () => {
      if (this.#powerBypass === stack()) return false;
      const address = pointer([readNativeCombatField(cpu, module.requireWorldProfile().calls.powerArmor, this.#powerSignature, "target")], 0);
      if (address === null) return false;
      const actor = this.host.actor(module.entities().fromPointer(address)); return actor !== null && this.#armorBindings.get(actor)?.stages.powered !== undefined;
    }));
    this.#armorHooks.push(module.options.runner.bindInlineRegion(this.entries.regularArmor.entry, this.entries.regularArmor.join, rereleaseAbi, continuation => {
      const profile = module.requireWorldProfile().regularArmor, sourceStack = memory.pointer(stack());
      if (sourceStack === null) throw new Error("Native regular stage has no source stack");
      const read = (location: RereleaseWorldLocation): bigint => {
        if (location.kind === "register") {
          const value = cpu.state.registers.read(location.register, location.storage === "pointer" ? 64 : 32);
          return location.storage === "int32" ? BigInt.asIntN(32, value) : value;
        }
        const address = memory.offset(sourceStack, BigInt(location.offset));
        return location.storage === "pointer" ? memory.readUint64(address) : BigInt(location.storage === "int32" ? memory.readInt32(address) : memory.readUint32(address));
      };
      const write = (location: RereleaseWorldLocation, value: bigint): void => {
        if (location.kind === "register") { cpu.state.registers.write(location.register, location.storage === "pointer" ? 64 : 32, value); return; }
        const address = memory.offset(sourceStack, BigInt(location.offset));
        if (location.storage === "pointer") memory.writeUint64(address, value);
        else if (location.storage === "int32") memory.writeInt32(address, Number(BigInt.asIntN(32, value)));
        else memory.writeUint32(address, Number(BigInt.asUintN(32, value)));
      };
      const address = memory.pointer(read(profile.target));
      const actor = address === null ? null : this.host.actor(module.entities().fromPointer(address));
      const intercept = actor === null ? undefined : this.#armorBindings.get(actor)?.stages.regular;
      if (intercept === undefined) return continuation.execute();
      const frame = this.#damageFrames.at(-1);
      if (actor === null || frame === undefined || !frame.request.target.equals(actor.id)) throw new Error("Native regular stage has no active source damage request");
      const point = memory.pointer(read(profile.point));
      if (point === null) throw new Error("Native regular stage has no source arguments");
      const normal = memory.pointer(read(profile.normal));
      if (normal === null) throw new Error("Native regular stage has no source normal");
      const repair = profile.repair.map(value => ({ target: value.target, value: read(value.source) }));
      let executed = false;
      const saved = intercept({ request: frame.request, amount: Number(read(profile.amount)),
        geometry: { direction: frame.request.direction, point: this.#vector(point), normal: this.#vector(normal) },
        flags: q2NativeArmorFlags(Number(read(profile.flags))) }, () => {
        continuation.execute(); executed = true;
        return Number(read(profile.result));
      });
      if (!this.host.options.engine.actors.isLive(actor.id)) throw new RemovedNativeDamage(frame.request);
      if (!executed) {
        continuation.skip();
        for (const value of repair) write(value.target, value.value);
      }
      write(profile.result, BigInt(Math.trunc(saved)));
      return undefined;
    }));
  }
  released(actor: OwnedActor): void { this.deferred.release(actor); const entry = this.#actors.get(actor.id); if (entry !== undefined) this.#release(entry); }
  lookup(view: RawEntityView): OwnedActor | null | undefined {
    let entry = this.#slots.get(view.slot);
    const saved = this.#restoring?.actors.get(view.slot);
    if (entry === undefined && saved !== undefined) {
      const actors = this.host.options.engine.actors;
      const actor = actors.resolveOwned(actors.referenceSaved(saved, this.#restoring?.domain));
      if (actor === null) throw new Error("Saved foreign projection actor is no longer live");
      const source = new RereleaseSourceEdict(view, this.host.module);
      if (this.host.module.memory.readUint8(source.at("shared.inuse")) === 0) return null;
      entry = { actor, view, generation: source.generation(), releasing: false, syncing: false };
      this.#actors.set(actor.id, entry); this.#slots.set(view.slot, entry);
    }
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
    if (body === null) throw new Error("Foreign native projection requires an existing body binding");
    const source = new RereleaseSourceEdict(entry.view, module);
    if (source.generation() !== entry.generation) {
      this.#actors.delete(entry.actor.id); this.#slots.delete(entry.view.slot); this.address(entry.actor.id); return;
    }
    entry.syncing = true;
    try {
      source.body({ address: actor => this.host.addressForActor(actor), actor: address => this.#actor(address) }).write(body);
      source.health = combat?.health ?? 0;
      memory.writeInt32(source.at("mass"), combat?.mass ?? 0); memory.writeUint8(source.at("takedamage"), combat?.canTakeDamage === true ? 1 : 0);
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
  #incoming(sourceArgs: readonly GuestCallValue[]): void {
    const args = readNativeCombatArguments(this.host.module.requireWorldProfile().calls.damage, "damage", sourceArgs, 8);
    const target = this.#actor(requiredPointer(args, 0)), inflictor = this.#actor(requiredPointer(args, 1)), attacker = this.#actor(requiredPointer(args, 2));
    const mod = args[9];
    if (mod?.kind !== "aggregate" || mod.bytes.length !== 3) throw new Error("Native damage requires the API2023 mod_t ABI");
    const id = mod.bytes[0]; if (id === undefined) throw new Error("Missing native damage ID");
    const native: Q2NativeCause = { edition: "rerelease", id, friendlyFire: mod.bytes[1] !== 0, noPointLoss: mod.bytes[2] !== 0 };
    const canonical = canonicalCauseFromNative(native); if (canonical === null) throw new Error("Unclassified native damage cause");
    const damageFlags = Number(integer(args, 8));
    const request: DamageRequest = { target, amount: Number(integer(args, 6)), knockback: Number(integer(args, 7)),
      direction: this.#vector(requiredPointer(args, 3)), point: this.#vector(requiredPointer(args, 4)), normal: this.#vector(requiredPointer(args, 5)),
      delivery: (damageFlags & 1) !== 0 ? "radius" : "direct", attack: { ...this.services.provenance(attacker, inflictor, target), attacker, inflictor,
        cause: { kind: "q2", meansOfDeath: canonical, damageFlags, native } } };
    if (this.#actors.has(target)) this.host.options.engine.combat.apply(request);
    else this.host.options.engine.combat.apply(request, effective => this.damageNative(effective, sourceArgs));
    const entry = this.#actors.get(target); if (entry !== undefined && !entry.releasing) this.#sync(entry);
  }
  damageNative(input: DamageRequest, sourceArgs?: readonly GuestCallValue[]): DamageOutcome {
    const { module } = this.host, { engine } = this.host.options, memory = module.memory;
    return engine.combat.runSourceDamage(input, (observer, request) => {
      const target = engine.actors.sourceOf(request.target);
      if (target === null || target.provider !== memory.module.id) throw new Error("Native damage execution requires a native target");
      const cause = q2NativeDamageArguments(request, { edition: "rerelease" }), native = cause.native;
      if (native === null || native.edition !== "rerelease") throw new Error("Damage cause has no native representation");
      const view = module.entities().atSlot(target.slot), source = new RereleaseSourceEdict(view, module);
      const monster = (memory.readUint32(source.at("shared.svflags")) & 4) !== 0;
      this.deferred.track(view);
      const attacker = this.host.addressForActor(request.attack.attacker ?? engine.worldActor()), inflictor = this.host.addressForActor(request.attack.inflictor ?? engine.worldActor());
      const frame: DamageFrame = { request, entered: false, stack: null, observing: false };
      const state: { result: SourceDamageResult | null } = { result: null };
      const targetOwner = engine.actors.resolveOwned(request.target), power = targetOwner === null ? undefined : this.#armorBindings.get(targetOwner);
      const readArmor = power?.armor ?? (() => engine.combat.read(request.target)?.armor);
      let health = source.health, velocity = source.vector("velocity"), armor = readArmor(), appliedDamage = 0;
      if (armor === undefined) throw new Error("Native target lacks a combat binding");
      this.#damageFrames.push(frame);
      const removeWrites: (() => void)[] = [], removeEntries: (() => void)[] = [];
      let vectors: GuestAddress | null = null;
      const stopWrites = (): void => { frame.observing = false; for (const remove of removeWrites.splice(0)) remove(); };
      const current = (): boolean => this.#damageFrames.at(-1) === frame && state.result === null;
      try {
        frame.observing = true;
        removeWrites.push(memory.observeWrites(source.at("health"), 4, () => {
          const after = source.health, before = health; health = after;
          if (!current() || after === before) return;
          appliedDamage += before - after;
          observer.stored({ kind: "health", before, after });
        }));
        removeWrites.push(memory.observeWrites(source.at("velocity"), 12, () => {
          const after = source.vector("velocity"), before = velocity; velocity = after;
          if (!current()) return;
          observer.stored({ kind: "source-velocity", before, after, movementProvider: request.attack.movementProvider });
        }));
        if (source.client !== null) {
          const client = new RereleaseSourceClient(source.client, module, module.requireWorldProfile().client);
          removeWrites.push(memory.observeWrites(client.at("pers.inventory"), module.requireWorldProfile().client.inventoryCount * 4, () => {
            if (!this.#publishesInventory(frame)) return;
            const after = readArmor();
            const before = armor; armor = after;
            if (!current()) return;
            if (after === undefined || before === undefined) throw new Error("Native armor binding disappeared during damage");
            const effective = engine.combat.read(request.target)?.armor;
            if (effective === undefined) throw new Error("Native armor binding disappeared during damage");
            const prior = { regular: power?.stages.regular === undefined ? before.regular : effective.regular, powered: power?.stages.powered === undefined ? before.powered : effective.powered };
            if (isDeepStrictEqual(prior, effective)) return;
            observer.stored({ kind: "armor", before: prior, after: effective });
          }));
        }
        const { callbacks, cpu } = module.options.runner.options;
        for (const reaction of monster ? [] : ["pain", "death"] satisfies readonly ("pain" | "death")[]) {
          const address = memory.readPointer(source.at(reaction === "pain" ? "pain.value" : "die.value"));
          if (address === null) continue;
          const call = module.requireWorldProfile().calls[reaction], signature = nativeCombatSignature(call, reaction, rereleaseAbi);
          removeEntries.push(callbacks.observeEntry(address, () => {
            if (!current()) return;
            if (pointer([readNativeCombatField(cpu, call, signature, "target")], 0)?.byteOffset !== view.address.byteOffset) return;
            state.result = { reaction, appliedDamage: Number(integer([readNativeCombatField(cpu, call, signature, "amount")], 0)) };
            stopWrites(); observer.beforeReaction(state.result);
          }));
        }
        const allocatedVectors = memory.allocate({ byteLength: 36, alignment: 4n, label: "Q2 damage vectors" });
        vectors = allocatedVectors;
        [request.direction, request.point, request.normal].forEach((vector, index) => {
          const address = memory.offset(allocatedVectors, BigInt(index * 12));
          memory.writeFloat32(address, vector.x); memory.writeFloat32(memory.offset(address, 4n), vector.y); memory.writeFloat32(memory.offset(address, 8n), vector.z);
        });
        const savedProcessor = captureAbiProcessorState(cpu.state);
        try { module.invoke(this.entries.damage, this.#damageSignature, lowerNativeCombatArguments(module.requireWorldProfile().calls.damage, "damage", [guestPointer(view.address), guestPointer(inflictor), guestPointer(attacker),
          guestPointer(vectors), guestPointer(memory.offset(vectors, 12n)), guestPointer(memory.offset(vectors, 24n)), guestInt(Math.trunc(request.amount)), guestInt(Math.trunc(request.knockback)), guestInt(cause.damageFlags),
          { kind: "aggregate", layout: rereleaseModLayout, bytes: new Uint8Array([native.id, native.friendlyFire ? 1 : 0, native.noPointLoss ? 1 : 0]) }], memory, this.#image, sourceArgs), view); }
        catch (error) {
          if (!(error instanceof RemovedNativeDamage) || error.request !== request) throw error;
          restoreAbiProcessorState(cpu.state, savedProcessor);
        }
        return state.result ?? { reaction: "none", appliedDamage };
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
    this.deferred.clear();
    const errors: unknown[] = [];
    for (const entry of [...this.#actors.values()]) { try { this.#release(entry); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw new AggregateError(errors, "Foreign native projection cleanup failed");
  }
  saveProjections(): readonly RereleaseProjectionSave[] {
    return [...this.#actors.values()].filter(entry => this.lookup(entry.view) === entry.actor)
      .map(entry => ({ slot: entry.view.slot, actor: { slot: entry.actor.id.slot, generation: entry.actor.id.generation } }));
  }
  beginRestore(saved: readonly RereleaseProjectionSave[], domain: "checkpoint" | "current" = "current"): void {
    if (this.#restoring !== null) throw new Error("Native projection restore is already active");
    this.#restoring = { actors: new Map(saved.map(entry => [entry.slot, entry.actor])), domain };
  }
  endRestore(): void { this.#restoring = null; }
  close(): void {
    for (const remove of this.#armorHooks.splice(0)) remove();
    this.#armorBindings.clear();
    if (this.#closed) return; this.#closed = true;
    this.#removeEntry(); this.#removeContinuation(); this.deferred.close(); this.clear();
  }
}
