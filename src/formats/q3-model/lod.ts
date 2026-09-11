/* MD3 LOD registration order from Q3 renderer/tr_model.c. GPL-2.0-or-later. */
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { parseMd3 } from "./md3.ts";
import type { Md3Model } from "./md3.ts";

export type Md3LodSlot = { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "loaded"; readonly path: string; readonly model: Md3Model; readonly bytes: Uint8Array }
  | { readonly kind: "invalid"; readonly path: string; readonly error: string }
  | { readonly kind: "alias"; readonly path: string; readonly sourceSlot: number };

export interface Md3LodModel {
  readonly path: string;
  readonly slots: readonly [Md3LodSlot, Md3LodSlot, Md3LodSlot];
  readonly loadOrder: readonly number[];
  readonly numLods: number;
  readonly byteLength: number;
}

export interface Md3ModelReader { read(path: string): Promise<Uint8Array | null>; }

export function md3LodPaths(path: string): readonly [string, string, string] {
  const dot = path.lastIndexOf(".");
  const stem = dot < 0 ? path : path.slice(0, dot);
  return [path, `${stem}_1.md3`, `${stem}_2.md3`];
}

/** Missing files keep their independent slots. A failed nonzero LOD aliases only lower slots. */
export async function loadMd3Lods(path: string, reader: Md3ModelReader): Promise<Md3LodModel | null> {
  const paths = md3LodPaths(path);
  const slots: [Md3LodSlot, Md3LodSlot, Md3LodSlot] = [
    { kind: "missing", path: paths[0] }, { kind: "missing", path: paths[1] }, { kind: "missing", path: paths[2] },
  ];
  const loadOrder: number[] = [];
  let numLods = 0;
  let byteLength = 0;
  for (let lod = 2; lod >= 0; lod--) {
    const filename = paths[lod];
    if (filename === undefined) throw new RangeError("Invalid MD3 LOD slot");
    const bytes = await reader.read(filename);
    if (bytes === null) continue;
    loadOrder.push(lod);
    try {
      // Unknown dispatch IDs abort registration before the nonzero-LOD fallback.
      if (new BinaryReader(bytes, filename).u32() !== 0x33504449) return null;
      const model = parseMd3(bytes, filename);
      slots[lod] = { kind: "loaded", path: filename, model, bytes: model.bytes };
      byteLength += model.byteLength;
      numLods++;
    } catch (error) {
      if (!(error instanceof BinaryError)) throw error;
      if (lod === 0) return null;
      slots[lod] = { kind: "invalid", path: filename, error: error.message };
      if (numLods === 0) return null;
      for (let lower = lod - 1; lower >= 0; lower--) {
        const lowerPath = paths[lower];
        if (lowerPath === undefined) throw new RangeError("Invalid MD3 LOD slot");
        slots[lower] = { kind: "alias", path: lowerPath, sourceSlot: lower + 1 };
        numLods++;
      }
      break;
    }
  }
  return numLods === 0 ? null : { path, slots, loadOrder, numLods, byteLength };
}

export function md3AtLod(model: Md3LodModel, lod: number): Md3Model | null {
  if (!Number.isInteger(lod) || lod < 0 || lod > 2) throw new RangeError("MD3 LOD must be 0..2");
  const slot = model.slots[lod];
  if (slot === undefined) return null;
  switch (slot.kind) {
    case "loaded": return slot.model;
    case "alias": return md3AtLod(model, slot.sourceSlot);
    case "missing": case "invalid": return null;
  }
}
