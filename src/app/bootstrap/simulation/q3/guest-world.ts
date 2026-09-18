import { SaveReader } from '../../../../persistence/value.ts';
import type { SharedSceneQueries } from '../../../../world/collision/index.ts';

/** Q3 area-pair references resolve against the selected world's real portal ownership. */
export class Q3GuestWorld {
  private readonly references = new Map<string, number>();
  constructor(readonly scene: SharedSceneQueries) {}
  adjustAreaPortalState(first: number, second: number, open: boolean): void {
    if (first < 0 || second < 0 || first === second) return;
    const geometry = this.scene.geometry;
    if (geometry.kind === 'q3-bsp') { this.scene.adjustAreaPortalState(first, second, open); return; }
    if (geometry.kind === 'q1-bsp') return; // Quake BSP visibility has no area-portal graph.
    const area = geometry.areas[first];
    if (area === undefined || geometry.areas[second] === undefined) throw new RangeError('Guest area pair is outside the selected map');
    const key = `${Math.min(first, second)}:${Math.max(first, second)}`, previous = this.references.get(key) ?? 0;
    const count = previous + (open ? 1 : -1);
    if (count < 0) throw new Error('Guest area portal reference underflow');
    this.references.set(key, count);
    for (let index = area.portals.first; index < area.portals.first + area.portals.count; index++) {
      const portal = geometry.areaPortals[index];
      if (portal?.otherArea === second) this.scene.setAreaPortalState(portal.portal, count > 0);
    }
  }
  capturePortalCheckpoint(): unknown {
    const native = this.scene.nativeQ3ClipModels();
    if (native !== null) return native.world.capturePortalCheckpoint();
    return { kind: this.scene.geometry.kind, references: [...this.references].map(([pair, count]) => ({ pair, count })) };
  }
  restorePortalCheckpoint(value: unknown): void {
    const native = this.scene.nativeQ3ClipModels();
    if (native !== null) { native.world.restorePortalCheckpoint(value); return; }
    const reader = new SaveReader(value, 'q3.guest.foreign-portals'); reader.field('kind').literal(this.scene.geometry.kind);
    this.references.clear();
    if (this.scene.geometry.kind === 'q2-bsp') for (const portal of this.scene.geometry.areaPortals) this.scene.setAreaPortalState(portal.portal, false);
    for (const entry of reader.field('references').list(cell => ({ pair: cell.field('pair').string(), count: cell.field('count').integer(0) }))) {
      const match = /^(\d+):(\d+)$/.exec(entry.pair);
      if (match === null || this.references.has(entry.pair)) throw new Error('Invalid guest portal reference');
      const first = Number(match[1]), second = Number(match[2]);
      for (let count = 0; count < entry.count; count++) this.adjustAreaPortalState(first, second, true);
      if (entry.count === 0) this.references.set(entry.pair, 0);
    }
  }
}
