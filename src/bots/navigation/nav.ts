// NAV2 layout: quake-1-re-ts/src/lib/nav.ts (retail-derived v12-v18).
// NAV3 layout: q2repro/src/server/nav.c, inc/server/nav.h; quake-2-re-ts/src/server/nav.ts.
// Copyright (C) 2003-2006 Andrey Nazarov. SPDX-License-Identifier: GPL-2.0-or-later
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { TraversalHint } from "./types.ts";

export interface KexNavigationAsset {
  readonly kind: "nav2" | "nav3"; readonly source: string; readonly version: number; readonly heuristic: number;
  readonly nodes: readonly { readonly flags: number; readonly firstLink: number; readonly linkCount: number; readonly radius: number; readonly origin: Vec3 }[];
  readonly links: readonly { readonly target: number; readonly type: number; readonly flags: number; readonly storedFlags: number; readonly traversal: number | null }[];
  readonly traversals: readonly TraversalHint[];
  readonly entities: readonly { readonly link: number; readonly model: number | null; readonly bounds: Bounds; readonly tail: readonly number[] }[];
}
function vector(r: BinaryReader): Vec3 { return { x: r.finiteF32(), y: r.finiteF32(), z: r.finiteF32() }; }
function count(r: BinaryReader, stride: number): number {
  const offset = r.offset, value = r.i32();
  if (value < 0 || value > r.length / stride) throw new BinaryError(r.source, offset, "invalid navigation record count");
  return value;
}

export function parseKexNavigation(bytes: Uint8Array, source = "<nav>"): KexNavigationAsset {
  const r = new BinaryReader(bytes, source);
  const magic = r.fixedString(4);
  if (magic !== "NAV2" && magic !== "NAV3") throw new BinaryError(source, 0, "expected NAV2 or NAV3");
  const kind = magic === "NAV2" ? "nav2" : "nav3";
  const version = r.i32();
  if (kind === "nav2" ? version < 12 || version > 18 : version < 1 || version > 6) throw new BinaryError(source, 4, `unsupported ${magic} version ${version}`);
  const nodeCount = count(r, 20), linkCount = count(r, 6), traversalCount = count(r, 36);
  const heuristic = kind === "nav3" || version >= 16 ? r.finiteF32() : 1;
  if (heuristic <= 0) throw new BinaryError(source, r.offset - 4, "navigation cost multiplier must be positive");
  const headers: { flags: number; firstLink: number; linkCount: number; radius: number }[] = [];
  for (let index = 0; index < nodeCount; index++) {
    const flags = r.u16(), links = r.u16(), firstLink = r.u16(), radius = r.u16();
    if (firstLink + links > linkCount) throw new BinaryError(source, r.offset - 8, "node link range exceeds table");
    headers.push({ flags, linkCount: links, firstLink, radius });
  }
  const nodes = headers.map(header => ({ ...header, origin: vector(r) }));
  const links: KexNavigationAsset["links"][number][] = [];
  for (let index = 0; index < linkCount; index++) {
    const target = r.u16(), type = r.u8(), storedFlags = r.u8(), traversal = r.u16();
    if (target >= nodeCount || traversal !== 0xffff && traversal >= traversalCount) throw new BinaryError(source, r.offset - 6, "navigation link references missing record");
    // NAV2 v18 flags have unresolved semantics; retain them without applying NAV3's Disabled bit.
    const flags = kind === "nav3" && version < 3 ? 3 : kind === "nav3" && version < 6 ? storedFlags & ~12 : storedFlags;
    links.push({ target, type, flags, storedFlags, traversal: traversal === 0xffff ? null : traversal });
  }
  const traversals: TraversalHint[] = [];
  for (let index = 0; index < traversalCount; index++) traversals.push({ funnel: vector(r), start: vector(r), end: vector(r), ladderPlane: kind === "nav3" && version >= 4 ? vector(r) : null });
  const entityCount = count(r, 26), entities: KexNavigationAsset["entities"][number][] = [];
  for (let index = 0; index < entityCount; index++) {
    const link = r.u16();
    const model = kind === "nav3" ? version >= 2 ? r.i32() : 0 : null;
    const bounds = { min: vector(r), max: vector(r) };
    const tail: number[] = [];
    if (kind === "nav2") for (let word = 0; word < (version <= 12 ? 0 : version <= 14 ? 2 : 1); word++) tail.push(r.i32());
    if (link >= linkCount) throw new BinaryError(source, r.offset, "entity references missing link");
    if (bounds.min.x > bounds.max.x || bounds.min.y > bounds.max.y || bounds.min.z > bounds.max.z) throw new BinaryError(source, r.offset, "inverted entity bounds");
    entities.push({ link, model, bounds, tail });
  }
  if (r.remaining !== 0) throw new BinaryError(source, r.offset, "unconsumed navigation bytes");
  return { kind, source, version, heuristic, nodes, links, traversals, entities };
}
