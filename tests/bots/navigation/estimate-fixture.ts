// AAS fixture layout from quake-3-ts/tests/routing.test.ts. SPDX-License-Identifier: GPL-2.0-or-later
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import { parseAas } from "../../../src/bots/navigation/aas.ts";
import { aasTravelMode } from "../../../src/bots/navigation/graph.ts";
import type { NavigationGraph } from "../../../src/bots/navigation/types.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { profile } from "./prediction.ts";
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export interface AreaSpec { readonly cluster?: number; readonly contents?: number; readonly flags?: number; readonly presenceType?: number }
export interface LinkSpec { readonly from: number; readonly to: number; readonly time?: number; readonly type?: number; readonly start?: Vec3; readonly end?: Vec3 }
export interface PortalSpec { readonly area: number; readonly front: number; readonly back: number }

export function aasEstimateFixture(areas: readonly AreaSpec[], links: readonly LinkSpec[], portals: readonly PortalSpec[] = []): Uint8Array {
  const clusters = areas.map(area => area.cluster ?? 1);
  const clusterCount = Math.max(1, ...clusters, ...portals.flatMap(portal => [portal.front, portal.back]));
  const members = Array.from({ length: clusterCount + 1 }, (_, cluster) => areas.map((_, index) => index + 1).filter(area => {
    const direct = clusters[area - 1];
    if (direct === cluster) return true;
    const portal = portals.find(portal => portal.area === area);
    return portal !== undefined && (portal.front === cluster || portal.back === cluster);
  }));
  const grouped = areas.map((_, index) => links.filter(link => link.from === index + 1));
  function encode(size: number, write: (writer: BinaryWriter) => void): Uint8Array {
    const writer = new BinaryWriter(size); write(writer); return writer.finish();
  }
  function vector(writer: BinaryWriter, value: Vec3): void { writer.f32(value.x); writer.f32(value.y); writer.f32(value.z); }
  const lumps: Uint8Array[] = Array.from({ length: 14 }, () => new Uint8Array(0));
  lumps[2] = encode(20, writer => { vector(writer, { x: 1, y: 0, z: 0 }); writer.f32(0); writer.i32(0); });
  lumps[7] = encode((areas.length + 1) * 48, writer => {
    for (let area = 0; area <= areas.length; area++) {
      writer.i32(area); writer.i32(0); writer.i32(0);
      vector(writer, ZERO); vector(writer, { x: 1, y: 1, z: 1 }); vector(writer, ZERO);
    }
  });
  lumps[8] = encode((areas.length + 1) * 28, writer => {
    for (let i = 0; i < 7; i++) writer.i32(0);
    let first = 1;
    for (const [index, area] of areas.entries()) {
      const cluster = clusters[index];
      const outgoing = grouped[index];
      if (cluster === undefined || outgoing === undefined) throw new Error("invalid fixture area");
      const clusterMembers = members[cluster];
      writer.i32(area.contents ?? 0); writer.i32(area.flags ?? 1); writer.i32(area.presenceType ?? 2);
      writer.i32(cluster); writer.i32(cluster > 0 && clusterMembers !== undefined ? clusterMembers.indexOf(index + 1) : 0);
      writer.i32(outgoing.length); writer.i32(first); first += outgoing.length;
    }
  });
  lumps[9] = encode((links.length + 1) * 44, writer => {
    writer.bytes(new Uint8Array(44));
    for (const outgoing of grouped) for (const link of outgoing) {
      writer.i32(link.to); writer.i32(0); writer.i32(0);
      vector(writer, link.start ?? ZERO); vector(writer, link.end ?? ZERO);
      writer.i32(link.type ?? 2); writer.u16(link.time ?? 10); writer.u16(0);
    }
  });
  lumps[10] = encode(24, writer => { for (let i = 0; i < 6; i++) writer.i32(0); });
  lumps[11] = encode((portals.length + 1) * 20, writer => {
    writer.bytes(new Uint8Array(20));
    for (const portal of portals) {
      const front = members[portal.front]; const back = members[portal.back];
      if (front === undefined || back === undefined) throw new Error("invalid fixture portal");
      writer.i32(portal.area); writer.i32(portal.front); writer.i32(portal.back);
      writer.i32(front.indexOf(portal.area)); writer.i32(back.indexOf(portal.area));
    }
  });
  const portalLists = members.map((_, cluster) => portals.flatMap((portal, index) => portal.front === cluster || portal.back === cluster ? [index + 1] : []));
  lumps[12] = encode(portalLists.flat().length * 4, writer => { for (const list of portalLists) for (const portal of list) writer.i32(portal); });
  lumps[13] = encode(members.length * 16, writer => {
    let first = 0;
    for (const [cluster, areas] of members.entries()) {
      const list = portalLists[cluster]; if (list === undefined) throw new Error("missing fixture portal list");
      writer.i32(areas.length); writer.i32(areas.length); writer.i32(list.length); writer.i32(first); first += list.length;
    }
  });
  const output = new BinaryWriter(124 + lumps.reduce((size, lump) => size + lump.length, 0));
  output.u32(0x53414145); output.i32(4); output.i32(0);
  let offset = 124;
  for (const lump of lumps) { output.i32(offset); output.i32(lump.length); offset += lump.length; }
  for (const lump of lumps) output.bytes(lump);
  return output.finish();
}

export function estimateGraph(bytes: Uint8Array): NavigationGraph {
  const asset = parseAas(bytes);
  return { map: { name: "estimate-fixture", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) }, profile,
    asset, clusters: [], rejected: [], nodes: asset.areas.slice(1).map(area => {
      const settings = asset.settings[area.number];
      if (settings === undefined) throw new Error("Missing fixture area settings");
      return { id: area.number, origin: area.center, bounds: area.bounds, radius: 0, contents: settings.contents, flags: settings.flags,
        presence: settings.presence, sourceCluster: settings.cluster, source: { kind: "aas", area: area.number, reachability: null } };
    }), edges: asset.settings.flatMap((settings, area) => Array.from({ length: settings.reachCount }, (_, offset) => {
      const id = settings.firstReach + offset, reach = asset.reachability[id];
      if (reach === undefined) throw new Error("Missing fixture reachability");
      return { id, from: area, to: reach.area, mode: aasTravelMode(reach.travelType), start: reach.start, end: reach.end,
        travelSeconds: Math.max(1, reach.travelTime) / 100, sourceTravelType: reach.travelType, sourceFlags: 0,
        hint: null, entity: null, source: { kind: "aas", area, reachability: id } };
    })) };
}
