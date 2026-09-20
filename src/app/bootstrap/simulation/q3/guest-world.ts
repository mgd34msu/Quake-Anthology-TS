import { SaveReader } from '../../../../persistence/value.ts';
import type { SharedSceneQueries } from '../../../../world/collision/index.ts';

export type Q3GuestTopology = Pick<SharedSceneQueries, 'geometry' | 'adjustAreaPortalState' | 'adjustAreaPortalContribution' | 'nativeQ3ClipModels'>;

/** Q3 area-pair references resolve against the selected world's real portal ownership. */
export class Q3GuestWorld {
  private readonly references = new Map<string, number>();
  constructor(readonly scene: Q3GuestTopology) {}
  adjustAreaPortalState(first: number, second: number, open: boolean): void {
    if (first < 0 || second < 0 || first === second) return;
    const geometry = this.scene.geometry;
    if (geometry.kind === 'q1-bsp') return; // Quake BSP visibility has no area-portal graph.
    const key = `${Math.min(first, second)}:${Math.max(first, second)}`, previous = this.references.get(key) ?? 0;
    const count = previous + (open ? 1 : -1);
    if (count < 0) throw new Error('Guest area portal reference underflow');
    if (geometry.kind === 'q3-bsp') {
      this.scene.adjustAreaPortalState(first, second, open); this.references.set(key, count); return;
    }
    const area = geometry.areas[first];
    if (area === undefined || geometry.areas[second] === undefined) throw new RangeError('Guest area pair is outside the selected map');
    this.references.set(key, count);
    for (let index = area.portals.first; index < area.portals.first + area.portals.count; index++) {
      const portal = geometry.areaPortals[index];
      if (portal?.otherArea === second) this.scene.adjustAreaPortalContribution(portal.portal, open ? 1 : -1);
    }
  }
  capturePortalCheckpoint(): unknown {
    return { kind: this.scene.geometry.kind, references: [...this.references].map(([pair, count]) => ({ pair, count })) };
  }
  close(): void {
    for (const [pair, count] of [...this.references]) {
      const [first, second] = pair.split(':').map(Number);
      if (first === undefined || second === undefined) throw new Error('Invalid retained portal pair');
      for (let index = 0; index < count; index++) this.adjustAreaPortalState(first, second, false);
    }
    this.references.clear();
  }
  restorePortalCheckpoint(value: unknown): void {
    const reader = new SaveReader(value, 'q3.guest.foreign-portals');
    const native = this.scene.nativeQ3ClipModels();
    if (reader.field('kind').value === undefined && native !== null) {
      this.close(); native.world.restorePortalCheckpoint(value);
      const areas = reader.field('areas').list(area => area).length, portals = reader.field('portals').list(portal => portal.integer(0));
      for (let first = 0; first < areas; first++) for (let second = first + 1; second < areas; second++) {
        const count = portals[first * areas + second] ?? 0; if (count > 0) this.references.set(`${first}:${second}`, count);
      }
      return;
    }
    reader.field('kind').literal(this.scene.geometry.kind);
    const pairs = new Set<string>();
    const entries = reader.field('references').list(cell => ({ pair: cell.field('pair').string(), count: cell.field('count').integer(0) })).map(entry => {
      const match = /^(\d+):(\d+)$/.exec(entry.pair);
      if (match === null || pairs.has(entry.pair)) throw new Error('Invalid guest portal reference');
      pairs.add(entry.pair);
      const first = Number(match[1]), second = Number(match[2]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first >= second) throw new Error('Invalid guest portal pair');
      const geometry = this.scene.geometry;
      if (geometry.kind === 'q1-bsp' || geometry.kind === 'q2-bsp' && (geometry.areas[first] === undefined || geometry.areas[second] === undefined))
        throw new Error('Guest portal checkpoint belongs to another area table');
      return { ...entry, first, second };
    });
    this.close();
    for (const { pair, count, first, second } of entries) {
      for (let index = 0; index < count; index++) this.adjustAreaPortalState(first, second, true);
      if (count === 0) this.references.set(pair, 0);
    }
  }
}
