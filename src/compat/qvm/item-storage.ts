import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { QvmItemCapacity, QvmItemField, QvmItemStorage } from "../../contracts/qvm-mod-items.ts";
import { QvmOpcode, type QvmImage } from "./image.ts";
function integer(value: number): boolean { return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647; }
function constant(image: QvmImage, instruction: number): number {
  const value = image.instructions[instruction];
  if (value?.opcode !== QvmOpcode.OP_CONST || value.operand < 0) throw new Error("QVM item capacity is not its declared original constant");
  return value.operand;
}
export function validateQvmItemStorage(storageValues: readonly QvmItemStorage[], items: ReadonlySet<ItemId>, image: QvmImage,
  field: (source: QvmItemField, usage?: "storage" | "capacity") => void): void {
  const bound = new Set<ItemId>();
  const bind = (item: ItemId): void => { if (!items.has(item) || bound.has(item)) throw new Error("QVM item lacks distinct declared storage"); bound.add(item); };
  for (const storage of storageValues) {
    field(storage.field);
    if (storage.kind === "counter") {
      bind(storage.item);
      const capacity = storage.capacity;
      if (capacity.kind === "field") field(capacity.field, "capacity");
      if (capacity.kind === "constant" && (!integer(capacity.value) || capacity.value < 0)) throw new Error("QVM item capacity exceeds its source ABI");
      if (capacity.kind === "source") {
        constant(image, capacity.instruction);
        for (const value of capacity.overrides) {
          constant(image, value.instruction);
          if (!integer(value.value) || !Number.isInteger(value.address) || value.address < 0 || value.address % 4 !== 0
            || value.address + 4 > image.initializedData.length + image.bssLength) throw new Error("QVM capacity selector exceeds original source storage");
        }
      }
    } else {
      if (!Number.isInteger(storage.privateMask) || storage.privateMask < 0 || storage.privateMask > 0xffffffff || storage.items.length === 0) throw new Error("Invalid QVM private inventory mask");
      let mask = storage.privateMask;
      for (const value of storage.items) {
        bind(value.item);
        if (!Number.isInteger(value.mask) || value.mask < 1 || value.mask > 0x80000000 || (value.mask & (value.mask - 1)) !== 0 || (mask & value.mask) !== 0)
          throw new Error("QVM packed item masks overlap");
        mask |= value.mask;
      }
    }
  }
  if (bound.size !== items.size) throw new Error("QVM item definition has no source storage");
}
export interface QvmItemStorageAccess {
  read(field: QvmItemField): number;
  global(address: number): number;
  write(field: QvmItemField, value: number): void;
}
export function qvmItemCapacity(image: QvmImage, capacity: QvmItemCapacity, access: Pick<QvmItemStorageAccess, "read" | "global">): number {
  if (capacity.kind === "constant") return capacity.value;
  if (capacity.kind === "field") return access.read(capacity.field);
  for (const value of capacity.overrides) {
    const matches = access.global(value.address) === value.value;
    if (value.comparison === "equals" ? matches : !matches) return constant(image, value.instruction);
  }
  return constant(image, capacity.instruction);
}
export function readQvmItemStorage(image: QvmImage, storage: QvmItemStorage, access: Pick<QvmItemStorageAccess, "read" | "global">): readonly InventoryEntry[] {
  const count = access.read(storage.field);
  if (storage.kind === "counter") return [{ item: storage.item, count, capacity: qvmItemCapacity(image, storage.capacity, access), countPolicy: { kind: "source-counter", arithmetic: "int32" } }];
  const mask = storage.items.reduce((mask, value) => mask | value.mask, storage.privateMask);
  if ((count & ~mask) !== 0) throw new Error("Original QVM inventory contains undeclared bits");
  return storage.items.map(value => ({ item: value.item, count: (count & value.mask) === 0 ? 0 : 1, capacity: 1 }));
}
export function writeQvmItemStorage(image: QvmImage, storage: QvmItemStorage, entry: InventoryEntry, access: QvmItemStorageAccess): undefined {
  if (storage.kind === "counter") {
    if (!integer(entry.count) || !integer(entry.capacity) || entry.capacity < 0) throw new Error("QVM item exceeds its signed source representation");
    if (storage.capacity.kind !== "field" && entry.capacity !== qvmItemCapacity(image, storage.capacity, access)) throw new Error("QVM capacity is owned by its original source");
    access.write(storage.field, entry.count);
    if (storage.capacity.kind === "field") access.write(storage.capacity.field, entry.capacity);
  } else {
    const bit = storage.items.find(value => value.item === entry.item);
    if (bit === undefined || entry.capacity !== 1 || entry.count !== 0 && entry.count !== 1) throw new Error("QVM packed ownership requires one admitted bit");
    const previous = access.read(storage.field); access.write(storage.field, entry.count === 0 ? previous & ~bit.mask : previous | bit.mask);
  }
  return undefined;
}
