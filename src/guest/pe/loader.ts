// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity } from "../../contracts/execution.ts";
import type { GuestImportResolution, GuestImportResolver, GuestMapping, MappedGuestMemory } from "../core/contracts.ts";
import { directory, parsePe, PeError, PeReader } from "./format.ts";
import { ImageReader } from "./image.ts";
import type { PeImage } from "./image.ts";
import { readExports, readImports, readLoadConfiguration, readTls, readUnwind } from "./directories.ts";

export interface MapPeImageOptions {
  readonly bytes: Uint8Array;
  readonly memory: MappedGuestMemory;
  readonly module?: ModuleIdentity;
  readonly base?: bigint;
  readonly maximumImageBytes?: number;
}

function relocate(image: ImageReader): void {
  const reader = image.forStage("relocation");
  const table = directory(reader.pe, 5);
  const delta = reader.base - reader.pe.preferredBase;
  if (delta !== 0n && ((reader.pe.characteristics & 1) !== 0 || table.rva === 0)) throw new PeError("relocation", "image cannot be relocated away from its preferred base");
  if (table.rva === 0) return;
  const source = new PeReader(reader.copy(table.rva, table.byteLength), "relocation");
  const patches: { readonly rva: number; readonly width: 2 | 4 | 8; readonly value: bigint }[] = [];
  for (let block = 0; block < table.byteLength; ) {
    const page = source.u32(block);
    const size = source.u32(block + 4);
    if (page % 4096 !== 0 || size < 8 || size % 2 !== 0 || size > table.byteLength - block) throw new PeError("relocation", "invalid relocation block size/page");
    for (let at = block + 8; at < block + size; at += 2) {
      const entry = source.u16(at);
      const type = entry >>> 12;
      if (type === 0) continue;
      const rva = page + (entry & 0xfff);
      if (type === 10 && reader.pe.abi.pointerBytes === 8) {
        reader.range(rva, 8);
        patches.push({ rva, width: 8, value: reader.reader.u64(rva) + delta });
      } else if (reader.pe.abi.pointerBytes === 4 && type === 3) {
        patches.push({ rva, width: 4, value: BigInt(reader.u32(rva)) + delta });
      } else if (reader.pe.abi.pointerBytes === 4 && (type === 1 || type === 2)) {
        patches.push({ rva, width: 2, value: BigInt(reader.u16(rva)) + (type === 1 ? delta >> 16n : delta) });
      } else if (reader.pe.abi.pointerBytes === 4 && type === 4) {
        if (at + 2 >= block + size) throw new PeError("relocation", "HIGHADJ lacks its signed low word");
        at += 2;
        const low = BigInt.asIntN(16, BigInt(source.u16(at)));
        patches.push({ rva, width: 2, value: ((BigInt(reader.u16(rva)) << 16n) + low + delta + 0x8000n) >> 16n });
      } else throw new PeError("relocation", `unsupported base relocation type ${type} for ${reader.pe.abi.image}`);
    }
    block += size;
  }
  patches.sort((left, right) => left.rva - right.rva);
  let end = -1;
  for (const patch of patches) {
    if (patch.rva < end) throw new PeError("relocation", "overlapping relocation targets");
    end = patch.rva + patch.width;
    const value = BigInt.asUintN(patch.width * 8, patch.value);
    switch (patch.width) {
      case 2: reader.reader.view.setUint16(patch.rva, Number(value), true); break;
      case 4: reader.reader.view.setUint32(patch.rva, Number(value), true); break;
      case 8: reader.reader.view.setBigUint64(patch.rva, value, true); break;
    }
  }
}

/** Maps bytes and lifecycle metadata only. Bind imports and prepare TLS/runtime services before execution. */
export function mapPeImage(options: MapPeImageOptions): PeImage {
  const pe = parsePe(options.bytes);
  const memory = options.memory;
  const module = options.module ?? memory.module;
  const base = options.base ?? pe.preferredBase;
  const maximum = options.maximumImageBytes ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || pe.imageSize > maximum) throw new PeError("mapping", "image exceeds the explicit allocation limit");
  if (memory.pointerBytes !== pe.abi.pointerBytes || base === 0n || base % 65536n !== 0n || base < 0n ||
      base + BigInt(pe.imageSize) > (1n << BigInt(pe.abi.pointerBytes * 8))) throw new PeError("mapping", "incompatible guest pointer width or image base");
  if (directory(pe, 14).rva !== 0) throw new PeError("mapping", "managed CLR images require an unsupported runtime");
  const bytes = new Uint8Array(pe.imageSize);
  bytes.set(options.bytes.subarray(0, pe.headerSize));
  for (const section of pe.sections) bytes.set(options.bytes.subarray(section.rawOffset, section.rawOffset + section.rawSize), section.rva);
  const reader = new ImageReader(bytes, pe, base, memory, module, "mapping");
  for (let index = 0; index < pe.directories.length; index++) {
    const entry = directory(pe, index);
    if (index !== 4 && entry.rva !== 0) reader.range(entry.rva, entry.byteLength);
  }
  relocate(reader);
  const imports = readImports(reader);
  const exports = readExports(reader);
  const tls = readTls(reader);
  const unwindRecords = readUnwind(reader);
  const loadConfiguration = readLoadConfiguration(reader);
  const entryPoint = pe.entryPointRva === 0 ? null : reader.executable(pe.entryPointRva);
  const address = reader.address(0);
  const headerMappedSize = Math.ceil(pe.headerSize / pe.sectionAlignment) * pe.sectionAlignment;
  const imageMappings: GuestMapping[] = [{ base, byteLength: headerMappedSize, permissions: "read", label: `${module.id}:PE headers` }];
  for (const section of pe.sections) {
    if (section.mappedSize > 0) imageMappings.push({ base: base + BigInt(section.rva), byteLength: section.mappedSize,
      permissions: section.permissions, label: `${module.id}:${section.name}` });
  }
  memory.map({ base, byteLength: pe.imageSize, permissions: "read-write", bytes, label: `${module.id}:PE image` });
  try {
    memory.protect(address, pe.imageSize, "none");
    for (const mapping of imageMappings) memory.protect(memory.offset(address, mapping.base - base), mapping.byteLength, mapping.permissions);
  } catch (error) {
    memory.unmap(address, pe.imageSize);
    throw error;
  }
  return { module, abi: pe.abi, base: address, preferredBase: pe.preferredBase, byteLength: BigInt(pe.imageSize), entryPoint,
    mappings: memory.mappings().filter(mapping => mapping.base >= base && mapping.base < base + BigInt(pe.imageSize)), imports, exports,
    tls: tls.tls, tlsIndexAddress: tls.index, loadConfiguration, pe, unwindRecords,
    // Windows owns DllMain and TLS notifications. CRT constructors execute through DllMain, not a second list.
    initializers: [], finalizers: [],
    unwind: unwindRecords.map(record => ({ start: reader.address(record.beginRva), end: reader.address(record.endRva, 0), format: "pe-x64-unwind", metadata: record.metadata })) };
}

/** Resolver failures leave all IAT bytes untouched. Guest/host targets must belong to the same guest address space. */
export function bindPeImports(image: PeImage, memory: MappedGuestMemory, resolver: GuestImportResolver): readonly GuestImportResolution[] {
  if (memory.addressSpace !== image.base.addressSpace || memory.pointerBytes !== image.abi.pointerBytes) throw new PeError("imports", "image belongs to another guest address space");
  const resolutions: GuestImportResolution[] = [];
  const writes: { readonly slot: GuestAddress; readonly bytes: Uint8Array; readonly previous: Uint8Array }[] = [];
  for (const import_ of image.imports) {
    const resolution = resolver.resolve(import_, image);
    if (resolution.kind === "unresolved") throw new PeError("imports", `${import_.library}: ${resolution.detail}`);
    const address = resolution.address;
    if (address.addressSpace !== memory.addressSpace || address.byteOffset <= 0n || address.byteOffset >= (1n << BigInt(memory.pointerBytes * 8)) ||
        !memory.mappings().some(mapping => address.byteOffset >= mapping.base && address.byteOffset < mapping.base + BigInt(mapping.byteLength) && mapping.permissions !== "none")) {
      throw new PeError("imports", "resolved symbol is not a mapped address in this guest space");
    }
    const bytes = new Uint8Array(memory.pointerBytes);
    const view = new DataView(bytes.buffer);
    if (memory.pointerBytes === 4) view.setUint32(0, Number(address.byteOffset), true);
    else view.setBigUint64(0, address.byteOffset, true);
    writes.push({ slot: import_.slot, bytes, previous: memory.copy(import_.slot, memory.pointerBytes) });
    resolutions.push(resolution);
  }
  const regions = memory.mappings().filter(mapping => writes.some(write => write.slot.byteOffset < mapping.base + BigInt(mapping.byteLength) &&
    write.slot.byteOffset + BigInt(memory.pointerBytes) > mapping.base));
  const protectedRegions: GuestMapping[] = [];
  try {
    for (const region of regions) {
      const address = memory.pointer(region.base);
      if (address === null) throw new PeError("imports", "null IAT region");
      memory.protect(address, region.byteLength, region.permissions.includes("execute") ? "read-write-execute" : "read-write");
      protectedRegions.push(region);
    }
    try { for (const write of writes) memory.write(write.slot, write.bytes); }
    catch (error) { for (const write of writes) memory.write(write.slot, write.previous); throw error; }
  } finally {
    for (const region of protectedRegions) {
      const address = memory.pointer(region.base);
      if (address === null) throw new PeError("imports", "null IAT protection address");
      memory.protect(address, region.byteLength, region.permissions);
    }
  }
  return resolutions;
}
