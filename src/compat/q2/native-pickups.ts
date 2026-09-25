import type { SourcePickupQuantity } from "../../contracts/pickups.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ItemId, ProtectionChannel } from "../../contracts/gameplay.ts";
import type { PickupSupplyOffer } from "../../contracts/pickups.ts";
import type { OriginalPickupAdmission, OriginalPickupOffer, OriginalPickupOutcome, SourcePickupSelection } from "../../contracts/original-pickups.ts";
import type { GuestCallSignature, GuestRegister, MappedGuestMemory } from "../../guest/core/contracts.ts";
import { captureAbiProcessorState, restoreAbiProcessorState, type GuestCallRunner } from "../../guest/abi/runner.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";

export interface NativePickupGrant {
  readonly entry: number;
  readonly recipient: { readonly entry: number; readonly join: number };
  readonly resource: "regular" | "inventory";
  readonly consumers?: readonly { readonly entry: number; readonly signature: GuestCallSignature; readonly protection: ProtectionChannel }[];
  readonly supply?:
    | { readonly kind: "ammo"; readonly entry: number; readonly amount: GuestRegister }
    | { readonly kind: "weapon"; readonly ammoReturn: number; readonly settle: number; readonly autoswitch: { readonly entry: number; readonly join: number } };
}
export interface NativePickupSupply {
  owns(actor: ActorId, item: ItemId): boolean;
}
export interface NativePickupSupplyEvaluation {
  readonly offer: PickupSupplyOffer;
  readonly quantity?: (count: number, capacity: number) => SourcePickupQuantity;
}
/** Each region leaves the original stack, saved registers and map continuation intact. */
export interface NativePickupProfile {
  readonly digest: ContentDigest;
  readonly touch: number;
  readonly grantReturn: number;
  readonly targetsReturn: number;
  readonly touchSignature: GuestCallSignature;
  readonly grantSignature: GuestCallSignature;
  readonly grants: readonly NativePickupGrant[];
  readonly items: { readonly table: number; readonly stride: number; readonly count: number; readonly classname: number; readonly pickup: number };
  readonly entity: { readonly item: number; readonly count: number; readonly spawnflags: number; readonly inuse: number; readonly inuseBytes: 1 | 4; readonly generation: number | null };
  readonly time: { readonly address: number; readonly storage: "float32-seconds" | "int64-milliseconds" };
  readonly supply: {
    readonly client: number; readonly inventory: number; readonly flags: number; readonly weaponFlag: number;
    readonly ammo: { readonly entry: number; readonly signature: GuestCallSignature; readonly stop: number | null;
      readonly tag: number; readonly capacities: readonly number[]; readonly capacityBytes: 2 | 4 };
  };
}
export interface NativePickupHost {
  readonly memory: MappedGuestMemory;
  readonly runner: GuestCallRunner;
  invoke(target: GuestAddress, signature: GuestCallSignature, values: readonly GuestCallValue[]): GuestCallResult;
  record(address: GuestAddress): RawEntityView;
  current(record: RawEntityView): ActorId | null;
  admission(): OriginalPickupAdmission;
  withProtection?<T>(recipient: RawEntityView, channel: ProtectionChannel, current: () => void, operation: (consume: (execute: () => void) => void) => T, committed?: () => boolean): T;
}
interface PickupFrame {
  readonly pickup: RawEntityView;
  readonly recipient: RawEntityView;
  readonly offer: OriginalPickupOffer;
  readonly selection: SourcePickupSelection;
  readonly grant: NativePickupGrant;
  readonly descriptor: GuestAddress;
  readonly cancelled: object;
  invalid: boolean;
  called: boolean;
  projections: number;
  supply: NativePickupSupplyEvaluation | null;
}
const voidResult: GuestCallResult = { kind: "void" };
function argument(values: readonly GuestCallValue[], index: number): GuestAddress {
  const value = values[index];
  if (value?.kind !== "pointer" || value.value === null) throw new Error("Native item callback requires its original record arguments");
  return value.value;
}

/** The complete original caller owns eligibility, feedback, targets and item lifetime. */
export class NativePrimaryPickups {
  private readonly remove: (() => void)[] = [];
  private readonly frames: (PickupFrame | null)[] = [];
  private closed = false;
  private supplyOwner: NativePickupSupply | null = null;
  constructor(private readonly host: NativePickupHost, private readonly image: GuestAddress, private readonly profile: NativePickupProfile) {
    if (profile.grants.some(grant => grant.consumers?.length) && host.withProtection === undefined) throw new Error("Native pickup consumer has no protection owner binding");
    if (host.memory.module.digest !== profile.digest) throw new Error("Native pickup profile does not identify this artifact");
    const entries = { memory: host.memory, entries: host.runner.options, invoke: host.invoke.bind(host) };
    try {
      this.remove.push(bindNativeModEntry(entries, this.at(profile.touch), `${host.memory.module.id}:primary-item-touch`, profile.touchSignature,
        (values, original) => this.touch(values, original)).close);
      for (const grant of profile.grants) this.remove.push(bindNativeModEntry(entries, this.at(grant.entry), `${host.memory.module.id}:primary-item-grant-${grant.entry}`, profile.grantSignature,
        (values, original) => this.grant(values, original), () => this.grantCaller(grant)).close);
      this.remove.push(host.runner.options.callbacks.observeEntry(this.at(profile.targetsReturn), () => {
        const frame = this.frames.at(-1); if (frame !== undefined && frame !== null && frame.selection.kind !== "original") this.requireCurrent(frame);
      }));
    } catch (error) { for (const remove of this.remove.splice(0).reverse()) remove(); throw error; }
  }
  assertIdle(): void { if (this.frames.length !== 0) throw new Error("Native pickup caller is still active"); }
  bindSupply(owner: NativePickupSupply): () => undefined {
    this.assertIdle();
    if (this.closed || this.supplyOwner !== null) throw new Error("Native pickups already have a supply owner or are closed");
    this.supplyOwner = owner;
    return () => { if (this.supplyOwner === owner) this.supplyOwner = null; return undefined; };
  }
  supply(offer: OriginalPickupOffer): NativePickupSupplyEvaluation {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame === null || frame.supply === null || frame.offer.item !== offer.item || frame.offer.source !== offer.source
      || !frame.offer.pickup.equals(offer.pickup) || !frame.offer.recipient.equals(offer.recipient)) throw new Error("Native pickup supply requires its held source grant");
    this.requireCurrent(frame);
    return frame.supply;
  }
  close(): undefined {
    this.closed = true;
    for (const frame of this.frames) if (frame !== null) frame.invalid = true;
    for (const remove of this.remove.splice(0).reverse()) remove();
    return undefined;
  }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.image, BigInt(offset)); }
  private field(record: RawEntityView, offset: number): GuestAddress { return this.host.memory.offset(record.address, BigInt(offset)); }
  private itemIndex(descriptor: GuestAddress): number {
    const offset = descriptor.byteOffset - this.at(this.profile.items.table).byteOffset;
    if (offset < 0n || offset % BigInt(this.profile.items.stride) !== 0n || offset / BigInt(this.profile.items.stride) >= BigInt(this.profile.items.count))
      throw new Error("Native pickup descriptor is outside its original item table");
    return Number(offset / BigInt(this.profile.items.stride));
  }
  private itemName(descriptor: GuestAddress): ItemId {
    this.itemIndex(descriptor);
    const { memory } = this.host, name = memory.readPointer(memory.offset(descriptor, BigInt(this.profile.items.classname)));
    if (name === null) throw new Error("Native pickup descriptor has no classname");
    const bytes: number[] = [];
    for (let index = 0; index < 256; index++) {
      const byte = memory.readUint8(memory.offset(name, BigInt(index)));
      if (byte === 0) return `q2:${new TextDecoder().decode(new Uint8Array(bytes))}`;
      bytes.push(byte);
    }
    throw new Error("Native item classname has no terminator");
  }
  private client(frame: PickupFrame): GuestAddress {
    const client = this.host.memory.readPointer(this.field(frame.recipient, this.profile.supply.client));
    if (client === null) throw new Error("Native pickup recipient has no original client");
    return client;
  }
  private counter(frame: PickupFrame, descriptor: GuestAddress): GuestAddress {
    return this.host.memory.offset(this.client(frame), BigInt(this.profile.supply.inventory + this.itemIndex(descriptor) * 4));
  }
  private live(record: RawEntityView): boolean {
    const { memory } = this.host, { entity } = this.profile, address = this.field(record, entity.inuse);
    return (entity.inuseBytes === 1 ? memory.readUint8(address) : memory.readInt32(address)) !== 0;
  }
  private current(frame: PickupFrame): boolean {
    return !this.closed && !frame.invalid && this.live(frame.pickup) && this.live(frame.recipient)
      && this.host.current(frame.pickup)?.equals(frame.offer.pickup) === true && this.host.current(frame.recipient)?.equals(frame.offer.recipient) === true
      && this.host.memory.readPointer(this.field(frame.pickup, this.profile.entity.item))?.byteOffset === frame.descriptor.byteOffset
      && (frame.selection.kind !== "replacement" || frame.selection.current());
  }
  private requireCurrent(frame: PickupFrame): void { if (!this.current(frame)) throw frame.cancelled; }
  private grantCaller(grant: NativePickupGrant): boolean {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame === null || frame.grant !== grant || frame.selection.kind === "original") return false;
    const { memory, runner } = this.host, stack = memory.pointer(runner.options.cpu.state.registers.read("rsp", memory.pointerBytes === 4 ? 32 : 64));
    return stack !== null && memory.readPointer(stack)?.byteOffset === this.at(this.profile.grantReturn).byteOffset;
  }
  private describe(values: readonly GuestCallValue[]): Omit<PickupFrame, "selection"> | "stale" | null {
    const { host, profile } = this, { memory } = host;
    const pickup = host.record(argument(values, 0)), recipient = host.record(argument(values, 1));
    const descriptor = memory.readPointer(this.field(pickup, profile.entity.item));
    if (descriptor === null) return null;
    const difference = descriptor.byteOffset - this.at(profile.items.table).byteOffset;
    if (difference < 0n || difference % BigInt(profile.items.stride) !== 0n || difference / BigInt(profile.items.stride) >= BigInt(profile.items.count)) return null;
    const entry = memory.readPointer(memory.offset(descriptor, BigInt(profile.items.pickup)));
    const grant = profile.grants.find(value => entry?.byteOffset === this.at(value.entry).byteOffset);
    if (grant === undefined) return null;
    const pickupActor = host.current(pickup), recipientActor = host.current(recipient);
    if (pickupActor === null || recipientActor === null || !this.live(pickup) || !this.live(recipient)) return "stale";
    const name = memory.readPointer(memory.offset(descriptor, BigInt(profile.items.classname)));
    if (name === null) return null;
    const bytes: number[] = [];
    for (let index = 0; index < 256; index++) {
      const byte = memory.readUint8(memory.offset(name, BigInt(index)));
      if (byte === 0) break;
      if (index === 255) throw new Error("Native item classname has no terminator");
      bytes.push(byte);
    }
    const item: `q2:${string}` = `q2:${new TextDecoder().decode(new Uint8Array(bytes))}`;
    const count = memory.readInt32(this.field(pickup, profile.entity.count));
    const time = profile.time.storage === "float32-seconds"
      ? { kind: "seconds", value: memory.readFloat32(this.at(profile.time.address)) } satisfies OriginalPickupOffer["time"]
      : { kind: "milliseconds", value: Number(memory.readInt64(this.at(profile.time.address))) } satisfies OriginalPickupOffer["time"];
    if (!Number.isFinite(time.value) || !Number.isSafeInteger(Math.trunc(time.value))) throw new Error("Native pickup clock cannot be represented");
    return { pickup, recipient, descriptor, grant, cancelled: {}, invalid: false, called: false, projections: 0, supply: null, offer: {
      recipient: recipientActor, pickup: pickupActor, source: memory.module.id, item,
      defaultResource: grant.resource === "regular" ? { kind: "protection", channel: "regular" } : { kind: "inventory", item },
      count: count === 0 ? { kind: "default" } : { kind: "override", amount: count },
      dropped: (memory.readUint32(this.field(pickup, profile.entity.spawnflags)) & 0x30000) !== 0, time,
    } };
  }
  private touch(values: readonly GuestCallValue[], original: (values: readonly GuestCallValue[]) => GuestCallResult): GuestCallResult {
    const description = this.describe(values);
    if (description === "stale") return voidResult;
    if (description === null) { this.frames.push(null); try { return original(values); } finally { this.frames.pop(); } }
    const result = this.host.admission().runSource(description.offer, selection => {
      if (selection.kind === "stale") return voidResult;
      const frame: PickupFrame = { ...description, selection }, remove: (() => void)[] = [];
      const { memory, runner } = this.host, processor = captureAbiProcessorState(runner.options.cpu.state);
      this.frames.push(frame);
      try {
        if (selection.kind !== "original") for (const record of [frame.pickup, frame.recipient]) {
          remove.push(memory.observeWrites(this.field(record, this.profile.entity.inuse), this.profile.entity.inuseBytes, () => { if (!this.live(record)) frame.invalid = true; }));
          const generation = this.profile.entity.generation;
          if (generation !== null) {
            const address = this.field(record, generation), captured = memory.readInt32(address);
            remove.push(memory.observeWrites(address, 4, () => { if (memory.readInt32(address) !== captured) frame.invalid = true; }));
          }
        }
        return original(values);
      } catch (error) {
        if (error !== frame.cancelled) throw error;
        restoreAbiProcessorState(runner.options.cpu.state, processor);
        return voidResult;
      } finally { for (const close of remove.reverse()) close(); this.frames.pop(); }
    });
    if (result instanceof Promise) throw new Error("Native synchronous pickup caller yielded during admission");
    return result;
  }
  private grant(values: readonly GuestCallValue[], original: (values: readonly GuestCallValue[]) => GuestCallResult): GuestCallResult {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame === null) throw new Error("Native pickup grant has no owning caller");
    this.requireCurrent(frame);
    if (argument(values, 0).byteOffset !== frame.pickup.address.byteOffset || argument(values, 1).byteOffset !== frame.recipient.address.byteOffset || frame.called)
      throw new Error("Native pickup grant changed its owning source call");
    frame.called = true;
    const refused: GuestCallResult = { kind: "int32", value: 0 };
    if (frame.selection.kind === "blocked") return refused;
    if (frame.selection.kind !== "replacement") throw new Error("Native pickup replacement has no resource owner");
    if (frame.grant.supply !== undefined) return this.grantSupply(frame, values, original);
    const decision = this.grantResources(frame); this.requireCurrent(frame);
    if (decision === "stale") throw frame.cancelled;
    if (decision === "refused") return refused;
    let skipped = false;
    const remove = this.host.runner.bindInlineRegion(this.at(frame.grant.recipient.entry), this.at(frame.grant.recipient.join), this.profile.grantSignature.abi, continuation => {
      this.requireCurrent(frame); remove(); skipped = true; return continuation.skip();
    });
    try {
      const result = original(values); this.requireCurrent(frame);
      if (!skipped || (result.kind !== "int32" && result.kind !== "uint32") || result.value === 0) throw new Error("Original pickup map continuation did not accept its settled grant");
      return result;
    } finally { remove(); }
  }
  private grantResources(frame: PickupFrame, consume: () => boolean = () => true): OriginalPickupOutcome {
    const consumers = frame.grant.consumers ?? [], calls: (() => void)[] = [];
    const scope = (index: number): OriginalPickupOutcome => {
      const consumer = consumers[index];
      if (consumer === undefined) {
        if (frame.selection.kind !== "replacement") throw new Error("Native pickup resource owner changed");
        const decision = frame.selection.grant(); this.requireCurrent(frame);
        if (decision === "accepted" && consume()) for (const call of calls) { call(); this.requireCurrent(frame); }
        return decision;
      }
      const protect = this.host.withProtection;
      if (protect === undefined) throw new Error("Native pickup protection binding disappeared");
      return protect(frame.recipient, consumer.protection, () => this.requireCurrent(frame), publish => {
        calls.push(() => publish(() => {
          this.host.invoke(this.at(consumer.entry), consumer.signature, [{ kind: "pointer", value: frame.recipient.address }]);
        }));
        try { return scope(index + 1); } finally { calls.pop(); }
      }, () => frame.projections === 0);
    };
    return scope(0);
  }
  private quantity(frame: PickupFrame, descriptor: GuestAddress, amount: number, count: number, capacity: number): SourcePickupQuantity {
    this.requireCurrent(frame);
    if (this.frames.at(-1) !== frame || frame.supply === null) throw new Error("Native pickup quantity has expired");
    const { host } = this, { memory, runner } = host, ammo = this.profile.supply.ammo;
    const tag = memory.readInt32(memory.offset(descriptor, BigInt(ammo.tag))), capacityOffset = ammo.capacities[tag];
    if (capacityOffset === undefined) throw new Error("Native pickup ammo has no source capacity");
    if (!Number.isInteger(count) || count < -0x80000000 || count > 0x7fffffff || !Number.isInteger(capacity) || capacity < 0
      || capacity > (ammo.capacityBytes === 2 ? 0x7fff : 0x7fffffff)) throw new Error("Selected pickup count or capacity exceeds its original ABI");
    const counter = this.counter(frame, descriptor), cap = memory.offset(this.client(frame), BigInt(capacityOffset));
    const previousCount = memory.readInt32(counter), previousCap = ammo.capacityBytes === 2 ? memory.readInt16(cap) : memory.readInt32(cap);
    const processor = captureAbiProcessorState(runner.options.cpu.state), stop = {};
    const remove = ammo.stop === null ? () => {} : runner.options.callbacks.observeEntry(this.at(ammo.stop), () => { throw stop; });
    frame.projections++;
    try {
      memory.writeInt32(counter, count);
      if (ammo.capacityBytes === 2) memory.writeInt16(cap, capacity); else memory.writeInt32(cap, capacity);
      let accepted: boolean;
      try {
        const result = host.invoke(this.at(ammo.entry), ammo.signature, [{ kind: "pointer", value: frame.recipient.address }, { kind: "pointer", value: descriptor }, { kind: "int32", value: amount }]);
        if (result.kind !== "int32" && result.kind !== "uint32") throw new Error("Original ammo grant returned a non-boolean ABI value");
        accepted = result.value !== 0;
      } catch (error) {
        if (error !== stop) throw error;
        // The qualified rerelease stop follows successful bookkeeping and precedes power-armor use.
        accepted = true;
      }
      return { amount: memory.readInt32(counter) - count, accepted };
    } finally {
      try {
        remove(); restoreAbiProcessorState(runner.options.cpu.state, processor);
        memory.writeInt32(counter, previousCount);
        if (ammo.capacityBytes === 2) memory.writeInt16(cap, previousCap); else memory.writeInt32(cap, previousCap);
      } finally { frame.projections--; }
    }
  }
  private grantSupply(frame: PickupFrame, values: readonly GuestCallValue[], original: (values: readonly GuestCallValue[]) => GuestCallResult): GuestCallResult {
    const operation = frame.grant.supply;
    if (operation === undefined || frame.selection.kind !== "replacement") throw new Error("Native supply has no selected grant");
    const { memory, runner } = this.host, processor = captureAbiProcessorState(runner.options.cpu.state), declined = {};
    const remove: (() => void)[] = [];
    let settled = false, ammo: { descriptor: GuestAddress; amount: number } | null = null;
    let projected: { address: GuestAddress; previous: number } | null = null;
    const restore = (): void => { if (projected !== null) { const saved = projected; projected = null; memory.writeInt32(saved.address, saved.previous); } };
    const settle = (): void => {
      if (settled) return;
      restore(); this.requireCurrent(frame); settled = true;
      const sourceAmmo = ammo, item = sourceAmmo === null ? null : this.itemName(sourceAmmo.descriptor);
      let acceptedAmmo = false;
      const offer: PickupSupplyOffer = operation.kind === "weapon"
        ? { kind: "weapon", offer: { item: frame.offer.item, ammo: sourceAmmo === null || item === null ? [] : [{ item, amount: sourceAmmo.amount }] } }
        : { kind: "ammo", offer: { item: frame.offer.item, amount: sourceAmmo?.amount ?? 0 } };
      const flags = memory.readUint32(memory.offset(frame.descriptor, BigInt(this.profile.supply.flags)));
      frame.supply = { offer: operation.kind === "ammo" && offer.kind === "ammo" && (flags & this.profile.supply.weaponFlag) !== 0
        ? { kind: "ammoWeapon", offer: { ...offer.offer, weapon: frame.offer.item } } : offer,
        ...(sourceAmmo === null ? {} : { quantity: (count: number, capacity: number) => {
          const result = this.quantity(frame, sourceAmmo.descriptor, sourceAmmo.amount, count, capacity);
          acceptedAmmo ||= result.accepted;
          return result;
        } }) };
      try {
        if (frame.selection.kind !== "replacement") throw new Error("Native supply owner changed during its source call");
        const decision = this.grantResources(frame, () => acceptedAmmo); this.requireCurrent(frame);
        if (decision === "stale") throw frame.cancelled;
        if (decision === "refused") throw declined;
      } finally { frame.supply = null; }
    };
    try {
      if (operation.kind === "ammo") {
        remove.push(runner.bindInlineRegion(this.at(operation.entry), this.at(frame.grant.recipient.join), this.profile.grantSignature.abi, continuation => {
          ammo = { descriptor: frame.descriptor, amount: Number(BigInt.asIntN(32, runner.options.cpu.state.registers.read(operation.amount, 32))) };
          settle(); return continuation.skip();
        }));
      } else {
        if (this.supplyOwner !== null) {
          const address = this.counter(frame, frame.descriptor);
          projected = { address, previous: memory.readInt32(address) };
          memory.writeInt32(address, this.supplyOwner.owns(frame.offer.recipient, frame.offer.item) ? 1 : 0);
        }
        remove.push(runner.bindInlineRegion(this.at(frame.grant.recipient.entry), this.at(frame.grant.recipient.join), this.profile.grantSignature.abi, continuation => {
          restore(); this.requireCurrent(frame); return continuation.skip();
        }));
        const entries = { memory, entries: runner.options, invoke: this.host.invoke.bind(this.host) };
        remove.push(bindNativeModEntry(entries, this.at(this.profile.supply.ammo.entry), `${memory.module.id}:primary-supply-ammo`, this.profile.supply.ammo.signature, args => {
          if (argument(args, 0).byteOffset !== frame.recipient.address.byteOffset || ammo !== null) throw new Error("Native supply ammo changed its source recipient");
          const amount = args[2]; if (amount?.kind !== "int32") throw new Error("Native supply has no original ammo count");
          ammo = { descriptor: argument(args, 1), amount: amount.value };
          return { kind: "int32", value: 1 };
        }, () => {
          const stack = memory.pointer(runner.options.cpu.state.registers.read("rsp", memory.pointerBytes === 4 ? 32 : 64));
          return this.frames.at(-1) === frame && stack !== null && memory.readPointer(stack)?.byteOffset === this.at(operation.ammoReturn).byteOffset;
        }).close);
        remove.push(runner.options.callbacks.observeEntry(this.at(operation.settle), settle));
        remove.push(runner.bindInlineRegion(this.at(operation.autoswitch.entry), this.at(operation.autoswitch.join), this.profile.grantSignature.abi, continuation => {
          settle(); return continuation.skip();
        }));
      }
      const result = original(values); this.requireCurrent(frame);
      if ((result.kind !== "int32" && result.kind !== "uint32") || result.value !== 0 && !settled) throw new Error("Native supply did not settle before its source continuation");
      return result;
    } catch (error) {
      if (error !== declined) throw error;
      restoreAbiProcessorState(runner.options.cpu.state, processor);
      return { kind: "int32", value: 0 };
    } finally { restore(); frame.supply = null; for (const close of remove.reverse()) close(); }
  }
}
