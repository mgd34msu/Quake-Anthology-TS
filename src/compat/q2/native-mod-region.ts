import type { GuestAddress, GuestCallValue } from "../../contracts/execution.ts";
import type { NativeModProtectionRegion, NativeModRegionLocation } from "../../contracts/native-mod-region.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { captureAbiProcessorState, restoreAbiProcessorState, type AbiProcessorSnapshot } from "../../guest/abi/runner.ts";
import { decodeValue, encodeValue, storageBytes } from "../../guest/abi/values.ts";

export interface NativeModRegionAuthority { readonly error: Error; current(): boolean; }

type Host = Pick<NativeModHost, "memory" | "imageBase" | "entries" | "bindInlineRegion">;
const width = (bytes: number): 8 | 16 | 32 | 64 => {
  switch (bytes) { case 1: return 8; case 2: return 16; case 4: return 32; case 8: return 64; default: throw new Error("Invalid native region scalar width"); }
};
export function validateNativeModRegion(region: NativeModProtectionRegion, pointerBytes: 4 | 8): void {
  const boundaries = [region.frame.entry, region.entry, region.join, region.frame.exit];
  if (boundaries.some(value => !Number.isSafeInteger(value) || value < 0) || new Set(boundaries).size !== boundaries.length
    || [region.frame.stackBytes, region.frame.argumentBytes].some(value => !Number.isSafeInteger(value) || value < 0 || value % pointerBytes !== 0)
    || (region.call.skips?.length ?? 0) !== 0 || region.result.storage === "pointer") throw new Error("Invalid standalone native region frame");
  const locations = region.inputs.map(input => input.target);
  const extent = (location: NativeModRegionLocation): { readonly bank: string; readonly offset: number; readonly length: number } => {
    const length = storageBytes(location.storage, pointerBytes);
    if (location.kind === "register") {
      if (pointerBytes === 4 && (length > 4 || /^r(?:[89]|1[0-5])$/.test(location.register))) throw new Error("Native region register exceeds the source architecture");
      return { bank: location.register, offset: 0, length };
    }
    if (!Number.isSafeInteger(location.offset) || location.offset < 0) throw new Error("Invalid native region field offset");
    if (location.kind === "simd") {
      if (!Number.isSafeInteger(location.index) || location.index < 0 || location.index >= (pointerBytes === 4 ? 8 : 16) || location.offset + length > 16)
        throw new Error("Native region SIMD field exceeds its register");
      return { bank: "simd", offset: location.index * 16 + location.offset, length };
    }
    if (location.offset + length > region.frame.stackBytes + pointerBytes + region.frame.argumentBytes
      || location.offset < region.frame.stackBytes + pointerBytes && location.offset + length > region.frame.stackBytes)
      throw new Error("Native region field exceeds its frame or overlaps the return address");
    return { bank: "stack", offset: location.offset, length };
  };
  const ranges = locations.map(extent); extent(region.result);
  for (const [index, range] of ranges.entries()) if (ranges.slice(0, index).some(previous => previous.bank === range.bank
    && range.offset < previous.offset + previous.length && previous.offset < range.offset + range.length)) throw new Error("Native region inputs overlap");
}

/** Runs a qualified region in its original prologue/epilogue, scoped to one invocation. */
export class NativeModRegionExecution {
  private entryStack: bigint | null = null;
  private before: AbiProcessorSnapshot | null = null;
  private phase: "prologue" | "region" | "executing" | "epilogue" = "prologue";
  private output: GuestCallValue | null = null;
  private readonly stackInputs: { readonly address: GuestAddress; readonly bytes: Uint8Array }[] = [];
  constructor(private readonly host: Host, private readonly definition: NativeModProtectionRegion,
    private readonly inputs: readonly GuestCallValue[], private readonly authority: NativeModRegionAuthority | undefined) {
    validateNativeModRegion(definition, host.memory.pointerBytes);
    if (inputs.length !== definition.inputs.length) throw new Error("Native region input count differs from its declaration");
    for (const rva of [definition.frame.entry, definition.entry, definition.join, definition.frame.exit]) host.memory.check(this.at(rva), 1, "execute");
  }
  private assertCurrent(): void { if (this.authority !== undefined && !this.authority.current()) throw this.authority.error; }
  private at(rva: number): GuestAddress { return this.host.memory.offset(this.host.imageBase, BigInt(rva)); }
  private stack(): bigint { return this.host.entries.cpu.state.registers.read("rsp", this.host.memory.pointerBytes === 4 ? 32 : 64); }
  private current(): boolean { return this.entryStack !== null && this.stack() === this.entryStack - BigInt(this.definition.frame.stackBytes); }
  private stackAddress(offset: number): GuestAddress {
    const address = this.host.memory.pointer(this.stack() + BigInt(offset)); if (address === null) throw new Error("Native region has no live stack"); return address;
  }
  private read(location: NativeModRegionLocation): Uint8Array {
    const { memory, entries: { cpu } } = this.host, count = storageBytes(location.storage, memory.pointerBytes);
    if (location.kind === "stack") return memory.copy(this.stackAddress(location.offset), count);
    if (location.kind === "simd") return cpu.state.simd.xmm.slice(location.index * 16 + location.offset, location.index * 16 + location.offset + count);
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, cpu.state.registers.read(location.register, width(count)), true); return bytes.slice(0, count);
  }
  private write(location: NativeModRegionLocation, value: GuestCallValue): void {
    const { memory, entries: { cpu } } = this.host, bytes = encodeValue({ kind: "scalar", storage: location.storage }, value, memory);
    if (location.kind === "stack") {
      const address = this.stackAddress(location.offset); this.stackInputs.push({ address, bytes: memory.copy(address, bytes.length) }); memory.write(address, bytes);
    } else if (location.kind === "simd") cpu.state.simd.xmm.set(bytes, location.index * 16 + location.offset);
    else { const raw = new Uint8Array(8); raw.set(bytes); cpu.state.registers.write(location.register, width(bytes.length), new DataView(raw.buffer).getBigUint64(0, true)); }
  }
  bind(target: GuestAddress): () => void {
    const { host, definition } = this, remove: (() => void)[] = [];
    try {
      remove.push(host.entries.callbacks.observeEntry(target, () => { if (this.entryStack === null) this.entryStack = this.stack(); }));
      remove.push(host.bindInlineRegion(this.at(definition.frame.entry), this.at(definition.entry), continuation => {
        this.assertCurrent(); if (!this.current()) throw new Error("Native donor prologue differs from its declared stack frame");
        this.before = captureAbiProcessorState(host.entries.cpu.state);
        for (const [index, input] of definition.inputs.entries()) { const value = this.inputs[index]; if (value === undefined) throw new Error("Missing native region input"); this.write(input.target, value); }
        this.phase = "region"; return continuation.skip();
      }, () => this.phase === "prologue"));
      remove.push(host.bindInlineRegion(this.at(definition.entry), this.at(definition.join), continuation => {
        this.assertCurrent(); if (!this.current()) throw new Error("Native donor region left its declared stack frame");
        this.phase = "executing"; continuation.execute(); this.assertCurrent();
        this.output = decodeValue({ kind: "scalar", storage: definition.result.storage }, this.read(definition.result), host.memory);
        if (this.before === null) throw new Error("Native donor region skipped its declared prologue");
        for (const saved of this.stackInputs.splice(0).reverse()) host.memory.write(saved.address, saved.bytes);
        restoreAbiProcessorState(host.entries.cpu.state, this.before); host.entries.cpu.state.instructionPointer = this.at(definition.join).byteOffset;
        this.phase = "epilogue"; return undefined;
      }, () => this.phase === "region"));
      remove.push(host.bindInlineRegion(this.at(definition.join), this.at(definition.frame.exit), continuation => {
        this.assertCurrent(); if (!this.current()) throw new Error("Native donor epilogue left its declared stack frame");
        return continuation.skip();
      }, () => this.phase === "epilogue"));
    } catch (error) { for (const close of remove.reverse()) close(); throw error; }
    return () => { for (const close of remove.reverse()) close(); };
  }
  result(): GuestCallValue {
    if (this.phase !== "epilogue" || this.output === null) throw new Error("Native donor did not complete its declared region");
    return this.output;
  }
}
