// SPDX-License-Identifier: GPL-2.0-or-later
// botlib/l_memory.c release32 allocation IDs and heap/hunk lifetime.

export interface BotMemoryAllocation { readonly bytes: Uint8Array }
export interface BotMemoryProvenance { readonly file: string; readonly line: number; readonly label: string }
export interface BotMemoryDebugProfile {
  readonly kind: "manager" | "debug";
  print(severity: "message" | "fatal", text: string): void;
  writeLog(text: string): void;
}
export interface BotMemoryHost {
  allocate(size: number, kind: "heap" | "hunk", clear: boolean): BotMemoryAllocation;
  release(allocation: BotMemoryAllocation, kind: "heap" | "hunk"): void;
  availableMemory(): number;
}
export interface BotMemoryOptions { readonly host?: BotMemoryHost; readonly debug?: BotMemoryDebugProfile }
interface AllocationRecord {
  readonly backing: BotMemoryAllocation;
  readonly kind: "heap" | "hunk";
  readonly size: number;
  readonly provenance: BotMemoryProvenance | null;
  live: boolean;
}
const prefixBytes = 4, heapId = 0x12345678, hunkId = 0x87654321;

/** Owns parser/state bytes only. Optional arenas and their capacity belong to the host. */
export class BotMemory {
  private readonly records = new WeakMap<BotMemoryAllocation, AllocationRecord>();
  private readonly live = new Map<BotMemoryAllocation, AllocationRecord>();
  private disposed = false;
  constructor(private readonly options: BotMemoryOptions = {}) {}

  allocate(size: number, kind: "heap" | "hunk", clear: boolean, provenance: BotMemoryProvenance | null = null): BotMemoryAllocation {
    if (this.disposed) throw new Error("Bot memory owner is disposed");
    if (!Number.isInteger(size) || size < 0 || size > 0x7fffffff - prefixBytes)
      throw new RangeError("Bot memory allocation must fit a signed source size with its four-byte prefix");
    const backing = this.options.host?.allocate(size + prefixBytes, kind, clear) ?? { bytes: new Uint8Array(size + prefixBytes) };
    const bytes = backing.bytes;
    if (bytes.byteLength !== size + prefixBytes) throw new RangeError("Bot memory host returned an allocation of the wrong size");
    new DataView(bytes.buffer, bytes.byteOffset, prefixBytes).setUint32(0, kind === "heap" ? heapId : hunkId, true);
    if (clear) bytes.fill(0, prefixBytes);
    const record: AllocationRecord = { backing, kind, size, provenance, live: true };
    const allocation: BotMemoryAllocation = {
      get bytes(): Uint8Array {
        if (!record.live) throw new Error("Bot memory allocation has been freed");
        return record.backing.bytes.subarray(prefixBytes);
      },
    };
    this.records.set(allocation, record); this.live.set(allocation, record);
    return allocation;
  }

  free(allocation: BotMemoryAllocation | null): void {
    const record = allocation === null ? undefined : this.records.get(allocation);
    if (record === undefined || !record.live) {
      if (this.options.debug !== undefined) { this.options.debug.print("fatal", "FreeMemory: invalid memory block\n"); return; }
      throw new Error("Bot memory allocation belongs to another owner or has been freed");
    }
    const bytes = record.backing.bytes;
    const id = new DataView(bytes.buffer, bytes.byteOffset, prefixBytes).getUint32(0, true);
    if (id !== heapId) return;
    if (record.kind !== "heap") throw new Error("Bot memory heap ID does not belong to a heap allocation");
    if (allocation === null) throw new Error("Bot memory allocation is absent");
    this.release(allocation, record);
  }

  private release(allocation: BotMemoryAllocation, record: AllocationRecord): void {
    this.options.host?.release(record.backing, record.kind);
    if (this.options.host === undefined) record.backing.bytes.fill(0xaa);
    record.live = false; this.live.delete(allocation);
  }
  resetHunk(): void {
    for (const [allocation, record] of this.live) if (record.kind === "hunk") this.release(allocation, record);
  }
  dispose(): void {
    if (this.disposed) return;
    for (const [allocation, record] of this.live) this.release(allocation, record);
    this.disposed = true;
  }
  availableMemory(): number {
    if (this.options.host === undefined) throw new Error("Bot AvailableMemory requires a host arena with capacity accounting");
    return this.options.host.availableMemory();
  }
  get liveAllocations(): number { return this.live.size; }
  get allocatedBytes(): number { let size = 0; for (const record of this.live.values()) size += record.size; return size; }
  printUsedMemorySize(): void {
    const debug = this.options.debug;
    if (debug === undefined) return;
    debug.print("message", `total allocated memory: ${this.allocatedBytes >> 10} KB\n`);
    debug.print("message", `total botlib memory: ${(this.allocatedBytes + prefixBytes * this.live.size) >> 10} KB\n`);
    debug.print("message", `total memory blocks: ${this.live.size}\n`);
  }
  printMemoryLabels(): void {
    const debug = this.options.debug;
    if (debug === undefined) return;
    this.printUsedMemorySize(); debug.writeLog("============= Botlib memory log ==============\r\n\r\n");
    if (debug.kind !== "debug") return;
    let index = 0;
    for (const record of [...this.live.values()].reverse()) {
      const source = record.provenance;
      const location = source === null ? "<unattributed>" : `${source.file.padStart(24)} line ${String(source.line).padStart(6)}: ${source.label}`;
      debug.writeLog(`${String(index++).padStart(6)}, ${record.kind}, ${String(record.size + prefixBytes).padStart(8)}: ${location}\r\n`);
    }
  }
  memoryByteSize(allocation: BotMemoryAllocation | null): number {
    if (this.options.debug === undefined) throw new Error("MemoryByteSize requires the bot memory manager profile");
    const record = allocation === null ? undefined : this.records.get(allocation);
    return record === undefined || !record.live ? 0 : record.size + prefixBytes;
  }
  dumpMemory(): void {
    if (this.options.debug === undefined) throw new Error("DumpMemory requires the bot memory manager profile");
    for (const allocation of [...this.live.keys()].reverse()) this.free(allocation);
  }
}
