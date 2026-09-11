// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity } from "../../contracts/execution.ts";
import type { GuestImage, MappedGuestMemory } from "../core/contracts.ts";
import { checkedRange, PeError, PeReader } from "./format.ts";
import type { PeFile } from "./format.ts";

export interface PeUnwindRecord {
  readonly beginRva: number;
  readonly endRva: number;
  readonly unwindInfoRva: number;
  readonly version: number;
  readonly flags: number;
  readonly handlerRva: number | null;
  readonly handlerDataRva: number | null;
  readonly chained: PeUnwindRecord | null;
  /** Exact UNWIND_INFO header/codes and optional handler RVA or chained RUNTIME_FUNCTION. */
  readonly metadata: Uint8Array;
}
export interface PeLoadConfiguration {
  readonly address: GuestAddress;
  readonly bytes: Uint8Array;
  readonly securityCookieAddress: GuestAddress | null;
  readonly guardCheckSlot: GuestAddress | null;
  readonly guardDispatchSlot: GuestAddress | null;
  readonly guardFlags: number;
}
export interface PeImage extends GuestImage {
  readonly pe: PeFile;
  readonly tlsIndexAddress: GuestAddress | null;
  readonly loadConfiguration: PeLoadConfiguration | null;
  readonly unwindRecords: readonly PeUnwindRecord[];
}

export class ImageReader {
  readonly reader: PeReader;
  constructor(readonly bytes: Uint8Array, readonly pe: PeFile, readonly base: bigint,
    readonly memory: MappedGuestMemory, readonly module: ModuleIdentity, readonly stage: PeError["stage"]) {
    this.reader = new PeReader(bytes, stage);
  }
  forStage(stage: PeError["stage"]): ImageReader { return new ImageReader(this.bytes, this.pe, this.base, this.memory, this.module, stage); }
  range(rva: number, size: number): void {
    checkedRange(rva, size, this.bytes.length, this.stage);
    if (size === 0) return;
    let at = rva;
    if (at < this.pe.headerSize) at = Math.min(rva + size, this.pe.headerSize);
    for (const section of this.pe.sections) {
      if (at >= section.rva && at < section.rva + section.mappedSize) at = Math.min(rva + size, section.rva + section.mappedSize);
      if (at === rva + size) return;
    }
    if (at !== rva + size) throw new PeError(this.stage, `RVA 0x${rva.toString(16)} crosses an unmapped image gap`);
  }
  address(rva: number, size = 1): GuestAddress {
    this.range(rva, size);
    const address = this.memory.pointer(this.base + BigInt(rva));
    if (address === null) throw new PeError(this.stage, "null image address");
    return address;
  }
  rva(va: bigint, size = 1): number {
    const offset = va - this.base;
    if (offset < 0n || offset > BigInt(this.pe.imageSize)) throw new PeError(this.stage, `VA 0x${va.toString(16)} is outside the image`);
    const rva = Number(offset);
    this.range(rva, size);
    return rva;
  }
  executable(rva: number): GuestAddress {
    const section = this.pe.sections.find(section => rva >= section.rva && rva < section.rva + section.mappedSize);
    if (section === undefined || !section.permissions.includes("execute")) throw new PeError(this.stage, `RVA 0x${rva.toString(16)} is not executable`);
    return this.address(rva);
  }
  u16(rva: number): number { this.range(rva, 2); return this.reader.u16(rva); }
  u32(rva: number): number { this.range(rva, 4); return this.reader.u32(rva); }
  pointer(rva: number): bigint {
    this.range(rva, this.pe.abi.pointerBytes);
    return this.pe.abi.pointerBytes === 4 ? BigInt(this.reader.u32(rva)) : this.reader.u64(rva);
  }
  text(rva: number, end = this.pe.imageSize): string {
    this.range(rva, 1);
    const section = this.pe.sections.find(section => rva >= section.rva && rva < section.rva + section.mappedSize);
    const bound = Math.min(end, section === undefined ? this.pe.headerSize : section.rva + section.mappedSize);
    return this.reader.text(rva, bound - rva);
  }
  copy(rva: number, size: number): Uint8Array { this.range(rva, size); return this.bytes.slice(rva, rva + size); }
}
