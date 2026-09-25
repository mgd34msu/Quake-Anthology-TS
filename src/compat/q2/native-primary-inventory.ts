import { sourceItemNamed } from "../../contracts/source-items.ts";
import type { WeaponHudIcon } from "../../contracts/ui.ts";
import { readClassicString } from "./classic/records.ts";
import type { ContentDigest, ProviderReference } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallValue, GuestValueLayout, NativeAbi } from "../../contracts/execution.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { bindNativeModEntry, type NativeModEntryBinding } from "./native-mod-entries.ts";
import type { NativePrimaryWeaponHost } from "./native-primary-weapons.ts";

export type NativeInventoryPresentation = { readonly source: ProviderReference } & (
  | { readonly kind: "weapon" | "ammunition"; readonly weapon: ItemId }
  | { readonly kind: "item"; readonly icon: WeaponHudIcon | null }
);
export interface NativeInventoryRow {
  readonly presentation?: NativeInventoryPresentation;
  readonly item: ItemId;
  readonly label: string;
  readonly count: number;
  readonly sourceIndex: number;
  readonly selected: boolean;
  readonly presenceOnly?: true;
}
export interface NativeInventoryReadout {
  readonly presentation?: NativeInventoryPresentation;
  readonly items: readonly { readonly item: ItemId; readonly label: string; readonly count: number }[];
  readonly selected: ItemId | null;
}
export interface NativePrimaryInventoryProfile {
  readonly digest: ContentDigest;
  readonly abi: NativeAbi;
  readonly client: number;
  readonly inventory: number;
  readonly count: number;
  readonly cursor: number;
  readonly empty: number;
  readonly prototypes: { readonly weapon: ItemId; readonly ammunition: ItemId; readonly usable: ItemId; readonly passive: ItemId; readonly droppable: ItemId; readonly undroppable: ItemId };
  readonly selectionWrites: readonly { readonly offset: number; readonly bytes: number }[];
  readonly next: { readonly entry: number; readonly scan: number; readonly join: number; readonly menuArgument: boolean };
  readonly previous: { readonly entry: number; readonly scan: number; readonly join: number };
  readonly validate: { readonly entry: number; readonly scan: { readonly entry: number; readonly join: number } | null };
  readonly use: { readonly entry: number; readonly call: number; readonly join: number };
  readonly namedUse: { readonly entry: number; readonly lookupCall: number; readonly lookupReturn: number; readonly call: number; readonly join: number };
}
interface Frame { readonly actor: ActorId | null; readonly flags: number; readonly named: boolean; row: NativeInventoryRow | null; restore: (() => void) | null; }
const pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };
const integer: GuestValueLayout = { kind: "scalar", storage: "int32" };

/** Original scanners own usability, category filters and accepted cursor side effects. */
export class NativePrimaryInventory {
  private readonly removals: (() => void)[] = [];
  private readonly selected = new Map<ActorId, { readonly item: ItemId; readonly index: number }>();
  private readonly frames: Frame[] = [];
  private evaluating = 0;
  private closed = false;
  private readonly next: NativeModEntryBinding;
  private readonly previous: NativeModEntryBinding;
  constructor(private readonly host: NativePrimaryWeaponHost, private readonly profile: NativePrimaryInventoryProfile,
    private readonly hooks: { rows(actor: ActorId): readonly NativeInventoryRow[] | null; use(actor: ActorId, item: ItemId): void; descriptor(index: number): GuestAddress; itemAt(address: GuestAddress): ItemId | null; print(actor: ActorId, text: string): void }) {
    if (host.memory.module.digest !== profile.digest) throw new Error("Native inventory profile belongs to another artifact");
    const boundary = { memory: host.memory, entries: host.runner.options, invoke: host.invoke.bind(host) };
    const bind = (entry: number, name: string, parameters: readonly GuestValueLayout[], validate = false, named = false): NativeModEntryBinding => {
      const binding = bindNativeModEntry(boundary, this.at(entry), `${host.memory.module.id}:primary-inventory-${name}`,
        { abi: profile.abi, parameters, result: "void", variadic: false }, (values, original) => {
          const value = values[0], flags = values[1], actor = value?.kind === "pointer" && value.value !== null ? host.actor(host.record(value.value)) : null;
          const frame: Frame = { actor, flags: flags?.kind === "int32" ? flags.value : -1, named, row: null, restore: null }; this.frames.push(frame);
          try {
            if (!validate || actor === null || this.evaluating !== 0) return original(values);
            const rows = hooks.rows(actor), chosen = rows === null ? null : this.cursor(actor, rows);
            if (chosen?.selected !== true) return original(values);
            const client = this.client(actor), address = host.memory.offset(client, BigInt(profile.inventory + chosen.sourceIndex * 4)), count = host.memory.readInt32(address);
            host.memory.writeInt32(address, this.sourceCount(chosen));
            try { return original(values); } finally { if (this.current(actor)) host.memory.writeInt32(address, count); }
          } finally { frame.restore?.(); this.frames.pop(); }
        });
      this.removals.push(binding.close); return binding;
    };
    try {
      this.next = bind(profile.next.entry, "next", [pointer, integer, ...profile.next.menuArgument ? [{ kind: "scalar", storage: "uint8" } satisfies GuestValueLayout] : []]);
      this.previous = bind(profile.previous.entry, "previous", [pointer, integer]);
      bind(profile.validate.entry, "validate", [pointer], true);
      bind(profile.use.entry, "use", [pointer]);
      bind(profile.namedUse.entry, "named-use", [pointer], false, true);
      this.removals.push(host.runner.bindInlineRegion(this.at(profile.namedUse.lookupCall), this.at(profile.namedUse.lookupReturn), profile.abi, continuation => {
        const frame = this.frames.at(-1), memory = host.memory, registers = host.runner.options.cpu.state.registers;
        if (frame?.named !== true || frame.actor === null || !this.current(frame.actor)) return continuation.execute();
        const stack = memory.pointer(registers.read("rsp", memory.pointerBytes === 4 ? 32 : 64));
        const name = memory.pointerBytes === 4 ? stack === null ? null : memory.readPointer(stack) : memory.pointer(registers.read("rcx", 64));
        if (name === null) throw new Error("Original item lookup has no name argument");
        const text = readClassicString(memory, name).toLowerCase();
        const result = continuation.execute();
        const original = memory.pointer(registers.read("rax", memory.pointerBytes === 4 ? 32 : 64));
        const choice = sourceItemNamed(hooks.rows(frame.actor) ?? [], text, original === null ? null : hooks.itemAt(original));
        if (choice?.kind === "ambiguous") {
          if (registers.read("rax", memory.pointerBytes === 4 ? 32 : 64) === 0n)
            hooks.print(frame.actor, `Ambiguous item "${text}"; use ${choice.items.map(item => item.item).join(", ")}\n`);
          return result;
        }
        const row = choice?.item;
        if (row?.selected !== true) return result;
        const actor = frame.actor, address = memory.offset(this.client(actor), BigInt(profile.inventory + row.sourceIndex * 4)), count = memory.readInt32(address);
        frame.row = row; frame.restore = () => { frame.restore = null; if (this.current(actor)) memory.writeInt32(address, count); };
        memory.writeInt32(address, this.sourceCount(row));
        registers.write("rax", memory.pointerBytes === 4 ? 32 : 64, hooks.descriptor(row.sourceIndex).byteOffset);
        return result;
      }));
      const scans = [
        { entry: profile.next.scan, join: profile.next.join, direction: 1 },
        { entry: profile.previous.scan, join: profile.previous.join, direction: -1 },
        ...profile.validate.scan === null ? [] : [{ ...profile.validate.scan, direction: 1 }],
      ];
      for (const scan of scans) this.removals.push(host.runner.bindInlineRegion(this.at(scan.entry), this.at(scan.join), profile.abi, continuation => {
        const frame = this.frames.at(-1), actor = frame?.actor;
        if (actor == null || !this.current(actor)) throw new Error("Admitted inventory scan lost its actor");
        const rows = hooks.rows(actor); if (rows === null) throw new Error("Admitted inventory scan lost its rows");
        this.navigate(actor, rows, scan.direction, frame?.flags ?? -1);
        return continuation.skip();
      }, () => {
        const actor = this.frames.at(-1)?.actor;
        return this.evaluating === 0 && actor != null && this.current(actor) && hooks.rows(actor) !== null;
      }));
      for (const use of [profile.use, profile.namedUse]) this.removals.push(host.runner.bindInlineRegion(this.at(use.call), this.at(use.join), profile.abi, continuation => {
        const frame = this.frames.at(-1), actor = frame?.actor;
        if (actor == null || !this.current(actor)) return continuation.execute();
        const rows = hooks.rows(actor), chosen = frame?.named === true ? frame.row : rows === null ? null : this.cursor(actor, rows);
        if (chosen?.selected !== true) return continuation.execute();
        frame?.restore?.(); hooks.use(actor, chosen.item); return continuation.skip();
      }));
    } catch (error) { this.close(); throw error; }
  }
  private sourceCount(row: NativeInventoryRow): number { return row.presenceOnly ? row.count === 0 ? 0 : 1 : row.count; }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.host.image, BigInt(offset)); }
  private current(actor: ActorId): boolean { const record = this.closed ? null : this.host.recordFor(actor); return record !== null && this.host.actor(record)?.equals(actor) === true; }
  private client(actor: ActorId): GuestAddress {
    const record = this.host.recordFor(actor);
    const client = record === null ? null : this.host.memory.readPointer(this.host.memory.offset(record.address, BigInt(this.profile.client)));
    if (client === null) throw new Error("Native inventory actor has no source client"); return client;
  }
  private cursor(actor: ActorId, rows: readonly NativeInventoryRow[]): NativeInventoryRow | null {
    const index = this.host.memory.readInt32(this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor))), selected = this.selected.get(actor);
    if (selected?.index === index) {
      const row = rows.find(row => row.item === selected.item);
      if (row !== undefined) return row;
      this.selected.delete(actor); this.host.memory.writeInt32(this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor)), this.profile.empty); return null;
    }
    this.selected.delete(actor); return rows.find(row => !row.selected && row.sourceIndex === index) ?? null;
  }
  private navigate(actor: ActorId, rows: readonly NativeInventoryRow[], direction: number, flags: number): void {
    const chosen = this.cursor(actor, rows), start = chosen === null ? direction > 0 ? -1 : 0 : rows.indexOf(chosen);
    const refused = new Map<number, Set<number>>();
    for (let step = 1; step <= rows.length; step++) {
      const row = rows[(start + direction * step + rows.length) % rows.length];
      if (row === undefined) throw new Error("Native inventory traversal lost its row");
      if (row.count === 0 || refused.get(row.sourceIndex)?.has(this.sourceCount(row)) === true) continue;
      if (this.evaluate(actor, row, direction, flags)) { this.selected.set(actor, { item: row.item, index: row.sourceIndex }); return; }
      const counts = refused.get(row.sourceIndex) ?? new Set<number>(); counts.add(this.sourceCount(row)); refused.set(row.sourceIndex, counts);
    }
    this.host.memory.writeInt32(this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor)), this.profile.empty);
    this.selected.delete(actor);
  }
  private evaluate(actor: ActorId, row: NativeInventoryRow, direction: number, flags: number): boolean {
    const memory = this.host.memory, client = this.client(actor), record = this.host.recordFor(actor);
    if (record === null || !Number.isInteger(row.sourceIndex) || row.sourceIndex <= 0 || row.sourceIndex >= this.profile.count)
      throw new Error("Canonical inventory row has no valid original item slot");
    const inventory = memory.offset(client, BigInt(this.profile.inventory)), savedInventory = memory.copy(inventory, this.profile.count * 4);
    const savedSelection = this.profile.selectionWrites.map(field => ({ address: memory.offset(client, BigInt(field.offset)), bytes: memory.copy(memory.offset(client, BigInt(field.offset)), field.bytes) }));
    let accepted = false;
    this.evaluating++;
    try {
      memory.write(inventory, new Uint8Array(savedInventory.length));
      memory.writeInt32(memory.offset(inventory, BigInt(row.sourceIndex * 4)), this.sourceCount(row));
      memory.writeInt32(memory.offset(client, BigInt(this.profile.cursor)), 0);
      const values: GuestCallValue[] = [{ kind: "pointer", value: record.address }, { kind: "int32", value: flags }];
      if (direction > 0 && this.profile.next.menuArgument) values.push({ kind: "uint32", value: 0 });
      (direction > 0 ? this.next : this.previous).original(values);
      accepted = memory.readInt32(memory.offset(client, BigInt(this.profile.cursor))) === row.sourceIndex;
      return accepted;
    } finally {
      this.evaluating--;
      if (this.current(actor)) {
        memory.write(inventory, savedInventory);
        if (!accepted) for (const value of savedSelection) memory.write(value.address, value.bytes);
      }
    }
  }
  read(actor: ActorId): NativeInventoryReadout | null {
    if (!this.current(actor)) return null;
    const rows = this.hooks.rows(actor);
    if (rows === null) {
      const tracked = this.selected.get(actor); this.selected.delete(actor);
      if (tracked !== undefined) {
        const cursor = this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor));
        if (this.host.memory.readInt32(cursor) === tracked.index) this.host.memory.writeInt32(cursor, this.profile.empty);
      }
      return null;
    }
    const chosen = this.cursor(actor, rows);
    return { items: rows.filter(row => row.count !== 0).map(({ item, label, count }) => ({ item, label, count })), selected: chosen?.item ?? null, ...(chosen?.presentation === undefined ? {} : { presentation: chosen.presentation }) };
  }
  restore(actor: ActorId, item: ItemId | null): void {
    this.selected.delete(actor); if (item === null) { this.host.memory.writeInt32(this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor)), this.profile.empty); return; }
    const row = this.hooks.rows(actor)?.find(row => row.item === item);
    if (row === undefined) throw new Error("Saved native inventory cursor is absent from its canonical rows");
    this.host.memory.writeInt32(this.host.memory.offset(this.client(actor), BigInt(this.profile.cursor)), row.sourceIndex);
    this.selected.set(actor, { item, index: row.sourceIndex });
  }
  release(actor: ActorId): void { this.selected.delete(actor); }
  close(): void { if (this.closed) return; this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); this.selected.clear(); }
}
