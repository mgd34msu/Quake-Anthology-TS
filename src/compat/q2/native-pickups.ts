import type { ContentDigest } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupOffer, SourcePickupSelection } from "../../contracts/original-pickups.ts";
import type { GuestCallSignature, MappedGuestMemory } from "../../guest/core/contracts.ts";
import { captureAbiProcessorState, restoreAbiProcessorState, type GuestCallRunner } from "../../guest/abi/runner.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";

export interface NativePickupGrant {
  readonly entry: number;
  readonly recipient: { readonly entry: number; readonly join: number };
  readonly resource: "regular" | "inventory";
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
}
export interface NativePickupHost {
  readonly memory: MappedGuestMemory;
  readonly runner: GuestCallRunner;
  invoke(target: GuestAddress, signature: GuestCallSignature, values: readonly GuestCallValue[]): GuestCallResult;
  record(address: GuestAddress): RawEntityView;
  current(record: RawEntityView): ActorId | null;
  admission(): OriginalPickupAdmission;
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
  constructor(private readonly host: NativePickupHost, private readonly image: GuestAddress, private readonly profile: NativePickupProfile) {
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
  close(): undefined {
    this.closed = true;
    for (const frame of this.frames) if (frame !== null) frame.invalid = true;
    for (const remove of this.remove.splice(0).reverse()) remove();
    return undefined;
  }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.image, BigInt(offset)); }
  private field(record: RawEntityView, offset: number): GuestAddress { return this.host.memory.offset(record.address, BigInt(offset)); }
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
    return { pickup, recipient, descriptor, grant, cancelled: {}, invalid: false, called: false, offer: {
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
    const decision = frame.selection.grant(); this.requireCurrent(frame);
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
}
