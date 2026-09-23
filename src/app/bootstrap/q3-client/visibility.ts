import type { Bounds } from "../../../contracts/math.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import { EntityStateRecord } from "../../../network/q3/state/entity.ts";
import type { PlayerStateFields } from "../../../network/q3/state/player.ts";
import { selectQ3SnapshotEntities } from "../../../network/q3/visibility.ts";
import type { Q3VisibilityEntity, Q3VisibilityLink, Q3VisibleEntities } from "../../../network/q3/visibility.ts";
import type { EntityStateFields } from "../../../network/q3/state/entity.ts";

type Queries = Pick<SharedSceneQueries, "pointLeaf" | "leafCluster" | "leafArea" | "areaBits" | "boxLeaves" | "clusterVisible" | "areasConnected">;

/** The local transport runs the same Q3 visibility selection as a network snapshot. */
export function selectApplicationQ3Snapshot(player: Pick<PlayerStateFields, "clientNum" | "origin" | "viewheight">,
  source: { readonly entities: readonly { readonly state: EntityStateFields; readonly linked: boolean; readonly serverFlags: number; readonly singleClient: number }[] },
  queries: Queries, bounds: (number: number) => Bounds | null, leafCount: number, print: (text: string) => void): Q3VisibleEntities {
  const entities = new Map<number, Q3VisibilityEntity>(), links = new Map<number, Q3VisibilityLink>();
  let entityCount = 0;
  for (const row of source.entities) {
    const number = row.state.number;
    entityCount = Math.max(entityCount, number + 1);
    const state = new EntityStateRecord<number>(0); state.copyFrom(row.state);
    entities.set(number, { state, linked: row.linked, flags: row.serverFlags, singleClient: row.singleClient });
    if (!row.linked) continue;
    const box = bounds(number);
    if (box === null) throw new Error(`Linked Q3 source entity ${number} lost its shared body bounds`);
    const all = queries.boxLeaves(box, leafCount).leaves, leaves = all.slice(0, 128);
    let areanum = -1, areanum2 = -1;
    for (const leaf of leaves) {
      const area = queries.leafArea(leaf);
      if (area === -1) continue;
      if (areanum !== -1 && areanum !== area) areanum2 = area;
      else areanum = area;
    }
    const clusters: number[] = [];
    let lastCluster = 0;
    for (const leaf of leaves) {
      const cluster = queries.leafCluster(leaf);
      if (cluster === -1) continue;
      clusters.push(cluster);
      if (clusters.length === 16) {
        const lastLeaf = all.at(-1);
        if (lastLeaf !== undefined) lastCluster = queries.leafCluster(lastLeaf);
        break;
      }
    }
    links.set(number, { areanum, areanum2, clusters, lastCluster });
  }
  return selectQ3SnapshotEntities(player, { entityCount, dead: false, print,
    entity: number => {
      const value = entities.get(number);
      if (value !== undefined) return value;
      const state = new EntityStateRecord(0); state.number = number;
      return { state, linked: false, flags: 0, singleClient: 0 };
    },
    link: number => links.get(number),
    collision: {
      pointLeafnum: point => queries.pointLeaf(point), leafArea: leaf => queries.leafArea(leaf), leafCluster: leaf => queries.leafCluster(leaf),
      areasConnected: (first, second) => queries.areasConnected(first, second),
      writeAreaBits: (bytes, area) => {
        const bits = queries.areaBits(area);
        if (bits.length > bytes.length) throw new RangeError("Selected world exceeds source Q3 area mask storage");
        for (const [index, value] of bits.entries()) bytes[index] = (bytes[index] ?? 0) | value;
        return bits.length;
      },
      clusterPVS: from => ({ byteAt: index => {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) if (queries.clusterVisible(from, index * 8 + bit, "pvs")) byte |= 1 << bit;
        return byte;
      } }),
    },
  });
}
