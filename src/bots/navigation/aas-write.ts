// AAS_WriteAASFile, id Software GPL-2.0-or-later; shared immutable asset output.
import { BinaryWriter } from "../../core/binary/index.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { parseAas, type AasAsset } from "./aas.ts";
function vector(writer: BinaryWriter, value: Vec3): void { writer.f32(value.x); writer.f32(value.y); writer.f32(value.z); }
export function writeAas(world: AasAsset): Uint8Array {
  const lumps: Uint8Array[] = [], header = new BinaryWriter(124);
  header.i32(0x53414145); header.i32(5); header.i32(world.bspChecksum);
  let offset = 124;
  const writeAasLump = <T>(records: readonly T[], stride: number, encode: (writer: BinaryWriter, record: T) => void): void => {
    const writer = new BinaryWriter(records.length * stride);
    for (const record of records) encode(writer, record);
    const bytes = writer.finish(); header.i32(offset); header.i32(bytes.length); offset += bytes.length; lumps.push(bytes);
  };
  writeAasLump(world.bboxes, 32, (writer, box) => {
    writer.i32(box.presence); writer.i32(box.flags);
    vector(writer, box.bounds.min); vector(writer, box.bounds.max);
  });
  writeAasLump(world.vertices, 12, vector);
  writeAasLump(world.planes, 20, (writer, plane) => {
    vector(writer, plane.normal); writer.f32(plane.distance); writer.i32(plane.type);
  });
  writeAasLump(world.edges, 8, (writer, edge) => {
    writer.i32(edge.vertices[0]); writer.i32(edge.vertices[1]);
  });
  writeAasLump(world.edgeIndexes, 4, (writer, value) => writer.i32(value));
  writeAasLump(world.faces, 24, (writer, face) => {
    writer.i32(face.plane); writer.i32(face.flags); writer.i32(face.edgeCount);
    writer.i32(face.firstEdge); writer.i32(face.frontArea); writer.i32(face.backArea);
  });
  writeAasLump(world.faceIndexes, 4, (writer, value) => writer.i32(value));
  writeAasLump(world.areas, 48, (writer, area) => {
    writer.i32(area.number); writer.i32(area.faceCount); writer.i32(area.firstFace);
    vector(writer, area.bounds.min); vector(writer, area.bounds.max); vector(writer, area.center);
  });
  writeAasLump(world.settings, 28, (writer, settings) => {
    writer.i32(settings.contents); writer.i32(settings.flags); writer.i32(settings.presence);
    writer.i32(settings.cluster); writer.i32(settings.clusterArea);
    writer.i32(settings.reachCount); writer.i32(settings.firstReach);
  });
  writeAasLump(world.reachability, 44, (writer, reachability) => {
    writer.i32(reachability.area); writer.i32(reachability.face); writer.i32(reachability.edge);
    vector(writer, reachability.start); vector(writer, reachability.end);
    writer.i32(reachability.travelType); writer.u16(reachability.travelTime);
    writer.u16(reachability.padding);
  });
  writeAasLump(world.nodes, 12, (writer, node) => {
    writer.i32(node.plane); writer.i32(node.children[0]); writer.i32(node.children[1]);
  });
  writeAasLump(world.portals, 20, (writer, portal) => {
    writer.i32(portal.area); writer.i32(portal.frontCluster); writer.i32(portal.backCluster);
    writer.i32(portal.clusterAreas[0]); writer.i32(portal.clusterAreas[1]);
  });
  writeAasLump(world.portalIndexes, 4, (writer, value) => writer.i32(value));
  writeAasLump(world.clusters, 16, (writer, cluster) => {
    writer.i32(cluster.areaCount); writer.i32(cluster.reachabilityAreaCount);
    writer.i32(cluster.portalCount); writer.i32(cluster.firstPortal);
  });
  const bytes = header.finish();
  for (let index = 8; index < bytes.length; index++) {
    const value = bytes[index];
    if (value === undefined) throw new Error("Missing AAS header byte");
    bytes[index] = value ^ ((index - 8) * 119 & 255);
  }
  const result = new BinaryWriter(offset); result.bytes(bytes);
  for (const lump of lumps) result.bytes(lump);
  const output = result.finish();
  parseAas(output, world.source, world.bspChecksum);
  return output;
}
