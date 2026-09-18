// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage } from "../../../contracts/execution.ts";
import type { GuestCallRunner } from "../../abi/index.ts";
import type { GuestCallbackTable, GuestCallSignature, MappedGuestMemory } from "../../core/index.ts";
import type { PeImage } from "../../pe/index.ts";

export interface WindowsFile {
  read(offset: number, length: number): Uint8Array;
  write(offset: number, bytes: Uint8Array): number;
  size(): number;
  truncate(length: number): void;
  flush(): void;
  close(): void;
}
export interface WindowsCapabilities {
  readonly nowMilliseconds?: () => number;
  readonly performanceCounter?: () => bigint;
  readonly performanceFrequency?: bigint;
  readonly commandLine?: string;
  readonly environment?: ReadonlyMap<string, string>;
  readonly openFile?: (path: string, options: { readonly read: boolean; readonly write: boolean; readonly creation: number }) => WindowsFile | null;
  readonly standardOutput?: (stream: "stdout" | "stderr", bytes: Uint8Array) => void;
  readonly standardInput?: (length: number) => Uint8Array;
}
export interface WindowsRuntimeOptions {
  readonly memory: MappedGuestMemory;
  readonly callbacks: GuestCallbackTable;
  readonly capabilities?: WindowsCapabilities;
  readonly processId?: number;
  readonly threadId?: number;
}
export interface WindowsImportCoverage { readonly library: string; readonly name: string; readonly supported: boolean; readonly reached: number; readonly failed: number; readonly lastFailure: string | null; }
export interface WindowsInitializeOptions { readonly context: GuestCallContext; readonly instructionBudget: number; }
export type WindowsImportImplementation = (context: GuestCallContext, args: readonly GuestCallValue[]) => GuestCallResult;
export interface WindowsServiceHost {
  readonly memory: MappedGuestMemory;
  readonly capabilities: WindowsCapabilities;
  readonly pointerStorage: "uint32" | "uint64";
  readonly runner: GuestCallRunner;
  readonly images: readonly PeImage[];
  readonly teb: GuestAddress;
  readonly processId: number;
  readonly threadId: number;
  lastError: number;
  register(library: string, name: string, signature: GuestCallSignature, invoke: WindowsImportImplementation): void;
  service(library: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: WindowsImportImplementation): void;
  allocate(size: number, heap?: bigint): GuestAddress | null;
  free(address: GuestAddress | null, heap?: bigint): boolean;
  allocationSize(address: GuestAddress, heap?: bigint): number | null;
  destroyHeap(heap: bigint): void;
  invoke(context: GuestCallContext, target: GuestAddress, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[], convention?: "system"): GuestCallResult;
  resolveAddress(library: string, name: string): GuestAddress | null;
  libraryHandle(library: string): GuestAddress | null;
  loadLibrary(library: string): GuestAddress | null;
  freeLibrary(handle: GuestAddress): boolean;
  libraryName(handle: GuestAddress): string | null;
}
export class UnsupportedWindowsImport extends Error {
  constructor(readonly library: string, readonly symbol: string, readonly context: GuestCallContext, readonly detail = "runtime service is not implemented") {
    super(`Unsupported Windows guest import ${library}!${symbol}: ${detail}`);
    this.name = "UnsupportedWindowsImport";
  }
}
