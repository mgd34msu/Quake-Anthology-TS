/* Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1Entity, Q1Map } from "../../../formats/q1-map/index.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { MonsterDefinitionReference } from "../../../contracts/content.ts";
import type { Bounds } from "../../../contracts/math.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import type { Q1Presentation } from "./types.ts";
import { vadd, vsub, ZERO, POINT } from "./types.ts";
import { parseVector, sourceAngles } from "./entity.ts";
import { linkDoors, UnknownQ1SpawnError } from "./spawns.ts";
import { Q1EntityServices } from "./entity-services.ts";
export { ammoItem } from "./entity-services.ts";

export interface Q1SpawnReport {
  readonly spawned: readonly Q1Presentation[];
  readonly inhibited: readonly { readonly ordinal: number; readonly classname: string; readonly reason: string }[];
  readonly compilerOnly: readonly { readonly ordinal: number; readonly classname: string }[];
  /** Authored ordinals with no Q1 spawn, handed to an authored-family
   * adjunct on foreign maps (empty unless foreignWorld is enabled). */
  readonly foreign: readonly { readonly ordinal: number; readonly classname: string }[];
}

/** Map admission adds authored geometry and inhibition to the shared Q1 entity services. */
export class Q1Foundation extends Q1EntityServices {
  monsterAdmission: {
    resolve(classname: string, source: Q1Entity): MonsterDefinitionReference | null;
    spawn(actor: OwnedActor, source: Q1Entity, ordinal: number, definition: MonsterDefinitionReference): undefined;
  } | null = null;
  spawnMap(map: Q1Map): Q1SpawnReport {
    return this.spawnEntities(map.entityList, map.models.map(model => model.bounds),
      map.source.replace(/^.*[/\\]/u, "").replace(/\.bsp$/u, ""));
  }
  /** Spawn an authored entity list against foreign BSP geometry (or an
   * adjunct's kept ordinals of it). Ordinals always index the full list so
   * source slots stay authored; `keep` restricts which ordinals spawn
   * here (worldspawn always spawns so the game has its world actor). */
  spawnEntities(entityList: readonly Q1Entity[], modelBounds: readonly Bounds[], mapName: string,
    keep: ReadonlySet<number> | null = null): Q1SpawnReport {
    if (this.entities.size > 0) throw new Error("Q1 map entities already spawned");
    const replacements = new Map<number, MonsterDefinitionReference>();
    if (this.monsterAdmission !== null) for (const [ordinal, source] of entityList.entries()) {
      if (keep !== null && ordinal !== 0 && !keep.has(ordinal)) continue;
      const classname = q1EntityValue(source, "classname") ?? "";
      if (this.inhibit(classname, Number(q1EntityValue(source, "spawnflags") ?? 0)) !== null) continue;
      const definition = this.monsterAdmission.resolve(classname, source);
      if (definition !== null) replacements.set(ordinal, definition);
    }
    this.mapName = mapName;
    this.precaches.beginWorld(`maps/${this.mapName}.bsp`, Math.max(0, modelBounds.length - 1));
    this.nextDynamicSlot = (this.options.maxClients ?? 0) + entityList.length;
    const inhibited: { ordinal: number; classname: string; reason: string }[] = [];
    const compilerOnly: { ordinal: number; classname: string }[] = [];
    const foreign: { ordinal: number; classname: string }[] = [];
    for (const [ordinal, source] of entityList.entries()) {
      if (keep !== null && ordinal !== 0 && !keep.has(ordinal)) continue;
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
        this.host.combat.create(actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: false, invulnerable: false, team: null });
        this.monsterAdmission.spawn(actor, source, ordinal, definition);
        continue;
      }
      const actor = this.create(classname, source, ordinal);
      const body = this.body(actor);
      if (actor.model.startsWith("*")) {
        const modelIndex = Number(actor.model.slice(1)); const bounds = modelBounds[modelIndex];
        if (bounds === undefined) throw new Error(`Missing inline model ${actor.model}`);
        // Mod_LoadBrushModel expands each authored bound by one; QC self.size includes that expansion.
        this.host.bodies.write(actor.actor, { ...body, bounds: { min: vsub(bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(bounds.max, { x: 1, y: 1, z: 1 }) } });
      }
      try {
        this.spawnEntity(actor);
      } catch (error) {
        if (this.options.foreignWorld !== true || !(error instanceof UnknownQ1SpawnError)) throw error;
        foreign.push({ ordinal, classname: error.classname });
        this.remove(actor);
      }
    }
    linkDoors(this);
    this.precaches.freeze();
    return { spawned: this.presentations(), inhibited, compilerOnly, foreign };
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
