import type { ContentDigest } from "../../contracts/content.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue, NativeAbi, GuestValueLayout } from "../../contracts/execution.ts";
import type { GuestRegister } from "../../guest/core/contracts.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import { readClassicString } from "./classic/records.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";
import type { NativePrimaryWeaponHost } from "./native-primary-weapons.ts";

export interface NativePrimaryCommandProfile {
  readonly digest: ContentDigest;
  readonly abi: NativeAbi;
  readonly give: { readonly entry: number; readonly weapons: number; readonly ammo: number;
    readonly unknown: { readonly entry: number; readonly join: number };
    readonly ammoGrants: readonly { readonly entry: number; readonly join: number; readonly descriptor: GuestRegister; readonly kind: "set" | "add" }[]; readonly argc: number; readonly argv: number };
  readonly drop: { readonly entry: number; readonly eligibility: { readonly entry: number; readonly join: number } };
  readonly client: { readonly pointer: number; readonly weapon: number; readonly ammoIndex: number | null; readonly inventory: number };
  readonly items: { readonly table: number; readonly stride: number; readonly count: number; readonly classname: number; readonly flags: number;
    readonly ammo: { readonly kind: "name"; readonly offset: number; readonly label: number } | { readonly kind: "index"; readonly offset: number } };
}
export interface NativePrimaryCommandHooks {
  give(actor: ActorId, category: "weapons" | "ammo"): void;
  giveItem(actor: ActorId, args: readonly string[]): boolean;
  giveAmmo(actor: ActorId, item: ItemId, change: { readonly kind: "set" | "add"; readonly amount: number }): void;
  drop(actor: ActorId): { readonly item: ItemId | null; readonly ammo: number } | null;
}
interface Item { readonly item: ItemId; readonly index: number; readonly address: GuestAddress; readonly weapon: boolean; readonly ammunition: boolean; readonly ammo: ItemId | null; }
const pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };
const integer: GuestValueLayout = { kind: "scalar", storage: "int32" };

/** Original commands retain cheat checks, grants and map-owned drop decisions. */
export class NativePrimaryCommands {
  private readonly removals: (() => void)[] = [];
  private readonly giving: (ActorId | null)[] = [];
  private readonly dropping: (ActorId | null)[] = [];
  private readonly items: readonly Item[];
  private closed = false;
  constructor(private readonly host: NativePrimaryWeaponHost, private readonly profile: NativePrimaryCommandProfile, hooks: NativePrimaryCommandHooks) {
    if (host.memory.module.digest !== profile.digest) throw new Error("Native command profile belongs to another artifact");
    this.items = this.readItems();
    const boundary = { memory: host.memory, entries: host.runner.options, invoke: host.invoke.bind(host) };
    const signature = { abi: profile.abi, parameters: [pointer], result: "void", variadic: false } satisfies import("../../guest/core/contracts.ts").GuestCallSignature;
    try {
      for (const [name, entry, stack] of [["give", profile.give.entry, this.giving], ["drop", profile.drop.entry, this.dropping]] satisfies readonly (readonly [string, number, (ActorId | null)[]])[]) {
        this.removals.push(bindNativeModEntry(boundary, this.at(entry), `${host.memory.module.id}:primary-${name}`, signature, (values, original) => {
          const value = values[0], actor = value?.kind === "pointer" && value.value !== null ? host.actor(host.record(value.value)) : null;
          stack.push(actor);
          try { return original(values); } finally { stack.pop(); }
        }).close);
      }
      for (const category of ["weapons", "ammo"] satisfies readonly ("weapons" | "ammo")[]) this.removals.push(host.runner.options.callbacks.observeEntry(this.at(profile.give[category]), () => {
        const actor = this.giving.at(-1); if (actor != null && this.current(actor)) hooks.give(actor, category);
      }));
      this.removals.push(host.runner.bindInlineRegion(this.at(profile.give.unknown.entry), this.at(profile.give.unknown.join), profile.abi, continuation => {
        const actor = this.giving.at(-1);
        return actor != null && this.current(actor) && hooks.giveItem(actor, this.arguments()) ? continuation.skip() : continuation.execute();
      }));
      for (const region of profile.give.ammoGrants) this.removals.push(host.runner.bindInlineRegion(this.at(region.entry), this.at(region.join), profile.abi, continuation => {
        const actor = this.giving.at(-1); if (actor == null || !this.current(actor)) return continuation.execute();
        const descriptor = host.runner.options.cpu.state.registers.read(region.descriptor, host.memory.pointerBytes === 4 ? 32 : 64);
        const item = this.items.find(value => value.address.byteOffset === descriptor), record = host.recordFor(actor);
        if (item === undefined || record === null) throw new Error("Original ammo command lacks its source item");
        const client = host.memory.readPointer(host.memory.offset(record.address, BigInt(profile.client.pointer)));
        if (client === null) throw new Error("Original ammo command lost its client");
        const address = host.memory.offset(client, BigInt(profile.client.inventory + item.index * 4)), before = host.memory.readInt32(address);
        const result = continuation.execute();
        if (this.current(actor)) {
          const after = host.memory.readInt32(address);
          hooks.giveAmmo(actor, item.item, { kind: region.kind, amount: region.kind === "set" ? after : (after - before) | 0 });
        }
        return result;
      }));
      this.removals.push(host.runner.bindInlineRegion(this.at(profile.drop.eligibility.entry), this.at(profile.drop.eligibility.join), profile.abi, continuation => {
        const actor = this.dropping.at(-1), projection = actor == null || !this.current(actor) ? null : hooks.drop(actor);
        if (actor == null || projection === null) return continuation.execute();
        const record = host.recordFor(actor); if (record === null) throw new Error("Original death drop lost its actor");
        const client = host.memory.readPointer(host.memory.offset(record.address, BigInt(profile.client.pointer)));
        if (client === null) throw new Error("Original death drop lost its client");
        const item = projection.item === null ? null : this.items.find(value => value.item === projection.item && value.weapon);
        if (item === undefined || !Number.isInteger(projection.ammo) || projection.ammo < -0x80000000 || projection.ammo > 0x7fffffff) throw new Error("Selected death drop lacks an original weapon or int32 ammunition");
        const ammo = item?.ammo == null ? undefined : this.items.find(value => value.item === item.ammo);
        const weapon = host.memory.offset(client, BigInt(profile.client.weapon));
        const words = [...profile.client.ammoIndex === null ? [] : [{ address: host.memory.offset(client, BigInt(profile.client.ammoIndex)), value: ammo?.index ?? 0 }],
          ...ammo === undefined ? [] : [{ address: host.memory.offset(client, BigInt(profile.client.inventory + ammo.index * 4)), value: projection.ammo }]];
        const saved = [{ address: weapon, bytes: host.memory.copy(weapon, host.memory.pointerBytes) }, ...words.map(value => ({ address: value.address, bytes: host.memory.copy(value.address, 4) }))];
        try {
          host.memory.writePointer(weapon, item?.address ?? null);
          for (const word of words) host.memory.writeInt32(word.address, word.value);
          return continuation.execute();
        } finally { if (this.current(actor) && host.recordFor(actor)?.address.byteOffset === record.address.byteOffset) for (const value of saved.reverse()) host.memory.write(value.address, value.bytes); }
      }));
    } catch (error) { this.close(); throw error; }
  }
  private at(offset: number): GuestAddress { return this.host.memory.offset(this.host.image, BigInt(offset)); }
  private current(actor: ActorId): boolean { if (this.closed) return false; const record = this.host.recordFor(actor); return record !== null && this.host.actor(record)?.equals(actor) === true; }
  private readItems(): readonly Item[] {
    const table = this.profile.items, memory = this.host.memory;
    const source = Array.from({ length: table.count }, (_, index) => {
      const address = this.at(table.table + index * table.stride), classname = readClassicString(memory, memory.readPointer(memory.offset(address, BigInt(table.classname))));
      const item: ItemId | null = /^[a-z][a-z0-9_]*$/.test(classname) ? `q2:${classname}` : null;
      return { item, index, address, ammunition: (memory.readUint32(memory.offset(address, BigInt(table.flags))) & 2) !== 0, weapon: (memory.readUint32(memory.offset(address, BigInt(table.flags))) & 1) !== 0,
        label: table.ammo.kind === "name" ? readClassicString(memory, memory.readPointer(memory.offset(address, BigInt(table.ammo.label)))) : "" };
    });
    const result: Item[] = [], names = new Set<ItemId>();
    for (const value of source) {
      if (value.item === null) { if (value.weapon) throw new Error("Original weapon has no qualified classname"); continue; }
      if (names.has(value.item)) throw new Error("Original item table has duplicate classnames"); names.add(value.item);
      let ammo: ItemId | null = null;
      if (value.weapon) {
        const field = memory.offset(value.address, BigInt(table.ammo.offset));
        if (table.ammo.kind === "name") {
          const name = readClassicString(memory, memory.readPointer(field));
          if (name !== "") { const found = source.find(row => row.label.toLowerCase() === name.toLowerCase()); if (found?.item == null) throw new Error("Original weapon ammo name has no source item"); ammo = found.item; }
        } else {
          const index = memory.readInt32(field);
          if (index !== 0) { const found = source[index]; if (found?.item == null) throw new Error("Original weapon ammo index has no source item"); ammo = found.item; }
        }
      }
      result.push({ item: value.item, index: value.index, address: value.address, weapon: value.weapon, ammunition: value.ammunition, ammo });
    }
    return result;
  }
  inventorySlots(): readonly { readonly item: ItemId; readonly index: number; readonly weapon: boolean; readonly ammunition: boolean }[] {
    return this.items.map(({ item, index, weapon, ammunition }) => ({ item, index, weapon, ammunition }));
  }
  weapons(): readonly { readonly item: ItemId; readonly ammo: ItemId | null }[] { return this.items.filter(value => value.weapon).map(({ item, ammo }) => ({ item, ammo })); }
  withWeapon<Result>(actor: ActorId, item: ItemId | null, run: () => Result): Result {
    if (!this.current(actor)) throw new Error("Original weapon projection lost its actor");
    if (item === null) return run();
    const descriptor = this.items.find(value => value.item === item && value.weapon), record = this.host.recordFor(actor);
    if (descriptor === undefined || record === null) throw new Error("Selected weapon has no original descriptor");
    const client = this.host.memory.readPointer(this.host.memory.offset(record.address, BigInt(this.profile.client.pointer)));
    if (client === null) throw new Error("Original weapon projection lost its client");
    const address = this.host.memory.offset(client, BigInt(this.profile.client.weapon)), previous = this.host.memory.readPointer(address);
    try { this.host.memory.writePointer(address, descriptor.address); return run(); }
    finally { if (this.current(actor) && this.host.recordFor(actor)?.address.byteOffset === record.address.byteOffset) this.host.memory.writePointer(address, previous); }
  }
  private imported(offset: number, parameters: readonly GuestValueLayout[], result: GuestValueLayout, values: readonly GuestCallValue[]): GuestCallResult {
    const address = this.host.memory.readPointer(this.at(offset)); if (address === null) throw new Error("Original command import is null");
    return this.host.invoke(address, { abi: this.profile.abi, parameters, result, variadic: false }, values);
  }
  private arguments(): readonly string[] {
    const count = this.imported(this.profile.give.argc, [], integer, []);
    if (count.kind !== "int32" || count.value < 0 || count.value > 1024) throw new Error("Original command argc is invalid");
    return Array.from({ length: Math.max(0, count.value - 1) }, (_, index) => {
      const value = this.imported(this.profile.give.argv, [integer], pointer, [{ kind: "int32", value: index + 1 }]);
      if (value.kind !== "pointer" || value.value === null) throw new Error("Original command argv is null");
      return readClassicString(this.host.memory, value.value);
    });
  }
  close(): void { if (this.closed) return; this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); }
}
