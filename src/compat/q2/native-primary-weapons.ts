import type { SourceEquipmentContext } from "../../contracts/source-items.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, NativeAbi, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { NativeItemField, NativeItemTest, NativeWeaponStage } from "../../contracts/native-mod-items.ts";
import type { NativeModScalar } from "../../contracts/native-mod-callbacks.ts";
import type { AnimationState } from "../../contracts/movement.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { MappedGuestMemory, GuestCallSignature } from "../../guest/core/contracts.ts";
import type { GuestCallRunner } from "../../guest/abi/runner.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";
import { NativeWeaponDispatcher } from "./native-mod-weapon-stage.ts";

export interface NativePrimaryWeaponProfile {
  readonly digest: ContentDigest;
  readonly abi: NativeAbi;
  readonly dispatcher: NativeWeaponStage["dispatcher"];
  readonly decisions: NativeWeaponStage["decisions"];
  readonly spawn: { readonly entry: number; readonly accepted: readonly NativeItemTest[] };
  readonly active: readonly NativeItemTest[];
  readonly committedInput: readonly (readonly NativeItemTest[])[];
  readonly continuations: readonly (readonly NativeItemTest[])[];
  readonly time: { readonly address: number; readonly encoding: NativeModScalar; readonly milliseconds: number };
  readonly entity: { readonly client: number; readonly waterLevel: NativeItemField; readonly viewHeight: NativeItemField; readonly maxHealth: NativeItemField };
  readonly client: { readonly byteLength: number; readonly viewAngles: number; readonly buttons: NativeItemField; readonly latchedButtons: NativeItemField };
  readonly attackAnimation: { readonly entry: number; readonly skip: readonly { readonly entry: number; readonly join: number }[] };
  readonly animation: { readonly frame: NativeItemField; readonly end: NativeItemField; readonly priority: NativeItemField; readonly duck: NativeItemField; readonly run: NativeItemField };
  readonly equipmentContexts: readonly SourceEquipmentContext[];
  readonly delay: { readonly flag: NativeItemField; readonly region: { readonly entry: number; readonly join: number }; readonly evaluate:
    { readonly kind: "source-flag"; readonly factors: readonly number[] }
    | { readonly kind: "source-animation"; readonly entry: number; readonly baselineMilliseconds: number;
      readonly projection: readonly { readonly field: NativeItemField; readonly value: number }[]; readonly writes: readonly NativeItemField[] } };
  readonly damage: { readonly kind: "source-result"; readonly entry: number; readonly result: "uint8" | "int32" }
    | { readonly kind: "source-flag"; readonly address: number; readonly encoding: NativeModScalar; readonly factors: readonly number[]; readonly region: { readonly entry: number; readonly join: number } };
}
export interface NativePrimaryWeaponHost {
  readonly memory: MappedGuestMemory;
  readonly runner: GuestCallRunner;
  readonly image: GuestAddress;
  invoke(address: GuestAddress, signature: GuestCallSignature, values: readonly GuestCallValue[]): GuestCallResult;
  entry(name: string): GuestAddress;
  record(address: GuestAddress): RawEntityView;
  actor(record: RawEntityView): ActorId | null;
  recordFor(actor: ActorId): RawEntityView | null;
}
export interface NativePrimaryWeaponHooks {
  selected(actor: ActorId): boolean;
  completed(actor: ActorId, reachedDecision: boolean): void;
  spawned(actor: ActorId): void;
}

/** Borrows the real primary client's fields and the shared native dispatcher. */
export class NativePrimaryWeapons {
  private closed = false;
  private readonly dispatcher: NativeWeaponDispatcher;
  private readonly removals: (() => void)[] = [];
  private readonly delayFlags = new Map<ActorId, number>();
  private readonly delayResult: GuestAddress | null;
  private readonly damageFactors = new Map<ActorId, number>();
  constructor(private readonly host: NativePrimaryWeaponHost, readonly profile: NativePrimaryWeaponProfile, hooks: NativePrimaryWeaponHooks) {
    if (host.memory.module.digest !== profile.digest) throw new Error("Native primary weapon profile does not identify this artifact");
    this.delayResult = profile.delay.evaluate.kind === "source-animation" ? host.memory.allocate({ byteLength: 8, alignment: 8n, label: "selected source weapon delay" }) : null;
    const entryHost = { memory: host.memory, imageBase: host.image, entries: host.runner.options,
      invoke: host.invoke.bind(host), entry: host.entry.bind(host),
      bindInlineRegion: (entry: GuestAddress, join: GuestAddress, run: Parameters<GuestCallRunner["bindInlineRegion"]>[3]) => host.runner.bindInlineRegion(entry, join, profile.abi, run) };
    try {
      this.dispatcher = new NativeWeaponDispatcher(profile, profile.abi, entryHost, host.memory.module.id, {
        actor: (record, address) => { if (record !== "entity") throw new Error("Native primary dispatcher requires an entity argument"); return host.actor(host.record(address)); },
        current: actor => this.current(actor), selected: hooks.selected, committedInput: actor => profile.committedInput.some(group => group.every(test => this.matches(actor, test))),
        read: (actor, field) => this.read(actor, field), write: (actor, field, value) => this.write(actor, field, value),
        completed: hooks.completed,
      });
    } catch (error) { if (this.delayResult !== null) host.memory.unmap(this.delayResult, 8); throw error; }
    try {
      const spawn = bindNativeModEntry(entryHost, this.at(profile.spawn.entry), `${host.memory.module.id}:selected-spawn`, {
        abi: profile.abi, parameters: [{ kind: "scalar", storage: "pointer" }], result: "void", variadic: false,
      }, (values, original) => {
        const argument = values[0], actor = argument?.kind === "pointer" && argument.value !== null ? host.actor(host.record(argument.value)) : null;
        const result = original(values);
        if (actor !== null && this.current(actor) && profile.spawn.accepted.every(test => this.matches(actor, test))) hooks.spawned(actor);
        return result;
      });
      this.removals.push(() => spawn.close());
      const delay = profile.delay;
      this.removals.push(host.runner.bindInlineRegion(this.at(delay.region.entry), this.at(delay.region.join), profile.abi, continuation => {
        const actor = this.dispatcher.currentActor(), result = continuation.execute();
        if (actor !== null && this.current(actor)) this.delayFlags.set(actor, this.read(actor, delay.flag));
        return result;
      }));
      const damage = profile.damage;
      if (damage.kind === "source-flag") {
        this.removals.push(host.runner.bindInlineRegion(this.at(damage.region.entry), this.at(damage.region.join), profile.abi, continuation => {
          const actor = this.dispatcher.currentActor();
          const result = continuation.execute();
          if (actor !== null && this.current(actor)) {
            const value = this.readAddress(this.at(damage.address), damage.encoding), factor = damage.factors[value];
            if (factor === undefined) throw new Error("Original weapon damage flag has no declared source factor");
            this.damageFactors.set(actor, factor);
          }
          return result;
        }));
      }
    } catch (error) { this.close(); throw error; }
  }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.host.image, BigInt(offset)); }
  private current(actor: ActorId): boolean {
    const record = this.host.recordFor(actor);
    return record !== null && this.host.actor(record)?.equals(actor) === true;
  }
  private record(actor: ActorId): RawEntityView {
    const record = this.host.recordFor(actor);
    if (record === null || this.host.actor(record)?.equals(actor) !== true) throw new Error("Native weapon owner was retired");
    return record;
  }
  private address(actor: ActorId, record: string, offset: number): GuestAddress {
    const entity = this.record(actor), memory = this.host.memory;
    if (record === "image") return this.at(offset);
    if (record === "entity") return memory.offset(entity.address, BigInt(offset));
    if (record !== "client") throw new Error("Native primary field has an unknown record");
    const client = memory.readPointer(memory.offset(entity.address, BigInt(this.profile.entity.client)));
    if (client === null) throw new Error("Native weapon owner has no source client");
    memory.check(client, this.profile.client.byteLength, "read");
    return memory.offset(client, BigInt(offset));
  }
  private readAddress(address: GuestAddress, encoding: NativeModScalar): number {
    const memory = this.host.memory;
    switch (encoding) {
      case "int8": return memory.readInt8(address); case "uint8": return memory.readUint8(address);
      case "int16": return memory.readInt16(address); case "uint16": return memory.readUint16(address);
      case "int32": return memory.readInt32(address); case "uint32": return memory.readUint32(address);
      case "float32": return memory.readFloat32(address); case "float64": return memory.readFloat64(address);
      case "int64": case "uint64": {
        const value = Number(encoding === "int64" ? memory.readInt64(address) : memory.readUint64(address));
        if (!Number.isSafeInteger(value)) throw new RangeError("Native weapon field exceeds exact numeric range");
        return value;
      }
    }
  }
  read(actor: ActorId, field: NativeItemField): number { return this.readAddress(this.address(actor, field.record, field.offset), field.encoding); }
  private write(actor: ActorId, field: NativeItemField, value: number): void {
    const address = this.address(actor, field.record, field.offset), memory = this.host.memory;
    switch (field.encoding) {
      case "int8": memory.writeInt8(address, value); break; case "uint8": memory.writeUint8(address, value); break;
      case "int16": memory.writeInt16(address, value); break; case "uint16": memory.writeUint16(address, value); break;
      case "int32": memory.writeInt32(address, value); break; case "uint32": memory.writeUint32(address, value); break;
      case "float32": memory.writeFloat32(address, value); break; case "float64": memory.writeFloat64(address, value); break;
      case "int64": memory.writeInt64(address, BigInt(value)); break; case "uint64": memory.writeUint64(address, BigInt(value)); break;
    }
  }
  input(actor: ActorId): { readonly buttons: number; readonly latchedButtons: number; readonly viewAngles: Vec3; readonly viewHeight: number; readonly waterLevel: number; readonly maxHealth: number } {
    const client = this.profile.client, memory = this.host.memory, angles = this.address(actor, "client", client.viewAngles);
    return { buttons: this.read(actor, client.buttons), latchedButtons: this.read(actor, client.latchedButtons),
      viewAngles: { x: memory.readFloat32(angles), y: memory.readFloat32(memory.offset(angles, 4n)), z: memory.readFloat32(memory.offset(angles, 8n)) },
      viewHeight: this.read(actor, this.profile.entity.viewHeight), waterLevel: this.read(actor, this.profile.entity.waterLevel), maxHealth: this.read(actor, this.profile.entity.maxHealth) };
  }
  animation(actor: ActorId): Extract<AnimationState, { kind: "q2" }> {
    const fields = this.profile.animation;
    return { kind: "q2", frame: this.read(actor, fields.frame), endFrame: this.read(actor, fields.end),
      priority: this.read(actor, fields.priority), duck: this.read(actor, fields.duck) !== 0, run: this.read(actor, fields.run) !== 0 };
  }
  damageFactor(actor: ActorId): number {
    const damage = this.profile.damage, memory = this.host.memory;
    if (damage.kind === "source-flag") {
      this.record(actor);
      const factor = this.damageFactors.get(actor);
      if (factor === undefined) throw new Error("Original weapon damage modifier has not run for this actor");
      return factor;
    }
    const result = this.host.invoke(memory.offset(this.host.image, BigInt(damage.entry)), { abi: this.profile.abi,
      parameters: [{ kind: "scalar", storage: "pointer" }], result: { kind: "scalar", storage: damage.result }, variadic: false }, [{ kind: "pointer", value: this.record(actor).address }]);
    if (result.kind !== "uint32" && result.kind !== "int32") throw new Error("Original weapon damage helper returned the wrong ABI type");
    return result.value;
  }
  attackAnimation(actor: ActorId): void {
    if (!this.available(actor)) return;
    const operation = this.profile.attackAnimation, remove: (() => void)[] = [];
    try {
      for (const region of operation.skip) remove.push(this.host.runner.bindInlineRegion(this.at(region.entry), this.at(region.join), this.profile.abi, continuation => continuation.skip()));
      this.host.invoke(this.at(operation.entry), { abi: this.profile.abi, parameters: [
        { kind: "scalar", storage: "pointer" }, ...Array.from({ length: 4 }, () => ({ kind: "scalar", storage: "int32" } satisfies GuestCallSignature["parameters"][number])),
        ...Array.from({ length: 3 }, () => ({ kind: "scalar", storage: "pointer" } satisfies GuestCallSignature["parameters"][number])),
      ], result: "void", variadic: false }, [{ kind: "pointer", value: this.record(actor).address },
        ...Array.from({ length: 4 }, () => ({ kind: "int32", value: 0 } satisfies GuestCallValue)),
        ...Array.from({ length: 3 }, () => ({ kind: "pointer", value: null } satisfies GuestCallValue))]);
    } finally { for (const dispose of remove.reverse()) dispose(); }
  }
  weaponDelay(actor: ActorId, milliseconds: number): number {
    const delay = this.profile.delay, flag = this.delayFlags.get(actor), evaluate = delay.evaluate;
    if (flag === undefined) throw new Error("Original firing modifier has not run for this actor");
    if (evaluate.kind === "source-flag") {
      const factor = evaluate.factors[flag];
      if (factor === undefined) throw new Error("Original firing flag has no declared source factor");
      return milliseconds * factor;
    }
    const result = this.delayResult;
    if (result === null) throw new Error("Original animation delay result storage is unavailable");
    const fields = [...evaluate.projection.map(value => value.field), ...evaluate.writes, delay.flag];
    const saved = fields.map(field => ({ field, value: this.read(actor, field) }));
    try {
      for (const projection of evaluate.projection) this.write(actor, projection.field, projection.value);
      this.write(actor, delay.flag, flag);
      this.host.invoke(this.at(evaluate.entry), { abi: this.profile.abi,
        parameters: [{ kind: "scalar", storage: "pointer" }, { kind: "scalar", storage: "pointer" }], result: { kind: "scalar", storage: "pointer" }, variadic: false },
        [{ kind: "pointer", value: result }, { kind: "pointer", value: this.record(actor).address }]);
      return milliseconds * Number(this.host.memory.readInt64(result)) / evaluate.baselineMilliseconds;
    } finally { for (const value of saved) this.write(actor, value.field, value.value); }
  }
  private matches(actor: ActorId, test: NativeItemTest): boolean {
    if (test.kind === "pointer") {
      const pointer = this.host.memory.readPointer(this.address(actor, test.field.record, test.field.offset));
      let expected = test.value === null ? null : this.at(test.value.rva);
      for (const offset of test.value?.indirections ?? []) {
        if (expected === null) break;
        expected = this.host.memory.readPointer(this.host.memory.offset(expected, BigInt(offset)));
      }
      return pointer?.byteOffset === expected?.byteOffset;
    }
    const raw = this.read(actor, test.field), value = test.mask === null ? raw : raw & test.mask;
    return test.comparison === "equals" ? value === test.value : value <= test.value;
  }
  available(actor: ActorId): boolean { return this.current(actor) && this.profile.active.every(test => this.matches(actor, test)); }
  continuing(actor: ActorId): boolean { return this.current(actor) && this.profile.continuations.some(group => group.every(test => this.matches(actor, test))); }
  timeMilliseconds(): number { return this.readAddress(this.at(this.profile.time.address), this.profile.time.encoding) * this.profile.time.milliseconds; }
  release(actor: ActorId): void { this.damageFactors.delete(actor); this.delayFlags.delete(actor); }
  close(): void { if (this.closed) return; this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); this.dispatcher.close(); this.damageFactors.clear(); this.delayFlags.clear();
    if (this.delayResult !== null) this.host.memory.unmap(this.delayResult, 8); }
}
