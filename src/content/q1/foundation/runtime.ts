/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1Entity, Q1Map } from "../../../formats/q1-map/index.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { MonsterDefinitionReference } from "../../../contracts/content.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import type { Q1Presentation } from "./types.ts";
import { vadd, vsub, ZERO, POINT } from "./types.ts";
import { parseVector, sourceAngles } from "./entity.ts";
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
  monsterAdmission: {
    resolve(classname: string, source: Q1Entity): MonsterDefinitionReference | null;
    spawn(actor: OwnedActor, source: Q1Entity, ordinal: number, definition: MonsterDefinitionReference): undefined;
  } | null = null;
  spawnMap(map: Q1Map): Q1SpawnReport {
    if (this.entities.size > 0) throw new Error("Q1 map entities already spawned");
    const replacements = new Map<number, MonsterDefinitionReference>();
    if (this.monsterAdmission !== null) for (const [ordinal, source] of map.entityList.entries()) {
      const classname = q1EntityValue(source, "classname") ?? "";
      if (this.inhibit(classname, Number(q1EntityValue(source, "spawnflags") ?? 0)) !== null) continue;
      const definition = this.monsterAdmission.resolve(classname, source);
      if (definition !== null) replacements.set(ordinal, definition);
    }
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
      const definition = replacements.get(ordinal);
      if (definition != null && this.monsterAdmission !== null) {
        const slot = ordinal === 0 ? 0 : ordinal + (this.options.maxClients ?? 0);
        const actor = this.host.actors.allocateAtSource(this.provider, slot, `${definition.source.provider}/${definition.classname}`);
        this.host.bodies.create(actor, { origin: parseVector(q1EntityValue(source, "origin") ?? ""), angles: sourceAngles(source), velocity: ZERO, bounds: POINT, ground: null });
        this.host.combat.create(actor, { health: 0, armor: { kind: "none" }, mass: 100, canTakeDamage: false, invulnerable: false, team: null });
        this.monsterAdmission.spawn(actor, source, ordinal, definition);
        continue;
      }
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
