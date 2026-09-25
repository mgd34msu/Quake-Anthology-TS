import { sourceItemNamed } from "../../contracts/source-items.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallValue, GuestValueLayout, NativeAbi } from "../../contracts/execution.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { readClassicString } from "./classic/records.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";
import type { NativePrimaryCommands } from "./native-primary-commands.ts";
import type { NativeInventoryRow } from "./native-primary-inventory.ts";
import type { NativePrimaryWeaponHost } from "./native-primary-weapons.ts";

export interface NativePrimaryDropProfile {
  readonly digest: ContentDigest;
  readonly abi: NativeAbi;
  readonly client: { readonly pointer: number; readonly inventory: number; readonly cursor: number; readonly weapon: number; readonly pending: number };
  readonly named: number;
  readonly inventory: { readonly entry: number; readonly admitted: number };
  readonly find: number;
  readonly lookupReturn: number;
  readonly allocate: number;
  readonly free: number;
  readonly consumer: { readonly entry: number; readonly join: number } | null;
  readonly callbacks: readonly { readonly entry: number; readonly join: number }[];
  readonly debits: readonly { readonly entry: number; readonly join: number }[];
}
export interface NativePrimaryDropHooks {
  rows(actor: ActorId): readonly NativeInventoryRow[] | null;
  selected(actor: ActorId): ItemId | null;
  projection(actor: ActorId, item: ItemId): { readonly source: ItemId; readonly current: ItemId | null; readonly pending: ItemId | null };
  dropped(actor: ActorId, pickup: ActorId, item: ItemId, count: number): boolean;
  consume(actor: ActorId, execute: () => void): void;
  action(actor: ActorId, item: ItemId): (() => void) | null;
  print(actor: ActorId, text: string): void;
}
interface DropFrame {
  readonly actor: ActorId | null;
  readonly kind: "named" | "inventory";
  row: NativeInventoryRow | null;
  counter: GuestAddress | null;
  restore: (() => void) | null;
  pickup: ActorId | null;
  debit: "pending" | "accepted" | "refused";
}
const pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };

/** Original command guards, item callbacks and accepted decrements own each drop. */
export class NativePrimaryDrop {
  private readonly removals: (() => void)[] = [];
  private readonly frames: DropFrame[] = [];
  private closed = false;
  constructor(private readonly host: NativePrimaryWeaponHost, private readonly profile: NativePrimaryDropProfile,
    private readonly commands: NativePrimaryCommands, private readonly hooks: NativePrimaryDropHooks) {
    if (host.memory.module.digest !== profile.digest) throw new Error("Native drop profile belongs to another artifact");
    const boundary = { memory: host.memory, entries: host.runner.options, invoke: host.invoke.bind(host) };
    try {
      for (const [kind, entry] of [["named", profile.named], ["inventory", profile.inventory.entry]] satisfies readonly (readonly ["named" | "inventory", number])[]) {
        this.removals.push(bindNativeModEntry(boundary, this.at(entry), `${host.memory.module.id}:selected-${kind}-drop`,
          { abi: profile.abi, parameters: [pointer], result: "void", variadic: false }, (values, original) => {
            const actor = this.actor(values[0]), frame: DropFrame = { actor, kind, row: null, counter: null, restore: null, pickup: null, debit: "pending" };
            this.frames.push(frame);
            try { return original(values); } finally { frame.restore?.(); this.frames.pop(); }
          }).close);
      }
      this.removals.push(bindNativeModEntry(boundary, this.at(profile.find), `${host.memory.module.id}:selected-drop-item`,
        { abi: profile.abi, parameters: [pointer], result: pointer, variadic: false }, (values, original) => {
          const result = original(values), frame = this.frames.at(-1), name = values[0];
          if (frame?.kind !== "named" || frame.actor === null || name?.kind !== "pointer" || name.value === null || !this.current(frame.actor)) return result;
          const text = readClassicString(host.memory, name.value).toLowerCase(), rows = hooks.rows(frame.actor);
          const choice = sourceItemNamed(rows ?? [], text, result.kind === "pointer" && result.value !== null ? commands.itemAt(result.value) : null);
          if (choice?.kind === "ambiguous") {
            if (result.kind === "pointer" && result.value === null)
              hooks.print(frame.actor, `Ambiguous item "${text}"; use ${choice.items.map(item => item.item).join(", ")}\n`);
            return result;
          }
          const row = choice?.item;
          if (row?.selected !== true) return result;
          return { kind: "pointer", value: this.project(frame, row, false) };
        }, () => {
          const stack = host.memory.pointer(host.runner.options.cpu.state.registers.read("rsp", host.memory.pointerBytes === 4 ? 32 : 64));
          return this.frames.at(-1)?.kind === "named" && stack !== null && host.memory.readPointer(stack)?.byteOffset === this.at(profile.lookupReturn).byteOffset;
        }).close);
      this.removals.push(host.runner.options.callbacks.observeEntry(this.at(profile.inventory.admitted), () => {
        const frame = this.frames.at(-1); if (frame?.kind !== "inventory" || frame.actor === null || !this.current(frame.actor)) return;
        const chosen = hooks.selected(frame.actor), row = hooks.rows(frame.actor)?.find(row => row.item === chosen && row.selected);
        if (row !== undefined) this.project(frame, row, true);
      }));
      this.removals.push(bindNativeModEntry(boundary, this.at(profile.allocate), `${host.memory.module.id}:selected-drop-allocation`,
        { abi: profile.abi, parameters: [pointer, pointer], result: pointer, variadic: false }, (values, original) => {
          const frame = this.frames.at(-1), result = original(values);
          if (frame !== undefined && frame.counter !== null && frame.actor !== null && this.actor(values[0])?.equals(frame.actor) === true
            && result.kind === "pointer" && result.value !== null) frame.pickup = host.actor(host.record(result.value));
          return result;
        }).close);
      for (const callback of profile.callbacks) this.removals.push(host.runner.bindInlineRegion(this.at(callback.entry), this.at(callback.join), profile.abi, continuation => {
        const frame = this.frames.at(-1);
        if (frame?.row == null || frame.actor === null || !this.current(frame.actor)) return continuation.execute();
        const action = hooks.action(frame.actor, frame.row.item);
        if (action === null) return continuation.execute();
        frame.restore?.(); action(); return continuation.skip();
      }));
      for (const debit of profile.debits) this.removals.push(host.runner.bindInlineRegion(this.at(debit.entry), this.at(debit.join), profile.abi, continuation => {
        const frame = this.frames.at(-1);
        if (frame?.counter == null || frame.row === null || frame.actor === null || !this.current(frame.actor)) return continuation.execute();
        const before = host.memory.readInt32(frame.counter), result = continuation.execute(), after = host.memory.readInt32(frame.counter);
        const count = before - after, pickup = frame.pickup;
        frame.restore?.();
        if (!Number.isInteger(count) || count <= 0 || pickup === null || !this.current(pickup)) throw new Error("Accepted original drop lacks its source allocation or positive debit");
        frame.debit = hooks.dropped(frame.actor, pickup, frame.row.item, count) ? "accepted" : "refused";
        if (frame.debit === "refused") {
          const record = this.current(pickup) ? host.recordFor(pickup) : null;
          if (record !== null) host.invoke(this.at(profile.free), { abi: profile.abi, parameters: [pointer], result: "void", variadic: false }, [{ kind: "pointer", value: record.address }]);
        }
        return result;
      }));
      if (profile.consumer !== null) this.removals.push(host.runner.bindInlineRegion(this.at(profile.consumer.entry), this.at(profile.consumer.join), profile.abi, continuation => {
        const frame = this.frames.at(-1);
        if (frame?.debit === "refused") return continuation.skip();
        if (frame?.debit !== "accepted" || frame.actor === null || !this.current(frame.actor)) return continuation.execute();
        let executed = false;
        hooks.consume(frame.actor, () => { executed = true; continuation.execute(); });
        return executed ? undefined : continuation.skip();
      }));
    } catch (error) { this.close(); throw error; }
  }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.host.image, BigInt(offset)); }
  private actor(value: GuestCallValue | undefined): ActorId | null { return value?.kind === "pointer" && value.value !== null ? this.host.actor(this.host.record(value.value)) : null; }
  private current(actor: ActorId): boolean { const record = this.closed ? null : this.host.recordFor(actor); return record !== null && this.host.actor(record)?.equals(actor) === true; }
  private project(frame: DropFrame, row: NativeInventoryRow, cursor: boolean): GuestAddress {
    if (frame.actor === null || frame.restore !== null) throw new Error("Original drop projection has no unique actor scope");
    const projection = this.hooks.projection(frame.actor, row.item), descriptor = this.commands.sourceItem(projection.source), memory = this.host.memory;
    const record = this.host.recordFor(frame.actor), client = record === null ? null : memory.readPointer(memory.offset(record.address, BigInt(this.profile.client.pointer)));
    if (descriptor === null || client === null) throw new Error("Selected drop has no source item or client");
    const counter = memory.offset(client, BigInt(this.profile.client.inventory + descriptor.index * 4));
    const weapon = memory.offset(client, BigInt(this.profile.client.weapon)), pending = memory.offset(client, BigInt(this.profile.client.pending));
    const selection = memory.offset(client, BigInt(this.profile.client.cursor));
    const fields = [{ address: counter, bytes: memory.copy(counter, 4) }, { address: weapon, bytes: memory.copy(weapon, memory.pointerBytes) },
      { address: pending, bytes: memory.copy(pending, memory.pointerBytes) }, ...cursor ? [{ address: selection, bytes: memory.copy(selection, 4) }] : []];
    const sourceWeapon = (item: ItemId | null): GuestAddress | null => {
      if (item === null) return null;
      const value = this.commands.sourceItem(item); if (value === null) throw new Error("Selected drop weapon has no source descriptor"); return value.address;
    };
    const actor = frame.actor;
    frame.row = row; frame.counter = counter;
    frame.restore = () => {
      frame.restore = null; frame.counter = null;
      if (this.current(actor)) for (const field of fields) memory.write(field.address, field.bytes);
    };
    try {
      memory.writeInt32(counter, row.presenceOnly ? row.count === 0 ? 0 : 1 : row.count);
      memory.writePointer(weapon, sourceWeapon(projection.current)); memory.writePointer(pending, sourceWeapon(projection.pending));
      if (cursor) memory.writeInt32(selection, descriptor.index);
      return descriptor.address;
    } catch (error) { frame.restore(); throw error; }
  }
  close(): void { if (this.closed) return; for (const frame of [...this.frames].reverse()) frame.restore?.(); this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); }
}
