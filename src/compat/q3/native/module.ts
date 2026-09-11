// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage, NativeAbi } from "../../../contracts/execution.ts";
import type { GuestCallRunner } from "../../../guest/abi/index.ts";
import type { GuestCallSignature, GuestImage, MappedGuestMemory } from "../../../guest/core/index.ts";

export function nativeQ3Signature(abi: NativeAbi, parameters: readonly GuestStorage[], result: GuestStorage | "void", variadic = false): GuestCallSignature {
  return { abi, parameters: parameters.map(storage => ({ kind: "scalar", storage })),
    result: result === "void" ? "void" : { kind: "scalar", storage: result }, variadic };
}

export function nativeQ3Export(image: GuestImage, name: string): GuestAddress | null {
  const entry = image.exports.find(entry => entry.symbol.kind === "name" && entry.symbol.name === name);
  return entry?.target.kind === "address" ? entry.target.address : null;
}

export interface NativeQ3ModuleOptions {
  readonly image: GuestImage;
  readonly runner: GuestCallRunner;
  readonly context: GuestCallContext;
  readonly instructionBudget: number;
}

/** Quake Live game API 10, checked against both supplied ELF entry functions.
 * Official Q3's dllEntry(syscall)/vmMain interface is a different profile.
 * The caller owns image loading/CRT initialization and the shared guest process.
 */
export class QuakeLiveGameModule {
  readonly memory: MappedGuestMemory;
  readonly exports: GuestAddress;
  readonly apiVersion: number;
  constructor(readonly options: NativeQ3ModuleOptions, imports: GuestAddress) {
    const { image, runner } = options;
    this.memory = runner.options.cpu.memory;
    if (image.base.addressSpace !== imports.addressSpace || image.base.addressSpace !== this.memory.addressSpace) throw new TypeError("Native game imports belong to another guest process");
    if (nativeQ3Export(image, "vmMain") !== null || nativeQ3Export(image, "GetGameAPI") !== null) throw new TypeError("Module does not use the Quake Live table interface");
    const entry = nativeQ3Export(image, "dllEntry"); if (entry === null) throw new Error("Native module has no dllEntry export");
    const output = this.memory.allocate({ byteLength: image.abi.pointerBytes + 4, alignment: 8n, label: "QL dllEntry output" });
    const version = this.memory.offset(output, BigInt(image.abi.pointerBytes));
    this.invoke(entry, ["pointer", "pointer", "pointer"], "void", [{ kind: "pointer", value: output }, { kind: "pointer", value: imports }, { kind: "pointer", value: version }]);
    this.apiVersion = this.memory.readInt32(version);
    if (this.apiVersion !== 10) throw new Error(`Quake Live game API ${this.apiVersion} is unsupported; expected 10`);
    const table = this.memory.readPointer(output); if (table === null) throw new Error("Quake Live dllEntry returned a null export table");
    this.memory.check(table, 11 * image.abi.pointerBytes, "read");
    this.exports = table;
    this.memory.unmap(output, image.abi.pointerBytes + 4);
  }
  private invoke(target: GuestAddress, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult {
    const { options } = this, signature = nativeQ3Signature(options.image.abi, parameters, result);
    return options.runner.invoke({ target, signature, arguments: args, context: { ...options.context,
      callback: { kind: "native-guest", module: options.image.module, address: target, abi: signature.abi } }, instructionBudget: options.instructionBudget });
  }
  private call(slot: number, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult {
    const target = this.memory.readPointer(this.memory.offset(this.exports, BigInt(slot * this.memory.pointerBytes)));
    if (target === null) throw new Error(`Missing Quake Live export slot ${slot}`);
    this.memory.check(target, 1, "execute");
    return this.invoke(target, parameters, result, args);
  }
  registerCvars(): void { this.call(2, [], "void", []); }
  initialize(levelTime: number, randomSeed: number, restart = false): void {
    this.call(3, ["int32", "int32", "int32"], "void", [levelTime, randomSeed, Number(restart)].map(value => ({ kind: "int32", value })));
  }
  shutdown(restart = false): void { this.call(0, ["int32"], "void", [{ kind: "int32", value: Number(restart) }]); }
  runFrame(time: number): void { this.call(1, ["int32"], "void", [{ kind: "int32", value: time }]); }
  consoleCommand(): boolean {
    const result = this.call(4, [], "int32", []);
    if (result.kind !== "int32") throw new TypeError("Quake Live ConsoleCommand returned the wrong ABI type");
    return result.value !== 0;
  }
  clientConnect(client: number, firstTime: boolean, isBot: boolean): GuestAddress | null {
    const result = this.call(8, ["int32", "int32", "int32"], "pointer", [client, Number(firstTime), Number(isBot)].map(value => ({ kind: "int32", value })));
    if (result.kind !== "pointer") throw new TypeError("Quake Live ClientConnect returned the wrong ABI type");
    return result.value;
  }
}

/** Official Q3 1.32 native i386 vmMain uses command plus twelve 32-bit arguments.
 * The supplied syscall address must use the source variadic C ABI. QVM memory
 * masking must not be applied to these absolute guest addresses.
 */
export class Quake3VmModule {
  readonly vmMain: GuestAddress;
  constructor(readonly options: NativeQ3ModuleOptions, syscall: GuestAddress) {
    const { image, runner, context, instructionBudget } = options;
    if (image.abi.pointerBytes !== 4) throw new Error("The Q3 1.32 native profile requires i386; later intptr_t profiles need their own declared ABI");
    const entry = nativeQ3Export(image, "dllEntry"), main = nativeQ3Export(image, "vmMain");
    if (entry === null || main === null) throw new Error("Q3 1.32 native module requires dllEntry and vmMain exports");
    this.vmMain = main;
    runner.invoke({ target: entry, signature: nativeQ3Signature(image.abi, ["pointer"], "void"),
      arguments: [{ kind: "pointer", value: syscall }], context, instructionBudget });
  }
  call(command: number, arguments_: readonly number[] = []): number {
    if (arguments_.length > 12) throw new RangeError("Q3 vmMain accepts at most twelve arguments");
    const { image, runner, context, instructionBudget } = this.options;
    const args: GuestCallValue[] = [command, ...arguments_, ...new Array<number>(12 - arguments_.length).fill(0)].map(value => ({ kind: "int32", value }));
    const result = runner.invoke({ target: this.vmMain, signature: nativeQ3Signature(image.abi, new Array<GuestStorage>(13).fill("int32"), "int32"),
      arguments: args, context: { ...context, callback: { kind: "native-guest", module: image.module, address: this.vmMain, abi: image.abi } }, instructionBudget });
    if (result.kind !== "int32") throw new TypeError("Q3 vmMain returned the wrong ABI type");
    return result.value;
  }
}
