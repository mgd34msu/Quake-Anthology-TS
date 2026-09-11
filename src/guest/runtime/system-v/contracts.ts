// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage } from "../../../contracts/execution.ts";
import type { GuestCallRunner } from "../../abi/index.ts";
import type { GuestCallbackTable, MappedGuestMemory } from "../../core/index.ts";

export interface SystemVCapabilities {
  readonly nowSeconds?: () => bigint;
  readonly standardInput?: (maximumBytes: number) => Uint8Array;
  readonly standardOutput?: (stream: "stdout" | "stderr", bytes: Uint8Array) => number;
  readonly standardFlush?: (stream: "stdout" | "stderr") => number;
  readonly outputIsTerminal?: boolean;
}
export interface SystemVRuntimeOptions {
  readonly memory: MappedGuestMemory;
  readonly callbacks: GuestCallbackTable;
  readonly capabilities?: SystemVCapabilities;
  readonly argv?: readonly string[];
  readonly environment?: readonly string[];
}
export interface SystemVImportCoverage {
  readonly library: string;
  readonly name: string;
  readonly version: string | null;
  readonly support: "implemented" | "unsupported-function" | "unsupported-data";
  readonly reached: number;
}
export interface SystemVInitializeOptions { readonly context: GuestCallContext; readonly instructionBudget: number; }
export type SystemVImplementation = (context: GuestCallContext, args: readonly GuestCallValue[]) => GuestCallResult;
export interface SystemVServiceHost {
  readonly memory: MappedGuestMemory;
  readonly capabilities: SystemVCapabilities;
  readonly pointerStorage: "uint32" | "uint64";
  readonly signedPointerStorage: "int32" | "int64";
  readonly runner: GuestCallRunner;
  readonly emptyStringRepresentation: GuestAddress;
  readonly threadPointer: GuestAddress;
  readonly errnoAddress: GuestAddress;
  errno: number;
  service(library: string, name: string, versions: readonly (string | null)[], parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: SystemVImplementation): void;
  data(library: string, name: string, version: string | null, address: GuestAddress, byteLength: number): void;
  resolveAddress(library: string, name: string, version: string | null): GuestAddress | null;
  unavailable(library: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", detail: string): GuestAddress;
  allocate(size: number): GuestAddress;
  free(address: GuestAddress | null): void;
  allocationSize(address: GuestAddress): number | null;
  invoke(context: GuestCallContext, target: GuestAddress, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult;
  registerDestructor(target: GuestAddress, argument: GuestAddress | null, dso: GuestAddress | null): void;
  finalizeDestructors(context: GuestCallContext, dso: GuestAddress | null): void;
  tlsAddress(moduleId: bigint, offset: bigint): GuestAddress;
}
export class UnsupportedSystemVService extends Error {
  constructor(readonly library: string, readonly symbol: string, readonly version: string | null, readonly context: GuestCallContext, readonly detail: string) {
    super(`Unsupported System V guest service ${library}:${symbol}${version === null ? "" : `@${version}`}: ${detail}`);
    this.name = "UnsupportedSystemVService";
  }
}
