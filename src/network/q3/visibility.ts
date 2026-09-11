// SV_AddEntitiesVisibleFromPoint and SV_BuildClientSnapshot, sv_snapshot.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Vec3 } from "../../contracts/math.ts";
import { dot3, sub3 } from "../../core/math.ts";
import { CommonError } from "../../core/common-error.ts";
import type { EntityStateFields } from "./state/entity.ts";
import type { PlayerStateFields } from "./state/player.ts";

export enum Q3ServerEntityFlags {
  NoClient = 1, ClientMask = 2, Bot = 8, Broadcast = 32, Portal = 64,
  UseCurrentOrigin = 128, SingleClient = 256, NoServerInfo = 512, NotSingleClient = 2048,
}
export interface Q3VisibilityEntity {
  readonly state: EntityStateFields;
  readonly linked: boolean;
  readonly flags: number;
  readonly singleClient: number;
}
export interface Q3VisibilityLink {
  readonly areanum: number; readonly areanum2: number;
  readonly clusters: readonly number[]; readonly lastCluster: number;
}
/** The real collision world implements these queries; link records come from link-time state. */
export interface Q3VisibilityWorld {
  pointLeafnum(point: Vec3): number;
  leafArea(leaf: number): number;
  leafCluster(leaf: number): number;
  writeAreaBits(bytes: Uint8Array, area: number): number;
  clusterPVS(cluster: number): { byteAt(index: number): number };
  areasConnected(first: number, second: number): boolean;
}
export interface Q3VisibilityBindings {
  readonly collision: Q3VisibilityWorld;
  readonly entityCount: number;
  readonly dead: boolean;
  entity(number: number): Q3VisibilityEntity;
  link(number: number): Q3VisibilityLink | undefined;
  print(text: string): void;
}
export interface Q3VisibleEntities { readonly areaMask: Uint8Array; readonly entities: readonly EntityStateFields[]; }

export function selectQ3SnapshotEntities(player: Readonly<Pick<PlayerStateFields, "clientNum" | "origin" | "viewheight">>, host: Q3VisibilityBindings): Q3VisibleEntities {
  if (!Number.isInteger(player.clientNum) || player.clientNum < 0 || player.clientNum >= 1024) throw new CommonError("drop", "SV_SvEntityForGentity: bad gEnt");
  const selected: number[] = [], visited = new Set<number>([player.clientNum]), areaBits = new Uint8Array(32);
  let areaBytes = 0;
  function add(number: number): void {
    if (visited.has(number)) return;
    visited.add(number);
    if (selected.length === 256) return;
    if (number < 0 || number >= 1024) throw new RangeError("Server snapshot entity outside source storage");
    selected.push(number);
  }
  function visibleFrom(origin: Vec3): void {
    if (host.dead) return;
    const collision = host.collision, leaf = collision.pointLeafnum(origin), area = collision.leafArea(leaf);
    areaBytes = collision.writeAreaBits(areaBits, area);
    const pvs = collision.clusterPVS(collision.leafCluster(leaf));
    const visible = (cluster: number): boolean => (pvs.byteAt(cluster >> 3) & (1 << (cluster & 7))) !== 0;
    for (let number = 0; number < host.entityCount; number++) {
      const entity = host.entity(number), state = entity.state, flags = entity.flags;
      if (!entity.linked) continue;
      if (state.number !== number) { host.print("FIXING ENT->S.NUMBER!!!\n"); state.number = number; }
      if (flags & Q3ServerEntityFlags.NoClient) continue;
      if ((flags & Q3ServerEntityFlags.SingleClient) && entity.singleClient !== player.clientNum) continue;
      if ((flags & Q3ServerEntityFlags.NotSingleClient) && entity.singleClient === player.clientNum) continue;
      if (flags & Q3ServerEntityFlags.ClientMask) {
        if (player.clientNum >= 32) throw new CommonError("drop", "SVF_CLIENTMASK: cientNum > 32\n");
        if (~entity.singleClient & (1 << player.clientNum)) continue;
      }
      if (visited.has(number)) continue;
      if (flags & Q3ServerEntityFlags.Broadcast) { add(number); continue; }
      const link = host.link(number);
      if (link === undefined || (!collision.areasConnected(area, link.areanum) && !collision.areasConnected(area, link.areanum2)) || link.clusters.length === 0) continue;
      let cluster = 0, index = 0;
      for (; index < link.clusters.length; index++) {
        const value = link.clusters[index];
        if (value === undefined) throw new RangeError("Missing source cluster");
        cluster = value;
        if (visible(cluster)) break;
      }
      if (index === link.clusters.length) {
        if (!link.lastCluster) continue;
        for (; cluster <= link.lastCluster; cluster++) if (visible(cluster)) break;
        // Original source compares equality here, including overflow-cluster behavior.
        if (cluster === link.lastCluster) continue;
      }
      add(number);
      if (flags & Q3ServerEntityFlags.Portal) {
        if (state.generic1) {
          const delta = sub3(state.origin, origin), distance = Math.fround(Math.fround(state.generic1) * Math.fround(state.generic1));
          if (dot3(delta, delta) > distance) continue;
        }
        visibleFrom(state.origin2);
      }
    }
  }
  visibleFrom({ x: player.origin.x, y: player.origin.y, z: Math.fround(player.origin.z + Math.fround(player.viewheight)) });
  selected.sort((left, right) => left - right);
  if (areaBytes < 0 || areaBytes > 32) throw new RangeError("Source area bits exceed 32 bytes");
  for (let index = 0; index < 32; index++) areaBits[index] = (areaBits[index] ?? 0) ^ 255;
  return { areaMask: areaBits.slice(0, areaBytes), entities: selected.map(number => host.entity(number).state) };
}
