/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1Map } from "../../../formats/q1-map/index.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import type { Q1Presentation } from "./types.ts";
import { vadd, vsub } from "./types.ts";
import { linkDoors } from "./spawns.ts";
import { Q1EntityServices } from "./entity-services.ts";
export { ammoItem } from "./entity-services.ts";

export interface Q1SpawnReport {
  readonly spawned: readonly Q1Presentation[];
  readonly inhibited: readonly { readonly ordinal: number; readonly classname: string; readonly reason: string }[];
  readonly compilerOnly: readonly { readonly ordinal: number; readonly classname: string }[];
}

/** Map admission adds authored geometry and inhibition to the shared Q1 entity services. */
export class Q1Foundation extends Q1EntityServices {
  spawnMap(map: Q1Map): Q1SpawnReport {
    if (this.entities.size > 0) throw new Error("Q1 map entities already spawned");
    this.mapName = map.source.replace(/^.*[/\\]/u, "").replace(/\.bsp$/u, "");
    this.precaches.beginWorld(`maps/${this.mapName}.bsp`, map.models.length - 1);
    this.nextDynamicSlot = (this.options.maxClients ?? 0) + map.entityList.length;
    const inhibited: { ordinal: number; classname: string; reason: string }[] = [];
    const compilerOnly: { ordinal: number; classname: string }[] = [];
    for (const [ordinal, source] of map.entityList.entries()) {
      const classname = q1EntityValue(source, "classname") ?? "";
      const flags = Number(q1EntityValue(source, "spawnflags") ?? 0);
      const reason = this.inhibit(classname, flags);
      if (reason !== null) { inhibited.push({ ordinal, classname, reason }); continue; }
      // info_null is explicitly removed by misc.qc after the compiler uses its lighting target.
      if (classname === "info_null") { compilerOnly.push({ ordinal, classname }); continue; }
      const actor = this.create(classname, source, ordinal);
      const body = this.body(actor);
      if (actor.model.startsWith("*")) {
        const modelIndex = Number(actor.model.slice(1)); const model = map.models[modelIndex];
        if (model === undefined) throw new Error(`Missing inline model ${actor.model}`);
        // Mod_LoadBrushModel expands each authored bound by one; QC self.size includes that expansion.
        this.host.bodies.write(actor.actor, { ...body, bounds: { min: vsub(model.bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(model.bounds.max, { x: 1, y: 1, z: 1 }) } });
      }
      this.spawnEntity(actor);
    }
    linkDoors(this);
    this.precaches.freeze();
    return { spawned: this.presentations(), inhibited, compilerOnly };
  }
  private inhibit(classname: string, flags: number): string | null {
    if (this.options.deathmatch !== 0 && ((flags & 2048) !== 0 || classname.startsWith("monster_"))) return "deathmatch";
    if (this.options.deathmatch === 0) {
      const bit = this.options.skill === 0 ? 256 : this.options.skill === 1 ? 512 : 1024;
      if ((flags & bit) !== 0) return `skill-${this.options.skill}`;
    }
    return null;
  }
}
