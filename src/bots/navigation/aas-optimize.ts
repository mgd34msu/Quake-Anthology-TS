// AAS_Optimize from id Software be_aas_optimize.c; GPL-2.0-or-later.
import type { AasAsset } from "./aas.ts";
import type { Vec3 } from "../../contracts/math.ts";
function at<T>(values: readonly T[], index: number): T {
  const value = values[index]; if (value === undefined) throw new RangeError(`AAS optimization index ${index}`); return value;
}
/** Source ladder-only geometry compaction; source arrays and routing metadata remain immutable. */
export function optimizeAas(asset: AasAsset): AasAsset {
  const vertices: Vec3[] = [], edges: AasAsset["edges"][number][] = [{ vertices: [0, 0] }];
  const faces: AasAsset["faces"][number][] = [{ plane: 0, flags: 0, edgeCount: 0, firstEdge: 0, frontArea: 0, backArea: 0 }];
  const edgeIndexes: number[] = [], faceIndexes: number[] = [];
  const vertexMap = new Map<number, number>(), edgeMap = new Map<number, number>(), faceMap = new Map<number, number>();
  const vertex = (number: number): number => {
    const mapped = vertexMap.get(number) ?? 0;
    // Preserve source zero sentinel behavior, including duplication of output vertex zero.
    if (mapped !== 0) return mapped;
    const result = vertices.length; vertices.push({ ...at(asset.vertices, number) }); vertexMap.set(number, result); return result;
  };
  const edge = (number: number): number => {
    const source = at(asset.edges, Math.abs(number));
    let result = edgeMap.get(Math.abs(number));
    if (result === undefined) {
      result = edges.length; edges.push({ vertices: [vertex(source.vertices[0]), vertex(source.vertices[1])] }); edgeMap.set(Math.abs(number), result);
    }
    return number > 0 ? result : -result;
  };
  const face = (number: number): number => {
    const source = at(asset.faces, Math.abs(number));
    if ((source.flags & 2) === 0) return 0;
    let result = faceMap.get(Math.abs(number));
    if (result === undefined) {
      const firstEdge = edgeIndexes.length;
      for (let index = 0; index < source.edgeCount; index++) edgeIndexes.push(edge(at(asset.edgeIndexes, source.firstEdge + index)));
      result = faces.length; faces.push({ ...source, firstEdge, edgeCount: edgeIndexes.length - firstEdge }); faceMap.set(Math.abs(number), result);
    }
    return number > 0 ? result : -result;
  };
  const areas = asset.areas.map((area, number) => {
    if (number === 0) return { number: 0, faceCount: 0, firstFace: 0,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, center: { x: 0, y: 0, z: 0 } };
    const firstFace = faceIndexes.length;
    for (let index = 0; index < area.faceCount; index++) { const mapped = face(at(asset.faceIndexes, area.firstFace + index)); if (mapped !== 0) faceIndexes.push(mapped); }
    return { ...area, firstFace, faceCount: faceIndexes.length - firstFace };
  });
  const remap = (number: number, map: ReadonlyMap<number, number>): number => (number < 0 ? -1 : 1) * (map.get(Math.abs(number)) ?? 0);
  const reachability = asset.reachability.map(reach => {
    const travel = reach.travelType & 0xffffff;
    return travel === 11 || travel === 18 || travel === 19 ? { ...reach }
      : { ...reach, face: remap(reach.face, faceMap), edge: remap(reach.edge, edgeMap) };
  });
  return { ...asset, lumps: [], vertices, edges, edgeIndexes, faces, faceIndexes, areas, reachability };
}
