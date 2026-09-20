import type { ActorId } from "../../../contracts/identity.ts";
import type { TraceQuery, TraceResult } from "../../../contracts/scene.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnFields } from "../../../content/q2/foundation/host.ts";
import type { Q2MonsterDefinition } from "../../../content/q2/foundation/monsters/types.ts";
import { add, integerField, vectorField } from "../../../content/q2/foundation/fields.ts";
import { monsterSolidMask } from "../../../content/q2/foundation/monsters/ai.ts";
import type { MonsterDefinitionReference, ResolvedMap } from "../../../contracts/content.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q1Entity } from "../../../formats/q1-map/index.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import { parseVector } from "../../../content/q1/foundation/entity.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q1Actor } from "../../../content/q1/foundation/entity.ts";
import { baseSpecies } from "../../../content/q1/base/species.ts";

/** Q1 maps may store live monsters in solid space inside a target-activated teleport. */
export function isQ1TeleportStaging(game: Q1EntityServices, body: BodyState): boolean {
  for (const trigger of game.entities.values()) {
    if (trigger.classname !== "trigger_teleport" || trigger.targetname === "" || trigger.solid !== "trigger"
      || trigger.touch === null || (trigger.spawnflags & 1) !== 0) continue;
    const bounds = game.host.bodies.linked(trigger.actor.id)?.absoluteBounds;
    if (bounds !== undefined && body.origin.x + body.bounds.max.x >= bounds.min.x && body.origin.x + body.bounds.min.x <= bounds.max.x
      && body.origin.y + body.bounds.max.y >= bounds.min.y && body.origin.y + body.bounds.min.y <= bounds.max.y
      && body.origin.z + body.bounds.max.z >= bounds.min.z && body.origin.z + body.bounds.min.z <= bounds.max.z
      && game.find(trigger.target).length !== 0) return true;
  }
  return false;
}

function sameVector(left: Vec3, right: Vec3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

/** Preserve exact native Q1 startup outcomes, including failed floor drops and flying overlap. */
export function preservesAuthoredQ1Placement(input: {
  readonly map: ResolvedMap;
  readonly authored: Q1Entity | undefined;
  readonly definition: MonsterDefinitionReference;
  readonly game: Q1EntityServices;
  readonly entity: Q1Actor;
  readonly body: BodyState;
}): boolean {
  const { map, authored, definition, game, entity, body } = input;
  if (map.entities.provider !== "q1:official" || (definition.source.provider !== "q1:monsters/classic/id1" && definition.source.provider !== "q1:monsters/rerelease/id1")
    || map.entities.content !== definition.source.content || map.geometryContent !== definition.source.content || authored === undefined) return false;
  const classname = q1EntityValue(authored, "classname");
  if (classname !== definition.classname || entity.classname !== classname) return false;
  const species = baseSpecies.find(species => species.classnames.includes(classname));
  if (species === undefined || entity.movement !== "step" || entity.model !== `progs/${species.model}.mdl`
    || !sameVector(body.bounds.min, species.bounds.min) || !sameVector(body.bounds.max, species.bounds.max)) return false;
  const origin = parseVector(q1EntityValue(authored, "origin") ?? "");
  if (species.movement === "fly") return (entity.movementFlags & 3) === 1 && sameVector(body.origin, origin);
  if (species.movement !== "walk" || entity.movementFlags !== 32 || body.ground !== null || entity.solid !== "slidebox") return false;
  const start = { ...origin, z: origin.z + 1 };
  if (!sameVector(body.origin, start)) return false;
  const floor = game.host.trace({ start, end: { ...start, z: start.z - 256 }, bounds: body.bounds, ignore: entity.actor.id, monsters: true });
  return floor.fraction === 1 || floor.allSolid;
}

export function preservesAuthoredQ2Placement(input: {
  readonly map: ResolvedMap;
  readonly authored: Q2SpawnFields | undefined;
  readonly definition: MonsterDefinitionReference;
  readonly native: Q2MonsterDefinition | null;
  readonly game: Q2GameServices;
  readonly entity: Q2Entity;
  readonly body: BodyState;
}): boolean {
  const { map, authored, definition, native, game, entity, body } = input;
  if (map.entities.provider !== "q2:official" || definition.source.provider !== "q2:monsters/classic/baseq2"
    || map.entities.content !== definition.source.content || map.geometryContent !== definition.source.content
    || game.options.edition !== "classic" || authored === undefined || native === null
    || authored.classname !== definition.classname || entity.classname !== authored.classname) return false;
  if ((native.locomotion ?? "walk") !== "walk" || entity.motion !== "step" || (entity.flags & 3) !== 0
    || entity.model !== native.model || entity.scale !== 1 || entity.gravity !== 1 || !sameVector(entity.gravityVector, { x: 0, y: 0, z: -1 })
    || (integerField(authored, "spawnflags") & ~0x1f00) !== entity.spawnflags || (entity.spawnflags & 2) !== 0
    || !sameVector(body.bounds.min, native.bounds.min) || !sameVector(body.bounds.max, native.bounds.max)) return false;
  const start = add(vectorField(authored, "origin"), { x: 0, y: 0, z: 1 });
  const floor = game.host.trace({ start, end: add(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds,
    ignore: entity.actor.id, mask: monsterSolidMask(game) });
  return floor.fraction !== 1 && !floor.allSolid && floor.hit.kind === "world" && sameVector(body.origin, floor.end);
}


const placementOffsets = new Map<number, readonly { readonly x: number; readonly y: number }[]>();
function offsetsWithin(radius: number): readonly { readonly x: number; readonly y: number }[] {
  const cached = placementOffsets.get(radius);
  if (cached !== undefined) return cached;
  const offsets: { readonly x: number; readonly y: number }[] = [];
  for (let x = -Math.ceil(radius / 4); x <= Math.ceil(radius / 4); x++) {
    for (let y = -Math.ceil(radius / 4); y <= Math.ceil(radius / 4); y++) {
      if ((x * x + y * y) * 16 <= radius * radius) offsets.push({ x: x * 4, y: y * 4 });
    }
  }
  offsets.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || a.y - b.y || a.x - b.x);
  placementOffsets.set(radius, offsets);
  return offsets;
}

/** Keep the authored encounter reachable by its original hull while fitting the selected hull. */
export function nearbyMonsterPlacement(input: {
  readonly body: BodyState;
  readonly locomotion: "walk" | "fly" | "swim";
  readonly worldActor: ActorId | null;
  readonly sameMedium: (origin: Vec3) => boolean;
  readonly authored: { readonly origin: Vec3; readonly bounds: Bounds; readonly locomotion: "walk" | "fly" | "swim" };
  readonly query: Omit<TraceQuery, "start" | "end" | "shape">;
  readonly trace: (query: TraceQuery) => TraceResult;
  readonly blockedBy?: (actor: ActorId) => undefined;
}): Pick<BodyState, "origin" | "ground"> | null {
  const { body, authored, query, trace } = input;
  const routeTrace = (value: TraceQuery): TraceResult => {
    const result = trace({ ...value, policy: value.policy.kind === "q1" ? { ...value.policy, move: "no-monsters" } : value.policy });
    if (result.fraction < 1 && result.hit.kind === "actor") input.blockedBy?.(result.hit.actor);
    return result;
  };
  const sourceStart = { ...authored.origin, z: authored.origin.z + 1 };
  const sourceFloor = routeTrace({ ...query, start: sourceStart, end: { ...sourceStart, z: sourceStart.z - 256 }, shape: { kind: "box", bounds: authored.bounds } });
  const supported = !sourceFloor.startSolid && !sourceFloor.allSolid && sourceFloor.fraction < 1;
  const sourceOrigin = supported && authored.locomotion === "walk" ? sourceFloor.end : authored.origin;
  const reachable = (end: Vec3): boolean => {
    const route = routeTrace({ ...query, start: sourceOrigin, end, shape: { kind: "box", bounds: authored.bounds } });
    if (route.allSolid || route.fraction !== 1) return false;
    if (!route.startSolid) return true;
    // Authored hulls can overlap a wall. Require a clear center route and a full-hull exit.
    const center = routeTrace({ ...query, start: sourceOrigin, end, shape: { kind: "point" } });
    const exit = routeTrace({ ...query, start: end, end, shape: { kind: "box", bounds: authored.bounds } });
    return !center.startSolid && !center.allSolid && center.fraction === 1 && !exit.startSolid && !exit.allSolid;
  };
  const feet = sourceOrigin.z + authored.bounds.min.z;
  const anchor = { x: sourceFloor.end.x, y: sourceFloor.end.y, z: feet - body.bounds.min.z };
  const radius = 2 * Math.max(body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y,
    authored.bounds.max.x - authored.bounds.min.x, authored.bounds.max.y - authored.bounds.min.y);
  const offsets = offsetsWithin(radius);
  if (input.locomotion !== "walk") {
    const vertical = [0];
    for (let z = 4; z <= body.bounds.max.z - body.bounds.min.z; z += 4) vertical.push(-z, z);
    for (const offset of offsets) for (const z of vertical) {
      const origin = { x: body.origin.x + offset.x, y: body.origin.y + offset.y, z: body.origin.z + z };
      if (!input.sameMedium(origin)) continue;
      const fit = trace({ ...query, start: origin, end: origin, shape: { kind: "box", bounds: body.bounds } });
      if (fit.startSolid || fit.allSolid) continue;
      const sourceEnd = { ...origin, z: origin.z + body.bounds.min.z - authored.bounds.min.z };
      if (reachable(sourceEnd)) return { origin, ground: null };
    }
  }
  if (input.locomotion === "walk") for (const offset of offsets) for (const lift of [1, 18]) {
    const start = { x: anchor.x + offset.x, y: anchor.y + offset.y, z: anchor.z + lift };
    const floor = trace({ ...query, start, end: { ...start, z: anchor.z - (supported && authored.locomotion === "walk" ? 18 : 256) }, shape: { kind: "box", bounds: body.bounds } });
    if (floor.startSolid || floor.allSolid || floor.fraction === 1 || floor.contact.kind !== "plane" || floor.contact.plane.normal.z < 0.7) continue;
    if (!input.sameMedium(floor.end)) continue;
    const fit = trace({ ...query, start: floor.end, end: floor.end, shape: { kind: "box", bounds: body.bounds } });
    if (fit.startSolid || fit.allSolid) continue;
    const sourceEnd = { ...floor.end, z: floor.end.z + body.bounds.min.z - authored.bounds.min.z };
    if (!reachable(sourceEnd)) continue;
    return { origin: floor.end, ground: floor.hit.kind === "actor" ? floor.hit.actor : input.worldActor };
  }
  if (!supported || authored.locomotion !== "walk") return null;
  // Tight authored pockets can open around a corner: follow walkable source-hull edges.
  const pending: Vec3[] = [sourceOrigin];
  const visited = new Set<string>(["0,0"]);
  const reach = Math.max(512, radius);
  for (let index = 0; index < pending.length && index < 4096; index++) {
    const current = pending[index];
    if (current === undefined) break;
    for (const direction of [{ x: 8, y: 0 }, { x: -8, y: 0 }, { x: 0, y: 8 }, { x: 0, y: -8 }]) {
      const x = current.x + direction.x, y = current.y + direction.y;
      const key = `${x - sourceOrigin.x},${y - sourceOrigin.y}`;
      if (visited.has(key) || Math.hypot(x - sourceOrigin.x, y - sourceOrigin.y) > reach) continue;
      for (const lift of [0, 18]) {
        const start = { ...current, z: current.z + lift };
        const raised = routeTrace({ ...query, start: current, end: start, shape: { kind: "box", bounds: authored.bounds } });
        if (raised.startSolid || raised.allSolid || raised.fraction !== 1) continue;
        const across = routeTrace({ ...query, start, end: { x, y, z: start.z }, shape: { kind: "box", bounds: authored.bounds } });
        if (across.startSolid || across.allSolid || across.fraction !== 1) continue;
        const floor = routeTrace({ ...query, start: across.end, end: { x, y, z: current.z - 18 }, shape: { kind: "box", bounds: authored.bounds } });
        if (floor.startSolid || floor.allSolid || floor.fraction === 1 || floor.contact.kind !== "plane" || floor.contact.plane.normal.z < 0.7) continue;
        visited.add(key);
        pending.push(floor.end);
        const origin = { ...floor.end, z: floor.end.z + authored.bounds.min.z - body.bounds.min.z };
        if (input.sameMedium(origin)) {
          const fit = trace({ ...query, start: origin, end: origin, shape: { kind: "box", bounds: body.bounds } });
          if (!fit.startSolid && !fit.allSolid) return { origin, ground: input.locomotion !== "walk" ? null : floor.hit.kind === "actor" ? floor.hit.actor : input.worldActor };
        }
        break;
      }
    }
  }
  return null;
}
