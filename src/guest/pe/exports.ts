// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestSymbolName } from "../core/contracts.ts";
import { PeError } from "./format.ts";
import type { PeImage } from "./image.ts";

export interface PeResolvedExport { readonly image: PeImage; readonly address: GuestAddress; }
export type PeLibraryLookup = (library: string, requesting: PeImage) => PeImage | null;

/** Library policy and guest dependency loading belong to the caller; forwarders never load native code. */
export function resolvePeExport(image: PeImage, symbol: GuestSymbolName, lookup: PeLibraryLookup): PeResolvedExport {
  const seen = new Map<PeImage, Set<string>>();
  let current = image;
  let name = symbol;
  for (let depth = 0; depth < 128; depth++) {
    const key = name.kind === "ordinal" ? `ordinal:${name.ordinal}` : `name:${name.name}:${name.version ?? ""}`;
    let names = seen.get(current);
    if (names?.has(key)) throw new PeError("exports", "cyclic export forwarder");
    if (names === undefined) { names = new Set(); seen.set(current, names); }
    names.add(key);
    const requested = name;
    const exported = current.exports.find(entry => entry.symbol.kind === "ordinal"
      ? requested.kind === "ordinal" && entry.symbol.ordinal === requested.ordinal
      : requested.kind === "name" && entry.symbol.name === requested.name && entry.symbol.version === requested.version);
    if (exported === undefined) throw new PeError("exports", `unresolved ${current.module.id} ${key}`);
    if (exported.target.kind === "address") return { image: current, address: exported.target.address };
    const dependency = lookup(exported.target.library, current);
    if (dependency === null) throw new PeError("exports", `unresolved forwarded library ${exported.target.library}`);
    if (dependency.base.addressSpace !== image.base.addressSpace || dependency.abi.pointerBytes !== image.abi.pointerBytes) {
      throw new PeError("exports", "forwarded export belongs to another guest address space or ABI width");
    }
    current = dependency;
    name = exported.target.symbol;
  }
  throw new PeError("exports", "export forwarder chain exceeds 128 entries");
}
